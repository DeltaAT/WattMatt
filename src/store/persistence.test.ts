import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { IDLE_SCENE, WELCOME_SCENE } from '@/domain/beamerScene';
import type { Migration, SchemaTarget } from '@/domain/migrations';
import { SCHEMA_VERSION, tournamentFileSchema, type TournamentFileLike } from '@/domain/schema';
import { EMPTY_TOURNAMENT } from '@/domain/snapshot';
import { group, midTournament, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { TournamentFileError } from '@/platform/tournamentFile';
import { setOpenedDocument } from '@/store/actions/document';
import {
  autosaveTournament,
  createTournamentDocument,
  openTournamentAt,
  openTournamentWithDialog,
  parseTournamentFile,
  saveTournament,
  saveTournamentAs,
  serialiseTournament,
  closeTournamentDocument,
} from '@/store/persistence';
import { fakeDeps as deps, fakeFiles, LIBRARY } from '@/store/testFixtures';
import { createTournamentStore, type TournamentStore } from '@/store/tournamentStore';

const PATH = `${LIBRARY}\\Sommer.wattmatt`;

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

  /**
   * The same criterion, on a tournament that is actually under way. The empty
   * round trip above passes even if `rounds`, `tables`, `repechage`, `bracket`
   * and `log` were dropped wholesale, because there is nothing in them — so on
   * its own it is not evidence for the acceptance criterion it claims.
   */
  it('round-trips a tournament in the middle of its bracket phase', () => {
    const original: Tournament = midTournament({ name: 'Sommerturnier Grünau' });

    const parsed = parseTournamentFile(serialiseTournament(original, '0.1.0'));

    expect(parsed).toEqual(original);
    // Named individually as well: `toEqual` on the whole object would also pass
    // if the fixture itself had quietly become empty.
    expect(parsed?.rounds.flatMap((entry) => entry.matches)).toHaveLength(3);
    expect(parsed?.tables.map((entry) => entry.status)).toEqual(['OCCUPIED', 'FREE', 'DISABLED']);
    expect(parsed?.bracket?.nodes).toHaveLength(3);
    expect(parsed?.repechage?.fallbackUsed).toBe('BYES');
    expect(parsed?.log).toHaveLength(2);
  });

  it('writes UTF-8 JSON with a two-space indent (docs/FILE-FORMAT.md)', () => {
    const raw = serialiseTournament(tournament({ name: 'Sommerturnier Grünau' }), '0.1.0');

    expect(raw).toContain(`\n  "schemaVersion": ${SCHEMA_VERSION}`);
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
    const claimingTheFuture = raw.replace(
      `"schemaVersion": ${SCHEMA_VERSION}`,
      '"schemaVersion": 99',
    );

    expect(parseTournamentFile(claimingTheFuture)).toBeNull();
  });

  it('refuses a file whose group is missing a field', () => {
    const raw = serialiseTournament(tournament({ groups: [group(1)] }), '0.1.0');
    const damaged = raw.replace('"status": "ACTIVE"', '"status": "GEWONNEN"');

    expect(parseTournamentFile(damaged)).toBeNull();
  });
});

