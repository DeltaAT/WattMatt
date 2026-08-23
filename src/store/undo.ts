import type { BeamerScene } from '@/domain/beamerScene';
import type { Tournament } from '@/domain/types';

/**
 * The undo history (issue #11, CLAUDE.md golden rule 6).
 *
 * Snapshots, not inverse operations. An inverse has to be written per action
 * and is wrong in exactly the cases nobody tested — the ones where an action
 * touched something derived, a table it freed or a round it closed. A snapshot
 * cannot be incomplete: whatever the action changed, the previous picture had
 * it, so "undo restores derived state too" is a property of the mechanism
 * rather than a promise each future action has to keep.
 *
 * Nothing here reads the store or the clock. The stack is a value; wiring it
 * into `commit` is `tournamentStore.ts`'s job, and that is the single funnel
 * that makes every action undoable by construction.
 */

/**
 * How far back the host can go.
 *
 * Fifty is the issue's number and it is generous on purpose: an event runs a
 * few hundred decisions, and the misclick a host discovers late is the one they
 * most need back. Memory is not the constraint — see `undoMemory.test.ts`.
 */
export const UNDO_DEPTH = 50;

/** What the audit log calls an undo and a redo (docs/FILE-FORMAT.md rule 6). */
export const UNDO_LOG_ACTION = 'ACTION_UNDONE';
export const REDO_LOG_ACTION = 'ACTION_REDONE';

/**
 * A tournament as the stack keeps it: everything except the two fields that
 * only ever move forward.
 *
 * `log` is append-only (docs/FILE-FORMAT.md rule 6). Rolling it back would
 * erase the record of the very decision the host is undoing, which is the one
 * entry an audit would look for.
 *
 * `rngCursor` is the same kind of thing for a different reason. Randomness the
 * event has already consumed is consumed: the room watched that draw. Rewinding
 * the cursor would make a redraw reproduce the pairing the host just rejected,
 * and would give two different draws the same `(seed, cursor)` — destroying the
 * property that makes a disputed draw defensible at all (CLAUDE.md golden rule
 * 7, docs/ARCHITECTURE.md §5 "The draw stream", docs/OPEN-QUESTIONS.md #32).
 *
 * Both are left out of the snapshot type rather than merely ignored on restore,
 * so a future field added to one of the two streams cannot be rewound by
 * accident.
 */
export type UndoDocument = Omit<Tournament, 'log' | 'rngCursor'>;

/** Everything an undo puts back. */
export interface UndoSnapshot {
  document: UndoDocument;
  /**
   * The beamer travels with the tournament. Undoing a decision the host made
   * three scenes ago and leaving the projector where it is would show the
   * audience a picture of a state that no longer exists.
   */
  scene: BeamerScene;
  autoFollow: boolean;
}

/** One step, and what to call it on the button. */
export interface UndoEntry {
  /** German, from `de-AT.ts`: what the host did, in their words. */
  label: string;
  /** The audit name of the action, when it wrote one. */
  action: string | null;
  /** The picture from *before* the action ran. */
  snapshot: UndoSnapshot;
}

export interface UndoHistory {
  /** Oldest first; the last element is the next undo. */
  past: readonly UndoEntry[];
  /** Oldest first; the last element is the next redo. */
  future: readonly UndoEntry[];
}

export const EMPTY_HISTORY: UndoHistory = { past: [], future: [] };

/** What a state has to carry for the stack to be able to snapshot it. */
export interface UndoableState {
  document: Tournament | null;
  scene: BeamerScene;
  autoFollow: boolean;
}

/**
 * Copies the current picture out of the state, or `null` if no tournament is
 * open.
 *
 * The clone is what makes the entry safe to hold: an action is not supposed to
 * mutate the tournament in place, but a stack that survives one that does is
 * worth more than a rule nobody can enforce at runtime.
 */
export function capture(state: UndoableState): UndoSnapshot | null {
  if (state.document === null) {
    return null;
  }
  const { log: _log, rngCursor: _rngCursor, ...document } = state.document;
  return {
    document: structuredClone(document),
    scene: state.scene,
    autoFollow: state.autoFollow,
  };
}

/**
 * Turns a snapshot back into a whole tournament.
 *
 * The two forward-only streams come from the tournament as it is *now*, not
 * from the entry — see `UndoDocument`. Cloning again means the same entry can
 * be undone, redone and undone once more without ever handing out the object
 * the stack is holding.
 */
export function restore(snapshot: UndoSnapshot, current: Tournament): Tournament {
  return {
    ...structuredClone(snapshot.document),
    rngCursor: current.rngCursor,
    log: current.log,
  };
}

/**
 * Puts one step on the stack.
 *
 * Redo is dropped, which is the standard behaviour and the reason there is no
 * branching history to explain to a host mid-event (issue #11 notes).
 */
export function record(
  history: UndoHistory,
  entry: UndoEntry,
  depth: number = UNDO_DEPTH,
): UndoHistory {
  const past = [...history.past, entry];
  return { past: past.length > depth ? past.slice(past.length - depth) : past, future: [] };
}

/** The step an undo or a redo would take, and the history it leaves behind. */
export interface UndoMove {
  entry: UndoEntry;
  history: UndoHistory;
}

/**
 * Steps back one action.
 *
 * `current` becomes the redo entry, under the *same* label. Undo and redo name
 * one action between them, so the host reads the same words on both buttons and
 * does not have to work out that they are the same decision.
 */
export function stepBack(history: UndoHistory, current: UndoSnapshot): UndoMove | null {
  const entry = history.past.at(-1);
  if (entry === undefined) {
    return null;
  }
  return {
    entry,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, { ...entry, snapshot: current }],
    },
  };
}

/** Steps forward again, mirroring `stepBack`. */
export function stepForward(history: UndoHistory, current: UndoSnapshot): UndoMove | null {
  const entry = history.future.at(-1);
  if (entry === undefined) {
    return null;
  }
  return {
    entry,
    history: {
      past: [...history.past, { ...entry, snapshot: current }],
      future: history.future.slice(0, -1),
    },
  };
}

/** What the undo button is about to do, or `null` if it is disabled. */
export function nextUndo(history: UndoHistory): UndoEntry | null {
  return history.past.at(-1) ?? null;
}

/** What the redo button is about to do, or `null` if it is disabled. */
export function nextRedo(history: UndoHistory): UndoEntry | null {
  return history.future.at(-1) ?? null;
}
