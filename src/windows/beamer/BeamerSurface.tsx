import { useEffect, type ReactNode } from 'react';

import { de } from '@/i18n';
import type { BeamerPlacement } from '@/platform/beamerWindow';
import { LetterboxStage } from '@/windows/beamer/LetterboxStage';

/**
 * Everything that makes the beamer window a presentation surface rather than a
 * web page: no chrome, no cursor, no context menu, no selection, no scrollbars,
 * and a 16:9 stage whatever the projector reports (docs/STYLEGUIDE.md §3, §5).
 *
 * Kept apart from `BeamerWindow` so these properties can be asserted at both
 * placements without a window system — they are the ones the audience sees.
 */
export function BeamerSurface({
  placement,
  performanceMode,
  embedded = false,
  children,
}: {
  placement: BeamerPlacement;
  /**
   * Whether to run the cheap motion (docs/MOTION.md §6, issue #15).
   *
   * It arrives from the host in every snapshot, so flipping it reaches a window
   * that is already showing something — which is when a host reaches for it,
   * because the projector is stuttering in front of them right now. The
   * durations themselves live in `src/styles/global.css`, keyed on the
   * attribute below, so a scene written later is covered without its author
   * having to remember.
   */
  performanceMode: boolean;
  /**
   * Rendered inside another window's layout rather than owning the window it is
   * in — the host's live preview thumbnail (issue #28).
   *
   * It changes nothing the audience can see and two things the *host* would
   * notice: the surface keeps its hands off the window's context menu and text
   * selection, which belong to the host UI around it, and the cursor stays
   * visible over it. Everything below this line is otherwise identical, which
   * is the point of the preview — a second implementation of the picture would
   * be a preview that could lie.
   */
  embedded?: boolean;
  children: ReactNode;
}) {
  const isPreview = placement === 'preview';

  usePresentationChrome(!embedded);

  return (
    <div
      // `.beamer-root` carries the resolution-relative type scale and hides the
      // cursor (src/styles/global.css). In the windowed preview the cursor has
      // to come back: with a single screen it is the host's only pointer, and
      // losing it over the preview window is a trap, not a feature
      // (docs/OPEN-QUESTIONS.md 16).
      className={`beamer-root relative h-full w-full select-none overflow-hidden ${
        isPreview || embedded ? 'cursor-auto' : ''
      }`}
      data-placement={placement}
      data-performance-mode={String(performanceMode)}
    >
      <LetterboxStage>{children}</LetterboxStage>

      {isPreview ? (
        <p className="absolute left-0 top-0 m-2 rounded-wm-sm bg-wm-accent-soft px-2 py-1 text-beamer-caption font-bold text-wm-accent">
          {de.beamer.previewBadge}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Removes the last few ways a WebView can look like a browser.
 *
 * Listeners rather than CSS because these are events, and on `window` rather
 * than the root element so a right-click on a letterbox bar is covered too. The
 * host window deliberately keeps its defaults — nobody in the audience is
 * looking at it.
 */
function usePresentationChrome(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const suppress = (event: Event) => event.preventDefault();

    window.addEventListener('contextmenu', suppress);
    window.addEventListener('dragstart', suppress);
    window.addEventListener('selectstart', suppress);

    return () => {
      window.removeEventListener('contextmenu', suppress);
      window.removeEventListener('dragstart', suppress);
      window.removeEventListener('selectstart', suppress);
    };
  }, [enabled]);
}
