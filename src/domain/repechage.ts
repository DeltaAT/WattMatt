import { roundOutcome } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { createRng, type Rng } from '@/domain/rng';
import { nextPowerOfTwo, repechageOutlook } from '@/domain/round';
import type { Group, Repechage, RepechageFallback, Round, Tournament } from '@/domain/types';

/**
 * The repechage engine — `Hoffnungsrunde`, issue #20,
 * docs/TOURNAMENT-RULES.md §4.
 *
 * ```text
 * target := 2^ceil(log2(|W|))
 * if |W| == target: skip entirely
 * need := target - |W|
 * pool := shuffle(losers)
 *
 * while need > 0 and pool is not empty:
 *     candidate := pool.pop()
 *     host decides: Ja   -> W.add(candidate); need -= 1
 *                   Nein -> candidate is eliminated
 * ```
 *
 * The trickiest rule in the app, and the one with the most ways to leave a host
 * stranded in front of a room, so three things are load-bearing here.
 *
 * **The pot is in the file.** It was produced by one shuffle at one position of
 * the seeded stream, and every draw since has moved the cursor past it, so a
 * laptop restarted mid-phase cannot reconstruct it — it could only shuffle
 * again and offer the room a different candidate than the pot it was shown.
 * That is what `repechage.pool` and schema v4 are for.
 *
 * **The field is read off the qualifying round, not off `group.status`.** `|W|`
 * is the winners of round 1 plus the candidates who have accepted since. Taking
 * the active groups instead would fold in a participant who turned up late and
 * was added mid-tournament (docs/TOURNAMENT-RULES.md §2), and the target
 * arithmetic would quietly be about a different field than the bracket needs.
 *
 * **Every path out is a host decision, and one always exists.** The pot only
 * ever shrinks, so the draw loop terminates; when it runs dry with places still
 * open, §4's two fallbacks are offered and *Freilose vergeben* is available
 * every single time. There is no state in here the host can reach and not leave.
 *
 * Pure, like everything in `src/domain`, and the same `Tournament -> Tournament`
 * shape as `@/domain/draw` for the reason recorded in docs/OPEN-QUESTIONS.md
 * #47: accepting a candidate changes a draw record *and* a group's status, and
 * the two have to land in one commit. Every function hands its argument back
 * unchanged when it is asked for something that cannot happen, so a stale click
 * during a live event costs nothing (CLAUDE.md golden rule 3).
 */

// ---------------------------------------------------------------------------
// Entering the phase
// ---------------------------------------------------------------------------

/** A reason the repechage cannot be started right now. Explained by #21. */
export type RepechageBlocker =
  /** §1 puts `REPECHAGE` after `QUALIFYING` and nowhere else. */
  | 'NOT_AFTER_QUALIFYING'
  /** No qualifying round, or the host has not closed it yet. */
  | 'QUALIFYING_NOT_CLOSED'
  /** It is already running — the pot has been drawn. */
  | 'ALREADY_STARTED'
  /** `|W|` is already a power of two, so §4 is skipped (§9 case 2). */
  | 'NOT_NEEDED';

/**
 * Everything standing between the host and the repechage, all of it at once.
 *
 * A list rather than a single reason, for the argument `drawBlockers` makes: a
 * host reading a panel of checks needs the same panel every time, and a check
 * that vanishes when it passes is one they cannot confirm they have satisfied.
 */
export function repechageBlockers(tournament: Tournament): readonly RepechageBlocker[] {
  const blockers: RepechageBlocker[] = [];

  if (tournament.phase !== 'QUALIFYING') {
    blockers.push('NOT_AFTER_QUALIFYING');
  }

  const round = qualifyingRound(tournament);
  if (round === null || round.state !== 'CLOSED') {
    blockers.push('QUALIFYING_NOT_CLOSED');
  }
  if (tournament.repechage !== null) {
    blockers.push('ALREADY_STARTED');
  }
  // Only asked once there is a round to ask it of. Without one the check above
  // has already fired, and "not needed" would be a second, misleading reason
  // for the same missing thing.
  if (round !== null && !isRepechageNeeded(tournament)) {
    blockers.push('NOT_NEEDED');
  }

  return blockers;
}

export function canStartRepechage(tournament: Tournament): boolean {
  return repechageBlockers(tournament).length === 0;
}

