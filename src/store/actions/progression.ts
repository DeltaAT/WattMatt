import type { BeamerScene } from '@/domain/beamerScene';
import * as phase from '@/domain/progression';
import { sceneForPhase } from '@/domain/sceneCatalog';
import { trackState } from '@/domain/track';
import type { RoundTrack, Tournament } from '@/domain/types';
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
export function advancePhase(store: TournamentStore, track: RoundTrack = 'MAIN'): void {
  const before = store.getState().document;
  if (before === null) {
    return;
  }

  const step = phase.phaseStep(before, track);
  const after = phase.advancePhase(before, track);
  // Nothing to commit when the domain handed its argument back: a blocker is
  // standing, or there is no step from this phase at all. The button is
  // disabled in both cases; the guard is what makes a stale click during a live
  // event cost nothing rather than push an entry that undoes nothing.
  if (after === before || step === null) {
    return;
  }

  store.commit(
    (state) => ({ document: after, ...picture(after, state.autoFollow, track) }),
    describe(step, after, track),
  );
}

function describe(step: phase.PhaseStep, after: Tournament, track: RoundTrack): CommitOptions {
  const state = trackState(after, track);
  return {
    urgent: true,
    undoLabel: de.undo.action.phaseAdvanced({ phase: de.phase.name[state.phase] }),
    log: {
      action: 'PHASE_ADVANCED',
      payload: {
        // Which of the two tournaments moved. Both are in the file and both
        // walk the same phases, so an entry that did not say would be
        // ambiguous the moment the side event exists (issue #91).
        track,
        from: step.from,
        to: state.phase,
        // The field the step carried across. Half an hour later this is what
        // answers "why is the Turnierbaum this size?" without anybody having to
        // replay the evening (docs/FILE-FORMAT.md rule 6).
        field: step.field,
        // Only ever set by a step into the `Hoffnungsrunde`, and the pair of
        // them is what makes that shuffle reproducible a week later
        // (CLAUDE.md golden rule 7).
        pool: trackState(after, track).repechage?.pool ?? [],
        rngCursor: after.rngCursor,
      },
    },
  };
}

/**
 * The picture the step puts on the projector.
 *
 * Two phases stage themselves whatever the host has done to the beamer. The
 * `Hoffnungsrunde`, because the phase change *is* the pot being shuffled and
 * the two must never be observable apart (docs/OPEN-QUESTIONS.md #54).
 * `NAMING` for the opposite reason: nothing is about to happen out there for
 * several minutes, and whatever was on the wall — the round board of a round
 * that is over, the field of participants the host is now half-renaming — would
 * either go stale or show the room a list filling up one name at a time
 * (issue #23, docs/TOURNAMENT-RULES.md §6). The holding scene says what is
 * happening instead.
 *
 * Every other step follows the phase only while `autoFollow` is on, which is
 * the whole of that flag (issue #28). A scene staged by hand turns it off and
 * therefore outranks the phase (golden rule 3), and this is the only moment
 * auto-follow ever moves the picture: a phase boundary is a button the host
 * pressed themselves, so it cannot take the screen away mid-explanation.
 *
 * Either way the scene is part of the same commit, so an undo takes the picture
 * back with the phase rather than leaving the projector in a phase that no
 * longer exists (golden rule 4).
 */
function picture(
  after: Tournament,
  autoFollow: boolean,
  track: RoundTrack,
): { scene?: BeamerScene } {
  const phaseNow = trackState(after, track).phase;
  if (phaseNow === 'REPECHAGE') {
    return { scene: track === 'MAIN' ? { id: 'REPECHAGE' } : { id: 'REPECHAGE', track } };
  }
  /*
   * The `Trostrunde` never reaches `NAMING`, so this branch is the main
   * field's alone — and the side event's step into its own `BRACKET` phase
   * stages nothing at all, because the tree is not drawn yet. The host presses
   * *Turnierbaum auslosen* next, and that is what puts it on the wall (issue
   * #91, docs/OPEN-QUESTIONS.md, entry 100).
   */
  if (phaseNow === 'NAMING') {
    return { scene: { id: 'NAMING' } };
  }
  if (track !== 'MAIN') {
    return {};
  }
  return autoFollow ? { scene: sceneForPhase(after) } : {};
}
