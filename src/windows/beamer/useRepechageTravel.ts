import { useCallback, useEffect, useMemo, useState } from 'react';

import type { GroupId } from '@/domain/ids';
import { travelPath } from '@/domain/repechageTravel';
import { createRng } from '@/domain/rng';
import { useReducedMotion } from '@/windows/beamer/reducedMotion';

/**
 * Drives the travelling highlight of the `Hoffnungsrunde` draw (issue #89,
 * docs/MOTION.md §4.3).
 *
 * Where the light goes is `@/domain/repechageTravel`'s. This owns only when it
 * moves, which is the part that needs timers and therefore cannot be pure.
 *
 * **The candidate is already drawn before any of this runs.** The snapshot
 * arrives with one pot entry at `DRAWN`, decided by the tournament's own seeded
 * stream — so the animation cannot influence the result, and the draw stays
 * reproducible from `(seed, cursor)` (issue #8). What this adds is that the
 * room does not get to *see* the answer until the light stops: while the travel
 * runs, the drawn card is reported as `pending` and the scene paints it exactly
 * like the rest of the pot. A scene that lifted it on arrival would show the
 * winner two seconds before the highlight got there, which is the whole failure
 * this issue exists to fix.
 *
 * The path's randomness comes from a **presentation** generator, seeded per
 * draw and thrown away. Not `Math.random()`, which golden rule 7 bans outright,
 * and deliberately not the tournament's `Rng`: consuming from that stream would
 * shift the cursor and change every pairing drawn afterwards.
 *
 * Three ways the travel can end, and all three land on the same picture:
 *
 *  - it ran its course;
 *  - the host skipped it with `Space`;
 *  - it never started, because the beamer caught up mid-phase, the field is too
 *    small to travel across, or this window has been asked to hold still.
 */

export interface RepechageTravel {
  /** The card the light is on right now, or null when nothing is travelling. */
  highlight: GroupId | null;
  /**
   * The drawn candidate whose reveal has not landed yet.
   *
   * The scene renders this card as though it were still in the pool — same
   * colours, same word, no lift. Null the instant the light arrives, which is
   * when the card becomes the drawn candidate in the picture as well as in the
   * snapshot.
   */
  pending: GroupId | null;
  /** True while the light is still moving. */
  isTravelling: boolean;
  /** Land immediately. Safe to call when nothing is travelling. */
  skip: () => void;
}

export function useRepechageTravel({
  drawn,
  candidates,
  performanceMode,
}: {
  /**
   * The candidate this window watched being drawn, or null.
   *
   * Null covers every case that must not animate: no draw, an accept or a
   * decline rather than a draw, and a beamer that arrived to find the candidate
   * already on the wall (`useRepechageBeat`, golden rule 4).
   */
  drawn: GroupId | null;
  /** The cards the light may visit: everybody still in the pot, drawn included. */
  candidates: readonly GroupId[];
  performanceMode: boolean;
}): RepechageTravel {
  /*
   * Both shortcuts remove the travel rather than shortening it, and that is the
   * issue's instruction: "skip the travel, reveal the candidate directly with a
   * colour and opacity change". A quick version of a lottery machine is not a
   * cheaper effect, it is a flicker — and reduced motion exists precisely to
   * stop a light jumping around a screen at 80 ms.
   */
  const reducedMotion = useReducedMotion();
  const quick = performanceMode || reducedMotion;

  const count = candidates.length;
  const target = drawn === null ? -1 : candidates.indexOf(drawn);

  /*
   * Rebuilt only when the draw itself changes. Every dependency is a primitive
   * on purpose: the snapshot rebuilds its pot array on every commit, so a memo
   * that depended on the list would redraw the path — and re-arm every timer,
   * restarting the travel from the current moment — each time anything at all
   * changed in the tournament.
   *
   * The seed is the candidate and the field size, so one draw has one path
   * however many times this window re-renders during it.
   */
  const path = useMemo(
    () =>
      drawn === null || quick
        ? []
        : travelPath(count, target, createRng(`${drawn}:${String(count)}`)),
    [drawn, count, target, quick],
  );

  const [progress, setProgress] = useState<{ drawn: GroupId | null; hop: number }>(() => ({
    drawn,
    hop: 0,
  }));

  // Derived rather than reset in an effect: the next candidate has to start
  // their own travel in the render their draw arrives in, or the room sees a
  // frame of the previous candidate still lit.
  const hop = progress.drawn === drawn ? progress.hop : 0;
  const landed = hop >= path.length - 1;

  const advanceTo = useCallback(
    (next: number) => {
      setProgress((previous) =>
        previous.drawn === drawn
          ? // Never backwards. A timer that fires after a skip would otherwise
            // send the light back out across the pot in front of the room.
            { drawn, hop: Math.max(previous.hop, next) }
          : { drawn, hop: next },
      );
    },
    [drawn],
  );

  const skip = useCallback(() => advanceTo(path.length), [advanceTo, path.length]);

  useEffect(() => {
    if (path.length === 0) {
      return;
    }

    // Armed against absolute offsets from now, like the draw's schedule: a
    // chain of one-shots would accumulate the drift of every hop, and the last
    // dwell is the one the room is watching most closely.
    const timers = path
      .slice(1)
      .map((step, index) => setTimeout(() => advanceTo(index + 1), step.at));

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [path, advanceTo]);

  if (path.length === 0 || landed) {
    return { highlight: null, pending: null, isTravelling: false, skip };
  }

  return {
    highlight: candidates[path[hop]?.index ?? -1] ?? null,
    pending: drawn,
    isTravelling: true,
    skip,
  };
}

/** What the scene renders when no travel is running — a plain, landed picture. */
export const NO_TRAVEL: RepechageTravel = {
  highlight: null,
  pending: null,
  isTravelling: false,
  skip: () => undefined,
};
