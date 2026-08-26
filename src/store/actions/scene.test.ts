import { describe, expect, it } from 'vitest';

import { round, roundId, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { setOpenedDocument } from '@/store/actions/document';
import {
  blackout,
  setAutoFollow,
  setFrozen,
  showScene,
  skipAnimation,
} from '@/store/actions/scene';
import { createTournamentStore, INITIAL_TOURNAMENT_STATE } from '@/store/tournamentStore';
import { nextUndo } from '@/store/undo';

/**
 * The actions behind the beamer control centre (issue #28).
 *
 * What each of them costs matters as much as what it does: a blackout must not
 * rewrite the tournament, and a freeze must not consume the undo step the host
 * is keeping for the result they got wrong.
 */

const PATH = 'C:\\Turniere\\Sommer.wattmatt';

function opened(phase: Parameters<typeof tournament>[0] = {}) {
  const store = createTournamentStore({ ...INITIAL_TOURNAMENT_STATE });
  setOpenedDocument(store, tournament(phase), PATH);
  return store;
}

describe('taking the beamer by hand', () => {
  it('stages the scene and turns auto-follow off in the same commit', () => {
    const store = opened();

    showScene(store, { id: 'TABLE_OVERVIEW' });

    expect(store.getState().scene).toEqual({ id: 'TABLE_OVERVIEW' });
    // Manual control always wins, and stays won until the host says otherwise
    // (golden rule 3) — the issue's "sticky until the host releases it".
    expect(store.getState().autoFollow).toBe(false);
  });

  it('leaves the picture alone when auto-follow is switched off', () => {
    const store = opened();
    showScene(store, { id: 'TABLE_OVERVIEW' });
    setAutoFollow(store, true);
    const staged = store.getState().scene;

    setAutoFollow(store, false);

    // Taking manual control is not a request for a different scene, it is a
    // request for this one to stop moving.
    expect(store.getState().scene).toEqual(staged);
  });

  it('hands the beamer back to the phase the moment auto-follow goes on', () => {
    const store = opened({ phase: 'QUALIFYING', rounds: [round(1, { state: 'RUNNING' })] });
    showScene(store, { id: 'TABLE_OVERVIEW' });

    setAutoFollow(store, true);

    // Not "leave it and wait for something to change": the host presses this
    // precisely because the wall is wrong right now.
    expect(store.getState().scene).toEqual({ id: 'ROUND_BOARD', roundId: roundId(1) });
    expect(store.getState().autoFollow).toBe(true);
  });

  it('never rewrites the tournament for a scene change', () => {
    const store = opened();
    const before = store.getState();

    blackout(store);

    // The one action that must never queue behind sixty-four groups of data
    // (docs/FILE-FORMAT.md rule 6): no document, no log entry, no dirty file.
    expect(store.getState().document).toBe(before.document);
    expect(store.getState().documentRevision).toBe(before.documentRevision);
    expect(store.getState().document?.log).toEqual(before.document?.log);
    expect(store.getState().file).toEqual(before.file);
  });

  it('names the blackout on the undo button rather than calling it a scene change', () => {
    const store = opened();

    blackout(store);

    expect(nextUndo(store.getState().history)?.label).toBe(de.undo.action.blackout);
  });
});

describe('freezing the picture', () => {
  it('is a hold the host puts on and takes off again', () => {
    const store = opened();

    setFrozen(store, true);
    expect(store.getState().frozen).toBe(true);

    setFrozen(store, false);
    expect(store.getState().frozen).toBe(false);
  });

  /*
   * docs/OPEN-QUESTIONS.md #75. Undoing a misclicked result three panels away
   * must not also whip the cover off a screen the host is working behind.
   */
  it('does not land on the undo stack', () => {
    const store = opened();
    showScene(store, { id: 'BRACKET' });
    const step = nextUndo(store.getState().history);

    setFrozen(store, true);

    expect(nextUndo(store.getState().history)).toBe(step);
  });

  it('leaves the tournament and the file exactly where they were', () => {
    const store = opened();
    const before = store.getState();

    setFrozen(store, true);

    expect(store.getState().document).toBe(before.document);
    expect(store.getState().file).toEqual(before.file);
  });
});

describe('skipping a running sequence', () => {
  it('moves a counter forward rather than sending a command', () => {
    const store = opened();

    skipAnimation(store);
    skipAnimation(store);

    // Monotonic, so the beamer skips once per press and a re-delivered
    // snapshot skips nothing at all (docs/OPEN-QUESTIONS.md #53).
    expect(store.getState().skipToken).toBe(2);
  });

  it('changes neither the staged scene nor the undo stack', () => {
    const store = opened();
    showScene(store, { id: 'BRACKET' });
    const step = nextUndo(store.getState().history);

    skipAnimation(store);

    expect(store.getState().scene).toEqual({ id: 'BRACKET' });
    // There is no such thing as un-skipping an animation the room has already
    // seen the end of.
    expect(nextUndo(store.getState().history)).toBe(step);
  });
});
