import { MINIMUM_GROUPS } from '@/domain/groups';
import {
  matchIdSchema,
  roundIdSchema,
  type GroupId,
  type MatchId,
  type RoundId,
  type TableId,
} from '@/domain/ids';
import { allMatches } from '@/domain/lookup';
import { createRng, type Rng } from '@/domain/rng';
import { activeGroups, currentRound, freeTables, undecidedMatches } from '@/domain/selectors';
import { occupyTable, releaseTable } from '@/domain/tables';
import type {
  Group,
  Match,
  Phase,
  Round,
  RoundKind,
  RoundState,
  Timestamp,
  Tournament,
} from '@/domain/types';

/**
 * The draw engine (issue #16, docs/TOURNAMENT-RULES.md §3 and §5).
 *
 * This is the algorithm the whole event turns on: shuffle the groups still in,
 * pair them off, hand the pairs to the tables that are free, and queue the rest.
 * Everything after it — the round panel (#17), the draw animation (#18), the
 * live board (#19), the repechage (#20) — reads what this module wrote.
 *
 * Pure, like everything in `src/domain`: no React, no clock, no `Math.random()`.
 * Randomness arrives as an injected `Rng` positioned at the tournament's own
 * stream cursor, and the cursor is written back on every draw, which is what
 * makes a disputed pairing reproducible from the file a week later
 * (CLAUDE.md golden rule 7, docs/OPEN-QUESTIONS.md #23).
 *
 * Two shapes recur and both are deliberate.
 *
 * **Every mutation takes a `Tournament` and returns one.** The issue sketches
 * `drawRound(groups, tables, rng): Round`, but a `Round` on its own cannot say
 * which tables are now occupied, which groups are out, or where the RNG stream
 * has got to — and those have to move in the same commit as the pairings, or
 * the projector and the laptop disagree. See docs/OPEN-QUESTIONS.md #47.
 *
 * **Nothing here moves a match on its own.** A table that frees up is *offered*
 * the next queued match (`nextQueuedMatch`); putting it there is a second,
 * explicit call the host makes (CLAUDE.md golden rule 3,
 * docs/TOURNAMENT-RULES.md §3, docs/OPEN-QUESTIONS.md #35).
 *
 * Every function returns its argument unchanged when it is asked for something
 * that cannot happen — a winner for a bye, a match onto an occupied table, a
 * round closed with matches still open. The host UI disables those controls;
 * the guard is here so a stale click during a live event costs nothing rather
 * than throwing in front of the room.
 */

/** The prefixes docs/FILE-FORMAT.md writes round and match ids with. */
const ROUND_ID_PREFIX = 'rnd_';
const MATCH_ID_PREFIX = 'mt_';

const NUMBERED_ROUND_ID = /^rnd_(\d+)$/;
const NUMBERED_MATCH_ID = /^mt_(\d+)$/;

/**
 * Which kind of round a draw produces in each phase
 * (docs/TOURNAMENT-RULES.md §1).
 *
 * A phase that is not in here draws nothing at all: `SETUP` has not started,
 * `REPECHAGE` draws candidates rather than pairs (#20), and `NAMING`, `BRACKET`
 * and `CEREMONY` are past the point where rounds are drawn (#24). A partial map
 * rather than a `switch`, so a phase added later has to be decided here instead
 * of falling into an `else`.
 */
const ROUND_KIND_BY_PHASE: Partial<Record<Phase, RoundKind>> = {
  QUALIFYING: 'QUALIFYING',
  ELIMINATION: 'ELIMINATION',
};

// ---------------------------------------------------------------------------
// Drawing a round
// ---------------------------------------------------------------------------