describe('autosaveTournament', () => {
  it('writes the open tournament back to its own file, with no host involved', async () => {
    const { store, files } = setup({ [PATH]: '{}' });
    setOpenedDocument(store, midTournament(), PATH);
    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, rngCursor: 18 },
    }));

    const outcome = await autosaveTournament(store, deps(files));

    expect(outcome).toEqual({ status: 'saved', path: PATH });
    expect(JSON.parse(files.disk.get(PATH) ?? '{}')).toMatchObject({ rngCursor: 18 });
    expect(store.getState().file).toEqual({ status: 'saved', path: PATH });
  });

  it('does nothing when the file on disk is already the tournament in memory', async () => {
    const { store, files } = setup({ [PATH]: '{}' });
    setOpenedDocument(store, midTournament(), PATH);

    const outcome = await autosaveTournament(store, deps(files));

    expect(outcome).toEqual({ status: 'skipped' });
    expect(files.writes).toEqual([]);
  });

  it('does nothing at all with no tournament open', async () => {
    const { store, files } = setup();

    await expect(autosaveTournament(store, deps(files))).resolves.toEqual({ status: 'skipped' });
  });

  /**
   * The first write of a new tournament can fail, leaving it with no path. An
   * autosave that fell through to "Speichern unter…" would open a native dialog
   * half a second after the host stopped typing — the machine taken away from
   * them mid-sentence (CLAUDE.md golden rule 3).
   */
  it('never opens a dialog for a tournament that has no file', async () => {
    const { store, files } = setup();
    let dialogs = 0;
    const withDialog = deps(files, {
      dialogs: {
        pickOpen: async () => null,
        pickSave: async () => {
          dialogs += 1;
          return `${LIBRARY}\\Neu.wattmatt`;
        },
      },
    });
    files.failWrite(new TournamentFileError('permissionDenied', 'read only', null));
    await createTournamentDocument(store, withDialog, { name: 'Vereinsturnier' });
    files.failWrite(null);

    const outcome = await autosaveTournament(store, withDialog);

    expect(outcome).toEqual({ status: 'skipped' });
    expect(dialogs).toBe(0);
    expect(files.writes).toEqual([]);
  });

  /**
   * The issue's edge case: the tournament is on a USB stick that gets pulled
   * out mid-event. The typed variant is what the host's German message is
   * chosen from (docs/ARCHITECTURE.md §6), so it has to survive.
   */
  it('reports a failed write with the reason, and leaves the tournament dirty', async () => {
    const { store, files } = setup({ [PATH]: '{}' });
    setOpenedDocument(store, midTournament(), PATH);
    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, rngCursor: 18 },
    }));
    files.failWrite(new TournamentFileError('notFound', 'the stick is gone', PATH));

    const outcome = await autosaveTournament(store, deps(files));

    expect(outcome).toEqual({ status: 'failed', path: PATH, kind: 'notFound' });
    expect(store.getState().file).toEqual({ status: 'modified', path: PATH });
  });
});

describe('a save that the host overtook', () => {
  /**
   * The write is asynchronous, and at the 500 ms autosave cadence most writes
   * overlap the host's next decision. Reporting the file as clean afterwards
   * would tell them a result is safe when it is not in the bytes on disk.
   */
  it('leaves the tournament modified when it changed while the bytes were in flight', async () => {
    const { store, files } = setup({ [PATH]: '{}' });
    setOpenedDocument(store, midTournament(), PATH);
    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, rngCursor: 18 },
    }));

    const release = files.blockWrites();
    const saving = autosaveTournament(store, deps(files));
    // The host decides something else while the write is open.
    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, rngCursor: 19 },
    }));
    release();
    await saving;

    expect(store.getState().file).toEqual({ status: 'modified', path: PATH });
    // What landed is what was serialised, not what the host has now.
    expect(JSON.parse(files.disk.get(PATH) ?? '{}')).toMatchObject({ rngCursor: 18 });
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

    // Empty in every respect but its name, which the beamer carries from the
    // moment the tournament exists — the round board puts it on the wall as
    // persistent chrome (issue #19).
    expect(store.getState().tournament).toEqual({ ...EMPTY_TOURNAMENT, name: 'T' });
    // And the welcome picture is up from that same moment: a tournament that
    // exists and has not started is exactly what that scene is for (issue #74).
    expect(store.getState().scene).toEqual(WELCOME_SCENE);
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

    expect(outcome).toEqual({ status: 'opened', path, migratedFrom: null });
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

    expect(outcome).toEqual({ status: 'opened', path, migratedFrom: null });
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
    expect(store.getState().tournament).toEqual(EMPTY_TOURNAMENT);
    expect(store.getState().scene).toEqual(IDLE_SCENE);
  });
});

/**
 * Issue #9 acceptance criterion 1, end to end through the store rather than
 * through `serialise`/`parse` alone: a tournament saved on laptop A opens on
 * laptop B with identical state. Two stores stand in for the two laptops.
 */
