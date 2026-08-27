import { describe, expect, it } from 'vitest';

import { havePlayed, playedAgainst, rematchesIn, rematchIds } from '@/domain/history';
import {
  bracketNodeId,
  group,
  groupId,
  match,
  matchId,
  round,
  tournament,
} from '@/domain/testFixtures';
import type { Bracket } from '@/domain/types';

/**
 * The match history (issue #72, docs/TOURNAMENT-RULES.md §3).
 *
 * Everything here is derived from the rounds and the bracket, which is the
 * whole point: there is no field to keep in step, so an undo, a correction or a
 * file repaired by hand can never leave the history saying something the
 * matches do not.
 */

const four = [group(1), group(2), group(3), group(4)];

describe('playedAgainst', () => {
  it('remembers nothing before the first round', () => {
    expect(playedAgainst(tournament({ groups: four }))).toEqual(new Map());
  });

  it('records a pairing from both sides', () => {
    const document = tournament({
      groups: four,
      rounds: [round(1, { matches: [match(1, { a: groupId(1), b: groupId(2) })] })],
    });

    const history = playedAgainst(document);

    expect(havePlayed(history, groupId(1), groupId(2))).toBe(true);
    expect(havePlayed(history, groupId(2), groupId(1))).toBe(true);
    expect(havePlayed(history, groupId(1), groupId(3))).toBe(false);
  });

  it('ignores a bye, which nobody played', () => {
    const document = tournament({
      groups: four,
      rounds: [
        round(1, {
          matches: [match(1, { a: groupId(3), b: null, winnerId: groupId(3), status: 'DONE' })],
        }),
      ],
    });

    expect(playedAgainst(document)).toEqual(new Map());
  });

  it('carries a repechage returnee back in with their round-1 history', () => {
    // Group 2 lost round 1 to group 1, was drawn back in, and is in the field
    // for round 2. The draw must still keep them apart (issue #72).
    const document = tournament({
      groups: four,
      rounds: [
        round(1, {
          state: 'CLOSED',
          matches: [match(1, { a: groupId(1), b: groupId(2), winnerId: groupId(1) })],
        }),
      ],
      repechage: {
        target: 4,
        pool: [],
        draws: [{ groupId: groupId(2), accepted: true }],
        fallbackUsed: null,
      },
    });

    expect(havePlayed(playedAgainst(document), groupId(2), groupId(1))).toBe(true);
  });

  it('counts a bracket node as played', () => {
    const bracket: Bracket = {
      size: 2,
      nodes: [
        {
          id: bracketNodeId(1),
          round: 'FINAL',
          slotA: groupId(1),
          slotB: groupId(4),
          winnerId: null,
          nextNodeId: null,
          tableId: null,
        },
      ],
      thirdPlaceNodeId: null,
    };

    expect(
      havePlayed(playedAgainst(tournament({ groups: four, bracket })), groupId(1), groupId(4)),
    ).toBe(true);
  });
});

describe('rematchIds', () => {
  it('is empty when nobody meets twice', () => {
    const document = tournament({
      groups: four,
      rounds: [
        round(1, { matches: [match(1, { a: groupId(1), b: groupId(2) })] }),
        round(2, { matches: [match(2, { a: groupId(1), b: groupId(3) })] }),
      ],
    });

    expect(rematchIds(document)).toEqual(new Set());
  });

  it('flags the later meeting and not the first one', () => {
    const document = tournament({
      groups: four,
      rounds: [
        round(1, { matches: [match(1, { a: groupId(1), b: groupId(2) })] }),
        round(2, { matches: [match(2, { a: groupId(2), b: groupId(1) })] }),
      ],
    });

    expect(rematchIds(document)).toEqual(new Set([matchId(2)]));
  });

  it('names only the matches of the round it is asked about', () => {
    const first = round(1, { matches: [match(1, { a: groupId(1), b: groupId(2) })] });
    const second = round(2, { matches: [match(2, { a: groupId(1), b: groupId(2) })] });
    const document = tournament({ groups: four, rounds: [first, second] });

    expect(rematchesIn(document, first)).toEqual([]);
    expect(rematchesIn(document, second).map((repeat) => repeat.id)).toEqual([matchId(2)]);
  });
});
