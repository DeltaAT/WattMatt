import type { BeamerScene } from '@/domain/beamerScene';
import type { RoundId } from '@/domain/ids';
import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import type { BracketRound } from '@/domain/types';
import { de } from '@/i18n';
import {
  BracketScene,
  DrawScene,
  GroupOverviewScene,
  NamingScene,
  RepechageScene,
  RoundBoardScene,
  TableOverviewScene,
  CeremonySceneHost,
  WelcomeScene,
} from '@/windows/beamer/scenes';
import { useBracketAdvance } from '@/windows/beamer/useBracketAdvance';
import { useDrawSequence } from '@/windows/beamer/useDrawSequence';
import { useRepechageBeat } from '@/windows/beamer/useRepechageBeat';
import { useRepechageTravel } from '@/windows/beamer/useRepechageTravel';
import { useSkipKey } from '@/windows/beamer/useSkipKey';
import { useSkipSignal } from '@/windows/beamer/useSkipSignal';

/**
 * Draws whichever scene the host has staged.
 *
 * Issue #5 owns the channel, not the pictures. `TABLE_OVERVIEW` (#13),
 * `GROUP_OVERVIEW` (#14), `DRAW` (#18), `ROUND_BOARD` (#19), `REPECHAGE` (#21)
 * `NAMING` (#23) and `BRACKET` (#25) are drawn for real; `CEREMONY` lands with
 * issue #27, and until then renders a placeholder — deliberately a real render of the
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
  skipToken,
}: {
  scene: BeamerScene;
  /** What the host last sent. Every real scene draws from this and nothing else. */
  tournament: TournamentSnapshot;
  settled: boolean;
  /**
   * How many times the host has asked for the running sequence to be skipped
   * (issue #28). Two scenes have something to skip — the `Auslosung`'s reveal
   * and the `Hoffnungsrunde`'s travelling highlight (issue #89); the rest
   * ignore it.
   */
  skipToken: number;
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

  if (scene.id === 'WELCOME') {
    /*
     * The picture of the whole setup phase (issue #74). Like `NAMING` it needs
     * no guard against the snapshot: what it draws is the tournament's name and
     * how many are registered, and a descriptor that names nothing cannot
     * disagree with either. `delivery` is what keeps the count from ticking at
     * a beamer that has only just been handed it.
     */
    return <WelcomeScene tournament={tournament} settled={settled} delivery={delivery} />;
  }

  if (scene.id === 'GROUP_OVERVIEW') {
    return <GroupOverviewScene tournament={tournament} settled={settled} />;
  }

  if (scene.id === 'TABLE_OVERVIEW') {
    return <TableOverviewScene tournament={tournament} settled={settled} />;
  }

  if (scene.id === 'NAMING') {
    /*
     * The holding picture of issue #23. It draws from the snapshot like every
     * other scene, and needs no guard against it: what it shows is the
     * tournament's name and how many are through, and neither can disagree with
     * a descriptor that names nothing.
     */
    return <NamingScene tournament={tournament} settled={settled} />;
  }

  if (scene.id === 'ROUND_BOARD') {
    /*
     * The descriptor names a round, and the board is drawn from exactly that
     * one — the open round when it is the open round, otherwise the closed
     * round of that id out of the history the snapshot carries (issue #22).
     * Without the second case, pointing the projector back at *Runde 2* while
     * *Runde 3* is running would show the room an empty board.
     *
     * An id that names neither still renders empty rather than confidently
     * wrong: an undo can take a round away while the scene is still staged
     * against it, and the *next* round's pairings under the previous round's
     * heading is the one picture that must never appear.
     */
    /*
     * And both tracks at once when the host has asked for it and there are two
     * to show (issue #79). The flag is the host's decision and nothing else's
     * (golden rule 3), but a split of one board is not a split — so a scene
     * left staged as split after the side event closed falls back to the single
     * board rather than putting an empty half on the wall.
     */
    if (scene.split === true && tournament.consolationRound !== null) {
      return <SplitRoundBoard tournament={tournament} settled={settled} delivery={delivery} />;
    }

    return (
      <RoundBoardScene
        tournament={stageRound(tournament, scene.roundId)}
        settled={settled}
        // A board that is catching up shows its results rather than replaying
        // them (issue #29) — the same rule the bracket and the repechage follow.
        delivery={delivery}
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
    return <RepechageSceneHost tournament={tournament} delivery={delivery} skipToken={skipToken} />;
  }

  if (scene.id === 'BRACKET') {
    /*
     * No guard against the snapshot, like the `Hoffnungsrunde` and unlike the
     * two scenes below: the descriptor names nothing that could disagree with
     * it, and a tournament has exactly one bracket. Before it is drawn the
     * scene says so itself — a state the host can reach by staging the tree
     * before the final phase, and one the room must be able to read.
     */
    return (
      <BracketSceneHost
        tournament={tournament}
        settled={settled}
        delivery={delivery}
        focus={scene.focus ?? null}
      />
    );
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
    // Either track's open round counts as staged, and the snapshot is staged to
    // it: a `DRAW` scene pointed at the `Trostrunde` has to animate the
    // pairings the room is watching being dealt, not the main field's under the
    // side event's heading (issue #73, §10).
    const isStagedRound =
      tournament.round?.id === scene.roundId || tournament.consolationRound?.id === scene.roundId;
    return (
      <DrawSceneHost
        tournament={stageRound(tournament, scene.roundId)}
        settled={settled || !isStagedRound}
        roundId={scene.roundId}
        skipToken={skipToken}
      />
    );
  }

  if (scene.id === 'CEREMONY') {
    return (
      <CeremonySceneHost
        tournament={tournament}
        settled={settled}
        delivery={delivery}
        sceneReveal={scene.reveal}
      />
    );
  }

  return (
    <div
      className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
      data-scene={(scene as { id: string }).id}
      data-settled={settled}
    >
      <h1 className="wm-display text-beamer-h1">{de.beamer.idleTitle}</h1>
      <p className="text-beamer-body text-wm-text-muted">{de.beamer.scenePending}</p>
    </div>
  );
}

