import { describe, expect, it } from 'vitest';

import {
  assignMatch,
  assignNextQueuedMatch,
  byesOwed,
  canCloseRound,
  canDrawRound,
  closeRound,
  closeRoundBlockers,
  drawBlockers,
  drawRound,
  fieldSize,
  forcedRematches,
  nextQueuedMatch,
  previewDrawRound,
  queuedMatches,
  roundOutcome,
  setWinner,
} from '@/domain/draw';
import { addGroups } from '@/domain/groups';
import {
  matchIdSchema,
  roundIdSchema,
  type GroupId,
  type MatchId,
  type TableId,
} from '@/domain/ids';
import { indexTournament } from '@/domain/lookup';
import { createRng } from '@/domain/rng';
import { activeGroups, currentRound, freeTables } from '@/domain/selectors';
import { startTournament } from '@/domain/start';
import { addTables, disableTable } from '@/domain/tables';
import { FIXED_NOW, group, groupId, tournament } from '@/domain/testFixtures';
import { tournamentSchema, type Match, type Round, type Tournament } from '@/domain/types';

/**
 * The draw engine (issue #16, docs/TOURNAMENT-RULES.md §3).
 *
 * The cases here are the ones that decide whether an evening works: an odd
 * field, twenty matches on three tables, a table taken out of service before
 * the draw, a host who marked the wrong winner. Counts are checked against the
 * rule rather than against a recorded output, so a test fails because the
 * algorithm changed and not because the seed did.
 *
 * German labels appear because the host's do — the domain never writes them, it
 * is handed a `label` function (CLAUDE.md golden rule 1).
 */

const tableLabel = (n: number) => `Tisch ${n}`;
const roundLabel = (index: number) => `Runde ${index}`;

const draw = { at: FIXED_NOW, label: roundLabel };

/** A tournament in `QUALIFYING` with `groups` participants and `tables` tables. */
function ready(groups: number, tables: number, overrides: Partial<Tournament> = {}): Tournament {
  const base = addTables(addGroups(tournament(), groups), { count: tables, label: tableLabel });
  return { ...base, phase: 'QUALIFYING', ...overrides };
}

function openRound(document: Tournament): Round {
  const round = currentRound(document);
  if (round === null) {
    throw new Error('Expected an open round');
  }
  return round;
}

function matchAt(round: Round, index: number): Match {
  const match = round.matches[index];
  if (match === undefined) {
    throw new Error(`No match at index ${index}`);
  }
  return match;
}

function opponent(match: Match): GroupId {
  if (match.b === null) {
    throw new Error(`Match ${match.id} is a bye`);
  }
  return match.b;
}

function playedOn(match: Match): TableId {
  if (match.tableId === null) {
    throw new Error(`Expected match ${match.id} to be on a table`);
  }
  return match.tableId;
}

function tableIdAt(document: Tournament, position: number): TableId {
  const table = document.tables[position];
  if (table === undefined) {
    throw new Error(`No table at position ${position}`);
  }
  return table.id;
}

/** Every group named by the pairings, byes included. */
function drawnGroups(round: Round): readonly GroupId[] {
  return round.matches.flatMap((match) => (match.b === null ? [match.a] : [match.a, match.b]));
}

function sorted(ids: readonly GroupId[]): string[] {
  return [...ids].sort();
}

function pairings(document: Tournament): string[] {
  return openRound(document).matches.map((match) => `${match.a}:${String(match.b)}`);
}

/**
 * The invariants that must hold after every draw, whatever the counts.
 *
 * Bundled because "no group is drawn twice or lost" is the acceptance criterion
 * and it has to be checked at 2 groups and at 64 alike — a helper every size
 * case calls is the only way that stays honest.
 */
function expectSoundDraw(before: Tournament, after: Tournament): Round {
  const round = openRound(after);
  const field = activeGroups(before).map((entry) => entry.id);

  // A permutation of the input: everyone in, nobody twice, nobody lost.
  expect(sorted(drawnGroups(round))).toEqual(sorted(field));
  expect(new Set(drawnGroups(round)).size).toBe(field.length);

  expect(round.matches).toHaveLength(Math.ceil(field.length / 2));
  expect(round.matches.filter((match) => match.b === null)).toHaveLength(field.length % 2);

  // Ids are unique across the whole tournament, and the document still parses —
  // which is what pins a table's occupancy to the match that claims it.
  expect(() => indexTournament(after)).not.toThrow();
  expect(() => tournamentSchema.parse(after)).not.toThrow();

  return round;
}

/**
 * Marks the first-named group the winner of every undecided match of the open
 * round, so a test can reach the close without playing the queue out.
 *
 * Matches still waiting for a table are decided too: `canCloseRound` asks for a
 * winner, not for a table.
 */
function decideEverything(document: Tournament): Tournament {
  let next = document;
  for (const match of openRound(document).matches) {
    if (match.winnerId === null) {
      next = setWinner(next, match.id, match.a);
    }
  }
  return next;
}

