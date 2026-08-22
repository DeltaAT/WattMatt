import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import type { BeamerStatus, MonitorInfo } from '@/platform/beamerWindow';
import { BeamerControlPanel } from '@/windows/host/BeamerControlPanel';

const laptop: MonitorInfo = {
  id: 'laptop',
  name: '\\\\.\\DISPLAY1',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
  isPrimary: true,
};

const projector: MonitorInfo = {
  ...laptop,
  id: 'projector',
  name: '\\\\.\\DISPLAY2',
  x: 1920,
  isPrimary: false,
};

function render(status: Partial<BeamerStatus>): string {
  return renderToStaticMarkup(
    <BeamerControlPanel
      status={{
        open: true,
        placement: 'projected',
        reason: 'autoSelected',
        monitorId: 'projector',
        monitors: [laptop, projector],
        ...status,
      }}
    />,
  );
}

describe('the beamer control panel', () => {
  it('offers to close a beamer that is open, and to open one that is not', () => {
    expect(render({})).toContain(de.beamerControl.close);
    expect(render({ open: false, monitorId: null })).toContain(de.beamerControl.open);
  });

  it('lists every attached monitor so the host can reassign at any time', () => {
    const markup = render({});
    expect(markup).toContain(laptop.name);
    expect(markup).toContain(projector.name);
    // The laptop screen is labelled as such: picking it by accident mid-event
    // would put the beamer scene over the controls.
    expect(markup).toContain(de.beamerControl.primaryMonitor);
  });

  it('marks the monitor the beamer is actually on', () => {
    expect(render({})).toContain('aria-pressed="true"');
    // Nothing is active while the beamer is closed, however well remembered
    // the host's choice is.
    expect(render({ open: false })).not.toContain('aria-pressed="true"');
  });

  /*
   * The single-monitor case has to be readable at a glance — this is what the
   * host sees when they arrive at a venue without a second output.
   */
  it('explains the single-monitor preview in German', () => {
    const markup = render({
      placement: 'preview',
      reason: 'noSecondMonitor',
      monitorId: null,
      monitors: [laptop],
    });
    expect(markup).toContain(de.beamerControl.status.previewNoSecondMonitor);
    expect(markup).toContain('role="alert"');
  });

  it('says something different when the projector was unplugged mid-session', () => {
    const markup = render({
      placement: 'preview',
      reason: 'monitorLost',
      monitorId: null,
      monitors: [laptop],
    });
    expect(markup).toContain(de.beamerControl.status.previewMonitorLost);
    expect(markup).not.toContain(de.beamerControl.status.previewNoSecondMonitor);
  });

  it('warns when the beamer is covering the host screen', () => {
    const markup = render({ monitorId: 'laptop', reason: 'hostChoice' });
    expect(markup).toContain(de.beamerControl.status.projectedOnPrimary);
    expect(markup).toContain(de.beamerControl.focusHost);
  });

  it('stays quiet when everything is as it should be', () => {
    expect(render({})).not.toContain('role="alert"');
  });

  it('announces letterboxing on a projector that is not 16:9', () => {
    const wide: MonitorInfo = { ...projector, width: 2560 };
    const markup = render({ monitorId: 'projector', monitors: [laptop, wide] });
    expect(markup).toContain(de.beamerControl.letterboxNotice);
    expect(render({})).not.toContain(de.beamerControl.letterboxNotice);
  });

  it('survives a machine that reports no monitors at all', () => {
    const markup = render({ open: false, monitorId: null, monitors: [] });
    expect(markup).toContain(de.beamerControl.noMonitors);
  });
});
