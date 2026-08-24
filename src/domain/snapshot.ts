import { z } from 'zod';

import { beamerSceneSchema, IDLE_SCENE } from '@/domain/beamerScene';
import { currentRound } from '@/domain/selectors';
import { matchesOnTables } from '@/domain/tables';
import {
  groupSchema,
  matchSchema,
  participantLabelSchema,
  roundSchema,
  tableSchema,
  type Group,
  type Match,
  type Round,
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
 * them — exactly what `TABLE_OVERVIEW` draws — plus the two settings the
 * projector itself needs: what the audience calls a participant (issue #14) and
 * how expensively it may animate (issue #15). The
 * scenes that need whole rounds and the bracket are issues #18, #19, #25 and
 * #27, and each extends this schema with what it actually draws; the envelope
 * around it is final either way (docs/OPEN-QUESTIONS.md #19).
 */
export const groupSnapshotSchema = groupSchema;

export type GroupSnapshot = Group;

/**
 * A round without its matches — they travel in `matches` alongside it.
 *
 * Split rather than sent whole so there is one list of matches in a snapshot
 * instead of two that could disagree about which pairing is on which table.
 */
export const roundSnapshotSchema = roundSchema.omit({ matches: true });

export type RoundSnapshot = z.infer<typeof roundSnapshotSchema>;

export const tournamentSnapshotSchema = z.object({
  /**
   * What the tournament is called (issue #19).
   *
   * The round board carries persistent chrome — the tournament, the round, the
   * progress — so the audience can read what they are looking at from the back
   * of the room without having been there when it started.
   */
  name: z.string(),
  groups: z.array(groupSnapshotSchema),
  /**
   * Whether the room is playing in `Gruppen`, `Teams` or as `Spieler`
   * (issue #14).
   *
   * The piece of `settings` that changes what the audience *reads*. Sent rather
   * than assumed: the host screen and the projector calling the same participant
   * two different things is precisely the disagreement golden rule 4 exists to
   * prevent.
   */
  participantLabel: participantLabelSchema,
  /**
   * Whether the beamer is to run its motion in the cheap mode (issue #15,
   * docs/MOTION.md §6).
   *
   * Sent rather than read from a preference file, because MOTION.md requires it
   * to be switchable **mid-event without reloading the beamer window** — and
   * the snapshot is the one channel that reaches a window already showing
   * something. A host reaches for this while the projector is visibly
   * stuttering, so the next picture has to be the cheap one.
   */
  performanceMode: z.boolean(),
  /** In the host's configured order, which is the order they stand in the room. */
  tables: z.array(tableSchema),
  /**
   * The current round's matches, or — between rounds, when there is no current
   * round — the matches still sitting on a table.
   *
   * Widened from "on a table" by issue #18: the draw scene has to show every
   * pairing, including the ones queued for a table and the byes, which never
   * touch one. `TABLE_OVERVIEW` is unaffected, because `occupancyBoard` picks
   * matches out by `table.currentMatchId` rather than by taking the whole list.
   */
  matches: z.array(matchSchema),
  /**
   * Which round those matches belong to, without them (issue #18).
   *
   * The scene descriptor names a `roundId`, and the beamer must be able to tell
   * whether the round it has been handed is that one. Without this it would
   * animate whatever arrived, so a `DRAW` scene left staged while the host drew
   * the *next* round would re-run the sequence against pairings the audience
   * has already seen.
   */
  round: roundSnapshotSchema.nullable(),
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
  // No tournament open, so nothing to name.
  name: '',
  groups: [],
  // The default of `DEFAULT_SETTINGS`: with no tournament open there is nobody
  // to call anything, and `Gruppe` is what the glossary calls a participant.
  participantLabel: 'GROUP',
  // The default of `DEFAULT_SETTINGS` as well: an idle beamer animates nothing
  // worth economising on.
  performanceMode: false,
  tables: [],
  matches: [],
  // Nothing has been drawn, so there is no round to name.
  round: null,
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
  const round = currentRound(tournament);

  return {
    name: tournament.name,
    groups: tournament.groups,
    participantLabel: tournament.settings.participantLabel,
    performanceMode: tournament.settings.performanceMode,
    tables: tournament.tables,
    // The whole round while one is open, so the draw scene can show the queued
    // pairings and the byes as well as what is on a table. Between rounds there
    // is no round to send, and what is left on a table is what the occupancy
    // board still has to draw.
    //
    // Copied out of the readonly projection: the snapshot is a value the sync
    // layer serialises, and Zod's inferred array type is a mutable one.
    matches: round === null ? [...matchesOnTables(tournament)] : [...round.matches],
    round: round === null ? null : withoutMatches(round),
  };
}

function withoutMatches(round: Round): RoundSnapshot {
  const { matches: _matches, ...rest } = round;
  return rest;
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
