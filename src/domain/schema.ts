import { z } from 'zod';

import { tournamentSchema } from '@/domain/types';

/**
 * The `.wattmatt` file itself — docs/FILE-FORMAT.md §"Schema (v8)".
 *
 * Separate from `tournamentSchema` because the two answer different questions.
 * `Tournament` is what the store owns and what every domain function operates
 * on; `TournamentFile` is that plus the two stamps only a file needs: which
 * schema wrote it, and which build. Keeping them apart means the migration
 * framework (`@/domain/migrations`) can read the version off a file without the
 * rest of the app carrying a `schemaVersion` field it never reads.
 */

/**
 * Bumped on any breaking change, with a migration alongside it
 * (docs/FILE-FORMAT.md rule 7, `@/domain/migrations/registry`).
 *
 * v2 added `occupiedSince` to a table and made the three occupancy fields a
 * checked invariant (issue #13). A v1 table has neither, so a v1 file cannot
 * satisfy this schema — which is what a bump means.
 *
 * v3 added `nextGroupNumber`, the group-number counter that makes "numbers are
 * never reused" true after a group is deleted (issue #14,
 * docs/TOURNAMENT-RULES.md §2). A v2 file has no such field, and it is required
 * rather than optional for the same reason `nextTableNumber` is: a counter that
 * may be absent is one every caller has to guess a default for, and the guess
 * is exactly the `max + 1` the counter exists to avoid.
 *
 * v4 added `repechage.pool`, the candidates the `Hoffnungsrunde` has still to
 * draw (issue #20, docs/TOURNAMENT-RULES.md §4). A v3 file cannot say who is
 * left in the pot: the order was produced by one shuffle at one position of the
 * RNG stream, and the cursor has moved on past it with every draw since. It is
 * required rather than optional because an absent pool and an empty one are the
 * two states §4 has to tell apart — the second is what triggers the fallback
 * dialog.
 *
 * v5 gave every round a `track` and the tournament a `consolation` record
 * (issue #73, docs/TOURNAMENT-RULES.md §10). The `Trostrunde` runs beside the
 * main field rather than after it, so "the open round" became a question with
 * two answers and the file has to say which one each round is. Both fields are
 * required rather than optional for the reason `nextGroupNumber` is: a track
 * that may be absent is one every queue, board and undo has to guess a default
 * for, and a guess about which half of the evening a round belongs to is a
 * guess made in front of an audience.
 *
 * v6 gave a table a `reservedFor` track (issue #79) — the host's standing
 * answer to which half of the evening a table serves, which they otherwise had
 * to re-decide on every table.
 *
 * v7 gave the `Trostrunde` a `phase`, a `repechage` and a `bracket` of its own
 * (issue #91, docs/TOURNAMENT-RULES.md §10). The side event now runs the same
 * pipeline as the main field rather than a plain sequence of rounds, so it
 * needs the same three pieces of state — and they cannot be the main field's,
 * because the two tracks run at the same time and are routinely in different
 * phases. All three are required rather than optional for the reason the track
 * was: a phase that may be absent is one every panel has to guess a default
 * for, and that guess decides what the host is offered next.
 *
 * v8 gave `settings` a `tableAssignmentOrder` (issue #101,
 * docs/TOURNAMENT-RULES.md §3) — which end of the host's table list free tables
 * are handed out from. A v7 file was written by a build that could only fill
 * from the first table, so it comes back `ASCENDING`, which is what it did.
 * Required rather than optional for the reason every other setting is: an
 * absent direction is one the draw, the tree and every table picker would have
 * to default separately, and four copies of a default are four places for them
 * to disagree.
 */
export const SCHEMA_VERSION = 8;

export const appStampSchema = z.object({
  name: z.literal('WattMatt'),
  version: z.string().min(1),
});
export type AppStamp = z.infer<typeof appStampSchema>;

/**
 * The tournament fields sit at the top level rather than nested under a
 * `tournament` key, because that is how FILE-FORMAT.md §"Schema (v8)" writes
 * them — and the file is meant to be repairable in Notepad, which is easier
 * with one level less of nesting.
 *
 * The schema describes the fields this build *knows*. A top-level field it does
 * not know is not part of `TournamentFile` and never reaches the store — it is
 * carried beside it by `carriedFields` and put back by `withCarriedFields`, so
 * a file written by a later build survives being opened and saved by this one
 * (docs/FILE-FORMAT.md rule 7).
 *
 * Deliberately at the top level only. Nested objects still parse strictly, and
 * `schema.test.ts` leans on it: a field added to `settings` or to a `match` but
 * forgotten here fails the round-trip assertion instead of being dropped on the
 * host's next save. The top-level equivalent of that guard is
 * `covers every field of the documented example`, which does not depend on
 * strictness at all.
 */
export const tournamentFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    app: appStampSchema,
  })
  .extend(tournamentSchema.shape);

export type TournamentFile = z.infer<typeof tournamentFileSchema>;

/**
 * A tournament file at *some* schema version.
 *
 * `TournamentFile` pins `schemaVersion` to the literal this build writes, which
 * is what makes the schema refuse a file it does not understand. Everything
 * that works on a file *whatever* version it came from — the migration runner's
 * target, and stripping the stamps back off — wants the widened form instead.
 */
export type TournamentFileLike = Omit<TournamentFile, 'schemaVersion'> & { schemaVersion: number };

/** Every top-level key this build writes and understands. */
export const KNOWN_FILE_FIELDS: readonly string[] = Object.keys(tournamentFileSchema.shape);

const KNOWN: ReadonlySet<string> = new Set(KNOWN_FILE_FIELDS);

/**
 * Top-level fields of an opened file that this build does not know.
 *
 * They belong to the file, not to the tournament: nothing in `src/domain` reads
 * them, no action can change them, and they are written back out untouched.
 * That is the whole of forward compatibility — an older build opening a file
 * from a newer one must hand it back with the newer build's fields intact,
 * rather than quietly stripping the half it could not read.
 */
export type CarriedFields = Readonly<Record<string, unknown>>;

export const NO_CARRIED_FIELDS: CarriedFields = Object.freeze({});

export function carriedFields(json: unknown): CarriedFields {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return NO_CARRIED_FIELDS;
  }

  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(json)) {
    // `__proto__` is an own property when it came through JSON.parse, and
    // writing it back with `=` would set a prototype rather than a field. A
    // file cannot smuggle one through us; it is dropped like the nonsense it is.
    if (KNOWN.has(key) || key === '__proto__') {
      continue;
    }
    carried[key] = value;
  }
  return Object.keys(carried).length === 0 ? NO_CARRIED_FIELDS : carried;
}

/**
 * The file as it goes to disk: what this build knows, plus what it carried.
 *
 * Known fields win, and the order is deliberate — a carried key that collides
 * with one this build owns is a stale copy of a field the tournament is now
 * authoritative for, and writing it over the real one would resurrect it.
 */
export function withCarriedFields(
  file: TournamentFile,
  carried: CarriedFields,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...file };
  for (const [key, value] of Object.entries(carried)) {
    if (KNOWN.has(key) || key === '__proto__') {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}
