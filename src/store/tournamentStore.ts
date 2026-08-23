import { createStore } from 'zustand/vanilla';

import { IDLE_SCENE, type BeamerScene } from '@/domain/beamerScene';
import {
  EMPTY_TOURNAMENT,
  toTournamentSnapshot,
  type Snapshot,
  type TournamentSnapshot,
} from '@/domain/snapshot';
import type { Clock, Tournament } from '@/domain/types';
import { systemClock } from '@/platform/clock';
import {
  capture,
  record,
  restore,
  stepBack,
  stepForward,
  EMPTY_HISTORY,
  REDO_LOG_ACTION,
  UNDO_LOG_ACTION,
  type UndoHistory,
} from '@/store/undo';

/**
 * The single source of truth, in the host window (docs/ARCHITECTURE.md §3).
 *
 * Components never write to it: every mutation goes through an action, and
 * every action goes through `commit`. That is what makes one central broadcast,
 * one central autosave and one central undo stack possible instead of a call at
 * each action site — an action added by a later issue is undoable, audited,
 * broadcast and saved by construction, and there is nothing for its author to
 * forget (issue #11).
 */

/**
 * Where the open tournament lives, and whether the copy on disk is current.
 *
 * Kept beside the tournament rather than inside it: none of it belongs in the
 * `.wattmatt` file, and a file that recorded its own path would be wrong the
 * moment it was copied onto a USB stick.
 *
 * A union rather than `path` plus a `dirty` flag (CLAUDE.md §6): the pair can
 * express "clean, but never written", and a host trusting that combination
 * closes the window on a tournament that exists nowhere.
 */
export type FileState =
  /**
   * Never reached disk. Since a new tournament is written to the library as it
   * is created (issue #9), this only survives a first write that failed.
   */
  | { status: 'unsaved' }
  /** The file on disk is the tournament in memory. */
  | { status: 'saved'; path: string }
  /** On disk, but behind what the host has done since. */
  | { status: 'modified'; path: string };

export const UNSAVED_FILE: FileState = { status: 'unsaved' };

/** The path the tournament was last written to, if it has one. */
export function filePath(file: FileState): string | null {
  return file.status === 'unsaved' ? null : file.path;
}

export interface TournamentState {
  /**
   * Bumped by every commit. The beamer uses it to order messages; issue #10
   * uses it to know whether there is anything to autosave.
   */
  revision: number;
  /**
   * Bumped only by a commit that replaced the tournament itself.
   *
   * Separate from `revision` because a save has to know whether the *file* is
   * still current, and `revision` moves for things a file does not contain —
   * staging a beamer scene, taking manual control. Comparing `revision` would
   * leave a tournament marked unsaved because the host clicked a beamer button
   * while the bytes were in flight, and cost a redundant write and a rotation
   * every time they did (issue #10).
   */
  documentRevision: number;
  scene: BeamerScene;
  autoFollow: boolean;
  /**
   * The whole tournament the host owns — what gets written to disk. `null`
   * means no tournament is open and the host is looking at the start screen.
   *
   * Authoritative. `tournament` below is a projection of this, recomputed by
   * `commit`; no action writes the projection itself.
   */
  document: Tournament | null;
  file: FileState;
  /**
   * What the beamer is sent (docs/ARCHITECTURE.md §3). Derived from `document`,
   * never assigned by an action.
   */
  tournament: TournamentSnapshot;
  /**
   * What the host can take back (issue #11). Maintained by `commit`, never by
   * an action — which is why `CommitPatch` cannot express it.
   *
   * It lives in the state so the host window re-renders when the next undo
   * step changes: the buttons name the step they would take, and a label that
   * lagged a click behind would tell the host they are about to undo something
   * they already undid. The beamer never sees it — `toSnapshot` picks its
   * fields by name.
   */
  history: UndoHistory;
}

export const INITIAL_TOURNAMENT_STATE: TournamentState = {
  revision: 0,
  documentRevision: 0,
  scene: IDLE_SCENE,
  autoFollow: true,
  document: null,
  file: UNSAVED_FILE,
  tournament: EMPTY_TOURNAMENT,
  history: EMPTY_HISTORY,
};

/** Whether the tournament in memory has moved on from the one on disk. */
export function hasUnsavedChanges(state: TournamentState): boolean {
  return state.document !== null && state.file.status !== 'saved';
}

/**
 * What an action may return.
 *
 * The three counters and the undo history are the store's own bookkeeping: an
 * action that could write `history` could quietly drop the steps behind it, and
 * one that could write `revision` could commit without the beamer noticing.
 * `tournament` stays writable because the sync tests drive the beamer channel
 * directly; every real action goes through `document` and lets `commit` project
 * it.
 */
export type CommitPatch = Partial<
  Omit<TournamentState, 'revision' | 'documentRevision' | 'history'>
>;

/** One appended audit record, before the clock has stamped it. */
export interface LogRecord {
  /** The action's name in SCREAMING_SNAKE_CASE, e.g. `MATCH_WINNER_SET`. */
  action: string;
  payload: Record<string, unknown>;
}

