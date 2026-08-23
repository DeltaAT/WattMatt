import { describe, expect, it } from 'vitest';

import { IDLE_SCENE, BLACKOUT_SCENE } from '@/domain/beamerScene';
import { group, match, midTournament, round, table, tournament } from '@/domain/testFixtures';
import type { Tournament } from '@/domain/types';
import {
  capture,
  nextRedo,
  nextUndo,
  record,
  restore,
  stepBack,
  stepForward,
  EMPTY_HISTORY,
  UNDO_DEPTH,
  type UndoEntry,
  type UndoHistory,
  type UndoSnapshot,
} from '@/store/undo';

/**
 * The stack as a value, away from the store.
 *
 * What is tested here is the part a wrong answer cannot be argued with: what a
 * snapshot contains, what it deliberately does not, and where a step ends up.
 * The wiring — which commits are recorded, what an undo does to the file and to
 * the beamer — is `tournamentStore.test.ts` and `sync.test.ts`.
 */

const LABEL = 'Winner set';

function stateOf(document: Tournament | null, scene = IDLE_SCENE, autoFollow = true) {
  return { document, scene, autoFollow };
}

function entryFrom(document: Tournament, label = LABEL): UndoEntry {
  const snapshot = capture(stateOf(document));
  if (snapshot === null) {
    throw new Error('fixture has no document');
  }
  return { label, action: 'MATCH_WINNER_SET', touchedDocument: true, snapshot };
}

/** A step that only moved the projector: no audit name, no tournament change. */
function sceneEntryFrom(document: Tournament, label = 'Blackout'): UndoEntry {
  return { ...entryFrom(document, label), action: null, touchedDocument: false };
}

describe('capturing a snapshot', () => {
  it('has nothing to capture without a tournament', () => {
    expect(capture(stateOf(null))).toBeNull();
  });

  it('takes the whole tournament, not the fields an action happened to touch', () => {
    const document = midTournament();
    const snapshot = capture(stateOf(document));

    // Byte for byte, minus the two forward-only streams. An undo that restored
    // the phase but not the table it freed is the failure this design exists
    // to make impossible (CLAUDE.md golden rule 6).
    const { log: _log, rngCursor: _rngCursor, ...expected } = document;
    expect(snapshot?.document).toEqual(expected);
  });

  it('carries the beamer picture with the tournament', () => {
    const snapshot = capture(stateOf(midTournament(), BLACKOUT_SCENE, false));

    expect(snapshot?.scene).toEqual(BLACKOUT_SCENE);
    expect(snapshot?.autoFollow).toBe(false);
  });

  it('keeps neither the audit log nor the RNG cursor', () => {
    const snapshot = capture(stateOf(midTournament()));

    expect(snapshot?.document).not.toHaveProperty('log');
    expect(snapshot?.document).not.toHaveProperty('rngCursor');
  });

  it('clones deeply, so a later mutation cannot reach into the stack', () => {
    const document = midTournament();
    const snapshot = capture(stateOf(document));

    // Actions are not supposed to mutate in place. A stack that survives one
    // that does is worth more than a rule nothing enforces at runtime.
    document.groups[0]!.status = 'ELIMINATED';
    document.rounds[1]!.matches[0]!.winnerId = document.groups[1]!.id;

    expect(snapshot?.document.groups[0]?.status).toBe('ACTIVE');
    expect(snapshot?.document.rounds[1]?.matches[0]?.winnerId).toBeNull();
  });
});

