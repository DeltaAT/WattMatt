// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { usePhase, type PhaseHandle } from '@/windows/host/usePhase';

/**
 * The wire between the phase panel and the store (issue #22).
 *
 * The store is the real one: what is being checked is that a press reaches it,
 * that the panel redraws when it does, and — the acceptance criterion — that
 * nothing moves the phase on when nobody presses anything.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** A tournament whose qualifying round is drawn, decided and closed. */
function qualified(groups: number, tables = 4): Tournament {
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

function handle(): { current: PhaseHandle } {
  return renderHook(() => usePhase()).result;
}

describe('usePhase', () => {
  it('reads nothing with no tournament open', () => {
    const result = handle();

    expect(result.current.isActive).toBe(false);
    expect(result.current.step).toBeNull();
    expect(result.current.history).toEqual([]);
  });

  /* During SETUP the pre-start panel is the whole story, and a second panel
   * saying the tournament has not started is a panel in the way. */
  it('stays off the screen during setup', () => {
    opened(tournament({ phase: 'SETUP' }));

    expect(handle().current.isActive).toBe(false);
  });

  it('reads the step out of the open tournament', () => {
    opened(qualified(64));
    const result = handle();

    expect(result.current.isActive).toBe(true);
    expect(result.current.phase).toBe('QUALIFYING');
    expect(result.current.step?.to).toBe('ELIMINATION');
    expect(result.current.step?.field).toBe(32);
  });

  /*
   * The acceptance criterion, on the host's side of the wall: mounting the
   * panel, reading it and letting it sit there moves nothing. Only the press
   * does.
   */
  it('moves nothing until the host presses', () => {
    opened(qualified(64));
    const result = handle();

    expect(tournamentStore.getState().document?.phase).toBe('QUALIFYING');

    act(() => {
      result.current.advance();
    });

    expect(tournamentStore.getState().document?.phase).toBe('ELIMINATION');
    expect(result.current.phase).toBe('ELIMINATION');
    expect(result.current.step?.blockers).toEqual(['FIELD_TOO_LARGE']);
  });

  it('hands over the rounds already played', () => {
    opened(qualified(64));
    const result = handle();

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]?.summary.winners).toHaveLength(32);
  });

  /* Staging a round changes the picture and nothing else: the round that is
   * running carries on underneath it (golden rule 3). */
  it('puts a round of the history on the projector without touching the tournament', () => {
    const document = qualified(64);
    opened(document);
    const result = handle();
    const before = tournamentStore.getState().document;
    const roundId = openRound(document).id;

    act(() => {
      result.current.showRoundOnBeamer(roundId);
    });

    expect(tournamentStore.getState().scene).toEqual({ id: 'ROUND_BOARD', roundId });
    expect(tournamentStore.getState().document).toBe(before);
  });
});
