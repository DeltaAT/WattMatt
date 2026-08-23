import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  dismissRecovery,
  endSession,
  markSessionDocument,
  pendingRecovery,
  type RecoveryOffer,
} from '@/platform/session';
import { isTauriRuntime } from '@/platform/tauri';
import type { BackupEntry, FileErrorKind, TournamentEntry } from '@/platform/tournamentFile';
import { IDLE_AUTOSAVE, startAutosave, type Autosave, type AutosaveState } from '@/store/autosave';
import {
  autosaveTournament,
  closeTournamentDocument,
  createTournamentDocument,
  listRecentTournaments,
  openTournamentAt,
  openTournamentWithDialog,
  saveTournament,
  saveTournamentAs,
  type OpenFailure,
  type OpenOutcome,
} from '@/store/persistence';
import { APP_VERSION, createPersistenceDeps } from '@/store/persistenceRuntime';
import { tournamentStore } from '@/store/session';
import { filePath, hasUnsavedChanges, type TournamentState } from '@/store/tournamentStore';

/**
 * The host's file operations, bound to the one store this window owns.
 *
 * All the decisions live in `@/store/persistence` and `@/store/autosave`, both
 * of which are injectable and tested. What is left here is genuinely React:
 * which dialog is open, what the start screen is listing, and the window's own
 * close request — none of which survives a reload and none of which belongs in
 * the tournament.
 */

/** Something the host has to be told about, and act on. */
export type FileNotice =
  | { kind: 'openFailed'; reason: OpenFailure; path: string; backups: BackupEntry[] }
  | { kind: 'saveFailed'; errorKind: FileErrorKind }
  | { kind: 'notWritten'; errorKind: FileErrorKind }
  /**
   * A file from an older schema was brought up to date on the way in
   * (docs/FILE-FORMAT.md rule 7). Not a failure — the tournament is open — but
   * the host is told, because the file on their stick is about to be written in
   * a format an older laptop cannot read.
   */
  | { kind: 'migrated'; from: number }
  /**
   * The autosave stopped working — a stick pulled out, a file locked. Unlike
   * the others this one cannot be dismissed: it describes a condition that is
   * still true, and a host who clicked it away would be running an event with
   * nothing being written (issue #10, "never a silent no-op").
   */
  | { kind: 'autosaveFailed'; errorKind: FileErrorKind };

/**
 * What the host was doing when the unsaved-changes question interrupted them.
 * The answer decides where they end up, so it cannot be a plain boolean.
 */
export type PendingIntent = 'close' | 'quit';

export type UnsavedAnswer = 'save' | 'discard' | 'cancel';

export interface TournamentDocument {
  state: TournamentState;
  isDirty: boolean;
  /** Whether a file operation is in flight; the toolbar disables itself. */
  busy: boolean;
  /** What the background autosave is doing, for the discreet state line. */
  autosave: AutosaveState;
  recents: TournamentEntry[];
  /** The default library, shown so the host can find it in Explorer. */
  library: string | null;
  notice: FileNotice | null;
  /** A tournament the last, killed session left behind (docs/FILE-FORMAT.md rule 5). */
  recovery: RecoveryOffer | null;
  pendingIntent: PendingIntent | null;
  create: (name: string) => void;
  openWithDialog: () => void;
  openAt: (path: string) => void;
  save: () => void;
  saveAs: () => void;
  requestClose: () => void;
  answerUnsaved: (answer: UnsavedAnswer) => void;
  dismissNotice: () => void;
  recover: () => void;
  declineRecovery: () => void;
}

