import { describe, expect, it } from 'vitest';

import { assignMatch, drawRound, queuedMatches } from '@/domain/draw';
import { createRng } from '@/domain/rng';
import { roundBoard } from '@/domain/round';
import { currentRound, freeTables, servesTrack, tablesForTrack } from '@/domain/selectors';
import { disableTable, reserveTable } from '@/domain/tables';
import { group, table, tableId, tournament, FIXED_NOW } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';

/**
 * Reserving a table for one track (issue #79, docs/TOURNAMENT-RULES.md §10).
 *
 * #73 left both tracks drawing from one pool with the host deciding table by
 * table, all evening (docs/OPEN-QUESTIONS.md #87). This is the standing version
 * of that decision, and everything below is a way it could quietly fail to hold:
 * a draw that ignores it, a running match yanked off a table by it, a queue
 * that stops with nothing on screen to say why.
 */

/** Six groups, `tables` tables, a `Trostrunde` under way beside the main field. */
function bothTracks(tables = 4): Tournament {
  return tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: 6 }, (_unused, index) => group(index + 1)),
    nextGroupNumber: 7,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
    consolation: {
      state: 'RUNNING',
      phase: 'QUALIFYING',
      repechage: null,
      bracket: null,
      winnerId: null,
    },
  });
}

/** Draws one round of `track` and hands back the tournament with it on. */
function draw(document: Tournament, track: 'MAIN' | 'CONSOLATION'): Tournament {
  return drawRound(document, {
    at: FIXED_NOW,
    label: (index) => `R${String(index)}`,
    track,
    rng: createRng('reservation'),
  });
}

describe('servesTrack', () => {
  it('lets an unreserved table take either track', () => {
    expect(servesTrack(table(1), 'MAIN')).toBe(true);
    expect(servesTrack(table(1), 'CONSOLATION')).toBe(true);
  });

  it('lets a reserved table take only its own', () => {
    const reserved = table(1, { reservedFor: 'CONSOLATION' });

    expect(servesTrack(reserved, 'CONSOLATION')).toBe(true);
    expect(servesTrack(reserved, 'MAIN')).toBe(false);
  });

  /*
   * A reservation is a standing answer to "where does the draw put things",
   * never a lock on what the host may do with their own tables (golden rule 3).
   * Asking without a track is asking that second question.
   */
  it('says yes to a caller that is not asking on behalf of a track', () => {
    expect(servesTrack(table(1, { reservedFor: 'CONSOLATION' }))).toBe(true);
  });
});

describe('reserveTable', () => {
  it('reserves and releases', () => {
    const reserved = reserveTable(bothTracks(), tableId(1), 'CONSOLATION');
    expect(reserved.tables[0]?.reservedFor).toBe('CONSOLATION');

    const released = reserveTable(reserved, tableId(1), null);
    expect(released.tables[0]?.reservedFor).toBeNull();
  });

  it('hands the tournament back untouched when nothing changes', () => {
    const document = bothTracks();

    expect(reserveTable(document, tableId(1), null)).toBe(document);
    expect(reserveTable(document, tableId(99), 'MAIN')).toBe(document);
  });

  /*
   * The rule hosts get wrong, and the one this shares with `disableTable`
   * (issue #13, rules §0): the pair are playing and the room is watching, so a
   * reservation applies to what happens *next*.
   */
  it('leaves a running match of the other track exactly where it is', () => {
    const running = draw(bothTracks(2), 'MAIN');
    const occupied = running.tables[0];
    expect(occupied?.status).toBe('OCCUPIED');

    const reserved = reserveTable(running, tableId(1), 'CONSOLATION');
    const after = reserved.tables[0];

    expect(after?.status).toBe('OCCUPIED');
    expect(after?.currentMatchId).toBe(occupied?.currentMatchId);
    expect(after?.occupiedSince).toBe(occupied?.occupiedSince);
    expect(after?.reservedFor).toBe('CONSOLATION');
  });
});

describe('freeTables, asked on behalf of a track', () => {
  const reserved = reserveTable(
    reserveTable(bothTracks(), tableId(1), 'CONSOLATION'),
    tableId(2),
    'MAIN',
  );

  it('offers a track its own tables and the unreserved ones', () => {
    expect(freeTables(reserved, 'MAIN').map((entry) => entry.id)).toEqual([
      tableId(2),
      tableId(3),
      tableId(4),
    ]);
    expect(freeTables(reserved, 'CONSOLATION').map((entry) => entry.id)).toEqual([
      tableId(1),
      tableId(3),
      tableId(4),
    ]);
  });

  it('offers every free table when no track is named', () => {
    expect(freeTables(reserved)).toHaveLength(4);
  });
});

