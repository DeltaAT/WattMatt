import { createStore } from 'zustand/vanilla';

import { IDLE_SCENE, type BeamerScene } from '@/domain/beamerScene';
import {
  EMPTY_TOURNAMENT,
  toTournamentSnapshot,
  type Snapshot,
  type TournamentSnapshot,
} from '@/domain/snapshot';
import type { Tournament } from '@/domain/types';

/**
 * The single source of truth, in the host window (docs/ARCHITECTURE.md §3).
 *
 * Components never write to it: every mutation goes through an action, and
 * every action goes through `commit`. That is what makes one central broadcast
 * and one central autosave possible instead of a call at each action site —
 * and it is where the undo stack hooks in at issue #11.
 */

/**
 * Where the open tournament lives, and whether the copy on disk is current.
 *
 * Kept beside the tournament rather than inside it: none of it belongs in the
 * `.wattmatt` file, and a file that recorded its own path would be wrong the
 * moment it was copied onto a USB stick.
 *
 * A union rather than `path` plus a `dirty` flag (CLAUDE.md §6): the pair can
 * express "clean, but never written", and a host trusting that combination
 * closes the window on a tournament that exists nowhere.
 */
export type FileState =
  /**
   * Never reached disk. Since a new tournament is written to the library as it
   * is created (issue #9), this only survives a first write that failed.
   */
  | { status: 'unsaved' }
  /** The file on disk is the tournament in memory. */
  | { status: 'saved'; path: string }
  /** On disk, but behind what the host has done since. */
  | { status: 'modified'; path: string };

export const UNSAVED_FILE: FileState = { status: 'unsaved' };

/** The path the tournament was last written to, if it has one. */
export function filePath(file: FileState): string | null {
  return file.status === 'unsaved' ? null : file.path;
}

export interface TournamentState {
  /**
   * Bumped by every commit. The beamer uses it to order messages; issue #10
   * uses it to know whether there is anything to autosave.
   */
  revision: number;
  /**
   * Bumped only by a commit that replaced the tournament itself.
   *
   * Separate from `revision` because a save has to know whether the *file* is
   * still current, and `revision` moves for things a file does not contain —
   * staging a beamer scene, taking manual control. Comparing `revision` would
   * leave a tournament marked unsaved because the host clicked a beamer button
   * while the bytes were in flight, and cost a redundant write and a rotation
   * every time they did (issue #10).
   */
  documentRevision: number;
  scene: BeamerScene;
  autoFollow: boolean;
  /**
   * The whole tournament the host owns — what gets written to disk. `null`
   * means no tournament is open and the host is looking at the start screen.
   *
   * Authoritative. `tournament` below is a projection of this, recomputed by
   * `commit`; no action writes the projection itself.
   */
  document: Tournament | null;
  file: FileState;
  /**
   * What the beamer is sent (docs/ARCHITECTURE.md §3). Derived from `document`,
   * never assigned by an action.
   */
  tournament: TournamentSnapshot;
}

export const INITIAL_TOURNAMENT_STATE: TournamentState = {
  revision: 0,
  documentRevision: 0,
  scene: IDLE_SCENE,
  autoFollow: true,
  document: null,
  file: UNSAVED_FILE,
  tournament: EMPTY_TOURNAMENT,
};

/** Whether the tournament in memory has moved on from the one on disk. */
export function hasUnsavedChanges(state: TournamentState): boolean {
  return state.document !== null && state.file.status !== 'saved';
}

/**
 * How a commit is to be treated by the layers listening to it.
 *
 * Passed by the action rather than inferred, because "this one must be on disk
 * before the next thing happens" is a statement about the tournament — closing
 * a round, changing phase — and nothing downstream can work that out from the
 * state alone (docs/FILE-FORMAT.md rule 4).
 */
export interface CommitOptions {
  /**
   * Skip the autosave debounce and write now.
   *
   * For the moments the host would not survive losing: a round closing, a phase
   * changing. Everything else waits the 500 ms, so a burst of clicks is one
   * write rather than ten.
   */
  urgent?: boolean;
}

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
  /** The action asked for an immediate save (see [`CommitOptions`]). */
  urgent: boolean;
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
  commit(
    mutate: (state: TournamentState) => Partial<TournamentState>,
    options?: CommitOptions,
  ): void;
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
    commit: (mutate, options) => {
      const current = store.getState();
      const partial = mutate(current);
      const next: TournamentState = { ...current, ...partial, revision: current.revision + 1 };

      // The beamer's copy is derived here, once, rather than by each action.
      // An action that changed the tournament and forgot to re-project it would
      // leave the projector a decision behind while the host screen looks
      // correct — the failure golden rule 4 exists to prevent.
      const touchedDocument = 'document' in partial;
      if (touchedDocument) {
        next.tournament = next.document ? toTournamentSnapshot(next.document) : EMPTY_TOURNAMENT;
        next.documentRevision = current.documentRevision + 1;
      }

      // Same reasoning for the dirty flag: an action that changed the
      // tournament without saying so would let the host close the window on
      // work that was never written. Only an action that decided the file
      // state itself — opening, saving, closing — is left alone.
      if (touchedDocument && !('file' in partial) && current.file.status !== 'unsaved') {
        next.file = { status: 'modified', path: current.file.path };
      }

      store.setState(next, true);

      const meta: CommitMeta = {
        touchedTournament: touchedDocument || 'tournament' in partial,
        urgent: options?.urgent === true,
      };
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
