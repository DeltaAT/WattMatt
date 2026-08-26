import type { BeamerViewState } from '@/store/beamerStore';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { BeamerHoldingScene } from '@/windows/beamer/BeamerHoldingScene';
import { BeamerPicture } from '@/windows/beamer/BeamerPicture';

/**
 * The stage contents, with a net under them (issue #30).
 *
 * Everywhere the beamer picture is drawn goes through here — the projector and
 * the host's live preview both — so a scene that throws is caught in exactly
 * one place and behaves identically in both. A preview that could show a white
 * rectangle while the projector held a picture, or the other way round, would
 * be a preview the host cannot trust at the one moment they most need to.
 *
 * The boundary sits *inside* `BeamerSurface` on purpose. The surface owns the
 * background, the letterbox bars, the hidden cursor and the suppressed context
 * menu; a boundary above it would take all of that with the scene and leave the
 * audience looking at a browser.
 *
 * It resets on the staged scene id, which is the host's way out: a scene that
 * threw will throw again on the next snapshot, so re-rendering it would only
 * flicker. Staging a different scene — or the blackout, which is one key away —
 * makes the beamer try again.
 */
export function SafeBeamerPicture({
  view,
  onSceneFailure,
}: {
  view: BeamerViewState;
  /**
   * Reported wherever this window can reach the host: the projector emits it
   * over the channel, the preview reports it locally. Handed the scene id and
   * the exception, never a German word.
   */
  onSceneFailure: (scene: string, error: unknown) => void;
}) {
  const scene = view.snapshot.scene.id;

  return (
    <ErrorBoundary
      resetKey={scene}
      onError={(error) => onSceneFailure(scene, error)}
      fallback={() => <BeamerHoldingScene />}
    >
      <BeamerPicture view={view} />
    </ErrorBoundary>
  );
}
