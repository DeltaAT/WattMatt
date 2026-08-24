import { tableIdSchema, type MatchId, type TableId } from '@/domain/ids';
import { allMatches } from '@/domain/lookup';
import type { Match, Table, Timestamp, Tournament } from '@/domain/types';

/**
 * The table lifecycle (issue #13, docs/TOURNAMENT-RULES.md §0 and §3).
 *
 * Tables are the scarce resource the whole round flow turns on, so every
 * transition they can make lives here and nowhere else: created, renamed,
 * reordered, taken out of service, deleted, occupied by a match and freed
 * again. The store actions in `@/store/actions/tables` are a thin wrapper
 * around these, and the draw engine (#16) and the round panel (#17) reach the
 * same two functions at the bottom of this file rather than writing a table by
 * hand.
 *
 * Pure, like everything in `src/domain`: no clock, no randomness. A table id is
 * the one thing built here rather than passed in, and it is built from a
 * counter the tournament carries — not from a random value and not from the
 * length of the list. The timestamp a table carries comes from the caller
 * (ARCHITECTURE.md §5).
 *
 * Every function returns the tournament unchanged when it is asked for
 * something that cannot happen — an unknown table, a move off the end of the
 * list, an empty label. The host UI disables those controls; the guard is here
 * so a stale click during a live event costs nothing rather than throwing in
 * front of the room.
 */

/** The prefix docs/FILE-FORMAT.md writes table ids with. */
const TABLE_ID_PREFIX = 'tbl_';

const NUMBERED_ID = /^tbl_(\d+)$/;

/**
 * The number the next table gets, in its id and in its default label.
 *
 * Highest ever used plus one, never the lowest free one: a table number is how
 * the host and the room refer to a physical table, and reusing the number of a
 * table that was deleted an hour ago would put "Tisch 2" on a different piece
 * of furniture mid-event. Same reasoning as group numbers
 * (docs/TOURNAMENT-RULES.md §2).
 *
 * "Ever" is why this reads a stored counter (`tournament.nextTableNumber`)
 * rather than the tables in front of it: after `tbl_3` is deleted, the list no
 * longer contains any evidence that the number 3 is spent.
 *
 * The counter is floored by the tables that do exist, which only matters for a
 * file repaired in Notepad (docs/FILE-FORMAT.md §Encoding): a counter that has
 * been edited back below an existing table would otherwise mint a duplicate id,
 * and `indexById` throws on those at load time. Ids that do not follow the
 * `tbl_<n>` pattern — a hand-written one, a later build's scheme — are ignored
 * rather than rejected. They cannot collide, which is all this has to
 * guarantee.
 */
export function nextTableNumber(tournament: Tournament): number {
  return Math.max(tournament.nextTableNumber, highestTableNumber(tournament.tables) + 1);
}

/** The largest `tbl_<n>` number among these tables, or zero if there is none. */
function highestTableNumber(tables: readonly Table[]): number {
  let highest = 0;
  for (const table of tables) {
    const match = NUMBERED_ID.exec(table.id);
    const number = match?.[1] === undefined ? 0 : Number(match[1]);
    highest = Math.max(highest, number);
  }
  return highest;
}

export interface AddTablesInput {
  /** How many to create. Anything below one creates nothing. */
  count: number;
  /**
   * The default label for the table with this number, from `de-AT.ts` —
   * "Tisch 3" (CLAUDE.md golden rule 1: the domain never writes German).
   */
  label: (number: number) => string;
}

/**
 * Creates `count` tables at the end of the list, numbered on from the highest
 * that has ever existed.
 *
 * One function for the `+` and for the "Anzahl Tische" quick-add: they differ
 * only in the number the host asked for, and two code paths would eventually
 * disagree about numbering.
 */
export function addTables(tournament: Tournament, { count, label }: AddTablesInput): Tournament {
  const wanted = Math.floor(count);
  if (!Number.isFinite(wanted) || wanted < 1) {
    return tournament;
  }

  const first = nextTableNumber(tournament);
  const created: Table[] = Array.from({ length: wanted }, (_unused, index) => {
    const number = first + index;
    return {
      id: tableIdSchema.parse(`${TABLE_ID_PREFIX}${number}`),
      label: label(number),
      status: 'FREE',
      currentMatchId: null,
      occupiedSince: null,
    };
  });

  // The counter moves on with the tables, in the same commit: a create that
  // advanced the list without advancing the counter would mint the same id
  // twice on the next `+`.
  return {
    ...tournament,
    tables: [...tournament.tables, ...created],
    nextTableNumber: first + wanted,
  };
}

