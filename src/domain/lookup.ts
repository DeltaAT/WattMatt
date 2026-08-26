import { matchIdSchema } from '@/domain/ids';
import type {
  BracketNode,
  Group,
  Match,
  MatchStatus,
  Round,
  Table,
  Tournament,
} from '@/domain/types';

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

/**
 * A bracket node as the `Partie` it is, or null while it has no pairing yet.
 *
 * The bracket phase appends nothing to `rounds` — a node carries its own
 * pairing, winner and table (`@/domain/bracket`, docs/OPEN-QUESTIONS.md #68) —
 * so this is how everything that reasons about *matches* keeps working while
 * the final phase is being played: the occupancy board, the snapshot the
 * beamer's `TABLE_OVERVIEW` draws, the elapsed time on a table.
 *
 * The id is the node's own, which is what `table.currentMatchId` names while a
 * `Halbfinale` is on that table. Node ids (`bn_3`) and match ids (`mt_3`) come
 * from two prefixes and cannot collide, so one id still names one thing.
 *
 * A node with one empty slot is a `Freilos` and becomes a match with `b: null`,
 * exactly as the draw engine writes one (docs/TOURNAMENT-RULES.md §3).
 */
export function bracketNodeMatch(node: BracketNode): Match | null {
  if (node.slotA === null) {
    return null;
  }
  return {
    id: matchIdSchema.parse(node.id),
    tableId: node.tableId,
    a: node.slotA,
    b: node.slotB,
    winnerId: node.winnerId,
    status: bracketNodeStatus(node),
  };
}

/** Every bracket match of the tournament, in node order. */
export function bracketMatches(tournament: Tournament): readonly Match[] {
  return (tournament.bracket?.nodes ?? []).flatMap((node) => bracketNodeMatch(node) ?? []);
}

/**
 * A node's status in the words `matchStatusSchema` uses.
 *
 * Derived rather than stored, because a node has no status field to drift: it
 * is decided, or it is on a table, or it is waiting for one. `READY` is not
 * produced here for the same reason the draw engine never produces it — a match
 * starts when it is put on a table (docs/OPEN-QUESTIONS.md #48).
 */
function bracketNodeStatus(node: BracketNode): MatchStatus {
  if (node.winnerId !== null) {
    return 'DONE';
  }
  return node.tableId === null ? 'WAITING_FOR_TABLE' : 'RUNNING';
}
