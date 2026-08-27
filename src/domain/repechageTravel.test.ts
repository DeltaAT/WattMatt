import { describe, expect, it } from 'vitest';

import {
  MINIMUM_TRAVEL_FIELD,
  TRAVEL_BEATS,
  travelDuration,
  travelPath,
  type TravelHop,
} from '@/domain/repechageTravel';
import { createRng } from '@/domain/rng';

/**
 * The travelling highlight of the `Hoffnungsrunde` draw (issue #89).
 *
 * The requirement is unusual for a test file: *nobody in the room may be able
 * to work out where the light will stop.* That is a statement about a
 * distribution, not about one run, so most of what is below draws two hundred
 * paths and asks whether any of them leaks the answer — a single path proves
 * nothing either way, and a single path is exactly what an eyeballed
 * implementation gets checked against.
 *
 * The three ways a travel gives its answer away, each of which has a test here:
 *
 *  - it visits the target early, so the room sees the light pause there;
 *  - it moves in index order, or to a neighbour, so the next position follows
 *    from the last one;
 *  - it *converges* — the positions crowd toward the target as the travel slows
 *    — which is the subtle one, and the one an implementation written to "look
 *    random" tends to have.
 */

/** A fresh presentation RNG. Never the tournament's — see the module. */
const rng = (seed: string) => createRng(`travel-${seed}`);

/** `n` paths over the same field, one per seed. */
function paths(count: number, target: number, n = 200): readonly (readonly TravelHop[])[] {
  return Array.from({ length: n }, (_unused, index) =>
    travelPath(count, target, rng(String(index))),
  );
}

/** Every hop but the landing. */
const travelling = (path: readonly TravelHop[]) => path.slice(0, -1);

