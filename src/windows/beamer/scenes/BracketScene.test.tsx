import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { assignBracketNode, buildBracket, drawBracket, setBracketWinner } from '@/domain/bracket';
import type { BracketNodeId, GroupId } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import { toTournamentSnapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { BracketScene } from '@/windows/beamer/scenes/BracketScene';
import type { BracketAdvance } from '@/windows/beamer/useBracketAdvance';
import { tableNumber } from '@/windows/tableLabel';

/**
 * `BRACKET` (issue #25) — the picture the whole final phase is played in front
 * of.
 *
 * Two criteria drive the assertions. The tree must be **complete and correct at
 * every size the final phase can start at** — 16, 8, 4 and 2 — because a
 * bracket with a round missing is not a smaller bracket but a wrong one. And it
 * must be **readable in greyscale**: roughly 8 % of men have a red–green
 * deficiency and a projector in a bright room flattens the hues for everybody,
 * so every result is asserted with the colour classes stripped out.
 */

/** A tournament whose bracket has just been drawn, at the given size. */
function drawn(size: number, tables = 2): Tournament {
  return drawBracket(
    tournament({
      name: 'Sommerturnier',
      phase: 'NAMING',
      groups: Array.from({ length: size }, (_unused, index) =>
        group(index + 1, { name: `Team ${index + 1}` }),
      ),
      nextGroupNumber: size + 1,
      tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
      nextTableNumber: tables + 1,
    }),
    { at: FIXED_NOW },
  );
}

/** Nothing is moving: the state a test renders in unless it says otherwise. */
const AT_REST: BracketAdvance = {
  chip: () => () => undefined,
  arriving: new Set<string>(),
};

const scene = (document: Tournament, settled = true, advance: BracketAdvance = AT_REST) =>
  renderToStaticMarkup(
    <BracketScene
      tournament={toTournamentSnapshot(document)}
      settled={settled}
      advance={advance}
    />,
  );

/** Every participant slot, with its outcome — the board's structure, without its paint. */
function slotsOf(markup: string): string[] {
  return [...markup.matchAll(/data-chip="([^"]+)" data-outcome="([^"]+)"/g)].map(
    (found) => `${found[1] ?? ''}:${found[2] ?? ''}`,
  );
}

/** Every colour class gone — what a red–green-deficient viewer effectively has. */
function greyscale(markup: string): string {
  return markup.replace(/(?:border|bg|text)-wm-(?:win|lose|live|accent)[a-z-]*/g, '');
}

/** Plays every node that has both participants, in tree order. */
function playRound(document: Tournament): Tournament {
  let next = document;
  for (const node of document.bracket?.nodes ?? []) {
    if (node.slotA !== null && node.slotB !== null && node.winnerId === null) {
      next = setBracketWinner(next, node.id, node.slotA);
    }
  }
  return next;
}

/**
 * A field of 8 played down to the last two matches, both on a table.
 *
 * The first round is seated by the draw; every later match is sent to a table
 * by the host, one at a time (issue #26) — so the `Finale` and the `Spiel um
 * Platz 3`, which §7 plays at the same moment, are assigned here by hand.
 */
function lastTwo(): Tournament {
  const played = playRound(playRound(drawn(8, 2)));
  let next = played;
  for (const [index, node] of (played.bracket?.nodes ?? [])
    .filter((candidate) => candidate.round === 'FINAL' || candidate.round === 'THIRD_PLACE')
    .entries()) {
    next = assignBracketNode(next, {
      nodeId: node.id,
      tableId: table(index + 1).id,
      at: FIXED_NOW,
    });
  }
  return next;
}

/** The table number each node draws, keyed by node id — absent when it draws none. */
function tablesOn(markup: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, id, rest] of markup.matchAll(/data-bracket-node="([^"]+)"([\s\S]*?)<\/li>/g)) {
    const table = /data-node-table="">([^<]*)</.exec(rest ?? '');
    if (table !== null) {
      found[id ?? ''] = table[1] ?? '';
    }
  }
  return found;
}

/** The nodes of one round, in the order the tree draws them. */
function nodesOf(document: Tournament, round: string): readonly BracketNodeId[] {
  return (document.bracket?.nodes ?? [])
    .filter((node) => node.round === round)
    .map((node) => node.id);
}

