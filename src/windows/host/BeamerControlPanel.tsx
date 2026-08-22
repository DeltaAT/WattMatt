import { useCallback } from 'react';

import { de } from '@/i18n';
import { summariseBeamer, sortMonitors, type BeamerHint } from '@/platform/beamerSummary';
import {
  closeBeamer,
  focusHost,
  openBeamer,
  type BeamerStatus,
  type MonitorInfo,
} from '@/platform/beamerWindow';

/**
 * The host's control over the beamer window (docs/ARCHITECTURE.md §2).
 *
 * Three things the host must be able to do at any moment, without the
 * tournament noticing: open the beamer, close it, and move it to a different
 * monitor. None of them touches tournament state (CLAUDE.md golden rule 4).
 *
 * The live preview thumbnail from docs/STYLEGUIDE.md §4 lands with issue #28,
 * on top of the snapshot channel issue #5 builds.
 */

const HINT_TEXT: Record<BeamerHint, string> = {
  closed: de.beamerControl.status.closed,
  closedNoSecondMonitor: de.beamerControl.status.closedNoSecondMonitor,
  projected: de.beamerControl.status.projected,
  projectedOnPrimary: de.beamerControl.status.projectedOnPrimary,
  previewNoSecondMonitor: de.beamerControl.status.previewNoSecondMonitor,
  previewMonitorLost: de.beamerControl.status.previewMonitorLost,
};

export function BeamerControlPanel({
  status,
  beamerAlive,
}: {
  status: BeamerStatus;
  /**
   * Whether the beamer's WebView is answering the heartbeat (issue #5).
   *
   * Separate from `status.open`, and the more useful of the two: an open window
   * whose renderer has died still reports itself open while showing the
   * audience a frozen picture.
   */
  beamerAlive: boolean;
}) {
  const summary = summariseBeamer(status);
  const monitors = sortMonitors(status.monitors);

  // Every action is fire-and-forget: Rust answers with a status event, so the
  // panel never has to guess what happened. A rejected promise means the window
  // system refused, which issue #30 turns into a toast; swallowing it here
  // would at worst leave the panel one event behind, which the two-second
  // monitor poll corrects on its own.
  const run = useCallback((action: () => Promise<unknown>) => {
    action().catch((error: unknown) => console.error('beamer command failed', error));
  }, []);

  return (
    <section className="flex w-80 shrink-0 flex-col gap-4 border-l border-wm-border bg-wm-bg-elevated p-4">
      <h2 className="wm-label">{de.beamerControl.sectionLabel}</h2>

      <p
        className={`text-host-sm ${summary.isWarning ? 'text-wm-live' : 'text-wm-text-muted'}`}
        role={summary.isWarning ? 'alert' : undefined}
      >
        {HINT_TEXT[summary.hint]}
      </p>

      {summary.isLetterboxed ? (
        <p className="text-host-xs text-wm-text-faint">{de.beamerControl.letterboxNotice}</p>
      ) : null}

      <LivenessRow open={status.open} alive={beamerAlive} />

      <div className="flex gap-2">
        {status.open ? (
          <button type="button" className={ACTION_CLASS} onClick={() => run(() => closeBeamer())}>
            {de.beamerControl.close}
          </button>
        ) : (
          <button type="button" className={ACTION_CLASS} onClick={() => run(() => openBeamer())}>
            {de.beamerControl.open}
          </button>
        )}
        <button type="button" className={SECONDARY_CLASS} onClick={() => run(() => focusHost())}>
          {de.beamerControl.focusHost}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="wm-label">{de.beamerControl.monitorsLabel}</h3>
        {monitors.length === 0 ? (
          <p className="text-host-sm text-wm-text-faint">{de.beamerControl.noMonitors}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {monitors.map((monitor) => (
              <li key={monitor.id}>
                <MonitorButton
                  monitor={monitor}
                  isActive={monitor.id === status.monitorId && status.open}
                  // Picking a monitor both opens and moves the beamer — the
                  // host should not have to open it first to be allowed to
                  // choose where it goes.
                  onSelect={() => run(() => openBeamer(monitor.id))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The picture channel, as opposed to the window.
 *
 * Silence while the window is open is the case worth shouting about: the host
 * is looking at a control panel that says everything is fine, and the room is
 * looking at a screen that stopped updating.
 */
function LivenessRow({ open, alive }: { open: boolean; alive: boolean }) {
  const isWarning = open && !alive;
  const text = !open
    ? de.beamerControl.liveness.notRunning
    : alive
      ? de.beamerControl.liveness.alive
      : de.beamerControl.liveness.silent;

  return (
    <p
      className={`text-host-xs ${isWarning ? 'text-wm-live' : 'text-wm-text-faint'}`}
      role={isWarning ? 'alert' : undefined}
      data-liveness={!open ? 'closed' : alive ? 'alive' : 'silent'}
    >
      {`${de.beamerControl.liveness.label} ${text}`}
    </p>
  );
}

function MonitorButton({
  monitor,
  isActive,
  onSelect,
}: {
  monitor: MonitorInfo;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={onSelect}
      className={`flex w-full flex-col items-start gap-1 rounded-wm-md border px-3 py-2 text-left transition-colors duration-[--dur-fast] ease-out ${
        isActive
          ? 'border-wm-accent bg-wm-accent-soft'
          : 'border-wm-border bg-wm-surface hover:bg-wm-surface-hover'
      }`}
    >
      <span className="text-host-sm font-medium text-wm-text">
        {monitor.name ?? de.beamerControl.unnamedMonitor}
      </span>
      <span className="wm-tnum text-host-xs text-wm-text-faint">
        {monitor.width} × {monitor.height}
        {monitor.isPrimary ? ` · ${de.beamerControl.primaryMonitor}` : ''}
        {isActive ? ` · ${de.beamerControl.activeMonitor}` : ''}
      </span>
    </button>
  );
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const ACTION_CLASS =
  'h-10 flex-1 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong';

const SECONDARY_CLASS =
  'h-10 flex-1 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
