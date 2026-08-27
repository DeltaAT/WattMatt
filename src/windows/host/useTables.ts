import { useCallback, useSyncExternalStore } from 'react';

import type { BeamerScene } from '@/domain/beamerScene';
import type { TableId } from '@/domain/ids';
import { occupancyBoard, type MatchDisposition, type TableSlot } from '@/domain/tables';
import type { RoundTrack } from '@/domain/types';
import { showScene } from '@/store/actions/scene';
import {
  addTables,
  disableTable,
  enableTable,
  moveTable,
  removeTable,
  renameTable,
  reserveTable,
} from '@/store/actions/tables';
import { tournamentStore } from '@/store/session';

/**
 * The host's table controls, bound to the one store this window owns (issue #13).
 *
 * Everything that decides anything lives in `@/domain/tables` and the actions
 * around it. What is left here is React: subscribing so the board redraws when a
 * table changes, and handing the components callbacks that do not change
 * identity between renders.
 */

const TABLE_OVERVIEW: BeamerScene = { id: 'TABLE_OVERVIEW' };

export interface TablesHandle {
  /** Every table with whatever is on it, in the order the host arranged them. */
  board: readonly TableSlot[];
  /** True while any table has a match on it — the board's stopwatch runs then. */
  isAnyRunning: boolean;
  /**
   * Whether the reservation control is worth showing (issue #79).
   *
   * While the `Trostrunde` is running there are two tracks to choose between.
   * **And whenever any table is still reserved**, whatever the side event is
   * doing — without that second clause a host who reserved two tables and then
   * watched the side event finish would be left with two tables permanently
   * excluded from the main field's draws and no control to release them. The
   * board would say why (`RoundBoard.stalled`) and there would be nothing to do
   * about it.
   */
  canReserve: boolean;
  add: (count: number) => void;
  rename: (tableId: TableId, label: string) => void;
  move: (tableId: TableId, offset: number) => void;
  reserve: (tableId: TableId, track: RoundTrack | null) => void;
  disable: (tableId: TableId, disposition?: MatchDisposition) => void;
  enable: (tableId: TableId) => void;
  remove: (tableId: TableId, disposition?: MatchDisposition) => void;
  /** Puts the occupancy board on the projector (`TABLE_OVERVIEW`). */
  showOnBeamer: () => void;
}

export function useTables(): TablesHandle {
  // The projection the beamer is sent, not the document: it already holds the
  // tables and exactly the matches that are on them, and `commit` hands back
  // the same reference when neither changed — so this re-renders when the board
  // would read differently and not on every beamer scene the host stages.
  const tournament = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().tournament,
  );

  /*
   * Read off the document rather than the snapshot: the side event's *state* is
   * not something the beamer is sent, and there is no round on the projector to
   * infer it from until one has been drawn. A string is a stable snapshot for
   * `useSyncExternalStore`, so this re-renders when the answer changes and not
   * when a table does.
   */
  const consolation = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().document?.consolation?.state ?? null,
  );

  const board = occupancyBoard(tournament.tables, tournament.matches);

  return {
    board,
    isAnyRunning: board.some((slot) => slot.table.currentMatchId !== null),
    canReserve:
      consolation === 'RUNNING' || tournament.tables.some((table) => table.reservedFor !== null),
    add: useCallback((count: number) => addTables(tournamentStore, count), []),
    rename: useCallback(
      (tableId: TableId, label: string) => renameTable(tournamentStore, tableId, label),
      [],
    ),
    move: useCallback(
      (tableId: TableId, offset: number) => moveTable(tournamentStore, tableId, offset),
      [],
    ),
    reserve: useCallback(
      (tableId: TableId, track: RoundTrack | null) => reserveTable(tournamentStore, tableId, track),
      [],
    ),
    disable: useCallback(
      (tableId: TableId, disposition?: MatchDisposition) =>
        disableTable(tournamentStore, tableId, disposition),
      [],
    ),
    enable: useCallback((tableId: TableId) => enableTable(tournamentStore, tableId), []),
    remove: useCallback(
      (tableId: TableId, disposition?: MatchDisposition) =>
        removeTable(tournamentStore, tableId, disposition),
      [],
    ),
    showOnBeamer: useCallback(() => showScene(tournamentStore, TABLE_OVERVIEW), []),
  };
}
