import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { setLogSink, type LogEntry, type LogSink } from '@/platform/log';
import { createProblemStore, problemStore, reportProblem } from '@/store/problems';

/**
 * What the host is told when something failed that is not about a file
 * (issue #30).
 *
 * The properties worth pinning are the ones that decide whether the host reads
 * the message at all: repeats collapse, the newest thing is at the top, and
 * dismissing removes it without touching the rest.
 */

describe('the problem store', () => {
  it('starts with nothing to report', () => {
    expect(createProblemStore().getState()).toEqual([]);
  });

  it('records what failed and when', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);

    expect(store.getState()).toEqual([{ kind: 'beamerSync', count: 1, at: 1_000 }]);
  });

  /*
   * The one that matters live. A broken sync fails on every commit, and a host
   * who has dismissed forty identical toasts during a round will dismiss the
   * forty-first without reading it — which is how the one that mattered gets
   * missed.
   */
  it('collapses repeats of the same kind into one entry with a count', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('beamerSync', 2_000);
    store.report('beamerSync', 3_000);

    expect(store.getState()).toEqual([{ kind: 'beamerSync', count: 3, at: 3_000 }]);
  });

  it('keeps different kinds apart', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('unexpected', 2_000);

    expect(store.getState().map((problem) => problem.kind)).toEqual(['unexpected', 'beamerSync']);
  });

  it('moves a repeat back to the front, because it is what just happened', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('unexpected', 2_000);
    store.report('beamerSync', 3_000);

    expect(store.getState()).toEqual([
      { kind: 'beamerSync', count: 2, at: 3_000 },
      { kind: 'unexpected', count: 1, at: 2_000 },
    ]);
  });

  it('dismisses one kind and leaves the others standing', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('unexpected', 2_000);

    store.dismiss('beamerSync');

    expect(store.getState()).toEqual([{ kind: 'unexpected', count: 1, at: 2_000 }]);
  });

  /* A dismissed problem that happens again is news again, not a continuation. */
  it('starts counting from one again after a dismissal', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('beamerSync', 2_000);
    store.dismiss('beamerSync');
    store.report('beamerSync', 3_000);

    expect(store.getState()).toEqual([{ kind: 'beamerSync', count: 1, at: 3_000 }]);
  });

  it('notifies subscribers on a report and on a dismissal', () => {
    const store = createProblemStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.report('beamerSync', 1_000);
    store.dismiss('beamerSync');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  /*
   * `useSyncExternalStore` compares by reference and re-renders on every
   * notification. A dismissal of something that was not there would tell React
   * the host window changed for no reason at all.
   */
  it('says nothing when a dismissal changes nothing', () => {
    const store = createProblemStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.dismiss('beamerSync');

    expect(listener).not.toHaveBeenCalled();
  });

  it('holds the same array reference until something changes', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    const first = store.getState();

    expect(store.getState()).toBe(first);
  });

  it('stops notifying an unsubscribed listener', () => {
    const store = createProblemStore();
    const listener = vi.fn();
    store.subscribe(listener)();

    store.report('beamerSync', 1_000);

    expect(listener).not.toHaveBeenCalled();
  });

  it('clears everything at once', () => {
    const store = createProblemStore();
    store.report('beamerSync', 1_000);
    store.report('unexpected', 2_000);

    store.dismissAll();

    expect(store.getState()).toEqual([]);
  });
});

describe('reporting a problem', () => {
  const written: LogEntry[] = [];
  let restore: LogSink;

  beforeAll(() => {
    restore = setLogSink((entry) => written.push(entry));
  });

  afterAll(() => {
    // Put back, so the rest of the suite is not writing into this file's array.
    setLogSink(restore);
  });

  afterEach(() => {
    written.length = 0;
    problemStore.dismissAll();
  });

  /*
   * The whole reason `reportProblem` exists rather than two calls at each site:
   * the log is the record that survives the evening, the toast is what the host
   * can act on during it, and a site that did one and forgot the other would be
   * indistinguishable from one that worked.
   */
  it('writes the log entry and raises the toast in one call', () => {
    reportProblem('beamerScene', 'beamer.scene-failed', new Error('boom'));

    expect(written).toHaveLength(1);
    expect(written[0]?.event).toBe('beamer.scene-failed');
    expect(written[0]?.level).toBe('error');
    expect(problemStore.getState().map((problem) => problem.kind)).toEqual(['beamerScene']);
  });

  it('carries the cause into the log and nowhere else', () => {
    reportProblem('unexpected', 'window.error', new Error('the projector is on fire'));

    expect(written[0]?.detail).toContain('the projector is on fire');
    // The host's sentence is picked from `de.error.*` by kind. Nothing about
    // the exception reaches the screen — it is English and technical, and a
    // host reading it mid-round has been given a puzzle instead of a next step.
    expect(problemStore.getState()[0]).toMatchObject({ kind: 'unexpected', count: 1 });
  });

  it('writes an entry even when there was nothing to catch', () => {
    reportProblem('logUnavailable', 'log.open-failed');

    expect(written).toHaveLength(1);
    expect(written[0]?.detail).toBeUndefined();
  });
});
