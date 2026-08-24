import { describe, expect, it } from 'vitest';

import { beamerBoard, matchPhase } from '@/domain/round';
import { groupId, match, occupiedTable, table, tableId } from '@/domain/testFixtures';

/**
 * The beamer's round board, grouped by table (issue #19).
 *
 * The load-bearing decision here is that a match is grouped by its **own**
 * `tableId`, not by `table.currentMatchId`. Marking a winner frees the table,
 * so the other reading would make the card disappear from its slot at the exact
 * moment the audience is looking at it — and the green/red flip the whole issue
 * is about would never be seen.
 */

const pairing = (n: number, table: number | null, extra = {}) =>
  match(n, {
    a: groupId(n * 2 - 1),
    b: groupId(n * 2),
    tableId: table === null ? null : tableId(table),
    ...extra,
  });

describe('beamerBoard', () => {
  it('puts each match under the table it was assigned to', () => {
    const board = beamerBoard([table(1), table(2)], [pairing(1, 1), pairing(2, 2)]);

    expect(board).toHaveLength(2);
    expect(board[0]?.table?.id).toBe(tableId(1));
    expect(board[0]?.matches.map((entry) => entry.id)).toEqual([pairing(1, 1).id]);
  });

  it('keeps the tables in the order the host arranged them', () => {
    const board = beamerBoard([table(3), table(1), table(2)], []);
    expect(board.map((section) => section.table?.label)).toEqual(['Table 3', 'Table 1', 'Table 2']);
  });

  /*
   * The acceptance criterion "no layout shift when a result comes in". A
   * decided match has released its table — `table.currentMatchId` is null — but
   * it keeps its own `tableId`, so its card stays exactly where it was and only
   * changes colour.
   */
  it('keeps a decided match in its table section after the table is freed', () => {
    const decided = pairing(1, 1, { winnerId: groupId(1), status: 'DONE' as const });
    // The table has already been freed, as `setWinner` leaves it.
    const board = beamerBoard([table(1, { status: 'FREE' })], [decided]);

    expect(board[0]?.matches.map((entry) => entry.id)).toEqual([decided.id]);
  });

  it('holds both matches a table has hosted, in draw order', () => {
    const first = pairing(1, 1, { winnerId: groupId(1), status: 'DONE' as const });
    const second = pairing(2, 1, { status: 'RUNNING' as const });
    const board = beamerBoard([occupiedTable(1, second.id)], [first, second]);

    expect(board[0]?.matches.map((entry) => entry.id)).toEqual([first.id, second.id]);
  });

  /* The queue is a section of its own, and it comes last: the room reads the
   * tables first, because that is where something is happening. */
  it('collects the matches with no table into a queue section at the end', () => {
    const board = beamerBoard([table(1)], [pairing(1, 1), pairing(2, null), pairing(3, null)]);

    expect(board).toHaveLength(2);
    expect(board.at(-1)?.table).toBeNull();
    expect(board.at(-1)?.matches).toHaveLength(2);
  });

  /* A board with enough tables for every pairing must not carry an empty
   * heading — the beamer shows one idea per screen (docs/STYLEGUIDE.md §3). */
  it('omits the queue section entirely when nothing is waiting', () => {
    const board = beamerBoard([table(1), table(2)], [pairing(1, 1), pairing(2, 2)]);

    expect(board.every((section) => section.table !== null)).toBe(true);
  });

  it('keeps a table with nothing on it, so the room can see it is free', () => {
    const board = beamerBoard([table(1), table(2)], [pairing(1, 1)]);

    expect(board).toHaveLength(2);
    expect(board[1]?.matches).toEqual([]);
  });

  it('handles a round with no matches at all', () => {
    expect(beamerBoard([table(1)], [])).toEqual([{ table: table(1), matches: [] }]);
  });

  /* A bye never touches a table, so it belongs in the queue section — it is
   * decided from the moment it is drawn, and the card says so. */
  it('places a bye with the waiting matches', () => {
    const bye = match(9, { a: groupId(9), b: null, winnerId: groupId(9), status: 'DONE' });
    const board = beamerBoard([table(1)], [pairing(1, 1), bye]);

    expect(board.at(-1)?.table).toBeNull();
    expect(board.at(-1)?.matches.map((entry) => entry.id)).toEqual([bye.id]);
  });
});

describe('matchPhase', () => {
  it('is WAITING while the match has no table', () => {
    expect(matchPhase(pairing(1, null))).toBe('WAITING');
  });

  it('is RUNNING once it is on a table', () => {
    expect(matchPhase(pairing(1, 1, { status: 'RUNNING' as const }))).toBe('RUNNING');
  });

  it('is FINISHED once it has a winner', () => {
    expect(matchPhase(pairing(1, 1, { winnerId: groupId(1), status: 'DONE' as const }))).toBe(
      'FINISHED',
    );
  });

  /*
   * Keyed on the winner rather than on `status`, so a card cannot be painted
   * green while its ribbon still reads `LÄUFT`. A bye is decided by the draw
   * and never sees a table.
   */
  it('is FINISHED for a bye, which never reaches a table', () => {
    const bye = match(9, { a: groupId(9), b: null, winnerId: groupId(9), status: 'DONE' });
    expect(matchPhase(bye)).toBe('FINISHED');
  });

  it('agrees with the colour when a result is corrected', () => {
    // A correction goes back through `setWinner`, which leaves the table freed
    // and the tableId in place.
    const corrected = pairing(1, 1, { winnerId: groupId(2), status: 'DONE' as const });
    expect(matchPhase(corrected)).toBe('FINISHED');
  });
});
