import { describe, expect, it } from 'vitest';

import { createRng } from '@/domain/rng';

const SEED = '8f3c1a7e';

function take(count: number, seed = SEED, cursor = 0): number[] {
  const rng = createRng(seed, cursor);
  return Array.from({ length: count }, () => rng.next());
}

describe('determinism', () => {
  it('produces the same sequence for the same seed', () => {
    expect(take(20)).toEqual(take(20));
  });

  it('produces a different sequence for a different seed', () => {
    expect(take(20, 'seed-a')).not.toEqual(take(20, 'seed-b'));
  });

  /*
   * Two seeds differing in one character must not land near each other in the
   * stream. Without the hash step a caller who names tournaments "turnier-1",
   * "turnier-2" would get near-identical draws all evening.
   */
  it('separates seeds that differ by a single character', () => {
    const a = take(10, 'turnier-1');
    const b = take(10, 'turnier-2');
    expect(a.filter((value, index) => value === b[index])).toEqual([]);
  });

  it('accepts any string as a seed, including one a host typed', () => {
    expect(() => take(5, 'Vereinsturnier 2026')).not.toThrow();
    expect(take(5, '')).toEqual(take(5, ''));
  });
});

/*
 * The algorithm is part of the file format, not an implementation detail.
 *
 * A tournament file stores `(rngSeed, rngCursor)` and nothing else about the
 * stream, so the numbers below are what turn those two fields back into the
 * draw that actually happened. Change mulberry32 or the xmur3 seed hash and
 * every tournament ever saved silently replays differently — including the one
 * a participant is disputing.
 *
 * These are characterisation values: recorded from this implementation, not
 * derived from an external reference. They prove nothing about the quality of
 * the generator (the distribution test does that). Their whole job is to make
 * a change to the algorithm impossible to land by accident. If a change is
 * intended, it needs a schemaVersion bump and a migration (FILE-FORMAT rule 7),
 * and these values are updated deliberately as part of it.
 */
describe('golden vectors (the stream is part of the file format)', () => {
  const GOLDEN_SEED = 'wattmatt-v1';

  it('produces the recorded floats', () => {
    const rng = createRng(GOLDEN_SEED);
    expect(Array.from({ length: 8 }, () => rng.next())).toEqual([
      0.3882599361240864, 0.6811052528209984, 0.48921187431551516, 0.6820903695188463,
      0.09736869600601494, 0.1735365935601294, 0.012422752799466252, 0.6895048602018505,
    ]);
  });

  it('produces the recorded integers', () => {
    const rng = createRng(GOLDEN_SEED);
    expect(Array.from({ length: 8 }, () => rng.int(1000))).toEqual([
      728, 786, 1, 830, 365, 994, 317, 825,
    ]);
  });

  it('produces the recorded shuffle', () => {
    expect(createRng(GOLDEN_SEED).shuffle([1, 2, 3, 4, 5, 6, 7, 8])).toEqual([
      5, 4, 3, 6, 8, 2, 7, 1,
    ]);
  });
});

describe('the cursor', () => {
  it('starts where it was told to', () => {
    expect(createRng(SEED).cursor).toBe(0);
    expect(createRng(SEED, 42).cursor).toBe(42);
  });

  it('counts every value consumed', () => {
    const rng = createRng(SEED);
    rng.next();
    rng.next();
    expect(rng.cursor).toBe(2);
  });

  it('counts the values a shuffle consumes', () => {
    const rng = createRng(SEED);
    rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rng.cursor).toBeGreaterThan(0);
  });

  /*
   * The acceptance criterion, and the reason the cursor is persisted at all:
   * a tournament reopened after a crash must continue the stream, not restart
   * it. Restarting would re-draw the pairings the room has already seen.
   *
   * Seeking is O(1) arithmetic on mulberry32's state, so it is checked against
   * an actual replay rather than trusted.
   */
  it('resumes exactly where a replayed stream would be', () => {
    const full = take(50);

    for (const cursor of [0, 1, 7, 49]) {
      const resumed = take(50 - cursor, SEED, cursor);
      expect(resumed, `cursor ${cursor}`).toEqual(full.slice(cursor));
    }
  });

  it('reproduces a whole draw from (seed, cursor) alone', () => {
    const groups = Array.from({ length: 13 }, (_, index) => index + 1);

    const live = createRng(SEED);
    live.shuffle(groups);
    const cursorAfterFirstDraw = live.cursor;
    const secondDraw = live.shuffle(groups);

    // What a reopened tournament file has: the seed and the cursor, nothing else.
    const replayed = createRng(SEED, cursorAfterFirstDraw).shuffle(groups);
    expect(replayed).toEqual(secondDraw);
  });

  it('rejects a cursor that is not a non-negative integer', () => {
    expect(() => createRng(SEED, -1)).toThrow(/non-negative integer/);
    expect(() => createRng(SEED, 1.5)).toThrow(/non-negative integer/);
  });
});

