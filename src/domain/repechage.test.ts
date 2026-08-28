import { describe, expect, it } from 'vitest';

import { closeRound, drawRound, roundOutcome, setWinner } from '@/domain/draw';
import { addGroups } from '@/domain/groups';
import type { GroupId } from '@/domain/ids';
import {
  acceptCandidate,
  canStartRepechage,
  declineCandidate,
  drawCandidate,
  isRepechageComplete,
  isRepechageNeeded,
  repechageBlockers,
  repechageDisplayOrder,
  repechagePot,
  repechageState,
  startRepechage,
  useRepechageFallback,
  type RepechageState,
} from '@/domain/repechage';
import { createRng } from '@/domain/rng';
import { nextPowerOfTwo } from '@/domain/round';
import { SCHEMA_VERSION, tournamentFileSchema } from '@/domain/schema';
import { activeGroups, currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import { tournamentSchema, type Round, type Tournament } from '@/domain/types';

/**
 * The repechage engine (issue #20, docs/TOURNAMENT-RULES.md §4).
 *
 * The rule with the most ways to strand a host, so the cases here are the ones
 * that would strand one: a field that must skip the phase entirely, a run of
 * declines, a pot that empties with places still open, and a target that has to
 * come out a power of two however the evening went.
 *
 * Tournaments are built by playing them — `drawRound`, `setWinner`,
 * `closeRound` — rather than by writing a `Round` literal. The whole phase is
 * arithmetic over what the qualifying round produced, so a fixture that hand-set
 * its winners would be testing the fixture (`drawn`, below).
 */

/**
 * A tournament whose qualifying round has been drawn, decided and closed.
 *
 * `a` wins every match, which is as arbitrary as any other rule and makes the
 * losers exactly the `b` side. Byes decide themselves at draw time.
 */
function qualified(groups: number, tables = 2): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => `Round ${index}` });
  let decided = drawn;
  for (const match of openRound(drawn).matches) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

/** The same tournament with the pot already shuffled and the phase entered. */
function inRepechage(groups: number, tables = 2): Tournament {
  return startRepechage(qualified(groups, tables));
}

function openRound(document: Tournament): Round {
  const round = currentRound(document) ?? document.rounds[0];
  if (round === undefined) {
    throw new Error('nothing was drawn');
  }
  return round;
}

function state(document: Tournament): RepechageState {
  const current = repechageState(document);
  if (current === null) {
    throw new Error('no repechage is running');
  }
  return current;
}

/**
 * The draw order, read where it actually lives (issue #97).
 *
 * `tournament.repechage.pool` is the shuffle, and since #97 it is the only
 * place the draw order exists: everything `repechageState` and `repechagePot`
 * hand out is in display order, precisely so that nothing rendered can carry
 * it. A test that wants to know who comes next therefore has to ask the file,
 * exactly as `drawCandidate` does.
 */
function drawOrder(document: Tournament): readonly GroupId[] {
  const pool = document.repechage?.pool;
  if (pool === undefined) {
    throw new Error('no repechage is running');
  }
  return pool;
}

/** The group the next `drawCandidate` will take — the front of the shuffle. */
function nextUp(document: Tournament): GroupId {
  const first = drawOrder(document)[0];
  if (first === undefined) {
    throw new Error('the pot is empty');
  }
  return first;
}

/** The number the room reads off a group's card. */
function numberOf(document: Tournament, groupId: GroupId): number {
  const found = document.groups.find((entry) => entry.id === groupId);
  if (found === undefined) {
    throw new Error('no such group');
  }
  return found.number;
}

function numbersOf(document: Tournament, groupIds: readonly GroupId[]): readonly number[] {
  return groupIds.map((groupId) => numberOf(document, groupId));
}

/** Draws a candidate and answers it, which is the host's one-two in §4. */
function answer(document: Tournament, accepted: boolean): Tournament {
  const drawn = drawCandidate(document);
  return accepted ? acceptCandidate(drawn) : declineCandidate(drawn);
}

