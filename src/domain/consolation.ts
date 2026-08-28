import { closeRound, drawRound, roundOutcome, type DrawRoundInput } from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { isRepechageComplete } from '@/domain/repechage';
import { consolationGroups, currentRound, roundsOfTrack } from '@/domain/selectors';
import type { Consolation, Group, Round, Tournament } from '@/domain/types';

/**
 * The `Trostrunde` — a self-contained side event for the first-round losers
 * (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * Three properties are the whole of this module.
 *
 * **It is a side event, not a way back.** Its winner does not rejoin the main
 * field. The only route back into the main tournament is the `Hoffnungsrunde`
 * lottery of §4, and that is unchanged. What the `Trostrunde` gives the groups
 * it takes is an evening of playing rather than an evening of watching.
 *
 * **It runs second and on whoever is left.** §4 removes groups from the loser
 * pool, so the field of this event is not known until the lottery has closed.
 * That ordering is why the host is asked here rather than at the close of the
 * qualifying round: the question can be *put* then, but it can only be
 * *answered into a field* afterwards.
 *
 * **It runs the whole pipeline** (issue #91). This is what changed: it used to
 * be a plain sequence of rounds with no power-of-two requirement and no tree at
 * the end, and that is now wrong. The side event runs the *same* pipeline as
 * the main field — a qualifying round, its own `Hoffnungsrunde` when the field
 * is not a power of two, elimination rounds down to sixteen, then a bracket
 * with a `Spiel um Platz 3` — with exactly one exception: it never enters the
 * naming phase, so it is numbers from its first round to its final.
 *
 * That is why almost nothing lives here any more. The pipeline is one pipeline
 * run twice, parameterised by `track` (`@/domain/track`), and what is left in
 * this module is only what is true of the side event and of nothing else: who
 * is in it, when the host may start it, and when it is over.
 *
 * **One level, and no further.** The `Trostrunde`'s own first-round losers do
 * **not** get a side event of their own — one level is where the structure
 * stops recursing (§10). The consequence is worth saying out loud to a room,
 * because it is the opposite of the main field's: declining *this*
 * `Hoffnungsrunde` really does mean going home.
 *
 * Pure, like everything in `src/domain`. Nothing here draws a round: the draw
 * engine does that, on the `CONSOLATION` track, over the field this module
 * defines.
 */

/** A reason the `Trostrunde` cannot be started right now. Explained by #73's panel. */
export type ConsolationBlocker =
  /** The qualifying round has not been closed, so nobody has lost yet (§3). */
  | 'QUALIFYING_OPEN'
  /**
   * The `Hoffnungsrunde` is still drawing. Its lottery removes groups from the
   * loser pool, so the field of the side event is not yet known (§4, §10).
   */
  | 'REPECHAGE_OPEN'
  /** The host has already answered — it is running, finished, or declined. */
  | 'ALREADY_ANSWERED'
  /**
   * Fewer than two groups would be in it.
   *
   * A field of one has nobody to play and a field of none has nobody at all;
   * both are the ordinary outcome of a lottery that drew most of the losers
   * back up, and neither may produce a round with nothing in it
   * (docs/OPEN-QUESTIONS.md #86).
   */
  | 'FIELD_TOO_SMALL';

/** Two groups, the same floor every draw has: one group has nobody to play. */
export const MINIMUM_CONSOLATION_FIELD = 2;

/**
 * Everyone the main tournament has finished with, in qualifying-draw order.
 *
 * Read off the qualifying round and then filtered by status. That is what makes
 * the two `Hoffnungsrunde` outcomes fall out without a special case: a
 * candidate who accepted is `ACTIVE` and therefore not here, and one who
 * declined is `ELIMINATED` and therefore is — which is the decline semantics
 * §10 settles (docs/OPEN-QUESTIONS.md #6). A loser the lottery never reached is
 * `ELIMINATED` too, and is likewise in.
 *
 * Groups eliminated anywhere other than the qualifying round cannot appear: the
 * side event is for the **first-round** losers, and by the time an elimination
 * round has produced any, the `Trostrunde` has long since been started or
 * declined.
 *
 * Answers about the field the event would *start* with, so it is empty once the
 * event is under way — from then on the field is written on the groups
 * themselves and `consolationGroups` is what reads it.
 */
