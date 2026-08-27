// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { groupIdSchema, type GroupId } from '@/domain/ids';
import { travelPath, TRAVEL_BEATS } from '@/domain/repechageTravel';
import { createRng } from '@/domain/rng';
import { useRepechageTravel, type RepechageTravel } from '@/windows/beamer/useRepechageTravel';

/**
 * The timing of the travelling highlight (issue #89).
 *
 * *Where* the light goes is `repechageTravel.test.ts`'s. This is only about
 * when it moves and, more importantly, about what the room is allowed to see
 * while it does: the snapshot has carried the answer since before the first
 * frame, and every test below is a way of asking whether it leaks.
 */

/**
 * jsdom has no `matchMedia`, and the hook reads it: an unstubbed run counts as
 * "animate", which is the accessible default (`reducedMotion.ts`).
 */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
}

const id = (value: string): GroupId => groupIdSchema.parse(value);

/** A pot of `count` cards, `g1` … `gN`. */
const pot = (count: number): GroupId[] =>
  Array.from({ length: count }, (_unused, index) => id(`g${String(index + 1)}`));

/** Renders the hook and hands back a live handle on its latest value. */
function mount(props: Parameters<typeof useRepechageTravel>[0]) {
  const seen: RepechageTravel[] = [];

  function Probe(inner: Parameters<typeof useRepechageTravel>[0]) {
    seen.push(useRepechageTravel(inner));
    return null;
  }

  const view = render(<Probe {...props} />);
  return {
    get current(): RepechageTravel {
      const latest = seen.at(-1);
      if (latest === undefined) {
        throw new Error('the hook never rendered');
      }
      return latest;
    },
    /** Every value the hook has produced, in order. */
    get all(): readonly RepechageTravel[] {
      return seen;
    },
    rerender: (next: Parameters<typeof useRepechageTravel>[0]) =>
      view.rerender(<Probe {...next} />),
    unmount: view.unmount,
  };
}

/** The path the hook will build for this draw — same seed, same arithmetic. */
const pathFor = (drawn: string, candidates: readonly GroupId[]) =>
  travelPath(
    candidates.length,
    candidates.indexOf(id(drawn)),
    createRng(`${drawn}:${String(candidates.length)}`),
  );

const CANDIDATES = pot(12);
const DRAWN = 'g5';

beforeEach(() => {
  vi.useFakeTimers();
  stubReducedMotion(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a candidate being drawn', () => {
  it('lights a card the moment the draw arrives', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    expect(probe.current.isTravelling).toBe(true);
    expect(probe.current.highlight).not.toBeNull();
  });

  /*
   * The failure this whole issue exists to prevent, and the one an
   * implementation gets wrong by doing nothing: the snapshot says `DRAWN` from
   * the first frame, so a scene that simply rendered it would lift the winner
   * two seconds before the light arrived.
   */
  it('holds the answer back until the light lands', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });
    const path = pathFor(DRAWN, CANDIDATES);

    expect(probe.current.pending).toBe(id(DRAWN));

    act(() => {
      vi.advanceTimersByTime((path.at(-1)?.at ?? 0) - 1);
    });

    expect(probe.current.pending, 'still pending one millisecond out').toBe(id(DRAWN));
    expect(probe.current.highlight).not.toBe(id(DRAWN));

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(probe.current.pending).toBeNull();
    expect(probe.current.isTravelling).toBe(false);
  });

  /* Never a pass over the answer, which is a tell the second time the room
   * sees the scene. Asserted over every value the hook actually produced. */
  it('never lights the drawn card before it lands', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    for (const value of probe.all) {
      if (value.isTravelling) {
        expect(value.highlight).not.toBe(id(DRAWN));
      }
    }
  });

  /*
   * Every hop of the path, walked one dwell at a time. The light must be on the
   * card the domain chose at each point — a hook that armed its timers against
   * the wrong offsets would still look plausible and would land early.
   */
  it('follows the path the domain drew, hop by hop', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });
    const path = pathFor(DRAWN, CANDIDATES);

    let elapsed = 0;
    for (const [index, hop] of path.entries()) {
      act(() => {
        vi.advanceTimersByTime(hop.at - elapsed);
      });
      elapsed = hop.at;

      if (index === path.length - 1) {
        // The landing is not a highlight: the card becomes the drawn candidate.
        expect(probe.current.highlight).toBeNull();
        expect(probe.current.pending).toBeNull();
      } else {
        expect(probe.current.highlight, `hop ${String(index)}`).toBe(CANDIDATES[hop.index]);
      }
    }
  });
});

