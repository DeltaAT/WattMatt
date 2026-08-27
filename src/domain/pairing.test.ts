import { describe, expect, it } from 'vitest';

import { havePlayed, type MatchHistory } from '@/domain/history';
import type { GroupId } from '@/domain/ids';
import { drawPairing, type Pair } from '@/domain/pairing';
import { createRng } from '@/domain/rng';
import { groupId } from '@/domain/testFixtures';

/**
 * The pairing engine (issue #72, docs/TOURNAMENT-RULES.md §3).
 *
 * The properties are asserted rather than a recorded output: a pairing is
 * correct because nobody meets an old opponent, everybody is in exactly one
 * pair, and the same seed produces the same answer — not because it matches a
 * string somebody pasted in once.
 *
 * The unsolvable field is the case worth the most here. Four groups in their
 * third round have all played all, there is no rematch-free pairing, and the
 * engine has to say so rather than search forever.
 */

const field = (n: number): readonly GroupId[] =>
  Array.from({ length: n }, (_unused, index) => groupId(index + 1));

/** A history built from pairs written as group numbers, for readability. */
function history(...pairs: readonly (readonly [number, number])[]): MatchHistory {
  const built = new Map<GroupId, Set<GroupId>>();
  const remember = (a: GroupId, b: GroupId) => {
    const opponents = built.get(a) ?? new Set<GroupId>();
    opponents.add(b);
    built.set(a, opponents);
  };
  for (const [a, b] of pairs) {
    remember(groupId(a), groupId(b));
    remember(groupId(b), groupId(a));
  }
  return built;
}

/** Every pair of a field of `n`, which is the state that admits no answer. */
function everyoneHasPlayed(n: number): MatchHistory {
  const pairs: (readonly [number, number])[] = [];
  for (let a = 1; a <= n; a += 1) {
    for (let b = a + 1; b <= n; b += 1) {
      pairs.push([a, b]);
    }
  }
  return history(...pairs);
}

function rematches(pairs: readonly Pair[], played: MatchHistory): readonly Pair[] {
  return pairs.filter(([a, b]) => havePlayed(played, a, b));
}

/** Everyone appears exactly once, as a pair or as a bye. */
function covers(pairs: readonly Pair[], byes: readonly GroupId[], size: number): boolean {
  const seen = pairs.flatMap((pair) => [...pair]).concat([...byes]);
  return seen.length === size && new Set(seen).size === size;
}

const rng = () => createRng('seed');

