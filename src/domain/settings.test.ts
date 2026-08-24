import { describe, expect, it } from 'vitest';

import { setParticipantLabel } from '@/domain/settings';
import { midTournament, tournament } from '@/domain/testFixtures';

/**
 * The tournament's own settings (issue #14).
 *
 * `participantLabel` decides one thing and nothing else: which German noun the
 * host and the audience read. The point of the test is that it really is
 * nothing else — a setting that quietly rewrote the field would be discovered
 * mid-event.
 */

describe('setParticipantLabel', () => {
  it('switches the wording the whole app reads', () => {
    expect(setParticipantLabel(tournament(), 'TEAM').settings.participantLabel).toBe('TEAM');
  });

  it('changes nothing else about the tournament', () => {
    const before = midTournament();

    const after = setParticipantLabel(before, 'PLAYER');

    expect({ ...after, settings: before.settings }).toEqual(before);
    expect(after.groups).toBe(before.groups);
  });

  /* A no-op must not commit: it would put a step on the undo stack that undoes
   * nothing and dirty a file that is on disk (see `@/store/actions/groups`). */
  it('hands the tournament straight back when the wording is already that', () => {
    const before = tournament();

    expect(setParticipantLabel(before, 'GROUP')).toBe(before);
  });
});