/**
 * Renames a table.
 *
 * Two labels are refused, both by leaving the tournament untouched:
 *
 * - **Empty after trimming.** `tableSchema` requires a non-empty label, so
 *   accepting it would write a file that cannot be opened again.
 * - **Already worn by another table.** The label is what the host says out loud
 *   ("Gruppe 3 auf Tisch 2") and what the move-target dropdown offers when a
 *   busy table is deleted; two tables answering to the same name is a match
 *   sent to the wrong one in front of the room. Compared case-insensitively,
 *   because "tisch 2" is not a distinguishable second name across ten metres.
 *
 * `isLabelAvailable` is the same rule, so the host UI can put the old label
 * back rather than leave a name on screen that was never committed.
 */
export function renameTable(tournament: Tournament, tableId: TableId, label: string): Tournament {
  if (!isLabelAvailable(tournament, tableId, label)) {
    return tournament;
  }
  return mapTable(tournament, tableId, (table) => ({ ...table, label: label.trim() }));
}

/** Whether `renameTable` would accept this label for this table. */
export function isLabelAvailable(tournament: Tournament, tableId: TableId, label: string): boolean {
  const trimmed = label.trim();
  if (trimmed === '') {
    return false;
  }

  const wanted = fold(trimmed);
  return !tournament.tables.some((table) => table.id !== tableId && fold(table.label) === wanted);
}

/** Locale-aware, so "TISCH 2" and "Tisch 2" are the one name they look like. */
function fold(label: string): string {
  return label.trim().toLocaleLowerCase('de-AT');
}

/**
 * Moves a table one position up or down the list.
 *
 * The list order is the order the tables stand in the room, and it is the order
 * a queued match is offered a free table in (docs/TOURNAMENT-RULES.md §3) — so
 * it is worth being able to correct. Clamped at both ends rather than wrapping:
 * a table jumping from the top of the board to the bottom is not what a host
 * pressing "up" once more meant.
 */
export function moveTable(tournament: Tournament, tableId: TableId, offset: number): Tournament {
  const from = tournament.tables.findIndex((table) => table.id === tableId);
  if (from === -1) {
    return tournament;
  }

  const to = from + Math.trunc(offset);
  if (to < 0 || to >= tournament.tables.length || to === from) {
    return tournament;
  }

  const tables = [...tournament.tables];
  const [moved] = tables.splice(from, 1);
  if (moved === undefined) {
    return tournament;
  }
  tables.splice(to, 0, moved);
  return { ...tournament, tables };
}

/**
 * What happens to the match on a table the host is about to take away
 * (issue #13: "deleting or disabling an occupied table asks what happens to
 * the running match").
 *
 * There is no "leave it there" option, and that is the point: the table is
 * going away, so the match has to go somewhere. The host answers where.
 */
export type MatchDisposition =
  /** Back into the queue — `WAITING_FOR_TABLE`, waiting for the next free table. */
  | { kind: 'REQUEUE' }
  /** Straight onto another free table, carrying its running time with it. */
  | { kind: 'MOVE'; toTableId: TableId };

export const REQUEUE: MatchDisposition = { kind: 'REQUEUE' };

/**
 * Takes a table out of service (`gesperrt`): a wobbly leg, a spilled drink, a
 * light that went out.
 *
 * Allowed at any moment of the tournament, which is why it has to say what
 * happens to a match that is on it. A disabled table is never offered to a
 * queued match (`freeTables` in `@/domain/selectors`).
 */
export function disableTable(
  tournament: Tournament,
  tableId: TableId,
  disposition: MatchDisposition = REQUEUE,
): Tournament {
  const table = findTable(tournament, tableId);
  if (table === undefined || table.status === 'DISABLED') {
    return tournament;
  }

  const cleared = clearTable(tournament, table, disposition);
  if (cleared === null) {
    return tournament;
  }
  return mapTable(cleared, tableId, (free) => ({ ...free, status: 'DISABLED' }));
}

