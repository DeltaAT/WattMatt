import { byesOwed, FINAL_PHASE_SIZE, MINIMUM_BRACKET_SIZE } from '@/domain/draw';
import { isRepechageComplete, startRepechage, type RepechageRngInput } from '@/domain/repechage';
import { nextPowerOfTwo } from '@/domain/round';
import { activeGroups, currentRound } from '@/domain/selectors';
import type { Phase, Round, Tournament } from '@/domain/types';

/**
 * The phase state machine (issue #22, docs/TOURNAMENT-RULES.md §1 and §5).
 *
 * ```text
 * SETUP → QUALIFYING → REPECHAGE? → ELIMINATION* → NAMING → BRACKET → CEREMONY
 * ```
 *
 * Everything before this issue moved the tournament *within* a phase — a round
 * drawn, a result marked, a candidate accepted. This module is the glue between
 * them: after a round is closed it answers the one question the host has left,
 * which is whether another elimination round follows or the final phase begins.
 *
 * Three properties are load-bearing.
 *
 * **Nothing advances on its own.** `advancePhase` is called by a host action and
 * by nothing else. There is no timer, no effect and no "when the last winner is
 * marked" hook — the host closes the round, reads the panel, and presses the
 * button when the room is ready (CLAUDE.md golden rule 3).
 *
 * **The field is one number, computed in one place.** `carriedField` is what the
 * current phase hands to the next one, and every decision here is made from it:
 * whether a repechage is needed, whether another elimination round follows, what
 * size the bracket will be. Two answers to "how many are still in?" would
 * eventually disagree, and the disagreement would surface as a host being
 * offered the final phase while sixty-four people are still playing.
 *
 * **Every phase has a way out.** `nextPhase` is total over the phases and the
 * field, which is what the acceptance criterion "no configuration of group count
 * can produce an unreachable or stuck phase" means in code. The one place it
 * answers null — `ELIMINATION` with more than the final phase holds — is not a
 * dead end but the loop of §5: the host draws another round, the field halves,
 * and the same question is asked again.
 *
 * Pure, like everything in `src/domain`. The transitions this issue owns end at
 * `NAMING`; `NAMING → BRACKET` needs every group named (issue #23) and a bracket
 * to draw (issue #24), and `BRACKET → CEREMONY` needs a final to have been
 * played (issue #27), so `phaseStep` reports no step from those three rather
 * than offering a button that would produce a phase with nothing in it.
 */

/**
 * The whole machine of §1, as a table over the phase and the field it hands on.
 *
 * Separate from `phaseStep` and taking two numbers rather than a tournament, so
 * the shape of the machine can be checked against docs/TOURNAMENT-RULES.md §1
 * directly — every phase, every field size — without building a tournament that
 * happens to be in each of them.
 *
 * Null means "not from here, not yet": the `CEREMONY` is the end of the evening,
 * and an `ELIMINATION` field larger than the final phase needs another round
 * before the question can be answered at all.
 */
export function nextPhase(phase: Phase, field: number): Phase | null {
  switch (phase) {
    case 'SETUP':
      return 'QUALIFYING';
    case 'QUALIFYING':
      // §4: the bracket needs a power-of-two field, and the losers of round 1
      // are the only place the missing places can come from. Skipped entirely
      // when the field is already one, which is the common case (§9 case 2).
      return nextPowerOfTwo(field) === field ? finalOrElimination(field) : 'REPECHAGE';
    case 'REPECHAGE':
      // The phase leaves the field a power of two by its own invariant, so
      // there is nothing left to ask except how big it is.
      return finalOrElimination(field);
    case 'ELIMINATION':
      // The `while |W| > 16` of §5. Null is the loop going round again, not a
      // tournament with nowhere to go: the host draws, and this is asked again
      // of half the field.
      return field > FINAL_PHASE_SIZE ? null : 'NAMING';
    case 'NAMING':
      return 'BRACKET';
    case 'BRACKET':
      return 'CEREMONY';
    case 'CEREMONY':
      return null;
  }
}

function finalOrElimination(field: number): Phase {
  return field > FINAL_PHASE_SIZE ? 'ELIMINATION' : 'NAMING';
}

/** A reason the tournament cannot move on yet. Explained in German by the panel. */
export type PhaseBlocker =
  /** The phase's round has not been drawn — there is no `W` to carry forward. */
  | 'ROUND_NOT_DRAWN'
  /** A round is still open. The host closes it before the phase moves. */
  | 'ROUND_OPEN'
  /** The `Hoffnungsrunde` still has places to fill (docs/TOURNAMENT-RULES.md §4). */
  | 'REPECHAGE_OPEN'
  /** More are still in than the final phase holds — another round first (§5). */
  | 'FIELD_TOO_LARGE';

/**
 * The one step out of the phase the tournament is in.
 *
 * One step rather than a list of reachable phases, because there is only ever
 * one: §1 is a line, not a graph, and the single branch in it — repechage or
 * straight on — is decided by the field rather than by the host. What the host
 * decides is *when*, which is what `blockers` and `canAdvance` are about.
 */
export interface PhaseStep {
  /** Where the tournament stands. */
  from: Phase;
  /**
   * Where this step would take it.
   *
   * Present even while the step is blocked, and deliberately: the panel names
   * the phase the host is heading for from the moment the round is drawn, so
   * they can tell the room what happens next before it happens.
   */
  to: Phase;
  /**
   * How many are carried into `to` — `|W|` plus any `Freilose` §4 owes.
   *
   * Known from the pairings rather than from the results, for the reason
   * docs/OPEN-QUESTIONS.md #52 gives: every match yields exactly one winner, so
   * this number is fixed the moment a round is drawn and does not climb through
   * the round while the host watches it.
   */
  field: number;
  blockers: readonly PhaseBlocker[];
  canAdvance: boolean;
}

