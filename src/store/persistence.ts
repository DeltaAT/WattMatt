import {
  createTournament,
  fromTournamentFile,
  toTournamentFile,
  type CreateTournamentInput,
} from '@/domain/factory';
import { TOURNAMENT_FILE_EXTENSION, toTournamentFileName, uniqueFileName } from '@/domain/fileName';
import {
  migrateToTarget,
  migrateTournamentFile,
  readSchemaVersion,
  type SchemaTarget,
} from '@/domain/migrations';
import {
  carriedFields,
  NO_CARRIED_FIELDS,
  withCarriedFields,
  type CarriedFields,
  type TournamentFileLike,
} from '@/domain/schema';
import type { Clock, Settings, Tournament } from '@/domain/types';
import {
  toTournamentFileError,
  type BackupEntry,
  type FileErrorKind,
  type TournamentEntry,
} from '@/platform/tournamentFile';
import {
  closeDocument,
  setDocumentSaved,
  setNewDocument,
  setOpenedDocument,
} from '@/store/actions/document';
import { filePath, type TournamentStore } from '@/store/tournamentStore';

/**
 * Everything that turns a tournament into a file and back (issue #9).
 *
 * The I/O is injected rather than imported, for the reason the domain is pure:
 * every branch here — a corrupt file, a cancelled dialog, a save that failed
 * onto a USB stick that was pulled out — has to be reachable in a test, and
 * none of them is reachable through a real file system on demand.
 *
 * Nothing in this module decides what the host is *told*. It returns outcomes;
 * the host window maps them to German (CLAUDE.md §1).
 *
 * Issue #10 builds the debounced autosave on top of this. The rotating backups
 * of docs/FILE-FORMAT.md rule 3 are its half too — this module only *finds*
 * backups, so a file that fails validation can be answered with the newest one.
 */

export interface PersistenceFiles {
  read(path: string): Promise<string>;
  write(path: string, contents: string): Promise<void>;
  list(): Promise<TournamentEntry[]>;
  listBackups(path: string): Promise<BackupEntry[]>;
  /**
   * Copies a file aside before it is migrated (docs/FILE-FORMAT.md rule 7).
   * Rejects if the copy could not be made, which stops the open.
   */
  backUpForMigration(path: string, version: number): Promise<string>;
  /** The default library, or `null` where there is no backend to ask. */
  directory(): Promise<string | null>;
}

export interface PersistenceDialogs {
  pickOpen(defaultDirectory: string | null): Promise<string | null>;
  pickSave(defaultDirectory: string | null, suggestedFileName: string): Promise<string | null>;
}

export interface PersistenceDeps {
  files: PersistenceFiles;
  dialogs: PersistenceDialogs;
  clock: Clock;
  newId(): string;
  newSeed(): string;
  /** Stamped into the file so a support question can name the build. */
  appVersion: string;
  /** German fallback stem, used when a name yields no usable file name. */
  fallbackFileBase: string;
  /**
   * The file format this build reads: the version stamp, the schema, and the
   * migrations that lead up to it (`CURRENT_SCHEMA` in `@/domain/migrations`).
   *
   * Injected for the same reason the file system is. There is exactly one
   * schema version today, so with `CURRENT_SCHEMA` imported here no file could
   * ever be *outdated* — and the branch that copies the original aside before
   * migrating it, the one docs/FILE-FORMAT.md rule 7 exists for, would first
   * run on a host's laptop rather than in a test.
   */
  schema: SchemaTarget<TournamentFileLike>;
}

/** Why a file could not be opened (docs/FILE-FORMAT.md rules 1 and 7). */
export type OpenFailure =
  /** The bytes never arrived: missing, locked, on a stick that was pulled out. */
  | 'unreadable'
  /** The bytes arrived and are not a tournament. */
  | 'invalid'
  /**
   * Written by a newer WattMatt. Refused rather than opened partially: a build
   * that does not know what a field means cannot know whether dropping it loses
   * a round, and saving over the file is how the host would find out.
   */
  | 'futureVersion'
  /**
   * From an older schema, and this build could not bring it up to date — a
   * missing step, a step that refused, or a safety copy that could not be made.
   */
  | 'migrationFailed';

export type OpenOutcome =
  | {
      status: 'opened';
      path: string;
      /** The schema version it was migrated from, or `null` if it was current. */
      migratedFrom: number | null;
    }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: OpenFailure; path: string; backups: BackupEntry[] };

