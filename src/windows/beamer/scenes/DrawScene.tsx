import type { GroupId, TableId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Group, Match, Table } from '@/domain/types';
import { de } from '@/i18n';
import { GroupBox, type GroupBoxScale } from '@/ui';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupNumber } from '@/windows/groupLabel';
import { tableNumber } from '@/windows/tableLabel';

/**
 * `DRAW`: the Auslosung, live in front of the room (issue #18, redesigned by
 * issue #76).
 *
 * The signature moment of the whole app, and the one scene where *how* it is
 * drawn is the point rather than a decoration — the sequence is the
 * entertainment (docs/MOTION.md §4.1).
 *
 * The board is a pure function of `step`. When the step advances lives in
 * `useDrawSequence`; what a step means lives in `@/domain/drawSequence`. That
 * split is what makes "skipping mid-sequence produces a board identical to
 * letting it finish" checkable without driving a timer — at the final step this
 * renders the settled board, and there is no other path to it.
 *
 * **Every slot is drawn from the first frame; only its contents wait.** This is
 * the whole of issue #76's redesign and it is not a detail of the markup. A
 * grid that grew as pairings arrived would re-lay-out every already-revealed
 * card every 500 ms — and with `useFitToStage` on top, rescale the entire board
 * with it — so over 32 pairings the room would be reading a screen that never
 * stops moving. So the columns, the density and the scale are all derived from
 * the **final** pairing count, the empty slots hold exactly the space their
 * cards will need, and a card that has landed never moves again.
 *
 * An undrawn slot carries no number, not even an invisible one: it renders the
 * same two lines with a non-breaking space in each, which is the same height
 * and says nothing about what is coming (the issue's second acceptance
 * criterion).
 *
 * **Each number is in a box of its own** (issue #88, `@/ui/GroupBox`). Two
 * numerals separated by nothing but space read as one number from ten metres —
 * `7 12` is `712` to anybody who has not been told otherwise — and the fix is
 * not more space but a container each. It is deliberately the same component
 * the round board paints its results in: the neutral box the room watches a
 * pairing land in is the box that turns green or red once the match is played,
 * so the two pictures are continuous.
 *
 * The reveal is a CSS keyframe: docs/MOTION.md §6 prefers CSS for predetermined
 * beats because they run off the main thread and stay smooth while React is
 * busy building the next card. Exactly one card animates at a time, which is as
 * far inside the §6 budget as this scene can be.
 */
