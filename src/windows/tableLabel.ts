import { de } from '@/i18n';

/**
 * How a table is named on the **bracket**, and only there (issues #75, #100).
 *
 * The default label a table is created with is `Tisch 3` (`de.table.defaultLabel`).
 * Issue #75 took the word off every beamer scene on the theory that the number
 * alone was enough; issue #100 put it back on the three group-round scenes,
 * where a bare number sitting above two other bare numbers turned out to be a
 * third number. Those scenes now draw `table.label` verbatim, which is the word
 * and the number together and the same string the host panel shows.
 *
 * The `Turnierbaum` is the one place the short form survives, deliberately
 * (docs/STYLEGUIDE.md §4). A bracket node names its table in the top-right
 * corner of a card whose content is *names*: there is no other numeral on it
 * for a bare `3` to be confused with, so the ambiguity issue #100 fixes does
 * not arise — and the node is genuinely out of room, which is why issue #90
 * put the number at `beamer-caption` in an absolutely positioned corner in the
 * first place.
 *
 * So: the leading `Tisch` is dropped and whatever the host wrote after it is
 * kept. A table the host renamed — `Fenster`, `Bühne links`, `A` — is drawn
 * exactly as they named it, because the label is the host's own word for a
 * physical thing in the room and second-guessing it would put a name on the
 * wall that nobody in the hall uses.
 *
 * **Derived rather than stored.** A `Table` carries a label and no number
 * (`tableSchema`): `addTables` numbers them on the way in and writes the label
 * from the number, and nothing keeps the two in step afterwards — a renamed
 * table has no number any more, which is the honest answer and not a gap. So
 * the short form is read back off the label, and the day a `Table` gains a
 * number this becomes a field lookup (docs/OPEN-QUESTIONS.md #89).
 */
export function tableNumber(label: string): string {
  const word = de.table.label;
  if (!label.startsWith(word)) {
    return label;
  }

  const rest = label.slice(word.length).trim();
  // `Tisch` on its own, or `Tischtennis` — neither is a prefix with a number
  // behind it, and both are labels the host meant literally.
  return rest === '' || !label.slice(word.length).startsWith(' ') ? label : rest;
}
