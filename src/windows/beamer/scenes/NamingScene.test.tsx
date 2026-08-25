import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { setGroupName } from '@/domain/naming';
import { setParticipantLabel } from '@/domain/settings';
import { toTournamentSnapshot, EMPTY_TOURNAMENT, type TournamentSnapshot } from '@/domain/snapshot';
import { group, groupId, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { NamingScene } from '@/windows/beamer/scenes/NamingScene';

/**
 * `NAMING` on the projector (issue #23, docs/TOURNAMENT-RULES.md §6).
 *
 * The scene defined by what it must **not** show. Behind it the host is
 * entering sixteen names one at a time, so the assertion that matters most is
 * the negative one: no name reaches the wall while the list is half full, and
 * therefore no typo on the way to being corrected either.
 */

function scene(snapshot: TournamentSnapshot, settled = true): string {
  return renderToStaticMarkup(<NamingScene tournament={snapshot} settled={settled} />);
}

/** Four participants, of which the first two have been named so far. */
const halfNamed = (): TournamentSnapshot => {
  const four = tournament({
    name: 'Sommerturnier',
    phase: 'NAMING',
    groups: [group(1), group(2), group(3), group(4)],
    nextGroupNumber: 5,
  });

  return toTournamentSnapshot(
    setGroupName(setGroupName(four, groupId(1), 'Die Adler'), groupId(2), 'Die Falken'),
  );
};

describe('the naming scene', () => {
  it('says what is happening and what comes next', () => {
    const markup = scene(halfNamed());

    expect(markup).toContain(de.beamer.naming.title);
    expect(markup).toContain(de.beamer.naming.notice);
  });

  /*
   * The whole point of the scene. A wall that followed the host's typing would
   * show the room a half-finished field and have them asking who is missing.
   */
  it('shows none of the names the host has entered so far', () => {
    const markup = scene(halfNamed());

    expect(markup).not.toContain('Die Adler');
    expect(markup).not.toContain('Die Falken');
  });

  it('says how many are through, which is the one number the room can be told', () => {
    expect(scene(halfNamed())).toContain(
      de.beamer.naming.field({ participants: de.participant.GROUP.count({ n: 4 }) }),
    );
  });

  it('counts only the participants who are still in', () => {
    const mixed = toTournamentSnapshot(
      tournament({
        groups: [group(1), group(2), group(3, { status: 'ELIMINATED' })],
        nextGroupNumber: 4,
      }),
    );

    expect(scene(mixed)).toContain(
      de.beamer.naming.field({ participants: de.participant.GROUP.count({ n: 2 }) }),
    );
  });

  it('counts in the wording this tournament uses', () => {
    const teams = toTournamentSnapshot(
      setParticipantLabel(tournament({ groups: [group(1), group(2)], nextGroupNumber: 3 }), 'TEAM'),
    );

    expect(scene(teams)).toContain(
      de.beamer.naming.field({ participants: de.participant.TEAM.count({ n: 2 }) }),
    );
  });

  /*
   * Somebody walking into the room during this phase has nothing else to tell
   * them what they have walked into.
   */
  it('carries the tournament name as chrome', () => {
    expect(scene(halfNamed())).toContain('Sommerturnier');
  });

  it('draws without a tournament rather than throwing in front of the room', () => {
    const markup = scene(EMPTY_TOURNAMENT);

    expect(markup).toContain(de.beamer.naming.title);
    expect(markup).not.toContain('data-naming-field');
    expect(markup).not.toContain('data-tournament-name');
  });

  /*
   * The scene sits on screen for minutes while nothing happens, so it settles
   * whether it was walked into live or found by a beamer that was reopened
   * (CLAUDE.md golden rule 4).
   */
  it('renders identically whether it was arrived at live or caught up with', () => {
    expect(scene(halfNamed(), false).replace(/data-settled="false"/, 'data-settled="true"')).toBe(
      scene(halfNamed(), true),
    );
  });
});
