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

    /*
     * The three signals must not drift apart, and they have to be checked
     * *together*. Counting ticks and `SIEGER`s across the whole document
     * passes just as happily when the loser is the one wearing the tick —
     * which is why this reads each side as a unit.
     */
    it('binds the icon and the word to the outcome on the same side', () => {
      const markup = scene(board({ pairs: 3, decided: 3 }));
      const sides = readSides(markup);

      expect(sides).toHaveLength(6);
      for (const side of sides) {
        if (side.outcome === 'WINNER') {
          expect(side.icon, 'winner icon').toBe('✓');
          expect(side.label, 'winner word').toBe(de.beamer.roundBoard.winner);
        } else {
          expect(side.icon, 'loser icon').toBe('✗');
          expect(side.label, 'loser word').toBe(de.beamer.roundBoard.loser);
        }
      }
    });

    /*
     * The third signal is the one that has to survive the colour being gone,
     * so its size is not cosmetic. `wm-label` cannot be used here: it hardcodes
     * 12 px and Tailwind emits it after the beamer type utilities at equal
     * specificity, so it silently wins and drags the word below the 32 px floor
     * (docs/STYLEGUIDE.md §2). Class-name greps cannot see that, so this asserts
     * the host utility is simply absent from the scene.
     */
    it('never labels a result with the host-sized utility', () => {
      const markup = scene(board({ pairs: 2, decided: 1 }));

      expect(markup).not.toMatch(/class="[^"]*wm-label[ "]/);
      expect(markup).toContain('wm-beamer-label');
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

  /*
   * The auto-scaling bullet, asserted rather than assumed. Returning one
   * density for everything, or one column count for every density, used to
   * pass the whole file — nothing looked at either mapping.
   */
  describe('auto-scaling', () => {
    it('gives a small board room and a large one columns', () => {
      // 2 matches on 2 tables: shallow and narrow.
      expect(scene(board({ pairs: 2, tables: 2 }))).toContain('grid-cols-2');
      // 24 matches on 8 tables: three deep per table, and wide.
      expect(scene(board({ pairs: 24, tables: 8 }))).toContain('grid-cols-4');
    });

    /* Depth, not just count: the same sixteen matches on two tables is a much
     * deeper board than on sixteen, and depth is what falls off the bottom. */
    it('gets denser when few tables have to hold many matches', () => {
      const shallow = scene(board({ pairs: 8, tables: 8 }));
      const deep = scene(board({ pairs: 8, tables: 2 }));

      expect(shallow).not.toBe(deep);
      expect(deep).toContain('grid-cols-4');
    });

    /*
     * The stage is `overflow-hidden`, so anything that does not fit is simply
     * gone — with nothing to tell the room the list it is reading is partial.
     * A 64-group round on few tables is exactly that case.
     */
    it('counts what will not fit instead of clipping it', () => {
      const markup = scene(board({ pairs: 32, tables: 2 }));

      expect(markup).toContain('data-section-overflow');
      expect(markup).toContain('und');
    });

    it('says nothing about overflow when everything fits', () => {
      expect(scene(board({ pairs: 4, tables: 4 }))).not.toContain('data-section-overflow');
    });

    /* The queue is the section that grows without a table to bound it, so it
     * spans the grid and lays itself out in columns rather than one stack. */
    it('lets the queue span the board rather than stacking one column', () => {
      expect(scene(board({ pairs: 12, tables: 2 }))).toContain('col-span-full');
    });
  });

  /*
   * The layout-shift criterion, one level in from the card. Rendering the
   * result word only once decided re-truncates the participant name at the
   * exact moment the room is reading it, because the name is `flex-1 truncate`
   * and a new sibling takes width from it. The slot is therefore always there.
   */
  it('reserves the result slot before there is a result', () => {
    const open = scene(board({ pairs: 1 }));

    expect(open).toContain('data-outcome-slot');
    expect(open).not.toContain('data-outcome-label');
  });

  it(`does not change a card inner structure when its result lands`, () => {
    const before = scene(board({ pairs: 2, tables: 2, decided: 0 }));
    const after = scene(board({ pairs: 2, tables: 2, decided: 1 }));

    expect(slots(after)).toEqual(slots(before));
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

/**
 * Each result side as `{ outcome, icon, label }`.
 *
 * Reading them as units is the point: three independent global counts of
 * `WINNER`, `✓` and `SIEGER` all pass while the tick sits on the loser.
 */
function readSides(markup: string): { outcome: string; icon: string; label: string }[] {
  return [...markup.matchAll(/data-outcome="(WINNER|LOSER)"[\s\S]*?<\/span><\/span>/g)].map(
    (hit) => {
      const block = hit[0];
      return {
        outcome: hit[1] ?? '',
        icon: /data-outcome-icon="">([^<]*)</.exec(block)?.[1] ?? '',
        label: /data-outcome-label="">([^<]*)</.exec(block)?.[1] ?? '',
      };
    },
  );
}

/** How many reserved result slots and icons each board renders. */
function slots(markup: string): { slots: number; icons: number } {
  return {
    slots: (markup.match(/data-outcome-slot/g) ?? []).length,
    icons: (markup.match(/data-outcome-icon/g) ?? []).length,
  };
}
