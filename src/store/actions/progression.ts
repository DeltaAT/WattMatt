import type { BeamerScene } from '@/domain/beamerScene';
import * as phase from '@/domain/progression';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import type { CommitOptions, TournamentStore } from '@/store/tournamentStore';

/**
 * The one decision that moves the evening from one phase to the next
 * (issue #22, docs/TOURNAMENT-RULES.md §1).
 *
 * The rules are `@/domain/progression`'s — this layer adds the German the undo button
 * reads and the audit record the file keeps. One commit, so it lands on the
 * undo stack, in the log, on the beamer and in the next autosave without doing
 * anything about any of them (docs/ARCHITECTURE.md §3).
 *
 * **It is a host action and only a host action.** Nothing subscribes to a
 * closed round and calls this; there is no timer behind it and no effect that
 * fires when the last winner is marked. The host closes the round, tells the
 * room what happens next, and presses the button — which is the acceptance
 * criterion "the phase never advances without an explicit host action", made
 * true by there being no other caller (CLAUDE.md golden rule 3).
 */

/**
 * Moves the tournament into the next phase.
 *
 * `urgent`, for the reason `CommitOptions` names outright: a phase change is a
 * line the host has just told the room they have crossed, and the half second
 * of autosave debounce is the difference between a recoverable crash and an
 * evening that has to be explained.
 *
 * Entering the `Hoffnungsrunde` also stages the pot, exactly as
 * `@/store/actions/repechage` does when the host starts it from its own panel:
 * the phase change *is* the shuffle (docs/OPEN-QUESTIONS.md #54), and an undo
 * that took the pot back but left the projector showing it would be a beamer
 * displaying a phase that no longer exists (golden rule 4). Every other step is
 * the phase alone — the round that follows is drawn by a separate, explicit
 * press, so the pairings never appear on the wall before the host asks for them
 * (docs/OPEN-QUESTIONS.md #45).
 */
export function advancePhase(store: TournamentStore): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const step = phase.phaseStep(before);
  const after = phase.advancePhase(before);
  // Nothing to commit when the domain handed its argument back: a blocker is
  // standing, or there is no step from this phase at all. The button is
  // disabled in both cases; the guard is what makes a stale click during a live
  // event cost nothing rather than push an entry that undoes nothing.
  if (after === before || step === null) {
    return;
  }

  store.commit(() => ({ document: after, ...picture(after) }), describe(step, after));
}

function describe(step: phase.PhaseStep, after: Tournament): CommitOptions {
  return {
    urgent: true,
    undoLabel: de.undo.action.phaseAdvanced({ phase: de.phase.name[after.phase] }),
    log: {
      action: 'PHASE_ADVANCED',
      payload: {
        from: step.from,
        to: after.phase,
        // The field the step carried across. Half an hour later this is what
        // answers "why is the Turnierbaum this size?" without anybody having to
        // replay the evening (docs/FILE-FORMAT.md rule 6).
        field: step.field,
        // Only ever set by a step into the `Hoffnungsrunde`, and the pair of
        // them is what makes that shuffle reproducible a week later
        // (CLAUDE.md golden rule 7).
        pool: after.repechage?.pool ?? [],
        rngCursor: after.rngCursor,
      },
    },
  };
}

function picture(after: Tournament): { scene?: BeamerScene } {
  return after.phase === 'REPECHAGE' ? { scene: { id: 'REPECHAGE' } } : {};
}
