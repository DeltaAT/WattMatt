// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useRepechage, type RepechageHandle } from '@/windows/host/useRepechage';

/**
 * The wire between the repechage panel and the store (issue #21).
 *
 * The store is the real one: what is being checked is that a click reaches it,
 * that the panel redraws when it does, and that the panel is simply not on the
 * screen for the tournaments this phase does not apply to — which is most of
 * them, and which is issue #21's "skipped invisibly".
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** A tournament whose qualifying round is drawn, decided and closed. */
function qualified(groups: number, tables = 2): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => `Runde ${index}` });
  let decided = drawn;
  for (const match of openRound(drawn).matches) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

function openRound(document: Tournament): Round {
  const round = currentRound(document) ?? document.rounds[0];
  if (round === undefined) {
    throw new Error('nothing was drawn');
  }
  return round;
}

function opened(document: Tournament) {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, document, PATH);
}

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<RepechageHandle, void>(() => useRepechage());

describe('the repechage handle', () => {
  it('is inactive with no tournament open', () => {
    closeDocument(tournamentStore);

    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.state).toBeNull();
  });

  /*
   * The skip of docs/TOURNAMENT-RULES.md §9 case 2: 16 groups leave 8 winners,
   * which is already a power of two. The panel is not on the screen at all —
   * not on it saying that it does not apply.
   */
  it('is inactive for a field that is already a power of two', () => {
    opened(qualified(16));

    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.canStart).toBe(false);
    expect(result.current.blockers).toContain('NOT_NEEDED');
  });

  it('is inactive while the qualifying round is still open', () => {
    const drawn = drawRound(
      tournament({
        phase: 'QUALIFYING',
        groups: Array.from({ length: 13 }, (_unused, index) => group(index + 1)),
        nextGroupNumber: 14,
        tables: [table(1)],
        nextTableNumber: 2,
      }),
      { at: FIXED_NOW, label: (index) => `Runde ${index}` },
    );
    opened(drawn);

    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.blockers).toContain('QUALIFYING_NOT_CLOSED');
  });

  it('offers the start once the round is closed and the field is short', () => {
    opened(qualified(13));

    const { result } = mounted();

    expect(result.current.isActive).toBe(true);
    expect(result.current.canStart).toBe(true);
    expect(result.current.state).toBeNull();
    // Known from the pairings, before anything is drawn: the host reads the
    // same number before and after they press the button.
    expect(result.current.target).toBe(8);
  });

  it('starts the phase and redraws with the pot', () => {
    opened(qualified(13));
    const { result } = mounted();

    act(() => {
      result.current.start();
    });

    expect(result.current.state?.target).toBe(8);
    expect(result.current.state?.need).toBe(1);
    expect(result.current.canStart).toBe(false);
    expect(tournamentStore.getState().scene).toEqual({ id: 'REPECHAGE' });
  });

  /**
   * Issue #21's first acceptance criterion, at the layer the button reads: with
   * a candidate on the beamer there is nothing to draw, so the control the host
   * would double-click is off.
   */
  it('closes the draw while a candidate is waiting for an answer', () => {
    opened(qualified(13));
    const { result } = mounted();
    act(() => {
      result.current.start();
    });

    expect(result.current.canDraw).toBe(true);

    act(() => {
      result.current.drawCandidate();
    });

    expect(result.current.state?.pending).not.toBeNull();
    expect(result.current.canDraw).toBe(false);
  });

  it('accepts a candidate and closes the draw again once the field is full', () => {
    opened(qualified(13));
    const { result } = mounted();
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.drawCandidate();
    });
    const candidate = result.current.state?.pending;

    act(() => {
      result.current.accept();
    });

    expect(result.current.state?.through).toContain(candidate);
    expect(result.current.state?.need).toBe(0);
    expect(result.current.state?.complete).toBe(true);
    // Nothing left to offer anybody: the room has seen the last place taken.
    expect(result.current.canDraw).toBe(false);
  });

  it('declines a candidate and leaves the place open', () => {
    opened(qualified(13));
    const { result } = mounted();
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.drawCandidate();
    });
    const candidate = result.current.state?.pending;

    act(() => {
      result.current.decline();
    });

    expect(result.current.state?.declined).toContain(candidate);
    expect(result.current.state?.need).toBe(1);
    expect(result.current.canDraw).toBe(true);
  });

  it('reports the fallback when the pot runs dry with a place still open', () => {
    opened(qualified(13));
    const { result } = mounted();
    act(() => {
      result.current.start();
    });

    while (result.current.canDraw) {
      act(() => {
        result.current.drawCandidate();
      });
      act(() => {
        result.current.decline();
      });
    }

    expect(result.current.state?.fallbackNeeded).toBe(true);

    act(() => {
      result.current.useFallback('BYES');
    });

    expect(result.current.state).toMatchObject({ byes: 1, need: 0, complete: true });
  });

  it('puts the pot on the projector by hand', () => {
    opened(qualified(13));
    const { result } = mounted();
    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.showOnBeamer();
    });

    expect(tournamentStore.getState().scene).toEqual({ id: 'REPECHAGE' });
    // Driving the beamer by hand always wins and always turns auto-follow off
    // (CLAUDE.md golden rule 3).
    expect(tournamentStore.getState().autoFollow).toBe(false);
  });
});
