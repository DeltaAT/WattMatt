import { describe, expect, it, vi } from 'vitest';

import { IDLE_SCENE } from '@/domain/beamerScene';
import { SCHEMA_VERSION } from '@/domain/schema';
import { fixedClock, group, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import {
  TournamentFileError,
  type BackupEntry,
  type TournamentEntry,
} from '@/platform/tournamentFile';
import {
  createTournamentDocument,
  openTournamentAt,
  openTournamentWithDialog,
  parseTournamentFile,
  saveTournament,
  saveTournamentAs,
  serialiseTournament,
  closeTournamentDocument,
  type PersistenceDeps,
  type PersistenceFiles,
} from '@/store/persistence';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

/**
 * A file system in a Map.
 *
 * Every failure the host can hit lives in a branch of `persistence.ts`, and a
 * pulled USB stick, a locked file and a disk that is full are not things a test
 * can arrange on a real one. `fail` is how each of them is reproduced.
 */
const LIBRARY = 'C:\\AppData\\WattMatt\\tournaments';

function fakeFiles(initial: Record<string, string> = {}) {
  const disk = new Map(Object.entries(initial));
  let readFailure: Error | null = null;
  let writeFailure: Error | null = null;
  let directory: string | null = LIBRARY;
  let backups: BackupEntry[] = [];

  const api: PersistenceFiles = {
    read: async (path: string) => {
      if (readFailure) {
        throw readFailure;
      }
      const contents = disk.get(path);
      if (contents === undefined) {
        throw new TournamentFileError('notFound', 'missing', path);
      }
      return contents;
    },
    write: async (path: string, contents: string) => {
      if (writeFailure) {
        throw writeFailure;
      }
      disk.set(path, contents);
    },
    list: async (): Promise<TournamentEntry[]> =>
      [...disk.keys()].map((path) => ({
        path,
        fileName: path.split('\\').pop() ?? path,
        modifiedAt: 0,
        bytes: 0,
      })),
    listBackups: async () => backups,
    directory: async () => directory,
  };

  return {
    disk,
    api,
    failWrite(error: Error) {
      writeFailure = error;
    },
    failRead(error: Error) {
      readFailure = error;
    },
    noDirectory() {
      directory = null;
    },
    setBackups(entries: BackupEntry[]) {
      backups = entries;
    },
  };
}

function deps(
  files: ReturnType<typeof fakeFiles>,
  overrides: Partial<PersistenceDeps> = {},
): PersistenceDeps {
  return {
    files: files.api,
    dialogs: {
      pickOpen: async () => null,
      pickSave: async () => null,
    },
    clock: fixedClock(),
    newId: () => 'tnm_test',
    newSeed: () => 'seed_test',
    appVersion: '0.1.0',
    fallbackFileBase: 'Turnier',
    ...overrides,
  };
}

function setup(initial: Record<string, string> = {}) {
  return { store: createTournamentStore(), files: fakeFiles(initial) };
}

describe('serialiseTournament / parseTournamentFile', () => {
  /**
   * Issue #9 acceptance criterion: a tournament saved on laptop A opens on
   * laptop B with identical state. Same bytes, same object — anything the
   * schema silently drops shows up here as a difference.
   */
  it('round-trips a tournament unchanged', () => {
    const original: Tournament = tournament({
      groups: [group(1), group(2, { name: 'Die Schnellen', status: 'ELIMINATED' })],
      rngCursor: 42,
    });

    const parsed = parseTournamentFile(serialiseTournament(original, '0.1.0'));

    expect(parsed).toEqual(original);
  });

  it('writes UTF-8 JSON with a two-space indent (docs/FILE-FORMAT.md)', () => {
    const raw = serialiseTournament(tournament({ name: 'Sommerturnier Grünau' }), '0.1.0');

    expect(raw).toContain('\n  "schemaVersion": 1');
    expect(raw).toContain('Grünau');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('stamps the schema version and the build that wrote the file', () => {
    const raw = serialiseTournament(tournament(), '0.4.2');

    expect(JSON.parse(raw)).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      app: { name: 'WattMatt', version: '0.4.2' },
    });
  });

  it('refuses bytes that are not JSON at all', () => {
    expect(parseTournamentFile('not a tournament')).toBeNull();
  });

  it('refuses JSON that is not a tournament', () => {
    expect(parseTournamentFile('{"schemaVersion": 1}')).toBeNull();
  });

  it('refuses a file from a schema version this build does not know', () => {
    const raw = serialiseTournament(tournament(), '0.1.0');
    const claimingTheFuture = raw.replace('"schemaVersion": 1', '"schemaVersion": 99');

    expect(parseTournamentFile(claimingTheFuture)).toBeNull();
  });

  it('refuses a file whose group is missing a field', () => {
    const raw = serialiseTournament(tournament({ groups: [group(1)] }), '0.1.0');
    const damaged = raw.replace('"status": "ACTIVE"', '"status": "GEWONNEN"');

    expect(parseTournamentFile(damaged)).toBeNull();
  });
});

describe('createTournamentDocument', () => {
  it('opens the tournament and writes it to the library straight away', async () => {
    const { store, files } = setup();

    const outcome = await createTournamentDocument(store, deps(files), {
      name: 'Vereinsturnier 2026',
    });

    const path = `${LIBRARY}\\Vereinsturnier 2026.wattmatt`;
    expect(outcome).toEqual({ status: 'created', path });
    expect(store.getState().document?.name).toBe('Vereinsturnier 2026');
    expect(store.getState().file).toEqual({ status: 'saved', path });
    expect(files.disk.has(path)).toBe(true);
  });

  it('draws the seed once, from the injected source', async () => {
    const { store, files } = setup();
    const newSeed = vi.fn(() => 'seed_abc');

    await createTournamentDocument(store, deps(files, { newSeed }), { name: 'T' });

    expect(newSeed).toHaveBeenCalledTimes(1);
    expect(store.getState().document?.rngSeed).toBe('seed_abc');
    expect(store.getState().document?.rngCursor).toBe(0);
  });

  it('never overwrites a tournament of the same name', async () => {
    const { store, files } = setup({ [`${LIBRARY}\\Vereinsturnier.wattmatt`]: '{}' });

    const outcome = await createTournamentDocument(store, deps(files), {
      name: 'Vereinsturnier',
    });

    expect(outcome).toEqual({
      status: 'created',
      path: `${LIBRARY}\\Vereinsturnier (2).wattmatt`,
    });
    expect(files.disk.get(`${LIBRARY}\\Vereinsturnier.wattmatt`)).toBe('{}');
  });

  /**
   * A library that cannot be written to must not cost the host the tournament
   * they have just named. They keep it, they are told, and "Speichern unter…"
   * is the way out (issue #10's disk-full edge case).
   */
  it('keeps the tournament in memory when the first write fails', async () => {
    const { store, files } = setup();
    files.failWrite(new TournamentFileError('permissionDenied', 'denied', null));

    const outcome = await createTournamentDocument(store, deps(files), { name: 'T' });

    expect(outcome).toEqual({ status: 'unwritten', kind: 'permissionDenied' });
    expect(store.getState().document?.name).toBe('T');
    expect(store.getState().file).toEqual({ status: 'unsaved' });
  });

  it('reports the missing library rather than inventing a path', async () => {
    const { store, files } = setup();
    files.noDirectory();

    const outcome = await createTournamentDocument(store, deps(files), { name: 'T' });

    expect(outcome).toEqual({ status: 'unwritten', kind: 'noDataDirectory' });
    expect(files.disk.size).toBe(0);
  });

  it('projects the new tournament onto the beamer snapshot', async () => {
    const { store, files } = setup();

    await createTournamentDocument(store, deps(files), { name: 'T' });

    expect(store.getState().tournament).toEqual({ groups: [] });
    expect(store.getState().scene).toEqual(IDLE_SCENE);
  });
});

describe('openTournamentAt', () => {
  const path = `${LIBRARY}\\Sommer.wattmatt`;

  function saved(): Record<string, string> {
    return {
      [path]: serialiseTournament(
        tournament({ name: 'Sommerturnier', groups: [group(1), group(2)] }),
        '0.1.0',
      ),
    };
  }

  it('opens a valid file as saved, not modified', async () => {
    const { store, files } = setup(saved());

    const outcome = await openTournamentAt(store, deps(files), path);

    expect(outcome).toEqual({ status: 'opened', path });
    expect(store.getState().document?.name).toBe('Sommerturnier');
    expect(store.getState().file).toEqual({ status: 'saved', path });
  });

  it('hands the opened tournament to the beamer', async () => {
    const { store, files } = setup(saved());

    await openTournamentAt(store, deps(files), path);

    expect(store.getState().tournament.groups.map((entry) => entry.number)).toEqual([1, 2]);
  });

  /**
   * Issue #9 acceptance criterion: a hand-corrupted file produces a clear
   * message, never a white screen — and never a half-loaded tournament
   * (docs/FILE-FORMAT.md rule 1). What was open stays open.
   */
  it('leaves the open tournament alone when the file is corrupt', async () => {
    const { store, files } = setup({ ...saved(), [`${LIBRARY}\\broken.wattmatt`]: '{ "a": ' });
    await openTournamentAt(store, deps(files), path);
    const before = store.getState().document;

    const outcome = await openTournamentAt(store, deps(files), `${LIBRARY}\\broken.wattmatt`);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid' });
    expect(store.getState().document).toBe(before);
    expect(store.getState().file).toEqual({ status: 'saved', path });
  });

  it('offers the newest backup of a file that would not parse', async () => {
    const { store, files } = setup({ [`${LIBRARY}\\broken.wattmatt`]: 'nonsense' });
    files.setBackups([
      { path: `${LIBRARY}\\broken.wattmatt.bak1`, suffix: 'bak1', modifiedAt: 2, bytes: 10 },
      { path: `${LIBRARY}\\broken.wattmatt.bak2`, suffix: 'bak2', modifiedAt: 1, bytes: 10 },
    ]);

    const outcome = await openTournamentAt(store, deps(files), `${LIBRARY}\\broken.wattmatt`);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid' });
    expect(outcome.status === 'failed' && outcome.backups[0]?.suffix).toBe('bak1');
  });

  it('separates a file it could not read from one it could not parse', async () => {
    const { store, files } = setup();
    files.failRead(new TournamentFileError('notFound', 'gone', null));

    const outcome = await openTournamentAt(store, deps(files), path);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'unreadable', path });
  });

  it('reports no backups rather than failing when they cannot be listed', async () => {
    const { store, files } = setup({ [`${LIBRARY}\\broken.wattmatt`]: 'nonsense' });
    const listBackups = async () => {
      throw new Error('drive removed');
    };

    const outcome = await openTournamentAt(
      store,
      deps(files, { files: { ...files.api, listBackups } }),
      `${LIBRARY}\\broken.wattmatt`,
    );

    expect(outcome).toMatchObject({ status: 'failed', backups: [] });
  });
});

