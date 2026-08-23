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
 * The shape of everything — docs/FILE-FORMAT.md §"Schema (v1)".
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

export const roundKindSchema = z.enum(['QUALIFYING', 'REPECHAGE', 'ELIMINATION', 'BRACKET']);
export type RoundKind = z.infer<typeof roundKindSchema>;

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

/** A group leaves `ACTIVE` by losing, or by declining a repechage slot (§4). */
export const groupStatusSchema = z.enum(['ACTIVE', 'ELIMINATED']);
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

export const tableSchema = z.object({
  id: tableIdSchema,
  label: z.string().min(1),
  status: tableStatusSchema,
  /** Set exactly while `status === 'OCCUPIED'`; see `@/domain/invariants`. */
  currentMatchId: matchIdSchema.nullable(),
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
  index: z.number().int().positive(),
  kind: roundKindSchema,
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
  draws: z.array(repechageDrawSchema),
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

export const settingsSchema = z.object({
  participantLabel: participantLabelSchema,
  /** Field size at which names become required (docs/OPEN-QUESTIONS.md #8). */
  namingAt: z.number().int().positive(),
  performanceMode: z.boolean(),
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
  groups: z.array(groupSchema),
  rounds: z.array(roundSchema),

  /** Null when the phase was skipped, which is the common case (§4). */
  repechage: repechageSchema.nullable(),
  /** Null until the final phase is reached. */
  bracket: bracketSchema.nullable(),

  log: z.array(logEntrySchema),
});
export type Tournament = z.infer<typeof tournamentSchema>;
