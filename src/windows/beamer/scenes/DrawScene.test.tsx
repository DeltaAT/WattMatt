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
import { DrawScene } from '@/windows/beamer/scenes/DrawScene';

/**
 * The `DRAW` scene (issue #18).
 *
 * The board is a pure function of `step`, so every acceptance criterion about
 * what the audience sees can be asked here directly, with no timer involved.
 * The timing itself is `drawSequence.test.ts`'s; the skip is
 * `useDrawSequence.test.tsx`'s.
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

const cards = (markup: string) => markup.match(/data-match-id="/g) ?? [];
const poolChips = (markup: string) => markup.match(/data-pool-group-id="/g) ?? [];

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
   * "Drawn numbers are removed from the pool so the audience can follow the
   * shrinking field" — the thing that makes a draw legible from the back of a
   * room.
   */
  it('takes each drawn pairing out of the pool', () => {
    const snapshot = drawnTournament({ pairs: 4 });

    expect(poolChips(scene(snapshot, 0))).toHaveLength(8);
    expect(poolChips(scene(snapshot, 2))).toHaveLength(4);
    expect(scene(snapshot, 4)).toContain(de.beamer.draw.poolEmpty);
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
    expect(caughtUp).not.toContain('wm-draw-pool-number');
    expect(caughtUp).toContain('data-settled="true"');
  });

  /* Only the pairing that has just landed animates — re-animating the board on
   * every step would blow the 60-element budget (docs/MOTION.md §6). */
  it('animates only the newest pairing', () => {
    const markup = scene(drawnTournament({ pairs: 4 }), 3);

    expect(markup.match(/data-newest="true"/g)).toHaveLength(1);
    expect(markup.match(/wm-draw-reveal/g)).toHaveLength(1);
  });

  /* The shuffling slot exists only while a pairing is in flight. A caught-up
   * beamer has nothing being drawn, and neither has a finished board. */
  it('shows the shuffling slot only while the draw is running', () => {
    const snapshot = drawnTournament({ pairs: 3 });

    expect(scene(snapshot, 1, false)).toContain('data-draw-slot');
    expect(scene(snapshot, 3, false)).not.toContain('data-draw-slot');
    expect(scene(snapshot, 1, true)).not.toContain('data-draw-slot');
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
