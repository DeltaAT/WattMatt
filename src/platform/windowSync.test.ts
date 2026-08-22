import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

type TauriEvent = { payload: unknown };

const emitTo = vi.fn<(target: string, event: string, payload?: unknown) => Promise<void>>(
  async () => {},
);
const listen = vi.fn<(event: string, handler: (event: TauriEvent) => void) => Promise<() => void>>(
  async () => () => {},
);

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: (target: string, event: string, payload?: unknown) => emitTo(target, event, payload),
  listen: (event: string, handler: (event: TauriEvent) => void) => listen(event, handler),
}));

/**
 * The shipped transport, as opposed to the in-memory double the sync tests use.
 *
 * Everything else about issue #5 is verified against `createLinkedTransports`,
 * which proves the logic and nothing at all about whether a message actually
 * leaves the window. What can be pinned here without a running app is the part
 * that silently breaks: the window labels and the runtime guard.
 */

async function loadWindowSync() {
  vi.resetModules();
  return import('@/platform/windowSync');
}

function pretendTauri(present: boolean) {
  const scope = globalThis as unknown as { window?: unknown };
  scope.window = present ? { __TAURI_INTERNALS__: {} } : {};
}

beforeEach(() => {
  emitTo.mockClear();
  listen.mockClear();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('the Tauri sync transport', () => {
  it('addresses the beamer from the host and the host from the beamer', async () => {
    pretendTauri(true);
    const { createBeamerTransport, createHostTransport } = await loadWindowSync();

    await createHostTransport().emit('state:snapshot', { revision: 1 });
    await createBeamerTransport().emit('state:request-snapshot', {});

    // A broadcast `emit` would also hit the sender, and the host acting on its
    // own snapshot is a loop waiting to happen.
    expect(emitTo).toHaveBeenNthCalledWith(1, 'beamer', 'state:snapshot', { revision: 1 });
    expect(emitTo).toHaveBeenNthCalledWith(2, 'host', 'state:request-snapshot', {});
  });

  it('uses the window labels the app actually creates', () => {
    // These strings are a contract with Rust. Renaming a window without
    // renaming them compiles, ships, and delivers every snapshot to nobody.
    const config: unknown = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
    const labels = z
      .object({ app: z.object({ windows: z.array(z.object({ label: z.string() })) }) })
      .parse(config).app.windows;

    expect(labels.map((window) => window.label)).toContain('host');

    const rust = readFileSync('src-tauri/src/windows.rs', 'utf-8');
    expect(rust).toContain('"beamer"');
  });

  it('drops a payload that does not match its schema instead of delivering it', async () => {
    pretendTauri(true);
    const { createHostTransport } = await loadWindowSync();
    const received: unknown[] = [];

    await createHostTransport().listen('beamer:heartbeat', z.object({ beat: z.number() }), (p) =>
      received.push(p),
    );

    const handler = listen.mock.calls[0]?.[1];
    handler?.({ payload: { beat: 'soon' } });
    handler?.({ payload: { beat: 3 } });

    // Half a payload rendered on the projector is worse than the last correct
    // picture staying up.
    expect(received).toEqual([{ beat: 3 }]);
  });

  it('degrades to silence in a plain browser rather than throwing', async () => {
    pretendTauri(false);
    const { createBeamerTransport, createHostTransport } = await loadWindowSync();

    await expect(createHostTransport().emit('state:snapshot', {})).resolves.toBeUndefined();
    const unlisten = await createBeamerTransport().listen('x', z.unknown(), () => {});
    unlisten();

    // `pnpm dev` in a browser has no second window; the layer must not explode.
    expect(emitTo).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