export function useTournamentDocument(): TournamentDocument {
  const state = useSyncExternalStore(tournamentStore.subscribe, tournamentStore.getState);
  const deps = useMemo(() => createPersistenceDeps(APP_VERSION), []);

  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<TournamentEntry[]>([]);
  const [library, setLibrary] = useState<string | null>(null);
  /**
   * The notices that report one thing that already happened. The autosave's
   * warning is deliberately *not* in here — see `notice` below.
   */
  const [transientNotice, setTransientNotice] = useState<FileNotice | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);
  const [recovery, setRecovery] = useState<RecoveryOffer | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>(IDLE_AUTOSAVE);

  const isDirty = hasUnsavedChanges(state);

  const refreshLibrary = useCallback(() => {
    listRecentTournaments(deps).then(setRecents, reportFailure);
    deps.files.directory().then(setLibrary, reportFailure);
  }, [deps]);

  // The start screen is the first thing the host sees; the list has to be there
  // before they look for it, not after the first click.
  useEffect(refreshLibrary, [refreshLibrary]);

  /**
   * Runs one file operation, after every operation queued before it.
   *
   * Genuinely serialised, not merely flagged: `busy` disables the toolbar, but
   * it does not disable the window's close button or the unsaved-changes
   * dialog, so a save can still be issued while one is in flight — and from
   * issue #10 on, the autosave issues writes nobody clicked at all. Two of them
   * racing onto the same path both go through the atomic write, and the one
   * that finishes second wins — which during an event is the older tournament
   * overwriting the newer one.
   */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const enqueue = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    // Both handlers, so one failed operation does not strand the queue behind
    // it: the next thing the host clicks still has to happen.
    const next = queue.current.then(operation, operation);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  /**
   * The same queue, plus the busy flag.
   *
   * `busy` therefore counts what is outstanding rather than tracking the last
   * caller: it has to stay on until the queue is empty, or the toolbar comes
   * back while an operation is still waiting its turn. The autosave uses
   * `enqueue` directly and is deliberately *not* counted — a toolbar that
   * greyed itself out twice a second while the host worked would be unusable.
   */
  const outstanding = useRef(0);

  const run = useCallback(
    (operation: () => Promise<void>) => {
      outstanding.current += 1;
      setBusy(true);
      void enqueue(operation)
        .catch(reportFailure)
        .finally(() => {
          outstanding.current -= 1;
          if (outstanding.current === 0) {
            setBusy(false);
          }
        });
    },
    [enqueue],
  );

  /**
   * The debounced autosave, for this window's lifetime.
   *
   * Held in a ref as well as in state because the exit path has to flush it,
   * and the exit path runs from a Tauri event handler that never re-renders.
   */
  const autosave = useRef<Autosave | null>(null);

  useEffect(() => {
    const instance = startAutosave(tournamentStore, {
      save: () => enqueue(() => autosaveTournament(tournamentStore, deps)),
      now: () => Date.now(),
    });
    autosave.current = instance;
    setAutosaveState(instance.getState());
    const unsubscribe = instance.subscribe(setAutosaveState);

    return () => {
      unsubscribe();
      instance.stop();
      autosave.current = null;
    };
  }, [deps, enqueue]);

  /**
   * What the host is shown, with the autosave's warning on top.
   *
   * Derived rather than stored, and that is the whole point. A stored notice
   * is overwritten by the next file operation that reports anything — so a
   * failed manual save would replace the autosave warning with a *dismissible*
   * one, the host would dismiss it, and the event would carry on with nothing
   * being written and no sign of it. Deriving it makes "cannot be dismissed
   * while the autosave is broken" a property of the code rather than a promise
   * (issue #10, "never a silent no-op").
   *
   * The failure is a condition, not an event: it appears when writing stops
   * working and goes when a write succeeds, without anyone acting on it.
   */
  const notice: FileNotice | null =
    autosaveState.failure === null
      ? transientNotice
      : { kind: 'autosaveFailed', errorKind: autosaveState.failure };

  // A one-off notice from before the autosave broke has been overtaken by it,
  // and must not resurface as news once the warning clears.
  useEffect(() => {
    if (autosaveState.failure !== null) {
      setTransientNotice(null);
    }
  }, [autosaveState.failure]);

  // Which tournament a crash would have to hand back (src-tauri/src/session.rs).
  // Keyed on the path rather than on every commit: the marker records *where*
  // the tournament is, and what is at that path is the autosave's business.
  const documentPath = filePath(state.file);
  useEffect(() => {
    void markSessionDocument(documentPath);
  }, [documentPath]);

  // What the *last* run left behind. Asked once, before the host has done
  // anything they could lose by being interrupted.
  useEffect(() => {
    pendingRecovery().then(setRecovery, reportFailure);
  }, []);

  const create = useCallback(
    (name: string) => {
      run(async () => {
        const outcome = await createTournamentDocument(tournamentStore, deps, { name });
        setTransientNotice(
          outcome.status === 'unwritten' ? { kind: 'notWritten', errorKind: outcome.kind } : null,
        );
        refreshLibrary();
      });
    },
    [deps, refreshLibrary, run],
  );

  const openAt = useCallback(
    (path: string) => {
      run(async () => {
        setTransientNotice(noticeForOpen(await openTournamentAt(tournamentStore, deps, path)));
      });
    },
    [deps, run],
  );

  const openWithDialog = useCallback(() => {
    run(async () => {
      setTransientNotice(noticeForOpen(await openTournamentWithDialog(tournamentStore, deps)));
    });
  }, [deps, run]);

  const save = useCallback(() => {
    run(async () => {
      const outcome = await saveTournament(tournamentStore, deps);
      setTransientNotice(
        outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
      );
      refreshLibrary();
    });
  }, [deps, refreshLibrary, run]);

  const saveAs = useCallback(() => {
    run(async () => {
      const outcome = await saveTournamentAs(tournamentStore, deps);
      setTransientNotice(
        outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
      );
      refreshLibrary();
    });
  }, [deps, refreshLibrary, run]);

  const finishDocument = useCallback(() => {
    closeTournamentDocument(tournamentStore);
    setTransientNotice(null);
    refreshLibrary();
  }, [refreshLibrary]);

  /**
   * Closing the tournament.
   *
   * The flush comes first and is deliberately *outside* the queue: a debounce
   * that was still counting is work the host has already done, and asking them
   * "unsaved changes?" about it — or worse, discarding it — would be the app
   * losing a round it had simply not got round to writing.
   */
  const requestClose = useCallback(() => {
    void flushThen(autosave, () => {
      if (hasUnsavedChanges(tournamentStore.getState())) {
        setPendingIntent('close');
        return;
      }
      finishDocument();
    });
  }, [finishDocument]);

  const quit = useCallback(async () => {
    // The marker is cleared before the window goes, so the next start knows
    // this exit was chosen rather than survived.
    await endSession();
    await destroyHostWindow();
  }, []);

  const answerUnsaved = useCallback(
    (answer: UnsavedAnswer) => {
      const intent = pendingIntent;
      setPendingIntent(null);
      if (intent === null || answer === 'cancel') {
        return;
      }

      run(async () => {
        if (answer === 'save') {
          const outcome = await saveTournament(tournamentStore, deps);
          // A save the host cancelled, or one that failed, must not be followed
          // by the close they only agreed to on the strength of it.
          if (outcome.status !== 'saved') {
            setTransientNotice(
              outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
            );
            return;
          }
        }

        if (intent === 'quit') {
          await quit();
          return;
        }
        finishDocument();
      });
    },
    [deps, finishDocument, pendingIntent, quit, run],
  );

  /**
   * The window's own close button (issue #10: "forced immediate save on … app
   * exit").
   *
   * Always intercepted, even when nothing is dirty: the session marker has to
   * be cleared before the process goes, or the next start greets the host with
   * a recovery offer for a tournament nothing happened to.
   */
  const requestQuit = useCallback(() => {
    void flushThen(autosave, () => {
      if (hasUnsavedChanges(tournamentStore.getState())) {
        setPendingIntent('quit');
        return;
      }
      void quit();
    });
  }, [quit]);

  useCloseRequest(requestQuit);

  const recover = useCallback(() => {
    const offer = recovery;
    setRecovery(null);
    void dismissRecovery();
    if (offer !== null) {
      openAt(offer.path);
    }
  }, [openAt, recovery]);

  const declineRecovery = useCallback(() => {
    setRecovery(null);
    void dismissRecovery();
  }, []);

  return {
    state,
    isDirty,
    busy,
    autosave: autosaveState,
    recents,
    library,
    notice,
    recovery,
    pendingIntent,
    create,
    openWithDialog,
    openAt,
    save,
    saveAs,
    requestClose,
    answerUnsaved,
    // Only ever reaches a one-off notice: the autosave warning is derived and
    // its component offers no dismiss button at all.
    dismissNotice: () => setTransientNotice(null),
    recover,
    declineRecovery,
  };
}

