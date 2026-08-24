import type { GroupId } from '@/domain/ids';
import { elapsedMs } from '@/domain/tables';
import type { Group, Match, ParticipantLabel, Timestamp } from '@/domain/types';
import { de, formatDuration } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * One match, with the two targets that decide it (issue #17,
 * docs/STYLEGUIDE.md §4 "Match card").
 *
 * The card is the whole interaction of a live round: the host walks to a table,
 * looks at who won, and presses that participant. One click, no confirmation
 * dialog — the acceptance criterion — which is affordable because every
 * decision is undoable (golden rule 6).
 *
 * A **decided** match is the exception, and the reason this component has a
 * state of its own to be told about. Its targets are gone until the host arms
 * the card, so the stray click that lands on a finished match while they are
 * aiming at the one below it cannot flip a result the room has already been
 * told. Arming is the panel's state, not the card's, so only one card is ever
 * armed and walking away from it disarms it.
 */
export function MatchCard({
  match,
  groups,
  participant,
  /** The table this match is on, already resolved to what the host calls it. */
  tableLabel,
  since,
  now,
  isArmed,
  onSetWinner,
  onArm,
  onDisarm,
}: {
  match: Match;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  tableLabel: string | null;
  /** When the match started on its table, for the stopwatch. Null when waiting. */
  since: Timestamp | null;
  now: Timestamp;
  isArmed: boolean;
  onSetWinner: (winnerId: GroupId) => void;
  onArm: () => void;
  onDisarm: () => void;
}) {
  const a = groupLabel(match.a, groups, participant);
  const b = groupLabel(match.b, groups, participant);
  const isBye = match.b === null;
  const isDecided = match.winnerId !== null;
  // Decided matches show their targets only once the host has armed the card;
  // undecided ones always do, because that is the one click the issue asks for.
  const showsTargets = !isBye && (!isDecided || isArmed);

  return (
    <li
      className={`flex flex-col gap-2 rounded-wm-md border bg-wm-surface p-2 ${
        isDecided ? 'border-wm-border' : 'border-wm-border-strong'
      }`}
      data-match-id={match.id}
      data-match-state={
        isBye ? 'bye' : isDecided ? 'decided' : tableLabel === null ? 'queued' : 'running'
      }
    >
      <header className="flex items-baseline gap-2">
        <span className="wm-label min-w-0 flex-1 truncate text-wm-text-muted" data-match-where="">
          {tableLabel ?? (isDecided ? de.match.finished : de.table.waitingForTable)}
        </span>
        {since === null ? null : (
          <span className="wm-tnum text-host-xs text-wm-live" data-match-running="">
            {de.table.runningFor({ duration: formatDuration(elapsedMs(since, now)) })}
          </span>
        )}
      </header>

      {isBye ? (
        // Decided by the draw itself: there is nobody to beat, so there is
        // nothing to press (docs/TOURNAMENT-RULES.md §3).
        <p className="text-host-sm text-wm-text" data-match-bye="">
          <span className="wm-display font-bold">{a.text}</span>{' '}
          <span className="text-wm-text-muted">{de.outcome.bye}</span>
        </p>
      ) : null}

      {isDecided && !isArmed ? <Result match={match} a={a.text} b={b.text} /> : null}

      {showsTargets ? (
        <>
          {isArmed ? (
            <p className="wm-label text-wm-live" data-match-prompt="correct">
              {de.match.correctPrompt}
            </p>
          ) : null}
          <div className="flex gap-2">
            <WinnerButton
              label={a.text}
              isWinner={match.winnerId === match.a}
              onClick={() => onSetWinner(match.a)}
            />
            <WinnerButton
              label={b.text}
              isWinner={match.b !== null && match.winnerId === match.b}
              onClick={() => (match.b === null ? undefined : onSetWinner(match.b))}
            />
          </div>
        </>
      ) : null}

      {isDecided && !isBye ? (
        <div className="flex justify-end">
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={isArmed ? onDisarm : onArm}
            data-match-action={isArmed ? 'cancel' : 'correct'}
          >
            {isArmed ? de.match.correctCancel : de.match.correct}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The result of a decided match.
 *
 * Three signals for the win, never colour alone (docs/STYLEGUIDE.md §1): the
 * token colour, a filled tick, and the German word. The loser is greyed and
 * carries the cross and `ausgeschieden` for the same reason.
 */
function Result({ match, a, b }: { match: Match; a: string; b: string }) {
  const winner = match.winnerId === match.a ? a : b;
  const loser = match.winnerId === match.a ? b : a;

  return (
    <div className="flex flex-col gap-1">
      <p
        className="border-l-4 border-wm-win pl-2 text-host-sm font-medium text-wm-win"
        data-match-winner=""
      >
        <span aria-hidden="true">{'✓ '}</span>
        {de.match.winnerIs({ participant: winner })}
      </p>
      <p className="pl-3 text-host-xs text-wm-lose opacity-60" data-match-loser="">
        <span aria-hidden="true">{'✗ '}</span>
        {`${loser} — ${de.outcome.eliminated}`}
      </p>
    </div>
  );
}

/**
 * One of the two targets. 48 px tall and half the card wide, well over the
 * 40 px floor docs/STYLEGUIDE.md §3 sets for a high-frequency control — this is
 * the most-pressed button of the evening, aimed at fast and under pressure.
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
      // The verb is on the button for the screen reader and the tooltip; the
      // visible face is the participant alone, because that is what the host is
      // scanning for across thirty-two cards.
      title={de.match.winnerAction({ participant: label })}
      aria-label={de.match.winnerAction({ participant: label })}
      data-match-action="winner"
    >
      <span className="wm-display block truncate">{label}</span>
    </button>
  );
}

/** 32 px, the floor for a host control (docs/STYLEGUIDE.md §3). */
const SECONDARY_CLASS =
  'h-8 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-2 text-host-xs text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-40';
