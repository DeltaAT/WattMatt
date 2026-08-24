import type { BeamerScene } from '@/domain/beamerScene';
import type { GroupId } from '@/domain/ids';
import * as repechage from '@/domain/repechage';
import type { RepechageFallback, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * Everything the host decides during the `Hoffnungsrunde` (issue #21).
 *
 * The rules are `@/domain/repechage`'s — this layer adds the German the undo
 * button reads, the audit record the file keeps, and how much a crash in the
 * next half-second is allowed to cost. Each is one commit, so each lands on the
 * undo stack, in the log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3).
 *
 * **Every one of these is urgent.** That is unusual — the round actions reserve
 * it for a draw and a close — and it is because this phase is the one the file
 * cannot reconstruct. The pot came out of one shuffle at one RNG cursor, and a
 * crash that lost a draw or an answer would reopen on a laptop that can only
 * shuffle again and offer the room a different candidate than the one whose
 * number was just read out (docs/OPEN-QUESTIONS.md #61).
 */

/**
 * Opens the phase and puts the pot on the projector, in one commit.
 *
 * One commit for the same reason `drawRound` stages its own scene: an undo that
 * took the shuffle back but left the beamer showing the pot would be a
 * projector displaying a phase that no longer exists (golden rule 4), and one
 * that took the picture back but left the pot drawn would have burned the RNG
 * cursor for nothing.
 *
 * The scene is staged whatever `autoFollow` says, and `autoFollow` itself is
 * left alone: the host pressed *Hoffnungsrunde starten*, which is as explicit
 * as an intention gets (golden rule 3).
 */
export function startRepechage(store: TournamentStore): void {
  change(
    store,
    (document) => repechage.startRepechage(document),
    (_before, after) => ({
      urgent: true,
      undoLabel: de.undo.action.repechageStarted,
      log: {
        action: 'REPECHAGE_STARTED',
        payload: {
          target: after.repechage?.target ?? null,
          // The pot in the order it was shuffled into, and the cursor it came
          // out of: together they are what makes the draw reproducible a week
          // later, if a participant asks (CLAUDE.md golden rule 7).
          pool: after.repechage?.pool ?? [],
          rngCursor: after.rngCursor,
        },
      },
    }),
    () => ({ scene: { id: 'REPECHAGE' } }),
  );
}

/**
 * Takes the next candidate out of the pot.
 *
 * Refused by the engine while one is unanswered, which is what makes "the host
 * can never accidentally draw two candidates at once" true below the button as
 * well as on it.
 */
export function drawRepechageCandidate(store: TournamentStore): void {
  change(
    store,
    (document) => repechage.drawCandidate(document),
    (_before, after) => ({
      urgent: true,
      undoLabel: de.undo.action.repechageCandidateDrawn({
        participant: participantOf(after, pendingOf(after)),
      }),
      log: {
        action: 'REPECHAGE_CANDIDATE_DRAWN',
        payload: {
          groupId: pendingOf(after),
          // What was still in the pot behind them. Half an hour later this is
          // the only record of how close the phase came to running dry.
          remaining: after.repechage?.pool.length ?? 0,
        },
      },
    }),
  );
}

/** The drawn candidate takes the place and is back in the tournament. */
export function acceptRepechageCandidate(store: TournamentStore): void {
  answer(store, true);
}

/** The drawn candidate says no, and is out for good (docs/OPEN-QUESTIONS.md #6). */
export function declineRepechageCandidate(store: TournamentStore): void {
  answer(store, false);
}

function answer(store: TournamentStore, accepted: boolean): void {
  change(
    store,
    (document) =>
      accepted ? repechage.acceptCandidate(document) : repechage.declineCandidate(document),
    (before) => {
      // Read off the tournament from *before*: afterwards nothing is pending,
      // and the participant this decision was about is the one the undo button
      // has to name.
      const candidate = pendingOf(before);
      const participant = participantOf(before, candidate);
      return {
        urgent: true,
        undoLabel: accepted
          ? de.undo.action.repechageAccepted({ participant })
          : de.undo.action.repechageDeclined({ participant }),
        log: {
          action: 'REPECHAGE_ANSWERED',
          payload: { groupId: candidate, accepted },
        },
      };
    },
  );
}

/**
 * Takes one of the two answers docs/TOURNAMENT-RULES.md §4 offers when the pot
 * has run dry with places still open.
 *
 * "This situation is logged prominently", says §4, and this is that log entry:
 * it records which answer was taken and how many places it was about, because
 * the field the bracket is built on will not be the field the qualifying round
 * produced and somebody will ask why.
 */
export function useRepechageFallback(store: TournamentStore, choice: RepechageFallback): void {
  change(
    store,
    (document) => repechage.useRepechageFallback(document, choice),
    (before, after) => ({
      urgent: true,
      undoLabel:
        choice === 'BYES' ? de.undo.action.repechageByes : de.undo.action.repechageReopened,
      log: {
        action: 'REPECHAGE_FALLBACK',
        payload: {
          choice,
          need: repechage.repechageState(before)?.need ?? 0,
          reopened: choice === 'BYES' ? [] : (after.repechage?.pool ?? []),
          rngCursor: after.rngCursor,
        },
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Applies one domain function to the open tournament and commits the result.
 *
 * The same shape as `@/store/actions/round`, and refusing the same two things
 * for the same reasons: nothing to do with no tournament open, and nothing to
 * commit when the domain handed its argument back. Every function in
 * `@/domain/repechage` does that when it is asked for something that cannot
 * happen — a second candidate while one is unanswered, a fallback before the
 * pot is empty — and committing it would put a step on the undo stack that
 * undoes nothing.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
  picture?: () => { scene?: BeamerScene },
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after, ...picture?.() }), describe(before, after));
}

/** The candidate waiting for an answer, or null. */
function pendingOf(document: Tournament): GroupId | null {
  return repechage.repechageState(document)?.pending ?? null;
}

/** What this tournament calls the group, in the host's chosen wording. */
function participantOf(document: Tournament, groupId: GroupId | null): string {
  const group = document.groups.find((candidate) => candidate.id === groupId);
  if (group === undefined) {
    return de.group.unknown;
  }
  return (
    group.name ?? de.participant[document.settings.participantLabel].numbered({ n: group.number })
  );
}
