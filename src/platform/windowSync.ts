import { emitTo, listen } from '@tauri-apps/api/event';

import { isTauriRuntime } from '@/platform/tauri';
import type { SyncTransport, Unsubscribe } from '@/store/syncContract';

import type { ZodType } from 'zod';

/**
 * The Tauri implementation of the sync transport (docs/ARCHITECTURE.md §3).
 *
 * Addressed with `emitTo` rather than a broadcast `emit`: a host that shouts
 * every snapshot at every window would also be shouting them at itself, and the
 * host acting on its own broadcast is a loop waiting to happen.
 */

const HOST_WINDOW = 'host';
const BEAMER_WINDOW = 'beamer';

function createTransport(target: string): SyncTransport {
  return {
    emit: (event, payload) => emitTo(target, event, payload),
    listen: <T>(event: string, schema: ZodType<T>, onMessage: (payload: T) => void) =>
      listen(event, ({ payload }) => {
        const parsed = schema.safeParse(payload);
        // A payload that does not parse is dropped, not delivered: rendering
        // half a snapshot is worse than holding the last correct picture
        // (see src/platform/tauri.ts).
        if (parsed.success) {
          onMessage(parsed.data);
        }
      }) as Promise<Unsubscribe>,
  };
}

/**
 * A transport that goes nowhere.
 *
 * `pnpm dev` in a plain browser has no second window and no backend. The layer
 * degrades to silence instead of throwing, exactly as the rest of the platform
 * boundary does.
 */
export function createDetachedTransport(): SyncTransport {
  return {
    emit: async () => {},
    listen: async () => () => {},
  };
}

/** Used by the host window: talks to the beamer. */
export function createHostTransport(): SyncTransport {
  return isTauriRuntime() ? createTransport(BEAMER_WINDOW) : createDetachedTransport();
}

/** Used by the beamer window: talks to the host. */
export function createBeamerTransport(): SyncTransport {
  return isTauriRuntime() ? createTransport(HOST_WINDOW) : createDetachedTransport();
}
