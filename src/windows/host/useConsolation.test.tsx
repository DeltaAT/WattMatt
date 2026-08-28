// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { consolationGroups, currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useConsolation, type ConsolationHandle } from '@/windows/host/useConsolation';
import { usePhase, type PhaseHandle } from '@/windows/host/usePhase';

/**
 * The wire between the `Trostrunde` panel and the store (issue #73,
 * docs/TOURNAMENT-RULES.md §10).
 *
 * The store is the real one: what is checked is that a click reaches it, that
 * the panel redraws when it does, and that the panel is simply not on screen
 * for the tournaments the side event does not apply to — which is every one
 * whose host declines it, and every one before the `Hoffnungsrunde` closes.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** 16 groups through the qualifying round: 8 through, 8 in the loser pool. */
function qualified(groups = 16, tables = 4): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => `Runde ${index}` });
  let decided = drawn;
  for (const match of currentRound(drawn)?.matches ?? []) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

function opened(document: Tournament) {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, document, PATH);
}

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

function handle(): { result: { current: ConsolationHandle } } {
  return renderHook(() => useConsolation());
}

/**
 * Both halves of the side event's panel at once (issue #91).
 *
 * The `Trostrunde` runs the whole pipeline, so its board and the step out of
 * its phase are two hooks rather than one — the same pair the main field has,
 * with the track set the other way. Rendered together because that is how the
 * host reads them: the round is closed, and the step underneath it says what
 * follows.
 */
function pair(): { result: { current: { consolation: ConsolationHandle; phase: PhaseHandle } } } {
  return renderHook(() => ({
    consolation: useConsolation(),
    phase: usePhase('CONSOLATION'),
  }));
}

/** Draws the open side-event round, decides every pairing, and closes it. */
function playOneRound(result: { current: { consolation: ConsolationHandle } }): void {
  act(() => {
    result.current.consolation.draw();
  });
  for (const match of result.current.consolation.summary?.round?.matches ?? []) {
    if (match.b !== null) {
      const winner = match.a;
      act(() => {
        result.current.consolation.setWinner(match.id, winner);
      });
    }
  }
  act(() => {
    result.current.consolation.close();
  });
}

const documentOf = (): Tournament => {
  const document = tournamentStore.getState().document;
  if (document === null) {
    throw new Error('no tournament open');
  }
  return document;
};

describe('useConsolation', () => {
  it('is silent with no tournament open', () => {
    const { result } = handle();

    expect(result.current.isActive).toBe(false);
    expect(result.current.summary).toBeNull();
  });

  it('is silent while the qualifying round is still open', () => {
    opened(
      drawRound(
        tournament({
          phase: 'QUALIFYING',
          groups: Array.from({ length: 8 }, (_unused, index) => group(index + 1)),
          tables: [table(1)],
        }),
        { at: FIXED_NOW, label: (index) => `Runde ${index}` },
      ),
    );

    expect(handle().result.current.isActive).toBe(false);
  });

  it('puts the question once the loser pool is settled', () => {
    opened(qualified());
    const { result } = handle();

    expect(result.current.isActive).toBe(true);
    expect(result.current.isOffered).toBe(true);
    expect(result.current.fieldSize).toBe(8);
    expect(result.current.blockers).toEqual([]);
  });

  it('starts the side event and redraws', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.start();
    });

    expect(result.current.isOffered).toBe(false);
    expect(result.current.summary?.state).toBe('RUNNING');
    expect(result.current.summary?.standing).toHaveLength(8);
    expect(consolationGroups(documentOf())).toHaveLength(8);
  });

  /*
   * A declined side event leaves nothing on screen: the panel would otherwise
   * spend the rest of the evening explaining a decision the host has made
   * (issue #21 makes the same argument about the `Hoffnungsrunde`).
   */
  it('goes away entirely when the host declines', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.decline();
    });

    expect(result.current.isActive).toBe(false);
    expect(result.current.summary).toBeNull();
  });

  it('draws on the CONSOLATION track and leaves the main field alone', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.draw();
    });

    expect(result.current.summary?.round?.track).toBe('CONSOLATION');
    expect(currentRound(documentOf(), 'MAIN')).toBeNull();
    expect(result.current.canClose).toBe(false);
  });

  it('puts its own round on the projector, not the main field’s', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.start();
    });
    act(() => {
      result.current.draw();
    });
    const roundId = result.current.summary?.round?.id;

    act(() => {
      result.current.showOnBeamer();
    });

    expect(tournamentStore.getState().scene).toEqual({ id: 'ROUND_BOARD', roundId });
  });

  /*
   * What changed with issue #91: the side event no longer plays itself down to
   * one group by repeating rounds. It runs the *same* pipeline as the main
   * field, so a round that leaves a field small enough hands over to its own
   * tree rather than dealing again — and the step out of the phase names that
   * tree, never `NAMING`, because the `Trostrunde` is numbers from start to
   * finish (§10).
   */
  it('hands its field to its own bracket instead of dealing another round', () => {
    opened(qualified());
    const { result } = pair();

    act(() => {
      result.current.consolation.start();
    });
    playOneRound(result);

    // Eight went in, four came out, and four is already the tree.
    expect(consolationGroups(documentOf())).toHaveLength(4);
    expect(result.current.consolation.canDraw).toBe(false);
    expect(result.current.phase.step?.to).toBe('BRACKET');
    expect(result.current.phase.step?.canAdvance).toBe(true);

    act(() => {
      result.current.phase.advance();
    });

    expect(result.current.phase.phase).toBe('BRACKET');
    // Still running: the winner is one the tree decides, not the close.
    expect(result.current.consolation.summary?.state).toBe('RUNNING');
  });

  /*
   * The smallest side event there is: two groups, whose single match *is* the
   * `Finale`. It takes the same route the main field takes at two participants
   * — no qualifying round to draw, because there is nothing to qualify for —
   * so the panel offers no draw at all and the step goes straight to the tree
   * (§9 case 5, docs/OPEN-QUESTIONS.md entry 101).
   */
  it('offers no round at all for a field of two and goes straight to the tree', () => {
    opened(qualified(4, 2));
    const { result } = pair();

    expect(result.current.consolation.fieldSize).toBe(2);
    act(() => {
      result.current.consolation.start();
    });

    // The board says why, rather than offering a draw that would refuse.
    expect(result.current.consolation.canDraw).toBe(false);
    expect(result.current.consolation.drawBlockers).toContain('FINAL_PHASE_REACHED');
    expect(result.current.phase.step?.to).toBe('BRACKET');
    expect(result.current.phase.step?.canAdvance).toBe(true);
  });

  it('previews without spending the RNG cursor', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.start();
    });
    const cursor = documentOf().rngCursor;

    const forced = result.current.previewDraw();

    expect(forced).toEqual([]);
    expect(documentOf().rngCursor).toBe(cursor);
  });
});
