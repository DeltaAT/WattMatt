import { useEffect, useState } from 'react';

import { drawPool, revealedMatches } from '@/domain/drawSequence';
import type { GroupId, TableId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Group, Match, Table } from '@/domain/types';
import { de } from '@/i18n';
import { useReducedMotion } from '@/windows/beamer/reducedMotion';
import { useFitToStage } from '@/windows/beamer/useFitToStage';
import { groupNumber } from '@/windows/groupLabel';
import { tableNumber } from '@/windows/tableLabel';

/**
 * `DRAW`: the Auslosung, live in front of the room (issue #18).
 *
 * The signature moment of the whole app, and the one scene where *how* it is
 * drawn is the point rather than a decoration — the sequence is the
 * entertainment (docs/MOTION.md §4.1).
 *
 * The board is a pure function of `step`. When the step advances lives in
 * `useDrawSequence`; what a step means lives in `@/domain/drawSequence`. That
 * split is what makes "skipping mid-sequence leaves a correct, complete board"
 * checkable without driving a timer — at the final step this renders the
 * settled board, and there is no other path to it.
 *
 * The card reveal, the placement and the pool pulse are CSS keyframes:
 * docs/MOTION.md §6 prefers CSS for predetermined sequences because they run
 * off the main thread and stay smooth while React is busy, which is the
 * difference between 60 fps and a stutter with 32 pairings. The one exception
 * is the shuffling slot, whose content depends on the pool and so cannot be
 * predetermined — it is a single element ticking, far inside the §6 budget.
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

  // The snapshot carries the round flat — its identity beside its matches — so
  // this puts them back together for the one module that slices them. Both
  // sides therefore agree about draw order by construction.
  const asRound = { ...round, matches: tournament.matches };
  const revealed = revealedMatches(asRound, step);
  const pool = drawPool(asRound, tournament.groups, step);
  const total = tournament.matches.length;
  const size = density(total);

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((group) => [group.id, group]),
  );
  const tables: ReadonlyMap<TableId, Table> = new Map(
    tournament.tables.map((table) => [table.id, table]),
  );

  // The slot the next pairing is being drawn into. Absent once the board is
  // complete, and absent when settled — a caught-up beamer has no pairing in
  // flight to show.
  const isDrawing = !settled && revealed.length < total;

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="DRAW"
      data-settled={settled}
      // How many pairings are actually on the board, not the raw counter: a
      // skip sets the step past the end, and an attribute that reported the
      // over-run would make two identical boards look different to anything
      // reading the markup.
      data-step={revealed.length}
    >
      <header className="flex items-baseline gap-6">
        <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.draw.title}</h1>
        <p className="wm-tnum text-beamer-body text-wm-text-muted" data-draw-progress="">
          {de.beamer.draw.progress({ drawn: revealed.length, total })}
        </p>
      </header>

      {/*
       * Scaled to fit like every other scene since issue #55, and newly so
       * (issue #75). The numerals are the point of this board now, and numerals
       * that large at 32 pairings are exactly the case where a board runs off
       * the bottom of an `overflow-hidden` stage — taking the last pairings
       * drawn with it, which is the half of the draw the room has not seen yet.
       */}
      <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
        <div className="beamer-fit grid grid-cols-[2fr_1fr] gap-8" ref={content}>
          <ol className={`grid auto-rows-min gap-4 ${PAIRING_COLUMNS[size]}`}>
            {revealed.map((match, index) => (
              <PairingCard
                key={match.id}
                match={match}
                groups={byId}
                tables={tables}
                size={size}
                // Only the pairing that has just landed animates. Re-animating
                // the whole board every step would blow the 60-element budget
                // (docs/MOTION.md §6) and read as a flicker.
                isNewest={!settled && index === revealed.length - 1}
              />
            ))}

            {isDrawing ? <ShuffleSlot pool={pool} size={size} /> : null}
          </ol>

          <Pool groups={pool} settled={settled} />
        </div>
      </div>
    </div>
  );
}

/**
 * The pairing slot mid-draw: numbers cycling before one lands
 * (docs/MOTION.md §4.1, the shuffle beat).
 *
 * The tick is JavaScript because what it cycles through is the live pool, which
 * no CSS keyframe can know. One element updating ~17 times a second is nothing
 * against the §6 budget — the budget is about how many things move at once.
 *
 * Under `prefers-reduced-motion` it holds still and shows nothing but the
 * placeholder: rapidly flickering digits are precisely what that setting exists
 * to prevent, and §6 keeps meaning while dropping movement.
 */
function ShuffleSlot({ pool, size }: { pool: readonly Group[]; size: Density }) {
  const [tick, setTick] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (pool.length === 0 || reducedMotion) {
      return;
    }
    // ~60 ms per tick, the rate docs/MOTION.md §4.1 gives for the shuffle.
    const timer = setInterval(() => setTick((previous) => previous + 1), 60);
    return () => clearInterval(timer);
  }, [pool.length, reducedMotion]);

  const showing = pool.length === 0 ? null : pool[tick % pool.length];

  return (
    <li
      className={`flex flex-col items-center gap-2 rounded-wm-xl border-4 border-dashed border-wm-accent bg-wm-bg px-6 py-4 ${NUMBER_TYPE[size]}`}
      data-draw-slot=""
      aria-hidden="true"
    >
      <span className="wm-display wm-tnum font-extrabold text-wm-accent">
        {showing?.number ?? '—'}
      </span>
    </li>
  );
}

