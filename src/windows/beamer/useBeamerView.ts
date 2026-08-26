import { useEffect, useSyncExternalStore } from 'react';

import { createBeamerTransport } from '@/platform/windowSync';
import type { BeamerViewState } from '@/store/beamerStore';
import { startHeartbeat } from '@/store/heartbeat';
import { reportProblem } from '@/store/problems';
import { beamerViewStore } from '@/store/session';
import { startBeamerSync } from '@/store/sync';

/**
 * The beamer's view of the tournament, kept live by the sync layer.
 *
 * Mounting starts the channel and asks the host for the current picture, which
 * is what makes reopening the beamer restore the scene rather than the idle
 * screen (CLAUDE.md golden rule 4).
 */
export function useBeamerView(): BeamerViewState {
  useEffect(() => {
    const transport = createBeamerTransport();
    const sync = startBeamerSync(beamerViewStore, transport);
    const stopHeartbeat = startHeartbeat(transport);

    return () => {
      stopHeartbeat();
      sync.then((started) => started.stop(), reportBeamerViewFailure);
    };
  }, []);

  return useSyncExternalStore(beamerViewStore.subscribe, beamerViewStore.getState);
}

function reportBeamerViewFailure(error: unknown): void {
  reportProblem('beamerSync', 'beamer.view-sync-failed', error);
}
