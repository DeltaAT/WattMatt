/**
 * How big a table's label is drawn on a group-round beamer scene (issue #100).
 *
 * Issue #75 took the word `Tisch` off the projector and left the number alone,
 * on the theory that a screen whose whole subject is which table to walk to
 * needs no label for it. In the room it did not hold: a bare number sitting
 * above two other bare numbers is a third number, and it was small enough that
 * the question never got as far as being ambiguous — it could not be read at
 * all. So the word comes back, the label gets a step of its own, and the
 * scene draws `table.label` verbatim rather than a number picked out of it.
 *
 * **Larger, and still subordinate.** The two group numbers stay the dominant
 * element on every card: they are the answer to "is this mine", and the table
 * is the answer to "where". Subordination is carried by three things at once
 * and not by size alone — the label is muted, it is a weight lighter, and it
 * carries a word while the numbers are bare. That is what lets the densest
 * step sit at three quarters of the numerals' size without competing with
 * them, where a bare numeral at that ratio would have been a third
 * participant.
 *
 * **One ladder, three scenes.** The `Auslosung`, the round board and the
 * `Tischbelegung` all draw the same label and must agree about how big it is —
 * they are three views of one evening and the room moves between them. Each
 * scene keeps its own density thresholds, because a grid of pairings and a
 * board of sections do not get crowded at the same count, and maps them onto
 * these steps the way they already map onto `GroupBoxScale`.
 *
 * The `Turnierbaum` deliberately does not use this (docs/STYLEGUIDE.md §4): a
 * bracket node names its table in a corner, at `beamer-caption`, and by its
 * number alone. Nothing on that node is a numeral, so there is nothing for a
 * bare number to be confused with — and the node is genuinely out of room.
 */
export type TableLabelDensity = 'roomy' | 'normal' | 'dense';

/**
 * Never `beamer-body`: 32 px is the floor a scene is designed to
 * (docs/STYLEGUIDE.md §2), and the whole complaint of issue #100 is that the
 * table sat on it. `useFitToStage` shrinks the board from here when a
 * projector has less room than the ladder assumed, so the ladder asks for what
 * the room needs rather than for what always fits.
 */
export const TABLE_TYPE: Record<TableLabelDensity, string> = {
  roomy: 'text-beamer-h2',
  normal: 'text-beamer-h3',
  dense: 'text-beamer-h3',
};
