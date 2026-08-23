import { CURRENT_SCHEMA } from '@/domain/migrations';
import { fixedClock } from '@/domain/testFixtures';
import {
  TournamentFileError,
  type BackupEntry,
  type TournamentEntry,
} from '@/platform/tournamentFile';
import type { PersistenceDeps, PersistenceFiles } from '@/store/persistence';

/**
 * A file system in a Map, and the dependency bundle around it.
 *
 * Every failure the host can hit lives in a branch of `@/store/persistence`,
 * and a pulled USB stick, a locked file and a disk that is full are not things
 * a test can arrange on a real one. `failWrite`/`failRead` are how each of them
 * is reproduced.
 *
 * Shared between `persistence.test.ts` and the host window's document tests, so
 * the two agree on what a disk does rather than each inventing its own.
 */

export const LIBRARY = 'C:\\AppData\\WattMatt\\tournaments';

export interface FakeFiles {
  /** The bytes on disk, keyed by path — assert against this, not through it. */
  disk: Map<string, string>;
  api: PersistenceFiles;
  /** Every path written, in the order the writes completed. */
  writes: string[];
  /**
   * The most writes that were ever inside `write` at the same time.
   *
   * The host window promises its file operations do not overlap; without a
   * number that goes above 1 when they do, that promise is only a comment.
   */
  metrics: { peakConcurrentWrites: number };
  failWrite(error: Error | null): void;
  failRead(error: Error | null): void;
  /** Makes the pre-migration safety copy impossible (docs/FILE-FORMAT.md rule 7). */
  failMigrationBackup(error: Error | null): void;
  /** Every pre-migration copy that was made, as `path -> backup path`. */
  migrationBackups: Map<string, string>;
  noDirectory(): void;
  setBackups(entries: BackupEntry[]): void;
  /** Holds every write open until the returned function is called. */
  blockWrites(): () => void;
}

export function fakeFiles(initial: Record<string, string> = {}): FakeFiles {
  const disk = new Map(Object.entries(initial));
  const writes: string[] = [];
  const migrationBackups = new Map<string, string>();
  let readFailure: Error | null = null;
  let writeFailure: Error | null = null;
  let migrationBackupFailure: Error | null = null;
  let directory: string | null = LIBRARY;
  let backups: BackupEntry[] = [];
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;
  let inFlight = 0;
  const metrics = { peakConcurrentWrites: 0 };

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
      inFlight += 1;
      metrics.peakConcurrentWrites = Math.max(metrics.peakConcurrentWrites, inFlight);
      try {
        if (gate) {
          await gate;
        }
        if (writeFailure) {
          throw writeFailure;
        }
        disk.set(path, contents);
        writes.push(path);
      } finally {
        inFlight -= 1;
      }
    },
    list: async (): Promise<TournamentEntry[]> =>
      [...disk.keys()].map((path) => ({
        path,
        fileName: path.split('\\').pop() ?? path,
        modifiedAt: 0,
        bytes: 0,
      })),
    listBackups: async () => backups,
    backUpForMigration: async (path: string, version: number) => {
      if (migrationBackupFailure) {
        throw migrationBackupFailure;
      }
      const contents = disk.get(path);
      if (contents === undefined) {
        throw new TournamentFileError('notFound', 'missing', path);
      }
      // Named the way src-tauri/src/fs.rs names it, and never overwritten: the
      // first copy is the file as the older version wrote it.
      const target = `${path}.v${version}.bak`;
      if (!disk.has(target)) {
        disk.set(target, contents);
      }
      migrationBackups.set(path, target);
      return target;
    },
    directory: async () => directory,
  };

  return {
    disk,
    api,
    writes,
    metrics,
    failWrite(error: Error | null) {
      writeFailure = error;
    },
    failRead(error: Error | null) {
      readFailure = error;
    },
    failMigrationBackup(error: Error | null) {
      migrationBackupFailure = error;
    },
    migrationBackups,
    noDirectory() {
      directory = null;
    },
    setBackups(entries: BackupEntry[]) {
      backups = entries;
    },
    blockWrites() {
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      return () => {
        gate = null;
        openGate?.();
      };
    },
  };
}

export function fakeDeps(
  files: FakeFiles,
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
    schema: CURRENT_SCHEMA,
    ...overrides,
  };
}
