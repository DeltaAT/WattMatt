import type { BracketCorrection } from '@/domain/bracket';
import type { GroupId } from '@/domain/ids';
import type { BracketNode, Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * "Correcting a decided node warns clearly that downstream results will be
 * discarded, lists what is lost, and requires confirmation" (issue #26).
 *
 * The one dialog of the final phase, and it exists because this is the one
 * correction that costs something the room has watched. Everything else in the
 * app commits on a single click and leans on undo (golden rule 6); a
 * `Viertelfinale` corrected an hour later takes the two matches played on top
 * of it with it, and a host who found that out afterwards would be standing in
 * front of fifty people wondering what happened to the `Finale`.
 *
 * It **lists the matches by name** rather than counting them. "2 Ergebnisse
 * werden verworfen" is a number to be trusted; `Finale: Team 3 schlägt Team 7`
 * is a sentence the host can check against the room in front of them.
 *
 * It is never shown when nothing would be discarded — `bracketCorrection`
 * answers null for that, which is the ordinary correction and stays one click.
 * A dialog in front of every result is a dialog that gets dismissed unread.
 */
export function BracketCorrectionDialog({
  correction,
  groups,
  participant,
  onConfirm,
  onCancel,
}: {
  correction: BracketCorrection;
  groups: ReadonlyMap<GroupId, Group>;
  /** The wording this tournament uses, for every participant named below. */
  participant: ParticipantLabel;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const name = (groupId: GroupId | null) =>
    groupId === null ? de.bracket.open : groupLabel(groupId, groups, participant).text;

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={de.bracket.correctDialog.title}
      data-dialog="bracket-correction"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.bracket.correctDialog.title}</h2>

        <p className="text-host-sm text-wm-text-muted">
          {de.bracket.correctDialog.body({ participant: name(correction.winnerId) })}
        </p>

        {/*
         * The list is the whole point of the dialog, so it is the loudest thing
         * in it: the colour of a result that is about to be thrown away, and
         * one line per match with the round it belongs to.
         */}
        <ul className="flex flex-col gap-1" data-dialog-discards="">
          {correction.discards.map((node) => (
            <li
              key={node.id}
              className="rounded-wm-sm border-l-4 border-wm-lose bg-wm-lose-bg px-2 py-1 text-host-sm text-wm-text"
              data-discard-node={node.id}
            >
              {describe(node, name)}
            </li>
          ))}
        </ul>

        <p className="text-host-xs text-wm-text-faint">{de.bracket.correctDialog.note}</p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className={SECONDARY_CLASS}
            onClick={onCancel}
            data-dialog-action="cancel"
          >
            {de.bracket.correctCancel}
          </button>
          <button
            type="button"
            className={DANGER_CLASS}
            onClick={onConfirm}
            data-dialog-action="confirm"
          >
            {de.bracket.correctDialog.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One discarded result, in the words the host would use out loud. */
function describe(node: BracketNode, name: (groupId: GroupId | null) => string): string {
  const round = de.bracket.round[node.round];
  const winner = name(node.winnerId);
  const loser = node.winnerId === node.slotA ? node.slotB : node.slotA;

  return loser === null
    ? de.bracket.correctDialog.byeEntry({ round, winner })
    : de.bracket.correctDialog.entry({ round, winner, loser: name(loser) });
}

/** 32 px, the floor for a host control (docs/STYLEGUIDE.md §3). */
const SECONDARY_CLASS =
  'h-8 rounded-wm-sm border border-wm-border-strong bg-wm-bg-elevated px-3 text-host-sm text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';

/**
 * The confirming button carries the loss in its colour as well as in its words:
 * it is the only control in the app that throws a result away.
 */
const DANGER_CLASS =
  'h-8 rounded-wm-sm border border-wm-lose bg-wm-lose-bg px-3 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover';
