import type { CSSProperties } from 'react';

/**
 * Fitting a scene onto the stage (issue #55, docs/STYLEGUIDE.md §3).
 *
 * A beamer scene never scrolls and the stage is `overflow-hidden`, so anything
 * that does not fit is simply gone — and the room has no way to tell that the
 * list it is reading is incomplete. A row that is too small can be read by
 * walking closer; a row that was cut off cannot be read at all. So nothing is
 * ever dropped, counted or clipped: the grid takes as many columns as the field
 * needs, and whatever is still too tall is scaled down until it fits.
 *
 * The arithmetic here is deliberately pure and separate from the DOM. What it
 * decides — how many columns, and by how much to shrink — is the part that has
 * to be right at 5 tables and at 60, and it is checked at both without a
 * browser (`fit.test.ts`). The measuring itself is `useFitToStage`.
 */

/** Every scene is drawn into a 16:9 stage, whatever the projector reports. */
export const STAGE_ASPECT = 16 / 9;

/**
 * How many columns a grid of `count` equal cells should take.
 *
 * Chosen so the cells come out near `cellAspect` (their width divided by their
 * height) on a 16:9 stage: `cols × cellAspect / rows ≈ 16/9`, which with
 * `rows = count / cols` gives `cols = sqrt(count × 16/9 / cellAspect)`.
 *
 * Continuous rather than a ladder of hand-tuned steps, because the step past
 * the last rung is exactly the case that used to clip. The constants each scene
 * passes are calibrated so the counts a host actually has — 16 groups, 5
 * tables, 9 sections — come out at the column counts the scenes used before
 * (`fit.test.ts` pins that), and everything above them keeps going instead of
 * stopping.
 */
export function fitColumns(count: number, cellAspect: number): number {
  if (!Number.isFinite(count) || count <= 1) {
    return 1;
  }
  const ideal = Math.ceil(Math.sqrt((count * STAGE_ASPECT) / cellAspect));
  // Never more columns than there are things to put in them: a row of empty
  // tracks would push the cards narrower for nothing.
  return Math.min(count, Math.max(1, ideal));
}

/**
 * How much the scene body has to shrink to fit the height it has.
 *
 * One ratio and no iteration, because the scale is applied with `zoom`: every
 * length inside — type, padding, borders, gaps — is multiplied by it, so the
 * content's height is linear in the scale and `available / natural` lands
 * exactly. That holds as long as nothing inside re-wraps at a different size,
 * which is why the scenes truncate names rather than wrapping them.
 *
 * Never scales *up*. A scene with four tables on it is meant to have air around
 * it, not to be inflated until it touches the safe area.
 *
 * Returns 1 when there is nothing to measure — a container of zero height, a
 * scene that has not been laid out yet, jsdom. Guessing a shrink from a
 * measurement that does not exist would put a scene on the projector at some
 * arbitrary size; leaving it alone shows it at its natural one.
 */
export function fitScale(available: number, natural: number): number {
  if (!Number.isFinite(available) || !Number.isFinite(natural)) {
    return 1;
  }
  if (available <= 0 || natural <= 0) {
    return 1;
  }
  return Math.min(1, available / natural);
}

/**
 * The `grid-template-columns` for a computed column count.
 *
 * An inline style rather than a Tailwind class, because the count is a number
 * this module works out at runtime and Tailwind can only emit classes it can
 * see in the source. `minmax(0, 1fr)` rather than `1fr`: a plain `1fr` track has
 * a minimum size of `auto`, so one long team name would widen its column and
 * push the others off the stage instead of truncating inside it.
 */
export function gridColumns(columns: number): CSSProperties {
  return { gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))` };
}