export function consolationField(tournament: Tournament): readonly Group[] {
  const qualifying = tournament.rounds.find((round) => round.kind === 'QUALIFYING');
  if (qualifying === undefined || qualifying.state !== 'CLOSED') {
    return [];
  }

  const byId = new Map(tournament.groups.map((group) => [group.id, group]));
  const seen = new Set<GroupId>();
  const field: Group[] = [];

  for (const groupId of roundOutcome(qualifying).losers) {
    const group = byId.get(groupId);
    if (group === undefined || group.status !== 'ELIMINATED' || seen.has(groupId)) {
      continue;
    }
    seen.add(groupId);
    field.push(group);
  }

  return field;
}

/**
 * Everything standing between the host and the side event, all of it at once.
 *
 * A list rather than one reason, for the argument `@/domain/start` makes about
 * the pre-start report: a host reading a panel of checks needs the same panel
 * every time, and a check that vanishes once it passes is one they cannot
 * confirm they have satisfied.
 */
export function consolationBlockers(tournament: Tournament): readonly ConsolationBlocker[] {
  const blockers: ConsolationBlocker[] = [];

  const qualifying = tournament.rounds.find((round) => round.kind === 'QUALIFYING');
  if (qualifying === undefined || qualifying.state !== 'CLOSED') {
    blockers.push('QUALIFYING_OPEN');
  }
  // The lottery first, always. Asked before it closes, the question would be
  // answered into a field that is still shrinking (§10, order of operations).
  if (tournament.repechage !== null && !isRepechageComplete(tournament)) {
    blockers.push('REPECHAGE_OPEN');
  }
  if (tournament.consolation !== null) {
    blockers.push('ALREADY_ANSWERED');
  }
  if (consolationField(tournament).length < MINIMUM_CONSOLATION_FIELD) {
    blockers.push('FIELD_TOO_SMALL');
  }

  return blockers;
}

/** Whether the host may be offered the side event at all. */
export function canStartConsolation(tournament: Tournament): boolean {
  return consolationBlockers(tournament).length === 0;
}

/**
 * Whether the host still has the question in front of them.
 *
 * True exactly while `consolation` is null and the only thing missing is the
 * host's answer — which is what the panel keys on. A field too small to play is
 * not a question: §10 says a side event of one or none simply does not happen,
 * and offering a button that would deal an empty round is worse than not
 * offering one (docs/OPEN-QUESTIONS.md #86).
 */
export function isConsolationOffered(tournament: Tournament): boolean {
  return tournament.consolation === null && canStartConsolation(tournament);
}

/**
 * Starts the side event: everyone left in the loser pool joins it.
 *
 * The field is moved from `ELIMINATED` to `CONSOLATION` in one commit with the
 * record that says the event is running, so an undo takes both back and cannot
 * leave a tournament in which groups are in a side event that does not exist.
 *
 * No round is drawn here, exactly as `advancePhase` draws none: the host starts
 * the event, reads the room, and presses *auslosen* when it is ready
 * (CLAUDE.md golden rule 3, docs/OPEN-QUESTIONS.md #45).
 *
 * Refused when a blocker is standing, so a stale click during a live event
 * costs nothing rather than pulling eliminated groups back into play.
 */
export function startConsolation(tournament: Tournament): Tournament {
  if (!canStartConsolation(tournament)) {
    return tournament;
  }

  const field = new Set<GroupId>(consolationField(tournament).map((group) => group.id));
  return {
    ...tournament,
    groups: tournament.groups.map((group) =>
      field.has(group.id) ? { ...group, status: 'CONSOLATION' } : group,
    ),
    // At the start of its own pipeline, with nothing drawn (issue #91). The
    // phase is the side event's own and moves independently of the main
    // field's, which is routinely several rounds ahead of it.
    consolation: {
      state: 'RUNNING',
      phase: 'QUALIFYING',
      repechage: null,
      bracket: null,
      winnerId: null,
    },
  };
}

/**
 * The host's *Nein*: the losers go home as they did before §10 existed.
 *
 * Recorded rather than left as the absence of a decision, so the panel can stop
 * asking. Undoable like everything else, which is what makes it safe to press —
 * a host who says no and is then told the room wants to keep playing takes it
 * back (CLAUDE.md golden rule 6).
 */
export function declineConsolation(tournament: Tournament): Tournament {
  if (!canStartConsolation(tournament)) {
    return tournament;
  }
  return {
    ...tournament,
    consolation: {
      state: 'DECLINED',
      // `SETUP` rather than a phase it will never be in: nothing is offered for
      // a declined event, and a phase that named a step would be a step nobody
      // can take.
      phase: 'SETUP',
      repechage: null,
      bracket: null,
      winnerId: null,
    },
  };
}

/**
 * Whether the side event is open for business — which is what the draw engine
 * asks before dealing on the `CONSOLATION` track.
 */
