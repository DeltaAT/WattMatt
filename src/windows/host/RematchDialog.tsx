import { de } from '@/i18n';

/** One forced pairing, already resolved to what the host calls the two groups. */
export interface RematchPair {
  key: string;
  a: string;
  b: string;
}

/**
 * "This draw repeats matches that have already been played" — issue #72,
 * docs/TOURNAMENT-RULES.md §3.
 *
 * The rarest dialog in the app and the one that must never be skipped. The
 * engine avoids rematches wherever a rematch-free pairing exists, so this
 * appears only when the field has genuinely played itself out — and then the
 * host is the one who tells the room, not the projector. §3 says never
 * silently.
 *
 * Nothing has been committed at this point. The draw is a preview: cancelling
 * spends nothing and changes nothing, which is what the line under the buttons
 * says out loud, because a host looking at an unexpected dialog mid-event needs
 * to know that the safe answer is safe.
 *
 * The pairs are listed in full rather than counted. The host is about to read
 * them out, and "two pairings repeat" is not something anybody can say into a
 * microphone.
 */
export function RematchDialog({
  pairs,
  onConfirm,
  onCancel,
}: {
  /** The pairs that repeat, in draw order. Never empty — the dialog would not be shown. */
  pairs: readonly RematchPair[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={de.draw.rematch.title}
      data-dialog="rematch"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.draw.rematch.title}</h2>

        <p className="text-host-sm text-wm-text-muted">
          {de.draw.rematch.body({ n: pairs.length })}
        </p>
        <p className="text-host-sm text-wm-text-muted">{de.draw.rematch.explain}</p>

        <ul className="flex flex-col gap-1" data-dialog-list="rematches">
          {pairs.map((pair) => (
            <li
              key={pair.key}
              className="wm-display rounded-wm-sm bg-wm-surface px-2 py-1 text-host-sm text-wm-text"
              data-dialog-pair={pair.key}
            >
              {de.draw.rematch.pair({ a: pair.a, b: pair.b })}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY_CLASS}
            onClick={onConfirm}
            data-dialog-action="confirm"
          >
            {de.draw.rematch.confirm}
          </button>
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onCancel}
            data-dialog-action="cancel"
          >
            {de.draw.rematch.cancel}
          </button>
        </div>

        <p className="text-host-xs text-wm-text-faint">{de.draw.rematch.cancelHint}</p>
      </div>
    </div>
  );
}

/** 40 px: a high-frequency host control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