describe('isRepechageNeeded', () => {
  /*
   * docs/TOURNAMENT-RULES.md §9 case 2. Sixteen groups play eight matches and
   * produce eight winners, which is already the field the bracket wants — the
   * phase must not happen at all, not even as an empty scene for a second.
   */
  it('is false when the qualifying round already produced a power of two', () => {
    expect(isRepechageNeeded(qualified(16))).toBe(false);
  });

  it('is true for a field that has to be topped up', () => {
    // Thirteen groups: six pairs plus a bye, so |W| = 7 and the target is 8.
    expect(isRepechageNeeded(qualified(13))).toBe(true);
  });

  it('is false before there is a qualifying round to read', () => {
    expect(isRepechageNeeded(tournament({ phase: 'QUALIFYING' }))).toBe(false);
  });
});

describe('startRepechage', () => {
  /*
   * The first test the issue names. Thirteen groups draw six pairs and one
   * `Freilos`, so seven groups go through, the bracket needs eight, and exactly
   * one loser has to come back.
   */
  it('reads target and need off a 13-group qualifying round', () => {
    const started = inRepechage(13);
    const current = state(started);

    expect(openRound(qualified(13)).matches).toHaveLength(7);
    expect(current.through).toHaveLength(7);
    expect(current.target).toBe(8);
    expect(current.need).toBe(1);
  });

  it('puts every loser in the pot and nobody else', () => {
    const closed = qualified(13);
    const { losers } = roundOutcome(openRound(closed));

    // Six losers: the seventh group had a bye and beat nobody.
    expect([...state(startRepechage(closed)).remaining].sort()).toEqual([...losers].sort());
  });

  it('moves the phase in the same object as the pot', () => {
    const started = inRepechage(13);

    expect(started.phase).toBe('REPECHAGE');
    expect(started.repechage).not.toBeNull();
  });

  /*
   * docs/OPEN-QUESTIONS.md #23: the shuffle consumed values, and a start that
   * recorded the pot but left the cursor behind would hand the identical order
   * to the next thing that draws.
   */
  it('writes the RNG cursor on past the shuffle it ran', () => {
    const closed = qualified(13);

    expect(startRepechage(closed).rngCursor).toBeGreaterThan(closed.rngCursor);
  });

  it('draws the pot from the tournament stream, so the order is reproducible', () => {
    const closed = qualified(13);
    const expected = createRng(closed.rngSeed, closed.rngCursor).shuffle(
      roundOutcome(openRound(closed)).losers,
    );

    expect(drawOrder(startRepechage(closed))).toEqual(expected);
  });

  it('leaves everyone in the pot eliminated — being drawn is a chance, not a reprieve', () => {
    const started = inRepechage(13);

    expect(activeGroups(started)).toHaveLength(7);
  });

  it('is refused, and changes nothing, when the field is already a power of two', () => {
    const closed = qualified(16);

    expect(repechageBlockers(closed)).toContain('NOT_NEEDED');
    expect(canStartRepechage(closed)).toBe(false);
    expect(startRepechage(closed)).toBe(closed);
  });

  it('is refused while the qualifying round is still open', () => {
    const drawn = drawRound(
      tournament({
        phase: 'QUALIFYING',
        groups: Array.from({ length: 13 }, (_unused, index) => group(index + 1)),
        nextGroupNumber: 14,
        tables: [table(1), table(2)],
        nextTableNumber: 3,
      }),
      { at: FIXED_NOW, label: (index) => `Round ${index}` },
    );

    expect(repechageBlockers(drawn)).toContain('QUALIFYING_NOT_CLOSED');
    expect(startRepechage(drawn)).toBe(drawn);
  });

  it('is refused a second time, so a stale click cannot re-shuffle the pot', () => {
    const started = inRepechage(13);

    expect(repechageBlockers(started)).toEqual(
      expect.arrayContaining(['NOT_AFTER_QUALIFYING', 'ALREADY_STARTED']),
    );
    expect(startRepechage(started)).toBe(started);
  });

  it('lists every reason at once rather than the first one it finds', () => {
    // No round at all, and the phase has not started: a host reading a panel of
    // checks needs the same panel every time.
    expect(repechageBlockers(tournament())).toEqual([
      'NOT_AFTER_QUALIFYING',
      'QUALIFYING_NOT_CLOSED',
    ]);
  });
});

