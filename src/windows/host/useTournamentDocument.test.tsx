// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { midTournament } from '@/domain/testFixtures';
import type * as TauriPlatform from '@/platform/tauri';
import { TournamentFileError } from '@/platform/tournamentFile';
import { closeDocument, setNewDocument, setOpenedDocument } from '@/store/actions/document';
import { AUTOSAVE_DEBOUNCE_MS } from '@/store/autosave';
import { serialiseTournament, type PersistenceDeps } from '@/store/persistence';
import { problemStore } from '@/store/problems';
import { tournamentStore } from '@/store/session';
import { fakeDeps, fakeFiles, LIBRARY, type FakeFiles } from '@/store/testFixtures';
import {
  useTournamentDocument,
  type TournamentDocument,
} from '@/windows/host/useTournamentDocument';

/**
 * The host window's file operations, driven the way the host drives them.
 *
 * `@/store/persistence` is tested on its own; what is only reachable here is
 * the sequencing the host actually experiences — the unsaved-changes question,
 * what a *failed* answer to it does, and the window's own close button. Every
 * one of those decides whether a live tournament survives a misclick, so none
 * of them may rest on "the code looks right".
 *
 * Only the dependency bundle and the window handle are faked. The store, the
 * actions and `persistence.ts` are the real ones, so a test failing here means
 * the host would see it too.
 */

const mocks = vi.hoisted(() => ({
  tauriPresent: true,
  /** Every handler `onCloseRequested` is currently holding. */
  closeHandlers: [] as Array<(event: { preventDefault: () => void }) => void>,
  destroy: vi.fn(async () => {}),
  deps: null as PersistenceDeps | null,
  /** The session marker (issue #10), which lives in Rust. */
  recovery: null as { path: string; startedAt: number } | null,
  markSessionDocument: vi.fn<(path: string | null) => Promise<void>>(async () => {}),
  endSession: vi.fn(async () => {}),
  dismissRecovery: vi.fn(async () => {}),
  /** What Rust says this process was started with (issue #31). */
  startupDocument: null as string | null,
  /** Every handler `onOpenRequest` is currently holding. */
  openRequests: [] as Array<(path: string) => void>,
}));

vi.mock('@/platform/session', () => ({
  pendingRecovery: async () => mocks.recovery,
  markSessionDocument: (path: string | null) => mocks.markSessionDocument(path),
  endSession: () => mocks.endSession(),
  dismissRecovery: () => mocks.dismissRecovery(),
}));

vi.mock('@/platform/launch', () => ({
  takeStartupDocument: async () => {
    // Taken, exactly as Rust hands it out: a second mount must not reopen it.
    const path = mocks.startupDocument;
    mocks.startupDocument = null;
    return path;
  },
  onOpenRequest: async (handler: (path: string) => void) => {
    mocks.openRequests.push(handler);
    return () => {
      const at = mocks.openRequests.indexOf(handler);
      if (at >= 0) {
        mocks.openRequests.splice(at, 1);
      }
    };
  },
}));

vi.mock('@/platform/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof TauriPlatform>()),
  isTauriRuntime: () => mocks.tauriPresent,
}));

vi.mock('@/store/persistenceRuntime', () => ({
  APP_VERSION: '0.1.0',
  createPersistenceDeps: () => mocks.deps,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: (event: { preventDefault: () => void }) => void) => {
      mocks.closeHandlers.push(handler);
      return () => {
        const at = mocks.closeHandlers.indexOf(handler);
        if (at >= 0) {
          mocks.closeHandlers.splice(at, 1);
        }
      };
    },
    destroy: mocks.destroy,
  }),
}));

const PATH = `${LIBRARY}\\Sommer.wattmatt`;

let files: FakeFiles;

