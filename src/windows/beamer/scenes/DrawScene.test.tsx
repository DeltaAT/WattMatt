import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { drawStepCount } from '@/domain/drawSequence';
import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import {
  group,
  groupId,
  match,
  midTournament,
  round,
  table,
  tournament,
} from '@/domain/testFixtures';
import { de } from '@/i18n';
import { fitColumns } from '@/windows/beamer/fit';
import { DrawScene, EMPTY_SLOT_TEXT } from '@/windows/beamer/scenes/DrawScene';

/**
 * The `DRAW` scene (issue #18, redesigned by issue #76).
 *
 * The board is a pure function of `step`, so every acceptance criterion about
 * what the audience sees can be asked here directly, with no timer involved.
 * The timing itself is `drawSequence.test.ts`'s; the skip is
 * `useDrawSequence.test.tsx`'s.
 *
 * Issue #76's central claim is a *negative* one — "nothing has moved after it
 * appeared" — and jsdom has no layout to measure it with. So what is pinned
 * here is everything that decides the layout: how many slots there are, how
 * many columns they sit in, and which type step they are drawn at. All three
 * are computed from the final pairing count, so all three must be identical at
 * step 0 and at the last step. If they are, no card can have moved.
 */

function drawnTournament({ pairs, bye = false }: { pairs: number; bye?: boolean }) {
  const matches = Array.from({ length: pairs }, (_, index) =>
    match(index + 1, {
      a: groupId(index * 2 + 1),
      b: groupId(index * 2 + 2),
      // Two tables only, so the pairings past them queue — the normal case
      // (docs/TOURNAMENT-RULES.md §3, edge case 3).
      tableId: index < 2 ? table(index + 1).id : null,
    }),
  );
  if (bye) {
    matches.push(match(pairs + 1, { a: groupId(pairs * 2 + 1), b: null }));
  }

  const groups = Array.from({ length: pairs * 2 + (bye ? 1 : 0) }, (_, index) => group(index + 1));

  return toTournamentSnapshot(
    tournament({
      groups,
      tables: [table(1), table(2)],
      rounds: [round(1, { state: 'DRAWN', matches })],
    }),
  );
}

function scene(snapshot: TournamentSnapshot, step: number, settled = false): string {
  return renderToStaticMarkup(<DrawScene tournament={snapshot} step={step} settled={settled} />);
}

