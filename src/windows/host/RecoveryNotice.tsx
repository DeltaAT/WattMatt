import { tournamentNameFromFileName } from '@/domain/fileName';
import { de, formatDateTime } from '@/i18n';
import type { RecoveryOffer } from '@/platform/session';

/**
 * The offer made when the last session did not exit cleanly (issue #10,
 * docs/FILE-FORMAT.md rule 5).
 *
 * An offer, not an error, and it is written that way: nothing is broken, there
 * is simply a tournament sitting where the host left it when the laptop died.
 * The two answers are equal in weight — opening it and getting on with the
 * evening, or ignoring it because the crash happened during a rehearsal.
 *
 * Inline rather than modal on purpose. It appears while the host is still
 * looking at the start screen, and a modal in front of the one screen they need
 * would be the app deciding what they do next (CLAUDE.md golden rule 3).
 */
export function RecoveryNotice({
  offer,
  busy,
  onRecover,
  onDecline,
}: {
  offer: RecoveryOffer;
  busy: boolean;
  onRecover: () => void;
  onDecline: () => void;
}) {
  return (
    <div
      role="status"
      data-notice="recovery"
      className="flex items-start gap-3 border-b border-wm-accent bg-wm-accent-soft px-4 py-3"
    >
      <div className="flex flex-1 flex-col gap-1">
        <p className="text-host-sm font-medium text-wm-text">{de.file.recovery.title}</p>
        <p className="text-host-xs text-wm-text-muted">
          {de.file.recovery.body({
            // The file name is what the host recognises; the path is a folder
            // they have never looked at.
            name: tournamentNameFromFileName(fileNameOf(offer.path)),
            at: formatDateTime(new Date(offer.startedAt)),
          })}
        </p>
      </div>

      <button type="button" className={PRIMARY_CLASS} disabled={busy} onClick={onRecover}>
        {de.file.recovery.open}
      </button>
      <button type="button" className={SECONDARY_CLASS} onClick={onDecline}>
        {de.common.dismiss}
      </button>
    </div>
  );
}

/** Windows separators, because that is what the marker recorded. */
function fileNameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut < 0 ? path : path.slice(cut + 1);
}

/** 32 px: an infrequent control that is still the point of the row. */
const PRIMARY_CLASS =
  'h-8 shrink-0 rounded-wm-sm border border-wm-accent bg-wm-accent-strong px-3 text-host-xs font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out disabled:opacity-60';

const SECONDARY_CLASS =
  'h-8 shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-surface px-3 text-host-xs text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
