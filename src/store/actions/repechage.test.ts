import { describe, expect, it } from 'vitest';

import { closeRound, drawRound, setWinner } from '@/domain/draw';
import { repechageState, startRepechage as startInDomain } from '@/domain/repechage';
import { currentRound } from '@/domain/selectors';
import { FIXED_NOW, group, table, tournament } from '@/domain/testFixtures';
import type { Round, Tournament } from '@/domain/types';
import { de } from '@/i18n';
import {
  acceptRepechageCandidate,
  declineRepechageCandidate,
  drawRepechageCandidate,
  startRepechage,
  useRepechageFallback,
} from '@/store/actions/repechage';
import {
  createTournamentStore,
  INITIAL_TOURNAMENT_STATE,
  type TournamentStore,
} from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The repechage actions (issue #21).
 *
 * The rules are `@/domain/repechage`'s and are tested there. What is checked
 * here is what an action adds: the German step the undo button reads, the audit
 * entry the file keeps, the beamer picture that travels with the start, and the
 * two things `change` refuses to do — commit with no tournament open, and
 * commit a change that changed nothing.
 */

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

/** A store holding a 13-group tournament: target 8, one place to fill. */
function ready(document: Tournament = qualified(13)): TournamentStore {
  const store = createTournamentStore();
  store.commit(() => ({ document }));
  return store;
}

function open(store: TournamentStore): Tournament {
  const document = store.getState().document;
  if (document === null) {
    throw new Error('no tournament is open');
  }
  return document;
}

const pending = (store: TournamentStore) => repechageState(open(store))?.pending ?? null;

const lastLog = (store: TournamentStore) => open(store).log.at(-1);

/** What the host would call the group, for the undo labels below. */
function named(store: TournamentStore, groupId: string | null): string {
  const found = open(store).groups.find((candidate) => candidate.id === groupId);
  return found?.name ?? de.participant.GROUP.numbered({ n: found?.number ?? 0 });
}

describe('startRepechage', () => {
  it('opens the phase, shuffles the pot and puts it on the projector', () => {
    const store = ready();

    startRepechage(store);

    const document = open(store);
    expect(document.phase).toBe('REPECHAGE');
    expect(document.repechage?.target).toBe(8);
    expect(store.getState().scene).toEqual({ id: 'REPECHAGE' });
  });

  /*
   * One commit, so the pot and the picture cannot be undone apart: a projector
   * showing a phase that no longer exists is exactly what golden rule 4 is
   * about.
   */
  it('takes the picture back with the pot in one step', () => {
    const store = ready();

    startRepechage(store);
    store.undo();

    expect(open(store).repechage).toBeNull();
    expect(open(store).phase).toBe('QUALIFYING');
    expect(store.getState().scene).not.toEqual({ id: 'REPECHAGE' });
  });

  it('names itself on the undo stack and records the pot it dealt', () => {
    const store = ready();

    startRepechage(store);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.repechageStarted);
    expect(lastLog(store)).toMatchObject({
      action: 'REPECHAGE_STARTED',
      payload: { target: 8, rngCursor: open(store).rngCursor },
    });
    // The pot in the order it was dealt: without it the draw cannot be
    // reproduced a week later (CLAUDE.md golden rule 7).
    expect(lastLog(store)?.payload['pool']).toEqual(open(store).repechage?.pool);
  });

  /*
   * The one moment worth losing nothing over: the cursor has moved, so a crash
   * that lost the shuffle would deal the room a different pot than the one it
   * has been shown.
   */
  it('asks for an immediate save', () => {
    const store = ready();
    let urgent = false;
    store.onCommit((_state, meta) => {
      urgent = meta.urgent;
    });

    startRepechage(store);

    expect(urgent).toBe(true);
  });

  it('does nothing at all for a field that skips the phase', () => {
    const store = ready(qualified(16));
    const before = store.getState();

    startRepechage(store);

    expect(store.getState()).toBe(before);
  });

  it('does nothing with no tournament open', () => {
    const store = createTournamentStore();

    startRepechage(store);

    expect(store.getState()).toEqual(INITIAL_TOURNAMENT_STATE);
  });
});

describe('drawRepechageCandidate', () => {
  it('takes a candidate out of the pot and names them on the undo stack', () => {
    const store = ready(startInDomain(qualified(13)));

    drawRepechageCandidate(store);

    const candidate = pending(store);
    expect(candidate).not.toBeNull();
    expect(nextUndo(store.getState().history)?.label).toBe(
      de.undo.action.repechageCandidateDrawn({ participant: named(store, candidate) }),
    );
    expect(lastLog(store)).toMatchObject({
      action: 'REPECHAGE_CANDIDATE_DRAWN',
      payload: { groupId: candidate },
    });
  });

  /*
   * Issue #21's first acceptance criterion, below the button rather than on it:
   * the panel disables the control, and this is what makes a click that arrived
   * anyway — a double-click, a stale render — cost nothing.
   */
  it('refuses a second candidate while the first is unanswered', () => {
    const store = ready(startInDomain(qualified(13)));

    drawRepechageCandidate(store);
    const afterFirst = store.getState();
    drawRepechageCandidate(store);

    expect(store.getState()).toBe(afterFirst);
  });

  it('records how many were still in the pot behind them', () => {
    const store = ready(startInDomain(qualified(13)));

    drawRepechageCandidate(store);

    expect(lastLog(store)?.payload['remaining']).toBe(open(store).repechage?.pool.length);
  });
});

