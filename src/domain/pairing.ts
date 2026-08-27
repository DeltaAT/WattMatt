import { havePlayed, type MatchHistory } from '@/domain/history';
import type { GroupId } from '@/domain/ids';
import type { Rng } from '@/domain/rng';

/**
 * Pairing a shuffled field without repeating a match anyone has already played
 * (issue #72, docs/TOURNAMENT-RULES.md §3).
 *
 * §3 used to be a plain shuffle read off in twos. That is perfectly random and
 * perfectly unfair-looking: with 8 groups the chance that some pair from round
 * 1 meets again in round 2 is better than one in four, and from the third row
 * it does not read as chance, it reads as the app being broken.
 *
 * So the shuffle stays — it is where the fairness lives, and "the order they
 * came out of the pot" is the sentence the host says at the microphone — and
 * the pairing off it is the one rearrangement of that order in which nobody
 * meets an old opponent.
 *
 * ```text
 * repeat up to ATTEMPTS times:
 *     order := shuffle(field)               // seeded, so reproducible
 *     byes  := the last `sitting` of order  // §3: the last drawn sit it out
 *     pair the rest, first-unpaired-first, backtracking on a rematch
 *     if that succeeds: done
 * exhaustive pass over the last order, with a budget large enough to prove it
 * if even that fails: the smallest number of rematches there is, and the host
 * is told which pairs they are (`drawRound`, issue #72)
 * ```
 *
 * **The search is exhaustive, not greedy-with-a-prayer.** It always pairs the
 * first group that is still free, and tries every partner for it — so if it
 * comes back empty having spent less than its budget, there is genuinely no
 * rematch-free pairing of that order, and no number of retries would have found
 * one. Retrying is still worth it when the field is odd or owes `Freilose`,
 * because a different shuffle sits *different* groups out and that is a
 * different problem.
 *
 * **It is bounded.** A frozen host window during a live event is the worst
 * failure this app has, so every search carries a step budget and a search that
 * runs out is treated as "no answer" rather than allowed to keep going. The
 * costs are asymmetric and deliberately so: the worst case of giving up early
 * is a rematch the host is told about, and the worst case of not giving up is
 * fifty people watching a spinner.
 *
 * **It is deterministic.** Everything random comes from the injected `Rng`, in
 * a fixed sequence, so the same seed and the same history produce the same
 * pairing — including the number of attempts it took, which is what moves the
 * cursor (CLAUDE.md golden rule 7).
 */

/** Two groups drawn against each other. Unordered; `a` and `b` are card sides. */
export type Pair = readonly [GroupId, GroupId];

export interface Pairing {
  /** The pairs, in draw order — which is also the order tables are handed out. */
  readonly pairs: readonly Pair[];
  /** The groups sitting this round out, in draw order (§3, §4 fallback 1). */
  readonly byes: readonly GroupId[];
  /**
   * The subset of `pairs` that repeats an earlier meeting.
   *
   * Empty in every ordinary draw. Non-empty only when the field admits no
   * rematch-free pairing at all, and then the host is asked before the draw
   * reaches the projector — never silently (issue #72).
   */
  readonly forced: readonly Pair[];
}

export interface DrawPairingInput {
  /** Who has already played whom (`@/domain/history`). */
  history: MatchHistory;
  /** The tournament's own stream, positioned at its cursor. */
  rng: Rng;
  /**
   * How many of the field sit this round out: the `Freilose` §4's fallback owes
   * plus the one an odd count earns. Clamped and rounded up to whatever leaves
   * an even number to pair, so a caller cannot ask for an impossible split.
   */
  byes: number;
}

/**
 * How many shuffles to try before settling for an exhaustive pass.
 *
 * Eight rather than one because a reshuffle changes *who sits the round out*,
 * and that is the part a retry can actually fix; and eight rather than eighty
 * because attempts beyond the first only help in the rare fields where the
 * bye set is what decides feasibility, and every one of them costs the host a
 * moment in front of the room.
 */
const ATTEMPTS = 8;

/**
 * The step budgets. A step is one candidate partner considered.
 *
 * An attempt is meant to be cheap and is expected to succeed on its first
 * descent — a real field of 64 with two rounds behind it needs about 32 steps.
 * The exhaustive pass is the one allowed to prove a negative, so it gets three
 * orders of magnitude more, which is still a few milliseconds.
 */
const ATTEMPT_STEPS = 5_000;
const EXACT_STEPS = 250_000;

export function drawPairing(
  field: readonly GroupId[],
  { history, rng, byes }: DrawPairingInput,
): Pairing {
  const sitting = byeCount(field.length, byes);

  let order = rng.shuffle(field);
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    // Shuffled once before the loop and once per further attempt, rather than
    // at the top of it: the ordinary draw then consumes exactly one shuffle,
    // which is what the seeded stream used to advance by and what every
    // recorded cursor in an existing tournament file was written against.
    if (attempt > 0) {
      order = rng.shuffle(field);
    }
    const found = search(pool(order, sitting), history, 0, budget(ATTEMPT_STEPS));
    if (found !== null) {
      return { pairs: found, byes: sitOut(order, sitting), forced: [] };
    }
  }

  return settleFor(order, sitting, history);
}

