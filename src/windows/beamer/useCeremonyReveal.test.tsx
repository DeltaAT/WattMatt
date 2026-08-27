// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SnapshotDelivery } from '@/domain/snapshot';
import { useCeremonyReveal } from '@/windows/beamer/useCeremonyReveal';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the ceremony reveal', () => {
  /*
   * A beamer reopened mid-ceremony, and an undo, both arrive this way. The
   * sequence must not run — the room heard those three names called out
   * already — but the podium it produced has to be there, whole, or reopening
   * the window would take the evening's last picture off the wall
   * (CLAUDE.md golden rule 4, docs/TOURNAMENT-RULES.md §9 case 12).
   */
  it('hands a catch-up snapshot the finished podium and no sequence', () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      ({ delivery }: { delivery: SnapshotDelivery }) =>
        useCeremonyReveal({ mode: 'AUTO', step: 0 }, delivery, true),
      { initialProps: { delivery: 'catchUp' as SnapshotDelivery } },
    );

    expect(result.current.step).toBe(2);
    // Nothing is landing, so nothing on the podium moves.
    expect(result.current.arriving).toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.step).toBe(2);
  });

  it('does not start the sequence before the scene has settled', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ settled }: { settled: boolean }) =>
        useCeremonyReveal({ mode: 'AUTO', step: 0 }, 'live', settled),
      { initialProps: { settled: false } },
    );

    expect(result.current.step).toBe(-1);

    rerender({ settled: true });
    expect(result.current.step).toBe(0);
  });

  it('reveals bronze -> silver -> gold in live mode', () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      ({ delivery }: { delivery: SnapshotDelivery }) =>
        useCeremonyReveal({ mode: 'AUTO', step: 0 }, delivery, true),
      { initialProps: { delivery: 'live' as SnapshotDelivery } },
    );

    expect(result.current.step).toBe(0);
    // The place that is landing: the one the podium animates (issue #69).
    expect(result.current.arriving).toBe(0);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.step).toBe(1);
    expect(result.current.arriving).toBe(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.step).toBe(2);
    expect(result.current.arriving).toBe(2);
  });

  it('honours host-triggered manual stepping instead of auto-replaying the reveal', () => {
    const { result, rerender } = renderHook(
      ({
        sceneReveal,
        delivery,
      }: {
        sceneReveal: { mode: 'AUTO' | 'STEP'; step: number };
        delivery: SnapshotDelivery;
      }) => useCeremonyReveal(sceneReveal, delivery, true),
      {
        initialProps: {
          sceneReveal: { mode: 'STEP', step: 0 },
          delivery: 'live' as SnapshotDelivery,
        },
      },
    );

    expect(result.current.mode).toBe('STEP');
    expect(result.current.step).toBe(0);

    rerender({ sceneReveal: { mode: 'STEP', step: 1 }, delivery: 'live' as SnapshotDelivery });
    expect(result.current.step).toBe(1);

    rerender({ sceneReveal: { mode: 'STEP', step: 2 }, delivery: 'live' as SnapshotDelivery });
    expect(result.current.step).toBe(2);
    expect(result.current.arriving).toBe(2);

    // A step the window has already watched is not an arrival: an undo puts the
    // podium back without the block rising a second time.
    rerender({ sceneReveal: { mode: 'STEP', step: 1 }, delivery: 'catchUp' as SnapshotDelivery });
    expect(result.current.step).toBe(1);
    expect(result.current.arriving).toBeNull();
  });
});