describe('accepting and declining', () => {
  it('puts an accepted candidate back into the tournament', () => {
    const store = ready(startInDomain(qualified(13)));
    drawRepechageCandidate(store);
    const candidate = pending(store);

    acceptRepechageCandidate(store);

    expect(open(store).groups.find((one) => one.id === candidate)?.status).toBe('ACTIVE');
    expect(repechageState(open(store))?.through).toContain(candidate);
  });

  /*
   * The label is read off the tournament from *before* the answer: afterwards
   * nothing is pending, and the participant the host is about to un-decide is
   * the whole point of naming the step (issue #11).
   */
  it('names the participant the answer was about, both ways', () => {
    const accept = ready(startInDomain(qualified(13)));
    drawRepechageCandidate(accept);
    const accepted = named(accept, pending(accept));
    acceptRepechageCandidate(accept);

    const decline = ready(startInDomain(qualified(13)));
    drawRepechageCandidate(decline);
    const declined = named(decline, pending(decline));
    declineRepechageCandidate(decline);

    expect(nextUndo(accept.getState().history)?.label).toBe(
      de.undo.action.repechageAccepted({ participant: accepted }),
    );
    expect(nextUndo(decline.getState().history)?.label).toBe(
      de.undo.action.repechageDeclined({ participant: declined }),
    );
  });

  it('logs the answer with the group it was about', () => {
    const store = ready(startInDomain(qualified(13)));
    drawRepechageCandidate(store);
    const candidate = pending(store);

    declineRepechageCandidate(store);

    expect(lastLog(store)).toMatchObject({
      action: 'REPECHAGE_ANSWERED',
      payload: { groupId: candidate, accepted: false },
    });
  });

  /**
   * Undo of an accept has to put back *both* halves — the draw record and the
   * group's status — or the next round pairs somebody the room watched come
   * back (issue #21, CLAUDE.md §7).
   */
  it('rewinds an accept completely', () => {
    const store = ready(startInDomain(qualified(13)));
    drawRepechageCandidate(store);
    const candidate = pending(store);
    const before = open(store);

    acceptRepechageCandidate(store);
    store.undo();

    // Everything but the log, which is append-only by design: the undo itself
    // is a line in it (docs/FILE-FORMAT.md rule 6).
    expect({ ...open(store), log: [] }).toEqual({ ...before, log: [] });
    expect(open(store).groups.find((one) => one.id === candidate)?.status).toBe('ELIMINATED');
    expect(repechageState(open(store))?.pending).toBe(candidate);
  });

  it('does nothing when no candidate is waiting for an answer', () => {
    const store = ready(startInDomain(qualified(13)));
    const before = store.getState();

    acceptRepechageCandidate(store);
    declineRepechageCandidate(store);

    expect(store.getState()).toBe(before);
  });
});

describe('the fallback', () => {
  /** Draws and declines everybody, which is what empties the pot. */
  function exhausted(): TournamentStore {
    const store = ready(startInDomain(qualified(13)));
    while ((repechageState(open(store))?.pool.length ?? 0) > 0) {
      drawRepechageCandidate(store);
      declineRepechageCandidate(store);
    }
    return store;
  }

  it('hands out the Freilose and says so on the undo stack', () => {
    const store = exhausted();

    useRepechageFallback(store, 'BYES');

    expect(repechageState(open(store))).toMatchObject({ byes: 1, need: 0, complete: true });
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.repechageByes);
  });

  /* §4: "this situation is logged prominently". */
  it('logs which answer was taken and how many places it was about', () => {
    const store = exhausted();

    useRepechageFallback(store, 'BYES');

    expect(lastLog(store)).toMatchObject({
      action: 'REPECHAGE_FALLBACK',
      payload: { choice: 'BYES', need: 1 },
    });
  });

  it('puts the declined back into the pot and records who came back', () => {
    const store = exhausted();
    const declined = repechageState(open(store))?.declined ?? [];

    useRepechageFallback(store, 'REOPEN_DECLINED');

    expect(open(store).repechage?.pool).toHaveLength(declined.length);
    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.repechageReopened);
    expect(lastLog(store)?.payload['reopened']).toEqual(open(store).repechage?.pool);
  });

  it('does nothing while there is still somebody in the pot', () => {
    const store = ready(startInDomain(qualified(13)));
    const before = store.getState();

    useRepechageFallback(store, 'BYES');

    expect(store.getState()).toBe(before);
  });
});
