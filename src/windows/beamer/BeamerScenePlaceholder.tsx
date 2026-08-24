import type { BeamerScene } from '@/domain/beamerScene';
import type { RoundId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { DrawScene, GroupOverviewScene, TableOverviewScene } from '@/windows/beamer/scenes';
import { useDrawSequence } from '@/windows/beamer/useDrawSequence';
import { useSkipKey } from '@/windows/beamer/useSkipKey';

/**
 * Draws whichever scene the host has staged.
 *
 * Issue #5 owns the channel, not the pictures. `TABLE_OVERVIEW` (issue #13) and
 * `GROUP_OVERVIEW` (issue #14) are drawn for real; the rest land with issues
 * #18, #19, #25 and #27, and until then render a placeholder — deliberately a
 * real render of the *current* scene rather than a blank, so the channel is
 * visibly working end to end.
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

  if (scene.id === 'GROUP_OVERVIEW') {
    return <GroupOverviewScene tournament={tournament} settled={settled} />;
  }

  if (scene.id === 'TABLE_OVERVIEW') {
    return <TableOverviewScene tournament={tournament} settled={settled} />;
  }

  if (scene.id === 'DRAW') {
    /*
     * The scene descriptor names a round; the snapshot carries one. They can
     * disagree for a moment — a `DRAW` scene left staged while the host draws
     * the next round — and animating whatever arrived would replay the sequence
     * against pairings the audience has already watched. When they disagree the
     * board is shown settled, which is the honest picture: this is the round
     * that exists, and nothing is being drawn right now.
     */
    const isStagedRound = tournament.round?.id === scene.roundId;
    return (
      <DrawSceneHost
        tournament={tournament}
        settled={settled || !isStagedRound}
        roundId={scene.roundId}
      />
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

/**
 * Binds the draw scene to its timeline.
 *
 * A component of its own because the hooks must not sit behind the early
 * returns above — and because it keeps `DrawScene` a pure function of `step`,
 * which is what lets the board be tested at any point of the sequence without
 * a timer.
 */
function DrawSceneHost({
  tournament,
  settled,
  roundId,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  roundId: RoundId;
}) {
  const sequence = useDrawSequence({
    roundId,
    pairings: tournament.matches.length,
    settled,
    performanceMode: tournament.performanceMode,
  });

  useSkipKey(sequence.skip, !sequence.isComplete);

  return (
    <DrawScene
      tournament={tournament}
      step={sequence.step}
      // Not the raw `settled`: that goes true on any commit which leaves the
      // draw staged, and the sequence must carry on through those.
      settled={sequence.startedSettled}
    />
  );
}