describe('drawPairing', () => {
  it('pairs the whole field, byes aside', () => {
    const pairing = drawPairing(field(8), { history: new Map(), rng: rng(), byes: 0 });

    expect(pairing.pairs).toHaveLength(4);
    expect(pairing.byes).toEqual([]);
    expect(covers(pairing.pairs, pairing.byes, 8)).toBe(true);
  });

  it('gives an odd field the one bye §3 owes it, off the back of the shuffle', () => {
    const pairing = drawPairing(field(7), { history: new Map(), rng: rng(), byes: 0 });

    expect(pairing.pairs).toHaveLength(3);
    expect(pairing.byes).toHaveLength(1);
    expect(covers(pairing.pairs, pairing.byes, 7)).toBe(true);
  });

  it('hands out the Freilose §4 owes, plus the one an odd count earns', () => {
    // A field of 13 short of 16 owes three; the count then leaves an even ten
    // to pair, so three is also the total (docs/TOURNAMENT-RULES.md §4).
    const pairing = drawPairing(field(13), { history: new Map(), rng: rng(), byes: 3 });

    expect(pairing.byes).toHaveLength(3);
    expect(pairing.pairs).toHaveLength(5);
    expect(covers(pairing.pairs, pairing.byes, 13)).toBe(true);
  });

  it('keeps two groups apart who have already played', () => {
    // Round 1 of a field of 8, in full. Round 2 may repeat none of it.
    const played = history([1, 2], [3, 4], [5, 6], [7, 8]);
    const pairing = drawPairing(field(8), { history: played, rng: rng(), byes: 0 });

    expect(rematches(pairing.pairs, played)).toEqual([]);
    expect(pairing.forced).toEqual([]);
    expect(covers(pairing.pairs, pairing.byes, 8)).toBe(true);
  });

  it('finds the one valid pairing there is', () => {
    // Six groups where every pair but three has already met. The only
    // rematch-free pairing left is 1-2, 3-4, 5-6, and the engine has to find it
    // by backtracking rather than by luck.
    const forbidden: (readonly [number, number])[] = [];
    for (let a = 1; a <= 6; a += 1) {
      for (let b = a + 1; b <= 6; b += 1) {
        const allowed = (a === 1 && b === 2) || (a === 3 && b === 4) || (a === 5 && b === 6);
        if (!allowed) {
          forbidden.push([a, b]);
        }
      }
    }
    const played = history(...forbidden);

    const pairing = drawPairing(field(6), { history: played, rng: rng(), byes: 0 });

    expect(pairing.forced).toEqual([]);
    expect(pairing.pairs.map(([a, b]) => [a, b].sort().join('+')).sort()).toEqual(
      [
        [groupId(1), groupId(2)].sort().join('+'),
        [groupId(3), groupId(4)].sort().join('+'),
        [groupId(5), groupId(6)].sort().join('+'),
      ].sort(),
    );
  });

  it('falls back to the fewest rematches when there is no valid pairing', () => {
    // Four groups who have all played all — the third round of a four-group
    // tournament. Every pairing is two rematches, and the engine has to return
    // one of them rather than loop (issue #72).
    const played = everyoneHasPlayed(4);

    const pairing = drawPairing(field(4), { history: played, rng: rng(), byes: 0 });

    expect(covers(pairing.pairs, pairing.byes, 4)).toBe(true);
    expect(pairing.forced).toHaveLength(2);
    expect(pairing.forced).toEqual(rematches(pairing.pairs, played));
  });

  it('takes only the rematches it has to', () => {
    // Groups 1 and 2 have played everyone including each other, so one rematch
    // is unavoidable — but exactly one, and it has to be theirs.
    const played = history([1, 2], [1, 3], [1, 4], [2, 3], [2, 4]);

    const pairing = drawPairing(field(4), { history: played, rng: rng(), byes: 0 });

    expect(pairing.forced).toHaveLength(1);
    expect([...(pairing.forced[0] ?? [])].sort()).toEqual([groupId(1), groupId(2)].sort());
  });

  it('is the same pairing for the same seed and the same history', () => {
    const played = history([1, 2], [3, 4], [5, 6], [7, 8]);
    const once = drawPairing(field(8), { history: played, rng: createRng('abc'), byes: 0 });
    const again = drawPairing(field(8), { history: played, rng: createRng('abc'), byes: 0 });

    expect(again.pairs).toEqual(once.pairs);
    expect(again.byes).toEqual(once.byes);
  });

  it('is a different pairing further along the same stream', () => {
    // What makes a second round a second round: the cursor has moved on, so the
    // same field is not dealt the same way twice (CLAUDE.md golden rule 7).
    const first = drawPairing(field(16), { history: new Map(), rng: createRng('abc'), byes: 0 });
    const later = drawPairing(field(16), {
      history: new Map(),
      rng: createRng('abc', 40),
      byes: 0,
    });

    expect(later.pairs).not.toEqual(first.pairs);
  });

  it('spends one shuffle when the first attempt works', () => {
    // The ordinary draw, which is every draw: the cursor moves by exactly the
    // one shuffle it used and no further, so an existing tournament file's
    // recorded cursor still means what it meant (CLAUDE.md golden rule 7).
    const reference = createRng('seed');
    reference.shuffle(field(8));

    const stream = createRng('seed');
    drawPairing(field(8), { history: new Map(), rng: stream, byes: 0 });

    expect(stream.cursor).toBe(reference.cursor);
  });

  it('handles a field of two, which is a final', () => {
    const pairing = drawPairing(field(2), { history: new Map(), rng: rng(), byes: 0 });

    expect(pairing.pairs).toHaveLength(1);
    expect(pairing.byes).toEqual([]);
  });

  it('handles an empty field without pairing anything', () => {
    const pairing = drawPairing([], { history: new Map(), rng: rng(), byes: 0 });

    expect(pairing).toEqual({ pairs: [], byes: [], forced: [] });
  });

  it('answers a large unsolvable field without hanging', () => {
    // The pathological case, deliberately: 16 groups who have all played all.
    // The engine may not search forever and it may not throw — a frozen host
    // window is the worst failure this app has. The timeout is the assertion:
    // an engine that looped would fail this test rather than the suite.
    const played = everyoneHasPlayed(16);

    const pairing = drawPairing(field(16), { history: played, rng: rng(), byes: 0 });

    expect(covers(pairing.pairs, pairing.byes, 16)).toBe(true);
    expect(pairing.forced).toHaveLength(8);
  }, 2_000);
});
