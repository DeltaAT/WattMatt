import { de } from '@/i18n';
import type { FileErrorKind } from '@/platform/tournamentFile';
import type { FileNotice as Notice } from '@/windows/host/useTournamentDocument';

/**
 * What the host is told when a file operation failed (issues #9 and #10,
 * docs/ARCHITECTURE.md §6).
 *
 * Never a white screen and never a stack trace: a sentence saying what happened
 * and what to do next, plus the way out as a button — the newest backup for a
 * file that would not open (docs/FILE-FORMAT.md rule 1), "Speichern unter…" for
 * anything that could not be written. It is an inline alert rather than a
 * modal, because the host may well want to try something else first.
 */
export function FileNotice({
  notice,
  busy,
  onOpenBackup,
  onSaveAs,
  onDismiss,
}: {
  notice: Notice;
  busy: boolean;
  onOpenBackup: (path: string) => void;
  onSaveAs: () => void;
  onDismiss: () => void;
}) {
  const newestBackup = notice.kind === 'openFailed' ? (notice.backups[0] ?? null) : null;
  // Every write failure has the same way out: put the tournament somewhere that
  // works. That is the issue's "disk full / file locked → offer Speichern
  // unter…", and it is the only action the host can take that fixes anything.
  const canRelocate = notice.kind !== 'openFailed';
  /*
    A stopped autosave is a condition, not an event: it is still true while the
    host reads it, and it clears itself the moment a write succeeds. Offering to
    hide it would be offering to run the rest of the event blind.
  */
  const canDismiss = notice.kind !== 'autosaveFailed';

  return (
    <div
      role="alert"
      data-notice={notice.kind}
      className="flex items-start gap-3 border-b border-wm-lose bg-wm-lose-bg px-4 py-3"
    >
      <p className="flex-1 text-host-sm text-wm-text">{messageFor(notice)}</p>

      {notice.kind === 'openFailed' ? (
        newestBackup === null ? (
          <span className="text-host-xs text-wm-text-muted">{de.file.noBackup}</span>
        ) : (
          <button
            type="button"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onOpenBackup(newestBackup.path)}
          >
            {de.file.openBackup}
          </button>
        )
      ) : null}

      {canRelocate ? (
        <button type="button" className={ACTION_CLASS} disabled={busy} onClick={onSaveAs}>
          {de.file.saveAs}
        </button>
      ) : null}

      {/*
        `dismiss`, not `cancel`: the notice reports something that has already
        happened, and there is nothing left to call off (CLAUDE.md §1 — the
        word the host reads has to be the right one, not merely a German one).
      */}
      {canDismiss ? (
        <button type="button" className={ACTION_CLASS} onClick={onDismiss}>
          {de.common.dismiss}
        </button>
      ) : null}
    </div>
  );
}

/**
 * The German sentence for a failure.
 *
 * Keyed on the typed variant Rust returned rather than on its message: the
 * message is an OS string in whatever language Windows is installed in, and
 * putting it in front of the host is how an error stops being actionable.
 */
function messageFor(notice: Notice): string {
  if (notice.kind === 'openFailed') {
    return notice.reason === 'invalid' ? de.error.fileInvalid : de.error.fileUnreadable;
  }
  if (notice.kind === 'notWritten') {
    return de.error.fileNotWritten;
  }
  // The named causes are the same either way — a pulled USB stick is a pulled
  // USB stick — but the fallback is not: "versuchen Sie es erneut" is advice
  // about a button, and nobody pressed one to start an autosave.
  return notice.kind === 'autosaveFailed'
    ? writeMessage(notice.errorKind, de.error.autosaveFailed)
    : writeMessage(notice.errorKind, de.error.saveFailed);
}

function writeMessage(kind: FileErrorKind, fallback: string): string {
  switch (kind) {
    case 'notFound':
      return de.error.fileMissing;
    case 'permissionDenied':
      return de.error.fileLocked;
    default:
      return fallback;
  }
}

const ACTION_CLASS =
  'h-8 shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-3 text-host-xs text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
