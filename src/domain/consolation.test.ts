import { describe, expect, it } from 'vitest';

import {
  drawBracket,
  finalStandings,
  finishBracket,
  hasThirdPlace,
  isBracketComplete,
  setBracketWinner,
} from '@/domain/bracket';
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
import {
  canDrawRound,
  closeRound,
  drawRound,
  nextQueuedMatch,
  queuedMatches,
  setWinner,
} from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { setGroupName } from '@/domain/naming';
import { advancePhase, carriedField } from '@/domain/progression';
import {
  acceptCandidate,
  drawCandidate,
  isRepechageComplete,
  repechageState,
  useRepechageFallback,
} from '@/domain/repechage';
import { createRng } from '@/domain/rng';
import { nextPowerOfTwo } from '@/domain/round';
import { activeGroups, consolationGroups, currentRound, roundsOfTrack } from '@/domain/selectors';
import { toTournamentSnapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, groupId, table, tournament } from '@/domain/testFixtures';
import { trackState } from '@/domain/track';
import type { Match, Round, Tournament } from '@/domain/types';

/**
 * The `Trostrunde` (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * The tests are built out of *played* tournaments rather than hand-written
 * ones wherever the property is about the interaction between the two tracks.
 * The whole point of the issue is that two rounds are live at once out of one
 * pool of tables and one RNG stream, and a fixture that asserts the end state
 * directly would prove nothing about the path the host actually walks.
 *
 * Issue #91 makes that argument twice over. The side event now runs the *whole*
 * pipeline — its own `Hoffnungsrunde`, its own elimination rounds, its own
 * bracket with a `Spiel um Platz 3` — and the claim is that it is one pipeline
 * run twice rather than two pipelines. The only way to check that is to walk
 * the host's path on the side event exactly as the main field's tests walk it
 * on the main field, which is what `playSideEvent` does.
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
    expect(started.consolation).toEqual({
      state: 'RUNNING',
      phase: 'QUALIFYING',
      repechage: null,
      bracket: null,
      winnerId: null,
    });
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

    expect(declined.consolation).toEqual({
      state: 'DECLINED',
      phase: 'SETUP',
      repechage: null,
      bracket: null,
      winnerId: null,
    });
    expect(declined.groups).toBe(played.groups);
    // Nothing to run, so nothing to draw a panel of.
    expect(consolationSummary(declined)).toBeNull();
    expect(isConsolationOffered(declined)).toBe(false);
  });
});

describe('a Trostrunde played to its end', () => {
  /**
   * A side event of exactly `n` groups, however many the main field had.
   *
   * Built by playing the qualifying round and then promoting whichever losers
   * are surplus, which is what the main `Hoffnungsrunde` does to them: the
   * side event's field is *whoever the lottery left behind* (§10), and a
   * fixture that wrote the statuses by hand would not be that.
   */
  function sideEventOf(n: number, mainGroups = 13, tables = 2): Tournament {
    const played = afterQualifying(mainGroups, tables);
    const surplus = consolationField(played).slice(n);
    const promoted: Tournament = {
      ...played,
      groups: played.groups.map((entry) =>
        surplus.some((loser) => loser.id === entry.id) ? { ...entry, status: 'ACTIVE' } : entry,
      ),
    };
    return startConsolation(promoted);
  }

  function drawSide(next: Tournament): Tournament {
    return drawConsolationRound(next, { at: FIXED_NOW, label: (index) => `Trost ${index}` });
  }

  /** Marks a winner in every bracket node that has two participants and none. */
  function playBracketOnce(start: Tournament): Tournament {
    let next = start;
    for (const node of trackState(start, 'CONSOLATION').bracket?.nodes ?? []) {
      if (node.slotA !== null && node.slotB !== null && node.winnerId === null) {
        next = setBracketWinner(next, node.id, node.slotA, 'CONSOLATION');
      }
    }
    return next;
  }

  /**
   * The whole side event, walked the way the host walks it.
   *
   * Draw a round, play it, close it, move the phase on; run the lottery when
   * the field is not a power of two, accepting every candidate; draw the tree
   * and play it out; press *abschließen*. Every one of those is the same call
   * the main field makes with `track` set the other way, which is the claim
   * issue #91 is really making.
   *
   * The guard is a test's version of "this terminates": a pipeline that could
   * loop would hang the suite rather than fail it, and a hung suite is the one
   * failure nobody reads.
   */
  function playSideEvent(from: Tournament): Tournament {
    let next = from;

    for (let step = 0; step < 60; step += 1) {
      if (next.consolation?.state !== 'RUNNING') {
        return next;
      }
      const phase = next.consolation.phase;

      if (phase === 'QUALIFYING' || phase === 'ELIMINATION') {
        if (currentRound(next, 'CONSOLATION') !== null) {
          next = playOut(next, 'CONSOLATION');
        } else if (canDrawRound(next, 'CONSOLATION')) {
          next = drawSide(next);
        } else {
          next = advancePhase(next, 'CONSOLATION');
        }
        continue;
      }

      if (phase === 'REPECHAGE') {
        const state = repechageState(next, 'CONSOLATION');
        if (isRepechageComplete(next, 'CONSOLATION') || state === null) {
          next = advancePhase(next, 'CONSOLATION');
        } else if (state.pending !== null) {
          next = acceptCandidate(next, 'CONSOLATION');
        } else if (state.remaining.length > 0) {
          next = drawCandidate(next, 'CONSOLATION');
        } else {
          next = useRepechageFallback(next, 'BYES', 'CONSOLATION');
        }
        continue;
      }

      if (phase === 'BRACKET') {
        if (trackState(next, 'CONSOLATION').bracket === null) {
          next = drawBracket(next, { at: FIXED_NOW }, 'CONSOLATION');
        } else if (isBracketComplete(next, 'CONSOLATION')) {
          next = finishBracket(next, 'CONSOLATION');
        } else {
          next = playBracketOnce(next);
        }
        continue;
      }

      return next;
    }

    throw new Error('the side event did not terminate');
  }

  /**
   * The **main** field walked to its podium, so the two tournaments can be
   * checked side by side (issue #91).
   *
   * The same loop as `playSideEvent` with the track the other way round, plus
   * the one step the side event does not have: §6's naming phase, which the
   * main field passes through and the `Trostrunde` never enters. That the two
   * loops are otherwise the same call sequence is the claim this issue makes.
   */
  function playMainField(from: Tournament): Tournament {
    let next = from;

    for (let step = 0; step < 60; step += 1) {
      const phase = next.phase;

      if (phase === 'QUALIFYING' || phase === 'ELIMINATION') {
        if (currentRound(next) !== null) {
          next = playOut(next, 'MAIN');
        } else if (canDrawRound(next)) {
          next = drawRound(next, { at: FIXED_NOW, label: (index) => `Runde ${index}` });
        } else {
          next = advancePhase(next);
        }
        continue;
      }

      if (phase === 'REPECHAGE') {
        const state = repechageState(next);
        if (isRepechageComplete(next) || state === null) {
          next = advancePhase(next);
        } else if (state.pending !== null) {
          next = acceptCandidate(next);
        } else if (state.remaining.length > 0) {
          next = drawCandidate(next);
        } else {
          next = useRepechageFallback(next, 'BYES');
        }
        continue;
      }

      if (phase === 'NAMING') {
        // Every name the tree needs, typed the way the host types them (§6),
        // and then the draw — which is what moves the phase, exactly as it does
        // for the side event: the tree and the phase are halves of one press.
        for (const entry of activeGroups(next)) {
          if (entry.name === null) {
            next = setGroupName(next, entry.id, `Team ${entry.number}`);
          }
        }
        next = drawBracket(next, { at: FIXED_NOW });
        continue;
      }

      if (phase === 'BRACKET') {
        if (next.bracket === null) {
          next = drawBracket(next, { at: FIXED_NOW });
        } else if (isBracketComplete(next)) {
          next = finishBracket(next);
        } else {
          for (const node of next.bracket.nodes) {
            if (node.slotA !== null && node.slotB !== null && node.winnerId === null) {
              next = setBracketWinner(next, node.id, node.slotA);
            }
          }
        }
        continue;
      }

      return next;
    }

    throw new Error('the main field did not terminate');
  }

  const sideBracket = (document: Tournament) => trackState(document, 'CONSOLATION').bracket;

  /*
   * Issue #91's headline case: a field of five runs the lottery and then a
   * four-slot bracket **with** a third-place match. Walked one press at a time,
   * because every one of those presses is a main-field call with the track set
   * the other way.
   */
  it('runs a field of five through its own lottery into a four-slot bracket', () => {
    const started = sideEventOf(5);
    expect(consolationGroups(started)).toHaveLength(5);

    // Round 1: two pairs and a `Freilos`, which leaves three.
    let next = drawSide(started);
    expect(currentRound(next, 'CONSOLATION')?.matches).toHaveLength(3);
    expect(
      currentRound(next, 'CONSOLATION')?.matches.filter((match) => match.b === null),
    ).toHaveLength(1);
    next = advancePhase(playOut(next, 'CONSOLATION'), 'CONSOLATION');

    // Three is not a power of two, so its own `Hoffnungsrunde` opens.
    expect(next.consolation?.phase).toBe('REPECHAGE');
    expect(repechageState(next, 'CONSOLATION')?.target).toBe(4);
    expect(repechageState(next, 'CONSOLATION')?.need).toBe(1);

    next = acceptCandidate(drawCandidate(next, 'CONSOLATION'), 'CONSOLATION');
    expect(isRepechageComplete(next, 'CONSOLATION')).toBe(true);

    // Then the tree, with the third-place match §7 gives every bracket of four.
    next = advancePhase(next, 'CONSOLATION');
    expect(next.consolation?.phase).toBe('BRACKET');
    next = drawBracket(next, { at: FIXED_NOW }, 'CONSOLATION');

    expect(sideBracket(next)?.size).toBe(4);
    expect(hasThirdPlace(sideBracket(next)!)).toBe(true);
    expect(sideBracket(next)?.thirdPlaceNodeId).not.toBeNull();
  });

  /*
   * "Trostrunde field of 2 → single match, no Hoffnungsrunde, no third place,
   * immediate winner."
   *
   * Which is what a bracket of two *is* — a `Finale` and nothing else (§9 case
   * 5, §9 case 10). The side event takes the same route the main field takes at
   * two participants: no qualifying round, because the one match there is to
   * play is the final, and therefore no lottery and no `Spiel um Platz 3`
   * either. That the single match is modelled as a tree rather than as a round
   * is the price of one pipeline instead of two, and it is the cheaper half of
   * the trade (docs/OPEN-QUESTIONS.md, entry 101).
   */
  it('ends a field of two with a single match and nothing else', () => {
    const played = playSideEvent(sideEventOf(2));

    expect(roundsOfTrack(played, 'CONSOLATION')).toHaveLength(0);
    expect(trackState(played, 'CONSOLATION').repechage).toBeNull();
    expect(sideBracket(played)?.size).toBe(2);
    expect(sideBracket(played)?.nodes).toHaveLength(1);
    expect(hasThirdPlace(sideBracket(played)!)).toBe(false);
    expect(played.consolation?.state).toBe('FINISHED');
    expect(played.consolation?.winnerId).not.toBeNull();
  });

  /* Every field the side event can have, played to exactly one winner. */
  it.each([2, 3, 4, 5, 9])('terminates a field of %i with exactly one winner', (size) => {
    const played = playSideEvent(sideEventOf(size, Math.max(13, size * 2 + 1)));

    expect(played.consolation?.state).toBe('FINISHED');
    expect(played.consolation?.winnerId).not.toBeNull();
  });

  /*
   * The issue's first test case, end to end: 40 groups leave 20 losers, the
   * main lottery draws four of them back up, and the sixteen that are left run
   * a whole tournament of their own.
   */
  it('runs sixteen through the full pipeline after a field of forty', () => {
    const started = sideEventOf(16, 40, 4);
    expect(consolationGroups(started)).toHaveLength(16);

    const played = playSideEvent(started);

    // Eight first-round matches, then a bracket of eight — no lottery, because
    // eight is already a power of two (§9 case 2).
    expect(roundsOfTrack(played, 'CONSOLATION')).toHaveLength(1);
    expect(trackState(played, 'CONSOLATION').repechage).toBeNull();
    expect(sideBracket(played)?.size).toBe(8);
    expect(hasThirdPlace(sideBracket(played)!)).toBe(true);
    expect(played.consolation?.state).toBe('FINISHED');
  });

  /* The naming phase is the one part of the pipeline the side event skips: it
   * is numbers from its first round to its final (§10). */
  it.each([2, 3, 5, 9, 16])('never enters the naming phase at a field of %i', (size) => {
    const played = playSideEvent(sideEventOf(size, Math.max(13, size * 2 + 1)));

    expect(played.consolation?.phase).not.toBe('NAMING');
    expect(played.consolation?.phase).not.toBe('CEREMONY');
    // And nobody in it was ever asked for a name.
    for (const entry of played.groups) {
      if (entry.status === 'CONSOLATION') {
        expect(entry.name).toBeNull();
      }
    }
  });

  /*
   * The `Siegerehrung` is the main tournament's 1/2/3 and nobody else's
   * (issue #91's second decision, §10). The side event ends where its bracket
   * ends, and its winner is read off *its* tree in the `Trostrunde` panel —
   * never off the podium.
   *
   * Checked at every field size, because the way this would break is a small
   * one: a side event whose tree happened to be the only tree drawn.
   */
  it.each([2, 3, 5, 9, 16])(
    'keeps the side event out of the Siegerehrung payload at a field of %i',
    (size) => {
      const played = playSideEvent(sideEventOf(size, Math.max(13, size * 2 + 1)));

      // The podium is read off the main field's tree, which the side event
      // never touches — it has one of its own.
      const podium = finalStandings(played, 'MAIN');
      expect(podium).toBeNull();
      expect(trackState(played, 'MAIN').bracket).toBeNull();

      // And its own winner is on its own tree, decided and named.
      const side = finalStandings(played, 'CONSOLATION');
      expect(side?.first).toBe(played.consolation?.winnerId);

      // What the beamer is handed keeps the two apart in the same way: the
      // `Siegerehrung` reads `bracket`, and the side event's tree is not it.
      const snapshot = toTournamentSnapshot(played);
      expect(snapshot.bracket).toBeNull();
      expect(snapshot.consolationBracket).not.toBeNull();
    },
  );

  /*
   * The same claim once the main field really does have a podium: the two trees
   * exist side by side, and nobody from the side event stands on the main one.
   */
  it('names nobody from the Trostrunde on a decided podium', () => {
    /*
     * Sixteen groups, so the loser pool is the side event's field untouched:
     * `sideEventOf` promotes nobody, and the main field's eight winners are
     * already a power of two. Both tournaments therefore run their own pipeline
     * from an honestly played qualifying round rather than from a fixture that
     * moved somebody by hand.
     */
    const played = playSideEvent(sideEventOf(8, 16));
    const finished = playMainField(played);

    const podium = finalStandings(finished, 'MAIN');
    expect(podium?.first).not.toBeNull();

    const inSideEvent = new Set(
      finished.groups.filter((entry) => entry.status === 'CONSOLATION').map((entry) => entry.id),
    );
    expect(inSideEvent.size).toBeGreaterThan(0);
    for (const place of [podium?.first, podium?.second, podium?.third]) {
      expect(place === null || place === undefined || !inSideEvent.has(place)).toBe(true);
    }
    // Including the one who actually won it.
    expect(inSideEvent.has(finished.consolation!.winnerId!)).toBe(true);
  });

  it('numbers its rounds per track, not across the file', () => {
    let next = drawSide(sideEventOf(9, 19));
    expect(currentRound(next, 'CONSOLATION')?.index).toBe(1);

    next = advancePhase(playOut(next, 'CONSOLATION'), 'CONSOLATION');
    next = advancePhase(
      // The lottery tops five up to eight, so an elimination round follows.
      useRepechageFallback(next, 'BYES', 'CONSOLATION'),
      'CONSOLATION',
    );

    // The main qualifying round is `rounds[0]`, so a count over the file would
    // not say 1 for the side event's first.
    expect(roundsOfTrack(next, 'CONSOLATION')[0]?.index).toBe(1);
  });

  it('refuses to draw once it is decided', () => {
    const played = playSideEvent(sideEventOf(2));

    expect(played.consolation?.state).toBe('FINISHED');
    expect(drawSide(played)).toBe(played);
  });

  it('does not call the field a winner before a round has been played', () => {
    const started = sideEventOf(5);

    // `startConsolation` moved the field across; nothing has been drawn.
    expect(settleConsolation(started)).toBe(started);
    expect(started.consolation?.winnerId).toBeNull();
  });

  it('never puts a Trostrunde winner back into the main field', () => {
    const started = sideEventOf(5);
    const mainField = ids(activeGroups(started));

    const played = playSideEvent(started);

    // The whole of "self-contained": the winner is still in `CONSOLATION`, and
    // the main field has exactly the groups it had before the side event began.
    expect(played.groups.find((entry) => entry.id === played.consolation?.winnerId)?.status).toBe(
      'CONSOLATION',
    );
    expect(ids(activeGroups(played))).toEqual(mainField);
  });

  /*
   * "No nesting." The side event's own losers get no side event of their own —
   * one level is where the structure stops recursing (§10), which is why
   * declining *its* lottery really does mean going home.
   */
  it('never starts a second side event out of its own losers', () => {
    const played = playSideEvent(sideEventOf(5));

    expect(consolationField(played).every((entry) => entry.status === 'ELIMINATED')).toBe(true);
    expect(isConsolationOffered(played)).toBe(false);
    expect(consolationBlockers(played)).toContain('ALREADY_ANSWERED');
  });

  /*
   * "Both tracks' draws come from the same seeded RNG stream." One cursor for
   * the whole evening is what keeps it reproducible from one seed, and a side
   * event that drew from a stream of its own would be a second thing to record.
   */
  it('draws both tracks out of the one seeded stream', () => {
    const started = sideEventOf(5);
    const played = playSideEvent(started);

    expect(played.rngCursor).toBeGreaterThan(started.rngCursor);
    // Replaying from the same seed and cursor reproduces it exactly.
    expect(playSideEvent(started)).toEqual(played);
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
    // Since issue #91 the side event's rounds carry the kind their own phase
    // gives them — what says which tournament they belong to is the track.
    expect(currentRound(live, 'CONSOLATION')?.kind).toBe('QUALIFYING');
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
