import { z } from 'zod';

/**
 * Branded IDs (CLAUDE.md §6): an ID is never a bare `string`, so a `RoundId`
 * cannot be passed where a `GroupId` belongs.
 *
 * Issue #7 owns the domain model. This file carries only the IDs the beamer
 * scene contract needs, so issue #5 can define that contract without inventing
 * the rest of the model first — and #7 extends it rather than replacing it.
 */

export const roundIdSchema = z.string().min(1).brand<'RoundId'>();
export type RoundId = z.infer<typeof roundIdSchema>;

export const groupIdSchema = z.string().min(1).brand<'GroupId'>();
export type GroupId = z.infer<typeof groupIdSchema>;