describe('the bracket scene', () => {
  it.each([
    [16, 16],
    [8, 8],
    [4, 4],
  ])('draws every node of a field of %i', (size, nodes) => {
    // Every round halves, plus the `Spiel um Platz 3`: 8+4+2+1+1 at 16.
    expect(scene(drawn(size)).match(/data-bracket-node="/g)).toHaveLength(nodes);
  });

  it('names every round of the tree in German', () => {
    const markup = scene(drawn(16));

    expect(markup).toContain(de.bracket.round.ROUND_OF_16);
    expect(markup).toContain(de.bracket.round.QUARTER_FINAL);
    expect(markup).toContain(de.bracket.round.SEMI_FINAL);
    expect(markup).toContain(de.bracket.round.FINAL);
    expect(markup).toContain(de.bracket.round.THIRD_PLACE);
  });

  it('draws a field of two as a Finale with no third-place match (§9 case 10)', () => {
    const markup = scene(drawn(2, 1));

    expect(markup.match(/data-bracket-node="/g)).toHaveLength(1);
    expect(markup).toContain(de.bracket.round.FINAL);
    expect(markup).not.toContain(de.bracket.round.THIRD_PLACE);
  });

  it('puts every participant on the wall by name', () => {
    const markup = scene(drawn(8));

    for (let number = 1; number <= 8; number += 1) {
      expect(markup, `Team ${String(number)}`).toContain(`Team ${String(number)}`);
    }
  });

  it('says so rather than drawing an empty tree before the bracket exists', () => {
    const markup = scene(tournament({ name: 'Sommerturnier' }));

    expect(markup).toContain(de.beamer.bracket.empty);
    expect(markup).not.toContain('data-bracket-node=');
  });

  /*
   * Half of this tree is empty for most of the final phase. An empty box on a
   * projector reads as a broken app, so a slot nobody has reached says what it
   * is waiting for.
   */
  it('says a slot is still open rather than leaving it blank', () => {
    expect(scene(drawn(4))).toContain(de.beamer.bracket.open);
  });

  it('names a Freilos in the first round (§9 case 1)', () => {
    // Three participants in a field of four, which is what the `Freilose` the
    // §4 fallback owes leaves behind: the last node is a walkover. Built
    // directly rather than played into, because what is under test is the
    // picture and not the route to it.
    const groups = [
      group(1, { name: 'Team 1' }),
      group(2, { name: 'Team 2' }),
      group(3, { name: 'Team 3' }),
    ];
    const short = tournament({
      phase: 'BRACKET',
      groups,
      nextGroupNumber: 4,
      bracket: buildBracket(groups, { rng: createRng('seed'), size: 4 }),
    });

    expect(scene(short)).toContain(de.outcome.bye);
  });
});

describe('a result on the tree', () => {
  function semiDecided(): Tournament {
    const document = drawn(4);
    const semi = document.bracket?.nodes[0];
    return setBracketWinner(document, semi?.id as BracketNodeId, semi?.slotA as GroupId);
  }

  it('carries the colour, the icon and the word (docs/STYLEGUIDE.md §1)', () => {
    const markup = scene(semiDecided());

    expect(markup).toContain('data-outcome="WINNER"');
    expect(markup).toContain('data-outcome="LOSER"');
    expect(markup).toContain(de.beamer.bracket.winner);
    expect(markup).toContain(de.beamer.bracket.loser);
    expect(markup).toContain('✓');
    expect(markup).toContain('✗');
  });

  it('is still readable with every colour stripped out', () => {
    const flat = greyscale(scene(semiDecided()));

    expect(flat).toContain(de.beamer.bracket.winner);
    expect(flat).toContain(de.beamer.bracket.loser);
    expect(flat).toContain('✓');
    expect(flat).toContain('✗');
  });

  it('shows the winner again in the round above', () => {
    const document = semiDecided();
    const final = nodesOf(document, 'FINAL')[0];
    const markup = scene(document);

    // The same participant is on the wall twice while they are advancing: the
    // chip they won in, and the chip they have arrived at.
    expect(markup).toContain(`data-chip="${String(final)}:A"`);
    expect(markup.match(/data-outcome="WINNER"/g)).toHaveLength(1);
  });
});

describe('the focus levels (docs/MOTION.md §4.4)', () => {
  it('gives the live round the room, and dims the rest', () => {
    const markup = scene(drawn(8));

    expect(markup).toContain('data-column-state="ACTIVE"');
    expect(markup).toContain('data-column-state="FUTURE"');
    expect(markup).toContain('opacity-45');
    expect(markup).not.toContain('data-column-state="DECIDED"');
  });

  it('moves the attention on once a round is over', () => {
    let document = drawn(4);
    for (const nodeId of nodesOf(document, 'SEMI_FINAL')) {
      const node = document.bracket?.nodes.find((candidate) => candidate.id === nodeId);
      document = setBracketWinner(document, nodeId, node?.slotA as GroupId);
    }

    const markup = scene(document);

    expect(markup).toContain('data-column-state="DECIDED"');
    // The `Finale` and the `Spiel um Platz 3` are played at the same time (§7),
    // so both are live at once.
    expect(markup.match(/data-column-state="ACTIVE"/g)).toHaveLength(2);
    expect(markup).toContain(de.bracket.round.FINAL);
  });
});

describe('the first reveal', () => {
  it('staggers the nodes left to right while the scene is arriving', () => {
    const markup = scene(drawn(4), false);

    expect(markup).toContain('wm-bracket-node');
    // One index per node, in reading order, for the `--stagger-wide` delay.
    expect(markup).toContain('--wm-reveal-index:0');
    expect(markup).toContain('--wm-reveal-index:3');
  });

  /*
   * A beamer reopened during the semi-finals must show the tree as it stands.
   * Replaying the reveal would show the audience a bracket being drawn that was
   * drawn twenty minutes ago (CLAUDE.md golden rule 4).
   */
  it('is not replayed on a settled scene', () => {
    expect(scene(drawn(4), true)).not.toContain('wm-bracket-node');
  });

  it('draws a connector out of every node but the final and the third-place match', () => {
    const markup = scene(drawn(8));

    // Four quarter-finals and two semi-finals lead somewhere; the final and the
    // third-place match do not.
    expect(markup.match(/data-bracket-connector="/g)).toHaveLength(6);
    expect(markup).toContain('data-bracket-connector="down"');
    expect(markup).toContain('data-bracket-connector="up"');
  });
});

describe('the zoom to a round (issue #26)', () => {
  it('draws the whole tree when the host has not zoomed', () => {
    const markup = scene(drawn(8));

    expect(markup).toContain(de.bracket.round.QUARTER_FINAL);
    expect(markup.match(/data-bracket-node="/g)).toHaveLength(8);
  });

  it('drops the rounds already played so the last matches fill the screen', () => {
    const markup = renderToStaticMarkup(
      <BracketScene
        tournament={toTournamentSnapshot(drawn(8))}
        settled
        focus="SEMI_FINAL"
        advance={AT_REST}
      />,
    );

    expect(markup).not.toContain(de.bracket.round.QUARTER_FINAL);
    expect(markup).toContain(de.bracket.round.SEMI_FINAL);
    // Two semi-finals, the final, and the third-place match.
    expect(markup.match(/data-bracket-node="/g)).toHaveLength(4);
  });

  /*
   * Issue #90. The round board named the table for the whole group phase and
   * then the tree replaced it, so the room lost the one thing it needs in order
   * to walk over and watch a match.
   */
  describe('the table a match is on', () => {
    it('names it on the nodes that are being played', () => {
      const markup = scene(drawn(8, 2));

      // Two tables, four quarter-finals: two running, two queued.
      expect(Object.values(tablesOn(markup))).toEqual([
        tableNumber(table(1).label),
        tableNumber(table(2).label),
      ]);
    });

    /*
     * "A node whose match has not been scheduled shows nothing — no
     * placeholder, no dash, and above all no `0`." A queued node and an empty
     * one are simply nodes.
     */
    /*
     * The deliberate divergence from issue #100 (docs/STYLEGUIDE.md §4). The
     * group rounds put the word `Tisch` back in front of the number, because a
     * bare numeral above two other bare numerals is a third one. Nothing on a
     * bracket node is a numeral, and the corner this badge sits in has no room
     * for a word, so here the number stays alone. Pinned with the label a host
     * actually gets, not the fixture's English stand-in, since the short form
     * is exactly what that label is cut down to.
     */
    it('names it by the number alone, unlike the group rounds', () => {
      const renamed: Tournament = {
        ...drawn(8, 2),
        tables: drawn(8, 2).tables.map((entry, index) => ({
          ...entry,
          label: de.table.defaultLabel({ n: index + 1 }),
        })),
      };

      expect(Object.values(tablesOn(scene(renamed)))).toEqual(['1', '2']);
    });

    it('names nothing at all on a node that has no table', () => {
      const markup = scene(drawn(8, 2));
      const named = Object.keys(tablesOn(markup));

      // 8 nodes drawn, 2 of them on a table.
      expect(markup.match(/data-bracket-node="/g)).toHaveLength(8);
      expect(named).toHaveLength(2);
      expect(markup).not.toContain('data-node-table="">0<');
      expect(markup).not.toContain('data-node-table="">–<');
      expect(markup).not.toContain('data-node-table=""><');
    });

    it('names no table anywhere on a tree with no tables at all', () => {
      expect(tablesOn(scene(drawn(8, 0)))).toEqual({});
    });

    /*
     * The fourth task. A decided node keeps its `tableId` as the record of
     * where it was played (docs/OPEN-QUESTIONS.md #37), and the table itself
     * went back to the pool the moment the winner was marked — so printing the
     * stored id would name a table that is somebody else's by then.
     */
    it('takes it off again once the match is decided', () => {
      const document = drawn(8, 2);
      const running = Object.keys(tablesOn(scene(document)));
      const after = tablesOn(scene(playRound(document)));

      expect(running).not.toHaveLength(0);
      for (const id of running) {
        expect(after[id], id).toBeUndefined();
      }
    });

    /* "Also applies to the `Spiel um Platz 3` node." It is drawn under the
     * tree rather than in it, so it is the one node that could be missed. */
    it('names it on the Spiel um Platz 3 as well', () => {
      // Quarter-finals, then semi-finals: the final and the third-place match
      // are the two that are left, and §7 plays them at the same time.
      const document = lastTwo();
      const third = (document.bracket?.nodes ?? []).find((node) => node.round === 'THIRD_PLACE');

      expect(third?.tableId).not.toBeNull();
      expect(Object.keys(tablesOn(scene(document)))).toContain(String(third?.id));
    });

    /*
     * "Must not squeeze the name field." Out of the flow is how: the table is
     * absolutely positioned, so the slots are byte-for-byte the markup they
     * were before a table was assigned, and nothing on the board moves when a
     * match starts.
     */
    it('costs the names nothing', () => {
      const withTables = scene(drawn(8, 2));
      const without = scene(drawn(8, 0));

      expect(slotsOf(withTables)).toEqual(slotsOf(without));
      expect(withTables).toMatch(/class="[^"]*absolute[^"]*"\s+data-node-table/);
    });

    /*
     * Small and subordinate: the names are the content, the table is a
     * reference. One step under the names where there is a step left, and
     * never below the 32 px floor (issue #100) — `beamer-caption` is what
     * docs/STYLEGUIDE.md §2 reserves for persistent chrome, and the number a
     * pair walks to a table on is not chrome.
     */
    it('is drawn no larger than the names and never below the floor', () => {
      for (const [size, expected] of [
        [4, 'text-beamer-h3'],
        [8, 'text-beamer-body'],
        [16, 'text-beamer-body'],
      ] as const) {
        const markup = scene(drawn(size, 2));
        const badge = /class="([^"]*)"\s+data-node-table/.exec(markup)?.[1] ?? '';

        expect(badge, `field of ${String(size)}`).toContain(expected);
        expect(badge, `field of ${String(size)}`).not.toContain('text-beamer-caption');
      }
    });

    /* "Zoomed-to-round view shows the table numbers at a comfortable size."
     * The zoom draws two matches, so the ladder hands it the top step. */
    it('is comfortable in the zoomed view', () => {
      const markup = renderToStaticMarkup(
        <BracketScene
          tournament={toTournamentSnapshot(lastTwo())}
          settled
          focus="FINAL"
          advance={AT_REST}
        />,
      );
      const badge = /class="([^"]*)"\s+data-node-table/.exec(markup)?.[1] ?? '';

      expect(badge).toContain('text-beamer-h3');
    });

    /*
     * "A 16-slot bracket with 40-character names still fits, with table
     * numbers, inside the safe area." Nothing is dropped and nothing is
     * counted; `useFitToStage` scales whatever is left (issue #55).
     */
    it('draws every node of a field of 16 with the longest names allowed', () => {
      const long = 'M'.repeat(40);
      const document = drawBracket(
        tournament({
          phase: 'NAMING',
          groups: Array.from({ length: 16 }, (_unused, index) =>
            group(index + 1, { name: `${long}${String(index)}`.slice(0, 40) }),
          ),
          nextGroupNumber: 17,
          tables: Array.from({ length: 4 }, (_unused, index) => table(index + 1)),
          nextTableNumber: 5,
        }),
        { at: FIXED_NOW },
      );
      const markup = scene(document);

      expect(markup.match(/data-bracket-node="/g)).toHaveLength(16);
      expect(Object.keys(tablesOn(markup))).toHaveLength(4);
      expect(markup).toContain('beamer-fit');
    });
  });

  /*
   * The third-place column sits before the final in the tree's own order, so a
   * naive slice would cut off the one match §7 plays at the same time as the
   * one being zoomed to.
   */
  it('keeps the Spiel um Platz 3 beside the Finale', () => {
    const markup = renderToStaticMarkup(
      <BracketScene
        tournament={toTournamentSnapshot(drawn(8))}
        settled
        focus="FINAL"
        advance={AT_REST}
      />,
    );

    expect(markup).toContain(de.bracket.round.FINAL);
    expect(markup).toContain(de.bracket.round.THIRD_PLACE);
    expect(markup.match(/data-bracket-node="/g)).toHaveLength(2);
  });
});