describe('a tournament that changes laptops', () => {
  it('opens on the second machine with the state the first one saved', async () => {
    const laptopA = createTournamentStore();
    const files = fakeFiles();
    const path = `${LIBRARY}\\Sommer.wattmatt`;
    const before = midTournament();
    setOpenedDocument(laptopA, before, path);

    expect(await saveTournament(laptopA, deps(files))).toEqual({ status: 'saved', path });

    // Nothing carries over but the bytes: a fresh store, a fresh read.
    const laptopB = createTournamentStore();
    const outcome = await openTournamentAt(
      laptopB,
      deps(fakeFiles({ [path]: files.disk.get(path) ?? '' })),
      path,
    );

    expect(outcome).toEqual({ status: 'opened', path, migratedFrom: null });
    expect(laptopB.getState().document).toEqual(before);
    expect(laptopB.getState().file).toEqual({ status: 'saved', path });
  });

  /**
   * Golden rule 4: the beamer holds no authoritative state, so what it is sent
   * has to be recomputed from the opened document — not carried over from
   * whatever the window was showing before.
   */
  it('projects the opened tournament onto the beamer, mid-tournament and all', async () => {
    const files = fakeFiles();
    const path = `${LIBRARY}\\Sommer.wattmatt`;
    const store = createTournamentStore();
    setOpenedDocument(store, midTournament(), path);
    await saveTournament(store, deps(files));

    const reopened = createTournamentStore();
    await openTournamentAt(reopened, deps(files), path);

    expect(reopened.getState().tournament.groups.map((entry) => entry.number)).toEqual([
      1, 2, 3, 4,
    ]);
    // Idle rather than the round board: opening a file mid-tournament must not
    // throw the last event's round onto a screen nobody has looked at yet
    // (issue #74). `WELCOME` is only for a tournament that has not started.
    expect(reopened.getState().scene).toEqual(IDLE_SCENE);
  });
});

/**
 * Issue #12: schema versioning, the refusal of a newer file, and the fields an
 * older build has to hand back untouched (docs/FILE-FORMAT.md rule 7).
 */
