import { z } from 'zod';

import {
  bracketNodeIdSchema,
  groupIdSchema,
  matchIdSchema,
  roundIdSchema,
  tableIdSchema,
  tournamentIdSchema,
} from '@/domain/ids';

/**
 * The shape of everything — docs/FILE-FORMAT.md §"Schema (v8)".
 *
 * Schema first, type second: every entity is a Zod schema and its TypeScript
 * type is inferred from it. One definition, so a schema and its type cannot
 * drift apart, and every value that crosses a boundary is parsed by the same
 * thing the compiler checks against (ARCHITECTURE.md §4).
 *
 * State is modelled as discriminated unions of literals rather than booleans.
 * `match.status === 'WAITING_FOR_TABLE'` cannot encode the impossible state
 * that `isWaiting: true` plus `hasTable: true` can.
 */

/** ISO-8601 with an explicit offset, as written by docs/FILE-FORMAT.md. */
export const timestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof timestampSchema>;

/**
 * Time enters the domain through this and nothing else (ARCHITECTURE.md §5).
 * `src/domain` may not call `new Date()`; the caller supplies the clock, which
 * is what lets a test pin the tournament to a fixed instant.
 */
export type Clock = {
  now: () => Timestamp;
};

// ---------------------------------------------------------------------------
// State unions
// ---------------------------------------------------------------------------

/** docs/TOURNAMENT-RULES.md §1. `REPECHAGE` is skipped when unneeded. */
export const phaseSchema = z.enum([
  'SETUP',
  'QUALIFYING',
  'REPECHAGE',
  'ELIMINATION',
  'NAMING',
  'BRACKET',
  'CEREMONY',
]);
export type Phase = z.infer<typeof phaseSchema>;

export const roundKindSchema = z.enum([
  'QUALIFYING',
  'REPECHAGE',
  'ELIMINATION',
  'BRACKET',
  /** One round of the `Trostrunde` side event (issue #73, §10). */
  'CONSOLATION',
]);
export type RoundKind = z.infer<typeof roundKindSchema>;

/**
 * Which of the two tournaments a round belongs to
 * (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * Until the `Trostrunde` existed exactly one round was ever open, so "the
 * current round" was a question with one answer. It now has two: the main
 * field's elimination rounds and the side event run at the same time, in the
 * same room, out of the same pool of tables. Every function that used to mean
 * "the open round" takes a track and means "the open round of this track".
 *
 * Stored beside `kind` rather than derived from it, and the two are not the
 * same axis. `kind` is what the round is *called* — it names the German label
 * and the rules it was drawn under. `track` is what it is *scheduled* against:
 * which queue a freed table serves, which board the host reads, and which half
 * of the tournament an undo is allowed to touch. A second side event would add
 * a kind without adding a track, and a `Trostrunde` that one day ran its own
 * bracket would add a kind on the track it already has.
 */
export const roundTrackSchema = z.enum(['MAIN', 'CONSOLATION']);
export type RoundTrack = z.infer<typeof roundTrackSchema>;

/**
 * `DRAWN` — pairs exist, nothing has been played.
 * `RUNNING` — at least one match is under way.
 * `CLOSED` — the host explicitly closed it (docs/TOURNAMENT-RULES.md §3).
 */
export const roundStateSchema = z.enum(['DRAWN', 'RUNNING', 'CLOSED']);
export type RoundState = z.infer<typeof roundStateSchema>;

/**
 * `WAITING_FOR_TABLE` is a real state, not a derived one: there are routinely
 * more matches than tables (docs/TOURNAMENT-RULES.md §3, edge case 3).
 */
export const matchStatusSchema = z.enum(['WAITING_FOR_TABLE', 'READY', 'RUNNING', 'DONE']);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const tableStatusSchema = z.enum(['FREE', 'OCCUPIED', 'DISABLED']);
export type TableStatus = z.infer<typeof tableStatusSchema>;

