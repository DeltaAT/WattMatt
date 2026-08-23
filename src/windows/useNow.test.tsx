// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNow } from '@/windows/useNow';

/**
 * The display clock behind the occupancy board's stopwatch (issue #13).
 *
 * It exists so a running time moves without anybody clicking, and it is the one
 * clock in the UI that is read outside the injected `Clock` — so what is
 * checked here is that it stops when there is nothing to count.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-23T10:00:00'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useNow', () => {
  it('moves on its own, once a second', () => {
    const { result } = renderHook(() => useNow(true));
    const first = result.current;

    act(() => vi.advanceTimersByTime(2_000));

    expect(result.current).not.toBe(first);
    expect(Date.parse(result.current) - Date.parse(first)).toBe(2_000);
  });

  /* A setup screen has no stopwatch to move, and re-rendering the host window
   * once a second for the hour before the doors open buys nothing. */
  it('stands still while nothing is running', () => {
    const { result } = renderHook(() => useNow(false));
    const first = result.current;

    act(() => vi.advanceTimersByTime(5_000));

    expect(result.current).toBe(first);
  });

  it('reads the clock the moment it is switched on, not a second later', () => {
    const { result, rerender } = renderHook(({ on }: { on: boolean }) => useNow(on), {
      initialProps: { on: false },
    });
    const before = result.current;

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    rerender({ on: true });

    expect(Date.parse(result.current) - Date.parse(before)).toBe(30_000);
  });

  it('stops ticking when it is unmounted', () => {
    const { unmount } = renderHook(() => useNow(true));

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });
});
