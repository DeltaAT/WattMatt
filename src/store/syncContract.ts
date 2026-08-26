import { z } from 'zod';

import { beamerSceneSchema } from '@/domain/beamerScene';
import { snapshotDeliverySchema } from '@/domain/snapshot';

import type { ZodType } from 'zod';

/**
 * The typed event contract between the two windows (docs/ARCHITECTURE.md §3).
 *
 * One direction carries truth (host → beamer), the other carries only requests
 * and liveness (beamer → host). There is deliberately no event by which the
 * beamer can change the tournament: golden rule 4 is enforced by the contract
 * having no such message, not by the beamer choosing not to send one.
 */

/** Host → beamer. The whole picture. */
export const SNAPSHOT_EVENT = 'state:snapshot';

/** Beamer → host. "I just started, tell me everything." */
export const REQUEST_SNAPSHOT_EVENT = 'state:request-snapshot';

/**
 * Host → beamer. What the host is driving, without the tournament payload.
 *
 * Exists because a blackout must land immediately and unconditionally; making
 * the host's panic button wait behind sixty-four groups of data is the wrong
 * trade. Carries the same revision as a snapshot so the channels stay ordered.
 */
export const SCENE_EVENT = 'beamer:scene';

/** Beamer → host. Proof the projector window is still alive. */
export const HEARTBEAT_EVENT = 'beamer:heartbeat';

export const sceneMessageSchema = z.object({
  revision: z.number().int().nonnegative(),
  scene: beamerSceneSchema,
  autoFollow: z.boolean(),
  /** See `snapshotSchema`: the host's skip, carried as a count (issue #28). */
  skipToken: z.number().int().nonnegative().default(0),
  delivery: snapshotDeliverySchema,
});

export type SceneMessage = z.infer<typeof sceneMessageSchema>;

export const heartbeatSchema = z.object({
  /** Counts beats within one beamer session; resets when the window restarts. */
  beat: z.number().int().nonnegative(),
});

export type Heartbeat = z.infer<typeof heartbeatSchema>;

/** A request carries nothing — its arrival is the whole message. */
export const requestSnapshotSchema = z.object({}).loose();

export type Unsubscribe = () => void;

/**
 * How the two windows talk.
 *
 * An interface rather than a direct Tauri call so the layer can be tested in
 * full without a backend, and so a future transport (a mock beamer in the host
 * window, issue #28's live preview) plugs in without touching the logic.
 */
export interface SyncTransport {
  emit(event: string, payload: unknown): Promise<void>;
  listen<T>(
    event: string,
    schema: ZodType<T>,
    onMessage: (payload: T) => void,
  ): Promise<Unsubscribe>;
}