/**
 * Both tracks side by side (issue #79, docs/TOURNAMENT-RULES.md §10).
 *
 * Two boards rather than one board of everything, because they are two
 * tournaments: the pairings, the queue and the progress count are each per
 * track, and a merged board would tell the room a `Trostrunde` pair is one
 * result away from the bracket.
 *
 * Each half is the same `RoundBoardScene` the whole wall shows, handed a
 * snapshot staged to its own round — so a split half and a full board cannot
 * disagree about what a round looks like, and every rule the board already
 * follows (the result flip, the fit-to-stage, the reserved-table marker) comes
 * with it for free.
 *
 * `min-w-0` on both halves is load-bearing: a grid track's minimum is `auto`,
 * so without it a wide board would push the other one off the stage instead of
 * scaling inside its own half (`fit.ts` makes the same point about columns).
 */
function SplitRoundBoard({
  tournament,
  settled,
  delivery,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  delivery: SnapshotDelivery;
}) {
  return (
    <div className="grid h-full grid-cols-2 gap-6" data-scene-split="">
      <div className="min-w-0" data-split-track="MAIN">
        <RoundBoardScene tournament={tournament} settled={settled} delivery={delivery} />
      </div>
      <div className="min-w-0" data-split-track="CONSOLATION">
        <RoundBoardScene
          tournament={{
            ...tournament,
            matches: tournament.consolationMatches,
            round: tournament.consolationRound,
          }}
          settled={settled}
          delivery={delivery}
        />
      </div>
    </div>
  );
}

