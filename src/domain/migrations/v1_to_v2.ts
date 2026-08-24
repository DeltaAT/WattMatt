import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v1 → v2: tables learn when the match on them started (issue #13).
 *
 * The occupancy board answers "how long has this been running?", and a laptop
 * restarted mid-event has to answer it too — so the stamp lives in the file
 * rather than in memory (`occupiedSince` in `@/domain/types`).
 *
 * v1 has no such stamp, so a v1 file that is in the middle of a round has to be
 * given one. `updatedAt` is the only evidence in the file about when anything
 * last happened, and it is the *safe* direction to guess in: it is later than
 * the true start, so the board under-reports rather than inventing a match that
 * has apparently been running since this morning.
 *
 * The second thing this step does is repair a state v1 could express and v2
 * cannot: a table that calls itself `OCCUPIED` while naming no match. v2 checks
 * the two together (`tableSchema`), so such a table has to be decided one way
 * or the other, and it comes back **free** — a free table the host has to mark
 * busy again costs one click, while a busy table that is really free silently
 * holds up the queue for the rest of the event.
 *
 * The third is `nextTableNumber`, v2's table-number counter. v1 derived the
 * number from the tables it had, so a v1 file does not record how high the
 * numbering ever reached. The best reconstruction is the highest `tbl_<n>` the
 * file still mentions anywhere — a table, a match that was played on one, a
 * bracket node — plus one. That can under-count, but only by numbers no
 * surviving record refers to, which is exactly the case the counter exists to
 * protect (docs/OPEN-QUESTIONS.md #37).
 */
export const v1ToV2: Migration = {
  from: 1,
  to: 2,
  migrate: (file) => {
    const tables = file['tables'];
    // Not an array means these bytes were never a tournament. Handed on
    // untouched so the schema reports it, with a path, instead of this step
    // failing with "could not be brought up to date".
    if (!Array.isArray(tables)) {
      return file;
    }

    const updatedAt = file['updatedAt'];
    const hasOccupied = tables.some((table) => isOccupied(table));
    if (hasOccupied && typeof updatedAt !== 'string') {
      // A refusal rather than a guess: there is nothing else in the file that
      // says when the match on that table began (see `Migration.migrate`).
      throw new Error('v1 file has an occupied table but no usable updatedAt');
    }

    return {
      ...file,
      tables: tables.map((table) => migrateTable(table, updatedAt)),
      nextTableNumber: highestTableNumberInFile(file) + 1,
    };
  },
};

const NUMBERED_ID = /^tbl_(\d+)$/;

/**
 * The highest `tbl_<n>` mentioned anywhere in a v1 file, or zero.
 *
 * Deliberately a walk over the raw JSON rather than over parsed entities: this
 * runs *before* the file is a `Tournament`, on bytes that may be repaired by
 * hand, and a round or a bracket node in an unexpected shape has to be skipped
 * rather than throw. A missed reference costs one reused number in a file that
 * was already broken; a throw costs the host the whole tournament.
 */
function highestTableNumberInFile(file: RawTournamentFile): number {
  const ids: unknown[] = [];

  for (const table of asArray(file['tables'])) {
    ids.push(asFields(table)?.['id']);
  }
  for (const round of asArray(file['rounds'])) {
    for (const match of asArray(asFields(round)?.['matches'])) {
      ids.push(asFields(match)?.['tableId']);
    }
  }
  for (const node of asArray(asFields(file['bracket'])?.['nodes'])) {
    ids.push(asFields(node)?.['tableId']);
  }

  let highest = 0;
  for (const id of ids) {
    if (typeof id !== 'string') {
      continue;
    }
    const matched = NUMBERED_ID.exec(id);
    highest = Math.max(highest, matched?.[1] === undefined ? 0 : Number(matched[1]));
  }
  return highest;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function asFields(value: unknown): RawTournamentFile | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as RawTournamentFile;
}

function migrateTable(table: unknown, updatedAt: unknown): unknown {
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    return table;
  }

  const fields = { ...(table as RawTournamentFile) };
  if (isOccupied(table)) {
    return { ...fields, occupiedSince: updatedAt };
  }

  // Free and disabled tables hold nothing, whatever v1 wrote next to them —
  // and a table that called itself busy without naming a match is not busy.
  // `DISABLED` survives: it is a decision the host took about the furniture,
  // not a claim about a match.
  return {
    ...fields,
    status: fields['status'] === 'DISABLED' ? 'DISABLED' : 'FREE',
    currentMatchId: null,
    occupiedSince: null,
  };
}

/** A v1 table that both claims to be busy and names the match it is busy with. */
function isOccupied(table: unknown): boolean {
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    return false;
  }
  const fields = table as RawTournamentFile;
  return fields['status'] === 'OCCUPIED' && typeof fields['currentMatchId'] === 'string';
}
