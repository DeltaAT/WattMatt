import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v4 → v5: two tournaments can be live at once (issue #73).
 *
 * docs/TOURNAMENT-RULES.md §10 adds the `Trostrunde`, a side event for the
 * first-round losers that runs *beside* the main field rather than after it.
 * Two things follow, and both are in the file.
 *
 * Every round says which track it is on. A v4 file has no such field, but
 * unlike `repechage.pool` (v3 → v4) it is not unknowable: v4 had no side event
 * to be on, so every round in it belongs to the main field by construction.
 * `MAIN` is a reconstruction, not a default.
 *
 * The tournament gains `consolation`, which comes back **null** — the host has
 * not been asked. Null rather than `{ state: 'DECLINED' }` because the two are
 * different answers: a v4 tournament reopened mid-event should still be offered
 * the side event if its `Hoffnungsrunde` is only now closing, and a file that
 * came back already having declined would take that decision away from a host
 * who was never asked (docs/OPEN-QUESTIONS.md #85).
 *
 * A hand-repaired v4 file that already carries either field keeps it, for the
 * reason `v3ToV4` gives about the pool: evidence in the file beats a
 * reconstruction, and docs/FILE-FORMAT.md §Encoding invites the repair.
 */
export const v4ToV5: Migration = {
  from: 4,
  to: 5,
  migrate: (file) => {
    const migrated: RawTournamentFile = { ...file };

    const rounds = file['rounds'];
    if (Array.isArray(rounds)) {
      migrated['rounds'] = rounds.map((round) => withTrack(round));
    }

    // `in` rather than a null check: a file that explicitly says `null` has
    // been through this step already, and writing over it would re-ask a
    // question the host has answered.
    if (!('consolation' in file)) {
      migrated['consolation'] = null;
    }

    return migrated;
  },
};

/**
 * One round, on the track it must have been on.
 *
 * Anything that is not an object is handed on untouched, so the schema reports
 * it with a path rather than this step failing with "could not be brought up to
 * date" — the same argument `v3ToV4` makes about a `repechage` that is not one.
 */
function withTrack(round: unknown): unknown {
  if (round === null || typeof round !== 'object' || Array.isArray(round)) {
    return round;
  }
  const fields = round as RawTournamentFile;
  if ('track' in fields) {
    return round;
  }
  return { ...fields, track: 'MAIN' };
}
