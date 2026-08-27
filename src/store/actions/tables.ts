import type { TableId } from '@/domain/ids';
import * as tables from '@/domain/tables';
import type { RoundTrack, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * Everything the host can do to a table (issue #13).
 *
 * Each of these is one decision and one commit, so each lands on the undo stack,
 * in the audit log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3). The rules themselves
 * live in `@/domain/tables`; what is added here is what the host would call the
 * step in German and what the log should remember about it.
 *
 * All of them are allowed **mid-tournament**: the host configures anything,
 * anytime, and a table that breaks does so during a round rather than during
 * setup. Nothing here is urgent, though — a table change that is lost to a
 * crash costs a few seconds of clicking, and the debounce keeps a quick-add of
 * sixteen tables to one write instead of sixteen.
 */

/**
 * Creates `count` tables, numbered on from the highest that has ever existed.
 *
 * One action for the `+` and for the "Anzahl Tische" quick-add: the host means
 * the same thing either way, and two actions would eventually disagree about
 * the numbering.
 */
export function addTables(store: TournamentStore, count: number): void {
  change(
    store,
    (document) => tables.addTables(document, { count, label: (n) => de.table.defaultLabel({ n }) }),
    (before, after) => {
      // Counted from what actually appeared rather than from what was asked
      // for: the domain floors a fractional count, and an undo button promising
      // three tables that were never created is worse than no label at all.
      const created = after.tables.length - before.tables.length;
      return {
        undoLabel: de.undo.action.tablesAdded({ n: created }),
        log: {
          action: 'TABLES_ADDED',
          payload: { count: created, tableIds: after.tables.slice(-created).map((t) => t.id) },
        },
      };
    },
  );
}

export function renameTable(store: TournamentStore, tableId: TableId, label: string): void {
  change(
    store,
    (document) => tables.renameTable(document, tableId, label),
    (before, after) => ({
      // The new name, because that is what the host is looking at on the board
      // when they reach for undo.
      undoLabel: de.undo.action.tableRenamed({ label: labelOf(after, tableId) }),
      log: {
        action: 'TABLE_RENAMED',
        payload: { tableId, from: labelOf(before, tableId), to: labelOf(after, tableId) },
      },
    }),
  );
}

/** Moves a table one place up (`-1`) or down (`1`) the host's list. */
export function moveTable(store: TournamentStore, tableId: TableId, offset: number): void {
  change(
    store,
    (document) => tables.moveTable(document, tableId, offset),
    (document) => ({
      undoLabel: de.undo.action.tableMoved({ label: labelOf(document, tableId) }),
      log: { action: 'TABLE_MOVED', payload: { tableId, offset } },
    }),
  );
}

/**
 * Takes a table out of service. `disposition` says what happens to a match on
 * it, and is ignored for a table that is free.
 */
export function disableTable(
  store: TournamentStore,
  tableId: TableId,
  disposition: tables.MatchDisposition = tables.REQUEUE,
): void {
  change(
    store,
    (document) => tables.disableTable(document, tableId, disposition),
    (before) => ({
      undoLabel: de.undo.action.tableDisabled({ label: labelOf(before, tableId) }),
      log: {
        action: 'TABLE_DISABLED',
        payload: { tableId, ...displacedPayload(before, tableId, disposition) },
      },
    }),
  );
}

/** Puts a table that was out of service back into service, free. */
export function enableTable(store: TournamentStore, tableId: TableId): void {
  change(
    store,
    (document) => tables.enableTable(document, tableId),
    (document) => ({
      undoLabel: de.undo.action.tableEnabled({ label: labelOf(document, tableId) }),
      log: { action: 'TABLE_ENABLED', payload: { tableId } },
    }),
  );
}

/**
 * Reserves a table for one track, or hands it back to both (issue #79).
 *
 * One action for both directions, because the host means the same thing either
 * way — *this table serves that half of the evening now* — and two actions
 * would put two different sentences on the undo button for one decision. The
 * label still says which: releasing is the step a host takes back most often,
 * having reserved the wrong table.
 *
 * A reservation that changes nothing writes nothing: `reserveTable` hands the
 * tournament back untouched for a table that already serves that track, and
 * `change` commits only a document that actually moved — so a stale click does
 * not bury the undo stack under a step that did nothing (golden rule 6).
 */
export function reserveTable(
  store: TournamentStore,
  tableId: TableId,
  track: RoundTrack | null,
): void {
  change(
    store,
    (document) => tables.reserveTable(document, tableId, track),
    (_before, after) => ({
      undoLabel:
        track === null
          ? de.undo.action.tableReleased({ label: labelOf(after, tableId) })
          : de.undo.action.tableReserved({
              label: labelOf(after, tableId),
              track: de.table.reservation[track],
            }),
      log: { action: 'TABLE_RESERVED', payload: { tableId, track } },
    }),
  );
}

/**
 * Removes a table. `disposition` says what happens to a match on it.
 *
 * The label is read off the tournament *before* the removal — afterwards there
 * is no table left to name, and an undo label ending in nothing is the one a
 * host cannot act on.
 */
export function removeTable(
  store: TournamentStore,
  tableId: TableId,
  disposition: tables.MatchDisposition = tables.REQUEUE,
): void {
  change(
    store,
    (document) => tables.removeTable(document, tableId, disposition),
    (before) => ({
      undoLabel: de.undo.action.tableRemoved({ label: labelOf(before, tableId) }),
      log: {
        action: 'TABLE_REMOVED',
        payload: { tableId, ...displacedPayload(before, tableId, disposition) },
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * Two things it will not do, and both matter during an event.
 *
 * With no tournament open it does nothing at all rather than committing an
 * empty patch — the table controls live with the tournament, so this can only
 * be a click that arrived after the host closed one.
 *
 * A change that produced the same tournament also does not commit. Every domain
 * function here hands its argument back when it is asked for something that
 * cannot happen — a move off the end of the list, a match sent to a table that
 * is not free — and committing that would put a step on the undo stack that
 * undoes nothing, which is worse than a button that did not react.
 *
 * `describe` is given both tournaments. Which one an action reads is not a
 * detail: a removal has to name the table from *before*, because afterwards
 * there is none left to name, while a rename has to name it from *after*,
 * because the new name is what the host is looking at when they reach for undo.
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

/** What the host calls this table, for the undo button and the log. */
function labelOf(document: Tournament, tableId: TableId): string {
  return document.tables.find((table) => table.id === tableId)?.label ?? de.table.label;
}

/**
 * What happened to the match that was on the table.
 *
 * Read off the tournament from before the change, which is the last one that
 * still knows there was a match there. In the log rather than only on the
 * screen, because "where did that match go?" is a question asked half an hour
 * later, when the only record left is the file (docs/FILE-FORMAT.md rule 6).
 */
function displacedPayload(
  before: Tournament,
  tableId: TableId,
  disposition: tables.MatchDisposition,
): Record<string, unknown> {
  const displaced = before.tables.find((table) => table.id === tableId)?.currentMatchId ?? null;
  if (displaced === null) {
    return {};
  }
  return disposition.kind === 'MOVE'
    ? { matchId: displaced, movedTo: disposition.toTableId }
    : { matchId: displaced, requeued: true };
}
