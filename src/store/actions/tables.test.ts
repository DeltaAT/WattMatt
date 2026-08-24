import { describe, expect, it } from 'vitest';

import { freeTables } from '@/domain/selectors';
import {
  FIXED_NOW,
  fixedClock,
  matchId,
  midTournament,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import { tournamentSchema, type Tournament } from '@/domain/types';
import { de } from '@/i18n';
import {
  addTables,
  disableTable,
  enableTable,
  moveTable,
  removeTable,
  renameTable,
} from '@/store/actions/tables';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The table actions (issue #13).
 *
 * The rules are `@/domain/tables`' and are tested there. What is checked here is
 * what an action adds: the German step the undo button reads, the audit entry
 * the file keeps, and the two things `change` refuses to do — commit with no
 * tournament open, and commit a change that changed nothing.
 */

function setup(document: Tournament = midTournament()): TournamentStore {
  const store = createTournamentStore(
    { ...INITIAL_TOURNAMENT_STATE, document, file: { status: 'saved', path: 'C:\\T.wattmatt' } },
    { clock: fixedClock() },
  );
  return store;
}

const documentOf = (store: TournamentStore): Tournament => {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

const lastLog = (store: TournamentStore) => documentOf(store).log.at(-1);

/**
 * A tournament without the two streams an undo deliberately does not rewind.
 *
 * The log is append-only and records the undo itself, and `updatedAt` moves
 * with it (docs/FILE-FORMAT.md rule 6). Everything else has to come back
 * exactly, which is what these two helpers assert.
 */
function restorable({ log: _log, updatedAt: _updatedAt, ...rest }: Tournament) {
  return rest;
}

const restored = (store: TournamentStore) => restorable(documentOf(store));

describe('addTables', () => {
  it('creates the tables the host asked for, with German default labels', () => {
    const store = setup(tournament());

    addTables(store, 3);

    expect(documentOf(store).tables.map((table) => table.label)).toEqual([
      de.table.defaultLabel({ n: 1 }),
      de.table.defaultLabel({ n: 2 }),
      de.table.defaultLabel({ n: 3 }),
    ]);
  });

  it('names the step on the undo button and appends one audit entry', () => {
    const store = setup(tournament());

    addTables(store, 3);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.tablesAdded({ n: 3 }));
    expect(lastLog(store)).toMatchObject({
      at: FIXED_NOW,
      action: 'TABLES_ADDED',
      payload: { count: 3 },
    });
  });

  it('takes the whole thing back in one step', () => {
    const store = setup(tournament());
    const before = restored(store);
    addTables(store, 8);

    store.undo();

    expect(documentOf(store).tables).toEqual([]);
    // Including the number counter. An undo says the eight tables never
    // happened, so the next `+` is table one again — unlike a *deletion*, which
    // says they did and spends their numbers for good (OPEN-QUESTIONS #37).
    expect(restored(store)).toEqual(before);
    expect(documentOf(store).nextTableNumber).toBe(1);
  });

  it('spends the numbers of tables that were deleted rather than undone', () => {
    const store = setup(tournament());
    addTables(store, 3);

    removeTable(store, tableId(3));
    addTables(store, 1);

    expect(documentOf(store).tables.map((table) => table.id)).toEqual([
      tableId(1),
      tableId(2),
      tableId(4),
    ]);
  });

  it.each([0, -1])('does nothing at all for a count of %s', (count) => {
    const store = setup(tournament());
    const before = store.getState();

    addTables(store, count);

    expect(store.getState()).toBe(before);
  });

  /* The controls live with the tournament, so this can only be a click that
   * arrived after the host closed one. */
  it('does nothing with no tournament open', () => {
    const store = createTournamentStore();
    const before = store.getState();

    addTables(store, 4);

    expect(store.getState()).toBe(before);
  });
});

describe('renameTable', () => {
  it('renames the table and remembers both names in the log', () => {
    const store = setup();

    renameTable(store, tableId(2), 'Fenstertisch');

    expect(documentOf(store).tables[1]?.label).toBe('Fenstertisch');
    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_RENAMED',
      payload: { tableId: tableId(2), from: 'Table 2', to: 'Fenstertisch' },
    });
  });

  it('names the new label on the undo button, which is what the host can see', () => {
    const store = setup();

    renameTable(store, tableId(2), 'Fenstertisch');

    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.tableRenamed({ label: 'Fenstertisch' }),
    );
  });

  it.each([
    ['an empty label', '   '],
    // A second "Table 3" would be a second identical option in the dialog that
    // asks where the match on a deleted table should go.
    ['a label another table already wears', 'Table 3'],
  ])('does not commit a rename the domain refused: %s', (_case, refused) => {
    const store = setup();
    const before = store.getState();

    renameTable(store, tableId(2), refused);

    // Not merely "the label is unchanged": a refusal must not reach the undo
    // stack or the audit log either, or the host's next undo takes back
    // nothing visible.
    expect(store.getState()).toBe(before);
  });
});