describe('schema versioning', () => {
  const path = `${LIBRARY}\\Sommer.wattmatt`;

  function v1(extra: Record<string, unknown> = {}): string {
    const file = {
      ...(JSON.parse(serialiseTournament(midTournament(), '0.1.0')) as Record<string, unknown>),
      ...extra,
    };
    return `${JSON.stringify(file, null, 2)}\n`;
  }

  /**
   * Issue #12 acceptance criterion: a hand-edited file claiming
   * `schemaVersion: 99` is refused cleanly — a German message, not a throw and
   * not a half-loaded tournament.
   */
  it('refuses a file written by a newer version of WattMatt', async () => {
    const { store, files } = setup({ [path]: v1({ schemaVersion: 99 }) });
    const before = store.getState();

    const outcome = await openTournamentAt(store, deps(files), path);

    expect(outcome).toEqual({ status: 'failed', reason: 'futureVersion', path, backups: [] });
    expect(store.getState()).toBe(before);
    // Nothing was written, so the file is still openable by the build that
    // wrote it — which is the only build that can do anything with it.
    expect(files.disk.get(path)).toBe(v1({ schemaVersion: 99 }));
  });

  /*
   * The rotated backups sit beside the file and were written by the same, newer
   * build. Offering one would walk the host straight into the same refusal.
   */
  it('offers no backup for a file from a newer version', async () => {
    const { store, files } = setup({ [path]: v1({ schemaVersion: 99 }) });
    files.setBackups([{ path: `${path}.bak1`, suffix: 'bak1', modifiedAt: 1, bytes: 10 }]);

    const outcome = await openTournamentAt(store, deps(files), path);

    expect(outcome).toMatchObject({ reason: 'futureVersion', backups: [] });
  });

  it('opens a file that carries fields this build has never heard of', async () => {
    const { store, files } = setup({ [path]: v1({ namingDone: true }) });

    const outcome = await openTournamentAt(store, deps(files), path);

    expect(outcome).toMatchObject({ status: 'opened', migratedFrom: null });
    expect(store.getState().document?.name).toBe('Sommerturnier');
    // The tournament itself stays clean: nothing in `src/domain` has to cope
    // with a field it cannot type.
    expect(store.getState().document).not.toHaveProperty('namingDone');
    expect(store.getState().carried).toEqual({ namingDone: true });
  });

  /**
   * The point of the whole exercise: an older WattMatt opening a newer build's
   * file, recording a result and saving must not strip the half it could not
   * read (docs/FILE-FORMAT.md rule 7).
   */
  it('writes the unknown fields back out on the next save', async () => {
    const { store, files } = setup({ [path]: v1({ namingDone: true, sponsors: ['Raiffeisen'] }) });
    await openTournamentAt(store, deps(files), path);

    store.commit((state) => ({
      document: state.document === null ? null : { ...state.document, name: 'Sommerturnier neu' },
    }));
    expect(await saveTournament(store, deps(files))).toEqual({ status: 'saved', path });

    const written = JSON.parse(files.disk.get(path) ?? '') as Record<string, unknown>;
    expect(written['namingDone']).toBe(true);
    expect(written['sponsors']).toEqual(['Raiffeisen']);
    expect(written['name']).toBe('Sommerturnier neu');
  });

  it('does not carry the unknown fields of one file into the next tournament', async () => {
    const plain = `${LIBRARY}\\Plain.wattmatt`;
    const { store, files } = setup({ [path]: v1({ namingDone: true }), [plain]: v1() });
    await openTournamentAt(store, deps(files), path);

    await openTournamentAt(store, deps(files), plain);
    await saveTournament(store, deps(files));

    expect(store.getState().carried).toEqual({});
    expect(JSON.parse(files.disk.get(plain) ?? '')).not.toHaveProperty('namingDone');
  });

  it('does not carry unknown fields into a newly created tournament', async () => {
    const { store, files } = setup({ [path]: v1({ namingDone: true }) });
    await openTournamentAt(store, deps(files), path);

    const created = await createTournamentDocument(store, deps(files), { name: 'Neu' });

    expect(created).toMatchObject({ status: 'created' });
    expect(store.getState().carried).toEqual({});
    const written = JSON.parse(
      files.disk.get(created.status === 'created' ? created.path : '') ?? 'null',
    ) as Record<string, unknown>;
    expect(written).not.toHaveProperty('namingDone');
  });

  /**
   * `carried` is deliberately outside `UndoDocument` (issue #11): it belongs to
   * the file, not to a decision inside the tournament, and nothing the host can
   * do changes it. That reasoning is only worth anything if taking a decision
   * back does not quietly drop the fields on the way — an undo mid-event
   * followed by the autosave 500 ms later is exactly when it would happen, and
   * the file would come back stripped with nobody having done anything wrong.
   */
  it('keeps the unknown fields through an undo and a redo', async () => {
    const { store, files } = setup({ [path]: v1({ namingDone: true }) });
    await openTournamentAt(store, deps(files), path);
    store.commit(
      (state) => ({
        document: state.document === null ? null : { ...state.document, rngCursor: 99 },
      }),
      { undoLabel: 'Sieger festgelegt', log: { action: 'MATCH_WINNER_SET', payload: {} } },
    );

    expect(store.undo()).toBe(true);
    expect(store.getState().carried).toEqual({ namingDone: true });
    await saveTournament(store, deps(files));
    expect(JSON.parse(files.disk.get(path) ?? 'null')).toMatchObject({ namingDone: true });

    expect(store.redo()).toBe(true);
    await saveTournament(store, deps(files));
    expect(JSON.parse(files.disk.get(path) ?? 'null')).toMatchObject({
      namingDone: true,
      rngCursor: 99,
    });
  });
});

/**
 * Issue #12, written one `SCHEMA_VERSION` bump ahead of whatever this build
 * ships.
 *
 * The real chain is exercised by `src/domain/migrations/fixtures.test.ts`,
 * which opens every archived file through the real registry. What is tested
 * here is the persistence half: the safety copy, and the refusals that must
 * leave the bytes on disk untouched. Those need failures no real migration
 * would ever contain — a chain with a hole in it, a step that throws — and
 * `deps.schema` is injected for exactly that. The target below is what the
 * tree looks like after the next bump.
 *
 * Only the reading half is simulated. `serialiseTournament` still writes the
 * version this build ships, which is correct today and correct again after the
 * bump, and is why none of these tests asserts on written bytes beyond "the
 * original is untouched".
 */
