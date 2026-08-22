import { BLACKOUT_SCENE, type BeamerScene } from '@/domain/beamerScene';
import { commit, type TournamentStore } from '@/store/tournamentStore';

/**
 * Actions that decide what the beamer shows.
 *
 * Each one is a committed mutation, so each one lands on the undo stack and
 * reaches the beamer without doing anything about either itself
 * (docs/ARCHITECTURE.md §3).
 */

/**
 * Puts a scene on the beamer.
 *
 * Driving the beamer by hand is always allowed and always wins, so this turns
 * `autoFollow` off — golden rule 3. The host turns it back on deliberately.
 */
export function showScene(store: TournamentStore, scene: BeamerScene): void {
  commit(store, () => ({ scene, autoFollow: false }));
}

/** The panic button: black screen, immediately, whatever else is going on. */
export function blackout(store: TournamentStore): void {
  showScene(store, BLACKOUT_SCENE);
}

/**
 * Hands the beamer back to the tournament phase.
 *
 * Issue #22 decides which scene a phase implies; until then re-enabling
 * auto-follow leaves the current picture alone rather than guessing.
 */
export function setAutoFollow(store: TournamentStore, autoFollow: boolean): void {
  commit(store, () => ({ autoFollow }));
}