beforeEach(() => {
  files = fakeFiles();
  mocks.deps = fakeDeps(files);
  mocks.tauriPresent = true;
  mocks.closeHandlers.length = 0;
  mocks.destroy.mockClear();
  mocks.recovery = null;
  mocks.markSessionDocument.mockClear();
  mocks.endSession.mockClear();
  mocks.dismissRecovery.mockClear();
  mocks.startupDocument = null;
  mocks.openRequests.length = 0;
  problemStore.dismissAll();
  // The store outlives a window, so each test starts it back at the start
  // screen rather than inheriting the previous test's tournament.
  closeDocument(tournamentStore);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Every mounted hook holds a live autosave subscribed to the module-level
  // store, which outlives the test. Without this, a hook from an earlier test
  // keeps writing to the fake disk that test created — and the tournament of
  // the *current* one is marked saved by a write that went somewhere else.
  cleanup();
  vi.restoreAllMocks();
});

type View = RenderHookResult<TournamentDocument, unknown>;

/** Mounts the hook and lets the start screen's library listing settle. */
async function mount(): Promise<View> {
  const view = renderHook(() => useTournamentDocument());
  await waitFor(() => expect(view.result.current.library).toBe(LIBRARY));
  return view;
}

/** A tournament open, on disk at `PATH`, and changed since it was written. */
function loadModifiedTournament(): void {
  files.disk.set(PATH, '{}');
  setOpenedDocument(tournamentStore, midTournament(), PATH);
  tournamentStore.commit((state) => ({
    document: state.document === null ? null : { ...state.document, rngCursor: 18 },
  }));
}

/**
 * A tournament that has never reached disk: the first write failed, or nobody
 * has chosen a location yet. This is the only state in which closing genuinely
 * loses something once the autosave of issue #10 is running.
 */
function loadUnwrittenTournament(): void {
  setNewDocument(tournamentStore, midTournament());
}

/** Waits for the operation queue to drain. */
async function idle(view: View): Promise<void> {
  await waitFor(() => expect(view.result.current.busy).toBe(false));
}

describe('the start screen listing', () => {
  it('has the library and its tournaments before the host looks for them', async () => {
    files.disk.set(PATH, '{}');

    const { result } = await mount();

    expect(result.current.library).toBe(LIBRARY);
    expect(result.current.recents.map((entry) => entry.fileName)).toEqual(['Sommer.wattmatt']);
  });
});

describe('closing a tournament with nothing to lose', () => {
  it('closes at once rather than asking', async () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const view = await mount();

    await act(async () => {
      view.result.current.requestClose();
    });

    expect(view.result.current.pendingIntent).toBeNull();
    expect(tournamentStore.getState().document).toBeNull();
  });
});

