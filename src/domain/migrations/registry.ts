import type { Migration } from '@/domain/migrations/types';
import { v1ToV2 } from '@/domain/migrations/v1_to_v2';
import { v2ToV3 } from '@/domain/migrations/v2_to_v3';
import { v3ToV4 } from '@/domain/migrations/v3_to_v4';
import { v4ToV5 } from '@/domain/migrations/v4_to_v5';
import { v5ToV6 } from '@/domain/migrations/v5_to_v6';
import { v6ToV7 } from '@/domain/migrations/v6_to_v7';

/**
 * Every migration this build knows, in no particular order — the runner picks
 * the step it needs by `from` (docs/FILE-FORMAT.md rule 7).
 *
 * The framework landed empty on purpose (issue #12), so that the first real
 * migration would be a file, a fixture and a line in this array rather than a
 * design decision taken the evening before an event. `v1ToV2` is that first
 * one: issue #13 gave tables an `occupiedSince` stamp, and the live occupancy
 * board cannot answer "how long has this been running?" without it.
 *
 * Adding one:
 *
 * 1. Bump `SCHEMA_VERSION` in `@/domain/schema` and change `tournamentSchema`.
 * 2. Add `src/domain/migrations/v2_to_v3.ts` exporting `const v2ToV3: Migration`.
 * 3. Append it here.
 * 4. Copy a file written by the previous build into `tests/fixtures/` as
 *    `v2.wattmatt`, and let `fixtures.test.ts` pick it up.
 *
 * The array must be contiguous from the oldest supported version up to
 * `SCHEMA_VERSION`; `runner.test.ts` asserts it, because a gap is a file that
 * opens on the developer's laptop and refuses on the host's.
 */
export const MIGRATIONS: readonly Migration[] = [v1ToV2, v2ToV3, v3ToV4, v4ToV5, v5ToV6, v6ToV7];
