import { tournamentIdSchema } from '@/domain/ids';
import { SCHEMA_VERSION, type TournamentFile, type TournamentFileLike } from '@/domain/schema';
import type { Clock, Settings, Tournament } from '@/domain/types';

/**
 * A valid, empty tournament — what "Neues Turnier" produces before the host has
 * added a single table or group.
 *
 * Everything the tournament cannot derive is passed in: the ID, the RNG seed
 * and the clock. `src/domain` may not invent any of the three
 * (ARCHITECTURE.md §5), which is also what lets a test build the exact same
 * tournament twice and compare them.
 */

/** docs/TOURNAMENT-RULES.md §6: names are entered at the final phase, 16 normally. */
export const DEFAULT_SETTINGS: Settings = {
  participantLabel: 'GROUP',
  namingAt: 16,
  performanceMode: false,
  // The first table first — what every build before issue #101 did, and the
  // only default that cannot surprise a host who never opens the setting.
  tableAssignmentOrder: 'ASCENDING',
};

export type CreateTournamentInput = {
  id: string;
  name: string;
  /** Seed for the draw RNG. Issue #8 owns generating one. */
  rngSeed: string;
  clock: Clock;
  /** Overrides for the host's non-default choices; the rest keep their default. */
  settings?: Partial<Settings>;
};

export function createTournament(input: CreateTournamentInput): Tournament {
  // Created and updated are the same instant, and stay that way until the
  // first committed action — one clock read, not two, so they cannot differ by
  // a millisecond and make a fresh file look already edited.
  const now = input.clock.now();

  return {
    id: tournamentIdSchema.parse(input.id),
    name: input.name,
    createdAt: now,
    updatedAt: now,

    rngSeed: input.rngSeed,
    rngCursor: 0,

    settings: { ...DEFAULT_SETTINGS, ...input.settings },
    phase: 'SETUP',

    tables: [],
    nextTableNumber: 1,
    groups: [],
    nextGroupNumber: 1,
    rounds: [],

    // Skipped and not-yet-reached, respectively — not "empty". A repechage that
    // never happened must be distinguishable from one with an empty draw list
    // (docs/TOURNAMENT-RULES.md §4, edge case 2).
    repechage: null,
    // Null rather than `DECLINED` for the same reason: the host is asked about
    // the `Trostrunde` once the `Hoffnungsrunde` closes, and a new tournament
    // that already said no would take the question away before it was put
    // (docs/TOURNAMENT-RULES.md §10, issue #73).
    consolation: null,
    bracket: null,

    log: [],
  };
}

/** Wrap a tournament for writing to disk (docs/FILE-FORMAT.md). */
export function toTournamentFile(tournament: Tournament, appVersion: string): TournamentFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: { name: 'WattMatt', version: appVersion },
    ...tournament,
  };
}

/**
 * Strip the file stamps back off, yielding what the store owns.
 *
 * Takes the widened `TournamentFileLike` rather than `TournamentFile`: by the
 * time a file reaches here it has been through the migration runner, and what
 * that hands back is a file at the version this build reads — which is the same
 * thing, one `SCHEMA_VERSION` bump later.
 */
export function fromTournamentFile(file: TournamentFileLike): Tournament {
  const { schemaVersion: _schemaVersion, app: _app, ...tournament } = file;
  return tournament;
}
