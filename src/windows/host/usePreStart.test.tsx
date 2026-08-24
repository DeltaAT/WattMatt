// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { group, table, tournament } from '@/domain/testFixtures';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { addGroups } from '@/store/actions/groups';
import { disableTable } from '@/store/actions/tables';
import { tournamentStore } from '@/store/session';
import { usePreStart, type PreStartHandle } from '@/windows/host/usePreStart';

/**
 * The wire between the pre-start panel and the store (issue #15).
 *
 * The report has to be as live as the room is: a participant who arrives and a
 * table that breaks both change what the panel says, and a host who has to click
 * elsewhere before the screen catches up would start a tournament on a check
 * that was true a minute ago.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

const ready = () => tournament({ groups: [group(1), group(2)], tables: [table(1)] });

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, ready(), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<PreStartHandle, void>(() => usePreStart());

describe('the pre-start handle', () => {
  it('reports a ready tournament as ready', () => {
    const { result } = mounted();

    expect(result.current.report.canStart).toBe(true);
    expect(result.current.report.blockers).toEqual([]);
  });

  it('starts the tournament through the store', () => {
    const { result } = mounted();

    act(() => result.current.start());

    expect(tournamentStore.getState().document?.phase).toBe('QUALIFYING');
    expect(result.current.report.pending).toBe(false);
    expect(result.current.report.canStart).toBe(false);
  });

  it('re-reads the checks when a participant arrives', () => {
    setOpenedDocument(tournamentStore, tournament({ tables: [table(1)] }), PATH);
    const { result } = mounted();

    expect(result.current.report.blockers).toEqual(['TOO_FEW_GROUPS']);

    act(() => addGroups(tournamentStore, 2));

    expect(result.current.report.blockers).toEqual([]);
    expect(result.current.report.preview.matches).toBe(1);
  });

  /* A table goes out of service mid-setup and the last usable one takes the
   * start button with it. */
  it('re-reads the checks when the last table is taken out of service', () => {
    const { result } = mounted();

    act(() => disableTable(tournamentStore, table(1).id));

    expect(result.current.report.blockers).toEqual(['NO_USABLE_TABLE']);
    expect(result.current.report.canStart).toBe(false);
  });

  it('reports nothing startable with no tournament open', () => {
    const { result } = mounted();

    act(() => closeDocument(tournamentStore));

    expect(result.current.report.canStart).toBe(false);
    expect(result.current.report.pending).toBe(false);
  });
});
