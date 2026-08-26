import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
type Listener = (event: { payload: unknown }) => void;

const invoke = vi.fn<Invoke>(async () => null);
const unlisten = vi.fn(() => {});
const listeners = new Map<string, Listener>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (event: string, listener: Listener) => {
    listeners.set(event, listener);
    return unlisten;
  },
}));

/**
 * The launch boundary (issue #31). The Rust half is tested in
 * `src-tauri/src/launch.rs`; what is only reachable here is the contract
 * between the two, and this module's promise to everything above it: a
 * double-click that could not be read is a double-click that did nothing, never
 * a host window that fails to start.
 */

async function loadLaunch() {
  vi.resetModules();
  return import('@/platform/launch');
}

function pretendTauri(present: boolean) {
  const scope = globalThis as unknown as { window?: unknown };
  scope.window = present ? { __TAURI_INTERNALS__: {} } : {};
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  unlisten.mockClear();
  listeners.clear();
  pretendTauri(true);
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('takeStartupDocument', () => {
  it('hands over the tournament the app was started with', async () => {
    invoke.mockResolvedValue('C:\\turniere\\Sommer.wattmatt');
    const { takeStartupDocument } = await loadLaunch();

    await expect(takeStartupDocument()).resolves.toBe('C:\\turniere\\Sommer.wattmatt');
    expect(invoke).toHaveBeenCalledWith('take_startup_document', undefined);
  });

  it('answers null when the app was simply launched', async () => {
    invoke.mockResolvedValue(null);
    const { takeStartupDocument } = await loadLaunch();

    await expect(takeStartupDocument()).resolves.toBeNull();
  });

  it('answers null in a plain browser, where there is no backend', async () => {
    pretendTauri(false);
    const { takeStartupDocument } = await loadLaunch();

    await expect(takeStartupDocument()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  /** A start-up argument nobody could read must not stop the app starting. */
  it('answers null rather than throwing when the call fails', async () => {
    invoke.mockRejectedValue(new Error('no such command'));
    const { takeStartupDocument } = await loadLaunch();

    await expect(takeStartupDocument()).resolves.toBeNull();
  });

  /** A shape that is not a path is a broken contract, not a tournament. */
  it('answers null when Rust returns something that is not a path', async () => {
    invoke.mockResolvedValue({ path: 'C:\\t.wattmatt' });
    const { takeStartupDocument } = await loadLaunch();

    await expect(takeStartupDocument()).resolves.toBeNull();
  });
});

describe('onOpenRequest', () => {
  it('reports the path a second instance was started with', async () => {
    const { onOpenRequest } = await loadLaunch();
    const seen: string[] = [];
    await onOpenRequest((path) => seen.push(path));

    listeners.get('launch:open-request')?.({ payload: { path: 'C:\\t.wattmatt' } });

    expect(seen).toEqual(['C:\\t.wattmatt']);
  });

  /** A malformed event is our own bug, and acting on half of it is worse. */
  it('drops a payload that is not a path', async () => {
    const { onOpenRequest } = await loadLaunch();
    const seen: string[] = [];
    await onOpenRequest((path) => seen.push(path));

    listeners.get('launch:open-request')?.({ payload: { path: 42 } });
    listeners.get('launch:open-request')?.({ payload: null });

    expect(seen).toEqual([]);
  });

  it('stops listening when it is told to', async () => {
    const { onOpenRequest } = await loadLaunch();

    (await onOpenRequest(() => {}))();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it('subscribes to nothing in a plain browser', async () => {
    pretendTauri(false);
    const { onOpenRequest } = await loadLaunch();

    (await onOpenRequest(() => {}))();

    expect(listeners.size).toBe(0);
  });
});
