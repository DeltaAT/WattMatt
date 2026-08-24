import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { occupancyBoard, type TableSlot } from '@/domain/tables';
import type { Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { groupLabel } from '@/windows/groupLabel';

/**
 * `TABLE_OVERVIEW`: who plays where, on the projector (issue #13).
 *
 * The scene the audience gets between rounds — it answers the one question
 * fifty people in a room ask at once, and it answers it without anybody having
 * to walk to a table and read a piece of paper.
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

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="TABLE_OVERVIEW"
      data-settled={settled}
    >
      <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.tableOverview.title}</h1>

      {board.length === 0 ? (
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.tableOverview.empty}</p>
      ) : (
        <ul className={`grid flex-1 auto-rows-min gap-4 ${COLUMNS[density(board.length)]}`}>
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

  return (
    <li
      // 4 px of border, never a thin one: a hairline disappears through a
      // projector lens (docs/STYLEGUIDE.md §5).
      className={`flex items-baseline gap-6 rounded-wm-xl border-4 px-6 py-4 ${CARD_CLASS[table.status]}`}
      data-table-id={table.id}
      data-table-status={table.status}
    >
      <span className={`wm-display shrink-0 font-bold ${TYPE[size]}`}>{table.label}</span>
      <span className={`min-w-0 flex-1 truncate font-semibold ${TYPE[size]}`}>
        {pairingText(slot, groups, participant)}
      </span>
    </li>
  );
}

/**
 * How much room each table gets.
 *
 * A beamer scene that needs a scrollbar is the wrong scene
 * (docs/STYLEGUIDE.md §3), and the number of tables is the host's decision
 * rather than the designer's — so the grid gets denser instead of taller. Three
 * steps and no more: `text-beamer-body` is the absolute floor at 32 px, so a
 * venue with more tables than the third step holds is a scene that needs a
 * different design, not a smaller font (§2).
 */
type Density = 'roomy' | 'normal' | 'dense';

function density(count: number): Density {
  if (count <= 5) {
    return 'roomy';
  }
  return count <= 16 ? 'normal' : 'dense';
}

const COLUMNS: Record<Density, string> = {
  roomy: 'grid-cols-1',
  normal: 'grid-cols-2',
  dense: 'grid-cols-3',
};

const TYPE: Record<Density, string> = {
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
