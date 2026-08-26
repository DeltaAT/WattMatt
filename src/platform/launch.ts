import { z } from 'zod';

import { invokeCommand, isTauriRuntime, listenEvent } from '@/platform/tauri';

/**
 * The launch half of the Rust boundary (src-tauri/src/launch.rs).
 *
 * `.wattmatt` is registered with the shell (issue #31), so a tournament can
 * arrive two ways that are not the host picking it from the start screen: as
 * the argument WattMatt was started with, or from a second WattMatt somebody
 * started while this one was already running.
 *
 * Both are requests, not commands. This module reports them; whether to open
 * anything is the host window's decision, because a file that replaced a
 * running tournament without being asked would be the app taking control away
 * mid-event (CLAUDE.md golden rule 3).
 */

/** Mirrors `OPEN_REQUEST_EVENT` in src-tauri/src/launch.rs. */
const OPEN_REQUEST_EVENT = 'launch:open-request';

const openRequestSchema = z.object({ path: z.string() });

/**
 * The tournament this process was started with, or `null`.
 *
 * Takes it: Rust hands the path out exactly once. A start-up path that survived
 * a reload of the host WebView would reopen the file over whatever the host had
 * done since, and discard it without asking.
 *
 * `null` rather than a throw when there is no backend, and when the call fails:
 * the app has to reach the start screen either way, and a start-up argument
 * nobody could read is a double-click that did nothing, not a broken app.
 */
export async function takeStartupDocument(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invokeCommand('take_startup_document', z.string().nullable());
  } catch {
    return null;
  }
}

/**
 * Calls back when a second WattMatt was asked to open a tournament.
 *
 * The second process has already exited by then and its window is gone; all
 * that is left is the path it was started with.
 */
export async function onOpenRequest(onRequest: (path: string) => void): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  return listenEvent(OPEN_REQUEST_EVENT, openRequestSchema, ({ path }) => onRequest(path));
}
