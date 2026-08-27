// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { setParticipantLabel } from '@/domain/settings';
import {
  toTournamentSnapshot,
  EMPTY_TOURNAMENT,
  type SnapshotDelivery,
  type TournamentSnapshot,
} from '@/domain/snapshot';
import { addTables } from '@/domain/tables';
import { group, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { WelcomeScene } from '@/windows/beamer/scenes/WelcomeScene';

/**
 * `WELCOME` on the projector (issue #74).
 *
 * The picture the room fills up in front of. Three things decide whether it
 * works, and all three are asserted below: the count is readable from the back,
 * the layout does not move as the field grows from nothing to sixty-four, and
 * the number ticks only for a change this window actually watched.
 */

afterEach(cleanup);

/** `count` participants, on `tables` tables, in a named tournament. */
function field(count: number, tables = 0): TournamentSnapshot {
  const groups = Array.from({ length: count }, (_unused, index) => group(index + 1));
  const base = tournament({
    name: 'Sommerturnier',
    groups,
    nextGroupNumber: count + 1,
  });

  return toTournamentSnapshot(
    tables === 0
      ? base
      : addTables(base, { count: tables, label: (n) => de.table.defaultLabel({ n }) }),
  );
}

function markup(snapshot: TournamentSnapshot, settled = true, delivery: SnapshotDelivery = 'live') {
  return renderToStaticMarkup(
    <WelcomeScene tournament={snapshot} settled={settled} delivery={delivery} />,
  );
}

/** The text of the one element that carries the live number. */
function shown(container: HTMLElement): string | null {
  return container.querySelector('[data-count-value]')?.textContent ?? null;
}

describe('the welcome scene', () => {
  it('names the tournament so somebody walking in knows what they walked into', () => {
    expect(markup(field(12))).toContain('Sommerturnier');
  });

  it('draws the count in the display font at the hero size', () => {
    // docs/STYLEGUIDE.md §2: `beamer-hero` is the 160 px step, and the issue's
    // acceptance criterion is that this number is readable at ten metres.
    const view = render(<WelcomeScene tournament={field(24)} settled delivery="catchUp" />);
    const hero = view.container.querySelector('[data-group-count]');

    expect(hero?.className).toContain('text-beamer-hero');
    expect(hero?.className).toContain('wm-display');
    expect(shown(view.container)).toBe('24');
  });

  it('says what is being counted, in the wording this tournament uses', () => {
    expect(markup(field(12))).toContain(
      de.beamer.welcome.atTheStart({ participants: de.participant.GROUP.word({ n: 12 }) }),
    );

    const teams = toTournamentSnapshot(
      setParticipantLabel(tournament({ groups: [group(1), group(2)], nextGroupNumber: 3 }), 'TEAM'),
    );
    expect(markup(teams)).toContain(
      de.beamer.welcome.atTheStart({ participants: de.participant.TEAM.word({ n: 2 }) }),
    );
  });

  it('puts the word in the singular for the very first participant', () => {
    // The figure is drawn above the word, so "1 Gruppe am Start" would print
    // the number twice — and the plural under a big 1 is simply wrong.
    expect(markup(field(1))).toContain(
      de.beamer.welcome.atTheStart({ participants: de.participant.GROUP.one }),
    );
  });

  it('carries the table count as the quiet line underneath', () => {
    expect(markup(field(12, 6))).toContain(de.table.count({ n: 6 }));
  });

  /*
   * The issue's fourth acceptance criterion. "Am I in?" is a different question
   * with a different screen — `GROUP_OVERVIEW` — and a welcome screen that also
   * listed sixty-four numbers would be neither picture.
   */
  it('lists no participant numbers and no names', () => {
    const named = toTournamentSnapshot(
      tournament({
        name: 'Sommerturnier',
        groups: [group(1, { name: 'Die Adler' }), group(2, { name: 'Die Falken' })],
        nextGroupNumber: 3,
      }),
    );
    const html = markup(named);

    expect(html).not.toContain('Die Adler');
    expect(html).not.toContain('Die Falken');
    expect(html).not.toContain(de.participant.GROUP.numbered({ n: 1 }));
  });

  /*
   * The issue's third acceptance criterion, and the reason every line is drawn
   * unconditionally: the host adds groups and tables while the room watches,
   * and nothing may move when they do.
   */
  it('draws the same elements at every field size from 0 to 64', () => {
    const shape = (snapshot: TournamentSnapshot) => markup(snapshot).replace(/>[^<>]*</g, '><');

    const empty = shape(field(0));
    for (const count of [1, 2, 16, 40, 64]) {
      expect(shape(field(count)), `field of ${String(count)}`).toBe(empty);
    }
    // And a table being added does not add a line either.
    expect(shape(field(0, 8))).toBe(empty);
  });

  it('shows a zero rather than hiding the count before anybody is entered', () => {
    const view = render(<WelcomeScene tournament={field(0)} settled delivery="catchUp" />);

    expect(shown(view.container)).toBe('0');
  });

  /*
   * The host can stage this from the start screen (issue #28: every scene is
   * reachable at any time), and a heading that was simply missing would leave
   * the count floating over an empty wall.
   */
  it('falls back to the product name while no tournament is open', () => {
    const view = render(<WelcomeScene tournament={EMPTY_TOURNAMENT} settled delivery="catchUp" />);

    expect(view.container.querySelector('[data-tournament-name]')?.textContent).toBe(
      de.beamer.idleTitle,
    );
    expect(shown(view.container)).toBe('0');
  });

  describe('the tick when a group is added', () => {
    it('pulses the number and nothing else', () => {
      const view = render(<WelcomeScene tournament={field(11)} settled delivery="live" />);
      view.rerender(<WelcomeScene tournament={field(12)} settled delivery="live" />);

      expect(view.container.querySelectorAll('.wm-count-pulse')).toHaveLength(1);
      expect(view.container.querySelector('.wm-count-pulse')?.textContent).toBe('12');
      // The issue's note: the rest of the screen stays still, because a host
      // adding forty groups in a minute would otherwise strobe at the audience.
      expect(view.container.querySelector('[data-tournament-name]')?.className).not.toContain(
        'wm-count-pulse',
      );
    });

    it('replays for each further group, on a fresh element each time', () => {
      const view = render(<WelcomeScene tournament={field(1)} settled delivery="live" />);

      view.rerender(<WelcomeScene tournament={field(2)} settled delivery="live" />);
      const first = view.container.querySelector('.wm-count-pulse');

      view.rerender(<WelcomeScene tournament={field(3)} settled delivery="live" />);
      const second = view.container.querySelector('.wm-count-pulse');

      // A CSS animation does not run again because its class was applied again.
      expect(second).not.toBe(first);
      expect(second?.textContent).toBe('3');
    });

    it('animates nothing at a beamer that is only catching up', () => {
      const view = render(
        <WelcomeScene tournament={field(4)} settled={false} delivery="catchUp" />,
      );
      view.rerender(<WelcomeScene tournament={field(40)} settled delivery="catchUp" />);

      expect(view.container.querySelectorAll('.wm-count-pulse')).toHaveLength(0);
      expect(shown(view.container)).toBe('40');
    });
  });

  /*
   * The scene stands still for the whole of setup, so it looks the same whether
   * the beamer was there when it went up or found it already there
   * (CLAUDE.md golden rule 4).
   */
  it('renders identically whether it was arrived at live or caught up with', () => {
    expect(
      markup(field(12), false, 'catchUp').replace(/data-settled="false"/, 'data-settled="true"'),
    ).toBe(markup(field(12), true, 'catchUp'));
  });
});
