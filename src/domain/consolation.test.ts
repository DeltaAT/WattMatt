import { describe, expect, it } from 'vitest';

import {
  canStartConsolation,
  closeConsolationRound,
  consolationBlockers,
  consolationField,
  consolationSummary,
  declineConsolation,
  drawConsolationRound,
  isConsolationOffered,
  isConsolationRunning,
  settleConsolation,
  startConsolation,
} from '@/domain/consolation';
import { closeRound, drawRound, nextQueuedMatch, queuedMatches, setWinner } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { carriedField } from '@/domain/progression';
import { createRng } from '@/domain/rng';
import { nextPowerOfTwo } from '@/domain/round';
import { activeGroups, consolationGroups, currentRound, roundsOfTrack } from '@/domain/selectors';
import { FIXED_NOW, group, groupId, table, tournament } from '@/domain/testFixtures';
import type { Match, Round, Tournament } from '@/domain/types';

/**
 * The `Trostrunde` (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * The tests are built out of *played* tournaments rather than hand-written
 * ones wherever the property is about the interaction between the two tracks.
 * The whole point of the issue is that two rounds are live at once out of one
 * pool of tables and one RNG stream, and a fixture that asserts the end state
 * directly would prove nothing about the path the host actually walks.
 */

/** A tournament in `QUALIFYING` with `n` groups and `tables` free tables. */
function readyToPlay(n: number, tables = 2): Tournament {
  return tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: n }, (_unused, index) => group(index + 1)),
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
  });
}

/** Marks every open match of a round, `a` winning, and closes it. */
function playOut(start: Tournament, track: 'MAIN' | 'CONSOLATION' = 'MAIN'): Tournament {
  let next = start;
  const round = currentRound(next, track);
  if (round === null) {
    return next;
  }

  for (const match of round.matches) {
    if (match.b === null || match.winnerId !== null) {
      continue;
    }
    next = setWinner(next, match.id, match.a);
  }
  return track === 'CONSOLATION' ? closeConsolationRound(next) : closeRound(next, track);
}

/** The qualifying round played out, which is where every §10 test starts. */
function afterQualifying(n: number, tables = 2): Tournament {
  const drawn = drawRound(readyToPlay(n, tables), {
    at: FIXED_NOW,
    label: (index) => `Round ${index}`,
  });
  return playOut(drawn);
}

function ids(groups: readonly { id: GroupId }[]): readonly GroupId[] {
  return groups.map((entry) => entry.id).sort();
}

describe('consolationField', () => {
  it('is every first-round loser the Hoffnungsrunde did not take', () => {
    // 13 groups: 6 pairs plus a `Freilos`, so 7 through and 6 out (§3, §9 #1).
    const played = afterQualifying(13);

    expect(consolationField(played)).toHaveLength(6);
    expect(activeGroups(played)).toHaveLength(7);
  });

  it('is empty while the qualifying round is still open', () => {
    const drawn = drawRound(readyToPlay(8), {
      at: FIXED_NOW,
      label: (index) => `Round ${index}`,
    });

    // Nobody has lost yet in the sense §10 means: the round can still be
    // corrected, and a field read now would go stale on the next click.
    expect(consolationField(drawn)).toEqual([]);
  });

  it('leaves out a loser the Hoffnungsrunde drew back into the main field', () => {
    const played = afterQualifying(13);
    const drawnUp = consolationField(played)[0];
    expect(drawnUp).toBeDefined();

    // What `acceptCandidate` does, in one line: the group is `ACTIVE` again.
    const promoted: Tournament = {
      ...played,
      groups: played.groups.map((entry) =>
        entry.id === drawnUp?.id ? { ...entry, status: 'ACTIVE' } : entry,
      ),
    };

    expect(consolationField(promoted)).toHaveLength(5);
    expect(ids(consolationField(promoted))).not.toContain(drawnUp?.id);
  });

  /*
   * docs/OPEN-QUESTIONS.md #6 as §10 settles it: declining the lottery is
   * declining the *main field*, not the evening. A decliner is `ELIMINATED`
   * like any other loser, so it is in the side event's field for free — and
   * this test is what says that is deliberate rather than accidental.
   */
  it('includes a group that declined the Hoffnungsrunde', () => {
    const played = afterQualifying(13);
    const decliner = consolationField(played)[0];

    expect(ids(consolationField(played))).toContain(decliner?.id);
  });

  it('does not include a group that never played the qualifying round', () => {
    const played = afterQualifying(13);
    // A latecomer added mid-tournament (§2) and then knocked out some other
    // way. The side event is for the *first-round* losers.
    const late = group(99, { status: 'ELIMINATED' });
    const withLate: Tournament = { ...played, groups: [...played.groups, late] };

    expect(ids(consolationField(withLate))).not.toContain(late.id);
  });
});