describe('drawing a round', () => {
  it('pairs an even field with no bye', () => {
    const before = ready(8, 4);
    const round = expectSoundDraw(before, drawRound(before, draw));

    expect(round.matches).toHaveLength(4);
    expect(round.matches.every((match) => match.b !== null)).toBe(true);
  });

  it('gives the group left over a bye that advances without ever taking a table', () => {
    const before = ready(5, 4);
    const after = drawRound(before, draw);
    const round = expectSoundDraw(before, after);

    const byes = round.matches.filter((match) => match.b === null);
    expect(byes).toHaveLength(1);

    const bye = byes[0];
    expect(bye?.tableId).toBeNull();
    expect(bye?.winnerId).toBe(bye?.a);
    expect(bye?.status).toBe('DONE');

    // §9 case 1: the bye recipient is a winner, and no table ever carried it.
    expect(roundOutcome(round).winners).toContain(bye?.a);
    expect(after.tables.some((table) => table.currentMatchId === bye?.id)).toBe(false);
  });

  it('draws the bye last, so it is the group the shuffle left over', () => {
    const round = openRound(drawRound(ready(13, 6), draw));

    expect(round.matches.at(-1)?.b).toBeNull();
    expect(round.matches.slice(0, -1).every((match) => match.b !== null)).toBe(true);
  });

  it.each([3, 5, 13, 40, 64])('keeps every one of %i groups exactly once', (count) => {
    const before = ready(count, 4);
    const round = expectSoundDraw(before, drawRound(before, draw));

    expect(round.matches).toHaveLength(Math.ceil(count / 2));
    expect(round.matches.filter((match) => match.b === null)).toHaveLength(count % 2);
    // Before anything is played, the only decided match is the bye.
    expect(roundOutcome(round).winners).toHaveLength(count % 2);
  });

  it('takes its round number and its name from the caller', () => {
    const round = openRound(drawRound(ready(4, 2), draw));

    expect(round.index).toBe(1);
    expect(round.label).toBe('Runde 1');
    expect(round.kind).toBe('QUALIFYING');
  });

  it('leaves eliminated groups out of the field', () => {
    const before = ready(6, 3, {
      groups: [
        group(1),
        group(2),
        group(3, { status: 'ELIMINATED' }),
        group(4),
        group(5, { status: 'ELIMINATED' }),
        group(6),
      ],
    });
    const round = expectSoundDraw(before, drawRound(before, draw));

    expect(round.matches).toHaveLength(2);
    expect(drawnGroups(round)).not.toContain(groupId(3));
    expect(drawnGroups(round)).not.toContain(groupId(5));
  });
});

