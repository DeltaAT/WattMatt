import type { ConsolationBlocker, ConsolationSummary } from '@/domain/consolation';
import type { CloseRoundBlocker, DrawBlocker } from '@/domain/draw';
import type { GroupId, MatchId, TableId } from '@/domain/ids';
import type { RoundBoard, RoundSummary } from '@/domain/round';
import type { Group, Match, ParticipantLabel, Timestamp } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';
import { CONSOLATION_ROUND_COPY, RoundPanel } from '@/windows/host/RoundPanel';

/**
 * The `Trostrunde` control panel (issue #73, docs/TOURNAMENT-RULES.md §10).
 *
 * Three states, in the order the evening reaches them.
 *
 * **The question**, once the `Hoffnungsrunde` has closed: does the side event
 * happen at all? Both answers are buttons and neither is pre-selected, because
 * this is a decision about the room — how late it is, whether people are still
 * there — that no rule can make for the host. The wording says out loud that
 * the winner does not come back into the main field, because that is the thing
 * a host will otherwise announce wrongly.
 *
 * The **field is listed by name** beside the question, not just counted
 * (issue #102). It is fixed the moment the lottery closes and cannot change
 * afterwards, so this is the last point at which a host can look at it and say
 * "that is wrong" — after the button it is on the projector, and a wrong list
 * there is a correction made in front of the room rather than a question asked
 * at the laptop. A count alone cannot be checked against anything; the numbers
 * can.
 *
 * **The board**, while it runs. Drawn by `RoundPanel` in the side event's own
 * words rather than by a second board of its own: the host is running two
 * tournaments at once and cannot afford two different screens to read
 * (`RoundPanelCopy`).
 *
 * **The winner**, once one group is left. Numbers only — the `Trostrunde` never
 * enters a naming phase, and if the winner is to be named at the ceremony the
 * host types the name there, once.
 *
 * Presentational. Every decision comes in as a callback from `useConsolation`,
 * which is what lets the whole panel be rendered in a test without a store.
 */
export function ConsolationPanel({
  isOffered,
  field,
  blockers,
  summary,
  board,
  roundSummary,
  groups,
  participant,
  now,
  drawBlockers,
  canDraw,
  closeBlockers,
  canClose,
  undecided,
  rematches,
  onStart,
  onDecline,
  onPreviewDraw,
  onDraw,
  onSetWinner,
  onStartNext,
  onClose,
  onShowOnBeamer,
}: {
  isOffered: boolean;
  /**
   * Who is in the side event, in qualifying-draw order — the stored field of
   * issue #102, not a live reading of who is out.
   *
   * The whole list rather than its size, because the host is being asked to
   * commit to it. Its length is still what the question is worded with.
   */
  field: readonly Group[];
  blockers: readonly ConsolationBlocker[];
  /** Null while the side event has not been started. */
  summary: ConsolationSummary | null;
  board: RoundBoard | null;
  roundSummary: RoundSummary | null;
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
  rematches: ReadonlySet<MatchId>;
  onStart: () => void;
  onDecline: () => void;
  onPreviewDraw: () => readonly Match[] | null;
  onDraw: () => void;
  onSetWinner: (matchId: MatchId, winnerId: GroupId) => void;
  onStartNext: (tableId: TableId) => void;
  onClose: () => void;
  onShowOnBeamer: () => void;
}) {
  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const reason = blockers.map(blockerText)[0];

  if (isOffered) {
    return (
      <section
        className="flex flex-col gap-3 rounded-wm-md border border-wm-border bg-wm-bg-elevated p-3"
        aria-label={de.consolation.sectionLabel}
        data-consolation="offer"
      >
        <h2 className="wm-display text-host-lg font-bold">{de.consolation.offerTitle}</h2>
        <p className="text-host-sm text-wm-text-muted">
          {de.consolation.offer({ n: field.length })}
        </p>

        {/*
          The field itself, before anything is started. Rendered as the same
          chips the `Hoffnungsrunde` panel uses for its pot, so a host moving
          between the two panels is reading one design rather than two.
        */}
        <section className="flex flex-col gap-1" data-consolation-field="">
          <h3 className="wm-label">
            {de.consolation.fieldTitle} <span className="wm-tnum">{field.length}</span>
          </h3>
          <ul className="flex flex-wrap gap-1">
            {field.map((entry) => (
              <li
                key={entry.id}
                className="rounded-wm-sm bg-wm-surface px-2 py-1 text-host-sm text-wm-text"
                data-group-id={entry.id}
              >
                {groupLabel(entry.id, byId, participant).text}
              </li>
            ))}
          </ul>
          <p className="text-host-sm text-wm-text-muted">{de.consolation.fieldHint}</p>
        </section>

        <div className="flex gap-2">
          <button
            type="button"
            className={PRIMARY_CLASS}
            onClick={onStart}
            // The reason is on the control the click was aimed at, for both the
            // pointer and the screen reader (the round panel does the same).
            title={reason === undefined ? undefined : de.consolation.blocked({ reason })}
            aria-label={
              reason === undefined ? de.consolation.start : de.consolation.blocked({ reason })
            }
            data-consolation-action="start"
          >
            {de.consolation.start}
          </button>

          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onDecline}
            data-consolation-action="decline"
          >
            {de.consolation.decline}
          </button>
        </div>
      </section>
    );
  }

  if (summary === null) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3" data-consolation={summary.state.toLowerCase()}>
      {summary.state === 'FINISHED' && summary.winner !== null ? (
        <div
          className="flex flex-col gap-1 rounded-wm-md border border-wm-accent bg-wm-accent-soft p-3"
          data-consolation-winner={summary.winner.id}
        >
          <p className="wm-display text-host-lg font-bold text-wm-text">
            {de.consolation.winner({
              participant: groupLabel(summary.winner.id, byId, participant).text,
            })}
          </p>
          <p className="text-host-sm text-wm-text-muted">{de.consolation.winnerHint}</p>
        </div>
      ) : (
        <p className="wm-label text-wm-text-muted" data-consolation-standing="">
          {de.consolation.standing({ n: summary.standing.length })}
        </p>
      )}

      {/*
        The same board the main field is run on, in the side event's words. Its
        own draw and close buttons are the `CONSOLATION`-track ones, and they
        grey themselves out with the reason on them once the event is decided.
      */}
      <RoundPanel
        round={summary.round}
        board={board}
        summary={roundSummary}
        groups={groups}
        participant={participant}
        now={now}
        drawBlockers={drawBlockers}
        canDraw={canDraw}
        closeBlockers={closeBlockers}
        canClose={canClose}
        undecided={undecided}
        rematches={rematches}
        copy={CONSOLATION_ROUND_COPY}
        onPreviewDraw={onPreviewDraw}
        onDraw={onDraw}
        onSetWinner={onSetWinner}
        onStartNext={onStartNext}
        onClose={onClose}
        onShowOnBeamer={onShowOnBeamer}
      />
    </section>
  );
}

/** The German for a blocker, so the reason sits on the button it blocks. */
function blockerText(blocker: ConsolationBlocker): string {
  switch (blocker) {
    case 'QUALIFYING_OPEN':
      return de.consolation.blocker.qualifyingOpen;
    case 'REPECHAGE_OPEN':
      return de.consolation.blocker.repechageOpen;
    case 'ALREADY_ANSWERED':
      return de.consolation.blocker.alreadyAnswered;
    case 'FIELD_TOO_SMALL':
      return de.consolation.blocker.fieldTooSmall;
  }
}

const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