/** A reason a round cannot be drawn right now. Explained in German by #17. */
export type DrawBlocker =
  /** `SETUP`, `REPECHAGE`, `NAMING`, `BRACKET`, `CEREMONY` — see the map above. */
  | 'NOT_A_DRAWING_PHASE'
  /** A round is still open. It has to be closed before the next is drawn. */
  | 'ROUND_OPEN'
  /** Fewer than two groups left in (docs/TOURNAMENT-RULES.md §2, §9 case 4). */
  | 'TOO_FEW_GROUPS'
  /** The qualifying round is round 1 and there is only one of it (§3). */
  | 'QUALIFYING_ALREADY_DRAWN';

/**
 * Everything standing between the host and the next draw, all of it at once.
 *
 * A list rather than a single reason, for the argument the pre-start report
 * makes (`@/domain/start`): a host reading a panel of checks needs the same
 * panel every time, and a check that vanishes when it passes is one they cannot
 * confirm they have satisfied.
 */
export function drawBlockers(tournament: Tournament): readonly DrawBlocker[] {
  const blockers: DrawBlocker[] = [];

  if (ROUND_KIND_BY_PHASE[tournament.phase] === undefined) {
    blockers.push('NOT_A_DRAWING_PHASE');
  }
  if (currentRound(tournament) !== null) {
    blockers.push('ROUND_OPEN');
  }
  if (activeGroups(tournament).length < MINIMUM_GROUPS) {
    blockers.push('TOO_FEW_GROUPS');
  }
  // The qualifying round is *round 1*, singular. Moving on to the elimination
  // rounds is a phase change and belongs to issue #22; without this guard a
  // second press of the draw button would deal a second qualifying round over
  // the top of the first one's winners.
  if (
    tournament.phase === 'QUALIFYING' &&
    tournament.rounds.some((round) => round.kind === 'QUALIFYING')
  ) {
    blockers.push('QUALIFYING_ALREADY_DRAWN');
  }

  return blockers;
}

/** Whether `drawRound` would produce a round. */
export function canDrawRound(tournament: Tournament): boolean {
  return drawBlockers(tournament).length === 0;
}

export interface DrawRoundInput {
  /**
   * The instant the matches that get a table start on it.
   *
   * A timestamp rather than a `Clock`, so one draw stamps every table it fills
   * with the same instant — the room started them together
   * (docs/OPEN-QUESTIONS.md #36).
   */
  at: Timestamp;
  /**
   * What this round is called — `de.round.title` from the caller. The domain
   * never writes German (CLAUDE.md golden rule 1).
   */
  label: (index: number) => string;
  /**
   * Where in the seeded stream this draw happens.
   *
   * Defaults to the tournament's own cursor, which is the only position a live
   * draw may ever run from: an RNG built anywhere else would re-deal pairings
   * the room has already watched. Injectable so a test can pin a draw without
   * writing a cursor into the fixture.
   */
  rng?: Rng;
}

/**
 * Draws the next round: shuffle, pair, hand out the free tables, queue the rest
 * (docs/TOURNAMENT-RULES.md §3).
 *
 * ```text
 * P  := active groups, n := |P|, n >= 2
 * shuffle(P) using the seeded RNG
 * pairs := [(P[0],P[1]), (P[2],P[3]), …]
 * if n is odd: the last remaining group receives a BYE and advances automatically
 * ```
 *
 * The bye is decided the moment it is drawn — `winnerId` is the group itself and
 * the match is `DONE` — and it is never handed a table, because nobody plays it.
 * It still exists as a match so that the round board, the winners list and the
 * audit log all show the group advancing rather than silently reappearing in
 * the next round (§9 case 1).
 *
 * Matches are given tables in **draw order**, which is also queue order: the
 * pairs that did not get one keep their position in `round.matches` and drain
 * from the front as tables free up. There is no separate queue field, because
 * two orderings would eventually disagree about who is next.
 */
