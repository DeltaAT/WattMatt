// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { closeDocument, setOpenedDocument } from '@/store/actions/document';
import { tournamentStore } from '@/store/session';
import { useRound, type RoundHandle } from '@/windows/host/useRound';

/**
 * The wire between the round panel and the store (issue #17).
 *
 * The store is the real one: what is being checked is that a click reaches it,
 * that the panel redraws when it does, and that the beamer is pointed at the
 * round the host is actually working in — the projector and the laptop
 * disagreeing about that is the failure golden rule 4 exists to prevent.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

/** Six participants on two tables, started and waiting for its first draw. */
function ready(): Tournament {
  return tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: 6 }, (_unused, index) => group(index + 1)),
    nextGroupNumber: 7,
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

const mounted = () => renderHook<RoundHandle, void>(() => useRound());

describe('the round handle', () => {
  it('has no round before the first draw, and says the draw is possible', () => {
    const { result } = mounted();

    expect(result.current.isActive).toBe(true);
    expect(result.current.round).toBeNull();
    expect(result.current.board).toBeNull();
    expect(result.current.canDraw).toBe(true);
    expect(result.current.drawBlockers).toEqual([]);
  });

  it('is inactive while the tournament is still being set up', () => {
    closeDocument(tournamentStore);
    setOpenedDocument(tournamentStore, tournament({ groups: [group(1), group(2)] }), PATH);

    // `SETUP` is the pre-start panel's screen: a round header over nothing is
    // not something the host has any use for.
    expect(mounted().result.current.isActive).toBe(false);
  });

  it('draws a round and redraws the board with it', () => {
    const { result } = mounted();

    act(() => result.current.draw());

    expect(result.current.round?.label).toBe(de.round.title({ n: 1 }));
    expect(result.current.board?.progress.total).toBe(3);
    expect(result.current.board?.tables).toHaveLength(2);
    expect(result.current.canDraw).toBe(false);
    expect(result.current.drawBlockers).toContain('ROUND_OPEN');
  });

  it('puts the draw on the beamer in the same step', () => {
    const { result } = mounted();

    act(() => result.current.draw());

    expect(tournamentStore.getState().scene).toEqual({
      id: 'DRAW',
      roundId: result.current.round?.id,
    });
  });

  it('sets a winner, frees the table and moves the summary on', () => {
    const { result } = mounted();
    act(() => result.current.draw());

    const first = result.current.round?.matches[0];
    if (first === undefined) {
      throw new Error('nothing was drawn');
    }
    act(() => result.current.setWinner(first.id, first.a));

    expect(result.current.summary?.winners).toEqual([first.a]);
    expect(result.current.summary?.losers).toEqual([first.b]);
    expect(result.current.board?.progress).toEqual({ decided: 1, open: 2, total: 3 });
    expect(result.current.board?.tables[0]?.match).toBeNull();
  });

  it('refuses to close the round until every match is decided', () => {
    const { result } = mounted();
    act(() => result.current.draw());

    expect(result.current.canClose).toBe(false);
    expect(result.current.undecided).toBe(3);

    const matches = result.current.round?.matches ?? [];
    for (const each of matches) {
      act(() => result.current.setWinner(each.id, each.a));
    }

    expect(result.current.canClose).toBe(true);
    act(() => result.current.close());

    expect(result.current.round).toBeNull();
    expect(result.current.canDraw).toBe(false);
    // The qualifying round is round 1, singular (docs/TOURNAMENT-RULES.md §3).
    expect(result.current.drawBlockers).toContain('QUALIFYING_ALREADY_DRAWN');
  });

  it('hands a table that has come free the next waiting pair', () => {
    // Six participants on one table: two pairs are waiting from the first
    // second (docs/TOURNAMENT-RULES.md §3).
    closeDocument(tournamentStore);
    setOpenedDocument(
      tournamentStore,
      tournament({
        phase: 'QUALIFYING',
        groups: Array.from({ length: 6 }, (_unused, index) => group(index + 1)),
        nextGroupNumber: 7,
        tables: [table(1)],
        nextTableNumber: 2,
      }),
      PATH,
    );

    const { result } = mounted();
    act(() => result.current.draw());
    const running = result.current.board?.tables[0]?.match;
    const waiting = result.current.board?.queued[0];
    if (running === undefined || running === null || waiting === undefined) {
      throw new Error('nothing was drawn');
    }

    act(() => result.current.setWinner(running.id, running.a));
    expect(result.current.board?.queued).toHaveLength(2);

    act(() => result.current.startNext(table(1).id));

    expect(result.current.board?.tables[0]?.match?.id).toBe(waiting.id);
    expect(result.current.board?.queued).toHaveLength(1);
  });

  it('stages the open round on the beamer, and nothing when there is none', () => {
    const { result } = mounted();

    // No round yet: the button is disabled in the panel, and a click that
    // arrived anyway must not point the projector at a round that is not there.
    const before = tournamentStore.getState().scene;
    act(() => result.current.showOnBeamer());
    expect(tournamentStore.getState().scene).toEqual(before);

    act(() => result.current.draw());
    act(() => result.current.showOnBeamer());

    expect(tournamentStore.getState().scene).toEqual({
      id: 'ROUND_BOARD',
      roundId: result.current.round?.id,
    });
  });

  it('reads nothing at all with no tournament open', () => {
    closeDocument(tournamentStore);
    const { result } = mounted();

    expect(result.current.isActive).toBe(false);
    expect(result.current.round).toBeNull();
    expect(result.current.canDraw).toBe(false);
    expect(result.current.canClose).toBe(false);

    // Every callback is safe to call: a click can arrive after the host closed
    // the tournament, and it has to cost nothing.
    expect(() => {
      act(() => result.current.draw());
      act(() => result.current.close());
      act(() => result.current.showOnBeamer());
      act(() => result.current.startNext(table(1).id));
    }).not.toThrow();
  });
});
