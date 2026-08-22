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
  children,
}: {
  placement: BeamerPlacement;
  children: ReactNode;
}) {
  const isPreview = placement === 'preview';

  usePresentationChrome();

  return (
    <div
      // `.beamer-root` carries the resolution-relative type scale and hides the
      // cursor (src/styles/global.css). In the windowed preview the cursor has
      // to come back: with a single screen it is the host's only pointer, and
      // losing it over the preview window is a trap, not a feature
      // (docs/OPEN-QUESTIONS.md 16).
      className={`beamer-root relative h-full w-full select-none overflow-hidden ${
        isPreview ? 'cursor-auto' : ''
      }`}
      data-placement={placement}
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
function usePresentationChrome(): void {
  useEffect(() => {
    const suppress = (event: Event) => event.preventDefault();

    window.addEventListener('contextmenu', suppress);
    window.addEventListener('dragstart', suppress);
    window.addEventListener('selectstart', suppress);

    return () => {
      window.removeEventListener('contextmenu', suppress);
      window.removeEventListener('dragstart', suppress);
      window.removeEventListener('selectstart', suppress);
    };
  }, []);
}
