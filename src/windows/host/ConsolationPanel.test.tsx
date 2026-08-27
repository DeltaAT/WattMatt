// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  closeConsolationRound,
  consolationSummary,
  drawConsolationRound,
  startConsolation,
  type ConsolationSummary,
} from '@/domain/consolation';
import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { roundBoard, roundSummary } from '@/domain/round';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { ConsolationPanel } from '@/windows/host/ConsolationPanel';

/**
 * The `Trostrunde` panel (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * The rules are tested in `@/domain/consolation`; what is checked here is what
 * the host experiences. Three things matter and all three are about a host
 * running two tournaments at once in front of an audience: the question is put
 * once and both answers are reachable, the board is the same board they read
 * for the main field, and the panel never claims the side event is a way back
 * into it.
 */

afterEach(cleanup);

/** 16 groups through the qualifying round: 8 through, 8 in the loser pool. */
function afterQualifying(tables = 4): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: 16 }, (_unused, index) => group(index + 1)),
    nextGroupNumber: 17,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => de.round.title({ n: index }) });
  let decided = drawn;
  for (const match of currentRound(drawn)?.matches ?? []) {
    if (match.b !== null) {
      decided = setWinner(decided, match.id, match.a);
    }
  }
  return closeRound(decided);
}

/** The panel with every callback stubbed, over the tournament as it stands. */
function renderPanel(document: Tournament, isOffered: boolean, overrides = {}) {
  const summary: ConsolationSummary | null = consolationSummary(document);
  const round = summary?.round ?? null;
  const handlers = {
    onStart: vi.fn(),
    onDecline: vi.fn(),
    onPreviewDraw: vi.fn(() => [] as const),
    onDraw: vi.fn(),
    onSetWinner: vi.fn(),
    onStartNext: vi.fn(),
    onClose: vi.fn(),
    onShowOnBeamer: vi.fn(),
    ...overrides,
  };

  render(
    <ConsolationPanel
      isOffered={isOffered}
      fieldSize={8}
      blockers={[]}
      summary={summary}
      board={round === null ? null : roundBoard(document, round)}
      roundSummary={round === null ? null : roundSummary(round)}
      groups={document.groups}
      participant="GROUP"
      now={FIXED_NOW}
      drawBlockers={[]}
      canDraw
      closeBlockers={[]}
      canClose={false}
      undecided={0}
      rematches={new Set()}
      {...handlers}
    />,
  );

  return handlers;
}

describe('the question', () => {
  it('puts both answers in front of the host', () => {
    renderPanel(afterQualifying(), true);

    expect(screen.getByText(de.consolation.offerTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: de.consolation.start })).toBeTruthy();
    expect(screen.getByRole('button', { name: de.consolation.decline })).toBeTruthy();
  });

  /*
   * The sentence a host reads out. Getting this wrong is a host announcing a
   * way back into the main field that does not exist (§10), which is a
   * correction made in front of fifty people.
   */
  it('says how many are in it and that its winner does not come back', () => {
    renderPanel(afterQualifying(), true);

    expect(screen.getByText(de.consolation.offer({ n: 8 }))).toBeTruthy();
  });

  it('starts the side event when the host says yes', () => {
    const handlers = renderPanel(afterQualifying(), true);

    fireEvent.click(screen.getByRole('button', { name: de.consolation.start }));

    expect(handlers.onStart).toHaveBeenCalledTimes(1);
    expect(handlers.onDecline).not.toHaveBeenCalled();
  });

  it('records the refusal when the host says no', () => {
    const handlers = renderPanel(afterQualifying(), true);

    fireEvent.click(screen.getByRole('button', { name: de.consolation.decline }));

    expect(handlers.onDecline).toHaveBeenCalledTimes(1);
  });

  it('is not on screen at all before the Hoffnungsrunde has closed', () => {
    const { container } = render(
      <ConsolationPanel
        isOffered={false}
        fieldSize={0}
        blockers={['REPECHAGE_OPEN']}
        summary={null}
        board={null}
        roundSummary={null}
        groups={[]}
        participant="GROUP"
        now={FIXED_NOW}
        drawBlockers={[]}
        canDraw={false}
        closeBlockers={[]}
        canClose={false}
        undecided={0}
        rematches={new Set()}
        onStart={vi.fn()}
        onDecline={vi.fn()}
        onPreviewDraw={vi.fn(() => null)}
        onDraw={vi.fn()}
        onSetWinner={vi.fn()}
        onStartNext={vi.fn()}
        onClose={vi.fn()}
        onShowOnBeamer={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe('the board', () => {
  function running(): Tournament {
    return startConsolation(afterQualifying());
  }

  it('offers the draw in the side event’s own words', () => {
    renderPanel(running(), false);

    expect(screen.getByRole('button', { name: de.consolation.draw })).toBeTruthy();
    expect(screen.getByRole('button', { name: de.consolation.showOnBeamer })).toBeTruthy();
    // Never the main field's, or the host has two identical buttons on screen.
    expect(screen.queryByRole('button', { name: de.draw.start })).toBeNull();
  });

  it('says how many are still in it', () => {
    renderPanel(running(), false);

    expect(screen.getByText(de.consolation.standing({ n: 8 }))).toBeTruthy();
  });

  it('draws when the host presses, with nothing to confirm', () => {
    const handlers = renderPanel(running(), false);

    fireEvent.click(screen.getByRole('button', { name: de.consolation.draw }));

    expect(handlers.onPreviewDraw).toHaveBeenCalledTimes(1);
    expect(handlers.onDraw).toHaveBeenCalledTimes(1);
  });

  it('draws the pairings of the open Trostrunde round', () => {
    const drawn = drawConsolationRound(running(), {
      at: FIXED_NOW,
      label: (index) => de.consolation.title({ n: index }),
    });

    renderPanel(drawn, false);

    expect(screen.getByText(de.consolation.title({ n: 1 }))).toBeTruthy();
    expect(screen.getByRole('button', { name: de.consolation.close })).toBeTruthy();
  });
});

describe('the winner', () => {
  /** The side event played all the way down to one group. */
  function decided(): Tournament {
    let next = startConsolation(afterQualifying());
    for (let round = 0; round < 3; round += 1) {
      next = drawConsolationRound(next, {
        at: FIXED_NOW,
        label: (index) => de.consolation.title({ n: index }),
      });
      const open = currentRound(next, 'CONSOLATION');
      for (const match of open?.matches ?? []) {
        if (match.b !== null) {
          next = setWinner(next, match.id, match.a);
        }
      }
      next = closeConsolationRound(next);
    }
    return next;
  }

  it('names the winner and repeats that it is not a way back', () => {
    const document = decided();
    const winner = consolationSummary(document)?.winner;
    expect(winner).toBeDefined();

    renderPanel(document, false);

    expect(
      screen.getByText(
        de.consolation.winner({
          participant: de.participant.GROUP.numbered({ n: winner?.number ?? 0 }),
        }),
      ),
    ).toBeTruthy();
    expect(screen.getByText(de.consolation.winnerHint)).toBeTruthy();
  });

  it('stops offering the standing count once there is a winner', () => {
    renderPanel(decided(), false);

    expect(screen.queryByText(de.consolation.standing({ n: 1 }))).toBeNull();
  });
});
