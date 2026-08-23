import { tournamentIdSchema } from '@/domain/ids';
import { SCHEMA_VERSION, type TournamentFile } from '@/domain/schema';
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
    groups: [],
    rounds: [],

    // Skipped and not-yet-reached, respectively — not "empty". A repechage that
    // never happened must be distinguishable from one with an empty draw list
    // (docs/TOURNAMENT-RULES.md §4, edge case 2).
    repechage: null,
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

/** Strip the file stamps back off, yielding what the store owns. */
export function fromTournamentFile(file: TournamentFile): Tournament {
  const { schemaVersion: _schemaVersion, app: _app, ...tournament } = file;
  return tournament;
}
