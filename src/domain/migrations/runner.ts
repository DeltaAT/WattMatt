import { MIGRATIONS } from '@/domain/migrations/registry';
import type { Migration, RawTournamentFile } from '@/domain/migrations/types';
import { SCHEMA_VERSION, tournamentFileSchema, type TournamentFileLike } from '@/domain/schema';

import type { z } from 'zod';

/**
 * Bringing a file up to the schema this build understands
 * (docs/FILE-FORMAT.md rule 7, issue #12).
 *
 * Pure, like everything in `src/domain`: it takes parsed JSON and returns
 * either a tournament file or a reason. It reads no file, writes no file and
 * makes no backup — the copy of the original that rule 7 demands is I/O and
 * belongs to `@/store/persistence`, which is also the only place that knows
 * the path.
 *
 * The split into "which version is this?" and "migrate it" is what makes that
 * possible: the caller learns a migration is needed, secures the original, and
 * only then asks for the work to be done.
 *
 * Where this module takes a target rather than reading `SCHEMA_VERSION`, that
 * is not indirection for its own sake. v1 is the only version that has ever
 * existed, so with the constant baked in there is no such thing as an outdated
 * file and two thirds of this code could not be run at all — the first time it
 * ever executed would be on a host's laptop the evening before an event.
 */

/** What a file claims about itself, before anything is done about it. */
export type FileVersion =
  /** Written by the schema this build reads. Nothing to do. */
  | { status: 'current'; version: number }
  /** Older. A migration chain has to run before it can be parsed. */
  | { status: 'outdated'; version: number }
  /**
   * Newer. Refused rather than guessed at: a build that does not know what a
   * field means cannot decide whether dropping it loses a round
   * (docs/FILE-FORMAT.md rule 7).
   */
  | { status: 'tooNew'; version: number }
  /** No usable `schemaVersion` at all, so these bytes were never our file. */
  | { status: 'unversioned' };

/**
 * The `schemaVersion` a file declares, placed against the version we read.
 *
 * Reads the one field rather than parsing the file, and that is the point: a v1
 * file cannot satisfy the v4 schema, so anything that parsed first could only
 * ever report "invalid" for a file that is merely old.
 */
export function readSchemaVersion(json: unknown, current: number = SCHEMA_VERSION): FileVersion {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return { status: 'unversioned' };
  }

  const version = (json as RawTournamentFile)['schemaVersion'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    return { status: 'unversioned' };
  }

  if (version > current) {
    return { status: 'tooNew', version };
  }
  return version === current ? { status: 'current', version } : { status: 'outdated', version };
}

/** Why a chain could not be run to the end. */
export type ChainFailure =
  /** No migration reads the version the file is at. The chain has a hole. */
  | 'noStep'
  /** A step threw — a field it needed to derive the next version was not there. */
  | 'stepFailed'
  /** A step did not produce an object, or does not move the version forward. */
  | 'brokenStep';

export type ChainOutcome =
  | { status: 'ok'; file: RawTournamentFile }
  | { status: 'failed'; reason: ChainFailure; at: number };

/**
 * Runs one step at a time from the file's version up to `target`.
 *
 * Steps are looked up by `from` on each pass rather than sorted once: a chain
 * with a hole in it has to fail at the hole, naming the version it got stuck
 * on, rather than stopping short and handing back a half-migrated file.
 */
export function applyMigrations(
  json: RawTournamentFile,
  { migrations, target }: { migrations: readonly Migration[]; target: number },
): ChainOutcome {
  let file = json;
  let version = versionOf(file);

  while (version < target) {
    const step = migrations.find((candidate) => candidate.from === version);
    if (step === undefined) {
      return { status: 'failed', reason: 'noStep', at: version };
    }

    // A step that does not move forward would spin this loop for ever, and a
    // live event would freeze on the click that opens a tournament. The
    // registry is wrong in that case, and no file can fix it.
    if (step.to <= version) {
      return { status: 'failed', reason: 'brokenStep', at: version };
    }

    let migrated: RawTournamentFile;
    try {
      migrated = step.migrate(file);
    } catch {
      return { status: 'failed', reason: 'stepFailed', at: version };
    }

    if (migrated === null || typeof migrated !== 'object' || Array.isArray(migrated)) {
      return { status: 'failed', reason: 'brokenStep', at: version };
    }

    // The step declares where it lands and the file is made to agree, so the
    // next pass cannot look up the wrong step. A file that says v1 while
    // holding v2 data is the one thing worse than a file that refuses to open.
    file = { ...migrated, schemaVersion: step.to };
    version = step.to;
  }

  return { status: 'ok', file };
}