describe('drawCandidate', () => {
  it('takes the front of the pot and leaves it waiting for an answer', () => {
    const started = inRepechage(13);
    const first = nextUp(started);

    const drawn = drawCandidate(started);

    expect(state(drawn).pending).toBe(first);
    expect(drawOrder(drawn)).toEqual(drawOrder(started).slice(1));
    expect(drawn.repechage?.draws).toEqual([{ groupId: first, accepted: null }]);
  });

  /* Issue #21: "the host can never accidentally draw two candidates at once" —
   * true in the engine, not only in a disabled button. */
  it('refuses a second draw while one is unanswered', () => {
    const drawn = drawCandidate(inRepechage(13));

    expect(drawCandidate(drawn)).toBe(drawn);
  });

  it('refuses once the field is full, so no place is offered twice', () => {
    const full = answer(inRepechage(13), true);

    expect(state(full).need).toBe(0);
    expect(drawCandidate(full)).toBe(full);
  });

  it('does nothing at all when there is no repechage', () => {
    const closed = qualified(16);

    expect(drawCandidate(closed)).toBe(closed);
  });
});

describe('acceptCandidate and declineCandidate', () => {
  it('puts an accepted candidate back into the tournament', () => {
    const started = inRepechage(13);
    const candidate = nextUp(started);

    const accepted = acceptCandidate(drawCandidate(started));

    expect(state(accepted).through).toContain(candidate);
    expect(activeGroups(accepted).map((entry) => entry.id)).toContain(candidate);
    expect(accepted.repechage?.draws).toEqual([{ groupId: candidate, accepted: true }]);
  });

  it('leaves a declined candidate out, and out of the pot', () => {
    const started = inRepechage(13);
    const candidate = nextUp(started);

    const declined = declineCandidate(drawCandidate(started));
    const current = state(declined);

    expect(current.through).not.toContain(candidate);
    expect(current.remaining).not.toContain(candidate);
    expect(current.declined).toEqual([candidate]);
    expect(activeGroups(declined).map((entry) => entry.id)).not.toContain(candidate);
  });

  it('counts a place off `need` only when the candidate accepted', () => {
    const started = inRepechage(10);

    expect(state(answer(started, false)).need).toBe(state(started).need);
    expect(state(answer(started, true)).need).toBe(state(started).need - 1);
  });

  it('refuses an answer when nothing has been drawn', () => {
    const started = inRepechage(13);

    expect(acceptCandidate(started)).toBe(started);
    expect(declineCandidate(started)).toBe(started);
  });

  it('refuses a second answer, so a double click cannot decide the next candidate', () => {
    const answered = acceptCandidate(drawCandidate(inRepechage(13)));

    expect(acceptCandidate(answered)).toBe(answered);
    expect(declineCandidate(answered)).toBe(answered);
  });
});

describe('the draw loop', () => {
  /*
   * The sequence issue #20 names, with the numbers §4 actually produces:
   * |W| = 5 gives a target of 8 and a need of 3, so one acceptance does not
   * reach it. See docs/OPEN-QUESTIONS.md #55 — the test after this one carries
   * the intent on a field where a single acceptance does finish the job.
   */
  it('survives three declines: 5 winners, 5 losers, the fourth candidate accepts', () => {
    let document = inRepechage(10);
    expect(state(document).target).toBe(8);
    expect(state(document).need).toBe(3);
    expect(state(document).remaining).toHaveLength(5);

    for (let index = 0; index < 3; index += 1) {
      document = answer(document, false);
    }
    document = answer(document, true);

    const current = state(document);
    expect(current.through).toHaveLength(6);
    expect(current.declined).toHaveLength(3);
    expect(current.need).toBe(2);
    // One candidate is still standing in the pot, so this is not the fallback.
    expect(current.remaining).toHaveLength(1);
    expect(current.fallbackNeeded).toBe(false);
  });

  it('reaches the target when the fourth candidate accepts the one open place', () => {
    let document = inRepechage(13);
    for (let index = 0; index < 3; index += 1) {
      document = answer(document, false);
    }
    document = answer(document, true);

    expect(state(document).need).toBe(0);
    expect(isRepechageComplete(document)).toBe(true);
  });

  it('leaves the phase incomplete while a candidate is still unanswered', () => {
    const drawn = drawCandidate(inRepechage(13));

    expect(isRepechageComplete(drawn)).toBe(false);
  });

  /*
   * The termination claim in the acceptance criteria, checked as a claim and
   * not by hoping: the pot only ever shrinks, so a loop that keeps drawing
   * stops of its own accord. The bound is generous and the assertion is that it
   * was never needed.
   */
  it('always terminates, whatever the host answers', () => {
    let document = inRepechage(21);
    let steps = 0;

    while (!isRepechageComplete(document) && !state(document).fallbackNeeded) {
      document = answer(document, steps % 3 === 0);
      steps += 1;
      expect(steps).toBeLessThan(100);
    }

    expect(state(document).remaining.length === 0 || isRepechageComplete(document)).toBe(true);
  });
});

