import { describe, expect, it } from 'vitest';

import {
  activeBracketRound,
  assignBracketNode,
  bracketCorrection,
  bracketNodeState,
  bracketNodeTableId,
  assignNextBracketNode,
  bracketBlockers,
  bracketColumns,
  bracketRoundForSize,
  buildBracket,
  chipOrigin,
  canDrawBracket,
  canFinishBracket,
  drawBracket,
  finishBracket,
  forcedBracketRematches,
  previewDrawBracket,
  finalStandings,
  finalStandingsOf,
  hasThirdPlace,
  isBracketComplete,
  nextQueuedBracketNode,
  queuedBracketNodes,
  setBracketWinner,
} from '@/domain/bracket';
import type { BracketNodeId, GroupId } from '@/domain/ids';
import { createRng } from '@/domain/rng';
import {
  disableTable,
  occupancyBoard,
  matchesOnTables,
  removeTable,
  REQUEUE,
} from '@/domain/tables';
import {
  FIXED_NOW,
  group,
  groupId,
  match,
  round,
  table,
  tableId,
  tournament,
} from '@/domain/testFixtures';
import type { Bracket, BracketNode, BracketRound, Group, Table, Tournament } from '@/domain/types';

/**
 * The bracket (issue #24, docs/TOURNAMENT-RULES.md §7).
 *
 * The two acceptance criteria are the spine of this file: a group can never
 * appear in two nodes of the same round, and the tree is fully determined by
 * `(seed, group list)`. Both are checked over every size the final phase can
 * start at — 16, 8, 4 and 2 (§9 case 10) — rather than over the 16 a large
 * tournament happens to reach.
 */

const NAMED = 'Team';

function named(count: number): Group[] {
  return Array.from({ length: count }, (_unused, index) =>
    group(index + 1, { name: `${NAMED} ${index + 1}` }),
  );
}

/** A tournament sitting in `NAMING` with everybody named — the draw's input. */
function readyToDraw(count: number, overrides: Partial<Tournament> = {}): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: named(count),
    nextGroupNumber: count + 1,
    ...overrides,
  });
}

function nodesOf(bracket: Bracket, round: BracketRound): readonly BracketNode[] {
  return bracket.nodes.filter((node) => node.round === round);
}

function nodeById(bracket: Bracket, id: BracketNodeId | null): BracketNode | undefined {
  return bracket.nodes.find((node) => node.id === id);
}

/** Everybody the first round of a bracket puts on the board, byes included. */
function firstRoundEntrants(bracket: Bracket): GroupId[] {
  const first = bracket.size === 2 ? 'FINAL' : firstRoundName(bracket.size);
  return nodesOf(bracket, first).flatMap((node) =>
    [node.slotA, node.slotB].filter((slot): slot is GroupId => slot !== null),
  );
}

function firstRoundName(size: number): BracketRound {
  switch (size) {
    case 16:
      return 'ROUND_OF_16';
    case 8:
      return 'QUARTER_FINAL';
    case 4:
      return 'SEMI_FINAL';
    default:
      return 'FINAL';
  }
}

/** The bracket of a tournament that has one, for the tests that assume it. */
function bracketOf(document: Tournament): Bracket {
  const bracket = document.bracket;
  if (bracket === null) {
    throw new Error('expected a bracket');
  }
  return bracket;
}

describe('buildBracket', () => {
  it.each([
    [16, 'ROUND_OF_16', 15 + 1],
    [8, 'QUARTER_FINAL', 7 + 1],
    [4, 'SEMI_FINAL', 3 + 1],
  ] as const)('builds a field of %i as a full tree', (size, firstRound, nodeCount) => {
    const bracket = buildBracket(named(size), { rng: createRng('seed') });

    expect(bracket.size).toBe(size);
    // Every round halves, plus the `Spiel um Platz 3` (§7).
    expect(bracket.nodes).toHaveLength(nodeCount);
    expect(nodesOf(bracket, firstRound)).toHaveLength(size / 2);
    expect(nodesOf(bracket, 'FINAL')).toHaveLength(1);
    expect(nodesOf(bracket, 'THIRD_PLACE')).toHaveLength(1);
    expect(bracket.thirdPlaceNodeId).toBe(nodesOf(bracket, 'THIRD_PLACE')[0]?.id);
  });

  it('names the rounds by field size (docs/TOURNAMENT-RULES.md §7)', () => {
    const bracket = buildBracket(named(16), { rng: createRng('seed') });

    expect(nodesOf(bracket, 'ROUND_OF_16')).toHaveLength(8);
    expect(nodesOf(bracket, 'QUARTER_FINAL')).toHaveLength(4);
    expect(nodesOf(bracket, 'SEMI_FINAL')).toHaveLength(2);
    expect(nodesOf(bracket, 'FINAL')).toHaveLength(1);
  });

  it('numbers the nodes the way docs/FILE-FORMAT.md writes them', () => {
    const bracket = buildBracket(named(16), { rng: createRng('seed') });

    // The example in the file format: `bn_1` is a first-round node feeding
    // `bn_9`, and the third-place match is `bn_15`.
    expect(bracket.nodes[0]?.id).toBe('bn_1');
    expect(bracket.nodes[0]?.nextNodeId).toBe('bn_9');
    expect(bracket.thirdPlaceNodeId).toBe('bn_15');
    expect(nodesOf(bracket, 'FINAL')[0]?.id).toBe('bn_16');
  });

  it('leaves a field of two as a final with no third-place match (§9 case 10)', () => {
    const bracket = buildBracket(named(2), { rng: createRng('seed') });

    expect(bracket.size).toBe(2);
    expect(bracket.nodes).toHaveLength(1);
    expect(bracket.nodes[0]?.round).toBe('FINAL');
    expect(bracket.thirdPlaceNodeId).toBeNull();
    expect(nodesOf(bracket, 'THIRD_PLACE')).toHaveLength(0);
  });

  it('links every node but the final and the third-place match to the one above', () => {
    const bracket = buildBracket(named(8), { rng: createRng('seed') });

    for (const node of bracket.nodes) {
      if (node.round === 'FINAL' || node.round === 'THIRD_PLACE') {
        expect(node.nextNodeId).toBeNull();
        continue;
      }
      const above = nodeById(bracket, node.nextNodeId);
      expect(above, node.id).toBeDefined();
      // Upwards only: a node never feeds its own round or the one below it.
      expect(above?.round).not.toBe(node.round);
    }
  });

  it('starts every node above the first round empty', () => {
    const bracket = buildBracket(named(8), { rng: createRng('seed') });

    for (const node of bracket.nodes) {
      if (node.round === 'QUARTER_FINAL') {
        continue;
      }
      expect(node.slotA, node.id).toBeNull();
      expect(node.slotB, node.id).toBeNull();
      expect(node.winnerId, node.id).toBeNull();
    }
  });

  it.each([16, 8, 4, 2])('puts each of %i groups in exactly one first-round slot', (size) => {
    const bracket = buildBracket(named(size), { rng: createRng('seed') });
    const entrants = firstRoundEntrants(bracket);

    expect(entrants).toHaveLength(size);
    expect(new Set(entrants).size).toBe(size);
    expect([...entrants].sort()).toEqual(
      named(size)
        .map((group) => group.id)
        .sort(),
    );
  });

  it('is fully determined by the seed and the group list', () => {
    const groups = named(8);

    const first = buildBracket(groups, { rng: createRng('seed') });
    const again = buildBracket(groups, { rng: createRng('seed') });
    const other = buildBracket(groups, { rng: createRng('a different seed') });

    expect(again).toEqual(first);
    // Not a guarantee of the algorithm, but a shuffle of eight that landed
    // identically from two seeds would mean the seed was not being used.
    expect(other).not.toEqual(first);
  });

  it('spreads the Freilose a short field owes over the last nodes (§4 fallback 1)', () => {
    // Six named participants in a field of eight: two nodes get one each rather
    // than one node being left empty.
    const bracket = buildBracket(named(6), { rng: createRng('seed'), size: 8 });
    const quarters = nodesOf(bracket, 'QUARTER_FINAL');

    expect(bracket.size).toBe(8);
    expect(quarters.filter((node) => node.slotB === null)).toHaveLength(2);
    expect(quarters.filter((node) => node.slotA === null)).toHaveLength(0);
    expect(firstRoundEntrants(bracket)).toHaveLength(6);
  });

  it('decides a Freilos in the draw and stands its winner in the round above', () => {
    const bracket = buildBracket(named(3), { rng: createRng('seed'), size: 4 });
    const bye = nodesOf(bracket, 'SEMI_FINAL').find((node) => node.slotB === null);
    const final = nodesOf(bracket, 'FINAL')[0];

    expect(bye?.winnerId).toBe(bye?.slotA);
    // The second semi-final is the second slot of the final.
    expect(final?.slotB).toBe(bye?.slotA);
    expect(final?.slotA).toBeNull();
  });
});