/**
 * Everything that defines "the format this build reads": the version stamp, the
 * schema that validates it, and the steps that lead up to it.
 *
 * One value rather than three parameters, because the three are only ever
 * correct together — a schema paired with the wrong version number would
 * migrate a file to a shape it then refuses.
 */
export interface SchemaTarget<T> {
  readonly version: number;
  readonly schema: z.ZodType<T>;
  readonly migrations: readonly Migration[];
}

/** What this build reads today (docs/FILE-FORMAT.md §"Schema (v1)"). */
export const CURRENT_SCHEMA: SchemaTarget<TournamentFileLike> = {
  version: SCHEMA_VERSION,
  schema: tournamentFileSchema,
  migrations: MIGRATIONS,
};

/** Why a file could not be turned into a tournament file. */
export type MigrationFailure =
  /** From a newer build — `readSchemaVersion` says `tooNew`. */
  | 'tooNew'
  /** Not a tournament file at all, or one with no version to place it by. */
  | 'unreadable'
  /** The chain could not be run to the end. */
  | 'chainBroken'
  /** The chain ran, and what came out is still not a valid tournament file. */
  | 'invalidResult';

export type MigrationOutcome<T> =
  | {
      status: 'ok';
      file: T;
      /**
       * The migrated JSON the file was parsed from, unknown fields included.
       * The caller keeps them so a save can put them back (rule 7); the schema
       * cannot hand them over, because not knowing them is what they are.
       */
      raw: RawTournamentFile;
      /** The version it came from, or `null` if it was already current. */
      migratedFrom: number | null;
    }
  | { status: 'failed'; reason: MigrationFailure; version: number | null };

/**
 * A parsed `.wattmatt` file at `target`'s version, migrating on the way if it
 * has to.
 */
export function migrateToTarget<T>(json: unknown, target: SchemaTarget<T>): MigrationOutcome<T> {
  const version = readSchemaVersion(json, target.version);
  if (version.status === 'unversioned') {
    return { status: 'failed', reason: 'unreadable', version: null };
  }
  if (version.status === 'tooNew') {
    return { status: 'failed', reason: 'tooNew', version: version.version };
  }

  const chained = applyMigrations(json as RawTournamentFile, {
    migrations: target.migrations,
    target: target.version,
  });
  if (chained.status === 'failed') {
    return { status: 'failed', reason: 'chainBroken', version: version.version };
  }

  const parsed = target.schema.safeParse(chained.file);
  if (!parsed.success) {
    // A file that was already current and does not parse was never a
    // tournament; one that came through a chain and does not parse means the
    // chain is wrong. The host is told the same thing either way — the log of
    // issue #30 is not, and that is where a broken step gets found.
    return {
      status: 'failed',
      reason: version.status === 'outdated' ? 'invalidResult' : 'unreadable',
      version: version.version,
    };
  }

  return {
    status: 'ok',
    file: parsed.data,
    raw: chained.file,
    migratedFrom: version.status === 'outdated' ? version.version : null,
  };
}

/** The same, against the schema this build actually ships. */
export function migrateTournamentFile(json: unknown): MigrationOutcome<TournamentFileLike> {
  return migrateToTarget(json, CURRENT_SCHEMA);
}

function versionOf(file: RawTournamentFile): number {
  const version = file['schemaVersion'];
  return typeof version === 'number' ? version : 0;
}
