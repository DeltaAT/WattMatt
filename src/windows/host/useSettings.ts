import { useCallback, useSyncExternalStore } from 'react';

import { DEFAULT_SETTINGS } from '@/domain/factory';
import { isNamingAtEditable } from '@/domain/settings';
import type { ParticipantLabel, Settings, TableAssignmentOrder } from '@/domain/types';
import { setParticipantLabel } from '@/store/actions/groups';
import {
  setNamingAt,
  setPerformanceMode,
  setTableAssignmentOrder,
  setTournamentName,
} from '@/store/actions/settings';
import { tournamentStore } from '@/store/session';

/**
 * The host's settings controls, bound to the one store this window owns
 * (issue #15).
 *
 * Everything that decides anything lives in `@/domain/settings` and the actions
 * around it. What is left here is React: subscribing so a change made anywhere —
 * this panel, the participant control beside the field, an undo — redraws the
 * panel, and handing the components callbacks that keep their identity between
 * renders.
 */

export interface SettingsHandle {
  /** The tournament's name, which is not part of `settings` but is edited beside it. */
  name: string;
  settings: Settings;
  /** Shown read-only so a draw can be audited later (CLAUDE.md golden rule 7). */
  rngSeed: string;
  /** False from the naming phase on (`isNamingAtEditable`). */
  isNamingAtEditable: boolean;
  rename: (name: string) => void;
  setParticipant: (label: ParticipantLabel) => void;
  setNamingAt: (namingAt: number) => void;
  setPerformanceMode: (performanceMode: boolean) => void;
  setTableAssignmentOrder: (order: TableAssignmentOrder) => void;
}

export function useSettings(): SettingsHandle {
  // The document rather than the beamer's projection: the seed, the name and
  // the naming threshold are host-side, and the projection deliberately does
  // not carry them (docs/OPEN-QUESTIONS.md #19).
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  return {
    // The panel only renders with a tournament open; these defaults exist so a
    // click that arrives during a close has something to read rather than
    // throwing in front of the room.
    name: document?.name ?? '',
    settings: document?.settings ?? DEFAULT_SETTINGS,
    rngSeed: document?.rngSeed ?? '',
    isNamingAtEditable: document === null ? false : isNamingAtEditable(document),
    rename: useCallback((name: string) => setTournamentName(tournamentStore, name), []),
    setParticipant: useCallback(
      (label: ParticipantLabel) => setParticipantLabel(tournamentStore, label),
      [],
    ),
    setNamingAt: useCallback((namingAt: number) => setNamingAt(tournamentStore, namingAt), []),
    setPerformanceMode: useCallback(
      (performanceMode: boolean) => setPerformanceMode(tournamentStore, performanceMode),
      [],
    ),
    setTableAssignmentOrder: useCallback(
      (order: TableAssignmentOrder) => setTableAssignmentOrder(tournamentStore, order),
      [],
    ),
  };
}