describe('openTournamentWithDialog', () => {
  it('does nothing when the host cancels', async () => {
    const { store, files } = setup();

    const outcome = await openTournamentWithDialog(store, deps(files));

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(store.getState().document).toBeNull();
  });

  it('opens the file the host picked', async () => {
    const path = 'D:\\USB\\Sommer.wattmatt';
    const { store, files } = setup({ [path]: serialiseTournament(tournament(), '0.1.0') });

    const outcome = await openTournamentWithDialog(
      store,
      deps(files, { dialogs: { pickOpen: async () => path, pickSave: async () => null } }),
    );

    expect(outcome).toEqual({ status: 'opened', path });
  });

  it('opens the dialog in the default library', async () => {
    const { store, files } = setup();
    const pickOpen = vi.fn(async () => null);

    await openTournamentWithDialog(
      store,
      deps(files, { dialogs: { pickOpen, pickSave: async () => null } }),
    );

    expect(pickOpen).toHaveBeenCalledWith(LIBRARY);
  });
});

describe('saveTournament', () => {
  async function opened() {
    const { store, files } = setup();
    await createTournamentDocument(store, deps(files), { name: 'Sommer' });
    return { store, files, path: `${LIBRARY}\\Sommer.wattmatt` };
  }

  /** Stands in for the actions later issues add; the point is that they commit. */
  function editTournament(store: TournamentStore, name: string): void {
    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, name },
    }));
  }

  it('marks the tournament modified as soon as anything changes it', async () => {
    const { store } = await opened();

    editTournament(store, 'Sommerturnier');

    expect(store.getState().file).toMatchObject({ status: 'modified' });
  });

  it('writes to the file it already has and clears the modified state', async () => {
    const { store, files, path } = await opened();
    editTournament(store, 'Sommerturnier');

    const outcome = await saveTournament(store, deps(files));

    expect(outcome).toEqual({ status: 'saved', path });
    expect(store.getState().file).toEqual({ status: 'saved', path });
    expect(parseTournamentFile(files.disk.get(path) ?? '')?.name).toBe('Sommerturnier');
  });

  it('stays modified when the write fails, so nothing looks safe that is not', async () => {
    const { store, files } = await opened();
    editTournament(store, 'Sommerturnier');
    files.failWrite(new TournamentFileError('io', 'disk full', null));

    const outcome = await saveTournament(store, deps(files));

    expect(outcome).toMatchObject({ status: 'failed', kind: 'io' });
    expect(store.getState().file).toMatchObject({ status: 'modified' });
  });

  it('asks for a location when the tournament never reached disk', async () => {
    const { store, files } = setup();
    files.failWrite(new TournamentFileError('permissionDenied', 'library not writable', null));
    await createTournamentDocument(store, deps(files), { name: 'Sommer' });
    const pickSave = vi.fn(async () => 'D:\\USB\\Sommer.wattmatt');

    const workingFiles = fakeFiles();
    const outcome = await saveTournament(
      store,
      deps(workingFiles, { dialogs: { pickOpen: async () => null, pickSave } }),
    );

    expect(pickSave).toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'saved', path: 'D:\\USB\\Sommer.wattmatt' });
  });

  it('does nothing when no tournament is open', async () => {
    const { store, files } = setup();

    expect(await saveTournament(store, deps(files))).toEqual({ status: 'cancelled' });
  });
});

