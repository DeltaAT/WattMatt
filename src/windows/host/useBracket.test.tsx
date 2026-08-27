// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BracketNodeId, GroupId } from '@/domain/ids';
import { group, table, tableId, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useBracket, type BracketHandle } from '@/windows/host/useBracket';

/**
 * The wire between the bracket panel and the store (issue #26).
 *
 * The store is the real one: what is being checked is that a press reaches it,
 * that the panel redraws when it does, and that the two things the panel reads
 * *at click time* — what a correction would cost, and where the projector is
 * pointed — are read off the store rather than off a stale render.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** Four named participants on two tables, waiting for the tree to be drawn. */
function ready(): Tournament {
  return tournament({
    phase: 'NAMING',
    groups: Array.from({ length: 4 }, (_unused, index) =>
      group(index + 1, { name: `Team ${index + 1}` }),
    ),
    nextGroupNumber: 5,
    tables: [table(1), table(2)],
    nextTableNumber: 3,
  });
}

beforeEach(() => {
  closeDocument(tournamentStore);
  setOpenedDocument(tournamentStore, ready(), PATH);
});

afterEach(() => {
  cleanup();
  closeDocument(tournamentStore);
});

const mounted = () => renderHook<BracketHandle, void>(() => useBracket());

describe('the bracket handle', () => {
  it('is inert with no tournament open', () => {
    closeDocument(tournamentStore);

    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.bracket).toBeNull();
    expect(result.current.canDraw).toBe(false);
  });

  it('offers the draw from the naming phase, before there is a tree', () => {
    const { result } = mounted();

    expect(result.current.isActive).toBe(true);
    expect(result.current.bracket).toBeNull();
    expect(result.current.canDraw).toBe(true);
  });

  it('draws the tree and redraws the panel around it', () => {
    const { result } = mounted();

    act(() => {
      result.current.draw();
    });

    expect(result.current.bracket?.size).toBe(4);
    expect(result.current.columns.map((column) => column.round)).toEqual([
      'SEMI_FINAL',
      'THIRD_PLACE',
      'FINAL',
    ]);
    // Two semi-finals went straight onto the two tables.
    expect(result.current.playable).toBe(2);
    expect(result.current.freeTables).toHaveLength(0);
  });

  it('counts what the host could send to a table right now', () => {
    setOpenedDocument(tournamentStore, { ...ready(), tables: [table(1)] }, PATH);
    const { result } = mounted();

    act(() => {
      result.current.draw();
    });

    // One on the table, one waiting for one: both are matches the host is
    // working on, and neither is the final, which has nobody in it yet.
    expect(result.current.playable).toBe(2);
    expect(result.current.freeTables).toHaveLength(0);
  });

  it('marks a winner and lets the tree grow', () => {
    const { result } = mounted();
    act(() => {
      result.current.draw();
    });
    const semi = result.current.bracket?.nodes[0];

    act(() => {
      result.current.setWinner(semi?.id as BracketNodeId, semi?.slotA as GroupId);
    });

    expect(result.current.bracket?.nodes[0]?.winnerId).toBe(semi?.slotA);
    // The table it was on is free again, and the beaten semi-finalist is in the
    // third-place match — `bn_3`, which sits between the semi-finals and the
    // final in the tree's own order (docs/TOURNAMENT-RULES.md §7).
    expect(result.current.freeTables).toHaveLength(1);
    expect(result.current.bracket?.nodes[2]?.slotA).toBe(semi?.slotB);
  });

  it('answers what a correction would cost, off the store and not off a render', () => {
    const { result } = mounted();
    act(() => {
      result.current.draw();
    });
    const semi = result.current.bracket?.nodes[0];
    const other = result.current.bracket?.nodes[1];

    act(() => {
      result.current.setWinner(semi?.id as BracketNodeId, semi?.slotA as GroupId);
    });

    // Nothing has been built on it yet.
    expect(
      result.current.correctionFor(semi?.id as BracketNodeId, semi?.slotB as GroupId),
    ).toBeNull();

    act(() => {
      result.current.setWinner(other?.id as BracketNodeId, other?.slotA as GroupId);
      const final = tournamentStore.getState().document?.bracket?.nodes[3];
      result.current.setWinner(final?.id as BracketNodeId, final?.slotA as GroupId);
    });

    const correction = result.current.correctionFor(
      semi?.id as BracketNodeId,
      semi?.slotB as GroupId,
    );
    expect(correction?.discards.map((node) => node.round)).toEqual(['FINAL']);
  });

  it('sends a waiting match to a table by name', () => {
    // One table: the second semi-final is queued behind the first.
    setOpenedDocument(tournamentStore, { ...ready(), tables: [table(1)] }, PATH);
    const { result } = mounted();
    act(() => {
      result.current.draw();
    });
    const semi = result.current.bracket?.nodes[0];
    act(() => {
      result.current.setWinner(semi?.id as BracketNodeId, semi?.slotA as GroupId);
    });
    const second = result.current.bracket?.nodes[1];
    expect(second?.tableId).toBeNull();

    act(() => {
      result.current.assign(second?.id as BracketNodeId, tableId(1));
    });

    expect(result.current.bracket?.nodes[1]?.tableId).toBe(tableId(1));
  });

  it('reads the zoom back off the staged scene', () => {
    const { result } = mounted();
    act(() => {
      result.current.draw();
    });

    expect(result.current.focus).toBeNull();

    act(() => {
      result.current.showOnBeamer('FINAL');
    });

    expect(result.current.focus).toBe('FINAL');
    expect(tournamentStore.getState().scene).toEqual({ id: 'BRACKET', focus: 'FINAL' });
  });

  it('offers Finale abschließen only once the tree is over', () => {
    const { result } = mounted();
    act(() => {
      result.current.draw();
    });
    expect(result.current.canFinish).toBe(false);

    act(() => {
      for (const node of result.current.bracket?.nodes ?? []) {
        if (node.round === 'SEMI_FINAL') {
          result.current.setWinner(node.id, node.slotA as GroupId);
        }
      }
    });
    act(() => {
      for (const node of result.current.bracket?.nodes ?? []) {
        if (node.round === 'FINAL' || node.round === 'THIRD_PLACE') {
          result.current.setWinner(node.id, node.slotA as GroupId);
        }
      }
    });

    expect(result.current.canFinish).toBe(true);

    act(() => {
      result.current.finish();
    });

    expect(tournamentStore.getState().document?.phase).toBe('CEREMONY');
    // The finished tree stays on the panel through the ceremony.
    expect(result.current.isActive).toBe(true);
  });
});