describe('table assignment and the queue', () => {
  it('starts every match when there are more tables than matches', () => {
    const after = drawRound(ready(8, 10), draw);
    const round = openRound(after);

    expect(round.matches.every((match) => match.tableId !== null)).toBe(true);
    expect(round.matches.every((match) => match.status === 'RUNNING')).toBe(true);
    expect(queuedMatches(round)).toHaveLength(0);
    expect(freeTables(after)).toHaveLength(6);
    expect(round.state).toBe('RUNNING');
  });

  it('fills every table exactly when tables equal matches', () => {
    const after = drawRound(ready(8, 4), draw);

    expect(freeTables(after)).toHaveLength(0);
    expect(queuedMatches(openRound(after))).toHaveLength(0);
    expect(after.tables.every((table) => table.status === 'OCCUPIED')).toBe(true);
  });

  it('queues 20 matches onto 3 tables in draw order, losing none', () => {
    const after = drawRound(ready(40, 3), draw);
    const round = openRound(after);

    expect(round.matches).toHaveLength(20);

    const running = round.matches.filter((match) => match.status === 'RUNNING');
    const waiting = round.matches.filter((match) => match.status === 'WAITING_FOR_TABLE');
    expect(running).toHaveLength(3);
    expect(waiting).toHaveLength(17);
    expect(running.length + waiting.length).toBe(round.matches.length);

    // The three that got a table are the first three drawn, on the tables in
    // the host's order.
    expect(round.matches.slice(0, 3).map(playedOn)).toEqual(after.tables.map((table) => table.id));
    expect(queuedMatches(round)).toEqual(round.matches.slice(3));
  });

  it('queues every match when no table is free, and loses none', () => {
    const before = ready(10, 0);
    const after = drawRound(before, draw);
    const round = expectSoundDraw(before, after);

    expect(round.matches).toHaveLength(5);
    expect(round.matches.every((match) => match.status === 'WAITING_FOR_TABLE')).toBe(true);
    expect(queuedMatches(round)).toHaveLength(5);
    // Nothing is on a table, so nothing has started.
    expect(round.state).toBe('DRAWN');
  });

  it('never hands a match to a table that is out of service', () => {
    const withTables = ready(6, 3);
    const before = disableTable(withTables, tableIdAt(withTables, 0));
    const after = drawRound(before, draw);
    const round = openRound(after);

    expect(after.tables[0]?.status).toBe('DISABLED');
    expect(after.tables[0]?.currentMatchId).toBeNull();

    // The two tables still in service take the *first two* pairs drawn. A
    // disabled table that merely gets skipped over would leave the front of the
    // draw waiting while later pairs play, which is not the order §3 promises.
    expect(round.matches.slice(0, 2).map(playedOn)).toEqual([
      tableIdAt(after, 1),
      tableIdAt(after, 2),
    ]);
    expect(queuedMatches(round)).toEqual([matchAt(round, 2)]);
  });

  it('offers the queue in draw order, and moves nothing until the host confirms', () => {
    const after = drawRound(ready(40, 3), draw);
    const round = openRound(after);
    const first = matchAt(round, 0);
    const fourth = matchAt(round, 3);
    const table = playedOn(first);

    expect(nextQueuedMatch(after)?.id).toBe(fourth.id);

    // Marking a winner frees the table but moves nothing onto it (golden rule 3).
    const decided = setWinner(after, first.id, first.a);
    expect(matchAt(openRound(decided), 3).tableId).toBeNull();
    expect(nextQueuedMatch(decided)?.id).toBe(fourth.id);

    // The host confirms; the front of the queue takes the table.
    const assigned = assignNextQueuedMatch(decided, { tableId: table, at: FIXED_NOW });
    const started = matchAt(openRound(assigned), 3);
    expect(started.tableId).toBe(table);
    expect(started.status).toBe('RUNNING');
    expect(nextQueuedMatch(assigned)?.id).toBe(matchAt(round, 4).id);
    expect(() => tournamentSchema.parse(assigned)).not.toThrow();
  });

  it('drains the whole queue in draw order, one freed table at a time', () => {
    const drawn = drawRound(ready(14, 2), draw);
    const order = openRound(drawn).matches.map((match) => match.id);

    let document = drawn;
    const started: MatchId[] = openRound(drawn)
      .matches.filter((match) => match.tableId !== null)
      .map((match) => match.id);

    while (nextQueuedMatch(document) !== null) {
      const busy = document.tables.find((table) => table.status === 'OCCUPIED');
      const playingId = busy?.currentMatchId;
      if (busy === undefined || playingId === undefined || playingId === null) {
        throw new Error('No match is on a table, so the queue can never drain');
      }
      const playing = openRound(document).matches.find((match) => match.id === playingId);
      const offered = nextQueuedMatch(document);
      if (playing === undefined || offered === null) {
        throw new Error('Expected a running match and an offer');
      }

      document = setWinner(document, playing.id, playing.a);
      document = assignNextQueuedMatch(document, { tableId: busy.id, at: FIXED_NOW });
      started.push(offered.id);
    }

    expect(started).toEqual(order);
  });

  it('has nothing to offer and nothing to assign while no round is open', () => {
    const beforeTheDraw = ready(8, 4);
    const closed = closeRound(decideEverything(drawRound(beforeTheDraw, draw)));
    const request = { tableId: tableIdAt(closed, 0), at: FIXED_NOW };
    const anyMatch = matchIdSchema.parse('mt_1');

    for (const document of [beforeTheDraw, closed]) {
      expect(nextQueuedMatch(document)).toBeNull();
      expect(assignNextQueuedMatch(document, request)).toBe(document);
      expect(assignMatch(document, { ...request, matchId: anyMatch })).toBe(document);
    }
  });

  it('refuses a table that is not free, and a match that is already playing', () => {
    const after = drawRound(ready(40, 3), draw);
    const round = openRound(after);
    const first = matchAt(round, 0);
    const busy = playedOn(first);

    expect(
      assignMatch(after, { matchId: matchAt(round, 3).id, tableId: busy, at: FIXED_NOW }),
    ).toBe(after);

    const freed = setWinner(after, first.id, first.a);
    const running = matchAt(round, 1);
    expect(assignMatch(freed, { matchId: running.id, tableId: busy, at: FIXED_NOW })).toBe(freed);
  });

  it('does nothing when the queue is empty', () => {
    const after = drawRound(ready(4, 4), draw);
    const free = freeTables(after)[0];

    expect(nextQueuedMatch(after)).toBeNull();
    expect(free).toBeDefined();
    expect(assignNextQueuedMatch(after, { tableId: tableIdAt(after, 2), at: FIXED_NOW })).toBe(
      after,
    );
  });

  it('gives a requeued match its draw position back, ahead of later pairs', () => {
    const after = drawRound(ready(40, 3), draw);
    const requeued = matchAt(openRound(after), 1);

    // What `@/domain/tables` does when the table under a match is taken away.
    const broken = disableTable(after, playedOn(requeued));

    expect(matchAt(openRound(broken), 1).status).toBe('WAITING_FOR_TABLE');
    expect(nextQueuedMatch(broken)?.id).toBe(requeued.id);
  });
});

