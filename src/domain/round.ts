import { queuedMatches, roundOutcome } from '@/domain/draw';
import type { GroupId, RoundId } from '@/domain/ids';
import { tablesForTrack, usableTables } from '@/domain/selectors';
import { occupancyBoard, type TableSlot } from '@/domain/tables';
import type { Match, Round, Table, Tournament } from '@/domain/types';

/**
 * What the host's round panel reads (issue #17).
 *
 * The panel is the screen the host stares at for most of the event, so the
 * arithmetic behind it — how far the round has got, which match is where, what
 * the repechage will need — lives here rather than in the component. Pure and
 * unit-tested, for the reason `@/domain/start` gives about the pre-start
 * report: two answers to "how many are still open?" would eventually disagree,
 * and the disagreement would surface as a *Runde abschließen* button that is
 * enabled while a match has no winner.
 *
 * Nothing here mutates. The decisions are `@/domain/draw`'s — `setWinner`,
 * `assignNextQueuedMatch`, `closeRound` — and this module only says what the
 * host is looking at while they make them.
 */

/** How far a round has got, for the header (`7 / 12 Partien entschieden`). */
export interface RoundProgress {
  /** Matches with a winner, byes included — they are decided by the draw (§3). */
  decided: number;
  /** Matches still waiting for the host to say who won. */
  open: number;
  total: number;
}

export function roundProgress(round: Round): RoundProgress {
  return matchesProgress(round.matches);
}

/**
 * The same count over a bare list of matches.
 *
 * The beamer has no `Round` — the snapshot carries the round's identity beside
 * its matches rather than nested inside it — and the projector's progress
 * counter must be the same arithmetic as the host's, not a second one that
 * eventually disagrees.
 */
export function matchesProgress(matches: readonly Match[]): RoundProgress {
  const decided = matches.filter((match) => match.winnerId !== null).length;
  return { decided, open: matches.length - decided, total: matches.length };
}

/**
 * Every match of a round, in the three places the host looks for one.
 *
 * The split is the physical truth of the room: a match is on a table, or it is
 * waiting for one, or it is over. Grouping by table rather than listing all
 * matches flat is what the issue asks for, and it is also how the host works —
 * they walk to a table, look at it, and press the winner.
 *
 * `queued` comes from `@/domain/draw` rather than being recomputed here, so the
 * list the host reads is exactly the one `assignNextQueuedMatch` will take
 * from. Two definitions of "next" would put a different pair on the table than
 * the one at the top of the screen.
 */
export interface RoundBoard {
  /** Every table in the host's order, with this round's match on it, if any. */
  tables: readonly TableSlot[];
  /** Waiting for a table, in draw order — which is queue order (§3). */
  queued: readonly Match[];
  /** Decided, in draw order. Byes are here from the moment they are drawn. */
  decided: readonly Match[];
  progress: RoundProgress;
  /**
   * Why this round's queue cannot move at all, or null when it can
   * (issue #79).
   *
   * Not the same question as "is a table free right now" — a queue behind three
   * busy tables is working exactly as §3 intends and needs no explanation. This
   * answers the one the host asks when nothing is *going to* happen: there is
   * no table this round could ever be played on.
   *
   * Two ways to get there, and the host needs to be told which. Every table out
   * of service is a room problem; every table reserved for the other track is a
   * decision they took themselves and can take back in one click, and a panel
   * that said only "no free table" would send them looking at the furniture.
   */
  stalled: RoundStall;
}

/** Why a round's queue cannot move (issue #79). */
export type RoundStall =
  /** No usable table at all: none exists, or every one is `gesperrt`. */
  | 'NO_USABLE_TABLE'
  /** Usable tables exist, and every one of them is reserved for the other track. */
  | 'RESERVED_ELSEWHERE'
  | null;

export function roundBoard(tournament: Tournament, round: Round): RoundBoard {
  return {
    // Restricted to this round's matches on purpose: a table still naming a
    // match of a closed round is a table the host has to be able to see is
    // wrong, and `occupancyBoard` renders that as an empty slot rather than
    // reaching into rounds that are over.
    tables: occupancyBoard(tournament.tables, round.matches),
    queued: queuedMatches(round),
    decided: round.matches.filter((match) => match.winnerId !== null),
    progress: roundProgress(round),
    stalled: roundStall(tournament, round),
  };
}

/**
 * Whether this round has anywhere at all to be played, and if not, why not.
 *
 * Answered only when something is actually waiting: a round whose every match
 * is decided has an empty queue, and telling the host their tables are all
 * reserved elsewhere at that moment would be true and useless.
 */
function roundStall(tournament: Tournament, round: Round): RoundStall {
  if (queuedMatches(round).length === 0) {
    return null;
  }
  if (tablesForTrack(tournament, round.track).length > 0) {
    return null;
  }
  return usableTables(tournament).length === 0 ? 'NO_USABLE_TABLE' : 'RESERVED_ELSEWHERE';
}

/**
 * The smallest power of two that is at least `value` — the `2^ceil(log2(n))`
 * of docs/TOURNAMENT-RULES.md §4.
 *
 * Doubled rather than computed through `Math.log2`, which is exact for the
 * powers of two it is handed today but is a floating-point round trip that
 * would have to be argued about rather than read.
 */
