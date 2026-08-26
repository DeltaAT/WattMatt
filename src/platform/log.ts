import { z } from 'zod';

import { invokeCommand, isTauriRuntime } from '@/platform/tauri';
import { toTournamentFileError, type TournamentFileError } from '@/platform/tournamentFile';

/**
 * The frontend half of the rolling log (src-tauri/src/logging.rs, issue #30).
 *
 * Rust owns file I/O (CLAUDE.md §4), so this module builds entries and hands
 * them over. It knows no German: a log is read after the event by whoever is
 * working out what happened, and it is written in the same English as the code
 * it describes.
 *
 * Two properties are the whole design.
 *
 * **`logEvent` never throws and is never awaited.** Every caller is a place
 * that has just failed. A logger that could add a second failure on top of the
 * first — or that made a scene wait on a disk — would be worse than no logger.
 *
 * **It never reports a problem of its own.** `@/store/problems` logs whatever
 * it reports, so a logger that reported its own failures would loop.
 */

/** Matched by `LogLevel` in src-tauri/src/logging.rs. */
export type LogLevel = 'info' | 'warn' | 'error';

/** Which window an entry came from. Rust adds `rust` for its own. */
export type LogSource = 'host' | 'beamer';

export interface LogEvent {
  level: LogLevel;
  /** A stable code, not prose: `beamer.scene-failed`. Grepped, not read. */
  event: string;
  /** One sentence of English prose about what happened. */
  message: string;
  /** The stack, the path, the OS message — whatever the next reader needs. */
  detail?: string | undefined;
}

/**
 * Where entries say they came from.
 *
 * Module-level rather than a parameter because most call sites — the sync
 * layer, the stores — run in both windows and have no business knowing which
 * one they are in. `App.tsx` sets it once, from the resolved route.
 */
let source: LogSource = 'host';

export function setLogSource(next: LogSource): void {
  source = next;
}

/** What the sink is handed. `source` is filled in here, not by the caller. */
export interface LogEntry extends LogEvent {
  source: LogSource;
}

/**
 * Where entries go.
 *
 * Injectable for the tests, which have to assert on what was written without a
 * Rust backend underneath — and to keep the suite from firing IPC calls at a
 * backend that is not there.
 */
export type LogSink = (entry: LogEntry) => void;

const rustSink: LogSink = (entry) => {
  if (!isTauriRuntime()) {
    // A plain browser (`pnpm dev` without Tauri) has no log folder. Dropping is
    // right: the console already carries whatever React reported, and this
    // module must not become the thing that broke the page.
    return;
  }
  // Deliberately not awaited, and the rejection is swallowed rather than
  // reported: a log folder that cannot be written is exactly the situation in
  // which a second write would fail too.
  void invokeCommand('log_event', z.null().or(z.undefined()), { entry }).catch(() => {});
};

let sink: LogSink = rustSink;

/** Replaces the sink. Returns the previous one so a test can put it back. */
export function setLogSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}

/** Writes one entry. Fire and forget, by contract. */
export function logEvent(event: LogEvent): void {
  try {
    sink({ ...event, source });
  } catch {
    // A sink that throws is a bug in the sink. It is not worth an app.
  }
}

/**
 * What to put in `detail` for a caught value.
 *
 * The stack rather than only the message: the message alone rarely says which
 * scene threw, and the stack is the difference between a log that records that
 * something failed and one that says what.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    // A circular object, or one whose getter throws. Its type is still worth
    // knowing, and it is all that is left.
    return Object.prototype.toString.call(error);
  }
}

/**
 * Records that this window started, with its local clock.
 *
 * The one entry that has to be there: Rust stamps every line in UTC because it
 * has no timezone database, and this line is what lets a reader translate the
 * rest back to the evening the host remembers.
 */
export function logSessionStart(appVersion: string, now: Date = new Date()): void {
  logEvent({
    level: 'info',
    event: 'session.started',
    message: `window opened, WattMatt ${appVersion}`,
    detail: `local time ${localTimestamp(now)}`,
  });
}

/** `2026-08-26T19:31:04+02:00` — the same instant, in the host's own clock. */
export function localTimestamp(now: Date): string {
  // `getTimezoneOffset` counts minutes *behind* UTC, so Vienna in summer is
  // -120 and the offset written in the stamp is +02:00.
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);

  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * `%APPDATA%\WattMatt\logs`, or `null` where there is no backend to ask.
 *
 * Null rather than a throw, like `tournamentsDirectory`: this only decides
 * whether a path can be printed under a button, and not knowing it must never
 * be the reason the button is missing.
 */
export async function logDirectory(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invokeCommand('log_directory', z.string());
  } catch {
    return null;
  }
}

/**
 * Opens the log folder in Explorer — the host's "Protokoll öffnen".
 *
 * The one call in this module that throws. It is the only one a host pressed a
 * button for, and a button that silently does nothing is the failure this
 * whole issue exists to remove.
 *
 * @throws TournamentFileError typed like every other file failure, so the host
 *   is told in the same German.
 */
export async function openLogDirectory(): Promise<void> {
  if (!isTauriRuntime()) {
    throw noBackend();
  }
  try {
    await invokeCommand('open_log_directory', z.null().or(z.undefined()));
  } catch (error) {
    throw toTournamentFileError(error);
  }
}

function noBackend(): TournamentFileError {
  return toTournamentFileError(new Error('no Tauri backend in this window'));
}
