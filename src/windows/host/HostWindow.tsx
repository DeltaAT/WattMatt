import { useEffect } from 'react';

import { de } from '@/i18n';
import { setSleepInhibited } from '@/platform/beamerWindow';
import { BeamerControlPanel } from '@/windows/host/BeamerControlPanel';
import { useBeamerStatus } from '@/windows/useBeamerStatus';

/**
 * The control window on the laptop screen (docs/ARCHITECTURE.md §2).
 *
 * The real shell — phase navigation on the left, current round in the centre,
 * beamer column on the right (docs/STYLEGUIDE.md §4) — arrives with the phase
 * issues. What this issue owns is the right-hand column and the frame it sits
 * in, so the host has full control over the beamer from the first build.
 */
export function HostWindow() {
  const status = useBeamerStatus();

  useSleepInhibitor(status.open);

  return (
    <div className="flex h-full">
      <main className="flex flex-1 flex-col items-center justify-center gap-2">
        <h1 className="wm-display text-host-2xl font-bold">{de.app.name}</h1>
        <p className="text-host-sm text-wm-text-muted">{de.app.bootstrapNotice}</p>
      </main>

      <BeamerControlPanel status={status} />
    </div>
  );
}

/**
 * Holds off the screensaver and the display timeout while something is on the
 * projector (src-tauri/src/power.rs).
 *
 * "A tournament is running" is the condition the issue names, but there is no
 * tournament state yet — the store lands with issue #5. An open beamer is the
 * closest honest proxy: nothing is being presented while it is closed, and the
 * moment it opens the machine must stop dimming.
 */
function useSleepInhibitor(active: boolean): void {
  useEffect(() => {
    setSleepInhibited(active).catch((error: unknown) =>
      console.error('sleep inhibitor unavailable', error),
    );
  }, [active]);

  // Releasing on unmount as well would fight React's strict-mode double-invoke
  // for no benefit: Rust releases the state when the process exits, and the
  // host window living shorter than the app is not a case that exists.
}
