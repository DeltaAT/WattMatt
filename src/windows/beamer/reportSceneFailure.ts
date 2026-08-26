import { describeError, logEvent } from '@/platform/log';
import { createBeamerTransport } from '@/platform/windowSync';
import { BEAMER_PROBLEM_EVENT } from '@/store/syncContract';

/**
 * Tells the host that the projector could not draw what it was staged
 * (issue #30, `BEAMER_PROBLEM_EVENT`).
 *
 * The room is looking at a neutral picture by the time this runs, and the host
 * is looking at a laptop that has no way of knowing. Without this message the
 * one person who can fix it is the last to find out — which, with the projector
 * behind them, may be not at all.
 *
 * A transport is built per call rather than threaded down from `useBeamerView`.
 * `createBeamerTransport` wraps Tauri's `emitTo` and holds no state, so there is
 * nothing to keep alive — and the alternative, passing a channel through the
 * scene tree to be used only when that tree has already thrown, is the sort of
 * wiring that quietly stops working.
 */
export function reportSceneFailure(scene: string, error: unknown): void {
  const detail = describeError(error);

  logEvent({
    level: 'error',
    event: 'beamer.scene-failed',
    message: `scene ${scene} could not be drawn`,
    detail,
  });

  // Fire and forget. A projector that has just failed to render is not a
  // window whose messages are guaranteed to arrive, and there is nothing
  // useful left to do about it here — the log already has the failure.
  void createBeamerTransport()
    .emit(BEAMER_PROBLEM_EVENT, { scene, detail })
    .catch(() => {});
}
