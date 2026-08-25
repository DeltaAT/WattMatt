import type { GroupId } from '@/domain/ids';
import type { PotStatus } from '@/domain/repechage';
import type { RepechageSnapshot, TournamentSnapshot } from '@/domain/snapshot';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType } from '@/ui/nameFit';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupLabel } from '@/windows/groupLabel';

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
 * The motion is CSS, like the draw sequence: docs/MOTION.md §6 prefers it for
 * predetermined beats because keyframes run off the main thread and stay smooth
 * while React is busy. Every duration resolves through the tokens, so
 * performance mode halves them without this scene knowing it exists.
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
}: {
  tournament: TournamentSnapshot;
  beat: GroupId | null;
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
  const name = (groupId: GroupId) => groupLabel(groupId, byId, tournament.participantLabel).text;

  // A candidate is on the beamer waiting for an answer, which is the moment the
  // rest of the pot dims (docs/MOTION.md §4.3).
  const isDrawing = repechage.pot.some((entry) => entry.status === 'DRAWN');

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="REPECHAGE"
      data-drawing={isDrawing}
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
          <Pot entries={repechage.pot} name={name} beat={beat} dimmed={isDrawing} />
          <Through through={repechage.through} byes={repechage.byes} name={name} beat={beat} />
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
  name,
  beat,
  dimmed,
}: {
  entries: RepechageSnapshot['pot'];
  name: (groupId: GroupId) => string;
  beat: GroupId | null;
  /** True while a candidate is out: the rest of the pot recedes behind them. */
  dimmed: boolean;
}) {
  const columns = fitColumns(entries.length, POT_CELL_ASPECT);

  return (
    <section className="flex min-w-0 flex-col gap-4" data-repechage-pot="">
      <h2 className="wm-display text-beamer-h3 font-bold text-wm-text-muted">
        {de.beamer.repechage.potTitle}
      </h2>

      <ul className="grid auto-rows-min gap-3" style={gridColumns(columns)}>
        {entries.map((entry) => (
          <PotCard
            key={entry.groupId}
            groupId={entry.groupId}
            status={entry.status}
            name={name(entry.groupId)}
            // Only the card that just moved animates. Animating the pot would
            // blow the 60-element budget of docs/MOTION.md §6 and read as a
            // flicker rather than as one thing happening.
            isBeat={beat === entry.groupId}
            // The drawn card is never dimmed — it is the one being lifted out
            // of the crowd, and dimming it with the crowd would defeat the beat.
            dimmed={dimmed && entry.status === 'POOL'}
          />
        ))}
      </ul>
    </section>
  );
}

function PotCard({
  groupId,
  status,
  name,
  isBeat,
  dimmed,
}: {
  groupId: GroupId;
  status: PotStatus;
  name: string;
  isBeat: boolean;
  dimmed: boolean;
}) {
  return (
    <li
      // 4 px of border, never a hairline: a thin line disappears through a
      // projector lens (docs/STYLEGUIDE.md §5).
      className={`flex min-w-0 flex-col gap-1 rounded-wm-xl border-4 px-5 py-3 ${
        STATUS_CARD[status]
      } ${dimmed ? 'opacity-35' : ''} ${isBeat ? STATUS_ANIMATION[status] : ''}`}
      data-group-id={groupId}
      data-pot-status={status}
    >
      <span className="wm-beamer-label text-beamer-body text-wm-text-muted" data-pot-label="">
        {de.beamer.repechage.status[status]}
      </span>
      {/*
       * Stepped down to the 32 px floor for a long name before the ellipsis
       * (issue #23, `@/ui/nameFit`). This is the card the room is reading out
       * loud, so it is the last place a name should end mid-word.
       */}
      <span className={`truncate font-bold ${fitNameType(name, 'text-beamer-h3')}`}>{name}</span>
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
  name,
  beat,
}: {
  through: readonly GroupId[];
  byes: number;
  name: (groupId: GroupId) => string;
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
            className={`min-w-0 truncate rounded-wm-md border-4 border-wm-win bg-wm-win-bg px-3 py-2 text-beamer-body font-bold ${
              // The card that has just arrived. It lands rather than appearing:
              // the audience has to see *this* number take *that* place.
              beat === groupId ? 'wm-repechage-arrive' : ''
            }`}
            data-group-id={groupId}
          >
            {name(groupId)}
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
