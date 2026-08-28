import { MINIMUM_GROUPS } from '@/domain/groups';
import { playedAgainst, rematchesIn } from '@/domain/history';
import {
  matchIdSchema,
  roundIdSchema,
  type GroupId,
  type MatchId,
  type RoundId,
  type TableId,
} from '@/domain/ids';
import { allMatches } from '@/domain/lookup';
import { drawPairing, type Pairing } from '@/domain/pairing';
import { createRng, type Rng } from '@/domain/rng';
import {
  currentRound,
  freeTables,
  roundsOfTrack,
  servesTrack,
  undecidedMatches,
} from '@/domain/selectors';
import { occupyTable, releaseTable } from '@/domain/tables';
import { trackGroups, trackState } from '@/domain/track';
import type {
  Group,
  GroupStatus,
  Match,
  Phase,
  Round,
  RoundKind,
  RoundState,
  RoundTrack,
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
 * **Two rounds can be open at once.** Since issue #73 the `Trostrunde` runs
 * beside the main field, so every function that used to mean "the open round"
 * takes a `RoundTrack` and means "the open round of this track" (§10). The
 * default is `MAIN` everywhere, because that is what every main-field caller
 * means and what the side event must stay invisible to.
 *
 * The **tables are not split**. Both tracks draw from the one `freeTables` pool
 * and `occupyTable` refuses a table that is not `FREE`, so no table can carry
 * two matches however the two rounds interleave — the invariant is the table's
 * own status rather than a rule about tracks. Which tables a track may use is a
 * separate question the host answers by reserving them, and it is issue #79's.
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

/**
 * What kind of round the next draw on a track would be, or undefined when that
 * track has nothing to deal.
 *
 * **Both tracks ask their own phase** (issue #91). Until the `Trostrunde` ran
 * the whole pipeline it was outside the phase machine and dealt one kind of
 * round over and over; it now has a phase of its own, so the same question has
 * the same answer on both tracks and `RoundKind` says what a round *is* rather
 * than which half of the evening it belongs to. Which half is `round.track`,
 * and that is the only thing that ever needed to say it.
 *
 * The `CONSOLATION` round kind is therefore legacy: nothing writes it any
 * more, files that carry it are brought forward by `v6ToV7`, and it stays in
 * the schema because a kind that vanished would make those files unreadable.
 */
function roundKindFor(tournament: Tournament, track: RoundTrack): RoundKind | undefined {
  return ROUND_KIND_BY_PHASE[trackState(tournament, track).phase];
}

/**
 * The groups a track's next draw would deal, before any `Freilose` are added.
 *
 * The two are disjoint by construction — `activeGroups` is `status === 'ACTIVE'`
 * and `consolationGroups` is `status === 'CONSOLATION'` — which is what makes
 * "a `Trostrunde` group never appears in a main-field draw" true of the model
 * rather than of a filter (issue #73).
 */
function fieldOf(tournament: Tournament, track: RoundTrack): readonly Group[] {
  return trackGroups(tournament, track);
}

/**
 * The field size at or below which the final phase begins
 * (docs/TOURNAMENT-RULES.md §5).
 *
 * The elimination rounds are a `while |W| > 16` loop, so this is both the
 * condition that keeps them going and the largest bracket the app builds. It
 * lives here rather than in `@/domain/progression` because the draw engine is what
 * has to refuse the round that would take the field below it — the phase module
 * describes the transition, this one declines to deal another hand.
 */
export const FINAL_PHASE_SIZE = 16;

/**
 * The smallest bracket there is: a `Finale` and nothing else
 * (docs/TOURNAMENT-RULES.md §7, §9 case 10).
 *
 * Two participants are already the final phase. Pairing them in a qualifying
 * round would leave one group standing, and a bracket of one is not a picture
 * the app can draw (§9 case 5, docs/OPEN-QUESTIONS.md #62).
 */
export const MINIMUM_BRACKET_SIZE = 2;

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
  | 'QUALIFYING_ALREADY_DRAWN'
  /**
   * The field is already the one the bracket is built on, so another round
   * would take it below a bracket (docs/TOURNAMENT-RULES.md §5, issue #22).
   */
  | 'FINAL_PHASE_REACHED'
  /**
   * The `CONSOLATION` track has nothing to deal: the host has not started the
   * `Trostrunde`, declined it, or it is already decided (§10, issue #73).
   */
  | 'CONSOLATION_NOT_RUNNING';

/**
 * Everything standing between the host and the next draw, all of it at once.
 *
 * A list rather than a single reason, for the argument the pre-start report
 * makes (`@/domain/start`): a host reading a panel of checks needs the same
 * panel every time, and a check that vanishes when it passes is one they cannot
 * confirm they have satisfied.
 */
export function drawBlockers(
  tournament: Tournament,
  track: RoundTrack = 'MAIN',
): readonly DrawBlocker[] {
  const blockers: DrawBlocker[] = [];

  // The side event has one gate the main field does not: the host has to have
  // started it, and it has to still be running (§10). Read off the record
  // rather than through `@/domain/consolation`, which composes this module and
  // must not be composed by it.
  if (track === 'CONSOLATION' && tournament.consolation?.state !== 'RUNNING') {
    blockers.push('CONSOLATION_NOT_RUNNING');
  }
  // Past that gate the question is the same one on both tracks, asked of that
  // track's own phase (issue #91).
  const phase = trackState(tournament, track).phase;
  if (ROUND_KIND_BY_PHASE[phase] === undefined) {
    blockers.push('NOT_A_DRAWING_PHASE');
  }
  if (currentRound(tournament, track) !== null) {
    blockers.push('ROUND_OPEN');
  }
  if (fieldOf(tournament, track).length < MINIMUM_GROUPS) {
    blockers.push('TOO_FEW_GROUPS');
  }
  // The qualifying round is *round 1*, singular. Moving on to the elimination
  // rounds is a phase change and belongs to issue #22; without this guard a
  // second press of the draw button would deal a second qualifying round over
  // the top of the first one's winners.
  if (phase === 'QUALIFYING' && qualifyingRoundOf(tournament, track) !== null) {
    blockers.push('QUALIFYING_ALREADY_DRAWN');
  }
  // The `while |W| > 16` of docs/TOURNAMENT-RULES.md §5, as a refusal rather
  // than as a loop: an elimination round dealt at 16 would take the field to 8
  // and the `Achtelfinale` the room was promised would never be played. The
  // qualifying round is measured against the smallest bracket instead, because
  // §3 plays it at every size — except at two, where the one match there is to
  // play is the `Finale` itself (§9 case 5).
  //
  // The `Trostrunde` has the same floor, because since issue #91 it feeds a
  // bracket too: a side event that kept halving to one group would never draw
  // the tree §10 now gives it.
  const floor = phase === 'ELIMINATION' ? FINAL_PHASE_SIZE : MINIMUM_BRACKET_SIZE;
  if (ROUND_KIND_BY_PHASE[phase] !== undefined && fieldSize(tournament, track) <= floor) {
    blockers.push('FINAL_PHASE_REACHED');
  }

  return blockers;
}

/**
 * The field the next draw would deal: the groups still in, plus the `Freilose`
 * the repechage fallback still owes (docs/TOURNAMENT-RULES.md §4, §5).
 *
 * Not `activeGroups().length` on its own, because a field of 20 that owes 12
 * `Freilose` is a field of 32 as far as every count in the tournament is
 * concerned — that is the whole point of fallback 1.
 */
export function fieldSize(tournament: Tournament, track: RoundTrack = 'MAIN'): number {
  return trackGroups(tournament, track).length + byesOwed(tournament, track);
}

/**
 * A track's own qualifying round — its first — or null before it has one.
 *
 * Both tracks have one since issue #91, and both find it the same way: the
 * round of kind `QUALIFYING` on that track. A file written before v7 has its
 * side event's rounds as kind `CONSOLATION`; `v6ToV7` renames them, so nothing
 * downstream needs to know that the shape ever differed.
 */
export function qualifyingRoundOf(
  tournament: Tournament,
  track: RoundTrack = 'MAIN',
): Round | null {
  return (
    tournament.rounds.find((round) => round.track === track && round.kind === 'QUALIFYING') ?? null
  );
}

/**
 * How many `Freilose` the §4 fallback still owes the next draw
 * (docs/TOURNAMENT-RULES.md §4, fallback 1).
 *
 * *Freilose vergeben* does not hand the places out where it is taken: it
 * records a debt, and §5 says it is the next draw that settles it. A field of
 * 13 short of 16 owes **three**, so the round drawn from it deals three byes
 * and five pairs, and the 8 winners the bracket needs come out of it.
 *
 * Owed only until that draw happens, which is what the elimination-round check
 * says: the debt is settled by the first elimination round, and asking again
 * afterwards would deal the same three byes a second time. When the target is
 * already at or below the final phase there is no elimination round to settle
 * it — the debt then belongs to the bracket, and issue #24 reads it off the
 * repechage record rather than from here.
 *
 * The field is read off the qualifying round and the accepted draws rather than
 * off `activeGroups`, for the reason `repechageState` gives: a participant who
 * turned up late and was added mid-tournament (§2) is active without ever
 * having been in this arithmetic.
 */
export function byesOwed(tournament: Tournament, track: RoundTrack = 'MAIN'): number {
  const repechage = trackState(tournament, track).repechage;
  if (repechage === null || repechage.fallbackUsed !== 'BYES') {
    return 0;
  }
  if (tournament.rounds.some((round) => round.track === track && round.kind === 'ELIMINATION')) {
    return 0;
  }

  const qualifying = qualifyingRoundOf(tournament, track);
  const winners = qualifying === null ? 0 : roundOutcome(qualifying).winners.length;
  const accepted = repechage.draws.filter((draw) => draw.accepted === true).length;
  return Math.max(0, repechage.target - winners - accepted);
}

/** Whether `drawRound` would produce a round on this track. */
export function canDrawRound(tournament: Tournament, track: RoundTrack = 'MAIN'): boolean {
  return drawBlockers(tournament, track).length === 0;
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
  /**
   * Which of the two parallel tournaments this draw is for
   * (docs/TOURNAMENT-RULES.md §10).
   *
   * Both tracks run through the same engine and the same seeded stream: the
   * `Trostrunde` is the ordinary draw of §3, and its pairings have to be as
   * reproducible from the file as the main field's. What the track changes is
   * which groups are in the pot, what the round is called, and which of the two
   * boards it appears on.
   */
  track?: RoundTrack;
}

/**
 * Draws the next round: shuffle, pair, hand out the free tables, queue the rest
 * (docs/TOURNAMENT-RULES.md §3).
 *
 * ```text
 * P  := active groups, n := |P|, n >= 2
 * shuffle(P) using the seeded RNG
 * pairs := the one reading of that shuffle in which nobody meets an opponent
 *          they have already played (`@/domain/pairing`, issue #72)
 * if n is odd: the last remaining group receives a BYE and advances automatically
 * ```
 *
 * The no-rematch constraint is the whole of issue #72 and it is not a filter
 * applied afterwards: the pairing is searched for, out of the shuffled order,
 * so the fairness still comes from the shuffle and the room still watches the
 * same pot being emptied. When the field admits no rematch-free pairing at all
 * — four groups in their third round, where everyone has played everyone — the
 * pairing with the fewest repeats is taken instead and the repeats are named,
 * so the host can say so before the draw reaches the projector. `drawRound`
 * never asks; `forcedRematches` is how the caller finds out, and issue #72's
 * host dialog is where the asking happens.
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
  {
    at,
    label,
    track = 'MAIN',
    rng = createRng(tournament.rngSeed, tournament.rngCursor),
  }: DrawRoundInput,
): Tournament {
  const kind = roundKindFor(tournament, track);
  if (kind === undefined || !canDrawRound(tournament, track)) {
    return tournament;
  }

  const pairing = drawPairing(
    fieldOf(tournament, track).map((group) => group.id),
    {
      // Derived from the rounds that exist rather than carried in a field of
      // its own, so it cannot drift from the match history it describes
      // (issue #72, `@/domain/history`).
      history: playedAgainst(tournament),
      rng,
      // The `Freilose` §4 owes are settled here and only here, so the count
      // comes off the tournament rather than off the caller: an action that
      // forgot to pass it would deal 20 groups into 10 pairs where the bracket
      // is waiting for a field of 32 (docs/TOURNAMENT-RULES.md §4 fallback 1,
      // issue #22).
      //
      // Owed on either track since issue #91 — both have a lottery that can
      // take the fallback. The old comment below is what changed: the debt
      // belongs to the bracket the
      // side event does not feed, and paying it there would hand a `Freilos` to
      // a `Trostrunde` that owes nobody one (§10).
      byes: byesOwed(tournament, track),
    },
  );
  const matches = pair(pairing, nextMatchNumber(tournament));

  // Counted over the track, not over the file: `Runde 3` and `Trostrunde 2` are
  // each the third and second thing their own half of the evening has played,
  // and a number that counted both would call the side event's first round
  // `Trostrunde 7` in front of the room.
  const index = roundsOfTrack(tournament, track).length + 1;
  const round: Round = {
    id: nextRoundId(tournament),
    index,
    kind,
    track,
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

  return settle(fillTables(withRound, matches, at, track), round.id);
}

/** What the next draw would produce, without producing it (issue #72). */
export interface DrawPreview {
  /** The round `drawRound` would append. */
  round: Round;
  /**
   * The pairs it could not keep apart, in draw order. Empty in every ordinary
   * draw; non-empty is the case the host has to confirm.
   */
  forced: readonly Match[];
}

/**
 * The round the next draw would deal, so the host can be shown a forced
 * rematch before the room is (issue #72, docs/TOURNAMENT-RULES.md §3).
 *
 * Nothing is committed and the tournament's own cursor does not move — the
 * `Rng` this builds is thrown away. That is what makes the confirmation safe to
 * decline: the host says no, nothing happened, and the same press of the button
 * later deals the same pairings, because the draw is a function of the seed,
 * the cursor and the history and none of the three have changed.
 *
 * Which is also the one thing to know about the confirmation flow: the host
 * confirms a *preview*, and the commit re-runs the draw rather than replaying a
 * stored result. Identical by construction, and it keeps `drawRound` the single
 * place a round is ever built.
 *
 * Null when there is nothing to draw, for the same reasons `drawRound` hands
 * its argument back.
 */
export function previewDrawRound(
  tournament: Tournament,
  input: DrawRoundInput,
): DrawPreview | null {
  // The whole input travels, `track` included: a `Trostrunde` draw is confirmed
  // the same way a main-field one is, and the preview has to be of the round
  // the commit will actually deal (§10).
  const drawn = drawRound(tournament, input);
  if (drawn === tournament) {
    return null;
  }
  const round = drawn.rounds.at(-1);
  if (round === undefined) {
    return null;
  }
  return { round, forced: forcedRematches(drawn, round) };
}

/**
 * Turns a pairing into the round's matches, byes last.
 *
 * The order is the pairing's own, which is the shuffle's: pairs in the order
 * their first group came out of the pot, then the groups sitting the round out.
 * That is the order tables are handed out in and the order the queue drains in,
 * and it is what "the last ones drawn sit this round out" means on the beamer
 * (docs/TOURNAMENT-RULES.md §3).
 */
function pair(pairing: Pairing, firstNumber: number): Match[] {
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

  for (const [a, b] of pairing.pairs) {
    matches.push(newMatch(a, b));
  }
  for (const leftover of pairing.byes) {
    matches.push(newMatch(leftover, null));
  }

  return matches;
}

/**
 * The matches of a round that repeat a meeting the tournament already staged
 * (issue #72).
 *
 * Empty in every ordinary draw. Non-empty only when the field admitted no
 * rematch-free pairing at all, and then it is what the host has to be shown
 * *before* the draw goes on the projector — §3 says never silently.
 *
 * Derived from the tournament's own history rather than read off a flag, so it
 * stays right through an undo, a correction and a file repaired by hand
 * (`@/domain/history`).
 */
export function forcedRematches(tournament: Tournament, round: Round): readonly Match[] {
  return rematchesIn(tournament, round);
}

/**
 * Sends the front of the draw onto the tables that are free **and this track's
 * to use**, in the host's table order (`freeTables`, `@/domain/selectors`).
 *
 * Byes are skipped rather than counted: a bye must never occupy a table, both
 * because nobody is playing on it and because doing so would push a real pair
 * into the queue behind an empty table (§9 case 1).
 *
 * A `DISABLED` table is not free and is never filled here — that is the whole
 * point of taking one out of service (docs/TOURNAMENT-RULES.md §0). Nor is a
 * table the host has reserved for the other track (issue #79): that reservation
 * is the standing version of the decision they would otherwise make table by
 * table all evening, and a draw that ignored it would undo it in one press.
 *
 * A match starts the moment it lands on a table: `occupyTable` moves it to
 * `RUNNING` and stamps the table with `occupiedSince`, so `READY` is a status
 * the file format allows and nothing produces (docs/OPEN-QUESTIONS.md #48).
 */
function fillTables(
  tournament: Tournament,
  matches: readonly Match[],
  at: Timestamp,
  track: RoundTrack,
): Tournament {
  const free = freeTables(tournament, track);
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
export function nextQueuedMatch(tournament: Tournament, track: RoundTrack = 'MAIN'): Match | null {
  const round = currentRound(tournament, track);
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
  // Looked up across the open rounds rather than in one track's, because the
  // match id already says which round it is in and a caller that had to name
  // the track as well could name the wrong one. Two open rounds never share a
  // match id — ids are handed out from one counter over the whole file (§10).
  const round = openRoundOf(tournament, matchId);
  if (round === null) {
    return tournament;
  }

  const match = round.matches.find((candidate) => candidate.id === matchId);
  if (match === undefined || match.tableId !== null || match.winnerId !== null) {
    return tournament;
  }

  /*
   * And refused for a table the host has reserved for the other track
   * (issue #79). The panel does not offer the button, so this is the guard
   * against a stale click — a host who pressed *Nächste Partie starten* just as
   * the reservation changed under them gets nothing rather than a `Trostrunde`
   * pair on the table they had just set aside for the main field.
   */
  const table = tournament.tables.find((candidate) => candidate.id === tableId);
  if (table === undefined || !servesTrack(table, round.track)) {
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
  { tableId, at, track = 'MAIN' }: { tableId: TableId; at: Timestamp; track?: RoundTrack },
): Tournament {
  // The track is the host's: a freed table serves the queue the host points it
  // at, and with two rounds live that is a decision rather than an ordering
  // rule (§10, issue #79 for the reservation that makes it a standing one).
  const match = nextQueuedMatch(tournament, track);
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
  // Across the open rounds, for the reason `assignMatch` gives: the id names
  // the round, and with the `Trostrunde` live beside the main field a caller
  // that also had to name the track could name the wrong one (§10).
  const round = openRoundOf(tournament, matchId);
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
  // Winning a `Trostrunde` round keeps a group in the `Trostrunde`; it does not
  // put it back into the main field. The side event is self-contained and its
  // winner never rejoins — the only way back is the §4 lottery, which has
  // closed by the time this track exists (§10, issue #73).
  const throughStatus: GroupStatus = round.track === 'CONSOLATION' ? 'CONSOLATION' : 'ACTIVE';

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
      return group.status === throughStatus ? group : { ...group, status: throughStatus };
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

export function closeRoundBlockers(
  tournament: Tournament,
  track: RoundTrack = 'MAIN',
): readonly CloseRoundBlocker[] {
  const round = currentRound(tournament, track);
  if (round === null) {
    return ['NO_OPEN_ROUND'];
  }
  return undecidedMatches(round).length === 0 ? [] : ['MATCHES_UNDECIDED'];
}

/**
 * Whether every match of the open round has a winner
 * (docs/TOURNAMENT-RULES.md §3).
 */
export function canCloseRound(tournament: Tournament, track: RoundTrack = 'MAIN'): boolean {
  return closeRoundBlockers(tournament, track).length === 0;
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
export function closeRound(tournament: Tournament, track: RoundTrack = 'MAIN'): Tournament {
  const round = currentRound(tournament, track);
  if (round === null || !canCloseRound(tournament, track)) {
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
 * The open round that holds a match, whichever track it is on, or null.
 *
 * Since issue #73 there can be two open rounds, and a match id belongs to
 * exactly one of them: ids come from a single counter over the whole file, so
 * the lookup cannot be ambiguous. Closed rounds are deliberately not searched —
 * a decided round is corrected by undo, not by reaching back into it
 * (docs/TOURNAMENT-RULES.md §3).
 */
function openRoundOf(tournament: Tournament, matchId: MatchId): Round | null {
  for (let index = tournament.rounds.length - 1; index >= 0; index -= 1) {
    const round = tournament.rounds[index];
    if (
      round !== undefined &&
      round.state !== 'CLOSED' &&
      round.matches.some((match) => match.id === matchId)
    ) {
      return round;
    }
  }
  return null;
}

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
