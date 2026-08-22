import { useEffect, useState } from 'react';

import {
  fetchBeamerStatus,
  onBeamerStatus,
  UNKNOWN_BEAMER_STATUS,
  type BeamerStatus,
} from '@/platform/beamerWindow';

/**
 * The current beamer placement, kept live.
 *
 * Both windows use it: the host to drive its control panel, the beamer to know
 * whether it is on a projector or in a windowed preview. It is *window* state,
 * not tournament state — the beamer holding a copy of it does not make it less
 * of a pure view (CLAUDE.md golden rule 4).
 *
 * Rust pushes changes, so an unplugged projector reaches the UI without anyone
 * clicking anything. The initial fetch exists for the case that matters after a
 * crash: a window that mounts long after the last change would otherwise sit on
 * the placeholder forever.
 */
export function useBeamerStatus(): BeamerStatus {
  const [status, setStatus] = useState<BeamerStatus>(UNKNOWN_BEAMER_STATUS);

  useEffect(() => {
    let mounted = true;
    const apply = (next: BeamerStatus) => {
      if (mounted) {
        setStatus(next);
      }
    };

    // A failure here is not fatal: the panel keeps showing "closed", which is
    // the reading that makes the host look at the projector rather than trust
    // it. Proper error surfacing lands with issue #30.
    fetchBeamerStatus().then(apply, reportBeamerFailure);
    const subscription = onBeamerStatus(apply);

    return () => {
      mounted = false;
      subscription.then((unlisten) => unlisten(), reportBeamerFailure);
    };
  }, []);

  return status;
}

function reportBeamerFailure(error: unknown): void {
  console.error('beamer status unavailable', error);
}
