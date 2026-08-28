import { z } from 'zod';

import { beamerSceneSchema, IDLE_SCENE } from '@/domain/beamerScene';
import { groupIdSchema } from '@/domain/ids';
import { potEntrySchema, repechagePot, repechageState } from '@/domain/repechage';
import { currentRound } from '@/domain/selectors';
import { matchesOnTables } from '@/domain/tables';
import {
  bracketSchema,
  groupSchema,
  matchSchema,
  participantLabelSchema,
  repechageDrawSchema,
  repechageFallbackSchema,
  roundSchema,
  tableSchema,
  type Group,
  type Match,
  type Round,
  type RoundTrack,
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

/**
 * The `Hoffnungsrunde` as the projector draws it (issue #21).
 *
 * Derived, not raw: `repechage.pool` and `repechage.draws` are the file's
 * record of what happened, and the scene needs the picture that follows from
 * them — who is through, who is still in the pot, how many places are left. The
 * derivation is `@/domain/repechage`'s and is done once, on the host, so the
 * panel the host reads and the wall the room reads cannot come out of two
 * different calculations and disagree about the count in front of everybody.
 *
 * Null for most of a tournament: before the phase, and for every tournament
 * whose field was a power of two and skipped it (docs/TOURNAMENT-RULES.md §9
 * case 2). Null is what tells the scene to draw nothing rather than an empty
 * pot.
 */
export const repechageSnapshotSchema = z.object({
  /** `2^ceil(log2(|W|))` — the field the bracket needs. */
  target: z.number().int().positive(),
  /** How many places are still open, which is the counter the room reads. */
  need: z.number().int().nonnegative(),
  /** Places the *Freilose vergeben* fallback owes the next draw. */
  byes: z.number().int().nonnegative(),
  /** The winners column: the qualifying winners plus everyone who accepted. */
  through: z.array(groupIdSchema),
  /** Every loser and where they stand, in the order the room has seen them. */
  pot: z.array(potEntrySchema),
  /**
   * The last draw and what became of it — the one card that is moving
   * (docs/MOTION.md §4.3). Null before the first candidate is drawn.
   */
  last: repechageDrawSchema.nullable(),
  /** Which §4 fallback the host took, so the wall can say so. Usually null. */
  fallbackUsed: repechageFallbackSchema.nullable(),
  /** The field is full and nobody is waiting for an answer. */
  complete: z.boolean(),
});

export type RepechageSnapshot = z.infer<typeof repechageSnapshotSchema>;

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
  /**
   * The open `Trostrunde` round and its matches, or null and empty (issue #73).
   *
   * A second pair of fields rather than a list of open rounds, because that is
   * what the beamer actually has to answer: `ROUND_BOARD` and `DRAW` name one
   * round, and the projector has to be able to find it whichever of the two
   * tracks it is on (docs/TOURNAMENT-RULES.md §10). Keeping the main field in
   * `round` and `matches` means every scene written before the side event
   * existed keeps drawing exactly what it drew.
   *
   * The two lists never share a match: a match belongs to one round, and the
   * two rounds are on different tracks by construction.
   */
  consolationRound: roundSnapshotSchema.nullable(),
  consolationMatches: z.array(matchSchema),
  /**
   * The running `Hoffnungsrunde`, or null (issue #21).
   *
   * Sent for the same reason `round` is: the `REPECHAGE` scene draws it, and
   * the beamer holds no state of its own to draw it from (golden rule 4). It is
   * also what makes the phase survive the projector being unplugged mid-draw —
   * a beamer reopened between two candidates is handed the pot, the winners
   * column and the counter exactly as they stood.
   */
  repechage: repechageSnapshotSchema.nullable(),
  /**
   * The `Trostrunde`'s own `Hoffnungsrunde`, or null (issue #91).
   *
   * A second field rather than a discriminated one, for the reason
   * `consolationRound` is: the two tournaments run at the same time and can
   * both have a lottery open, and every scene written before the side event had
   * one keeps reading exactly the field it read. Which of the two is on the wall
   * is the staged scene's `track`.
   */
  consolationRepechage: repechageSnapshotSchema.nullable(),
  /**
   * Every round that is over, with its matches — the history (issue #22).
   *
   * The `ROUND_BOARD` scene names a round, and until now the only round the
   * beamer could be handed was the open one: pointing the projector at *Runde 2*
   * while *Runde 3* was running rendered an empty board. The host browses the
   * evening back on their own screen and must be able to put any of it on the
   * wall — "who did you beat in the second round?" is a question asked out loud
   * at every tournament.
   *
   * Closed rounds only, so no match travels twice: the open round is `round`
   * plus `matches` above, and a snapshot with two lists that could disagree
   * about which pairing is on which table is the thing `roundSnapshotSchema`
   * was split to avoid.
   */
  history: z.array(roundSchema),
  /**
   * The `Trostrunde`'s own tree, or null until it is drawn (issue #91).
   *
   * Beside `bracket` for the same reason its lottery is beside the main one:
   * both can exist at once, and the `BRACKET` scene is pointed at one of them
   * by the staged descriptor's `track`. It is drawn in numbers rather than
   * names, which is a property of the tree and not a second scene — the side
   * event never enters the naming phase (§10).
   */
  consolationBracket: bracketSchema.nullable(),
  /**
   * The `Turnierbaum`, or null until it is drawn (issue #25).
   *
   * The real `Bracket`, not a view of one, for the reason `groups` and `tables`
   * are the real entities: a second definition of the same tree is the kind of
   * thing that drifts silently, and the difference would surface as a projector
   * showing a semi-final the host has already decided. What the scene draws on
   * top of it — the columns, which round is live, where a chip travelled from —
   * is derived by `@/domain/bracket` on both sides, so the host panel (#26) and
   * the wall cannot disagree about it either.
   */
  bracket: bracketSchema.nullable(),
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
  /**
   * How many times the host has told the beamer to jump a running sequence to
   * its end (issue #28).
   *
   * Part of the picture rather than a command of its own: the beamer skips when
   * the number it is holding changes, so the message is idempotent, ordered
   * with everything else, and harmless to a window that has just caught up.
   *
   * Defaulted rather than required, so a payload built before this field
   * existed still parses into a beamer that simply never skips — the schema is
   * the only thing standing between a mismatched message and a blank projector.
   */
  skipToken: z.number().int().nonnegative().default(0),
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
  // Nothing is open on the side event's track either, and for most of an
  // evening there is no side event at all (docs/TOURNAMENT-RULES.md §10).
  consolationRound: null,
  consolationMatches: [],
  // The common case for a real tournament too: the phase is skipped whenever
  // the qualifying round leaves a power of two standing.
  repechage: null,
  // Nothing has been played, so there is nothing to look back at.
  history: [],
  // The final phase has not been reached, which is true of most of an evening.
  bracket: null,
  consolationBracket: null,
  consolationRepechage: null,
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
  const consolationRound = currentRound(tournament, 'CONSOLATION');
  const repechage = repechageState(tournament);
  const consolationRepechage = repechageState(tournament, 'CONSOLATION');

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
    // Only the open one. A closed `Trostrunde` round travels in `history` with
    // every other closed round, which is what the projector already reaches
    // into when the host points it at a past board (issue #22).
    consolationRound: consolationRound === null ? null : withoutMatches(consolationRound),
    consolationMatches: consolationRound === null ? [] : [...consolationRound.matches],
    // Copied out of the readonly projection for the same reason `matches` is:
    // what crosses the channel is a value the sync layer serialises, and the
    // schema's inferred arrays are mutable ones.
    repechage: potSnapshot(tournament, repechage, 'MAIN'),
    consolationRepechage: potSnapshot(tournament, consolationRepechage, 'CONSOLATION'),
    // Copied for the same reason the two lists above are: what crosses the
    // channel is a value the sync layer serialises, and the schema's inferred
    // arrays are mutable ones.
    history: tournament.rounds.filter((candidate) => candidate.state === 'CLOSED'),
    // Sent whole, and sent from the moment it is drawn: the `BRACKET` scene is
    // the main picture of the entire final phase, and a beamer reopened between
    // two semi-finals has nothing of its own to draw the tree from (golden
    // rule 4).
    bracket: tournament.bracket,
    consolationBracket: tournament.consolation?.bracket ?? null,
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
  // Nothing has been skipped, and nothing is running to skip.
  skipToken: 0,
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

/**
 * One track's lottery, as the beamer reads it.
 *
 * Shared by both since issue #91: two copies of this projection would be two
 * places for the pot to come to mean something different, and the side event's
 * lottery is the *same* lottery — same target, same counter, same pot.
 *
 * Copied out of the readonly projections, because what crosses the channel is a
 * value the sync layer serialises and the schema's inferred arrays are mutable
 * ones.
 */
function potSnapshot(
  tournament: Tournament,
  state: ReturnType<typeof repechageState>,
  track: RoundTrack,
): TournamentSnapshot['repechage'] {
  if (state === null) {
    return null;
  }
  return {
    target: state.target,
    need: state.need,
    byes: state.byes,
    through: [...state.through],
    pot: [...repechagePot(tournament, track)],
    last: state.last,
    fallbackUsed: state.fallbackUsed,
    complete: state.complete,
  };
}
