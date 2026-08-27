import { MAX_GROUP_NAME_LENGTH } from '@/domain/naming';

/**
 * How a long name is fitted onto the projector (issue #23).
 *
 * The strategy is decided here rather than left to whichever scene meets the
 * first forty-character team: **step the type down to the floor, then let the
 * ellipsis take over.** Both halves matter. A name that shrank without a floor
 * would eventually be unreadable from the back of the room while looking
 * perfectly fine on the host's laptop; a name that was only ever truncated
 * would lose its ending at 64 px while there was room to spare two steps down.
 *
 * The default floor is `text-beamer-body`, the 32 px of docs/STYLEGUIDE.md §2,
 * and it is where the two numbers meet: `MAX_GROUP_NAME_LENGTH` is chosen so
 * the longest name a host can enter still fits one card line there. So a legal
 * name never reaches the ellipsis, and the ellipsis is what covers a longer
 * one — a file repaired by hand, or a limit some future issue raises without
 * coming back here.
 *
 * A scene that gives a name more than one card line's worth of room says so
 * (`lines`), and one that refuses to go all the way down to 32 px raises its
 * own floor (`floor`). The podium is both: the `Siegerehrung` gives each name
 * a whole column over two lines and stops at 64 px, because a winner's name
 * printed at body size is not a winner's name (issue #86).
 *
 * This is only the *name's own* step. How much type a scene gives a card in the
 * first place is its density ladder, and how much the whole board is shrunk to
 * reach the stage is `useFitToStage`. The three compose: the ladder picks the
 * base, this steps it down for one long name so the card does not have to grow,
 * and the fit takes the board down as a whole.
 */

/**
 * The type steps a name is ever drawn at (docs/STYLEGUIDE.md §2).
 *
 * The Tailwind class itself rather than an abstract name, because that is what
 * the scenes' density ladders already hold and a second vocabulary between them
 * would only need translating back.
 */
export type NameType =
  'text-beamer-hero' | 'text-beamer-h1' | 'text-beamer-h2' | 'text-beamer-h3' | 'text-beamer-body';

/**
 * How many characters fit one line at each step.
 *
 * Derived from the floor rather than measured per step: the budget is inversely
 * proportional to the type size, so 40 characters at 32 px is 40 × 32/48 at
 * 48 px and 40 × 32/64 at 64 px. Approximate by nature — the glyphs are
 * proportional — and deliberately generous at the top, because stepping a
 * seventeen-character name down a size costs nothing and cutting one off costs
 * the room a participant's name.
 */
export const NAME_BUDGET: Record<NameType, number> = {
  'text-beamer-hero': Math.floor((MAX_GROUP_NAME_LENGTH * 32) / 160),
  'text-beamer-h1': Math.floor((MAX_GROUP_NAME_LENGTH * 32) / 96),
  'text-beamer-h2': Math.floor((MAX_GROUP_NAME_LENGTH * 32) / 64),
  'text-beamer-h3': Math.floor((MAX_GROUP_NAME_LENGTH * 32) / 48),
  'text-beamer-body': MAX_GROUP_NAME_LENGTH,
};

/** The steps in the order they are given up, largest first. */
const LADDER: readonly NameType[] = [
  'text-beamer-hero',
  'text-beamer-h1',
  'text-beamer-h2',
  'text-beamer-h3',
  'text-beamer-body',
];

/** What a scene may say about the room it is giving the name. */
export type NameFit = {
  /**
   * The smallest step this scene will draw the name at, `text-beamer-body` by
   * default.
   *
   * Raised by a scene where a name *is* the picture rather than a label on a
   * card: below its floor the name would still be legible on the host's laptop
   * and gone from the back of the room, which for the `Siegerehrung` is the
   * whole point of the scene (issue #86).
   */
  floor?: NameType;
  /**
   * How many lines the name may take, 1 by default.
   *
   * A card gets one line because the card is a row in a board and a second line
   * would push the rows below it off the stage. A podium column gets two,
   * because the column is as tall as the name needs and nothing sits under it —
   * but never three: at that point the name is a paragraph and the block it
   * stands on has stopped reading as a podium (issue #86).
   */
  lines?: number;
};

/**
 * The step a name should actually be drawn at, given the one its scene offers.
 *
 * Never steps *up*: a scene that has decided its cards are dense means it, and
 * a short name inflating to 64 px in a grid of 32 px ones would read as an
 * emphasis nobody intended.
 *
 * The text passed in is the whole line as the audience reads it — a pairing is
 * two names and the word between them, and stepping down for the longer of the
 * two alone would still overflow.
 */
export function fitNameType(text: string, base: NameType, fit: NameFit = {}): NameType {
  const floor = fit.floor ?? 'text-beamer-body';
  const lines = Math.max(1, fit.lines ?? 1);

  // From the step the scene offered down to its floor. Both are one of the
  // steps by their type, so the slice is never the whole ladder by accident —
  // and a floor above the base leaves the base, because a scene may not be
  // talked into a bigger name than it asked for.
  const from = LADDER.indexOf(base);
  const to = Math.max(from, LADDER.indexOf(floor));
  for (const candidate of LADDER.slice(from, to + 1)) {
    if (text.length <= NAME_BUDGET[candidate] * lines) {
      return candidate;
    }
  }

  // Longer than the floor holds. Drawn at the floor and cut with an ellipsis by
  // the element itself — never smaller, because a name below its scene's floor
  // is one the back of the room cannot read at all.
  return LADDER[to] ?? 'text-beamer-body';
}
