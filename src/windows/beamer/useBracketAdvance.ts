import { useLayoutEffect, useRef, type RefCallback } from 'react';

import { chipOrigin, type BracketSide } from '@/domain/bracket';
import type { BracketNodeId, GroupId } from '@/domain/ids';
import type { SnapshotDelivery } from '@/domain/snapshot';
import type { Bracket } from '@/domain/types';
import { prefersReducedMotion } from '@/windows/beamer/reducedMotion';

/**
 * The winner's chip *moving* into the round above (issue #25,
 * docs/MOTION.md §4.4).
 *
 * The rule this exists for is a sentence from the issue: "the audience must be
 * able to follow the team with their eyes". A chip that faded out of a
 * `Viertelfinale` and faded into a `Halbfinale` is two things happening; a chip
 * that travels is one team advancing, and that is the difference between a room
 * that can follow a bracket and a room that has to be told what happened.
 *
 * **Measured, not choreographed.** How far a chip travels depends on where the
 * two nodes ended up — which depends on the bracket size, the scale
 * `useFitToStage` settled on and the length of the names around it. No keyframe
 * can know that, so this reads both rectangles after the browser has laid the
 * new tree out, puts the chip back where it came from with a transform, and
 * lets it ride home on the transition `wm-bracket-advance` carries. The classic
 * FLIP, and the same thing a Motion `layoutId` does internally
 * (docs/OPEN-QUESTIONS.md #70).
 *
 * **A window only animates what it watched happen.** `delivery` is the same
 * flag `useRepechageBeat` reads and for the same reason (docs/OPEN-QUESTIONS.md
 * #60): a projector reopened during the semi-finals, and a host undoing a
 * misclick, both arrive as `catchUp` and must show the tree as it stands. Only
 * a `live` snapshot that actually filled a slot moves anything.
 *
 * Nothing here holds React state. A chip's position is not something the tree
 * needs re-rendering to know, and a state update per result would re-run the
 * measurement it just took.
 */

/** One slot of one node: what a chip is, and what can be moved. */
export type ChipKey = string;

export function chipKey(nodeId: BracketNodeId, side: BracketSide): ChipKey {
  return `${nodeId}:${side}`;
}

export interface BracketAdvance {
  /**
   * Attach to every chip, so the ones that move can be found again.
   *
   * A chip is registered under its slot rather than under its participant: the
   * same team is two chips while it is advancing — the one it won in and the
   * one it is arriving at — and the whole animation is about the distance
   * between them.
   */
  chip: (key: ChipKey) => RefCallback<HTMLElement>;
  /** The chips this window has just watched arrive. */
  arriving: ReadonlySet<ChipKey>;
}

const NOTHING: ReadonlySet<ChipKey> = new Set();

export function useBracketAdvance(
  bracket: Bracket | null,
  delivery: SnapshotDelivery,
): BracketAdvance {
  const elements = useRef(new Map<ChipKey, HTMLElement>());
  // Where the tree stood the last time this window looked. A ref rather than
  // state: it is the *previous* picture, and re-rendering because it changed
  // would be re-rendering because the render happened.
  const resting = useRef<ReadonlyMap<ChipKey, GroupId>>(occupancy(bracket));

  const filled = occupancy(bracket);
  const arriving = delivery === 'catchUp' ? NOTHING : newlyFilled(resting.current, filled);

  useLayoutEffect(() => {
    // Before the paint that would show the chip in its new slot, never after:
    // an effect that ran a frame later would let the audience see it arrive and
    // then jump back to where it came from.
    if (bracket !== null && arriving.size > 0 && !prefersReducedMotion()) {
      for (const key of arriving) {
        flip(bracket, key, elements.current);
      }
    }
    resting.current = filled;
  });

  return {
    chip: (key: ChipKey) => (element: HTMLElement | null) => {
      if (element === null) {
        elements.current.delete(key);
        return;
      }
      elements.current.set(key, element);
    },
    arriving,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Who is standing in which slot, which is the whole of what can change here. */
function occupancy(bracket: Bracket | null): ReadonlyMap<ChipKey, GroupId> {
  const filled = new Map<ChipKey, GroupId>();
  for (const node of bracket?.nodes ?? []) {
    if (node.slotA !== null) {
      filled.set(chipKey(node.id, 'A'), node.slotA);
    }
    if (node.slotB !== null) {
      filled.set(chipKey(node.id, 'B'), node.slotB);
    }
  }
  return filled;
}

/**
 * The slots that have just been filled, or filled by somebody else.
 *
 * The second case is a correction: the host marks the wrong winner, puts it
 * right, and the chip standing in the round above is replaced. That is a chip
 * arriving as much as the first one was, and it has to travel from the same
 * place the corrected result came from.
 */
function newlyFilled(
  before: ReadonlyMap<ChipKey, GroupId>,
  after: ReadonlyMap<ChipKey, GroupId>,
): ReadonlySet<ChipKey> {
  const arrived = new Set<ChipKey>();
  for (const [key, groupId] of after) {
    if (before.get(key) !== groupId) {
      arrived.add(key);
    }
  }
  return arrived;
}

/**
 * Puts one chip back where it came from, then lets it travel.
 *
 * Hands the tournament back untouched — visually — whenever it cannot measure
 * the trip: a chip drawn into the first round has nowhere to come from, and a
 * layout with no geometry (a window that has not painted, jsdom) yields a
 * distance of zero. In both cases the chip simply appears, which is exactly
 * what it should do.
 */
function flip(bracket: Bracket, key: ChipKey, elements: ReadonlyMap<ChipKey, HTMLElement>): void {
  const element = elements.get(key);
  const origin = originOf(bracket, key);
  const source = origin === null ? undefined : elements.get(origin);
  if (element === undefined || source === undefined) {
    return;
  }

  const from = source.getBoundingClientRect();
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (dx === 0 && dy === 0) {
    return;
  }

  element.style.transition = 'none';
  element.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;

  // Next frame, so the browser has painted the inverted position and has
  // something to transition *from*. Clearing both properties hands the chip
  // back to `wm-bracket-advance`, which owns the duration and the easing.
  requestAnimationFrame(() => {
    element.style.transition = '';
    element.style.transform = '';
  });
}

/** The chip a slot's occupant travelled from, as a key. */
function originOf(bracket: Bracket, key: ChipKey): ChipKey | null {
  const divider = key.lastIndexOf(':');
  const nodeId = key.slice(0, divider) as BracketNodeId;
  const side = key.slice(divider + 1) === 'A' ? 'A' : 'B';

  const origin = chipOrigin(bracket, nodeId, side);
  return origin === null ? null : chipKey(origin.nodeId, origin.side);
}