export function drawRound(
  tournament: Tournament,
  { at, label, rng = createRng(tournament.rngSeed, tournament.rngCursor) }: DrawRoundInput,
): Tournament {
  const kind = ROUND_KIND_BY_PHASE[tournament.phase];
  if (kind === undefined || !canDrawRound(tournament)) {
    return tournament;
  }

  const drawn = rng.shuffle(activeGroups(tournament));
  const matches = pair(drawn, nextMatchNumber(tournament));

  const index = tournament.rounds.length + 1;
  const round: Round = {
    id: nextRoundId(tournament),
    index,
    kind,
    label: label(index),
    state: 'DRAWN',
    matches,
  };

  // The cursor moves on in the same commit as the pairings it produced. A draw
  // that appended the round but left the cursor behind would hand the identical
  // shuffle to the next round (docs/OPEN-QUESTIONS.md #23).
  const withRound: Tournament = {
    ...tournament,
    rounds: [...tournament.rounds, round],
    rngCursor: rng.cursor,
  };

  return settle(fillTables(withRound, matches, at), round.id);
}

/**
 * Pairs a shuffled field, appending a bye for the group left over.
 *
 * Sequential and nothing cleverer: the shuffle is where the fairness lives, so
 * pairing neighbours is exactly as random as any other rule, and it is the one
 * a host can explain to a participant standing in front of them.
 */
function pair(drawn: readonly Group[], firstNumber: number): Match[] {
  const matches: Match[] = [];
  let number = firstNumber;

  const newMatch = (a: GroupId, b: GroupId | null): Match => {
    const match: Match = {
      id: matchIdSchema.parse(`${MATCH_ID_PREFIX}${number}`),
      tableId: null,
      a,
      b,
      // A bye is decided by the draw itself, not by the host: there is nobody
      // to beat (docs/TOURNAMENT-RULES.md §3).
      winnerId: b === null ? a : null,
      status: b === null ? 'DONE' : 'WAITING_FOR_TABLE',
    };
    number += 1;
    return match;
  };

  for (let index = 0; index + 1 < drawn.length; index += 2) {
    // Both in range by construction; `noUncheckedIndexedAccess` cannot see it.
    const a = drawn[index] as Group;
    const b = drawn[index + 1] as Group;
    matches.push(newMatch(a.id, b.id));
  }

  if (drawn.length % 2 === 1) {
    const leftover = drawn[drawn.length - 1] as Group;
    matches.push(newMatch(leftover.id, null));
  }

  return matches;
}

/**
 * Sends the front of the draw onto the tables that are free, in the host's
 * table order (`freeTables`, `@/domain/selectors`).
 *
 * Byes are skipped rather than counted: a bye must never occupy a table, both
 * because nobody is playing on it and because doing so would push a real pair
 * into the queue behind an empty table (§9 case 1).
 *
 * A `DISABLED` table is not free and is never filled here — that is the whole
 * point of taking one out of service (docs/TOURNAMENT-RULES.md §0).
 *
 * A match starts the moment it lands on a table: `occupyTable` moves it to
 * `RUNNING` and stamps the table with `occupiedSince`, so `READY` is a status
 * the file format allows and nothing produces (docs/OPEN-QUESTIONS.md #48).
 */