describe('results', () => {
  it('frees the table and knocks the loser out', () => {
    const after = drawRound(ready(8, 4), draw);
    const match = matchAt(openRound(after), 0);
    const table = playedOn(match);
    const winnerId = match.a;
    const loserId = opponent(match);

    const decided = setWinner(after, match.id, winnerId);
    const settled = matchAt(openRound(decided), 0);

    expect(settled.winnerId).toBe(winnerId);
    expect(settled.status).toBe('DONE');
    // The match keeps the record of where it was played; only the table forgets.
    expect(settled.tableId).toBe(table);

    const freed = decided.tables.find((entry) => entry.id === table);
    expect(freed?.status).toBe('FREE');
    expect(freed?.currentMatchId).toBeNull();
    expect(freed?.occupiedSince).toBeNull();

    const groups = indexTournament(decided).groups;
    expect(groups.get(loserId)?.status).toBe('ELIMINATED');
    expect(groups.get(winnerId)?.status).toBe('ACTIVE');
    expect(activeGroups(decided).map((entry) => entry.id)).not.toContain(loserId);
  });

  it('corrects a winner in place and puts the wrongly eliminated group back', () => {
    const after = drawRound(ready(8, 4), draw);
    const match = matchAt(openRound(after), 0);
    const first = match.a;
    const second = opponent(match);

    const corrected = setWinner(setWinner(after, match.id, first), match.id, second);
    const groups = indexTournament(corrected).groups;
    const outcome = roundOutcome(openRound(corrected));

    expect(matchAt(openRound(corrected), 0).winnerId).toBe(second);
    expect(groups.get(second)?.status).toBe('ACTIVE');
    expect(groups.get(first)?.status).toBe('ELIMINATED');
    expect(outcome.winners).toContain(second);
    expect(outcome.losers).toContain(first);
  });

  it('does not take a table back off the pair that took it over', () => {
    const after = drawRound(ready(40, 3), draw);
    const first = matchAt(openRound(after), 0);
    const table = playedOn(first);

    const decided = setWinner(after, first.id, first.a);
    const reused = assignNextQueuedMatch(decided, { tableId: table, at: FIXED_NOW });

    // Correcting the finished match must not free the table under the next one.
    const corrected = setWinner(reused, first.id, opponent(first));
    const carrying = corrected.tables.find((entry) => entry.id === table);

    expect(carrying?.status).toBe('OCCUPIED');
    expect(carrying?.currentMatchId).toBe(matchAt(openRound(corrected), 3).id);
    expect(() => tournamentSchema.parse(corrected)).not.toThrow();
  });

  it('refuses a winner for a bye, for an outsider and for an unknown match', () => {
    const after = drawRound(ready(5, 3), draw);
    const round = openRound(after);
    const bye = round.matches.find((match) => match.b === null);
    const played = matchAt(round, 0);
    const outsider = drawnGroups(round).find((id) => id !== played.a && id !== played.b);

    expect(bye).toBeDefined();
    expect(outsider).toBeDefined();
    expect(setWinner(after, bye?.id ?? played.id, bye?.a ?? played.a)).toBe(after);
    expect(setWinner(after, played.id, outsider ?? played.a)).toBe(after);
    expect(setWinner(after, matchIdSchema.parse('mt_999'), played.a)).toBe(after);
  });

  it('does nothing when the winner is already the one asked for', () => {
    const after = drawRound(ready(4, 2), draw);
    const match = matchAt(openRound(after), 0);
    const decided = setWinner(after, match.id, match.a);

    expect(setWinner(decided, match.id, match.a)).toBe(decided);
  });

  it('refuses to change a round that has been closed', () => {
    const closed = closeRound(decideEverything(drawRound(ready(4, 2), draw)));
    const played = closed.rounds[0];
    const match = played === undefined ? undefined : played.matches[0];

    expect(match).toBeDefined();
    expect(setWinner(closed, match?.id ?? matchIdSchema.parse('mt_1'), groupId(1))).toBe(closed);
  });
});

