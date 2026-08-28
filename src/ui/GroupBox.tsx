/**
 * A participant's number, in a box of its own (issue #88).
 *
 * The identity element of every group-round scene on the projector. Two numbers
 * sitting in one line of text read as one number from ten metres — `7 12` is
 * `712` to anybody who has not been told otherwise — so a number is never drawn
 * as loose text on the beamer again. It gets a container, and the container is
 * this one everywhere.
 *
 * **One component, three states.** The box is neutral while the pairing is only
 * drawn, and turns green or red when the result lands (issue #77). That is the
 * whole reason it is a component rather than a class string copied into two
 * scenes: the box a group sits in during the `Auslosung` is literally the same
 * box that turns over on the round board twenty seconds later, so there is no
 * discontinuity between the two pictures — no change of size, of padding, of
 * radius, or of where the number sits inside it.
 *
 * **What each state is allowed to change, and what it may not.** Only colour,
 * the icon and the winner's inset ring differ between the three. Geometry is
 * identical in all of them, and that is load-bearing twice over: issue #77's
 * one hard requirement is that nothing moves when a result comes in, and issue
 * #88's is that the draw and the board show the same object. A future state
 * that added a pixel of border or a word beside the number would break both.
 *
 * **Why the signals are what they are** (docs/STYLEGUIDE.md §1): roughly 8 % of
 * men have a red–green deficiency and a projector in a lit room flattens hue
 * for everybody, so a win/lose pair must differ in at least two properties, one
 * of them not hue. Here that is luminance (the loser's dimming, measured in
 * `src/styles/resultContrast.test.ts`), geometry (`wm-result-ring` is the
 * winner's extra 4 px, drawn inward so it costs no layout) and the `✓` / `✗`
 * glyph. The digits themselves are `--wm-text` in every state — the box is
 * coloured, never the number.
 */

/**
 * How big the box is drawn, named for the type step its number takes.
 *
 * Three steps, matching the three densities both group-round scenes already
 * ladder through. Each scene keeps its own thresholds — a board of sections and
 * a grid of pairings do not get crowded at the same count — and maps them onto
 * these, so the two agree about what a `hero` box looks like without agreeing
 * about when to use one.
 */
export type GroupBoxScale = 'hero' | 'h1' | 'h2';

/**
 * What has happened to this participant.
 *
 * `NEUTRAL` is both "not drawn against anybody yet" and "playing, undecided" —
 * one state rather than two, because they look the same and must: the room
 * should see nothing change at the moment a drawn pairing becomes a running
 * match.
 */
export type GroupBoxState = 'NEUTRAL' | 'WINNER' | 'LOSER';

export function GroupBox({
  number,
  state,
  scale,
  flip = false,
}: {
  /** The bare number, `groupNumber` in `@/windows/groupLabel`. */
  number: string;
  state: GroupBoxState;
  scale: GroupBoxScale;
  /**
   * True only for a result the window has just watched land (issue #29).
   *
   * The flip belongs to the moment a result is decided, not to the state of
   * being decided: a beamer that is merely catching up carries every settled
   * colour without replaying an hour of the evening. So the colours live in
   * `STATE_BOX` and only the animation is behind this flag.
   */
  flip?: boolean;
}) {
  return (
    <span
      // 2 px of border in every state, and never more: the winner's extra 4 px
      // are drawn inward by `wm-result-ring`, so the box is exactly the same
      // size decided and undecided. A border that grew when a result landed
      // would move every card on the row.
      className={`flex min-w-0 items-baseline justify-center border-[2px] ${BOX[scale]} ${
        STATE_BOX[state]
      } ${state === 'NEUTRAL' || !flip ? '' : STATE_ANIMATION[state]}`}
      data-outcome={state}
    >
      {/*
       * A fixed box, so `✓` → `✗` cannot nudge the number sideways. The two
       * glyphs have different advance widths, and nothing may move when a
       * result lands — inside the box as much as outside it.
       */}
      <span
        aria-hidden="true"
        className={`w-[1.2em] shrink-0 text-center font-bold ${ICON_TYPE[scale]}`}
        data-outcome-icon=""
      >
        {STATE_ICON[state]}
      </span>

      {/*
       * `min-w-[2ch]` is the issue's "single- and double-digit numbers look like
       * peers" criterion, and it is why the width is set here rather than on the
       * box: `ch` is the advance of a digit in the font the numeral is actually
       * drawn in, so a `7` reserves exactly the room a `12` needs and the two
       * boxes come out the same size. A minimum rather than a fixed width, so a
       * three-digit field grows instead of clipping.
       */}
      <span
        className={`wm-display wm-tnum min-w-[2ch] text-center font-extrabold ${NUMBER_TYPE[scale]}`}
        data-group-number=""
      >
        {number}
      </span>

      {/*
       * The empty half of the glyph slot (issue #100).
       *
       * `justify-center` centres the *row*, which is the icon, the gap and the
       * number — so the numeral itself sat half a glyph to the right of the
       * box's middle, and a box stretched to the width of a match card sat a
       * long way right of it. `text-align: center` was true and the picture was
       * still off-centre, which is the whole of the issue's "centre on the
       * numeral, not on the text box".
       *
       * So the slot is mirrored: the same width and the same gap on the other
       * side, empty. The numeral is then centred on the box's axis in every
       * state, and the geometry is still identical across the three — both
       * slots are reserved whether or not there is a glyph to put in one.
       */}
      <span
        aria-hidden="true"
        className={`w-[1.2em] shrink-0 ${ICON_TYPE[scale]}`}
        data-outcome-balance=""
      />
    </span>
  );
}

