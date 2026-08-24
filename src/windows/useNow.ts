import { useEffect, useState } from 'react';

import type { Timestamp } from '@/domain/types';
import { systemClock } from '@/platform/clock';

/** One tick a second: the occupancy board counts in seconds and no finer. */
const TICK_MS = 1000;

/**
 * The wall clock, re-read every second, for the parts of the UI that count.
 *
 * The occupancy board shows how long a match has been running, and that number
 * has to move without anybody clicking. Everything that decides anything still
 * goes through the injected `Clock` (docs/ARCHITECTURE.md §5) — this is a
 * *display* clock, and nothing derived from it is ever committed.
 *
 * `enabled` is what keeps a setup screen with no running match from re-rendering
 * once a second for an hour before the doors open.
 */
export function useNow(enabled: boolean): Timestamp {
  const [now, setNow] = useState<Timestamp>(() => systemClock.now());

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Read once on the way in as well: a board that has just appeared must not
    // show a stale second until the first interval fires.
    setNow(systemClock.now());
    const timer = setInterval(() => setNow(systemClock.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}
