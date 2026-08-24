import { useCallback, useSyncExternalStore } from 'react';

import type { BeamerScene } from '@/domain/beamerScene';
import { hasStarted, isRemovable } from '@/domain/groups';
import type { GroupId } from '@/domain/ids';
import type { Group, ParticipantLabel } from '@/domain/types';
import { addGroups, removeGroup, setParticipantLabel } from '@/store/actions/groups';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The host's group controls, bound to the one store this window owns
 * (issue #14).
 *
 * Everything that decides anything lives in `@/domain/groups` and the actions
 * around it. What is left here is React: subscribing so the grid redraws when a
 * group is added, and handing the components callbacks that do not change
 * identity between renders — the grid holds 64 chips, and a new `onRemove` per
 * render would re-render every one of them on every keystroke elsewhere.
 */

const GROUP_OVERVIEW: BeamerScene = { id: 'GROUP_OVERVIEW' };

export interface GroupsHandle {
  /** Every participant, in the order they were created. */
  groups: readonly Group[];
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  /**
   * True once a round has been drawn. Adding a group is still allowed — the
   * host is in control — but they are warned first (docs/TOURNAMENT-RULES.md §3).
   */
  hasStarted: boolean;
  /** Whether this group can still be taken out (`isRemovable`). */
  canRemove: (groupId: GroupId) => boolean;
  add: (count: number) => void;
  remove: (groupId: GroupId) => void;
  setParticipant: (label: ParticipantLabel) => void;
  /** Puts the field of participants on the projector (`GROUP_OVERVIEW`). */
  showOnBeamer: () => void;
}

export function useGroups(): GroupsHandle {
  // The projection the beamer is sent, not the document: it already holds the
  // groups and the participant wording, and `commit` hands back the same
  // reference when neither changed — so this re-renders when the grid would
  // read differently and not on every beamer scene the host stages.
  const tournament = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().tournament,
  );

  // Read off the document rather than the snapshot: "has a round been drawn"
  // is not something the beamer needs, so the snapshot does not carry rounds.
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  return {
    groups: tournament.groups,
    participant: tournament.participantLabel,
    hasStarted: document !== null && hasStarted(document),
    canRemove: useCallback(
      (groupId: GroupId) => {
        const open = tournamentStore.getState().document;
        return open !== null && isRemovable(open, groupId);
      },
      // Rebuilt per document revision rather than kept for the window's life:
      // a group that was drawn a second ago must stop being removable, and the
      // chips would not re-read a callback that never changed identity.
      [document],
    ),
    add: useCallback((count: number) => addGroups(tournamentStore, count), []),
    remove: useCallback((groupId: GroupId) => removeGroup(tournamentStore, groupId), []),
    setParticipant: useCallback(
      (label: ParticipantLabel) => setParticipantLabel(tournamentStore, label),
      [],
    ),
    showOnBeamer: useCallback(() => showScene(tournamentStore, GROUP_OVERVIEW), []),
  };
}
