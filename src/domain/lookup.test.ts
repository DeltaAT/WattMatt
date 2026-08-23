import { describe, expect, it } from 'vitest';

import { bracketNodeIdSchema } from '@/domain/ids';
import { allMatches, indexById, indexTournament } from '@/domain/lookup';
import {
  group,
  groupId,
  match,
  matchId,
  round,
  roundId,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import type { Bracket } from '@/domain/types';

describe('indexById', () => {
  it('keys entities by their ID', () => {
    const index = indexById([group(1), group(2)]);
    expect(index.get(groupId(2))?.number).toBe(2);
  });

  it('returns undefined for an ID that is not there', () => {
    expect(indexById([group(1)]).get(groupId(9))).toBeUndefined();
  });

  it('handles an empty collection', () => {
    expect(indexById([]).size).toBe(0);
  });

  /*
   * A duplicate ID means a corrupt file or a broken action. Letting the later
   * entity win would surface as the wrong card turning green mid-round, so it
   * throws at index time instead.
   */
  it('throws on a duplicate ID rather than letting the last one win', () => {
    expect(() => indexById([group(1), group(1, { number: 7 })])).toThrow(/Duplicate entity id/);
  });
});

describe('allMatches', () => {
  it('flattens every round in order', () => {
    const state = tournament({
      rounds: [round(1, { matches: [match(1), match(2)] }), round(2, { matches: [match(3)] })],
    });

    expect(allMatches(state).map((entry) => entry.id)).toEqual([
      matchId(1),
      matchId(2),
      matchId(3),
    ]);
  });

  it('is empty before the first draw', () => {
    expect(allMatches(tournament())).toEqual([]);
  });
});

describe('indexTournament', () => {
  it('indexes every entity type at once', () => {
    const bracket: Bracket = {
      size: 2,
      nodes: [
        {
          id: bracketNodeIdSchema.parse('bn_1'),
          round: 'FINAL',
          slotA: groupId(1),
          slotB: groupId(2),
          winnerId: null,
          nextNodeId: null,
          tableId: null,
        },
      ],
      thirdPlaceNodeId: null,
    };

    const state = tournament({
      groups: [group(1), group(2)],
      tables: [table(1)],
      rounds: [round(1, { matches: [match(1)] })],
      bracket,
    });

    const index = indexTournament(state);
    expect(index.groups.get(groupId(1))?.number).toBe(1);
    expect(index.tables.get(tableId(1))?.label).toBe('Tisch 1');
    expect(index.rounds.get(roundId(1))?.index).toBe(1);
    expect(index.matches.get(matchId(1))?.id).toBe(matchId(1));
    expect(index.bracketNodes.get(bracketNodeIdSchema.parse('bn_1'))?.round).toBe('FINAL');
  });

  /* The bracket is null for most of the event; indexing must not require one. */
  it('yields an empty bracket index while there is no bracket', () => {
    expect(indexTournament(tournament()).bracketNodes.size).toBe(0);
  });

  it('indexes matches across rounds, not just the current one', () => {
    const state = tournament({
      rounds: [round(1, { matches: [match(1)] }), round(2, { matches: [match(2)] })],
    });

    expect(indexTournament(state).matches.size).toBe(2);
  });
});