/*
 * docs/TOURNAMENT-RULES.md §8: the podium is revealed bronze → silver → gold on
 * the host's timing. The button used to send step 0 on every press, so the
 * second press put the room back at bronze — the host's half of "the reveal
 * does nothing" (issue #69).
 */
describe('stepping through the Siegerehrung', () => {
  function ceremony(result: { current: BracketHandle }): void {
    act(() => {
      result.current.draw();
    });
    act(() => {
      for (const node of result.current.bracket?.nodes ?? []) {
        if (node.round === 'SEMI_FINAL') {
          result.current.setWinner(node.id, node.slotA as GroupId);
        }
      }
    });
    act(() => {
      for (const node of result.current.bracket?.nodes ?? []) {
        if (node.round === 'FINAL' || node.round === 'THIRD_PLACE') {
          result.current.setWinner(node.id, node.slotA as GroupId);
        }
      }
    });
    act(() => {
      result.current.finish();
    });
  }

  const staged = () => tournamentStore.getState().scene;

  it('advances one place per press and stops at gold', () => {
    const { result } = mounted();
    ceremony(result);

    for (const step of [0, 1, 2]) {
      act(() => {
        result.current.showCeremonyStep();
      });
      expect(staged()).toEqual({ id: 'CEREMONY', reveal: { mode: 'STEP', step } });
    }

    const settled = tournamentStore.getState().revision;
    act(() => {
      result.current.showCeremonyStep();
    });

    // The podium is complete: nothing to show, and nothing to put on the undo
    // stack for a press that changes no picture.
    expect(staged()).toEqual({ id: 'CEREMONY', reveal: { mode: 'STEP', step: 2 } });
    expect(tournamentStore.getState().revision).toBe(settled);
  });

  it('takes over from the automatic reveal at the place it had reached', () => {
    const { result } = mounted();
    ceremony(result);

    act(() => {
      result.current.showCeremony('AUTO', 0);
    });
    act(() => {
      result.current.showCeremonyStep();
    });

    expect(staged()).toEqual({ id: 'CEREMONY', reveal: { mode: 'STEP', step: 1 } });
  });
});
