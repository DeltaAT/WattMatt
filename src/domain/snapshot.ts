import { z } from 'zod';

import { beamerSceneSchema, IDLE_SCENE } from '@/domain/beamerScene';
import { matchesOnTables } from '@/domain/tables';
import {
  groupSchema,
  matchSchema,
  participantLabelSchema,
  tableSchema,
  type Group,
  type Match,
  type Table,
  type Tournament,
} from '@/domain/types';

/**
 * The full picture the host broadcasts to the beamer (docs/ARCHITECTURE.md §3).
 *
 * Full snapshots, never diffs. A diff stream has to be replayed in order to be
 * correct, and a beamer that was killed mid-round has no order to replay — the
 * whole point of rule 4 is that a fresh window can be handed the current truth
 * in one message. Snapshots are small; revisit only if profiling says so.
 */

/**
 * The tournament half of a snapshot.
 *
 * The beamer is sent the real `Group`, not a parallel view of one: two
 * definitions of the same entity are exactly the kind of thing that drifts
 * silently, and the difference would surface as a projector showing a group
 * the host has already eliminated.
 *
 * It carries groups and, since issue #13, tables and the matches that are on
 * them — exactly what `TABLE_OVERVIEW` draws — plus, since issue #14, the one
 * setting that decides what the audience calls a participant. The scenes that
 * need whole rounds and the bracket are issues #18, #19, #25 and #27, and each
 * extends this schema with what it actually draws; the envelope around it is
 * final either way (docs/OPEN-QUESTIONS.md #19).
 */
export const groupSnapshotSchema = groupSchema;

export type GroupSnapshot = Group;

export const tournamentSnapshotSchema = z.object({
  groups: z.array(groupSnapshotSchema),
  /**
   * Whether the room is playing in `Gruppen`, `Teams` or as `Spieler`
   * (issue #14).
   *
   * The only piece of `settings` the beamer is sent, because it is the only one
   * that changes what the audience reads. Sent rather than assumed: the host
   * screen and the projector calling the same participant two different things
   * is precisely the disagreement golden rule 4 exists to prevent.
   */
  participantLabel: participantLabelSchema,
  /** In the host's configured order, which is the order they stand in the room. */
  tables: z.array(tableSchema),
  /**
   * The matches currently on a table, and only those.
   *
   * Enough for the occupancy board, which is the one scene that reads them
   * today. Issue #19 widens this to the current round's matches — the field is
   * the same one, and `toTournamentSnapshot` is the only place that decides
   * what goes in it.
   */
  matches: z.array(matchSchema),
});

export type TournamentSnapshot = z.infer<typeof tournamentSnapshotSchema>;

export type TableSnapshot = Table;
export type MatchSnapshot = Match;

/**
 * Why this snapshot was sent.
 *
 * `catchUp` answers a beamer that just mounted and is rendering a scene it has
 * never shown before. It must appear already settled: replaying the draw
 * animation because the beamer window was reopened would show the audience a
 * draw that is not happening (issue #5 acceptance criteria).
 *
 * An undo and a redo are sent the same way for the same reason (issue #11).
 * The two cases differ in what caused them and not at all in what the beamer
 * must do about it: put the picture where it belongs, without playing anything
 * out in front of the room.
 */
export const snapshotDeliverySchema = z.enum(['live', 'catchUp']);
export type SnapshotDelivery = z.infer<typeof snapshotDeliverySchema>;

export const snapshotSchema = z.object({
  /**
   * Monotonic per host session. Lets the beamer drop a snapshot that lost a
   * race and arrived after a newer one — out-of-order delivery is not something
   * the transport promises not to do.
   */
  revision: z.number().int().nonnegative(),
  scene: beamerSceneSchema,
  autoFollow: z.boolean(),
  tournament: tournamentSnapshotSchema,
  delivery: snapshotDeliverySchema,
});

export type Snapshot = z.infer<typeof snapshotSchema>;

export const EMPTY_TOURNAMENT: TournamentSnapshot = {
  groups: [],
  // The default of `DEFAULT_SETTINGS`: with no tournament open there is nobody
  // to call anything, and `Gruppe` is what the glossary calls a participant.
  participantLabel: 'GROUP',
  tables: [],
  matches: [],
};

/**
 * The beamer's view of the tournament the host owns.
 *
 * One function, called centrally by the store's `commit` (issue #9), rather
 * than a projection each action assembles for itself. An action that forgot to
 * update the beamer's copy would leave the projector one decision behind while
 * the host screen looks correct — the exact failure golden rule 4 exists to
 * prevent. Every issue that adds a field to `TournamentSnapshot` adds it here
 * too, and nowhere else.
 */
export function toTournamentSnapshot(tournament: Tournament): TournamentSnapshot {
  return {
    groups: tournament.groups,
    participantLabel: tournament.settings.participantLabel,
    tables: tournament.tables,
    // Copied out of the readonly projection: the snapshot is a value the sync
    // layer serialises, and Zod's inferred array type is a mutable one.
    matches: [...matchesOnTables(tournament)],
  };
}

/** What a beamer renders before the host has answered its first request. */
export const INITIAL_SNAPSHOT: Snapshot = {
  revision: 0,
  scene: IDLE_SCENE,
  autoFollow: true,
  tournament: EMPTY_TOURNAMENT,
  delivery: 'catchUp',
};

/**
 * Whether `incoming` should replace `current`.
 *
 * Equal revisions are accepted: the host re-sends the same revision to answer a
 * catch-up request, and that answer is exactly what a restarted beamer needs.
 */
export function supersedes(incoming: Snapshot, current: Snapshot): boolean {
  return incoming.revision >= current.revision;
}