/**
 * Where a group stands: in the main field, in the side event, or out
 * (docs/TOURNAMENT-RULES.md §3, §4, §10).
 *
 * `CONSOLATION` is a third state rather than a flag beside `ACTIVE`, and that
 * is the whole reason the `Trostrunde` cannot leak into a main-field draw: the
 * main field is `activeGroups`, which is `status === 'ACTIVE'` and nothing
 * else, so a group that has dropped into the side event is invisible to every
 * count, pairing and bracket the main tournament makes (issue #73). A boolean
 * `inConsolation` beside `ACTIVE` would have encoded the impossible state of
 * being in both (CLAUDE.md §6).
 *
 * A group leaves `ACTIVE` by losing or by declining a repechage slot (§4). It
 * leaves `CONSOLATION` by losing a `Trostrunde` round — or not at all, which is
 * what being the `Trostrunde` winner means.
 */
export const groupStatusSchema = z.enum(['ACTIVE', 'CONSOLATION', 'ELIMINATED']);
export type GroupStatus = z.infer<typeof groupStatusSchema>;

/**
 * Bracket rounds, named by field size (docs/TOURNAMENT-RULES.md §7).
 *
 * English per CLAUDE.md golden rule 1 — the German names in docs/GLOSSARY.md
 * (`Achtelfinale`, …) are UI copy and live in `src/i18n/de-AT.ts`.
 */
export const bracketRoundSchema = z.enum([
  'ROUND_OF_16',
  'QUARTER_FINAL',
  'SEMI_FINAL',
  'FINAL',
  'THIRD_PLACE',
]);
export type BracketRound = z.infer<typeof bracketRoundSchema>;

/** Affects German UI wording only (docs/FILE-FORMAT.md `settings`). */
export const participantLabelSchema = z.enum(['GROUP', 'TEAM', 'PLAYER']);
export type ParticipantLabel = z.infer<typeof participantLabelSchema>;

/**
 * Which end of the host's table list the app hands tables out from (issue #101).
 *
 * `ASCENDING` is the first table first and the behaviour every build until now
 * had. `DESCENDING` is the last table first, for the room where the
 * high-numbered tables are the ones by the beamer, the bar or the stage — which
 * end of the hall is the good end is a property of the venue and nothing the
 * app can work out.
 *
 * It orders the host's **list**, never a number parsed out of a label: tables
 * can be renamed and reordered (issue #13), and "the last table" means the last
 * row of the list the host is looking at (docs/TOURNAMENT-RULES.md §3).
 */
