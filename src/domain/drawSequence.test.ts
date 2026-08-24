import { describe, expect, it } from 'vitest';

import {
  beatDuration,
  DRAW_BEATS,
  drawPool,
  drawSchedule,
  drawStepCount,
  isDrawComplete,
  PAIRING_CEILING,
  PAIRING_DURATION,
  participantsOf,
  revealedMatches,
} from '@/domain/drawSequence';
import { group, groupId, match, round } from '@/domain/testFixtures';
import type { Group, Round } from '@/domain/types';

/**
 * The draw sequence as arithmetic (issue #18, docs/MOTION.md §4.1).
 *
 * Everything the acceptance criteria say about the *board* is asked here, with
 * no timer involved: what is revealed after n beats, what is left in the pool,
 * and whether skipping lands on the same picture as waiting.
 */

/** A round of `pairs` normal matches, optionally followed by a bye. */
function drawnRound({ pairs, bye = false }: { pairs: number; bye?: boolean }): {
  round: Round;
  groups: Group[];
} {
  const matches = Array.from({ length: pairs }, (_, index) =>
    match(index + 1, { a: groupId(index * 2 + 1), b: groupId(index * 2 + 2) }),
  );
  if (bye) {
    matches.push(match(pairs + 1, { a: groupId(pairs * 2 + 1), b: null }));
  }

  const groupCount = pairs * 2 + (bye ? 1 : 0);
  return {
    round: round(1, { matches }),
    groups: Array.from({ length: groupCount }, (_, index) => group(index + 1)),
  };
}

describe('the beat table', () => {
  it('matches docs/MOTION.md §4.1', () => {
    expect(DRAW_BEATS).toEqual({
      anticipation: 600,
      shuffle: 1200,
      reveal: 500,
      placement: 400,
    });
  });

  /*
   * The issue's own arithmetic: 32 pairings at 3 s is already 90 seconds in
   * front of an audience. A pairing that crept over the ceiling would not fail
   * anything visibly — it would just make every large draw slower than the
   * design was signed off at.
   */
  it('keeps a pairing inside the 3 s ceiling', () => {
    expect(PAIRING_DURATION).toBe(2100);
    expect(PAIRING_DURATION).toBeLessThanOrEqual(PAIRING_CEILING);
  });

  it('halves every beat in performance mode, as the CSS tokens do', () => {
    for (const beat of ['anticipation', 'shuffle', 'reveal', 'placement'] as const) {
      expect(beatDuration(beat, true), beat).toBe(DRAW_BEATS[beat] / 2);
      expect(beatDuration(beat, false), beat).toBe(DRAW_BEATS[beat]);
    }
  });
});

describe('drawStepCount', () => {
  it('is one step per match', () => {
    expect(drawStepCount(drawnRound({ pairs: 6 }).round)).toBe(6);
  });

  /* A Freilos is drawn like any other pairing (rules §9 case 1). */
  it('counts a bye as a step of its own', () => {
    expect(drawStepCount(drawnRound({ pairs: 6, bye: true }).round)).toBe(7);
  });

  it('is zero for a round with no matches', () => {
    expect(drawStepCount(round(1))).toBe(0);
  });
});

describe('revealedMatches', () => {
  it('reveals in draw order, one pairing per step', () => {
    const { round: drawn } = drawnRound({ pairs: 4 });

    expect(revealedMatches(drawn, 0)).toEqual([]);
    expect(revealedMatches(drawn, 1).map((entry) => entry.id)).toEqual([drawn.matches[0]?.id]);
    expect(revealedMatches(drawn, 3)).toHaveLength(3);
  });

  /*
   * The acceptance criterion "skipping mid-sequence leaves a correct, complete
   * board": the skip sets the step past the end, and that has to be the same
   * picture as the last beat completing on its own.
   */
  it('is the whole round once the sequence is past its end', () => {
    const { round: drawn } = drawnRound({ pairs: 5 });

    expect(revealedMatches(drawn, 5)).toEqual(drawn.matches);
    expect(revealedMatches(drawn, 99)).toEqual(revealedMatches(drawn, 5));
  });

  it('survives a step that is negative or not a number', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });

    expect(revealedMatches(drawn, -1)).toEqual([]);
    expect(revealedMatches(drawn, Number.NaN)).toEqual([]);
    expect(revealedMatches(drawn, 1.7)).toHaveLength(1);
  });
});

