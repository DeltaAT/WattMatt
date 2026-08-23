import type { FileErrorKind } from '@/platform/tournamentFile';
import type { AutosaveOutcome } from '@/store/persistence';
import type { TournamentState, TournamentStore } from '@/store/tournamentStore';

/**
 * The debounced autosave (issue #10, docs/FILE-FORMAT.md rule 4).
 *
 * Wired once, centrally, to `store.onCommit` — the same funnel the beamer
 * broadcast hangs off (docs/ARCHITECTURE.md §3). An action written by a later
 * issue is autosaved by construction; there is no call for its author to
 * forget, which is the only way this stays true across thirty more issues.
 *
 * Nothing here reads a file, formats a date or knows a German word. It decides
 * *when* to write and reports what happened; the writing is
 * `autosaveTournament`, and the "Gespeichert 19:31" line is the host window's.
 */

/**
 * How long the host has to stop clicking before the disk is touched.
 *
 * Long enough that entering eight results in a row is one write rather than
 * eight, short enough that half a second is all a crash can ever cost.
 */
export const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * How long a broken autosave waits before trying again.
 *
 * Without a retry, a failure is only reconsidered on the host's next decision —
 * so a host who pushed the USB stick back in between rounds would have nothing
 * written until they clicked something, while the warning kept telling them so.
 * Longer than the debounce because nothing is waiting on it: the host has been
 * told, and hammering a disk that is not there helps nobody.
 */
export const AUTOSAVE_RETRY_MS = 5_000;

/** What the autosave is doing right now, for the host's status line. */
export interface AutosaveState {
  activity: 'idle' | 'pending' | 'saving';
  /** Milliseconds since the epoch of the last successful write, or `null`. */
  lastSavedAt: number | null;
  /**
   * Why the last attempt failed, cleared by the next success.
   *
   * The host has to be told and kept told: an autosave that quietly stopped
   * working — a USB stick pulled out, a file locked by a virus scanner — looks
   * exactly like one that is working, right up to the crash.
   */
  failure: FileErrorKind | null;
}

export const IDLE_AUTOSAVE: AutosaveState = {
  activity: 'idle',
  lastSavedAt: null,
  failure: null,
};

export interface AutosaveOptions {
  /** One write attempt. Must not throw; a rejection is treated as a failure. */
  save: () => Promise<AutosaveOutcome>;
  /** Milliseconds since the epoch. Injected so the status line is testable. */
  now: () => number;
  debounceMs?: number;
}

export interface Autosave {
  getState(): AutosaveState;
  subscribe(listener: (state: AutosaveState) => void): () => void;
  /**
   * Writes whatever is waiting, right now, and resolves when it is on disk.
   *
   * The forced save of the issue's task list: window close and app exit call
   * it, and so does anything else that must not leave the debounce window open.
   */
  flush(): Promise<void>;
  stop(): void;
}

/**
 * Whether there is something to write and somewhere to write it.
 *
 * `modified` is the only state that has both. `saved` is already on disk, and
 * `unsaved` — a tournament whose first write failed — has no path; that one is
 * the host's decision to make through "Speichern unter…", not a dialog the
 * autosave may open behind their back (CLAUDE.md golden rule 3).
 */
export function needsAutosave(state: TournamentState): boolean {
  return state.document !== null && state.file.status === 'modified';
}

export function startAutosave(store: TournamentStore, options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const listeners = new Set<(state: AutosaveState) => void>();

  let state = IDLE_AUTOSAVE;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  /**
   * One attempt at a time, in order.
   *
   * Two writes racing onto the same path both go through the atomic write in
   * Rust, and the one that finishes second wins — which, when the first carried
   * the newer tournament, is the older one overwriting it.
   */
  let queue: Promise<void> = Promise.resolve();

  const publish = (next: Partial<AutosaveState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) {
      listener(state);
    }
  };

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Back to rest, or back to waiting if a commit arrived during the write. */
  const settle = (next: Partial<AutosaveState> = {}) => {
    publish({ ...next, activity: timer === null ? 'idle' : 'pending' });
  };

  const attempt = (): Promise<void> => {
    queue = queue.then(async () => {
      if (stopped || !needsAutosave(store.getState())) {
        settle();
        return;
      }

      publish({ activity: 'saving' });
      let outcome: AutosaveOutcome;
      try {
        outcome = await options.save();
      } catch {
        // `autosaveTournament` returns its failures rather than throwing, so
        // this is the layer below misbehaving. It is still a save that did not
        // happen, and the host is told the same thing either way.
        outcome = { status: 'failed', path: '', kind: 'io' };
      }

      if (outcome.status === 'failed') {
        // Nothing else will ask again until the host commits something, and the
        // condition that broke it is usually one they can fix on the spot.
        retry();
        settle({ failure: outcome.kind });
        return;
      }
      if (outcome.status === 'saved') {
        settle({ lastSavedAt: options.now(), failure: null });
        return;
      }
      settle();
    });
    return queue;
  };

  const after = (delayMs: number) => {
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      void attempt();
    }, delayMs);
  };

  /**
   * Tries again later, without disturbing a debounce that is already counting.
   *
   * A commit that arrived during the failed write has scheduled its own, sooner
   * attempt; replacing it with the slower retry would make the host wait longer
   * precisely because they kept working.
   */
  const retry = () => {
    if (timer === null && !stopped) {
      after(AUTOSAVE_RETRY_MS);
    }
  };

  const schedule = () => {
    after(debounceMs);
    // A write already in flight keeps its label: the host reading "Wird
    // gespeichert…" is being told the truth, and flicking back to "pending"
    // because they typed a character would only make the line twitch.
    publish({ activity: state.activity === 'saving' ? 'saving' : 'pending' });
  };

  const unsubscribeStore = store.onCommit((next, meta) => {
    if (!needsAutosave(next)) {
      // The commit that put memory and disk back in step — a save landing, a
      // tournament closing. A debounce still running would write nothing, and
      // would leave the status line claiming work is outstanding.
      //
      // An earlier failure is cleared here too, and that matters: a host who
      // answered a failed autosave with "Speichern unter…" has fixed the
      // problem, and a warning that outlives the condition is one they learn to
      // ignore before the next real one arrives.
      cancelTimer();
      if (state.activity === 'pending' || state.failure !== null) {
        publish({ activity: 'idle', failure: null });
      }
      return;
    }

    if (meta.urgent) {
      cancelTimer();
      void attempt();
      return;
    }
    schedule();
  });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: async () => {
      cancelTimer();
      // Checked before joining the queue, not inside it. `flush` is what the
      // window's close button waits on, and the queue it shares with the host's
      // own file operations can be held by a native dialog the host has not
      // answered yet — so a close with nothing to write must not wait on it.
      if (!needsAutosave(store.getState())) {
        settle();
        return;
      }
      await attempt();
    },
    stop: () => {
      stopped = true;
      cancelTimer();
      unsubscribeStore();
      listeners.clear();
    },
  };
}
