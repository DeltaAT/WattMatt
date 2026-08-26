// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { installGlobalErrorHandlers } from '@/platform/globalErrors';
import { setLogSink, type LogEntry, type LogSink } from '@/platform/log';
import { problemStore } from '@/store/problems';

/**
 * The net under everything React's boundaries cannot see (issue #30).
 *
 * A boundary catches exceptions thrown while *rendering*. It does not catch a
 * click handler that threw, an unawaited promise, a timer callback or an event
 * listener — and during a live event those are most of the code that runs.
 * Without these handlers the host clicks *Sieger festlegen*, nothing happens,
 * and nothing anywhere says why.
 */

const written: LogEntry[] = [];
let restore: LogSink;
let uninstall: () => void;

beforeAll(() => {
  restore = setLogSink((entry) => written.push(entry));
  uninstall = installGlobalErrorHandlers();
});

afterAll(() => {
  uninstall();
  setLogSink(restore);
});

afterEach(() => {
  written.length = 0;
  problemStore.dismissAll();
});

/**
 * jsdom fires a real `error` event for an uncaught exception, but only through
 * a listener it can reach. Dispatching the event directly is the same path the
 * browser takes and keeps the test off jsdom's own uncaught-error plumbing.
 */
function throwUncaught(error: Error): void {
  window.dispatchEvent(new ErrorEvent('error', { error, message: error.message }));
}

function rejectUnhandled(reason: unknown): void {
  // `PromiseRejectionEvent` is not constructible in jsdom, so the event is
  // built by hand with the one field the handler reads.
  const event = new Event('unhandledrejection') as Event & { reason?: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

describe('an exception nothing was expecting', () => {
  it('reaches the host as a toast', () => {
    throwUncaught(new Error('a handler threw'));

    expect(problemStore.getState().map((problem) => problem.kind)).toEqual(['unexpected']);
  });

  it('reaches the log with its stack', () => {
    throwUncaught(new Error('a handler threw'));

    expect(written).toHaveLength(1);
    expect(written[0]?.event).toBe('window.error');
    expect(written[0]?.detail).toContain('a handler threw');
  });

  /*
   * `event.error` is empty for a cross-origin script. That should not happen in
   * an offline app with an inlined bundle — but "should not happen" is not a
   * reason to record nothing at all.
   */
  it('falls back to the message when the thrown value did not survive', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));

    expect(written[0]?.detail).toContain('Script error.');
  });
});

describe('a promise nobody awaited', () => {
  it('reaches the host as a toast', () => {
    rejectUnhandled(new Error('the save never resolved'));

    expect(problemStore.getState().map((problem) => problem.kind)).toEqual(['unexpected']);
  });

  it('reaches the log with its reason', () => {
    rejectUnhandled(new Error('the save never resolved'));

    expect(written[0]?.event).toBe('window.unhandled-rejection');
    expect(written[0]?.detail).toContain('the save never resolved');
  });

  it('survives a rejection that carried no Error at all', () => {
    expect(() => rejectUnhandled('just a string')).not.toThrow();
    expect(written[0]?.detail).toBe('just a string');
  });
});

describe('the handlers themselves', () => {
  /*
   * They are meant to outlive every component in the window — which is exactly
   * why removing them has to work, or a test that installed a second set would
   * leave the suite double-reporting.
   */
  it('can be removed again', () => {
    const stop = installGlobalErrorHandlers();
    stop();

    throwUncaught(new Error('once, not twice'));

    expect(written).toHaveLength(1);
  });
});