describe('the §4 fallback', () => {
  /** Every candidate is drawn and declines, which empties the pot. */
  function allDeclined(groups: number): Tournament {
    let document = inRepechage(groups);
    while (state(document).remaining.length > 0 && state(document).need > 0) {
      document = answer(document, false);
    }
    return document;
  }

  it('is triggered when every loser declines, with no infinite loop', () => {
    const exhausted = allDeclined(10);
    const current = state(exhausted);

    expect(current.remaining).toHaveLength(0);
    expect(current.need).toBe(3);
    expect(current.fallbackNeeded).toBe(true);
    expect(current.declined).toHaveLength(5);
    // Nothing left to draw: the loop cannot spin, it has to be answered.
    expect(drawCandidate(exhausted)).toBe(exhausted);
  });

  /*
   * `need > pool size` reaches the same dialog by the other route: places are
   * still open and there are not enough candidates left to fill them, whatever
   * they answer.
   */
  it('is triggered when the pot is smaller than the places still open', () => {
    let document = inRepechage(10);
    // Three declines leave two candidates for three open places.
    for (let index = 0; index < 3; index += 1) {
      document = answer(document, false);
    }
    expect(state(document).need).toBeGreaterThan(state(document).remaining.length);

    document = answer(document, true);
    document = answer(document, true);

    const current = state(document);
    expect(current.remaining).toHaveLength(0);
    expect(current.need).toBe(1);
    expect(current.fallbackNeeded).toBe(true);
  });

  it('is not offered while a candidate is still standing in the pot', () => {
    const started = inRepechage(10);

    expect(state(started).fallbackNeeded).toBe(false);
    expect(useRepechageFallback(started, 'BYES')).toBe(started);
    expect(useRepechageFallback(started, 'REOPEN_DECLINED')).toBe(started);
  });

  it('fills the open places with Freilose and finishes the phase', () => {
    const withByes = useRepechageFallback(allDeclined(10), 'BYES');
    const current = state(withByes);

    expect(current.fallbackUsed).toBe('BYES');
    expect(current.byes).toBe(3);
    expect(current.size).toBe(8);
    expect(current.need).toBe(0);
    expect(isRepechageComplete(withByes)).toBe(true);
    // Nobody was let back in: the places are owed to the next draw, not to a
    // group (docs/OPEN-QUESTIONS.md #56).
    expect(current.through).toHaveLength(5);
    expect(activeGroups(withByes)).toHaveLength(5);
  });

  it('readmits the declined groups and carries the draw loop on', () => {
    const exhausted = allDeclined(10);

    const reopened = useRepechageFallback(exhausted, 'REOPEN_DECLINED');
    const current = state(reopened);

    expect(current.fallbackUsed).toBe('REOPEN_DECLINED');
    expect([...current.remaining].sort()).toEqual([...state(exhausted).declined].sort());
    expect(current.fallbackNeeded).toBe(false);
    expect(current.need).toBe(3);
    expect(current.byes).toBe(0);
  });

  it('shuffles the readmitted groups rather than handing them back in order', () => {
    const exhausted = allDeclined(10);
    const expected = createRng(exhausted.rngSeed, exhausted.rngCursor).shuffle(
      state(exhausted).declined,
    );

    const reopened = useRepechageFallback(exhausted, 'REOPEN_DECLINED');

    expect(reopened.repechage?.pool).toEqual(expected);
    expect(reopened.rngCursor).toBeGreaterThan(exhausted.rngCursor);
  });

  it('does not readmit a group that has since come back through the pot', () => {
    let document = inRepechage(10);
    // Everyone declines, everyone is readmitted, and then one accepts.
    while (state(document).remaining.length > 0) {
      document = answer(document, false);
    }
    document = useRepechageFallback(document, 'REOPEN_DECLINED');
    const returning = nextUp(document);
    document = answer(document, true);

    expect(state(document).through).toContain(returning);
    expect(state(document).declined).not.toContain(returning);
  });

  it('refuses to reopen when nobody has declined', () => {
    // Every candidate accepted, so the pot emptied with nothing to put back.
    // Reachable only by hand — the engine stops drawing once `need` is zero —
    // which is exactly why the guard is here rather than in a button.
    const started = inRepechage(13);
    const stranded: Tournament = {
      ...started,
      repechage: { target: 8, pool: [], draws: [], fallbackUsed: null },
    };

    expect(state(stranded).fallbackNeeded).toBe(true);
    expect(state(stranded).declined).toEqual([]);
    expect(useRepechageFallback(stranded, 'REOPEN_DECLINED')).toBe(stranded);
    // And the host is never stuck: the other answer still finishes the phase.
    expect(isRepechageComplete(useRepechageFallback(stranded, 'BYES'))).toBe(true);
  });

  /*
   * A file repaired in Notepad, which docs/FILE-FORMAT.md §Encoding invites: a
   * repechage whose qualifying round is gone. It reads as a field of nobody
   * rather than throwing, because a panel that throws during a live event is
   * worse than one showing a number the host can see is wrong.
   */
  it('reads a repechage whose qualifying round is missing without throwing', () => {
    const orphaned: Tournament = { ...inRepechage(13), rounds: [] };
    const current = state(orphaned);

    expect(current.through).toEqual([]);
    expect(current.need).toBe(current.target);
    expect(isRepechageComplete(orphaned)).toBe(false);
  });

  it('can be reopened more than once, and Freilose stay available every time', () => {
    let document = allDeclined(10);
    document = useRepechageFallback(document, 'REOPEN_DECLINED');
    while (state(document).remaining.length > 0) {
      document = answer(document, false);
    }

    expect(state(document).fallbackNeeded).toBe(true);
    expect(state(document).declined).toHaveLength(5);
    expect(isRepechageComplete(useRepechageFallback(document, 'BYES'))).toBe(true);
  });
});

