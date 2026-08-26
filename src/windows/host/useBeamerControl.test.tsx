// @vitest-environment jsdom

import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { round, roundId, tournament } from '@/domain/testFixtures';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { setTournamentName } from '@/store/actions/settings';
import { tournamentStore } from '@/store/session';
import { useBeamerControl, type BeamerControlHandle } from '@/windows/host/useBeamerControl';
import { useBeamerShortcuts } from '@/windows/host/useBeamerShortcuts';

/**
 * The beamer control centre against the real store (issue #28).
 *
 * Everything the panel offers has to work from the keyboard as well, because
 * that is the path the host actually uses once the room is full — so the hook
 * and its shortcuts are mounted together and driven the way a host would drive
 * them.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(
    tournamentStore,
    tournament({ phase: 'QUALIFYING', rounds: [round(1, { state: 'RUNNING' })] }),
    PATH,
  );
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

function mounted(onShowShortcuts = () => {}) {
  return renderHook<BeamerControlHandle, void>(() => {
    const handle = useBeamerControl();
    useBeamerShortcuts(handle, onShowShortcuts);
    return handle;
  });
}

function press(key: string, target: Element | Window = window, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(target, {
      key,
      code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`,
      ...init,
    });
  });
}

describe('the scene switcher', () => {
  it('stages a scene and takes manual control with it', () => {
    const { result } = mounted();

    act(() => result.current.show({ id: 'TABLE_OVERVIEW' }));

    expect(tournamentStore.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });
    expect(result.current.autoFollow).toBe(false);
  });

  it('reaches every scene from its digit', () => {
    const { result } = mounted();

    // 3 is the table overview and 5 is the round board, in the fixed order of
    // `SCENE_ORDER` — the positions are what the host's hand learns.
    press('3');
    expect(tournamentStore.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });

    press('5');
    expect(tournamentStore.getState().scene).toEqual({
      id: 'ROUND_BOARD',
      roundId: roundId(1),
    });
    expect(result.current.isStaged(result.current.choices[4]!)).toBe(true);
  });

  /*
   * A host pressing 4 before the first draw is reaching for the `Auslosung`.
   * The last thing they want is a different picture appearing because the one
   * they asked for was not available.
   */
  it('does nothing at all for a digit whose scene does not exist yet', () => {
    closeDocument(tournamentStore);
    setOpenedDocument(tournamentStore, tournament(), PATH);
    mounted();
    const before = tournamentStore.getState().scene;

    press('4');

    expect(tournamentStore.getState().scene).toEqual(before);
  });
});

describe('the blackout', () => {
  it('goes black on B and comes back to the picture that was up before it', () => {
    mounted();

    press('3');
    press('b');
    expect(tournamentStore.getState().scene).toEqual({ id: 'BLACKOUT' });

    press('b');
    expect(tournamentStore.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });
  });

  /*
   * "Blackout works even while an animation is running." Nothing about the
   * beamer's state can gate it: the action only commits, and the sequence on
   * the projector is a consequence rather than a lock (golden rule 5).
   */
  it('works while a draw is staged and still playing', () => {
    mounted();

    act(() => {
      tournamentStore.commit(() => ({ scene: { id: 'DRAW', roundId: roundId(1) } }));
    });
    press('b');

    expect(tournamentStore.getState().scene).toEqual({ id: 'BLACKOUT' });
  });
});

describe('the freeze and the skip', () => {
  it('holds and releases the picture on F', () => {
    const { result } = mounted();

    press('f');
    expect(result.current.frozen).toBe(true);

    press('f');
    expect(result.current.frozen).toBe(false);
  });

  it('bumps the skip token once per press of the space bar', () => {
    mounted();
    const before = tournamentStore.getState().skipToken;

    press(' ');
    press(' ');

    expect(tournamentStore.getState().skipToken).toBe(before + 2);
  });

  it('counts a held key as one press', () => {
    mounted();
    const before = tournamentStore.getState().skipToken;

    press(' ');
    act(() => {
      fireEvent.keyDown(window, { key: ' ', code: 'Space', repeat: true });
    });

    expect(tournamentStore.getState().skipToken).toBe(before + 1);
  });
});

describe('handing the beamer back', () => {
  it('stages the scene the phase implies the moment auto-follow goes on', () => {
    const { result } = mounted();
    act(() => result.current.show({ id: 'TABLE_OVERVIEW' }));

    act(() => result.current.setAutoFollow(true));

    expect(tournamentStore.getState().scene).toEqual({ id: 'ROUND_BOARD', roundId: roundId(1) });
  });

  it('keeps a manual choice through the decisions the host takes behind it', () => {
    const { result } = mounted();
    act(() => result.current.show({ id: 'GROUP_OVERVIEW' }));

    // A tournament decision, committed while the host is talking over the
    // picture they staged. Manual control is sticky until they release it.
    act(() => setTournamentName(tournamentStore, 'Winterturnier'));

    expect(tournamentStore.getState().autoFollow).toBe(false);
    expect(tournamentStore.getState().scene).toEqual({ id: 'GROUP_OVERVIEW' });
  });
});

describe('the shortcuts and the host typing', () => {
  /*
   * The naming phase is a panel of nothing but text fields, and `B` in one of
   * them has to be the letter B (the issue's last acceptance criterion).
   */
  it('fires none of them while the host is in a text field', () => {
    mounted();
    const input = window.document.createElement('input');
    window.document.body.append(input);
    const before = tournamentStore.getState();

    press('b', input);
    press('f', input);
    press('3', input);
    press(' ', input);

    expect(tournamentStore.getState()).toBe(before);
  });

  it('leaves a modified keypress to whoever owns it', () => {
    mounted();
    const before = tournamentStore.getState();

    // `Strg+Z` belongs to undo, and nothing here may swallow it.
    press('z', window, { ctrlKey: true });
    press('b', window, { ctrlKey: true });

    expect(tournamentStore.getState()).toBe(before);
  });

  it('opens the overview on the question mark', () => {
    const onShowShortcuts = vi.fn();
    mounted(onShowShortcuts);

    press('?', window, { shiftKey: true });

    expect(onShowShortcuts).toHaveBeenCalledTimes(1);
  });
});
