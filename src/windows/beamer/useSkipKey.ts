import { useEffect } from 'react';

/**
 * `Space` skips the running sequence to its settled board (issue #18).
 *
 * The host is always in control (CLAUDE.md golden rule 3), and a draw is the
 * one scene long enough to need interrupting: 32 pairings is ninety seconds in
 * front of a room that may already have got the idea.
 *
 * **This listens in the beamer window, so it only fires while that window has
 * focus.** With two screens the host is usually typing on the laptop, where the
 * key goes to the host window instead and nothing happens. Routing a host
 * keypress to the projector needs a message the contract does not have yet —
 * `beamer:scene` carries scenes, not commands — and that channel belongs to the
 * beamer control centre (issue #28). Recorded in docs/OPEN-QUESTIONS.md #53.
 *
 * `preventDefault` because Space scrolls a document by default, and the beamer
 * surface must never move under the audience.
 */
export function useSkipKey(skip: () => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      // `event.code`, not `event.key`: the physical key, so a keyboard layout
      // that puts something else on the space bar still skips.
      if (event.code !== 'Space' || event.repeat) {
        return;
      }
      event.preventDefault();
      skip();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [skip, enabled]);
}
