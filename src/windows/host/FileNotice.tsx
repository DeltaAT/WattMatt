import { de } from '@/i18n';
import type { FileErrorKind } from '@/platform/tournamentFile';
import type { FileNotice as Notice } from '@/windows/host/useTournamentDocument';

/**
 * What the host is told when a file operation failed (issue #9,
 * docs/ARCHITECTURE.md §6).
 *
 * Never a white screen and never a stack trace: a sentence saying what happened
 * and what to do next, plus — for a file that would not open — the newest
 * backup as a button (docs/FILE-FORMAT.md rule 1). It is an inline alert rather
 * than a modal, because the host may well want to try something else first.
 */
export function FileNotice({
  notice,
  busy,
  onOpenBackup,
  onDismiss,
}: {
  notice: Notice;
  busy: boolean;
  onOpenBackup: (path: string) => void;
  onDismiss: () => void;
}) {
  const newestBackup = notice.kind === 'openFailed' ? (notice.backups[0] ?? null) : null;

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

      <button type="button" className={ACTION_CLASS} onClick={onDismiss}>
        {de.common.cancel}
      </button>
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
  return saveMessage(notice.errorKind);
}

function saveMessage(kind: FileErrorKind): string {
  switch (kind) {
    case 'notFound':
      return de.error.fileMissing;
    case 'permissionDenied':
      return de.error.fileLocked;
    default:
      return de.error.saveFailed;
  }
}

const ACTION_CLASS =
  'h-8 shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-3 text-host-xs text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
