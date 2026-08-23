import { describe, expect, it } from 'vitest';

import { activeGroups, currentRound, freeTables, undecidedMatches } from '@/domain/selectors';
import {
  group,
  groupId,
  match,
  matchId,
  round,
  roundId,
  table,
  tournament,
} from '@/domain/testFixtures';

describe('activeGroups', () => {
  it('keeps only the groups still in the tournament', () => {
    const state = tournament({
      groups: [group(1), group(2, { status: 'ELIMINATED' }), group(3)],
    });

    expect(activeGroups(state).map((entry) => entry.id)).toEqual([groupId(1), groupId(3)]);
  });

  it('is empty during SETUP before any group is added', () => {
    expect(activeGroups(tournament())).toEqual([]);
  });

  /* Odd counts are the normal case, not an exception (rules §9 case 1). */
  it('does not care whether the count is even', () => {
    const state = tournament({ groups: [group(1), group(2), group(3)] });
    expect(activeGroups(state)).toHaveLength(3);
  });
});

describe('freeTables', () => {
  it('returns tables that can take a match', () => {
    const state = tournament({
      tables: [table(1), table(2, { status: 'OCCUPIED', currentMatchId: matchId(1) }), table(3)],
    });

    expect(freeTables(state).map((entry) => entry.label)).toEqual(['Tisch 1', 'Tisch 3']);
  });

  /*
   * A table taken out of service must never be offered the next match, so
   * DISABLED is excluded as firmly as OCCUPIED (docs/TOURNAMENT-RULES.md §0).
   */
  it('never offers a disabled table', () => {
    const state = tournament({ tables: [table(1, { status: 'DISABLED' })] });
    expect(freeTables(state)).toEqual([]);
  });

  it('preserves the host-configured table order', () => {
    const state = tournament({ tables: [table(3), table(1), table(2)] });
    expect(freeTables(state).map((entry) => entry.label)).toEqual([
      'Tisch 3',
      'Tisch 1',
      'Tisch 2',
    ]);
  });
});

describe('undecidedMatches', () => {
  it('returns the matches that still need a winner', () => {
    const decided = match(1, { winnerId: groupId(1), status: 'DONE' });
    const open = match(2, { status: 'RUNNING' });

    expect(undecidedMatches(round(1, { matches: [decided, open] }))).toEqual([open]);
  });

  /*
   * A Freilos is decided the moment it is drawn: the lone group advances
   * without playing (docs/TOURNAMENT-RULES.md §3), so it must not hold the
   * round open.
   */
  it('does not count a bye as undecided', () => {
    const bye = match(1, { b: null, winnerId: groupId(1), status: 'DONE' });
    expect(undecidedMatches(round(1, { matches: [bye] }))).toEqual([]);
  });

  /*
   * Keyed on the winner, not on status: a match queued for a table has no
   * winner and must keep the round open even though nothing is running.
   */
  it('counts a match still waiting for a table', () => {
    const waiting = match(1, { status: 'WAITING_FOR_TABLE' });
    expect(undecidedMatches(round(1, { matches: [waiting] }))).toHaveLength(1);
  });

  it('is empty for a round where every match has a winner', () => {
    const state = round(1, {
      matches: [
        match(1, { winnerId: groupId(1), status: 'DONE' }),
        match(2, { winnerId: groupId(3), status: 'DONE' }),
      ],
    });

    expect(undecidedMatches(state)).toEqual([]);
  });
});

describe('currentRound', () => {
  it('is null before the first draw', () => {
    expect(currentRound(tournament())).toBeNull();
  });

  it('is the newest round that is not closed', () => {
    const state = tournament({
      rounds: [round(1, { state: 'CLOSED' }), round(2, { state: 'RUNNING' })],
    });

    expect(currentRound(state)?.id).toBe(roundId(2));
  });

  /*
   * The gap between closing a round and drawing the next is a real state the
   * host UI has to render — it is where the host stands while announcing the
   * results, and it must not report the closed round as still live.
   */
  it('is null again once every round is closed', () => {
    const state = tournament({
      rounds: [round(1, { state: 'CLOSED' }), round(2, { state: 'CLOSED' })],
    });

    expect(currentRound(state)).toBeNull();
  });

  it('picks a freshly drawn round over an earlier closed one', () => {
    const state = tournament({
      rounds: [round(1, { state: 'CLOSED' }), round(2, { state: 'DRAWN' })],
    });

    expect(currentRound(state)?.state).toBe('DRAWN');
  });

  /*
   * Searched from the end rather than by index: an out-of-order rounds array
   * (a migration, a hand-repaired file) must still yield the newest open round
   * rather than whatever happens to sit at a fixed position.
   */
  it('does not depend on array position', () => {
    const state = tournament({
      rounds: [round(1, { state: 'CLOSED' }), round(2, { state: 'CLOSED' }), round(3)],
    });

    expect(currentRound(state)?.id).toBe(roundId(3));
  });
});