describe('bracketBlockers', () => {
  it('lets a named field of a power of two through', () => {
    expect(bracketBlockers(readyToDraw(8))).toEqual([]);
    expect(canDrawBracket(readyToDraw(8))).toBe(true);
  });

  it('refuses a phase that is not NAMING (docs/TOURNAMENT-RULES.md §1)', () => {
    expect(bracketBlockers(readyToDraw(8, { phase: 'ELIMINATION' }))).toContain('NOT_IN_NAMING');
  });

  it('refuses a second draw', () => {
    const drawn = drawBracket(readyToDraw(4), { at: FIXED_NOW });

    expect(bracketBlockers(drawn)).toContain('ALREADY_DRAWN');
    expect(drawBracket(drawn, { at: FIXED_NOW })).toBe(drawn);
  });

  it('refuses while a name is missing (docs/TOURNAMENT-RULES.md §6)', () => {
    const missing = readyToDraw(4, { groups: [...named(3), group(4)] });

    expect(bracketBlockers(missing)).toContain('NAMES_MISSING');
    expect(drawBracket(missing, { at: FIXED_NOW })).toBe(missing);
  });

  it('refuses a field larger than the bracket (docs/TOURNAMENT-RULES.md §5)', () => {
    expect(bracketBlockers(readyToDraw(32))).toContain('FIELD_TOO_LARGE');
  });

  it('refuses a field of fewer than two (§9 case 4)', () => {
    expect(bracketBlockers(readyToDraw(1))).toContain('FIELD_TOO_SMALL');
  });

  it('refuses a field that is not a power of two', () => {
    const blockers = bracketBlockers(readyToDraw(6));

    expect(blockers).toContain('FIELD_NOT_POWER_OF_TWO');
    // One reason about the field, not two.
    expect(blockers).not.toContain('FIELD_TOO_LARGE');
  });

  it('counts the Freilose the repechage still owes as part of the field', () => {
    const ready = owingOneBye();

    expect(bracketBlockers(ready)).toEqual([]);
    expect(bracketOf(drawBracket(ready, { at: FIXED_NOW })).size).toBe(4);
  });
});

/**
 * Three winners and a `Freilos` the §4 fallback owes: a field of four that
 * `activeGroups` alone would report as three (docs/OPEN-QUESTIONS.md #56).
 */
function owingOneBye(): Tournament {
  return readyToDraw(3, {
    groups: [...named(3), group(4, { status: 'ELIMINATED' }), group(5, { status: 'ELIMINATED' })],
    nextGroupNumber: 6,
    rounds: [
      round(1, {
        kind: 'QUALIFYING',
        state: 'CLOSED',
        matches: [
          match(1, { a: groupId(1), b: groupId(4), winnerId: groupId(1), status: 'DONE' }),
          match(2, { a: groupId(2), b: groupId(5), winnerId: groupId(2), status: 'DONE' }),
          match(3, { a: groupId(3), b: null, winnerId: groupId(3), status: 'DONE' }),
        ],
      }),
    ],
    repechage: {
      target: 4,
      pool: [],
      draws: [{ groupId: groupId(4), accepted: false }],
      fallbackUsed: 'BYES',
    },
  });
}

