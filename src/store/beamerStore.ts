import { createStore, type StoreApi } from 'zustand/vanilla';

import { isSameScene } from '@/domain/beamerScene';
import { INITIAL_SNAPSHOT, supersedes, type Snapshot } from '@/domain/snapshot';

/**
 * The beamer's local copy of the picture (CLAUDE.md golden rule 4).
 *
 * It exists purely so React has something to render. Nothing in the beamer
 * window may write to it except the sync layer applying what the host sent, and
 * the module exports no way to do so: there is no `setState` on the returned
 * handle, only `applySnapshot`.
 */

export interface BeamerViewState {
  snapshot: Snapshot;
  /**
   * Whether the current scene should animate in.
   *
   * False when the beamer is catching up after being reopened: the audience
   * must see the scene as it already is, not watch the draw play out a second
   * time (issue #5 acceptance criteria). False again when the same scene is
   * re-delivered, so a reconnect does not restart an animation mid-event.
   */
  animate: boolean;
}

export const INITIAL_BEAMER_VIEW: BeamerViewState = {
  snapshot: INITIAL_SNAPSHOT,
  animate: false,
};

export interface BeamerStore {
  getState(): BeamerViewState;
  subscribe(listener: (state: BeamerViewState) => void): () => void;
  /** The only way in. Called by the sync layer, never by a component. */
  applySnapshot(incoming: Snapshot): void;
}

/**
 * Recursively freezes a snapshot.
 *
 * In development a stray `snapshot.tournament.groups.push(...)` in a scene
 * component then throws at the point of the mistake instead of quietly making
 * the beamer disagree with the host — which during an event is the failure
 * nobody would think to look for.
 */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function createBeamerStore(
  initial: BeamerViewState = INITIAL_BEAMER_VIEW,
  { freeze = import.meta.env.DEV }: { freeze?: boolean } = {},
): BeamerStore {
  const guard = freeze ? deepFreeze : <T>(value: T) => value;
  const store: StoreApi<BeamerViewState> = createStore<BeamerViewState>(() =>
    guard({ ...initial }),
  );

  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    applySnapshot: (incoming) => {
      const current = store.getState();
      // A snapshot that lost a race would walk the beamer backwards.
      if (!supersedes(incoming, current.snapshot)) {
        return;
      }
      const sameScene = isSameScene(incoming.scene, current.snapshot.scene);

      // `replace` matters: a merging setState would build a fresh, unfrozen
      // object and quietly undo the read-only guarantee.
      const write = (animate: boolean) => {
        store.setState(guard({ snapshot: incoming, animate }), true);
      };

      // The same revision arriving twice is a re-delivery, not a change: React
      // StrictMode mounts the beamer twice and so asks for a catch-up twice.
      // Recomputing `animate` for it would settle a scene that is still
      // animating, in front of the audience.
      if (incoming.revision === current.snapshot.revision && sameScene) {
        write(current.animate);
        return;
      }

      write(incoming.delivery === 'live' && !sameScene);
    },
  };
}
