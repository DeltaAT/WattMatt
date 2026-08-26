import { useEffect, useState } from 'react';

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
  return query()?.matches ?? false;
}

/**
 * The same answer, kept current (issue #29).
 *
 * The setting can change while the window is open — a host turning it on
 * precisely because the projector is misbehaving in front of them — and a value
 * read once at mount would then be wrong for the rest of the evening, on the
 * one window nobody can reach to reload. Subscribing is a few lines and removes
 * the whole class of problem.
 *
 * `addEventListener` is fine to reach for unguarded: this runs in the app's own
 * WebView2, not in whatever browser a user brought.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const media = query();
    if (media === null) {
      return;
    }

    // Read once more on subscribe: the setting can have changed between the
    // first render and this effect, and nothing would tell us afterwards.
    setReduced(media.matches);

    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/** `null` where there is no `matchMedia` — jsdom, a server render. */
function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}