export function nextPowerOfTwo(value: number): number {
  if (value <= 1) {
    return Math.max(0, Math.ceil(value));
  }
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

/**
 * What the repechage will have to do after this round
 * (docs/TOURNAMENT-RULES.md §4, issue #20).
 *
 * The number this is computed from is **not** the winners decided so far: every
 * match produces exactly one winner, byes included, so `|W|` at the close of a
 * round is the number of matches in it — known the moment it is drawn. A live
 * summary that counted decided winners would tell the host "Ziel 8" at half
 * time and "Ziel 16" at the end, and a host reading the second number would
 * think something had gone wrong.
 *
 * Null outside a qualifying round: §1 puts `REPECHAGE` after `QUALIFYING` and
 * nowhere else, and from the elimination rounds on `|W|` is already a power of
 * two by §5's invariant.
 */
export interface RepechageOutlook {
  /** `|W|` at the close of this round — one winner per match. */
  winners: number;
  /** `2^ceil(log2(|W|))`, the power-of-two field the bracket needs. */
  target: number;
  /** `target - |W|` — how many losers would have to come back. */
  need: number;
  /** True when `|W|` is already the target, which skips §4 entirely. */
  skipped: boolean;
}

export function repechageOutlook(round: Round): RepechageOutlook | null {
  if (round.kind !== 'QUALIFYING') {
    return null;
  }
  const winners = round.matches.length;
  const target = nextPowerOfTwo(winners);
  return { winners, target, need: target - winners, skipped: target === winners };
}

/**
 * The live summary the host panel shows beside the matches: who is through, who
 * is out, and what that leaves the repechage to do.
 *
 * Winners and losers come from `roundOutcome`, which reads them off the matches
 * rather than off `group.status` — the repechage puts a loser back to `ACTIVE`,
 * and the record of who lost *this* round has to survive that.
 */
export interface RoundSummary {
  progress: RoundProgress;
  /** Through to the next round, including the recipient of a bye. */
  winners: readonly GroupId[];
  /** Knocked out. A bye produces no loser. */
  losers: readonly GroupId[];
  repechage: RepechageOutlook | null;
}

export function roundSummary(round: Round): RoundSummary {
  const { winners, losers } = roundOutcome(round);
  return {
    progress: roundProgress(round),
    winners,
    losers,
    repechage: repechageOutlook(round),
  };
}

/**
 * One round of the history the host browses (issue #22).
 *
 * The round itself plus what it produced, so the panel does not have to know
 * that winners are read off the matches rather than off `group.status` — which
 * matters exactly here, because the repechage puts losers back to `ACTIVE` and
 * a history that asked the groups would show a round nobody lost.
 */
export interface RoundRecord {
  round: Round;
  summary: RoundSummary;
}

/**
 * Every round that has been drawn, oldest first (issue #22).
 *
 * Chronological, which is the order they were played and the order the file
 * stores them in; a panel that wants the newest at the top reverses it, because
 * that is a decision about a screen rather than about the tournament.
 *
 * The open round is included. The host browsing back through the evening is
 * looking for "what happened in Runde 2", and a list that dropped the round
 * they are in would be a list with a hole at the end of it.
 */
export function roundHistory(tournament: Tournament): readonly RoundRecord[] {
  return tournament.rounds.map((round) => ({ round, summary: roundSummary(round) }));
}

/**
 * One round of the history by id, for a beamer scene pointed at a past round.
 *
 * Null rather than a throw for an id that names nothing: the scene descriptor
 * lives in the store and the rounds live in the file, and an undo can take a
 * round away while the projector is still pointed at it. The scene draws an
 * empty board then, which is honest — that round no longer exists.
 */
export function roundById(tournament: Tournament, roundId: RoundId): Round | null {
  return tournament.rounds.find((round) => round.id === roundId) ?? null;
}

/**
 * What the beamer's round board draws (issue #19).
 *
 * Grouped by table, and grouped by the match's **own** `tableId` rather than by
 * `table.currentMatchId`. The difference is the whole acceptance criterion "no
 * layout shift when a result comes in": marking a winner frees the table, so a
 * board keyed on `currentMatchId` would make the card vanish from its slot at
 * exactly the moment the audience is looking at it — and the green/red flip
 * would never be seen. A match keeps its `tableId` once assigned (`setWinner`
 * changes only the winner and the status), so its card keeps its place for the
 * rest of the round.
 *
 * The queue is a section of its own, with `table: null`. A match moving out of
 * it does move on screen, but that is the host starting the next pair — a
 * decision the room should see — and not a result landing.
 */
export interface BoardSection {
  /** The table this group of matches belongs to; null for the queue. */
  table: Table | null;
  /** In draw order, which is the order they were assigned in. */
  matches: readonly Match[];
}

export function beamerBoard(
  tables: readonly Table[],
  matches: readonly Match[],
): readonly BoardSection[] {
  const queue = matches.filter((match) => match.tableId === null);

  const sections: BoardSection[] = tables.map((table) => ({
    table,
    matches: matches.filter((match) => match.tableId === table.id),
  }));

  // The queue last: it is what has not started, and the room reads the tables
  // first. Omitted entirely when nothing is waiting, so a board with enough
  // tables is not half empty heading.
  return queue.length === 0 ? sections : [...sections, { table: null, matches: queue }];
}

/**
 * The ribbon on a card: `WARTET` · `LÄUFT` · `BEENDET` (issue #19).
 *
 * Derived from the match rather than stored, and keyed on the winner for the
 * finished case: a corrected result goes back through `setWinner`, and a card
 * that read its state from `status` alone would disagree with the colour it is
 * painted in.
 */
export type MatchPhase = 'WAITING' | 'RUNNING' | 'FINISHED';

export function matchPhase(match: Match): MatchPhase {
  if (match.winnerId !== null) {
    return 'FINISHED';
  }
  return match.tableId === null ? 'WAITING' : 'RUNNING';
}
