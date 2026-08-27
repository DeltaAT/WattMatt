import { useRef } from 'react';

import type { SnapshotDelivery } from '@/domain/snapshot';

/**
 * How many times this window has watched a number change (issue #74,
 * docs/MOTION.md §4.7).
 *
 * The welcome screen is on the wall for the half hour in which the room fills
 * up, and the one thing on it that moves is the count. The issue's note is the
 * whole design constraint: the host may add forty groups in under a minute, so
 * whatever happens when the number changes must be *one small element moving*
 * and never the screen re-entering. A full scene animation forty times over is
 * strobing at an audience.
 *
 * Returned as a **generation** rather than a boolean, and that is the part that
 * matters. A CSS animation does not replay because a class was applied a second
 * time, so the pulse has to arrive as a fresh element — the scene keys the digit
 * on this number. A counter also means an unrelated commit landing mid-pulse
 * neither restarts the animation nor cuts it short: the generation has not
 * moved, so React keeps the element it already has (the same reason
 * `useRepechageBeat` does not advance its resting beat when one plays).
 *
 * `0` is "nothing has changed in front of this window yet", which is what the
 * first render always is: the count it arrives on is the resting picture, not a
 * moment. A catch-up re-sets that resting count without advancing anything —
 * a beamer reopened during registration, and a host undoing a group they added
 * by mistake, both arrive as `catchUp` (issue #11) and neither is a tick the
 * room watched happen (CLAUDE.md golden rule 4).
 *
 * Holds no React state: what changed is a fact about two renders, and a state
 * update per group added would re-render the scene because it just rendered.
 */
export function useCountPulse(count: number, delivery: SnapshotDelivery): number {
  // The count this window is at rest on, and how many ticks it has shown.
  // Refs rather than state: both are read during the render that establishes
  // them, and neither may cause a render of its own.
  const resting = useRef(count);
  const generation = useRef(0);

  if (delivery === 'catchUp') {
    resting.current = count;
  } else if (count !== resting.current) {
    resting.current = count;
    generation.current += 1;
  }

  return generation.current;
}