describe('consolationBlockers', () => {
  it('is empty once the qualifying round is closed and nobody has answered', () => {
    expect(consolationBlockers(afterQualifying(13))).toEqual([]);
    expect(canStartConsolation(afterQualifying(13))).toBe(true);
    expect(isConsolationOffered(afterQualifying(13))).toBe(true);
  });

  it('names the open qualifying round', () => {
    const drawn = drawRound(readyToPlay(13), {
      at: FIXED_NOW,
      label: (index) => `Round ${index}`,
    });

    expect(consolationBlockers(drawn)).toContain('QUALIFYING_OPEN');
  });

  /*
   * The ordering rule of §10, as a refusal. The lottery removes groups from the
   * loser pool, so a side event started first would take a field that is still
   * shrinking — and would take groups the lottery was about to draw up.
   */
  it('waits for a Hoffnungsrunde that is still drawing', () => {
    const played = afterQualifying(13);
    const mid: Tournament = {
      ...played,
      phase: 'REPECHAGE',
      repechage: { target: 8, pool: [groupId(2)], draws: [], fallbackUsed: null },
    };

    expect(consolationBlockers(mid)).toContain('REPECHAGE_OPEN');
    expect(canStartConsolation(mid)).toBe(false);
  });

  it('stops asking once the host has answered', () => {
    const started = startConsolation(afterQualifying(13));

    expect(consolationBlockers(started)).toContain('ALREADY_ANSWERED');
    expect(isConsolationOffered(started)).toBe(false);
  });

  /*
   * Issue #73's second and third test cases. A field of one has nobody to play
   * and a field of none has nobody at all; §10 says neither produces a side
   * event, and the point is that neither produces an *empty round* either.
   */
  it.each([
    ['one', 1],
    ['none', 0],
  ])('refuses a field of %s', (_name, remaining) => {
    const played = afterQualifying(13);
    const field = consolationField(played);
    const staying = new Set(field.slice(0, remaining).map((entry) => entry.id));

    // Everyone else drawn back up by the lottery.
    const promoted: Tournament = {
      ...played,
      groups: played.groups.map((entry) =>
        entry.status === 'ELIMINATED' && !staying.has(entry.id)
          ? { ...entry, status: 'ACTIVE' }
          : entry,
      ),
    };

    expect(consolationField(promoted)).toHaveLength(remaining);
    expect(consolationBlockers(promoted)).toContain('FIELD_TOO_SMALL');
    expect(isConsolationOffered(promoted)).toBe(false);
    // The whole point: nothing to start means nothing to draw, so no round with
    // nothing in it can ever be appended.
    expect(startConsolation(promoted)).toBe(promoted);
    expect(roundsOfTrack(startConsolation(promoted), 'CONSOLATION')).toEqual([]);
  });
});

describe('startConsolation', () => {
  it('moves the whole field from ELIMINATED into CONSOLATION', () => {
    const played = afterQualifying(13);
    const field = ids(consolationField(played));

    const started = startConsolation(played);

    expect(ids(consolationGroups(started))).toEqual(field);
    expect(isConsolationRunning(started)).toBe(true);
    expect(started.consolation).toEqual({ state: 'RUNNING', winnerId: null });
  });

  it('leaves the main field exactly as it was', () => {
    const played = afterQualifying(13);
    const started = startConsolation(played);

    expect(ids(activeGroups(started))).toEqual(ids(activeGroups(played)));
    expect(started.rounds).toBe(played.rounds);
    expect(started.tables).toBe(played.tables);
    expect(started.rngCursor).toBe(played.rngCursor);
  });

  it('hands its argument back when a blocker is standing', () => {
    const drawn = drawRound(readyToPlay(13), {
      at: FIXED_NOW,
      label: (index) => `Round ${index}`,
    });

    expect(startConsolation(drawn)).toBe(drawn);
  });
});

