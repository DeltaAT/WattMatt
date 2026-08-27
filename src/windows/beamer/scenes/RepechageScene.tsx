import type { GroupId } from '@/domain/ids';
import type { PotStatus } from '@/domain/repechage';
import type { RepechageSnapshot, TournamentSnapshot } from '@/domain/snapshot';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { NO_TRAVEL, type RepechageTravel } from '@/windows/beamer/useRepechageTravel';
import { groupNumber } from '@/windows/groupLabel';

/**
 * `REPECHAGE`: the `Hoffnungsrunde`, live in front of the room (issue #21,
 * docs/MOTION.md §4.3, docs/TOURNAMENT-RULES.md §4).
 *
 * Dramatically the best moment of the evening: people who have just been
 * knocked out are drawn back in. Most of the audience does not know the rule,
 * so the scene has one job beyond being pretty — to make it obvious, without
 * anybody explaining it, that there are *n* places and that they are filling up.
 *
 * **Everybody who lost is on the wall from the first frame**, and nobody ever
 * leaves it. A card changes state where it stands: it lifts when it is drawn,
 * turns green when the place is taken, shakes and fades when it is turned down.
 * The person who came to watch their friend can follow that friend from the
 * moment the pot is shown to the moment they are through or out — which a scene
 * that moved cards between three lists would not allow.
 *
 * **The winners column is on screen the whole time**, so the progress toward
 * the target is a picture and not a number to be trusted. The counter above it
 * says the same thing in words, because a column of sixteen chips cannot be
 * counted from the back of a room.
 *
 * **The draw itself is a lottery and has to look like one** (issue #89). A
 * highlight travels the pot unpredictably and stops on the candidate; until it
 * stops, the drawn card is painted exactly like everybody else, because the
 * snapshot has known the answer since before the first frame and the room must
 * not. `travel.pending` is what holds that back, and the moment it clears is
 * the moment the card lifts and the rest of the pot dims behind it — the beat
 * docs/MOTION.md §4.3 describes, now the *end* of the draw rather than the
 * whole of it.
 *
 * The motion is CSS, like the draw sequence: docs/MOTION.md §6 prefers it for
 * predetermined beats because keyframes run off the main thread and stay smooth
 * while React is busy. Every duration resolves through the tokens, so
 * performance mode halves them without this scene knowing it exists. The travel
 * is the exception and is a timer, for the reason `useRepechageTravel` gives:
 * no media query can shorten a `setTimeout`, and the light must *stop* rather
 * than merely slow down when a window has been asked to hold still.
 */
export function RepechageScene({
  tournament,
  /**
   * The beat that is playing, or null when nothing is.
   *
   * Decided by the beamer window rather than here (`useRepechageBeat`), because
   * "did this window watch the answer land, or arrive to find it already
   * given?" is a question about the window and not about the tournament. It is
   * what keeps a projector reopened mid-phase from shaking a card that was
   * turned down ten minutes ago (CLAUDE.md golden rule 4).
   */
  beat,
  travel = NO_TRAVEL,
}: {
  tournament: TournamentSnapshot;
  beat: GroupId | null;
  /**
   * The travelling highlight, or `NO_TRAVEL` when none is running
   * (`useRepechageTravel`, issue #89).
   *
   * Defaulted so every caller that only wants a settled picture — a test, a
   * catch-up render — gets exactly the scene that existed before the travel
   * did.
   */
  travel?: RepechageTravel;
}) {
  const repechage = tournament.repechage;
  const { frame, content } = useFitToStage();

  if (repechage === null || repechage.pot.length === 0) {
    return (
      <div
        className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
        data-scene="REPECHAGE"
      >
        <h1 className="wm-display text-beamer-h1">{de.beamer.repechage.title}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.repechage.empty}</p>
      </div>
    );
  }

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  // The bare number, like every other group-round scene since issue #75: the
  // `Hoffnungsrunde` runs on the losers of the qualifying round, who have no
  // names yet and would not be helped by the word `Gruppe` in front of thirty
  // of them.
  const number = (groupId: GroupId) => groupNumber(groupId, byId).text;

  // A candidate is on the beamer waiting for an answer, which is the moment the
  // rest of the pot dims (docs/MOTION.md §4.3). Not while the light is still
  // travelling: the dimming is half of the landing, and a pot that receded the
  // moment the snapshot arrived would announce that somebody had been drawn
  // before the room could see who (issue #89).
  const isDrawing =
    travel.pending === null && repechage.pot.some((entry) => entry.status === 'DRAWN');

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="REPECHAGE"
      data-drawing={isDrawing}
      data-travelling={travel.isTravelling}
    >
      <header className="flex items-baseline justify-between gap-6">
        <div className="flex items-baseline gap-6">
          <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.repechage.title}</h1>
          <p className="wm-tnum text-beamer-body text-wm-text-muted" data-repechage-target="">
            {de.beamer.repechage.target({ n: repechage.target })}
          </p>
        </div>

        {/*
         * The counter the issue asks for, in the accent colour and at headline
         * size: "the audience can always tell how many slots remain" is an
         * acceptance criterion, and it is the one thing on this scene that has
         * to be legible from the very back.
         *
         * It does not disappear when it reaches zero — it says so. A number
         * that vanished at the exact moment the phase completed would read as a
         * screen that had broken, not as a field that had filled.
         */}
        <p
          className="wm-tnum wm-display text-beamer-h2 font-extrabold text-wm-accent"
          data-repechage-need=""
        >
          {repechage.need === 0
            ? de.beamer.repechage.slotsFilled
            : de.beamer.repechage.slotsLeft({ n: repechage.need })}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
        <div className="beamer-fit grid grid-cols-[2fr_1fr] gap-8" ref={content}>
          <Pot
            entries={repechage.pot}
            number={number}
            beat={beat}
            dimmed={isDrawing}
            travel={travel}
          />
          <Through through={repechage.through} byes={repechage.byes} number={number} beat={beat} />
        </div>
      </div>
    </div>
  );
}

