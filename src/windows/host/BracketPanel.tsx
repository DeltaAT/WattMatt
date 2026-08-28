import { useState } from 'react';

import {
  bracketNodeTableId,
  type BracketBlocker,
  type BracketColumn,
  type BracketCorrection,
} from '@/domain/bracket';
import { FINAL_PHASE_SIZE, MINIMUM_BRACKET_SIZE } from '@/domain/draw';
import type { BracketNodeId, GroupId, TableId } from '@/domain/ids';
import type {
  Bracket,
  BracketNode,
  BracketRound,
  Group,
  ParticipantLabel,
  RoundTrack,
  Table,
  Timestamp,
} from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';
import { BracketCorrectionDialog } from '@/windows/host/BracketCorrectionDialog';
import { BracketNodeCard } from '@/windows/host/BracketNodeCard';
import { RematchDialog, type RematchPair } from '@/windows/host/RematchDialog';

/**
 * The bracket control panel (issue #26).
 *
 * The host-side counterpart of the projector's tree, laid out the same way —
 * one column per round, left to right — so that the host's screen and the wall
 * can be read against each other without translating between two pictures. The
 * `Spiel um Platz 3` is a column of its own beside the `Finale`, which is
 * exactly where §7 puts it and the opposite of burying it under the tree.
 *
 * Two things drive the design.
 *
 * **What can be played right now has to be obvious.** The count is in the
 * header and every card says its own state in a word, because the question the
 * host answers a dozen times in this phase is "what can I send to that table
 * that just came free?".
 *
 * **A correction that costs something has to say so first.** Every other
 * decision in the app commits on one click; this is the one that can throw away
 * matches the room has watched, so it goes through a dialog that names them
 * (`BracketCorrectionDialog`). A correction that costs nothing stays one click.
 *
 * Presentational. Every decision comes in as a callback from `useBracket`,
 * which is what lets the whole panel be rendered in a test without a store.
 */
