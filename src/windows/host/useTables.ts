import { useCallback, useSyncExternalStore } from 'react';

import type { BeamerScene } from '@/domain/beamerScene';
import type { TableId } from '@/domain/ids';
import { occupancyBoard, type MatchDisposition, type TableSlot } from '@/domain/tables';
import { showScene } from '@/store/actions/scene';
import {
  addTables,
  disableTable,
  enableTable,
  moveTable,
  removeTable,
  renameTable,
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
  add: (count: number) => void;
  rename: (tableId: TableId, label: string) => void;
  move: (tableId: TableId, offset: number) => void;
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

  const board = occupancyBoard(tournament.tables, tournament.matches);

  return {
    board,
    isAnyRunning: board.some((slot) => slot.table.currentMatchId !== null),
    add: useCallback((count: number) => addTables(tournamentStore, count), []),
    rename: useCallback(
      (tableId: TableId, label: string) => renameTable(tournamentStore, tableId, label),
      [],
    ),
    move: useCallback(
      (tableId: TableId, offset: number) => moveTable(tournamentStore, tableId, offset),
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
