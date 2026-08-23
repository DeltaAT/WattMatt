import { de } from '@/i18n';
import type { UnsavedAnswer } from '@/windows/host/useTournamentDocument';

/**
 * The question asked before a tournament with unsaved changes disappears
 * (issue #9).
 *
 * Modal on purpose, and the only modal in the host UI. Everything else the host
 * does during an event is interruptible; this one has no correct default —
 * guessing "save" would write a misclick to disk, and guessing "discard" would
 * throw a round away.
 */
export function UnsavedChangesDialog({ onAnswer }: { onAnswer: (answer: UnsavedAnswer) => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={de.file.unsaved.title}
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.file.unsaved.title}</h2>
        <p className="text-host-sm text-wm-text-muted">{de.file.unsaved.body}</p>

        <div className="flex flex-col gap-2">
          <button type="button" className={PRIMARY_CLASS} onClick={() => onAnswer('save')}>
            {de.file.unsaved.saveAndClose}
          </button>
          <button type="button" className={SECONDARY_CLASS} onClick={() => onAnswer('cancel')}>
            {de.common.cancel}
          </button>
          {/*
            Last and visually quietest: it is the only irreversible answer here,
            and the undo stack does not reach across a closed tournament.
          */}
          <button type="button" className={DESTRUCTIVE_CLASS} onClick={() => onAnswer('discard')}>
            {de.file.unsaved.discard}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 40 px tall: destructive and high-frequency controls (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';

const DESTRUCTIVE_CLASS =
  'h-10 rounded-wm-md border border-wm-lose bg-wm-lose-bg px-3 text-host-sm text-wm-text transition-colors duration-[--dur-fast] ease-out';