export function BracketPanel({
  bracket,
  columns,
  groups,
  participant,
  freeTables,
  tables,
  playable,
  field,
  now,
  drawBlockers,
  canDraw,
  canFinish,
  focus,
  onPreviewDraw,
  onDraw,
  onSetWinner,
  correctionFor,
  onAssign,
  onFinish,
  onFocus,
  track = 'MAIN',
  phase,
  onShowCeremony,
  onShowCeremonyStep,
}: {
  bracket: Bracket | null;
  columns: readonly BracketColumn[];
  groups: readonly Group[];
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  freeTables: readonly Table[];
  /** Every table, so a running match can be named by the one it is on. */
  tables: readonly Table[];
  playable: number;
  field: number;
  /** Re-read every second by `useNow`, so the running times move on their own. */
  now: Timestamp;
  drawBlockers: readonly BracketBlocker[];
  canDraw: boolean;
  canFinish: boolean;
  focus: BracketRound | null;
  /**
   * What drawing the tree would deal: the first-round pairings it could not
   * keep apart. Null when there is nothing to draw, empty in every ordinary
   * draw (issue #72).
   */
  onPreviewDraw: () => readonly BracketNode[] | null;
  onDraw: () => void;
  onSetWinner: (nodeId: BracketNodeId, winnerId: GroupId) => void;
  correctionFor: (nodeId: BracketNodeId, winnerId: GroupId) => BracketCorrection | null;
  onAssign: (nodeId: BracketNodeId, tableId: TableId) => void;
  onFinish: () => void;
  onFocus: (round: BracketRound | null) => void;
  /**
   * Which of the two tournaments' trees this panel runs (issue #91, §10).
   *
   * The same tree — same nodes, same third-place routing, same corrections —
   * drawn for the `Trostrunde` in numbers rather than names. Both can be on
   * screen at once, which is why the heading names the tournament rather than
   * saying `Turnierbaum` twice.
   *
   * Defaulted, so the main field's panel is exactly what it was.
   */
  track?: RoundTrack;
  // New: phase and ceremony controls
  phase?: string;
  onShowCeremony?: (mode: 'AUTO' | 'STEP', step?: number) => void;
  onShowCeremonyStep?: () => void;
}) {
  /**
   * The one decided match the host has opened up for correction.
   *
   * Panel state rather than card state, for the reason the round panel gives:
   * arming a second card disarms the first, so there is never more than one
   * open target for a stray click.
   */
  const [armed, setArmed] = useState<BracketNodeId | null>(null);
  /** The correction waiting for an answer, or null. */
  const [pending, setPending] = useState<BracketCorrection | null>(null);
  /**
   * The forced rematches of a tree the host has been offered but not yet
   * confirmed (issue #72, docs/TOURNAMENT-RULES.md §3).
   *
   * Nothing is committed while this is set: the draw is a preview, so
   * cancelling costs the host nothing and the same press asks the same
   * question again.
   */
  const [pendingRematches, setPendingRematches] = useState<readonly BracketNode[] | null>(null);

  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const drawReason = drawBlockers.map((blocker) => blockerText(blocker, field))[0];

  /**
   * The draw button. A tree that repeats nothing goes straight through, and
   * only a forced rematch stops to ask (§3, never silently).
   */
  const requestDraw = () => {
    const forced = onPreviewDraw();
    if (forced === null || forced.length === 0) {
      onDraw();
      return;
    }
    setPendingRematches(forced);
  };

  const slotLabel = (id: GroupId | null) =>
    id === null ? de.outcome.bye : groupLabel(id, byId, participant).text;

  const pendingPairs: readonly RematchPair[] = (pendingRematches ?? []).map((node) => ({
    key: node.id,
    a: slotLabel(node.slotA),
    b: slotLabel(node.slotB),
  }));

  const decide = (nodeId: BracketNodeId, winnerId: GroupId) => {
    setArmed(null);
    // Asked every time and answered by the domain, so the dialog appears
    // exactly when something would be thrown away and never otherwise.
    const correction = correctionFor(nodeId, winnerId);
    if (correction === null) {
      onSetWinner(nodeId, winnerId);
      return;
    }
    setPending(correction);
  };

  const sectionLabel = track === 'MAIN' ? de.bracket.sectionLabel : de.consolation.bracketLabel;
  // The last press of the side event, and the door to the `Siegerehrung` on the
  // main field. Two different things behind one word would be the press a host
  // makes without meaning to (issue #91).
  const finishLabel = track === 'MAIN' ? de.bracket.finish : de.consolation.bracketFinish;

  return (
    <section
      className="relative flex flex-col gap-3"
      aria-label={sectionLabel}
      data-bracket-track={track}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">{sectionLabel}</h2>

        {bracket === null ? null : (
          <span className="wm-tnum text-host-sm text-wm-text" data-bracket-playable="">
            {de.bracket.playable({ n: playable })}
          </span>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          {phase === 'CEREMONY' ? (
            <>
              <button
                type="button"
                className={SECONDARY_CLASS}
                onClick={() => onShowCeremony?.('AUTO', 0)}
              >
                {de.bracket.showCeremony}
              </button>
              <button
                type="button"
                className={SECONDARY_CLASS}
                onClick={() => onShowCeremonyStep?.()}
              >
                {de.bracket.revealNext}
              </button>
            </>
          ) : null}
          {bracket === null ? (
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={requestDraw}
              disabled={!canDraw}
              // The reason is on the control the click was aimed at, for both
              // the pointer and the screen reader (every other panel does the
              // same).
              title={
                drawReason === undefined ? undefined : de.bracket.blocked({ reason: drawReason })
              }
              aria-label={
                drawReason === undefined
                  ? de.bracket.draw
                  : de.bracket.blocked({ reason: drawReason })
              }
              data-bracket-action="draw"
            >
              {de.bracket.draw}
            </button>
          ) : (
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onFinish}
              disabled={!canFinish}
              title={canFinish ? undefined : de.bracket.finishBlocked}
              aria-label={canFinish ? finishLabel : de.bracket.finishBlocked}
              data-bracket-action="finish"
            >
              {finishLabel}
            </button>
          )}
        </div>
      </header>

      {bracket === null ? (
        // Either the tree simply has not been drawn yet, or there is a reason it
        // cannot be — and the second is the more useful thing to read.
        <p className="text-host-sm text-wm-text-muted" data-bracket-none="">
          {drawReason ?? de.bracket.empty}
        </p>
      ) : (
        <>
          <FocusControl columns={columns} focus={focus} onFocus={onFocus} />

          <div className="flex gap-3 overflow-x-auto pb-1" data-bracket-tree="">
            {columns.map((column) => (
              <section
                key={column.round}
                className="flex w-72 shrink-0 flex-col gap-2"
                data-bracket-column={column.round}
                data-column-state={column.state}
              >
                <h3 className="flex items-baseline gap-2">
                  <span className="wm-label">{de.bracket.round[column.round]}</span>
                </h3>

                <ul className="flex flex-col gap-2">
                  {column.nodes.map((node) => (
                    <BracketNodeCard
                      key={node.id}
                      node={node}
                      groups={byId}
                      participant={participant}
                      tableLabel={tableLabelOf(tables, node)}
                      freeTables={freeTables}
                      since={occupiedSince(tables, node.id)}
                      now={now}
                      isArmed={armed === node.id}
                      onSetWinner={decide}
                      onAssign={onAssign}
                      onArm={() => setArmed(node.id)}
                      onDisarm={() => setArmed(null)}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {pending === null ? null : (
        <BracketCorrectionDialog
          correction={pending}
          groups={byId}
          participant={participant}
          onConfirm={() => {
            onSetWinner(pending.node.id, pending.winnerId);
            setPending(null);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}

      {pendingRematches === null ? null : (
        <RematchDialog
          pairs={pendingPairs}
          onConfirm={() => {
            setPendingRematches(null);
            onDraw();
          }}
          onCancel={() => setPendingRematches(null)}
        />
      )}
    </section>
  );
}

/**
 * Which part of the tree the projector shows.
 *
 * A row of rounds rather than a dropdown: it is one press during a moment the
 * host is talking to the room, and the current one has to be readable without
 * opening anything. The `Spiel um Platz 3` is not offered — it is drawn
 * whenever the `Finale` is, and "from the third-place match onwards" is not a
 * thing the tree can mean (§7).
 */
function FocusControl({
  columns,
  focus,
  onFocus,
}: {
  columns: readonly BracketColumn[];
  focus: BracketRound | null;
  onFocus: (round: BracketRound | null) => void;
}) {
  const rounds = columns.map((column) => column.round).filter((round) => round !== 'THIRD_PLACE');

  return (
    <div className="flex flex-wrap items-center gap-2" data-bracket-focus={focus ?? 'ALL'}>
      <span className="wm-label">{de.bracket.focusLabel}</span>

      <FocusButton
        label={de.bracket.focusAll}
        isActive={focus === null}
        onClick={() => {
          onFocus(null);
        }}
      />
      {rounds.map((round) => (
        <FocusButton
          key={round}
          label={de.bracket.focusRound({ round: de.bracket.round[round] })}
          isActive={focus === round}
          onClick={() => {
            onFocus(round);
          }}
        />
      ))}
    </div>
  );
}

function FocusButton({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`h-8 rounded-wm-sm border px-2 text-host-xs transition-colors duration-[--dur-fast] ease-out ${
        isActive
          ? 'border-wm-accent bg-wm-accent-soft text-wm-text'
          : 'border-wm-border-strong bg-wm-bg-elevated text-wm-text-muted hover:bg-wm-surface-hover'
      }`}
      onClick={onClick}
      aria-pressed={isActive}
      data-bracket-action="focus"
    >
      {label}
    </button>
  );
}

/**
 * What the host calls the table a match is on — and nothing at all once it is
 * over.
 *
 * *Whether* there is one to name is `bracketNodeTableId`'s (issue #90): a
 * decided node keeps its `tableId` as the record of where it was played
 * (docs/OPEN-QUESTIONS.md #37), and printing that on a finished card would read
 * as a table that is still busy. The rule lives in the domain because the
 * projector asks the same question, and this panel and the wall must not
 * disagree about which matches are still on a table.
 *
 * The fallback is this screen's own: an id that names no table is a table the
 * host removed mid-match, and the word alone is more use to them than a blank.
 */
function tableLabelOf(tables: readonly Table[], node: BracketNode): string | null {
  const tableId = bracketNodeTableId(node);
  if (tableId === null) {
    return null;
  }
  return tables.find((table) => table.id === tableId)?.label ?? de.table.label;
}

/** When the match on this node's table started, for the stopwatch. */
function occupiedSince(tables: readonly Table[], nodeId: BracketNodeId): Timestamp | null {
  // Compared as plain strings: a table carries the id of whatever is on it, and
  // in the final phase that is a bracket node (docs/OPEN-QUESTIONS.md #68).
  const carrying = tables.find(
    (table) => (table.currentMatchId as string | null) === (nodeId as string),
  );
  return carrying?.occupiedSince ?? null;
}

/** Why the tree cannot be drawn, in the host's words. */
function blockerText(blocker: BracketBlocker, field: number): string {
  switch (blocker) {
    case 'WRONG_PHASE':
      return de.bracket.blocker.notInNaming;
    case 'ALREADY_DRAWN':
      return de.bracket.blocker.alreadyDrawn;
    case 'NAMES_MISSING':
      return de.bracket.blocker.namesMissing;
    case 'FIELD_TOO_LARGE':
      return de.bracket.blocker.fieldTooLarge({ n: field, max: FINAL_PHASE_SIZE });
    case 'FIELD_TOO_SMALL':
      return de.bracket.blocker.fieldTooSmall;
    case 'FIELD_NOT_POWER_OF_TWO':
      return de.bracket.blocker.fieldNotPowerOfTwo({ n: Math.max(field, MINIMUM_BRACKET_SIZE) });
  }
}

/** 40 px, the floor docs/STYLEGUIDE.md §3 sets for a primary host control. */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-40';

const SECONDARY_CLASS =
  'h-8 rounded-wm-sm border px-2 text-host-xs transition-colors duration-[--dur-fast] ease-out border-wm-border-strong bg-wm-bg-elevated text-wm-text-muted hover:bg-wm-surface-hover';
