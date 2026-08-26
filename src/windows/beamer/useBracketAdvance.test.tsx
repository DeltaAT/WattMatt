// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { buildBracket, setBracketWinner } from '@/domain/bracket';
import type { BracketNodeId, GroupId } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import type { SnapshotDelivery } from '@/domain/snapshot';
import { group, tournament } from '@/domain/testFixtures';
import type { Bracket, Tournament } from '@/domain/types';
import { chipKey, useBracketAdvance } from '@/windows/beamer/useBracketAdvance';

/**
 * Which chips this window may move (issue #25, docs/MOTION.md §4.4).
 *
 * The hook answers the one question the tree cannot answer for itself: *did
 * this window watch that result land?* A projector reopened during the
 * semi-finals, and a host undoing a misclick, both arrive at a bracket with
 * chips already advanced — and flying them across the wall at that point shows
 * the audience something that is not happening (CLAUDE.md golden rule 4).
 *
 * The FLIP itself needs real geometry, which jsdom has none of: every rectangle
 * there is zero, so the transform is skipped and nothing is asserted about it.
 * What is asserted is the part that decides whether anything moves at all.
 */

afterEach(cleanup);

function played(): Tournament {
  const groups = Array.from({ length: 4 }, (_unused, index) =>
    group(index + 1, { name: `Team ${index + 1}` }),
  );
  return tournament({
    phase: 'BRACKET',
    groups,
    nextGroupNumber: 5,
    bracket: buildBracket(groups, { rng: createRng('seed') }),
  });
}

function decide(document: Tournament, nodeId: string): Tournament {
  const node = document.bracket?.nodes.find((candidate) => candidate.id === nodeId);
  return setBracketWinner(document, nodeId as BracketNodeId, node?.slotA as GroupId);
}

function mounted(bracket: Bracket | null, delivery: SnapshotDelivery = 'live') {
  return renderHook(
    ({ tree, how }: { tree: Bracket | null; how: SnapshotDelivery }) =>
      useBracketAdvance(tree, how),
    { initialProps: { tree: bracket, how: delivery } },
  );
}

describe('the bracket advance', () => {
  it('moves nothing on the picture a window arrives on', () => {
    const decided = decide(played(), 'bn_1');

    expect(mounted(decided.bracket).result.current.arriving.size).toBe(0);
  });

  it('moves the chip a result has just sent up', () => {
    const before = played();
    const { result, rerender } = mounted(before.bracket);

    rerender({ tree: decide(before, 'bn_1').bracket, how: 'live' });

    // The winner into the final, and the loser into the third-place match —
    // one `Halbfinale` fills two slots (docs/TOURNAMENT-RULES.md §7).
    expect([...result.current.arriving].sort()).toEqual([
      chipKey('bn_3' as BracketNodeId, 'A'),
      chipKey('bn_4' as BracketNodeId, 'A'),
    ]);
  });

  /*
   * A beamer reopened mid-phase, and an undo, both arrive as `catchUp`
   * (issue #11). Neither may play anything out in front of the room.
   */
  it('moves nothing when the snapshot is a catch-up', () => {
    const before = played();
    const { result, rerender } = mounted(before.bracket, 'catchUp');

    rerender({ tree: decide(before, 'bn_1').bracket, how: 'catchUp' });

    expect(result.current.arriving.size).toBe(0);
  });

  it('moves the replacement when the host corrects a result', () => {
    const first = decide(played(), 'bn_1');
    const { result, rerender } = mounted(first.bracket);
    const semi = first.bracket?.nodes[0];

    const corrected = setBracketWinner(first, semi?.id as BracketNodeId, semi?.slotB as GroupId);
    rerender({ tree: corrected.bracket, how: 'live' });

    // Both slots the semi-final feeds now hold somebody else.
    expect([...result.current.arriving].sort()).toEqual([
      chipKey('bn_3' as BracketNodeId, 'A'),
      chipKey('bn_4' as BracketNodeId, 'A'),
    ]);
  });

  it('moves nothing when nothing about the tree changed', () => {
    const before = played();
    const { result, rerender } = mounted(before.bracket);

    rerender({ tree: before.bracket, how: 'live' });

    expect(result.current.arriving.size).toBe(0);
  });

  it('survives a tournament with no bracket at all', () => {
    const { result } = mounted(null);

    expect(result.current.arriving.size).toBe(0);
    // The ref callback still has to be safe to attach and to detach.
    expect(() => {
      result.current.chip('bn_1:A')(null);
    }).not.toThrow();
  });
});