describe('declineConsolation', () => {
  it('records the answer without touching anybody', () => {
    const played = afterQualifying(13);
    const declined = declineConsolation(played);

    expect(declined.consolation).toEqual({ state: 'DECLINED', winnerId: null });
    expect(declined.groups).toBe(played.groups);
    // Nothing to run, so nothing to draw a panel of.
    expect(consolationSummary(declined)).toBeNull();
    expect(isConsolationOffered(declined)).toBe(false);
  });
});

describe('a Trostrunde played to its end', () => {
  /**
   * Issue #73's first test case, walked rather than asserted.
   *
   * 13 groups leave 6 losers; the lottery draws one of them back up; 5 play the
   * side event. 5 is odd, so round 1 is two pairs and a `Freilos` and leaves 3;
   * round 2 is one pair and a `Freilos` and leaves 2; round 3 is the final pair.
   * Three rounds, one winner.
   */
  function fiveInTheSideEvent(): Tournament {
    const played = afterQualifying(13);
    const drawnUp = consolationField(played)[0];
    const promoted: Tournament = {
      ...played,
      groups: played.groups.map((entry) =>
        entry.id === drawnUp?.id ? { ...entry, status: 'ACTIVE' } : entry,
      ),
    };
    return startConsolation(promoted);
  }

  function drawSide(next: Tournament): Tournament {
    return drawConsolationRound(next, { at: FIXED_NOW, label: (index) => `Trost ${index}` });
  }

  it('reaches one winner after three rounds, with a Freilos in the first', () => {
    let next = fiveInTheSideEvent();
    expect(consolationGroups(next)).toHaveLength(5);

    next = drawSide(next);
    const first = currentRound(next, 'CONSOLATION');
    expect(first?.matches).toHaveLength(3);
    // The odd count earns exactly one `Freilos`, decided by the draw itself.
    expect(first?.matches.filter((match) => match.b === null)).toHaveLength(1);
    next = playOut(next, 'CONSOLATION');
    expect(consolationGroups(next)).toHaveLength(3);

    next = playOut(drawSide(next), 'CONSOLATION');
    expect(consolationGroups(next)).toHaveLength(2);

    next = playOut(drawSide(next), 'CONSOLATION');

    expect(roundsOfTrack(next, 'CONSOLATION')).toHaveLength(3);
    expect(consolationGroups(next)).toHaveLength(1);
    expect(next.consolation?.state).toBe('FINISHED');
    expect(next.consolation?.winnerId).toBe(consolationGroups(next)[0]?.id);
  });

  it('numbers its rounds per track, not across the file', () => {
    let next = drawSide(fiveInTheSideEvent());
    expect(currentRound(next, 'CONSOLATION')?.index).toBe(1);

    next = drawSide(playOut(next, 'CONSOLATION'));

    // The qualifying round is `rounds[0]`, so a count over the file would say 3.
    expect(currentRound(next, 'CONSOLATION')?.index).toBe(2);
  });

  it('refuses to draw once it is decided', () => {
    let next = fiveInTheSideEvent();
    for (let round = 0; round < 3; round += 1) {
      next = playOut(drawSide(next), 'CONSOLATION');
    }

    expect(next.consolation?.state).toBe('FINISHED');
    expect(drawSide(next)).toBe(next);
  });

  it('does not call the field a winner before a round has been played', () => {
    const started = fiveInTheSideEvent();

    // `startConsolation` moved the field across; nothing has been drawn.
    expect(settleConsolation(started)).toBe(started);
    expect(started.consolation?.winnerId).toBeNull();
  });

  it('never puts a Trostrunde winner back into the main field', () => {
    let next = fiveInTheSideEvent();
    const mainField = ids(activeGroups(next));

    for (let round = 0; round < 3; round += 1) {
      next = playOut(drawSide(next), 'CONSOLATION');
    }

    // The whole of "self-contained": the winner is still in `CONSOLATION`, and
    // the main field has exactly the groups it had before the side event began.
    expect(next.groups.find((entry) => entry.id === next.consolation?.winnerId)?.status).toBe(
      'CONSOLATION',
    );
    expect(ids(activeGroups(next))).toEqual(mainField);
  });
});

