import { useCallback, useSyncExternalStore } from 'react';

import type { BeamerScene } from '@/domain/beamerScene';
import type { GroupId } from '@/domain/ids';
import { namingState, type NamingState } from '@/domain/naming';
import type { ParticipantLabel } from '@/domain/types';
import { setGroupName } from '@/store/actions/naming';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The naming list, bound to the one store this window owns (issue #23).
 *
 * Everything that decides anything lives in `@/domain/naming` and the action
 * around it. What is left here is React: subscribing so the list redraws when a
 * name lands — or when a round knocks half the field out from under it — and
 * handing the panel callbacks that keep their identity between renders.
 */

/** The holding picture the room is shown while the host types (§6). */
const NAMING_SCENE: BeamerScene = { id: 'NAMING' };

export interface NamingHandle {
  /**
   * Whether the host is being asked for names at all.
   *
   * False while the field is still larger than `settings.namingAt`, which is
   * most of the evening (docs/OPEN-QUESTIONS.md #63).
   */
  isActive: boolean;
  /** Null for the same case; the panel renders nothing from it. */
  state: NamingState | null;
  participant: ParticipantLabel;
  rename: (groupId: GroupId, name: string) => void;
  showOnBeamer: () => void;
}

export function useNaming(): NamingHandle {
  // The document rather than the beamer's projection: the naming threshold is
  // in `settings`, which the projection deliberately does not carry
  // (docs/OPEN-QUESTIONS.md #19).
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  const rename = useCallback(
    (groupId: GroupId, name: string) => setGroupName(tournamentStore, groupId, name),
    [],
  );
  const showOnBeamer = useCallback(() => showScene(tournamentStore, NAMING_SCENE), []);

  // Recomputed on every commit rather than memoised, for the reason
  // `@/domain/lookup` gives: the store commits whole new states, so a cached
  // list would be stale exactly when the host is typing into it.
  const state = document === null ? null : namingState(document);

  return {
    isActive: state !== null,
    state,
    participant: document?.settings.participantLabel ?? 'GROUP',
    rename,
    showOnBeamer,
  };
}
