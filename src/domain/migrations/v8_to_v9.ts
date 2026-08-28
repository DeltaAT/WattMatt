import type { Migration } from '@/domain/migrations/types';

/**
 * v8 → v9: the `Trostrunde`'s field is written down rather than worked out
 * (issue #102, docs/TOURNAMENT-RULES.md §10).
 *
 * Until v9 the side event's field was read live off `group.status` every time
 * anybody asked. That is right only in the instant the `Hoffnungsrunde` closes:
 * let the main field play one more round first and that round's losers were
 * swept in with it, so `consolationField` is now a list in the file, fixed at
 * the moment the lottery closes and immutable afterwards.
 *
 * A v8 file comes back **null**, and null is a real answer rather than a
 * missing one: it says the field is not fixed yet. This is the one migration in
 * the chain that deliberately does not reconstruct, and the reason is that the
 * question it would have to answer first — *has the lottery closed?* — is
 * exactly the question that decides whether there is anything to reconstruct. A
 * file saved mid-`Hoffnungsrunde` would get a field frozen too early, with the
 * candidates still to be drawn wrongly inside it.
 *
 * Nothing is lost by waiting. The list is derived from the qualifying round's
 * matches and the lottery's draw records, both of which a v8 file already
 * carries untouched, so the first commit after the file is opened writes
 * exactly the list the build that wrote the file would have — `setOpenedDocument`
 * is a commit, so that happens before the host can click anything
 * (`settleConsolationField` in `@/domain/consolation`).
 *
 * A hand-repaired v8 file that already carries the field keeps it, for the
 * reason `v3ToV4` gives about the pool and `v7ToV8` about the table order:
 * evidence in the file beats a reconstruction, and docs/FILE-FORMAT.md
 * §Encoding invites the repair.
 */
export const v8ToV9: Migration = {
  from: 8,
  to: 9,
  migrate: (file) => {
    // `in` rather than a null check: a file that explicitly says `null` has been
    // through this step already, and "not fixed yet" is what it is saying.
    if ('consolationField' in file) {
      return file;
    }
    return { ...file, consolationField: null };
  },
};
