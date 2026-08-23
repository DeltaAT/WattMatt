import { de, formatTime } from '@/i18n';
import type { AutosaveState } from '@/store/autosave';
import type { FileState } from '@/store/tournamentStore';

/**
 * The file controls above the tournament (issues #9 and #10).
 *
 * The save state is a word and a time, not a dot: the host has to be able to
 * answer "is this on disk?" from across the room while doing something else.
 * It is never a modal and never asks for anything — the autosave has already
 * done the work, and this only reports it (issue #10).
 */
export function TournamentBar({
  name,
  file,
  autosave,
  busy,
  onSave,
  onSaveAs,
  onClose,
}: {
  name: string;
  file: FileState;
  autosave: AutosaveState;
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

      <FileStateLabel file={file} autosave={autosave} />

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

function FileStateLabel({ file, autosave }: { file: FileState; autosave: AutosaveState }) {
  // "Never written" is the one worth an alert: a tournament nobody can recover
  // after a crash, which is the failure autosave exists to make impossible.
  const isWarning = file.status === 'unsaved';

  return (
    <span
      className={`wm-tnum text-host-xs ${isWarning ? 'text-wm-live' : 'text-wm-text-faint'}`}
      role={isWarning ? 'alert' : undefined}
      data-file-state={file.status}
      data-autosave={autosave.activity}
      title={file.status === 'unsaved' ? undefined : file.path}
    >
      {stateText(file, autosave)}
    </span>
  );
}

/**
 * The one line of text.
 *
 * The order is what the host most needs to know first. A write in flight
 * outranks everything: it is the only state that is about to change on its own.
 * A tournament with no file at all outranks a stale timestamp, because that is
 * the one case where nothing is being written and nobody is coming to fix it.
 * Otherwise the time of the last successful write is the answer — "Gespeichert"
 * without one only happens before the first autosave of a freshly opened file.
 */
function stateText(file: FileState, autosave: AutosaveState): string {
  if (autosave.activity === 'saving') {
    return de.file.stateSaving;
  }
  if (file.status !== 'saved') {
    return STATE_TEXT[file.status];
  }
  return autosave.lastSavedAt === null
    ? de.file.stateSaved
    : de.file.stateSavedAt({ time: formatTime(new Date(autosave.lastSavedAt)) });
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
