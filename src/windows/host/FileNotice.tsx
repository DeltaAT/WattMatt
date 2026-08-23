import { de } from '@/i18n';
import type { FileErrorKind } from '@/platform/tournamentFile';
import type { OpenFailure } from '@/store/persistence';
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
 *
 * One notice here is not a failure at all: a file that was migrated on the way
 * in (issue #12) says so in the same slot, in the accent colour rather than the
 * losing one. It shares the component because it is the same shape of thing —
 * one sentence about the file, dismissible, in the way until it is read — and
 * because two components competing for the same strip is how the host ends up
 * seeing neither.
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
  // A file from a *newer* build is the one open failure with no backup answer:
  // the rotated backups sit beside it and were written by the same build, so
  // offering one would send the host round the same refusal again.
  const offersBackup = notice.kind === 'openFailed' && notice.reason !== 'futureVersion';
  const newestBackup = offersBackup ? (notice.backups[0] ?? null) : null;
  // Every write failure has the same way out: put the tournament somewhere that
  // works. That is the issue's "disk full / file locked → offer Speichern
  // unter…", and it is the only action the host can take that fixes anything.
  const canRelocate = notice.kind !== 'openFailed' && notice.kind !== 'migrated';
  /*
    A stopped autosave is a condition, not an event: it is still true while the
    host reads it, and it clears itself the moment a write succeeds. Offering to
    hide it would be offering to run the rest of the event blind.
  */
  const canDismiss = notice.kind !== 'autosaveFailed';

  /*
    A migration is not a failure: the tournament is open and nothing is wrong.
    It is reported in the same slot because it is the same kind of thing — one
    sentence about the file, in the host's way until they have read it — but it
    must not be red, or the host reads "broken" and stops mid-setup to
    investigate a file that is fine.
  */
  const informational = notice.kind === 'migrated';

  return (
    <div
      role={informational ? 'status' : 'alert'}
      data-notice={notice.kind}
      className={`flex items-start gap-3 border-b px-4 py-3 ${
        informational ? 'border-wm-accent bg-wm-accent-soft' : 'border-wm-lose bg-wm-lose-bg'
      }`}
    >
      <p className="flex-1 text-host-sm text-wm-text">{messageFor(notice)}</p>

      {offersBackup ? (
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
    return openMessage(notice.reason);
  }
  if (notice.kind === 'migrated') {
    return de.file.migrated({ from: notice.from });
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

function openMessage(reason: OpenFailure): string {
  switch (reason) {
    case 'invalid':
      return de.error.fileInvalid;
    case 'futureVersion':
      return de.error.fileFromNewerVersion;
    case 'migrationFailed':
      return de.error.fileMigrationFailed;
    default:
      return de.error.fileUnreadable;
  }
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
