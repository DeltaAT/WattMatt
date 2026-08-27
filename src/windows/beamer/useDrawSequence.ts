import { useCallback, useEffect, useRef, useState } from 'react';

import { drawSchedule } from '@/domain/drawSequence';
import type { RoundId } from '@/domain/ids';
import { useReducedMotion } from '@/windows/beamer/reducedMotion';

/**
 * Drives the draw sequence forward (issue #18, retimed by issue #76,
 * docs/MOTION.md §4.1).
 *
 * What each step *shows* is `@/domain/drawSequence`'s. This owns only when the
 * step advances, which is the part that needs a timer and therefore cannot be
 * pure.
 *
 * Three ways the sequence can reach its end, and all three must land on the
 * same picture — the issue's "pixel-identical" criterion:
 *
 *  - it ran to completion;
 *  - somebody skipped it with `Space`;
 *  - the beamer was reopened mid-draw and caught up, so it starts at the end.
 *
 * The last is why `settled` is an input rather than something this decides:
 * replaying the draw because the projector was replugged would show the room a
 * draw that is not happening (CLAUDE.md golden rule 4).
 *
 * Every input here is a primitive. The snapshot builds a fresh round object on
 * every commit, so a hook that depended on the object would re-arm its timers —
 * and so restart the draw from the current moment — each time anything at all
 * changed in the tournament.
 */

export interface DrawSequence {
  /** How many pairings have been revealed. */
  step: number;
  /** True once every pairing is out, however the sequence got there. */
  isComplete: boolean;
  /**
   * True when this window never played the sequence — it arrived after the
   * draw and went straight to the board.
   *
   * This, and not `isComplete`, is what the scene renders as settled. A
   * sequence that has just finished is complete but *was* played, and its last
   * pairing still owes the room its reveal; suppressing animation the instant
   * the final beat landed would make that one card pop in without it.
   */
  startedSettled: boolean;
  /** Jump to the fully drawn board. Safe to call when already complete. */
  skip: () => void;
}

export function useDrawSequence({
  roundId,
  pairings,
  settled,
  performanceMode,
}: {
  /** Null while the snapshot carries no round to draw. */
  roundId: RoundId | null;
  pairings: number;
  /** True when the host sent this as a catch-up: start at the end. */
  settled: boolean;
  performanceMode: boolean;
}): DrawSequence {
  /*
   * Both shortcuts land on the same pace (issue #76): the host's decision about
   * a weak projector, and the machine's own setting. Read here rather than left
   * to the CSS, because the interval is a timer and no media query can shorten
   * one — and a sequence still pacing itself at 500 ms while its reveals run at
   * half speed is a board that spends most of every gap doing nothing.
   */
  const reducedMotion = useReducedMotion();
  const quick = performanceMode || reducedMotion;
  const [progress, setProgress] = useState<{ roundId: RoundId | null; step: number }>(() => ({
    roundId,
    step: settled ? pairings : 0,
  }));

  /**
   * Whether *this round* was already settled when this window first saw it.
   *
   * `settled` decides where a sequence starts, never where it jumps to, and the
   * difference matters because `beamerStore` computes it as
   * `delivery === 'live' && !sameScene`. Every commit that leaves the draw
   * staged — a table renamed, a winner marked elsewhere — therefore re-delivers
   * `DRAW` with it false. Reading the live value would cut the Auslosung short
   * the first time anything else happened during it, and re-arming the timers
   * around it would replay beats the room has already watched.
   *
   * A beamer genuinely reopened mid-draw remounts, so it sees the round for the
   * first time and starts at the end, which is the case this preserves.
   */
  const start = useRef<{ roundId: RoundId | null; settled: boolean }>({ roundId, settled });
  if (start.current.roundId !== roundId) {
    start.current = { roundId, settled };
  }
  const startedSettled = start.current.settled;

  // Derived rather than reset in an effect: drawing the *next* round has to
  // start its own sequence in the same render the new round arrives in, or the
  // room sees one frame of the previous round's finished board.
  const step =
    progress.roundId === roundId
      ? Math.min(progress.step, pairings)
      : startedSettled
        ? pairings
        : 0;

  const advanceTo = useCallback(
    (next: number) => {
      setProgress((previous) =>
        previous.roundId === roundId
          ? // Never backwards. A timer that fires after a skip would otherwise
            // rewind the board in front of the audience.
            { roundId, step: Math.max(previous.step, next) }
          : { roundId, step: next },
      );
    },
    [roundId],
  );

  const skip = useCallback(() => advanceTo(pairings), [advanceTo, pairings]);

  useEffect(() => {
    if (roundId === null || startedSettled) {
      return;
    }

    // The whole sequence is armed at once, against absolute offsets from now.
    // A chain of one-shot timers would accumulate the drift of every step, and
    // over 32 pairings that is visible against the host's own screen.
    //
    // Every dependency here is stable for the life of a round, so the timers
    // are armed once and never re-armed — re-arming would restart the schedule
    // from the current moment and replay pairings already on the wall.
    const timers = drawSchedule(pairings, quick).map((at, index) =>
      setTimeout(() => advanceTo(index + 1), at),
    );

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
    };
  }, [roundId, pairings, startedSettled, quick, advanceTo]);

  return { step, isComplete: step >= pairings, startedSettled, skip };
}