/**
 * Whether the field the qualifying round produced needs a second chance at all.
 *
 * The skip of docs/TOURNAMENT-RULES.md §9 case 2, and the question issue #22
 * asks before it routes the phase on: with `|W|` already a power of two the
 * `REPECHAGE` scene must never be shown, not even empty for a second. Read off
 * the number of matches rather than off the decided winners, for the reason in
 * docs/OPEN-QUESTIONS.md #52 — it is then the same answer the host has been
 * reading on the round panel since the moment the round was drawn.
 */
export function isRepechageNeeded(tournament: Tournament): boolean {
  const round = qualifyingRound(tournament);
  if (round === null) {
    return false;
  }
  return repechageOutlook(round)?.skipped === false;
}

export interface RepechageRngInput {
  /**
   * Where in the seeded stream the pot is shuffled.
   *
   * Defaults to the tournament's own cursor, which is the only position a live
   * draw may ever run from: an RNG built anywhere else would re-deal an order
   * the room has already been shown (CLAUDE.md golden rule 7).
   */
  rng?: Rng;
}

/**
 * Opens the `Hoffnungsrunde`: fixes the target and shuffles the losers into the
 * pot (docs/TOURNAMENT-RULES.md §4).
 *
 * The phase moves to `REPECHAGE` in the same object as the pot, deliberately
 * unlike `drawRound`, which leaves the phase alone (docs/OPEN-QUESTIONS.md #49,
 * #54). Entering the repechage *is* the phase change — a `REPECHAGE` phase with
 * no pot, or a pot with the phase still saying `QUALIFYING`, are two halves of
 * one decision that must never be observable apart, on the projector or in a
 * file recovered after a crash.
 *
 * Nobody's status changes here. The losers are already `ELIMINATED`; standing
 * in the pot is a chance, not a reprieve, and that is exactly what the room is
 * shown.
 */
export function startRepechage(
  tournament: Tournament,
  { rng = createRng(tournament.rngSeed, tournament.rngCursor) }: RepechageRngInput = {},
): Tournament {
  const round = qualifyingRound(tournament);
  if (round === null || !canStartRepechage(tournament)) {
    return tournament;
  }

  const { winners, losers } = roundOutcome(round);
  const repechage: Repechage = {
    target: nextPowerOfTwo(winners.length),
    pool: rng.shuffle(losers),
    draws: [],
    fallbackUsed: null,
  };

  return {
    ...tournament,
    phase: 'REPECHAGE',
    // The cursor moves on in the same object as the order it produced. A start
    // that recorded the pot but left the cursor behind would hand the identical
    // shuffle to the next thing that draws (docs/OPEN-QUESTIONS.md #23).
    rngCursor: rng.cursor,
    repechage,
  };
}

// ---------------------------------------------------------------------------
// Reading the phase
// ---------------------------------------------------------------------------

/**
 * Everything the host panel and the beamer scene read off a running repechage
 * (issue #21).
 *
 * One derived object rather than a handful of separate selectors, because these
 * numbers are shown side by side — the target, the count, the places left — and
 * two of them computed in two places would eventually disagree in front of the
 * audience.
 */
export interface RepechageState {
  /** `2^ceil(log2(|W|))` — the power-of-two field the bracket needs. */
  target: number;
  /** Through: the qualifying winners plus every candidate who has accepted. */
  through: readonly GroupId[];
  /** Not yet drawn, in the shuffled order. The next candidate is the front. */
  pool: readonly GroupId[];
  /** The candidate on the beamer, waiting for the host's answer. */
  pending: GroupId | null;
  /** Declined, and still eligible for the `REOPEN_DECLINED` fallback. */
  declined: readonly GroupId[];
  /**
   * Places the *Freilose vergeben* fallback owes the next draw.
   *
   * Zero unless the host took it. A count rather than a list because nobody
   * holds these places: docs/TOURNAMENT-RULES.md §5 hands them out as `Freilose`
   * when the next round is drawn, and who gets one is that draw's business
   * (issue #22).
   */
  byes: number;
  /** `through.length + byes` — a power of two once the phase is `complete`. */
  size: number;
  /** `target - size`, never negative: how many places are still open. */
  need: number;
  /** The pot has run dry with places still open — §4's fallback dialog. */
  fallbackNeeded: boolean;
  /** The last fallback the host took, or null. */
  fallbackUsed: RepechageFallback | null;
  /** Nothing pending and the field full. Issue #22 moves the phase on. */
  complete: boolean;
}