describe('closing a round', () => {
  it('stays shut while a match is undecided', () => {
    const after = drawRound(ready(6, 3), draw);
    const match = matchAt(openRound(after), 0);
    const partly = setWinner(after, match.id, match.a);

    expect(canCloseRound(partly)).toBe(false);
    expect(closeRoundBlockers(partly)).toEqual(['MATCHES_UNDECIDED']);
    expect(closeRound(partly)).toBe(partly);
  });

  it('closes once every match is decided, and reports winners and losers', () => {
    const before = ready(9, 4);
    const after = drawRound(before, draw);
    const decided = decideEverything(after);

    expect(canCloseRound(decided)).toBe(true);

    const closed = closeRound(decided);
    const played = closed.rounds[0];
    expect(played?.state).toBe('CLOSED');
    expect(currentRound(closed)).toBeNull();

    const outcome = roundOutcome(played ?? openRound(after));
    // Nine groups: four matches and one bye, so five advance and four go out.
    expect(outcome.winners).toHaveLength(5);
    expect(outcome.losers).toHaveLength(4);
    expect(sorted([...outcome.winners, ...outcome.losers])).toEqual(
      sorted(activeGroups(before).map((entry) => entry.id)),
    );
    expect(sorted(outcome.winners)).toEqual(sorted(activeGroups(closed).map((entry) => entry.id)));
  });

  it('leaves no table occupied by a round that is over', () => {
    const closed = closeRound(decideEverything(drawRound(ready(8, 4), draw)));

    expect(closed.tables.every((table) => table.status === 'FREE')).toBe(true);
    expect(() => tournamentSchema.parse(closed)).not.toThrow();
  });

  it('says there is nothing to close before the first draw', () => {
    expect(closeRoundBlockers(ready(4, 2))).toEqual(['NO_OPEN_ROUND']);
    expect(canCloseRound(ready(4, 2))).toBe(false);
  });

  it('counts a bye as a winner with no loser', () => {
    const closed = closeRound(decideEverything(drawRound(ready(3, 2), draw)));
    const round = closed.rounds[0];
    const bye = round?.matches.find((match) => match.b === null);
    const outcome = roundOutcome(round ?? openRound(closed));

    expect(bye).toBeDefined();
    expect(outcome.winners).toContain(bye?.a);
    expect(outcome.losers).not.toContain(bye?.a);
    expect(outcome.losers).toHaveLength(1);
  });
});

describe('when a round may be drawn', () => {
  it('refuses to draw before the tournament has started', () => {
    const setup: Tournament = { ...ready(8, 4), phase: 'SETUP' };

    expect(drawBlockers(setup)).toContain('NOT_A_DRAWING_PHASE');
    expect(canDrawRound(setup)).toBe(false);
    expect(drawRound(setup, draw)).toBe(setup);
  });

  it('draws as soon as the host has started the tournament', () => {
    const started = startTournament(
      addTables(addGroups(tournament(), 8), { count: 4, label: tableLabel }),
    );

    expect(started.phase).toBe('QUALIFYING');
    expect(canDrawRound(started)).toBe(true);
    expect(openRound(drawRound(started, draw)).matches).toHaveLength(4);
  });

  it('refuses a second draw while a round is open', () => {
    const after = drawRound(ready(8, 4), draw);

    expect(drawBlockers(after)).toContain('ROUND_OPEN');
    expect(drawRound(after, draw)).toBe(after);
  });

  it('refuses a second qualifying round once the first one is closed', () => {
    const closed = closeRound(decideEverything(drawRound(ready(8, 4), draw)));

    expect(drawBlockers(closed)).toEqual(['QUALIFYING_ALREADY_DRAWN']);
    expect(drawRound(closed, draw)).toBe(closed);
  });

  it('draws an elimination round from the winners once the phase moves on', () => {
    // 64 leaves 32 standing, which is the smallest field docs/TOURNAMENT-RULES
    // §5 still runs an elimination round on: at 16 or below the final phase has
    // been reached and another round would take it below the bracket.
    const closed = closeRound(decideEverything(drawRound(ready(64, 4), draw)));
    // Issue #22 owns the phase change; here it stands in for it.
    const eliminating: Tournament = { ...closed, phase: 'ELIMINATION' };
    const second = drawRound(eliminating, draw);
    const round = openRound(second);
    const first = closed.rounds[0];

    expect(round.kind).toBe('ELIMINATION');
    expect(round.index).toBe(2);
    expect(round.label).toBe('Runde 2');
    expect(round.matches).toHaveLength(16);
    expect(sorted(drawnGroups(round))).toEqual(sorted(roundOutcome(first ?? round).winners));
    // Ids never collide with the round that has already been played.
    expect(() => indexTournament(second)).not.toThrow();
    expect(() => tournamentSchema.parse(second)).not.toThrow();
  });

  it('refuses a field of fewer than two groups', () => {
    const single = ready(1, 2);

    expect(drawBlockers(single)).toContain('TOO_FEW_GROUPS');
    expect(drawRound(single, draw)).toBe(single);
  });

  /*
   * docs/TOURNAMENT-RULES.md §9 case 5: two participants play one match, and
   * that match is the `Finale`. Drawing a qualifying round for them would leave
   * a single group standing and a bracket of one — issue #22 routes them
   * straight to the naming phase instead (docs/OPEN-QUESTIONS.md #62).
   */
  it('refuses a qualifying round for a field of exactly two', () => {
    const pair = ready(2, 2);

    expect(drawBlockers(pair)).toEqual(['FINAL_PHASE_REACHED']);
    expect(drawRound(pair, draw)).toBe(pair);
  });

  /*
   * The `while |W| > 16` of §5, as a refusal: a round dealt at sixteen would
   * take the field to eight and the `Achtelfinale` the room was promised would
   * never be played.
   */
  it('refuses another elimination round once the final phase size is reached', () => {
    const closed = closeRound(decideEverything(drawRound(ready(32, 4), draw)));
    const eliminating: Tournament = { ...closed, phase: 'ELIMINATION' };

    expect(activeGroups(eliminating)).toHaveLength(16);
    expect(drawBlockers(eliminating)).toEqual(['FINAL_PHASE_REACHED']);
    expect(drawRound(eliminating, draw)).toBe(eliminating);
  });
});