describe('the unsaved-changes question', () => {
  /**
   * Issue #10 moved this. Closing now flushes whatever the debounce was still
   * holding, so a tournament with a file is on disk by the time the question
   * would have been asked — and a question with only one honest answer is one
   * more click between the host and the room.
   */
  it('writes what the debounce was holding and closes, rather than asking', async () => {
    loadModifiedTournament();
    const view = await mount();

    await act(async () => {
      view.result.current.requestClose();
    });
    await idle(view);

    expect(view.result.current.pendingIntent).toBeNull();
    expect(files.writes).toEqual([PATH]);
    expect(tournamentStore.getState().document).toBeNull();
  });

  /**
   * The case the question still exists for: a tournament the autosave cannot
   * write because it has no file. Closing it loses everything, and there is
   * nothing the app can do about that on the host's behalf.
   */
  it('still asks for a tournament that has never reached disk', async () => {
    loadUnwrittenTournament();
    const view = await mount();

    await act(async () => {
      view.result.current.requestClose();
    });

    expect(view.result.current.pendingIntent).toBe('close');
    expect(tournamentStore.getState().document).not.toBeNull();
  });

  /**
   * "Abbrechen" means the host changed their mind about closing — not about
   * anything else. Nothing may be written, nothing may be closed, and the
   * tournament must be exactly as dirty as it was.
   */
  it('leaves everything untouched when the host cancels', async () => {
    loadUnwrittenTournament();
    const view = await mount();
    await act(async () => {
      view.result.current.requestClose();
    });
    const before = tournamentStore.getState();

    await act(async () => {
      view.result.current.answerUnsaved('cancel');
    });
    await idle(view);

    expect(view.result.current.pendingIntent).toBeNull();
    expect(tournamentStore.getState()).toBe(before);
    expect(files.writes).toEqual([]);
  });

  it('saves and then closes when the host says so', async () => {
    mocks.deps = fakeDeps(files, {
      dialogs: { pickOpen: async () => null, pickSave: async () => PATH },
    });
    loadUnwrittenTournament();
    const view = await mount();
    await act(async () => {
      view.result.current.requestClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('save');
    });
    await idle(view);

    expect(files.writes).toEqual([PATH]);
    expect(tournamentStore.getState().document).toBeNull();
    expect(view.result.current.notice).toBeNull();
  });

  /**
   * The whole point of the question. The host agreed to close *on the strength
   * of the save*; a save that failed and a close that went ahead anyway is the
   * tournament gone, which is the exact outcome this dialog exists to prevent.
   */
  it('does not close when the save it was conditional on failed', async () => {
    mocks.deps = fakeDeps(files, {
      dialogs: { pickOpen: async () => null, pickSave: async () => PATH },
    });
    loadUnwrittenTournament();
    const view = await mount();
    files.failWrite(new TournamentFileError('permissionDenied', 'denied', PATH));
    await act(async () => {
      view.result.current.requestClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('save');
    });
    await idle(view);

    expect(tournamentStore.getState().document).not.toBeNull();
    expect(view.result.current.notice).toEqual({
      kind: 'saveFailed',
      errorKind: 'permissionDenied',
    });
  });

  /**
   * Same rule, quieter case: a tournament with no file falls through to
   * "Speichern unter…", and the host closing that dialog has not saved
   * anything. There is nothing to report — but there is also nothing to close.
   */
  it('does not close when the host backs out of the save dialog', async () => {
    setNewDocument(tournamentStore, midTournament());
    const view = await mount();
    await act(async () => {
      view.result.current.requestClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('save');
    });
    await idle(view);

    expect(tournamentStore.getState().document).not.toBeNull();
    expect(view.result.current.notice).toBeNull();
    expect(files.writes).toEqual([]);
  });

  it('closes without writing when the host discards', async () => {
    loadUnwrittenTournament();
    const view = await mount();
    await act(async () => {
      view.result.current.requestClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('discard');
    });
    await idle(view);

    expect(tournamentStore.getState().document).toBeNull();
    expect(files.writes).toEqual([]);
  });

  it('ignores an answer nobody asked for', async () => {
    loadUnwrittenTournament();
    const view = await mount();

    await act(async () => {
      view.result.current.answerUnsaved('discard');
    });
    await idle(view);

    expect(tournamentStore.getState().document).not.toBeNull();
  });
});