describe('restoring a snapshot', () => {
  it('puts every field of the tournament back', () => {
    const before = midTournament();
    const snapshot = capture(stateOf(before))!;
    const after: Tournament = {
      ...before,
      phase: 'CEREMONY',
      groups: [group(1, { status: 'ELIMINATED' })],
      tables: [table(1, { status: 'DISABLED', currentMatchId: null })],
    };

    const restored = restore(snapshot, after);

    expect(restored.phase).toBe(before.phase);
    expect(restored.groups).toEqual(before.groups);
    expect(restored.tables).toEqual(before.tables);
  });

  it('never rewinds the audit log', () => {
    const before = midTournament();
    const snapshot = capture(stateOf(before))!;
    const after: Tournament = {
      ...before,
      log: [...before.log, { at: before.createdAt, action: 'MATCH_WINNER_SET', payload: {} }],
    };

    // docs/FILE-FORMAT.md rule 6: the log is append-only. Rolling it back would
    // erase the record of the decision the host is undoing — the one entry an
    // audit would look for.
    expect(restore(snapshot, after).log).toEqual(after.log);
  });

  it('never rewinds the RNG cursor', () => {
    const before = midTournament({ rngCursor: 17 });
    const snapshot = capture(stateOf(before))!;
    const after: Tournament = { ...before, rngCursor: 41 };

    // Randomness the room has already watched is consumed. Rewinding would
    // reproduce the draw the host just rejected, and would give two different
    // draws the same (seed, cursor) — see docs/OPEN-QUESTIONS.md #32.
    expect(restore(snapshot, after).rngCursor).toBe(41);
  });

  it('clones, so undoing twice does not hand out the stack entry', () => {
    const before = midTournament();
    const snapshot = capture(stateOf(before))!;

    const first = restore(snapshot, before);
    first.groups[0]!.status = 'ELIMINATED';
    const second = restore(snapshot, before);

    expect(second.groups[0]?.status).toBe('ACTIVE');
  });
});

describe('recording a step', () => {
  it('starts empty', () => {
    expect(nextUndo(EMPTY_HISTORY)).toBeNull();
    expect(nextRedo(EMPTY_HISTORY)).toBeNull();
  });

  it('names the step the undo button would take', () => {
    const history = record(EMPTY_HISTORY, entryFrom(midTournament(), 'First'));

    expect(nextUndo(history)?.label).toBe('First');
  });

  it('keeps the most recent step last', () => {
    const one = record(EMPTY_HISTORY, entryFrom(midTournament(), 'First'));
    const two = record(one, entryFrom(midTournament(), 'Second'));

    expect(nextUndo(two)?.label).toBe('Second');
    expect(two.past).toHaveLength(2);
  });

  it('drops the oldest step past the depth', () => {
    let history: UndoHistory = EMPTY_HISTORY;
    for (let step = 0; step < UNDO_DEPTH + 10; step += 1) {
      history = record(history, entryFrom(midTournament(), `Step ${step}`));
    }

    expect(history.past).toHaveLength(UNDO_DEPTH);
    expect(history.past[0]?.label).toBe('Step 10');
    expect(nextUndo(history)?.label).toBe(`Step ${UNDO_DEPTH + 9}`);
  });

  it('discards redo, so the history never branches', () => {
    const document = midTournament();
    const recorded = record(EMPTY_HISTORY, entryFrom(document, 'First'));
    const undone = stepBack(recorded, capture(stateOf(document))!)!;

    expect(nextRedo(undone.history)?.label).toBe('First');

    const afterNewAction = record(undone.history, entryFrom(document, 'Second'));

    // Issue #11 notes: redo goes as soon as a new action is committed. A
    // branching history is one more thing to explain mid-event.
    expect(nextRedo(afterNewAction)).toBeNull();
  });
});

