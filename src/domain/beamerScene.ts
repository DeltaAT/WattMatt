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
  /*
   * The `Hoffnungsrunde` carries no round id, unlike the two scenes above it
   * (issue #21, docs/OPEN-QUESTIONS.md #59).
   *
   * There is no round to name. The phase is not one: it produces no pairings
   * and appends nothing to `rounds`, and everything it shows lives in
   * `tournament.repechage`, of which a tournament has exactly one. A qualifying
   * round id would also be a promise the beamer could not keep — the qualifying
   * round is `CLOSED` by then, so the snapshot carries no round at all and the
   * guard the other two use could never match.
   */
  z.object({ id: z.literal('REPECHAGE') }),
  /*
   * The holding picture the room is shown while the host enters names
   * (issue #23, docs/TOURNAMENT-RULES.md §6).
   *
   * A scene of its own rather than `IDLE`, because it is not idleness: the
   * evening is between two things the audience has been watching, and the wall
   * has to say so. It carries nothing — what it draws is the tournament's name
   * and how many are through, both of which the snapshot already holds — and
   * deliberately not the names themselves, which are half-entered for the whole
   * of this phase.
   */
  z.object({ id: z.literal('NAMING') }),
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