/**
 * Everybody who lost the qualifying round, in the order they were drawn from.
 *
 * Nothing is ever removed. `POOL` is the resting state; the rest are the three
 * things that can have happened to a card, each of which says so in a word as
 * well as in a colour (docs/STYLEGUIDE.md §1) — a projector in a bright room
 * flattens hues, and roughly 8 % of men would otherwise read a decline as an
 * acceptance.
 */
function Pot({
  entries,
  number,
  beat,
  dimmed,
  travel,
}: {
  entries: RepechageSnapshot['pot'];
  number: (groupId: GroupId) => string;
  beat: GroupId | null;
  /** True while a candidate is out: the rest of the pot recedes behind them. */
  dimmed: boolean;
  travel: RepechageTravel;
}) {
  const columns = fitColumns(entries.length, POT_CELL_ASPECT);

  return (
    <section className="flex min-w-0 flex-col gap-4" data-repechage-pot="">
      <h2 className="wm-display text-beamer-h3 font-bold text-wm-text-muted">
        {de.beamer.repechage.potTitle}
      </h2>

      <ul className="grid auto-rows-min gap-3" style={gridColumns(columns)}>
        {entries.map((entry) => {
          // Until the light lands, the candidate is one of the crowd — same
          // colour, same word, no lift (issue #89). The snapshot has said
          // `DRAWN` since the first frame; the picture must not.
          const isPending = travel.pending === entry.groupId;
          const status = isPending ? 'POOL' : entry.status;

          return (
            <PotCard
              key={entry.groupId}
              groupId={entry.groupId}
              status={status}
              number={number(entry.groupId)}
              // Only the card that just moved animates. Animating the pot would
              // blow the 60-element budget of docs/MOTION.md §6 and read as a
              // flicker rather than as one thing happening.
              isBeat={beat === entry.groupId && !isPending}
              // The drawn card is never dimmed — it is the one being lifted out
              // of the crowd, and dimming it with the crowd would defeat the
              // beat.
              dimmed={dimmed && status === 'POOL'}
              isLit={travel.highlight === entry.groupId}
            />
          );
        })}
      </ul>
    </section>
  );
}

function PotCard({
  groupId,
  status,
  number,
  isBeat,
  dimmed,
  isLit,
}: {
  groupId: GroupId;
  status: PotStatus;
  number: string;
  isBeat: boolean;
  dimmed: boolean;
  /** The travelling highlight is on this card right now (issue #89). */
  isLit: boolean;
}) {
  return (
    <li
      // 4 px of border, never a hairline: a thin line disappears through a
      // projector lens (docs/STYLEGUIDE.md §5).
      //
      // The lit card *replaces* its status colours rather than adding to them:
      // two `border-` utilities in one class string are decided by the order
      // Tailwind emitted them in, not by the order they are written here, so
      // appending would be a coin toss recompiled on every build.
      className={`flex min-w-0 flex-col gap-1 rounded-wm-xl border-4 px-5 py-3 ${
        isLit ? LIT_CARD : STATUS_CARD[status]
      } ${dimmed ? 'opacity-35' : ''} ${isBeat ? STATUS_ANIMATION[status] : ''}`}
      data-group-id={groupId}
      data-pot-status={status}
      data-pot-lit={isLit ? '' : undefined}
    >
      <span className="wm-beamer-label text-beamer-body text-wm-text-muted" data-pot-label="">
        {de.beamer.repechage.status[status]}
      </span>
      {/*
       * The number, at a step it could not have had while it was a word in
       * front of a number (issue #75). This is the card the room is reading out
       * loud, so it is the one that most has to carry to the back.
       */}
      <span className="wm-display wm-tnum text-beamer-h2 font-extrabold">{number}</span>
    </li>
  );
}

