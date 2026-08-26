import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  describeError,
  localTimestamp,
  logEvent,
  logSessionStart,
  setLogSink,
  setLogSource,
  type LogEntry,
  type LogSink,
} from '@/platform/log';

/**
 * The frontend half of the rolling log (issue #30).
 *
 * The file itself is Rust's and is tested there. What is asserted here is the
 * part a live event depends on: an entry says which window it came from, a
 * caught value keeps enough context to be reconstructed afterwards, and nothing
 * in this module can turn a failure into a second one.
 */

const written: LogEntry[] = [];
let restore: LogSink;

beforeAll(() => {
  restore = setLogSink((entry) => written.push(entry));
});

afterAll(() => {
  setLogSink(restore);
  setLogSource('host');
});

afterEach(() => {
  written.length = 0;
  setLogSource('host');
});

describe('writing an entry', () => {
  it('stamps the window it came from', () => {
    setLogSource('beamer');
    logEvent({ level: 'error', event: 'beamer.scene-failed', message: 'boom' });

    expect(written[0]?.source).toBe('beamer');
  });

  it('defaults to the host, which is the window a bare URL means', () => {
    logEvent({ level: 'info', event: 'test', message: 'hello' });

    expect(written[0]?.source).toBe('host');
  });

  it('passes the level, the code and the prose through untouched', () => {
    logEvent({
      level: 'warn',
      event: 'beamer.heartbeat-failed',
      message: 'a heartbeat could not be sent',
      detail: 'TypeError',
    });

    expect(written[0]).toEqual({
      level: 'warn',
      event: 'beamer.heartbeat-failed',
      message: 'a heartbeat could not be sent',
      detail: 'TypeError',
      source: 'host',
    });
  });

  /*
   * The contract every caller relies on. Each of them is a place that has just
   * failed, and a logger that could throw on top of that would turn a handled
   * problem into an unhandled one — in front of the room.
   */
  it('never throws, even when the sink does', () => {
    const previous = setLogSink(() => {
      throw new Error('the disk is gone');
    });

    expect(() => logEvent({ level: 'error', event: 'test', message: 'boom' })).not.toThrow();

    setLogSink(previous);
  });
});

describe('describing a caught value', () => {
  /* The message alone rarely says which scene threw. The stack does. */
  it('keeps the stack of a real error', () => {
    const described = describeError(new Error('boom'));

    expect(described).toContain('boom');
    expect(described).toContain('Error');
  });

  it('falls back to name and message when there is no stack', () => {
    const error = new Error('boom');
    // Deleted rather than set to `undefined`: with `exactOptionalPropertyTypes`
    // those are not the same thing, and an engine that never filled `stack` in
    // is the case being reproduced.
    Reflect.deleteProperty(error, 'stack');

    expect(describeError(error)).toBe('Error: boom');
  });

  it('passes a thrown string through', () => {
    expect(describeError('not an Error')).toBe('not an Error');
  });

  it('serialises a thrown object', () => {
    expect(describeError({ code: 17 })).toBe('{"code":17}');
  });

  /* A rejected `invoke` hands back the serialised Rust error, and a circular
   * value would otherwise take the reporter down with it. */
  it('survives a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    expect(describeError(circular)).toBe('[object Object]');
  });

  it('survives a value whose getter throws', () => {
    const hostile = {
      get boom(): never {
        throw new Error('nope');
      },
    };

    expect(() => describeError(hostile)).not.toThrow();
  });
});

describe('the local timestamp', () => {
  /*
   * Rust stamps every line in UTC because it has no timezone database. This is
   * the one entry that lets whoever reads the log translate the rest back to
   * the evening the host remembers, so the offset has to be there and it has to
   * have the right sign.
   */
  it('writes the offset ahead of UTC with a plus', () => {
    const summerInVienna = new Date('2026-08-26T19:31:04');
    Object.defineProperty(summerInVienna, 'getTimezoneOffset', { value: () => -120 });

    expect(localTimestamp(summerInVienna)).toMatch(/\+02:00$/u);
  });

  it('writes an offset behind UTC with a minus', () => {
    const elsewhere = new Date('2026-08-26T19:31:04');
    Object.defineProperty(elsewhere, 'getTimezoneOffset', { value: () => 330 });

    expect(localTimestamp(elsewhere)).toMatch(/-05:30$/u);
  });

  it('writes UTC itself as +00:00 rather than as nothing', () => {
    const utc = new Date('2026-08-26T19:31:04');
    Object.defineProperty(utc, 'getTimezoneOffset', { value: () => 0 });

    expect(localTimestamp(utc)).toMatch(/\+00:00$/u);
  });

  it('pads every field, so the column is the same width every line', () => {
    const early = new Date(2026, 0, 2, 3, 4, 5);
    Object.defineProperty(early, 'getTimezoneOffset', { value: () => -60 });

    expect(localTimestamp(early)).toBe('2026-01-02T03:04:05+01:00');
  });
});

describe('the session entry', () => {
  it('records the build and the host local clock', () => {
    logSessionStart('0.1.0', new Date(2026, 7, 26, 19, 31, 4));

    expect(written[0]?.event).toBe('session.started');
    expect(written[0]?.message).toContain('0.1.0');
    expect(written[0]?.detail).toContain('2026-08-26T19:31:04');
  });
});
