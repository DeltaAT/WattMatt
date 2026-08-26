import {
  activeBracketRound,
  bracketColumns,
  type BracketColumn,
  type BracketColumnState,
  type BracketSide,
} from '@/domain/bracket';
import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Bracket, BracketNode, Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, type NameType } from '@/ui/nameFit';
import { chipKey, type BracketAdvance } from '@/windows/beamer/useBracketAdvance';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupLabel } from '@/windows/groupLabel';

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
 */
export function BracketScene({
  tournament,
  settled,
  advance,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in — the first reveal of §4.4. */
  settled: boolean;
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

  if (bracket === null || bracket.nodes.length === 0) {
    return (
      <div
        className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
        data-scene="BRACKET"
        data-settled={settled}
      >
        <h1 className="wm-display text-beamer-h1">{de.beamer.bracket.title}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.bracket.empty}</p>
      </div>
    );
  }

  const columns = bracketColumns(bracket);
  const tree = columns.filter((column) => column.round !== 'THIRD_PLACE');
  const thirdPlace = columns.find((column) => column.round === 'THIRD_PLACE') ?? null;
  const active = activeBracketRound(bracket);

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const chips: ChipContext = {
    groups: byId,
    participant: tournament.participantLabel,
    type: NAME_TYPE[nameDensity(bracket.size)],
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
            {active === null ? de.beamer.bracket.title : de.bracket.round[active]}
          </h1>
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
              gridTemplateRows: `auto repeat(${String(Math.max(1, bracket.size / 2))}, minmax(0, 1fr))`,
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
                    gridRow: `${String(position * rowSpan(bracket, column) + 2)} / span ${String(rowSpan(bracket, column))}`,
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
      <div className="flex min-w-0 flex-1 flex-col gap-1 rounded-wm-lg border-4 border-wm-border-strong bg-wm-surface px-4 py-3">
        <Slot node={node} side="A" chips={chips} />
        <Slot node={node} side="B" chips={chips} />
      </div>

      {node.nextNodeId === null ? null : <Connector goesDown={revealSide(column, node) === 'A'} />}
    </li>
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

/** How many first-round rows one node of a column spans. */
function rowSpan(bracket: Bracket, column: BracketColumn): number {
  const rows = Math.max(1, bracket.size / 2);
  return Math.max(1, Math.round(rows / Math.max(1, column.nodes.length)));
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
