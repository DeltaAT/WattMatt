import type { Group, Match, Round, RoundTrack, Table, Tournament } from '@/domain/types';

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
 * The round the host is working in **on one track**: the last one of that track
 * not yet closed (docs/TOURNAMENT-RULES.md §10).
 *
 * Searched from the end because rounds only ever get appended, and the newest
 * open round of a track is always its live one. Returns null before the first
 * draw and again in the gap after a round is closed but the next has not been
 * drawn — both are real states the host UI has to render.
 *
 * The track defaults to `MAIN`, which is what every caller written before the
 * `Trostrunde` existed meant and what every caller that is about the main
 * tournament still means. That default is load-bearing rather than convenient:
 * the side event must be invisible to the main field, so a main-field check
 * that forgot to say which track it meant has to keep answering about the main
 * field rather than start seeing a `Trostrunde` round as "the open round"
 * (issue #73).
 */
export function currentRound(tournament: Tournament, track: RoundTrack = 'MAIN'): Round | null {
  for (let index = tournament.rounds.length - 1; index >= 0; index -= 1) {
    const round = tournament.rounds[index];
    if (round !== undefined && round.track === track && round.state !== 'CLOSED') {
      return round;
    }
  }
  return null;
}

/**
 * Every round of a track, oldest first.
 *
 * The two tracks are counted separately — `Runde 3` and `Trostrunde 2` are both
 * the third and second thing their own half of the evening has played — so the
 * index a draw hands out is a count over this, not over `rounds`.
 */
export function roundsOfTrack(tournament: Tournament, track: RoundTrack): readonly Round[] {
  return tournament.rounds.filter((round) => round.track === track);
}

/**
 * The groups still playing in the `Trostrunde` (docs/TOURNAMENT-RULES.md §10).
 *
 * The counterpart of `activeGroups`, and deliberately disjoint from it: a group
 * has one status, so it is in the main field or in the side event or out, and
 * never in two of them. That is what makes "a `Trostrunde` group never appears
 * in a main-field draw" a property of the model rather than a filter somebody
 * has to remember to apply (issue #73).
 */
export function consolationGroups(tournament: Tournament): readonly Group[] {
  return tournament.groups.filter((group) => group.status === 'CONSOLATION');
}

/**
 * Tables a match could be played on at all — everything not `gesperrt`.
 *
 * Wider than `freeTables` and answering a different question. `freeTables` asks
 * where the next match can go *now*; this asks whether the tournament has any
 * playing surface, which is what the pre-start check of
 * docs/TOURNAMENT-RULES.md §2 requires and what the queue estimate divides by.
 * A table with a match on it is not free, but it is very much usable — it frees
 * up the moment that match is decided.
 */
export function usableTables(tournament: Tournament): readonly Table[] {
  return tournament.tables.filter((table) => table.status !== 'DISABLED');
}
