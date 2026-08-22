import { useEffect, useState } from 'react';

import { createHostTransport } from '@/platform/windowSync';
import { HEARTBEAT_INTERVAL_MS, isBeamerAlive, watchHeartbeat } from '@/store/heartbeat';
import { tournamentStore } from '@/store/session';
import { startHostSync } from '@/store/sync';

/**
 * Starts the host half of the channel and reports whether the beamer window is
 * answering (issue #5 tasks).
 *
 * The re-check on an interval is what turns silence into a reading: nothing
 * arrives when a beamer dies, so without a tick the panel would keep showing
 * the last beat forever.
 */
export function useBeamerAlive(): boolean {
  const [lastBeatAt, setLastBeatAt] = useState<number | null>(null);
  const [alive, setAlive] = useState(false);

  useEffect(() => {
    const transport = createHostTransport();
    const sync = startHostSync(tournamentStore, transport);
    const watch = watchHeartbeat(transport, () => Date.now(), setLastBeatAt);

    return () => {
      sync.then((started) => started.stop(), reportHostSyncFailure);
      watch.then((unlisten) => unlisten(), reportHostSyncFailure);
    };
  }, []);

  useEffect(() => {
    const check = () => setAlive(isBeamerAlive(lastBeatAt, Date.now()));
    check();
    const timer = setInterval(check, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [lastBeatAt]);

  return alive;
}

function reportHostSyncFailure(error: unknown): void {
  console.error('host sync failed', error);
}
