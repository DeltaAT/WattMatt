import { BLACKOUT_SCENE, type BeamerScene } from '@/domain/beamerScene';
import { sceneForPhase } from '@/domain/sceneCatalog';
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
 * Hands the beamer back to the tournament phase, or takes it away again.
 *
 * Turning auto-follow **on** stages the scene the phase implies straight away
 * (`sceneForPhase`), rather than waiting for the next phase step. Anything else
 * would be a button that answers "the beamer follows the tournament" with a
 * picture from twenty minutes ago until something happens to change — and the
 * host presses this precisely when the wall is wrong.
 *
 * Turning it **off** leaves the picture exactly where it is: taking manual
 * control is not a request for a different scene, it is a request for this one
 * to stop moving (golden rule 3).
 */
export function setAutoFollow(store: TournamentStore, autoFollow: boolean): void {
  store.commit(
    (state) => ({
      autoFollow,
      ...(autoFollow && state.document !== null ? { scene: sceneForPhase(state.document) } : {}),
    }),
    { undoLabel: autoFollow ? de.undo.action.autoFollowOn : de.undo.action.autoFollowOff },
  );
}

/**
 * Holds the picture on the projector while the host works ahead (issue #28).
 *
 * While frozen the sync layer sends the beamer nothing at all, so the host can
 * draw the next round, correct a result or stage the scene they want to come
 * back to without any of it appearing on the wall. Thawing delivers where the
 * evening actually got to, settled — the room is shown the new picture rather
 * than watching twenty minutes replayed at speed (`startHostSync`).
 *
 * Deliberately **not** on the undo stack, unlike the three actions above, and
 * `frozen` is deliberately not in the undo snapshot (docs/OPEN-QUESTIONS.md
 * #75). A freeze is a hold the host is applying with their hand still on the
 * key; undoing a misclicked result three panels away must not also whip the
 * cover off a screen they are working behind. It is its own undo — the host
 * presses the same control again — which is the property golden rule 6 is
 * actually about.
 */
export function setFrozen(store: TournamentStore, frozen: boolean): void {
  store.commit(() => ({ frozen }));
}

/**
 * Tells the beamer to jump whatever it is playing to its settled end
 * (docs/MOTION.md §1 law 2, docs/OPEN-QUESTIONS.md #53).
 *
 * A counter rather than a command: see `TournamentState.skipToken`. It changes
 * nothing about the tournament and nothing about which scene is staged, so it
 * carries no undo label and no audit entry — there is no such thing as
 * un-skipping an animation the room has already seen the end of.
 */
export function skipAnimation(store: TournamentStore): void {
  store.commit((state) => ({ skipToken: state.skipToken + 1 }));
}