describe('drawPool', () => {
  it('starts with everyone who is being drawn', () => {
    const { round: drawn, groups } = drawnRound({ pairs: 4 });
    expect(drawPool(drawn, groups, 0)).toHaveLength(8);
  });

  it('removes both participants of each revealed pairing', () => {
    const { round: drawn, groups } = drawnRound({ pairs: 4 });

    expect(drawPool(drawn, groups, 1)).toHaveLength(6);
    expect(drawPool(drawn, groups, 4)).toEqual([]);
  });

  /* A bye takes one number out of the pool, not two. */
  it('removes only the one group of a bye', () => {
    const { round: drawn, groups } = drawnRound({ pairs: 2, bye: true });

    expect(drawPool(drawn, groups, 2)).toHaveLength(1);
    expect(drawPool(drawn, groups, 3)).toEqual([]);
  });

  /*
   * The pool is on the wall from the anticipation beat onward. If it were laid
   * out in match order, anyone watching could read the next pairing off the
   * grid before it was drawn — the sequence is the entertainment, and this is
   * what stops it spoiling itself.
   */
  it('is ordered by participant number, never by draw order', () => {
    const matches = [
      match(1, { a: groupId(6), b: groupId(2) }),
      match(2, { a: groupId(4), b: groupId(1) }),
      match(3, { a: groupId(5), b: groupId(3) }),
    ];
    const groups = Array.from({ length: 6 }, (_, index) => group(index + 1));

    expect(drawPool(round(1, { matches }), groups, 0).map((entry) => entry.number)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it('stays in number order as the field shrinks', () => {
    // Every group plays, as in a real qualifying round, so the shrinking is
    // the only thing changing the grid.
    const matches = [
      match(1, { a: groupId(6), b: groupId(2) }),
      match(2, { a: groupId(4), b: groupId(1) }),
      match(3, { a: groupId(5), b: groupId(3) }),
    ];
    const groups = Array.from({ length: 6 }, (_, index) => group(index + 1));
    const drawn = round(1, { matches });

    expect(drawPool(drawn, groups, 1).map((entry) => entry.number)).toEqual([1, 3, 4, 5]);
    expect(drawPool(drawn, groups, 2).map((entry) => entry.number)).toEqual([3, 5]);
  });

  /* The grid shows who is being drawn, not who exists — an eliminated group
   * from an earlier round must not sit in the pool of this one. */
  it('leaves out a group that is not in this round', () => {
    const matches = [match(1, { a: groupId(1), b: groupId(2) })];
    const groups = [group(1), group(2), group(3, { status: 'ELIMINATED' })];

    expect(drawPool(round(1, { matches }), groups, 0).map((entry) => entry.number)).toEqual([1, 2]);
  });

  it('does not mutate the array it is given', () => {
    const groups = [group(3), group(1), group(2)];
    const before = groups.map((entry) => entry.number);
    drawPool(round(1, { matches: [match(1, { a: groupId(3), b: groupId(1) })] }), groups, 0);
    expect(groups.map((entry) => entry.number)).toEqual(before);
  });
});

describe('participantsOf', () => {
  it('includes the lone group of a bye', () => {
    const { round: drawn } = drawnRound({ pairs: 1, bye: true });
    expect(participantsOf(drawn).size).toBe(3);
  });
});

describe('isDrawComplete', () => {
  it('is false until every pairing is out', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });
    expect(isDrawComplete(drawn, 2)).toBe(false);
    expect(isDrawComplete(drawn, 3)).toBe(true);
  });

  /* An empty round has nothing to wait for, so it is already settled — the
   * scene must not sit on an anticipation grid that never resolves. */
  it('is true immediately for a round with no matches', () => {
    expect(isDrawComplete(round(1), 0)).toBe(true);
  });
});

describe('drawSchedule', () => {
  it('lands the first pairing after the anticipation beat', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });
    expect(drawSchedule(drawStepCount(drawn), false)[0]).toBe(600 + 2100);
  });

  it('spaces the rest one pairing apart', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });
    expect(drawSchedule(drawStepCount(drawn), false)).toEqual([2700, 4800, 6900]);
  });

  it('halves the whole schedule in performance mode', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });
    expect(drawSchedule(drawStepCount(drawn), true)).toEqual([1350, 2400, 3450]);
  });

  it('is empty for a round with no matches', () => {
    expect(drawSchedule(drawStepCount(round(1)), false)).toEqual([]);
  });
});
