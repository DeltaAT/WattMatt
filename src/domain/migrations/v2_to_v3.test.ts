import { describe, expect, it } from 'vitest';

import { v2ToV3 } from '@/domain/migrations/v2_to_v3';

/**
 * The second real migration (issue #14, docs/FILE-FORMAT.md rule 7).
 *
 * v3 gave groups the number counter tables already had. A v2 file has no such
 * field, so the whole of this step is the reconstruction: how high did the
 * numbering ever reach, given only what the file still mentions? Getting it
 * wrong hands a departed participant's number to somebody else
 * (docs/TOURNAMENT-RULES.md §2).
 */

function v2File(fields: Record<string, unknown>): Record<string, unknown> {
  return { schemaVersion: 2, name: 'Vereinsturnier', groups: [], ...fields };
}

const group = (n: number) => ({ id: `grp_${n}`, number: n, name: null, status: 'ACTIVE' });

const counterOf = (file: Record<string, unknown>): unknown =>
  v2ToV3.migrate(file)['nextGroupNumber'];

describe('v2 → v3', () => {
  it('announces the step it takes', () => {
    expect(v2ToV3).toMatchObject({ from: 2, to: 3 });
  });

  it('counts on from the highest group in the file', () => {
    expect(counterOf(v2File({ groups: [group(1), group(2), group(3)] }))).toBe(4);
  });

  it('starts at 1 for a tournament that has no groups yet', () => {
    expect(counterOf(v2File({ groups: [] }))).toBe(1);
  });

  /*
   * The case the counter exists for. A v2 file whose highest-numbered group was
   * deleted still mentions it in the round it played, and that is the evidence
   * that the number is spent — deriving from `groups` alone would hand grp_9
   * back out to the next participant.
   */
  it('finds a number that only a played match still remembers', () => {
    const file = v2File({
      groups: [group(1), group(2)],
      rounds: [
        {
          id: 'rnd_1',
          matches: [{ id: 'mt_1', a: 'grp_1', b: 'grp_9', winnerId: 'grp_9', status: 'DONE' }],
        },
      ],
    });

    expect(counterOf(file)).toBe(10);
  });

  it('finds a number a repechage draw remembers', () => {
    const file = v2File({
      groups: [group(1)],
      repechage: { target: 4, draws: [{ groupId: 'grp_6', accepted: false }], fallbackUsed: null },
    });

    expect(counterOf(file)).toBe(7);
  });

  it('finds a number a bracket slot remembers', () => {
    const file = v2File({
      groups: [group(1)],
      bracket: {
        size: 4,
        nodes: [{ id: 'bn_1', slotA: 'grp_12', slotB: null, winnerId: null }],
        thirdPlaceNodeId: null,
      },
    });

    expect(counterOf(file)).toBe(13);
  });

  /*
   * A file repaired in Notepad can carry a `number` that its id does not match.
   * The higher of the two is the one that was said out loud in the room.
   */
  it('trusts the higher of a hand-edited id and number', () => {
    expect(counterOf(v2File({ groups: [{ ...group(1), id: 'grp_a', number: 5 }] }))).toBe(6);
  });

  it('changes nothing else about the file', () => {
    const file = v2File({ groups: [group(1)], phase: 'QUALIFYING' });

    const { nextGroupNumber: _counter, ...rest } = v2ToV3.migrate(file);

    expect(rest).toEqual(file);
  });

  it('does not mutate the file it was given', () => {
    const file = v2File({ groups: [group(1)] });

    v2ToV3.migrate(file);

    expect(file['nextGroupNumber']).toBeUndefined();
  });

  /*
   * Bytes that were never a tournament are handed on untouched, so the schema
   * reports them with a path rather than this step failing with "could not be
   * brought up to date".
   */
  it('passes a file without a group list straight through', () => {
    const notATournament = { schemaVersion: 2, groups: 'nonsense' };

    expect(v2ToV3.migrate(notATournament)).toBe(notATournament);
  });

  /* A round or a node in an unexpected shape is skipped, never thrown on: a
   * throw costs the host the whole tournament. */
  it('survives rounds, draws and nodes in shapes it does not expect', () => {
    const file = v2File({
      groups: [group(2)],
      rounds: ['not a round', { matches: 'not a list' }, { matches: [null, 42] }],
      repechage: 'not a repechage',
      bracket: { nodes: [null] },
    });

    expect(counterOf(file)).toBe(3);
  });
});
