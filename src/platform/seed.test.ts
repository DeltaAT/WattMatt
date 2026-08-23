import { describe, expect, it } from 'vitest';

import { createRng } from '@/domain/rng';
import { generateSeed } from '@/platform/seed';

describe('generateSeed', () => {
  it('is 128 bits of lowercase hex', () => {
    expect(generateSeed()).toMatch(/^[0-9a-f]{32}$/);
  });

  /*
   * Two tournaments created on the same laptop must not share a draw stream.
   * A generator that returned a constant would pass every other test here.
   */
  it('does not repeat', () => {
    const seeds = new Set(Array.from({ length: 500 }, () => generateSeed()));
    expect(seeds.size).toBe(500);
  });

  it('produces a seed the RNG accepts and can replay', () => {
    const seed = generateSeed();
    const first = Array.from({ length: 10 }, () => createRng(seed).next());
    const second = Array.from({ length: 10 }, () => createRng(seed).next());
    expect(first).toEqual(second);
  });

  /*
   * Different seeds must actually diverge. The hash step inside the RNG is
   * what guarantees this, but the pairing is what matters in practice: seed
   * generation and the RNG have to agree, or every tournament draws alike.
   */
  it('gives different seeds different streams', () => {
    const a = createRng(generateSeed());
    const b = createRng(generateSeed());
    const drawsA = Array.from({ length: 10 }, () => a.next());
    const drawsB = Array.from({ length: 10 }, () => b.next());
    expect(drawsA).not.toEqual(drawsB);
  });
});
