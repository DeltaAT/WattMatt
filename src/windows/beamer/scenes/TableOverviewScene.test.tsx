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

  it('names who is playing on a busy table', () => {
    const markup = scene(RUNNING);

    // `midTournament` runs group 1 against group 2 on the first table, and
    // group 2 has a name while group 1 has only its number.
    expect(markup).toContain(
      `${de.participant.GROUP.numbered({ n: 1 })} ${de.match.versus} Die Schnellen`,
    );
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
      groups: [group(1)],
      participantLabel: 'GROUP',
      tables: [occupiedTable(1, matchId(99))],
      matches: [],
    };

    expect(scene(broken)).toContain(de.table.unknownMatch);
  });

  it('says so rather than drawing an empty grid when there are no tables', () => {
    const markup = scene(toTournamentSnapshot(tournament()));

    expect(markup).toContain(de.beamer.tableOverview.empty);
  });

  it('shows a group that has a name by its name', () => {
    const named = tournament({
      groups: [group(1, { name: 'Die Rasenden' }), group(2)],
      tables: [occupiedTable(1, matchId(1))],
      rounds: [round(1, { matches: [match(1, { a: groupId(1), b: groupId(2), tableId: null })] })],
    });

    expect(scene(toTournamentSnapshot(named))).toContain('Die Rasenden');
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
    [3, 'grid-cols-1'],
    [10, 'grid-cols-2'],
    [24, 'grid-cols-3'],
  ])('lays %s tables out without needing to scroll', (count, columns) => {
    const many = tournament({
      tables: Array.from({ length: count }, (_unused, index) => table(index + 1)),
    });

    expect(scene(toTournamentSnapshot(many))).toContain(columns);
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