/**
 * Whether these two have met before — the question `drawPairing` is built
 * around, re-exported so a caller can label a pair without knowing how the
 * history is shaped.
 */
export function isRematchPair(history: MatchHistory, [a, b]: Pair): boolean {
  return havePlayed(history, a, b);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The last resort: the fewest rematches the field admits.
 *
 * Reached only when eight shuffles all failed, which for a field with no byes
 * means the graph itself is unsolvable — 4 groups where everyone has played
 * everyone is the smallest example, and it is a real state a 4-group tournament
 * reaches in its third round (issue #72).
 *
 * Iterative deepening rather than one search that minimises: a search allowed
 * `k` rematches prunes everything worse than `k`, so asking for one, then two,
 * then three finds the true minimum and finds it fast, because the answer is
 * almost always one.
 */
function settleFor(order: readonly GroupId[], sitting: number, history: MatchHistory): Pairing {
  const candidates = pool(order, sitting);
  const byes = sitOut(order, sitting);
  const maximum = candidates.length / 2;

  for (let allowed = 0; allowed <= maximum; allowed += 1) {
    const found = search(candidates, history, allowed, budget(EXACT_STEPS));
    if (found !== null) {
      return { pairs: found, byes, forced: found.filter((pair) => isRematchPair(history, pair)) };
    }
  }

  // Unreachable by the arithmetic above — pairing the order off in twos costs
  // at most `maximum` rematches, so the last iteration always succeeds. Kept
  // because "the host window froze" and "the round came out empty" are both
  // worse than a pairing nobody had to think about, and a budget is a promise
  // that can be broken by a machine slower than the one this was written on.
  const pairs = sequential(candidates);
  return { pairs, byes, forced: pairs.filter((pair) => isRematchPair(history, pair)) };
}

/**
 * Every pairing of `candidates` with at most `allowed` rematches, first one
 * found, or null if there is none within the budget.
 *
 * Always pairs the **first** group still free. That is what makes the search
 * exhaustive without being redundant: every pairing puts that group somewhere,
 * so trying each of its partners covers all of them, and no pairing is reached
 * twice by a different route.
 *
 * The pairs come out in the order of their first group, which is draw order —
 * the order tables are handed out in and the order the queue drains in (§3).
 */
function search(
  candidates: readonly GroupId[],
  history: MatchHistory,
  allowed: number,
  remaining: { steps: number },
): Pair[] | null {
  const taken = candidates.map(() => false);
  const pairs: Pair[] = [];

  function step(from: number, spent: number): boolean {
    let a = from;
    while (a < candidates.length && taken[a] === true) {
      a += 1;
    }
    if (a === candidates.length) {
      return true;
    }

    const first = candidates[a] as GroupId;
    taken[a] = true;

    for (let b = a + 1; b < candidates.length; b += 1) {
      if (taken[b] === true) {
        continue;
      }
      if (remaining.steps <= 0) {
        break;
      }
      remaining.steps -= 1;

      const second = candidates[b] as GroupId;
      const cost = havePlayed(history, first, second) ? 1 : 0;
      if (spent + cost > allowed) {
        continue;
      }

      taken[b] = true;
      pairs.push([first, second]);
      if (step(a + 1, spent + cost)) {
        return true;
      }
      pairs.pop();
      taken[b] = false;
    }

    taken[a] = false;
    return false;
  }

  return step(0, 0) ? pairs : null;
}

/** The order read off in twos, ignoring the history entirely. */
function sequential(candidates: readonly GroupId[]): Pair[] {
  const pairs: Pair[] = [];
  for (let index = 0; index + 1 < candidates.length; index += 2) {
    pairs.push([candidates[index] as GroupId, candidates[index + 1] as GroupId]);
  }
  return pairs;
}

/**
 * How many of the field sit the round out.
 *
 * Clamped rather than trusted, for the reason the draw engine's `pair` gives: a
 * file repaired by hand can name a target the field cannot reach, and an odd
 * remainder still earns the one bye §3 gives it on top of whatever §4 owes.
 */
function byeCount(size: number, requested: number): number {
  const promised = Math.min(Math.max(requested, 0), size);
  return promised + ((size - promised) % 2);
}

/** The part of the order that gets paired. */
function pool(order: readonly GroupId[], sitting: number): readonly GroupId[] {
  return order.slice(0, order.length - sitting);
}

/** The part that does not — the last drawn, which is where §3 puts them. */
function sitOut(order: readonly GroupId[], sitting: number): readonly GroupId[] {
  return order.slice(order.length - sitting);
}

function budget(steps: number): { steps: number } {
  return { steps };
}