describe('drawBracket', () => {
  it('enters the final phase and draws the tree in one object', () => {
    const before = readyToDraw(4);

    const after = drawBracket(before, { at: FIXED_NOW });

    expect(after.phase).toBe('BRACKET');
    expect(after.bracket).not.toBeNull();
    expect(after.rngCursor).toBeGreaterThan(before.rngCursor);
  });

  it('deals the same tree from the same seed and cursor', () => {
    const ready = readyToDraw(8);

    expect(drawBracket(ready, { at: FIXED_NOW }).bracket).toEqual(
      drawBracket(ready, { at: FIXED_NOW }).bracket,
    );
  });

  it('deals a different tree once the cursor has moved on', () => {
    const ready = readyToDraw(8);

    expect(drawBracket(ready, { at: FIXED_NOW }).bracket).not.toEqual(
      drawBracket({ ...ready, rngCursor: 12 }, { at: FIXED_NOW }).bracket,
    );
  });

  it('sends the first round onto the free tables in node order (§3)', () => {
    const ready = readyToDraw(4, { tables: [table(1), table(2)], nextTableNumber: 3 });

    const after = drawBracket(ready, { at: FIXED_NOW });
    const semis = nodesOf(bracketOf(after), 'SEMI_FINAL');

    expect(semis.map((node) => node.tableId)).toEqual([tableId(1), tableId(2)]);
    expect(after.tables.map((table) => table.status)).toEqual(['OCCUPIED', 'OCCUPIED']);
    expect(after.tables[0]?.currentMatchId).toBe(semis[0]?.id);
    expect(after.tables[0]?.occupiedSince).toBe(FIXED_NOW);
  });

  it('queues the matches it has no table for (§9 case 3)', () => {
    const ready = readyToDraw(8, { tables: [table(1)], nextTableNumber: 2 });

    const after = drawBracket(ready, { at: FIXED_NOW });

    expect(queuedBracketNodes(bracketOf(after))).toHaveLength(3);
    expect(nextQueuedBracketNode(after)?.id).toBe('bn_2');
  });

  it('never puts a Freilos or a disabled table into play', () => {
    const ready = {
      ...owingOneBye(),
      tables: [table(1, { status: 'DISABLED' }), table(2)],
      nextTableNumber: 3,
    };

    const after = drawBracket(ready, { at: FIXED_NOW });
    const semis = nodesOf(bracketOf(after), 'SEMI_FINAL');

    expect(after.tables[0]?.status).toBe('DISABLED');
    // Only the semi-final that is actually played gets a table.
    expect(semis.filter((node) => node.tableId !== null)).toHaveLength(1);
    expect(semis.find((node) => node.slotB === null)?.tableId).toBeNull();
  });

  it('shows a bracket match on the occupancy board while it is being played', () => {
    const ready = readyToDraw(4, { tables: [table(1), table(2)], nextTableNumber: 3 });

    const after = drawBracket(ready, { at: FIXED_NOW });
    const board = occupancyBoard(after.tables, matchesOnTables(after));

    expect(board[0]?.match?.id).toBe('bn_1');
    expect(board[0]?.match?.status).toBe('RUNNING');
    expect(board[1]?.match?.id).toBe('bn_2');
  });
});

