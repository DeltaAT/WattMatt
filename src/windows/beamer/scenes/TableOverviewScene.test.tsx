import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import {
  group,
  groupId,
  match,
  matchId,
  midTournament,
  occupiedTable,
  round,
  table,
  tournament,
} from '@/domain/testFixtures';
import { de } from '@/i18n';
import { TableOverviewScene } from '@/windows/beamer/scenes/TableOverviewScene';

/**
 * `TABLE_OVERVIEW` on the projector (issue #13).
 *
 * The scene answers one question for fifty people at once — which table do I
 * stand at — so what is asserted is that every table is on the screen, that a
 * busy one names the pair playing on it, and that nothing about a table's state
 * is carried by colour alone (docs/STYLEGUIDE.md §1).
 */

function scene(snapshot: TournamentSnapshot): string {
  return renderToStaticMarkup(<TableOverviewScene tournament={snapshot} settled />);
}

const RUNNING = toTournamentSnapshot(midTournament());

describe('the table overview scene', () => {
  it('draws every table the host configured, in their order', () => {
    const markup = scene(RUNNING);

    expect(markup.indexOf('data-table-id="tbl_1"')).toBeLessThan(
      markup.indexOf('data-table-id="tbl_2"'),
    );
    expect(markup).toContain('data-table-id="tbl_3"');
  });

  it('numbers who is playing on a busy table', () => {
    const markup = scene(RUNNING);

    // `midTournament` runs group 1 against group 2 on the first table. Since
    // issue #75 that is two numbers and nothing else — the word `Gruppe`
    // printed across a wall of tables is the width the numerals could have had.
    expect(markup).toContain('data-pairing=""><span>1</span>');
    expect(markup).toContain('<span>2</span>');
    expect(markup).not.toContain(de.participant.GROUP.numbered({ n: 1 }));
  });

  /*
   * Issue #75's second acceptance criterion, on the scene that carries the most
   * pairings at once.
   */
  it('carries no participant label anywhere on the board', () => {
    const markup = scene(RUNNING);

    for (const words of [de.participant.GROUP, de.participant.TEAM, de.participant.PLAYER]) {
      expect(markup).not.toContain(words.one);
    }
  });

  /* Colour is never the only signal: a projector in a bright room destroys hue
   * differences, and 8 % of men cannot separate the red from the green. */
  it('says free and out of service in words, not only in colour', () => {
    const markup = scene(RUNNING);

    expect(markup).toContain(de.beamer.tableOverview.free);
    expect(markup).toContain(de.beamer.tableOverview.disabled);
    expect(markup).toContain('data-table-status="DISABLED"');
  });

  it('calls a bye by its name rather than leaving the side blank', () => {
    const bye = tournament({
      groups: [group(1)],
      tables: [occupiedTable(1, matchId(1))],
      rounds: [round(1, { matches: [match(1, { b: null, tableId: null })] })],
    });

    expect(scene(toTournamentSnapshot(bye))).toContain(de.outcome.bye);
  });

  /*
   * A table that says it is busy with a match nobody can find. Said out loud so
   * it is obvious from the back of the room that this is not a table to stand
   * at — the alternative is a card that looks free and is not.
   */
  it('reports a table whose match cannot be found', () => {
    const broken: TournamentSnapshot = {
      name: 'Sommerturnier',
      groups: [group(1)],
      participantLabel: 'GROUP',
      performanceMode: false,
      tables: [occupiedTable(1, matchId(99))],
      matches: [],
      round: null,
      consolationRound: null,
      consolationMatches: [],
      repechage: null,
      history: [],
      bracket: null,
    };

    expect(scene(broken)).toContain(de.table.unknownMatch);
  });

  it('says so rather than drawing an empty grid when there are no tables', () => {
    const markup = scene(toTournamentSnapshot(tournament()));

    expect(markup).toContain(de.beamer.tableOverview.empty);
  });

  /*
   * Group rounds run before the naming phase (docs/TOURNAMENT-RULES.md §6), so
   * a name this early can only come from a file repaired by hand — and a board
   * where one card said `Die Rasenden` and thirty-one said a number would be
   * two designs at once. Names come back with the `Turnierbaum` (issue #23).
   */
  it('draws the number even for a group that already has a name', () => {
    const named = tournament({
      groups: [group(1, { name: 'Die Rasenden' }), group(2)],
      tables: [occupiedTable(1, matchId(1))],
      rounds: [round(1, { matches: [match(1, { a: groupId(1), b: groupId(2), tableId: null })] })],
    });

    const markup = scene(toTournamentSnapshot(named));

    expect(markup).not.toContain('Die Rasenden');
    expect(markup).toContain('data-pairing=""><span>1</span>');
  });

  /*
   * The default label is `Tisch 3` and the word is as redundant on a wall of
   * tables as `Gruppe` was. A table the host renamed keeps whatever they wrote
   * (issue #75, `tableNumber`).
   */
  it('drops the word Tisch from a default label and keeps a renamed one', () => {
    const renamed = tournament({
      groups: [group(1), group(2)],
      // The real default a host gets, not the fixture's English stand-in.
      tables: [
        table(1, { label: de.table.defaultLabel({ n: 1 }) }),
        table(2, { label: 'Fenster' }),
      ],
      rounds: [round(1, { matches: [match(1, { tableId: null })] })],
    });

    const markup = scene(toTournamentSnapshot(renamed));

    expect(markup).toContain('data-table-label="">1<');
    expect(markup).toContain('data-table-label="">Fenster<');
  });

  /* The beamer must not replay an animation for a scene it is already showing
   * (issue #5): a reopened window catches up settled. */
  it('reports whether it is catching up or arriving live', () => {
    const settled = renderToStaticMarkup(<TableOverviewScene tournament={RUNNING} settled />);
    const live = renderToStaticMarkup(<TableOverviewScene tournament={RUNNING} settled={false} />);

    expect(settled).toContain('data-settled="true"');
    expect(live).toContain('data-settled="false"');
  });

  /*
   * The number of tables is the host's decision, not the designer's, and a
   * beamer scene that needs a scrollbar is the wrong scene
   * (docs/STYLEGUIDE.md §3) — so the grid gets denser rather than taller.
   */
  it.each([
    [3, 1],
    [10, 2],
    [24, 3],
  ])('lays %s tables out without needing to scroll', (count, columns) => {
    const many = tournament({
      tables: Array.from({ length: count }, (_unused, index) => table(index + 1)),
    });

    expect(scene(toTournamentSnapshot(many))).toContain(`repeat(${columns}, minmax(0, 1fr))`);
  });

  /*
   * Issue #55. A venue with more tables than the old three density steps
   * anticipated lost the last ones off the bottom of an `overflow-hidden`
   * stage — and the pair standing at that table would have been looking for
   * themselves on a wall they were not on.
   */
  it.each([24, 40, 64])('draws every one of %s tables', (count) => {
    const many = tournament({
      tables: Array.from({ length: count }, (_unused, index) => table(index + 1)),
    });

    const markup = scene(toTournamentSnapshot(many));

    expect(markup.match(/data-table-id=/g)).toHaveLength(count);
    expect(markup).toContain(`data-table-id="tbl_${count}"`);
  });

  /* 32 px is the absolute floor for beamer text (docs/STYLEGUIDE.md §2). */
  it('never drops a table below the beamer type floor', () => {
    const many = tournament({
      tables: Array.from({ length: 24 }, (_unused, index) => table(index + 1)),
    });
    const markup = scene(toTournamentSnapshot(many));

    expect(markup).toContain('text-beamer-body');
    expect(markup).not.toContain('text-beamer-caption');
  });

  it('carries no table text that is not a beamer type token', () => {
    // Inherited text on the beamer is a bug, not a small style
    // (docs/STYLEGUIDE.md §"The beamer unit").
    expect(scene(RUNNING)).not.toMatch(/class="[^"]*text-host-/);
  });
});
