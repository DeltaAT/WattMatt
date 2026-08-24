import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

import { fitScale } from '@/windows/beamer/fit';

/**
 * Shrinks a scene body until it fits the stage (issue #55).
 *
 * Measured rather than estimated, and that is the whole point of the hook. The
 * height of a board depends on how many lines a card ends up with, on the font
 * the projector actually loaded and on the wording in `de-AT.ts` — none of which
 * a formula in `fit.ts` can see. An estimate that is optimistic by one row puts
 * a match on the floor behind the projector, and the room cannot tell it is
 * missing (docs/STYLEGUIDE.md §3).
 *
 * Two elements. The **frame** is the fixed box the scene has to fit into; it is
 * never scaled, so it is a stable thing to measure against. The **content** is
 * everything that shrinks. The scale is written to `--wm-fit`, which the
 * `beamer-fit` utility turns into `zoom` — so type, padding, borders, gaps and
 * radii all come down together and the boxes really do get smaller, rather than
 * the text rattling around inside boxes that stayed the size they were.
 *
 * Written to the DOM directly instead of through React state. A scale that went
 * through a render would re-run this effect, measure again and re-render — a
 * loop that settles only because the numbers happen to stop changing, which is
 * not a thing to rely on in front of an audience. `data-fit` carries the result
 * for tests and for anyone looking at the projector window with devtools open.
 */
export interface FitToStage {
  /** The fixed box to fit into. Put it on the element that owns the height. */
  frame: RefObject<HTMLDivElement>;
  /** Everything that scales. Must be the only child of the frame. */
  content: RefObject<HTMLDivElement>;
}

export function useFitToStage(): FitToStage {
  const frame = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  const apply = useCallback(() => {
    const frameElement = frame.current;
    const contentElement = content.current;
    if (frameElement === null || contentElement === null) {
      return;
    }

    // Measured unscaled, then scaled once. `zoom` multiplies every length
    // inside, so the natural height is all this needs to know — reading it back
    // at the new scale would only confirm arithmetic that is already exact.
    contentElement.style.setProperty('--wm-fit', '1');
    const scale = fitScale(frameElement.clientHeight, contentElement.scrollHeight);

    contentElement.style.setProperty('--wm-fit', String(scale));
    contentElement.dataset['fit'] = scale.toFixed(3);
  }, []);

  /*
   * After every render, not on a dependency list. The content of a live round
   * board changes on every result the host marks, and a card that grew a line
   * because a name arrived has to be measured again — a list of the things that
   * could have changed would be a list somebody has to remember to extend. Two
   * layout reads on a scene of thirty cards is not what costs frames here.
   */
  useLayoutEffect(apply);

  /*
   * And when the window itself changes size: the beamer is dragged to the
   * projector, the projector reports a different resolution, the host toggles
   * fullscreen. None of those re-render the scene, and all of them change the
   * box it has to fit into.
   */
  useEffect(() => {
    const frameElement = frame.current;
    if (frameElement === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(apply);
    observer.observe(frameElement);
    return () => {
      observer.disconnect();
    };
  }, [apply]);

  return { frame, content };
}
