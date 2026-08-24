import { describe, expect, it } from 'vitest';

import { drawRound } from '@/domain/draw';
import {
  nextPowerOfTwo,
  repechageOutlook,
  roundBoard,
  roundProgress,
  roundSummary,
} from '@/domain/round';
import {
  FIXED_NOW,
  group,
  groupId,
  match,
  matchId,
  occupiedTable,
  round,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';

/**
 * What the round panel reads (issue #17).
 *
 * The decisions themselves are `@/domain/draw`'s and are tested there. What is
 * checked here is the arithmetic the host reads off the screen: the progress in
 * the header, which of the three places a match is in, and the repechage target
 * the summary promises — the three things that would be wrong on the projector
 * before anybody noticed they were wrong in the code.
 */

/** A drawn qualifying round on two tables, from the real draw engine. */
function drawn(groups: number, tables: number) {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });
  return drawRound(base, { at: FIXED_NOW, label: (n) => `Runde ${n}` });
}

const openRound = (document: ReturnType<typeof drawn>) => {
  const first = document.rounds[0];
  if (first === undefined) {
    throw new Error('nothing was drawn');
  }
  return first;
};

describe('roundProgress', () => {
  it('counts a round nobody has decided yet', () => {
    const decided = round(1, { matches: [match(1), match(2), match(3)] });
    expect(roundProgress(decided)).toEqual({ decided: 0, open: 3, total: 3 });
  });

  it('counts a bye as decided, because the draw decided it', () => {
    // docs/TOURNAMENT-RULES.md §3: the group with no opponent advances without
    // playing, so the host has nothing left to press for it.
    const withBye = round(1, {
      matches: [match(1), match(2, { b: null, winnerId: groupId(1), status: 'DONE' })],
    });
    expect(roundProgress(withBye)).toEqual({ decided: 1, open: 1, total: 2 });
  });

  it('reads an empty round as nothing to do rather than as finished', () => {
    expect(roundProgress(round(1))).toEqual({ decided: 0, open: 0, total: 0 });
  });
});

describe('roundBoard', () => {
  it('puts every match in exactly one of the three places', () => {
    // Five groups on two tables: two pairs on the tables, none left over for
    // the queue at this size — so the fifth group's bye is the decided one.
    const document = drawn(5, 2);
    const board = roundBoard(document, openRound(document));

    const onTables = board.tables.flatMap((slot) => (slot.match === null ? [] : [slot.match.id]));
    const everywhere = [
      ...onTables,
      ...board.queued.map((m) => m.id),
      ...board.decided.map((m) => m.id),
    ];

    expect(new Set(everywhere).size).toBe(everywhere.length);
    expect(new Set(everywhere)).toEqual(new Set(openRound(document).matches.map((m) => m.id)));
  });

  it('queues the matches that found no free table, in draw order', () => {
    const document = drawn(8, 1);
    const drawnRound = openRound(document);
    const board = roundBoard(document, drawnRound);

    expect(board.tables.filter((slot) => slot.match !== null)).toHaveLength(1);
    // Three of the four pairs are waiting, and they are waiting in the order
    // they were drawn — the position they earned (§3).
    expect(board.queued.map((queued) => queued.id)).toEqual(
      drawnRound.matches.slice(1).map((waiting) => waiting.id),
    );
  });

  it('keeps every table on the board, including the free and the disabled one', () => {
    const document = tournament({
      tables: [table(1), table(2, { status: 'DISABLED' })],
      rounds: [round(1, { matches: [match(1)] })],
    });
    const board = roundBoard(document, openRound(document));

    expect(board.tables.map((slot) => slot.table.id)).toEqual([tableId(1), tableId(2)]);
    expect(board.tables.every((slot) => slot.match === null)).toBe(true);
  });

  it('does not show a table the match of an older round is still named on', () => {
    // A closed round's table would otherwise draw a pairing on the board that
    // nobody is playing any more.
    const stale = match(9, { tableId: tableId(1), winnerId: groupId(1), status: 'DONE' });
    const document = tournament({
      tables: [occupiedTable(1, stale.id)],
      rounds: [round(1, { state: 'CLOSED', matches: [stale] }), round(2, { matches: [match(1)] })],
    });
    const current = document.rounds[1];
    if (current === undefined) {
      throw new Error('no second round');
    }

    expect(roundBoard(document, current).tables[0]?.match).toBeNull();
  });

  it('takes a decided match off its table and into the decided list', () => {
    const decided = match(1, { tableId: tableId(1), winnerId: groupId(1), status: 'DONE' });
    const document = tournament({
      tables: [table(1)],
      rounds: [round(1, { matches: [decided, match(2)] })],
    });
    const board = roundBoard(document, openRound(document));

    expect(board.decided.map((m) => m.id)).toEqual([matchId(1)]);
    expect(board.queued.map((m) => m.id)).toEqual([matchId(2)]);
    expect(board.progress).toEqual({ decided: 1, open: 1, total: 2 });
  });
});