describe('consolationSummary', () => {
  it('is null while the host has not been asked', () => {
    expect(consolationSummary(afterQualifying(13))).toBeNull();
  });

  it('carries the standing field, the rounds and the open one', () => {
    const started = startConsolation(afterQualifying(13));
    const drawn = drawConsolationRound(started, {
      at: FIXED_NOW,
      label: (index) => `Trost ${index}`,
      rng: createRng('side'),
    });

    const summary = consolationSummary(drawn);

    expect(summary?.state).toBe('RUNNING');
    expect(summary?.standing).toHaveLength(6);
    expect(summary?.rounds).toHaveLength(1);
    expect(summary?.round?.track).toBe('CONSOLATION');
    expect(summary?.winner).toBeNull();
  });
});

describe('the two tracks side by side', () => {
  /**
   * The main field in an elimination round while the side event runs, which is
   * the state issue #73 calls "the real cost" — and the one every property
   * below is about.
   */
  function bothLive(): Tournament {
    // 64 groups: 32 through, 32 out. Already a power of two, so §4 is skipped
    // (§9 case 2) and 32 is still above the final phase, so §5 has an
    // elimination round left to deal — which is the only state in which the two
    // tracks are genuinely live together.
    const played = afterQualifying(64, 4);
    const started = startConsolation({ ...played, phase: 'ELIMINATION' });

    const withMain = drawRound(started, { at: FIXED_NOW, label: (index) => `Round ${index}` });

    // One main-field result comes in before the side event is drawn, so a table
    // frees up and the `Trostrunde` draw takes it. Without this the main round
    // holds every table and the side event queues entirely — true, and the
    // uninteresting half of the case (issue #79 is where the host gets to
    // reserve tables for a track).
    const mainRound = currentRound(withMain, 'MAIN');
    const onTable = mainRound?.matches.find((match) => match.tableId !== null);
    expect(onTable).toBeDefined();
    const freed = setWinner(withMain, onTable!.id, onTable!.a);

    return drawConsolationRound(freed, { at: FIXED_NOW, label: (index) => `Trost ${index}` });
  }

  /** Every match of a round that is still open, on either track. */
  function liveMatches(document: Tournament): readonly Match[] {
    return document.rounds
      .filter((round) => round.state !== 'CLOSED')
      .flatMap((round) => round.matches);
  }

  it('keeps both rounds open at once, one per track', () => {
    const live = bothLive();

    expect(currentRound(live, 'MAIN')?.kind).toBe('ELIMINATION');
    expect(currentRound(live, 'CONSOLATION')?.kind).toBe('CONSOLATION');
    expect(currentRound(live, 'MAIN')).not.toBe(currentRound(live, 'CONSOLATION'));
  });

  /* Issue #73's fifth test case, as a property of every pairing that exists. */
  it('never draws a Trostrunde group into a main-field match', () => {
    const live = bothLive();
    const sideEvent = new Set(consolationGroups(live).map((entry) => entry.id));

    const main = currentRound(live, 'MAIN');
    expect(main?.matches.length).toBeGreaterThan(0);
    for (const match of main?.matches ?? []) {
      expect(sideEvent.has(match.a)).toBe(false);
      if (match.b !== null) {
        expect(sideEvent.has(match.b)).toBe(false);
      }
    }
  });

  it('never draws a main-field group into a Trostrunde match', () => {
    const live = bothLive();
    const mainField = new Set(activeGroups(live).map((entry) => entry.id));

    const side = currentRound(live, 'CONSOLATION');
    expect(side?.matches.length).toBeGreaterThan(0);
    for (const match of side?.matches ?? []) {
      expect(mainField.has(match.a)).toBe(false);
      if (match.b !== null) {
        expect(mainField.has(match.b)).toBe(false);
      }
    }
  });

  /* Issue #73's sixth test case: one pool of tables, two rounds drawing on it. */
  it('gives no table to two matches', () => {
    const live = bothLive();

    // Closed rounds are left out on purpose: a decided match keeps the
    // `tableId` it was played on as the record of where that happened, and two
    // rounds having used the same table an hour apart is not a clash.
    const running = liveMatches(live).filter(
      (match) => match.tableId !== null && match.winnerId === null,
    );

    // Both tracks are actually on tables, or this proves nothing.
    const tracksOnTables = new Set(
      live.rounds
        .filter((round) => round.matches.some((match) => running.includes(match)))
        .map((round) => round.track),
    );
    expect(tracksOnTables).toEqual(new Set(['MAIN', 'CONSOLATION']));

    const tables = running.map((match) => match.tableId);
    expect(new Set(tables).size).toBe(tables.length);

    // And every occupied table names a match that is really on it.
    for (const seat of live.tables) {
      if (seat.currentMatchId === null) {
        continue;
      }
      expect(running.some((match) => match.id === seat.currentMatchId)).toBe(true);
    }
  });

  it('serves each track its own queue', () => {
    const live = bothLive();
    const mainRound = currentRound(live, 'MAIN');
    const sideRound = currentRound(live, 'CONSOLATION');

    expect(nextQueuedMatch(live, 'MAIN')?.id).toBe(queuedMatches(mainRound!)[0]?.id);
    expect(nextQueuedMatch(live, 'CONSOLATION')?.id).toBe(queuedMatches(sideRound!)[0]?.id);
    // The two queues never offer the same pair — the rounds share no match.
    expect(nextQueuedMatch(live, 'MAIN')?.id).not.toBe(nextQueuedMatch(live, 'CONSOLATION')?.id);
  });

  /*
   * Issue #73's fourth test case. The side event takes groups out of
   * `ELIMINATED` and gives them rounds of their own; none of that may reach the
   * arithmetic §5 halves the main field with.
   */
  it('leaves the main field a power of two', () => {
    const live = bothLive();

    // The field the main round carries forward is its match count, not the
    // groups standing: every match yields exactly one winner
    // (docs/OPEN-QUESTIONS.md #52). 64 groups leave 32, and 32 halve to 16.
    expect(carriedField(live)).toBe(16);
    expect(nextPowerOfTwo(carriedField(live))).toBe(carriedField(live));

    // A whole `Trostrunde` round played out changes none of it.
    const played = playOut(live, 'CONSOLATION');

    expect(carriedField(played)).toBe(16);
    expect(currentRound(played, 'MAIN')).toBe(currentRound(live, 'MAIN'));
  });

  /*
   * Issue #73's seventh test case, in the form the domain can state it: a
   * mutation on one track leaves the other track's rounds and record not merely
   * equal but the *same objects*. The store's undo is a whole-document restore,
   * so what it has to be able to rely on is exactly this — that the action it is
   * undoing never touched the other half in the first place.
   */
  it('leaves the other track untouched when a result is marked', () => {
    const live = bothLive();
    const mainRound = currentRound(live, 'MAIN');
    const sideRound = currentRound(live, 'CONSOLATION');
    const target = sideRound?.matches.find((match) => match.b !== null);
    expect(target).toBeDefined();

    const marked = setWinner(live, target!.id, target!.a);

    expect(roundById(marked, mainRound!.id)).toBe(mainRound);
    expect(roundById(marked, sideRound!.id)).not.toBe(sideRound);
  });

  it('leaves the Trostrunde untouched when the main field closes a round', () => {
    const live = bothLive();
    const sideRound = currentRound(live, 'CONSOLATION');

    const played = playOut(live, 'MAIN');

    expect(played.consolation).toBe(live.consolation);
    expect(roundById(played, sideRound!.id)).toBe(sideRound);
    expect(ids(consolationGroups(played))).toEqual(ids(consolationGroups(live)));
  });

  it('leaves the main field untouched when the Trostrunde closes a round', () => {
    const live = bothLive();
    const mainRound = currentRound(live, 'MAIN');
    const mainField = ids(activeGroups(live));

    const played = playOut(live, 'CONSOLATION');

    expect(roundById(played, mainRound!.id)).toBe(mainRound);
    expect(ids(activeGroups(played))).toEqual(mainField);
    expect(played.phase).toBe(live.phase);
  });
});

function roundById(document: Tournament, id: Round['id']): Round | undefined {
  return document.rounds.find((round) => round.id === id);
}