describe('the window close button', () => {
  function requestWindowClose(): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() };
    for (const handler of [...mocks.closeHandlers]) {
      handler(event);
    }
    return event;
  }

  it('registers with the window it is running in', async () => {
    await mount();

    expect(mocks.closeHandlers).toHaveLength(1);
  });

  /**
   * Always intercepted, even with nothing to lose (issue #10). The close has to
   * flush the pending autosave and clear the session marker before the process
   * goes; letting Tauri close the window straight away would leave the next
   * start offering a recovery of a tournament nothing happened to.
   */
  it('takes the close over, then completes it itself', async () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const view = await mount();

    let event!: { preventDefault: ReturnType<typeof vi.fn> };
    await act(async () => {
      event = requestWindowClose();
    });
    await idle(view);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(view.result.current.pendingIntent).toBeNull();
    expect(mocks.endSession).toHaveBeenCalledTimes(1);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  /**
   * Issue #10: "forced immediate save on … window close". The debounce may
   * still have been counting when the host reached for the close button, and
   * half a second of a live event is a decided match.
   */
  it('writes what the debounce was holding before the window goes', async () => {
    loadModifiedTournament();
    const view = await mount();

    await act(async () => {
      requestWindowClose();
    });
    await idle(view);

    expect(files.writes).toEqual([PATH]);
    expect(mocks.destroy).toHaveBeenCalledTimes(1);
  });

  it('turns the close into the question for a tournament that has no file', async () => {
    loadUnwrittenTournament();
    const view = await mount();

    let event!: { preventDefault: ReturnType<typeof vi.fn> };
    await act(async () => {
      event = requestWindowClose();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(view.result.current.pendingIntent).toBe('quit');
    expect(mocks.destroy).not.toHaveBeenCalled();
  });

  /**
   * The handler reads the state through a ref rather than a captured value. A
   * close arriving on the very commit that created the tournament must already
   * see it — that gap is where the tournament gets lost.
   */
  it('sees a tournament that appeared after the handler was registered', async () => {
    const view = await mount();

    await act(async () => {
      loadUnwrittenTournament();
    });
    let event!: { preventDefault: ReturnType<typeof vi.fn> };
    await act(async () => {
      event = requestWindowClose();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(view.result.current.pendingIntent).toBe('quit');
  });

  /**
   * Answering the *quit* question destroys the window rather than closing the
   * tournament: the host asked for the app to go away, and closing the
   * document instead would leave them staring at a start screen.
   */
  it('destroys the window once the host has answered', async () => {
    loadUnwrittenTournament();
    const view = await mount();
    await act(async () => {
      requestWindowClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('discard');
    });
    await idle(view);

    expect(mocks.destroy).toHaveBeenCalledTimes(1);
    expect(tournamentStore.getState().document).not.toBeNull();
  });

  it('does not destroy the window when the save it was conditional on failed', async () => {
    mocks.deps = fakeDeps(files, {
      dialogs: { pickOpen: async () => null, pickSave: async () => PATH },
    });
    loadUnwrittenTournament();
    const view = await mount();
    files.failWrite(new TournamentFileError('io', 'disk full', PATH));
    await act(async () => {
      requestWindowClose();
    });

    await act(async () => {
      view.result.current.answerUnsaved('save');
    });
    await idle(view);

    expect(mocks.destroy).not.toHaveBeenCalled();
    expect(view.result.current.notice).toEqual({ kind: 'saveFailed', errorKind: 'io' });
  });

  it('leaves the window alone in a plain browser, where there is none', async () => {
    mocks.tauriPresent = false;

    await mount();

    expect(mocks.closeHandlers).toHaveLength(0);
  });
});

describe('two file operations at once', () => {
  /**
   * `busy` disables the toolbar, but not the window's close button or the
   * unsaved-changes dialog — so a second save can still be issued while one is
   * in flight. Both go through the atomic write, and the one that finishes
   * second wins: an older tournament overwriting a newer one, silently.
   */
  it('runs them one after the other, never overlapping', async () => {
    loadModifiedTournament();
    const view = await mount();
    const release = files.blockWrites();

    act(() => {
      view.result.current.save();
      view.result.current.save();
    });
    expect(view.result.current.busy).toBe(true);
    release();
    await idle(view);

    expect(files.metrics.peakConcurrentWrites).toBe(1);
    expect(files.writes).toEqual([PATH, PATH]);
  });

  /**
   * One gate per write, released by hand, so the two operations can be pulled
   * apart: the second must not even reach the disk until the first is through,
   * and the toolbar must not come back while it is still queued.
   */
  it('starts the second only once the first is through, and stays busy meanwhile', async () => {
    const gates: Array<() => void> = [];
    mocks.deps = fakeDeps(files, {
      files: {
        ...files.api,
        write: async (path: string, contents: string) => {
          await new Promise<void>((resolve) => gates.push(resolve));
          await files.api.write(path, contents);
        },
      },
    });
    loadModifiedTournament();
    const view = await mount();

    act(() => {
      view.result.current.save();
      view.result.current.save();
    });
    await waitFor(() => expect(gates).toHaveLength(1));

    await act(async () => {
      gates[0]?.();
    });
    await waitFor(() => expect(gates).toHaveLength(2));
    expect(view.result.current.busy).toBe(true);

    await act(async () => {
      gates[1]?.();
    });
    await idle(view);

    expect(files.writes).toEqual([PATH, PATH]);
  });
});

describe('what the host is told', () => {
  it('warns when a new tournament could not be written to the library', async () => {
    const view = await mount();
    files.failWrite(new TournamentFileError('permissionDenied', 'denied', null));

    await act(async () => {
      view.result.current.create('Vereinsturnier');
    });
    await idle(view);

    expect(view.result.current.notice).toEqual({
      kind: 'notWritten',
      errorKind: 'permissionDenied',
    });
    // Golden rule: the host keeps the tournament they just named.
    expect(tournamentStore.getState().document?.name).toBe('Vereinsturnier');
  });

  it('offers the newest backup for a file that would not parse', async () => {
    const broken = `${LIBRARY}\\broken.wattmatt`;
    files.disk.set(broken, 'not a tournament');
    files.setBackups([
      { path: `${broken}.bak1`, suffix: 'bak1', modifiedAt: 2, bytes: 10 },
      { path: `${broken}.bak2`, suffix: 'bak2', modifiedAt: 1, bytes: 10 },
    ]);
    const view = await mount();

    await act(async () => {
      view.result.current.openAt(broken);
    });
    await idle(view);

    expect(view.result.current.notice).toMatchObject({
      kind: 'openFailed',
      reason: 'invalid',
      path: broken,
    });
    expect(tournamentStore.getState().document).toBeNull();
  });

  it('clears the notice when the host dismisses it', async () => {
    const view = await mount();
    files.failRead(new TournamentFileError('notFound', 'gone', PATH));
    await act(async () => {
      view.result.current.openAt(PATH);
    });
    await idle(view);

    await act(async () => {
      view.result.current.dismissNotice();
    });

    expect(view.result.current.notice).toBeNull();
  });

  /**
   * CLAUDE.md §7: the feature has to work with a tournament loaded mid-event,
   * not only from a cold start. Opening one and saving it again must leave the
   * rounds, tables and bracket exactly as they were.
   */
  it('saves a tournament that is in the middle of its bracket phase unchanged', async () => {
    const opened = midTournament();
    setOpenedDocument(tournamentStore, opened, PATH);
    tournamentStore.commit((state) => ({
      document: state.document === null ? null : { ...state.document, rngCursor: 18 },
    }));
    const view = await mount();

    await act(async () => {
      view.result.current.save();
    });
    await idle(view);

    expect(JSON.parse(files.disk.get(PATH) ?? '{}')).toMatchObject({
      rngCursor: 18,
      bracket: { size: 4, thirdPlaceNodeId: 'bn_2' },
      rounds: opened.rounds,
      tables: opened.tables,
      log: opened.log,
    });
    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
  });
});

describe('the two native dialogs', () => {
  it('opens whatever the host picked in "Turnier öffnen"', async () => {
    const picked = `${LIBRARY}\\Gepickt.wattmatt`;
    files.disk.set(picked, serialiseTournament(midTournament(), '0.1.0'));
    mocks.deps = fakeDeps(files, {
      dialogs: { pickOpen: async () => picked, pickSave: async () => null },
    });
    const view = await mount();

    await act(async () => {
      view.result.current.openWithDialog();
    });
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: picked });
    expect(view.result.current.notice).toBeNull();
  });

  it('follows the tournament to the file "Speichern unter…" chose', async () => {
    const elsewhere = 'D:\\USB\\Kopie.wattmatt';
    mocks.deps = fakeDeps(files, {
      dialogs: { pickOpen: async () => null, pickSave: async () => elsewhere },
    });
    loadModifiedTournament();
    const view = await mount();

    await act(async () => {
      view.result.current.saveAs();
    });
    await idle(view);

    expect(files.writes).toEqual([elsewhere]);
    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: elsewhere });
    // The file it came from is left exactly as it was.
    expect(files.disk.get(PATH)).toBe('{}');
  });
});