export const tableAssignmentOrderSchema = z.enum(['ASCENDING', 'DESCENDING']);
export type TableAssignmentOrder = z.infer<typeof tableAssignmentOrderSchema>;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * A participating unit: one player or one team, opaque beyond its number
 * (docs/OPEN-QUESTIONS.md #7). `name` is null until the naming phase — the
 * number is the identity for the whole event (docs/TOURNAMENT-RULES.md §0).
 */
export const groupSchema = z.object({
  id: groupIdSchema,
  number: z.number().int().positive(),
  name: z.string().nullable(),
  status: groupStatusSchema,
});
export type Group = z.infer<typeof groupSchema>;

export const tableSchema = z
  .object({
    id: tableIdSchema,
    label: z.string().min(1),
    status: tableStatusSchema,
    /** Set exactly while `status === 'OCCUPIED'` — see the check below. */
    currentMatchId: matchIdSchema.nullable(),
    /**
     * When the match now on this table started, or null while nothing is on it.
     *
     * Persisted rather than kept in memory, because the occupancy board answers
     * "how long has this been running?" and a laptop that was restarted
     * mid-event would otherwise report every match as just begun (issue #13,
     * CLAUDE.md §7 "loaded mid-tournament").
     *
     * It travels with the *match*, not with the table: moving a running match
     * to another table carries the stamp across, because the room has been
     * watching that match for twenty minutes whichever table it sits on.
     */
    occupiedSince: timestampSchema.nullable(),
    /**
     * Which track this table serves, or null for "either" (issue #79,
     * docs/TOURNAMENT-RULES.md §10).
     *
     * What the host says to the room once — *"Trostrunde an den beiden hinteren
     * Tischen"* — written down, so it does not have to be re-decided on every
     * table for the rest of the evening. Null is the default and stays the
     * common case: a tournament with no side event never sets this, and a table
     * that serves both tracks is the ordinary arrangement even in one that has.
     *
     * It is a rule about **what happens next**, never about what is happening.
     * Reserving a table that a match of the other track is already on does not
     * take that match off it, for the same reason disabling a table does not
     * (issue #13, rules §0): the pair are playing, and the room is watching.
     *
     * Independent of `status`, which is why it is a field of its own rather
     * than a fourth `TableStatus`. A table can be reserved and free, reserved
     * and busy, reserved and out of service; those are three different
     * questions and a single enum could only answer one of them at a time.
     */
    reservedFor: roundTrackSchema.nullable(),
  })
  /**
   * The three fields move together or not at all (issue #13 owns the table
   * lifecycle, `@/domain/tables`).
   *
   * Checked here rather than left as a convention, because every way into the
   * app goes through this schema: a file hand-repaired in Notepad — which
   * docs/FILE-FORMAT.md §Encoding invites — that frees a table but leaves the
   * match on it would otherwise open, and the draw engine would hand the same
   * table to a second match in front of the audience.
   */
  .refine((table) => (table.status === 'OCCUPIED') === (table.currentMatchId !== null), {
    path: ['currentMatchId'],
    error: 'A table carries a match exactly while it is OCCUPIED.',
  })
  .refine((table) => (table.currentMatchId !== null) === (table.occupiedSince !== null), {
    path: ['occupiedSince'],
    error: 'A table is occupied since exactly when it carries a match.',
  });
export type Table = z.infer<typeof tableSchema>;

/**
 * Exactly two groups, or one group plus a bye
 * (docs/TOURNAMENT-RULES.md §0): `b === null` is a `Freilos`.
 *
 * There are no scores and no draws — the host picks a winner
 * (docs/OPEN-QUESTIONS.md #2, #3).
 */
export const matchSchema = z.object({
  id: matchIdSchema,
  tableId: tableIdSchema.nullable(),
  a: groupIdSchema,
  b: groupIdSchema.nullable(),
  winnerId: groupIdSchema.nullable(),
  status: matchStatusSchema,
});
export type Match = z.infer<typeof matchSchema>;

export const roundSchema = z.object({
  id: roundIdSchema,
  /**
   * Which round of its **track** this is — `Runde 3`, `Trostrunde 2`.
   *
   * Per track rather than across the file, because it is what the label says
   * out loud and the two tracks are counted separately in the room. Round ids
   * stay global; only the number the host and the audience read is per track.
   */
  index: z.number().int().positive(),
  kind: roundKindSchema,
  /** Which of the two parallel tournaments this round belongs to (§10). */
  track: roundTrackSchema,
  label: z.string().min(1),
  state: roundStateSchema,
  matches: z.array(matchSchema),
});
export type Round = z.infer<typeof roundSchema>;

/** One candidate offered a second chance (docs/TOURNAMENT-RULES.md §4). */
export const repechageDrawSchema = z.object({
  groupId: groupIdSchema,
  /** `null` while the draw is on the beamer and the host has not answered. */
  accepted: z.boolean().nullable(),
});
export type RepechageDraw = z.infer<typeof repechageDrawSchema>;

/** Which §4 fallback the host chose when the pool ran dry. */
export const repechageFallbackSchema = z.enum(['BYES', 'REOPEN_DECLINED']);
export type RepechageFallback = z.infer<typeof repechageFallbackSchema>;

export const repechageSchema = z.object({
  /** `2^ceil(log2(|W|))` — the power-of-two field the bracket needs. */
  target: z.number().int().positive(),
  /**
   * The losers not yet drawn, in the order the seeded shuffle produced. The
   * next candidate is the front of the list (docs/TOURNAMENT-RULES.md §4).
   *
   * Stored rather than re-derived from the seed on load, and that is the whole
   * reason schema v4 exists. The shuffle happened at one position of the RNG
   * stream; every draw since has moved the cursor past it, so a file reopened
   * mid-phase could only re-shuffle into a *different* order — and the room has
   * already been shown the pot. A `Freilos` nobody drew and a candidate who was
   * already eliminated are the two ways that goes wrong in front of an
   * audience (CLAUDE.md §7, "loaded mid-tournament").
   */
  pool: z.array(groupIdSchema),
  draws: z.array(repechageDrawSchema),
  /**
   * Which §4 fallback the host took when the pool ran dry, or null.
   *
   * The **last** one, not a list: `REOPEN_DECLINED` can be taken more than once
   * and can be followed by `BYES`, and what the tournament still needs to know
   * afterwards is only whether byes are owed to the next draw. The full
   * sequence is in the append-only log (docs/FILE-FORMAT.md rule 6).
   */
  fallbackUsed: repechageFallbackSchema.nullable(),
});
export type Repechage = z.infer<typeof repechageSchema>;

export const bracketNodeSchema = z.object({
  id: bracketNodeIdSchema,
  round: bracketRoundSchema,
  /** Null until the feeding match has produced a winner. */
  slotA: groupIdSchema.nullable(),
  slotB: groupIdSchema.nullable(),
  winnerId: groupIdSchema.nullable(),
  /** Where this node's winner goes. Null for the final and for third place. */
  nextNodeId: bracketNodeIdSchema.nullable(),
  tableId: tableIdSchema.nullable(),
});
export type BracketNode = z.infer<typeof bracketNodeSchema>;

export const bracketSchema = z.object({
  /** 16, 8, 4 or 2 — a small tournament enters the final phase lower (§5). */
  size: z.number().int().positive(),
  nodes: z.array(bracketNodeSchema),
  /** Null at size 2: two groups leave nobody to play for third (§9 case 10). */
  thirdPlaceNodeId: bracketNodeIdSchema.nullable(),
});
export type Bracket = z.infer<typeof bracketSchema>;

/**
 * How far the `Trostrunde` has got — the side event of
 * docs/TOURNAMENT-RULES.md §10 (issue #73).
 *
 * `DECLINED` is a real answer and not the absence of one. The host is asked
 * once, when the `Hoffnungsrunde` closes, whether the evening has a side event
 * at all; a null `consolation` means they have not been asked yet, and a panel
 * that could not tell the two apart would keep offering a decision the host has
 * already made.
 *
 * There is no `pool` here, unlike `Repechage`. The field is not drawn out of a
 * pot at one position of the RNG stream — it is simply everyone the
 * `Hoffnungsrunde` left behind, which is written on the groups themselves as
 * `status === 'CONSOLATION'` and survives a reload without anything having to
 * remember a shuffle (docs/FILE-FORMAT.md §"Schema (v8)").
 */
export const consolationStateSchema = z.enum(['DECLINED', 'RUNNING', 'FINISHED']);
export type ConsolationState = z.infer<typeof consolationStateSchema>;

export const consolationSchema = z.object({
  state: consolationStateSchema,
  /**
   * Where the side event has got to in §1 — its own copy of the main field's
   * phase machine (issue #91).
   *
   * The `Trostrunde` runs the *same pipeline* as the main tournament, one level
   * down: a qualifying round, its own `Hoffnungsrunde` when the field is not a
   * power of two, elimination rounds down to sixteen, and then a bracket with a
   * `Spiel um Platz 3`. Two of the seven phases are unreachable here and that is
   * the whole of the difference: `NAMING` never happens, because the side event
   * is numbers-only from start to finish, and `CEREMONY` never happens, because
   * the podium is the main tournament's 1/2/3 (docs/TOURNAMENT-RULES.md §10).
   *
   * A phase of its own rather than a second meaning for `tournament.phase`: the
   * two tracks run at the same time and are routinely in different phases —
   * the main field in its `Achtelfinale` while the side event is still drawing
   * its first round is the ordinary evening, not an edge case.
   */
  phase: phaseSchema,
  /**
   * The side event's own `Hoffnungsrunde`, or null when it has not needed one.
   *
   * Same lottery, same accept/decline, same fallbacks — and one consequence
   * worth saying out loud to the room, because it is the opposite of the main
   * one: declining *this* one means going home. The `Trostrunde`'s losers get
   * no further side event, because one level is where the structure stops
   * recursing (issue #91, §10 "no nesting").
   */
  repechage: repechageSchema.nullable(),
  /** The side event's own tree, drawn in numbers and never in names (§10). */
  bracket: bracketSchema.nullable(),
  /**
   * The last group standing, once one is — set when the round that leaves it
   * alone is closed, and null before that and for a declined side event.
   *
   * Stored rather than derived from "the only group still in `CONSOLATION`",
   * because the two stop agreeing the moment the ceremony is reached: the
   * winner is the answer to a question the host asked an hour earlier, and a
   * derived one would change if a later correction moved a group's status.
   */
  winnerId: groupIdSchema.nullable(),
});
export type Consolation = z.infer<typeof consolationSchema>;

export const settingsSchema = z.object({
  participantLabel: participantLabelSchema,
  /** Field size at which names become required (docs/OPEN-QUESTIONS.md #8). */
  namingAt: z.number().int().positive(),
  performanceMode: z.boolean(),
  /** Which end of the table list a free table is taken from (issue #101). */
  tableAssignmentOrder: tableAssignmentOrderSchema,
});
export type Settings = z.infer<typeof settingsSchema>;

/**
 * One appended audit record. Append-only, and never replayed to rebuild state —
 * the snapshot fields are authoritative (docs/FILE-FORMAT.md rule 6).
 *
 * `action` and `payload` stay loose here on purpose: issue #11 owns the action
 * log and tightens both to the real union once the actions exist.
 */
export const logEntrySchema = z.object({
  at: timestampSchema,
  action: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type LogEntry = z.infer<typeof logEntrySchema>;

/**
 * One tournament — the whole of it. This is the object the file stores and the
 * store owns; `@/domain/schema` wraps it with the schema version and app stamp.
 */
export const tournamentSchema = z.object({
  id: tournamentIdSchema,
  name: z.string().min(1),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,

  /** Draws are reproducible from these two (CLAUDE.md golden rule 7). */
  rngSeed: z.string().min(1),
  rngCursor: z.number().int().nonnegative(),

  settings: settingsSchema,
  phase: phaseSchema,

  tables: z.array(tableSchema),
  /**
   * The number the next table created will get, in its id and in its default
   * label — a counter, not `tables.length + 1`.
   *
   * It is persisted because "highest ever used" is not derivable from a file:
   * once `tbl_3` has been deleted, nothing in `tables` remembers that the
   * number is spent. Deriving it would hand the number back out, and
   * `docs/OPEN-QUESTIONS.md` #37 leans on it never being handed back —
   * `match.tableId` keeps pointing at a deleted table as the record of where a
   * match was played, and that record must not come to mean a different one.
   */
  nextTableNumber: z.number().int().min(1),
  groups: z.array(groupSchema),
  /**
   * The number the next group created will get, in its id and on its chip.
   *
   * The same counter as `nextTableNumber` and for the same reason, one stated
   * by docs/TOURNAMENT-RULES.md §2 rather than inferred: a group number is
   * stable for the whole tournament and is **never reused**, even after the
   * group is removed. `max(number) + 1` breaks that the moment the
   * highest-numbered group is the one deleted, and nothing left in `groups`
   * remembers that its number is spent (docs/OPEN-QUESTIONS.md #22).
   */
  nextGroupNumber: z.number().int().min(1),
  rounds: z.array(roundSchema),

  /** Null when the phase was skipped, which is the common case (§4). */
  repechage: repechageSchema.nullable(),
  /**
   * The `Trostrunde`, or null while the host has not been asked about it (§10).
   *
   * Null for the whole of a tournament whose host declines to run one before
   * the question is put — which is every tournament played before issue #73,
   * and what the v4 → v5 migration writes.
   */
  consolation: consolationSchema.nullable(),
  /** Null until the final phase is reached. */
  bracket: bracketSchema.nullable(),

  log: z.array(logEntrySchema),
});
export type Tournament = z.infer<typeof tournamentSchema>;
