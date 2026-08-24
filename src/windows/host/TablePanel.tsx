import { useState } from 'react';

import type { GroupId, TableId } from '@/domain/ids';
import type { MatchDisposition, TableSlot } from '@/domain/tables';
import type { Group, Timestamp } from '@/domain/types';
import { de } from '@/i18n';
import { TableOccupiedDialog } from '@/windows/host/TableOccupiedDialog';
import { TableRow } from '@/windows/host/TableRow';

/**
 * Table management and the live occupancy board, in one panel (issue #13).
 *
 * One panel and not two, because they are one job: the host adds a table
 * because the board says every table is busy, and takes one out of service
 * because the board is what told them a match is sitting on a broken one.
 * Splitting them would put the reason on one screen and the control on another.
 *
 * Presentational. Every decision comes in as a callback from `useTables`, which
 * is what lets the whole board be rendered in a test without a store.
 */
export function TablePanel({
  board,
  groups,
  now,
  onAdd,
  onRename,
  onMove,
  onDisable,
  onEnable,
  onRemove,
  onShowOnBeamer,
}: {
  board: readonly TableSlot[];
  groups: readonly Group[];
  /** Re-read every second by `useNow`, so the running times move on their own. */
  now: Timestamp;
  onAdd: (count: number) => void;
  onRename: (tableId: TableId, label: string) => void;
  onMove: (tableId: TableId, offset: number) => void;
  onDisable: (tableId: TableId, disposition?: MatchDisposition) => void;
  onEnable: (tableId: TableId) => void;
  onRemove: (tableId: TableId, disposition?: MatchDisposition) => void;
  onShowOnBeamer: () => void;
}) {
  /**
   * The table whose match the host still has to decide about, and what they
   * were trying to do to it. Null the rest of the time — a question that is not
   * being asked must not be a dialog that is merely hidden.
   */
  const [pending, setPending] = useState<{ slot: TableSlot; intent: 'remove' | 'disable' } | null>(
    null,
  );

  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const freeTables = board.filter((slot) => slot.table.status === 'FREE').map((slot) => slot.table);

  /**
   * A table with a match on it never goes away without the host answering for
   * the match first (issue #13). A free one goes straight away — there is
   * nothing to ask, and undo is the way back from a misclick.
   */
  const request = (slot: TableSlot, intent: 'remove' | 'disable') => {
    if (slot.table.currentMatchId === null) {
      if (intent === 'remove') {
        onRemove(slot.table.id);
      } else {
        onDisable(slot.table.id);
      }
      return;
    }
    setPending({ slot, intent });
  };

  const answer = (disposition: MatchDisposition) => {
    if (pending === null) {
      return;
    }
    if (pending.intent === 'remove') {
      onRemove(pending.slot.table.id, disposition);
    } else {
      onDisable(pending.slot.table.id, disposition);
    }
    setPending(null);
  };

  return (
    <section className="flex flex-col gap-3" aria-label={de.table.sectionLabel}>
      <header className="flex items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">{de.table.sectionLabel}</h2>
        <span className="wm-tnum text-host-xs text-wm-text-faint" data-table-count={board.length}>
          {de.table.count({ n: board.length })}
        </span>

        <button
          type="button"
          className={`${SECONDARY_CLASS} ml-auto`}
          onClick={onShowOnBeamer}
          data-table-action="beamer"
        >
          {de.table.showOnBeamer}
        </button>
      </header>

      <QuickAdd onAdd={onAdd} />

      {board.length === 0 ? (
        <p className="text-host-sm text-wm-text-muted" data-table-empty="">
          {de.table.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label={de.table.boardLabel}>
          {board.map((slot, index) => (
            <TableRow
              key={slot.table.id}
              slot={slot}
              groups={byId}
              now={now}
              isFirst={index === 0}
              isLast={index === board.length - 1}
              onRename={onRename}
              onMove={onMove}
              onDisable={() => request(slot, 'disable')}
              onEnable={onEnable}
              onRemove={() => request(slot, 'remove')}
            />
          ))}
        </ul>
      )}

      {pending === null ? null : (
        <TableOccupiedDialog
          slot={pending.slot}
          intent={pending.intent}
          groups={byId}
          freeTables={freeTables}
          onAnswer={answer}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

/**
 * "Anzahl Tische": the number of tables the room has, typed once.
 *
 * A form rather than a bare button, so Enter works — the host is typing a
 * number, and reaching for the mouse afterwards is the slowest thing on this
 * screen. The count is kept as the typed text rather than as a number, because
 * a controlled numeric input that snaps an empty field back to 0 cannot be
 * cleared, and a host who cannot delete a digit ends up with 80 tables.
 */
function QuickAdd({ onAdd }: { onAdd: (count: number) => void }) {
  const [typed, setTyped] = useState('');
  const count = Number.parseInt(typed, 10);
  const isValid = Number.isSafeInteger(count) && count > 0 && count <= MAX_QUICK_ADD;

  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (isValid) {
          onAdd(count);
          setTyped('');
        }
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="wm-label">{de.table.quickAddLabel}</span>
        <input
          className="h-10 w-24 rounded-wm-md border border-wm-border-strong bg-wm-bg px-2 text-host-sm text-wm-text"
          type="number"
          min={1}
          max={MAX_QUICK_ADD}
          inputMode="numeric"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          data-table-input="count"
        />
      </label>

      <button type="submit" className={PRIMARY_CLASS} disabled={!isValid} data-table-action="quick">
        {de.table.quickAdd}
      </button>

      {/*
        The single `+` beside the quick-add, for the table that turns up late.
        Same action underneath — the host means the same thing either way.
      */}
      <button
        type="button"
        className={SECONDARY_CLASS}
        onClick={() => onAdd(1)}
        data-table-action="add"
      >
        {de.table.add}
      </button>
    </form>
  );
}

/**
 * More tables than any room this app is for. Not a rule from
 * docs/TOURNAMENT-RULES.md — a guard against a typo in a number field, where
 * "800" costs the host eight hundred rows to delete during setup.
 */
const MAX_QUICK_ADD = 64;

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
