import { z } from 'zod';

import { invokeCommand, isTauriRuntime } from '@/platform/tauri';

/**
 * The session-marker half of the Rust boundary (src-tauri/src/session.rs).
 *
 * Rust writes a marker when the app starts and deletes it on a clean exit, so a
 * marker that is still there at the next start is the evidence that the last run
 * was killed. This module reads that evidence and hands it up; whether to offer
 * a recovery, and in which words, is the host window's decision (CLAUDE.md §1).
 *
 * Every call degrades quietly. None of it is load-bearing for running a
 * tournament: a session marker that could not be written costs a recovery offer
 * after a crash that may never happen, and refusing to start over it would cost
 * the event.
 */

const sessionMarkerSchema = z.object({
  /** Milliseconds since the epoch; formatted for the host by `@/i18n/format`. */
  startedAt: z.number().int().nonnegative(),
  documentPath: z.string().nullable(),
});

/** A tournament the previous run was working on when it was killed. */
export interface RecoveryOffer {
  path: string;
  startedAt: number;
}

/**
 * What the last run left behind, or `null` if there is nothing to offer.
 *
 * A marker without a `documentPath` is deliberately `null` here rather than an
 * offer with nothing in it: a crash before any tournament was opened has
 * nothing to recover, and telling the host about it during setup is noise.
 */
export async function pendingRecovery(): Promise<RecoveryOffer | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    const marker = await invokeCommand(
      'pending_recovery',
      sessionMarkerSchema.nullable(),
      undefined,
    );
    if (marker === null || marker.documentPath === null) {
      return null;
    }
    return { path: marker.documentPath, startedAt: marker.startedAt };
  } catch {
    return null;
  }
}

/** Forgets the offer once the host has answered it, either way. */
export async function dismissRecovery(): Promise<void> {
  await call('dismiss_recovery');
}

/**
 * Records which tournament this session would want back after a crash.
 *
 * Called when the open file changes rather than on every autosave: the path is
 * what a recovery needs, and what is at that path is the autosave's business.
 */
export async function markSessionDocument(path: string | null): Promise<void> {
  await call('mark_session_document', { path });
}

/**
 * Marks this exit as one somebody chose.
 *
 * Must be awaited before the window is destroyed. A marker still on disk after
 * a deliberate quit greets the host with a recovery offer for a tournament
 * nothing happened to, which is how a safety net becomes noise to click away.
 */
export async function endSession(): Promise<void> {
  await call('end_session');
}

async function call(command: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invokeCommand(command, z.null().or(z.undefined()), args);
  } catch (error) {
    // Never thrown onward: none of this is worth taking the host window down
    // for mid-event. Proper surfacing lands with issue #30.
    console.error('session marker update failed', error);
  }
}