/**
 * How a commit is to be treated by the layers listening to it.
 *
 * Passed by the action rather than inferred, because none of it can be worked
 * out from the state alone: what the host would call this in German, whether it
 * belongs in the audit trail, and whether it must be on disk before the next
 * thing happens (docs/FILE-FORMAT.md rule 4).
 */
export interface CommitOptions {
  /**
   * Skip the autosave debounce and write now.
   *
   * For the moments the host would not survive losing: a round closing, a phase
   * changing. Everything else waits the 500 ms, so a burst of clicks is one
   * write rather than ten.
   */
  urgent?: boolean;
  /**
   * What the host just did, in German, taken from `de-AT.ts`.
   *
   * Its presence is what puts the commit on the undo stack, and the string is
   * what the undo button reads. It names the decision and its subject — the
   * winner that was set, and for which group — because a button that only says
   * "undo" leaves the host guessing what they are about to take back.
   *
   * Leaving it off marks a commit as bookkeeping rather than a decision — a
   * save landing, a document being opened. See `nextHistory` for what that
   * costs a commit that also replaces the tournament.
   */
  undoLabel?: string;
  /**
   * The audit record appended to `document.log` (docs/FILE-FORMAT.md rule 6).
   *
   * Only for commits that change the tournament: the log lives in the file, so
   * an entry written for a beamer scene would rewrite the tournament, bump
   * `documentRevision`, push the commit onto the heavy sync channel and trigger
   * an autosave — for a blackout, which is the one thing that must never queue
   * behind sixty-four groups of data (docs/ARCHITECTURE.md §3).
   */
  log?: LogRecord;
}

/** What a commit touched, reported to whoever is listening. */
export interface CommitMeta {
  /**
   * Whether the commit rewrote the tournament payload.
   *
   * Read from the keys the mutator returned rather than by comparing the old
   * and new state. A comparison would be reference equality, and an action that
   * mutated the tournament in place would look unchanged — sending the beamer
   * down the light channel and losing the data silently.
   */
  touchedTournament: boolean;
  /** The action asked for an immediate save (see [`CommitOptions`]). */
  urgent: boolean;
  /**
   * The picture is being put back, not played out.
   *
   * True for an undo and a redo. The beamer follows them like any other state
   * change, but it must not animate into them: replaying the pairing reveal
   * because the host corrected a misclick would show the audience a draw that
   * is not happening (issue #11 tasks, and the same reasoning as a reopened
   * beamer catching up).
   */
  settled: boolean;
}

export type CommitListener = (state: TournamentState, meta: CommitMeta) => void;

/**
 * The host store's public handle.
 *
 * Deliberately narrower than zustand's `StoreApi`: there is no `setState`, so
 * "every mutation goes through an action" is something the type system enforces
 * rather than something a reviewer has to notice. Without this a component
 * could write state that never bumps the revision, and the central broadcast
 * would skip it without a sound.
 */
export interface TournamentStore {
  getState(): TournamentState;
  /** For React bindings via `useSyncExternalStore`. */
  subscribe(listener: (state: TournamentState) => void): () => void;
  /** For the sync and persistence layers, which need to know what changed. */
  onCommit(listener: CommitListener): () => void;
  commit(mutate: (state: TournamentState) => CommitPatch, options?: CommitOptions): void;
  /**
   * Takes back the last recorded action. Returns false when there is nothing
   * to take back, so the caller can say so rather than pretend it happened.
   */
  undo(): boolean;
  /** Puts back the last undone action. */
  redo(): boolean;
}

export interface TournamentStoreOptions {
  /**
   * Stamps the audit log and `updatedAt`. Injected so a test can assert the
   * exact entry a decision wrote instead of matching a moving timestamp.
   */
  clock?: Clock;
}

