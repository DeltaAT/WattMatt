import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const invoke = vi.fn<Invoke>(async () => null);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => invoke(command, args),
}));

/**
 * The session marker across the IPC boundary (issue #10).
 *
 * The Rust half is tested in `src-tauri/src/session.rs`. What is only reachable
 * here is the contract between the two, and the promise this module makes to
 * everything above it: none of these calls may throw. A recovery offer is a
 * safety net, and a safety net that takes the host window down during setup is
 * worse than no net at all.
 */

async function loadSession() {
  vi.resetModules();
  return import('@/platform/session');
}

function pretendTauri(present: boolean) {
  const scope = globalThis as unknown as { window?: unknown };
  scope.window = present ? { __TAURI_INTERNALS__: {} } : {};
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(null);
  pretendTauri(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe('pendingRecovery', () => {
  it('offers the tournament the killed session was working on', async () => {
    invoke.mockResolvedValue({ startedAt: 1_700_000_000_000, documentPath: 'C:\\t.wattmatt' });
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toEqual({
      path: 'C:\\t.wattmatt',
      startedAt: 1_700_000_000_000,
    });
  });

  it('offers nothing when the last session ended cleanly', async () => {
    invoke.mockResolvedValue(null);
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toBeNull();
  });

  /**
   * A crash during setup, before anything was opened. There is no tournament to
   * hand back, and an offer with nothing behind it is a dialog the host learns
   * to dismiss without reading — which is how they dismiss the real one too.
   */
  it('offers nothing when the killed session had no tournament open', async () => {
    invoke.mockResolvedValue({ startedAt: 1, documentPath: null });
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toBeNull();
  });

  it('offers nothing when the marker does not match the contract', async () => {
    invoke.mockResolvedValue({ documentPath: 'C:\\t.wattmatt' });
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toBeNull();
  });

  it('offers nothing when the command fails outright', async () => {
    invoke.mockRejectedValue(new Error('no backend'));
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toBeNull();
  });

  it('does not reach for a backend that is not there', async () => {
    pretendTauri(false);
    const { pendingRecovery } = await loadSession();

    await expect(pendingRecovery()).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('the marker this session writes', () => {
  it('names the open tournament, and names none once it is closed', async () => {
    const { markSessionDocument } = await loadSession();

    await markSessionDocument('C:\\t.wattmatt');
    await markSessionDocument(null);

    expect(invoke.mock.calls).toEqual([
      ['mark_session_document', { path: 'C:\\t.wattmatt' }],
      ['mark_session_document', { path: null }],
    ]);
  });

  it('clears the marker on a chosen exit', async () => {
    const { endSession } = await loadSession();

    await endSession();

    expect(invoke).toHaveBeenCalledWith('end_session', undefined);
  });

  it('forgets an answered offer without clearing the marker of this run', async () => {
    const { dismissRecovery } = await loadSession();

    await dismissRecovery();

    expect(invoke).toHaveBeenCalledWith('dismiss_recovery', undefined);
    expect(invoke).not.toHaveBeenCalledWith('end_session', undefined);
  });

  /**
   * The exit path awaits `endSession()` before destroying the window. If a
   * failure here rejected, the window would never be destroyed and the host
   * would be left clicking a close button that does nothing.
   */
  it('never rejects, whatever the backend does', async () => {
    invoke.mockRejectedValue(new Error('disk gone'));
    const { dismissRecovery, endSession, markSessionDocument } = await loadSession();

    await expect(markSessionDocument('C:\\t.wattmatt')).resolves.toBeUndefined();
    await expect(endSession()).resolves.toBeUndefined();
    await expect(dismissRecovery()).resolves.toBeUndefined();
  });

  it('does nothing at all without a backend', async () => {
    pretendTauri(false);
    const { endSession, markSessionDocument } = await loadSession();

    await markSessionDocument('C:\\t.wattmatt');
    await endSession();

    expect(invoke).not.toHaveBeenCalled();
  });
});
