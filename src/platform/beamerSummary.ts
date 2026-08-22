import type { BeamerStatus, MonitorInfo } from '@/platform/beamerWindow';

/**
 * Turns a raw beamer status into the one thing the host needs to read at a
 * glance: is the audience seeing what it should, and if not, why not.
 *
 * Pure and separate from the panel that renders it, because "the projector fell
 * out and nobody noticed" is a bug worth unit-testing rather than eyeballing.
 * Nothing here produces text — the kinds below are mapped to German in the
 * component (CLAUDE.md §1).
 */

/** The beamer is laid out for 16:9 and letterboxed on anything else. */
const BEAMER_ASPECT_RATIO = 16 / 9;

/**
 * Half a percent. Wide enough that 1366×768 (1.7786) counts as 16:9, narrow
 * enough that 16:10 (1.6) and 4:3 (1.333) do not.
 */
const ASPECT_TOLERANCE = 0.005;

export type BeamerHint =
  /** Closed, but a monitor is standing by. */
  | 'closed'
  /** Closed and there is nowhere to project. */
  | 'closedNoSecondMonitor'
  /** Working as intended. */
  | 'projected'
  /** Projecting onto the laptop screen because the host asked for it. */
  | 'projectedOnPrimary'
  /** Windowed preview: this machine has one screen. */
  | 'previewNoSecondMonitor'
  /** Windowed preview: the chosen monitor disappeared. */
  | 'previewMonitorLost';

export interface BeamerSummary {
  hint: BeamerHint;
  /** `true` when the host should be looking at this rather than past it. */
  isWarning: boolean;
  /** The monitor the beamer is projected on, if any. */
  monitor: MonitorInfo | null;
  /**
   * `true` when the target monitor is not 16:9, so the scene is letterboxed
   * rather than reflowed (docs/STYLEGUIDE.md §3).
   */
  isLetterboxed: boolean;
  /** `true` when opening the beamer would land it on the laptop screen. */
  hasSecondMonitor: boolean;
}

/** Left to right, so the list matches how the monitors are physically arranged. */
export function sortMonitors(monitors: readonly MonitorInfo[]): MonitorInfo[] {
  return [...monitors].sort((a, b) => a.x - b.x || a.y - b.y);
}

export function findMonitor(
  monitors: readonly MonitorInfo[],
  monitorId: string | null,
): MonitorInfo | null {
  if (monitorId === null) {
    return null;
  }
  return monitors.find((monitor) => monitor.id === monitorId) ?? null;
}

export function isLetterboxed(monitor: MonitorInfo): boolean {
  return Math.abs(monitor.width / monitor.height - BEAMER_ASPECT_RATIO) > ASPECT_TOLERANCE;
}

export function summariseBeamer(status: BeamerStatus): BeamerSummary {
  const monitor = findMonitor(status.monitors, status.monitorId);
  const hasSecondMonitor = status.monitors.some((candidate) => !candidate.isPrimary);
  const base = {
    monitor,
    isLetterboxed: monitor !== null && isLetterboxed(monitor),
    hasSecondMonitor,
  };

  if (!status.open) {
    return {
      ...base,
      hint: hasSecondMonitor ? 'closed' : 'closedNoSecondMonitor',
      isWarning: false,
    };
  }

  if (status.placement === 'preview') {
    return {
      ...base,
      hint: status.reason === 'monitorLost' ? 'previewMonitorLost' : 'previewNoSecondMonitor',
      isWarning: true,
    };
  }

  // Projecting onto the laptop screen only ever happens because the host asked
  // for it (src-tauri/src/windows.rs never auto-selects the primary), but it
  // still hides the control panel, so it stays flagged.
  const onPrimary = monitor?.isPrimary === true;
  return {
    ...base,
    hint: onPrimary ? 'projectedOnPrimary' : 'projected',
    isWarning: onPrimary,
  };
}
