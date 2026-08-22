import { createStore } from 'zustand/vanilla';

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

/** What a commit touched, reported to whoever is listening. */
export interface CommitMeta {
  /**
   * Whether the commit rewrote the tournament payload.
   *
   * Read from the keys the mutator returned rather than by comparing the old
   * and new state. A comparison would be reference equality, and an action that
   * mutated the tournament in place would look unchanged — sending the beamer
   * down the light channel and losing the data silently.
   */
  touchedTournament: boolean;
}

export type CommitListener = (state: TournamentState, meta: CommitMeta) => void;

/**
 * The host store's public handle.
 *
 * Deliberately narrower than zustand's `StoreApi`: there is no `setState`, so
 * "every mutation goes through an action" is something the type system enforces
 * rather than something a reviewer has to notice. Without this a component
 * could write state that never bumps the revision, and the central broadcast
 * would skip it without a sound.
 */
export interface TournamentStore {
  getState(): TournamentState;
  /** For React bindings via `useSyncExternalStore`. */
  subscribe(listener: (state: TournamentState) => void): () => void;
  /** For the sync and persistence layers, which need to know what changed. */
  onCommit(listener: CommitListener): () => void;
  commit(mutate: (state: TournamentState) => Partial<TournamentState>): void;
}

export function createTournamentStore(
  initial: TournamentState = INITIAL_TOURNAMENT_STATE,
): TournamentStore {
  const store = createStore<TournamentState>(() => ({ ...initial }));
  const listeners = new Set<CommitListener>();

  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    onCommit: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Applies one action and bumps the revision.
     *
     * The bump is the commit: everything downstream — broadcast, autosave, undo
     * — keys off it rather than off the individual fields, so a new action never
     * has to remember to notify anybody.
     *
     * A mutator that changes nothing still commits. "The host clicked and
     * nothing observable happened" is a bug report during an event; a redundant
     * snapshot is a few hundred KB.
     */
    commit: (mutate) => {
      const current = store.getState();
      const partial = mutate(current);
      const next: TournamentState = { ...current, ...partial, revision: current.revision + 1 };
      store.setState(next, true);

      const meta: CommitMeta = { touchedTournament: 'tournament' in partial };
      for (const listener of [...listeners]) {
        listener(next, meta);
      }
    },
  };
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
