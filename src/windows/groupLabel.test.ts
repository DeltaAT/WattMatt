import { describe, expect, it } from 'vitest';

import type { GroupId } from '@/domain/ids';
import { group, groupId } from '@/domain/testFixtures';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * What a participant is called on both screens (issue #13).
 *
 * One function for the host and the beamer, because the two disagreeing about
 * who is playing where is the failure golden rule 4 exists to prevent.
 */

const byId: ReadonlyMap<GroupId, Group> = new Map([
  [groupId(1), group(1)],
  [groupId(2), group(2, { name: 'Die Schnellen' })],
]);

describe('groupLabel', () => {
  /* The number is the identity of a participant for the whole event
   * (docs/TOURNAMENT-RULES.md §0); a name only exists from the naming phase. */
  it('falls back to the number while a group has no name', () => {
    expect(groupLabel(groupId(1), byId, 'GROUP')).toEqual({
      text: de.participant.GROUP.numbered({ n: 1 }),
      isBye: false,
    });
  });

  /* The host may be running `Teams` or `Spieler` rather than `Gruppen`
   * (issue #14). Both screens read the wording off the same setting, so a
   * participant is called the same thing on the laptop and on the wall. */
  it('uses the wording this tournament chose', () => {
    expect(groupLabel(groupId(1), byId, 'TEAM').text).toBe('Team 1');
    expect(groupLabel(groupId(1), byId, 'PLAYER').text).toBe('Spieler 1');
  });

  it('prefers the name once there is one', () => {
    expect(groupLabel(groupId(2), byId, 'GROUP').text).toBe('Die Schnellen');
  });

  it('calls the empty side of a match a Freilos, not a missing group', () => {
    expect(groupLabel(null, byId, 'GROUP')).toEqual({ text: de.outcome.bye, isBye: true });
  });

  /* A group id that names nothing — a file repaired by hand. Said out loud
   * rather than drawn as a blank, so the host can see which table is wrong. */
  it('says so when the id names no group at all', () => {
    expect(groupLabel(groupId(9), byId, 'GROUP')).toEqual({
      text: de.group.unknown,
      isBye: false,
    });
  });
});
