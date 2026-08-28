import {
  activeBracketRound,
  bracketColumns,
  bracketNodeTableId,
  type BracketColumn,
  type BracketColumnState,
  type BracketSide,
} from '@/domain/bracket';
import type { GroupId, TableId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type {
  BracketNode,
  BracketRound,
  Group,
  ParticipantLabel,
  RoundTrack,
  Table,
} from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, type NameType } from '@/ui/nameFit';
import { chipKey, type BracketAdvance } from '@/windows/beamer/useBracketAdvance';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupLabel } from '@/windows/groupLabel';
import { tableNumber } from '@/windows/tableLabel';

import type { CSSProperties } from 'react';

/**
 * `BRACKET`: the `Turnierbaum` (issue #25, docs/TOURNAMENT-RULES.md §7,
 * docs/MOTION.md §4.4).
 *
 * The main picture of the whole final phase, and the only scene of the evening
 * that shows the audience where the tournament is *going* rather than where it
 * is. Everything about it follows from that.
 *
 * **The tree is the layout.** Every round is a column and every node sits
 * exactly between the two it is fed by, which is what makes the picture
 * readable without a caption. It is one CSS grid with `2^k / 2` rows and a node
 * spanning twice as many rows in each column to the right — so a field of 16, 8,
 * 4 or 2 is the same code and the same shape, and there is not a media query
 * anywhere near it (the issue's second task).
 *
 * **Nothing is ever left off.** Every node of the tree is drawn, including the
 * rounds nobody has reached; the board is scaled to the stage afterwards
 * (`useFitToStage`, issue #55). A bracket with a round missing is not a smaller
 * bracket, it is a wrong one.
 *
 * **Three levels of attention** (§4.4): the round being played at full
 * strength, the rounds already decided behind it, the ones still to come
 * further back. The state is computed in `@/domain/bracket` and not here, so
 * the host's panel and the wall cannot disagree about which round is live.
 *
 * **A result is never colour alone** (docs/STYLEGUIDE.md §1): the colour, the
 * icon and the German word travel together on the slot, and the test asserts
 * the board reads correctly with the colour classes stripped out.
 *
 * **A live match names its table** (issue #90). The round board carried that
 * for the whole group phase and then the tree replaced it, so the room lost the
 * one thing it needs to walk over and watch. It is a reference and not content:
 * small, muted, in the node's top corner, and out of the flow entirely so the
 * names keep every pixel they had. It appears only while the match is actually
 * being played — `bracketNodeTableId` — because a decided node still remembers
 * where it was played and that table is somebody else's by then.
 */
