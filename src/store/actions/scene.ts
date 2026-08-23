import { BLACKOUT_SCENE, type BeamerScene } from '@/domain/beamerScene';
import { de } from '@/i18n';
import type { TournamentStore } from '@/store/tournamentStore';

/**
 * Actions that decide what the beamer shows.
 *
 * Each one is a committed mutation, so each one lands on the undo stack and
 * reaches the beamer without doing anything about either itself
 * (docs/ARCHITECTURE.md §3).
 *
 * None of them writes to the audit log, and that is deliberate. The log lives
 * in the tournament file, so an entry here would rewrite the tournament on
 * every scene change — pushing a blackout onto the heavy sync channel and
 * triggering an autosave for it, when a blackout is the one thing that must
 * never wait behind sixty-four groups of data (issue #11).
 */

/**
 * Puts a scene on the beamer.
 *
 * Driving the beamer by hand is always allowed and always wins, so this turns
 * `autoFollow` off — golden rule 3. The host turns it back on deliberately.
 */
export function showScene(store: TournamentStore, scene: BeamerScene): void {
  store.commit(() => ({ scene, autoFollow: false }), { undoLabel: de.undo.action.sceneShown });
}

/** The panic button: black screen, immediately, whatever else is going on. */
export function blackout(store: TournamentStore): void {
  store.commit(() => ({ scene: BLACKOUT_SCENE, autoFollow: false }), {
    // Named on its own rather than through `showScene`: a host scanning the
    // undo button for the decision they want back reads what happened to the
    // projector, not that some scene or other changed.
    undoLabel: de.undo.action.blackout,
  });
}

/**
 * Hands the beamer back to the tournament phase.
 *
 * Issue #22 decides which scene a phase implies; until then re-enabling
 * auto-follow leaves the current picture alone rather than guessing.
 */
export function setAutoFollow(store: TournamentStore, autoFollow: boolean): void {
  store.commit(() => ({ autoFollow }), {
    undoLabel: autoFollow ? de.undo.action.autoFollowOn : de.undo.action.autoFollowOff,
  });
}
