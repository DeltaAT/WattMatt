import type { Group, Match, Round, Table, Tournament } from '@/domain/types';

/**
 * Derived reads over a tournament. Pure, cheap, and never cached — the store
 * commits whole new states, so a memoised answer is stale exactly when the host
 * needs it (see `@/domain/lookup`).
 */

/**
 * The groups still in the tournament.
 *
 * This is the `P` of docs/TOURNAMENT-RULES.md §3 and the `W` its later sections
 * carry forward: everything that pairs, draws or advances counts active groups,
 * never `groups.length`.
 */
export function activeGroups(tournament: Tournament): readonly Group[] {
  return tournament.groups.filter((group) => group.status === 'ACTIVE');
}

/**
 * Tables a waiting match may be sent to, in the host's configured order.
 *
 * `DISABLED` is deliberately not free: a table taken out of service — wobbly
 * leg, no light above it — must not be handed the next match
 * (docs/TOURNAMENT-RULES.md §0).
 */
export function freeTables(tournament: Tournament): readonly Table[] {
  return tournament.tables.filter((table) => table.status === 'FREE');
}

/**
 * Matches of a round that still need a winner.
 *
 * Keyed on `winnerId` rather than on `status === 'DONE'`, because this answers
 * "may the host close this round?" and a round is decidable exactly when every
 * match has a winner. A bye is already decided the moment it is drawn
 * (docs/TOURNAMENT-RULES.md §3), so it never appears here.
 *
 * Takes a `Round` rather than the tournament: the caller says which round it
 * means, usually by way of `currentRound`.
 */
export function undecidedMatches(round: Round): readonly Match[] {
  return round.matches.filter((match) => match.winnerId === null);
}

/**
 * The round the host is working in: the last one not yet closed.
 *
 * Searched from the end because rounds only ever get appended, and the newest
 * open round is always the live one. Returns null before the first draw and
 * again in the gap after a round is closed but the next has not been drawn —
 * both are real states the host UI has to render.
 */
export function currentRound(tournament: Tournament): Round | null {
  for (let index = tournament.rounds.length - 1; index >= 0; index -= 1) {
    const round = tournament.rounds[index];
    if (round !== undefined && round.state !== 'CLOSED') {
      return round;
    }
  }
  return null;
}
