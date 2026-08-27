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

  it('runs the round through to a winner', () => {
    opened(qualified());
    const { result } = handle();

    act(() => {
      result.current.start();
    });

    // 8 in it: 4, then 2, then 1.
    for (let round = 0; round < 3; round += 1) {
      act(() => {
        result.current.draw();
      });
      for (const match of result.current.summary?.round?.matches ?? []) {
        if (match.b !== null) {
          const winner = match.a;
          act(() => {
            result.current.setWinner(match.id, winner);
          });
        }
      }
      act(() => {
        result.current.close();
      });
    }

    expect(result.current.summary?.state).toBe('FINISHED');
    expect(result.current.summary?.winner).not.toBeNull();
    expect(result.current.canDraw).toBe(false);
    // The board says why, rather than offering a draw that would refuse.
    expect(result.current.drawBlockers).toContain('TOO_FEW_GROUPS');
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
