import { createTournament } from '@/domain/factory';
import {
  groupIdSchema,
  matchIdSchema,
  roundIdSchema,
  tableIdSchema,
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

export function group(n: number, overrides: Partial<Group> = {}): Group {
  return { id: groupId(n), number: n, name: null, status: 'ACTIVE', ...overrides };
}

export function table(n: number, overrides: Partial<Table> = {}): Table {
  return {
    id: tableId(n),
    label: `Tisch ${n}`,
    status: 'FREE',
    currentMatchId: null,
    ...overrides,
  };
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
    label: `Runde ${n}`,
    state: 'DRAWN',
    matches: [],
    ...overrides,
  };
}

export function tournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    ...createTournament({
      id: 'tnm_1',
      name: 'Vereinsturnier 2026',
      rngSeed: 'seed',
      clock: fixedClock(),
    }),
    ...overrides,
  };
}