describe('moveTable', () => {
  it('moves the table and records which way', () => {
    const store = setup();

    moveTable(store, tableId(1), 1);

    expect(documentOf(store).tables.map((table) => table.id)).toEqual([
      tableId(2),
      tableId(1),
      tableId(3),
    ]);
    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_MOVED',
      payload: { tableId: tableId(1), offset: 1 },
    });
  });

  /* A step on the stack that undoes nothing is worse than a button that did
   * not react: the host presses undo and the wrong thing disappears. */
  it('does not put a move off the end of the list on the undo stack', () => {
    const store = setup();
    const before = store.getState();

    moveTable(store, tableId(1), -1);

    expect(store.getState()).toBe(before);
  });
});

describe('disableTable and enableTable', () => {
  it('takes a table out of service and stops offering it to the queue', () => {
    const store = setup();

    disableTable(store, tableId(2));

    expect(freeTables(documentOf(store))).toEqual([]);
    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_DISABLED',
      payload: { tableId: tableId(2) },
    });
  });

  it('records where the match on it went', () => {
    const store = setup();

    disableTable(store, tableId(1));

    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_DISABLED',
      payload: { tableId: tableId(1), matchId: matchId(1), requeued: true },
    });
  });

  it('records the table a displaced match was moved to', () => {
    const store = setup();

    disableTable(store, tableId(1), { kind: 'MOVE', toTableId: tableId(2) });

    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_DISABLED',
      payload: { tableId: tableId(1), matchId: matchId(1), movedTo: tableId(2) },
    });
  });

  it('does not commit a disable whose match had nowhere to go', () => {
    const store = setup();
    const before = store.getState();

    // `tbl_3` is out of service, so the match cannot be sent there.
    disableTable(store, tableId(1), { kind: 'MOVE', toTableId: tableId(3) });

    expect(store.getState()).toBe(before);
  });

  it('puts a table back into service', () => {
    const store = setup();

    enableTable(store, tableId(3));

    expect(documentOf(store).tables[2]?.status).toBe('FREE');
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.tableEnabled({ label: 'Table 3' }),
    );
  });

  /** Golden rule 6: undo restores the derived state too, table occupancy included. */
  it('restores the match onto its table when the disable is taken back', () => {
    const store = setup();
    const before = documentOf(store);

    disableTable(store, tableId(1));
    store.undo();

    expect(restored(store)).toEqual(restorable(before));
  });
});

describe('removeTable', () => {
  it('removes the table and names it on the undo button', () => {
    const store = setup();

    removeTable(store, tableId(2));

    expect(documentOf(store).tables.map((table) => table.id)).toEqual([tableId(1), tableId(3)]);
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.tableRemoved({ label: 'Table 2' }),
    );
  });

  it('records the match it displaced', () => {
    const store = setup();

    removeTable(store, tableId(1));

    expect(lastLog(store)).toMatchObject({
      action: 'TABLE_REMOVED',
      payload: { tableId: tableId(1), matchId: matchId(1), requeued: true },
    });
  });

  it('brings the table and its match back on undo', () => {
    const store = setup();
    const before = documentOf(store);

    removeTable(store, tableId(1), { kind: 'MOVE', toTableId: tableId(2) });
    store.undo();

    expect(restored(store)).toEqual(restorable(before));
  });
});

describe('every table action', () => {
  /* An action that produced a tournament the schema refuses would be found on
   * the next save, by which time it is the file that will not open. */
  it('leaves a tournament the schema still accepts', () => {
    const store = setup();

    addTables(store, 2);
    renameTable(store, tableId(4), 'Bühne');
    moveTable(store, tableId(4), -1);
    disableTable(store, tableId(1), { kind: 'MOVE', toTableId: tableId(2) });
    removeTable(store, tableId(5));
    enableTable(store, tableId(3));

    expect(tournamentSchema.safeParse(documentOf(store)).success).toBe(true);
  });

  it('reaches the beamer through the central projection', () => {
    const store = setup(tournament());

    addTables(store, 2);

    expect(store.getState().tournament.tables.map((table) => table.label)).toEqual([
      de.table.defaultLabel({ n: 1 }),
      de.table.defaultLabel({ n: 2 }),
    ]);
  });

  it('marks the file as no longer matching what is on disk', () => {
    const store = setup();

    disableTable(store, tableId(2));

    expect(store.getState().file).toEqual({ status: 'modified', path: 'C:\\T.wattmatt' });
  });
});
