import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v3 → v4: the repechage records who is still in the pot (issue #20).
 *
 * docs/TOURNAMENT-RULES.md §4 draws candidates out of `pool := shuffle(L)`,
 * one at a time, with the host answering each. That list has to be in the file:
 * it was produced by a single shuffle at one position of the RNG stream, and
 * every draw since has moved the cursor past it, so a laptop restarted mid-phase
 * cannot reconstruct it — it could only shuffle again, and offer the room a
 * different candidate than the pot it was shown.
 *
 * A v3 file has no such field, and unlike `occupiedSince` (v1 → v2) or
 * `nextGroupNumber` (v2 → v3) there is **nothing in the file to reconstruct it
 * from**: `draws` records who was taken out of the pot, never who was left in.
 * So the pool comes back empty, which is the one honest answer and also the
 * conservative one — an empty pool with slots still open is exactly the state
 * §4's fallback dialog exists for, and the host is asked rather than handed a
 * candidate the app invented.
 *
 * In practice no released build ever wrote a repechage: issue #20 is the first
 * code that creates one, so every v3 file in the wild has `repechage: null` and
 * this step does nothing at all to it. The branch is here for the file that was
 * repaired by hand, which docs/FILE-FORMAT.md §Encoding invites.
 */
export const v3ToV4: Migration = {
  from: 3,
  to: 4,
  migrate: (file) => {
    const repechage = file['repechage'];
    // Null is the common case — the phase was skipped, or never reached — and
    // anything that is not an object was never a repechage. Both are handed on
    // untouched so the schema reports them, with a path, instead of this step
    // failing with "could not be brought up to date".
    if (repechage === null || typeof repechage !== 'object' || Array.isArray(repechage)) {
      return file;
    }

    const fields = repechage as RawTournamentFile;
    // A hand-written v3 file that already carries a pool keeps it: the field is
    // the one thing this step cannot derive, so evidence beats the default.
    if (Array.isArray(fields['pool'])) {
      return file;
    }

    return { ...file, repechage: { ...fields, pool: [] } };
  },
};
