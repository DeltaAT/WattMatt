import { useCallback, useSyncExternalStore } from 'react';

import {
  canStartRepechage,
  repechageBlockers,
  repechageState,
  type RepechageBlocker,
  type RepechageState,
} from '@/domain/repechage';
import { repechageOutlook } from '@/domain/round';
import type { Group, ParticipantLabel, RepechageFallback, Tournament } from '@/domain/types';
import {
  acceptRepechageCandidate,
  declineRepechageCandidate,
  drawRepechageCandidate,
  startRepechage,
  useRepechageFallback as commitFallback,
} from '@/store/actions/repechage';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The repechage panel, bound to the one store this window owns (issue #21).
 *
 * Everything that decides anything lives in `@/domain/repechage` and the
 * actions around it; what is left here is React — subscribing so the panel
 * redraws when a candidate is answered, and handing the panel callbacks that do
 * not change identity between renders.
 *
 * It subscribes to the whole document rather than to the beamer's projection,
 * like `useRound` and for the same reason: the panel needs the pot, the
 * declined and the blockers, and the snapshot deliberately carries only what a
 * scene draws (docs/OPEN-QUESTIONS.md #19).
 */

export interface RepechageHandle {
  /**
   * Whether the host has anything to do with the `Hoffnungsrunde` right now.
   *
   * False for the whole of a tournament that skips the phase — which is the
   * common case — so the panel is simply not on the screen rather than being on
   * it saying that it does not apply. That is issue #21's third acceptance
   * criterion, "the phase is skipped invisibly", on the host side; the beamer
   * half is that no `REPECHAGE` scene is ever staged.
   */
  isActive: boolean;
  /** The running phase, or null before it is started. */
  state: RepechageState | null;
  /** The target the phase is aiming at, known from the moment §4 is reached. */
  target: number | null;

  blockers: readonly RepechageBlocker[];
  canStart: boolean;
  /** A candidate may be drawn: nobody is pending and the pot is not empty. */
  canDraw: boolean;

  /** For the names — the panel resolves ids to what the host calls them. */
  groups: readonly Group[];
  participant: ParticipantLabel;

  start: () => void;
  drawCandidate: () => void;
  accept: () => void;
  decline: () => void;
  useFallback: (choice: RepechageFallback) => void;
  /** Puts the pot back on the projector (`REPECHAGE`). */
  showOnBeamer: () => void;
}

/** What a window with no tournament open reads: there is no repechage. */
const NO_REPECHAGE = {
  isActive: false,
  state: null,
  target: null,
  blockers: [],
  canStart: false,
  canDraw: false,
  groups: [],
  participant: 'GROUP',
} as const;

export function useRepechage(): RepechageHandle {
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  const start = useCallback(() => startRepechage(tournamentStore), []);
  const drawCandidate = useCallback(() => drawRepechageCandidate(tournamentStore), []);
  const accept = useCallback(() => acceptRepechageCandidate(tournamentStore), []);
  const decline = useCallback(() => declineRepechageCandidate(tournamentStore), []);
  const useFallback = useCallback(
    (choice: RepechageFallback) => commitFallback(tournamentStore, choice),
    [],
  );
  const showOnBeamer = useCallback(() => showScene(tournamentStore, { id: 'REPECHAGE' }), []);

  const actions = { start, drawCandidate, accept, decline, useFallback, showOnBeamer };

  if (document === null) {
    return { ...NO_REPECHAGE, ...actions };
  }

  const state = repechageState(document);
  const blockers = repechageBlockers(document);

  return {
    // Either it is running, or it can be started right now. Anything else — a
    // qualifying round still open, a field that is already a power of two — is
    // not a panel the host has any use for.
    isActive: state !== null || blockers.length === 0,
    state,
    target: state?.target ?? outlookTarget(document),
    blockers,
    canStart: canStartRepechage(document),
    // The engine refuses both of these as well; the button being disabled is
    // what keeps the host from finding that out in front of the room.
    canDraw: state !== null && state.pending === null && state.pool.length > 0 && state.need > 0,
    groups: document.groups,
    participant: document.settings.participantLabel,
    ...actions,
  };
}

/**
 * The target before the phase has been started.
 *
 * Read off the qualifying round, which knows it from the moment it was drawn:
 * every match yields exactly one winner, so `|W|` — and with it the power of
 * two the bracket needs — is fixed by the pairings and not by the results
 * (`repechageOutlook`). The host therefore reads the same number before and
 * after they press the button.
 */
function outlookTarget(document: Tournament): number | null {
  const qualifying = document.rounds.find((round) => round.kind === 'QUALIFYING');
  return qualifying === undefined ? null : (repechageOutlook(qualifying)?.target ?? null);
}