describe('opening a file from an older schema', () => {
  const path = `${LIBRARY}\\Sommer.wattmatt`;

  const OLD = SCHEMA_VERSION;
  const NEXT = SCHEMA_VERSION + 1;

  const nextSchema = tournamentFileSchema.extend({ schemaVersion: z.literal(NEXT) });

  /** A version bump with no shape change — the smallest real migration there is. */
  const currentToNext: Migration = { from: OLD, to: NEXT, migrate: (file) => file };

  function nextTarget(
    migrations: readonly Migration[] = [currentToNext],
  ): SchemaTarget<TournamentFileLike> {
    return { version: NEXT, schema: nextSchema, migrations };
  }

  function setupOlder() {
    const files = fakeFiles({ [path]: serialiseTournament(midTournament(), '0.1.0') });
    return { store: createTournamentStore(), files, original: files.disk.get(path) };
  }

  it('migrates it and says which version it came from', async () => {
    const { store, files } = setupOlder();

    const outcome = await openTournamentAt(store, deps(files, { schema: nextTarget() }), path);

    expect(outcome).toEqual({ status: 'opened', path, migratedFrom: OLD });
    expect(store.getState().document).toEqual(midTournament());
    expect(store.getState().file).toEqual({ status: 'saved', path });
  });

  /**
   * Issue #12 task: back up the original file before migrating. The copy is
   * what the host still has after the first autosave has rewritten the file in
   * the new format, half a second after their first click.
   */
  it('copies the original aside first, and leaves the file itself alone', async () => {
    const { store, files, original } = setupOlder();

    await openTournamentAt(store, deps(files, { schema: nextTarget() }), path);

    expect(files.migrationBackups.get(path)).toBe(`${path}.v${OLD}.bak`);
    expect(files.disk.get(`${path}.v${OLD}.bak`)).toBe(original);
    // Opening writes nothing: the tournament on disk is still the v1 file.
    expect(files.disk.get(path)).toBe(original);
    expect(files.writes).toEqual([]);
  });

  /**
   * Fatal on purpose. Without the copy, the autosave that follows the host's
   * first click is the moment the file as v1 wrote it stops existing.
   */
  it('refuses to open when the safety copy cannot be made', async () => {
    const { store, files, original } = setupOlder();
    files.failMigrationBackup(new TournamentFileError('permissionDenied', 'read-only', path));
    const before = store.getState();

    const outcome = await openTournamentAt(store, deps(files, { schema: nextTarget() }), path);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'migrationFailed', path });
    expect(store.getState()).toBe(before);
    expect(files.disk.get(path)).toBe(original);
  });

  /*
   * Issue #12 acceptance criterion: migration failure never overwrites the
   * original file. Both failures below are checked against the bytes on disk,
   * not against the absence of a write call, because "we did not mean to write"
   * is not evidence.
   */
  it('refuses cleanly when no migration reaches the current version', async () => {
    const { store, files, original } = setupOlder();

    const outcome = await openTournamentAt(store, deps(files, { schema: nextTarget([]) }), path);

    expect(outcome).toMatchObject({ status: 'failed', reason: 'migrationFailed', path });
    expect(store.getState().document).toBeNull();
    expect(files.disk.get(path)).toBe(original);
  });

  it('refuses cleanly when a migration step throws', async () => {
    const { store, files, original } = setupOlder();
    const throwing: Migration = {
      from: OLD,
      to: NEXT,
      migrate: () => {
        throw new Error('the next version needs a field this file never had');
      },
    };

    const outcome = await openTournamentAt(
      store,
      deps(files, { schema: nextTarget([throwing]) }),
      path,
    );

    expect(outcome).toMatchObject({ status: 'failed', reason: 'migrationFailed', path });
    expect(files.disk.get(path)).toBe(original);
    // The copy was already made: the backup comes before the migration, so a
    // step that fails still leaves the host with the file they started from.
    expect(files.disk.get(`${path}.v${OLD}.bak`)).toBe(original);
  });

  it('leaves the tournament that was already open alone', async () => {
    const { store, files } = setupOlder();
    const other = `${LIBRARY}\\Andere.wattmatt`;
    files.disk.set(other, serialiseTournament(tournament({ name: 'Andere' }), '0.1.0'));
    await openTournamentAt(store, deps(files), other);
    const before = store.getState().document;

    await openTournamentAt(store, deps(files, { schema: nextTarget([]) }), path);

    expect(store.getState().document).toBe(before);
    expect(store.getState().file).toEqual({ status: 'saved', path: other });
  });
});
