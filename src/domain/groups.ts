import { groupIdSchema, type GroupId } from '@/domain/ids';
import { allMatches } from '@/domain/lookup';
import type { Group, Tournament } from '@/domain/types';

/**
 * The group lifecycle (issue #14, docs/TOURNAMENT-RULES.md §2).
 *
 * Groups are the participants. Before the naming phase they are numbers and
 * nothing else, and the number is the identity for the whole event — which is
 * what makes creation and removal worth their own module rather than two
 * spreads inside an action: §2 requires that a number is stable and **never
 * reused**, and there is exactly one place that decides which number comes
 * next.
 *
 * Pure, like everything in `src/domain`: no clock, no randomness, no German. A
 * group id is the one thing built here, and it is built from the counter the
 * tournament carries rather than from the length of the list.
 *
 * Every function returns the tournament unchanged when it is asked for
 * something that cannot happen — an unknown group, a group that is already
 * playing. The host UI disables those controls; the guard is here so a stale
 * click during a live event costs nothing rather than throwing in front of the
 * room.
 */

/** The prefix docs/FILE-FORMAT.md writes group ids with. */
const GROUP_ID_PREFIX = 'grp_';

const NUMBERED_ID = /^grp_(\d+)$/;

/**
 * The number the next group gets, in its id and on its chip.
 *
 * Highest ever used plus one, never the lowest free one
 * (docs/TOURNAMENT-RULES.md §2, docs/OPEN-QUESTIONS.md #22). "Gruppe 3" is what
 * a participant is called out as for the whole event, and handing that number
 * to somebody else an hour after the first Gruppe 3 withdrew is the one
 * mistake nobody in the room would forgive.
 *
 * "Ever" is why this reads a stored counter (`tournament.nextGroupNumber`)
 * rather than the groups in front of it: after `grp_3` is deleted, the list no
 * longer contains any evidence that the number 3 is spent.
 *
 * The counter is floored by the groups that do exist, which only matters for a
 * file repaired in Notepad (docs/FILE-FORMAT.md §Encoding): a counter edited
 * back below an existing group would otherwise mint a duplicate id, and
 * `indexById` throws on those at load time. Ids that do not follow the
 * `grp_<n>` pattern are ignored rather than rejected — they cannot collide,
 * which is all this has to guarantee.
 */
export function nextGroupNumber(tournament: Tournament): number {
  return Math.max(tournament.nextGroupNumber, highestGroupNumber(tournament.groups) + 1);
}

/** The largest `grp_<n>` number among these groups, or zero if there is none. */
function highestGroupNumber(groups: readonly Group[]): number {
  let highest = 0;
  for (const group of groups) {
    const matched = NUMBERED_ID.exec(group.id);
    const number = matched?.[1] === undefined ? 0 : Number(matched[1]);
    highest = Math.max(highest, number);
  }
  return highest;
}

/**
 * Creates `count` groups at the end of the list, numbered on from the highest
 * that has ever existed.
 *
 * One function for the `+` and for the "Anzahl Gruppen" bulk add: the host
 * means the same thing either way, and two code paths would eventually
 * disagree about numbering. A group is born nameless — the name arrives in the
 * naming phase (issue #23) — and `ACTIVE`, because a participant that has not
 * played cannot have lost.
 */
export function addGroups(tournament: Tournament, count: number): Tournament {
  const wanted = Math.floor(count);
  if (!Number.isFinite(wanted) || wanted < 1) {
    return tournament;
  }

  const first = nextGroupNumber(tournament);
  const created: Group[] = Array.from({ length: wanted }, (_unused, index) => {
    const number = first + index;
    return {
      id: groupIdSchema.parse(`${GROUP_ID_PREFIX}${number}`),
      number,
      name: null,
      status: 'ACTIVE',
    };
  });

  // The counter moves on with the groups, in the same commit: a create that
  // advanced the list without advancing the counter would mint the same id
  // twice on the next `+`.
  return {
    ...tournament,
    groups: [...tournament.groups, ...created],
    nextGroupNumber: first + wanted,
  };
}

/**
 * Removes a group — the participant who never turned up, or the one entered
 * twice.
 *
 * The numbers of the remaining groups do **not** shift
 * (docs/TOURNAMENT-RULES.md §9 case 9): removing group 3 of 5 leaves 1, 2, 4
 * and 5. Renumbering would rename people who are standing at a table, and the
 * counter is not wound back either, so the next group added after that is 6.
 *
 * Refused for a group that is already part of the tournament — see
 * `isRemovable`. Undo is the way back from a removal that was a misclick
 * (CLAUDE.md golden rule 6).
 */
export function removeGroup(tournament: Tournament, groupId: GroupId): Tournament {
  if (!isRemovable(tournament, groupId)) {
    return tournament;
  }
  return { ...tournament, groups: tournament.groups.filter((group) => group.id !== groupId) };
}

/**
 * Whether this group can still be taken out of the tournament.
 *
 * A group that has been drawn into a match, offered a repechage slot or placed
 * in the bracket cannot: those records name it, and deleting it would leave a
 * match against nobody on the beamer — a `Freilos` the draw never granted
 * (docs/TOURNAMENT-RULES.md §0). The way to take such a participant out of the
 * event is to lose, to decline, or for the host to undo back to before the
 * draw.
 *
 * Exported so the host UI can grey out the control and say why, rather than
 * offering a button that silently does nothing.
 */
export function isRemovable(tournament: Tournament, groupId: GroupId): boolean {
  if (!tournament.groups.some((group) => group.id === groupId)) {
    return false;
  }
  return !isDrawnIn(tournament, groupId);
}

/** Whether any round, repechage draw or bracket node names this group. */
function isDrawnIn(tournament: Tournament, groupId: GroupId): boolean {
  const inMatch = allMatches(tournament).some(
    (match) => match.a === groupId || match.b === groupId || match.winnerId === groupId,
  );
  if (inMatch) {
    return true;
  }

  const inRepechage = tournament.repechage?.draws.some((draw) => draw.groupId === groupId) ?? false;
  if (inRepechage) {
    return true;
  }

  return (
    tournament.bracket?.nodes.some(
      (node) => node.slotA === groupId || node.slotB === groupId || node.winnerId === groupId,
    ) ?? false
  );
}

/**
 * Whether the first draw has happened.
 *
 * Groups may be added at any time — the host is in control (CLAUDE.md golden
 * rule 3) — but after the qualifying round has been drawn a new group is not in
 * it, and the host is warned before they find that out from the beamer
 * (issue #14). Keyed on rounds rather than on `phase`, because a round is the
 * thing a late participant would have had to be in.
 */
export function hasStarted(tournament: Tournament): boolean {
  return tournament.rounds.length > 0;
}

/**
 * The fewest groups a tournament can be run with (docs/TOURNAMENT-RULES.md §2,
 * §9 case 4). Two groups is one match, and that is a tournament.
 */
export const MINIMUM_GROUPS = 2;

/**
 * Whether there are enough participants to draw a round.
 *
 * Here rather than in the setup panel that shows the hint, because the draw
 * engine (#16) has to refuse exactly the same case, and two answers would
 * eventually disagree about what "ready" means.
 */
export function hasEnoughGroups(tournament: Tournament): boolean {
  return tournament.groups.length >= MINIMUM_GROUPS;
}
