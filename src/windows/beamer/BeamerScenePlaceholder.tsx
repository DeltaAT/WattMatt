import type { BeamerScene } from '@/domain/beamerScene';
import type { RoundId } from '@/domain/ids';
import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import {
  DrawScene,
  GroupOverviewScene,
  RepechageScene,
  RoundBoardScene,
  TableOverviewScene,
} from '@/windows/beamer/scenes';
import { useDrawSequence } from '@/windows/beamer/useDrawSequence';
import { useRepechageBeat } from '@/windows/beamer/useRepechageBeat';
import { useSkipKey } from '@/windows/beamer/useSkipKey';

/**
 * Draws whichever scene the host has staged.
 *
 * Issue #5 owns the channel, not the pictures. `TABLE_OVERVIEW` (#13),
 * `GROUP_OVERVIEW` (#14), `DRAW` (#18), `ROUND_BOARD` (#19) and `REPECHAGE`
 * (#21) are drawn for real; `BRACKET` and `CEREMONY` land with issues #25 and
 * #27, and until then render a placeholder — deliberately a real render of the
 * *current* scene rather than a blank, so the channel is visibly working end to
 * end.
 *
 * `settled` is the part that matters for the audience: a beamer catching up
 * after being reopened must show the scene as it already is, never replay the
 * animation that first brought it there.
 */
export function BeamerScenePlaceholder({
  scene,
  tournament,
  settled,
  delivery,
}: {
  scene: BeamerScene;
  /** What the host last sent. Every real scene draws from this and nothing else. */
  tournament: TournamentSnapshot;
  settled: boolean;
  /**
   * Why this snapshot was sent (issue #21).
   *
   * `settled` cannot stand in for it. It is computed per *scene* — false only
   * while a new one is animating in — so it says nothing about a change that
   * happens inside a scene that is already up, which is every beat of the
   * `Hoffnungsrunde`. `delivery` is the raw fact: `catchUp` for a reopened
   * beamer and for an undo (issue #11), `live` for a decision the room is
   * watching being taken.
   */
  delivery: SnapshotDelivery;
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

  if (scene.id === 'ROUND_BOARD') {
    /*
     * Same guard as `DRAW` below: the descriptor names a round and the snapshot
     * carries one, and they can disagree for a moment. Drawing whatever arrived
     * would put the *next* round's pairings under the previous round's heading
     * — so a mismatch renders the board empty rather than confidently wrong.
     */
    const staged = tournament.round?.id === scene.roundId;
    return (
      <RoundBoardScene
        tournament={staged ? tournament : { ...tournament, matches: [], round: null }}
        settled={settled}
      />
    );
  }

  if (scene.id === 'REPECHAGE') {
    /*
     * No guard against the snapshot, unlike the two scenes below: the
     * descriptor names nothing to disagree with, and a tournament has exactly
     * one repechage. When there is none the scene says so itself — which is a
     * state the host can reach by staging the scene by hand before starting the
     * phase, and one the room must be able to read rather than stare at.
     */
    return <RepechageSceneHost tournament={tournament} delivery={delivery} />;
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
 * Binds the repechage scene to the beat this window is allowed to play.
 *
 * A component of its own for the same reason `DrawSceneHost` is: the hook must
 * not sit behind the early returns above, and keeping it out here leaves
 * `RepechageScene` a pure function of the snapshot and one group id — which is
 * what lets every beat be rendered in a test without a store or a timer.
 */
function RepechageSceneHost({
  tournament,
  delivery,
}: {
  tournament: TournamentSnapshot;
  delivery: SnapshotDelivery;
}) {
  const beat = useRepechageBeat(tournament.repechage?.last ?? null, delivery);

  return <RepechageScene tournament={tournament} beat={beat} />;
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