describe('the §4 invariant', () => {
  /*
   * "Impossible to leave the phase with a non-power-of-two field." Stated over
   * `|W| + Freilose`, because fallback 1 fills the last places with byes rather
   * than with groups (docs/TOURNAMENT-RULES.md §4, docs/OPEN-QUESTIONS.md #56).
   *
   * Every field size a real evening can reach, played out three ways: everyone
   * accepts, everyone declines, and alternating. The point is that the answer
   * is a power of two in all of them, not that it is any particular number.
   *
   * Only group counts that actually reach the phase: `ceil(g / 2)` has to be
   * something other than a power of two, or there is no repechage to end and
   * the case belongs to the skip test below. `state` throws rather than passing
   * vacuously if one ever slips into the list.
   */
  const FIELDS = [5, 6, 9, 10, 11, 13, 17, 21, 33, 40, 61];

  it.each(FIELDS)('ends %i groups on a power of two whatever the host answers', (groups) => {
    for (const answers of ['all-accept', 'all-decline', 'alternating'] as const) {
      let document = inRepechage(groups);
      let index = 0;

      while (!isRepechageComplete(document)) {
        if (state(document).fallbackNeeded) {
          document = useRepechageFallback(document, 'BYES');
          continue;
        }
        const accepted = answers === 'all-accept' || (answers === 'alternating' && index % 2 === 0);
        document = answer(document, accepted);
        index += 1;
      }

      const current = state(document);
      expect(current.size).toBe(current.target);
      expect(nextPowerOfTwo(current.size)).toBe(current.size);
    }
  });

  it('never lets the field overshoot the target', () => {
    let document = inRepechage(10);
    while (!isRepechageComplete(document) && !state(document).fallbackNeeded) {
      document = answer(document, true);
      expect(state(document).size).toBeLessThanOrEqual(state(document).target);
    }

    expect(state(document).size).toBe(8);
  });

  /*
   * The skip, end to end: a field that is already a power of two never gets a
   * `repechage` at all, so nothing downstream can render an empty pot
   * (docs/TOURNAMENT-RULES.md §9 case 2).
   */
  it('never creates a repechage for a field that does not need one', () => {
    for (const groups of [4, 8, 16, 32]) {
      const closed = qualified(groups);
      expect(startRepechage(closed).repechage).toBeNull();
      expect(repechageState(closed)).toBeNull();
      expect(isRepechageComplete(closed)).toBe(false);
    }
  });
});

