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

/**
 * Two transports wired to each other inside one window (issue #28).
 *
 * The host's live preview is a real beamer: the same store, the same sync
 * layer, the same scenes, fed by the same messages the projector gets. That is
 * the only way "the preview matches the beamer" can be a property rather than a
 * promise — a second rendering path would be a preview that could disagree with
 * the wall at exactly the moment the host is relying on it.
 *
 * Synchronous delivery, unlike the Tauri transport. It costs nothing, and it
 * means the preview is never a frame behind the projector for a reason that
 * only exists in the host window.
 */
export function createLoopbackChannel(): { host: SyncTransport; beamer: SyncTransport } {
  type Listener = (payload: unknown) => void;
  const toBeamer = new Map<string, Set<Listener>>();
  const toHost = new Map<string, Set<Listener>>();

  const side = (
    out: Map<string, Set<Listener>>,
    inbox: Map<string, Set<Listener>>,
  ): SyncTransport => ({
    emit: async (event, payload) => {
      // Copied before iterating: a listener that unsubscribes itself while the
      // message is being delivered must not shorten the list underneath us.
      for (const listener of [...(out.get(event) ?? [])]) {
        listener(payload);
      }
    },
    listen: async (event, schema, onMessage) => {
      const listener: Listener = (payload) => {
        const parsed = schema.safeParse(payload);
        // Parsed even here, where both ends are the same build: the schema is
        // the contract, and a preview that accepted what the projector rejects
        // would hide exactly the bug it exists to reveal.
        if (parsed.success) {
          onMessage(parsed.data);
        }
      };
      const listeners = inbox.get(event) ?? new Set<Listener>();
      listeners.add(listener);
      inbox.set(event, listeners);
      return () => {
        listeners.delete(listener);
      };
    },
  });

  return { host: side(toBeamer, toHost), beamer: side(toHost, toBeamer) };
}

/**
 * One transport that speaks for several.
 *
 * The host emits to the projector *and* to its own preview, and listens to
 * both. Merging here rather than starting two host syncs matters: two syncs
 * would mean two broadcasts per commit and two answers to every catch-up
 * request, and the second of each would arrive at the projector as a duplicate.
 */
export function mergeTransports(transports: readonly SyncTransport[]): SyncTransport {
  return {
    emit: async (event, payload) => {
      await Promise.all(transports.map((transport) => transport.emit(event, payload)));
    },
    listen: async (event, schema, onMessage) => {
      const unlisteners = await Promise.all(
        transports.map((transport) => transport.listen(event, schema, onMessage)),
      );
      return () => {
        for (const unlisten of unlisteners) {
          unlisten();
        }
      };
    },
  };
}
