import { z } from 'zod';

import { roundIdSchema } from '@/domain/ids';

/**
 * What the beamer is showing, as defined in docs/ARCHITECTURE.md §3.
 *
 * The host sends a scene descriptor rather than a screen name: the beamer owns
 * how a scene looks, the host owns which one is on. A discriminated union means
 * a scene that needs a round cannot be constructed without one (CLAUDE.md §6).
 */
export const beamerSceneSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('IDLE') }),
  z.object({ id: z.literal('BLACKOUT') }),
  z.object({ id: z.literal('GROUP_OVERVIEW') }),
  z.object({ id: z.literal('TABLE_OVERVIEW') }),
  z.object({ id: z.literal('DRAW'), roundId: roundIdSchema }),
  z.object({ id: z.literal('ROUND_BOARD'), roundId: roundIdSchema }),
  z.object({ id: z.literal('REPECHAGE'), roundId: roundIdSchema }),
  z.object({ id: z.literal('BRACKET') }),
  z.object({ id: z.literal('CEREMONY') }),
]);

export type BeamerScene = z.infer<typeof beamerSceneSchema>;
export type BeamerSceneId = BeamerScene['id'];

/** What the beamer shows before anything has been staged on it. */
export const IDLE_SCENE: BeamerScene = { id: 'IDLE' };

/** The host's emergency "show nothing" (issue #28 wires the control). */
export const BLACKOUT_SCENE: BeamerScene = { id: 'BLACKOUT' };

/**
 * Whether two descriptors name the same picture.
 *
 * The beamer animates *into* a new scene and must not re-animate one it is
 * already showing — a re-delivered snapshot after a reconnect would otherwise
 * replay the draw in front of the audience (issue #5 acceptance criteria).
 */
export function isSameScene(a: BeamerScene, b: BeamerScene): boolean {
  if (a.id !== b.id) {
    return false;
  }
  return 'roundId' in a && 'roundId' in b ? a.roundId === b.roundId : true;
}
