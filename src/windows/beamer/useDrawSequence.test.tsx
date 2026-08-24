// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drawSchedule } from '@/domain/drawSequence';
import { roundIdSchema, type RoundId } from '@/domain/ids';
import { useDrawSequence, type DrawSequence } from '@/windows/beamer/useDrawSequence';

/**
 * The draw timeline (issue #18).
 *
 * What each step shows is `drawSequence.test.ts`'s; this is only about *when*
 * the step advances, and about the three ways the sequence can reach its end
 * having to agree — run to completion, skipped, or caught up.
 */

const round = (value: string): RoundId => roundIdSchema.parse(value);

/** Renders the hook and hands back a live handle on its latest value. */
function mount(props: Parameters<typeof useDrawSequence>[0]) {
  const seen: DrawSequence[] = [];

  function Probe(inner: Parameters<typeof useDrawSequence>[0]) {
    seen.push(useDrawSequence(inner));
    return null;
  }

  const view = render(<Probe {...props} />);
  return {
    get current(): DrawSequence {
      const latest = seen.at(-1);
      if (latest === undefined) {
        throw new Error('the hook never rendered');
      }
      return latest;
    },
    rerender: (next: Parameters<typeof useDrawSequence>[0]) => view.rerender(<Probe {...next} />),
    unmount: view.unmount,
  };
}

const FULL_SEQUENCE = drawSchedule(4, false).at(-1) ?? 0;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('running the sequence', () => {
  it('starts with nothing revealed', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });

    expect(probe.current.step).toBe(0);
    expect(probe.current.isComplete).toBe(false);
  });

  it('reveals nothing until the anticipation beat is over', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(probe.current.step).toBe(0);
  });

  it('advances one pairing per beat', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });
    const schedule = drawSchedule(4, false);

    act(() => {
      vi.advanceTimersByTime(schedule[0] ?? 0);
    });
    expect(probe.current.step).toBe(1);

    act(() => {
      vi.advanceTimersByTime((schedule[2] ?? 0) - (schedule[0] ?? 0));
    });
    expect(probe.current.step).toBe(3);
  });

  it('finishes at the last beat and stops there', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });

    act(() => {
      vi.advanceTimersByTime(FULL_SEQUENCE + 10_000);
    });

    expect(probe.current.step).toBe(4);
    expect(probe.current.isComplete).toBe(true);
  });

  /* Performance mode halves every duration (docs/MOTION.md §6), so the whole
   * draw is over in half the time — the CSS tokens do the same thing. */
  it('runs at half the length in performance mode', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: true,
    });

    act(() => {
      vi.advanceTimersByTime(FULL_SEQUENCE / 2);
    });

    expect(probe.current.step).toBe(4);
  });
});

describe('skipping', () => {
  /* The issue's criterion: `Space` skips to the fully drawn board. */
  it('jumps straight to the complete board', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });

    act(() => {
      vi.advanceTimersByTime(3000);
      probe.current.skip();
    });

    expect(probe.current.step).toBe(4);
    expect(probe.current.isComplete).toBe(true);
  });

  /*
   * The timers armed before the skip are still pending. If one of them landed
   * afterwards it would rewind the board in front of the audience — the reason
   * the hook only ever moves the step forward.
   */
  it('does not let a pending beat rewind the board', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });

    act(() => {
      probe.current.skip();
    });
    expect(probe.current.step).toBe(4);

    act(() => {
      vi.advanceTimersByTime(FULL_SEQUENCE + 5000);
    });
    expect(probe.current.step).toBe(4);
  });

  it('is harmless once the sequence is already complete', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 2,
      settled: false,
      performanceMode: false,
    });

    act(() => {
      vi.advanceTimersByTime(FULL_SEQUENCE);
      probe.current.skip();
      probe.current.skip();
    });

    expect(probe.current.step).toBe(2);
  });
});

describe('catching up', () => {
  /*
   * Reopening the beamer after the draw shows the settled board, not a replayed
   * animation (CLAUDE.md golden rule 4, and an acceptance criterion of this
   * issue). A caught-up beamer starts at the end and arms no timers at all.
   */
  it('starts at the end when the host sends a catch-up', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 6,
      settled: true,
      performanceMode: false,
    });

    expect(probe.current.step).toBe(6);
    expect(probe.current.isComplete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  /*
   * `settled` decides where a sequence *starts*, not where it jumps to.
   *
   * `beamerStore` computes it as `delivery === 'live' && !sameScene`, so every
   * commit that leaves the draw staged — a table renamed, a winner marked on
   * another round — re-delivers `DRAW` with `animate: false`. Reading that as
   * "go to the end" would cut the Auslosung short in front of the room the
   * first time anything else happened during it.
   *
   * A beamer genuinely reopened mid-draw remounts, so it sees the round for the
   * first time and starts settled — which is the case above.
   */
  it('keeps running when the same scene is re-delivered mid-draw', () => {
    const props = { roundId: round('r1'), pairings: 6, settled: false, performanceMode: false };
    const probe = mount(props);
    const schedule = drawSchedule(6, false);

    act(() => {
      vi.advanceTimersByTime(schedule[0] ?? 0);
    });
    expect(probe.current.step).toBe(1);

    act(() => {
      probe.rerender({ ...props, settled: true });
    });
    expect(probe.current.step, 'a re-delivery must not skip the draw').toBe(1);

    act(() => {
      probe.rerender({ ...props });
      vi.advanceTimersByTime((schedule[2] ?? 0) - (schedule[0] ?? 0));
    });
    expect(probe.current.step, 'and the sequence carries on').toBe(3);
  });
});

describe('a new round', () => {
  /*
   * Drawing the next round has to start its own sequence. Carrying the previous
   * round's step over would show the new round's board already complete — the
   * pairings revealed before anybody drew them.
   */
  it('restarts the sequence rather than continuing the previous one', () => {
    const props = { roundId: round('r1'), pairings: 4, settled: false, performanceMode: false };
    const probe = mount(props);

    act(() => {
      vi.advanceTimersByTime(FULL_SEQUENCE);
    });
    expect(probe.current.step).toBe(4);

    act(() => {
      probe.rerender({ ...props, roundId: round('r2') });
    });
    expect(probe.current.step).toBe(0);
    expect(probe.current.isComplete).toBe(false);
  });

  /*
   * The snapshot rebuilds its round on every commit, so the hook takes
   * primitives only. If it re-armed its timers whenever anything in the
   * tournament changed, an unrelated commit — a table renamed, a winner marked
   * elsewhere — would restart the draw from the current moment.
   */
  it('does not restart when an unrelated part of the snapshot changes', () => {
    const props = { roundId: round('r1'), pairings: 4, settled: false, performanceMode: false };
    const probe = mount(props);
    const schedule = drawSchedule(4, false);

    act(() => {
      vi.advanceTimersByTime(schedule[1] ?? 0);
    });
    expect(probe.current.step).toBe(2);

    // Same round, same everything the hook reads: a re-render must not reset it.
    act(() => {
      probe.rerender({ ...props });
    });
    act(() => {
      vi.advanceTimersByTime((schedule[2] ?? 0) - (schedule[1] ?? 0));
    });

    expect(probe.current.step).toBe(3);
  });

  it('arms no timers when there is no round', () => {
    mount({ roundId: null, pairings: 0, settled: false, performanceMode: false });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its timers when the scene goes away', () => {
    const probe = mount({
      roundId: round('r1'),
      pairings: 4,
      settled: false,
      performanceMode: false,
    });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    probe.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
