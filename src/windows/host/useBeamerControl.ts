import { useCallback, useRef, useSyncExternalStore } from 'react';

import { IDLE_SCENE, isSameScene, type BeamerScene } from '@/domain/beamerScene';
import { sceneChoices, type SceneChoice } from '@/domain/sceneCatalog';
import { currentRound } from '@/domain/selectors';
import {
  blackout,
  setAutoFollow,
  setFrozen,
  showScene,
  skipAnimation,
} from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';

/**
 * The beamer control centre, bound to the one store this window owns
 * (issue #28).
 *
 * Everything that decides anything lives in `@/domain/sceneCatalog` and the
 * actions around it. What is left here is React — subscribing so the switcher
 * redraws when the picture changes, and handing the panel callbacks that keep
 * their identity between renders so the keyboard layer can hold on to them.
 */

export interface BeamerControlHandle {
  /** What the host has staged. Not necessarily what the room can see: see `frozen`. */
  scene: BeamerScene;
  /** Every scene the host can reach, in the fixed order the digits follow. */
  choices: readonly SceneChoice[];
  /** Whether the scene follows the tournament phase (default on). */
  autoFollow: boolean;
  /** Whether the projector is holding its picture while the host works ahead. */
  frozen: boolean;
  /** Whether the screen is currently black. */
  isBlackout: boolean;
  /**
   * Whether both tracks have a live round to put side by side (issue #79).
   *
   * False for every tournament without a `Trostrunde`, and false again the
   * moment either round closes — so the control is on screen exactly while it
   * can do something.
   */
  canSplit: boolean;
  /** Whether the staged round board is showing both tracks. */
  isSplit: boolean;

  show: (scene: BeamerScene) => void;
  /** Stages the scene at position 1…9, or does nothing when it has none. */
  showAt: (shortcut: number) => void;
  /** Black screen, and back to the picture that was up before it. */
  toggleBlackout: () => void;
  setAutoFollow: (autoFollow: boolean) => void;
  toggleFreeze: () => void;
  /** Puts the second track's board beside the first, or takes it away again. */
  toggleSplit: () => void;
  /** Jumps whatever the beamer is playing to its settled end. */
  skip: () => void;
  /** Whether a choice is the picture that is staged right now. */
  isStaged: (choice: SceneChoice) => boolean;
}

export function useBeamerControl(): BeamerControlHandle {
  // The whole state rather than a field: `commit` replaces it wholesale, so the
  // reference is stable between commits and changes at exactly the moments the
  // panel would read differently.
  const state = useSyncExternalStore(tournamentStore.subscribe, tournamentStore.getState);

  /**
   * The picture the blackout interrupted.
   *
   * A ref rather than store state, and deliberately not undoable. "Back on"
   * means back to what the room was looking at a second ago, which is a fact
   * about this host session and not about the tournament — putting it in the
   * document would write a beamer button into the file, and putting it on the
   * undo stack would make coming back out of a blackout consume a step the host
   * may want for the result they got wrong.
   */
  const beforeBlackout = useRef<BeamerScene | null>(null);

  const show = useCallback((scene: BeamerScene) => showScene(tournamentStore, scene), []);

  const showAt = useCallback((shortcut: number) => {
    const choice = sceneChoices(tournamentStore.getState().document).find(
      (candidate) => candidate.shortcut === shortcut,
    );
    // A digit whose scene does not exist yet does nothing at all, rather than
    // staging something else. A host pressing 4 before the first draw is
    // reaching for the `Auslosung`; the last thing they want is a different
    // picture appearing because the one they asked for was unavailable.
    if (choice?.scene != null) {
      showScene(tournamentStore, choice.scene);
    }
  }, []);

  const toggleBlackout = useCallback(() => {
    const current = tournamentStore.getState().scene;
    if (current.id === 'BLACKOUT') {
      showScene(tournamentStore, beforeBlackout.current ?? IDLE_SCENE);
      return;
    }
    beforeBlackout.current = current;
    blackout(tournamentStore);
  }, []);

  const follow = useCallback(
    (autoFollow: boolean) => setAutoFollow(tournamentStore, autoFollow),
    [],
  );

  const toggleFreeze = useCallback(() => {
    setFrozen(tournamentStore, !tournamentStore.getState().frozen);
  }, []);

  const skip = useCallback(() => skipAnimation(tournamentStore), []);

  /**
   * Puts both tracks on the wall at once, or takes the second one back off
   * (issue #79, docs/TOURNAMENT-RULES.md §10).
   *
   * A flag on the staged `ROUND_BOARD` rather than a scene of its own, because
   * the switcher has exactly nine positions and the position *is* the keyboard
   * shortcut — a tenth entry would move every digit the host's hand has learned
   * (the same constraint issue #74 hit). It is also the honest shape: splitting
   * is a property of the picture the host already chose, not a different
   * picture to choose instead.
   *
   * Staging it turns auto-follow off like every other manual choice, which is
   * `showScene`'s doing and not this function's.
   */
  const toggleSplit = useCallback(() => {
    const current = tournamentStore.getState().scene;
    if (current.id !== 'ROUND_BOARD') {
      return;
    }
    showScene(tournamentStore, { ...current, split: current.split !== true });
  }, []);

  const isStaged = useCallback(
    (choice: SceneChoice) => choice.scene !== null && isSameScene(choice.scene, state.scene),
    [state.scene],
  );

  return {
    scene: state.scene,
    // Recomputed on every commit rather than memoised, for the reason
    // `@/domain/lookup` gives: the store commits whole new states, so a cached
    // list would name the previous round after the next one was drawn.
    choices: sceneChoices(state.document),
    autoFollow: state.autoFollow,
    frozen: state.frozen,
    isBlackout: state.scene.id === 'BLACKOUT',
    /*
     * Whether there are two live rounds to put side by side. Read off the
     * document rather than off the scene: the control has to disappear when the
     * side event's round closes, not when the host next stages something.
     */
    canSplit:
      state.scene.id === 'ROUND_BOARD' &&
      state.document !== null &&
      currentRound(state.document, 'MAIN') !== null &&
      currentRound(state.document, 'CONSOLATION') !== null,
    isSplit: state.scene.id === 'ROUND_BOARD' && state.scene.split === true,
    show,
    showAt,
    toggleBlackout,
    setAutoFollow: follow,
    toggleFreeze,
    toggleSplit,
    skip,
    isStaged,
  };
}
