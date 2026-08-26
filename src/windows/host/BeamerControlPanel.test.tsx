import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { BeamerScene } from '@/domain/beamerScene';
import { sceneChoices } from '@/domain/sceneCatalog';
import { round, tournament } from '@/domain/testFixtures';
import { de } from '@/i18n';
import type { BeamerStatus, MonitorInfo } from '@/platform/beamerWindow';
import { BeamerControlPanel } from '@/windows/host/BeamerControlPanel';
import type { BeamerControlHandle } from '@/windows/host/useBeamerControl';

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

const noop = () => {};

/**
 * A control handle standing in for the store-bound one.
 *
 * The hook is tested against the real store in `useBeamerControl.test`; what
 * is checked here is the panel — that every scene is on it, that the state of
 * the projector is legible, and that the two holds say which way round they are.
 */
function control(overrides: Partial<BeamerControlHandle> = {}): BeamerControlHandle {
  const scene: BeamerScene = overrides.scene ?? { id: 'IDLE' };
  return {
    scene,
    choices: sceneChoices(tournament({ rounds: [round(1)] })),
    autoFollow: true,
    frozen: false,
    isBlackout: scene.id === 'BLACKOUT',
    show: noop,
    showAt: noop,
    toggleBlackout: noop,
    setAutoFollow: noop,
    toggleFreeze: noop,
    skip: noop,
    isStaged: (choice) => choice.scene?.id === scene.id,
    ...overrides,
  };
}

function render(
  status: Partial<BeamerStatus>,
  beamerAlive = true,
  handle: BeamerControlHandle = control(),
  logDirectory: string | null = null,
): string {
  return renderToStaticMarkup(
    <BeamerControlPanel
      beamerAlive={beamerAlive}
      control={handle}
      onShowShortcuts={noop}
      onOpenLog={noop}
      logDirectory={logDirectory}
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
    expect(render({})).toContain(de.beamerControl.activeMonitor);
    // Nothing is active while the beamer is closed, however well remembered
    // the host's choice is.
    expect(render({ open: false })).not.toContain(de.beamerControl.activeMonitor);
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

describe('the beamer liveness readout', () => {
  it('raises an alert when an open beamer has stopped answering', () => {
    // The dangerous case: the window is open, the panel looks healthy, and the
    // room is staring at a picture that stopped updating.
    const markup = render({ open: true }, false);
    expect(markup).toContain(de.beamerControl.liveness.silent);
    expect(markup).toContain('data-liveness="silent"');
    expect(markup).toContain('role="alert"');
  });

  it('says so plainly while the beamer is answering', () => {
    const markup = render({ open: true }, true);
    expect(markup).toContain(de.beamerControl.liveness.alive);
    expect(markup).toContain('data-liveness="alive"');
  });

  it('does not cry wolf about a beamer nobody opened', () => {
    const markup = render({ open: false, monitorId: null }, false);
    expect(markup).toContain(de.beamerControl.liveness.notRunning);
    expect(markup).toContain('data-liveness="closed"');
  });
});

describe('the scene switcher', () => {
  /*
   * The issue's first acceptance criterion: any scene reachable within one
   * click at any time, in any phase.
   */
  it('puts every scene on the panel, with the digit that stages it', () => {
    const markup = render({});

    for (const choice of sceneChoices(tournament({ rounds: [round(1)] }))) {
      expect(markup).toContain(`data-scene="${choice.id}"`);
      expect(markup).toContain(de.beamerControl.sceneName[choice.id]);
    }
  });

  it('marks the one that is actually staged', () => {
    const markup = render({}, true, control({ scene: { id: 'BRACKET' } }));

    expect(markup).toContain('data-scene="BRACKET"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain(
      de.beamerControl.onScreen({ scene: de.beamerControl.sceneName.BRACKET }),
    );
  });

  /*
   * A `DRAW` before anything has been drawn is not a scene the host is being
   * denied, it is a scene that does not exist — and the button says so rather
   * than staging something else.
   */
  it('disables the two round scenes before the first draw, with the reason on them', () => {
    const markup = render({}, true, control({ choices: sceneChoices(tournament()) }));

    expect(markup).toContain('disabled=""');
    expect(markup).toContain(de.beamerControl.sceneUnavailable);
  });
});

describe('the two holds the host can put on the projector', () => {
  it('offers the blackout, and the way back out of it', () => {
    expect(render({})).toContain(de.beamerControl.blackout);
    expect(render({}, true, control({ scene: { id: 'BLACKOUT' }, isBlackout: true }))).toContain(
      de.beamerControl.blackoutRelease,
    );
  });

  it('says which way round the freeze is, and shouts while it is on', () => {
    expect(render({})).toContain(de.beamerControl.freeze.label);

    const frozen = render({}, true, control({ frozen: true }));
    expect(frozen).toContain(de.beamerControl.freeze.release);
    // A frozen preview looks exactly like a working one, so the panel has to
    // say so where the host is already looking.
    expect(frozen).toContain(de.beamerControl.freeze.badge);
    expect(frozen).toContain(de.beamerControl.freeze.hint);
  });

  it('reads out whether the beamer is following the tournament', () => {
    expect(render({})).toContain(de.beamerControl.autoFollow.on);
    expect(render({}, true, control({ autoFollow: false }))).toContain(
      de.beamerControl.autoFollow.off,
    );
  });

  it('offers the shortcut overview from the panel as well as from the keyboard', () => {
    expect(render({})).toContain(de.beamerControl.shortcuts.open);
  });

  /*
   * The log button (issue #30). It lives here rather than in the tournament
   * shell because the log outlives the tournament: a host who has closed the
   * file, or never opened one, still has to be able to reach it — which is
   * exactly the state they are in when they go looking for it after the event.
   */
  it('offers the log, with a tournament open and without one', () => {
    expect(render({})).toContain(de.log.open);
  });

  it('prints the folder as well, so it can be found without the button', () => {
    const path = 'C:\\Users\\host\\AppData\\Roaming\\WattMatt\\logs';

    expect(render({}, true, control(), path)).toContain(de.log.location({ path }));
  });

  /* In a plain browser there is no folder to name, and an empty line under the
   * button would read as an answer rather than as a missing one. */
  it('prints no folder when there is no backend to ask', () => {
    expect(render({})).not.toContain('Ordner:');
  });
});
