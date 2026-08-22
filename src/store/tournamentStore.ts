import { createStore, type StoreApi } from 'zustand/vanilla';

import { IDLE_SCENE, type BeamerScene } from '@/domain/beamerScene';
import { EMPTY_TOURNAMENT, type Snapshot, type TournamentSnapshot } from '@/domain/snapshot';

/**
 * The single source of truth, in the host window (docs/ARCHITECTURE.md §3).
 *
 * Components never write to it: every mutation goes through an action, and
 * every action goes through `commit`. That is what makes one central broadcast
 * and one central autosave possible instead of a call at each action site —
 * and it is where the undo stack hooks in at issue #11.
 */

export interface TournamentState {
  /**
   * Bumped by every commit. The beamer uses it to order messages; issue #10
   * uses it to know whether there is anything to autosave.
   */
  revision: number;
  scene: BeamerScene;
  autoFollow: boolean;
  tournament: TournamentSnapshot;
}

export const INITIAL_TOURNAMENT_STATE: TournamentState = {
  revision: 0,
  scene: IDLE_SCENE,
  autoFollow: true,
  tournament: EMPTY_TOURNAMENT,
};

export type TournamentStore = StoreApi<TournamentState>;

export function createTournamentStore(
  initial: TournamentState = INITIAL_TOURNAMENT_STATE,
): TournamentStore {
  return createStore<TournamentState>(() => ({ ...initial }));
}

/**
 * Applies one action and bumps the revision.
 *
 * The revision bump is the commit: everything downstream — broadcast, autosave,
 * undo — keys off it rather than off the individual fields, so a new action
 * never has to remember to notify anybody.
 *
 * A mutator that changes nothing still commits. "The host clicked and nothing
 * observable happened" is a bug report during an event; a redundant snapshot is
 * a few hundred KB.
 */
export function commit(
  store: TournamentStore,
  mutate: (state: TournamentState) => Partial<TournamentState>,
): void {
  const current = store.getState();
  store.setState({ ...current, ...mutate(current), revision: current.revision + 1 });
}

/** The snapshot that describes the store right now. */
export function toSnapshot(
  state: TournamentState,
  delivery: Snapshot['delivery'] = 'live',
): Snapshot {
  return {
    revision: state.revision,
    scene: state.scene,
    autoFollow: state.autoFollow,
    tournament: state.tournament,
    delivery,
  };
}
