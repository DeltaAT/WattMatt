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
 * Tables a waiting match may be sent to, in the order the host wants them
 * handed out (issue #101).
 *
 * `DISABLED` is deliberately not free: a table taken out of service — wobbly
 * leg, no light above it — must not be handed the next match
 * (docs/TOURNAMENT-RULES.md §0).
 *
 * **This is the one place the direction is applied**, and that is deliberate
 * rather than tidy. Every automatic choice of a table in the app comes through
 * here — the draw filling the qualifying round, the tree filling its first
 * round, and the table each picker offers first — so one reversal governs all
 * of them and none of them can be forgotten. The board the host reads is
 * *not* reordered: `occupancyBoard` still draws the tables in list order,
 * because the question there is "where is table 3" and the answer must not
 * move when this setting changes.
 *
 * Reversed rather than sorted, so it stays an ordering of the host's own list.
 * "Last" means the last row of the table panel, never the highest number
 * parsed out of a label — tables get renamed and reordered (issue #13), and the
 * list is the thing the host is looking at.
 *
 * `DESCENDING` skips a `gesperrt` table for exactly the same reason
 * `ASCENDING` does: the filter runs first, so both directions walk the same
 * pool from opposite ends.
 */
export function freeTables(tournament: Tournament, track?: RoundTrack): readonly Table[] {
  const free = tournament.tables.filter(
    (table) => table.status === 'FREE' && servesTrack(table, track),
  );
  return tournament.settings.tableAssignmentOrder === 'DESCENDING' ? [...free].reverse() : free;
}

/**
 * Whether a table may take a match of this track (issue #79).
 *
 * An unreserved table serves either, which is the default and stays the common
 * arrangement. A reserved one serves exactly the track it names.
 *
 * `undefined` means the caller is not asking on behalf of a track at all — the
 * host picking a move target by hand, say. That is deliberately *not* the same
 * as asking for `MAIN`: a reservation is a standing answer to "where does the
 * draw put things", never a lock on what the host may do with their own tables
 * (CLAUDE.md golden rule 3).
 */
export function servesTrack(table: Table, track?: RoundTrack): boolean {
  return track === undefined || table.reservedFor === null || table.reservedFor === track;
}

/**
 * The tables this track may ever use — reserved to it or to nobody, and not
 * out of service.
 *
 * The question behind "why is nothing starting?": a track whose every table is
 * reserved for the other one has a queue that cannot move, and the host has to
 * be told which of the two problems they have (issue #79). `freeTables` asks
 * where the next match can go *now*; this asks whether there is anywhere at all.
 */
export function tablesForTrack(tournament: Tournament, track: RoundTrack): readonly Table[] {
  return usableTables(tournament).filter((table) => servesTrack(table, track));
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
