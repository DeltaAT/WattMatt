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
