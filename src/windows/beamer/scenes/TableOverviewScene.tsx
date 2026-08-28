import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { occupancyBoard, type TableSlot } from '@/domain/tables';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { TABLE_TYPE } from '@/windows/beamer/tableType';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupNumber } from '@/windows/groupLabel';

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
  size,
}: {
  slot: TableSlot;
  groups: ReadonlyMap<GroupId, Group>;
  size: Density;
}) {
  const { table } = slot;
  const pairing = pairingOf(slot, groups);

  return (
    <li
      // 4 px of border, never a thin one: a hairline disappears through a
      // projector lens (docs/STYLEGUIDE.md §5).
      className={`flex items-baseline gap-6 rounded-wm-xl border-4 px-6 py-4 ${CARD_CLASS[table.status]}`}
      data-table-id={table.id}
      data-table-status={table.status}
    >
      {/*
       * The table's label, which is what somebody scans this wall for, drawn as
       * the host has it — `Tisch 3` by default (issue #100). It keeps a step of
       * its own: this is the one scene whose subject *is* the tables, and
       * shrinking their labels to make room for the numerals would be
       * optimising the wrong half (issue #75). `TABLE_TYPE` is the same ladder
       * the `Auslosung` and the round board use, so a table is the same size on
       * all three screens the room sees it on.
       *
       * `whitespace-nowrap` with `shrink-0`: the label is one unit, and a
       * `Tisch` that wrapped away from its number would be two.
       */}
      <span
        className={`wm-display wm-tnum shrink-0 whitespace-nowrap font-bold ${TABLE_TYPE[size]}`}
        data-table-label=""
      >
        {table.label}
      </span>

      {/*
       * What is on it: two numbers, or a word for the states that are not a
       * match. No participant label and nothing between the numbers but space
       * — the width the words took is the width the numerals now have.
       */}
      {typeof pairing === 'string' ? (
        <span className={`min-w-0 flex-1 truncate font-semibold ${TYPE[size]}`}>{pairing}</span>
      ) : (
        <span
          className={`flex min-w-0 flex-1 items-baseline justify-center gap-8 wm-display wm-tnum font-extrabold ${NUMBER_TYPE[size]}`}
          data-pairing=""
        >
          <span>{pairing.a}</span>
          {/*
            The word the space stands for, for a screen reader and for nobody
            else — `7 12` read aloud is two numbers and not a match.
          */}
          <span className="sr-only">{de.match.versus}</span>
          <span>{pairing.b}</span>
        </span>
      )}
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

const TYPE: Record<Density, string> = {
  roomy: 'text-beamer-h2',
  normal: 'text-beamer-h3',
  dense: 'text-beamer-body',
};

/**
 * And how big the two numbers on it are (issue #75).
 *
 * A step above the table's own label at every density: the table says which
 * card to look at, the numbers say whether it is yours, and the second is the
 * one that has to carry ten metres. `useFitToStage` shrinks the board from here
 * if the room turns out to be tighter than the ladder assumed.
 */
const NUMBER_TYPE: Record<Density, string> = {
  roomy: 'text-beamer-hero',
  normal: 'text-beamer-h1',
  dense: 'text-beamer-h2',
};

/**
 * What the card says beside the table: the two numbers, or a word.
 *
 * A string for the three states that are not a running match — free, locked,
 * and the table that claims a match nobody can find — and the pair otherwise,
 * so the caller can draw the numbers at the size the numerals deserve rather
 * than at the size a sentence would need.
 */
function pairingOf(
  { table, match }: TableSlot,
  groups: ReadonlyMap<GroupId, Group>,
): string | { a: string; b: string } {
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

  return {
    a: groupNumber(match.a, groups).text,
    b: groupNumber(match.b, groups).text,
  };
}

/** Grey `frei`, amber `belegt`, dark red `gesperrt` (docs/STYLEGUIDE.md §4). */
const CARD_CLASS: Record<TableSlot['table']['status'], string> = {
  FREE: 'border-wm-border-strong bg-wm-surface text-wm-text-muted',
  OCCUPIED: 'border-wm-live bg-wm-live-bg text-wm-text',
  DISABLED: 'border-wm-lose bg-wm-lose-bg text-wm-text-muted opacity-70',
};
