import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildBracket } from '@/domain/bracket';
import { groupIdSchema, matchIdSchema, roundIdSchema, tableIdSchema } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Group, Match, Table } from '@/domain/types';
import { de } from '@/i18n';
import {
  BracketScene,
  DrawScene,
  RepechageScene,
  RoundBoardScene,
  TableOverviewScene,
} from '@/windows/beamer/scenes';

import type { ReactElement } from 'react';

/**
 * Issue #75's acceptance criteria, across every group-round scene at once.
 *
 * The requirement is a negative one — "no participant label appears in any
 * group-round beamer scene" — and a negative is exactly what each scene's own
 * test file will not notice going stale. One card somewhere that still says
 * `Gruppe 12` is one card that is smaller than the rest and reads as a
 * different design from the back of the room, so this checks all four scenes
 * and all three wordings together, at the field sizes the app has to survive.
 *
 * The positive half is here too: the numbers are in the display font at a step
 * that carries ten metres, and the `Turnierbaum` is untouched — the final phase
 * keeps names, which is the whole point of the naming phase (issue #23).
 */

/** Every word a participant could be called, in all three settings. */
const PARTICIPANT_WORDS = [
  de.participant.GROUP,
  de.participant.TEAM,
  de.participant.PLAYER,
].flatMap((words) => [words.one, words.many]);

const RNG_SEED = 'group-round-numbers';

/**
 * A tournament of `count` participants, playing `count / 2` matches on tables.
 *
 * Named on purpose, and named the same way on every card: if a name can leak
 * onto a group-round scene at all, a field where every group has one is where
 * it leaks. Real group rounds run before the naming phase, so this is also the
 * hand-repaired file of `docs/FILE-FORMAT.md`.
 */
function field(count: number): TournamentSnapshot {
  const groups: Group[] = Array.from({ length: count }, (_unused, index) => ({
    id: groupIdSchema.parse(`group-${index + 1}`),
    number: index + 1,
    name: `Mannschaft Sonnenschein ${index + 1}`,
    status: 'ACTIVE',
  }));

  const pairs = Math.floor(count / 2);
  const matches: Match[] = Array.from({ length: pairs }, (_unused, index) => ({
    id: matchIdSchema.parse(`match-${index + 1}`),
    tableId: tableIdSchema.parse(`table-${index + 1}`),
    a: groupIdSchema.parse(`group-${index * 2 + 1}`),
    b: groupIdSchema.parse(`group-${index * 2 + 2}`),
    winnerId: index % 2 === 0 ? groupIdSchema.parse(`group-${index * 2 + 1}`) : null,
    status: index % 2 === 0 ? 'DONE' : 'RUNNING',
  }));

  const tables: Table[] = matches.map((entry, index) => ({
    id: tableIdSchema.parse(`table-${index + 1}`),
    // The label a host actually gets, so the `Tisch` half of the requirement
    // is exercised rather than assumed.
    label: de.table.defaultLabel({ n: index + 1 }),
    status: 'OCCUPIED',
    currentMatchId: entry.id,
    occupiedSince: '2026-08-23T10:00:00+02:00',
    reservedFor: null,
  }));

  return {
    name: 'Sommerturnier',
    groups,
    participantLabel: 'GROUP',
    performanceMode: false,
    tables,
    matches,
    round: {
      id: roundIdSchema.parse('round-1'),
      index: 1,
      kind: 'QUALIFYING',
      track: 'MAIN',
      label: 'Runde 1',
      state: 'DRAWN',
    },
    consolationRound: null,
    consolationMatches: [],
    repechage: {
      target: 2,
      need: 1,
      byes: 0,
      through: groups.slice(0, 1).map((group) => group.id),
      pot: groups.slice(1).map((group, index) => ({
        groupId: group.id,
        status: index === 0 ? 'DRAWN' : 'POOL',
      })),
      last: { groupId: groups[1]?.id ?? groups[0]!.id, accepted: null },
      fallbackUsed: null,
      complete: false,
    },
    consolationRepechage: null,
    history: [],
    consolationBracket: null,
    bracket: null,
  };
}

