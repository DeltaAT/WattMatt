import { de } from '@/i18n';

/**
 * What fills the host window when its tree could not be drawn (issue #30).
 *
 * The last net, and the only screen in WattMatt whose job is to be a dead end
 * that is not a dead end. Three things and nothing else:
 *
 *  - a German sentence saying what happened and what the host can do,
 *  - *Erneut versuchen*, which re-renders the tree the store is still holding —
 *    the store lives at module scope, so the tournament, the undo stack and the
 *    pending autosave all survive a failed render, and retrying is very often
 *    enough,
 *  - *Protokoll öffnen*, because the host will be asked afterwards what
 *    happened and the answer is in the file, not in their memory of it.
 *
 * Deliberately no stack trace and no *Neu laden*: a reload discards whatever
 * has not reached disk in the last half second, and offering it beside a retry
 * is offering the host a way to lose a result while they are under pressure.
 */
export function HostErrorFallback({
  onRetry,
  onOpenLog,
}: {
  onRetry: () => void;
  onOpenLog: () => void;
}) {
  return (
    <div
      role="alert"
      data-host-failure=""
      className="flex h-full flex-col items-center justify-center gap-4 bg-wm-bg p-8 text-center"
    >
      <h1 className="text-host-lg font-semibold text-wm-text">{de.failure.title}</h1>
      <p className="max-w-prose text-host-sm text-wm-text-muted">{de.error.hostCrashed}</p>

      <div className="flex gap-2">
        <button type="button" className={PRIMARY_CLASS} onClick={onRetry}>
          {de.failure.retry}
        </button>
        <button type="button" className={SECONDARY_CLASS} onClick={onOpenLog}>
          {de.log.open}
        </button>
      </div>
    </div>
  );
}

const PRIMARY_CLASS =
  'h-9 rounded-wm-sm border border-wm-accent bg-wm-accent-soft px-4 text-host-sm text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';

const SECONDARY_CLASS =
  'h-9 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-4 text-host-sm text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
