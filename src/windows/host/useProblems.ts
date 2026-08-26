import { useEffect, useState, useSyncExternalStore } from 'react';

import { logDirectory } from '@/platform/log';
import { problemStore, type Problem, type ProblemKind } from '@/store/problems';
import { openLogFolder } from '@/windows/host/openLogFolder';

/**
 * The host's view of what has gone wrong, and its way into the log
 * (issue #30).
 *
 * A hook rather than a store subscription in the window, so the toast strip and
 * the "Protokoll öffnen" button are testable without a Tauri backend and
 * without a component tree that has to throw first.
 */
export interface ProblemsHandle {
  /** Newest first, one entry per kind. */
  problems: readonly Problem[];
  dismiss: (kind: ProblemKind) => void;
  /** Opens `%APPDATA%\WattMatt\logs` in Explorer. Never throws. */
  openLog: () => void;
  /** The folder itself, so it can be found without the button. */
  directory: string | null;
}

export function useProblems(): ProblemsHandle {
  // The third argument is the server snapshot: there is no server, and the
  // store reads from the first render. Without it `useSyncExternalStore` throws
  // whenever a host component is rendered to static markup, which is how they
  // are all tested.
  const problems = useSyncExternalStore(
    problemStore.subscribe,
    problemStore.getState,
    problemStore.getState,
  );

  const [directory, setDirectory] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Not awaited into state blindly: the window can be closed between asking
    // and answering, and setting state on an unmounted tree is exactly the kind
    // of warning that trains people to ignore warnings.
    void logDirectory().then((path) => {
      if (live) {
        setDirectory(path);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  return { problems, dismiss: problemStore.dismiss, openLog: openLogFolder, directory };
}
