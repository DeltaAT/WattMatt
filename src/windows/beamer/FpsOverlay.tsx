import { useEffect, useState } from 'react';

/**
 * A frame-rate readout for the corner of the beamer, in dev builds only
 * (issue #29, docs/MOTION.md §6).
 *
 * §6 sets a budget — 60 fps at 1920 × 1080 on integrated graphics — that
 * nobody can eyeball. A dropped frame at 1080p is visible to an audience and
 * invisible to a developer looking for it, because the eye reports "smooth
 * enough" long after the number has stopped being 60. So the number is on
 * screen while the scenes are being built.
 *
 * **Never in a release.** `import.meta.env.DEV` is a compile-time constant, so
 * the whole component and its `requestAnimationFrame` loop are dropped from a
 * production bundle rather than merely hidden — an overlay that could appear on
 * a projector in front of an audience because a flag was wrong is worse than no
 * overlay at all. `BeamerWindow` guards the mount with the same constant.
 *
 * The label is English on purpose. It is a developer instrument and never part
 * of the German UI (CLAUDE.md §1), which is also why it carries no locale key.
 */

/** How often the readout updates. Long enough to be readable, short enough to
 *  catch a scene stuttering as it arrives. */
const WINDOW_MS = 500;

export function FpsOverlay() {
  const fps = useFrameRate();

  return (
    <output
      // Above the stage and outside the safe area: this is not part of the
      // picture and must never be mistaken for it.
      className="wm-tnum pointer-events-none absolute right-0 bottom-0 z-50 m-1 rounded-wm-sm bg-wm-bg-elevated px-2 py-1 text-host-xs font-bold text-wm-text-muted opacity-70"
      data-fps-overlay=""
      aria-hidden="true"
    >
      {fps === null ? '—' : String(fps)}
      {' fps'}
    </output>
  );
}

/**
 * Frames per second over the last `WINDOW_MS`, or `null` until the first window
 * has closed.
 *
 * Counts frames rather than measuring the gap between two of them: a single
 * long frame is noise, and a *rate* is what the budget is expressed in. The
 * loop stops with the component, so nothing keeps a `requestAnimationFrame`
 * alive after the overlay is gone.
 */
export function useFrameRate(): number | null {
  const [fps, setFps] = useState<number | null>(null);

  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }

    let frames = 0;
    let since: number | null = null;
    let handle = 0;

    const tick = (now: number) => {
      if (since === null) {
        // The frame that opens the window is not in it: it has no elapsed time
        // behind it, and counting it would report one frame too many for every
        // window — a readout that flatters the budget it exists to police.
        since = now;
        handle = requestAnimationFrame(tick);
        return;
      }

      frames += 1;
      const elapsed = now - since;
      if (elapsed >= WINDOW_MS) {
        setFps(Math.round((frames * 1000) / elapsed));
        frames = 0;
        since = now;
      }

      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, []);

  return fps;
}
