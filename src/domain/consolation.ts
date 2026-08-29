import {
  closeRound,
  drawRound,
  qualifyingRoundOf,
  roundOutcome,
  type DrawRoundInput,
} from '@/domain/draw';
import type { GroupId } from '@/domain/ids';
import { isRepechageComplete, isRepechageNeeded } from '@/domain/repechage';
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
 * **The field is written down, not worked out** (issue #102). The moment the
 * lottery closes — or the qualifying round does, when no lottery is needed —
 * the field is materialised into `tournament.consolationField` and is never
 * recomputed. The main field carries on playing and its later rounds knock more
 * groups out; none of them belong here, because this is the losers' round of
 * the **first** round and not a bucket for everyone who ever lost. A field read
 * live off `group.status` said otherwise the moment the host let the main field
 * play on before starting the side event, which is the bug the snapshot ends.
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
   * The `Hoffnungsrunde` has not closed. Its lottery removes groups from the
   * loser pool, so the field of the side event is not yet known (§4, §10).
   *
   * Raised for a lottery that is **needed and not yet started** as well as for
   * one that is under way, which is what §4's ordering rule actually says: the
   * question may be *put* the moment the qualifying round closes, but it cannot
   * be *answered into a field* until the pot is closed. Before issue #102 only
   * a started lottery blocked, so a host who had not pressed *Hoffnungsrunde
   * starten* yet could take the side event's field out from under it.
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

// ---------------------------------------------------------------------------
// The field, fixed once (issue #102)
// ---------------------------------------------------------------------------

/**
 * Whether the side event's field can be decided yet
 * (docs/TOURNAMENT-RULES.md §4 "Ordering", §10 "Field").
 *
 * Two conditions, and they are the two halves of §10's definition. The
 * qualifying round has to be **closed**, or there is no `L` to take the field
 * out of. And the `Hoffnungsrunde` has to be **over** — either because the
 * field was already a power of two and §4 was skipped, or because its lottery
 * has filled the last place — because until then the pot is still shrinking the
 * loser pool.
 *
 * "Needed and not started" counts as open, which is stricter than the check
 * this replaced. A host who closed round 1 and had not yet pressed
 * *Hoffnungsrunde starten* used to be allowed to start the side event, and
 * every candidate the lottery drew afterwards would have been in two places at
 * once.
 */
export function isConsolationFieldFixed(tournament: Tournament): boolean {
  const qualifying = qualifyingRoundOf(tournament, 'MAIN');
  if (qualifying === null || qualifying.state !== 'CLOSED') {
    return false;
  }
  return !isRepechageNeeded(tournament, 'MAIN') || isRepechageComplete(tournament, 'MAIN');
}

/**
 * The field as §10 defines it, computed from the records rather than from where
 * the groups stand now.
 *
 * ```text
 * field := losers(round 1) minus everyone the Hoffnungsrunde drew back up
 * ```
 *
 * Straight off the qualifying round's matches and the lottery's draw records,
 * and **never** off `group.status`. That is the correction issue #102 makes: a
 * status-based reading is right only in the instant the lottery closes, and by
 * the time the main field has played another round it has swept that round's
 * losers in as well — putting a group that is `ELIMINATED` from round 2 into a
 * round that exists for the losers of round 1.
 *
 * Read this way the answer does not depend on *when* it is asked, which is what
 * makes the stored snapshot below safe to write at the first commit after an
 * old file is opened as well as at the moment the lottery closes.
 *
 * Both `Hoffnungsrunde` outcomes still fall out without a special case: a
 * candidate who accepted has an `accepted: true` draw and is out of the list, a
 * decliner has `accepted: false` and stays in it (docs/OPEN-QUESTIONS.md #6),
 * and a loser the lottery never reached was never drawn at all. A group that
 * declined, was readmitted by the `REOPEN_DECLINED` fallback and then accepted
 * holds both records; the acceptance wins, because it is the one that put them
 * back in the main field.
 *
 * Internal on purpose. Everything outside this module reads the stored list —
 * that is the whole point of storing it.
 */
function fieldNow(tournament: Tournament): readonly GroupId[] {
  const qualifying = qualifyingRoundOf(tournament, 'MAIN');
  if (qualifying === null) {
    return [];
  }

  const accepted = new Set<GroupId>(
    (tournament.repechage?.draws ?? [])
      .filter((draw) => draw.accepted === true)
      .map((draw) => draw.groupId),
  );

  const seen = new Set<GroupId>();
  const field: GroupId[] = [];
  for (const groupId of roundOutcome(qualifying).losers) {
    if (accepted.has(groupId) || seen.has(groupId)) {
      continue;
    }
    seen.add(groupId);
    field.push(groupId);
  }
  return field;
}

/**
 * Writes the field down, once, at the moment §10 fixes it.
 *
 * The fix for issue #102 in one function. Called after **every** committed
 * action rather than at the two call sites that can trigger it
 * (`@/store/tournamentStore`), for the reason the central broadcast and the
 * central autosave are: a rule that each future action has to remember is a
 * rule that a future action forgets, and the one it would forget here writes a
 * group into a round it is not in.
 *
 * Idempotent, and deliberately so. It hands its argument straight back when the
 * field is not fixed yet and when it has already been written, so the hundreds
 * of commits an evening makes cost one comparison each — and the list the host
 * read off the panel at half past eight is still the list at half past ten.
 *
 * **Already written wins.** Nothing that happens in the main field afterwards
 * may change the field, and that is enforced here rather than trusted: a group
 * knocked out of round 2 or 3 is simply eliminated. The single exception is an
 * undo back through the lottery, and it does not go through this function at
 * all — the stack restores the tournament from before the answer, snapshot
 * included, and the next answer fixes it again (`@/store/undo`).
 */
export function settleConsolationField(tournament: Tournament): Tournament {
  if (tournament.consolationField !== null || !isConsolationFieldFixed(tournament)) {
    return tournament;
  }
  return { ...tournament, consolationField: [...fieldNow(tournament)] };
}

/**
 * The `Trostrunde`'s field, in qualifying-draw order — the stored list and
 * nothing else (issue #102).
 *
 * Empty while the list is not fixed yet, which is every tournament up to the
 * close of the `Hoffnungsrunde`. An id that names no group is dropped rather
 * than thrown on: a file repaired by hand is the host's problem to see on the
 * panel, not a reason for the side event to fail to open.
 *
 * Unlike the reading this replaced it does **not** empty out once the event is
 * under way. It is the record of who the event started with, and it stays that
 * whatever the groups in it have done since — which is what makes it worth
 * showing the host before they press the button. The groups still *playing* are
 * `consolationGroups`, and the two are deliberately different questions.
 */
export function consolationField(tournament: Tournament): readonly Group[] {
  const stored = tournament.consolationField;
  if (stored === null) {
    return [];
  }

  const byId = new Map(tournament.groups.map((group) => [group.id, group]));
  return stored.flatMap((groupId) => {
    const group = byId.get(groupId);
    return group === undefined ? [] : [group];
  });
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

  const qualifying = qualifyingRoundOf(tournament, 'MAIN');
  if (qualifying === null || qualifying.state !== 'CLOSED') {
    blockers.push('QUALIFYING_OPEN');
  }
  // The lottery first, always. Asked before it closes, the question would be
  // answered into a field that is still shrinking (§10, order of operations).
  // Only asked once the round is closed, so a tournament that has not played
  // round 1 yet gives one reason rather than two for the same missing thing.
  if (
    qualifying !== null &&
    qualifying.state === 'CLOSED' &&
    !isConsolationFieldFixed(tournament)
  ) {
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
 * Starts the side event: the stored field joins it.
 *
 * The field is moved from `ELIMINATED` to `CONSOLATION` in one commit with the
 * record that says the event is running, so an undo takes both back and cannot
 * leave a tournament in which groups are in a side event that does not exist.
 *
 * Out of `tournament.consolationField` and out of nothing else (issue #102).
 * That list was written down when the `Hoffnungsrunde` closed, so however long
 * the host waits — and however many main-field rounds are played in between —
 * the groups that walk into the side event are the ones the host read off the
 * panel when the question was put.
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
