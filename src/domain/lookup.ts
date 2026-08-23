import type { BracketNode, Group, Match, Round, Table, Tournament } from '@/domain/types';

/**
 * Entities are reached by ID, never by array position (CLAUDE.md §6).
 *
 * The reason is not tidiness. `rounds[2]` silently becomes the wrong round the
 * first time a round is inserted or removed, and the failure surfaces on the
 * projector rather than in a test. A map lookup either finds the entity or
 * returns `undefined`, and `noUncheckedIndexedAccess` forces that to be handled.
 */

/** Anything with a branded `id`, which is every entity in the model. */
type Identified = { id: string };

/**
 * Index a collection by ID.
 *
 * A duplicate ID throws rather than letting the later entity quietly win: two
 * groups sharing an ID means a corrupt file or a broken action, and finding out
 * at load time beats finding out when the wrong card turns green mid-round.
 */
export function indexById<T extends Identified>(items: readonly T[]): ReadonlyMap<T['id'], T> {
  const index = new Map<T['id'], T>();
  for (const item of items) {
    if (index.has(item.id)) {
      throw new Error(`Duplicate entity id: "${item.id}"`);
    }
    index.set(item.id, item);
  }
  return index;
}

/** Every match of the tournament, in round order then draw order. */
export function allMatches(tournament: Tournament): readonly Match[] {
  return tournament.rounds.flatMap((round) => round.matches);
}

/**
 * Every entity of a tournament, keyed by ID.
 *
 * Built once per read rather than memoised: the store commits whole new states,
 * so a cached index would be one commit stale exactly when it matters. Building
 * it is a linear pass over a few hundred entities at worst.
 */
export type TournamentIndex = {
  groups: ReadonlyMap<Group['id'], Group>;
  tables: ReadonlyMap<Table['id'], Table>;
  rounds: ReadonlyMap<Round['id'], Round>;
  matches: ReadonlyMap<Match['id'], Match>;
  bracketNodes: ReadonlyMap<BracketNode['id'], BracketNode>;
};

export function indexTournament(tournament: Tournament): TournamentIndex {
  return {
    groups: indexById(tournament.groups),
    tables: indexById(tournament.tables),
    rounds: indexById(tournament.rounds),
    matches: indexById(allMatches(tournament)),
    bracketNodes: indexById(tournament.bracket?.nodes ?? []),
  };
}