describe('a draw', () => {
  /*
   * The issue's first test, and the whole point of the feature. Three pairs and
   * four tables, of which two are the other track's: exactly two pairs may
   * start.
   */
  it('never takes a table reserved for the other track', () => {
    const reserved = reserveTable(
      reserveTable(bothTracks(), tableId(1), 'CONSOLATION'),
      tableId(2),
      'CONSOLATION',
    );

    const drawn = draw(reserved, 'MAIN');
    const round = currentRound(drawn, 'MAIN');

    expect(round).not.toBeNull();
    expect(drawn.tables.filter((entry) => entry.status === 'OCCUPIED').map((e) => e.id)).toEqual([
      tableId(3),
      tableId(4),
    ]);
    expect(queuedMatches(round!)).toHaveLength(1);
  });

  /*
   * The issue's second test. Everything queues, nothing throws, and the round
   * exists — a draw that refused itself would leave the host with no pairings
   * at all and nothing to reassign a table to.
   */
  it('queues the whole round when every table belongs to the other track', () => {
    let reserved = bothTracks();
    for (const entry of reserved.tables) {
      reserved = reserveTable(reserved, entry.id, 'CONSOLATION');
    }

    const drawn = draw(reserved, 'MAIN');
    const round = currentRound(drawn, 'MAIN');

    expect(round).not.toBeNull();
    expect(round?.matches).toHaveLength(3);
    expect(queuedMatches(round!)).toHaveLength(3);
    expect(drawn.tables.every((entry) => entry.status === 'FREE')).toBe(true);
  });

  it('and the host is told why, in the words for the reason they have', () => {
    let reserved = bothTracks();
    for (const entry of reserved.tables) {
      reserved = reserveTable(reserved, entry.id, 'CONSOLATION');
    }
    const drawn = draw(reserved, 'MAIN');

    expect(roundBoard(drawn, currentRound(drawn, 'MAIN')!).stalled).toBe('RESERVED_ELSEWHERE');
  });

  /*
   * The other reason a queue can be stuck, and the reason it has to be a
   * different sentence: this one is a problem with the room and no reservation
   * will fix it.
   */
  it('says the room is the problem when every table is out of service', () => {
    let document = draw(bothTracks(1), 'MAIN');
    document = disableTable(document, tableId(1));

    expect(roundBoard(document, currentRound(document, 'MAIN')!).stalled).toBe('NO_USABLE_TABLE');
  });

  /* A queue behind busy tables is the tournament working as §3 intends. */
  it('says nothing while tables are simply busy', () => {
    const drawn = draw(bothTracks(1), 'MAIN');

    expect(queuedMatches(currentRound(drawn, 'MAIN')!).length).toBeGreaterThan(0);
    expect(roundBoard(drawn, currentRound(drawn, 'MAIN')!).stalled).toBeNull();
  });
});

describe('assignMatch', () => {
  /*
   * The panel does not offer the button, so this is the guard against a stale
   * click — a host who pressed *Nächste Partie starten* just as the reservation
   * changed under them.
   */
  it('refuses a table reserved for the other track', () => {
    let document = draw(bothTracks(1), 'MAIN');
    const queued = queuedMatches(currentRound(document, 'MAIN')!)[0];
    document = reserveTable(
      { ...document, tables: [...document.tables, table(2)] },
      tableId(2),
      'CONSOLATION',
    );

    const after = assignMatch(document, {
      matchId: queued!.id,
      tableId: tableId(2),
      at: FIXED_NOW,
    });

    expect(after).toBe(document);
  });

  it('accepts one reserved for its own track', () => {
    let document = draw(bothTracks(1), 'MAIN');
    const queued = queuedMatches(currentRound(document, 'MAIN')!)[0];
    document = reserveTable(
      { ...document, tables: [...document.tables, table(2)] },
      tableId(2),
      'MAIN',
    );

    const after = assignMatch(document, {
      matchId: queued!.id,
      tableId: tableId(2),
      at: FIXED_NOW,
    });

    expect(after.tables[1]?.currentMatchId).toBe(queued!.id);
  });
});

describe('tablesForTrack', () => {
  it('counts the tables a track may ever use, busy ones included', () => {
    const document = reserveTable(bothTracks(3), tableId(1), 'CONSOLATION');

    expect(tablesForTrack(document, 'MAIN').map((entry) => entry.id)).toEqual([
      tableId(2),
      tableId(3),
    ]);
    expect(tablesForTrack(document, 'CONSOLATION')).toHaveLength(3);
  });

  it('leaves a table that is out of service out of both', () => {
    const document = disableTable(bothTracks(2), tableId(1));

    expect(tablesForTrack(document, 'MAIN').map((entry) => entry.id)).toEqual([tableId(2)]);
  });
});
