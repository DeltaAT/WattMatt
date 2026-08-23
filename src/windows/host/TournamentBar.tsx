import { de } from '@/i18n';
import type { FileState } from '@/store/tournamentStore';

/**
 * The file controls above the tournament (issue #9).
 *
 * The save state is a word, not a dot: the host has to be able to answer "is
 * this on disk?" from across the room while doing something else. Issue #10
 * turns it into the discreet "Gespeichert 19:31" indicator once autosave has a
 * time to show.
 */
export function TournamentBar({
  name,
  file,
  busy,
  onSave,
  onSaveAs,
  onClose,
}: {
  name: string;
  file: FileState;
  busy: boolean;
  onSave: () => void;
  onSaveAs: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-wm-border bg-wm-bg-elevated px-4 py-3">
      <h1 className="wm-display truncate text-host-lg font-bold" title={name}>
        {name}
      </h1>

      <FileStateLabel file={file} />

      <div className="ml-auto flex gap-2">
        <button type="button" className={PRIMARY_CLASS} onClick={onSave} disabled={busy}>
          {de.file.save}
        </button>
        <button type="button" className={SECONDARY_CLASS} onClick={onSaveAs} disabled={busy}>
          {de.file.saveAs}
        </button>
        <button type="button" className={SECONDARY_CLASS} onClick={onClose} disabled={busy}>
          {de.file.close}
        </button>
      </div>
    </header>
  );
}

const STATE_TEXT: Record<FileState['status'], string> = {
  saved: de.file.stateSaved,
  modified: de.file.stateModified,
  unsaved: de.file.stateUnwritten,
};

function FileStateLabel({ file }: { file: FileState }) {
  // "Never written" is the one worth an alert: a tournament nobody can recover
  // after a crash, which is the failure autosave exists to make impossible.
  const isWarning = file.status === 'unsaved';

  return (
    <span
      className={`text-host-xs ${isWarning ? 'text-wm-live' : 'text-wm-text-faint'}`}
      role={isWarning ? 'alert' : undefined}
      data-file-state={file.status}
      title={file.status === 'unsaved' ? undefined : file.path}
    >
      {STATE_TEXT[file.status]}
    </span>
  );
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