export function createTournamentStore(
  initial: TournamentState = INITIAL_TOURNAMENT_STATE,
  { clock = systemClock }: TournamentStoreOptions = {},
): TournamentStore {
  const store = createStore<TournamentState>(() => ({ ...initial }));
  const listeners = new Set<CommitListener>();

  /**
   * Applies one action and bumps the revision.
   *
   * The bump is the commit: everything downstream — broadcast, autosave, undo
   * — keys off it rather than off the individual fields, so a new action never
   * has to remember to notify anybody.
   *
   * A mutator that changes nothing still commits. "The host clicked and
   * nothing observable happened" is a bug report during an event; a redundant
   * snapshot is a few hundred KB.
   *
   * `history` is passed only by `undo` and `redo`, which move *within* the
   * stack instead of pushing onto it.
   */
  const apply = (
    mutate: (state: TournamentState) => CommitPatch,
    options: CommitOptions | undefined,
    history?: UndoHistory,
  ): void => {
    const current = store.getState();
    const patch = mutate(current);
    const next: TournamentState = { ...current, ...patch, revision: current.revision + 1 };

    const replacedDocument = 'document' in patch;
    let touchedDocument = replacedDocument;

    // The audit trail, written centrally for the same reason as everything else
    // on this path (docs/FILE-FORMAT.md rule 6). `updatedAt` moves with it and
    // only with it: a recorded action is exactly what "the tournament changed"
    // means, while opening a file or marking it saved is not.
    if (options?.log !== undefined && next.document !== null) {
      const at = clock.now();
      next.document = {
        ...next.document,
        updatedAt: at,
        log: [...next.document.log, { at, ...options.log }],
      };
      touchedDocument = true;
    }

    // The beamer's copy is derived here, once, rather than by each action.
    // An action that changed the tournament and forgot to re-project it would
    // leave the projector a decision behind while the host screen looks
    // correct — the failure golden rule 4 exists to prevent.
    if (touchedDocument) {
      next.tournament = next.document ? toTournamentSnapshot(next.document) : EMPTY_TOURNAMENT;
      next.documentRevision = current.documentRevision + 1;
    }

    // Same reasoning for the dirty flag: an action that changed the
    // tournament without saying so would let the host close the window on
    // work that was never written. Only an action that decided the file
    // state itself — opening, saving, closing — is left alone.
    if (touchedDocument && !('file' in patch) && current.file.status !== 'unsaved') {
      next.file = { status: 'modified', path: current.file.path };
    }

    next.history = history ?? nextHistory(current, options, replacedDocument, touchedDocument);

    store.setState(next, true);

    const meta: CommitMeta = {
      touchedTournament: touchedDocument || 'tournament' in patch,
      urgent: options?.urgent === true,
      settled: history !== undefined,
    };
    for (const listener of [...listeners]) {
      listener(next, meta);
    }
  };

  /**
   * One step through the stack, committed like anything else.
   *
   * Taking a step back costs exactly what the step itself cost: an action that
   * changed the tournament is put back urgently and audited, while one that
   * only moved the projector is put back on the light path — see
   * `UndoEntry.touchedDocument`.
   */
  const move = (direction: 'back' | 'forward'): boolean => {
    const current = store.getState();
    const document = current.document;
    const snapshot = capture(current);
    if (document === null || snapshot === null) {
      return false;
    }

    const step =
      direction === 'back'
        ? stepBack(current.history, snapshot)
        : stepForward(current.history, snapshot);
    if (step === null) {
      return false;
    }

    const entry = step.entry;
    const picture = { scene: entry.snapshot.scene, autoFollow: entry.snapshot.autoFollow };

    // Undoing a blackout is still a blackout. Handing the tournament back to
    // `apply` here would rewrite it, write an audit entry for a scene change,
    // dirty a clean file and force an urgent save with its backup rotation —
    // putting the one action that must never wait behind sixty-four groups of
    // data behind exactly that (docs/FILE-FORMAT.md rule 6, golden rule 3).
    if (!entry.touchedDocument) {
      apply(() => picture, undefined, step.history);
      return true;
    }

    apply(
      () => ({ document: restore(entry.snapshot, document), ...picture }),
      {
        // `urgent`, because an undo is a correction: the host has just told the
        // room the previous result was wrong, and a crash a second later must
        // not hand back the version they disowned.
        urgent: true,
        log: {
          action: direction === 'back' ? UNDO_LOG_ACTION : REDO_LOG_ACTION,
          // Both, because the two answer different questions: the action name
          // is what a later reader greps for, the label is what the host saw
          // on the button they pressed.
          payload: { action: entry.action, label: entry.label },
        },
      },
      step.history,
    );
    return true;
  };

  return {
    getState: () => store.getState(),
    subscribe: (listener) => store.subscribe(listener),
    onCommit: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commit: (mutate, options) => apply(mutate, options),
    undo: () => move('back'),
    redo: () => move('forward'),
  };
}

/**
 * What the stack looks like after this commit.
 *
 * Two rules, and the second one is the load-bearing one.
 *
 * An action that named itself is a host decision and is recorded. An action
 * that rewrote the tournament *without* naming itself is not a decision at all
 * — it is the document being replaced, by a new tournament, an opened file or a
 * close. The steps behind it describe a tournament that is no longer open, and
 * undoing into one of them would restore the previous event over the current
 * one. Clearing is therefore structural rather than something the three
 * document actions have to remember (docs/OPEN-QUESTIONS.md #20).
 */
function nextHistory(
  current: TournamentState,
  options: CommitOptions | undefined,
  replacedDocument: boolean,
  touchedDocument: boolean,
): UndoHistory {
  if (options?.undoLabel === undefined) {
    return replacedDocument ? EMPTY_HISTORY : current.history;
  }

  // Before the first tournament is open there is nothing to go back to, and no
  // button to show a step on: the controls live with the tournament.
  const snapshot = capture(current);
  if (snapshot === null) {
    return current.history;
  }

  return record(current.history, {
    label: options.undoLabel,
    action: options.log?.action ?? null,
    // Carried on the entry rather than worked out when the host presses the
    // button: by then the commit that knew is long gone (see `UndoEntry`).
    touchedDocument,
    snapshot,
  });
}

/** The snapshot that describes the store right now. */
export function toSnapshot(
  state: TournamentState,
  delivery: Snapshot['delivery'] = 'live',
): Snapshot {
  return {
    revision: state.revision,
    scene: state.scene,
    autoFollow: state.autoFollow,
    tournament: state.tournament,
    delivery,
  };
}
