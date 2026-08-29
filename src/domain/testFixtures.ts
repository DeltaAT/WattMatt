import { createTournament } from '@/domain/factory';
import {
  bracketNodeIdSchema,
  groupIdSchema,
  matchIdSchema,
  roundIdSchema,
  tableIdSchema,
  type BracketNodeId,
  type GroupId,
  type MatchId,
  type RoundId,
  type TableId,
} from '@/domain/ids';
import type { Clock, Group, Match, Round, Table, Timestamp, Tournament } from '@/domain/types';

/**
 * Builders for domain tests.
 *
 * Every builder takes the fields the test cares about and fills the rest with a
 * plausible default, so a test about table status is not obscured by six
 * unrelated fields. Deliberately not exported from `@/domain` — production code
 * builds entities through actions, never through these.
 */

export const FIXED_NOW = '2026-08-23T10:00:00+02:00' as Timestamp;

export function fixedClock(at: Timestamp = FIXED_NOW): Clock {
  return { now: () => at };
}

export function groupId(n: number): GroupId {
  return groupIdSchema.parse(`grp_${n}`);
}

export function tableId(n: number): TableId {
  return tableIdSchema.parse(`tbl_${n}`);
}

export function matchId(n: number): MatchId {
  return matchIdSchema.parse(`mt_${n}`);
}

export function roundId(n: number): RoundId {
  return roundIdSchema.parse(`rnd_${n}`);
}

export function bracketNodeId(n: number): BracketNodeId {
  return bracketNodeIdSchema.parse(`bn_${n}`);
}

export function group(n: number, overrides: Partial<Group> = {}): Group {
  return { id: groupId(n), number: n, name: null, status: 'ACTIVE', ...overrides };
}

export function table(n: number, overrides: Partial<Table> = {}): Table {
  return {
    id: tableId(n),
    label: `Table ${n}`,
    status: 'FREE',
    currentMatchId: null,
    occupiedSince: null,
    // Serving both tracks, which is what a table means unless a test says
    // otherwise (issue #79).
    reservedFor: null,
    ...overrides,
  };
}

/** A table with a match on it, with the three occupancy fields kept in step. */
export function occupiedTable(
  n: number,
  matchId: MatchId,
  at: Timestamp = FIXED_NOW,
  overrides: Partial<Table> = {},
): Table {
  return table(n, { status: 'OCCUPIED', currentMatchId: matchId, occupiedSince: at, ...overrides });
}

export function match(n: number, overrides: Partial<Match> = {}): Match {
  return {
    id: matchId(n),
    tableId: null,
    a: groupId(1),
    b: groupId(2),
    winnerId: null,
    status: 'WAITING_FOR_TABLE',
    ...overrides,
  };
}

export function round(n: number, overrides: Partial<Round> = {}): Round {
  return {
    id: roundId(n),
    index: n,
    kind: 'QUALIFYING',
    track: 'MAIN',
    label: `Round ${n}`,
    state: 'DRAWN',
    matches: [],
    ...overrides,
  };
}

export function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    ...createTournament({
      id: 'tnm_1',
      name: 'Test Tournament',
      rngSeed: 'seed',
      clock: fixedClock(),
    }),
    ...overrides,
  };
}

/**
 * A tournament that is actually under way, for the tests that must not run on
 * an empty one.
 *
 * Every array `tournamentSchema` carries is non-empty here, and the cross
 * references between them are real: the running match sits on the table that
 * names it, and the bracket's third-place node is one of its own nodes. A
 * round trip that drops or reorders any of that shows up as a difference,
 * which an empty tournament cannot reveal — see CLAUDE.md §7, "works with a
 * tournament loaded mid-tournament".
 */
export function midTournament(overrides: Partial<Tournament> = {}): Tournament {
  const runningMatch = match(1, {
    tableId: tableId(1),
    a: groupId(1),
    b: groupId(2),
    status: 'RUNNING',
  });

  return tournament({
    name: 'Sommerturnier',
    phase: 'BRACKET',
    rngCursor: 17,
    tables: [
      occupiedTable(1, runningMatch.id),
      table(2, { status: 'FREE' }),
      table(3, { status: 'DISABLED' }),
    ],
    // Three tables have been created, so the next one is the fourth — the
    // counter is part of the document and has to be as real as the rest of it.
    nextTableNumber: 4,
    groups: [
      group(1),
      group(2, { name: 'Die Schnellen' }),
      group(3, { status: 'ELIMINATED' }),
      group(4),
    ],
    // Four groups have been created, so the next one is the fifth. Like the
    // table counter, it is part of the document and has to be as real.
    nextGroupNumber: 5,
    rounds: [
      round(1, {
        kind: 'QUALIFYING',
        state: 'CLOSED',
        matches: [match(2, { a: groupId(3), b: groupId(4), winnerId: groupId(4), status: 'DONE' })],
      }),
      round(2, {
        kind: 'BRACKET',
        state: 'RUNNING',
        matches: [runningMatch, match(3, { a: groupId(1), b: groupId(4) })],
      }),
    ],
    repechage: {
      target: 4,
      // Empty because the phase is over: the pot ran dry, the host handed out
      // the missing place as a `Freilos`, and the bracket below is what came of
      // it (docs/TOURNAMENT-RULES.md §4).
      pool: [],
      draws: [{ groupId: groupId(3), accepted: false }],
      fallbackUsed: 'BYES',
    },
    // The one first-round loser the lottery did not take, written down when
    // that lottery closed and immutable since (issue #102,
    // docs/TOURNAMENT-RULES.md §10). Group 3 lost the qualifying round and
    // then declined its second chance, which is exactly what puts it here.
    consolationField: [groupId(3)],
    bracket: {
      size: 4,
      nodes: [
        {
          id: bracketNodeId(1),
          round: 'SEMI_FINAL',
          slotA: groupId(1),
          slotB: groupId(2),
          winnerId: null,
          nextNodeId: bracketNodeId(3),
          tableId: tableId(1),
        },
        {
          id: bracketNodeId(2),
          round: 'THIRD_PLACE',
          slotA: null,
          slotB: null,
          winnerId: null,
          nextNodeId: null,
          tableId: null,
        },
        {
          id: bracketNodeId(3),
          round: 'FINAL',
          slotA: null,
          slotB: null,
          winnerId: null,
          nextNodeId: null,
          tableId: null,
        },
      ],
      thirdPlaceNodeId: bracketNodeId(2),
    },
    log: [
      {
        at: FIXED_NOW,
        action: 'MATCH_WINNER_SET',
        payload: { matchId: 'mt_2', winnerId: 'grp_4' },
      },
      { at: FIXED_NOW, action: 'ROUND_CLOSED', payload: { roundId: 'rnd_1' } },
    ],
    ...overrides,
  });
}
