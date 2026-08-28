import { useCallback, useSyncExternalStore } from 'react';

import type { RoundId } from '@/domain/ids';
import { phaseStep, type PhaseStep } from '@/domain/progression';
import { roundHistory, type RoundRecord } from '@/domain/round';
import { isTrackRunning, trackState } from '@/domain/track';
import type { Group, ParticipantLabel, Phase, RoundTrack } from '@/domain/types';
import { advancePhase } from '@/store/actions/progression';
import { showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The phase panel and the round history, bound to the one store this window
 * owns (issue #22).
 *
 * Everything that decides anything lives in `@/domain/progression` and the action
 * around it; what is left here is React — subscribing so the panel redraws when
 * a round closes, and handing the panel callbacks that do not change identity
 * between renders.
 *
 * One hook for both, because they are one screen: the history is what the host
 * reads while deciding whether to press the step, and the step is what the
 * history is a record of.
 */

export interface PhaseHandle {
  /**
   * Whether the host has a phase to look at.
   *
   * False during `SETUP`, where the pre-start panel is the whole story and a
   * second panel saying the tournament has not started is a panel in the way.
   */
  isActive: boolean;
  /** Where the tournament stands, for the header. */
  phase: Phase;
  /** The one step out of it, or null once issues #23 and #24 take over. */
  step: PhaseStep | null;
  /** Every round of the evening, oldest first. */
  history: readonly RoundRecord[];
  /** For the pairings — the panel resolves ids to what the host calls them. */
  groups: readonly Group[];
  participant: ParticipantLabel;

  advance: () => void;
  /** Puts one round of the history back on the projector (`ROUND_BOARD`). */
  showRoundOnBeamer: (roundId: RoundId) => void;
}

/** What a window with no tournament open reads: there is no phase. */
const NO_PHASE = {
  isActive: false,
  phase: 'SETUP',
  step: null,
  history: [],
  groups: [],
  participant: 'GROUP',
} as const;

/**
 * @param track Which of the two tournaments this panel steps (issue #91).
 *
 * The `Trostrunde` runs the same pipeline on its own field, so it has a phase
 * of its own that moves independently of the main field's — which is routinely
 * several rounds ahead of it. One hook for both, because a second copy would be
 * the place the two came to disagree about what *weiter* does.
 */
export function usePhase(track: RoundTrack = 'MAIN'): PhaseHandle {
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  const advance = useCallback(() => advancePhase(tournamentStore, track), [track]);
  const showRoundOnBeamer = useCallback(
    (roundId: RoundId) => showScene(tournamentStore, { id: 'ROUND_BOARD', roundId }),
    [],
  );

  const actions = { advance, showRoundOnBeamer };

  if (document === null) {
    return { ...NO_PHASE, ...actions };
  }

  const phase = trackState(document, track).phase;

  return {
    // Recomputed on every commit rather than memoised, for the reason
    // `@/domain/lookup` gives: the store commits whole new states, so a cached
    // step would be stale exactly when the host needs it.
    //
    // A side event that was declined an hour ago or finished ten minutes ago is
    // not a tournament with a phase to read, so it has no panel either — the
    // same rule the round and bracket panels follow (issue #91).
    isActive: isTrackRunning(document, track) && phase !== 'SETUP',
    phase,
    step: phaseStep(document, track),
    history: roundHistory(document),
    groups: document.groups,
    participant: document.settings.participantLabel,
    ...actions,
  };
}
