import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { toTournamentSnapshot, type TournamentSnapshot } from '@/domain/snapshot';
import { group, groupId, match, round, table, tournament } from '@/domain/testFixtures';
import { DrawScene, RoundBoardScene } from '@/windows/beamer/scenes';

/**
 * Issue #88's third acceptance criterion, which no single scene can answer.
 *
 * *"The box a group sits in during the draw is the same box that later turns
 * green or red — no visual discontinuity when the round starts."* The room
 * watches the `Auslosung` and then, half a minute later, the round board. If
 * the numbers change size, padding or radius between the two pictures, the box
 * reads as a new object rather than as the same one being answered — and the
 * whole reason `GroupBox` is a component instead of a class string is to make
 * that impossible.
 *
 * Two class strings copied into two scenes would pass every other test in the
 * repository while drifting apart over three issues. This is the test that
 * fails when somebody adds a padding step to one of them.
 */

/** Four pairings on four tables, undecided: what the draw hands the board. */
function drawnRound({ decided = 0 }: { decided?: number } = {}): TournamentSnapshot {
  const matches = Array.from({ length: 4 }, (_, index) =>
    match(index + 1, {
      a: groupId(index * 2 + 1),
      b: groupId(index * 2 + 2),
      tableId: table(index + 1).id,
      ...(index < decided
        ? { winnerId: groupId(index * 2 + 1), status: 'DONE' as const }
        : { status: 'RUNNING' as const }),
    }),
  );

  return toTournamentSnapshot(
    tournament({
      groups: Array.from({ length: 8 }, (_, index) => group(index + 1)),
      tables: Array.from({ length: 4 }, (_, index) => table(index + 1)),
      rounds: [round(1, { state: 'RUNNING', matches })],
    }),
  );
}

const drawn = (snapshot: TournamentSnapshot) =>
  renderToStaticMarkup(<DrawScene tournament={snapshot} step={4} settled />);

const board = (snapshot: TournamentSnapshot) =>
  renderToStaticMarkup(<RoundBoardScene tournament={snapshot} settled delivery="catchUp" />);

/** Every box in the markup, as `{ state, classes }` in document order. */
function boxes(markup: string): { state: string; classes: string[] }[] {
  return [...markup.matchAll(/class="([^"]*)"\s+data-outcome="([A-Z]+)"/g)].map((hit) => ({
    state: hit[2] ?? '',
    classes: (hit[1] ?? '').split(' ').filter(Boolean),
  }));
}

/** What must not differ: everything about a box that is not its paint. */
function geometry(box: { classes: string[] }): string[] {
  return box.classes
    .filter((name) => !/^(?:border-wm|bg-wm|text-wm|wm-result|opacity|saturate)/.test(name))
    .sort();
}

describe('the number box across the two group-round scenes', () => {
  it('is the identical box in the draw and on the board', () => {
    const snapshot = drawnRound();
    const inDraw = boxes(drawn(snapshot));
    const onBoard = boxes(board(snapshot));

    expect(inDraw).not.toHaveLength(0);
    expect(onBoard).toHaveLength(inDraw.length);
    // Neutral on both: a pairing that has been drawn and not yet played looks
    // the same whichever picture the host has staged.
    expect(onBoard).toEqual(inDraw);
  });

  /*
   * And when the result does land, only the paint changes. This is issue #77's
   * "nothing moves when a result comes in" and issue #88's "no visual
   * discontinuity" asked as one question, across the scene boundary where both
   * are hardest to see.
   */
  it('changes only its colour when the result arrives', () => {
    const neutral = boxes(drawn(drawnRound()));
    const decided = boxes(board(drawnRound({ decided: 4 })));

    expect(decided.map((box) => box.state)).not.toContain('NEUTRAL');
    for (const [index, box] of decided.entries()) {
      expect(geometry(box), box.state).toEqual(geometry(neutral[index]!));
    }
  });
});
