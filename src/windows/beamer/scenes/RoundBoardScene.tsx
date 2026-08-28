import type { GroupId, MatchId } from '@/domain/ids';
import {
  beamerBoard,
  matchesProgress,
  matchPhase,
  type BoardSection,
  type MatchPhase,
} from '@/domain/round';
import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import type { Group, Match } from '@/domain/types';
import { de } from '@/i18n';
import { GroupBox, type GroupBoxScale, type GroupBoxState } from '@/ui';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { TABLE_TYPE } from '@/windows/beamer/tableType';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { useResultFlip } from '@/windows/beamer/useResultFlip';
import { groupNumber } from '@/windows/groupLabel';

/**
 * `ROUND_BOARD`: the live round, green and red (issue #19).
 *
 * The scene the audience looks at for most of the evening, so the whole design
 * is about being read from ten metres away by somebody who has not been told
 * what any of it means.
 *
 * **Every result carries three signals** (docs/STYLEGUIDE.md §1): the colour,
 * a filled icon, and a German word. Roughly 8 % of men have a red–green
 * deficiency, and a projector in a bright room flattens the hues for everybody
 * — so the board has to survive being read in greyscale, and the test asserts
 * exactly that by stripping the colour classes out of the markup.
 *
 * **The number boxes are `@/ui/GroupBox`**, the same component the `Auslosung`
 * draws its pairings with (issue #88). The box a group sits in during the draw
 * is the box that turns green or red here, so the room sees a colour arrive
 * rather than a new object — and the three states cannot drift apart, because
 * there is only one of each.
 *
 * **Nothing moves when a result lands.** Cards are grouped by the match's own
 * `tableId` (`@/domain/round`), which `setWinner` leaves alone, so the flip
 * happens in place. A board keyed on `table.currentMatchId` would make the card
 * vanish from its slot at the very moment the room is watching it.
 *
 * **Every match is on the board.** This scene used to draw as many cards as it
 * guessed would fit and print a count of the rest, which meant the pair whose
 * match came fourth in its section had to take the board's word for it that
 * they were playing at all. Everything is drawn now, and the board is scaled
 * down until it fits the stage instead (issue #55, `useFitToStage`).
 *
 * **And nothing else is.** One card per match, never one per table: a table
 * with no match this round is not drawn at all, so a hall with sixteen tables
 * and a four-match round gets four cards at the size four cards can have rather
 * than twelve empty headings around them (issue #87, `beamerBoard`). Unused
 * means *no match assigned this round* — a finished match keeps its table's
 * section and its result colour until the round closes.
 */
