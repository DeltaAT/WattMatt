import type { GroupId } from '@/domain/ids';
import * as naming from '@/domain/naming';
import { de } from '@/i18n';
import type { TournamentStore } from '@/store/tournamentStore';

/**
 * Entering and correcting the names of the remaining participants (issue #23,
 * docs/TOURNAMENT-RULES.md §6).
 *
 * The rules are `@/domain/naming`'s; what is added here is the German the undo
 * button reads and the audit record the file keeps. One commit per name, so
 * each lands on the undo stack, in the log, on the beamer and in the next
 * autosave without doing anything about any of them (docs/ARCHITECTURE.md §3).
 *
 * **One commit per name, not one per keystroke.** The panel calls this when a
 * field is left or Enter is pressed, never while the host is typing: a commit
 * per character would fill the undo stack with fragments of a word and cost the
 * host one press per letter to get the old name back — the same reason the
 * tournament's own name is committed on blur (issue #15).
 */

/**
 * Names a participant, or corrects the name they already have.
 *
 * Not `urgent`. Sixteen names are typed in a burst of a minute or two, and the
 * 500 ms debounce is exactly what turns that burst into a handful of writes
 * rather than sixteen (docs/FILE-FORMAT.md rule 4). Nothing about a name is
 * unreconstructable the way a shuffled repechage pot is: a host who lost the
 * last one to a crash reads it off the sheet in front of them and types it
 * again.
 */
export function setGroupName(store: TournamentStore, groupId: GroupId, name: string): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const target = before.groups.find((group) => group.id === groupId);
  const after = naming.setGroupName(before, groupId, name);
  // Nothing to commit when the domain handed its argument back: an empty name,
  // one over the limit, or a name that did not actually change. The field
  // refuses the first two at the keyboard; this is what makes a blur that
  // changed nothing cost nothing rather than push an undo step that undoes
  // nothing. An id that names nobody is caught by the same pair — it is read
  // here so the label below has a number to name.
  if (target === undefined || after === before) {
    return;
  }

  // The same function the domain stored it through, so the undo button reads
  // the name that is in the tournament rather than the one that was typed.
  const stored = naming.normalizeGroupName(name);

  store.commit(() => ({ document: after }), {
    // Two labels rather than one. "Name erfasst" and "Name geändert" are
    // different decisions to the host scanning for the one they want back —
    // the second is the misclick that replaced a name that was already right.
    //
    // Both name the row by **number**, never by the name. This is the button
    // for a name that is about to disappear, and labelling it with that same
    // name would name the thing being taken away rather than who it is being
    // taken away from (docs/TOURNAMENT-RULES.md §0: the number is the
    // identity).
    undoLabel: (target.name === null ? de.undo.action.groupNamed : de.undo.action.groupRenamed)({
      participant: de.participant[before.settings.participantLabel].numbered({
        n: target.number,
      }),
      name: stored,
    }),
    log: {
      action: 'GROUP_NAMED',
      payload: {
        groupId,
        name: stored,
        // What it was, so the log answers "who changed that, and from what?"
        // half an hour later without replaying the evening
        // (docs/FILE-FORMAT.md rule 6).
        previousName: target.name,
      },
    },
  });
}
