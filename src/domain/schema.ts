import { z } from 'zod';

import { tournamentSchema } from '@/domain/types';

/**
 * The `.wattmatt` file itself — docs/FILE-FORMAT.md §"Schema (v1)".
 *
 * Separate from `tournamentSchema` because the two answer different questions.
 * `Tournament` is what the store owns and what every domain function operates
 * on; `TournamentFile` is that plus the two stamps only a file needs: which
 * schema wrote it, and which build. Keeping them apart means the migration
 * framework (issue #12) can read the version off a file without the rest of
 * the app carrying a `schemaVersion` field it never reads.
 */

/**
 * Bumped on any breaking change, with a migration alongside it
 * (docs/FILE-FORMAT.md rule 7). Issue #12 owns that framework; v1 is the
 * only version that has ever existed, so nothing migrates yet.
 */
export const SCHEMA_VERSION = 1;

export const appStampSchema = z.object({
  name: z.literal('WattMatt'),
  version: z.string().min(1),
});
export type AppStamp = z.infer<typeof appStampSchema>;

/**
 * The tournament fields sit at the top level rather than nested under a
 * `tournament` key, because that is how FILE-FORMAT.md §"Schema (v1)" writes
 * them — and the file is meant to be repairable in Notepad, which is easier
 * with one level less of nesting.
 *
 * Parsing is strict: an unknown field is dropped, not preserved, which
 * FILE-FORMAT.md rule 7 will eventually forbid. That rule is issue #12's, and
 * the deferral is deliberate — see the note under rule 7. Making this
 * permissive now would disarm `schema.test.ts`, which detects a field
 * forgotten in the schema precisely because an unknown key does *not* survive
 * the round trip.
 */
export const tournamentFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    app: appStampSchema,
  })
  .extend(tournamentSchema.shape);

export type TournamentFile = z.infer<typeof tournamentFileSchema>;
