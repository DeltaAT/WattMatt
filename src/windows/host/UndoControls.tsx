import { de } from '@/i18n';
import type { UndoHandle } from '@/windows/host/useUndo';

/**
 * The two buttons that take a decision back (issue #11, golden rule 6).
 *
 * They name the step rather than saying only "undo". A host who has just
 * misclicked in front of the room needs to know what is about to disappear
 * before they press anything — and after two or three presses, what is left.
 *
 * Nothing here is a dialog and nothing asks for confirmation. Undo *is* the
 * confirmation: the fast way back is the whole point, and a modal in front of
 * it would make the misclick cost two more.
 */
export function UndoControls({ undoLabel, redoLabel, undo, redo }: UndoHandle) {
  return (
    <div className="flex items-center gap-2 border-b border-wm-border bg-wm-surface px-4 py-2">
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={undo}
        disabled={undoLabel === null}
        data-undo="undo"
      >
        {undoLabel === null ? de.undo.undo : de.undo.undoStep({ label: undoLabel })}
      </button>

      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={redo}
        disabled={redoLabel === null}
        title={redoLabel === null ? de.undo.nothingToRedo : undefined}
        data-undo="redo"
      >
        {redoLabel === null ? de.undo.redo : de.undo.redoStep({ label: redoLabel })}
      </button>

      {/*
        Said out loud rather than left to a greyed-out button. The one moment a
        host reads this is when undo did not do what they expected, and the
        answer they need — the history starts at the tournament they opened —
        is not something a disabled button conveys.
      */}
      {undoLabel === null ? (
        <span className="text-host-xs text-wm-text-faint">{de.undo.nothingToUndo}</span>
      ) : null}
    </div>
  );
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const BUTTON_CLASS =
  'h-10 max-w-[24rem] truncate rounded-wm-md border border-wm-border-strong bg-wm-bg-elevated px-3 text-host-sm text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-50';