export type SaveOutcome =
  | { status: 'saved'; path: string }
  | { status: 'cancelled' }
  | { status: 'failed'; path: string | null; kind: FileErrorKind };

export type CreateOutcome =
  /** In memory and on disk. */
  | { status: 'created'; path: string }
  /**
   * In memory only: the first write failed. The tournament is usable and the
   * host is warned — losing a tournament they have already started entering
   * because the library was not writable would be the worse answer.
   */
  | { status: 'unwritten'; kind: FileErrorKind };

/**
 * UTF-8 JSON, two-space indent, trailing newline (docs/FILE-FORMAT.md §Encoding).
 *
 * `carried` is what the file this tournament came from held and this build does
 * not understand. It goes back out untouched (rule 7): an older WattMatt opening
 * a newer build's file, recording a winner and saving must not strip the half it
 * could not read.
 */
export function serialiseTournament(
  tournament: Tournament,
  appVersion: string,
  carried: CarriedFields = NO_CARRIED_FIELDS,
): string {
  const file = withCarriedFields(toTournamentFile(tournament, appVersion), carried);
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * Creates a tournament and writes it to the library straight away.
 *
 * Writing immediately rather than at the first "Speichern" is deliberate: from
 * this moment the autosave of issue #10 has a target, and a laptop that dies
 * during setup costs the host nothing. The file name is derived from the
 * tournament name and made unique against the library, so two "Vereinsturnier"
 * evenings do not overwrite each other.
 */
export async function createTournamentDocument(
  store: TournamentStore,
  deps: PersistenceDeps,
  input: { name: string; settings?: Partial<Settings> },
): Promise<CreateOutcome> {
  const tournamentInput: CreateTournamentInput = {
    id: deps.newId(),
    name: input.name,
    // Once, at creation, and never again: every draw in the event is
    // reproducible from it (ARCHITECTURE.md §5, docs/OPEN-QUESTIONS.md #23).
    rngSeed: deps.newSeed(),
    clock: deps.clock,
    // Spread rather than passing `undefined`: with `exactOptionalPropertyTypes`
    // an explicit `undefined` is not the same as leaving the key out, and
    // `createTournament` fills in `DEFAULT_SETTINGS` only for an absent one.
    ...(input.settings === undefined ? {} : { settings: input.settings }),
  };
  const tournament = createTournament(tournamentInput);

  // Committed before the write: the host has a tournament either way, and the
  // failure path below only decides whether they are also warned.
  setNewDocument(store, tournament);

  const directory = await deps.files.directory();
  if (directory === null) {
    return { status: 'unwritten', kind: 'noDataDirectory' };
  }

  const taken = (await safeList(deps)).map((entry) => entry.fileName);
  const fileName = uniqueFileName(toTournamentFileName(input.name, deps.fallbackFileBase), taken);
  const path = join(directory, fileName);

  const written = await write(store, deps, tournament, path);
  return written.status === 'saved'
    ? { status: 'created', path }
    : { status: 'unwritten', kind: written.status === 'failed' ? written.kind : 'io' };
}

/**
 * Reads, validates, migrates if it has to, and opens the tournament at `path`
 * (docs/FILE-FORMAT.md rules 1 and 7).
 *
 * The order is the part worth reading. The version is settled *before* the file
 * is parsed, because a file from an older schema cannot satisfy this build's
 * schema and would otherwise be reported as corrupt. The safety copy is made
 * *before* the migration, and the migration itself is pure and in memory — so
 * the bytes at `path` are still exactly what the host had until they save.
 *
 * Nothing here writes to `path`. That is what makes the acceptance criterion
 * "migration failure never overwrites the original file" structural rather than
 * a promise: there is no write on this code path at all.
 */
export async function openTournamentAt(
  store: TournamentStore,
  deps: PersistenceDeps,
  path: string,
): Promise<OpenOutcome> {
  let raw: string;
  try {
    raw = await deps.files.read(path);
  } catch {
    return failedOpen(deps, 'unreadable', path);
  }

  const json = parseJson(raw);
  const version = readSchemaVersion(json, deps.schema.version);
  if (version.status === 'unversioned') {
    return failedOpen(deps, 'invalid', path);
  }
  if (version.status === 'tooNew') {
    // No backup offer: the rotated backups sit beside this file and were
    // written by the same build, so every one of them is just as unreadable.
    return { status: 'failed', reason: 'futureVersion', path, backups: [] };
  }

  if (version.status === 'outdated') {
    try {
      await deps.files.backUpForMigration(path, version.version);
    } catch {
      // Deliberately fatal. The migrated tournament is autosaved within half a
      // second of the host's first click, and without this copy the file as the
      // previous version wrote it is then gone. Refusing to open costs an
      // evening's inconvenience; going ahead costs the only copy.
      return failedOpen(deps, 'migrationFailed', path);
    }
  }

  const parsed = migrateToTarget(json, deps.schema);
  if (parsed.status !== 'ok') {
    return failedOpen(deps, parsed.reason === 'unreadable' ? 'invalid' : 'migrationFailed', path);
  }

  // Only now is anything replaced. A file that fails validation is never
  // partially loaded (docs/FILE-FORMAT.md rule 1) — the tournament that was
  // open before is still open, which during an event is the whole point.
  setOpenedDocument(store, fromTournamentFile(parsed.file), path, carriedFields(parsed.raw));
  return { status: 'opened', path, migratedFrom: parsed.migratedFrom };
}

/** "Turnier öffnen": the native dialog, then the same path as above. */
export async function openTournamentWithDialog(
  store: TournamentStore,
  deps: PersistenceDeps,
): Promise<OpenOutcome> {
  const picked = await deps.dialogs.pickOpen(await deps.files.directory());
  if (picked === null) {
    return { status: 'cancelled' };
  }
  return openTournamentAt(store, deps, picked);
}

/**
 * "Turnier speichern".
 *
 * Falls through to "Speichern unter…" when the tournament has no file yet,
 * which happens when the write at creation failed — exactly the case where the
 * host needs somewhere else to put it (issue #10's "disk full → offer
 * Speichern unter").
 */
export async function saveTournament(
  store: TournamentStore,
  deps: PersistenceDeps,
): Promise<SaveOutcome> {
  const state = store.getState();
  const tournament = state.document;
  if (tournament === null) {
    return { status: 'cancelled' };
  }

  const path = filePath(state.file);
  if (path === null) {
    return saveTournamentAs(store, deps);
  }
  return write(store, deps, tournament, path);
}

/** "Speichern unter…": pick a target, write there, and follow the file from now on. */
export async function saveTournamentAs(
  store: TournamentStore,
  deps: PersistenceDeps,
): Promise<SaveOutcome> {
  const state = store.getState();
  const tournament = state.document;
  if (tournament === null) {
    return { status: 'cancelled' };
  }

  const suggested = toTournamentFileName(tournament.name, deps.fallbackFileBase);
  const directory = directoryOf(filePath(state.file)) ?? (await deps.files.directory());
  const picked = await deps.dialogs.pickSave(directory, suggested);
  if (picked === null) {
    return { status: 'cancelled' };
  }

  return write(store, deps, tournament, withExtension(picked));
}

/**
 * What one autosave attempt did (issue #10).
 *
 * `skipped` is its own outcome rather than a silent `saved`: the autosave runs
 * on a timer and most of its firings have nothing to write, and a status line
 * that reported "Gespeichert" for a write that never happened would be exactly
 * the silent no-op the issue rules out.
 */
export type AutosaveOutcome =
  | { status: 'saved'; path: string }
  | { status: 'skipped' }
  | { status: 'failed'; path: string; kind: FileErrorKind };

/**
 * Writes the open tournament back to its own file, with no host involved.
 *
 * Deliberately *not* `saveTournament`: that one falls through to a native
 * "Speichern unter…" dialog when there is no path, and a dialog opening by
 * itself half a second after the host stopped typing would take the machine
 * away from them mid-event (CLAUDE.md golden rule 3). A tournament with no file
 * is therefore skipped here; the host is already being warned about it by the
 * `notWritten` notice, which offers the dialog as *their* decision.
 */
export async function autosaveTournament(
  store: TournamentStore,
  deps: PersistenceDeps,
): Promise<AutosaveOutcome> {
  const state = store.getState();
  const tournament = state.document;
  // `modified` is the only state with both something to write and somewhere to
  // write it: `saved` is already on disk, `unsaved` has no path.
  if (tournament === null || state.file.status !== 'modified') {
    return { status: 'skipped' };
  }

  const path = state.file.path;
  const outcome = await write(store, deps, tournament, path);
  return outcome.status === 'saved' ? { status: 'saved', path } : failedAutosave(outcome, path);
}

function failedAutosave(outcome: SaveOutcome, path: string): AutosaveOutcome {
  return {
    status: 'failed',
    path,
    kind: outcome.status === 'failed' ? outcome.kind : 'io',
  };
}

/**
 * Closes the tournament.
 *
 * The unsaved-changes question is asked by the host window before this is
 * called: only the UI knows whether the host has already answered it, and a
 * prompt buried in here would fire again on every future caller — including
 * issue #10's app-exit path, which has its own.
 */
export function closeTournamentDocument(store: TournamentStore): void {
  closeDocument(store);
}

/** The library listing behind the start screen's recent tournaments. */
export async function listRecentTournaments(deps: PersistenceDeps): Promise<TournamentEntry[]> {
  return safeList(deps);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function write(
  store: TournamentStore,
  deps: PersistenceDeps,
  tournament: Tournament,
  path: string,
): Promise<SaveOutcome> {
  // Captured before the write, not after: the host keeps clicking while the
  // bytes are in flight, and it is *this* revision that the file will hold.
  const { documentRevision: revision, carried } = store.getState();
  try {
    await deps.files.write(path, serialiseTournament(tournament, deps.appVersion, carried));
  } catch (error) {
    return { status: 'failed', path, kind: kindOf(error) };
  }
  setDocumentSaved(store, path, revision);
  return { status: 'saved', path };
}

/**
 * The tournament in a file's bytes, or `null` if it is not one at this build's
 * schema version.
 *
 * The straight-through path, for a file that needs no migration: everything the
 * *migrating* path adds is I/O, and `openTournamentAt` owns it. Kept exported
 * because "these bytes are a tournament" is a question worth being able to ask
 * on its own — a recovered backup, a fixture, a file pasted into a test.
 *
 * `JSON.parse` and the schema are one step on purpose: a `JSON.parse` result is
 * never trusted (CLAUDE.md §4), and syntactically valid JSON that is not a
 * tournament is the same problem for the host as a truncated file.
 */
export function parseTournamentFile(raw: string): Tournament | null {
  const parsed = migrateTournamentFile(parseJson(raw));
  return parsed.status === 'ok' && parsed.migratedFrom === null
    ? fromTournamentFile(parsed.file)
    : null;
}

/** `undefined` for bytes that are not JSON — which no file's JSON ever is. */
function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function failedOpen(
  deps: PersistenceDeps,
  reason: OpenFailure,
  path: string,
): Promise<OpenOutcome> {
  // The offer of a backup is the whole reason this is not just an error string
  // (docs/FILE-FORMAT.md rule 1). Failing to *list* backups must not swallow
  // the original failure, so an empty list is the answer.
  let backups: BackupEntry[] = [];
  try {
    backups = await deps.files.listBackups(path);
  } catch {
    backups = [];
  }
  return { status: 'failed', reason, path, backups };
}

async function safeList(deps: PersistenceDeps): Promise<TournamentEntry[]> {
  try {
    return await deps.files.list();
  } catch {
    // A library that cannot be listed is an empty start screen, not a dead one.
    return [];
  }
}

function kindOf(error: unknown): FileErrorKind {
  return toTournamentFileError(error).kind;
}

/**
 * Windows separators throughout: WattMatt is a Windows 11 app (CLAUDE.md §1),
 * and a path assembled with a forward slash reaches the host inside an error
 * message that then does not match what Explorer shows them.
 */
function join(directory: string, fileName: string): string {
  return directory.endsWith('\\') || directory.endsWith('/')
    ? `${directory}${fileName}`
    : `${directory}\\${fileName}`;
}

function directoryOf(path: string | null): string | null {
  if (path === null) {
    return null;
  }
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut <= 0 ? null : path.slice(0, cut);
}

/**
 * The save dialog returns whatever the host typed. A tournament called
 * `Sommer` with the extension left off would not be found by the open dialog's
 * own filter afterwards.
 */
function withExtension(path: string): string {
  const extension = `.${TOURNAMENT_FILE_EXTENSION}`;
  return path.toLowerCase().endsWith(extension) ? path : `${path}${extension}`;
}
