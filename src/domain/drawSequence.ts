import type { Match, Round } from '@/domain/types';

/**
 * The choreography of the draw, as arithmetic (issue #18, redesigned by issue
 * #76, docs/MOTION.md §4.1).
 *
 * The signature moment of the whole app is a sequence, and a sequence is a
 * function from "how far are we" to "what is on the wall". Keeping that
 * function here rather than inside the scene component is what makes it
 * testable: the acceptance criterion "skipping mid-sequence produces a board
 * identical to letting it finish" is a statement about this module, and a test
 * for it should not have to drive a timer to ask the question.
 *
 * The scene owns *when* the step advances. This owns *what* each step shows.
 *
 * **What issue #76 took out.** The first design had a slot machine: a pool of
 * every undrawn number on screen from the start, numbers cycling in the slot
 * before each pairing landed, and a card that then slid to its table. All three
 * are gone. The pool told the room what was coming and cost the pairings the
 * width they needed; the cycling was 1.2 s per pairing of a thing that never
 * meant anything; and the slide was a card moving after the audience had
 * already read it. What is left is the one beat that carries the moment: a
 * pairing appears, half a second later the next one does.
 */

/**
 * The two numbers the sequence is made of, in milliseconds
 * (docs/MOTION.md §4.1).
 *
 * `interval` is the gap between two pairings landing — the pace of the whole
 * draw, and the one number to change if a room finds it too fast or too slow.
 * `reveal` is how long a single card takes to appear, and it exists here so a
 * test can hold the rule the issue states: **the reveal must finish well inside
 * the gap.** A reveal that overran would leave the previous card still growing
 * when the next one lands, and over 32 pairings that is a board in permanent
 * motion rather than a board being filled.
 *
 * `reveal` is duplicated from the CSS token `--dur-base` on purpose: the CSS
 * animates a card, this schedules the sequence, and `drawSequence.test.ts`
 * pins the relationship so a "just a bit slower" edit to either cannot pass.
 */
export const DRAW_BEATS = {
  interval: 500,
  /** `--dur-base`, which is the token nearest the issue's "~300 ms". */
  reveal: 240,
} as const;

/**
 * The gap when the machine or the viewer has asked for less motion.
 *
 * One number rather than the old halving factor, because the issue names it:
 * performance mode and `prefers-reduced-motion` both drop the interval to
 * ~200 ms. The reveal shortens with it — it is a CSS token, and performance
 * mode redefines the tokens (`src/styles/global.css`) — so the "finishes inside
 * the gap" rule survives the mode that exists because the machine is already
 * struggling.
 */
export const QUICK_INTERVAL = 200;

/** The gap between two pairings landing, for this window's motion setting. */
export function drawInterval(quick: boolean): number {
  return quick ? QUICK_INTERVAL : DRAW_BEATS.interval;
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

/** Whether the sequence has nothing left to reveal. */
export function isDrawComplete(round: Round, step: number): boolean {
  return step >= drawStepCount(round);
}

/**
 * When each pairing lands, measured from the start of the sequence.
 *
 * Exposed as a list rather than as a single "step every N ms" so a test can
 * assert the whole shape at once, and so the scene arms every timer against an
 * absolute offset rather than chaining one-shots that accumulate drift.
 *
 * The board starts empty: the first pairing lands one interval in, not at zero.
 * A card that was already there when the scene appeared is a card the room did
 * not watch being drawn (issue #76, "the board starts empty and fills up").
 *
 * Takes a count rather than the `Round` it came from, and that is not
 * incidental: the snapshot rebuilds its round object on every commit, so a
 * caller that scheduled against the object would tear down and re-arm every
 * timer each time anything in the tournament changed — restarting the draw
 * from the current moment, in front of the room.
 */
export function drawSchedule(pairings: number, quick: boolean): readonly number[] {
  const interval = drawInterval(quick);

  return Array.from(
    { length: Math.max(0, Math.floor(pairings)) },
    (_unused, index) => interval * (index + 1),
  );
}

/** How long the whole draw takes, which is what a host plans the evening around. */
export function drawDuration(pairings: number, quick: boolean): number {
  return drawSchedule(pairings, quick).at(-1) ?? 0;
}

function clampStep(round: Round, step: number): number {
  if (!Number.isFinite(step) || step < 0) {
    return 0;
  }
  return Math.min(Math.floor(step), drawStepCount(round));
}