/** Puts a `gesperrt` table back into service. It comes back free, never busy. */
export function enableTable(tournament: Tournament, tableId: TableId): Tournament {
  return mapTable(tournament, tableId, (table) =>
    table.status === 'DISABLED' ? { ...table, status: 'FREE' } : table,
  );
}

/**
 * Removes a table from the tournament.
 *
 * Allowed mid-tournament like every other table change — the host configures
 * anything, anytime (issue #13). Rounds already played keep pointing at the
 * table their matches were played on, and that is deliberate: the id lives on
 * in `match.tableId` as a record of where the match happened, and a table
 * number is never reused (see `nextTableNumber`), so the reference can never
 * come to mean a different table.
 */
export function removeTable(
  tournament: Tournament,
  tableId: TableId,
  disposition: MatchDisposition = REQUEUE,
): Tournament {
  const table = findTable(tournament, tableId);
  if (table === undefined) {
    return tournament;
  }

  const cleared = clearTable(tournament, table, disposition);
  if (cleared === null) {
    return tournament;
  }
  return { ...cleared, tables: cleared.tables.filter((candidate) => candidate.id !== tableId) };
}

/**
 * Puts a match on a free table (docs/TOURNAMENT-RULES.md §3).
 *
 * The transition lives here rather than in the draw engine that calls it
 * (#16), so the three fields `tableSchema` ties together are only ever written
 * in one place. A table that is not `FREE` is refused: handing a second match
 * to an occupied table is the failure the schema's check exists to catch, and
 * it must not be reachable from an action either.
 */
export function occupyTable(
  tournament: Tournament,
  { tableId, matchId, at }: { tableId: TableId; matchId: MatchId; at: Timestamp },
): Tournament {
  const table = findTable(tournament, tableId);
  if (table === undefined || table.status !== 'FREE') {
    return tournament;
  }

  const withTable = mapTable(tournament, tableId, (free) => ({
    ...free,
    status: 'OCCUPIED',
    currentMatchId: matchId,
    occupiedSince: at,
  }));
  return mapMatch(withTable, matchId, (match) => ({
    ...match,
    tableId,
    status: match.winnerId === null ? 'RUNNING' : match.status,
  }));
}

/**
 * Frees a table again — what marking a winner does
 * (docs/TOURNAMENT-RULES.md §3, issue #13 acceptance criterion).
 *
 * The match keeps its `tableId`: it *was* played there, and the round board and
 * the log both read that field afterwards. Only the table forgets.
 */
export function releaseTable(tournament: Tournament, tableId: TableId): Tournament {
  return mapTable(tournament, tableId, (table) =>
    table.status === 'OCCUPIED'
      ? { ...table, status: 'FREE', currentMatchId: null, occupiedSince: null }
      : table,
  );
}

/** One row of the occupancy board: a table and whatever is on it. */
export interface TableSlot {
  table: Table;
  /** The match being played on it, or null when the table is free or disabled. */
  match: Match | null;
}

/**
 * The live occupancy board (issue #13).
 *
 * Takes the two collections rather than the tournament, because the beamer has
 * no tournament: it is handed `tables` and `matches` in the snapshot and has to
 * arrive at exactly the same board as the host screen. One function, two
 * callers — the alternative is a projector that disagrees with the laptop about
 * who is playing where, which is the failure golden rule 4 exists to prevent.
 *
 * A `currentMatchId` that names no match yields a row with `match: null` rather
 * than throwing. The board is what a host looks at when something has already
 * gone wrong; refusing to draw it would take away the one screen that shows
 * which table is the problem.
 */
export function occupancyBoard(
  tables: readonly Table[],
  matches: readonly Match[],
): readonly TableSlot[] {
  const byId = new Map(matches.map((match) => [match.id, match]));
  return tables.map((table) => ({
    table,
    match: table.currentMatchId === null ? null : (byId.get(table.currentMatchId) ?? null),
  }));
}

/**
 * The matches the occupancy board needs — the ones currently on a table.
 *
 * The snapshot carries these and not every match of the tournament: this is
 * what `TABLE_OVERVIEW` draws, and the round board that needs a whole round is
 * issue #19's (docs/OPEN-QUESTIONS.md #19).
 */