/**
 * The live state of the repechage, or null when there is not one.
 *
 * Null is the ordinary answer for most of a tournament — before the phase, and
 * whenever it was skipped — and it is what tells a caller to show nothing at
 * all rather than an empty pot (§9 case 2).
 */
export function repechageState(tournament: Tournament): RepechageState | null {
  const repechage = tournament.repechage;
  if (repechage === null) {
    return null;
  }

  const round = qualifyingRound(tournament);
  const winners = round === null ? [] : roundOutcome(round).winners;
  const accepted = repechage.draws.filter((draw) => draw.accepted === true);
  const through = [...winners, ...accepted.map((draw) => draw.groupId)];

  // At most one, because `drawCandidate` refuses while one is unanswered. The
  // first is taken rather than asserted on: a file repaired by hand is the
  // host's problem to see, not a reason for the panel to throw at them.
  const pending = repechage.draws.find((draw) => draw.accepted === null)?.groupId ?? null;

  const byes =
    repechage.fallbackUsed === 'BYES' ? Math.max(0, repechage.target - through.length) : 0;
  const size = through.length + byes;
  const need = Math.max(0, repechage.target - size);

  // A group is only offered back by `REOPEN_DECLINED` if it is not already in
  // play: one that declined, was readmitted and then accepted appears in
  // `draws` under both answers, and readmitting it a second time would put a
  // group that is already through back into the pot.
  const inPlay = new Set<GroupId>([...through, ...repechage.pool]);
  if (pending !== null) {
    inPlay.add(pending);
  }
  const declined = unique(
    repechage.draws.filter((draw) => draw.accepted === false).map((draw) => draw.groupId),
  ).filter((groupId) => !inPlay.has(groupId));

  return {
    target: repechage.target,
    through,
    pool: repechage.pool,
    pending,
    declined,
    byes,
    size,
    need,
    fallbackNeeded: need > 0 && repechage.pool.length === 0 && pending === null,
    fallbackUsed: repechage.fallbackUsed,
    complete: need === 0 && pending === null,
  };
}

/**
 * Whether the phase has done its job: the field is a power of two and nobody is
 * left waiting for an answer.
 *
 * The gate issue #22 opens the next round behind, and the invariant at the
 * bottom of docs/TOURNAMENT-RULES.md §4. False for a tournament that never had
 * a repechage — `isRepechageNeeded` is the question for that case, and the two
 * are kept apart so a skipped phase cannot be mistaken for a finished one.
 */
export function isRepechageComplete(tournament: Tournament): boolean {
  return repechageState(tournament)?.complete ?? false;
}

// ---------------------------------------------------------------------------
// The draw loop
// ---------------------------------------------------------------------------

/**
 * Takes the next candidate out of the pot (docs/TOURNAMENT-RULES.md §4).
 *
 * The front of the pool rather than its end: the order was fixed by the shuffle
 * in `startRepechage`, so which end it is read from changes nothing about
 * fairness, and "the next one is the one at the top of the list" is a sentence
 * a host can check against the file.
 *
 * Refused while a candidate is still unanswered, which is what makes issue
 * #21's "the host can never accidentally draw two candidates at once" true in
 * the engine rather than in a button's disabled state. Refused as well once the
 * field is full: the room has seen the last place taken, and there is nothing
 * left to offer anybody.
 */
export function drawCandidate(tournament: Tournament): Tournament {
  const state = repechageState(tournament);
  const repechage = tournament.repechage;
  if (state === null || repechage === null || state.pending !== null || state.need === 0) {
    return tournament;
  }

  const [candidate, ...rest] = repechage.pool;
  if (candidate === undefined) {
    return tournament;
  }

  return withRepechage(tournament, {
    ...repechage,
    pool: rest,
    draws: [...repechage.draws, { groupId: candidate, accepted: null }],
  });
}

/**
 * The drawn candidate takes the place and is back in the tournament.
 *
 * The draw record and the group's status move together: `ACTIVE` is what every
 * later draw reads (`activeGroups`), and a candidate marked accepted but left
 * `ELIMINATED` would be a group the room watched come back and the next round
 * never pairs.
 */
export function acceptCandidate(tournament: Tournament): Tournament {
  return answerCandidate(tournament, true);
}