/*
 * docs/TOURNAMENT-RULES.md §4 fallback 1: *Freilose vergeben* records a debt,
 * and §5 says the **next draw** settles it. The arithmetic is worth its own
 * cases because getting it wrong is invisible until the bracket is built: a
 * field of 13 short of 16 owes three `Freilose`, and a draw that handed out
 * only the one an odd count earns would produce 7 winners where the bracket
 * needs 8.
 */
describe('Freilose owed by the repechage fallback', () => {
  /** A tournament in `ELIMINATION` with `active` groups and `owed` byes due. */
  function owing(active: number, target: number): Tournament {
    const base = ready(active, 4, { phase: 'ELIMINATION' });
    return {
      ...base,
      // A qualifying round of `active` matches, closed: that is the `|W|` the
      // repechage worked from, and nobody accepted a place.
      rounds: [
        {
          id: roundIdSchema.parse('rnd_1'),
          index: 1,
          kind: 'QUALIFYING',
          label: 'Runde 1',
          state: 'CLOSED',
          matches: base.groups.map((entry, index) => ({
            id: matchIdSchema.parse(`mt_${String(index + 1)}`),
            tableId: null,
            a: entry.id,
            b: null,
            winnerId: entry.id,
            status: 'DONE' as const,
          })),
        },
      ],
      repechage: { target, pool: [], draws: [], fallbackUsed: 'BYES' },
    };
  }

  it('counts what the fallback still owes the next draw', () => {
    expect(byesOwed(owing(20, 32))).toBe(12);
    expect(fieldSize(owing(20, 32))).toBe(32);
  });

  it('deals every owed Freilos in the round that settles the debt', () => {
    // Twenty standing short of thirty-two: twelve places became `Freilose`.
    const round = openRound(drawRound(owing(20, 32), draw));

    // 32 places: four real pairs and twelve byes.
    expect(round.matches).toHaveLength(16);
    expect(round.matches.filter((entry) => entry.b === null)).toHaveLength(12);
    // The byes are the back of the shuffle, where §3 already puts the one an
    // odd count earns.
    expect(round.matches.slice(0, 4).every((entry) => entry.b !== null)).toBe(true);
  });

  /*
   * A target that is a power of two always leaves an even remainder, so this
   * branch is only reachable from a file repaired by hand (docs/FILE-FORMAT.md
   * §Encoding invites exactly that). What matters is that the round is still
   * sound: everybody in it once, nobody dropped, which is what §3's own
   * odd-count rule guarantees on top of the debt.
   */
  it('still deals a sound round when a repaired file names an impossible target', () => {
    const before = owing(21, 31);
    const round = openRound(drawRound(before, draw));

    expect(round.matches).toHaveLength(16);
    // Ten owed plus the one the odd remainder earns.
    expect(round.matches.filter((entry) => entry.b === null)).toHaveLength(11);
    expect(sorted(drawnGroups(round))).toEqual(sorted(before.groups.map((entry) => entry.id)));
  });

  it('never hands the same Freilos out twice', () => {
    const settled = drawRound(owing(20, 32), draw);

    expect(byesOwed(settled)).toBe(0);
  });

  it('owes nothing when the host did not take that fallback', () => {
    const reopened: Tournament = {
      ...owing(20, 32),
      repechage: { target: 32, pool: [], draws: [], fallbackUsed: null },
    };

    expect(byesOwed(reopened)).toBe(0);
    expect(byesOwed(ready(8, 2))).toBe(0);
  });
});

describe('reproducibility', () => {
  it('produces the identical draw from the same seed and cursor', () => {
    const before = ready(16, 5);
    const once = drawRound(before, draw);
    const twice = drawRound(before, draw);

    expect(twice.rounds).toEqual(once.rounds);
    expect(twice.tables).toEqual(once.tables);
    expect(twice.rngCursor).toBe(once.rngCursor);
  });

  it('replays a draw from the seed and the cursor stored in the file', () => {
    const before = ready(16, 5);
    const live = drawRound(before, draw);
    const replayed = drawRound(before, {
      ...draw,
      rng: createRng(before.rngSeed, before.rngCursor),
    });

    expect(replayed.rounds).toEqual(live.rounds);
  });

  it('moves the cursor on, so a redraw after an undo differs', () => {
    const before = ready(16, 5);
    const after = drawRound(before, draw);

    expect(after.rngCursor).toBeGreaterThan(before.rngCursor);

    // What a host sees after undoing a draw they did not like: the round is
    // gone, the cursor is not rewound (docs/OPEN-QUESTIONS.md #32), and the
    // redraw is a different one.
    const undone: Tournament = { ...before, rngCursor: after.rngCursor };

    expect(pairings(drawRound(undone, draw))).not.toEqual(pairings(after));
  });

  it('writes back exactly the cursor the generator reached', () => {
    const rng = createRng('another-seed', 7);
    const after = drawRound(ready(16, 5), { ...draw, rng });

    expect(after.rngCursor).toBe(rng.cursor);
    expect(after.rngCursor).toBeGreaterThan(7);
  });

  it('draws a different field from a different seed', () => {
    const before = ready(64, 8);

    const one = drawRound(before, { ...draw, rng: createRng('seed-one') });
    const other = drawRound(before, { ...draw, rng: createRng('seed-two') });

    expect(pairings(one)).not.toEqual(pairings(other));
  });
});