describe('nextPowerOfTwo', () => {
  it('leaves a power of two alone', () => {
    for (const power of [1, 2, 4, 8, 16, 32, 64]) {
      expect(nextPowerOfTwo(power)).toBe(power);
    }
  });

  it('rounds up to the next one', () => {
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
    expect(nextPowerOfTwo(17)).toBe(32);
  });

  it('has nothing to round up when there is nobody', () => {
    expect(nextPowerOfTwo(0)).toBe(0);
  });
});

describe('repechageOutlook', () => {
  it('reads the field size off the draw rather than off the decided matches', () => {
    // Twelve pairs, none of them played: |W| at the close is 12 whatever the
    // host has pressed so far, because every match produces exactly one winner.
    const twelve = round(1, {
      kind: 'QUALIFYING',
      matches: Array.from({ length: 12 }, (_unused, index) => match(index + 1)),
    });

    expect(repechageOutlook(twelve)).toEqual({
      winners: 12,
      target: 16,
      need: 4,
      skipped: false,
    });
  });

  it('does not change as the host decides matches', () => {
    const matches = Array.from({ length: 12 }, (_unused, index) => match(index + 1));
    const half = round(1, {
      kind: 'QUALIFYING',
      matches: matches.map((each, index) =>
        index < 7 ? { ...each, winnerId: each.a, status: 'DONE' as const } : each,
      ),
    });

    expect(repechageOutlook(half)?.target).toBe(16);
  });

  it('skips the phase when the field is already a power of two', () => {
    const eight = round(1, {
      kind: 'QUALIFYING',
      matches: Array.from({ length: 8 }, (_unused, index) => match(index + 1)),
    });

    expect(repechageOutlook(eight)).toEqual({ winners: 8, target: 8, need: 0, skipped: true });
  });

  it('counts a bye as a winner like any other match', () => {
    // Five groups produce two pairs and a bye: three winners, target four.
    const document = drawn(5, 2);
    expect(repechageOutlook(openRound(document))).toEqual({
      winners: 3,
      target: 4,
      need: 1,
      skipped: false,
    });
  });

  it('says nothing about a round the repechage does not follow', () => {
    // docs/TOURNAMENT-RULES.md §1: REPECHAGE comes after QUALIFYING and after
    // nothing else.
    for (const kind of ['ELIMINATION', 'REPECHAGE', 'BRACKET'] as const) {
      expect(
        repechageOutlook(round(1, { kind, matches: [match(1), match(2), match(3)] })),
      ).toBeNull();
    }
  });
});

describe('roundSummary', () => {
  it('names the winners and the losers of the matches decided so far', () => {
    const decided = round(1, {
      matches: [
        match(1, { a: groupId(1), b: groupId(2), winnerId: groupId(2), status: 'DONE' }),
        match(2, { a: groupId(3), b: groupId(4) }),
        match(3, { a: groupId(5), b: null, winnerId: groupId(5), status: 'DONE' }),
      ],
    });
    const summary = roundSummary(decided);

    expect(summary.winners).toEqual([groupId(2), groupId(5)]);
    // The bye produced no loser, and the undecided match produced neither.
    expect(summary.losers).toEqual([groupId(1)]);
    expect(summary.progress).toEqual({ decided: 2, open: 1, total: 3 });
    expect(summary.repechage?.target).toBe(4);
  });
});
