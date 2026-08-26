import { useEffect, useState } from 'react';

import { createHostTransport, mergeTransports } from '@/platform/windowSync';
import { HEARTBEAT_INTERVAL_MS, isBeamerAlive, watchHeartbeat } from '@/store/heartbeat';
import { beamerPreviewStore, previewChannel, tournamentStore } from '@/store/session';
import { startBeamerSync, startHostSync } from '@/store/sync';

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
    // The projector and the host's own preview, on one transport: two host
    // syncs would broadcast twice per commit and answer every catch-up request
    // twice (issue #28, `mergeTransports`).
    const transport = mergeTransports([createHostTransport(), previewChannel.host]);
    const sync = startHostSync(tournamentStore, transport);
    const watch = watchHeartbeat(transport, () => Date.now(), setLastBeatAt);

    // The preview is a beamer in every respect but one: it sends no heartbeat.
    // A liveness light that a preview could keep lit would say the projector is
    // fine while the room stares at a frozen picture — the exact failure the
    // heartbeat exists to catch (docs/ARCHITECTURE.md §3 "Liveness").
    const preview = startBeamerSync(beamerPreviewStore, previewChannel.beamer);

    return () => {
      sync.then((started) => started.stop(), reportHostSyncFailure);
      preview.then((started) => started.stop(), reportHostSyncFailure);
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