/**
 * The three scenes that name a table (issue #100).
 *
 * The `Hoffnungsrunde` is a group-round scene and has no tables on it: it is
 * the pot and the pairings coming out of it, before any of them is anywhere.
 */
function tableScenes(snapshot: TournamentSnapshot): [string, ReactElement][] {
  return groupRoundScenes(snapshot).filter(([name]) => name !== 'REPECHAGE');
}

/** Which attribute a scene hangs its table label on. */
const TABLE_SLOT: Record<string, string> = {
  DRAW: 'data-pairing-where',
  ROUND_BOARD: 'data-table-label',
  TABLE_OVERVIEW: 'data-table-label',
};

function tableSlots(scene: string, markup: string): { classes: string; text: string }[] {
  const slot = TABLE_SLOT[scene] ?? '';
  const pattern = new RegExp(`class="([^"]*)"[^>]*\\s${slot}=""[^>]*>([^<]*)<`, 'g');

  return [...markup.matchAll(pattern)].map((hit) => ({
    classes: hit[1] ?? '',
    text: hit[2] ?? '',
  }));
}

function tableLabels(scene: string, markup: string): string[] {
  return tableSlots(scene, markup).map((slot) => slot.text);
}

function tableLabelClasses(scene: string, markup: string): string[] {
  return tableSlots(scene, markup).map((slot) => slot.classes);
}

/**
 * The class list carrying the step the group numbers are drawn at.
 *
 * Two shapes, because two of these scenes put their numbers in a `GroupBox`
 * and the `Tischbelegung` draws them on the row itself. Either way it is the
 * element the type step lives on, which is all the comparison needs.
 */
function numberClasses(markup: string): string[] {
  const boxed = [...markup.matchAll(/class="([^"]*)"\s+data-group-number=""/g)].map(
    (hit) => hit[1] ?? '',
  );
  if (boxed.length > 0) {
    return boxed;
  }
  return [...markup.matchAll(/class="([^"]*)"\s+data-pairing=""/g)].map((hit) => hit[1] ?? '');
}

/** The beamer type ladder, smallest first (docs/STYLEGUIDE.md §2). */
const STEPS = [
  'text-beamer-caption',
  'text-beamer-body',
  'text-beamer-h3',
  'text-beamer-h2',
  'text-beamer-h1',
  'text-beamer-hero',
];

/** Where a class list sits on that ladder, so two of them can be compared. */
function step(classes: string): number {
  const found = classes.split(' ').find((name) => STEPS.includes(name));

  expect(found, `no beamer type step in "${classes}"`).toBeDefined();
  return STEPS.indexOf(found ?? '');
}

/**
 * The middle dot the neutral box used to draw, written as a char code so that
 * nothing in this file is a character you cannot see.
 */
const DOT = String.fromCharCode(0xb7);

/** The four scenes a group round is played out on. */
function groupRoundScenes(snapshot: TournamentSnapshot): [string, ReactElement][] {
  return [
    ['DRAW', <DrawScene tournament={snapshot} step={snapshot.matches.length} settled key="d" />],
    ['ROUND_BOARD', <RoundBoardScene tournament={snapshot} settled key="r" delivery="catchUp" />],
    ['TABLE_OVERVIEW', <TableOverviewScene tournament={snapshot} settled key="t" />],
    ['REPECHAGE', <RepechageScene tournament={snapshot} beat={null} key="p" />],
  ];
}

/** The smallest field the rules allow, a normal one, and the ceiling. */
const SIZES = [2, 16, 64];

