import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import { group, groupId, match, round, table, tableId, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { RoundBoardScene } from '@/windows/beamer/scenes/RoundBoardScene';

/**
 * `ROUND_BOARD` (issue #19) — what the audience looks at for most of the
 * evening.
 *
 * The criterion that drives the design is the greyscale one: roughly 8 % of men
 * have a red–green deficiency, and a projector in a bright room flattens the
 * hues for everybody. So the board is asserted with every colour class stripped
 * out of the markup, which is the closest a unit test gets to squinting at it
 * from ten metres.
 */

/** `pairs` matches on `tables` tables; the rest queue. */
function board({
  pairs,
  tables = 2,
  decided = 0,
  bye = false,
}: {
  pairs: number;
  tables?: number;
  decided?: number;
  bye?: boolean;
}): TournamentSnapshot {
  const matches = Array.from({ length: pairs }, (_, index) =>
    match(index + 1, {
      a: groupId(index * 2 + 1),
      b: groupId(index * 2 + 2),
      tableId: index < tables ? tableId(index + 1) : null,
      ...(index < decided
        ? { winnerId: groupId(index * 2 + 1), status: 'DONE' as const }
        : { status: index < tables ? ('RUNNING' as const) : ('WAITING_FOR_TABLE' as const) }),
    }),
  );
  if (bye) {
    matches.push(
      match(pairs + 1, {
        a: groupId(pairs * 2 + 1),
        b: null,
        winnerId: groupId(pairs * 2 + 1),
        status: 'DONE',
      }),
    );
  }

  return toTournamentSnapshot(
    tournament({
      name: 'Sommerturnier',
      groups: Array.from({ length: pairs * 2 + (bye ? 1 : 0) }, (_, i) => group(i + 1)),
      tables: Array.from({ length: tables }, (_, i) => table(i + 1)),
      rounds: [round(1, { state: 'RUNNING', matches })],
    }),
  );
}

const scene = (snapshot: TournamentSnapshot, settled = true) =>
  renderToStaticMarkup(<RoundBoardScene tournament={snapshot} settled={settled} />);

/** Every colour class gone — what a red–green-deficient viewer effectively has. */
function greyscale(markup: string): string {
  return markup.replace(/(?:border|bg|text)-wm-(?:win|lose|live|accent)[a-z-]*/g, '');
}

describe('the round board', () => {
  it('draws every match of the round', () => {
    expect(scene(board({ pairs: 6 })).match(/data-match-id="/g)).toHaveLength(6);
  });

  it('groups the matches under the table they are at', () => {
    const markup = scene(board({ pairs: 4, tables: 2 }));

    expect(markup).toContain(`data-table-id="${tableId(1)}"`);
    expect(markup).toContain(`data-table-id="${tableId(2)}"`);
  });

  /* Waiting matches are visually separated from running ones. */
  it('puts what has no table into the queue section', () => {
    const markup = scene(board({ pairs: 5, tables: 2 }));

    expect(markup).toContain('data-queue');
    expect(markup).toContain(de.beamer.roundBoard.queueTitle);
  });

  it('leaves the queue heading out when every match has a table', () => {
    expect(scene(board({ pairs: 2, tables: 2 }))).not.toContain(de.beamer.roundBoard.queueTitle);
  });

  it('carries the status ribbon on every card', () => {
    const markup = scene(board({ pairs: 4, tables: 2, decided: 1 }));

    expect(markup).toContain(de.beamer.roundBoard.phase.RUNNING);
    expect(markup).toContain(de.beamer.roundBoard.phase.WAITING);
    expect(markup).toContain(de.beamer.roundBoard.phase.FINISHED);
  });

  /* Persistent chrome: tournament, round, progress. */
  it('says what the room is looking at', () => {
    const markup = scene(board({ pairs: 4, decided: 1 }));

    expect(markup).toContain('Sommerturnier');
    expect(markup).toContain('Round 1');
    expect(markup).toContain(de.round.progress({ decided: 1, total: 4 }));
  });

  describe('a result', () => {
    it('marks the winner and the loser', () => {
      const markup = scene(board({ pairs: 2, decided: 1 }));

      expect(markup).toContain('data-outcome="WINNER"');
      expect(markup).toContain('data-outcome="LOSER"');
    });

    it('leaves an undecided match with neither', () => {
      const markup = scene(board({ pairs: 2 }));

      expect(markup).not.toContain('data-outcome="WINNER"');
      expect(markup).not.toContain('data-outcome="LOSER"');
      expect(markup).toContain('data-outcome="OPEN"');
    });

    /*
     * The acceptance criterion: the board is fully understandable in greyscale.
     * Colour is one of three signals (docs/STYLEGUIDE.md §1) and the other two
     * — the icon and the German word — must both survive on their own.
     */
    it('is readable with every colour class stripped out', () => {
      const plain = greyscale(scene(board({ pairs: 2, decided: 1 })));

      expect(plain).toContain('✓');
      expect(plain).toContain('✗');
      expect(plain).toContain(de.beamer.roundBoard.winner);
      expect(plain).toContain(de.beamer.roundBoard.loser);
    });

    /* The three signals must not drift apart: a card cannot be green without
     * the word, nor carry SIEGER without the tick. */
    it('carries all three signals for every decided side', () => {
      const markup = scene(board({ pairs: 3, decided: 3 }));

      expect(markup.match(/data-outcome="WINNER"/g)).toHaveLength(3);
      expect(markup.match(/✓/g)).toHaveLength(3);
      expect(markup.match(new RegExp(de.beamer.roundBoard.winner, 'g'))).toHaveLength(3);
    });

    /*
     * "No layout shift when a result comes in — cards change colour, they do
     * not move." Marking a winner frees the table, so a board keyed on
     * `table.currentMatchId` would drop the card out of its section. This
     * compares the two boards with everything but the structure removed.
     */
    it('does not move a card when its result lands', () => {
      const before = scene(board({ pairs: 4, tables: 2, decided: 0 }));
      const after = scene(board({ pairs: 4, tables: 2, decided: 1 }));

      expect(order(after)).toEqual(order(before));
      expect(sections(after)).toEqual(sections(before));
    });

    it('keeps a decided match under its table rather than moving it away', () => {
      const markup = scene(board({ pairs: 2, tables: 2, decided: 2 }));

      // Both tables still name their match; neither says it is idle.
      expect(markup).not.toContain('data-table-idle');
      expect(markup.match(/data-match-id="/g)).toHaveLength(2);
    });

    /* Both sides animate at once — a stagger would look like hesitation about
     * the result (docs/MOTION.md §4.2). */
    it('flips both sides together', () => {
      const markup = scene(board({ pairs: 1, decided: 1 }));

      expect(markup).toContain('wm-result-win');
      expect(markup).toContain('wm-result-lose');
    });
  });

  /* A Freilos has one side and is decided by the draw; it must not render a
   * phantom opponent. */
  it('draws a bye with one participant and no opponent', () => {
    const markup = scene(board({ pairs: 1, bye: true }));
    const byeCard = markup.slice(markup.lastIndexOf('data-match-id='));

    expect(byeCard).toContain(de.beamer.roundBoard.phase.FINISHED);
    expect(byeCard.match(/data-outcome="/g)).toHaveLength(1);
  });

  /*
   * "Readable at 10 m for every field size from 2 to 64 groups." The floor is
   * `text-beamer-body` at 32 px (docs/STYLEGUIDE.md §2), and 32 matches is the
   * largest round a 64-group field produces.
   */
  it('never drops below the beamer type floor, from 1 match to 32', () => {
    for (const pairs of [1, 4, 12, 32]) {
      const markup = scene(board({ pairs, tables: 8 }));

      expect(markup, `${pairs} matches`).toContain('text-beamer-body');
      for (const smaller of ['text-host-xs', 'text-host-sm', 'text-beamer-caption']) {
        expect(markup, `${pairs} matches / ${smaller}`).not.toContain(smaller);
      }
    }
  });

  it('says so rather than going blank before anything is drawn', () => {
    expect(scene(toTournamentSnapshot(tournament()))).toContain(de.beamer.roundBoard.empty);
  });

  it('shows a table with nothing on it as free', () => {
    const markup = scene(board({ pairs: 1, tables: 3 }));
    expect(markup).toContain(de.beamer.roundBoard.tableIdle);
  });
});

/** The match ids in document order — the board's structure, without its paint. */
function order(markup: string): string[] {
  return [...markup.matchAll(/data-match-id="([^"]+)"/g)].map((hit) => hit[1] ?? '');
}

/** The section ids in document order. */
function sections(markup: string): string[] {
  return [...markup.matchAll(/data-(?:table-id|queue)="([^"]*)"/g)].map((hit) => hit[1] ?? '');
}
