/**
 * The seeded random number generator every draw goes through
 * (CLAUDE.md golden rule 7, ARCHITECTURE.md §5).
 *
 * `Math.random()` is banned across the codebase because a draw has to be
 * defensible. If a participant disputes a pairing after the event, the seed and
 * the cursor stored in the tournament file reproduce that exact draw, and every
 * one before it. That property is only worth anything if nothing else in the
 * tournament can consume randomness, which is why this is the single source.
 *
 * The algorithm is mulberry32: a 32-bit state, one multiply-xor round, and a
 * period of 2^32. It is not cryptographic and does not need to be — it needs to
 * be deterministic, portable across machines, and fast enough that a shuffle of
 * sixty-four groups is invisible.
 */

/** mulberry32's step. The state advances by exactly this on every draw. */
const STEP = 0x6d2b79f5;

const UINT32_RANGE = 2 ** 32;

export type Rng = {
  /**
   * How many values have been consumed. Persisted as `rngCursor` so a
   * tournament reopened after a crash continues the stream instead of
   * restarting it and re-drawing identical pairings.
   */
  readonly cursor: number;
  /** A float in [0, 1). */
  next: () => number;
  /** An integer in [0, maxExclusive), uniformly distributed. */
  int: (maxExclusive: number) => number;
  /** One element, uniformly chosen. Throws on an empty array. */
  pick: <T>(items: readonly T[]) => T;
  /** A shuffled copy. The input is never mutated. */
  shuffle: <T>(items: readonly T[]) => T[];
};

/**
 * Derive a 32-bit state from a seed string (xmur3).
 *
 * The seed is stored as text in the tournament file so it survives being
 * opened in Notepad, but mulberry32 needs an integer. Hashing rather than
 * parsing means any string works as a seed, including one a host typed.
 */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    h = Math.imul(h ^ seed.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Create an RNG positioned at `cursor` values into the stream for `seed`.
 *
 * Resuming is O(1) rather than a replay loop: mulberry32 advances its state by
 * a constant, so the state after n draws is `initial + n * STEP` (mod 2^32).
 * `rng.test.ts` pins that against an actual replay rather than trusting the
 * arithmetic — a seek that disagreed with replaying would silently hand a
 * reopened tournament a different draw than the one already on the projector.
 */
export function createRng(seed: string, cursor = 0): Rng {
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error(`RNG cursor must be a non-negative integer, got ${cursor}`);
  }

  const initial = hashSeed(seed);
  let consumed = cursor;
  let state = (initial + Math.imul(cursor, STEP)) | 0;

  function nextUint32(): number {
    consumed += 1;
    state = (state + STEP) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  function int(maxExclusive: number): number {
    // The upper bound is not fussiness. One draw carries 32 bits, so a range
    // above 2^32 cannot be filled uniformly — and worse, `UINT32_RANGE %
    // maxExclusive` is then `UINT32_RANGE`, which makes `limit` zero and the
    // rejection loop below spin forever. A frozen host window mid-event is the
    // worst failure this app has; it fails loudly here instead.
    if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
      throw new Error(`RNG range must be an integer in [1, 2^32], got ${maxExclusive}`);
    }

    // Rejection sampling. `value % max` alone is biased toward the low end
    // whenever max does not divide 2^32 — by about one part in 2^32 per
    // outcome, which no audience would ever notice, but "uniform apart from a
    // rounding artefact" is not a sentence worth saying to a participant who
    // is disputing a draw. Discarding the short tail costs one extra value
    // per 2^32/max draws on average.
    const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = nextUint32();
    while (value >= limit) {
      value = nextUint32();
    }
    return value % maxExclusive;
  }

  return {
    get cursor() {
      return consumed;
    },

    next() {
      return nextUint32() / UINT32_RANGE;
    },

    int,

    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        // Checked here rather than left to `int`, which would otherwise report
        // this as "range must be a positive integer" — true, but it sends
        // whoever reads the log looking at the wrong argument.
        throw new Error('Cannot pick from an empty array');
      }
      // In range by construction; `noUncheckedIndexedAccess` cannot see it.
      return items[int(items.length)] as T;
    },

    shuffle<T>(items: readonly T[]): T[] {
      // Fisher-Yates, walked from the end. Every permutation is equally
      // likely; `sort(() => rng.next() - 0.5)` is not — it is not even a valid
      // comparator, and browsers disagree about what it produces.
      const result = [...items];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = int(index + 1);
        // Both indices are in range by construction — `index` walks the array
        // and `swap` is drawn from [0, index]. The casts answer
        // `noUncheckedIndexedAccess`, which cannot see that. Skipping the swap
        // on an `undefined` read instead would quietly refuse to shuffle an
        // array whose element type legitimately includes `undefined`.
        const a = result[index] as T;
        const b = result[swap] as T;
        result[index] = b;
        result[swap] = a;
      }
      return result;
    },
  };
}
