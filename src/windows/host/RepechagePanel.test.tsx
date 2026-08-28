// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import {
  acceptCandidate,
  declineCandidate,
  drawCandidate,
  repechageState,
  startRepechage,
  type RepechageState,
} from '@/domain/repechage';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import { RepechagePanel } from '@/windows/host/RepechagePanel';

/**
 * The repechage panel (issue #21).
 *
 * The rules are tested in `@/domain/repechage`; what is checked here is what
 * the host actually experiences, which is what the acceptance criteria are
 * written in terms of: two candidates can never be drawn at once, the two
 * answers are unmistakable and appear only when there is something to answer,
 * every disabled control says why in German, and the fallback is a decision
 * with two ways out rather than a dead end.
 */

afterEach(cleanup);

function qualified(groups: number, tables = 2): Tournament {
  const base = tournament({
    phase: 'QUALIFYING',
    groups: Array.from({ length: groups }, (_unused, index) => group(index + 1)),
    nextGroupNumber: groups + 1,
    tables: Array.from({ length: tables }, (_unused, index) => table(index + 1)),
    nextTableNumber: tables + 1,
  });

  const drawn = drawRound(base, { at: FIXED_NOW, label: (index) => de.round.title({ n: index }) });
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

function state(document: Tournament): RepechageState {
  const current = repechageState(document);
  if (current === null) {
    throw new Error('no repechage is running');
  }
  return current;
}

/** 13 groups: 7 winners, target 8, one place to fill from a pot of six. */
const started = () => startRepechage(qualified(13));

/** Draws and declines everybody, which empties the pot with a place open. */
function exhausted(): Tournament {
  let document = started();
  while (state(document).pool.length > 0 && state(document).need > 0) {
    document = declineCandidate(drawCandidate(document));
  }
  return document;
}

const NOTHING = {
  onStart: () => {},
  onDraw: () => {},
  onAccept: () => {},
  onDecline: () => {},
  onFallback: () => {},
  onShowOnBeamer: () => {},
};

/** The panel over a tournament, with the same reads `useRepechage` does. */
function panel(
  document: Tournament,
  overrides: Partial<Parameters<typeof RepechagePanel>[0]> = {},
) {
  const current = repechageState(document);
  return render(
    <RepechagePanel
      state={current}
      target={current?.target ?? 8}
      blockers={[]}
      canStart={current === null}
      canDraw={
        current !== null && current.pending === null && current.pool.length > 0 && current.need > 0
      }
      groups={document.groups}
      participant="GROUP"
      {...NOTHING}
      {...overrides}
    />,
  );
}

const action = (name: string) => document.querySelector(`[data-repechage-action="${name}"]`);

const dialogAction = (name: string) => document.querySelector(`[data-dialog-action="${name}"]`);

describe('before the phase is started', () => {
  it('explains what it is for, in the words the host will say out loud', () => {
    panel(qualified(13));

    expect(screen.getByText(de.repechage.intro({ target: 8 }))).toBeTruthy();
    expect(action('start')).toBeTruthy();
  });

  /*
   * The reason lives on the control the click was aimed at, for the pointer and
   * for a screen reader — the round panel and the pre-start panel do the same.
   */
  it('says why the start is doing nothing, on the button itself', () => {
    panel(qualified(13), { canStart: false, blockers: ['QUALIFYING_NOT_CLOSED'] });

    const start = action('start');
    expect(start?.getAttribute('aria-label')).toBe(
      de.repechage.blocked({ reason: de.repechage.qualifyingNotClosed }),
    );
    expect(screen.getByText(de.repechage.qualifyingNotClosed)).toBeTruthy();
  });

  it('offers nothing to answer and nothing to put on the beamer', () => {
    panel(qualified(13));

    expect(action('accept')).toBeNull();
    expect(action('decline')).toBeNull();
    expect(action('beamer')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('the running phase', () => {
  it('shows the target, the field and the places left', () => {
    panel(started());

    expect(screen.getByText(de.repechage.target({ n: 8 }))).toBeTruthy();
    expect(screen.getByText(de.repechage.field({ n: 7 }))).toBeTruthy();
    expect(screen.getByText(de.repechage.slotsLeft({ n: 1 }))).toBeTruthy();
  });

  it('draws a candidate on one click', () => {
    const onDraw = vi.fn();
    panel(started(), { onDraw });

    fireEvent.click(action('draw') as HTMLElement);

    expect(onDraw).toHaveBeenCalledTimes(1);
  });

  /**
   * Issue #21's first acceptance criterion: the host can never accidentally
   * draw two candidates at once. The engine refuses it as well — this is the
   * half of it the host can see, and the reason is on the button.
   */
  it('closes the draw while a candidate is waiting for an answer', () => {
    panel(drawCandidate(started()));

    const draw = action('draw');
    expect(draw?.hasAttribute('disabled')).toBe(true);
    expect(draw?.getAttribute('aria-label')).toBe(de.repechage.drawPending);
  });

  it('offers exactly two answers, named as verbs, while one is pending', () => {
    const drawn = drawCandidate(started());
    const candidate = state(drawn).pending;
    const onAccept = vi.fn();
    const onDecline = vi.fn();
    panel(drawn, { onAccept, onDecline });

    // The name the host reads out is on the screen, in the words this
    // tournament uses for a participant.
    const number = drawn.groups.find((one) => one.id === candidate)?.number ?? 0;
    expect(screen.getByText(de.participant.GROUP.numbered({ n: number }))).toBeTruthy();

    expect(action('accept')?.textContent).toBe(de.repechage.accept);
    expect(action('decline')?.textContent).toBe(de.repechage.decline);

    fireEvent.click(action('accept') as HTMLElement);
    fireEvent.click(action('decline') as HTMLElement);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('takes the answers away again once one is given', () => {
    panel(acceptCandidate(drawCandidate(started())));

    expect(action('accept')).toBeNull();
    expect(action('decline')).toBeNull();
  });

  it('says the field is full rather than counting down to nothing', () => {
    panel(acceptCandidate(drawCandidate(started())));

    expect(screen.getAllByText(de.repechage.slotsFilled).length).toBeGreaterThan(0);
    expect(screen.getByText(de.repechage.complete)).toBeTruthy();
    expect(action('draw')?.hasAttribute('disabled')).toBe(true);
  });

  it('lists who is through, who is still in the pot and who has declined', () => {
    const declined = declineCandidate(drawCandidate(started()));
    const current = state(declined);
    panel(declined);

    const list = (which: string) =>
      document.querySelectorAll(`[data-repechage-list="${which}"] [data-group-id]`);

    expect(list('through')).toHaveLength(current.through.length);
    expect(list('pool')).toHaveLength(current.pool.length);
    expect(list('declined')).toHaveLength(1);
  });

  it('puts the pot on the beamer on request', () => {
    const onShowOnBeamer = vi.fn();
    panel(started(), { onShowOnBeamer });

    fireEvent.click(action('beamer') as HTMLElement);

    expect(onShowOnBeamer).toHaveBeenCalledTimes(1);
  });
});

describe('the fallback dialog', () => {
  it('appears when the pot runs dry with a place still open', () => {
    panel(exhausted());

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(de.repechage.fallback.body({ n: 1 }))).toBeTruthy();
  });

  /**
   * Both answers spelt out, and both reachable. `Freilose vergeben` is offered
   * every single time, which is what makes the phase impossible to be stranded
   * in (issue #20's "every path terminates").
   */
  it('offers both of §4s answers, each explained', () => {
    const onFallback = vi.fn();
    panel(exhausted(), { onFallback });

    expect(screen.getByText(de.repechage.fallback.byesBody({ n: 1 }))).toBeTruthy();
    expect(screen.getByText(de.repechage.fallback.reopenBody({ n: 6 }))).toBeTruthy();

    fireEvent.click(screen.getByText(de.repechage.fallback.byes));
    fireEvent.click(screen.getByText(de.repechage.fallback.reopen));

    expect(onFallback).toHaveBeenNthCalledWith(1, 'BYES');
    expect(onFallback).toHaveBeenNthCalledWith(2, 'REOPEN_DECLINED');
  });

  /*
   * Nobody declined, so there is nothing to put back. The option is off with
   * the reason on it rather than absent: a host looking for the second answer
   * they were told about should find it, greyed out and explained.
   */
  it('greys out the readmission when nobody has declined', () => {
    // A pot that emptied without a single decline. The engine cannot reach it
    // from a 13-group field — the one place is taken by the first acceptance —
    // so the state is handed to the panel directly, which is exactly what a
    // presentational component is for.
    const filled = acceptCandidate(drawCandidate(started()));

    panel(filled, {
      state: {
        ...state(filled),
        need: 1,
        declined: [],
        pool: [],
        fallbackNeeded: true,
        complete: false,
      },
    });

    expect(screen.getByText(de.repechage.fallback.reopenNobody)).toBeTruthy();
    expect(dialogAction('reopen')?.hasAttribute('disabled')).toBe(true);
    // And the answer that always works is still there.
    expect(dialogAction('byes')?.hasAttribute('disabled')).toBe(false);
  });

  it('is absent while somebody is still in the pot', () => {
    panel(started());

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/*
 * The `Trostrunde` runs the same lottery on its own field (issue #91,
 * docs/TOURNAMENT-RULES.md §10). One panel for both, because a second copy is
 * where the two would come to disagree about what *Ja* means — but the two are
 * never allowed to look identical on screen, for two different reasons.
 */
describe('the side event’s own Hoffnungsrunde', () => {
  it('says which tournament’s places are being drawn', () => {
    panel(qualified(13), { track: 'CONSOLATION' });

    expect(screen.getByRole('region', { name: de.consolation.repechageLabel })).toBeTruthy();
    expect(screen.getByText(de.consolation.repechageLabel)).toBeTruthy();
  });

  /*
   * The one sentence that is only true here. In the main field, declining drops
   * a group into the `Trostrunde`; here it means going home, because there is
   * no second level and the structure stops recursing at one. The host has to
   * be able to say that out loud before anybody is drawn.
   */
  it('says out loud that declining this one means going home', () => {
    panel(qualified(13), { track: 'CONSOLATION' });

    expect(screen.getByText(de.consolation.repechageHint)).toBeTruthy();
  });

  it('leaves the main field’s panel exactly as it was', () => {
    panel(qualified(13));

    expect(screen.getByRole('region', { name: de.repechage.sectionLabel })).toBeTruthy();
    expect(screen.queryByText(de.consolation.repechageHint)).toBeNull();
  });
});