describe('a whole qualifying round on too few tables', () => {
  it('runs 13 groups on 2 tables from draw to close without losing anybody', () => {
    const before = ready(13, 2);
    let document = drawRound(before, draw);
    const round = expectSoundDraw(before, document);

    // Six pairs and a bye; two pairs start, four wait.
    expect(round.matches).toHaveLength(7);
    expect(queuedMatches(round)).toHaveLength(4);

    // Play it the way a host does: decide whatever is on a table, then hand
    // that table to the next queued pair.
    let guard = 0;
    while (!canCloseRound(document)) {
      guard += 1;
      if (guard > 100) {
        throw new Error('The queue did not drain');
      }
      const playing = openRound(document).matches.find(
        (match) => match.tableId !== null && match.winnerId === null,
      );
      if (playing === undefined) {
        throw new Error('No match is on a table, so the round can never finish');
      }
      const table = playedOn(playing);
      document = setWinner(document, playing.id, playing.a);
      document = assignNextQueuedMatch(document, { tableId: table, at: FIXED_NOW });
    }

    const closed = closeRound(document);
    const played = closed.rounds[0];
    const outcome = roundOutcome(played ?? round);

    expect(outcome.winners).toHaveLength(7);
    expect(outcome.losers).toHaveLength(6);
    expect(closed.tables.every((table) => table.status === 'FREE')).toBe(true);
    expect(activeGroups(closed)).toHaveLength(7);
    expect(() => tournamentSchema.parse(closed)).not.toThrow();
  });
});