/**
 * The numbers still to be drawn.
 *
 * Shrinking in front of the audience is the whole job: it is how a room follows
 * a draw it cannot otherwise verify, and how somebody still in the pool knows
 * they have not been dealt yet.
 */
function Pool({ groups, settled }: { groups: readonly Group[]; settled: boolean }) {
  // The pulse goes on the grid, not on each number in it. docs/MOTION.md §6
  // caps the beamer at roughly sixty simultaneously animated elements and says
  // to animate a container above that — and this is the one place in the app
  // that would go through the cap, because the pool at the start of a 64-group
  // draw *is* sixty-four elements (issue #29). One animated layer instead of
  // sixty-four, and the audience sees the same thing: the pool breathing while
  // it waits to be dealt from.
  return (
    <section
      className="flex min-h-0 flex-col gap-4 rounded-wm-xl border-4 border-wm-border-strong bg-wm-surface p-6"
      data-draw-pool=""
    >
      <h2 className="wm-display text-beamer-h3 font-bold text-wm-text-muted">
        {de.beamer.draw.poolTitle}
      </h2>

      {groups.length === 0 ? (
        <p className="text-beamer-body text-wm-text-faint">{de.beamer.draw.poolEmpty}</p>
      ) : (
        <ul
          className={`grid auto-rows-min grid-cols-4 gap-3 ${settled ? '' : 'wm-draw-pool-number'}`}
        >
          {groups.map((group) => (
            <li
              key={group.id}
              className="wm-tnum rounded-wm-md bg-wm-bg px-3 py-2 text-center text-beamer-body font-bold"
              data-pool-group-id={group.id}
            >
              {group.number}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PairingCard({
  match,
  groups,
  tables,
  size,
  isNewest,
}: {
  match: Match;
  groups: ReadonlyMap<GroupId, Group>;
  tables: ReadonlyMap<TableId, Table>;
  size: Density;
  isNewest: boolean;
}) {
  const a = groupNumber(match.a, groups);
  const b = groupNumber(match.b, groups);
  const isBye = match.b === null;
  const table = match.tableId === null ? null : (tables.get(match.tableId) ?? null);

  return (
    <li
      // 4 px of border, never a hairline: a thin line disappears through a
      // projector lens (docs/STYLEGUIDE.md §5). The Freilos gets the accent
      // colour as well as its own words — a projector in a bright room destroys
      // hue differences, so colour is never the only signal (§1).
      className={`flex flex-col gap-2 rounded-wm-xl border-4 px-6 py-4 text-center ${
        isBye ? 'border-wm-accent bg-wm-accent-soft' : 'border-wm-border-strong bg-wm-surface'
      } ${isNewest ? 'wm-draw-reveal' : ''}`}
      data-match-id={match.id}
      data-bye={isBye}
      data-newest={isNewest}
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
       */}
      <span className="text-beamer-body font-semibold text-wm-text-muted" data-pairing-where="">
        {isBye
          ? de.beamer.draw.byeAdvances
          : table === null
            ? de.beamer.draw.waitingForTable
            : tableNumber(table.label)}
      </span>

      {/*
       * The two numbers, and nothing between them but space (issue #75). They
       * are the one thing on this scene that has to carry ten metres, and every
       * word taken off the card went into their size.
       */}
      <span
        className={`flex min-w-0 items-baseline justify-center gap-8 wm-display wm-tnum font-extrabold ${NUMBER_TYPE[size]}`}
        data-pairing=""
      >
        <span>{a.text}</span>
        {isBye ? null : (
          <>
            {/*
              The word the space stands for, for a screen reader and for nobody
              else — `7 12` read aloud is two numbers and not a match.
            */}
            <span className="sr-only">{de.match.versus}</span>
            <span>{b.text}</span>
          </>
        )}
      </span>
    </li>
  );
}

/**
 * How much room each pairing gets.
 *
 * A beamer scene that needs a scrollbar is the wrong scene
 * (docs/STYLEGUIDE.md §3), so the grid gets denser rather than taller. The
 * densest step holds the 32 pairings the issue names as its worst case;
 * `text-beamer-body` is the 32 px floor (§2), so a larger draw is a scene that
 * needs a different design, not a smaller font.
 */
type Density = 'roomy' | 'normal' | 'dense';

function density(count: number): Density {
  if (count <= 6) {
    return 'roomy';
  }
  return count <= 16 ? 'normal' : 'dense';
}

const PAIRING_COLUMNS: Record<Density, string> = {
  roomy: 'grid-cols-1',
  normal: 'grid-cols-2',
  dense: 'grid-cols-3',
};

/**
 * How big the two numbers are drawn (issue #75).
 *
 * Every step went up once the words came off: `beamer-hero` at the field sizes
 * where it fits, and never below `beamer-h2` — which is twice the old densest
 * step, because two digits need a fraction of the width `Gruppe 7 gegen
 * Gruppe 12` did. `useFitToStage` shrinks the board from here if a projector
 * turns out to have less room than the ladder assumed, so the ladder is free to
 * ask for the size the room actually needs (docs/STYLEGUIDE.md §2, §4).
 */
const NUMBER_TYPE: Record<Density, string> = {
  roomy: 'text-beamer-hero',
  normal: 'text-beamer-h1',
  dense: 'text-beamer-h2',
};
