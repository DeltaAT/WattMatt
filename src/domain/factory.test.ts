import { describe, expect, it } from 'vitest';

import {
  createTournament,
  DEFAULT_SETTINGS,
  fromTournamentFile,
  toTournamentFile,
} from '@/domain/factory';
import { SCHEMA_VERSION, tournamentFileSchema } from '@/domain/schema';
import { tournamentSchema, type Clock, type Timestamp } from '@/domain/types';

const FIXED_NOW = '2026-08-23T10:00:00+02:00' as Timestamp;

/** A clock frozen at one instant — src/domain never reads the real one. */
function fixedClock(at: Timestamp = FIXED_NOW): Clock {
  return { now: () => at };
}

function newTournament(): ReturnType<typeof createTournament> {
  return createTournament({
    id: 'tnm_1',
    name: 'Test Tournament',
    rngSeed: '8f3c1a7e',
    clock: fixedClock(),
  });
}

describe('createTournament', () => {
  it('produces a tournament that validates against the schema', () => {
    expect(() => tournamentSchema.parse(newTournament())).not.toThrow();
  });

  it('starts in SETUP with nothing in it', () => {
    const tournament = newTournament();
    expect(tournament.phase).toBe('SETUP');
    expect(tournament.groups).toEqual([]);
    expect(tournament.tables).toEqual([]);
    expect(tournament.rounds).toEqual([]);
    expect(tournament.log).toEqual([]);
  });

  /*
   * Null, not an empty object. A repechage that was skipped because the winner
   * count was already a power of two must stay distinguishable from one that
   * ran and drew nobody (docs/TOURNAMENT-RULES.md §4, edge case 2) — an empty
   * `draws` array would show the audience an empty Hoffnungsrunde scene.
   */
  it('leaves the optional phases null rather than empty', () => {
    const tournament = newTournament();
    expect(tournament.repechage).toBeNull();
    expect(tournament.bracket).toBeNull();
  });

  it('reads the clock once, so a fresh tournament is not already edited', () => {
    const tournament = newTournament();
    expect(tournament.createdAt).toBe(FIXED_NOW);
    expect(tournament.updatedAt).toBe(tournament.createdAt);
  });

  it('starts the RNG cursor at zero so the seed alone reproduces every draw', () => {
    const tournament = newTournament();
    expect(tournament.rngSeed).toBe('8f3c1a7e');
    expect(tournament.rngCursor).toBe(0);
  });

  it('applies the documented defaults', () => {
    expect(newTournament().settings).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.namingAt).toBe(16);
    expect(DEFAULT_SETTINGS.performanceMode).toBe(false);
  });

  it('overrides only the settings it is given', () => {
    const tournament = createTournament({
      id: 'tnm_1',
      name: 'Test Tournament',
      rngSeed: 'seed',
      clock: fixedClock(),
      settings: { participantLabel: 'TEAM' },
    });

    expect(tournament.settings.participantLabel).toBe('TEAM');
    expect(tournament.settings.namingAt).toBe(DEFAULT_SETTINGS.namingAt);
  });

  it('is reproducible: same inputs, same tournament', () => {
    expect(newTournament()).toEqual(newTournament());
  });

  it('rejects an empty id', () => {
    expect(() =>
      createTournament({ id: '', name: 'X', rngSeed: 'seed', clock: fixedClock() }),
    ).toThrow();
  });
});

describe('file wrapping', () => {
  it('stamps the schema version and the app on the way out', () => {
    const file = toTournamentFile(newTournament(), '0.1.0');
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.app).toEqual({ name: 'WattMatt', version: '0.1.0' });
    expect(() => tournamentFileSchema.parse(file)).not.toThrow();
  });

  it('round-trips a tournament through the file shape unchanged', () => {
    const tournament = newTournament();
    expect(fromTournamentFile(toTournamentFile(tournament, '0.1.0'))).toEqual(tournament);
  });

  it('leaves no file-only field behind on the way back in', () => {
    const tournament = fromTournamentFile(toTournamentFile(newTournament(), '0.1.0'));
    expect(tournament).not.toHaveProperty('schemaVersion');
    expect(tournament).not.toHaveProperty('app');
  });
});
