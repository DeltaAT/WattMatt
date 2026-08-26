import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildBracket, drawBracket, setBracketWinner } from '@/domain/bracket';
import type { BracketNodeId, GroupId } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import { toTournamentSnapshot } from '@/domain/snapshot';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { BracketScene } from '@/windows/beamer/scenes/BracketScene';
import type { BracketAdvance } from '@/windows/beamer/useBracketAdvance';

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

/** Every colour class gone — what a red–green-deficient viewer effectively has. */
function greyscale(markup: string): string {
  return markup.replace(/(?:border|bg|text)-wm-(?:win|lose|live|accent)[a-z-]*/g, '');
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
