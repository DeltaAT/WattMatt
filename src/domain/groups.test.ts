import { describe, expect, it } from 'vitest';

import {
  addGroups,
  hasEnoughGroups,
  hasStarted,
  isRemovable,
  MINIMUM_GROUPS,
  nextGroupNumber,
  removeGroup,
} from '@/domain/groups';
import { groupIdSchema } from '@/domain/ids';
import { activeGroups } from '@/domain/selectors';
import { group, groupId, match, midTournament, round, tournament } from '@/domain/testFixtures';
import { groupSchema, tournamentSchema } from '@/domain/types';

/**
 * The group lifecycle (issue #14, docs/TOURNAMENT-RULES.md §2 and §9 case 9).
 *
 * The cases that matter here are the ones a host hits with a room filling up:
 * forty participants entered in one go, one of them entered twice and deleted
 * again, and somebody who turns up after the draw. The one rule underneath all
 * of them is that a number, once said out loud, belongs to that participant for
 * the evening.
 */

describe('numbering', () => {
  it('numbers the first group 1 and counts on from there', () => {
    const after = addGroups(tournament(), 3);

    expect(after.groups.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(after.groups.map((entry) => entry.id)).toEqual([groupId(1), groupId(2), groupId(3)]);
  });

  it('adds one at a time, which is what the `+` does', () => {
    const after = addGroups(addGroups(addGroups(tournament(), 1), 1), 1);

    expect(after.groups.map((entry) => entry.number)).toEqual([1, 2, 3]);
    expect(after.nextGroupNumber).toBe(4);
  });

  /* The acceptance criterion of issue #14: 40 participants, in one go. */
  it('adds a whole field in one bulk add', () => {
    const after = addGroups(tournament(), 40);

    expect(after.groups).toHaveLength(40);
    expect(after.groups.at(-1)?.number).toBe(40);
    expect(after.nextGroupNumber).toBe(41);
  });

  it('creates every group nameless and active', () => {
    const [created] = addGroups(tournament(), 1).groups;

    expect(created).toEqual({ id: groupId(1), number: 1, name: null, status: 'ACTIVE' });
    expect(groupSchema.safeParse(created).success).toBe(true);
  });

  it.each([
    ['zero', 0],
    ['a negative count', -3],
    ['nothing that is a number', Number.NaN],
  ])('creates nothing for %s', (_label, count) => {
    const before = tournament();

    expect(addGroups(before, count)).toBe(before);
  });

  it('floors a fractional count rather than minting half a group', () => {
    expect(addGroups(tournament(), 2.9).groups).toHaveLength(2);
  });

  /*
   * docs/TOURNAMENT-RULES.md §2: numbers are never reused. The counter is what
   * makes that true after a delete — `max(number) + 1` would hand 3 straight
   * back to the next participant, in front of a room that heard the first
   * Gruppe 3 ten minutes ago.
   */
  it('never hands a deleted number out again', () => {
    const three = addGroups(tournament(), 3);

    const afterDelete = removeGroup(three, groupId(3));
    const afterAdd = addGroups(afterDelete, 1);

    expect(afterAdd.groups.map((entry) => entry.number)).toEqual([1, 2, 4]);
  });

  it('reads the number off the stored counter, not off the list', () => {
    const emptied = removeGroup(removeGroup(addGroups(tournament(), 2), groupId(1)), groupId(2));

    expect(emptied.groups).toHaveLength(0);
    expect(nextGroupNumber(emptied)).toBe(3);
  });

  /*
   * A file repaired in Notepad can carry a counter below a group that exists.
   * Minting the same id twice would make `indexById` throw at load time, so the
   * counter is floored by what is actually there.
   */
  it('is floored by the groups that exist, whatever the counter says', () => {
    const repaired = tournament({ groups: [group(7)], nextGroupNumber: 2 });

    expect(nextGroupNumber(repaired)).toBe(8);
    expect(addGroups(repaired, 1).groups.at(-1)?.number).toBe(8);
  });

  it('ignores an id that does not follow the grp_<n> pattern', () => {
    const handWritten = tournament({
      groups: [group(1, { id: groupIdSchema.parse('grp_a') })],
      nextGroupNumber: 2,
    });

    expect(nextGroupNumber(handWritten)).toBe(2);
  });
});

describe('removing a group', () => {
  /* docs/TOURNAMENT-RULES.md §9 case 9, and the issue's acceptance criterion. */
  it('leaves 1, 2, 4, 5 when 3 of 5 is deleted — it never renumbers', () => {
    const five = addGroups(tournament(), 5);

    const after = removeGroup(five, groupId(3));

    expect(after.groups.map((entry) => entry.number)).toEqual([1, 2, 4, 5]);
    expect(after.groups.map((entry) => entry.id)).toEqual([
      groupId(1),
      groupId(2),
      groupId(4),
      groupId(5),
    ]);
  });

  it('does nothing for a group that is not in the tournament', () => {
    const before = addGroups(tournament(), 2);

    expect(removeGroup(before, groupId(9))).toBe(before);
  });

  /*
   * A group that has been drawn is named by a match, and deleting it would
   * leave a pairing against nobody on the beamer — a Freilos the draw never
   * granted (docs/TOURNAMENT-RULES.md §0).
   */
  it('refuses a group that has already been drawn into a match', () => {
    const drawn = tournament({
      groups: [group(1), group(2)],
      nextGroupNumber: 3,
      rounds: [round(1, { matches: [match(1, { a: groupId(1), b: groupId(2) })] })],
    });

    expect(isRemovable(drawn, groupId(1))).toBe(false);
    expect(removeGroup(drawn, groupId(1))).toBe(drawn);
  });

  it('refuses a group the repechage has already offered a slot to', () => {
    const offered = tournament({
      groups: [group(1), group(2)],
      nextGroupNumber: 3,
      repechage: {
        target: 4,
        pool: [],
        draws: [{ groupId: groupId(2), accepted: null }],
        fallbackUsed: null,
      },
    });

    expect(isRemovable(offered, groupId(2))).toBe(false);
  });

  it('refuses a group that is standing in the bracket', () => {
    // `midTournament` puts groups 1 and 2 in a semi-final and 3 in the
    // repechage; 4 has only ever been in a match. All four are spoken for.
    const running = midTournament();

    expect(running.groups.map((entry) => isRemovable(running, entry.id))).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it('allows a group that was added after the draw and has played nothing', () => {
    const late = addGroups(midTournament(), 1);
    const added = late.groups.at(-1);

    expect(added?.number).toBe(5);
    expect(isRemovable(late, groupId(5))).toBe(true);
    expect(removeGroup(late, groupId(5)).groups).toHaveLength(4);
  });

  it('leaves a removable tournament that still parses', () => {
    const after = removeGroup(addGroups(tournament(), 3), groupId(2));

    expect(tournamentSchema.safeParse(after).success).toBe(true);
  });

  it('does not touch the groups that stay', () => {
    const three = addGroups(tournament(), 3);

    const after = removeGroup(three, groupId(2));

    // Reference equality: the chips of the survivors must not re-render, and a
    // rebuilt group would also mean a rewritten name.
    expect(after.groups[0]).toBe(three.groups[0]);
    expect(activeGroups(after)).toHaveLength(2);
  });
});

describe('when a late entry has to be warned about', () => {
  it('is quiet while nothing has been drawn', () => {
    expect(hasStarted(addGroups(tournament(), 8))).toBe(false);
  });

  it('reports a tournament that has a round', () => {
    expect(hasStarted(midTournament())).toBe(true);
  });
});

describe('the minimum field', () => {
  it('is two participants (docs/TOURNAMENT-RULES.md §9 case 4)', () => {
    expect(MINIMUM_GROUPS).toBe(2);
    expect(hasEnoughGroups(addGroups(tournament(), 1))).toBe(false);
    expect(hasEnoughGroups(addGroups(tournament(), 2))).toBe(true);
  });
});