describe('next', () => {
  it('stays inside [0, 1)', () => {
    const rng = createRng(SEED);
    for (let draw = 0; draw < 10_000; draw += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('int', () => {
  it('stays inside [0, maxExclusive)', () => {
    const rng = createRng(SEED);
    for (let draw = 0; draw < 10_000; draw += 1) {
      const value = rng.int(7);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it('always returns 0 for a range of one', () => {
    const rng = createRng(SEED);
    expect([rng.int(1), rng.int(1), rng.int(1)]).toEqual([0, 0, 0]);
  });

  it('reaches both ends of the range', () => {
    const rng = createRng(SEED);
    const seen = new Set(Array.from({ length: 500 }, () => rng.int(4)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  /*
   * Proves the rejection sampling is real rather than decorative. A range of
   * 2^31 + 1 splits the 32-bit space almost exactly in half, so roughly every
   * other draw falls in the discarded tail — the cursor therefore has to
   * advance by more than the number of calls made. With `value % max` alone
   * the cursor would track the call count exactly.
   */
  it('discards the biased tail instead of folding it back in', () => {
    const rng = createRng(SEED);
    const CALLS = 200;

    for (let draw = 0; draw < CALLS; draw += 1) {
      expect(rng.int(2 ** 31 + 1)).toBeLessThan(2 ** 31 + 1);
    }

    expect(rng.cursor).toBeGreaterThan(CALLS);
  });

  it('rejects a range that cannot produce a value', () => {
    const rng = createRng(SEED);
    expect(() => rng.int(0)).toThrow(/\[1, 2\^32\]/);
    expect(() => rng.int(-3)).toThrow(/\[1, 2\^32\]/);
    expect(() => rng.int(2.5)).toThrow(/\[1, 2\^32\]/);
  });

  /*
   * A range above 2^32 used to hang: `UINT32_RANGE % maxExclusive` is then
   * UINT32_RANGE itself, so `limit` became 0 and the rejection loop spun
   * forever. Unreachable from an array length, but `int` is public API and a
   * frozen host window mid-event is this app's worst failure mode.
   *
   * The 2 s timeout is the assertion: a regression hangs the suite rather than
   * failing it, and a hung suite is a much worse diagnostic than a red one.
   */
  it('rejects a range wider than the generator instead of hanging', { timeout: 2000 }, () => {
    const rng = createRng(SEED);
    expect(() => rng.int(2 ** 32 + 1)).toThrow(/\[1, 2\^32\]/);
    expect(() => rng.int(Number.MAX_SAFE_INTEGER)).toThrow(/\[1, 2\^32\]/);
  });

  it('accepts the full generator range as an upper bound', () => {
    const value = createRng(SEED).int(2 ** 32);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(2 ** 32);
  });
});

describe('pick', () => {
  it('returns an element of the array', () => {
    const rng = createRng(SEED);
    const items = ['a', 'b', 'c'];
    for (let draw = 0; draw < 200; draw += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('returns the only element of a single-element array', () => {
    expect(createRng(SEED).pick(['only'])).toBe('only');
  });

  it('throws on an empty array rather than returning undefined', () => {
    // Asserts the message too: falling through to `int` would also throw, but
    // would blame the range rather than the empty array.
    expect(() => createRng(SEED).pick([])).toThrow(/empty array/);
  });
});

describe('shuffle', () => {
  it('keeps every element exactly once', () => {
    const items = Array.from({ length: 13 }, (_, index) => index + 1);
    const shuffled = createRng(SEED).shuffle(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  /*
   * The store replaces whole states rather than editing them, so a shuffle
   * that mutated the array it was handed would reorder the tournament's own
   * group list as a side effect of drawing.
   */
  it('does not mutate its input', () => {
    const items = [1, 2, 3, 4, 5];
    const before = [...items];
    createRng(SEED).shuffle(items);
    expect(items).toEqual(before);
  });

  it('handles empty and single-element arrays', () => {
    const rng = createRng(SEED);
    expect(rng.shuffle([])).toEqual([]);
    expect(rng.shuffle(['only'])).toEqual(['only']);
  });

  it('actually reorders', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    expect(createRng(SEED).shuffle(items)).not.toEqual(items);
  });

  it('is reproducible from the seed', () => {
    const items = Array.from({ length: 10 }, (_, index) => index);
    expect(createRng(SEED).shuffle(items)).toEqual(createRng(SEED).shuffle(items));
  });
});

/*
 * Issue #8: 100 000 shuffles of 8 elements, every element in every position
 * within tolerance.
 *
 * This is what separates Fisher-Yates from `sort(() => rng.next() - 0.5)`,
 * which passes every test above and is still badly biased. The RNG is seeded,
 * so this run is deterministic — it cannot flake, and the tolerance is set to
 * catch bias rather than to absorb noise.
 *
 * Expected count per (element, position) is 100000/8 = 12500, with a standard
 * deviation of sqrt(n·p·(1−p)) ≈ 105. The 4 % tolerance below is ~4.8σ.
 */
describe('shuffle distribution', () => {
  it('places every element in every position about equally often', () => {
    const SIZE = 8;
    const RUNS = 100_000;
    const EXPECTED = RUNS / SIZE;
    const TOLERANCE = EXPECTED * 0.04;

    const items = Array.from({ length: SIZE }, (_, index) => index);
    const counts = Array.from({ length: SIZE }, () => new Array<number>(SIZE).fill(0));
    const rng = createRng('distribution');

    for (let run = 0; run < RUNS; run += 1) {
      const shuffled = rng.shuffle(items);
      for (let position = 0; position < SIZE; position += 1) {
        const element = shuffled[position];
        if (element === undefined) {
          throw new Error(`shuffle produced a hole at position ${position}`);
        }
        const row = counts[element];
        if (row === undefined) {
          throw new Error(`shuffle produced an out-of-range element ${element}`);
        }
        row[position] = (row[position] ?? 0) + 1;
      }
    }

    for (let element = 0; element < SIZE; element += 1) {
      for (let position = 0; position < SIZE; position += 1) {
        const observed = counts[element]?.[position] ?? 0;
        expect(
          Math.abs(observed - EXPECTED),
          `element ${element} landed in position ${position} ${observed} times, expected ~${EXPECTED}`,
        ).toBeLessThan(TOLERANCE);
      }
    }

    /*
     * The per-cell bound above is a local check, and a loose one: a correct
     * shuffle already uses about 70 % of it, so a bias spread thinly across
     * many cells could stay under it everywhere. Chi-square over the whole
     * table catches exactly that — it accumulates small deviations instead of
     * looking at each in isolation, at no extra runtime since it reuses the
     * counts already gathered.
     *
     * An 8x8 position table has (8-1)^2 = 49 degrees of freedom, since every
     * row and every column is constrained to sum to RUNS. Chi-square(49) has
     * mean 49 and sd ~9.9, so the bound below sits about 5 sd out. The run is
     * seeded and therefore deterministic: this cannot flake.
     */
    let chiSquare = 0;
    for (let element = 0; element < SIZE; element += 1) {
      for (let position = 0; position < SIZE; position += 1) {
        const observed = counts[element]?.[position] ?? 0;
        chiSquare += (observed - EXPECTED) ** 2 / EXPECTED;
      }
    }

    expect(
      chiSquare,
      `chi-square over the 8x8 position table was ${chiSquare.toFixed(1)}, expected ~49`,
    ).toBeLessThan(100);
  });
});