function fillTables(tournament: Tournament, matches: readonly Match[], at: Timestamp): Tournament {
  const free = freeTables(tournament);
  let next = tournament;
  let slot = 0;

  for (const match of matches) {
    if (match.b === null) {
      continue;
    }
    const table = free[slot];
    if (table === undefined) {
      // Out of tables. Everything from here on stays `WAITING_FOR_TABLE` in
      // draw order — queued, not lost.
      break;
    }
    slot += 1;
    next = occupyTable(next, { tableId: table.id, matchId: match.id, at });
  }

  return next;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/**
 * The matches of a round still waiting for a table, in draw order.
 *
 * Keyed on "has no table and no result" rather than on `status`, because that is
 * the physical truth the host is looking at: a match requeued when its table
 * broke (`@/domain/tables`) is back in this list at its original draw position,
 * ahead of pairs drawn after it, which is the position it earned in the draw.
 */
export function queuedMatches(round: Round): readonly Match[] {
  return round.matches.filter((match) => match.tableId === null && match.winnerId === null);
}

/**
 * The match a freed table should be offered next, or null when the queue is
 * empty.
 *
 * An offer, not an assignment. Nothing moves onto the beamer without the host
 * confirming it (CLAUDE.md golden rule 3), so this is the question and
 * `assignNextQueuedMatch` is the answer.
 */
export function nextQueuedMatch(tournament: Tournament): Match | null {
  const round = currentRound(tournament);
  if (round === null) {
    return null;
  }
  return queuedMatches(round)[0] ?? null;
}

export interface AssignMatchInput {
  matchId: MatchId;
  tableId: TableId;
  /** When the match starts on this table (docs/OPEN-QUESTIONS.md #36). */
  at: Timestamp;
}

/**
 * Puts one waiting match of the open round onto a free table.
 *
 * Refused for a match that is already on a table or already decided: the first
 * would leave the old table pointing at a match that has moved, and the second
 * would restart something the room has finished watching.
 */
export function assignMatch(
  tournament: Tournament,
  { matchId, tableId, at }: AssignMatchInput,
): Tournament {
  const round = currentRound(tournament);
  if (round === null) {
    return tournament;
  }

  const match = round.matches.find((candidate) => candidate.id === matchId);
  if (match === undefined || match.tableId !== null || match.winnerId !== null) {
    return tournament;
  }

  // `occupyTable` owns the three fields the table schema ties together, and
  // refuses a table that is not FREE by handing its argument straight back.
  const next = occupyTable(tournament, { tableId, matchId, at });
  return next === tournament ? tournament : settle(next, round.id);
}

/**
 * The host's confirmation that the table which just freed up takes the next
 * queued match (docs/TOURNAMENT-RULES.md §3).
 *
 * Deliberately a separate step from `setWinner`, which frees the table. A round
 * where the next pair walked up the moment the last one sat down would take the
 * beamer away from the host mid-sentence.
 */
export function assignNextQueuedMatch(
  tournament: Tournament,
  { tableId, at }: { tableId: TableId; at: Timestamp },
): Tournament {
  const match = nextQueuedMatch(tournament);
  if (match === null) {
    return tournament;
  }
  return assignMatch(tournament, { matchId: match.id, tableId, at });
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * Marks the winner of a match: the table goes back to `FREE`, the loser leaves
 * the tournament (docs/TOURNAMENT-RULES.md §3).
 *
 * Correcting a decided match is the same call with the other group, and it puts
 * the previous loser back to `ACTIVE` — the host marks the wrong winner during a
 * live event and has to be able to say so without reaching for undo
 * (§9 case 8). The table is not taken back off the host, though: it was freed
 * when the first winner was marked and may already be carrying the next pair.
 *
 * Refused for a bye, which the draw already decided, for a group that is not in
 * the match, and for a round that has been closed — after a close, undo is the
 * way back (CLAUDE.md golden rule 6).
 */
export function setWinner(tournament: Tournament, matchId: MatchId, winnerId: GroupId): Tournament {
  const round = currentRound(tournament);
  if (round === null) {
    return tournament;
  }

  const match = round.matches.find((candidate) => candidate.id === matchId);
  if (match === undefined || match.b === null) {
    return tournament;
  }
  if (winnerId !== match.a && winnerId !== match.b) {
    return tournament;
  }
  if (match.winnerId === winnerId) {
    return tournament;
  }

  const loserId = winnerId === match.a ? match.b : match.a;

  const decided = mapRound(tournament, round.id, (open) => ({
    ...open,
    matches: open.matches.map((candidate) =>
      candidate.id === matchId ? { ...candidate, winnerId, status: 'DONE' } : candidate,
    ),
  }));

  // The winner is set back to ACTIVE as well as the loser to ELIMINATED. On a
  // first decision that is a no-op; on a correction it is the whole point,
  // because the group being promoted is the one the previous decision knocked
  // out.
  const restatused = mapGroups(decided, (group) => {
    if (group.id === loserId) {
      return group.status === 'ELIMINATED' ? group : { ...group, status: 'ELIMINATED' };
    }
    if (group.id === winnerId) {
      return group.status === 'ACTIVE' ? group : { ...group, status: 'ACTIVE' };
    }
    return group;
  });

  return settle(freeTableOf(restatused, match), round.id);
}

/** Winners and losers of a round (`W` and `L`, docs/TOURNAMENT-RULES.md §3). */
export interface RoundOutcome {
  /** Every group that advances, **including** the recipient of a bye. */
  winners: readonly GroupId[];
  /** Every group knocked out. A bye produces no loser. */
  losers: readonly GroupId[];
}

/**
 * What a round produced, in draw order.
 *
 * This is the `W` and `L` that §4 feeds to the repechage and §5 pairs again, so
 * it is read off the matches rather than off `group.status`: the repechage puts
 * a loser back to `ACTIVE`, and the record of who actually lost this round has
 * to survive that.
 *
 * Undecided matches contribute nothing, which lets the host panel show a live
 * summary of a round in progress (#17) through the same function #20 calls
 * after the close.
 */
export function roundOutcome(round: Round): RoundOutcome {
  const winners: GroupId[] = [];
  const losers: GroupId[] = [];

  for (const match of round.matches) {
    if (match.winnerId === null) {
      continue;
    }
    winners.push(match.winnerId);
    if (match.b === null) {
      continue;
    }
    losers.push(match.winnerId === match.a ? match.b : match.a);
  }

  return { winners, losers };
}

/** A reason the open round cannot be closed yet. */
export type CloseRoundBlocker =
  /** Nothing to close — before the first draw, or in the gap after a close. */
  | 'NO_OPEN_ROUND'
  /** At least one match still has no winner. */
  | 'MATCHES_UNDECIDED';

export function closeRoundBlockers(tournament: Tournament): readonly CloseRoundBlocker[] {
  const round = currentRound(tournament);
  if (round === null) {
    return ['NO_OPEN_ROUND'];
  }
  return undecidedMatches(round).length === 0 ? [] : ['MATCHES_UNDECIDED'];
}

/**
 * Whether every match of the open round has a winner
 * (docs/TOURNAMENT-RULES.md §3).
 */
export function canCloseRound(tournament: Tournament): boolean {
  return closeRoundBlockers(tournament).length === 0;
}

/**
 * Closes the open round. `roundOutcome` reads the winners and losers out of it.
 *
 * Any table still carrying one of its matches is freed on the way out. That
 * should already have happened when the winner was marked; doing it again here
 * costs nothing and means a round can never leave a table occupied by a match
 * nobody will play again — which is a table the host would have to delete and
 * re-create mid-event to get back.
 */
export function closeRound(tournament: Tournament): Tournament {
  const round = currentRound(tournament);
  if (round === null || !canCloseRound(tournament)) {
    return tournament;
  }

  let next = tournament;
  for (const match of round.matches) {
    next = freeTableOf(next, match);
  }
  return mapRound(next, round.id, (open) => ({ ...open, state: 'CLOSED' }));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The id of the round about to be drawn.
 *
 * Derived from the rounds that exist, unlike table and group numbers, which read
 * a stored counter because they are **spoken**: "Tisch 2" must not come back on
 * a different piece of furniture (docs/OPEN-QUESTIONS.md #22, #37). A round id
 * is internal — nothing outside the file ever says it, rounds are only appended
 * while the tournament moves forward, and the one thing that removes one, undo,
 * removes everything that referenced it in the same step. Deriving therefore
 * cannot produce a collision, and it keeps the ids of a redrawn round tidy
 * rather than climbing every time a host takes a draw back.
 */
function nextRoundId(tournament: Tournament): RoundId {
  const number = highestNumber(
    tournament.rounds.map((round) => round.id),
    NUMBERED_ROUND_ID,
  );
  return roundIdSchema.parse(`${ROUND_ID_PREFIX}${Math.max(number, tournament.rounds.length) + 1}`);
}

/** The number the first match of the next round gets. Same argument as above. */
function nextMatchNumber(tournament: Tournament): number {
  return (
    highestNumber(
      allMatches(tournament).map((match) => match.id),
      NUMBERED_MATCH_ID,
    ) + 1
  );
}

/**
 * The largest `<prefix>_<n>` among these ids, or zero if there is none.
 *
 * Ids that do not follow the pattern — a file repaired by hand, a later build's
 * scheme — are ignored rather than rejected. They cannot collide with a
 * generated one, which is all this has to guarantee.
 */
function highestNumber(ids: readonly string[], pattern: RegExp): number {
  let highest = 0;
  for (const id of ids) {
    const matched = pattern.exec(id);
    const number = matched?.[1] === undefined ? 0 : Number(matched[1]);
    highest = Math.max(highest, number);
  }
  return highest;
}

/**
 * Brings a round's state back in line with its matches (`DRAWN` → `RUNNING`,
 * docs/FILE-FORMAT.md).
 *
 * A round is under way once something is actually on a table, or once the host
 * has decided a real match. A bye on its own does not start a round: it was
 * decided by the draw, and a round whose only result is a bye is still a room
 * full of people waiting for a table.
 *
 * Only ever called on the round that is open — a round just drawn, or the one
 * `currentRound` returned. `CLOSED` is therefore not a case here rather than a
 * branch nothing can reach: reopening a closed round is undo's job, and undo
 * restores the whole document rather than recomputing a field.
 */
function settle(tournament: Tournament, roundId: RoundId): Tournament {
  return mapRound(tournament, roundId, (round) => {
    const underway = round.matches.some(
      (match) => match.tableId !== null || (match.b !== null && match.winnerId !== null),
    );
    const state: RoundState = underway ? 'RUNNING' : 'DRAWN';
    return state === round.state ? round : { ...round, state };
  });
}

/**
 * Frees the table a match is sitting on, if it still is.
 *
 * The `currentMatchId` check is what makes this safe to call twice: after a
 * correction, or after the table was handed to the next pair, `match.tableId` is
 * a record of where the match *was* played (docs/OPEN-QUESTIONS.md #37), and
 * releasing that table would throw whoever is on it now off it.
 */
function freeTableOf(tournament: Tournament, match: Match): Tournament {
  if (match.tableId === null) {
    return tournament;
  }
  const table = tournament.tables.find((candidate) => candidate.id === match.tableId);
  if (table === undefined || table.currentMatchId !== match.id) {
    return tournament;
  }
  return releaseTable(tournament, table.id);
}

/**
 * Replaces one round, leaving the others with their identity — so a React list
 * of rounds does not re-render because a winner was marked in the last one.
 */
function mapRound(
  tournament: Tournament,
  roundId: RoundId,
  change: (round: Round) => Round,
): Tournament {
  let touched = false;
  const rounds = tournament.rounds.map((round) => {
    if (round.id !== roundId) {
      return round;
    }
    const changed = change(round);
    // Compared rather than assumed: `settle` hands its argument back when the
    // state already agrees with the matches, and a new tournament object for a
    // no-op would still commit, broadcast and dirty the file.
    touched = touched || changed !== round;
    return changed;
  });
  return touched ? { ...tournament, rounds } : tournament;
}

function mapGroups(tournament: Tournament, change: (group: Group) => Group): Tournament {
  let touched = false;
  const groups = tournament.groups.map((group) => {
    const changed = change(group);
    touched = touched || changed !== group;
    return changed;
  });
  return touched ? { ...tournament, groups } : tournament;
}
