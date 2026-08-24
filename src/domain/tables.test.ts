import { describe, expect, it } from 'vitest';

import { allMatches } from '@/domain/lookup';
import { freeTables } from '@/domain/selectors';
import {
  addTables,
  disableTable,
  elapsedMs,
  enableTable,
  isLabelAvailable,
  matchesOnTables,
  moveTable,
  nextTableNumber,
  occupancyBoard,
  occupyTable,
  releaseTable,
  removeTable,
  renameTable,
  REQUEUE,
} from '@/domain/tables';
import {
  FIXED_NOW,
  group,
  groupId,
  match,
  matchId,
  midTournament,
  occupiedTable,
  round,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import { tableSchema, type Table, type Timestamp, type Tournament } from '@/domain/types';

/**
 * The table lifecycle (issue #13, docs/TOURNAMENT-RULES.md §0 and §3).
 *
 * Tables are the scarce resource the round flow turns on, so the cases that
 * matter here are the ones a host hits in front of an audience: a table that
 * breaks while a match is on it, a table added between two rounds, a number
 * that must not come back on a different piece of furniture.
 *
 * German labels appear throughout because the host's do — the domain never
 * writes them, it is handed a `label` function (CLAUDE.md golden rule 1).
 */

/** What `de.table.defaultLabel` does, without importing the locale into a domain test. */
const label = (n: number) => `Tisch ${n}`;

function withTables(count: number): Tournament {
  return addTables(tournament(), { count, label });
}

/**
 * The invariant `tableSchema` checks (`@/domain/types`).
 *
 * It lives on the schema rather than in a review comment because every way into
 * the app goes through it: a file hand-repaired in Notepad — which
 * docs/FILE-FORMAT.md invites — that frees a table but leaves the match on it
 * would otherwise open, and the draw engine would hand that table to a second
 * match in front of the audience.
 */
describe('the occupancy invariant', () => {
  it.each([
    ['a free table with a match on it', { status: 'FREE', currentMatchId: matchId(1) }],
    ['a busy table naming no match', { status: 'OCCUPIED', currentMatchId: null }],
    [
      'a busy table with no start time',
      { status: 'OCCUPIED', currentMatchId: matchId(1), occupiedSince: null },
    ],
    [
      'a free table with a start time',
      { status: 'FREE', currentMatchId: null, occupiedSince: FIXED_NOW },
    ],
    [
      'a table out of service that still holds a match',
      { status: 'DISABLED', currentMatchId: matchId(1), occupiedSince: FIXED_NOW },
    ],
  ])('rejects %s', (_case, overrides) => {
    expect(tableSchema.safeParse({ ...table(1), ...overrides }).success).toBe(false);
  });

  it.each([
    ['a free table', table(1)],
    ['a busy table', occupiedTable(1, matchId(1))],
    ['a table out of service', table(1, { status: 'DISABLED' })],
  ])('accepts %s', (_case, entry) => {
    expect(tableSchema.safeParse(entry).success).toBe(true);
  });
});

describe('nextTableNumber', () => {
  it('starts at one', () => {
    expect(nextTableNumber(tournament())).toBe(1);
  });

  /*
   * The number is how the host and the room refer to a physical table. Reusing
   * the number of a table deleted an hour ago would put "Tisch 2" on a
   * different piece of furniture mid-event — the same reasoning that keeps
   * group numbers stable (docs/TOURNAMENT-RULES.md §2).
   *
   * The deleted table has to be the *highest* one for this to prove anything.
   * Deleting a middle table leaves the highest id in place, and a counter
   * derived from `tables` would pass that case while still handing the number
   * back in the one that matters.
   */
  it('never reuses the number of the highest table, once it is deleted', () => {
    const three = withTables(3);

    const afterDelete = removeTable(three, tableId(3));

    expect(afterDelete.tables.map((entry) => entry.id)).toEqual([tableId(1), tableId(2)]);
    expect(nextTableNumber(afterDelete)).toBe(4);
  });

  it('never reuses a number after every table has been deleted', () => {
    const emptied = [tableId(1), tableId(2), tableId(3)].reduce(
      (document, id) => removeTable(document, id),
      withTables(3),
    );

    expect(emptied.tables).toEqual([]);
    expect(nextTableNumber(emptied)).toBe(4);
  });

  /*
   * The whole point of the counter: the id a closed round still points at
   * (`match.tableId`, docs/OPEN-QUESTIONS.md #37) must not come to mean a
   * different piece of furniture.
   */
  it('gives a table added after a deletion an id no match refers to', () => {
    const played = removeTable(
      addTables(
        tournament({
          rounds: [round(1, { state: 'CLOSED', matches: [match(1, { tableId: tableId(3) })] })],
        }),
        { count: 3, label },
      ),
      tableId(3),
    );

    const added = addTables(played, { count: 1, label });

    const created = added.tables.at(-1);
    expect(created?.id).toBe(tableId(4));
    expect(created?.label).toBe('Tisch 4');
    expect(allMatches(added).map((entry) => entry.tableId)).not.toContain(created?.id);
  });

  it('ignores ids that do not follow the scheme', () => {
    const odd = tournament({ tables: [table(1, { id: 'tisch-hinten' as Table['id'] }), table(7)] });

    expect(nextTableNumber(odd)).toBe(8);
  });

  /*
   * docs/FILE-FORMAT.md invites repairing a file in Notepad, and a counter
   * edited back below the tables that exist would mint a duplicate id —
   * `indexById` throws on those, which loses the tournament rather than one
   * number.
   */
  it('never falls below the tables that already exist', () => {
    const repaired = tournament({ tables: [table(1), table(9)], nextTableNumber: 2 });

    expect(nextTableNumber(repaired)).toBe(10);
    expect(addTables(repaired, { count: 1, label }).tables.at(-1)?.id).toBe(tableId(10));
  });
});

describe('addTables', () => {
  it('numbers the default labels from one', () => {
    expect(withTables(3).tables.map((entry) => entry.label)).toEqual([
      'Tisch 1',
      'Tisch 2',
      'Tisch 3',
    ]);
  });

  it('creates them free, with nothing on them', () => {
    const created = withTables(2).tables;

    expect(created.map((entry) => entry.status)).toEqual(['FREE', 'FREE']);
    expect(created.every((entry) => entry.currentMatchId === null)).toBe(true);
    expect(created.every((entry) => entry.occupiedSince === null)).toBe(true);
  });

  it('is the same operation for one table and for a quick-add of eight', () => {
    const oneByOne = [1, 1, 1].reduce(
      (current) => addTables(current, { count: 1, label }),
      tournament(),
    );

    expect(oneByOne.tables).toEqual(withTables(3).tables);
  });

  it('appends to what is already there rather than replacing it', () => {
    const grown = addTables(withTables(2), { count: 2, label });

    expect(grown.tables.map((entry) => entry.id)).toEqual([
      tableId(1),
      tableId(2),
      tableId(3),
      tableId(4),
    ]);
  });

  /** Issue #13 acceptance criterion: a table added mid-round is usable at once. */
  it('adds a usable table in the middle of a running round', () => {
    const running = midTournament();

    const grown = addTables(running, { count: 1, label });

    expect(freeTables(grown).map((entry) => entry.id)).toEqual([tableId(2), tableId(4)]);
    // Nothing else about the round moved.
    expect(allMatches(grown)).toEqual(allMatches(running));
  });

  it.each([0, -3, 0.4, Number.NaN])('creates nothing for a count of %s', (count) => {
    expect(addTables(withTables(1), { count, label })).toEqual(withTables(1));
  });

  it('produces tables the schema accepts', () => {
    for (const entry of withTables(2).tables) {
      expect(tableSchema.safeParse(entry).success).toBe(true);
    }
  });
});

describe('renameTable', () => {
  it('renames the one table it was given', () => {
    const renamed = renameTable(withTables(2), tableId(1), 'Fenstertisch');

    expect(renamed.tables.map((entry) => entry.label)).toEqual(['Fenstertisch', 'Tisch 2']);
  });

  it('trims what the host typed', () => {
    const renamed = renameTable(withTables(1), tableId(1), '  Bühne  ');

    expect(renamed.tables[0]?.label).toBe('Bühne');
  });

  /*
   * `tableSchema` requires a non-empty label, so accepting one would write a
   * file that cannot be opened again.
   */
  it.each(['', '   '])('refuses the empty label %p', (empty) => {
    const before = withTables(1);

    expect(renameTable(before, tableId(1), empty)).toBe(before);
  });

  it('does nothing for a table that is not there', () => {
    const before = withTables(1);

    expect(renameTable(before, tableId(9), 'Nirgendwo')).toBe(before);
  });

  /*
   * The label is what the host says out loud and what the move-target dropdown
   * offers when a busy table is deleted (`TableOccupiedDialog`). Two tables
   * answering to one name is a match sent to the wrong one in front of the
   * room.
   */
  it.each([
    ['the exact label of another table', 'Tisch 2'],
    ['it in another case', 'TISCH 2'],
    ['it with whitespace around it', '  Tisch 2  '],
  ])('refuses a label that is %s', (_case, taken) => {
    const before = withTables(2);

    expect(renameTable(before, tableId(1), taken)).toBe(before);
    expect(isLabelAvailable(before, tableId(1), taken)).toBe(false);
  });

  it('lets a table keep its own label, in any case', () => {
    const before = withTables(2);

    expect(renameTable(before, tableId(2), 'TISCH 2').tables[1]?.label).toBe('TISCH 2');
  });

  it('accepts a label no other table wears', () => {
    expect(isLabelAvailable(withTables(2), tableId(1), 'Bühne')).toBe(true);
  });

  /* A table that is gone took its name with it. */
  it('accepts the label of a table that was deleted', () => {
    const remaining = removeTable(withTables(2), tableId(2));

    expect(renameTable(remaining, tableId(1), 'Tisch 2').tables[0]?.label).toBe('Tisch 2');
  });
});

describe('moveTable', () => {
  const labels = (current: Tournament) => current.tables.map((entry) => entry.label);

  it('moves a table one place up', () => {
    expect(labels(moveTable(withTables(3), tableId(3), -1))).toEqual([
      'Tisch 1',
      'Tisch 3',
      'Tisch 2',
    ]);
  });

  it('moves a table one place down', () => {
    expect(labels(moveTable(withTables(3), tableId(1), 1))).toEqual([
      'Tisch 2',
      'Tisch 1',
      'Tisch 3',
    ]);
  });

  /* Clamped, not wrapped: a table jumping from the top of the board to the
   * bottom is not what a host pressing "up" once more meant. */
  it('stops at the ends instead of wrapping around', () => {
    const three = withTables(3);

    expect(moveTable(three, tableId(1), -1)).toBe(three);
    expect(moveTable(three, tableId(3), 1)).toBe(three);
  });

  it('does nothing for a table that is not there', () => {
    const before = withTables(2);

    expect(moveTable(before, tableId(9), 1)).toBe(before);
  });

  it('leaves the rest of the tournament alone', () => {
    const running = midTournament();

    const moved = moveTable(running, tableId(1), 1);

    expect(moved.tables.map((entry) => entry.id)).toEqual([tableId(2), tableId(1), tableId(3)]);
    expect(allMatches(moved)).toEqual(allMatches(running));
  });
});

describe('disableTable', () => {
  it('takes a free table out of service', () => {
    const blocked = disableTable(withTables(2), tableId(1));

    expect(blocked.tables[0]?.status).toBe('DISABLED');
  });

  /** Issue #13 acceptance criterion: a `gesperrt` table is never offered a match. */
  it('removes the table from the ones a queued match can be sent to', () => {
    const blocked = disableTable(withTables(2), tableId(1));

    expect(freeTables(blocked).map((entry) => entry.id)).toEqual([tableId(2)]);
  });

  it('does nothing to a table that is already out of service', () => {
    const blocked = disableTable(withTables(1), tableId(1));

    expect(disableTable(blocked, tableId(1))).toBe(blocked);
  });

  it('does nothing for a table that is not there', () => {
    const before = withTables(1);

    expect(disableTable(before, tableId(9))).toBe(before);
  });

  /*
   * The spilled drink of the issue: the table has to go out of service now, and
   * the match on it goes back in the queue rather than disappearing.
   */
  it('sends the running match back to the queue', () => {
    const blocked = disableTable(midTournament(), tableId(1), REQUEUE);

    const running = allMatches(blocked).find((entry) => entry.id === matchId(1));
    expect(running).toMatchObject({ tableId: null, status: 'WAITING_FOR_TABLE' });
    expect(blocked.tables[0]).toMatchObject({
      status: 'DISABLED',
      currentMatchId: null,
      occupiedSince: null,
    });
  });

  it('moves the running match to another free table when the host says so', () => {
    const blocked = disableTable(midTournament(), tableId(1), {
      kind: 'MOVE',
      toTableId: tableId(2),
    });

    expect(blocked.tables[0]).toMatchObject({ status: 'DISABLED', currentMatchId: null });
    expect(blocked.tables[1]).toMatchObject({
      status: 'OCCUPIED',
      currentMatchId: matchId(1),
      // The stamp travels with the match: the room has been watching it for
      // that long whichever table it sits on.
      occupiedSince: FIXED_NOW,
    });
    expect(allMatches(blocked).find((entry) => entry.id === matchId(1))?.tableId).toBe(tableId(2));
  });

  /*
   * Refused as a whole rather than half-done. A match that has fallen off the
   * board is invisible, and invisible is how a match gets forgotten in front of
   * an audience.
   */
  it.each([
    ['a table that is busy', tableId(1)],
    ['a table that is out of service', tableId(3)],
    ['a table that is not there', tableId(9)],
  ])('refuses to move the match onto %s', (_case, toTableId) => {
    const before = midTournament();

    expect(disableTable(before, tableId(1), { kind: 'MOVE', toTableId })).toBe(before);
  });
});

describe('enableTable', () => {
  it('puts a table back into service, free', () => {
    const back = enableTable(disableTable(withTables(1), tableId(1)), tableId(1));

    expect(back.tables[0]).toMatchObject({
      status: 'FREE',
      currentMatchId: null,
      occupiedSince: null,
    });
  });

  it('leaves a table that is not out of service exactly as it was', () => {
    const running = midTournament();

    expect(enableTable(running, tableId(1))).toBe(running);
    expect(enableTable(running, tableId(2))).toBe(running);
  });
});

describe('removeTable', () => {
  it('removes the table and leaves the order of the rest', () => {
    const left = removeTable(withTables(3), tableId(2));

    expect(left.tables.map((entry) => entry.id)).toEqual([tableId(1), tableId(3)]);
  });

  it('sends the running match back to the queue', () => {
    const left = removeTable(midTournament(), tableId(1), REQUEUE);

    expect(left.tables.map((entry) => entry.id)).toEqual([tableId(2), tableId(3)]);
    expect(allMatches(left).find((entry) => entry.id === matchId(1))).toMatchObject({
      tableId: null,
      status: 'WAITING_FOR_TABLE',
    });
  });

  it('moves the running match to another free table when the host says so', () => {
    const left = removeTable(midTournament(), tableId(1), { kind: 'MOVE', toTableId: tableId(2) });

    expect(left.tables[0]).toMatchObject({ id: tableId(2), currentMatchId: matchId(1) });
  });

  it('refuses when the match cannot go where the host said', () => {
    const before = midTournament();

    expect(removeTable(before, tableId(1), { kind: 'MOVE', toTableId: tableId(3) })).toBe(before);
  });

  it('does nothing for a table that is not there', () => {
    const before = withTables(1);

    expect(removeTable(before, tableId(9))).toBe(before);
  });

  /*
   * A finished match is not put back in the queue by having its table taken
   * away: it is over, and the only reason it is still on a table is that nobody
   * has closed it yet.
   */
  it('leaves a decided match decided', () => {
    const decided = tournament({
      tables: [occupiedTable(1, matchId(1))],
      rounds: [
        round(1, {
          matches: [match(1, { tableId: tableId(1), winnerId: groupId(1), status: 'DONE' })],
        }),
      ],
    });

    const left = removeTable(decided, tableId(1), REQUEUE);

    expect(allMatches(left)[0]).toMatchObject({ status: 'DONE', tableId: null });
  });

  /*
   * A played round keeps pointing at the table its matches were played on. The
   * id lives on in `match.tableId` as a record of where the match happened, and
   * numbers are never reused, so the reference cannot come to mean another
   * table.
   */
  it('leaves the record of matches already played on it', () => {
    const left = removeTable(midTournament(), tableId(3));

    expect(allMatches(left).find((entry) => entry.id === matchId(1))?.tableId).toBe(tableId(1));
  });
});

describe('occupyTable and releaseTable', () => {
  const drawn = tournament({
    tables: [table(1), table(2, { status: 'DISABLED' })],
    rounds: [round(1, { matches: [match(1)] })],
  });
  const at = '2026-08-23T11:30:00+02:00' as Timestamp;

  it('puts a match on a free table and starts its clock', () => {
    const started = occupyTable(drawn, { tableId: tableId(1), matchId: matchId(1), at });

    expect(started.tables[0]).toMatchObject({
      status: 'OCCUPIED',
      currentMatchId: matchId(1),
      occupiedSince: at,
    });
    expect(allMatches(started)[0]).toMatchObject({ tableId: tableId(1), status: 'RUNNING' });
  });

  it.each([
    ['a table that is out of service', tableId(2)],
    ['a table that is not there', tableId(9)],
  ])('refuses to start a match on %s', (_case, target) => {
    expect(occupyTable(drawn, { tableId: target, matchId: matchId(1), at })).toBe(drawn);
  });

  it('refuses to hand a second match to a table that is already busy', () => {
    const busy = occupyTable(drawn, { tableId: tableId(1), matchId: matchId(1), at });

    expect(occupyTable(busy, { tableId: tableId(1), matchId: matchId(2), at })).toBe(busy);
  });

  /** Issue #13 acceptance criterion: marking a winner frees the table at once. */
  it('frees the table again without erasing where the match was played', () => {
    const freed = releaseTable(midTournament(), tableId(1));

    expect(freed.tables[0]).toMatchObject({
      status: 'FREE',
      currentMatchId: null,
      occupiedSince: null,
    });
    expect(allMatches(freed).find((entry) => entry.id === matchId(1))?.tableId).toBe(tableId(1));
  });

  it('leaves a table that is not busy alone', () => {
    const running = midTournament();

    expect(releaseTable(running, tableId(2))).toBe(running);
    expect(releaseTable(running, tableId(3))).toBe(running);
  });

  it('produces tables the schema accepts, occupied and freed', () => {
    const started = occupyTable(drawn, { tableId: tableId(1), matchId: matchId(1), at });

    expect(tableSchema.safeParse(started.tables[0]).success).toBe(true);
    expect(tableSchema.safeParse(releaseTable(started, tableId(1)).tables[0]).success).toBe(true);
  });
});

describe('occupancyBoard', () => {
  it('pairs every table with what is on it, in the host order', () => {
    const running = midTournament();

    const board = occupancyBoard(running.tables, matchesOnTables(running));

    expect(board.map((slot) => slot.table.id)).toEqual([tableId(1), tableId(2), tableId(3)]);
    expect(board[0]?.match?.id).toBe(matchId(1));
    expect(board[1]?.match).toBeNull();
    expect(board[2]?.match).toBeNull();
  });

  /*
   * The board is what a host looks at when something has already gone wrong.
   * Refusing to draw it would take away the one screen that shows which table
   * is the problem.
   */
  it('still draws a table whose match cannot be found', () => {
    const board = occupancyBoard([occupiedTable(1, matchId(99))], []);

    expect(board).toEqual([{ table: occupiedTable(1, matchId(99)), match: null }]);
  });

  it('draws nothing for a tournament with no tables', () => {
    expect(occupancyBoard([], [])).toEqual([]);
  });
});

describe('matchesOnTables', () => {
  it('carries the matches that are on a table and no others', () => {
    const running = midTournament();

    expect(matchesOnTables(running).map((entry) => entry.id)).toEqual([matchId(1)]);
  });

  it('carries nothing while every table is free', () => {
    expect(matchesOnTables(tournament({ groups: [group(1)], tables: [table(1)] }))).toEqual([]);
  });
});

describe('elapsedMs', () => {
  it('measures how long the match has been on the table', () => {
    expect(elapsedMs(FIXED_NOW, '2026-08-23T10:12:30+02:00' as Timestamp)).toBe(750_000);
  });

  it('measures across time zones, because the two stamps carry their own', () => {
    expect(
      elapsedMs('2026-08-23T10:00:00+02:00' as Timestamp, '2026-08-23T09:30:00+01:00' as Timestamp),
    ).toBe(1_800_000);
  });

  /*
   * A file carried across a daylight-saving change, or a laptop whose clock was
   * corrected between two saves, can put the start in the future. A board
   * counting backwards would be reported as a bug during an event.
   */
  it('never counts backwards', () => {
    expect(elapsedMs('2026-08-23T11:00:00+02:00' as Timestamp, FIXED_NOW)).toBe(0);
  });

  it('reports nothing rather than NaN for a stamp it cannot read', () => {
    expect(elapsedMs('gestern' as Timestamp, FIXED_NOW)).toBe(0);
    expect(elapsedMs(FIXED_NOW, 'gestern' as Timestamp)).toBe(0);
  });
});
