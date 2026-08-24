import { useState, type ReactNode } from 'react';

import type { CloseRoundBlocker, DrawBlocker } from '@/domain/draw';
import type { GroupId, MatchId, TableId } from '@/domain/ids';
import type { RoundBoard, RoundSummary } from '@/domain/round';
import type { TableSlot } from '@/domain/tables';
import type { Group, Match, ParticipantLabel, Round, Timestamp } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';
import { MatchCard } from '@/windows/host/MatchCard';

/**
 * The round control panel (issue #17).
 *
 * The screen the host stares at for most of the event, so it is laid out the
 * way the room is: the tables first, because that is where the host is looking
 * and where the next decision comes from; then who is waiting for one; then
 * what has already been decided, which is the section they only need when they
 * got something wrong. The live summary sits beside the header, where it can be
 * read without leaving the matches.
 *
 * Everything is on one screen and nothing is behind a tab, because the issue's
 * third acceptance criterion is that thirty-two matches stay visible without
 * hunting — a match that is one click away is a match the host has to remember
 * to look for.
 *
 * Presentational. Every decision comes in as a callback from `useRound`, which
 * is what lets the whole panel be rendered in a test without a store.
 */
export function RoundPanel({
  round,
  board,
  summary,
  groups,
  participant,
  now,
  drawBlockers,
  canDraw,
  closeBlockers,
  canClose,
  undecided,
  onDraw,
  onSetWinner,
  onStartNext,
  onClose,
  onShowOnBeamer,
}: {
  round: Round | null;
  board: RoundBoard | null;
  summary: RoundSummary | null;
  groups: readonly Group[];
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  /** Re-read every second by `useNow`, so the running times move on their own. */
  now: Timestamp;
  drawBlockers: readonly DrawBlocker[];
  canDraw: boolean;
  closeBlockers: readonly CloseRoundBlocker[];
  canClose: boolean;
  undecided: number;
  onDraw: () => void;
  onSetWinner: (matchId: MatchId, winnerId: GroupId) => void;
  onStartNext: (tableId: TableId) => void;
  onClose: () => void;
  onShowOnBeamer: () => void;
}) {
  /**
   * The one decided match whose result the host has opened up for correction.
   *
   * Panel state rather than card state, so arming a second card disarms the
   * first: a screen with four cards left open is four chances for the stray
   * click the second acceptance criterion is about.
   */
  const [armed, setArmed] = useState<MatchId | null>(null);

  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const drawReason = drawBlockers.map((blocker) => drawBlockerText(blocker, participant))[0];
  const closeReason = closeBlockers.map((blocker) => closeBlockerText(blocker, undecided))[0];

  const card = (match: Match, tableLabel: string | null, since: Timestamp | null) => (
    <MatchCard
      key={match.id}
      match={match}
      groups={byId}
      participant={participant}
      tableLabel={tableLabel}
      since={since}
      now={now}
      isArmed={armed === match.id}
      onSetWinner={(winnerId) => {
        // Disarmed first: after a correction the card is a decided card again,
        // and leaving its targets on screen is the state this whole interaction
        // exists to avoid.
        setArmed(null);
        onSetWinner(match.id, winnerId);
      }}
      onArm={() => setArmed(match.id)}
      onDisarm={() => setArmed(null)}
    />
  );

  return (
    <section className="flex flex-col gap-3" aria-label={de.round.sectionLabel}>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="wm-display text-host-lg font-bold">
          {round === null ? de.round.sectionLabel : round.label}
        </h2>

        {round === null ? null : (
          <>
            <span className="wm-label text-wm-text-muted" data-round-state={round.state}>
              {de.round.state[round.state]}
            </span>
            <span className="wm-tnum text-host-sm text-wm-text" data-round-progress="">
              {de.round.progress({
                decided: board?.progress.decided ?? 0,
                total: board?.progress.total ?? 0,
              })}
            </span>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onShowOnBeamer}
            disabled={round === null}
            data-round-action="beamer"
          >
            {de.round.showOnBeamer}
          </button>

          <button
            type="button"
            className={PRIMARY_CLASS}
            onClick={onDraw}
            disabled={!canDraw}
            // The reason is on the control the click was aimed at, for both the
            // pointer and the screen reader (the pre-start panel does the same).
            title={drawReason === undefined ? undefined : de.draw.blocked({ reason: drawReason })}
            aria-label={
              drawReason === undefined ? de.draw.start : de.draw.blocked({ reason: drawReason })
            }
            data-round-action="draw"
          >
            {de.draw.start}
          </button>
        </div>
      </header>

      {round === null || board === null || summary === null ? (
        // Either there is simply nothing open yet, or there is a reason there
        // never will be in this phase — and the second is the more useful thing
        // to read (docs/OPEN-QUESTIONS.md #49).
        <p className="text-host-sm text-wm-text-muted" data-round-none="">
          {drawReason ?? de.round.none}
        </p>
      ) : (
        <>
          <Summary summary={summary} groups={byId} participant={participant} />

          <Section title={de.round.tablesTitle} count={null}>
            <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
              {board.tables.map((slot) => (
                <TableColumn
                  key={slot.table.id}
                  slot={slot}
                  hasQueue={board.queued.length > 0}
                  onStartNext={() => onStartNext(slot.table.id)}
                >
                  {slot.match === null
                    ? null
                    : card(slot.match, slot.table.label, slot.table.occupiedSince)}
                </TableColumn>
              ))}
            </ul>
          </Section>

          <Section
            title={de.round.queueTitle}
            count={
              board.queued.length === 0 ? null : de.round.queueCount({ n: board.queued.length })
            }
          >
            {board.queued.length === 0 ? (
              <p className="text-host-sm text-wm-text-faint" data-round-queue="empty">
                {de.round.queueEmpty}
              </p>
            ) : (
              <ul
                className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]"
                data-round-queue="list"
              >
                {board.queued.map((match) => card(match, null, null))}
              </ul>
            )}
          </Section>

          <Section title={de.round.decidedTitle} count={null}>
            {board.decided.length === 0 ? (
              <p className="text-host-sm text-wm-text-faint" data-round-decided="empty">
                {de.round.decidedEmpty}
              </p>
            ) : (
              <ul
                className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]"
                data-round-decided="list"
              >
                {board.decided.map((match) => card(match, null, null))}
              </ul>
            )}
          </Section>

          <div>
            <button
              type="button"
              className={PRIMARY_CLASS}
              onClick={onClose}
              disabled={!canClose}
              title={
                closeReason === undefined
                  ? undefined
                  : de.round.closeBlocked({ reason: closeReason })
              }
              aria-label={
                closeReason === undefined
                  ? de.round.close
                  : de.round.closeBlocked({ reason: closeReason })
              }
              data-round-action="close"
            >
              {de.round.close}
            </button>

            {closeReason === undefined ? null : (
              <p className="mt-1 text-host-sm text-wm-text-muted" data-round-close-reason="">
                {closeReason}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** One labelled block of the panel. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2">
        <span className="wm-label">{title}</span>
        {count === null ? null : <span className="text-host-xs text-wm-text-faint">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

/**
 * One table's column of the board: what is on it, or the button that puts the
 * next waiting pair there.
 *
 * The table was already freed when its winner was marked — the host's remaining
 * act is the confirmation that the next pair walks up, which never happens on
 * its own (docs/TOURNAMENT-RULES.md §3, golden rule 3). A disabled table shows
 * neither: it is out of service and is never offered a match.
 */
function TableColumn({
  slot,
  hasQueue,
  onStartNext,
  children,
}: {
  slot: TableSlot;
  hasQueue: boolean;
  onStartNext: () => void;
  children: ReactNode;
}) {
  const isFree = slot.table.status === 'FREE';

  return (
    <li
      className="flex flex-col gap-2 rounded-wm-md border border-wm-border bg-wm-bg-elevated p-2"
      data-round-table={slot.table.id}
      data-table-status={slot.table.status}
    >
      <p className="wm-label flex items-baseline gap-2">
        <span className="wm-display text-host-sm text-wm-text">{slot.table.label}</span>
        {slot.match === null ? (
          <span className="text-wm-text-faint">
            {slot.table.status === 'DISABLED' ? de.table.disabled : de.table.free}
          </span>
        ) : null}
      </p>

      {slot.match === null ? null : <ul className="flex flex-col gap-2">{children}</ul>}

      {slot.match === null && isFree ? (
        <button
          type="button"
          className={NEXT_CLASS}
          onClick={onStartNext}
          disabled={!hasQueue}
          title={de.round.startNextOn({ table: slot.table.label })}
          aria-label={de.round.startNextOn({ table: slot.table.label })}
          data-round-action="next"
        >
          {de.round.startNext}
        </button>
      ) : null}
    </li>
  );
}

/**
 * The live summary: who is through, who is out, and what that leaves the
 * repechage to do (docs/TOURNAMENT-RULES.md §3 and §4).
 *
 * The repechage line is stable from the moment the round is drawn — every match
 * produces exactly one winner, so the field size at the close is the number of
 * matches (`repechageOutlook` in `@/domain/round`). The host can therefore read
 * it at the start of the round and plan the evening around it.
 */
function Summary({
  summary,
  groups,
  participant,
}: {
  summary: RoundSummary;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
}) {
  const names = (ids: readonly GroupId[]) =>
    ids.map((id) => groupLabel(id, groups, participant).text);

  return (
    <div className="flex flex-col gap-2 rounded-wm-md border border-wm-border bg-wm-bg-elevated p-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="wm-label">{de.round.summaryTitle}</span>
        <span className="wm-tnum text-host-sm text-wm-win" data-round-summary="winners">
          {de.round.summaryWinners({ n: summary.winners.length })}
        </span>
        <span className="wm-tnum text-host-sm text-wm-lose" data-round-summary="losers">
          {de.round.summaryLosers({ n: summary.losers.length })}
        </span>
        <span className="wm-tnum text-host-sm text-wm-text-muted" data-round-summary="open">
          {de.round.summaryOpen({ n: summary.progress.open })}
        </span>
      </div>

      {summary.repechage === null ? null : (
        <p className="text-host-sm text-wm-text-muted" data-round-summary="repechage">
          {summary.repechage.skipped
            ? de.round.summaryRepechageSkipped({ target: summary.repechage.target })
            : de.round.summaryRepechage({
                target: summary.repechage.target,
                need: summary.repechage.need,
              })}
        </p>
      )}

      {summary.winners.length === 0 ? null : (
        <Chips label={de.outcome.winner} tone="win" names={names(summary.winners)} />
      )}
      {summary.losers.length === 0 ? null : (
        <Chips label={de.outcome.eliminated} tone="lose" names={names(summary.losers)} />
      )}
    </div>
  );
}

/** The participants behind a count, so the host can check a name against the room. */
function Chips({
  label,
  tone,
  names,
}: {
  label: string;
  tone: 'win' | 'lose';
  names: readonly string[];
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-1" data-round-chips={tone}>
      <span className="wm-label w-24 shrink-0">{label}</span>
      {names.map((name, index) => (
        <span
          key={`${name}-${String(index)}`}
          className={`wm-display rounded-wm-sm px-1 text-host-xs ${
            tone === 'win' ? 'bg-wm-win-bg text-wm-win' : 'bg-wm-lose-bg text-wm-lose opacity-60'
          }`}
        >
          {name}
        </span>
      ))}
    </p>
  );
}

/** The German for a draw blocker, in the wording this tournament uses. */
function drawBlockerText(blocker: DrawBlocker, participant: ParticipantLabel): string {
  switch (blocker) {
    case 'NOT_A_DRAWING_PHASE':
      return de.draw.notADrawingPhase;
    case 'ROUND_OPEN':
      return de.draw.roundOpen;
    case 'TOO_FEW_GROUPS':
      return de.participant[participant].tooFew;
    case 'QUALIFYING_ALREADY_DRAWN':
      return de.draw.qualifyingAlreadyDrawn;
  }
}

/** The German for a close blocker. It names how many are still open. */
function closeBlockerText(blocker: CloseRoundBlocker, undecided: number): string {
  switch (blocker) {
    case 'NO_OPEN_ROUND':
      return de.round.closeNoRound;
    case 'MATCHES_UNDECIDED':
      return de.round.closeUndecided({ n: undecided });
  }
}

/** 40 px: a high-frequency host control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';

const NEXT_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-40';
