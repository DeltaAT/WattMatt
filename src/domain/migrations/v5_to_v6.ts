import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v5 → v6: a table can be reserved for a track (issue #79).
 *
 * docs/TOURNAMENT-RULES.md §10 already let the two tracks run in parallel out of
 * one pool of tables; what v6 adds is the host's standing answer to *which*
 * tables a track may use — the sentence they say to the room once and then had
 * to re-decide on every table for the rest of the evening.
 *
 * Every table comes back **unreserved**, and that is a reconstruction rather
 * than a default: a v5 file was written by a build in which no table could be
 * reserved, so every table in it served both tracks. Null says exactly that.
 *
 * A hand-repaired v5 file that already carries the field keeps it, for the
 * reason `v3ToV4` gives about the pool and `v4ToV5` about the track: evidence
 * in the file beats a reconstruction, and docs/FILE-FORMAT.md §Encoding invites
 * the repair.
 */
export const v5ToV6: Migration = {
  from: 5,
  to: 6,
  migrate: (file) => {
    const tables = file['tables'];
    if (!Array.isArray(tables)) {
      return file;
    }
    return { ...file, tables: tables.map((table) => unreserved(table)) };
  },
};

/**
 * One table, serving both tracks.
 *
 * Anything that is not an object is handed on untouched, so the schema reports
 * it with a path rather than this step failing with "could not be brought up to
 * date" — the same argument `v4ToV5` makes about a round that is not one.
 */
function unreserved(table: unknown): unknown {
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    return table;
  }
  const fields = table as RawTournamentFile;
  if ('reservedFor' in fields) {
    return table;
  }
  return { ...fields, reservedFor: null };
}