describe('setBracketWinner', () => {
  /** A drawn bracket of four on two tables, which is a semi-final in progress. */
  function semiFinals(): Tournament {
    return drawBracket(readyToDraw(4, { tables: [table(1), table(2)], nextTableNumber: 3 }), {
      at: FIXED_NOW,
    });
  }

  function slots(document: Tournament, id: string): [GroupId | null, GroupId | null] {
    const node = bracketOf(document).nodes.find((candidate) => candidate.id === id);
    return [node?.slotA ?? null, node?.slotB ?? null];
  }

  it('advances the winner into the node above', () => {
    const before = semiFinals();
    const [winner] = slots(before, 'bn_1');

    const after = setBracketWinner(before, 'bn_1' as BracketNodeId, winner as GroupId);

    expect(slots(after, 'bn_4')[0]).toBe(winner);
    expect(slots(after, 'bn_4')[1]).toBeNull();
  });

  it('routes the loser of a semi-final into the Spiel um Platz 3 (§7)', () => {
    const before = semiFinals();
    const [winner, loser] = slots(before, 'bn_1');

    const after = setBracketWinner(before, 'bn_1' as BracketNodeId, winner as GroupId);

    expect(slots(after, 'bn_3')[0]).toBe(loser);
    // And the beaten semi-finalist is still in the tournament: they have a
    // match left to play.
    expect(after.groups.find((group) => group.id === loser)?.status).toBe('ACTIVE');
  });

  it('fills the third-place match from both semi-finals, side for side', () => {
    let document = semiFinals();
    const firstSemi = slots(document, 'bn_1');
    const secondSemi = slots(document, 'bn_2');

    document = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_2' as BracketNodeId, secondSemi[0] as GroupId);

    expect(slots(document, 'bn_4')).toEqual([firstSemi[0], secondSemi[0]]);
    expect(slots(document, 'bn_3')).toEqual([firstSemi[1], secondSemi[1]]);
  });

  it('eliminates the loser of a match that leads nowhere', () => {
    let document = semiFinals();
    const firstSemi = slots(document, 'bn_1');
    const secondSemi = slots(document, 'bn_2');
    document = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_2' as BracketNodeId, secondSemi[0] as GroupId);

    document = setBracketWinner(document, 'bn_3' as BracketNodeId, firstSemi[1] as GroupId);

    expect(document.groups.find((group) => group.id === secondSemi[1])?.status).toBe('ELIMINATED');
    expect(document.groups.find((group) => group.id === firstSemi[1])?.status).toBe('ACTIVE');
  });

  it('frees the table the match was played on and keeps the record of it', () => {
    const before = semiFinals();
    const [winner] = slots(before, 'bn_1');

    const after = setBracketWinner(before, 'bn_1' as BracketNodeId, winner as GroupId);
    const node = bracketOf(after).nodes.find((candidate) => candidate.id === 'bn_1');

    expect(after.tables[0]?.status).toBe('FREE');
    expect(after.tables[0]?.currentMatchId).toBeNull();
    // The node still says where it was played (docs/OPEN-QUESTIONS.md #37).
    expect(node?.tableId).toBe(tableId(1));
  });

  it('offers the freed table to the next waiting match, once the host says so', () => {
    const ready = readyToDraw(8, { tables: [table(1)], nextTableNumber: 2 });
    const drawn = drawBracket(ready, { at: FIXED_NOW });
    const first = bracketOf(drawn).nodes[0];

    const decided = setBracketWinner(drawn, first?.id as BracketNodeId, first?.slotA as GroupId);
    const assigned = assignNextBracketNode(decided, { tableId: tableId(1), at: FIXED_NOW });

    expect(nextQueuedBracketNode(decided)?.id).toBe('bn_2');
    expect(assigned.tables[0]?.currentMatchId).toBe('bn_2');
    expect(bracketOf(assigned).nodes[1]?.tableId).toBe(tableId(1));
  });

  it('corrects a result in place, taking the previous winner back out (§9 case 8)', () => {
    const before = semiFinals();
    const [winner, loser] = slots(before, 'bn_1');

    const wrong = setBracketWinner(before, 'bn_1' as BracketNodeId, winner as GroupId);
    const fixed = setBracketWinner(wrong, 'bn_1' as BracketNodeId, loser as GroupId);

    expect(slots(fixed, 'bn_4')[0]).toBe(loser);
    expect(slots(fixed, 'bn_3')[0]).toBe(winner);
    expect(fixed.groups.find((group) => group.id === winner)?.status).toBe('ACTIVE');
  });

  it('discards what was decided on top of a corrected result (issue #26)', () => {
    let document = semiFinals();
    const firstSemi = slots(document, 'bn_1');
    const secondSemi = slots(document, 'bn_2');
    document = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_2' as BracketNodeId, secondSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_3' as BracketNodeId, firstSemi[1] as GroupId);

    // The first semi-final went the other way after all.
    const corrected = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[1] as GroupId);
    const node = (id: string) =>
      bracketOf(corrected).nodes.find((candidate) => candidate.id === id);

    // The final and the third-place match were both built on it, so both are
    // open again — with the corrected participants standing in them.
    expect(node('bn_4')?.winnerId).toBeNull();
    expect(node('bn_3')?.winnerId).toBeNull();
    expect(slots(corrected, 'bn_4')).toEqual([firstSemi[1], secondSemi[0]]);
    expect(slots(corrected, 'bn_3')).toEqual([firstSemi[0], secondSemi[1]]);
    // The other semi-final is untouched: the walk only ever climbs out of the
    // node it starts at.
    expect(node('bn_2')?.winnerId).toBe(secondSemi[0]);
  });

  it('puts everybody the discarded results knocked out back in the tournament', () => {
    let document = semiFinals();
    const firstSemi = slots(document, 'bn_1');
    const secondSemi = slots(document, 'bn_2');
    document = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_2' as BracketNodeId, secondSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, firstSemi[0] as GroupId);
    const status = (document: Tournament, groupId: GroupId | null) =>
      document.groups.find((group) => group.id === groupId)?.status;

    expect(status(document, secondSemi[0])).toBe('ELIMINATED');

    const corrected = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[1] as GroupId);

    // The final was discarded, so the participant it knocked out is back in.
    expect(status(corrected, secondSemi[0])).toBe('ACTIVE');
    // And the corrected result's own two have swapped: the beaten semi-finalist
    // plays for third rather than leaving (§7).
    expect(status(corrected, firstSemi[1])).toBe('ACTIVE');
    expect(status(corrected, firstSemi[0])).toBe('ACTIVE');
  });

  it('takes a discarded match off its table and back into the queue', () => {
    let document = semiFinals();
    const firstSemi = slots(document, 'bn_1');
    const secondSemi = slots(document, 'bn_2');
    document = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[0] as GroupId);
    document = setBracketWinner(document, 'bn_2' as BracketNodeId, secondSemi[0] as GroupId);
    document = assignBracketNode(document, {
      nodeId: 'bn_4' as BracketNodeId,
      tableId: tableId(1),
      at: FIXED_NOW,
    });
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, firstSemi[0] as GroupId);
    document = assignBracketNode(document, {
      nodeId: 'bn_3' as BracketNodeId,
      tableId: tableId(1),
      at: FIXED_NOW,
    });

    const corrected = setBracketWinner(document, 'bn_1' as BracketNodeId, firstSemi[1] as GroupId);

    // The third-place match was on a table and is not the match it was: the
    // table is free again and the node is back in the queue.
    expect(corrected.tables[0]?.status).toBe('FREE');
    expect(queuedBracketNodes(bracketOf(corrected)).map((node) => node.id)).toContain('bn_3');
  });
  it('refuses a group that is not in the match, a Freilos and an unknown node', () => {
    const document = semiFinals();
    const [winner] = slots(document, 'bn_1');

    expect(setBracketWinner(document, 'bn_1' as BracketNodeId, groupId(99))).toBe(document);
    expect(setBracketWinner(document, 'bn_4' as BracketNodeId, winner as GroupId)).toBe(document);
    expect(setBracketWinner(document, 'bn_99' as BracketNodeId, winner as GroupId)).toBe(document);
  });

  it('refuses the same winner twice, and any winner without a bracket', () => {
    const document = semiFinals();
    const [winner] = slots(document, 'bn_1');
    const decided = setBracketWinner(document, 'bn_1' as BracketNodeId, winner as GroupId);

    expect(setBracketWinner(decided, 'bn_1' as BracketNodeId, winner as GroupId)).toBe(decided);
    expect(setBracketWinner(readyToDraw(4), 'bn_1' as BracketNodeId, groupId(1))).toEqual(
      readyToDraw(4),
    );
  });

  it('plays a field of two as the Finale and nothing else (§9 case 5)', () => {
    const drawn = drawBracket(readyToDraw(2, { tables: [table(1)], nextTableNumber: 2 }), {
      at: FIXED_NOW,
    });
    const final = bracketOf(drawn).nodes[0];

    const after = setBracketWinner(drawn, final?.id as BracketNodeId, final?.slotA as GroupId);

    expect(finalStandings(after)).toEqual({
      first: final?.slotA,
      second: final?.slotB,
      third: null,
    });
    expect(isBracketComplete(after)).toBe(true);
  });
});

