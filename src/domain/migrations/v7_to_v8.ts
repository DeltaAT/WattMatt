import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v7 → v8: the host chooses which end of the table list is filled first
 * (issue #101, docs/TOURNAMENT-RULES.md §3).
 *
 * Until v8 a free table was always taken from the front of the host's list.
 * Which end of a hall is the good end is a property of the room, though — the
 * high-numbered tables may be the ones by the beamer, the bar or the stage —
 * so `settings.tableAssignmentOrder` says which end the app reaches for.
 *
 * A v7 file comes back **`ASCENDING`**, and that is a reconstruction rather
 * than a default: the build that wrote it had no other behaviour, so every
 * table it ever handed out was handed out from the front. `ASCENDING` is the
 * literal truth about what that file's evening did.
 *
 * A v7 file whose `settings` is not an object is handed on untouched, so the
 * schema reports it with a path rather than this step failing with "could not
 * be brought up to date" — the same argument `v4ToV5` makes about a round that
 * is not one.
 *
 * A hand-repaired v7 file that already carries the field keeps it, for the
 * reason `v3ToV4` gives about the pool and `v5ToV6` about the reservation:
 * evidence in the file beats a reconstruction, and docs/FILE-FORMAT.md
 * §Encoding invites the repair.
 */
export const v7ToV8: Migration = {
  from: 7,
  to: 8,
  migrate: (file) => {
    const settings = file['settings'];
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
      return file;
    }

    const fields = settings as RawTournamentFile;
    if ('tableAssignmentOrder' in fields) {
      return file;
    }
    return { ...file, settings: { ...fields, tableAssignmentOrder: 'ASCENDING' } };
  },
};
