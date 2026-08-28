import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v6 → v7: the `Trostrunde` runs the whole pipeline (issue #91,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * Until v7 the side event was a plain sequence of rounds — shuffle, pair,
 * repeat until one group is left — with no lottery of its own and no tree at
 * the end. It now runs the same pipeline the main field does, so it needs the
 * same three pieces of state: where it has got to, its own `Hoffnungsrunde`,
 * and its own bracket.
 *
 * A v6 side event comes back **at `QUALIFYING`, with neither of the other two**,
 * and each of those three is a reconstruction rather than a default:
 *
 *  - it has no lottery and no tree because the build that wrote it could not
 *    produce either, so null is the literal truth about the file;
 *  - `QUALIFYING` because that is where a side event with rounds but no lottery
 *    and no tree actually stands under the new rules. The alternative was to
 *    guess `ELIMINATION` from the number of rounds played, which would put a
 *    reopened event past the lottery it is now entitled to — and the lottery is
 *    the one part of this that hands somebody back a place.
 *
 * A *finished* v6 side event keeps its `state` and its `winnerId`, which is what
 * every panel reads; the phase written here is never consulted for it, because
 * nothing is offered for a track that is no longer running. Recorded in
 * docs/OPEN-QUESTIONS.md #99.
 *
 * A tournament whose host was never asked, or who said no, has `consolation:
 * null` and is handed straight back: there is no side event to bring forward.
 *
 * A hand-repaired v6 file that already carries any of the three fields keeps
 * it, for the reason `v3ToV4` gives about the pool and `v4ToV5` about the
 * track: evidence in the file beats a reconstruction, and docs/FILE-FORMAT.md
 * §Encoding invites the repair.
 */
export const v6ToV7: Migration = {
  from: 6,
  to: 7,
  migrate: (file) => {
    const consolation = file['consolation'];
    if (consolation === null || typeof consolation !== 'object' || Array.isArray(consolation)) {
      // Not an object — handed on untouched, so the schema reports it with a
      // path rather than this step failing with "could not be brought up to
      // date" (the argument `v4ToV5` makes about a round that is not one).
      return file;
    }

    const fields = consolation as RawTournamentFile;
    return {
      ...file,
      consolation: {
        ...fields,
        phase: 'phase' in fields ? fields['phase'] : 'QUALIFYING',
        repechage: 'repechage' in fields ? fields['repechage'] : null,
        bracket: 'bracket' in fields ? fields['bracket'] : null,
      },
    };
  },
};
