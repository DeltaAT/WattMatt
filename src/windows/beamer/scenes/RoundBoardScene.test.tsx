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

/**
 * `pairs` matches on `tables` tables; the rest queue.
 *
 * `idle` adds further tables that no match of this round is on — the hall the
 * host actually set up, which is bigger than the round played on it more often
 * than not (issue #87). `locked` names tables to take out of service, by their
 * one-based number.
 */
function board({
  pairs,
  tables = 2,
  idle = 0,
  locked = [],
  decided = 0,
  bye = false,
}: {
  pairs: number;
  tables?: number;
  idle?: number;
  locked?: readonly number[];
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
      tables: Array.from({ length: tables + idle }, (_, i) =>
        table(i + 1, locked.includes(i + 1) ? { status: 'DISABLED' as const } : {}),
      ),
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
      expect(markup).toContain('data-outcome="NEUTRAL"');
    });

    /*
     * The acceptance criterion, in the half a class-name grep can answer: with
     * every colour class gone the two outcomes still differ. The word is no
     * longer one of the signals (issue #77), so what is left here is the icon
     * and the geometry — `wm-result-ring` is the winner's extra edge and it is
     * not a colour class. How far apart the two actually are *in* greyscale is
     * arithmetic, and `src/styles/resultContrast.test.ts` computes it.
     */
    it('is readable with every colour class stripped out', () => {
      const plain = greyscale(scene(board({ pairs: 2, decided: 1 })));

      expect(plain).toContain('✓');
      expect(plain).toContain('✗');
      expect(plain).toContain('wm-result-ring');
    });

    /* Issue #77's first acceptance criterion: no result text on the beamer. */
    it('carries no result word anywhere', () => {
      const markup = scene(board({ pairs: 3, decided: 3 }));

      for (const word of ['SIEGER', 'AUSGESCHIEDEN']) {
        expect(markup, word).not.toContain(word);
      }
      expect(markup).not.toContain('data-outcome-label');
      expect(markup).not.toContain('data-outcome-slot');
    });

    /*
     * "The number itself stays at full contrast — colour the box, not the
     * digits." A loser whose number was drawn in the muted text colour would be
     * harder to read than the winner beside it, which is a penalty the room
     * does not need on top of losing.
     */
    it('draws the number at full contrast whatever the result', () => {
      const markup = scene(board({ pairs: 1, decided: 1 }));

      const loser = /class="([^"]*)"[^>]*data-outcome="LOSER"/.exec(markup)?.[1] ?? '';
      const classes = loser.split(' ');

      expect(classes).toContain('text-wm-text');
      expect(classes).not.toContain('text-wm-text-muted');
    });

    /*
     * The signals must not drift apart, and they have to be checked
     * *together*. Counting ticks and rings across the whole document passes
     * just as happily when the loser is the one wearing the tick — which is
     * why this reads each side as a unit.
     */
    it('binds the icon and the ring to the outcome on the same side', () => {
      const markup = scene(board({ pairs: 3, decided: 3 }));
      const sides = readSides(markup);

      expect(sides).toHaveLength(6);
      for (const side of sides) {
        if (side.outcome === 'WINNER') {
          expect(side.icon, 'winner icon').toBe('✓');
          expect(side.ring, 'winner ring').toBe(true);
        } else {
          expect(side.icon, 'loser icon').toBe('✗');
          expect(side.ring, 'loser ring').toBe(false);
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

    /*
     * The flip belongs to the moment a result is decided, not to the state of
     * being decided, so a first render never carries it: a board that is merely
     * *arriving* — a reopened beamer, an undo, the host putting the round up an
     * hour later — shows its results without replaying them (issue #29,
     * `useResultFlip`). That both sides then turn over at once, and that only
     * the match that changed does, is asserted against the full field in
     * `src/windows/beamer/scenePerformance.test.tsx`, which needs two renders
     * and therefore a DOM.
     */
    it('shows a decided result without replaying it on the first render', () => {
      const markup = scene(board({ pairs: 1, decided: 1 }));

      expect(markup).not.toContain('wm-result-win');
      expect(markup).not.toContain('wm-result-lose');

      // The result is there all the same — colour, icon and the winner's ring.
      // The ring in particular is a state class and not an animation, so a
      // board that is only catching up still carries the signal that survives
      // greyscale (golden rule 4, issue #77).
      expect(markup).toContain('data-outcome="WINNER"');
      expect(markup).toContain('data-outcome="LOSER"');
      expect(markup).toContain('wm-result-ring');
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
      // 2 matches on 2 tables: two sections, side by side.
      expect(scene(board({ pairs: 2, tables: 2 }))).toContain('repeat(2, minmax(0, 1fr))');
      // 24 matches on 8 tables: eight sections plus the queue, so nine.
      expect(scene(board({ pairs: 24, tables: 8 }))).toContain('repeat(3, minmax(0, 1fr))');
    });

    /*
     * Depth is no longer what decides the layout — `useFitToStage` scales the
     * board down for it. What still has to hold is that a deep board and a
     * shallow one with the same matches are laid out differently at all: the
     * deep one is two tables plus a queue, the shallow one is eight sections.
     */
    it('lays a deep board out differently from a shallow one', () => {
      const shallow = scene(board({ pairs: 8, tables: 8 }));
      const deep = scene(board({ pairs: 8, tables: 2 }));

      expect(shallow).not.toBe(deep);
      expect(shallow).toContain('repeat(3, minmax(0, 1fr))');
      expect(deep).toContain('repeat(2, minmax(0, 1fr))');
    });

    /*
     * The whole of issue #55. This scene used to slice each section and print
     * a count of the rest, which meant the pair whose match came fourth in its
     * section had to take the board's word for it that they were playing. The
     * stage is `overflow-hidden`, so a card that is not drawn is a card nobody
     * in the room can know about.
     */
    it.each([
      [32, 2],
      [32, 16],
      [64, 4],
    ])('draws all %s matches over %s tables', (pairs, tables) => {
      const markup = scene(board({ pairs, tables }));

      expect(markup.match(/data-match-id=/g)).toHaveLength(pairs);
    });

    it('never counts a match instead of drawing it', () => {
      const markup = scene(board({ pairs: 32, tables: 2 }));

      expect(markup).not.toContain('data-section-overflow');
      expect(markup).not.toContain('weitere');
    });

    /* The body is wrapped in a frame the hook measures against, and the thing
     * inside it is what scales. Without both, nothing ever shrinks. */
    it('puts the board inside a frame that can be scaled', () => {
      expect(scene(board({ pairs: 4, tables: 4 }))).toContain('beamer-fit');
    });

    /* The queue is the section that grows without a table to bound it, so it
     * spans the grid and lays itself out in columns rather than one stack. */
    it('lets the queue span the board rather than stacking one column', () => {
      expect(scene(board({ pairs: 12, tables: 2 }))).toContain('col-span-full');
    });
  });

  /*
   * The layout-shift criterion, one level in from the card. Since issue #77 a
   * decided box gains no element and no border width at all — the winner's
   * extra 4 px are an inset shadow, which paints inside a box the browser had
   * already laid out. So the box that arrives is the box that was there.
   */
  it('changes no box geometry when a result lands', () => {
    const open = scene(board({ pairs: 1 }));
    const decided = scene(board({ pairs: 1, decided: 1 }));

    // The same border width in every state, and only one width in the file.
    expect(open.match(/border-\[2px\]/g)).toHaveLength(2);
    expect(decided.match(/border-\[2px\]/g)).toHaveLength(2);
    expect(decided).not.toMatch(/border-\[6px\]/);

    // And the same number of elements inside each side.
    expect(slots(decided)).toEqual(slots(open));
  });

  it(`does not change a card inner structure when its result lands`, () => {
    const before = scene(board({ pairs: 2, tables: 2, decided: 0 }));
    const after = scene(board({ pairs: 2, tables: 2, decided: 1 }));

    expect(slots(after)).toEqual(slots(before));
  });

  it('says so rather than going blank before anything is drawn', () => {
    expect(scene(toTournamentSnapshot(tournament()))).toContain(de.beamer.roundBoard.empty);
  });

  /*
   * Issue #87. One card per match, never one per table — a table the round is
   * not played on is dead space, and on a projector dead space is paid for in
   * numeral size, which is the only thing that matters at 10 m.
   */
  describe('a table with no match this round', () => {
    /* The issue's first acceptance criterion: 10 tables, 3 matches → 3 cards. */
    it('is not drawn at all', () => {
      const markup = scene(board({ pairs: 3, tables: 3, idle: 7 }));

      expect(markup.match(/data-table-id="/g)).toHaveLength(3);
      expect(markup.match(/data-match-id="/g)).toHaveLength(3);
      expect(markup).not.toContain('data-table-idle');
    });

    /*
     * ...and the other half of that criterion, which is the whole point of the
     * issue: "sized as if the screen only ever had 3 cards on it". Dropping the
     * seven headings and then laying the three out as though ten were still
     * there would buy the room nothing. Byte-for-byte the same board.
     */
    it('costs the board nothing at all', () => {
      const wideHall = scene(board({ pairs: 3, tables: 3, idle: 7 }));
      const narrowHall = scene(board({ pairs: 3, tables: 3 }));

      expect(wideHall).toBe(narrowHall);
    });

    it('is left out whether it is free or out of service', () => {
      const markup = scene(board({ pairs: 1, tables: 1, idle: 2, locked: [3] }));

      expect(markup.match(/data-table-id="/g)).toHaveLength(1);
      expect(markup).toContain(`data-table-id="${tableId(1)}"`);
    });
  });

  /*
   * The mistake the issue spends half its text warning about. "Unused" means
   * *no match assigned this round* — never "the match there has finished".
   * Getting it backwards would delete each result from the wall at the moment
   * the room started reading it.
   */
  describe('a table that has been played on', () => {
    it('keeps its finished match, and its colour, while the hall stands idle', () => {
      const markup = scene(board({ pairs: 1, tables: 1, idle: 9, decided: 1 }));

      expect(markup.match(/data-table-id="/g)).toHaveLength(1);
      expect(markup).toContain('data-outcome="WINNER"');
      expect(markup).toContain('data-outcome="LOSER"');
    });

    it('keeps every result of a round that is over', () => {
      const markup = scene(board({ pairs: 4, tables: 4, idle: 6, decided: 4 }));

      expect(markup.match(/data-match-id="/g)).toHaveLength(4);
      expect(markup.match(/data-outcome="WINNER"/g)).toHaveLength(4);
    });

    /*
     * The issue's third acceptance criterion. A table locked mid-round keeps
     * whatever is on it: the host sets `gesperrt` because the table is going
     * out of service *after* this match, and a board reading `status` rather
     * than the match list would blank a match still being played.
     */
    it('keeps its running match when the host locks it mid-round', () => {
      const markup = scene(board({ pairs: 2, tables: 2, locked: [1] }));

      expect(markup).toContain(`data-table-id="${tableId(1)}"`);
      expect(markup.match(/data-match-id="/g)).toHaveLength(2);
    });
  });

  /*
   * "The grid is still pre-computed once, so nothing reflows mid-round"
   * (issue #87, the same rule issue #76 imposed on the draw).
   *
   * The card scale is keyed on the round's match count and on nothing else,
   * and a round's match list is fixed the moment it is drawn — so the three
   * stages below are one round at three points in its evening and the numerals
   * are the same size in all of them. Keying it on the sections, or on the
   * deepest one, is what this rules out: both move as the host works through
   * the queue, and the room would watch the whole board change size because a
   * pair was sent to a table.
   */
  it('never changes the card scale as the round is played', () => {
    const queued = numeralType(scene(board({ pairs: 6, tables: 1 })));
    const spread = numeralType(scene(board({ pairs: 6, tables: 3 })));
    const over = numeralType(scene(board({ pairs: 6, tables: 6, decided: 6 })));

    expect(queued).not.toBe('');
    expect(spread).toBe(queued);
    expect(over).toBe(queued);
  });

  /* The other direction of the same rule: a smaller round is genuinely bigger
   * on the wall, so the scale is not simply constant everywhere. */
  it('gives a three-match round bigger numerals than a thirty-match one', () => {
    expect(numeralType(scene(board({ pairs: 3, tables: 3 })))).not.toBe(
      numeralType(scene(board({ pairs: 30, tables: 8 }))),
    );
  });
});

/** The type step the participant numbers are drawn at. */
function numeralType(markup: string): string {
  const numeral = /class="([^"]*)"[^>]*data-group-number/.exec(markup)?.[1] ?? '';
  return numeral.split(' ').find((name) => name.startsWith('text-beamer-')) ?? '';
}

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
function readSides(markup: string): { outcome: string; icon: string; ring: boolean }[] {
  const side = /class="([^"]*)"[^>]*data-outcome="(WINNER|LOSER)"[\s\S]*?<\/span><\/span>/g;
  return [...markup.matchAll(side)].map((hit) => ({
    outcome: hit[2] ?? '',
    icon: /data-outcome-icon="">([^<]*)</.exec(hit[0])?.[1] ?? '',
    ring: (hit[1] ?? '').includes('wm-result-ring'),
  }));
}

/** How many number boxes and icons each board renders. */
function slots(markup: string): { boxes: number; icons: number } {
  return {
    boxes: (markup.match(/data-outcome="/g) ?? []).length,
    icons: (markup.match(/data-outcome-icon/g) ?? []).length,
  };
}