export function RoundBoardScene({
  tournament,
  settled,
  delivery = 'live',
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in. */
  settled: boolean;
  /**
   * Why this snapshot was sent (issue #29).
   *
   * Handed straight to `useResultFlip`, which is what decides that only the
   * result the room has just watched being decided turns over. A board that is
   * merely *arriving* carries however many results were decided before anybody
   * looked — thirty-two matches and sixty-four sides at a full field, which is
   * over the animated-element budget of docs/MOTION.md §6 and a projector
   * replaying an hour of the evening besides.
   */
  delivery?: SnapshotDelivery;
}) {
  // Which matches turned over since this window last looked — never all of
  // them, and never any of them on the first render (issue #29).
  const flipping = useResultFlip(tournament.matches, delivery);
  const sections = beamerBoard(tournament.tables, tournament.matches);
  const progress = matchesProgress(tournament.matches);
  // How many cards there are, and nothing about where they currently sit
  // (issue #87). A round's match list is fixed the moment it is drawn, so the
  // type step is settled once for the whole round and cannot change under the
  // room: not when a result lands, not when the host starts the next pair off
  // the queue, not when a table is locked mid-round. How those cards are
  // *arranged* still follows the sections, which is the one thing that may
  // legitimately move — and only ever because the host started a match.
  const size = density(tournament.matches.length);
  const columns = fitColumns(sections.length, SECTION_CELL_ASPECT);

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const { frame, content } = useFitToStage();

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-5"
      data-scene="ROUND_BOARD"
      data-settled={settled}
    >
      {/*
       * Persistent chrome: what tournament, what round, how far along. The room
       * fills and empties over an evening, and somebody who just walked in has
       * no other way to know what they are looking at.
       */}
      <header className="flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-6">
          <h1 className="wm-display text-beamer-h1 font-extrabold">
            {tournament.round?.label ?? de.round.label}
          </h1>
          {tournament.name === '' ? null : (
            <p className="text-beamer-body text-wm-text-muted" data-tournament-name="">
              {tournament.name}
            </p>
          )}
        </div>
        <p className="wm-tnum text-beamer-body text-wm-text-muted" data-round-progress="">
          {de.round.progress({ decided: progress.decided, total: progress.total })}
        </p>
      </header>

      {tournament.matches.length === 0 ? (
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.roundBoard.empty}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
          <div className="beamer-fit" ref={content}>
            <div className="grid auto-rows-min gap-4" style={gridColumns(columns)}>
              {sections.map((section) => (
                <Section
                  key={section.table?.id ?? 'queue'}
                  section={section}
                  groups={byId}
                  size={size}
                  flipping={flipping}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  section,
  groups,
  size,
  flipping,
}: {
  section: BoardSection;
  groups: ReadonlyMap<GroupId, Group>;
  size: Density;
  /** The matches whose result has just changed — see the scene. */
  flipping: ReadonlySet<MatchId>;
}) {
  const { table } = section;
  const isQueue = table === null;

  return (
    <section
      // The queue spans the whole grid and lays its matches out in columns of
      // its own: it is the one section that grows without a table to bound it,
      // and a single stacked column of twenty-six cards is what clips.
      className={`flex min-w-0 flex-col gap-2 ${isQueue ? 'col-span-full' : ''}`}
      data-table-id={table?.id ?? undefined}
      data-queue={isQueue ? '' : undefined}
    >
      {/*
       * The table, above its matches — the shape issue #75 asks for, one level
       * up because this board already groups by table, and at the size issue
       * #100 asks for. The label is drawn as the host has it, so the default
       * one reads `Tisch 3`: the word is what stops a number over two numbers
       * reading as a third one, and it comes from the same string the host
       * panel shows rather than from a second opinion about what a table is
       * called.
       *
       * `truncate` keeps it one unit that never wraps — `Tisch` and its number
       * belong on one line, and a section heading that took two would push
       * every card in the column down.
       */}
      <h2
        className={`wm-display wm-tnum truncate font-bold text-wm-text-muted ${TABLE_TYPE[size]}`}
        data-table-label=""
      >
        {isQueue ? de.beamer.roundBoard.queueTitle : table.label}
      </h2>

      {/*
       * No empty case: `beamerBoard` only hands over sections that have a match
       * in them (issue #87), so a heading on this board always has cards under
       * it — including the table whose only match is already over.
       */}
      <ul
        className={isQueue ? 'grid auto-rows-min gap-2' : 'flex flex-col gap-2'}
        style={
          isQueue ? gridColumns(fitColumns(section.matches.length, QUEUE_CELL_ASPECT)) : undefined
        }
      >
        {section.matches.map((match) => (
          <MatchCard
            key={match.id}
            match={match}
            groups={groups}
            size={size}
            flip={flipping.has(match.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function MatchCard({
  match,
  groups,
  size,
  flip,
}: {
  match: Match;
  groups: ReadonlyMap<GroupId, Group>;
  size: Density;
  flip: boolean;
}) {
  const phase = matchPhase(match);

  return (
    <li
      className={`flex min-w-0 flex-col gap-1 rounded-wm-lg border-4 px-4 py-3 ${PHASE_CARD[phase]}`}
      data-match-id={match.id}
      data-phase={phase}
    >
      <span className={`wm-beamer-label text-wm-text-muted ${RIBBON[size]}`} data-phase-ribbon="">
        {de.beamer.roundBoard.phase[phase]}
      </span>

      <Side match={match} groupId={match.a} groups={groups} size={size} flip={flip} />
      {match.b === null ? null : (
        <Side match={match} groupId={match.b} groups={groups} size={size} flip={flip} />
      )}
    </li>
  );
}

/**
 * One participant of a match: which state its box is in, and nothing else.
 *
 * The box itself is `@/ui/GroupBox` (issue #88) — every decision about how a
 * number is drawn on the projector lives there, including the three signals
 * that have to survive a red–green deficiency. What is left here is the one
 * question only a match can answer, which is whether this side won it.
 *
 * Keyed on `winnerId` rather than on `status`, so a corrected result — which
 * goes back through `setWinner` — repaints both sides rather than leaving the
 * old winner green.
 */
function Side({
  match,
  groupId,
  groups,
  size,
  flip,
}: {
  match: Match;
  groupId: GroupId;
  groups: ReadonlyMap<GroupId, Group>;
  size: Density;
  flip: boolean;
}) {
  const decided = match.winnerId !== null;
  const state: GroupBoxState = !decided
    ? 'NEUTRAL'
    : match.winnerId === groupId
      ? 'WINNER'
      : 'LOSER';

  return (
    <GroupBox
      number={groupNumber(groupId, groups).text}
      state={state}
      scale={BOX_SCALE[size]}
      flip={flip}
    />
  );
}

/** The card itself only carries the phase; the result lives on the sides. */
const PHASE_CARD: Record<MatchPhase, string> = {
  WAITING: 'border-wm-border bg-wm-bg-elevated',
  RUNNING: 'border-wm-live bg-wm-live-bg',
  FINISHED: 'border-wm-border-strong bg-wm-surface',
};

/**
 * The shape of a section: a heading with a stack of match cards under it.
 *
 * 16:9 is the stage's own ratio, which makes the grid of sections square-ish —
 * `fitColumns` reduces to `round(sqrt(sections))` at this value, which is
 * exactly the ladder this scene used before (2 columns at 4 sections, 3 at 9,
 * 4 at 16) and keeps going past it instead of stopping.
 */
const SECTION_CELL_ASPECT = 16 / 9;

/**
 * The shape of a queued match card: two participants stacked, and wide.
 *
 * The queue gets its own column count rather than borrowing the board's,
 * because it is the one section with no table to bound it: two tables and a
 * thirty-match queue would otherwise stack fifteen cards deep and shrink the
 * whole board to fit them.
 */
const QUEUE_CELL_ASPECT = 4;

/**
 * How much type each match gets.
 *
 * Three steps, and they decide the *relative* emphasis on a crowded board
 * rather than whether it fits — fitting is `useFitToStage`'s job now and
 * happens on top of this. `text-beamer-body` is the 32 px floor of
 * docs/STYLEGUIDE.md §2, which holds for the field sizes a host normally has
 * rather than absolutely: a card below it can be read by walking closer, and a
 * card that was never drawn cannot be read at all (issue #55,
 * docs/OPEN-QUESTIONS.md #57).
 */
type Density = 'roomy' | 'normal' | 'dense';

/**
 * Keyed on the round's card count alone (issue #87).
 *
 * It used to be keyed on the sections and on the deepest one, and both of those
 * move while the round is being played: the queue section disappears when the
 * last waiting pair is started, and a section's depth changes every time one
 * is. So the type step could change under a room mid-round, which is the reflow
 * issue #76 removed from the draw and this board must not reintroduce. A
 * round's match list is fixed when it is drawn, so this is computed once in
 * effect — the same three steps, from the one number that cannot move.
 */
function density(cards: number): Density {
  if (cards <= 4) {
    return 'roomy';
  }
  return cards <= 9 ? 'normal' : 'dense';
}

/**
 * Which `GroupBox` step a density draws its numbers at (issues #75, #88).
 *
 * The thresholds above are this scene's; the box these land on is shared with
 * the `Auslosung`, so a `hero` box is the same object in both. Every step went
 * up when the words came off — `beamer-hero` on a board with room for it, and
 * never below `beamer-h2`, because two digits need a fraction of the width
 * `Gruppe 12` did. `useFitToStage` shrinks the board from here when a projector
 * has less room than the ladder assumed, so the ladder asks for what the room
 * needs rather than for what always fits (docs/STYLEGUIDE.md §2, §4).
 */
const BOX_SCALE: Record<Density, GroupBoxScale> = {
  roomy: 'hero',
  normal: 'h1',
  dense: 'h2',
};

const RIBBON: Record<Density, string> = {
  roomy: 'text-beamer-body',
  normal: 'text-beamer-body',
  dense: 'text-beamer-body',
};
