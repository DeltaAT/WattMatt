import { describe, expect, it } from 'vitest';

import type { GroupId } from '@/domain/ids';
import { group, groupId } from '@/domain/testFixtures';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel, groupNumber } from '@/windows/groupLabel';

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

/**
 * And what it is called on the beamer, in a group round (issue #75).
 *
 * The same three cases, answered the other way. The word in front of the number
 * carries nothing, and thirty-two copies of it are the width the numerals could
 * have had — so the beamer takes the number and the host keeps the sentence.
 */
describe('groupNumber', () => {
  it('is the bare number, with no word in front of it', () => {
    expect(groupNumber(groupId(1), byId)).toEqual({ text: '1', isBye: false });
    expect(groupNumber(groupId(1), byId).text).not.toContain(de.participant.GROUP.one);
  });

  /*
   * Group rounds run before the naming phase (docs/TOURNAMENT-RULES.md §6), so
   * a name this early can only come from a file repaired by hand — and a board
   * where one card carried a name and thirty-one carried a number would be two
   * designs at once. Names come back with the `Turnierbaum` (issue #23).
   */
  it('keeps the number even once a group has a name', () => {
    expect(groupNumber(groupId(2), byId).text).toBe('2');
  });

  /*
   * The one thing a number cannot say. It is the audience's only explanation of
   * why somebody advanced without playing (docs/TOURNAMENT-RULES.md §9 case 1).
   */
  it('still calls the empty side of a match a Freilos', () => {
    expect(groupNumber(null, byId)).toEqual({ text: de.outcome.bye, isBye: true });
  });

  it('still says so when the id names no group at all', () => {
    expect(groupNumber(groupId(9), byId)).toEqual({ text: de.group.unknown, isBye: false });
  });

  /*
   * The wording is the host's setting and no longer reaches a beamer match card
   * at all — which is the point of the change, and the reason this function
   * takes no `ParticipantLabel`. The host's form still does, and still says the
   * whole thing.
   */
  it('leaves the wording to the host screen, which keeps it', () => {
    for (const participant of ['GROUP', 'TEAM', 'PLAYER'] as const) {
      expect(groupLabel(groupId(1), byId, participant).text).toContain(
        de.participant[participant].one,
      );
    }
    expect(groupNumber(groupId(1), byId).text).toBe('1');
  });
});