describe('landing early', () => {
  /* `Space` skips straight to the landed state (the issue, docs/MOTION.md §1
   * law 2). It must be the same picture the travel would have reached. */
  it('skips to the landed state', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    act(() => {
      vi.advanceTimersByTime(TRAVEL_BEATS.first);
      probe.current.skip();
    });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
    expect(probe.current.highlight).toBeNull();
  });

  it('does not send the light back out after a skip', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    act(() => {
      probe.current.skip();
      vi.advanceTimersByTime(5000);
    });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.highlight).toBeNull();
  });
});

describe('a window that must not animate', () => {
  /*
   * "Performance mode / reduced motion: skip the travel, reveal the candidate
   * directly." Not a faster travel — a light jumping around a screen at 80 ms
   * is exactly what the setting exists to stop.
   */
  it('reveals the candidate directly in performance mode', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: true });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
    expect(probe.current.highlight).toBeNull();
  });

  it('reveals the candidate directly under reduced motion', () => {
    stubReducedMotion(true);
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
  });
});

describe('nothing to travel for', () => {
  /*
   * A beamer reopened mid-phase, and an accept or a decline. Both arrive with
   * `drawn` null — the first because `useRepechageBeat` refuses to animate a
   * catch-up (golden rule 4), the second because an answer is not a draw.
   */
  it('travels for no draw at all', () => {
    const probe = mount({ drawn: null, candidates: CANDIDATES, performanceMode: false });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
  });

  /* "With 2 candidates the travel is meaningless, so fall back to a short
   * direct reveal." An empty path is that fallback. */
  it('reveals directly when the pot is too small to travel across', () => {
    const two = pot(2);
    const probe = mount({ drawn: two[0] ?? null, candidates: two, performanceMode: false });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
  });

  it('reveals directly when the drawn card is not in the pot', () => {
    const probe = mount({ drawn: id('gone'), candidates: CANDIDATES, performanceMode: false });

    expect(probe.current.isTravelling).toBe(false);
    expect(probe.current.pending).toBeNull();
  });
});

describe('the travel across re-renders', () => {
  /*
   * The snapshot rebuilds its pot on every commit — a table renamed, the host's
   * own panel redrawing — and a hook that re-armed its timers on the array
   * would restart the travel from the current moment, in front of the room.
   */
  it('does not restart when an unrelated commit re-renders the scene', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });
    const path = pathFor(DRAWN, CANDIDATES);
    const landing = path.at(-1)?.at ?? 0;

    act(() => {
      vi.advanceTimersByTime(landing - TRAVEL_BEATS.last);
    });
    // A fresh array with the same ids, as the snapshot hands over.
    probe.rerender({ drawn: id(DRAWN), candidates: [...CANDIDATES], performanceMode: false });

    act(() => {
      vi.advanceTimersByTime(TRAVEL_BEATS.last);
    });

    expect(probe.current.isTravelling, 'landed on time').toBe(false);
  });

  /* The next candidate starts their own travel in the render their draw
   * arrives in, or the room sees a frame of the previous one still lit. */
  it('starts again for the next candidate', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(probe.current.isTravelling).toBe(false);

    probe.rerender({ drawn: id('g9'), candidates: CANDIDATES, performanceMode: false });

    expect(probe.current.isTravelling).toBe(true);
    expect(probe.current.pending).toBe(id('g9'));
  });

  it('drops its timers when the window closes', () => {
    const probe = mount({ drawn: id(DRAWN), candidates: CANDIDATES, performanceMode: false });

    probe.unmount();

    expect(() => {
      vi.advanceTimersByTime(5000);
    }).not.toThrow();
  });
});
