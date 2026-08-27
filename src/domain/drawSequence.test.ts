import { describe, expect, it } from 'vitest';

import {
  DRAW_BEATS,
  drawDuration,
  drawInterval,
  drawSchedule,
  drawStepCount,
  isDrawComplete,
  QUICK_INTERVAL,
  revealedMatches,
} from '@/domain/drawSequence';
import { group, groupId, match, round } from '@/domain/testFixtures';
import type { Group, Round } from '@/domain/types';

/**
 * The draw sequence as arithmetic (issue #18, redesigned by issue #76,
 * docs/MOTION.md §4.1).
 *
 * Everything the acceptance criteria say about the *board* is asked here, with
 * no timer involved: what is revealed after n beats, how long the whole thing
 * takes, and whether skipping lands on the same picture as waiting.
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
  it('is one interval and one reveal, as docs/MOTION.md §4.1 now says', () => {
    expect(DRAW_BEATS).toEqual({ interval: 500, reveal: 240 });
  });

  /*
   * The rule the whole redesign hangs on (issue #76). A reveal that overran its
   * gap would leave the previous card still growing when the next one lands,
   * and over 32 pairings that is a board in permanent motion rather than a
   * board being filled — which is exactly the failure the issue is fixing.
   */
  it('finishes a reveal well inside the gap before the next pairing', () => {
    expect(DRAW_BEATS.reveal).toBeLessThan(DRAW_BEATS.interval);
    // "Well inside", not merely inside: half the gap leaves the card visibly
    // at rest before the next one arrives.
    expect(DRAW_BEATS.reveal).toBeLessThanOrEqual(DRAW_BEATS.interval / 2);
  });

  /*
   * Performance mode and reduced motion both take the same shortcut. The reveal
   * shortens with them because it is a CSS token and the mode redefines the
   * tokens, so the rule above still holds at the quicker pace.
   */
  it('drops to the quick interval when less motion is asked for', () => {
    expect(drawInterval(false)).toBe(DRAW_BEATS.interval);
    expect(drawInterval(true)).toBe(QUICK_INTERVAL);
    expect(QUICK_INTERVAL).toBeLessThan(DRAW_BEATS.interval);
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
  it('starts the board empty and lands the first pairing one interval in', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });

    // A card that was already there when the scene appeared is a card the room
    // did not watch being drawn (issue #76).
    expect(drawSchedule(drawStepCount(drawn), false)[0]).toBe(DRAW_BEATS.interval);
  });

  it('lands one pairing every interval, with no drift', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });

    expect(drawSchedule(drawStepCount(drawn), false)).toEqual([500, 1000, 1500]);
  });

  it('uses the quick interval when less motion is asked for', () => {
    const { round: drawn } = drawnRound({ pairs: 3 });

    expect(drawSchedule(drawStepCount(drawn), true)).toEqual([200, 400, 600]);
  });

  it('schedules nothing for a round with no matches', () => {
    expect(drawSchedule(drawStepCount(round(1)), false)).toEqual([]);
  });

  /*
   * The issue's own arithmetic, and the number a host plans the evening around:
   * "32 pairings: total draw ≈ 16 s". The old choreography took 68 seconds for
   * the same board.
   */
  it('draws the worst-case field in about sixteen seconds', () => {
    expect(drawDuration(32, false)).toBe(16_000);
    expect(drawDuration(32, true)).toBe(6_400);
    expect(drawDuration(0, false)).toBe(0);
  });
});