/**
 * The column that fills up: everybody who is through to the bracket.
 *
 * On screen from the first frame, empty places included, because the point of
 * the whole scene is watching it fill. The qualifying winners are in it too —
 * they are the field the repechage is topping up, and a column that showed only
 * the newcomers would make the target look unreachable.
 */
function Through({
  through,
  byes,
  number,
  beat,
}: {
  through: readonly GroupId[];
  byes: number;
  number: (groupId: GroupId) => string;
  beat: GroupId | null;
}) {
  const columns = fitColumns(through.length, THROUGH_CELL_ASPECT);

  return (
    <section
      className="flex min-w-0 flex-col gap-4 rounded-wm-xl border-4 border-wm-border-strong bg-wm-surface p-6"
      data-repechage-through=""
    >
      <h2 className="wm-display text-beamer-h3 font-bold text-wm-text-muted">
        {de.beamer.repechage.throughTitle}{' '}
        <span className="wm-tnum text-wm-text">{through.length}</span>
      </h2>

      <ul className="grid auto-rows-min gap-2" style={gridColumns(columns)}>
        {through.map((groupId) => (
          <li
            key={groupId}
            className={`wm-display wm-tnum min-w-0 truncate rounded-wm-md border-4 border-wm-win bg-wm-win-bg px-3 py-2 text-center text-beamer-h3 font-extrabold ${
              // The card that has just arrived. It lands rather than appearing:
              // the audience has to see *this* number take *that* place.
              beat === groupId ? 'wm-repechage-arrive' : ''
            }`}
            data-group-id={groupId}
          >
            {number(groupId)}
          </li>
        ))}
      </ul>

      {/*
       * The `Freilose` the §4 fallback owes the next round. Said out loud
       * because they are places in the field that nobody is standing in, and a
       * column that came up short against the target with no explanation is how
       * a room decides the app has miscounted.
       */}
      {byes === 0 ? null : (
        <p className="text-beamer-body font-semibold text-wm-accent" data-repechage-byes="">
          {de.beamer.repechage.byes({ n: byes })}
        </p>
      )}
    </section>
  );
}

/**
 * Roughly how wide each card comes out against its height, for `fitColumns`.
 *
 * A pot card carries a label over a name and is wider than it is tall; a chip in
 * the winners column is one line. Calibrated so the counts a host actually has
 * — a pot of 5, a field of 16 — come out at the column counts the scene was
 * designed against (`fit.ts`).
 */
const POT_CELL_ASPECT = 3;
const THROUGH_CELL_ASPECT = 5;

/**
 * The card the travelling highlight is on (issue #89).
 *
 * Deliberately not the drawn card's treatment. The light is a *pass* — accent
 * edge and fill, at full strength against a pot that has not dimmed yet — while
 * the landing adds the scale and the glow ring on top (`wm-repechage-lift`). If
 * the two looked the same, every hop would read as an announcement and the room
 * would stop believing the last one.
 *
 * A held class and not an animation: the light jumps, and a transition would
 * smear it into a slide across the pot — which is a highlight moving *toward*
 * somewhere, and therefore a tell.
 */
const LIT_CARD = 'border-wm-accent bg-wm-accent-soft text-wm-text';

const STATUS_CARD: Record<PotStatus, string> = {
  POOL: 'border-wm-border-strong bg-wm-bg text-wm-text',
  DRAWN: 'border-wm-accent bg-wm-accent-soft text-wm-text',
  ACCEPTED: 'border-wm-win bg-wm-win-bg text-wm-text',
  DECLINED: 'border-wm-lose bg-wm-lose-bg text-wm-text-muted opacity-20 saturate-50',
};

/** docs/MOTION.md §4.3, one class per beat. `POOL` is not a beat. */
const STATUS_ANIMATION: Record<PotStatus, string> = {
  POOL: '',
  DRAWN: 'wm-repechage-lift',
  ACCEPTED: 'wm-repechage-accept',
  DECLINED: 'wm-repechage-decline',
};
