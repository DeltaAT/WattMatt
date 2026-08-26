import {
  BLACKOUT_SCENE,
  IDLE_SCENE,
  type BeamerScene,
  type BeamerSceneId,
} from '@/domain/beamerScene';
import { currentRound } from '@/domain/selectors';
import type { Round, Tournament } from '@/domain/types';

/**
 * Every picture the host can put on the projector, and the one the tournament
 * implies (issue #28, docs/ARCHITECTURE.md §3 "Beamer scene model").
 *
 * Pure, and deliberately not part of the control panel: what a phase implies
 * and which descriptors exist are tournament facts, and both are needed in two
 * places — the switcher the host clicks and the `autoFollow` rule that stages a
 * scene without them. A second answer living in a component would eventually
 * disagree with this one, and the disagreement would surface as a projector
 * showing the wrong half of the evening.
 */

/**
 * The round the host means when they say "the round".
 *
 * The open one while there is one, and otherwise the most recent — a host
 * pointing the room back at *Runde 3* between rounds is pointing at the round
 * that just finished, not at nothing.
 */
export function stagedRound(tournament: Tournament): Round | null {
  return currentRound(tournament) ?? tournament.rounds.at(-1) ?? null;
}

/**
 * The picture the tournament's own phase implies.
 *
 * This is the whole of `autoFollow`: while it is on, a phase step stages this
 * scene, and while it is off nothing here is consulted at all (golden rule 3).
 * It is asked **only at a phase boundary** — a moment the host reached by
 * pressing the step button themselves — which is what keeps auto-follow from
 * yanking the screen away mid-explanation. Inside a phase the picture belongs
 * to whoever staged it: the draw stages its own sequence, and a host who put
 * the tree on the wall to talk about it keeps it there while results land.
 *
 * `SETUP` is `IDLE` rather than the field of participants: before the doors
 * open the host is working in a lit room, and a projector that switched itself
 * on because a tournament was created would be a surprise, not a service.
 */
export function sceneForPhase(tournament: Tournament): BeamerScene {
  switch (tournament.phase) {
    case 'SETUP':
      return IDLE_SCENE;
    case 'QUALIFYING':
    case 'ELIMINATION': {
      // The board, not the draw: the draw is a sequence the draw action stages
      // as it happens, and replaying it because a phase changed would show the
      // room pairings being dealt that were dealt twenty minutes ago.
      const round = stagedRound(tournament);
      return round === null ? IDLE_SCENE : { id: 'ROUND_BOARD', roundId: round.id };
    }
    case 'REPECHAGE':
      return { id: 'REPECHAGE' };
    case 'NAMING':
      return { id: 'NAMING' };
    case 'BRACKET':
      return { id: 'BRACKET' };
    case 'CEREMONY':
      return { id: 'CEREMONY' };
  }
}

/**
 * The order the switcher lists scenes in, which is the order of the evening.
 *
 * Fixed rather than filtered to what is reachable right now, because the
 * position **is** the keyboard shortcut: `4` has to be the draw at nine o'clock
 * as well as at eight, or the host's hands learn a layout that moves under them
 * (issue #28, "no shortcut collides with a text input" is the other half of the
 * same requirement).
 *
 * `BLACKOUT` is deliberately absent. It is not one picture among ten — it is
 * the panic button, and it gets a control of its own that is always in the same
 * place (docs/MOTION.md §4.6).
 */
export const SCENE_ORDER: readonly BeamerSceneId[] = [
  'IDLE',
  'GROUP_OVERVIEW',
  'TABLE_OVERVIEW',
  'DRAW',
  'ROUND_BOARD',
  'REPECHAGE',
  'NAMING',
  'BRACKET',
  'CEREMONY',
];

/** One entry of the switcher. */
export interface SceneChoice {
  id: BeamerSceneId;
  /**
   * The descriptor this entry would stage, or `null` when the tournament
   * cannot currently produce one.
   *
   * Only ever null for the two scenes that name a round: a `DRAW` without a
   * round is not a scene the host is being denied, it is a scene that does not
   * exist yet. Everything else is reachable in every phase, which is the
   * issue's first acceptance criterion — a scene that reads "noch nichts
   * ausgelost" is still the honest picture and the host may want it on the wall.
   */
  scene: BeamerScene | null;
  /** The digit that stages it: 1…9, matching the position in `SCENE_ORDER`. */
  shortcut: number;
}

/**
 * The switcher, for the tournament as it stands.
 *
 * Takes the whole tournament rather than a snapshot because it has to read the
 * round ids, and `null` because the beamer column is present before a
 * tournament is open too (CLAUDE.md golden rule 3).
 */
export function sceneChoices(tournament: Tournament | null): readonly SceneChoice[] {
  const round = tournament === null ? null : stagedRound(tournament);

  return SCENE_ORDER.map((id, index) => ({
    id,
    scene: sceneFor(id, round),
    shortcut: index + 1,
  }));
}

/** The scene at one position, or null when it needs a round and there is none. */
function sceneFor(id: BeamerSceneId, round: Round | null): BeamerScene | null {
  switch (id) {
    // The two that name a round, and the only two that can be unavailable.
    case 'DRAW':
      return round === null ? null : { id: 'DRAW', roundId: round.id };
    case 'ROUND_BOARD':
      return round === null ? null : { id: 'ROUND_BOARD', roundId: round.id };
    case 'IDLE':
      return IDLE_SCENE;
    case 'BLACKOUT':
      return BLACKOUT_SCENE;
    case 'GROUP_OVERVIEW':
      return { id: 'GROUP_OVERVIEW' };
    case 'TABLE_OVERVIEW':
      return { id: 'TABLE_OVERVIEW' };
    case 'REPECHAGE':
      return { id: 'REPECHAGE' };
    case 'NAMING':
      return { id: 'NAMING' };
    // Both carry an optional field, and neither is set from the switcher: the
    // whole tree and a ceremony nobody has started revealing yet.
    case 'BRACKET':
      return { id: 'BRACKET' };
    case 'CEREMONY':
      return { id: 'CEREMONY' };
  }
}
