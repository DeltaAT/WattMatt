import { z } from 'zod';

import { roundIdSchema } from '@/domain/ids';
import { bracketRoundSchema } from '@/domain/types';

/**
 * What the beamer is showing, as defined in docs/ARCHITECTURE.md §3.
 *
 * The host sends a scene descriptor rather than a screen name: the beamer owns
 * how a scene looks, the host owns which one is on. A discriminated union means
 * a scene that needs a round cannot be constructed without one (CLAUDE.md §6).
 */
export const beamerSceneSchema = z.discriminatedUnion('id', [
  z.object({ id: z.literal('IDLE') }),
  /*
   * The picture the room fills up in front of (issue #74).
   *
   * Carries nothing, like `NAMING` and for the same reason: what it draws is
   * the tournament's name and how many are registered, and the snapshot already
   * holds both. It is a count and never a roster — who is in is
   * `GROUP_OVERVIEW`, which is a different question and a different screen.
   *
   * Its own id rather than a smarter `IDLE`, because the two say different
   * things: `IDLE` is "nothing is set up yet" and belongs to a host who has not
   * opened a tournament, and this one is "the evening is about to start, and
   * here is how big it has got".
   */
  z.object({ id: z.literal('WELCOME') }),
  z.object({ id: z.literal('BLACKOUT') }),
  z.object({ id: z.literal('GROUP_OVERVIEW') }),
  z.object({ id: z.literal('TABLE_OVERVIEW') }),
  z.object({ id: z.literal('DRAW'), roundId: roundIdSchema }),
  /*
   * The live round of one track — and, when the host asks for it, of both at
   * once (issue #79, docs/TOURNAMENT-RULES.md §10).
   *
   * `roundId` still names one round and stays the whole descriptor for the
   * ordinary case. `split` is a flag rather than a second round id, because the
   * second board is never a *choice*: it is the other track's open round, which
   * the snapshot already carries, and a descriptor that named it could go stale
   * the moment that round closed while this one did not.
   *
   * Optional rather than nullable, so every way of staging the scene that
   * existed before still says exactly what it means: `{ id: 'ROUND_BOARD',
   * roundId }` is one board, and nothing had to learn a new field to keep
   * saying so — the same shape `BRACKET.focus` uses (issue #26).
   */
  z.object({
    id: z.literal('ROUND_BOARD'),
    roundId: roundIdSchema,
    split: z.boolean().optional(),
  }),
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
  /*
   * The `Turnierbaum`, optionally zoomed to one round (issue #26).
   *
   * `focus` is the round the host has asked the projector to concentrate on:
   * the tree is drawn from that round onwards, so the last matches fill the
   * screen while the rounds already played step out of the way. Absent — the
   * ordinary case — means the whole tree.
   *
   * Optional rather than nullable, so every existing way of staging the scene
   * still says exactly what it means: `{ id: 'BRACKET' }` is the whole tree,
   * and nothing had to learn a new field to keep saying so.
   */
  z.object({ id: z.literal('BRACKET'), focus: bracketRoundSchema.optional() }),
  z.object({
    id: z.literal('CEREMONY'),
    reveal: z
      .object({ mode: z.enum(['AUTO', 'STEP']), step: z.number().int().nonnegative() })
      .optional(),
  }),
]);

export type BeamerScene = z.infer<typeof beamerSceneSchema>;
export type BeamerSceneId = BeamerScene['id'];

/** What the beamer shows before anything has been staged on it. */
export const IDLE_SCENE: BeamerScene = { id: 'IDLE' };

/** The welcome picture: what a tournament that has not started yet looks like. */
export const WELCOME_SCENE: BeamerScene = { id: 'WELCOME' };

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
  if (a.id === 'ROUND_BOARD' && b.id === 'ROUND_BOARD') {
    // Splitting the wall in two is a different picture and the beamer animates
    // into it rather than cutting (issue #79) — the same reasoning the tree's
    // focus follows below.
    return a.roundId === b.roundId && (a.split ?? false) === (b.split ?? false);
  }
  if ('roundId' in a && 'roundId' in b) {
    return a.roundId === b.roundId;
  }
  // Zooming the tree to a round is a different picture, and the beamer reveals
  // it rather than cutting to it (issue #26, docs/MOTION.md §4.4).
  if (a.id === 'BRACKET' && b.id === 'BRACKET') {
    return a.focus === b.focus;
  }
  return true;
}
