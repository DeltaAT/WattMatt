import { useState } from 'react';

import type { GroupId, TableId } from '@/domain/ids';
import { elapsedMs, type TableSlot } from '@/domain/tables';
import type { Group, ParticipantLabel, RoundTrack, TableStatus, Timestamp } from '@/domain/types';
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
  canReserve,
  onRename,
  onMove,
  onReserve,
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
  /**
   * Whether there are two tracks to choose between (issue #79).
   *
   * A tournament with no side event has one answer to "which track does this
   * table serve", and a control that can only say what is already true is a
   * control on every row of every event for nothing.
   */
  canReserve: boolean;
  onRename: (tableId: TableId, label: string) => void;
  onMove: (tableId: TableId, offset: number) => void;
  onReserve: (tableId: TableId, track: RoundTrack | null) => void;
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

      {canReserve ? (
        <ReservationPicker
          reservedFor={table.reservedFor}
          onReserve={(track) => onReserve(table.id, track)}
        />
      ) : null}

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
 * Which track this table serves (issue #79, docs/TOURNAMENT-RULES.md §10).
 *
 * A select rather than a toggle, because there are three answers and only one
 * of them is a default: both tracks, the main field, the `Trostrunde`. It sits
 * on the row rather than behind a dialog for the reason every other table
 * control does — the host reaches for it while looking at the board that told
 * them they needed it.
 *
 * Committing on change is right here and wrong for the label beside it: a
 * reservation is one decision and one undo step, where a name typed a character
 * at a time would be twelve.
 */
function ReservationPicker({
  reservedFor,
  onReserve,
}: {
  reservedFor: RoundTrack | null;
  onReserve: (track: RoundTrack | null) => void;
}) {
  return (
    <select
      className="h-8 shrink-0 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-2 text-host-xs text-wm-text-muted focus:border-wm-accent focus:outline-none"
      value={reservedFor ?? BOTH}
      aria-label={de.table.reservation.label}
      title={de.table.reservation.label}
      data-table-input="reservation"
      onChange={(event) =>
        onReserve(event.target.value === BOTH ? null : toTrack(event.target.value))
      }
    >
      <option value={BOTH}>{de.table.reservation.both}</option>
      <option value="MAIN">{de.table.reservation.MAIN}</option>
      <option value="CONSOLATION">{de.table.reservation.CONSOLATION}</option>
    </select>
  );
}

/** The `<option>` value that stands for "no reservation" — `null` is not one. */
const BOTH = 'BOTH';

/** A `<select>` hands back a string; this is the one place that narrows it. */
function toTrack(value: string): RoundTrack {
  return value === 'CONSOLATION' ? 'CONSOLATION' : 'MAIN';
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