describe('a repechage that has to survive the file', () => {
  /*
   * CLAUDE.md §7: "works with a tournament file loaded mid-tournament". The pot
   * is the field schema v4 exists for — the order was produced at an RNG cursor
   * the file has moved past, so a phase that lost it on save could only shuffle
   * again and offer the room a different candidate than the pot it was shown.
   */
  it('comes back off disk with the pot in the same order', () => {
    const mid = declineCandidate(drawCandidate(inRepechage(21)));

    const reopened = tournamentSchema.parse(JSON.parse(JSON.stringify(mid)));

    expect(reopened).toEqual(mid);
    expect(repechageState(reopened)).toEqual(repechageState(mid));
    expect(state(reopened).remaining).toEqual(state(mid).remaining);
  });

  it('carries the pot through the whole file wrapper as well', () => {
    const mid = drawCandidate(inRepechage(13));
    const file = {
      schemaVersion: SCHEMA_VERSION,
      app: { name: 'WattMatt', version: '0.1.0' },
      ...mid,
    };

    const parsed = tournamentFileSchema.parse(JSON.parse(JSON.stringify(file)));

    expect(parsed.repechage?.pool).toEqual(mid.repechage?.pool);
    expect(parsed.repechage?.draws).toEqual(mid.repechage?.draws);
  });

  it('carries on from where the host left off', () => {
    const mid = drawCandidate(inRepechage(13));
    const reopened = tournamentSchema.parse(JSON.parse(JSON.stringify(mid)));

    const answered = acceptCandidate(reopened);

    expect(state(answered).through).toEqual(state(acceptCandidate(mid)).through);
    expect(isRepechageComplete(answered)).toBe(true);
  });

  /*
   * A participant who turned up late is added mid-tournament and is `ACTIVE`
   * without ever having played (docs/TOURNAMENT-RULES.md §2). The target
   * arithmetic must not fold them in, or it would be about a different field
   * than the one the qualifying round produced.
   */
  it('counts the qualifying winners, not everyone who happens to be active', () => {
    const started = inRepechage(13);

    const withLatecomer = addGroups(started, 1);

    expect(activeGroups(withLatecomer)).toHaveLength(8);
    expect(state(withLatecomer).through).toHaveLength(7);
    expect(state(withLatecomer).need).toBe(1);
  });
});

/**
 * The pot as the projector draws it (issue #21).
 *
 * The scene's promise is that everybody who lost is on the wall from the first
 * frame and that nobody ever leaves it, so what is checked here is exactly
 * that: one entry per loser, always, in an order that does not move under the
 * audience's eyes.
 */
