import type { GroupId } from '@/domain/ids';
import type { Group, Match, Round } from '@/domain/types';

/**
 * The choreography of the draw, as arithmetic (issue #18, docs/MOTION.md §4.1).
 *
 * The signature moment of the whole app is a sequence, and a sequence is a
 * function from "how far are we" to "what is on the wall". Keeping that
 * function here rather than inside the scene component is what makes it
 * testable: the acceptance criterion "skipping mid-sequence leaves a correct,
 * complete board" is a statement about this module, and a test for it should
 * not have to drive a timer to ask the question.
 *
 * The scene owns *when* the step advances. This owns *what* each step shows.
 */

/**
 * The beat table of docs/MOTION.md §4.1, in milliseconds.
 *
 * `anticipation` runs once, before the first pairing. The other three run per
 * pairing and sum to 2100 ms, inside the 3 s per-pairing ceiling the issue
 * sets. They are duplicated from the CSS duration tokens on purpose: the CSS
 * animates a card, this schedules the sequence, and a scene where the two
 * disagree stalls with a card half-revealed. `drawSequence.test.ts` pins the
 * sum against the ceiling so a "just a bit slower" edit cannot pass.
 */
export const DRAW_BEATS = {
  anticipation: 600,
  shuffle: 1200,
  reveal: 500,
  placement: 400,
} as const;

/** One pairing, from the shuffle starting to the card reaching its table. */
export const PAIRING_DURATION = DRAW_BEATS.shuffle + DRAW_BEATS.reveal + DRAW_BEATS.placement;

/** docs/MOTION.md §4.1: "Maximum 3 s per pairing." */
export const PAIRING_CEILING = 3000;

/**
 * Performance mode halves every duration (docs/MOTION.md §6), matching what
 * `src/styles/global.css` does to the CSS tokens under
 * `[data-performance-mode='true']`. The JS timeline and the CSS have to scale
 * by the same factor or they drift apart in exactly the mode that exists
 * because the machine is already struggling.
 */
export const PERFORMANCE_FACTOR = 0.5;

export function beatDuration(beat: keyof typeof DRAW_BEATS, performanceMode: boolean): number {
  return DRAW_BEATS[beat] * (performanceMode ? PERFORMANCE_FACTOR : 1);
}

/**
 * How many pairings the sequence reveals.
 *
 * Every match is a step, byes included: a `Freilos` is drawn like any other
 * pairing and the audience has to see it happen, or the group that advanced
 * without playing looks like an error rather than a rule
 * (docs/TOURNAMENT-RULES.md §9 case 1).
 */
export function drawStepCount(round: Round): number {
  return round.matches.length;
}

/**
 * The pairings revealed once `step` beats have completed.
 *
 * `step` is clamped, so the settled board and an over-run timer are the same
 * picture — which is what makes the skip and the natural end pixel-identical.
 */
export function revealedMatches(round: Round, step: number): readonly Match[] {
  return round.matches.slice(0, clampStep(round, step));
}

/**
 * The numbers still in the pool grid, in the order they are drawn on screen.
 *
 * **Sorted by participant number, never by draw order.** The pool is on the
 * wall from the anticipation beat onward, so laying it out in the order the
 * matches happen to sit in would let anyone watching read the next pairing off
 * the grid before it is drawn. Sorting by number makes the grid say nothing
 * about what is coming, and it is also the order the room already knows the
 * field in (docs/TOURNAMENT-RULES.md §0).
 *
 * A group that is not in any of this round's matches is not in the pool: the
 * grid shows who is being drawn, not who exists.
 */
export function drawPool(round: Round, groups: readonly Group[], step: number): readonly Group[] {
  const drawn = new Set<GroupId>();
  for (const match of revealedMatches(round, step)) {
    drawn.add(match.a);
    if (match.b !== null) {
      drawn.add(match.b);
    }
  }

  const playing = participantsOf(round);
  return groups
    .filter((group) => playing.has(group.id) && !drawn.has(group.id))
    .sort((a, b) => a.number - b.number);
}

/** Every group id this round draws, byes included. */
export function participantsOf(round: Round): ReadonlySet<GroupId> {
  const ids = new Set<GroupId>();
  for (const match of round.matches) {
    ids.add(match.a);
    if (match.b !== null) {
      ids.add(match.b);
    }
  }
  return ids;
}

/** Whether the sequence has nothing left to reveal. */
export function isDrawComplete(round: Round, step: number): boolean {
  return step >= drawStepCount(round);
}

/**
 * When each pairing lands, measured from the start of the sequence.
 *
 * Exposed as a list rather than as a single "step every N ms" so a test can
 * assert the whole shape at once, and so the anticipation beat is visible in
 * the schedule instead of hidden in an offset the scene applies by hand.
 *
 * Takes a count rather than the `Round` it came from, and that is not
 * incidental: the snapshot rebuilds its round object on every commit, so a
 * caller that scheduled against the object would tear down and re-arm every
 * timer each time anything in the tournament changed — restarting the draw
 * from the current moment, in front of the room.
 */
export function drawSchedule(pairings: number, performanceMode: boolean): readonly number[] {
  const anticipation = beatDuration('anticipation', performanceMode);
  const perPairing =
    beatDuration('shuffle', performanceMode) +
    beatDuration('reveal', performanceMode) +
    beatDuration('placement', performanceMode);

  return Array.from(
    { length: Math.max(0, Math.floor(pairings)) },
    (_, index) => anticipation + perPairing * (index + 1),
  );
}

function clampStep(round: Round, step: number): number {
  if (!Number.isFinite(step) || step < 0) {
    return 0;
  }
  return Math.min(Math.floor(step), drawStepCount(round));
}