describe('the autosave, end to end', () => {
  /**
   * The debounce itself is pinned in `autosave.test.ts`. What is only reachable
   * here is that a host decision really does reach the disk through the whole
   * stack — store, action, persistence, file — without anybody clicking save.
   */
  it('writes the tournament half a second after the host stops', async () => {
    vi.useFakeTimers();
    try {
      setOpenedDocument(tournamentStore, midTournament(), PATH);
      const view = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      await act(async () => {
        tournamentStore.commit((state) => ({
          document: state.document === null ? null : { ...state.document, rngCursor: 18 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });

      expect(files.writes).toEqual([PATH]);
      expect(JSON.parse(files.disk.get(PATH) ?? '{}')).toMatchObject({ rngCursor: 18 });
      expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
      expect(view.result.current.autosave.lastSavedAt).not.toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The issue's edge case: the tournament is on a USB stick and somebody pulls
   * it out. The host has to be told, loudly and persistently — an autosave that
   * quietly stopped working looks exactly like one that is working, right up to
   * the crash.
   */
  it('raises a warning the host cannot dismiss when it stops working', async () => {
    vi.useFakeTimers();
    try {
      setOpenedDocument(tournamentStore, midTournament(), PATH);
      const view = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      files.failWrite(new TournamentFileError('notFound', 'the stick is gone', PATH));

      await act(async () => {
        tournamentStore.commit((state) => ({
          document: state.document === null ? null : { ...state.document, rngCursor: 18 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });

      expect(view.result.current.notice).toEqual({
        kind: 'autosaveFailed',
        errorKind: 'notFound',
      });

      // Dismissing it is refused while the condition is still true.
      await act(async () => {
        view.result.current.dismissNotice();
      });
      expect(view.result.current.notice).toMatchObject({ kind: 'autosaveFailed' });

      // The stick is back in, and the warning goes by itself.
      files.failWrite(null);
      await act(async () => {
        tournamentStore.commit((state) => ({
          document: state.document === null ? null : { ...state.document, rngCursor: 19 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });

      expect(view.result.current.notice).toBeNull();
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * The warning must survive everything else the host does. A stored notice
   * would be overwritten by the next operation that reports anything — and a
   * *dismissible* notice in its place is how an event carries on with nothing
   * being written and no sign of it.
   */
  it('keeps warning even after another failure has been reported and dismissed', async () => {
    vi.useFakeTimers();
    try {
      setOpenedDocument(tournamentStore, midTournament(), PATH);
      const view = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      files.failWrite(new TournamentFileError('notFound', 'the stick is gone', PATH));
      await act(async () => {
        tournamentStore.commit((state) => ({
          document: state.document === null ? null : { ...state.document, rngCursor: 18 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });

      // The host tries "Turnier speichern" themselves, and that fails too.
      await act(async () => {
        view.result.current.save();
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        view.result.current.dismissNotice();
      });

      expect(view.result.current.notice).toEqual({
        kind: 'autosaveFailed',
        errorKind: 'notFound',
      });
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * Issue #10 acceptance criterion: "autosave never blocks the UI thread or
   * delays a host click". The autosave shares the operation queue so it cannot
   * race a manual save onto the same path, but it must never put the toolbar
   * into its disabled state — a host whose controls grey out twice a second
   * while they work has an unusable machine.
   */
  it('never disables the toolbar, even with a write held open', async () => {
    vi.useFakeTimers();
    try {
      setOpenedDocument(tournamentStore, midTournament(), PATH);
      const view = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      const release = files.blockWrites();

      const seen: boolean[] = [];
      await act(async () => {
        tournamentStore.commit((state) => ({
          document: state.document === null ? null : { ...state.document, rngCursor: 18 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });
      seen.push(view.result.current.busy);

      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(0);
      });
      seen.push(view.result.current.busy);

      expect(seen).toEqual([false, false]);
      expect(files.writes).toEqual([PATH]);
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('crash recovery', () => {
  const CRASHED = `${LIBRARY}\\Gestern.wattmatt`;

  it('tells Rust which tournament a crash would have to hand back', async () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    await mount();

    expect(mocks.markSessionDocument).toHaveBeenCalledWith(PATH);
  });

  it('names no tournament once there is none open', async () => {
    const view = await mount();

    await act(async () => {
      view.result.current.requestClose();
    });
    await idle(view);

    expect(mocks.markSessionDocument).toHaveBeenCalledWith(null);
  });

  /**
   * Issue #10 acceptance criterion, at the top of the stack: the last session
   * was killed, and the host is offered the tournament it was working on rather
   * than being told that something went wrong.
   */
  it('offers the tournament a killed session left behind', async () => {
    files.disk.set(CRASHED, serialiseTournament(midTournament(), '0.1.0'));
    mocks.recovery = { path: CRASHED, startedAt: 1_700_000_000_000 };

    const view = await mount();
    await waitFor(() => expect(view.result.current.recovery).not.toBeNull());

    await act(async () => {
      view.result.current.recover();
    });
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: CRASHED });
    expect(view.result.current.recovery).toBeNull();
    expect(mocks.dismissRecovery).toHaveBeenCalledTimes(1);
  });

  /**
   * The acceptance criterion in full: "killing the process mid-round and
   * restarting recovers every decided result". The two halves are played out
   * against the same fake disk — a session that autosaves a decision and is
   * then killed, and a fresh window that finds the marker and opens what the
   * autosave left. Asserting only that the offer opens *a* file would pass even
   * if the autosave had written nothing.
   */
  it('brings back the results that were decided before the kill', async () => {
    vi.useFakeTimers();
    try {
      // The session that dies. It opens a tournament, the host decides
      // something, and the autosave writes it.
      files.disk.set(CRASHED, serialiseTournament(midTournament(), '0.1.0'));
      setOpenedDocument(tournamentStore, midTournament(), CRASHED);
      const killed = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        tournamentStore.commit((state) => ({
          document:
            state.document === null
              ? null
              : { ...state.document, name: 'Vereinsturnier 2026', rngCursor: 42 },
        }));
        await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      });
      expect(mocks.markSessionDocument).toHaveBeenCalledWith(CRASHED);

      // The kill: no clean exit, so the marker Rust wrote is still there. The
      // in-memory tournament goes with the process.
      killed.unmount();
      closeDocument(tournamentStore);
      expect(mocks.endSession).not.toHaveBeenCalled();

      // The restart.
      mocks.recovery = { path: CRASHED, startedAt: 1_700_000_000_000 };
      const restarted = renderHook(() => useTournamentDocument());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        restarted.result.current.recover();
        await vi.advanceTimersByTimeAsync(0);
      });

      const recovered = tournamentStore.getState().document;
      expect(recovered?.name).toBe('Vereinsturnier 2026');
      expect(recovered?.rngCursor).toBe(42);
      // The whole tournament, not just the fields the decision touched.
      expect(recovered?.rounds.flatMap((round) => round.matches)).toHaveLength(3);
      restarted.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers nothing after a clean exit', async () => {
    const view = await mount();

    expect(view.result.current.recovery).toBeNull();
  });

  /**
   * Declining forgets the offer without touching the marker this run wrote: the
   * app is still running, and a crash in the next minute must still be
   * recoverable.
   */
  it('drops the offer when the host declines it', async () => {
    mocks.recovery = { path: CRASHED, startedAt: 1 };
    const view = await mount();
    await waitFor(() => expect(view.result.current.recovery).not.toBeNull());

    await act(async () => {
      view.result.current.declineRecovery();
    });

    expect(view.result.current.recovery).toBeNull();
    expect(mocks.dismissRecovery).toHaveBeenCalledTimes(1);
    expect(mocks.endSession).not.toHaveBeenCalled();
    expect(tournamentStore.getState().document).toBeNull();
  });
});

describe('the window going away', () => {
  it('stops listening for close requests when it unmounts', async () => {
    const view = await mount();
    expect(mocks.closeHandlers).toHaveLength(1);

    view.unmount();

    expect(mocks.closeHandlers).toHaveLength(0);
  });

  /**
   * The registration is asynchronous, so a window closed before it completes
   * would otherwise leave a handler behind on a component that no longer
   * exists — and React would report the state update it makes.
   */
  it('stops listening even when it unmounts before the registration lands', async () => {
    const view = renderHook(() => useTournamentDocument());

    view.unmount();
    await act(async () => {});

    expect(mocks.closeHandlers).toHaveLength(0);
  });

  /**
   * A library that cannot be listed is an empty start screen, not a dead host
   * window: the host can still create a tournament and save it elsewhere.
   */
  it('survives a library it cannot even locate', async () => {
    const failing = fakeDeps(files);
    mocks.deps = {
      ...failing,
      files: { ...failing.files, directory: async () => Promise.reject(new Error('no profile')) },
    };

    const view = renderHook(() => useTournamentDocument());
    await act(async () => {});

    expect(view.result.current.library).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});

/**
 * The `.wattmatt` file association of issue #31.
 *
 * A tournament can now arrive without anybody clicking anything in WattMatt —
 * from Explorer, either into a process that is starting or into one that is
 * already running an event. The second case is the one worth testing hardest:
 * the wrong answer there is a round in progress being replaced by whatever file
 * somebody double-clicked.
 */
describe('a tournament opened from Explorer', () => {
  const OTHER = `${LIBRARY}\\Gestern.wattmatt`;

  beforeEach(() => {
    files.disk.set(PATH, serialiseTournament(midTournament(), '0.1.0'));
    files.disk.set(OTHER, serialiseTournament(midTournament(), '0.1.0'));
  });

  it('opens the file the app was started with', async () => {
    mocks.startupDocument = PATH;

    const view = await mount();
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
  });

  it('reaches the start screen when it was started with nothing', async () => {
    const view = await mount();
    await idle(view);

    expect(tournamentStore.getState().document).toBeNull();
  });

  /**
   * Restarting by double-clicking the tournament WattMatt died on is the
   * shortest way back into an event. Offering to recover what is already open
   * would be one more thing to dismiss while the room waits.
   */
  it('does not also offer to recover the file it was just asked to open', async () => {
    mocks.startupDocument = PATH;
    mocks.recovery = { path: PATH, startedAt: 1_700_000_000_000 };

    const view = await mount();
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(view.result.current.recovery).toBeNull();
  });

  it('still offers a recovery of a different tournament', async () => {
    mocks.startupDocument = PATH;
    mocks.recovery = { path: OTHER, startedAt: 1_700_000_000_000 };

    const view = await mount();
    await idle(view);
    await waitFor(() => expect(view.result.current.recovery).not.toBeNull());

    expect(view.result.current.recovery?.path).toBe(OTHER);
  });

  it('opens a file a second instance hands over when nothing is open', async () => {
    const view = await mount();
    await waitFor(() => expect(mocks.openRequests).toHaveLength(1));

    await act(async () => {
      mocks.openRequests[0]?.(PATH);
    });
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
  });

  /**
   * The one that decides whether a live event survives a misclick in Explorer.
   * The open tournament stays exactly where it was, and the host is told why
   * nothing happened — from Explorer the double-click looks like a no-op.
   */
  it('refuses to swap a tournament that is already open, and says so', async () => {
    setOpenedDocument(tournamentStore, midTournament(), OTHER);
    const view = await mount();
    await waitFor(() => expect(mocks.openRequests).toHaveLength(1));

    await act(async () => {
      mocks.openRequests[0]?.(PATH);
    });
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: OTHER });
    expect(problemStore.getState().map((problem) => problem.kind)).toEqual(['documentAlreadyOpen']);
  });

  /**
   * Double-clicking the tournament that is already open: the second instance
   * has raised this window, which is all the host wanted. Complaining about it
   * would be the app scolding somebody for asking for what they already have.
   */
  it('says nothing when the file handed over is the one already open', async () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const view = await mount();
    await waitFor(() => expect(mocks.openRequests).toHaveLength(1));

    await act(async () => {
      mocks.openRequests[0]?.(PATH);
    });
    await idle(view);

    expect(tournamentStore.getState().file).toEqual({ status: 'saved', path: PATH });
    expect(problemStore.getState()).toHaveLength(0);
  });

  it('stops listening once the window is gone', async () => {
    const view = await mount();
    await waitFor(() => expect(mocks.openRequests).toHaveLength(1));

    view.unmount();
    await act(async () => {});

    expect(mocks.openRequests).toHaveLength(0);
  });
});
