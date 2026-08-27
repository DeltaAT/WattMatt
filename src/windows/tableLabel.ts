import { de } from '@/i18n';

/**
 * How a table is named on the **beamer** (issue #75).
 *
 * The default label a table is created with is `Tisch 3` (`de.table.defaultLabel`),
 * and on the projector the word is the same noise the participant label was:
 * one match card carries it once, thirty-two carry it thirty-two times, and it
 * is the width the numbers could have had. The number alone is unambiguous on a
 * screen whose whole subject is which table to walk to.
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
