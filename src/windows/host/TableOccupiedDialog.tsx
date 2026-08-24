import { useState } from 'react';

import type { GroupId, TableId } from '@/domain/ids';
import { REQUEUE, type MatchDisposition, type TableSlot } from '@/domain/tables';
import type { Group, ParticipantLabel, Table } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * "Deleting or disabling an occupied table asks what happens to the running
 * match" (issue #13).
 *
 * There is deliberately no "leave it there" answer. The table is going away, so
 * the match has to go somewhere, and the host is the only one who knows where —
 * a drink went over one table, and the pair either carries on next door or
 * waits for the next table to free up.
 *
 * The pairing is named in the dialog rather than only the table, because that is
 * what the host is about to interrupt and what they will have to say out loud
 * to the two people standing at it.
 */
export function TableOccupiedDialog({
  slot,
  intent,
  groups,
  participant,
  freeTables,
  onAnswer,
  onCancel,
}: {
  slot: TableSlot;
  intent: 'remove' | 'disable';
  groups: ReadonlyMap<GroupId, Group>;
  /** The wording this tournament uses, for the pairing named in the question. */
  participant: ParticipantLabel;
  /** The tables the match could go to instead. Empty is a normal case. */
  freeTables: readonly Table[];
  onAnswer: (disposition: MatchDisposition) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<TableId | null>(freeTables[0]?.id ?? null);

  const { table, match } = slot;
  const pairing =
    match === null
      ? de.table.unknownMatch
      : `${groupLabel(match.a, groups, participant).text} ${de.match.versus} ${groupLabel(match.b, groups, participant).text}`;

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={de.table.occupiedDialog.title}
      data-dialog="table-occupied"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.table.occupiedDialog.title}</h2>

        <p className="text-host-sm text-wm-text-muted">
          {intent === 'remove'
            ? de.table.occupiedDialog.removeBody({ label: table.label })
            : de.table.occupiedDialog.disableBody({ label: table.label })}
        </p>

        <p className="wm-tnum text-host-base text-wm-text" data-dialog-pairing="">
          {pairing}
        </p>

        {freeTables.length === 0 ? (
          // Said out loud rather than shown as a disabled control: the host has
          // to know the match is queueing before they press the button, not
          // afterwards.
          <p className="text-host-sm text-wm-live" data-dialog-note="no-free-table">
            {de.table.occupiedDialog.noFreeTable}
          </p>
        ) : (
          <label className="flex items-center gap-2">
            <span className="wm-label">{de.table.occupiedDialog.moveTargetLabel}</span>
            <select
              className="h-10 rounded-wm-md border border-wm-border-strong bg-wm-bg px-2 text-host-sm text-wm-text"
              value={target ?? ''}
              onChange={(event) => setTarget(event.target.value as TableId)}
              data-dialog-select="target"
            >
              {freeTables.map((free) => (
                <option key={free.id} value={free.id}>
                  {free.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY_CLASS}
            onClick={() => onAnswer(REQUEUE)}
            data-dialog-action="requeue"
          >
            {de.table.occupiedDialog.requeue}
          </button>

          <button
            type="button"
            className={SECONDARY_CLASS}
            disabled={target === null}
            onClick={() => {
              if (target !== null) {
                onAnswer({ kind: 'MOVE', toTableId: target });
              }
            }}
            data-dialog-action="move"
          >
            {de.table.occupiedDialog.moveTo}
          </button>

          {/*
            Last, and never the default: the host opened this dialog on purpose,
            and a cancel sitting where the eye lands first is how the broken
            table stays in the queue.
          */}
          <button
            type="button"
            className={`${SECONDARY_CLASS} ml-auto`}
            onClick={onCancel}
            data-dialog-action="cancel"
          >
            {de.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