/**
 * The drawn candidate declines, and is out for good.
 *
 * They do not go back into the pot; declining is a decision, not a pass
 * (docs/OPEN-QUESTIONS.md #6). The one way back is the host taking §4's
 * `REOPEN_DECLINED` fallback after the pot has run dry.
 */
export function declineCandidate(tournament: Tournament): Tournament {
  return answerCandidate(tournament, false);
}

function answerCandidate(tournament: Tournament, accepted: boolean): Tournament {
  const repechage = tournament.repechage;
  if (repechage === null) {
    return tournament;
  }

  const pendingIndex = repechage.draws.findIndex((draw) => draw.accepted === null);
  const pending = repechage.draws[pendingIndex];
  if (pending === undefined) {
    return tournament;
  }

  const answered = withRepechage(tournament, {
    ...repechage,
    draws: repechage.draws.map((draw, index) =>
      index === pendingIndex ? { ...draw, accepted } : draw,
    ),
  });

  return mapGroup(answered, pending.groupId, (group) => ({
    ...group,
    // Written for both answers rather than only for an acceptance. A decline
    // leaves an already-eliminated group exactly as it was, and a file where
    // the two records disagree is repaired rather than carried forward.
    status: accepted ? 'ACTIVE' : 'ELIMINATED',
  }));
}

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

/**
 * Takes one of the two answers docs/TOURNAMENT-RULES.md §4 offers when the pot
 * has run dry with places still open.
 *
 * `BYES` — *Freilose vergeben*, the default. The open places become `Freilose`
 * in the next round, which is what makes the field behave as the power of two
 * the bracket needs even though fewer groups are standing in it. The count is
 * `state.byes` from then on, and issue #22 hands them out when it draws.
 *
 * `REOPEN_DECLINED` — *Ausgeschiedene erneut zulassen*. Everyone who declined
 * goes back into the pot, shuffled again, and the draw loop carries on. Refused
 * when nobody has declined: there would be nothing to put back, and a host who
 * pressed it would be left looking at the same dialog.
 *
 * Both are refused unless the pot really is empty with places open. The dialog
 * is the only way in, and an early *Freilose vergeben* would hand out places
 * while candidates were still standing in the pot waiting to be drawn.
 *
 * Either answer terminates. `BYES` fills the field outright; `REOPEN_DECLINED`
 * can be taken again, but only ever after a further host decision, so there is
 * no loop the app can spin on its own — and `BYES` is available every time the
 * dialog comes back.
 */
export function useRepechageFallback(
  tournament: Tournament,
  choice: RepechageFallback,
  { rng = createRng(tournament.rngSeed, tournament.rngCursor) }: RepechageRngInput = {},
): Tournament {
  const state = repechageState(tournament);
  const repechage = tournament.repechage;
  if (state === null || repechage === null || !state.fallbackNeeded) {
    return tournament;
  }

  if (choice === 'BYES') {
    return withRepechage(tournament, { ...repechage, fallbackUsed: 'BYES' });
  }

  if (state.declined.length === 0) {
    return tournament;
  }

  const reopened = withRepechage(tournament, {
    ...repechage,
    pool: rng.shuffle(state.declined),
    fallbackUsed: 'REOPEN_DECLINED',
  });
  return { ...reopened, rngCursor: rng.cursor };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The qualifying round, whose `W` and `L` this phase works from.
 *
 * There is exactly one — docs/TOURNAMENT-RULES.md §3 calls it round 1, and
 * `drawBlockers` refuses a second (docs/OPEN-QUESTIONS.md #49) — so the first
 * match is the answer rather than the last.
 */
function qualifyingRound(tournament: Tournament): Round | null {
  return tournament.rounds.find((round) => round.kind === 'QUALIFYING') ?? null;
}

function withRepechage(tournament: Tournament, repechage: Repechage): Tournament {
  return { ...tournament, repechage };
}

function mapGroup(
  tournament: Tournament,
  groupId: GroupId,
  change: (group: Group) => Group,
): Tournament {
  let touched = false;
  const groups = tournament.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    const changed = change(group);
    // Compared rather than assumed, as `@/domain/draw` does: a decline leaves
    // an eliminated group as it was, and a fresh object for a no-op would still
    // re-render every chip on the host's screen.
    if (changed.status === group.status) {
      return group;
    }
    touched = true;
    return changed;
  });
  return touched ? { ...tournament, groups } : tournament;
}

function unique(ids: readonly GroupId[]): GroupId[] {
  return [...new Set(ids)];
}