export function BracketScene({
  tournament,
  settled,
  track = 'MAIN',
  focus = null,
  advance,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in — the first reveal of §4.4. */
  settled: boolean;
  /**
   * Which of the two tournaments this tree belongs to (issue #91, §10).
   *
   * Both end in one, and the `Trostrunde`'s is played out in numbers while the
   * main field's is being played in names — possibly in the same half hour. The
   * heading is the only thing on the wall that says which, so it says it: a
   * room shown a `Halbfinale` with no tournament on it is a room that will
   * applaud the wrong pair.
   *
   * Defaulted, so every existing render of the main field's tree is unchanged.
   */
  track?: RoundTrack;
  /**
   * The round the host has zoomed the projector to, or null for the whole tree
   * (issue #26).
   *
   * The tree is drawn *from* that round onwards rather than as that round
   * alone: the last matches fill the screen, which is what the zoom is for, and
   * the audience can still see where the winner of the match in front of them
   * is going — which a single column stripped of its links could not show
   * (docs/OPEN-QUESTIONS.md #74).
   */
  focus?: BracketRound | null;
  /**
   * The chips that are moving, and where to attach them.
   *
   * Passed in rather than hooked up here, exactly as the `Hoffnungsrunde` takes
   * its beat: *this window watched that happen* is a fact about the window and
   * not about the tournament, and keeping it out leaves this component a pure
   * function of one snapshot — which is what lets every state of the tree be
   * rendered in a test without a browser that can measure anything.
   */
  advance: BracketAdvance;
}) {
  const { frame, content } = useFitToStage();
  const bracket = tournament.bracket;
  // Named by the tournament it belongs to from the empty state onwards: the
  // host stages the tree before drawing it, and the room reads that picture too.
  const title = track === 'MAIN' ? de.beamer.bracket.title : de.beamer.bracket.consolationTitle;

  if (bracket === null || bracket.nodes.length === 0) {
    return (
      <div
        className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
        data-scene="BRACKET"
        data-settled={settled}
        data-bracket-track={track}
      >
        <h1 className="wm-display text-beamer-h1">{title}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.bracket.empty}</p>
      </div>
    );
  }

  const columns = zoom(bracketColumns(bracket), focus);
  const tree = columns.filter((column) => column.round !== 'THIRD_PLACE');
  const thirdPlace = columns.find((column) => column.round === 'THIRD_PLACE') ?? null;
  const active = activeBracketRound(bracket);
  // What the heading names: the live round while it is on screen, and otherwise
  // the round the host has zoomed to. A projector showing the semi-finals under
  // the word `Viertelfinale` — true of the tournament, wrong about the picture
  // — is exactly the disagreement the room would read as a mistake.
  const heading =
    active !== null && columns.some((column) => column.round === active)
      ? active
      : (focus ?? active);
  // The rows the grid needs, and the type the names get, both come off what is
  // actually drawn rather than off the size of the whole bracket: zooming to
  // the semi-finals of a field of 16 is a board of two matches, and it should
  // be typed like one.
  const drawnField = tree[0]?.field ?? bracket.size;

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const chips: ChipContext = {
    groups: byId,
    participant: tournament.participantLabel,
    type: NAME_TYPE[nameDensity(drawnField)],
    tables: new Map(tournament.tables.map((table) => [table.id, table])),
    tableType: TABLE_TYPE[nameDensity(drawnField)],
    advance,
    settled,
  };

  // The reading order the reveal staggers along: down each column, then on to
  // the next one, with the `Spiel um Platz 3` last because it is drawn under
  // the tree rather than in it (docs/MOTION.md §4.4).
  let revealIndex = 0;

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-5"
      data-scene="BRACKET"
      data-settled={settled}
    >
      {/*
       * Persistent chrome, as on the round board: which round the room is
       * watching, which tournament it belongs to, and how big the final phase
       * is. Somebody who walked in during the `Viertelfinale` has no other way
       * to know what they are looking at.
       */}
      <header className="flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-6">
          <h1 className="wm-display text-beamer-h1 font-extrabold" data-bracket-title="">
            {heading === null ? title : de.bracket.round[heading]}
          </h1>
          {/*
            The round name stays the round name — `Halbfinale` is what the room
            calls it in both tournaments — and the track is said beside it
            rather than folded into it (issue #91).
          */}
          {track === 'MAIN' ? null : (
            <p
              className="text-beamer-body font-semibold text-wm-accent"
              data-bracket-track="CONSOLATION"
            >
              {de.consolation.label}
            </p>
          )}
          {tournament.name === '' ? null : (
            <p className="text-beamer-body text-wm-text-muted" data-tournament-name="">
              {tournament.name}
            </p>
          )}
        </div>
        <p className="wm-tnum text-beamer-body text-wm-text-muted" data-bracket-field="">
          {de.beamer.bracket.field({ n: bracket.size })}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
        <div className="beamer-fit flex flex-col gap-6" ref={content}>
          <ol
            className="grid gap-x-8 gap-y-2"
            style={{
              gridTemplateColumns: `repeat(${String(tree.length)}, minmax(0, 1fr))`,
              // One row per first-round node; every later round spans the rows
              // of the two nodes below it, which is what centres it between
              // them without a single measurement.
              gridTemplateRows: `auto repeat(${String(Math.max(1, drawnField / 2))}, minmax(0, 1fr))`,
            }}
            data-bracket-tree=""
          >
            {tree.map((column, index) => (
              <li
                key={`${column.round}-heading`}
                className="contents"
                data-bracket-column={column.round}
                data-column-state={column.state}
              >
                <h2
                  className={`wm-display self-end text-beamer-h3 font-bold text-wm-text-muted wm-bracket-focus ${FOCUS[column.state]}`}
                  style={{ gridColumn: index + 1, gridRow: 1 }}
                >
                  {de.bracket.round[column.round]}
                </h2>
              </li>
            ))}

            {tree.flatMap((column, index) =>
              column.nodes.map((node, position) => (
                <Node
                  key={node.id}
                  node={node}
                  column={column}
                  chips={chips}
                  revealIndex={revealIndex++}
                  style={{
                    gridColumn: index + 1,
                    // Row 1 is the round's heading, so the tree starts at 2.
                    gridRow: `${String(position * rowSpan(drawnField, column) + 2)} / span ${String(rowSpan(drawnField, column))}`,
                  }}
                />
              )),
            )}
          </ol>

          {/*
           * "It is scheduled at the same time as the final and appears as a
           * separate node under the tree" (§7), word for word. Under rather
           * than inside, because a node hanging off the semi-finals in the tree
           * itself would read as a route to the final — which is the one thing
           * the third-place match is not.
           */}
          {thirdPlace === null
            ? null
            : thirdPlace.nodes.map((node) => (
                <section
                  key={node.id}
                  className="flex items-center gap-6"
                  data-bracket-column="THIRD_PLACE"
                  data-column-state={thirdPlace.state}
                >
                  <h2
                    className={`wm-display shrink-0 text-beamer-h3 font-bold text-wm-text-muted wm-bracket-focus ${FOCUS[thirdPlace.state]}`}
                  >
                    {de.bracket.round.THIRD_PLACE}
                  </h2>
                  {/* A list of one, so the node stays an `li` wherever it is drawn. */}
                  <ul className="min-w-0 flex-1">
                    <Node
                      node={node}
                      column={thirdPlace}
                      chips={chips}
                      revealIndex={revealIndex++}
                    />
                  </ul>
                </section>
              ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One match of the tree: two slots, and the line to the round above.
 *
 * The line is drawn from the node rather than over the board, so it needs no
 * measurement at all: the node above is centred on the boundary between this
 * node's cell and its sibling's, which is exactly half this cell's height away
 * — a distance the cell can express in percentages of itself at any bracket
 * size.
 */
function Node({
  node,
  column,
  chips,
  revealIndex,
  style,
}: {
  node: BracketNode;
  column: BracketColumn;
  chips: ChipContext;
  revealIndex: number;
  style?: CSSProperties;
}) {
  return (
    <li
      className={`relative flex min-w-0 items-center wm-bracket-focus ${FOCUS[column.state]} ${
        chips.settled ? '' : 'wm-bracket-node'
      }`}
      style={{ ...style, ...revealStyle(revealIndex) }}
      data-bracket-node={node.id}
      data-node-round={node.round}
    >
      <div className="relative flex min-w-0 flex-1 flex-col gap-1 rounded-wm-lg border-4 border-wm-border-strong bg-wm-surface px-4 py-3">
        <NodeTable node={node} chips={chips} />
        <Slot node={node} side="A" chips={chips} />
        <Slot node={node} side="B" chips={chips} />
      </div>

      {node.nextNodeId === null ? null : <Connector goesDown={revealSide(column, node) === 'A'} />}
    </li>
  );
}

/**
 * Where this match is being played, if it is being played (issue #90).
 *
 * **Absolutely positioned, and that is the whole design.** The issue's last
 * task says the table must not squeeze the name field, and offers "above the
 * node" as the fallback if it would. Out of the flow is better than either: the
 * names keep every pixel they had, every node is exactly the height it was, and
 * nothing on the board moves when a match starts or ends — which matters more
 * here than anywhere, because the tree is the one scene that is on the wall for
 * the whole final phase.
 *
 * It lands over the top-right of slot A, which is the box each slot reserves
 * for `SIEGER` / `AUSGESCHIEDEN`. The two can never collide: that word appears
 * only once the match is decided, and a decided match has no table to name.
 *
 * Nothing at all when there is no table — no placeholder, no dash, no `0`. A
 * node without one is simply a node, which is what the issue means by "looks
 * deliberate, not broken": there is nothing there to be broken.
 *
 * **It keeps the bare number while the group rounds went back to the word**
 * (issue #100, docs/STYLEGUIDE.md §4). That divergence is chosen, not
 * inherited: `Tisch` came back to the round board because a bare number over
 * two bare numbers is a third number, and there is no numeral anywhere on a
 * bracket node for this one to be confused with. The node is also the one
 * place genuinely short of room — this badge sits in a corner it must not grow
 * out of, over a box reserved for another word.
 *
 * The *size* did follow the group rounds up a step (`TABLE_TYPE` below). The
 * word and the size are two decisions, and only the first of them is about
 * ambiguity: a number nobody can read is no more useful here than it was on
 * the round board. It costs the names nothing, because out of the flow is
 * still out of the flow — and the box it lands over is the reserved
 * `AUSGESCHIEDEN` slot, which is far wider than two numerals at any step of
 * this ladder.
 */
function NodeTable({ node, chips }: { node: BracketNode; chips: ChipContext }) {
  const tableId = bracketNodeTableId(node);
  const table = tableId === null ? null : (chips.tables.get(tableId) ?? null);
  if (table === null) {
    return null;
  }

  return (
    <span
      className={`wm-display wm-tnum pointer-events-none absolute top-1 right-4 font-bold text-wm-text-muted ${chips.tableType}`}
      data-node-table=""
    >
      {tableNumber(table.label)}
    </span>
  );
}

/**
 * One participant in a match of the tree.
 *
 * The three signals of docs/STYLEGUIDE.md §1 live here together so they cannot
 * drift apart: the colour, the icon and the word. A slot nobody has reached yet
 * says so rather than being left blank — an empty box on a projector reads as a
 * bug, and half this tree is empty for most of the final phase.
 */
function Slot({ node, side, chips }: { node: BracketNode; side: BracketSide; chips: ChipContext }) {
  const groupId = side === 'A' ? node.slotA : node.slotB;
  const key = chipKey(node.id, side);
  const outcome = outcomeOf(node, groupId);
  const label =
    groupId === null
      ? { text: outcome === 'BYE' ? de.outcome.bye : de.beamer.bracket.open }
      : groupLabel(groupId, chips.groups, chips.participant);

  return (
    <span
      // The 6 px left border is the winner's (docs/STYLEGUIDE.md §1). The loser
      // drops to .6 and desaturates; both survive greyscale, which is the point.
      className={`wm-bracket-advance flex min-w-0 items-baseline gap-3 border-l-[6px] pl-3 ${OUTCOME_SLOT[outcome]}`}
      ref={chips.advance.chip(key)}
      data-chip={key}
      data-outcome={outcome}
      data-arriving={chips.advance.arriving.has(key) ? '' : undefined}
    >
      {/*
       * A fixed box, so `·` → `✓` cannot nudge the name sideways: the glyphs
       * have different advance widths, and a name that shifted when its match
       * was decided would move at the exact moment the room is reading it.
       */}
      <span
        aria-hidden="true"
        className="w-[1.2em] shrink-0 text-center text-beamer-body font-bold"
        data-outcome-icon=""
      >
        {OUTCOME_ICON[outcome]}
      </span>

      {/*
       * Stepped down towards the 32 px floor before the ellipsis takes over
       * (issue #23, `@/ui/nameFit`). This is the last card of the evening a
       * name should be cut off on.
       */}
      <span
        className={`min-w-0 flex-1 truncate font-semibold ${fitNameType(label.text, chips.type)}`}
      >
        {label.text}
      </span>

      {/*
       * The word always occupies its slot, decided or not, so a result cannot
       * re-truncate the name beside it (the same reasoning as the round board's
       * reserved ribbon).
       */}
      <span className="grid shrink-0 text-beamer-body" data-outcome-slot="">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 wm-beamer-label">
          {LONGEST_OUTCOME_LABEL}
        </span>
        {outcome === 'WINNER' || outcome === 'LOSER' ? (
          <span
            className="col-start-1 row-start-1 wm-beamer-label text-right"
            data-outcome-label=""
          >
            {outcome === 'WINNER' ? de.beamer.bracket.winner : de.beamer.bracket.loser}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * The line from a node to the one above it.
 *
 * An SVG so it can *draw* itself in (docs/MOTION.md §4.4). `pathLength="100"`
 * normalises the dash to hundredths of the path, so the animation is unaffected
 * by the box being stretched to whatever size the bracket ends up at, and
 * `vector-effect` keeps the stroke a constant width through the same stretch —
 * a hairline that thinned out at one bracket size would disappear through a
 * projector lens (docs/STYLEGUIDE.md §5).
 */
function Connector({ goesDown }: { goesDown: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-full h-1/2 w-8 text-wm-border-strong ${
        goesDown ? 'top-1/2' : 'bottom-1/2'
      }`}
      data-bracket-connector={goesDown ? 'down' : 'up'}
    >
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path
          className="wm-bracket-connector"
          d={goesDown ? 'M0,0 H50 V100 H100' : 'M0,100 H50 V0 H100'}
          pathLength={100}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** What every slot needs to draw itself, gathered once per render. */
interface ChipContext {
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  type: NameType;
  /** Every table, to resolve the one a live node is on (issue #90). */
  tables: ReadonlyMap<TableId, Table>;
  /** The type step that table is drawn at — always under the names. */
  tableType: string;
  advance: BracketAdvance;
  settled: boolean;
}

type Outcome =
  /** Both are in and nobody has won yet. */
  | 'OPEN'
  /** Through to the round above. */
  | 'WINNER'
  /** Out — or, from a `Halbfinale`, on the way to the `Spiel um Platz 3`. */
  | 'LOSER'
  /** A `Freilos`: the match was decided without a second participant (§9 case 1). */
  | 'BYE'
  /** Waiting for the match below to send somebody up. */
  | 'EMPTY';

function outcomeOf(node: BracketNode, groupId: GroupId | null): Outcome {
  if (groupId === null) {
    // A decided node with an empty side was a walkover, and the room is owed
    // the word for it — the alternative is a card with one name and a blank,
    // which looks like a bug from the back of the room.
    return node.winnerId === null ? 'EMPTY' : 'BYE';
  }
  if (node.winnerId === null) {
    return 'OPEN';
  }
  return node.winnerId === groupId ? 'WINNER' : 'LOSER';
}

/** Filled shapes, never thin outlines — a hairline glyph dies on a projector. */
const OUTCOME_ICON: Record<Outcome, string> = {
  OPEN: '·',
  WINNER: '✓',
  LOSER: '✗',
  BYE: '–',
  EMPTY: '·',
};

const OUTCOME_SLOT: Record<Outcome, string> = {
  OPEN: 'border-transparent text-wm-text',
  WINNER: 'border-wm-win bg-wm-win-bg text-wm-text',
  LOSER: 'border-wm-lose bg-wm-lose-bg text-wm-text-muted opacity-60 saturate-50',
  BYE: 'border-transparent text-wm-text-muted',
  EMPTY: 'border-transparent text-wm-text-faint',
};

/** Whichever of the two result words is wider, for the reserved slot. */
const LONGEST_OUTCOME_LABEL =
  de.beamer.bracket.winner.length >= de.beamer.bracket.loser.length
    ? de.beamer.bracket.winner
    : de.beamer.bracket.loser;

/** The focus levels of docs/MOTION.md §4.4, as opacities. */
const FOCUS: Record<BracketColumnState, string> = {
  ACTIVE: 'opacity-100',
  DECIDED: 'opacity-75',
  FUTURE: 'opacity-45',
};

/**
 * How much type the names get.
 *
 * `text-beamer-h2` is what the issue asks for and what a small field can have:
 * two or four participants leave room for 64 px. Sixteen do not, and the
 * ladder is the same argument the round board makes — type that was *chosen* is
 * nicer than type that was shrunk, so a crowded tree starts smaller instead of
 * being scaled harder afterwards (`useFitToStage` still has the last word).
 */
type NameDensity = 'roomy' | 'normal' | 'dense';

function nameDensity(size: number): NameDensity {
  if (size <= 4) {
    return 'roomy';
  }
  return size <= 8 ? 'normal' : 'dense';
}

const NAME_TYPE: Record<NameDensity, NameType> = {
  roomy: 'text-beamer-h2',
  normal: 'text-beamer-h3',
  dense: 'text-beamer-body',
};

/**
 * How big the table number is (issues #90, #100).
 *
 * Issue #90 put it one step under the names at every density and let it bottom
 * out at `beamer-caption`. Issue #100 raised the whole ladder a step and moved
 * the floor to `beamer-body`, because 24 px is what docs/STYLEGUIDE.md §2
 * reserves for **persistent chrome** — the clock, the tournament name — and a
 * table number is not chrome. It is the one thing on this screen somebody acts
 * on: it is how a pair finds out where to go and stand. Nothing the room has to
 * read goes below the 32 px floor.
 *
 * **Still subordinate, and at the densest step no longer by size.** The names
 * are already on the floor at a field of sixteen, so there is no step left
 * under them — the table sits at the same 32 px and is told apart by the three
 * things that are not size: it is muted, it is alone in a corner rather than in
 * the body of the card, and it is one or two numerals against a name of up to
 * forty characters. That is the same argument the group-round scenes make for
 * their much larger label (docs/STYLEGUIDE.md §4), and it is why the two scenes
 * no longer disagree about how big a table is allowed to be.
 *
 * The zoomed view gets the top of the ladder: the host zooms to the `Finale`,
 * the drawn field is 2, and a 48 px table sits under 64 px names.
 */
const TABLE_TYPE: Record<NameDensity, string> = {
  roomy: 'text-beamer-h3',
  normal: 'text-beamer-body',
  dense: 'text-beamer-body',
};

/** How many rows of the drawn tree one node of a column spans. */
function rowSpan(field: number, column: BracketColumn): number {
  const rows = Math.max(1, field / 2);
  return Math.max(1, Math.round(rows / Math.max(1, column.nodes.length)));
}

/**
 * The columns the projector actually draws.
 *
 * Everything, or — when the host has zoomed to a round — that round and the
 * ones after it. The `Spiel um Platz 3` stays whenever the `Finale` is drawn,
 * because §7 plays the two together and the whole point of the zoom is the end
 * of the evening.
 */
function zoom(
  columns: readonly BracketColumn[],
  focus: BracketRound | null,
): readonly BracketColumn[] {
  if (focus === null) {
    return columns;
  }
  const from = columns.findIndex((column) => column.round === focus);
  if (from < 0) {
    return columns;
  }

  const zoomed = columns.slice(from);
  const third = columns.find((column) => column.round === 'THIRD_PLACE');
  // The third-place column sits before the final in the file's own order, so a
  // zoom to the `Finale` would otherwise slice it off — the one match §7 plays
  // at the same time as the one being zoomed to.
  if (third === undefined || zoomed.includes(third)) {
    return zoomed;
  }
  return zoomed.some((column) => column.round === 'FINAL') ? [third, ...zoomed] : zoomed;
}

/**
 * Which side of the node above this one feeds, and therefore which way its
 * connector turns: the upper of a pair goes down to meet it, the lower goes up.
 */
function revealSide(column: BracketColumn, node: BracketNode): BracketSide {
  return column.nodes.indexOf(node) % 2 === 0 ? 'A' : 'B';
}

/**
 * The node's place in the reveal, as a custom property the stagger reads.
 *
 * A CSS variable rather than an inline `animation-delay`, so the delay stays in
 * `global.css` where the token that halves it in performance mode lives.
 */
function revealStyle(index: number): CSSProperties {
  return { '--wm-reveal-index': index } as CSSProperties;
}
