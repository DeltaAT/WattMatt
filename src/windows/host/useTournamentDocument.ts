import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { isTauriRuntime } from '@/platform/tauri';
import type { BackupEntry, FileErrorKind, TournamentEntry } from '@/platform/tournamentFile';
import {
  closeTournamentDocument,
  createTournamentDocument,
  listRecentTournaments,
  openTournamentAt,
  openTournamentWithDialog,
  saveTournament,
  saveTournamentAs,
  type OpenFailure,
} from '@/store/persistence';
import { APP_VERSION, createPersistenceDeps } from '@/store/persistenceRuntime';
import { tournamentStore } from '@/store/session';
import { hasUnsavedChanges, type TournamentState } from '@/store/tournamentStore';

/**
 * The host's file operations, bound to the one store this window owns.
 *
 * All the decisions live in `@/store/persistence`, which is injectable and
 * tested. What is left here is genuinely React: which dialog is open, what the
 * start screen is listing, and the window's own close request — none of which
 * survives a reload and none of which belongs in the tournament.
 */

/** Something the host has to be told about, and act on. */
export type FileNotice =
  | { kind: 'openFailed'; reason: OpenFailure; path: string; backups: BackupEntry[] }
  | { kind: 'saveFailed'; errorKind: FileErrorKind }
  | { kind: 'notWritten'; errorKind: FileErrorKind };

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
  recents: TournamentEntry[];
  /** The default library, shown so the host can find it in Explorer. */
  library: string | null;
  notice: FileNotice | null;
  pendingIntent: PendingIntent | null;
  create: (name: string) => void;
  openWithDialog: () => void;
  openAt: (path: string) => void;
  save: () => void;
  saveAs: () => void;
  requestClose: () => void;
  answerUnsaved: (answer: UnsavedAnswer) => void;
  dismissNotice: () => void;
}

export function useTournamentDocument(): TournamentDocument {
  const state = useSyncExternalStore(tournamentStore.subscribe, tournamentStore.getState);
  const deps = useMemo(() => createPersistenceDeps(APP_VERSION), []);

  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<TournamentEntry[]>([]);
  const [library, setLibrary] = useState<string | null>(null);
  const [notice, setNotice] = useState<FileNotice | null>(null);
  const [pendingIntent, setPendingIntent] = useState<PendingIntent | null>(null);

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
   * dialog, so a save can still be issued while one is in flight. Two of them
   * racing onto the same path both go through the atomic write, and the one
   * that finishes second wins — which during an event is the older tournament
   * overwriting the newer one.
   *
   * `busy` therefore counts what is outstanding rather than tracking the last
   * caller: it has to stay on until the queue is empty, or the toolbar comes
   * back while an operation is still waiting its turn.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const outstanding = useRef(0);

  const run = useCallback((operation: () => Promise<void>) => {
    outstanding.current += 1;
    setBusy(true);
    queue.current = queue.current
      .then(operation)
      .catch(reportFailure)
      .finally(() => {
        outstanding.current -= 1;
        if (outstanding.current === 0) {
          setBusy(false);
        }
      });
  }, []);

  const create = useCallback(
    (name: string) => {
      run(async () => {
        const outcome = await createTournamentDocument(tournamentStore, deps, { name });
        setNotice(
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
        const outcome = await openTournamentAt(tournamentStore, deps, path);
        setNotice(outcome.status === 'failed' ? { kind: 'openFailed', ...outcome } : null);
      });
    },
    [deps, run],
  );

  const openWithDialog = useCallback(() => {
    run(async () => {
      const outcome = await openTournamentWithDialog(tournamentStore, deps);
      setNotice(outcome.status === 'failed' ? { kind: 'openFailed', ...outcome } : null);
    });
  }, [deps, run]);

  const save = useCallback(() => {
    run(async () => {
      const outcome = await saveTournament(tournamentStore, deps);
      setNotice(
        outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
      );
      refreshLibrary();
    });
  }, [deps, refreshLibrary, run]);

  const saveAs = useCallback(() => {
    run(async () => {
      const outcome = await saveTournamentAs(tournamentStore, deps);
      setNotice(
        outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
      );
      refreshLibrary();
    });
  }, [deps, refreshLibrary, run]);

  const requestClose = useCallback(() => {
    if (hasUnsavedChanges(tournamentStore.getState())) {
      setPendingIntent('close');
      return;
    }
    closeTournamentDocument(tournamentStore);
    setNotice(null);
    refreshLibrary();
  }, [refreshLibrary]);

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
            setNotice(
              outcome.status === 'failed' ? { kind: 'saveFailed', errorKind: outcome.kind } : null,
            );
            return;
          }
        }

        if (intent === 'quit') {
          await destroyHostWindow();
          return;
        }
        closeTournamentDocument(tournamentStore);
        setNotice(null);
        refreshLibrary();
      });
    },
    [deps, pendingIntent, refreshLibrary, run],
  );

  useCloseRequest(isDirty, () => setPendingIntent('quit'));

  return {
    state,
    isDirty,
    busy,
    recents,
    library,
    notice,
    pendingIntent,
    create,
    openWithDialog,
    openAt,
    save,
    saveAs,
    requestClose,
    answerUnsaved,
    dismissNotice: () => setNotice(null),
  };
}

/**
 * Turns the window's close button into a question when there is something to
 * lose.
 *
 * The dirty flag is read through a ref rather than captured: re-registering the
 * handler on every commit would leave a window in the gap between the two
 * listeners, and a close that lands in that gap takes the tournament with it.
 */
function useCloseRequest(isDirty: boolean, onBlocked: () => void): void {
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const stop = await getCurrentWindow().onCloseRequested((event) => {
        if (!dirtyRef.current) {
          return;
        }
        event.preventDefault();
        blockedRef.current();
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

function reportFailure(error: unknown): void {
  // Never thrown onward: a failed listing must not take the host window down
  // mid-event. Proper surfacing lands with issue #30.
  console.error('tournament file operation failed', error);
}