export function isConsolationRunning(tournament: Tournament): boolean {
  return tournament.consolation?.state === 'RUNNING';
}

/**
 * The record after a `Trostrunde` round has been closed, or the argument back.
 *
 * **A guard, not a route.** Since issue #91 the side event ends in its tree:
 * `finishBracket` writes the winner under the final the host has just watched,
 * and every field size reaches that — a field of two included, because two
 * participants skip the qualifying round and their single match *is* the
 * `Finale` (§9 case 5, docs/OPEN-QUESTIONS.md entry 101).
 *
 * What is left here is the invariant underneath that: a closed round that
 * leaves exactly one group standing has decided the event, whatever the phase
 * machine thinks happens next, and a record still saying `RUNNING` would offer
 * the host a draw with a single group in the pot. Keeping it costs one
 * comparison per close and removes a way for the two to disagree.
 *
 * A closed round that leaves two or more still in changes nothing — the phase
 * moves on and the host draws again, or draws the tree.
 */
export function settleConsolation(tournament: Tournament): Tournament {
  const consolation = tournament.consolation;
  if (consolation === null || consolation.state !== 'RUNNING') {
    return tournament;
  }
  if (currentRound(tournament, 'CONSOLATION') !== null) {
    return tournament;
  }
  // The field has been moved across but nothing has been played yet, so the one
  // group standing in a two-group event is not a winner — it is half a pairing.
  if (roundsOfTrack(tournament, 'CONSOLATION').length === 0) {
    return tournament;
  }

  const standing = consolationGroups(tournament);
  const winner = standing[0];
  if (standing.length !== 1 || winner === undefined) {
    return tournament;
  }

  const finished: Consolation = { ...consolation, state: 'FINISHED', winnerId: winner.id };
  return { ...tournament, consolation: finished };
}

/**
 * Draws the next `Trostrunde` round — the ordinary draw of §3, on the side
 * event's track.
 *
 * A wrapper rather than a second engine, and that is the point of §10: shuffle,
 * pair, `Freilos` on an odd count, no rematches. The composition goes this way
 * round — this module calls the draw engine, never the other way about — so the
 * engine stays a mechanism that knows about tracks and this module stays the
 * rules that know about the side event.
 */
export function drawConsolationRound(
  tournament: Tournament,
  input: Omit<DrawRoundInput, 'track'>,
): Tournament {
  return drawRound(tournament, { ...input, track: 'CONSOLATION' });
}

/**
 * Closes the open `Trostrunde` round and records the winner if that round left
 * one group standing.
 *
 * The two steps are one call because they are one fact: the round in which
 * everybody but one group has lost **is** the end of the side event, and a
 * close that left the record saying `RUNNING` would offer the host a draw with
 * a single group in the pot. `closeRound` itself stays free of this — it is the
 * mechanism both tracks share, and the side event's rules live here.
 */
export function closeConsolationRound(tournament: Tournament): Tournament {
  const closed = closeRound(tournament, 'CONSOLATION');
  return closed === tournament ? tournament : settleConsolation(closed);
}

/** What the host's `Trostrunde` panel reads (issue #73). */
export interface ConsolationSummary {
  state: Consolation['state'];
  /** Where the side event has got to in its own copy of §1 (issue #91). */
  phase: Consolation['phase'];
  /** The groups still in it, in group order. */
  standing: readonly Group[];
  /** Its rounds, oldest first — `Trostrunde 1`, `Trostrunde 2`, … */
  rounds: readonly Round[];
  /** The open one, or null between two rounds. */
  round: Round | null;
  /** The last group standing, once there is one. */
  winner: Group | null;
}

/**
 * The side event as one object, or null while there is none.
 *
 * Null covers both "the host has not been asked" and "the host said no": in
 * neither case is there an event to draw a panel of. Whether the *question* is
 * still open is `isConsolationOffered`, which the panel asks separately — a
 * declined event and an unasked one look the same here and must not look the
 * same on screen.
 */
export function consolationSummary(tournament: Tournament): ConsolationSummary | null {
  const consolation = tournament.consolation;
  if (consolation === null || consolation.state === 'DECLINED') {
    return null;
  }

  const winnerId = consolation.winnerId;
  return {
    state: consolation.state,
    phase: consolation.phase,
    standing: consolationGroups(tournament),
    rounds: roundsOfTrack(tournament, 'CONSOLATION'),
    round: currentRound(tournament, 'CONSOLATION'),
    winner:
      winnerId === null ? null : (tournament.groups.find((group) => group.id === winnerId) ?? null),
  };
}