describe('the repechage travel path', () => {
  it('lands on the candidate that was already drawn', () => {
    for (const path of paths(12, 5)) {
      expect(path.at(-1)?.index).toBe(5);
    }
  });

  /*
   * The mistake that would undo the whole issue in one frame. The light must
   * not touch the answer until it stops on it — a pass over the target, even a
   * fast one, is a tell the second time the room sees the scene.
   */
  it('never touches the target before it lands', () => {
    for (const path of paths(12, 5)) {
      expect(travelling(path).map((hop) => hop.index)).not.toContain(5);
    }
  });

  it('never stands still', () => {
    for (const path of paths(12, 5)) {
      for (const [index, hop] of path.entries()) {
        if (index > 0) {
          expect(hop.index).not.toBe(path[index - 1]?.index);
        }
      }
    }
  });

  /*
   * "Never in index order, never to an adjacent card." Both are the same rule
   * once stated as a distance, and it covers the landing too: the last jump is
   * a jump, not a slide onto the card next door.
   */
  it('never moves to a neighbouring card', () => {
    for (const count of [8, 12, 30]) {
      for (const path of paths(count, 3)) {
        for (const [index, hop] of path.entries()) {
          const previous = path[index - 1];
          if (previous !== undefined) {
            expect(
              Math.abs(hop.index - previous.index),
              `${String(count)} cards: ${String(previous.index)} → ${String(hop.index)}`,
            ).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  /*
   * The subtle one, and the criterion the issue bolds: "position stays random
   * right up to the final jump. Do not converge toward the target."
   *
   * Measured as the mean distance from the target at each hop. A path that
   * drifts inward has a falling curve; a path that is uniform has a flat one.
   * The comparison is between the first travelling hop and the last, because
   * the last is where a convergent implementation has already given the answer
   * away — and it is asserted as "no closer", which a genuinely uniform draw
   * satisfies with room to spare.
   */
  it('does not drift toward the target as it slows', () => {
    const count = 20;
    const target = 7;
    const all = paths(count, target, 400);

    const meanDistance = (hop: number) => {
      const distances = all
        .map((path) => path[hop])
        .filter((step): step is TravelHop => step !== undefined)
        .map((step) => Math.abs(step.index - target));
      return distances.reduce((sum, value) => sum + value, 0) / distances.length;
    };

    // Every path has at least `minHops` travelling positions, so both of these
    // are drawn from the full sample.
    const early = meanDistance(0);
    const late = meanDistance(TRAVEL_BEATS.minHops - 2);

    expect(late).toBeGreaterThanOrEqual(early * 0.9);
  });

  /*
   * The same requirement from the other side: no position is ruled out either.
   * A travel confined to one half of the pot is as readable as one that drifts,
   * and it is what a naive "pick far from the target" rule produces.
   */
  it('reaches every card in the pot across many draws', () => {
    const count = 20;
    const seen = new Set<number>();
    for (const path of paths(count, 7, 400)) {
      for (const hop of travelling(path)) {
        seen.add(hop.index);
      }
    }

    // Every index except the target, which is only ever the landing.
    expect(seen.size).toBe(count - 1);
    expect(seen.has(7)).toBe(false);
  });

  /*
   * An audience that has watched three draws has counted the hops. A fixed
   * count would let them call the winner one hop early however uniform the
   * positions were, so the length is drawn too.
   */
  it('does not run the same number of hops every time', () => {
    const lengths = new Set(paths(20, 7).map((path) => path.length));

    expect(lengths.size).toBeGreaterThan(1);
    for (const length of lengths) {
      // Travelling hops plus the landing.
      expect(length).toBeGreaterThanOrEqual(TRAVEL_BEATS.minHops + 1);
      expect(length).toBeLessThanOrEqual(TRAVEL_BEATS.maxHops + 1);
    }
  });

  describe('the pace', () => {
    it('starts at the first dwell and ends at the last', () => {
      const path = travelPath(20, 7, rng('pace'));
      const gaps = path.slice(1).map((hop, index) => hop.at - (path[index]?.at ?? 0));

      expect(gaps[0]).toBe(TRAVEL_BEATS.first);
      expect(gaps.at(-1)).toBe(TRAVEL_BEATS.last);
    });

    it('only ever slows down', () => {
      for (const path of paths(20, 7, 50)) {
        const gaps = path.slice(1).map((hop, index) => hop.at - (path[index]?.at ?? 0));

        for (const [index, gap] of gaps.entries()) {
          if (index > 0) {
            expect(gap).toBeGreaterThanOrEqual(gaps[index - 1] ?? 0);
          }
        }
      }
    });

    /* The issue's "roughly 1.5–2.5 s", at both ends of the hop range. */
    it('takes between 1.5 and 2.5 seconds', () => {
      for (const path of paths(20, 7)) {
        expect(travelDuration(path)).toBeGreaterThanOrEqual(1500);
        expect(travelDuration(path)).toBeLessThanOrEqual(2500);
      }
    });

    it('starts at zero, so the first card lights the moment the draw lands', () => {
      expect(travelPath(20, 7, rng('start'))[0]?.at).toBe(0);
    });
  });

  /*
   * "Works with a loser field of 2 as well as 30 — with 2 candidates the travel
   * is meaningless, so fall back to a short direct reveal." An empty path *is*
   * that fallback: the caller lands the candidate immediately.
   */
  describe('a field too small to travel across', () => {
    it.each([0, 1, 2])('gives %s candidates no travel at all', (count) => {
      expect(travelPath(count, 0, rng('small'))).toEqual([]);
    });

    it('travels across the smallest field that can carry it', () => {
      const path = travelPath(MINIMUM_TRAVEL_FIELD, 1, rng('three'));

      expect(path.length).toBeGreaterThan(1);
      expect(path.at(-1)?.index).toBe(1);
      expect(travelling(path).map((hop) => hop.index)).not.toContain(1);
    });

    /*
     * The spacing rule is a preference, and this is why. With three cards and
     * the target in the middle there is no position two cards away from
     * anywhere — so the rule that cannot be honoured is dropped rather than the
     * travel failing or looping forever.
     */
    it('drops the spacing rule rather than the travel when the pot is tiny', () => {
      const path = travelPath(3, 1, rng('tiny'));

      expect(path.at(-1)?.index).toBe(1);
      for (const hop of travelling(path)) {
        expect([0, 2]).toContain(hop.index);
      }
    });
  });

  describe('a target that names no card', () => {
    it.each([-1, 12, 1.5])('gives index %s no travel', (target) => {
      expect(travelPath(12, target, rng('bad'))).toEqual([]);
    });
  });

  /*
   * The first acceptance criterion, halved. The candidate is decided elsewhere,
   * from the tournament's own stream, so this cannot move it — what is asserted
   * here is the other half: a presentation RNG is still an RNG, and the same
   * seed reproduces the same path. `Math.random()` is banned across the
   * codebase for exactly this reason (golden rule 7).
   */
  it('reproduces the same path from the same seed', () => {
    expect(travelPath(20, 7, rng('same'))).toEqual(travelPath(20, 7, rng('same')));
    expect(travelPath(20, 7, rng('other'))).not.toEqual(travelPath(20, 7, rng('same')));
  });

  /* The path is a decoration, and a decoration that consumed the tournament's
   * randomness would change every pairing drawn after it (issue #8). */
  it('takes exactly the values it needs from the generator it is given', () => {
    const generator = createRng('cursor');
    const path = travelPath(20, 7, generator);

    // One for the hop count, one per travelling position. `int` rejects the
    // short tail of the 32-bit range, so this is a floor rather than an
    // equality.
    expect(generator.cursor).toBeGreaterThanOrEqual(path.length);
  });
});
