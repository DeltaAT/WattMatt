import { useState } from 'react';

import type { GroupId, TableId } from '@/domain/ids';
import { elapsedMs, type TableSlot } from '@/domain/tables';
import type { Group, ParticipantLabel, TableStatus, Timestamp } from '@/domain/types';
import { de, formatDuration } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * One line of the occupancy board: a table, what is on it, and everything the
 * host can do to it (issue #13, docs/STYLEGUIDE.md §4 "Table chip").
 *
 * Readable at a glance is the requirement, so the status carries a colour *and*
 * a German word — colour is never the only signal (docs/STYLEGUIDE.md §1), and
 * a projector-lit room destroys hue differences anyway.
 */
export function TableRow({
  slot,
  groups,
  participant,
  now,
  isFirst,
  isLast,
  onRename,
  onMove,
  onDisable,
  onEnable,
  onRemove,
}: {
  slot: TableSlot;
  groups: ReadonlyMap<GroupId, Group>;
  /** The wording this tournament uses, for the pairing on the row. */
  participant: ParticipantLabel;
  now: Timestamp;
  isFirst: boolean;
  isLast: boolean;
  onRename: (tableId: TableId, label: string) => void;
  onMove: (tableId: TableId, offset: number) => void;
  onDisable: () => void;
  onEnable: (tableId: TableId) => void;
  onRemove: () => void;
}) {
  const { table } = slot;
  const isDisabled = table.status === 'DISABLED';

  return (
    <li
      className={`flex items-center gap-2 rounded-wm-md border border-wm-border bg-wm-surface px-3 py-2 ${
        isDisabled ? 'opacity-70' : ''
      }`}
      data-table-id={table.id}
      data-table-status={table.status}
    >
      <StatusDot status={table.status} />

      <LabelField
        // Keyed by the label, so an undo or a tournament opened from a file
        // resets the field rather than leaving a stale name in it that the next
        // blur would write back over the real one.
        key={table.label}
        label={table.label}
        onRename={(label) => onRename(table.id, label)}
      />

      <p className="min-w-0 flex-1 truncate text-host-sm text-wm-text-muted" data-table-match="">
        {occupancyText(slot, groups, participant, now)}
      </p>

      <div className="flex shrink-0 gap-1">
        <button
          type="button"
          className={ICON_CLASS}
          onClick={() => onMove(table.id, -1)}
          disabled={isFirst}
          title={de.table.moveUp}
          aria-label={de.table.moveUp}
          data-table-action="up"
        >
          {'↑'}
        </button>
        <button
          type="button"
          className={ICON_CLASS}
          onClick={() => onMove(table.id, 1)}
          disabled={isLast}
          title={de.table.moveDown}
          aria-label={de.table.moveDown}
          data-table-action="down"
        >
          {'↓'}
        </button>

        {isDisabled ? (
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={() => onEnable(table.id)}
            data-table-action="enable"
          >
            {de.table.enable}
          </button>
        ) : (
          <button
            type="button"
            className={BUTTON_CLASS}
            onClick={onDisable}
            data-table-action="disable"
          >
            {de.table.disable}
          </button>
        )}

        <button
          type="button"
          className={BUTTON_CLASS}
          onClick={onRemove}
          data-table-action="remove"
        >
          {de.table.remove}
        </button>
      </div>
    </li>
  );
}

/**
 * The label, editable in place.
 *
 * Committed on blur and on Enter rather than on every keystroke: a rename per
 * character would bury the undo stack under twelve steps for one new name
 * (CLAUDE.md golden rule 6). Escape puts the old label back, which is what a
 * host who started renaming the wrong table reaches for.
 */
function LabelField({ label, onRename }: { label: string; onRename: (label: string) => void }) {
  const [typed, setTyped] = useState(label);

  const commit = () => {
    const wanted = typed.trim();
    if (wanted === label) {
      return;
    }
    // An emptied field is a host who deleted the old name and walked away, not
    // a table without a name. `renameTable` refuses it anyway; not asking keeps
    // it out of the audit log as well.
    if (wanted !== '') {
      onRename(typed);
    }
    // Then put the old label back, whatever was asked for. `renameTable` also
    // refuses a name another table already answers to, and this field is the
    // only place that can say so — a refused name left on screen is one the
    // next blur would try to write again. A name that *was* accepted never sees
    // this: the row is keyed by the label, so by now the field is a new one
    // with the new name already in it.
    setTyped(label);
  };

  return (
    <input
      className="h-8 w-40 shrink-0 rounded-wm-sm border border-transparent bg-transparent px-2 text-host-sm font-medium text-wm-text hover:border-wm-border-strong focus:border-wm-accent focus:bg-wm-bg focus:outline-none"
      value={typed}
      aria-label={de.table.nameLabel}
      data-table-input="label"
      onChange={(event) => setTyped(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
          event.currentTarget.blur();
        }
        if (event.key === 'Escape') {
          setTyped(label);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * What is on the table, as one line.
 *
 * The stopwatch is beside the pairing rather than in a column of its own: the
 * question the host is asking is "how much longer will this table be busy",
 * and the two halves of the answer belong together.
 */
function occupancyText(
  { table, match }: TableSlot,
  groups: ReadonlyMap<GroupId, Group>,
  participant: ParticipantLabel,
  now: Timestamp,
): string {
  if (table.status === 'DISABLED') {
    return de.table.disabled;
  }
  if (table.currentMatchId === null) {
    return de.table.free;
  }
  if (match === null) {
    return de.table.unknownMatch;
  }

  const a = groupLabel(match.a, groups, participant).text;
  const b = groupLabel(match.b, groups, participant).text;
  const running =
    table.occupiedSince === null
      ? ''
      : ` · ${de.table.runningFor({ duration: formatDuration(elapsedMs(table.occupiedSince, now)) })}`;

  return `${a} ${de.match.versus} ${b}${running}`;
}

/** Grey `frei`, amber `belegt`, dark red `gesperrt` (docs/STYLEGUIDE.md §4). */
const DOT_CLASS: Record<TableStatus, string> = {
  FREE: 'bg-wm-idle',
  OCCUPIED: 'bg-wm-live',
  DISABLED: 'bg-wm-lose',
};

const STATUS_TEXT: Record<TableStatus, string> = {
  FREE: de.table.free,
  OCCUPIED: de.table.occupied,
  DISABLED: de.table.disabled,
};

function StatusDot({ status }: { status: TableStatus }) {
  return (
    <span className="flex shrink-0 items-center gap-2">
      <span className={`h-3 w-3 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
      {/* The word, not only the dot: colour is never the only signal (§1). */}
      <span className="wm-label w-16">{STATUS_TEXT[status]}</span>
    </span>
  );
}

/** 32 px, the floor for a host control (docs/STYLEGUIDE.md §3). */
const BUTTON_CLASS =
  'h-8 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-2 text-host-xs text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-40';

const ICON_CLASS = `${BUTTON_CLASS} w-8`;
