// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { matchId } from '@/domain/testFixtures';
import type { Match } from '@/domain/types';
import { useResultFlip } from '@/windows/beamer/useResultFlip';

/**
 * Which results turn over on the projector (issue #29, docs/MOTION.md §4.2).
 *
 * The rule is one sentence: a card flips because the room has just watched it
 * being decided, and for no other reason. Everything below is a way that
 * sentence gets broken — a beamer reopened mid-round, an undo, a host putting
 * an old round back on the wall — and each of them is thirty-two matches'
 * worth of animation at a full field.
 */

afterEach(cleanup);

/** `count` matches, of which the first `decided` have a winner. */
function board(count: number, decided: number): Match[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: matchId(index + 1),
    tableId: null,
    a: `grp_${String(index * 2 + 1)}` as Match['a'],
    b: `grp_${String(index * 2 + 2)}` as Match['b'],
    winnerId: index < decided ? (`grp_${String(index * 2 + 1)}` as Match['winnerId']) : null,
    status: index < decided ? ('DONE' as const) : ('RUNNING' as const),
  }));
}

function mounted(matches: Match[], delivery: 'live' | 'catchUp' = 'live') {
  return renderHook(
    ({ current, how }: { current: Match[]; how: 'live' | 'catchUp' }) =>
      useResultFlip(current, how),
    { initialProps: { current: matches, how: delivery } },
  );
}

describe('useResultFlip', () => {
  it('flips nothing on the first render, however much is decided', () => {
    // The board the window opens on is the resting picture. Thirty-two decided
    // matches is sixty-four sides, and every one of them would animate.
    const { result } = mounted(board(32, 32));
    expect(result.current.size).toBe(0);
  });

  it('flips the one match that has just been decided', () => {
    const { result, rerender } = mounted(board(32, 31));
    rerender({ current: board(32, 32), how: 'live' });

    expect([...result.current]).toEqual([matchId(32)]);
  });

  it('flips a corrected result again', () => {
    // The host marks the wrong winner and puts it right. The card has to turn
    // the other way; a colour that changed with nothing happening reads as a
    // rendering bug from the back of the room.
    const decided = board(4, 4);
    const corrected = decided.map((match, index) =>
      index === 0 ? { ...match, winnerId: match.b } : match,
    );

    const { result, rerender } = mounted(decided);
    rerender({ current: corrected, how: 'live' });

    expect([...result.current]).toEqual([matchId(1)]);
  });

  it('flips nothing on a catch-up, whatever changed', () => {
    // A reopened beamer and an undo both arrive this way (issue #11). Both must
    // put the picture where it belongs without playing anything out.
    const { result, rerender } = mounted(board(32, 31));
    rerender({ current: board(32, 32), how: 'catchUp' });

    expect(result.current.size).toBe(0);
  });

  it('flips nothing when a result is walked back', () => {
    // An undo that opens a decided match again. There is no card to turn over:
    // nothing was decided, something was un-decided.
    const { result, rerender } = mounted(board(32, 32));
    rerender({ current: board(32, 31), how: 'live' });

    expect(result.current.size).toBe(0);
  });

  it('forgets a flip once it has been rendered', () => {
    // Otherwise a board that re-rendered for any other reason — the clock, a
    // table being renamed — would replay the last result every time.
    const { result, rerender } = mounted(board(4, 3));
    rerender({ current: board(4, 4), how: 'live' });
    expect(result.current.size).toBe(1);

    rerender({ current: board(4, 4), how: 'live' });

    expect(result.current.size).toBe(0);
  });

  it('flips every result that landed between two renders', () => {
    // Two tables finishing at once is ordinary, and the snapshot can carry both
    // — but a whole board arriving at once is what the budget of §6 cares
    // about, and that is the catch-up case above.
    const { result, rerender } = mounted(board(4, 2));
    rerender({ current: board(4, 4), how: 'live' });

    expect([...result.current].sort()).toEqual([matchId(3), matchId(4)]);
  });
});