describe('bracketCorrection', () => {
  function played(): Tournament {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    for (const node of nodesOf(bracketOf(document), 'SEMI_FINAL')) {
      document = setBracketWinner(document, node.id, node.slotA as GroupId);
    }
    return document;
  }

  it('is nothing at all for a decision that costs nothing', () => {
    const document = played();
    const semi = bracketOf(document).nodes[0];

    // A first decision, and a correction with nothing built on it.
    expect(bracketCorrection(document, 'bn_4' as BracketNodeId, semi?.slotA as GroupId)).toBeNull();
    expect(
      bracketCorrection(document, semi?.id as BracketNodeId, semi?.slotB as GroupId),
    ).toBeNull();
  });

  it('lists exactly the results a correction would discard', () => {
    let document = played();
    const first = nodesOf(bracketOf(document), 'SEMI_FINAL')[0];
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, first?.slotA as GroupId);
    document = setBracketWinner(document, 'bn_3' as BracketNodeId, first?.slotB as GroupId);

    const correction = bracketCorrection(
      document,
      first?.id as BracketNodeId,
      first?.slotB as GroupId,
    );

    expect(correction?.node.id).toBe(first?.id);
    expect(correction?.winnerId).toBe(first?.slotB);
    expect(correction?.discards.map((node) => node.id).sort()).toEqual(['bn_3', 'bn_4']);
    // The discarded results are handed over as they stand, so the panel can say
    // who beat whom in the match that is about to be thrown away.
    expect(correction?.discards.every((node) => node.winnerId !== null)).toBe(true);
  });

  it('is nothing for a node that does not exist, or without a bracket', () => {
    expect(bracketCorrection(played(), 'bn_99' as BracketNodeId, groupId(1))).toBeNull();
    expect(bracketCorrection(readyToDraw(4), 'bn_1' as BracketNodeId, groupId(1))).toBeNull();
  });
});