/**
 * Writes whatever the debounce was holding, then continues.
 *
 * Deliberately not queued through `run`: `flush` waits on the same queue, so a
 * flush issued from inside a queued operation would wait for itself.
 */
async function flushThen(autosave: { current: Autosave | null }, next: () => void): Promise<void> {
  try {
    await autosave.current?.flush();
  } catch (error) {
    // A flush that failed has already set the autosave's failure state, which
    // is what the host sees. It must not stop them from closing.
    reportFailure(error);
  }
  next();
}

/**
 * Turns the window's close button into something this app decides about.
 *
 * The handler is read through a ref rather than captured: re-registering it on
 * every commit would leave a window in the gap between the two listeners, and a
 * close that lands in that gap takes the tournament with it.
 */
function useCloseRequest(onClose: () => void): void {
  const handler = useRef(onClose);
  handler.current = onClose;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const stop = await getCurrentWindow().onCloseRequested((event) => {
        // Always: the close is completed by `destroy` once the pending autosave
        // has landed and the session marker is gone.
        event.preventDefault();
        handler.current();
      });
      if (cancelled) {
        stop();
        return;
      }
      unlisten = stop;
    })().catch(reportFailure);

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/**
 * Closes for real, after the host has answered.
 *
 * `destroy` rather than `close`: `close` raises another close request, which
 * this window has just been told to intercept.
 */
async function destroyHostWindow(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().destroy();
}

/**
 * What an open has to say for itself.
 *
 * `null` for the ordinary case, which is what clears whatever the last
 * operation left on screen. A migration is the one *successful* open that still
 * puts something there.
 */
function noticeForOpen(outcome: OpenOutcome): FileNotice | null {
  if (outcome.status === 'failed') {
    return { kind: 'openFailed', ...outcome };
  }
  if (outcome.status === 'opened' && outcome.migratedFrom !== null) {
    return { kind: 'migrated', from: outcome.migratedFrom };
  }
  return null;
}

function reportFailure(error: unknown): void {
  // Never thrown onward: a failed listing must not take the host window down
  // mid-event. Proper surfacing lands with issue #30.
  console.error('tournament file operation failed', error);
}
