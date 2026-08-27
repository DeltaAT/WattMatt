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
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { useResultFlip } from '@/windows/beamer/useResultFlip';
import { groupNumber } from '@/windows/groupLabel';
import { tableNumber } from '@/windows/tableLabel';

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
       * The table, small and above its matches — the shape issue #75 asks for,
       * one level up because this board already groups by table. It is the
       * table's number and nothing else: `Tisch` printed over every section is
       * the width the numerals under it could have had.
       */}
      <h2
        className={`wm-display wm-tnum font-bold text-wm-text-muted ${HEADING[size]}`}
        data-table-label=""
      >
        {isQueue ? de.beamer.roundBoard.queueTitle : tableNumber(table.label)}
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
 * One participant of a match, as a box that carries the result (issue #77).
 *
 * The `SIEGER` / `AUSGESCHIEDEN` words are gone: at the sizes issue #75 gave
 * the numerals there is no room for a word beside them that is worth reading,
 * and the box around the number can say the same thing without any.
 *
 * **What replaced the word, and why it is not just colour.** docs/STYLEGUIDE.md
 * §1 used to require three signals because roughly 8 % of men have a red–green
 * deficiency and a projector in a lit room flattens hue. Dropping the text
 * leaves three that are not hue at all, and `resultContrast.test.ts` computes
 * them rather than trusting the eye:
 *
 *  - **Luminance.** The winner's edge and the loser's differ by 3.2:1 in
 *    greyscale once the loser's dimming is composited — past §1's 3:1 bar for
 *    non-text UI. The *fills* alone manage only 1.4:1, which is why the edge
 *    does the work and not the background.
 *  - **Geometry.** The winner's edge reads 6 px against the loser's 2 px
 *    (`wm-result-ring`), drawn inward so it costs no layout.
 *  - **Weight.** The loser stays at `opacity .6` and half saturation — the
 *    issue #19 treatment, kept deliberately. Winner at full strength.
 *
 * The `✓` / `✗` glyph stays too. The issue's own warning counts the text as
 * *one* of the three signals, so the icon is the one that survives, and it is
 * the cheapest non-hue signal there is.
 *
 * The digits themselves are `--wm-text` in every state: the box is coloured,
 * never the number (issue #77).
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
  const label = groupNumber(groupId, groups);
  const decided = match.winnerId !== null;
  const isWinner = decided && match.winnerId === groupId;
  const outcome: Outcome = !decided ? 'OPEN' : isWinner ? 'WINNER' : 'LOSER';

  return (
    <span
      // 2 px of border in every state, and never more: the winner's extra 4 px
      // are drawn inward by `wm-result-ring`, so the box is exactly the same
      // size decided and undecided. A border that grew when a result landed
      // would move every card on the row — "no layout shift when a result comes
      // in" is issue #77's one hard requirement.
      className={`flex min-w-0 items-baseline justify-center gap-3 rounded-wm-lg border-[2px] px-4 py-2 ${
        OUTCOME_BOX[outcome]
      } ${
        // The flip itself. Only the decided sides animate, and both run at once
        // — a stagger would look like hesitation about the result
        // (docs/MOTION.md §4.2). A board that is only *arriving* does not flip
        // at all: `OUTCOME_BOX` already carries every settled colour, so the
        // results are there, they simply do not replay (issue #29).
        outcome === 'OPEN' || !flip ? '' : OUTCOME_ANIMATION[outcome]
      }`}
      data-outcome={outcome}
    >
      {/*
       * A fixed box, so `·` → `✓` cannot nudge the number sideways. The three
       * glyphs have different advance widths, and the acceptance criterion is
       * that nothing moves when a result lands — inside the box as much as
       * outside it.
       */}
      <span
        aria-hidden="true"
        className={`w-[1.2em] shrink-0 text-center font-bold ${LABEL[size]}`}
        data-outcome-icon=""
      >
        {OUTCOME_ICON[outcome]}
      </span>

      {/*
       * The number, and nothing in front of it (issue #75). Two digits at a
       * fixed step rather than a name stepped down towards the 32 px floor:
       * there is no length here to defend against, so the type is the size the
       * room needs rather than the size the longest label allowed.
       */}
      <span className={`wm-display wm-tnum font-extrabold ${TYPE[size]}`} data-group-number="">
        {label.text}
      </span>
    </span>
  );
}

type Outcome = 'OPEN' | 'WINNER' | 'LOSER';

/** Filled shapes, not thin outlines — a hairline glyph dies on a projector. */
const OUTCOME_ICON: Record<Outcome, string> = {
  OPEN: '·',
  WINNER: '✓',
  LOSER: '✗',
};

/**
 * The three states of a number box (issue #77).
 *
 * `text-wm-text` throughout: the box is coloured and the digits are not, so a
 * number is exactly as readable when its match is lost as when it is won.
 * `wm-result-ring` is the winner's extra 4 px of edge, and it is applied here
 * rather than in the animation so a board that is merely catching up wears it
 * too (golden rule 4).
 */
const OUTCOME_BOX: Record<Outcome, string> = {
  OPEN: 'border-wm-border-strong bg-wm-bg-elevated text-wm-text',
  WINNER: 'wm-result-ring border-wm-win bg-wm-win-bg text-wm-text',
  LOSER: 'border-wm-lose bg-wm-lose-bg text-wm-text opacity-60 saturate-50',
};

const OUTCOME_ANIMATION: Record<Exclude<Outcome, 'OPEN'>, string> = {
  WINNER: 'wm-result-win',
  LOSER: 'wm-result-lose',
};

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
 * How big a participant's number is drawn (issue #75).
 *
 * Every step went up once the words came off. `beamer-hero` on a board with
 * room for it, and never below `beamer-h2` — two digits need a fraction of the
 * width `Gruppe 12` did, and the space that frees is the whole point of the
 * change. `useFitToStage` shrinks the board from here when a projector has less
 * room than the ladder assumed, so the ladder asks for what the room needs
 * rather than for what always fits (docs/STYLEGUIDE.md §2, §4).
 */
const TYPE: Record<Density, string> = {
  roomy: 'text-beamer-hero',
  normal: 'text-beamer-h1',
  dense: 'text-beamer-h2',
};

const HEADING: Record<Density, string> = {
  roomy: 'text-beamer-h3',
  normal: 'text-beamer-body',
  dense: 'text-beamer-body',
};

const LABEL: Record<Density, string> = {
  roomy: 'text-beamer-h3',
  normal: 'text-beamer-body',
  dense: 'text-beamer-body',
};

const RIBBON: Record<Density, string> = {
  roomy: 'text-beamer-body',
  normal: 'text-beamer-body',
  dense: 'text-beamer-body',
};
