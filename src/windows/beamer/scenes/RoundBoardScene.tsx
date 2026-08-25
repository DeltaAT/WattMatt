import type { GroupId } from '@/domain/ids';
import {
  beamerBoard,
  matchesProgress,
  matchPhase,
  type BoardSection,
  type MatchPhase,
} from '@/domain/round';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Group, Match, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, type NameType } from '@/ui/nameFit';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupLabel } from '@/windows/groupLabel';

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
 */
export function RoundBoardScene({
  tournament,
  settled,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in. */
  settled: boolean;
}) {
  const sections = beamerBoard(tournament.tables, tournament.matches);
  const progress = matchesProgress(tournament.matches);
  // Both inputs matter. Sixteen matches spread over sixteen tables is a wide,
  // shallow board; the same sixteen on two tables is a deep one. Depth no
  // longer decides whether the board fits — `useFitToStage` does that — but a
  // deep board should reach for smaller type before it reaches for the scale,
  // because type that was chosen is nicer than type that was shrunk.
  const size = density(sections.length, deepestSection(sections));
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
                  participant={tournament.participantLabel}
                  size={size}
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
  participant,
  size,
}: {
  section: BoardSection;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  size: Density;
}) {
  const { table } = section;
  const isQueue = table === null;
  const isDisabled = table?.status === 'DISABLED';

  return (
    <section
      // The queue spans the whole grid and lays its matches out in columns of
      // its own: it is the one section that grows without a table to bound it,
      // and a single stacked column of twenty-six cards is what clips.
      className={`flex min-w-0 flex-col gap-2 ${isQueue ? 'col-span-full' : ''}`}
      data-table-id={table?.id ?? undefined}
      data-queue={isQueue ? '' : undefined}
    >
      <h2 className={`wm-display font-bold text-wm-text-muted ${HEADING[size]}`}>
        {isQueue ? de.beamer.roundBoard.queueTitle : table.label}
      </h2>

      {section.matches.length === 0 ? (
        <p className={`text-wm-text-faint ${LABEL[size]}`} data-table-idle="">
          {isDisabled ? de.beamer.roundBoard.tableDisabled : de.beamer.roundBoard.tableIdle}
        </p>
      ) : (
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
              participant={participant}
              size={size}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchCard({
  match,
  groups,
  participant,
  size,
}: {
  match: Match;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  size: Density;
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

      <Side match={match} groupId={match.a} groups={groups} participant={participant} size={size} />
      {match.b === null ? null : (
        <Side
          match={match}
          groupId={match.b}
          groups={groups}
          participant={participant}
          size={size}
        />
      )}
    </li>
  );
}

/**
 * One participant of a match, with its result.
 *
 * The three signals live here together so they cannot drift apart: a card that
 * was green without the word, or carried `SIEGER` without the tick, would fail
 * the greyscale reading the issue asks for.
 */
function Side({
  match,
  groupId,
  groups,
  participant,
  size,
}: {
  match: Match;
  groupId: GroupId;
  groups: ReadonlyMap<GroupId, Group>;
  participant: ParticipantLabel;
  size: Density;
}) {
  const label = groupLabel(groupId, groups, participant);
  const decided = match.winnerId !== null;
  const isWinner = decided && match.winnerId === groupId;
  const outcome: Outcome = !decided ? 'OPEN' : isWinner ? 'WINNER' : 'LOSER';

  return (
    <span
      // The 6 px left border is the winner's, per docs/STYLEGUIDE.md §1. The
      // loser drops to .6 opacity and desaturates; both are colour-independent
      // on purpose, so the difference survives greyscale.
      className={`flex min-w-0 items-baseline gap-3 border-l-[6px] pl-3 ${OUTCOME_SIDE[outcome]} ${
        // The flip itself. Only the decided sides animate, and both run at once
        // — a stagger would look like hesitation about the result
        // (docs/MOTION.md §4.2).
        outcome === 'OPEN' ? '' : OUTCOME_ANIMATION[outcome]
      }`}
      data-outcome={outcome}
    >
      {/*
       * A fixed box, so `·` → `✓` cannot nudge the name sideways. The three
       * glyphs have different advance widths, and the acceptance criterion is
       * that nothing moves when a result lands — inside the card as much as
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
       * Stepped down towards the 32 px floor for a long name before the
       * `truncate` beside it resorts to an ellipsis (issue #23, `@/ui/nameFit`):
       * a forty-character team is read rather than cut off mid-word.
       */}
      <span
        className={`min-w-0 flex-1 truncate font-semibold ${fitNameType(label.text, TYPE[size])}`}
      >
        {label.text}
      </span>

      {/*
       * The result word always occupies its slot, even before there is a
       * result. Rendering it only once decided would re-truncate the name at
       * the exact moment the room is reading it — the same layout shift the
       * criterion forbids, one level further in.
       *
       * The slot is sized by the longest of the two words rather than by a
       * hardcoded width: an invisible copy sits in the same grid cell and does
       * the measuring, so the reservation stays correct if the wording changes.
       */}
      <span className={`grid shrink-0 ${RIBBON[size]}`} data-outcome-slot="">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 wm-beamer-label">
          {LONGEST_OUTCOME_LABEL}
        </span>
        {outcome === 'OPEN' ? null : (
          <span
            className="col-start-1 row-start-1 wm-beamer-label text-right"
            data-outcome-label=""
          >
            {outcome === 'WINNER' ? de.beamer.roundBoard.winner : de.beamer.roundBoard.loser}
          </span>
        )}
      </span>
    </span>
  );
}

/** Whichever of the two result words is wider, for the reserved slot above. */
const LONGEST_OUTCOME_LABEL =
  de.beamer.roundBoard.winner.length >= de.beamer.roundBoard.loser.length
    ? de.beamer.roundBoard.winner
    : de.beamer.roundBoard.loser;

type Outcome = 'OPEN' | 'WINNER' | 'LOSER';

/** Filled shapes, not thin outlines — a hairline glyph dies on a projector. */
const OUTCOME_ICON: Record<Outcome, string> = {
  OPEN: '·',
  WINNER: '✓',
  LOSER: '✗',
};

const OUTCOME_SIDE: Record<Outcome, string> = {
  OPEN: 'border-transparent text-wm-text',
  WINNER: 'border-wm-win bg-wm-win-bg text-wm-text',
  LOSER: 'border-wm-lose bg-wm-lose-bg text-wm-text-muted opacity-60 saturate-50',
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

function density(sections: number, deepest: number): Density {
  if (sections <= 4 && deepest <= 2) {
    return 'roomy';
  }
  return sections <= 9 && deepest <= 4 ? 'normal' : 'dense';
}

/** The most matches any one section has to hold. */
function deepestSection(sections: readonly BoardSection[]): number {
  return sections.reduce((most, section) => Math.max(most, section.matches.length), 0);
}

const TYPE: Record<Density, NameType> = {
  roomy: 'text-beamer-h2',
  normal: 'text-beamer-h3',
  dense: 'text-beamer-body',
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
