import type { Migration, RawTournamentFile } from '@/domain/migrations/types';

/**
 * v2 → v3: groups get the number counter tables already had (issue #14).
 *
 * docs/TOURNAMENT-RULES.md §2 requires that a group number is stable for the
 * whole tournament and never reused. A plain delete plus `max(number) + 1`
 * breaks that the moment the highest-numbered group is the one removed — the
 * next participant is called out as "Gruppe 12" in front of a room that heard
 * the first Gruppe 12 an hour ago (docs/OPEN-QUESTIONS.md #22).
 *
 * v2 has no such field, so it has to be reconstructed. The best evidence a v2
 * file holds is the highest `grp_<n>` it still mentions **anywhere** — a group,
 * a match that was drawn, a repechage draw, a bracket slot — plus one. That can
 * under-count, but only by numbers no surviving record refers to, which is
 * exactly the case the counter exists to protect. Same reconstruction as
 * `v1_to_v2` does for `nextTableNumber`, and for the same reason.
 *
 * Nothing else changes: a v2 group already has every field v3 wants.
 */
export const v2ToV3: Migration = {
  from: 2,
  to: 3,
  migrate: (file) => {
    // Not an array means these bytes were never a tournament. Handed on
    // untouched so the schema reports it, with a path, instead of this step
    // failing with "could not be brought up to date".
    if (!Array.isArray(file['groups'])) {
      return file;
    }

    return { ...file, nextGroupNumber: highestGroupNumberInFile(file) + 1 };
  },
};

const NUMBERED_ID = /^grp_(\d+)$/;

/**
 * The highest `grp_<n>` mentioned anywhere in a v2 file, or zero.
 *
 * Deliberately a walk over the raw JSON rather than over parsed entities: this
 * runs *before* the file is a `Tournament`, on bytes that may have been
 * repaired by hand, and a round or a bracket node in an unexpected shape has to
 * be skipped rather than throw. A missed reference costs one reused number in a
 * file that was already broken; a throw costs the host the whole tournament.
 */
function highestGroupNumberInFile(file: RawTournamentFile): number {
  const ids: unknown[] = [];
  let highest = 0;

  for (const group of asArray(file['groups'])) {
    const fields = asFields(group);
    ids.push(fields?.['id']);
    // The `number` as well as the id: they agree in every file this app has
    // written, and where a hand-repaired one disagrees the higher of the two is
    // the number that has been said out loud.
    const number = fields?.['number'];
    if (typeof number === 'number' && Number.isSafeInteger(number)) {
      highest = Math.max(highest, number);
    }
  }
  for (const round of asArray(file['rounds'])) {
    for (const match of asArray(asFields(round)?.['matches'])) {
      const fields = asFields(match);
      ids.push(fields?.['a'], fields?.['b'], fields?.['winnerId']);
    }
  }
  for (const draw of asArray(asFields(file['repechage'])?.['draws'])) {
    ids.push(asFields(draw)?.['groupId']);
  }
  for (const node of asArray(asFields(file['bracket'])?.['nodes'])) {
    const fields = asFields(node);
    ids.push(fields?.['slotA'], fields?.['slotB'], fields?.['winnerId']);
  }

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
