// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { midTournament, tableId, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useTables, type TablesHandle } from '@/windows/host/useTables';

/**
 * The wire between the table panel and the store (issue #13).
 *
 * The store is the real one: what is being checked is that a click reaches it,
 * that the board redraws when it does, and that the board the host reads is the
 * same projection the beamer is sent — the two disagreeing about who is playing
 * where is the failure golden rule 4 exists to prevent.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, midTournament(), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<TablesHandle, void>(() => useTables());

describe('the table handle', () => {
  it('reads the board out of the tournament the host has open', () => {
    const { result } = mounted();

    expect(result.current.board.map((slot) => slot.table.id)).toEqual([
      tableId(1),
      tableId(2),
      tableId(3),
    ]);
    expect(result.current.board[0]?.match?.id).toBe(midTournament().rounds[1]?.matches[0]?.id);
  });

  it('redraws when a table changes', () => {
    const { result } = mounted();

    act(() => result.current.add(2));

    expect(result.current.board).toHaveLength(5);
    expect(result.current.board[3]?.table.label).toBe(de.table.defaultLabel({ n: 4 }));
  });

  it('reports whether anything is running, so the stopwatch only ticks then', () => {
    const { result } = mounted();
    expect(result.current.isAnyRunning).toBe(true);

    act(() => {
      closeDocument(tournamentStore);
      setOpenedDocument(tournamentStore, tournament(), PATH);
    });

    expect(result.current.isAnyRunning).toBe(false);
  });

  it('takes a table out of service and puts it back', () => {
    const { result } = mounted();

    act(() => result.current.disable(tableId(2)));
    expect(result.current.board[1]?.table.status).toBe('DISABLED');

    act(() => result.current.enable(tableId(2)));
    expect(result.current.board[1]?.table.status).toBe('FREE');
  });

  it('renames, moves and removes through the store', () => {
    const { result } = mounted();

    act(() => result.current.rename(tableId(2), 'Fenstertisch'));
    act(() => result.current.move(tableId(2), -1));
    act(() => result.current.remove(tableId(3)));

    expect(result.current.board.map((slot) => slot.table.label)).toEqual([
      'Fenstertisch',
      'Table 1',
    ]);
  });

  /** Issue #13: the optional `TABLE_OVERVIEW` scene, staged by the host. */
  it('puts the overview on the beamer and takes manual control with it', () => {
    const { result } = mounted();

    act(() => result.current.showOnBeamer());

    expect(tournamentStore.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });
    // Driving the beamer by hand always wins (CLAUDE.md golden rule 3).
    expect(tournamentStore.getState().autoFollow).toBe(false);
  });

  it('hands the host the same board the beamer is sent', () => {
    const { result } = mounted();

    const projected = tournamentStore.getState().tournament;
    expect(result.current.board.map((slot) => slot.table)).toEqual(projected.tables);
    expect(result.current.board[0]?.match).toEqual(projected.matches[0]);
  });
});
