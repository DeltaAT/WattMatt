import type { GroupId } from '@/domain/ids';
import type { Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';

/**
 * What a group is called on screen, before it has a name.
 *
 * The number is the identity of a participant for the whole event
 * (docs/TOURNAMENT-RULES.md §0), and a name only exists from the naming phase
 * on (issue #23) — so this prefers the name and falls back to the number.
 *
 * Shared by the host and the beamer on purpose: the two must never disagree
 * about who is playing where, and one function is the cheapest way to make that
 * true (CLAUDE.md golden rule 4).
 *
 * `participant` is passed rather than defaulted, so a screen that forgot to
 * thread the host's choice through fails to compile instead of quietly saying
 * `Gruppe 4` at a tournament that has been calling them `Teams` all evening
 * (issue #14). The host reads it from the open tournament, the beamer from the
 * snapshot — which carries it for exactly this reason.
 */
export function groupLabel(
  groupId: GroupId | null,
  byId: ReadonlyMap<GroupId, Group>,
  participant: ParticipantLabel,
): { text: string; isBye: boolean } {
  // A match with no second group is a bye, not a missing group
  // (docs/TOURNAMENT-RULES.md §0).
  if (groupId === null) {
    return { text: de.outcome.bye, isBye: true };
  }

  const group = byId.get(groupId);
  if (group === undefined) {
    // A group id that names nothing — a file repaired by hand. Said out loud
    // rather than drawn as a blank, so the host can see which table is wrong.
    return { text: de.group.unknown, isBye: false };
  }
  return {
    text: group.name ?? de.participant[participant].numbered({ n: group.number }),
    isBye: false,
  };
}

/**
 * What a participant is called on the **beamer**, in a group round: the bare
 * number (issue #75).
 *
 * The number is a participant's identity for the whole event
 * (docs/TOURNAMENT-RULES.md §0), and the word in front of it carries nothing.
 * Repeated across thirty-two cards it is not merely redundant — it is the
 * reason the numbers are small, because it eats the width they could have had.
 * At ten metres the two things a spectator needs are which table and which two
 * numbers, and both of them fit only once the words are gone.
 *
 * A name is deliberately dropped too, even on the rare file that carries one
 * this early. Group rounds run before the naming phase by construction
 * (docs/TOURNAMENT-RULES.md §6) so there is normally nothing to drop, and a
 * board where one card said `Die Adler` and thirty-one said a number would be
 * two designs at once. Names come back with the `Turnierbaum`, all together,
 * which is the moment they are meant to land (issue #23).
 *
 * A `Freilos` keeps its word: no number can express "advanced without playing",
 * and it is the audience's only explanation of why somebody did
 * (docs/TOURNAMENT-RULES.md §9 case 1).
 *
 * Beside `groupLabel` rather than replacing it: the host keeps the full wording
 * on a 50 cm screen where density is not the problem, and the two forms living
 * in one file is what stops them drifting into disagreement about who is
 * playing (CLAUDE.md golden rule 4).
 */
export function groupNumber(
  groupId: GroupId | null,
  byId: ReadonlyMap<GroupId, Group>,
): { text: string; isBye: boolean } {
  if (groupId === null) {
    return { text: de.outcome.bye, isBye: true };
  }

  const group = byId.get(groupId);
  if (group === undefined) {
    // A group id that names nothing — a file repaired by hand. Said out loud
    // rather than drawn as a blank, so the host can see which table is wrong.
    return { text: de.group.unknown, isBye: false };
  }
  return { text: String(group.number), isBye: false };
}
