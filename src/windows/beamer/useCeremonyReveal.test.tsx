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
  it('does not auto-reveal a catch-up snapshot', () => {
    const { result } = renderHook(
      ({ delivery }: { delivery: SnapshotDelivery }) =>
        useCeremonyReveal({ mode: 'AUTO', step: 0 }, delivery, true),
      { initialProps: { delivery: 'catchUp' as SnapshotDelivery } },
    );

    expect(result.current.step).toBe(-1);
  });

  it('reveals bronze -> silver -> gold in live mode', () => {
    vi.useFakeTimers();
    const { result } = renderHook(
      ({ delivery }: { delivery: SnapshotDelivery }) =>
        useCeremonyReveal({ mode: 'AUTO', step: 0 }, delivery, true),
      { initialProps: { delivery: 'live' as SnapshotDelivery } },
    );

    expect(result.current.step).toBe(0);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.step).toBe(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.step).toBe(2);
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
  });
});
