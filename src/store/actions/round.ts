import type { BeamerScene } from '@/domain/beamerScene';
import * as draw from '@/domain/draw';
import type { GroupId, MatchId, RoundId, TableId } from '@/domain/ids';
import { currentRound } from '@/domain/selectors';
import type { Clock, Match, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { systemClock } from '@/platform/clock';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * Everything the host decides while a round is running (issue #17).
 *
 * The rules are `@/domain/draw`'s — this layer adds what the host would call
 * the step in German, what the audit log should remember about it, and how much
 * a crash in the next half-second is allowed to cost. Each is one commit, so
 * each lands on the undo stack, in the log, on the beamer and in the next
 * autosave without doing anything about any of them (docs/ARCHITECTURE.md §3).
 *
 * The clock is a parameter with a default rather than a module-level read: the
 * timestamps these actions write end up in the file as the moment a match
 * started, and a test that could not pin them would be asserting against the
 * wall clock (ARCHITECTURE.md §5).
 */

/**
 * Draws the next round and puts the draw on the projector, in one commit.
 *
 * One commit, because the two belong to the same decision: an undo that took
 * the round back but left the beamer showing its pairings would be a projector
 * displaying a round that no longer exists (golden rule 4), and one that took
 * the picture back but left the round drawn would have burned the RNG cursor
 * for nothing.
 *
 * The scene is staged whatever `autoFollow` says, and `autoFollow` itself is
 * left alone. The host pressed the draw button — that is as explicit as an
 * intention gets, and a host who had taken the beamer by hand still gets the
 * picture they just asked for (golden rule 3). Issue #18 replaces the still
 * picture with the animated sequence; the scene descriptor it animates into is
 * this one.
 */
export function drawRound(store: TournamentStore, clock: Clock = systemClock): void {
  change(
    store,
    (document) =>
      draw.drawRound(document, {
        at: clock.now(),
        label: (index) => de.round.title({ n: index }),
      }),
    (_before, after) => {
      const round = currentRound(after);
      return {
        // A draw is not repeatable: the RNG cursor has moved, so a crash that
        // lost the round would deal the room different pairings than the ones
        // they watched being drawn (CLAUDE.md golden rule 7).
        urgent: true,
        undoLabel: de.undo.action.roundDrawn({ round: round?.label ?? de.round.label }),
        log: {
          action: 'ROUND_DRAWN',
          payload: {
            roundId: round?.id ?? null,
            matches: round?.matches.map((match) => ({
              matchId: match.id,
              a: match.a,
              b: match.b,
              tableId: match.tableId,
            })),
            // The cursor the draw ran from is what makes it reproducible a week
            // later, which is the whole reason the seed is stored at all
            // (docs/OPEN-QUESTIONS.md #23).
            rngCursor: after.rngCursor,
          },
        },
      };
    },
    (after) => {
      const roundId = currentRoundId(after);
      return roundId === null ? {} : { scene: { id: 'DRAW', roundId } };
    },
  );
}

/**
 * Marks the winner of a match, which also frees the table it was on
 * (docs/TOURNAMENT-RULES.md §3).
 *
 * The same call corrects a decision: passing the other group promotes it and
 * puts the previous winner back where it was. Both are one click for the host —
 * the deliberate second interaction a correction needs is in the panel, not
 * here, because a guard in the action would also block the undo of a correction.
 */
export function setMatchWinner(store: TournamentStore, matchId: MatchId, winnerId: GroupId): void {
  change(
    store,
    (document) => draw.setWinner(document, matchId, winnerId),
    (before, after) => {
      // What the correction replaced. Half an hour later the file is the only
      // record of the result that was on the projector first
      // (docs/FILE-FORMAT.md rule 6).
      const previousWinnerId = matchOf(before, matchId)?.winnerId ?? null;
      const participant = participantOf(after, winnerId);
      return {
        undoLabel:
          previousWinnerId === null
            ? de.undo.action.matchWinnerSet({ participant })
            : de.undo.action.matchWinnerCorrected({ participant }),
        log: {
          action: 'MATCH_WINNER_SET',
          payload: { matchId, winnerId, previousWinnerId },
        },
      };
    },
  );
}

/**
 * The host's confirmation that the table which just freed up takes the next
 * waiting pair (docs/TOURNAMENT-RULES.md §3, docs/OPEN-QUESTIONS.md #35).
 *
 * Deliberately not automatic: a round where the next pair walks up the moment
 * the last one sits down takes the beamer away from the host mid-sentence.
 */
export function startNextMatch(
  store: TournamentStore,
  tableId: TableId,
  clock: Clock = systemClock,
): void {
  change(
    store,
    (document) => draw.assignNextQueuedMatch(document, { tableId, at: clock.now() }),
    (before, after) => ({
      undoLabel: de.undo.action.matchStarted({ table: tableLabel(after, tableId) }),
      log: {
        action: 'MATCH_ASSIGNED',
        payload: {
          tableId,
          matchId: after.tables.find((table) => table.id === tableId)?.currentMatchId ?? null,
          // Read off the tournament from before: afterwards the match is no
          // longer waiting, and how long the queue was is the thing a host
          // reconstructing the evening wants to know.
          queued: queueLength(before),
        },
      },
    }),
  );
}

/**
 * Closes the open round once every match has a winner.
 *
 * Refused while anything is undecided — the button is disabled with the reason
 * on it, and this guard is what makes a click that arrived anyway cost nothing.
 */
export function closeRound(store: TournamentStore): void {
  change(
    store,
    (document) => draw.closeRound(document),
    (before) => {
      const round = currentRound(before);
      const outcome = round === null ? { winners: [], losers: [] } : draw.roundOutcome(round);
      return {
        // The other moment `CommitOptions.urgent` was written for: a closed
        // round is a line the host has told the room they have crossed.
        urgent: true,
        undoLabel: de.undo.action.roundClosed({ round: round?.label ?? de.round.label }),
        log: {
          action: 'ROUND_CLOSED',
          payload: {
            roundId: round?.id ?? null,
            winners: outcome.winners,
            losers: outcome.losers,
          },
        },
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * The same shape as `@/store/actions/tables`, and refusing the same two things
 * for the same reasons: nothing to do with no tournament open, and nothing to
 * commit when the domain handed its argument back. Every function in
 * `@/domain/draw` does that when it is asked for something that cannot happen —
 * a winner for a bye, a match onto an occupied table, a round closed with
 * matches still open — and committing it would put a step on the undo stack
 * that undoes nothing.
 *
 * `picture` is the one addition: an action may stage a beamer scene in the same
 * commit as the tournament change that caused it, so the two can never be
 * undone apart.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
  picture?: (after: Tournament) => { scene?: BeamerScene },
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after, ...picture?.(after) }), describe(before, after));
}

/**
 * The round the draw just appended, for the scene it is shown in.
 *
 * `currentRound` cannot be null here — `change` only reaches this when the draw
 * produced a round, and a round is open the moment it is drawn — but the last
 * round is taken as the answer rather than asserting, because an action that
 * throws during a live event is worse than a beamer pointed at the wrong round.
 */
function currentRoundId(document: Tournament): RoundId | null {
  return (currentRound(document) ?? document.rounds.at(-1))?.id ?? null;
}

function matchOf(document: Tournament, matchId: MatchId): Match | undefined {
  return currentRound(document)?.matches.find((match) => match.id === matchId);
}

/** What this tournament calls the group, in the host's chosen wording. */
function participantOf(document: Tournament, groupId: GroupId): string {
  const group = document.groups.find((candidate) => candidate.id === groupId);
  const words = de.participant[document.settings.participantLabel];
  if (group === undefined) {
    return de.group.unknown;
  }
  return group.name ?? words.numbered({ n: group.number });
}

/** What the host calls this table, for the undo button and the log. */
function tableLabel(document: Tournament, tableId: TableId): string {
  return document.tables.find((table) => table.id === tableId)?.label ?? de.table.label;
}

function queueLength(document: Tournament): number {
  const round = currentRound(document);
  return round === null ? 0 : draw.queuedMatches(round).length;
}
