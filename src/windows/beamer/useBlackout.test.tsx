// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BeamerScene } from '@/domain/beamerScene';
import { BLACKOUT_FADE_MS, useBlackout } from '@/windows/beamer/useBlackout';

/**
 * The blackout fade (issue #28, docs/MOTION.md §4.6).
 *
 * The behaviour worth pinning is not the animation, it is what is on screen
 * while it runs and what happens if anything about it goes wrong.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BLACKOUT: BeamerScene = { id: 'BLACKOUT' };
const BRACKET: BeamerScene = { id: 'BRACKET' };

function mounted(scene: BeamerScene, settled = false) {
  return renderHook(
    ({ current, isSettled }: { current: BeamerScene; isSettled: boolean }) =>
      useBlackout(current, isSettled),
    { initialProps: { current: scene, isSettled: settled } },
  );
}

describe('the blackout fade', () => {
  it('keeps drawing the covered picture while the veil comes down', () => {
    const { result, rerender } = mounted(BRACKET, true);

    rerender({ current: BLACKOUT, isSettled: false });

    expect(result.current.veil).toBe(true);
    // There is nothing to fade *from* unless the picture is still there.
    expect(result.current.under).toEqual(BRACKET);
  });

  it('drops the covered picture once the veil has landed', () => {
    const { result, rerender } = mounted(BRACKET, true);
    rerender({ current: BLACKOUT, isSettled: false });

    vi.advanceTimersByTime(BLACKOUT_FADE_MS);
    rerender({ current: BLACKOUT, isSettled: false });

    // A draw playing on behind an opaque layer for the rest of the evening
    // would spend the frame budget of docs/MOTION.md §6 on nothing.
    expect(result.current.veil).toBe(false);
    expect(result.current.under).toEqual(BLACKOUT);
  });

  /*
   * A beamer reopened into a dark room must come up dark. Fading in from the
   * picture the host blacked out ten minutes ago would put that picture back in
   * front of the audience.
   */
  it('does not fade a blackout that arrives as a catch-up', () => {
    const { result } = mounted(BLACKOUT, true);

    expect(result.current.veil).toBe(false);
    expect(result.current.under).toEqual(BLACKOUT);
  });

  it('draws the scene itself when there is no blackout at all', () => {
    const { result } = mounted(BRACKET, false);

    expect(result.current.veil).toBe(false);
    expect(result.current.under).toEqual(BRACKET);
  });

  it('fades from the newest picture when the host blacks out twice', () => {
    const { result, rerender } = mounted(BRACKET, true);

    rerender({ current: BLACKOUT, isSettled: false });
    vi.advanceTimersByTime(BLACKOUT_FADE_MS);
    rerender({ current: { id: 'TABLE_OVERVIEW' }, isSettled: false });
    rerender({ current: BLACKOUT, isSettled: false });

    expect(result.current.under).toEqual({ id: 'TABLE_OVERVIEW' });
  });
});
