import { describe, expect, it } from 'vitest';

import {
  listBackups,
  listTournaments,
  pickTournamentSaveTarget,
  pickTournamentToOpen,
  readTournamentFile,
  toTournamentFileError,
  tournamentsDirectory,
  TournamentFileError,
  writeTournamentFile,
} from '@/platform/tournamentFile';

/**
 * These run without a Tauri backend, which is also how `pnpm dev` in a plain
 * browser runs. Both halves matter: the typed error mapping is what turns a
 * Rust rejection into a German sentence, and the no-backend behaviour is what
 * keeps the start screen rendering while the UI is worked on.
 */

const COPY = { title: 'Titel', filterLabel: 'Turnier' };

describe('toTournamentFileError', () => {
  it('reads the typed error Rust rejects with', () => {
    const error = toTournamentFileError({
      kind: 'permissionDenied',
      detail: 'Access is denied. (os error 5)',
      path: 'C:\\Turniere\\Sommer.wattmatt',
    });

    expect(error.kind).toBe('permissionDenied');
    expect(error.path).toBe('C:\\Turniere\\Sommer.wattmatt');
  });

  it('passes an already typed error straight through', () => {
    const original = new TournamentFileError('notFound', 'gone', null);

    expect(toTournamentFileError(original)).toBe(original);
  });

  /**
   * Anything that is not the contract — a plugin that is not loaded, a shape
   * mismatch — lands in `io`. It is the honest bucket: something below us
   * failed, and the host's next step is the same either way.
   */
  it('falls back to io for anything that is not the contract', () => {
    expect(toTournamentFileError(new Error('boom')).kind).toBe('io');
    expect(toTournamentFileError({ kind: 'unbekannt' }).kind).toBe('io');
    expect(toTournamentFileError(undefined).kind).toBe('io');
  });

  it('keeps the detail for the log rather than losing it', () => {
    expect(toTournamentFileError(new Error('boom')).detail).toBe('boom');
  });
});

describe('without a Tauri backend', () => {
  it('lists an empty library rather than failing the start screen', async () => {
    await expect(listTournaments()).resolves.toEqual([]);
    await expect(listBackups('C:\\x.wattmatt')).resolves.toEqual([]);
  });

  it('has no default directory to offer', async () => {
    await expect(tournamentsDirectory()).resolves.toBeNull();
  });

  it('cancels a dialog it cannot open', async () => {
    await expect(pickTournamentToOpen(COPY, null)).resolves.toBeNull();
    await expect(pickTournamentSaveTarget(COPY, null, 'Sommer.wattmatt')).resolves.toBeNull();
  });

  /**
   * Reading and writing fail loudly, unlike listing. A save that quietly did
   * nothing is the one failure the whole file layer exists to prevent.
   */
  it('refuses to read or write, with a typed error', async () => {
    await expect(readTournamentFile('C:\\x.wattmatt')).rejects.toBeInstanceOf(TournamentFileError);
    await expect(writeTournamentFile('C:\\x.wattmatt', '{}')).rejects.toBeInstanceOf(
      TournamentFileError,
    );
  });
});
