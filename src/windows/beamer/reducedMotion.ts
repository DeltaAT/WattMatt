/**
 * Whether this window has been asked to hold still (docs/MOTION.md §6).
 *
 * Read here as well as in CSS because two of the beamer's effects are not
 * keyframes and cannot be switched off by a media query: the draw's cycling
 * numbers, which JavaScript ticks (#18), and the bracket's advancement, whose
 * distance is measured at runtime (#25). Both must stop, not merely slow down —
 * flickering digits and a chip flying across the wall are precisely what the
 * setting exists to prevent.
 *
 * Separate from `performanceMode`, which is the host's decision about a weak
 * projector and only shortens durations. This one belongs to the machine the
 * beamer window runs on and removes movement altogether.
 *
 * A window with no `matchMedia` — jsdom, a server render — counts as "animate":
 * the accessible default is what the viewer asked for, and nobody has asked for
 * anything here.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