/**
 * What the host may do next about the phase, or null when the phase moves on
 * some other way.
 *
 * Null in `SETUP`, where *Turnier starten* is the pre-start panel's button and
 * has its own checks (issue #15) — a second control for the same transition
 * would be a second set of reasons for it to be greyed out. Null from `NAMING`
 * on, where the transitions belong to issues #23, #24 and #27.
 */
export function phaseStep(tournament: Tournament): PhaseStep | null {
  const phase = tournament.phase;
  if (phase !== 'QUALIFYING' && phase !== 'REPECHAGE' && phase !== 'ELIMINATION') {
    return null;
  }

  const field = carriedField(tournament);
  const blockers = phaseBlockers(tournament, field);
  // `nextPhase` answers null for an elimination field that still has to be
  // halved, and the blocker beside it already says so. The panel still names
  // `NAMING`, because that is where the tournament is going once the field is
  // small enough — and a button with no destination on it is one the host
  // cannot plan around.
  const to = nextPhase(phase, field) ?? 'NAMING';

  return { from: phase, to, field, blockers, canAdvance: blockers.length === 0 };
}

/** Whether `advancePhase` would move the tournament on. */
export function canAdvancePhase(tournament: Tournament): boolean {
  return phaseStep(tournament)?.canAdvance ?? false;
}

/**
 * How many the current phase hands to the next one.
 *
 * `|W|` is the number of *matches* in the phase's round, not the winners
 * decided so far: every match produces exactly one winner, byes included
 * (docs/OPEN-QUESTIONS.md #52). Before that round is drawn it is the field
 * standing — the groups still in, plus whatever §4 still owes — because that is
 * what the draw will deal.
 */
export function carriedField(tournament: Tournament): number {
  const standing = activeGroups(tournament).length;

  switch (tournament.phase) {
    case 'QUALIFYING': {
      const round = roundOfKind(tournament, 'QUALIFYING');
      // Two groups play one match and that match is the `Finale`, so nothing is
      // halved on the way there (docs/TOURNAMENT-RULES.md §9 case 5).
      if (round === null) {
        return standing <= MINIMUM_BRACKET_SIZE ? standing : Math.ceil(standing / 2);
      }
      return round.matches.length;
    }
    case 'REPECHAGE':
      // The target, not the count so far: §4 fills the field to it, and the
      // number the host plans around must not climb while candidates answer.
      return tournament.repechage?.target ?? standing;
    case 'ELIMINATION': {
      const round = lastRoundOfKind(tournament, 'ELIMINATION');
      return round === null ? standing + byesOwed(tournament) : round.matches.length;
    }
    default:
      return standing;
  }
}

function phaseBlockers(tournament: Tournament, field: number): readonly PhaseBlocker[] {
  const blockers: PhaseBlocker[] = [];

  if (tournament.phase === 'QUALIFYING') {
    const round = roundOfKind(tournament, 'QUALIFYING');
    // The one tournament that leaves `QUALIFYING` without a round in it: two
    // participants have nothing to qualify for (§9 case 5).
    const skipsQualifying =
      round === null && activeGroups(tournament).length <= MINIMUM_BRACKET_SIZE;
    if (round === null && !skipsQualifying) {
      blockers.push('ROUND_NOT_DRAWN');
    }
    if (round !== null && round.state !== 'CLOSED') {
      blockers.push('ROUND_OPEN');
    }
  }

  if (tournament.phase === 'REPECHAGE' && !isRepechageComplete(tournament)) {
    blockers.push('REPECHAGE_OPEN');
  }

  if (tournament.phase === 'ELIMINATION') {
    if (currentRound(tournament) !== null) {
      blockers.push('ROUND_OPEN');
    }
    if (field > FINAL_PHASE_SIZE) {
      blockers.push('FIELD_TOO_LARGE');
    }
  }

  return blockers;
}

/**
 * Moves the tournament into the next phase, once the host says so.
 *
 * Entering the `Hoffnungsrunde` is delegated rather than written here: that
 * phase change *is* the pot being shuffled, and the two must never be
 * observable apart (docs/OPEN-QUESTIONS.md #54). Every other transition is the
 * phase and nothing else — the round that follows is drawn by a separate,
 * explicit press, exactly as the qualifying round is (#45).
 *
 * Refused when a blocker is standing, so a stale click during a live event
 * costs nothing rather than skipping a phase in front of the room.
 */
export function advancePhase(tournament: Tournament, rng: RepechageRngInput = {}): Tournament {
  const step = phaseStep(tournament);
  if (step === null || !step.canAdvance) {
    return tournament;
  }
  if (step.to === 'REPECHAGE') {
    return startRepechage(tournament, rng);
  }
  return { ...tournament, phase: step.to };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * The qualifying round, of which there is exactly one
 * (docs/TOURNAMENT-RULES.md §3, docs/OPEN-QUESTIONS.md #49).
 */
function roundOfKind(tournament: Tournament, kind: Round['kind']): Round | null {
  return tournament.rounds.find((round) => round.kind === kind) ?? null;
}

/** The most recent round of a kind that repeats, which is the live one. */
function lastRoundOfKind(tournament: Tournament, kind: Round['kind']): Round | null {
  for (let index = tournament.rounds.length - 1; index >= 0; index -= 1) {
    const round = tournament.rounds[index];
    if (round !== undefined && round.kind === kind) {
      return round;
    }
  }
  return null;
}
