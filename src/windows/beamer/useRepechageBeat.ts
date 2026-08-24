import { useRef } from 'react';

import type { GroupId } from '@/domain/ids';
import type { SnapshotDelivery } from '@/domain/snapshot';
import type { RepechageDraw } from '@/domain/types';

/**
 * Which repechage card, if any, this window is allowed to animate (issue #21,
 * docs/OPEN-QUESTIONS.md #60).
 *
 * The `REPECHAGE` scene has no timeline of its own — its beats are the host's
 * clicks, arriving one snapshot at a time. So the question it cannot answer for
 * itself is the one every beamer scene has to answer: *did this window watch
 * the answer land, or arrive to find it already given?* A projector reopened
 * between two candidates must show the pot as it stands, not shake a card that
 * was turned down ten minutes ago (CLAUDE.md golden rule 4, and the same
 * reasoning as `useDrawSequence`'s `startedSettled`).
 *
 * Neither of the two flags the scene already has can answer it.
 * `snapshot.animate` is `delivery === 'live' && !sameScene`, so it is false for
 * every commit that leaves the same scene staged — which is every draw and
 * every answer of this whole phase, and reading it would mean nothing ever
 * animated after the first frame. And the beat is not a property of the scene
 * either: the scene does not change when a candidate is drawn.
 *
 * So the beat is named instead — the group the last draw was about, together
 * with what became of them. Whatever this window arrives on is its resting
 * state and never plays; a key it has not seen before was witnessed live and
 * does. `delivery` is what separates the two: a catch-up and an undo both
 * arrive as `catchUp` (issue #11), and both re-set the resting state rather
 * than playing into it — the host correcting a misclick must not make the room
 * watch somebody be turned down a second time.
 */
export function useRepechageBeat(
  last: RepechageDraw | null,
  delivery: SnapshotDelivery,
): GroupId | null {
  const key = last === null ? null : `${last.groupId}:${String(last.accepted)}`;

  // The beat this window is at rest on. A ref rather than state: it is read
  // during the render that establishes it, and must never cause one of its own.
  const resting = useRef<string | null>(key);

  if (delivery === 'catchUp') {
    resting.current = key;
    return null;
  }

  // Deliberately not advanced when a beat plays. The class stays on the card
  // for as long as that beat is the last one, so an unrelated commit — a table
  // renamed, the host's own panel redrawing — cannot pull it off half-way
  // through and cut the animation short in front of the room.
  return key === null || key === resting.current ? null : (last?.groupId ?? null);
}
