import { z } from 'zod';

import { beamerSceneSchema, IDLE_SCENE } from '@/domain/beamerScene';
import { groupIdSchema } from '@/domain/ids';

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
 * Issue #7 owns the real domain model. Until it lands this carries the one
 * entity the channel can be built and profiled against — a group is a numbered,
 * optionally named unit and nothing more (docs/GLOSSARY.md). #7 extends this
 * schema; it does not replace the envelope around it.
 */
export const groupSnapshotSchema = z.object({
  id: groupIdSchema,
  number: z.number().int().positive(),
  name: z.string().nullable(),
});

export type GroupSnapshot = z.infer<typeof groupSnapshotSchema>;

export const tournamentSnapshotSchema = z.object({
  groups: z.array(groupSnapshotSchema),
});

export type TournamentSnapshot = z.infer<typeof tournamentSnapshotSchema>;

/**
 * Why this snapshot was sent.
 *
 * `catchUp` answers a beamer that just mounted and is rendering a scene it has
 * never shown before. It must appear already settled: replaying the draw
 * animation because the beamer window was reopened would show the audience a
 * draw that is not happening (issue #5 acceptance criteria).
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

export const EMPTY_TOURNAMENT: TournamentSnapshot = { groups: [] };

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