describe('stepping through the history', () => {
  const before = midTournament({ phase: 'QUALIFYING' });
  const after = midTournament({ phase: 'BRACKET' });

  function currentOf(document: Tournament): UndoSnapshot {
    return capture(stateOf(document))!;
  }

  it('has nowhere to go on an empty history', () => {
    expect(stepBack(EMPTY_HISTORY, currentOf(after))).toBeNull();
    expect(stepForward(EMPTY_HISTORY, currentOf(after))).toBeNull();
  });

  it('hands back the picture from before the action', () => {
    const history = record(EMPTY_HISTORY, entryFrom(before));
    const move = stepBack(history, currentOf(after));

    expect(move?.entry.snapshot.document.phase).toBe('QUALIFYING');
    expect(move?.history.past).toHaveLength(0);
  });

  it('turns the current picture into the redo step, under the same label', () => {
    const history = record(EMPTY_HISTORY, entryFrom(before, 'Winner set'));
    const move = stepBack(history, currentOf(after))!;

    // Undo and redo name one action between them; a host reading the two
    // buttons has to see the same words on both.
    expect(nextRedo(move.history)?.label).toBe('Winner set');
    expect(nextRedo(move.history)?.snapshot.document.phase).toBe('BRACKET');
  });

  /**
   * What the step cost going forward is what it costs coming back, in both
   * directions. `tournamentStore.test.ts` proves what the store does with the
   * answer; losing it here would let an undo of a blackout rewrite the
   * tournament file (docs/FILE-FORMAT.md rule 6).
   */
  it('carries what the step touched into the redo step and back again', () => {
    const history = record(EMPTY_HISTORY, sceneEntryFrom(before));
    const undone = stepBack(history, currentOf(after))!;

    expect(undone.entry.touchedDocument).toBe(false);
    expect(nextRedo(undone.history)?.touchedDocument).toBe(false);

    const redone = stepForward(undone.history, undone.entry.snapshot)!;

    expect(redone.entry.touchedDocument).toBe(false);
    expect(nextUndo(redone.history)?.touchedDocument).toBe(false);
  });

  it('walks back and forward over the same ground', () => {
    const history = record(EMPTY_HISTORY, entryFrom(before));
    const undone = stepBack(history, currentOf(after))!;
    const redone = stepForward(undone.history, undone.entry.snapshot)!;

    expect(redone.entry.snapshot.document.phase).toBe('BRACKET');
    expect(nextUndo(redone.history)?.snapshot.document.phase).toBe('QUALIFYING');
    expect(nextRedo(redone.history)).toBeNull();
  });
});

describe('what fifty steps cost', () => {
  /**
   * Issue #11 acceptance criterion: fifty steps on a 64-group tournament stay
   * under 100 MB.
   *
   * Measured as the serialised size of the stack rather than as heap usage.
   * A tournament is plain JSON data by construction — it is what the file
   * holds — so its retained size is within a small constant factor of its
   * serialisation, while `heapUsed` in a shared test process measures the
   * garbage collector's mood as much as anything this code did.
   *
   * The generous budget is checked, and so is a far tighter one: at 100 MB
   * alone the test would still pass if every entry silently carried the whole
   * audit log of the event, which is exactly the regression the `UndoDocument`
   * type exists to prevent.
   */
  const BUDGET_BYTES = 100 * 1024 * 1024;
  const REALISTIC_BYTES = 8 * 1024 * 1024;

  function sixtyFourGroups(): Tournament {
    const groups = Array.from({ length: 64 }, (_, index) =>
      group(index + 1, { name: `Mannschaft ${index + 1}` }),
    );
    return tournament({
      groups,
      tables: Array.from({ length: 12 }, (_, index) => table(index + 1)),
      rounds: Array.from({ length: 6 }, (_, roundIndex) =>
        round(roundIndex + 1, {
          state: 'CLOSED',
          matches: Array.from({ length: 32 }, (_, matchIndex) =>
            match(roundIndex * 32 + matchIndex + 1, {
              a: groups[(matchIndex * 2) % 64]!.id,
              b: groups[(matchIndex * 2 + 1) % 64]!.id,
              status: 'DONE',
            }),
          ),
        }),
      ),
    });
  }

  it('keeps a full stack far inside the budget', () => {
    const document = sixtyFourGroups();
    let history: UndoHistory = EMPTY_HISTORY;

    for (let step = 0; step < UNDO_DEPTH; step += 1) {
      // A growing log on the live tournament, which the stack must not copy.
      document.log.push({ at: document.createdAt, action: 'MATCH_WINNER_SET', payload: { step } });
      history = record(history, entryFrom(document, `Step ${step}`));
    }

    expect(history.past).toHaveLength(UNDO_DEPTH);

    const bytes = JSON.stringify(history).length;
    expect(bytes, `stack serialised to ${(bytes / 1024 / 1024).toFixed(2)} MB`).toBeLessThan(
      BUDGET_BYTES,
    );
    expect(bytes).toBeLessThan(REALISTIC_BYTES);
  });
});
