import type { SyncTransport, Unsubscribe } from '@/store/syncContract';

import type { ZodType } from 'zod';

/**
 * A pair of transports wired to each other, for tests.
 *
 * Payloads are round-tripped through JSON and re-parsed with the real schemas,
 * so a test exercises the same validation the Tauri boundary does. A test that
 * passed live objects between the windows would prove nothing about what
 * survives serialisation — which is where a snapshot bug would actually be.
 */

interface Wire {
  handlers: Map<string, Set<(payload: unknown) => void>>;
}

function deliver(wire: Wire, event: string, payload: unknown): void {
  const handlers = wire.handlers.get(event);
  if (!handlers) {
    return;
  }
  const wireFormat: unknown = JSON.parse(JSON.stringify(payload));
  for (const handler of [...handlers]) {
    handler(wireFormat);
  }
}

function endpoint(inbox: Wire, outbox: Wire): SyncTransport {
  return {
    emit: async (event, payload) => {
      deliver(outbox, event, payload);
    },
    listen: async <T>(event: string, schema: ZodType<T>, onMessage: (payload: T) => void) => {
      const handler = (payload: unknown) => {
        const parsed = schema.safeParse(payload);
        if (parsed.success) {
          onMessage(parsed.data);
        }
      };
      const handlers = inbox.handlers.get(event) ?? new Set();
      handlers.add(handler);
      inbox.handlers.set(event, handlers);
      return (() => {
        handlers.delete(handler);
      }) satisfies Unsubscribe;
    },
  };
}

export interface LinkedTransports {
  host: SyncTransport;
  beamer: SyncTransport;
}

export function createLinkedTransports(): LinkedTransports {
  const hostInbox: Wire = { handlers: new Map() };
  const beamerInbox: Wire = { handlers: new Map() };

  return {
    host: endpoint(hostInbox, beamerInbox),
    beamer: endpoint(beamerInbox, hostInbox),
  };
}