describe('a group round on the projector', () => {
  for (const count of SIZES) {
    const snapshot = field(count);

    for (const [name, element] of groupRoundScenes(snapshot)) {
      it(`carries no participant label on ${name} at ${String(count)}`, () => {
        const markup = renderToStaticMarkup(element);

        for (const word of PARTICIPANT_WORDS) {
          // `sr-only` text is exempt nowhere: the rule is that the word is not
          // on the card, and a hidden copy is a copy that comes back the first
          // time somebody removes the class.
          expect(markup, `${name} @ ${String(count)}: ${word}`).not.toContain(word);
        }
      });

      it(`carries no name on ${name} at ${String(count)}`, () => {
        expect(renderToStaticMarkup(element), name).not.toContain('Mannschaft Sonnenschein');
      });
    }
  }

  /*
   * The positive half of the first acceptance criterion: legible at ten metres.
   * A test runner cannot measure a projector, so what is pinned is the thing
   * that decides it — the numerals are in the display font at a beamer step,
   * and never at the 32 px floor the words used to squeeze them down to.
   */
  it('draws the numbers in the display font, above the floor, at every size', () => {
    for (const count of SIZES) {
      const markup = renderToStaticMarkup(
        <RoundBoardScene tournament={field(count)} settled delivery="catchUp" />,
      );
      const numerals = [
        ...markup.matchAll(/class="([^"]*)"\s+data-group-number=""[^>]*>\d+</g),
      ].map(([, classes]) => classes ?? '');

      expect(numerals.length, `field of ${String(count)}`).toBeGreaterThan(0);
      for (const classes of numerals) {
        expect(classes, `field of ${String(count)}`).toContain('wm-tnum');
        expect(classes, `field of ${String(count)}`).not.toContain('text-beamer-body');
      }
    }
  });

  /*
   * The `Tisch` half, reversed by issue #100.
   *
   * Issue #75 took the word off on the theory that the number alone was
   * enough. It was not: a bare number sitting above two other bare numbers is
   * a third number, and at 32 px the question of what it meant never came up
   * because it could not be read. So the label goes back to the table's own
   * string, which is `Tisch 3` for every table nobody renamed, and the same
   * string the host panel shows — the wall and the control screen cannot
   * disagree about what a table is called.
   *
   * Checked on all three group-round scenes at once and at every field size,
   * because this is exactly the kind of requirement that gets satisfied on the
   * scene somebody was looking at and missed on the other two.
   */
  it('spells out Tisch in front of the number on every group-round scene', () => {
    for (const count of SIZES) {
      const snapshot = field(count);

      for (const [name, element] of tableScenes(snapshot)) {
        const labels = tableLabels(name, renderToStaticMarkup(element));

        expect(labels.length, `${name} @ ${String(count)}`).toBeGreaterThan(0);
        expect(labels[0], `${name} @ ${String(count)}`).toBe(de.table.defaultLabel({ n: 1 }));
      }
    }
  });

  /*
   * "The label is one unit: `Tisch` and the number scale together and never
   * wrap." A heading that broke after the word would put the number on a line
   * of its own, which is the bare numeral issue #100 is removing.
   */
  it('keeps the word and the number on one line', () => {
    for (const count of SIZES) {
      for (const [name, element] of tableScenes(field(count))) {
        const classes = (tableLabelClasses(name, renderToStaticMarkup(element))[0] ?? '').split(
          ' ',
        );

        // Either spelling of the same promise: `truncate` where the label may
        // outgrow its column and has to be cut rather than wrapped, plain
        // `whitespace-nowrap` where the column gives way instead.
        expect(
          classes.includes('truncate') || classes.includes('whitespace-nowrap'),
          `${name} @ ${String(count)}: ${classes.join(' ')}`,
        ).toBe(true);
      }
    }
  });

  /*
   * "Larger, but still subordinate to the group numbers." Both halves, at every
   * density: above the 32 px floor it used to sit on, and strictly below the
   * step the numerals are drawn at, so the two numbers stay the dominant
   * element on the card.
   */
  it('draws the table above the floor and under the numbers, at every size', () => {
    for (const count of SIZES) {
      const snapshot = field(count);

      for (const [name, element] of tableScenes(snapshot)) {
        const markup = renderToStaticMarkup(element);
        const table = step(tableLabelClasses(name, markup)[0] ?? '');
        const numbers = step(numberClasses(markup)[0] ?? '');
        const where = `${name} @ ${String(count)}`;

        expect(table, where).toBeGreaterThan(STEPS.indexOf('text-beamer-body'));
        expect(numbers, where).toBeGreaterThan(table);
      }
    }
  });

  /*
   * "Remove the dot wherever it appears alongside these numbers." The neutral
   * `GroupBox` used to hold a `·`, and on a pairing that put one squarely in
   * the gap between the two numbers, which is the one place issue #88 wanted
   * empty: a mark between two numerals is what makes them read as one string
   * again.
   */
  it('puts no dot anywhere near the numerals', () => {
    for (const count of SIZES) {
      for (const [name, element] of groupRoundScenes(field(count))) {
        expect(renderToStaticMarkup(element), `${name} @ ${String(count)}`).not.toContain(DOT);
      }
    }
  });

  /*
   * "Waiting matches show no table label at all" — not `Tisch —`, not
   * `Tisch 0`. The slot holds a sentence saying why there is no table, which
   * is a different thing from a label with a placeholder in it: there are
   * routinely more matches than tables (docs/TOURNAMENT-RULES.md §3), and a
   * card that names one nobody can find sends people looking for it.
   */
  it('gives a match with no table no table label', () => {
    const base = field(4);
    const waiting: TournamentSnapshot = {
      ...base,
      matches: base.matches.map((match, index) =>
        index === 0 ? { ...match, tableId: null, status: 'WAITING_FOR_TABLE' } : match,
      ),
    };

    const card =
      /<li[^>]*data-match-id="match-1"[\s\S]*?<\/li>/.exec(
        renderToStaticMarkup(<DrawScene tournament={waiting} step={2} settled />),
      )?.[0] ?? '';

    expect(card).toContain(de.beamer.draw.waitingForTable);
    // Nothing but a nested sentence in the slot: no bare label, and therefore
    // no way for a placeholder to be dressed up as one.
    expect(card).not.toMatch(/data-pairing-where=""[^>]*>[^<]/);
  });

  /*
   * The one word a number cannot replace. A card with one participant and an
   * empty space reads as a bug from the back of a room, and this line is the
   * audience's only explanation of why somebody advanced without playing
   * (docs/TOURNAMENT-RULES.md §9 case 1).
   */
  it('still says Freilos in words', () => {
    const odd = field(4);
    const bye: Match = {
      id: matchIdSchema.parse('match-bye'),
      tableId: null,
      a: groupIdSchema.parse('group-3'),
      b: null,
      winnerId: null,
      status: 'WAITING_FOR_TABLE',
    };
    const withBye: TournamentSnapshot = { ...odd, matches: [...odd.matches, bye] };

    expect(renderToStaticMarkup(<DrawScene tournament={withBye} step={9} settled />)).toContain(
      de.beamer.draw.byeAdvances,
    );
  });

  /*
   * Issue #75's third acceptance criterion. The final phase is where names
   * arrive and the whole reason the naming phase exists (issue #23) — nothing
   * here may touch it.
   */
  it('leaves the Turnierbaum drawing names', () => {
    const sixteen = field(16);
    const withBracket: TournamentSnapshot = {
      ...sixteen,
      bracket: buildBracket(sixteen.groups.slice(0, 16), { rng: createRng(RNG_SEED) }),
    };

    const markup = renderToStaticMarkup(
      <BracketScene
        tournament={withBracket}
        settled
        focus={null}
        advance={{ chip: () => () => undefined, arriving: new Set() }}
      />,
    );

    expect(markup).toContain('Mannschaft Sonnenschein');
  });
});
