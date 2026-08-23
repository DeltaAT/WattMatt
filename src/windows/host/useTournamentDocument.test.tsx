// @vitest-environment jsdom

import { act, renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { midTournament } from '@/domain/testFixtures';
import type * as TauriPlatform from '@/platform/tauri';
import { TournamentFileError } from '@/platform/tournamentFile';
import { closeDocument, setNewDocument, setOpenedDocument } from '@/store/actions/document';
import { serialiseTournament, type PersistenceDeps } from '@/store/persistence';
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
  // The store outlives a window, so each test starts it back at the start
  // screen rather than inheriting the previous test's tournament.
  closeDocument(tournamentStore);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
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
  it('asks instead of closing when the tournament has moved on from its file', async () => {
    loadModifiedTournament();
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
    loadModifiedTournament();
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
    loadModifiedTournament();
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
    loadModifiedTournament();
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
    loadModifiedTournament();
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
    loadModifiedTournament();
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

  it('lets the window close when there is nothing to lose', async () => {
    setOpenedDocument(tournamentStore, midTournament(), PATH);
    const view = await mount();

    const event = requestWindowClose();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(view.result.current.pendingIntent).toBeNull();
  });

  it('turns the close into the question when there is', async () => {
    loadModifiedTournament();
    const view = await mount();

    let event!: { preventDefault: ReturnType<typeof vi.fn> };
    await act(async () => {
      event = requestWindowClose();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(view.result.current.pendingIntent).toBe('quit');
  });

  /**
   * The handler reads the dirty flag through a ref rather than a captured
   * value. A close arriving on the very commit that dirtied the tournament
   * must already see it — that gap is where the tournament gets lost.
   */
  it('sees a tournament that was dirtied after the handler was registered', async () => {
    const view = await mount();

    await act(async () => {
      loadModifiedTournament();
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
    loadModifiedTournament();
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
    loadModifiedTournament();
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
