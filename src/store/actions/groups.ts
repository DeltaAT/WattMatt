import * as groups from '@/domain/groups';
import type { GroupId } from '@/domain/ids';
import { setParticipantLabel as set } from '@/domain/settings';
import type { ParticipantLabel, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * Everything the host can do to the field of participants (issue #14).
 *
 * Each of these is one decision and one commit, so each lands on the undo
 * stack, in the audit log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3). The rules themselves
 * live in `@/domain/groups`; what is added here is what the host would call the
 * step in German — in the wording *this* tournament uses — and what the log
 * should remember about it.
 *
 * The German is picked per commit rather than once, because the host may switch
 * between `Gruppen`, `Teams` and `Spieler` at any time and the undo button has
 * to read the way the screen does.
 */

/**
 * Creates `count` groups, numbered on from the highest that has ever existed.
 *
 * One action for the `+` and for the "Anzahl Gruppen" bulk add: the host means
 * the same thing either way, and 40 groups arriving as 40 commits is a stack
 * the host would have to press undo 40 times to walk back out of.
 */
export function addGroups(store: TournamentStore, count: number): void {
  change(
    store,
    (document) => groups.addGroups(document, count),
    (before, after) => {
      // Counted from what actually appeared rather than from what was asked
      // for: the domain floors a fractional count, and an undo button promising
      // three groups that were never created is worse than no label at all.
      const created = after.groups.length - before.groups.length;
      return {
        undoLabel: de.undo.action.groupsAdded({
          participants: words(after).count({ n: created }),
        }),
        log: {
          action: 'GROUPS_ADDED',
          payload: {
            count: created,
            groupIds: after.groups.slice(-created).map((group) => group.id),
          },
        },
      };
    },
  );
}

/**
 * Removes a group. Refused for one that has already been drawn
 * (`isRemovable` in `@/domain/groups`).
 *
 * The number is read off the tournament from *before* the removal — afterwards
 * there is no group left to name, and an undo label naming nobody is the one a
 * host cannot act on.
 */
export function removeGroup(store: TournamentStore, groupId: GroupId): void {
  change(
    store,
    (document) => groups.removeGroup(document, groupId),
    (before) => ({
      undoLabel: de.undo.action.groupRemoved({ participant: nameOf(before, groupId) }),
      log: {
        action: 'GROUP_REMOVED',
        payload: { groupId, number: numberOf(before, groupId) },
      },
    }),
  );
}

/**
 * Switches the German wording between `Gruppe`, `Team` and `Spieler`.
 *
 * A tournament setting rather than an app preference: it belongs to this event
 * and travels in its file, so a laptop that runs a club evening and a school
 * final on the same night gets both right (docs/FILE-FORMAT.md `settings`).
 */
export function setParticipantLabel(store: TournamentStore, label: ParticipantLabel): void {
  change(
    store,
    (document) => set(document, label),
    (_before, after) => ({
      undoLabel: de.undo.action.participantLabelSet({ participants: words(after).many }),
      log: { action: 'PARTICIPANT_LABEL_SET', payload: { participantLabel: label } },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * The same shape as `@/store/actions/tables`, and for the same two reasons.
 * With no tournament open it does nothing rather than committing an empty
 * patch — the group controls live with the tournament, so this can only be a
 * click that arrived after the host closed one. And a change that produced the
 * same tournament does not commit either: every domain function here hands its
 * argument back when it is asked for something that cannot happen — removing a
 * group that is already playing, adding zero of them — and committing that
 * would put a step on the undo stack that undoes nothing.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after }), describe(before, after));
}

/** The wording this tournament calls its participants by. */
function words(document: Tournament) {
  return de.participant[document.settings.participantLabel];
}

/** What the host calls this participant, for the undo button. */
function nameOf(document: Tournament, groupId: GroupId): string {
  const group = document.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    return de.group.unknown;
  }
  return group.name ?? words(document).numbered({ n: group.number });
}

/** The number for the audit log, which records what happened and not what it looked like. */
function numberOf(document: Tournament, groupId: GroupId): number | null {
  return document.groups.find((candidate) => candidate.id === groupId)?.number ?? null;
}