describe('rematches in the first bracket round (issue #72)', () => {
  /** Every pairing of a tree as an unordered key, so a repeat is comparable. */
  function meetings(nodes: readonly BracketNode[]): readonly string[] {
    return nodes
      .filter((node) => node.slotA !== null && node.slotB !== null)
      .map((node) => [String(node.slotA), String(node.slotB)].sort().join('+'));
  }

  /**
   * A tournament of `count` named groups whose qualifying round is on record.
   *
   * The bracket is the second time a small field is drawn — 8 groups play one
   * qualifying round and go straight into the tree — so this is the case the
   * issue's first test describes for a field that never sees an elimination
   * round (docs/TOURNAMENT-RULES.md §5).
   */
  function afterQualifying(count: number, pairs: readonly (readonly [number, number])[]) {
    return readyToDraw(count, {
      rounds: [
        round(1, {
          kind: 'QUALIFYING',
          state: 'CLOSED',
          matches: pairs.map(([a, b], index) =>
            match(index + 1, {
              a: groupId(a),
              b: groupId(b),
              winnerId: groupId(a),
              status: 'DONE',
            }),
          ),
        }),
      ],
    });
  }

  it('does not put two groups back together who have already played', () => {
    // Eight groups, one qualifying round of four pairings, then the tree. None
    // of those four may appear in the `Viertelfinale`.
    const played: readonly (readonly [number, number])[] = [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ];
    const document = afterQualifying(8, played);

    const drawn = drawBracket(document, { at: FIXED_NOW });
    const bracket = drawn.bracket as Bracket;

    const before = played.map(([a, b]) => [groupId(a), groupId(b)].sort().join('+'));
    expect(meetings(bracket.nodes)).toHaveLength(4);
    expect(meetings(bracket.nodes).filter((pairing) => before.includes(pairing))).toEqual([]);
  });

  it('reports no forced rematch, and previews the tree it will deal', () => {
    const document = afterQualifying(8, [
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);

    const preview = previewDrawBracket(document, { at: FIXED_NOW });

    expect(preview?.forced).toEqual([]);
    expect(preview?.bracket).toEqual(drawBracket(document, { at: FIXED_NOW }).bracket);
    // Nothing was committed: the phase and the cursor are untouched, so a host
    // who declines the confirmation has lost nothing (issue #72).
    expect(document.phase).toBe('NAMING');
    expect(document.bracket).toBeNull();
  });

  it('previews nothing when the tree cannot be drawn', () => {
    // A field of six is not a power of two, so there is no tree to preview —
    // the same refusal `drawBracket` gives (docs/TOURNAMENT-RULES.md §7).
    expect(previewDrawBracket(readyToDraw(6), { at: FIXED_NOW })).toBeNull();
  });

  it('names the pairs it could not avoid when the field has played itself out', () => {
    // Four groups who have all played all — the smallest genuinely unsolvable
    // field, and one a `Halbfinale` of four can be handed by a repaired file.
    const played: readonly (readonly [number, number])[] = [
      [1, 2],
      [3, 4],
      [1, 3],
      [2, 4],
      [1, 4],
      [2, 3],
    ];
    const document = afterQualifying(4, played);

    const drawn = drawBracket(document, { at: FIXED_NOW });

    // Two semi-finals, both of them repeats, and the draw still happened:
    // everybody in the tree exactly once (§7).
    expect(forcedBracketRematches(drawn)).toHaveLength(2);
    expect(firstRoundEntrants(drawn.bracket as Bracket).sort()).toEqual(
      [groupId(1), groupId(2), groupId(3), groupId(4)].sort(),
    );
  });

  it('leaves a tree drawn from a fresh field exactly as it was', () => {
    // The regression guard for every existing bracket test: with no history,
    // the shuffle is still read off in twos and the tree is unchanged.
    const groups = named(16);

    expect(buildBracket(groups, { rng: createRng('seed') })).toEqual(
      buildBracket(groups, { rng: createRng('seed'), history: new Map() }),
    );
  });
});

describe('assignBracketNode', () => {
  function drawnOnOneTable(): Tournament {
    return drawBracket(readyToDraw(4, { tables: [table(1), table(2)], nextTableNumber: 3 }), {
      at: FIXED_NOW,
    });
  }

  it('refuses a node that is unknown, already on a table, or already decided', () => {
    const document = drawnOnOneTable();
    const free = { ...document, tables: [table(1), table(2)] };

    expect(
      assignBracketNode(free, {
        nodeId: 'bn_99' as BracketNodeId,
        tableId: tableId(1),
        at: FIXED_NOW,
      }),
    ).toBe(free);
    // `bn_1` came off the draw already sitting on a table.
    expect(
      assignBracketNode(document, {
        nodeId: 'bn_1' as BracketNodeId,
        tableId: tableId(2),
        at: FIXED_NOW,
      }),
    ).toBe(document);
    // The final has nobody in it yet.
    expect(
      assignBracketNode(free, {
        nodeId: 'bn_4' as BracketNodeId,
        tableId: tableId(1),
        at: FIXED_NOW,
      }),
    ).toBe(free);
  });

  it('refuses a table that is not free, and any node without a bracket', () => {
    const document = drawnOnOneTable();
    const waiting = { ...document, tables: [document.tables[0] as Table, table(2)] };

    expect(
      assignBracketNode(waiting, {
        nodeId: 'bn_2' as BracketNodeId,
        tableId: tableId(1),
        at: FIXED_NOW,
      }),
    ).toBe(waiting);
    const noBracket = readyToDraw(4);
    expect(
      assignBracketNode(noBracket, {
        nodeId: 'bn_1' as BracketNodeId,
        tableId: tableId(1),
        at: FIXED_NOW,
      }),
    ).toBe(noBracket);
  });

  it('offers nothing to a table while there is no bracket', () => {
    const ready = readyToDraw(4);

    expect(nextQueuedBracketNode(ready)).toBeNull();
    expect(assignNextBracketNode(ready, { tableId: tableId(1), at: FIXED_NOW })).toBe(ready);
  });
});

describe('a table that breaks during the final phase (issue #13)', () => {
  function drawnOnTwoTables(): Tournament {
    return drawBracket(readyToDraw(4, { tables: [table(1), table(2)], nextTableNumber: 3 }), {
      at: FIXED_NOW,
    });
  }

  it('puts the match back in the queue when its table is taken out of service', () => {
    const document = drawnOnTwoTables();

    const after = disableTable(document, tableId(1), REQUEUE);

    expect(after.tables[0]?.status).toBe('DISABLED');
    expect(bracketOf(after).nodes[0]?.tableId).toBeNull();
    expect(queuedBracketNodes(bracketOf(after)).map((node) => node.id)).toEqual(['bn_1']);
  });

  it('carries the match across when the host moves it to another table', () => {
    const document = drawBracket(
      readyToDraw(4, { tables: [table(1), table(2), table(3)], nextTableNumber: 4 }),
      { at: FIXED_NOW },
    );

    const after = removeTable(document, tableId(1), { kind: 'MOVE', toTableId: tableId(3) });
    const moved = after.tables.find((candidate) => candidate.id === tableId(3));

    expect(after.tables.map((candidate) => candidate.id)).toEqual([tableId(2), tableId(3)]);
    expect(bracketOf(after).nodes[0]?.tableId).toBe(tableId(3));
    expect(moved?.currentMatchId).toBe('bn_1');
    // The stamp travels with the match: the room has been watching it whichever
    // table it sits on.
    expect(moved?.occupiedSince).toBe(FIXED_NOW);
  });
});

describe('bracketRoundForSize', () => {
  it('names the four sizes docs/TOURNAMENT-RULES.md §7 lists, and nothing else', () => {
    expect(bracketRoundForSize(16)).toBe('ROUND_OF_16');
    expect(bracketRoundForSize(8)).toBe('QUARTER_FINAL');
    expect(bracketRoundForSize(4)).toBe('SEMI_FINAL');
    expect(bracketRoundForSize(2)).toBe('FINAL');
    expect(bracketRoundForSize(32)).toBeNull();
  });
});

describe('a bracket with a Freilos in the semi-finals', () => {
  /** Three named participants in a field of four (docs/OPEN-QUESTIONS.md #56). */
  function drawn(): Tournament {
    return drawBracket(
      { ...owingOneBye(), tables: [table(1)], nextTableNumber: 2 },
      {
        at: FIXED_NOW,
      },
    );
  }

  it('refuses a winner for the Freilos the draw already decided', () => {
    const document = drawn();
    const bye = nodesOf(bracketOf(document), 'SEMI_FINAL').find((node) => node.slotB === null);

    expect(setBracketWinner(document, bye?.id as BracketNodeId, bye?.slotA as GroupId)).toBe(
      document,
    );
  });

  it('gives third place to the only participant who can reach it', () => {
    const document = drawn();
    const played = nodesOf(bracketOf(document), 'SEMI_FINAL').find((node) => node.slotB !== null);

    const after = setBracketWinner(document, played?.id as BracketNodeId, played?.slotA as GroupId);
    const third = bracketOf(after).nodes.find(
      (node) => node.id === bracketOf(after).thirdPlaceNodeId,
    );

    // Nobody is left to play them: the other semi-final was a `Freilos` and
    // produced no loser, so the third-place match is a `Freilos` in turn.
    expect(third?.winnerId).toBe(played?.slotB);
    expect(finalStandings(after)?.third).toBe(played?.slotB);
  });

  it('is complete once the final is decided, with no third-place match to play', () => {
    let document = drawn();
    const played = nodesOf(bracketOf(document), 'SEMI_FINAL').find((node) => node.slotB !== null);
    document = setBracketWinner(document, played?.id as BracketNodeId, played?.slotA as GroupId);
    expect(isBracketComplete(document)).toBe(false);

    const final = nodesOf(bracketOf(document), 'FINAL')[0];
    document = setBracketWinner(document, final?.id as BracketNodeId, final?.slotA as GroupId);

    expect(isBracketComplete(document)).toBe(true);
  });
});

describe('finalStandings', () => {
  it('is null while there is no bracket', () => {
    expect(finalStandings(readyToDraw(4))).toBeNull();
    expect(isBracketComplete(readyToDraw(4))).toBe(false);
  });

  it('names first, second and third once the last match is decided (§8)', () => {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    const bracket = bracketOf(document);
    const semis = nodesOf(bracket, 'SEMI_FINAL');
    const winners = semis.map((node) => node.slotA as GroupId);
    const losers = semis.map((node) => node.slotB as GroupId);

    for (const [index, node] of semis.entries()) {
      document = setBracketWinner(document, node.id, winners[index] as GroupId);
    }
    expect(isBracketComplete(document)).toBe(false);

    document = setBracketWinner(document, 'bn_4' as BracketNodeId, winners[0] as GroupId);
    document = setBracketWinner(document, 'bn_3' as BracketNodeId, losers[1] as GroupId);

    expect(finalStandings(document)).toEqual({
      first: winners[0],
      second: winners[1],
      third: losers[1],
    });
    expect(isBracketComplete(document)).toBe(true);
  });

  it('is incomplete while the third-place match is still open', () => {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    const semis = nodesOf(bracketOf(document), 'SEMI_FINAL');

    for (const node of semis) {
      document = setBracketWinner(document, node.id, node.slotA as GroupId);
    }
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, semis[0]?.slotA as GroupId);

    expect(finalStandings(document)?.first).toBe(semis[0]?.slotA);
    expect(finalStandings(document)?.third).toBeNull();
    expect(isBracketComplete(document)).toBe(false);
  });

  /*
   * The beamer reads the podium off a tree with no tournament around it
   * (issue #69): the `Siegerehrung` is handed a snapshot, and one derivation of
   * who came where is the only way the wall and the host can agree about it.
   */
  it('reads the same three places off the tree alone', () => {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    const semis = nodesOf(bracketOf(document), 'SEMI_FINAL');
    const winners = semis.map((node) => node.slotA as GroupId);
    const losers = semis.map((node) => node.slotB as GroupId);

    for (const [index, node] of semis.entries()) {
      document = setBracketWinner(document, node.id, winners[index] as GroupId);
    }
    document = setBracketWinner(document, 'bn_4' as BracketNodeId, winners[0] as GroupId);
    document = setBracketWinner(document, 'bn_3' as BracketNodeId, losers[1] as GroupId);

    expect(finalStandingsOf(bracketOf(document))).toEqual(finalStandings(document));
    expect(finalStandingsOf(bracketOf(document))).toEqual({
      first: winners[0],
      second: winners[1],
      third: losers[1],
    });
  });
});

