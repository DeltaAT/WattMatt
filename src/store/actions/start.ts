import { startTournament as start } from '@/domain/start';
import { de } from '@/i18n';
import type { TournamentStore } from '@/store/tournamentStore';

/**
 * The one action that ends the setup phase (issue #15).
 *
 * It moves `SETUP` to `QUALIFYING` and does nothing else — drawing the first
 * round is issue #16's, and keeping the two apart is what lets a host start the
 * evening, say so out loud, and draw when the room is ready.
 *
 * Refused for a tournament that is not ready or has already started
 * (`preStartReport` in `@/domain/start`). The button is disabled with a reason
 * in both cases; the guard is what makes a click that arrived anyway cost
 * nothing.
 */
export function startTournament(store: TournamentStore): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = start(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after }), {
    // One of the two moments `CommitOptions.urgent` was written for: a phase
    // change is a line the host cannot cross twice, and a crash in the next
    // half-second must not hand back a tournament that had not started.
    urgent: true,
    undoLabel: de.undo.action.tournamentStarted,
    log: { action: 'TOURNAMENT_STARTED', payload: { phase: after.phase } },
  });
}
