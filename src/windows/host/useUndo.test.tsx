// @vitest-environment jsdom

import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { midTournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { blackout, showScene } from '@/store/actions/scene';
import { tournamentStore } from '@/store/session';
import { useUndo, useUndoShortcuts, type UndoHandle } from '@/windows/host/useUndo';

/**
 * The host's hands are on the keyboard between decisions, so `Strg+Z` has to
 * work from anywhere in the window — and must not fire while they are typing a
 * tournament name (issue #11).
 *
 * The store is the real one: what is being checked is that a keypress reaches
 * it and that the buttons re-label themselves when it does.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, midTournament(), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

function mounted() {
  return renderHook<UndoHandle, void>(() => {
    const handle = useUndo();
    useUndoShortcuts(handle);
    return handle;
  });
}

function press(
  key: string,
  modifiers: Partial<KeyboardEventInit> = {},
  target: Element | Window = window,
) {
  act(() => {
    fireEvent.keyDown(target, { key, ctrlKey: true, ...modifiers });
  });
}

describe('the undo handle', () => {
  it('has nothing to offer on a tournament nobody has touched', () => {
    const { result } = mounted();

    expect(result.current.undoLabel).toBeNull();
    expect(result.current.redoLabel).toBeNull();
  });

  it('re-labels itself as the host works', () => {
    const { result } = mounted();

    act(() => showScene(tournamentStore, { id: 'BRACKET' }));
    expect(result.current.undoLabel).toBe(de.undo.action.sceneShown);

    act(() => blackout(tournamentStore));
    expect(result.current.undoLabel).toBe(de.undo.action.blackout);
  });

  it('offers the step it just took back as a redo', () => {
    const { result } = mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));

    act(() => result.current.undo());

    expect(result.current.undoLabel).toBeNull();
    expect(result.current.redoLabel).toBe(de.undo.action.sceneShown);
  });
});

describe('the keyboard shortcuts', () => {
  it('takes the last decision back on Ctrl+Z', () => {
    mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));

    press('z');

    expect(tournamentStore.getState().scene).toEqual({ id: 'IDLE' });
  });

  it('puts it back on Ctrl+Y', () => {
    mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));
    press('z');

    press('y');

    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('accepts Ctrl+Shift+Z as a redo as well', () => {
    mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));
    press('z');

    press('Z', { shiftKey: true });

    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('leaves text fields to their own undo', () => {
    mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));

    // The tournament name is typed into an input on the start screen; taking
    // the host's last decision back because they hit Ctrl+Z in a text field
    // would be a surprise they cannot see coming.
    const input = window.document.createElement('input');
    window.document.body.append(input);
    press('z', {}, input);
    input.remove();

    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('ignores a Z that is not the shortcut', () => {
    mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));

    press('z', { ctrlKey: false });
    press('z', { altKey: true });

    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET' });
  });

  it('stops listening once the window is gone', () => {
    const { unmount } = mounted();
    act(() => showScene(tournamentStore, { id: 'BRACKET' }));

    unmount();
    press('z');

    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET' });
  });
});