/*
 * docs/TOURNAMENT-RULES.md §9 case 10: the bracket adapts down to a field of 2,
 * and at 2 there is no `Spiel um Platz 3`. The `Siegerehrung` has to know the
 * difference between a bronze nobody has won *yet* and a bronze that will never
 * exist, because only the second one takes a step off the podium.
 */
describe('hasThirdPlace', () => {
  it('is false for a final phase that starts at 2', () => {
    const document = drawBracket(readyToDraw(2, { tables: [table(1)] }), { at: FIXED_NOW });

    expect(hasThirdPlace(bracketOf(document))).toBe(false);
    expect(finalStandingsOf(bracketOf(document)).third).toBeNull();
  });

  it('is true from a field of 4 up, decided or not', () => {
    const document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), {
      at: FIXED_NOW,
    });

    expect(hasThirdPlace(bracketOf(document))).toBe(true);
    expect(hasThirdPlace(buildBracket(named(16), { rng: createRng('seed') }))).toBe(true);
  });
});

describe('bracketColumns', () => {
  it('lists every round in the order the tree is drawn', () => {
    const bracket = buildBracket(named(16), { rng: createRng('seed') });

    expect(bracketColumns(bracket).map((column) => column.round)).toEqual([
      'ROUND_OF_16',
      'QUARTER_FINAL',
      'SEMI_FINAL',
      'THIRD_PLACE',
      'FINAL',
    ]);
    expect(bracketColumns(bracket).map((column) => column.field)).toEqual([16, 8, 4, 2, 2]);
  });

  it('is a single Finale at a field of two (§9 case 10)', () => {
    const bracket = buildBracket(named(2), { rng: createRng('seed') });

    expect(bracketColumns(bracket)).toHaveLength(1);
    expect(bracketColumns(bracket)[0]?.round).toBe('FINAL');
  });

  it('marks the round that can be played now, and the ones around it', () => {
    const drawn = drawBracket(readyToDraw(8, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    const states = (document: Tournament) =>
      Object.fromEntries(
        bracketColumns(bracketOf(document)).map((column) => [column.round, column.state]),
      );

    expect(states(drawn)).toEqual({
      QUARTER_FINAL: 'ACTIVE',
      SEMI_FINAL: 'FUTURE',
      THIRD_PLACE: 'FUTURE',
      FINAL: 'FUTURE',
    });
    expect(activeBracketRound(bracketOf(drawn))).toBe('QUARTER_FINAL');

    let document = drawn;
    for (const node of nodesOf(bracketOf(document), 'QUARTER_FINAL')) {
      document = setBracketWinner(document, node.id, node.slotA as GroupId);
    }

    expect(states(document)).toEqual({
      QUARTER_FINAL: 'DECIDED',
      SEMI_FINAL: 'ACTIVE',
      THIRD_PLACE: 'FUTURE',
      FINAL: 'FUTURE',
    });
    expect(activeBracketRound(bracketOf(document))).toBe('SEMI_FINAL');
  });

  /*
   * §7 schedules the third-place match at the same time as the final, so the
   * state is a property of a round and never of its position in the tree.
   */
  it('leaves the Finale and the Spiel um Platz 3 active together', () => {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    for (const node of nodesOf(bracketOf(document), 'SEMI_FINAL')) {
      document = setBracketWinner(document, node.id, node.slotA as GroupId);
    }

    const columns = bracketColumns(bracketOf(document));

    expect(columns.find((column) => column.round === 'FINAL')?.state).toBe('ACTIVE');
    expect(columns.find((column) => column.round === 'THIRD_PLACE')?.state).toBe('ACTIVE');
  });

  it('has nothing active once the last match is decided', () => {
    let document = drawBracket(readyToDraw(2, { tables: [table(1)] }), { at: FIXED_NOW });
    const final = bracketOf(document).nodes[0];
    document = setBracketWinner(document, final?.id as BracketNodeId, final?.slotA as GroupId);

    expect(activeBracketRound(bracketOf(document))).toBeNull();
    expect(bracketColumns(bracketOf(document))[0]?.state).toBe('DECIDED');
  });
});

describe('chipOrigin', () => {
  /** A bracket of four with both semi-finals decided. */
  function semisDecided(): Tournament {
    let document = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    for (const node of nodesOf(bracketOf(document), 'SEMI_FINAL')) {
      document = setBracketWinner(document, node.id, node.slotA as GroupId);
    }
    return document;
  }

  it('names the chip a winner travelled from', () => {
    const bracket = bracketOf(semisDecided());

    expect(chipOrigin(bracket, 'bn_4' as BracketNodeId, 'A')).toEqual({
      nodeId: 'bn_1',
      side: 'A',
    });
    expect(chipOrigin(bracket, 'bn_4' as BracketNodeId, 'B')).toEqual({
      nodeId: 'bn_2',
      side: 'A',
    });
  });

  /*
   * The chip that travels into the third-place match is the semi-final's
   * *loser* — the whole rule of §7, and the one case a scene that assumed
   * winners would get wrong in front of the room.
   */
  it('names the loser for the Spiel um Platz 3', () => {
    const bracket = bracketOf(semisDecided());

    expect(chipOrigin(bracket, 'bn_3' as BracketNodeId, 'A')).toEqual({
      nodeId: 'bn_1',
      side: 'B',
    });
    expect(chipOrigin(bracket, 'bn_3' as BracketNodeId, 'B')).toEqual({
      nodeId: 'bn_2',
      side: 'B',
    });
  });

  it('is null for the first round, an empty slot and an unknown node', () => {
    const drawn = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });
    const bracket = bracketOf(drawn);

    // Drawn into their slots rather than sent there by a match.
    expect(chipOrigin(bracket, 'bn_1' as BracketNodeId, 'A')).toBeNull();
    // Nobody has been sent up yet.
    expect(chipOrigin(bracket, 'bn_4' as BracketNodeId, 'A')).toBeNull();
    expect(chipOrigin(bracket, 'bn_99' as BracketNodeId, 'A')).toBeNull();
  });
});

