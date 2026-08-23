import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import { tournamentStore } from '@/store/session';
import { nextRedo, nextUndo } from '@/store/undo';

/**
 * The host's undo, bound to the one store this window owns (issue #11).
 *
 * Everything that decides anything lives in `@/store/undo` and the store's
 * `commit`. What is left here is React: subscribing so the buttons re-label
 * themselves, and a key handler that must not fire while the host is typing.
 */

export interface UndoHandle {
  /** What an undo would take back, or `null` when there is nothing. */
  undoLabel: string | null;
  /** What a redo would put back, or `null` when there is nothing. */
  redoLabel: string | null;
  undo: () => void;
  redo: () => void;
}

export function useUndo(): UndoHandle {
  // The history object itself, not a derived label: `commit` hands back the
  // same reference when it did not touch the stack, so this re-renders exactly
  // when the buttons would read differently.
  const history = useSyncExternalStore(
    tournamentStore.subscribe,
    () => tournamentStore.getState().history,
  );

  const undo = useCallback(() => {
    tournamentStore.undo();
  }, []);
  const redo = useCallback(() => {
    tournamentStore.redo();
  }, []);

  return {
    undoLabel: nextUndo(history)?.label ?? null,
    redoLabel: nextRedo(history)?.label ?? null,
    undo,
    redo,
  };
}

/**
 * `Ctrl+Z` and `Ctrl+Y` (`Strg` on the host's keyboard), for the whole window.
 *
 * On `window` rather than on the buttons: the host's hands are on the keyboard
 * between decisions, and an undo that only worked while the toolbar happened to
 * have focus would fail in the one moment it is needed.
 *
 * `Ctrl+Shift+Z` is accepted as well. It costs one branch and it is what a host
 * who has used anything else on the machine will try first.
 */
export function useUndoShortcuts(handle: UndoHandle): void {
  // Read through a ref rather than captured: re-registering the listener on
  // every commit would leave a gap between the two, and a keypress that lands
  // in it does nothing while the host is already looking at the projector.
  const latest = useRef(handle);
  latest.current = handle;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Alt and the Windows key make this a different shortcut, not this one.
      if (!event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      // The tournament name is typed into an input on the start screen, and a
      // text field's own undo belongs to the text field.
      if (isTextEntry(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        latest.current.undo();
        return;
      }
      if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        latest.current.redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Whether the keypress belongs to something the host is typing into. */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (element === null || typeof element.tagName !== 'string') {
    return false;
  }
  return (
    element.isContentEditable === true ||
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT'
  );
}
