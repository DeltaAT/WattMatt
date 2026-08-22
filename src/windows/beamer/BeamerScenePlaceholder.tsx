import type { BeamerScene } from '@/domain/beamerScene';
import { de } from '@/i18n';

/**
 * Draws whichever scene the host has staged.
 *
 * Issue #5 owns the channel, not the pictures: the scene components land with
 * issues #18, #19, #25 and #27. Until then every scene except idle and blackout
 * renders a placeholder — deliberately a real render of the *current* scene
 * rather than a blank, so the channel is visibly working end to end.
 *
 * `settled` is the part that matters for the audience: a beamer catching up
 * after being reopened must show the scene as it already is, never replay the
 * animation that first brought it there.
 */
export function BeamerScenePlaceholder({
  scene,
  settled,
}: {
  scene: BeamerScene;
  settled: boolean;
}) {
  if (scene.id === 'BLACKOUT') {
    // Nothing at all: the whole point of a blackout is an empty screen.
    return <div className="h-full w-full" data-scene="BLACKOUT" data-settled={settled} />;
  }

  if (scene.id === 'IDLE') {
    return (
      <div
        className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
        data-scene="IDLE"
        data-settled={settled}
      >
        <h1 className="wm-display text-beamer-h1">{de.beamer.idleTitle}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.idleNotice}</p>
      </div>
    );
  }

  return (
    <div
      className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
      data-scene={scene.id}
      data-settled={settled}
    >
      <h1 className="wm-display text-beamer-h1">{de.beamer.idleTitle}</h1>
      <p className="text-beamer-body text-wm-text-muted">{de.beamer.scenePending}</p>
    </div>
  );
}
