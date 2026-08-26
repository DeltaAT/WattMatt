import { de } from '@/i18n';

/**
 * Every keyboard shortcut in the host window, on one card (issue #28).
 *
 * The host learns these during an event and cannot go looking for
 * documentation while the room waits, so `?` puts the whole list in front of
 * them and any key takes it away again.
 *
 * Not modal, unlike `UnsavedChangesDialog`. Nothing here is a question: the
 * tournament carries on behind it, and a host who opened it by accident must be
 * able to keep working without answering anything.
 */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label={de.beamerControl.shortcuts.title}
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      // A click anywhere dismisses it, including on the backdrop: the fastest
      // way out of a panel the host did not mean to open.
      onClick={onClose}
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.beamerControl.shortcuts.title}</h2>

        <dl className="flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut} className="flex items-baseline justify-between gap-4">
              <dt className="wm-tnum shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-2 py-1 text-host-xs font-medium text-wm-text">
                {de.beamerControl.shortcuts.key[shortcut]}
              </dt>
              <dd className="text-right text-host-sm text-wm-text-muted">
                {de.beamerControl.shortcuts.action[shortcut]}
              </dd>
            </div>
          ))}
        </dl>

        <p className="text-host-xs text-wm-text-faint">{de.beamerControl.shortcuts.hint}</p>

        <button type="button" className={CLOSE_CLASS} onClick={onClose}>
          {de.beamerControl.shortcuts.close}
        </button>
      </div>
    </div>
  );
}

/**
 * The order the host meets them in: the three that touch the projector, then
 * the scenes, then the two that are about the host's own work.
 */
const SHORTCUTS = ['skip', 'blackout', 'freeze', 'scenes', 'undo', 'redo', 'help'] as const;

const CLOSE_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
