import { useEffect, useRef, useState } from 'react';

import { IDLE_SCENE, type BeamerScene } from '@/domain/beamerScene';

/**
 * The 200 ms fade the blackout arrives on (issue #28, docs/MOTION.md §4.6).
 *
 * A fade *from* a picture needs that picture to still be there, so for the
 * length of the fade the beamer keeps drawing the scene the blackout is
 * covering and puts an opaque veil over it. Once the veil has landed the scene
 * underneath is dropped: a draw sequence playing on behind an opaque layer for
 * the rest of the evening would spend the frame budget of docs/MOTION.md §6 on
 * something nobody can see.
 *
 * Two failure modes are deliberately closed off, because this is the one
 * control that must never fail.
 *
 *  - The veil's resting opacity is 1 and the animation only fades it *in*
 *    (`wm-blackout-veil`), so an animation that does not run leaves the screen
 *    black immediately rather than not black at all.
 *  - A blackout that arrives as a catch-up does not fade. A beamer reopened
 *    into a dark room must come up dark; fading in from the picture the host
 *    blacked out ten minutes ago would show the audience that picture again.
 */

/** Kept in step with `--dur-blackout` (src/styles/tokens.css). */
export const BLACKOUT_FADE_MS = 200;

export interface Blackout {
  /** The scene to draw — the covered one while the veil is coming down. */
  under: BeamerScene;
  /** Whether the veil is on screen and the scene under it is still live. */
  veil: boolean;
}

export function useBlackout(scene: BeamerScene, settled: boolean): Blackout {
  const isBlackout = scene.id === 'BLACKOUT';

  /**
   * The last picture that was not a blackout.
   *
   * Written in an effect rather than during the render, which is what makes it
   * usable: on the render where the blackout arrives this still holds the scene
   * the host has just covered, and that is precisely the one to fade from.
   */
  const covered = useRef<BeamerScene>(IDLE_SCENE);

  const [veil, setVeil] = useState(false);

  useEffect(() => {
    if (!isBlackout) {
      covered.current = scene;
    }
  }, [scene, isBlackout]);

  useEffect(() => {
    if (!isBlackout || settled) {
      setVeil(false);
      return;
    }

    setVeil(true);
    const timer = setTimeout(() => setVeil(false), BLACKOUT_FADE_MS);
    return () => clearTimeout(timer);
  }, [isBlackout, settled]);

  return { under: veil ? covered.current : scene, veil };
}
