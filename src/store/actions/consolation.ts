import * as consolation from '@/domain/consolation';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * The one decision the host makes *about* the `Trostrunde` (issue #73,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * Once it is running it is run with the ordinary round actions on the
 * `CONSOLATION` track — `@/store/actions/round` takes a track for exactly that
 * reason. What is left here is the question the host is asked once, when the
 * `Hoffnungsrunde` closes: does the evening have a side event at all?
 *
 * Both answers commit. A *Nein* that changed nothing would leave the panel
 * asking the same question for the rest of the evening, and a host who is told
 * a minute later that the room wants to keep playing has to be able to take it
 * back like anything else (CLAUDE.md golden rule 6).
 *
 * Neither is urgent. Unlike a draw or a repechage answer, both are
 * reconstructible: no RNG cursor moves, nothing is read out to the room, and a
 * crash in the next half-second costs one click (docs/OPEN-QUESTIONS.md #61).
 */

/**
 * Starts the side event: everyone the `Hoffnungsrunde` left behind joins it.
 *
 * No scene is staged and no round is drawn. Starting is a decision about who is
 * still playing, and the room finds out when the first `Trostrunde` draw goes
 * up — which is a separate press, exactly as the qualifying round's is
 * (docs/OPEN-QUESTIONS.md #45).
 */
export function startConsolation(store: TournamentStore): void {
  change(
    store,
    (document) => consolation.startConsolation(document),
    (before) => {
      const field = consolation.consolationField(before);
      return {
        undoLabel: de.undo.action.consolationStarted({ n: field.length }),
        log: {
          action: 'CONSOLATION_STARTED',
          // The field as it stood when the host said yes. Half an hour later
          // the groups themselves have moved on — some have lost a `Trostrunde`
          // round — and who was in it at the start is what a host
          // reconstructing the evening is asked about (docs/FILE-FORMAT.md
          // rule 6).
          payload: { field: field.map((group) => group.id), size: field.length },
        },
      };
    },
  );
}

/** The host's *Nein*: the first-round losers go home, as they did before §10. */
export function declineConsolation(store: TournamentStore): void {
  change(
    store,
    (document) => consolation.declineConsolation(document),
    (before) => ({
      undoLabel: de.undo.action.consolationDeclined,
      log: {
        action: 'CONSOLATION_DECLINED',
        payload: { size: consolation.consolationField(before).length },
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
 * The same shape as `@/store/actions/round`, refusing the same two things for
 * the same reasons: nothing to do with no tournament open, and nothing to
 * commit when the domain handed its argument back — which is what every
 * function in `@/domain/consolation` does when a blocker is standing, and
 * committing it would put a step on the undo stack that undoes nothing.
 */
function change(
  store: TournamentStore,
  apply: (document: Tournament) => Tournament,
  describe: (before: Tournament, after: Tournament) => CommitOptions,
): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const after = apply(before);
  if (after === before) {
    return;
  }

  store.commit(() => ({ document: after }), describe(before, after));
}
