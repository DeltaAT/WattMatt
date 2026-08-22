import { describe, expect, it } from 'vitest';

import {
  findMonitor,
  isLetterboxed,
  sortMonitors,
  summariseBeamer,
} from '@/platform/beamerSummary';
import type { BeamerStatus, MonitorInfo } from '@/platform/beamerWindow';

function monitor(overrides: Partial<MonitorInfo> & Pick<MonitorInfo, 'id'>): MonitorInfo {
  return {
    name: overrides.id,
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    isPrimary: false,
    ...overrides,
  };
}

const laptop = monitor({ id: 'laptop', isPrimary: true });
const projector = monitor({ id: 'projector', x: 1920 });

function status(overrides: Partial<BeamerStatus>): BeamerStatus {
  return {
    open: true,
    placement: 'projected',
    reason: 'autoSelected',
    monitorId: 'projector',
    monitors: [laptop, projector],
    ...overrides,
  };
}

describe('sortMonitors', () => {
  it('orders monitors left to right, then top to bottom', () => {
    const stacked = monitor({ id: 'above', x: 1920, y: -1080 });
    const ordered = sortMonitors([projector, laptop, stacked]);
    expect(ordered.map((entry) => entry.id)).toEqual(['laptop', 'above', 'projector']);
  });

  it('does not mutate its input', () => {
    const input = [projector, laptop];
    sortMonitors(input);
    expect(input.map((entry) => entry.id)).toEqual(['projector', 'laptop']);
  });
});

describe('findMonitor', () => {
  it('resolves an id against the current list', () => {
    expect(findMonitor([laptop, projector], 'projector')).toBe(projector);
  });

  // The remembered id survives a replug; the monitor may not.
  it('returns null for an id that is no longer attached', () => {
    expect(findMonitor([laptop], 'projector')).toBeNull();
    expect(findMonitor([laptop], null)).toBeNull();
  });
});

describe('isLetterboxed', () => {
  it('accepts the 16:9 resolutions a projector actually reports', () => {
    expect(isLetterboxed(monitor({ id: '1080p' }))).toBe(false);
    expect(isLetterboxed(monitor({ id: '720p', width: 1280, height: 720 }))).toBe(false);
    expect(isLetterboxed(monitor({ id: '4k', width: 3840, height: 2160 }))).toBe(false);
    // 1366×768 is 1.7786, not exactly 1.7778 — the tolerance exists for it.
    expect(isLetterboxed(monitor({ id: 'wxga', width: 1366, height: 768 }))).toBe(false);
  });

  it('flags the shapes that get letterboxed', () => {
    expect(isLetterboxed(monitor({ id: '4:3', width: 1024, height: 768 }))).toBe(true);
    expect(isLetterboxed(monitor({ id: '16:10', width: 1920, height: 1200 }))).toBe(true);
    expect(isLetterboxed(monitor({ id: '21:9', width: 2560, height: 1080 }))).toBe(true);
    expect(isLetterboxed(monitor({ id: 'portrait', width: 1080, height: 1920 }))).toBe(true);
  });
});

describe('summariseBeamer', () => {
  it('reports a projected beamer as unremarkable', () => {
    const summary = summariseBeamer(status({}));
    expect(summary).toMatchObject({
      hint: 'projected',
      isWarning: false,
      isLetterboxed: false,
      hasSecondMonitor: true,
    });
    expect(summary.monitor).toBe(projector);
  });

  it('flags a beamer the host put on the laptop screen', () => {
    const summary = summariseBeamer(status({ monitorId: 'laptop', reason: 'hostChoice' }));
    expect(summary.hint).toBe('projectedOnPrimary');
    expect(summary.isWarning).toBe(true);
  });

  it('flags the single-monitor preview', () => {
    const summary = summariseBeamer(
      status({
        placement: 'preview',
        reason: 'noSecondMonitor',
        monitorId: null,
        monitors: [laptop],
      }),
    );
    expect(summary.hint).toBe('previewNoSecondMonitor');
    expect(summary.isWarning).toBe(true);
    expect(summary.hasSecondMonitor).toBe(false);
  });

  // The projector was unplugged mid-session. This must read differently from
  // "this laptop only ever had one screen".
  it('distinguishes a lost monitor from a machine that never had one', () => {
    const summary = summariseBeamer(
      status({ placement: 'preview', reason: 'monitorLost', monitorId: null, monitors: [laptop] }),
    );
    expect(summary.hint).toBe('previewMonitorLost');
    expect(summary.isWarning).toBe(true);
  });

  it('reports a closed beamer without alarming the host', () => {
    expect(summariseBeamer(status({ open: false, monitorId: null }))).toMatchObject({
      hint: 'closed',
      isWarning: false,
      hasSecondMonitor: true,
    });
  });

  it('tells a closed beamer with nowhere to go apart from one that has a monitor waiting', () => {
    expect(summariseBeamer(status({ open: false, monitorId: null, monitors: [laptop] })).hint).toBe(
      'closedNoSecondMonitor',
    );
  });

  it('announces letterboxing on a projector that is not 16:9', () => {
    const wide = monitor({ id: 'ultrawide', x: 1920, width: 2560, height: 1080 });
    const summary = summariseBeamer(status({ monitorId: 'ultrawide', monitors: [laptop, wide] }));
    expect(summary.isLetterboxed).toBe(true);
    // Letterboxing is expected behaviour, not a fault — it must not shout.
    expect(summary.isWarning).toBe(false);
  });

  it('survives a status whose monitorId is no longer in the list', () => {
    const summary = summariseBeamer(status({ monitors: [laptop] }));
    expect(summary.monitor).toBeNull();
    expect(summary.isLetterboxed).toBe(false);
    expect(summary.hint).toBe('projected');
  });
});
