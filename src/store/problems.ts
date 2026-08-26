import { describeError, logEvent } from '@/platform/log';

/**
 * What has gone wrong that the host has not been told about yet (issue #30).
 *
 * Not part of the tournament and deliberately outside `TournamentStore`: a
 * failure is not a decision, it does not belong on the undo stack, it must
 * never reach the beamer, and it must survive the tournament being closed. It
 * is also the one kind of state that has to keep working after the tournament
 * store has thrown.
 *
 * Nothing here knows a German word. The kind is the contract — `de.error.*`
 * carries the sentence, exactly as it does for a file failure.
 */

/**
 * What kind of thing failed.
 *
 * One entry per way the app can fail that is *not* a file operation; those have
 * their own strip (`FileNotice`) because they carry a way out — a backup to
 * open, a place to save — and a toast that could be dismissed would be the
 * wrong shape for them.
 */
export type ProblemKind =
  /** An exception nothing was expecting: a render, a handler, a rejection. */
  | 'unexpected'
  /** A beamer scene threw; the projector is holding a neutral picture. */
  | 'beamerScene'
  /** A snapshot or scene message could not be sent to the projector. */
  | 'beamerSync'
  /** The window system refused to open, move, close or focus a window. */
  | 'beamerCommand'
  /** The monitors could not be enumerated. */
  | 'beamerStatus'
  /** The screensaver and display timeout could not be held off. */
  | 'sleepInhibitFailed'
  /** The crash-recovery marker could not be written. */
  | 'sessionMarkerFailed'
  /** The log itself could not be opened. */
  | 'logUnavailable'
  /**
   * A `.wattmatt` file was double-clicked while a different tournament was
   * open (issue #31). Not a failure of the app — a request it declined, and
   * the host is told so, because from Explorer it looks like nothing happened.
   */
  | 'documentAlreadyOpen';

export interface Problem {
  kind: ProblemKind;
  /**
   * How often this has happened since it was last dismissed.
   *
   * Collapsing repeats rather than stacking them is not cosmetic. A broken
   * sync fails on *every* commit, and a host who has to dismiss forty
   * identical toasts during a round will dismiss the forty-first without
   * reading it — which is how the one that mattered gets missed.
   */
  count: number;
  /** Milliseconds since the epoch of the most recent occurrence. */
  at: number;
}

export interface ProblemStore {
  /** Newest first. A stable reference until something changes. */
  getState(): readonly Problem[];
  subscribe(listener: () => void): () => void;
  /** Records one occurrence, or bumps the one that is already showing. */
  report(kind: ProblemKind, at: number): void;
  dismiss(kind: ProblemKind): void;
  /** Everything at once — the host's way out of a screen full of toasts. */
  dismissAll(): void;
}

const EMPTY: readonly Problem[] = [];

export function createProblemStore(): ProblemStore {
  let problems: readonly Problem[] = EMPTY;
  const listeners = new Set<() => void>();

  const publish = (next: readonly Problem[]) => {
    problems = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    getState: () => problems,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report: (kind, at) => {
      const existing = problems.find((problem) => problem.kind === kind);
      const next: Problem = {
        kind,
        count: (existing?.count ?? 0) + 1,
        at,
      };
      // Newest first, and a repeat moves back to the front: the thing that just
      // failed again is the thing the host should be reading.
      publish([next, ...problems.filter((problem) => problem.kind !== kind)]);
    },
    dismiss: (kind) => {
      const next = problems.filter((problem) => problem.kind !== kind);
      if (next.length !== problems.length) {
        publish(next);
      }
    },
    dismissAll: () => {
      if (problems.length > 0) {
        publish(EMPTY);
      }
    },
  };
}

/**
 * The one store per window, for the window's whole lifetime.
 *
 * Module-level for the same reason the tournament store is: the global error
 * handlers and the sync layer report from outside the component tree, and a
 * store recreated by a re-render would drop the message explaining why the
 * re-render happened.
 *
 * It exists in the beamer window too, where nothing reads it. That is on
 * purpose — `reportProblem` is called from code that runs in both windows, and
 * a version that had to know which window it was in would be a version whose
 * callers had to know as well.
 */
export const problemStore: ProblemStore = createProblemStore();

/**
 * Says it out loud and writes it down — the one call every failure site makes.
 *
 * Both halves, always, in this order: the log is the record that survives the
 * evening, the toast is what the host can act on during it. Splitting them into
 * two calls is how a site ends up doing one and forgetting the other.
 *
 * @param kind what failed, which is what picks the German sentence
 * @param event the stable code the log is grepped by
 * @param cause whatever was caught, for the log only — never for the host
 */
export function reportProblem(kind: ProblemKind, event: string, cause?: unknown): void {
  logEvent({
    level: 'error',
    event,
    message: `problem reported: ${kind}`,
    detail: cause === undefined ? undefined : describeError(cause),
  });
  problemStore.report(kind, Date.now());
}
