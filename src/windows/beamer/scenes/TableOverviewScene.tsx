import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { occupancyBoard, type TableSlot } from '@/domain/tables';
import type { Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, type NameType } from '@/ui/nameFit';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupLabel } from '@/windows/groupLabel';

/**
 * `TABLE_OVERVIEW`: who plays where, on the projector (issue #13).
 *
 * The scene the audience gets between rounds — it answers the one question
 * fifty people in a room ask at once, and it answers it without anybody having
 * to walk to a table and read a piece of paper.
 *
 * Which means **every** table has to be on it. A venue with more tables than
 * the grid held used to lose the last ones off the bottom of an
 * `overflow-hidden` stage, and the pair standing at that table would have been
 * left looking for themselves on a wall they were not on. So the grid takes as
 * many columns as the room needs and the board is scaled down until it fits
 * (issue #55, `useFitToStage`).
 *
 * One idea per screen (docs/STYLEGUIDE.md §3), so there is no stopwatch here:
 * how long a match has been running is the host's problem and belongs on their
 * board, while the room only wants to know which table to stand at. Nothing
 * depends on hover, and every status carries a word as well as a colour — a
 * projector in a bright room destroys hue differences (§1, §5).
 */
export function TableOverviewScene({
  tournament,
  settled,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in; nothing here animates yet. */
  settled: boolean;
}) {
  const board = occupancyBoard(tournament.tables, tournament.matches);
  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const { frame, content } = useFitToStage();

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="TABLE_OVERVIEW"
      data-settled={settled}
    >
      {/* Outside the frame, so the title stays the same size at 3 tables and
       * at 30 — it is what tells somebody walking in what they are reading. */}
      <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.tableOverview.title}</h1>

      {board.length === 0 ? (
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.tableOverview.empty}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
          <div className="beamer-fit" ref={content}>
            <ul
              className="grid auto-rows-min gap-4"
              style={gridColumns(fitColumns(board.length, CELL_ASPECT))}
            >
              {board.map((slot) => (
                <TableCard
                  key={slot.table.id}
                  slot={slot}
                  groups={byId}
                  participant={tournament.participantLabel}
                  size={density(board.length)}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function TableCard({
  slot,
  groups,
  participant,
  size,
}: {
  slot: TableSlot;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  size: Density;
}) {
  const { table } = slot;
  const pairing = pairingText(slot, groups, participant);

  return (
    <li
      // 4 px of border, never a thin one: a hairline disappears through a
      // projector lens (docs/STYLEGUIDE.md §5).
      className={`flex items-baseline gap-6 rounded-wm-xl border-4 px-6 py-4 ${CARD_CLASS[table.status]}`}
      data-table-id={table.id}
      data-table-status={table.status}
    >
      <span className={`wm-display shrink-0 font-bold ${TYPE[size]}`}>{table.label}</span>
      {/*
       * The pairing steps down for a long name before the `truncate` cuts it
       * (issue #23, `@/ui/nameFit`). The table's own label does not: it is
       * short by construction and is what somebody scans the wall for.
       */}
      <span className={`min-w-0 flex-1 truncate font-semibold ${fitNameType(pairing, TYPE[size])}`}>
        {pairing}
      </span>
    </li>
  );
}

/**
 * The shape of a table card: a label, and a pairing beside it that is most of
 * the width. Wide, so the grid should stay narrow — at this value `fitColumns`
 * puts 5 tables in one column and 16 in two, which is the ladder this scene
 * used before, and 36 in three, 64 in four, instead of stopping.
 */
const CELL_ASPECT = 9;

/**
 * How much type each table gets.
 *
 * Three steps, as before, and they decide the *relative* emphasis inside a card
 * rather than whether the board fits — that is `useFitToStage`'s job now, and
 * it happens on top of this. So a venue with more tables than the densest step
 * anticipated gets the same card drawn smaller rather than no card at all
 * (issue #55, docs/OPEN-QUESTIONS.md #57).
 */
type Density = 'roomy' | 'normal' | 'dense';

function density(count: number): Density {
  if (count <= 5) {
    return 'roomy';
  }
  return count <= 16 ? 'normal' : 'dense';
}

const TYPE: Record<Density, NameType> = {
  roomy: 'text-beamer-h2',
  normal: 'text-beamer-h3',
  dense: 'text-beamer-body',
};

function pairingText(
  { table, match }: TableSlot,
  groups: ReadonlyMap<GroupId, Group>,
  participant: ParticipantLabel,
): string {
  if (table.status === 'DISABLED') {
    return de.beamer.tableOverview.disabled;
  }
  if (table.currentMatchId === null) {
    return de.beamer.tableOverview.free;
  }
  if (match === null) {
    // A table that says it is busy with a match nobody can find. Said out loud
    // rather than drawn blank, so it is obvious from the back of the room that
    // this table is not the one to stand at.
    return de.table.unknownMatch;
  }

  const a = groupLabel(match.a, groups, participant).text;
  const b = groupLabel(match.b, groups, participant).text;
  return `${a} ${de.match.versus} ${b}`;
}

/** Grey `frei`, amber `belegt`, dark red `gesperrt` (docs/STYLEGUIDE.md §4). */
const CARD_CLASS: Record<TableSlot['table']['status'], string> = {
  FREE: 'border-wm-border-strong bg-wm-surface text-wm-text-muted',
  OCCUPIED: 'border-wm-live bg-wm-live-bg text-wm-text',
  DISABLED: 'border-wm-lose bg-wm-lose-bg text-wm-text-muted opacity-70',
};
