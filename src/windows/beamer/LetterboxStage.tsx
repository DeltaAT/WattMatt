import type { ReactNode } from 'react';

/**
 * The 16:9 area every beamer scene is drawn into.
 *
 * Projectors that report 4:3, 16:10 or 21:9 exist, and reflowing a scene for
 * them would mean every scene needing a second layout nobody ever rehearsed.
 * So the stage keeps 16:9 and the surplus becomes bars — docs/STYLEGUIDE.md §3,
 * "letterbox rather than reflow".
 *
 * The bars are `--wm-bg` rather than black on purpose: projectors band and
 * crush pure black (docs/STYLEGUIDE.md §1), and a seam between the stage and
 * the bar would be more visible than the bar itself.
 */
export function LetterboxStage({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden bg-wm-bg">
      <div className="beamer-stage relative overflow-hidden">{children}</div>
    </div>
  );
}
