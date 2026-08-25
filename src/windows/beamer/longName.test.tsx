import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MAX_GROUP_NAME_LENGTH } from '@/domain/naming';
import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import {
  group,
  groupId,
  match,
  matchId,
  occupiedTable,
  round,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import { NAME_BUDGET } from '@/ui/nameFit';
import {
  DrawScene,
  GroupOverviewScene,
  RoundBoardScene,
  TableOverviewScene,
} from '@/windows/beamer/scenes';

import type { ReactElement } from 'react';

/**
 * A forty-character name on every scene that draws one (issue #23).
 *
 * The acceptance criterion is that a long name does not break *any* beamer
 * layout, so it is checked across the scenes at once rather than left to each
 * of them to remember. What a unit test can hold is the two halves of the
 * strategy `@/ui/nameFit` decides: the name is drawn down at the 32 px floor
 * rather than at 64 px, and the element it sits in truncates — so the worst
 * case is an ellipsis on one card and never a card pushed off the stage.
 *
 * The example is the one the issue names. It is a character longer than
 * `MAX_GROUP_NAME_LENGTH`, so a host cannot type it in full — but a file
 * repaired by hand can carry it, and the beamer renders what it is given
 * (docs/FILE-FORMAT.md §Encoding).
 */

const LONG_NAME = 'Die schnellen Schnitzeljäger aus Salzburg';

/** The floor of docs/STYLEGUIDE.md §2, where the strategy stops shrinking. */
const FLOOR = 'text-beamer-body';

function named(): TournamentSnapshot {
  const running = match(1, {
    a: groupId(1),
    b: groupId(2),
    tableId: tableId(1),
    status: 'RUNNING',
  });

  return toTournamentSnapshot(
    tournament({
      name: 'Sommerturnier',
      groups: [
        group(1, { name: LONG_NAME }),
        group(2, { name: 'Die Adler' }),
        group(3, { name: LONG_NAME }),
        group(4, { name: 'Die Falken' }),
      ],
      nextGroupNumber: 5,
      tables: [occupiedTable(1, matchId(1))],
      nextTableNumber: 2,
      rounds: [
        round(1, {
          state: 'RUNNING',
          matches: [running, match(2, { a: groupId(3), b: groupId(4) })],
        }),
      ],
    }),
  );
}

/** Every element that carries the long name, with its classes. */
function carriers(markup: string): string[] {
  return [...markup.matchAll(/class="([^"]*)"[^>]*>([^<]*)/g)]
    .filter(([, , text]) => text !== undefined && text.includes(LONG_NAME.slice(0, 20)))
    .map(([, classes]) => classes ?? '');
}

const scenes: [string, ReactElement][] = [
  ['GROUP_OVERVIEW', <GroupOverviewScene tournament={named()} settled key="g" />],
  ['ROUND_BOARD', <RoundBoardScene tournament={named()} settled key="r" />],
  ['TABLE_OVERVIEW', <TableOverviewScene tournament={named()} settled key="t" />],
  ['DRAW', <DrawScene tournament={named()} step={2} settled key="d" />],
];

describe('a forty-character name on the projector', () => {
  it('is longer than any type step above the floor holds', () => {
    expect(LONG_NAME.length).toBeGreaterThan(NAME_BUDGET['text-beamer-h3']);
    expect(LONG_NAME.length).toBeGreaterThanOrEqual(MAX_GROUP_NAME_LENGTH);
  });

  for (const [name, element] of scenes) {
    it(`is drawn down to the floor and truncated on ${name}`, () => {
      const found = carriers(renderToStaticMarkup(element));

      expect(found.length).toBeGreaterThan(0);
      for (const classes of found) {
        expect(classes, name).toContain(FLOOR);
        expect(classes, name).toContain('truncate');
        // Never above the floor: that is what would push the card wider than
        // the column it sits in and take the scene off the stage.
        expect(classes, name).not.toContain('text-beamer-h2');
      }
    });
  }

  /*
   * A short name on the same scene keeps the emphasis its density chose — the
   * strategy steps *down* for the name that needs it, and does not flatten
   * every card because one of them is long.
   */
  it('leaves the short names on the same board at their own step', () => {
    const markup = renderToStaticMarkup(<GroupOverviewScene tournament={named()} settled />);

    expect(markup).toContain('Die Adler');
    expect(markup).toContain('text-beamer-h3');
  });
});