describe('repechagePot', () => {
  /** Draws and declines everybody, which is what empties the pot. */
  function declineEveryone(document: Tournament): Tournament {
    let current = document;
    while (state(current).remaining.length > 0 && state(current).need > 0) {
      current = answer(current, false);
    }
    return current;
  }

  it('is empty when there is no repechage', () => {
    expect(repechagePot(qualified(8))).toEqual([]);
  });

  it('starts as every loser, all of them still in the pot', () => {
    const started = inRepechage(13);
    const losers = roundOutcome(openRound(started)).losers;

    const pot = repechagePot(started);

    // A set: the order is display order, and the tests below are the ones that
    // pin it. What matters here is that nobody is missing and nobody is extra.
    expect(new Set(pot.map((entry) => entry.groupId))).toEqual(new Set(losers));
    expect(pot).toHaveLength(losers.length);
    expect(pot.every((entry) => entry.status === 'POOL')).toBe(true);
  });

  /*
   * Issue #97, and the whole of it. This used to assert the opposite — that the
   * pot came back in the pool's order — and that assertion was the bug: the
   * shuffle ran correctly and was then thrown away, because the thing it
   * randomised became the thing on screen. A grid in draw order is a grid whose
   * next name anyone watching can call.
   */
  it('is in display order, ascending by number, and never the pool’s', () => {
    const started = inRepechage(13);

    const shown = repechagePot(started).map((entry) => entry.groupId);
    const numbers = numbersOf(started, shown);

    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    // And it really is a different order from the one the draw will use —
    // otherwise this test would pass on a pool that happened to be sorted.
    expect(shown).not.toEqual(drawOrder(started));
  });

  it('is exactly the losers of the qualifying round, sorted by number', () => {
    const started = inRepechage(13);
    const losers = roundOutcome(openRound(started)).losers;

    expect(repechageDisplayOrder(started)).toEqual(
      [...losers].sort((a, b) => numberOf(started, a) - numberOf(started, b)),
    );
  });

  /*
   * The crisp statement of the separation, and the one that catches any future
   * regression that recouples them: change the seed and the draw order changes
   * while the grid does not move at all.
   */
  it('renders identically under two seeds that draw in different orders', () => {
    // One played qualifying round, so both have the same losers, and the seed
    // is changed only for the shuffle that follows. Re-seeding the whole
    // tournament would deal different pairings and therefore compare two
    // different sets of losers, which would prove nothing about the ordering.
    const closed = qualified(13);
    const one = startRepechage({ ...closed, rngSeed: 'seed-one' });
    const other = startRepechage({ ...closed, rngSeed: 'seed-two' });

    expect(repechageDisplayOrder(one)).toEqual(repechageDisplayOrder(other));
    expect(drawOrder(one)).not.toEqual(drawOrder(other));
  });

  /*
   * The bug's observable symptom, stated as a distribution. Under the old
   * behaviour the first candidate was always at display index 0; now the light
   * has to be able to land anywhere, or the suspense is still theatre over a
   * sequential pick.
   */
  it('lands its first candidate all over the grid across a thousand seeds', () => {
    const counts = new Map<number, number>();

    const closed = qualified(13);

    for (let seed = 0; seed < 1000; seed += 1) {
      const started = startRepechage({ ...closed, rngSeed: `seed-${String(seed)}` });
      const shown = repechageDisplayOrder(started);
      const index = shown.indexOf(nextUp(started));
      counts.set(index, (counts.get(index) ?? 0) + 1);
    }

    // Six losers, so six positions, and every one of them has to be reachable.
    expect(counts.size).toBe(6);
    // Roughly uniform: no position takes more than twice its share, and in
    // particular position 0 is not where the candidate always is. A loose bound
    // on purpose — this is asserting "unrelated", not "perfectly flat".
    for (const hits of counts.values()) {
      expect(hits).toBeGreaterThan(1000 / 6 / 2);
      expect(hits).toBeLessThan((1000 / 6) * 2);
    }
  });

  /*
   * The layout must not reflow. Removing or reordering a card shifts every
   * position after it, which leaks structure and makes the screen jump — the
   * same argument the pre-computed layout of issue #76 makes.
   */
  it('does not move any other card when a candidate is drawn', () => {
    let document = inRepechage(13);
    const before = repechageDisplayOrder(document);

    for (let step = 0; step < 3; step += 1) {
      document = answer(document, step === 0);
      expect(repechageDisplayOrder(document)).toEqual(before);
    }
  });

  it('marks the drawn candidate without taking them off the wall', () => {
    const drawn = drawCandidate(inRepechage(13));
    const candidate = state(drawn).pending;

    const pot = repechagePot(drawn);

    expect(pot).toHaveLength(repechagePot(inRepechage(13)).length);
    expect(pot.find((entry) => entry.groupId === candidate)?.status).toBe('DRAWN');
  });

  it('keeps an accepted candidate in the pot, marked as through', () => {
    const accepted = answer(inRepechage(13), true);
    const through = state(accepted).through.at(-1);

    expect(repechagePot(accepted).find((entry) => entry.groupId === through)?.status).toBe(
      'ACCEPTED',
    );
  });

  it('keeps a declined candidate in the pot, marked as out', () => {
    const declined = answer(inRepechage(13), false);
    const out = state(declined).declined[0];

    expect(repechagePot(declined).find((entry) => entry.groupId === out)?.status).toBe('DECLINED');
  });

  /*
   * A card must not jump sideways when the next candidate comes out. Since
   * issue #97 that falls out of the ordering rather than being arranged: a
   * card's place is its number, so being drawn cannot change it.
   */
  it('never moves a card once it has been drawn', () => {
    let document = inRepechage(13);
    const first = repechagePot(document).map((entry) => entry.groupId);

    document = answer(document, false);
    document = drawCandidate(document);

    expect(repechagePot(document).map((entry) => entry.groupId)).toEqual(first);
  });

  /*
   * `REOPEN_DECLINED` puts declined groups back into the pot, so one group can
   * hold a `false` draw record *and* stand in the pool. Two cards for one
   * person would be a person the room cannot follow.
   */
  it('shows a readmitted group once, and as back in the pot', () => {
    let document = declineEveryone(inRepechage(13));
    document = useRepechageFallback(document, 'REOPEN_DECLINED');

    const pot = repechagePot(document);
    const ids = pot.map((entry) => entry.groupId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(pot.filter((entry) => entry.status === 'POOL')).toHaveLength(
      state(document).remaining.length,
    );
    expect(pot.some((entry) => entry.status === 'DECLINED')).toBe(false);
  });
});

/**
 * `state.last` — the beat the beamer animates (docs/MOTION.md §4.3).
 *
 * One fact, "which card, and what happened to it", because a scene that
 * reconstructed it from `pending`, `through` and `declined` would have to guess
 * which of the three moved most recently.
 */
describe('the last draw', () => {
  it('is null until the first candidate is drawn', () => {
    expect(state(inRepechage(13)).last).toBeNull();
  });

  it('is the pending candidate while nobody has answered', () => {
    const drawn = drawCandidate(inRepechage(13));

    expect(state(drawn).last).toEqual({ groupId: state(drawn).pending, accepted: null });
  });

  it('carries the answer once it is given', () => {
    const accepted = answer(inRepechage(13), true);
    const declined = answer(inRepechage(13), false);

    expect(accepted.repechage?.draws.at(-1)?.accepted).toBe(true);
    expect(state(accepted).last?.accepted).toBe(true);
    expect(state(declined).last?.accepted).toBe(false);
  });

  it('moves on to the next candidate rather than remembering the last answer', () => {
    const first = answer(inRepechage(13), false);
    const second = drawCandidate(first);

    expect(state(second).last?.groupId).not.toBe(state(first).last?.groupId);
    expect(state(second).last?.accepted).toBeNull();
  });
});

describe('purity', () => {
  it('never mutates the tournament it is given', () => {
    const started = inRepechage(13);
    const before = JSON.stringify(started);

    drawCandidate(started);
    acceptCandidate(drawCandidate(started));
    declineCandidate(drawCandidate(started));
    useRepechageFallback(started, 'BYES');

    expect(JSON.stringify(started)).toBe(before);
  });

  it('hands the same object back when it is asked for something impossible', () => {
    const empty = tournament();

    expect(drawCandidate(empty)).toBe(empty);
    expect(acceptCandidate(empty)).toBe(empty);
    expect(declineCandidate(empty)).toBe(empty);
    expect(useRepechageFallback(empty, 'BYES')).toBe(empty);
    expect(startRepechage(empty)).toBe(empty);
  });

  it('leaves the group list untouched when a decline changes nothing about it', () => {
    const drawn = drawCandidate(inRepechage(13));

    // The candidate was already ELIMINATED — it lost. A new `groups` array for
    // a no-op would re-render every chip on the host's screen.
    expect(declineCandidate(drawn).groups).toBe(drawn.groups);
  });
});