describe('bracketNodeState', () => {
  it('says which matches can be played right now (issue #26)', () => {
    const document = drawBracket(readyToDraw(8, { tables: [table(1)], nextTableNumber: 2 }), {
      at: FIXED_NOW,
    });
    const state = (id: string) => {
      const node = bracketOf(document).nodes.find((candidate) => candidate.id === id);
      return node === undefined ? null : bracketNodeState(node);
    };

    // One table, four quarter-finals: one is being played and three are queued.
    expect(state('bn_1')).toBe('RUNNING');
    expect(state('bn_2')).toBe('QUEUED');
    // Nobody has reached the semi-finals, the final or the third-place match.
    expect(state('bn_5')).toBe('WAITING');
    expect(state('bn_8')).toBe('WAITING');
  });

  it('tells a played match from a Freilos', () => {
    const groups = Array.from({ length: 3 }, (_unused, index) =>
      group(index + 1, { name: `${NAMED} ${index + 1}` }),
    );
    const bracket = buildBracket(groups, { rng: createRng('seed'), size: 4 });
    const bye = bracket.nodes.find((node) => node.round === 'SEMI_FINAL' && node.slotB === null);
    const played = bracket.nodes.find((node) => node.round === 'SEMI_FINAL' && node.slotB !== null);

    expect(bye === undefined ? null : bracketNodeState(bye)).toBe('BYE');
    expect(played === undefined ? null : bracketNodeState(played)).toBe('QUEUED');
  });
});

/*
 * Which table a node is *shown* on (issue #90). The stored `tableId` is not the
 * answer: a decided node keeps it as the record of where it was played
 * (docs/OPEN-QUESTIONS.md #37), while the table itself went back to the pool
 * the moment the winner was marked.
 */
describe('bracketNodeTableId', () => {
  /** A field of 8 with one table: `bn_1` is running, the rest are queued. */
  const drawn = () =>
    drawBracket(readyToDraw(8, { tables: [table(1)], nextTableNumber: 2 }), { at: FIXED_NOW });

  const nodeOf = (document: Tournament, id: string) =>
    bracketOf(document).nodes.find((candidate) => candidate.id === id);

  it('names the table a match is being played on', () => {
    const node = nodeOf(drawn(), 'bn_1');

    expect(node?.tableId).not.toBeNull();
    expect(node === undefined ? null : bracketNodeTableId(node)).toBe(node?.tableId);
  });

  it('names nothing for a match that is still waiting for a table', () => {
    const node = nodeOf(drawn(), 'bn_2');

    expect(node === undefined ? null : bracketNodeTableId(node)).toBeNull();
  });

  it('names nothing for a round nobody has reached', () => {
    const node = nodeOf(drawn(), 'bn_5');

    expect(node === undefined ? null : bracketNodeTableId(node)).toBeNull();
  });

  /*
   * The issue's fourth task, and the one the stored field gets wrong on its
   * own: the node still remembers where it was played, and the table is busy
   * with somebody else by then.
   */
  it('forgets the table the moment the match is decided', () => {
    const document = drawn();
    const running = nodeOf(document, 'bn_1');
    const decided = setBracketWinner(
      document,
      running?.id as BracketNodeId,
      running?.slotA as GroupId,
    );
    const after = nodeOf(decided, 'bn_1');

    // The record survives — that is deliberate (docs/OPEN-QUESTIONS.md #37).
    expect(after?.tableId).toBe(running?.tableId);
    // What the screens show does not.
    expect(after === undefined ? null : bracketNodeTableId(after)).toBeNull();
  });

  it('names nothing for a Freilos, which never saw a table', () => {
    const groups = Array.from({ length: 3 }, (_unused, index) =>
      group(index + 1, { name: `${NAMED} ${index + 1}` }),
    );
    const bracket = buildBracket(groups, { rng: createRng('seed'), size: 4 });
    const bye = bracket.nodes.find((node) => node.round === 'SEMI_FINAL' && node.slotB === null);

    expect(bye === undefined ? null : bracketNodeTableId(bye)).toBeNull();
  });
});

describe('finishBracket', () => {
  /** A bracket of two, played to the end — the smallest complete one there is. */
  function finished(): Tournament {
    const drawn = drawBracket(readyToDraw(2, { tables: [table(1)] }), { at: FIXED_NOW });
    const final = bracketOf(drawn).nodes[0];
    return setBracketWinner(drawn, final?.id as BracketNodeId, final?.slotA as GroupId);
  }

  it('moves the tournament into the Siegerehrung once the tree is over', () => {
    const document = finished();

    expect(canFinishBracket(document)).toBe(true);
    expect(finishBracket(document).phase).toBe('CEREMONY');
  });

  /*
   * §8: the podium is revealed by the host and "must never fire automatically
   * the instant the final is decided, because the host may still be talking".
   * Moving the phase is not the reveal, and it changes nothing else.
   */
  it('changes the phase and nothing else', () => {
    const document = finished();

    expect(finishBracket(document)).toEqual({ ...document, phase: 'CEREMONY' });
  });

  it('refuses while a match is still to be played', () => {
    const open = drawBracket(readyToDraw(4, { tables: [table(1), table(2)] }), { at: FIXED_NOW });

    expect(canFinishBracket(open)).toBe(false);
    expect(finishBracket(open)).toBe(open);
  });

  it('refuses outside the final phase', () => {
    const ready = readyToDraw(4);

    expect(canFinishBracket(ready)).toBe(false);
    expect(finishBracket(ready)).toBe(ready);
  });
});
