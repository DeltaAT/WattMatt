import { useCallback } from 'react';

import type { SceneChoice } from '@/domain/sceneCatalog';
import { de } from '@/i18n';
import { summariseBeamer, sortMonitors, type BeamerHint } from '@/platform/beamerSummary';
import {
  closeBeamer,
  focusHost,
  openBeamer,
  type BeamerStatus,
  type MonitorInfo,
} from '@/platform/beamerWindow';
import { reportProblem } from '@/store/problems';
import { BeamerPreview } from '@/windows/host/BeamerPreview';
import type { BeamerControlHandle } from '@/windows/host/useBeamerControl';

/**
 * The host's control over the beamer (docs/ARCHITECTURE.md §2, issue #28).
 *
 * The column that makes "the host is always in control of what is displayed"
 * literally true (golden rule 3). Three groups, in the order the host reaches
 * for them under pressure:
 *
 *  - the **live preview**, the **blackout** and the **freeze**, pinned at the
 *    top so none of them ever scrolls out of reach — the preview is the only
 *    place the host can see what the room sees, and the blackout is the one
 *    control that must be one click away in every state the panel can be in;
 *  - the **switcher**, every scene one click away in any phase, in a fixed
 *    order because the position is also the keyboard shortcut;
 *  - the **window**, which is a presentation concern and touches no tournament
 *    state at all (golden rule 4).
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
  control,
  onShowShortcuts,
  onOpenLog,
  logDirectory,
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
  control: BeamerControlHandle;
  onShowShortcuts: () => void;
  /** Opens `%APPDATA%\WattMatt\logs` in Explorer (issue #30). */
  onOpenLog: () => void;
  /**
   * Printed under the button, or `null` where there is no backend to ask.
   *
   * The path and not only the button: Explorer can refuse, and a host who has
   * been told where the folder is can still get at it from the address bar.
   */
  logDirectory: string | null;
}) {
  const summary = summariseBeamer(status);
  const monitors = sortMonitors(status.monitors);

  // Every action is fire-and-forget: Rust answers with a status event, so the
  // panel never has to guess what happened. A rejected promise means the window
  // system refused, and that becomes a toast (issue #30) — a host who pressed
  // "Beamer öffnen" and got nothing must not be left wondering whether they
  // missed the button.
  const run = useCallback((action: () => Promise<unknown>) => {
    action().catch((error: unknown) => {
      reportProblem('beamerCommand', 'beamer.command-failed', error);
    });
  }, []);

  return (
    <section className="flex w-80 shrink-0 flex-col border-l border-wm-border bg-wm-bg-elevated">
      {/*
        Outside the scroll container on purpose. Whatever else the host has
        scrolled to, the picture the room is looking at and the button that
        takes it away sit in the same place every time.
      */}
      <div className="flex shrink-0 flex-col gap-3 border-b border-wm-border p-4">
        <h2 className="wm-label">{de.beamerControl.sectionLabel}</h2>

        <BeamerPreview placement={status.placement} frozen={control.frozen} open={status.open} />

        <p className="text-host-xs text-wm-text-faint" data-staged-scene={control.scene.id}>
          {de.beamerControl.onScreen({ scene: de.beamerControl.sceneName[control.scene.id] })}
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={control.isBlackout}
            onClick={control.toggleBlackout}
            className={control.isBlackout ? BLACKOUT_ACTIVE_CLASS : BLACKOUT_CLASS}
          >
            {control.isBlackout ? de.beamerControl.blackoutRelease : de.beamerControl.blackout}
          </button>
          <button
            type="button"
            aria-pressed={control.frozen}
            onClick={control.toggleFreeze}
            className={control.frozen ? FREEZE_ACTIVE_CLASS : SECONDARY_CLASS}
          >
            {control.frozen ? de.beamerControl.freeze.release : de.beamerControl.freeze.label}
          </button>
        </div>

        {control.frozen ? (
          <p className="text-host-xs text-wm-live" role="alert">
            {de.beamerControl.freeze.hint}
          </p>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <h3 className="wm-label">{de.beamerControl.sceneSectionLabel}</h3>
          <ul className="flex flex-col gap-1">
            {control.choices.map((choice) => (
              <li key={choice.id}>
                <SceneButton
                  choice={choice}
                  isStaged={control.isStaged(choice)}
                  onSelect={() => {
                    if (choice.scene !== null) {
                      control.show(choice.scene);
                    }
                  }}
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={control.autoFollow}
            onClick={() => control.setAutoFollow(!control.autoFollow)}
            className={control.autoFollow ? ACTION_CLASS : SECONDARY_CLASS}
          >
            {de.beamerControl.autoFollow.label}
          </button>
          <p className="text-host-xs text-wm-text-faint">
            {control.autoFollow ? de.beamerControl.autoFollow.on : de.beamerControl.autoFollow.off}
          </p>
          <button type="button" className={SECONDARY_CLASS} onClick={control.skip}>
            {de.beamerControl.skip}
          </button>
        </div>

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

        <button type="button" className={SECONDARY_CLASS} onClick={onShowShortcuts}>
          {de.beamerControl.shortcuts.open}
        </button>

        {/*
          Last in the column, under everything the host uses during the event
          (issue #30). It is deliberately the least prominent control in the
          window: it answers a question that is asked *after* the evening —
          "what actually happened at 19:31?" — and nothing about it should
          compete with the blackout for a hand reaching across the keyboard.

          Here rather than in the tournament shell because the log outlives the
          tournament: a host who closed the file, or never opened one, still has
          to be able to reach it.
        */}
        <div className="flex flex-col gap-1">
          <button type="button" className={SECONDARY_CLASS} onClick={onOpenLog}>
            {de.log.open}
          </button>
          {logDirectory === null ? null : (
            <p className="break-all text-host-xs text-wm-text-faint">
              {de.log.location({ path: logDirectory })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * One scene in the switcher, with the digit that stages it.
 *
 * The digit is printed on the button rather than hidden in a tooltip: the host
 * learns the layout by reading it during the first half of the evening, and by
 * the second half they are not looking at the panel at all.
 */
function SceneButton({
  choice,
  isStaged,
  onSelect,
}: {
  choice: SceneChoice;
  isStaged: boolean;
  onSelect: () => void;
}) {
  const unavailable = choice.scene === null;

  return (
    <button
      type="button"
      aria-pressed={isStaged}
      disabled={unavailable}
      title={unavailable ? de.beamerControl.sceneUnavailable : undefined}
      onClick={onSelect}
      data-scene={choice.id}
      className={`flex h-8 w-full items-center gap-2 rounded-wm-sm border px-2 text-left transition-colors duration-[--dur-fast] ease-out ${
        isStaged
          ? 'border-wm-accent bg-wm-accent-soft text-wm-text'
          : 'border-wm-border bg-wm-surface text-wm-text-muted hover:bg-wm-surface-hover'
      } ${unavailable ? 'opacity-40' : ''}`}
    >
      <span className="wm-tnum w-4 shrink-0 text-host-xs text-wm-text-faint">
        {choice.shortcut}
      </span>
      <span className="text-host-sm">{de.beamerControl.sceneName[choice.id]}</span>
    </button>
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

/**
 * The panic button, and it looks like one. Colour only on the transition, per
 * docs/MOTION.md §5: the host aims at this repeatedly under pressure and
 * nothing may move under the cursor.
 */
const BLACKOUT_CLASS =
  'h-10 flex-1 rounded-wm-md border border-wm-lose bg-wm-lose-bg px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out';

const BLACKOUT_ACTIVE_CLASS =
  'h-10 flex-1 rounded-wm-md border border-wm-lose bg-wm-lose px-3 text-host-sm font-medium text-wm-bg transition-colors duration-[--dur-fast] ease-out';

const FREEZE_ACTIVE_CLASS =
  'h-10 flex-1 rounded-wm-md border border-wm-live bg-wm-live-bg px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out';
