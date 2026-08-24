import { useCallback, useSyncExternalStore } from 'react';

import { preStartReport, type PreStartReport } from '@/domain/start';
import { startTournament } from '@/store/actions/start';
import { tournamentStore } from '@/store/session';

/**
 * The pre-start checks and the start button, bound to the store (issue #15).
 *
 * The report is recomputed on every commit rather than memoised: it is a
 * handful of counts over lists the host is actively editing, and a cached
 * answer would be stale exactly when it matters — a table disabled a second ago
 * has to remove the start button's reason to exist, not one click later
 * (`@/domain/lookup` says the same thing about every derived read).
 */

export interface PreStartHandle {
  report: PreStartReport;
  /** Moves `SETUP` to `QUALIFYING`. Does nothing when the report says it cannot. */
  start: () => void;
}

/** What a window with no tournament open reads: nothing can start. */
const NO_TOURNAMENT: PreStartReport = {
  pending: false,
  blockers: [],
  warnings: [],
  preview: { participants: 0, matches: 0, bye: false, tables: 0, queued: 0 },
  canStart: false,
};

export function usePreStart(): PreStartHandle {
  const document = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document,
  );

  return {
    report: document === null ? NO_TOURNAMENT : preStartReport(document),
    start: useCallback(() => startTournament(tournamentStore), []),
  };
}
