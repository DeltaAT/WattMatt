import { useEffect, useRef } from 'react';

import type { GroupId, MatchId } from '@/domain/ids';
import type { SnapshotDelivery } from '@/domain/snapshot';
import type { Match } from '@/domain/types';

/**
 * Which results this window has just watched being decided (issue #29,
 * docs/MOTION.md §4.2).
 *
 * The flip is a reaction to a moment: the host marks a winner and the room sees
 * the card turn. Every other way a decided match can appear on screen is not
 * that moment — a beamer reopened mid-round, an undo, the host putting the
 * board up an hour later — and the board has thirty-two of them at a 64-group
 * event. Sixty-four sides flipping at once is over the animated-element budget
 * of §6 and, worse, is a projector replaying results the room already applauded.
 *
 * So the scene animates a difference rather than a state, which is the same
 * shape `useBracketAdvance` and `useRepechageBeat` use and for the same reason
 * (docs/OPEN-QUESTIONS.md #60). Nothing flips on mount, because the first
 * render *is* the resting picture and there is no before to compare it to.
 *
 * Holds no React state: what changed is a fact about two renders, and a state
 * update per result would re-render the board because it just rendered.
 */
const NOTHING: ReadonlySet<MatchId> = new Set();

export function useResultFlip(
  matches: readonly Match[],
  delivery: SnapshotDelivery,
): ReadonlySet<MatchId> {
  // How the board stood the last time this window looked.
  const resting = useRef<ReadonlyMap<MatchId, GroupId>>(decided(matches));

  const now = decided(matches);
  const flipping = delivery === 'catchUp' ? NOTHING : changed(resting.current, now);

  // `useEffect` rather than `useLayoutEffect`: nothing here is measured, so
  // there is nothing that has to happen before the paint — and the board is
  // also rendered on the server by its own tests, where a layout effect is only
  // a warning about work that cannot happen.
  useEffect(() => {
    resting.current = now;
  });

  return flipping;
}

/** Who won, for every match that has been decided. */
function decided(matches: readonly Match[]): ReadonlyMap<MatchId, GroupId> {
  const winners = new Map<MatchId, GroupId>();
  for (const match of matches) {
    if (match.winnerId !== null) {
      winners.set(match.id, match.winnerId);
    }
  }
  return winners;
}

/**
 * The matches whose result is new, or newly different.
 *
 * The second case is the correction the host makes when they mark the wrong
 * winner and put it right: the card has to turn again, the other way, or the
 * room is left looking at a result that changed without anything happening.
 */
function changed(
  before: ReadonlyMap<MatchId, GroupId>,
  after: ReadonlyMap<MatchId, GroupId>,
): ReadonlySet<MatchId> {
  const flipped = new Set<MatchId>();
  for (const [id, winnerId] of after) {
    if (before.get(id) !== winnerId) {
      flipped.add(id);
    }
  }
  return flipped;
}
