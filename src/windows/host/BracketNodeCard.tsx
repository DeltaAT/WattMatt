import { useState } from 'react';

import { bracketNodeState, type BracketNodeState } from '@/domain/bracket';
import type { BracketNodeId, GroupId, TableId } from '@/domain/ids';
import { elapsedMs } from '@/domain/tables';
import type { BracketNode, Group, ParticipantLabel, Table, Timestamp } from '@/domain/types';
import { de, formatDuration } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * One match of the tree, with the two targets that decide it (issue #26).
 *
 * The same card as a round's (`MatchCard`, issue #17) and deliberately so — the
 * host has been pressing that card all evening and the final phase is not the
 * moment to teach them a second one. What a bracket node adds is the three
 * things a `Match` in a round cannot say:
 *
 * - **A slot can be empty because nobody has got there yet.** In a round an
 *   empty side is a `Freilos`; here it is usually the match below still being
 *   played, and calling that a `Freilos` would tell the host somebody has
 *   advanced who has not (docs/TOURNAMENT-RULES.md §3, §7).
 * - **A waiting match is sent to a table by name.** The `Finale` and the
 *   `Spiel um Platz 3` are playable at the same moment (§7), so which table
 *   each goes to is the host's decision and not the queue's.
 * - **A decided result may have been built on.** The card only ever asks; what
 *   a correction would cost is the panel's dialog to explain.
 */
export function BracketNodeCard({
  node,
  groups,
  participant,
  tableLabel,
  freeTables,
  since,
  now,
  isArmed,
  onSetWinner,
  onAssign,
  onArm,
  onDisarm,
}: {
  node: BracketNode;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  /** The table this match is on, already resolved to what the host calls it. */
  tableLabel: string | null;
  /** Where a waiting match could be sent. Empty is an ordinary state. */
  freeTables: readonly Table[];
  /** When it started on its table, for the stopwatch. Null while waiting. */
  since: Timestamp | null;
  now: Timestamp;
  isArmed: boolean;
  onSetWinner: (nodeId: BracketNodeId, winnerId: GroupId) => void;
  onAssign: (nodeId: BracketNodeId, tableId: TableId) => void;
  onArm: () => void;
  onDisarm: () => void;
}) {
  const state = bracketNodeState(node);
  const a = slotLabel(node.slotA, groups, participant, state);
  const b = slotLabel(node.slotB, groups, participant, state);
  // The one click the issue asks for, everywhere it is safe: a match that is
  // waiting for its participants has nothing to press, and a decided one shows
  // its targets only once the host has armed it — the same guard against a
  // stray click that `MatchCard` uses.
  const showsTargets =
    node.slotA !== null && node.slotB !== null && (node.winnerId === null || isArmed);

  return (
    <li
      className={`flex flex-col gap-2 rounded-wm-md border bg-wm-surface p-2 ${
        state === 'DECIDED' || state === 'BYE' ? 'border-wm-border' : 'border-wm-border-strong'
      }`}
      data-bracket-node={node.id}
      data-node-state={state}
    >
      <header className="flex items-baseline gap-2">
        <span className="wm-label min-w-0 flex-1 truncate text-wm-text-muted" data-node-where="">
          {tableLabel ?? de.bracket.state[state]}
        </span>
        {since === null ? null : (
          <span className="wm-tnum text-host-xs text-wm-live" data-node-running="">
            {de.table.runningFor({ duration: formatDuration(elapsedMs(since, now)) })}
          </span>
        )}
      </header>

      {state === 'BYE' ? (
        <p className="text-host-sm text-wm-text" data-node-bye="">
          <span className="wm-display font-bold">{a}</span>{' '}
          <span className="text-wm-text-muted">{de.outcome.bye}</span>
        </p>
      ) : null}

      {node.winnerId !== null && state !== 'BYE' && !isArmed ? (
        <Result node={node} a={a} b={b} />
      ) : null}

      {state === 'WAITING' ? (
        <p className="text-host-sm text-wm-text-faint" data-node-pairing="">
          {`${a} — ${b}`}
        </p>
      ) : null}

      {showsTargets ? (
        <>
          {isArmed ? (
            <p className="wm-label text-wm-live" data-node-prompt="correct">
              {de.bracket.correctPrompt}
            </p>
          ) : null}
          <div className="flex gap-2">
            <WinnerButton
              label={a}
              isWinner={node.winnerId === node.slotA}
              onClick={() => {
                if (node.slotA !== null) {
                  onSetWinner(node.id, node.slotA);
                }
              }}
            />
            <WinnerButton
              label={b}
              isWinner={node.winnerId !== null && node.winnerId === node.slotB}
              onClick={() => {
                if (node.slotB !== null) {
                  onSetWinner(node.id, node.slotB);
                }
              }}
            />
          </div>
        </>
      ) : null}

      {state === 'QUEUED' ? (
        <TablePicker node={node} freeTables={freeTables} onAssign={onAssign} />
      ) : null}

      {node.winnerId !== null && state !== 'BYE' ? (
        <div className="flex justify-end">
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={isArmed ? onDisarm : onArm}
            data-node-action={isArmed ? 'cancel' : 'correct'}
          >
            {isArmed ? de.bracket.correctCancel : de.bracket.correct}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Where a waiting match is sent.
 *
 * A picker rather than a single "next free table" button, because two matches
 * of this phase are routinely playable at once and the host is deciding which
 * one the room can see (§7). With nothing free it says so rather than
 * disappearing: a control that vanishes leaves the host looking for it.
 */
function TablePicker({
  node,
  freeTables,
  onAssign,
}: {
  node: BracketNode;
  freeTables: readonly Table[];
  onAssign: (nodeId: BracketNodeId, tableId: TableId) => void;
}) {
  const [target, setTarget] = useState<TableId | null>(null);
  const chosen = target ?? freeTables[0]?.id ?? null;

  if (freeTables.length === 0) {
    return (
      <p className="text-host-xs text-wm-text-faint" data-node-tables="none">
        {de.bracket.noFreeTable}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2" data-node-tables="free">
      <select
        className="h-8 min-w-0 flex-1 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-1 text-host-xs text-wm-text"
        value={chosen ?? ''}
        onChange={(event) => setTarget(event.target.value as TableId)}
        aria-label={de.bracket.assign}
        data-node-table-target=""
      >
        {freeTables.map((table) => (
          <option key={table.id} value={table.id}>
            {table.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={SECONDARY_CLASS}
        onClick={() => {
          if (chosen !== null) {
            onAssign(node.id, chosen);
          }
        }}
        title={de.bracket.assignAction({
          table: freeTables.find((table) => table.id === chosen)?.label ?? de.table.label,
        })}
        data-node-action="assign"
      >
        {de.bracket.assign}
      </button>
    </div>
  );
}

/**
 * The result of a decided match.
 *
 * Three signals for the win, never colour alone (docs/STYLEGUIDE.md §1) — the
 * same three the round card shows, in the same words, because the host is
 * reading both panels in one evening.
 */
function Result({ node, a, b }: { node: BracketNode; a: string; b: string }) {
  const winner = node.winnerId === node.slotA ? a : b;
  const loser = node.winnerId === node.slotA ? b : a;

  return (
    <div className="flex flex-col gap-1">
      <p
        className="border-l-4 border-wm-win pl-2 text-host-sm font-medium text-wm-win"
        data-node-winner=""
      >
        <span aria-hidden="true">{'✓ '}</span>
        {de.match.winnerIs({ participant: winner })}
      </p>
      <p className="pl-3 text-host-xs text-wm-lose opacity-60" data-node-loser="">
        <span aria-hidden="true">{'✗ '}</span>
        {`${loser} — ${de.outcome.eliminated}`}
      </p>
    </div>
  );
}

/**
 * One of the two targets — 48 px tall, like the round's, because it is the same
 * press under the same pressure (docs/STYLEGUIDE.md §3).
 */
function WinnerButton({
  label,
  isWinner,
  onClick,
}: {
  label: string;
  isWinner: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`h-12 min-w-0 flex-1 rounded-wm-md border px-2 text-host-sm font-medium transition-colors duration-[--dur-fast] ease-out ${
        isWinner
          ? 'border-wm-win bg-wm-win-bg text-wm-text'
          : 'border-wm-border-strong bg-wm-bg-elevated text-wm-text hover:bg-wm-surface-hover'
      }`}
      onClick={onClick}
      title={de.match.winnerAction({ participant: label })}
      aria-label={de.match.winnerAction({ participant: label })}
      data-node-action="winner"
    >
      <span className="wm-display block truncate">{label}</span>
    </button>
  );
}

/**
 * What one side of a node is called.
 *
 * An empty slot is `Offen` while the match below is still being played and
 * `Freilos` once the node has been decided without it — the two look the same
 * in the data and mean opposite things to the host (§3, §7).
 */
function slotLabel(
  groupId: GroupId | null,
  groups: ReadonlyMap<GroupId, Group>,
  participant: ParticipantLabel,
  state: BracketNodeState,
): string {
  if (groupId !== null) {
    return groupLabel(groupId, groups, participant).text;
  }
  return state === 'BYE' ? de.outcome.bye : de.bracket.open;
}

/** 32 px, the floor for a host control (docs/STYLEGUIDE.md §3). */
const SECONDARY_CLASS =
  'h-8 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-2 text-host-xs text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-40';
