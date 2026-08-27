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
    history: [],
    bracket: null,
  };
}

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
   * The `Tisch` half. The word goes for the same reason the participant label
   * did, and the number it was in front of stays.
   */
  it('names a table by its number on the board and on the draw', () => {
    const snapshot = field(4);

    const board = renderToStaticMarkup(
      <RoundBoardScene tournament={snapshot} settled delivery="catchUp" />,
    );
    const draw = renderToStaticMarkup(<DrawScene tournament={snapshot} step={2} settled />);

    for (const markup of [board, draw]) {
      expect(markup).not.toContain(de.table.defaultLabel({ n: 1 }));
      expect(markup).toContain('>1<');
    }
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
