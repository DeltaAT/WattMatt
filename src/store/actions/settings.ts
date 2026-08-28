import * as settings from '@/domain/settings';
import type { TableAssignmentOrder, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * The host's choices about the tournament itself (issue #15).
 *
 * Each of these is one decision and one commit, so each lands on the undo
 * stack, in the audit log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3). The rules live in
 * `@/domain/settings`; what is added here is what the host would call the step
 * in German and what the log should remember about it.
 *
 * `setParticipantLabel` is the one setting that does not live here: it is the
 * control the host reaches for while they are looking at the field, so it
 * stayed with the group actions it was written for (issue #14,
 * `@/store/actions/groups`).
 */

/**
 * Renames the tournament. The file it is saved in keeps its own name
 * (docs/OPEN-QUESTIONS.md #26).
 */
export function setTournamentName(store: TournamentStore, name: string): void {
  change(
    store,
    (document) => settings.setTournamentName(document, name),
    (_before, after) => ({
      undoLabel: de.undo.action.tournamentRenamed({ name: after.name }),
      log: { action: 'TOURNAMENT_RENAMED', payload: { name: after.name } },
    }),
  );
}

/**
 * Moves the field size at which participants are asked for names
 * (docs/TOURNAMENT-RULES.md §6). Refused once the naming phase has begun.
 */
export function setNamingAt(store: TournamentStore, namingAt: number): void {
  change(
    store,
    (document) => settings.setNamingAt(document, namingAt),
    (_before, after) => ({
      undoLabel: de.undo.action.namingAtSet({ n: after.settings.namingAt }),
      log: { action: 'NAMING_AT_SET', payload: { namingAt: after.settings.namingAt } },
    }),
  );
}

/**
 * Turns the cheap motion mode on or off (docs/MOTION.md §6).
 *
 * Reaches the projector on the next snapshot, which is what makes it usable
 * mid-event: the host flips it because the beamer is stuttering *now*, and
 * waiting for a window reload would mean the audience watching the reload.
 */
export function setPerformanceMode(store: TournamentStore, performanceMode: boolean): void {
  change(
    store,
    (document) => settings.setPerformanceMode(document, performanceMode),
    (_before, after) => ({
      undoLabel: after.settings.performanceMode
        ? de.undo.action.performanceModeOn
        : de.undo.action.performanceModeOff,
      log: { action: 'PERFORMANCE_MODE_SET', payload: { performanceMode } },
    }),
  );
}

/**
 * Chooses which end of the table list free tables are handed out from
 * (docs/TOURNAMENT-RULES.md §3).
 *
 * On the undo stack like every other decision, and worth being there: it is
 * one press, but the next draw hands out every table by it. Undoing it puts
 * the direction back and moves nothing else, because the setting only ever
 * decided what happens next.
 */
export function setTableAssignmentOrder(
  store: TournamentStore,
  tableAssignmentOrder: TableAssignmentOrder,
): void {
  change(
    store,
    (document) => settings.setTableAssignmentOrder(document, tableAssignmentOrder),
    (_before, after) => ({
      undoLabel: de.undo.action.tableAssignmentOrderSet({
        order: de.settings.tableAssignmentOrderOption[after.settings.tableAssignmentOrder],
      }),
      log: { action: 'TABLE_ASSIGNMENT_ORDER_SET', payload: { tableAssignmentOrder } },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * The same shape as `@/store/actions/tables` and `@/store/actions/groups`, and
 * for the same two reasons. With no tournament open it does nothing rather than
 * committing an empty patch — the settings panel lives with the tournament, so
 * this can only be a click that arrived after the host closed one. And a change
 * that produced the same tournament does not commit either: every function in
 * `@/domain/settings` hands its argument back when it is asked for something
 * that cannot happen — an empty name, a locked threshold, a mode that is
 * already on — and committing that would put a step on the undo stack that
 * undoes nothing.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after }), describe(before, after));
}
