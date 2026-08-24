// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { RepechageDraw, SnapshotDelivery } from '@/domain';
import { groupId } from '@/domain/testFixtures';
import { useRepechageBeat } from '@/windows/beamer/useRepechageBeat';

/**
 * Which repechage card this window may animate (issue #21).
 *
 * The one question the scene cannot answer for itself: did this window watch
 * the answer land, or arrive to find it already given? Everything below is a
 * case where getting it wrong shows the audience something that is not
 * happening (CLAUDE.md golden rule 4).
 */

afterEach(cleanup);

const drawn = (n: number, accepted: boolean | null): RepechageDraw => ({
  groupId: groupId(n),
  accepted,
});

function mounted(last: RepechageDraw | null, delivery: SnapshotDelivery = 'live') {
  return renderHook(
    ({ draw, how }: { draw: RepechageDraw | null; how: SnapshotDelivery }) =>
      useRepechageBeat(draw, how),
    { initialProps: { draw: last, how: delivery } },
  );
}

describe('the repechage beat', () => {
  it('is nothing at all before the first candidate is drawn', () => {
    expect(mounted(null).result.current).toBeNull();
  });

  /**
   * A beamer reopened between two candidates. It arrives on a decline that
   * happened ten minutes ago, and must show the pot as it stands rather than
   * shaking a card the room has stopped looking at.
   */
  it('never plays the beat the window arrived on', () => {
    expect(mounted(drawn(4, false)).result.current).toBeNull();
    expect(mounted(drawn(4, true)).result.current).toBeNull();
    expect(mounted(drawn(4, null)).result.current).toBeNull();
  });

  it('plays a candidate drawn while the window was watching', () => {
    const { result, rerender } = mounted(null);

    rerender({ draw: drawn(4, null), how: 'live' });

    expect(result.current).toBe(groupId(4));
  });

  /*
   * The same card, a different beat: the answer is a new key, so the class on
   * the card changes and the animation runs. Without this an accept would land
   * silently on the card that was already lifted.
   */
  it('plays the answer to a candidate it already watched being drawn', () => {
    const { result, rerender } = mounted(null);

    rerender({ draw: drawn(4, null), how: 'live' });
    rerender({ draw: drawn(4, true), how: 'live' });

    expect(result.current).toBe(groupId(4));
  });

  /**
   * An undo and a redo arrive as `catchUp` (issue #11). The host correcting a
   * misclick must not make the room watch somebody be turned down a second
   * time — the picture is put back, not played out.
   */
  it('plays nothing when the picture is being put back', () => {
    const { result, rerender } = mounted(null);

    rerender({ draw: drawn(4, null), how: 'live' });
    rerender({ draw: drawn(4, false), how: 'catchUp' });

    expect(result.current).toBeNull();
  });

  it('takes the rewound beat as its new resting state', () => {
    const { result, rerender } = mounted(null);

    rerender({ draw: drawn(4, null), how: 'live' });
    // Undone back to the draw, then re-delivered live by an unrelated commit.
    rerender({ draw: drawn(4, null), how: 'catchUp' });
    rerender({ draw: drawn(4, null), how: 'live' });

    expect(result.current).toBeNull();

    // …and the next real decision still plays.
    rerender({ draw: drawn(4, true), how: 'live' });
    expect(result.current).toBe(groupId(4));
  });

  /**
   * A commit that has nothing to do with this phase — a table renamed, the
   * host's own panel redrawing — re-delivers the same beat. The class has to
   * stay on the card, or the animation is cut off half-way in front of the room.
   */
  it('holds the beat while unrelated commits arrive', () => {
    const { result, rerender } = mounted(null);

    rerender({ draw: drawn(4, null), how: 'live' });
    rerender({ draw: drawn(4, null), how: 'live' });

    expect(result.current).toBe(groupId(4));
  });
});