/**
 * The snapshot as the `ROUND_BOARD` scene should read it: `round` and `matches`
 * are the round the descriptor names, whichever round that is.
 *
 * The scene draws `tournament.round` and `tournament.matches` and nothing else,
 * so a past round is shown by handing it a snapshot whose open round is that
 * one. Cheaper than teaching the scene about the history, and it keeps
 * `RoundBoardScene` a pure function of one round — which is what lets a closed
 * round and a live one be tested through the same component.
 *
 * Three places to look since issue #73, not two: the open main-field round, the
 * open `Trostrunde` round, and the closed rounds of both. That is the whole of
 * "the beamer can show either track" — the host stages a round id, and the
 * projector finds it wherever it lives (docs/TOURNAMENT-RULES.md §10). Which
 * picture the room sees stays the host's decision and nothing else's
 * (CLAUDE.md golden rule 3).
 */
function stageRound(tournament: TournamentSnapshot, roundId: RoundId): TournamentSnapshot {
  if (tournament.round?.id === roundId) {
    return tournament;
  }
  if (tournament.consolationRound?.id === roundId) {
    return {
      ...tournament,
      matches: tournament.consolationMatches,
      round: tournament.consolationRound,
    };
  }

  const past = tournament.history.find((round) => round.id === roundId);
  if (past === undefined) {
    return { ...tournament, matches: [], round: null };
  }

  const { matches, ...withoutMatches } = past;
  return { ...tournament, matches, round: withoutMatches };
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
  skipToken,
}: {
  tournament: TournamentSnapshot;
  delivery: SnapshotDelivery;
  skipToken: number;
}) {
  const repechage = tournament.repechage;
  const beat = useRepechageBeat(repechage?.last ?? null, delivery);

  /*
   * The travel runs for a *draw* and for nothing else (issue #89). An accept
   * and a decline are answers to a question the room has already been asked,
   * and sending a light back out across the pot for one would say a second
   * candidate had been picked.
   */
  const drawn = beat !== null && repechage?.last?.accepted === null ? beat : null;

  /*
   * The cards the light may visit: everybody the draw could still have landed
   * on. Cards that are already through or already out are settled pictures, and
   * a highlight passing over one would suggest it was back in play.
   */
  const candidates = (repechage?.pot ?? [])
    .filter((entry) => entry.status === 'POOL' || entry.status === 'DRAWN')
    .map((entry) => entry.groupId);

  const travel = useRepechageTravel({
    drawn,
    candidates,
    performanceMode: tournament.performanceMode,
  });

  // Two ways in, one skip — the same pair the draw has (issue #28). The key
  // covers a beamer window the host has clicked into; the token covers the
  // ordinary case, where they are on the laptop and the projector has no focus
  // at all (docs/OPEN-QUESTIONS.md #53).
  useSkipKey(travel.skip, travel.isTravelling);
  useSkipSignal(skipToken, travel.skip, travel.isTravelling);

  return <RepechageScene tournament={tournament} beat={beat} travel={travel} />;
}

/**
 * Binds the bracket scene to the chips this window is allowed to move.
 *
 * A component of its own for the same reason `RepechageSceneHost` is: the hook
 * must not sit behind the early returns above, and keeping it out here leaves
 * `BracketScene` a pure function of one snapshot — which is what lets every
 * state of the tree be rendered in a test without a browser that can measure
 * anything.
 */
function BracketSceneHost({
  tournament,
  settled,
  delivery,
  focus,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  delivery: SnapshotDelivery;
  focus: BracketRound | null;
}) {
  const advance = useBracketAdvance(tournament.bracket, delivery);

  return <BracketScene tournament={tournament} settled={settled} focus={focus} advance={advance} />;
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
  skipToken,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  roundId: RoundId;
  skipToken: number;
}) {
  const sequence = useDrawSequence({
    roundId,
    pairings: tournament.matches.length,
    settled,
    performanceMode: tournament.performanceMode,
  });

  // Two ways in, one skip. The key covers a beamer window the host has clicked
  // into; the token covers the ordinary case, where they are on the laptop and
  // the projector has no focus at all (docs/OPEN-QUESTIONS.md #53).
  useSkipKey(sequence.skip, !sequence.isComplete);
  useSkipSignal(skipToken, sequence.skip, !sequence.isComplete);

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