export function DrawScene({
  tournament,
  step,
  settled,
}: {
  tournament: TournamentSnapshot;
  step: number;
  /**
   * False only while the sequence is playing. A settled scene renders the same
   * board with every entry animation suppressed, so a beamer reopened after the
   * draw shows the result rather than replaying it (golden rule 4).
   */
  settled: boolean;
}) {
  // Before the early return, because hooks cannot sit behind one. The refs go
  // unattached on the empty branch and `useFitToStage` simply measures nothing.
  const { frame, content } = useFitToStage();
  const round = tournament.round;

  if (round === null || tournament.matches.length === 0) {
    return (
      <div
        className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
        data-scene="DRAW"
        data-settled={settled}
      >
        <h1 className="wm-display text-beamer-h1">{de.beamer.draw.title}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.draw.empty}</p>
      </div>
    );
  }

  const matches = tournament.matches;
  const total = matches.length;
  // Clamped here rather than trusted: the skip sets the step past the end, and
  // a caught-up beamer starts there. Both must be the finished board and not an
  // index that runs off the list.
  const revealed = Math.max(0, Math.min(Math.floor(step) || 0, total));

  // Both derived from the **final** count, never from what is on screen so far.
  // That is what reserves the layout (issue #76).
  const size = density(total);
  const columns = fitColumns(total, CELL_ASPECT);

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const tables: ReadonlyMap<TableId, Table> = new Map(
    tournament.tables.map((table) => [table.id, table]),
  );

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="DRAW"
      data-settled={settled}
      // How many pairings are actually on the board, not the raw counter: a
      // skip sets the step past the end, and an attribute that reported the
      // over-run would make two identical boards look different to anything
      // reading the markup.
      data-step={revealed}
    >
      <header className="flex items-baseline gap-6">
        <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.draw.title}</h1>
        <p className="wm-tnum text-beamer-body text-wm-text-muted" data-draw-progress="">
          {de.beamer.draw.progress({ drawn: revealed, total })}
        </p>
      </header>

      {/*
       * Scaled to fit like every other scene since issue #55. The scale is
       * measured once, off the full grid of slots, and therefore does not
       * change as the draw runs — a board that rescaled every 500 ms is the
       * same failure as one that reflows (issue #76).
       */}
      <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
        <div className="beamer-fit" ref={content}>
          <ol className="grid auto-rows-min gap-4" style={gridColumns(columns)}>
            {matches.map((match, index) => (
              <PairingCard
                key={match.id}
                match={match}
                groups={byId}
                tables={tables}
                size={size}
                revealed={index < revealed}
                // Only the pairing that has just landed animates. Re-animating
                // the board every step would blow the 60-element budget
                // (docs/MOTION.md §6) and read as a flicker.
                isNewest={!settled && index === revealed - 1}
              />
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

/**
 * One slot of the board, before and after its pairing lands.
 *
 * The same element either way, and that is the point: an empty slot is this
 * card with a non-breaking space where each line's text goes, so it occupies
 * exactly the height the drawn card will and the grid never moves. Both lines
 * are single-line by construction — the table line truncates, the numbers line
 * is a flex row that does not wrap — so the height is decided by the type steps
 * alone and not by how long a label happens to be.
 *
 * An undrawn slot is also neutral, never accented: colouring a `Freilos` before
 * it is drawn would tell the room which slot is the odd one out
 * (docs/TOURNAMENT-RULES.md §9 case 1).
 */
function PairingCard({
  match,
  groups,
  tables,
  size,
  revealed,
  isNewest,
}: {
  match: Match;
  groups: ReadonlyMap<GroupId, Group>;
  tables: ReadonlyMap<TableId, Table>;
  size: Density;
  revealed: boolean;
  isNewest: boolean;
}) {
  const a = groupNumber(match.a, groups);
  const b = groupNumber(match.b, groups);
  const isBye = revealed && match.b === null;
  const table = match.tableId === null ? null : (tables.get(match.tableId) ?? null);

  return (
    <li
      // 4 px of border, never a hairline: a thin line disappears through a
      // projector lens (docs/STYLEGUIDE.md §5). The Freilos gets the accent
      // colour as well as its own words — a projector in a bright room destroys
      // hue differences, so colour is never the only signal (§1).
      className={`flex flex-col gap-2 rounded-wm-xl border-4 px-6 py-4 text-center ${
        isBye ? 'border-wm-accent bg-wm-accent-soft' : 'border-wm-border-strong bg-wm-surface'
      } ${revealed ? '' : 'border-dashed opacity-40'} ${isNewest ? 'wm-draw-reveal' : ''}`}
      data-match-id={revealed ? match.id : undefined}
      data-slot={revealed ? undefined : ''}
      data-bye={isBye}
      data-newest={isNewest}
      aria-hidden={revealed ? undefined : 'true'}
    >
      {/*
       * Where the pairing is going, small and above the numbers — the shape
       * issue #75 asks for. The table is its number and nothing else: `Tisch`
       * repeated across thirty-two cards is the width the numerals could have
       * had. It is drawn muted and at a fifth of the numerals' size, which is
       * what keeps a bare `3` over a bare `7` from reading as a third
       * participant — the `Tisch`/`T` marker the issue holds in reserve is one
       * line away if a dry run says the size difference is not enough.
       *
       * Not uppercased, unlike the ribbons that share this slot elsewhere: a
       * table label is the host's own word for a physical thing in the room,
       * and shouting it back at them is not this scene's business.
       *
       * A bye says what it is, in words. A card with one participant and an
       * empty space reads as a bug from the back of a room, and this line is
       * the audience's only explanation of why somebody advanced without
       * playing (docs/TOURNAMENT-RULES.md §9 case 1).
       *
       * A pairing with no table says so too: there are routinely more matches
       * than tables (§3), and a card with nothing where the table goes sends
       * people looking for one.
       *
       * `truncate` so this is always exactly one line: it is half of what makes
       * an empty slot the same height as the card that will replace it.
       */}
      <span
        className="truncate text-beamer-body font-semibold text-wm-text-muted"
        data-pairing-where=""
      >
        {!revealed
          ? EMPTY_SLOT_TEXT
          : isBye
            ? de.beamer.draw.byeAdvances
            : table === null
              ? de.beamer.draw.waitingForTable
              : tableNumber(table.label)}
      </span>

      {/*
       * The two numbers, each in a box of its own (issue #88). Every word taken
       * off this card by issue #75 went into their size, and at that size two
       * numerals with only space between them are one number — `7 12` reads as
       * `712` from the back of a hall. The box is what separates them, and it
       * is `@/ui/GroupBox` rather than a border added here, so it is the same
       * object that turns green or red on the round board afterwards.
       *
       * `gap-[1.5ch]` is the issue's "at least as wide as one numeral", said in
       * the only unit that stays true at every step of the ladder: `ch` is the
       * advance of a digit, and the digits are tabular, so one `ch` is exactly
       * one numeral wide. That is why `wm-display wm-tnum` and the type step
       * stay on this row even though each box now sets its own — they are what
       * `ch` is measured in.
       *
       * An undrawn slot draws one box holding the blank. It is the same height
       * as the boxes that will replace it, which is what keeps the grid still
       * (issue #76), and it says nothing about what is coming — not even
       * whether the pairing is a `Freilos`.
       */}
      <span
        className={`flex min-w-0 items-baseline justify-center gap-[1.5ch] wm-display wm-tnum ${NUMBER_TYPE[size]}`}
        data-pairing=""
      >
        {revealed ? (
          <>
            <GroupBox number={a.text} state="NEUTRAL" scale={BOX_SCALE[size]} />
            {match.b === null ? null : (
              <>
                {/*
                  The word the space stands for, for a screen reader and for
                  nobody else — `7 12` read aloud is two numbers and not a match.
                */}
                <span className="sr-only">{de.match.versus}</span>
                <GroupBox number={b.text} state="NEUTRAL" scale={BOX_SCALE[size]} />
              </>
            )}
          </>
        ) : (
          <GroupBox number={EMPTY_SLOT_TEXT} state="NEUTRAL" scale={BOX_SCALE[size]} />
        )}
      </span>
    </li>
  );
}

/**
 * What an undrawn slot puts on each line: a non-breaking space.
 *
 * Written as a char code rather than typed, so nothing in this file is an
 * invisible character. An empty string would not do: an empty inline box has no
 * line height, so the card would collapse and the grid would grow every time a
 * pairing landed — the exact reflow issue #76 exists to remove.
 *
 * Exported so the scene's own test asserts against this exact value rather
 * than against a copy of it that could drift.
 */
export const EMPTY_SLOT_TEXT = String.fromCharCode(0xa0);

/**
 * The shape of a pairing card: a small line over two large numerals, a little
 * wider than it is tall.
 *
 * Feeds `fitColumns`, which puts 4 pairings in 2 columns, 16 in 4 and 32 in 6
 * on a 16:9 stage — square-ish grids that fill the width the pool used to take
 * (`fit.ts`). Above that it keeps going instead of stopping, and
 * `useFitToStage` shrinks whatever is still too tall.
 */
const CELL_ASPECT = 2;

/**
 * How much room each pairing gets.
 *
 * Decided by the **final** count, so it is fixed before the first card lands —
 * a density that changed as the board filled would restyle every card already
 * on the wall (issue #76). The steps are relative emphasis rather than a fit
 * guarantee; fitting is `useFitToStage`'s job and happens on top.
 */
type Density = 'roomy' | 'normal' | 'dense';

function density(count: number): Density {
  if (count <= 6) {
    return 'roomy';
  }
  return count <= 16 ? 'normal' : 'dense';
}

/**
 * How big the two numbers are drawn (issues #75, #88).
 *
 * Every step went up once the words came off: `beamer-hero` at the field sizes
 * where it fits, and never below `beamer-h2` — two digits need a fraction of
 * the width `Gruppe 7 gegen Gruppe 12` did. `useFitToStage` shrinks the board
 * from here if a projector turns out to have less room than the ladder assumed,
 * so the ladder is free to ask for the size the room actually needs
 * (docs/STYLEGUIDE.md §2, §4).
 *
 * The step is set twice over: `BOX_SCALE` is what each number is actually drawn
 * at, and `NUMBER_TYPE` puts the same step on the row around them so the `ch`
 * gap between the two boxes measures one of their numerals rather than one of
 * the body font's. The two must agree, which is why they are written together.
 */
const NUMBER_TYPE: Record<Density, string> = {
  roomy: 'text-beamer-hero',
  normal: 'text-beamer-h1',
  dense: 'text-beamer-h2',
};

const BOX_SCALE: Record<Density, GroupBoxScale> = {
  roomy: 'hero',
  normal: 'h1',
  dense: 'h2',
};
