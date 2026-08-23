import type { Migration } from '@/domain/migrations/types';

/**
 * Every migration this build knows, in no particular order — the runner picks
 * the step it needs by `from` (docs/FILE-FORMAT.md rule 7).
 *
 * Empty, and that is correct: v1 is the only `schemaVersion` that has ever
 * existed, so there is nothing to migrate *from* yet. The framework is here
 * first on purpose (issue #12) — the first real migration is then a file, a
 * fixture and a line in this array, rather than a design decision taken the
 * evening before an event.
 *
 * Adding one:
 *
 * 1. Bump `SCHEMA_VERSION` in `@/domain/schema` and change `tournamentSchema`.
 * 2. Add `src/domain/migrations/v1_to_v2.ts` exporting `const v1ToV2: Migration`.
 * 3. Append it here.
 * 4. Copy a file written by the previous build into `tests/fixtures/` as
 *    `v1.wattmatt`, and let `fixtures.test.ts` pick it up.
 *
 * The array must be contiguous from the oldest supported version up to
 * `SCHEMA_VERSION`; `runner.test.ts` asserts it, because a gap is a file that
 * opens on the developer's laptop and refuses on the host's.
 */
export const MIGRATIONS: readonly Migration[] = [];
