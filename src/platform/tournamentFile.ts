import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';

import { TOURNAMENT_FILE_EXTENSION } from '@/domain/fileName';
import { invokeCommand, isTauriRuntime } from '@/platform/tauri';

/**
 * The file half of the Rust boundary (src-tauri/src/fs.rs) and the native
 * open/save dialogs.
 *
 * Nothing here knows what a tournament *is*: it moves strings and paths. The
 * schema lives in `@/domain/schema` and is applied one layer up, in
 * `@/store/persistence`, so a file that fails validation is never partially
 * loaded (docs/FILE-FORMAT.md rule 1).
 *
 * No German copy either. Dialog titles and the file-type label are passed in by
 * the caller, which reads them from `de-AT.ts` (CLAUDE.md §1).
 */

/**
 * Mirrors `FileErrorKind` in src-tauri/src/fs.rs. The variant is the contract —
 * the host's German message is picked from it (docs/ARCHITECTURE.md §6).
 */
export const fileErrorKindSchema = z.enum([
  'notFound',
  'permissionDenied',
  'encoding',
  'noDataDirectory',
  'io',
]);
export type FileErrorKind = z.infer<typeof fileErrorKindSchema>;

const rustFileErrorSchema = z.object({
  kind: fileErrorKindSchema,
  detail: z.string(),
  path: z.string().nullable(),
});

/**
 * A file operation that did not happen.
 *
 * Thrown rather than returned because every caller in `@/store/persistence`
 * turns it into a decision the host is asked about, and a result type that is
 * silently ignorable is exactly how a failed save becomes a silent one
 * (issue #10's "never a silent no-op").
 */
export class TournamentFileError extends Error {
  constructor(
    readonly kind: FileErrorKind,
    /** For the log at `%APPDATA%/WattMatt/logs/` (issue #30), never for the host. */
    readonly detail: string,
    readonly path: string | null,
  ) {
    super(`tournament file ${kind}: ${detail}`);
    this.name = 'TournamentFileError';
  }
}

export const tournamentEntrySchema = z.object({
  path: z.string(),
  fileName: z.string(),
  /** Milliseconds since the epoch, or null where the platform had no answer. */
  modifiedAt: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
});
export type TournamentEntry = z.infer<typeof tournamentEntrySchema>;

export const backupEntrySchema = z.object({
  path: z.string(),
  /** `bak1` … `bak3`; `bak1` is the most recent (docs/FILE-FORMAT.md rule 3). */
  suffix: z.string(),
  modifiedAt: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
});
export type BackupEntry = z.infer<typeof backupEntrySchema>;

/** German copy for a native dialog, handed in by the caller. */
export interface DialogCopy {
  title: string;
  /** The file-type row of the dialog, e.g. "WattMatt-Turnier". */
  filterLabel: string;
}

/**
 * Turns whatever a rejected `invoke` produced into a typed error.
 *
 * Rust rejects with the serialised `FileError`; anything else — a contract
 * mismatch, a plugin that is not there — is reported as `io`. That is the
 * honest bucket: something below us failed and the host's next step is the
 * same either way.
 */
export function toTournamentFileError(error: unknown): TournamentFileError {
  if (error instanceof TournamentFileError) {
    return error;
  }
  const parsed = rustFileErrorSchema.safeParse(error);
  if (parsed.success) {
    return new TournamentFileError(parsed.data.kind, parsed.data.detail, parsed.data.path);
  }
  return new TournamentFileError('io', describe(error), null);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The error a file call gets in a plain browser, where there is no backend. */
function noBackend(): TournamentFileError {
  return new TournamentFileError('io', 'no Tauri backend in this window', null);
}

async function invokeFile<T>(
  command: string,
  schema: z.ZodType<T>,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invokeCommand(command, schema, args);
  } catch (error) {
    throw toTournamentFileError(error);
  }
}

/**
 * `%APPDATA%\WattMatt\tournaments`, or `null` in a plain browser.
 *
 * Null rather than a throw: this only decides where a dialog opens, and a
 * missing default directory must never be the reason the host cannot save.
 */
export async function tournamentsDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invokeFile('tournaments_directory', z.string());
  } catch {
    return null;
  }
}

export async function readTournamentFile(path: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw noBackend();
  }
  return invokeFile('read_tournament', z.string(), { path });
}

/** Atomic: temp file, fsync, rename (docs/FILE-FORMAT.md rule 2, in Rust). */
export async function writeTournamentFile(path: string, contents: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw noBackend();
  }
  await invokeFile('write_tournament', z.null().or(z.undefined()), { path, contents });
}

/**
 * The default library, newest first.
 *
 * An empty list rather than a throw when there is no backend: the start screen
 * has to render either way, and "no tournaments yet" is the same picture a
 * fresh installation shows.
 */
export async function listTournaments(): Promise<TournamentEntry[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    return await invokeFile('list_tournaments', z.array(tournamentEntrySchema));
  } catch {
    return [];
  }
}

/** The backups of one tournament file, most recent first. */
export async function listBackups(path: string): Promise<BackupEntry[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  try {
    return await invokeFile('list_backups', z.array(backupEntrySchema), { path });
  } catch {
    return [];
  }
}

const FILE_FILTER_EXTENSIONS = [TOURNAMENT_FILE_EXTENSION];

/** The path the host picked, or `null` if they cancelled. */
export async function pickTournamentToOpen(
  copy: DialogCopy,
  defaultDirectory: string | null,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const picked = await openDialog({
    title: copy.title,
    multiple: false,
    directory: false,
    // Spread rather than `?? undefined`: with `exactOptionalPropertyTypes` an
    // explicit `undefined` is not the same as an absent key, and the dialog
    // treats an absent one as "wherever Windows last was".
    ...(defaultDirectory === null ? {} : { defaultPath: defaultDirectory }),
    filters: [{ name: copy.filterLabel, extensions: FILE_FILTER_EXTENSIONS }],
  });

  // The plugin types allow an array for `multiple: true`, which this is not.
  return typeof picked === 'string' ? picked : null;
}

export async function pickTournamentSaveTarget(
  copy: DialogCopy,
  defaultDirectory: string | null,
  suggestedFileName: string,
): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  // A bare file name would open the dialog wherever Windows last was. Pointing
  // it at the library is what keeps an event's tournaments in one place.
  const defaultPath = defaultDirectory
    ? `${defaultDirectory}\\${suggestedFileName}`
    : suggestedFileName;

  return saveDialog({
    title: copy.title,
    defaultPath,
    filters: [{ name: copy.filterLabel, extensions: FILE_FILTER_EXTENSIONS }],
  });
}