export function matchesOnTables(tournament: Tournament): readonly Match[] {
  const occupied = new Set(
    tournament.tables.flatMap((table) =>
      table.currentMatchId === null ? [] : [table.currentMatchId],
    ),
  );
  return allMatches(tournament).filter((match) => occupied.has(match.id));
}

/**
 * How long the match on a table has been running, in milliseconds.
 *
 * `Date.parse` rather than a `Date` object: `src/domain` may not construct one
 * (ARCHITECTURE.md §5), and both ends of the subtraction are timestamps the
 * caller supplies, so this stays deterministic.
 *
 * Never negative. A tournament file carried across a daylight-saving change, or
 * a laptop whose clock was corrected between two saves, can put the start in
 * the future; a board counting backwards would be reported as a bug during an
 * event, and there is nothing useful to say about it beyond "just started".
 */
export function elapsedMs(since: Timestamp, now: Timestamp): number {
  const started = Date.parse(since);
  const current = Date.parse(now);
  if (Number.isNaN(started) || Number.isNaN(current)) {
    return 0;
  }
  return Math.max(0, current - started);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function findTable(tournament: Tournament, tableId: TableId): Table | undefined {
  return tournament.tables.find((table) => table.id === tableId);
}

function mapTable(
  tournament: Tournament,
  tableId: TableId,
  change: (table: Table) => Table,
): Tournament {
  let touched = false;
  const tables = tournament.tables.map((table) => {
    if (table.id !== tableId) {
      return table;
    }
    const changed = change(table);
    // Compared rather than assumed: `enableTable` on a table that is not
    // disabled hands its argument straight back, and a new tournament object
    // for a no-op would still commit, broadcast and dirty the file.
    touched = touched || changed !== table;
    return changed;
  });
  return touched ? { ...tournament, tables } : tournament;
}

/**
 * Rounds are nested, so a match is changed by rebuilding the round it sits in.
 * Only the round that holds it is replaced — the rest keep their identity, so a
 * React list of rounds does not re-render because a table was renamed.
 */
function mapMatch(
  tournament: Tournament,
  matchId: MatchId,
  change: (match: Match) => Match,
): Tournament {
  let touched = false;
  const rounds = tournament.rounds.map((round) => {
    if (!round.matches.some((match) => match.id === matchId)) {
      return round;
    }
    touched = true;
    return {
      ...round,
      matches: round.matches.map((match) => (match.id === matchId ? change(match) : match)),
    };
  });
  return touched ? { ...tournament, rounds } : tournament;
}

/**
 * Empties a table, doing whatever the host chose with the match on it.
 *
 * Returns null when the answer cannot be carried out — a move to a table that
 * is not free, or that no longer exists. The caller then does nothing at all,
 * rather than deleting the table and leaving the match nowhere: a match that
 * has fallen off the board is invisible, and invisible is how a match gets
 * forgotten in front of an audience.
 */
function clearTable(
  tournament: Tournament,
  table: Table,
  disposition: MatchDisposition,
): Tournament | null {
  const matchId = table.currentMatchId;
  if (matchId === null) {
    return tournament;
  }

  if (disposition.kind === 'MOVE') {
    const target = findTable(tournament, disposition.toTableId);
    if (target === undefined || target.id === table.id || target.status !== 'FREE') {
      return null;
    }

    const moved = mapTable(tournament, target.id, (free) => ({
      ...free,
      status: 'OCCUPIED',
      currentMatchId: matchId,
      // The stamp travels with the match, not with the table: the room has
      // been watching this match for twenty minutes whichever table it is on.
      occupiedSince: table.occupiedSince,
    }));
    const reassigned = mapMatch(moved, matchId, (match) => ({
      ...match,
      tableId: disposition.toTableId,
    }));
    return releaseTable(reassigned, table.id);
  }

  const requeued = mapMatch(tournament, matchId, (match) => ({
    ...match,
    tableId: null,
    // A decided match does not go back in the queue: it is over, and the only
    // reason it is still on a table is that nobody has closed it yet.
    status: match.winnerId === null ? 'WAITING_FOR_TABLE' : match.status,
  }));
  return releaseTable(requeued, table.id);
}
