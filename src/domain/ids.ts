import { z } from 'zod';

/**
 * Branded IDs (CLAUDE.md §6): an ID is never a bare `string`, so a `RoundId`
 * cannot be passed where a `GroupId` belongs. The brand exists only in the type
 * system — at runtime every ID is the plain string the file format stores.
 *
 * The prefixes below are the ones docs/FILE-FORMAT.md §"Schema (v8)" writes
 * (`grp_1`, `tbl_1`, `mt_3`, …). They are not validated: a file written by an
 * older build, or repaired by hand in Notepad as FILE-FORMAT invites, must
 * still open. Uniqueness is what matters, and that is checked where entities
 * are indexed (`@/domain/lookup`), not per string.
 */

export const tournamentIdSchema = z.string().min(1).brand<'TournamentId'>();
export type TournamentId = z.infer<typeof tournamentIdSchema>;

export const groupIdSchema = z.string().min(1).brand<'GroupId'>();
export type GroupId = z.infer<typeof groupIdSchema>;

export const tableIdSchema = z.string().min(1).brand<'TableId'>();
export type TableId = z.infer<typeof tableIdSchema>;

export const matchIdSchema = z.string().min(1).brand<'MatchId'>();
export type MatchId = z.infer<typeof matchIdSchema>;

export const roundIdSchema = z.string().min(1).brand<'RoundId'>();
export type RoundId = z.infer<typeof roundIdSchema>;

export const bracketNodeIdSchema = z.string().min(1).brand<'BracketNodeId'>();
export type BracketNodeId = z.infer<typeof bracketNodeIdSchema>;
