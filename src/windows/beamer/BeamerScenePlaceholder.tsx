import type { BeamerScene } from '@/domain/beamerScene';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { TableOverviewScene } from '@/windows/beamer/scenes';

/**
 * Draws whichever scene the host has staged.
 *
 * Issue #5 owns the channel, not the pictures. `TABLE_OVERVIEW` is drawn for
 * real (issue #13); the rest land with issues #18, #19, #25 and #27, and until
 * then render a placeholder — deliberately a real render of the *current*
 * scene rather than a blank, so the channel is visibly working end to end.
 *
 * `settled` is the part that matters for the audience: a beamer catching up
 * after being reopened must show the scene as it already is, never replay the
 * animation that first brought it there.
 */
export function BeamerScenePlaceholder({
  scene,
  tournament,
  settled,
}: {
  scene: BeamerScene;
  /** What the host last sent. Every real scene draws from this and nothing else. */
  tournament: TournamentSnapshot;
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

  if (scene.id === 'TABLE_OVERVIEW') {
    return <TableOverviewScene tournament={tournament} settled={settled} />;
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
