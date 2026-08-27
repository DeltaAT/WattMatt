// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SnapshotDelivery } from '@/domain/snapshot';
import { useCountPulse } from '@/windows/beamer/useCountPulse';

/**
 * The tick on the welcome screen's count (issue #74, docs/MOTION.md §4.7).
 *
 * The rule is one sentence: the number pulses because this window has just
 * watched it change, and for no other reason. Everything below is a way that
 * sentence gets broken — a beamer plugged back in during registration, an undo
 * of a group added by mistake, an unrelated commit landing while the pulse is
 * still running.
 */

afterEach(cleanup);

function mounted(count: number, delivery: SnapshotDelivery = 'live') {
  return renderHook(({ n, how }: { n: number; how: SnapshotDelivery }) => useCountPulse(n, how), {
    initialProps: { n: count, how: delivery },
  });
}

describe('useCountPulse', () => {
  it('does not pulse on the first render, however large the count already is', () => {
    // The count a window opens on is the resting picture, not a moment. A
    // beamer opened at a 64-group event must not announce the field it was
    // handed as if it had just arrived.
    expect(mounted(64).result.current).toBe(0);
  });

  it('advances once for each change the window watches happen', () => {
    const { result, rerender } = mounted(0);

    rerender({ n: 1, how: 'live' });
    expect(result.current).toBe(1);

    rerender({ n: 2, how: 'live' });
    expect(result.current).toBe(2);
  });

  /*
   * The bulk-add of issue #14: the host types "40" and commits once. Forty
   * groups arriving together is one tick, because one thing happened.
   */
  it('counts a jump of forty as a single tick', () => {
    const { result, rerender } = mounted(0);

    rerender({ n: 40, how: 'live' });

    expect(result.current).toBe(1);
  });

  /*
   * The generation is what the scene keys the digits on, and a key that moved
   * mid-animation would restart the pulse — or, worse, a class removed
   * mid-animation would cut it short in front of the room. So an unrelated
   * commit that leaves the count alone must leave the generation alone too.
   */
  it('stands still across a commit that did not change the count', () => {
    const { result, rerender } = mounted(0);
    rerender({ n: 7, how: 'live' });

    rerender({ n: 7, how: 'live' });
    rerender({ n: 7, how: 'live' });

    expect(result.current).toBe(1);
  });

  it('never pulses for a snapshot that is only catching up', () => {
    const { result, rerender } = mounted(4, 'catchUp');

    rerender({ n: 12, how: 'catchUp' });

    expect(result.current).toBe(0);
  });

  /*
   * An undo arrives as `catchUp` (issue #11). The host removing a group they
   * added by mistake is a correction, not a moment the room is watching.
   */
  it('takes a caught-up count as the new resting count', () => {
    const { result, rerender } = mounted(4);
    rerender({ n: 5, how: 'live' });
    expect(result.current).toBe(1);

    // The undo, and then a live render that changes nothing.
    rerender({ n: 4, how: 'catchUp' });
    rerender({ n: 4, how: 'live' });

    expect(result.current).toBe(1);
  });

  /*
   * The host deletes a group in setup, deliberately, while the wall is up. That
   * is still the number changing in front of the room and it still ticks —
   * a figure that dropped without anything happening reads as a glitch.
   */
  it('pulses when the count falls as well as when it rises', () => {
    const { result, rerender } = mounted(8);

    rerender({ n: 7, how: 'live' });

    expect(result.current).toBe(1);
  });
});
