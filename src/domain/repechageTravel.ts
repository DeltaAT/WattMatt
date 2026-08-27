import type { Rng } from '@/domain/rng';

/**
 * The travelling highlight of the `Hoffnungsrunde` draw, as arithmetic
 * (issue #89, docs/MOTION.md §4.3, docs/TOURNAMENT-RULES.md §4).
 *
 * The most dramatic moment of the evening is a lottery, and it has to look like
 * one. A highlight that walks the pot in index order, or drifts toward one
 * corner, tells the room who is coming several seconds before the app does —
 * and once the audience can call the winner, the moment is spent.
 *
 * **The result is not decided here.** `@/domain/repechage` has already drawn the
 * candidate from the tournament's own seeded stream by the time any of this
 * runs; what this produces is the path a light takes on its way to a card that
 * was chosen before the animation started. That order matters for issue #8's
 * guarantee: a draw must be reproducible from `(seed, cursor)`, so a decoration
 * that consumed values from the tournament's stream would change every pairing
 * that came after it. The `Rng` handed in here is a **presentation** generator,
 * created for one draw and thrown away (`useRepechageTravel`), and it must
 * never be the tournament's.
 *
 * Seeded rather than `Math.random()` all the same — golden rule 7 is absolute,
 * and the same seed reproducing the same path is a small gift to anybody
 * debugging a report of "it flickered oddly on the night".
 *
 * The scene owns *when* the highlight moves. This owns *where it goes and how
 * long it stays*, which is the part that has to be right at a pot of 3 and at a
 * pot of 30, and it is checked at both without a browser.
 */

/**
 * The numbers the travel is made of, in milliseconds (issue #89).
 *
 * `first` and `last` are the dwell on the first and the final travelling
 * position: the highlight starts flicking between cards faster than the eye
 * follows and slows to a near-stop before it lands, which is how a lottery
 * machine reads and the reason the deceleration is the effect rather than the
 * movement itself.
 *
 * The hop count is drawn per travel between `minHops` and `maxHops`, which is
 * not decoration either — an audience that has watched three draws has counted
 * the hops, and a fixed count would let them call the winner one hop early
 * however random the positions were. The dwell ramps linearly, so the total is
 * exactly `hops × (first + last) / 2`: between 1680 ms and 2400 ms, inside the
 * issue's 1.5–2.5 s at both ends of the range.
 */
export const TRAVEL_BEATS = {
  first: 80,
  last: 400,
  minHops: 7,
  maxHops: 10,
} as const;

/**
 * The smallest pot that gets a travel at all.
 *
 * Below this the animation is a lie: with two cards a highlight bouncing
 * between them is not suspense, it is a coin being flipped in front of somebody
 * who can see both sides. The issue asks for a direct reveal instead, which is
 * what an empty path produces — the drawn card simply lifts, as it did before
 * this existed.
 *
 * Three is where a path can still be surprising, because there is at least one
 * position that is neither the target nor where the light already is.
 */
export const MINIMUM_TRAVEL_FIELD = 3;

/** One position of the highlight, and when it lights up. */
export interface TravelHop {
  /** Index into the candidate list — the caller's order, untouched. */
  index: number;
  /** Milliseconds from the start of the travel. The first hop is at 0. */
  at: number;
}

/**
 * Where the highlight goes on its way to `target`, and when.
 *
 * The last hop is always the target and no earlier hop ever is — "never visit
 * the target early and linger on it", which is the one mistake that would give
 * the whole thing away in a single frame.
 *
 * Empty for a field too small to travel across, or for a target that names no
 * card. An empty path is the direct reveal, not an error: the caller lands the
 * candidate immediately, which is exactly the picture reduced motion and
 * performance mode also ask for.
 */
export function travelPath(count: number, target: number, rng: Rng): readonly TravelHop[] {
  if (!Number.isInteger(count) || !Number.isInteger(target)) {
    return [];
  }
  if (count < MINIMUM_TRAVEL_FIELD || target < 0 || target >= count) {
    return [];
  }

  const hops = TRAVEL_BEATS.minHops + rng.int(TRAVEL_BEATS.maxHops - TRAVEL_BEATS.minHops + 1);
  const path: TravelHop[] = [];
  let at = 0;
  let previous: number | null = null;

  for (let hop = 0; hop < hops; hop += 1) {
    const isLast = hop === hops - 1;
    const index = choose({
      count,
      rng,
      // The target is off limits for every travelling hop, and so is standing
      // still on the card the light is already on.
      exclude: previous === null ? [target] : [target, previous],
      // Never to a neighbour. On the last travelling hop the target counts as a
      // neighbour too, so the landing is a jump rather than a slide onto the
      // card next door — which would be the same telegraph one step later.
      spacedFrom: previous === null ? [] : isLast ? [previous, target] : [previous],
    });

    path.push({ index, at: Math.round(at) });
    at += dwell(hop, hops);
    previous = index;
  }

  path.push({ index: target, at: Math.round(at) });
  return path;
}

/** How long the travel runs before the candidate is on screen. */
export function travelDuration(path: readonly TravelHop[]): number {
  return path.at(-1)?.at ?? 0;
}

/**
 * How long the highlight rests on hop `index` of `hops`, in milliseconds.
 *
 * Linear from `first` to `last`. An exponential ramp was the other option and
 * looks almost identical over eight hops, but a straight line is the one whose
 * total a test can state in a single expression — and the total is the number
 * the issue actually constrains.
 */
function dwell(index: number, hops: number): number {
  if (hops <= 1) {
    return TRAVEL_BEATS.last;
  }
  const progress = index / (hops - 1);
  return TRAVEL_BEATS.first + (TRAVEL_BEATS.last - TRAVEL_BEATS.first) * progress;
}

/**
 * One position, drawn uniformly from what the rules leave open.
 *
 * **Uniform is the requirement, not a detail.** "Position stays random right up
 * to the final jump" means the distribution must not tighten around the target
 * as the travel goes on: a highlight that visibly closes in telegraphs the
 * result as plainly as a counter would. So nothing here knows how far along the
 * travel is, and the target is simply absent from the pool until the landing.
 *
 * The spacing rule is a preference rather than a law, and that is what makes a
 * pot of three work: with three cards and the target in the middle there is no
 * position two apart from anywhere, so the rule that cannot be satisfied is
 * dropped instead of the travel failing. A field big enough to honour it always
 * does.
 */
function choose({
  count,
  exclude,
  spacedFrom,
  rng,
}: {
  count: number;
  /** Indices this hop may not use at all. */
  exclude: readonly number[];
  /** Indices this hop should stay at least two cards away from. */
  spacedFrom: readonly number[];
  rng: Rng;
}): number {
  const open = Array.from({ length: count }, (_unused, index) => index).filter(
    (index) => !exclude.includes(index),
  );
  const spaced = open.filter((index) => spacedFrom.every((other) => Math.abs(index - other) >= 2));

  const pool = spaced.length > 0 ? spaced : open;
  // `open` cannot be empty: at most two indices are excluded and the field is
  // at least `MINIMUM_TRAVEL_FIELD`. The fallback is here so this is total
  // rather than because it is reachable.
  return pool.length === 0 ? (exclude[0] ?? 0) : rng.pick(pool);
}