/** The pairings actually on the board — an empty slot carries no match id. */
const cards = (markup: string) => markup.match(/data-match-id="/g) ?? [];

/** Every slot, drawn or not: this is the number that must never change. */
const slots = (markup: string) => markup.match(/<li /g) ?? [];

/** The three things that decide where a card ends up. */
function layout(markup: string) {
  return {
    slots: slots(markup).length,
    columns: /grid-template-columns:([^"]*)"/.exec(markup)?.[1],
    type: /text-beamer-(?:hero|h1|h2)/.exec(markup)?.[0],
  };
}

/** Each slot's markup, in board order. */
const cardsOf = (markup: string) => markup.split('<li ').slice(1);

/** How many number boxes a slot draws (issue #88). */
const boxesIn = (card: string) => (card.match(/data-outcome="/g) ?? []).length;

/** A pairing slot that is still waiting: both its lines hold the blank. */
const blankPairings = (markup: string) =>
  markup.match(new RegExp(`data-group-number="">${EMPTY_SLOT_TEXT}<`, 'g')) ?? [];

describe('the draw scene', () => {
  it('shows nothing drawn at step zero', () => {
    expect(cards(scene(drawnTournament({ pairs: 4 }), 0))).toHaveLength(0);
  });

  it('reveals one pairing per step, in draw order', () => {
    const snapshot = drawnTournament({ pairs: 4 });

    expect(cards(scene(snapshot, 1))).toHaveLength(1);
    expect(cards(scene(snapshot, 3))).toHaveLength(3);
    expect(scene(snapshot, 2)).toContain('data-match-id="mt_1"');
    expect(scene(snapshot, 2)).not.toContain('data-match-id="mt_3"');
  });

  /*
   * Issue #76's second acceptance criterion. The pool that used to stand on the
   * wall from the first frame told the room every number that was still coming;
   * the board now starts genuinely empty, and an undrawn slot says nothing at
   * all — not even in markup nobody can see.
   */
  it('shows no group number before it is drawn', () => {
    const snapshot = drawnTournament({ pairs: 4 });

    expect(blankPairings(scene(snapshot, 0))).toHaveLength(4);
    expect(blankPairings(scene(snapshot, 2))).toHaveLength(2);
    expect(blankPairings(scene(snapshot, 4))).toHaveLength(0);
  });

  /*
   * Issue #76's central requirement, and the one jsdom cannot measure directly:
   * "nothing has moved after it appeared". What decides that is the three
   * numbers below — how many slots, how many columns, which type step — and all
   * three are computed from the final pairing count. If none of them changes
   * between the empty board and the full one, no card can have moved.
   */
  it('reserves the whole grid before the first pairing lands', () => {
    for (const pairs of [1, 8, 16, 32]) {
      const snapshot = drawnTournament({ pairs });
      const empty = layout(scene(snapshot, 0));

      expect(empty.slots, `${String(pairs)} pairings`).toBe(pairs);
      expect(empty.columns, `${String(pairs)} pairings`).toBe(
        `repeat(${String(fitColumns(pairs, 2))}, minmax(0, 1fr))`,
      );

      for (const step of [1, Math.ceil(pairs / 2), pairs]) {
        expect(
          layout(scene(snapshot, step)),
          `${String(pairs)} pairings @ ${String(step)}`,
        ).toEqual(empty);
      }
    }
  });

  /*
   * The other half of the same guarantee: every pairing has a slot from the
   * start, so the last card lands in a space that was always reserved for it
   * and nothing is pushed off the stage at any field size.
   */
  it('keeps a slot for every pairing at every field size', () => {
    for (const pairs of [1, 8, 16, 32]) {
      const snapshot = drawnTournament({ pairs });

      expect(slots(scene(snapshot, 0)), `${String(pairs)} pairings`).toHaveLength(pairs);
      expect(cards(scene(snapshot, pairs, true)), `${String(pairs)} pairings`).toHaveLength(pairs);
    }
  });

  /*
   * A Freilos must not look like a bug (the issue says so in as many words).
   * It gets its own words, not only its own colour: a projector in a bright
   * room destroys hue differences (docs/STYLEGUIDE.md §1).
   */
  it('gives a Freilos its own reveal, in words', () => {
    const snapshot = drawnTournament({ pairs: 2, bye: true });
    const markup = scene(snapshot, 3);

    expect(markup).toContain(de.beamer.draw.byeAdvances);
    expect(markup).toContain('data-bye="true"');
  });

  it('does not mark an ordinary pairing as a bye', () => {
    const markup = scene(drawnTournament({ pairs: 2 }), 2);

    expect(markup).not.toContain('data-bye="true"');
    expect(markup).not.toContain(de.beamer.draw.byeAdvances);
  });

  /*
   * "Matches without a table show Wartet auf Tisch instead of a table label."
   * There are routinely more matches than tables (rules §3), and a card with
   * nothing where the table goes sends people looking for one.
   */
  it('says a pairing is waiting when it has no table', () => {
    const markup = scene(drawnTournament({ pairs: 4 }), 4);

    expect(markup).toContain(de.beamer.draw.waitingForTable);
    // The two that did get a table say so instead.
    expect(markup).toContain(table(1).label);
    expect(markup).toContain(table(2).label);
  });

  /*
   * The acceptance criterion: skipping mid-sequence leaves a correct, complete
   * board. The skip sets the step past the end, and that has to be the same
   * markup as the last beat completing on its own — bar the one-off entry
   * animation, which is what `settled` switches off.
   */
  it('renders the same board however the sequence reached its end', () => {
    const snapshot = drawnTournament({ pairs: 5, bye: true });
    const total = 6;

    expect(scene(snapshot, total, true)).toBe(scene(snapshot, total + 40, true));
  });

  /*
   * Reopening the beamer after the draw shows the settled board, not a replayed
   * animation (CLAUDE.md golden rule 4). `settled` is what removes every entry
   * animation, so nothing plays out in front of a room that already saw it.
   */
  it('animates nothing once settled', () => {
    const snapshot = drawnTournament({ pairs: 3 });
    const live = scene(snapshot, 3, false);
    const caughtUp = scene(snapshot, 3, true);

    expect(live).toContain('wm-draw-reveal');
    expect(caughtUp).not.toContain('wm-draw-reveal');
    expect(caughtUp).toContain('data-settled="true"');
  });

  /* Only the pairing that has just landed animates — re-animating the board on
   * every step would blow the 60-element budget (docs/MOTION.md §6). */
  it('animates only the newest pairing', () => {
    const markup = scene(drawnTournament({ pairs: 4 }), 3);

    expect(markup.match(/data-newest="true"/g)).toHaveLength(1);
    expect(markup.match(/wm-draw-reveal/g)).toHaveLength(1);
  });

  /*
   * The slot machine is gone (issue #76). A pairing simply appears — there is
   * no cycling slot, and nothing on the board is in flight between beats.
   */
  it('has no shuffling slot to show', () => {
    const snapshot = drawnTournament({ pairs: 3 });

    for (const step of [0, 1, 3]) {
      expect(scene(snapshot, step)).not.toContain('data-draw-slot');
      expect(scene(snapshot, step)).not.toContain('data-draw-pool');
    }
  });

  it('counts the progress for the room', () => {
    expect(scene(drawnTournament({ pairs: 6 }), 2)).toContain(
      de.beamer.draw.progress({ drawn: 2, total: 6 }),
    );
  });

  /*
   * The type floor is 32 px at 1080p (docs/STYLEGUIDE.md §2), which is
   * `text-beamer-body`. The densest step of the grid must still reach it — the
   * issue's "readable from 10 m" criterion is this and nothing else.
   */
  it('never drops below the beamer type floor, even at 32 pairings', () => {
    const markup = scene(drawnTournament({ pairs: 32 }), 32, true);

    expect(cards(markup)).toHaveLength(32);
    expect(markup).toContain('text-beamer-body');
    for (const smaller of ['text-host-xs', 'text-host-sm', 'text-beamer-caption']) {
      expect(markup, smaller).not.toContain(smaller);
    }
  });

  /*
   * Issue #88. Two numerals with nothing between them but space read as one
   * number from ten metres — `7 12` is `712` to anybody who has not been told
   * otherwise — so each gets a container of its own.
   */
  describe('each number in its own box', () => {
    it('draws two boxes for a pairing', () => {
      const drawn = cardsOf(scene(drawnTournament({ pairs: 3 }), 3, true));

      expect(drawn).toHaveLength(3);
      for (const card of drawn) {
        expect(boxesIn(card)).toBe(2);
      }
    });

    /* A `Freilos` has one participant, so it has one box — the empty half of
     * the pair is what makes it read as a bug (docs/TOURNAMENT-RULES.md §9). */
    it('draws one box for a Freilos', () => {
      const drawn = cardsOf(scene(drawnTournament({ pairs: 2, bye: true }), 3, true));

      expect(boxesIn(drawn.at(-1) ?? '')).toBe(1);
    });

    /*
     * "The gap between them should be at least as wide as one numeral." Said in
     * `ch`, which is the advance of a digit in the font the row is set in — the
     * only unit that stays true as the ladder steps the numerals up and down.
     * The type step has to stay on the row for that to mean anything, so it is
     * asserted with the gap rather than beside it.
     */
    it('separates the two boxes by more than a numeral', () => {
      const row = /class="([^"]*)"\s+data-pairing=""/.exec(
        scene(drawnTournament({ pairs: 3 }), 3, true),
      )?.[1];

      expect(row).toContain('gap-[1.5ch]');
      expect(row).toContain('wm-tnum');
      expect(row).toMatch(/text-beamer-(?:hero|h1|h2)/);
    });

    /*
     * Issue #75's shape, restated now that the numbers have edges of their own:
     * the table is above both boxes and outside them, so a bare `3` over a bare
     * `7` can never read as a third participant.
     */
    it('keeps the table number above both boxes and outside them', () => {
      const card = cardsOf(scene(drawnTournament({ pairs: 2 }), 2, true))[0] ?? '';
      const where = /class="[^"]*"\s+data-pairing-where="">([^<]*)</.exec(card);

      expect(where?.[1]).toBe(table(1).label);
      expect(card.indexOf('data-pairing-where')).toBeLessThan(card.indexOf('data-outcome'));
    });

    /*
     * An undrawn slot reserves a box too. It is the same height as the boxes
     * that will replace it — which is what keeps the grid still (issue #76) —
     * and it still says nothing about what is coming, not even whether the
     * pairing turns out to be a `Freilos`.
     */
    it('reserves a box in a slot nothing has landed in', () => {
      const empty = cardsOf(scene(drawnTournament({ pairs: 4 }), 0))[0] ?? '';

      expect(boxesIn(empty)).toBe(1);
      expect(empty).toContain('data-outcome="NEUTRAL"');
      expect(blankPairings(empty)).toHaveLength(1);
    });

    /* Neutral, always: a drawn pairing has no result yet, and a box that was
     * painted before the match would be telling the room the wrong thing. */
    it('paints every box neutral however far the draw has run', () => {
      for (const step of [0, 2, 4]) {
        const markup = scene(drawnTournament({ pairs: 4 }), step, true);

        expect(markup, `step ${String(step)}`).not.toContain('data-outcome="WINNER"');
        expect(markup, `step ${String(step)}`).not.toContain('data-outcome="LOSER"');
      }
    });
  });

  /* A round with nothing in it should not happen, but a blank projector during
   * the Auslosung is the one moment the room is actually watching. */
  it('says so rather than going blank when there is nothing to draw', () => {
    const markup = scene(toTournamentSnapshot(tournament()), 0, true);
    expect(markup).toContain(de.beamer.draw.empty);
  });

  it('draws the round carried by the snapshot', () => {
    const snapshot = toTournamentSnapshot(midTournament());
    // `midTournament`'s open round has two matches.
    expect(drawStepCount({ ...snapshot.round!, matches: snapshot.matches })).toBe(2);
    expect(cards(scene(snapshot, 2, true))).toHaveLength(2);
  });
});