describe('saveTournamentAs', () => {
  async function opened() {
    const { store, files } = setup();
    await createTournamentDocument(store, deps(files), { name: 'Sommer' });
    return { store, files };
  }

  it('follows the new file from then on', async () => {
    const { store, files } = await opened();
    const target = 'D:\\USB\\Kopie.wattmatt';

    const outcome = await saveTournamentAs(
      store,
      deps(files, { dialogs: { pickOpen: async () => null, pickSave: async () => target } }),
    );

    expect(outcome).toEqual({ status: 'saved', path: target });
    expect(store.getState().file).toEqual({ status: 'saved', path: target });
    // The original is left exactly as it was — "Speichern unter" is a copy.
    expect(files.disk.has(`${LIBRARY}\\Sommer.wattmatt`)).toBe(true);
  });

  /**
   * A file saved without the extension would not show up in the open dialog's
   * own filter afterwards — the host would be looking for a tournament that is
   * sitting right there.
   */
  it('adds the extension when the host left it off', async () => {
    const { store, files } = await opened();

    const outcome = await saveTournamentAs(
      store,
      deps(files, {
        dialogs: { pickOpen: async () => null, pickSave: async () => 'D:\\USB\\Kopie' },
      }),
    );

    expect(outcome).toEqual({ status: 'saved', path: 'D:\\USB\\Kopie.wattmatt' });
  });

  it('suggests a file name derived from the tournament name', async () => {
    const { store, files } = setup();
    await createTournamentDocument(store, deps(files), { name: 'Turnier: 2026/27' });
    const pickSave = vi.fn(async () => null);

    await saveTournamentAs(
      store,
      deps(files, { dialogs: { pickOpen: async () => null, pickSave } }),
    );

    expect(pickSave).toHaveBeenCalledWith(LIBRARY, 'Turnier 2026 27.wattmatt');
  });

  it('leaves everything alone when the host cancels', async () => {
    const { store, files } = await opened();
    const before = store.getState().file;

    const outcome = await saveTournamentAs(store, deps(files));

    expect(outcome).toEqual({ status: 'cancelled' });
    expect(store.getState().file).toEqual(before);
  });
});

describe('closeTournamentDocument', () => {
  it('returns to the start screen and clears the beamer', async () => {
    const { store, files } = setup();
    await createTournamentDocument(store, deps(files), { name: 'Sommer' });

    closeTournamentDocument(store);

    expect(store.getState().document).toBeNull();
    expect(store.getState().file).toEqual({ status: 'unsaved' });
    expect(store.getState().tournament).toEqual({ groups: [] });
    expect(store.getState().scene).toEqual(IDLE_SCENE);
  });
});