describe('rematches (issue #72)', () => {
  /** Every pairing of a round as an unordered key, so a repeat is comparable. */
  function meetings(round: Round): readonly string[] {
    return round.matches
      .filter((entry) => entry.b !== null)
      .map((entry) => [entry.a, String(entry.b)].sort().join('+'));
  }

  /**
   * Plays the open round out and draws the next one.
   *
   * The field has to be above 16 for there to *be* a next round — §5's loop
   * ends at the final phase — so every case here starts from a large one.
   */
  function playOn(document: Tournament): Tournament {
    const closed = closeRound(decideEverything(document));
    return drawRound({ ...closed, phase: 'ELIMINATION' }, draw);
  }

  it('never repeats a pairing from the round before', () => {
    // With a plain shuffle this fails often enough to be noticed from the
    // third row, which is the whole of issue #72.
    const first = drawRound(ready(64, 8), draw);
    const second = playOn(first);

    const before = meetings(openRound(first));
    const after = meetings(openRound(second));

    expect(after).toHaveLength(16);
    expect(after.filter((pairing) => before.includes(pairing))).toEqual([]);
  });

  it('never repeats a pairing at any point of a whole evening', () => {
    // Every meeting of the evening distinct, not only consecutive ones: a
    // group knocked back in by the repechage could otherwise meet somebody
    // from two rounds ago.
    let document = drawRound(ready(128, 8), draw);
    const seen: string[] = [...meetings(openRound(document))];

    while (canDrawRound({ ...closeRound(decideEverything(document)), phase: 'ELIMINATION' })) {
      document = playOn(document);
      const next = meetings(openRound(document));
      expect(next.filter((pairing) => seen.includes(pairing))).toEqual([]);
      seen.push(...next);
    }

    // Two elimination rounds after the qualifying one: 128 to 64 to 32 to 16.
    expect(document.rounds).toHaveLength(3);
  });

  it('keeps repechage returnees away from the groups that knocked them out', () => {
    // The issue's fifth case. A `Hoffnungsrunde` that readmitted every loser
    // puts 34 groups back in front of the draw, and each of the 17 returnees
    // has already played exactly one of them (docs/TOURNAMENT-RULES.md §4).
    const first = drawRound(ready(34, 4), draw);
    const before = meetings(openRound(first));

    const closed = closeRound(decideEverything(first));
    const returned: Tournament = {
      ...closed,
      phase: 'ELIMINATION',
      groups: closed.groups.map((entry) => ({ ...entry, status: 'ACTIVE' as const })),
    };

    const second = drawRound(returned, draw);

    expect(meetings(openRound(second))).toHaveLength(17);
    expect(meetings(openRound(second)).filter((pairing) => before.includes(pairing))).toEqual([]);
  });

  it('previews nothing when there is nothing to draw', () => {
    // Same refusal as `drawRound`'s, so the host panel can ask the question
    // before it knows whether the button is live.
    expect(previewDrawRound(ready(8, 4, { phase: 'SETUP' }), draw)).toBeNull();
    expect(previewDrawRound(drawRound(ready(8, 4), draw), draw)).toBeNull();
  });

  it('reports no forced rematch in an ordinary round', () => {
    const drawn = drawRound(ready(8, 4), draw);

    expect(forcedRematches(drawn, openRound(drawn))).toEqual([]);
    expect(previewDrawRound(ready(8, 4), draw)?.forced).toEqual([]);
  });

  describe('when no rematch-free pairing exists', () => {
    /**
     * A field in which everyone has already played everyone.
     *
     * Not a state ordinary play reaches — the field halves every round, so
     * nobody accumulates 17 opponents — but a file repaired by hand can say
     * it (docs/FILE-FORMAT.md §Encoding invites exactly that), and what the
     * engine must never do with it is search forever in front of the room.
     */
    function exhausted(): Tournament {
      const base = ready(18, 4, { phase: 'ELIMINATION' });
      const ids = base.groups.map((entry) => entry.id);

      const matches = [];
      let number = 1;
      for (let a = 0; a < ids.length; a += 1) {
        for (let b = a + 1; b < ids.length; b += 1) {
          matches.push({
            id: matchIdSchema.parse(`mt_${String(number)}`),
            tableId: null,
            a: ids[a] as GroupId,
            b: ids[b] as GroupId,
            winnerId: ids[a] as GroupId,
            status: 'DONE' as const,
          });
          number += 1;
        }
      }

      return {
        ...base,
        rounds: [
          {
            id: roundIdSchema.parse('rnd_1'),
            index: 1,
            kind: 'QUALIFYING',
            label: 'Runde 1',
            state: 'CLOSED',
            matches,
          },
        ],
      };
    }

    it('still deals a sound round rather than looping or throwing', () => {
      const before = exhausted();

      // The invariant that matters most: everybody in it once, nobody lost.
      expectSoundDraw(before, drawRound(before, draw));
    });

    it('marks the pairs it could not avoid, so the host can be asked', () => {
      const before = exhausted();
      const after = drawRound(before, draw);
      const forced = forcedRematches(after, openRound(after));

      // Every pair, because there is no other pairing of a field that has
      // played itself out.
      expect(forced).toHaveLength(9);
      expect(forced.map((entry) => entry.id)).toEqual(
        openRound(after).matches.map((entry) => entry.id),
      );
    });

    it('says so in a preview, without committing anything', () => {
      const before = exhausted();
      const preview = previewDrawRound(before, draw);

      expect(preview?.forced).toHaveLength(9);
      // Nothing happened: no round appended, no cursor spent. Declining the
      // confirmation costs the host nothing (issue #72).
      expect(before.rounds).toHaveLength(1);
      expect(before.rngCursor).toBe(ready(18, 4).rngCursor);
    });

    it('previews exactly the round the commit then deals', () => {
      const before = exhausted();
      const preview = previewDrawRound(before, draw);

      expect(openRound(drawRound(before, draw))).toEqual(preview?.round);
    });
  });

  it('reproduces the same pairing from the same seed and the same history', () => {
    const closed = closeRound(decideEverything(drawRound(ready(64, 8), draw)));
    const elimination: Tournament = { ...closed, phase: 'ELIMINATION' };

    const once = drawRound(elimination, draw);
    const again = drawRound(elimination, draw);

    expect(pairings(again)).toEqual(pairings(once));
    expect(again.rngCursor).toBe(once.rngCursor);
  });

  it('deals a different pairing once the history changes', () => {
    // Same seed, same cursor, same field, a different set of past meetings.
    // The pairing has to follow the history, or the constraint does nothing.
    const played = drawRound(ready(34, 4), draw);
    const withHistory: Tournament = {
      ...played,
      phase: 'ELIMINATION',
      groups: played.groups.map((entry) => ({ ...entry, status: 'ACTIVE' as const })),
      rounds: played.rounds.map((entry) => ({ ...entry, state: 'CLOSED' as const })),
      rngCursor: 0,
    };
    const withoutHistory: Tournament = { ...withHistory, rounds: [] };

    expect(pairings(drawRound(withHistory, draw))).not.toEqual(
      pairings(drawRound(withoutHistory, draw)),
    );
  });
});

describe('purity', () => {
  it('never mutates the tournament it is given', () => {
    const before = ready(9, 3);
    const snapshot = structuredClone(before);

    const after = drawRound(before, draw);
    const match = matchAt(openRound(after), 0);
    setWinner(after, match.id, match.a);
    closeRound(decideEverything(after));

    expect(before).toEqual(snapshot);
  });

  it('hands its argument straight back when nothing can happen', () => {
    const drawn = drawRound(ready(8, 4), draw);

    expect(drawRound(drawn, draw)).toBe(drawn);
    expect(assignNextQueuedMatch(drawn, { tableId: tableIdAt(drawn, 0), at: FIXED_NOW })).toBe(
      drawn,
    );
    expect(closeRound(drawn)).toBe(drawn);
  });
});
