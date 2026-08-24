import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { addGroups } from '@/domain/groups';
import { setParticipantLabel } from '@/domain/settings';
import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import { group, midTournament, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { GroupOverviewScene } from '@/windows/beamer/scenes/GroupOverviewScene';

/**
 * `GROUP_OVERVIEW` on the projector (issue #14).
 *
 * The scene that is on while the room fills up, so what is asserted is that
 * everybody who has been entered is on the wall, that the field the issue names
 * — 64 — fits without a scrollbar and above the type floor, and that the words
 * are the ones this tournament chose.
 */

function scene(snapshot: TournamentSnapshot): string {
  return renderToStaticMarkup(<GroupOverviewScene tournament={snapshot} settled />);
}

const withGroups = (count: number): TournamentSnapshot =>
  toTournamentSnapshot(addGroups(tournament(), count));

describe('the group overview scene', () => {
  it('draws every participant, in the order they were entered', () => {
    const markup = scene(withGroups(5));

    expect(chips(markup)).toHaveLength(5);
    expect(markup.indexOf('data-group-id="grp_1"')).toBeLessThan(
      markup.indexOf('data-group-id="grp_2"'),
    );
  });

  it('says how many are at the start, which the room cannot count for itself', () => {
    expect(scene(withGroups(24))).toContain(
      de.beamer.groupOverview.count({ participants: de.participant.GROUP.count({ n: 24 }) }),
    );
  });

  it('shows a name once there is one, and the number until then', () => {
    const named = toTournamentSnapshot(
      tournament({ groups: [group(1), group(2, { name: 'Die Rasenden' })], nextGroupNumber: 3 }),
    );

    expect(scene(named)).toContain('Die Rasenden');
    expect(scene(named)).toContain(de.participant.GROUP.numbered({ n: 1 }));
  });

  it('marks a participant who is out, in a word as well as a colour', () => {
    const markup = scene(toTournamentSnapshot(midTournament()));

    expect(markup).toContain('data-group-status="ELIMINATED"');
    expect(markup).toContain(de.outcome.eliminated);
  });

  it('says so when nobody has been entered yet', () => {
    expect(scene(withGroups(0))).toContain(de.participant.GROUP.beamerEmpty);
  });

  /* The host and the projector must never call a participant two different
   * things, so the wording travels in the snapshot (golden rule 4). */
  it.each([
    ['TEAM' as const, 'Teams'],
    ['PLAYER' as const, 'Spieler'],
  ])('uses the wording of a tournament played in %s', (label, heading) => {
    const markup = scene(
      toTournamentSnapshot(setParticipantLabel(addGroups(tournament(), 2), label)),
    );

    expect(markup).toContain(heading);
  });

  /* The beamer must not replay an animation for a scene it is already showing
   * (issue #5): a reopened window catches up settled. */
  it('reports whether it is catching up or arriving live', () => {
    const snapshot = withGroups(4);

    expect(renderToStaticMarkup(<GroupOverviewScene tournament={snapshot} settled />)).toContain(
      'data-settled="true"',
    );
    expect(
      renderToStaticMarkup(<GroupOverviewScene tournament={snapshot} settled={false} />),
    ).toContain('data-settled="false"');
  });

  /*
   * The acceptance criterion of issue #14: the grid stays readable at 64
   * participants, and a beamer scene that needs a scrollbar is the wrong scene
   * (docs/STYLEGUIDE.md §3) — so it takes columns rather than height.
   */
  it.each([
    [8, 3],
    [24, 5],
    [64, 8],
  ])('lays %s participants out without needing to scroll', (count, columns) => {
    expect(scene(withGroups(count))).toContain(`repeat(${columns}, minmax(0, 1fr))`);
  });

  /*
   * The whole of issue #55, and the reason this scene exists: a participant who
   * is in the tournament is on the wall. The grid used to stop at eight columns
   * and the rest fell off the bottom of an `overflow-hidden` stage — and the one
   * person whose chip was missing is exactly the person who came to look.
   */
  it.each([64, 100, 160])('draws every one of %s participants', (count) => {
    const markup = scene(withGroups(count));

    expect(markup.match(/data-group-id=/g)).toHaveLength(count);
    // The last one specifically: a slice would keep the first ones and lose it.
    expect(markup).toContain(`data-group-id="grp_${count}"`);
  });

  /* 32 px is the absolute floor for beamer text (docs/STYLEGUIDE.md §2), for a
   * name as much as for a number — the densest step is where that would slip. */
  it('never drops a participant below the beamer type floor at 64', () => {
    const many = addGroups(tournament(), 64);
    const named = toTournamentSnapshot({
      ...many,
      groups: many.groups.map((entry) => ({ ...entry, name: `Mannschaft ${entry.number}` })),
    });

    expect(scene(named)).toContain('text-beamer-body');
    expect(scene(named)).not.toContain('text-beamer-caption');
  });
});

/** Every chip in the rendered markup. */
function chips(markup: string): RegExpMatchArray[] {
  return [...markup.matchAll(/data-group-id="[^"]+"/g)];
}