/**
 * Filled shapes, not thin outlines — a hairline glyph dies on a projector.
 *
 * `NEUTRAL` draws nothing at all (issue #100). It used to draw a `·`, and on a
 * pairing that put a dot squarely in the gap between the two numbers — `7 · 12`
 * — which is the one place issue #88 wanted empty, because a mark between two
 * numerals is what makes them read as one string again. The slot is still
 * reserved, so a result landing still moves nothing; it is simply blank until
 * there is a result to report.
 */
const STATE_ICON: Record<GroupBoxState, string> = {
  NEUTRAL: '',
  WINNER: '✓',
  LOSER: '✗',
};

/**
 * The three states, in colour and in the two things that are not colour.
 *
 * `text-wm-text` throughout: a number is exactly as readable when its match is
 * lost as when it is won. `wm-result-ring` is applied here rather than in the
 * animation so a beamer that is merely catching up wears it too (golden rule 4)
 * — it is the signal that survives greyscale.
 */
const STATE_BOX: Record<GroupBoxState, string> = {
  NEUTRAL: 'border-wm-border-strong bg-wm-bg-elevated text-wm-text',
  WINNER: 'wm-result-ring border-wm-win bg-wm-win-bg text-wm-text',
  LOSER: 'border-wm-lose bg-wm-lose-bg text-wm-text opacity-60 saturate-50',
};

const STATE_ANIMATION: Record<Exclude<GroupBoxState, 'NEUTRAL'>, string> = {
  WINNER: 'wm-result-win',
  LOSER: 'wm-result-lose',
};

/**
 * Padding, radius and the gap to the icon, per step.
 *
 * The padding grows with the number, which is the issue's "a two-digit number
 * does not touch its border": 16 px beside a 160 px numeral is a rim, not a
 * margin. Radii are the `--wm-radius` tokens of docs/STYLEGUIDE.md §3 and the
 * padding lands on its 8 px grid.
 */
const BOX: Record<GroupBoxScale, string> = {
  hero: 'gap-4 rounded-wm-xl px-8 py-3',
  h1: 'gap-3 rounded-wm-xl px-6 py-2',
  h2: 'gap-3 rounded-wm-lg px-4 py-2',
};

const NUMBER_TYPE: Record<GroupBoxScale, string> = {
  hero: 'text-beamer-hero',
  h1: 'text-beamer-h1',
  h2: 'text-beamer-h2',
};

/**
 * The glyph is deliberately much smaller than the number it sits beside.
 *
 * It is a signal, not a second thing to read, and at the numeral's own size it
 * would take width the digits could have had. Never below `text-beamer-body`
 * all the same — 32 px is the floor for anything on the projector
 * (docs/STYLEGUIDE.md §2).
 */
const ICON_TYPE: Record<GroupBoxScale, string> = {
  hero: 'text-beamer-h3',
  h1: 'text-beamer-body',
  h2: 'text-beamer-body',
};
