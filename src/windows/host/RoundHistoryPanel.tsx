import { useState } from 'react';

import type { GroupId, RoundId } from '@/domain/ids';
import type { RoundRecord } from '@/domain/round';
import type { Group, Match, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * Every round of the evening, browsable, and any of them puttable back on the
 * projector (issue #22).
 *
 * The question this exists for is asked at every tournament, usually into a
 * microphone: *wen hat sie in der zweiten Runde geschlagen?* Without it the
 * host would have to undo their way backwards through the evening to find out,
 * which is the one thing they must never do to answer a question.
 *
 * **Newest first.** The round the host wants is nearly always the one that just
 * ended, and a list that grows downwards puts it further away with every round
 * played. The domain hands the history over in the order it happened
 * (`roundHistory`); which end the screen starts at is a decision about a screen.
 *
 * **One round open at a time.** Expanding a second collapses the first, so the
 * panel cannot grow to twenty matches times four rounds under the controls the
 * host actually needs — the same argument the round panel's armed card makes.
 *
 * **Showing a round on the beamer changes nothing else.** It stages a scene and
 * touches no tournament state, so the round that is running carries on
 * underneath it and the host puts the live board back when they are done
 * (golden rule 3).
 *
 * Presentational. Every decision comes in as a callback from `usePhase`.
 */
export function RoundHistoryPanel({
  history,
  groups,
  participant,
  onShowOnBeamer,
}: {
  /** Oldest first, as the domain produces it. */
  history: readonly RoundRecord[];
  groups: readonly Group[];
  /** The wording this tournament uses: `Gruppe`, `Team` or `Spieler`. */
  participant: ParticipantLabel;
  onShowOnBeamer: (roundId: RoundId) => void;
}) {
  const [open, setOpen] = useState<RoundId | null>(null);

  const byId: ReadonlyMap<GroupId, Group> = new Map(groups.map((group) => [group.id, group]));
  const name = (groupId: GroupId | null) => groupLabel(groupId, byId, participant).text;

  return (
    <section className="flex flex-col gap-3" aria-label={de.history.sectionLabel}>
      <h2 className="wm-display text-host-lg font-bold">{de.history.sectionLabel}</h2>

      {history.length === 0 ? (
        <p className="text-host-sm text-wm-text-faint" data-history="empty">
          {de.history.empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-history="list">
          {[...history].reverse().map((record) => {
            const isOpen = open === record.round.id;

            return (
              <li
                key={record.round.id}
                className="flex flex-col gap-2 rounded-wm-md border border-wm-border bg-wm-bg-elevated p-2"
                data-history-round={record.round.id}
              >
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="wm-display text-host-sm text-wm-text">{record.round.label}</span>
                  <span
                    className="wm-label text-wm-text-muted"
                    data-history-state={record.round.state}
                  >
                    {de.round.state[record.round.state]}
                  </span>
                  <span className="wm-tnum text-host-xs text-wm-text-muted" data-history-result="">
                    {de.history.result({
                      winners: record.summary.winners.length,
                      losers: record.summary.losers.length,
                    })}
                  </span>

                  <div className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className={SECONDARY_CLASS}
                      onClick={() => setOpen(isOpen ? null : record.round.id)}
                      aria-expanded={isOpen}
                      data-history-action="toggle"
                    >
                      {isOpen ? de.history.hide : de.history.show}
                    </button>
                    <button
                      type="button"
                      className={SECONDARY_CLASS}
                      onClick={() => onShowOnBeamer(record.round.id)}
                      data-history-action="beamer"
                    >
                      {de.history.showOnBeamer}
                    </button>
                  </div>
                </div>

                {isOpen ? (
                  <ul className="flex flex-col gap-1" data-history-matches="">
                    {record.round.matches.map((match) => (
                      <li key={match.id} className="text-host-sm text-wm-text-muted">
                        {pairingText(match, name)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * One line of a past round: who beat whom.
 *
 * Written as a sentence rather than drawn as two cards, because this is read
 * once to answer a question and then closed again — the card treatment belongs
 * to the round that is being played (`MatchCard`), where the host is clicking
 * rather than reading.
 */
function pairingText(match: Match, name: (groupId: GroupId | null) => string): string {
  if (match.b === null) {
    return de.history.byePairing({ participant: name(match.a) });
  }
  if (match.winnerId === null) {
    return de.history.undecided({ a: name(match.a), b: name(match.b) });
  }
  const loser = match.winnerId === match.a ? match.b : match.a;
  return de.history.pairing({ winner: name(match.winnerId), loser: name(loser) });
}

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
