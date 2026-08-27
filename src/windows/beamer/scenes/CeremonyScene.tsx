import { finalStandingsOf, hasThirdPlace } from '@/domain/bracket';
import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import type { Group } from '@/domain/types';
import { de } from '@/i18n';
import { useReducedMotion } from '@/windows/beamer/reducedMotion';
import { groupLabel } from '@/windows/groupLabel';

/** A step of the podium, named after the medal the room hears called out. */
type Place = 'bronze' | 'silver' | 'gold';

/**
 * Where each place stands and how big its block is.
 *
 * The geometry is what says who came second without anybody reading a word, so
 * it travels with the place rather than with the column it happens to sit in —
 * which is precisely how issue #69's swap survived: the heights were attached
 * to the place and the colours and captions to the column, and the two drifted
 * apart. One table now, so a wrong podium is a wrong line rather than a wrong
 * pairing of two right ones.
 */
const PODIUM: Record<Place, { position: '1' | '2' | '3'; block: string }> = {
  gold: { position: '1', block: 'h-40 w-48 bg-wm-gold font-extrabold' },
  silver: { position: '2', block: 'h-24 w-40 bg-wm-silver font-semibold' },
  bronze: { position: '3', block: 'h-20 w-36 bg-wm-bronze font-semibold' },
};

/** The 2 · 1 · 3 arrangement: the runner-up on the left, the winner in the middle. */
const COLUMNS: readonly Place[] = ['silver', 'gold', 'bronze'];

/** docs/TOURNAMENT-RULES.md §8: the room hears bronze first and gold last. */
const REVEAL_ORDER: readonly Place[] = ['bronze', 'silver', 'gold'];

/**
 * `CEREMONY`: the award podium (issues #27 and #69, docs/TOURNAMENT-RULES.md §8,
 * docs/MOTION.md §4.5).
 *
 * The last picture of the evening and the one the whole room photographs, which
 * is what decides everything about it.
 *
 * **Who stands where is read off the tree, once.** `finalStandingsOf` answers
 * it for the host panel and for the wall, so the two cannot disagree about who
 * came second — and the scene has no second derivation of its own to get the
 * wrong way round (issue #69).
 *
 * **The reveal is the host's.** §8 requires bronze → silver → gold on the
 * host's timing, because they are naming each place out loud before the room
 * sees it. The scene holds no timer: it renders the step it is handed, and
 * `useCeremonyReveal` — which is the piece that knows whether this snapshot is
 * live — decides what that step is. Without a reveal at all (`revealMode` null)
 * the podium simply stands complete, which is what a beamer reopened after the
 * ceremony must show (golden rule 4).
 *
 * **An unrevealed place is empty, not hidden.** Its column keeps its box so
 * nothing shifts when the next name lands, but neither the name nor the caption
 * is in the markup — a name that is merely transparent is one failed stylesheet
 * away from being read out by the projector before the host has said it.
 */
export function CeremonyScene({
  tournament,
  settled,
  revealMode = null,
  revealStep = -1,
  arriving = null,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  /**
   * How the podium is being revealed, or null for the settled podium.
   *
   * `STEP` is the host stepping through it themselves and `AUTO` the same
   * sequence run on §4.5's timings; both arrive here as nothing but a step,
   * because the difference between them is a fact about the *window* and not
   * about the tournament (`useCeremonyReveal`).
   */
  revealMode?: 'AUTO' | 'STEP' | null;
  /** How far the reveal has come: an index into the places that exist. */
  revealStep?: number;
  /**
   * The one place this window is watching arrive, or null for a podium that is
   * simply standing there.
   *
   * Passed in rather than worked out here, exactly as the tree takes its
   * advancement (`BracketScene`): *this window watched that happen* is a fact
   * about the window and not about the tournament, and keeping it out leaves
   * the scene a pure function of one snapshot — which is what lets every state
   * of the podium be rendered in a test.
   */
  arriving?: number | null;
}) {
  // docs/MOTION.md §6: particles are the first thing both performance mode and
  // reduced motion drop. The 150-particle burst of §4.5 is the heaviest thing
  // the beamer ever draws, and it carries no information — the podium already
  // says who won — so it is the cheapest thing to give up on weak hardware and
  // the most obviously right thing to give up for a viewer who asked for calm.
  const reducedMotion = useReducedMotion();

  const bracket = tournament.bracket;
  const standings = bracket === null ? null : finalStandingsOf(bracket);

  // §9 case 10: a final phase that starts at 2 is one match and has no
  // `Spiel um Platz 3`, so the podium has two steps. Asked of the tree rather
  // than of the standings, because a third place that is merely still being
  // played keeps its step — empty until its match is over.
  const bronze = bracket !== null && hasThirdPlace(bracket);

  const byId: ReadonlyMap<GroupId, Group> = new Map(
    tournament.groups.map((entry) => [entry.id, entry]),
  );
  const name = (id: GroupId | null): string =>
    // Not through `groupLabel`'s bye branch: a place nobody has won yet is
    // blank, and `Freilos` under `Silber` would name a winner that does not
    // exist.
    id === null ? '' : groupLabel(id, byId, tournament.participantLabel).text;

  const names: Record<Place, string> = {
    gold: name(standings?.first ?? null),
    silver: name(standings?.second ?? null),
    bronze: name(standings?.third ?? null),
  };

  // The places this podium actually has, in the order §8 reveals them. A two-
  // step podium reveals silver on the host's first press rather than spending
  // it on a bronze that does not exist.
  const order = REVEAL_ORDER.filter((place) => place !== 'bronze' || bronze);
  const columns = COLUMNS.filter((place) => place !== 'bronze' || bronze);
  const shown = (place: Place): boolean =>
    revealMode === null || revealStep >= order.indexOf(place);

  // §4.5's burst belongs to gold's arrival: confetti over an empty podium would
  // celebrate a winner the room has not been told yet.
  const particles = !tournament.performanceMode && !reducedMotion && shown('gold');

  return (
    <div
      className="beamer-safe-area flex h-full items-end justify-center"
      data-scene="CEREMONY"
      data-settled={settled}
    >
      <header className="absolute top-6 left-6">
        <h1 className="wm-display text-beamer-h1">{de.beamer.ceremony.title}</h1>
      </header>
      <div className="flex w-full max-w-5xl items-end justify-center gap-8" data-podium="">
        {columns.map((place) => (
          <PodiumPlace
            key={place}
            place={place}
            name={names[place]}
            revealed={shown(place)}
            // Only the block that is landing right now moves. The ones already
            // on the podium keep their picture — the room is looking at the
            // step the host has just named.
            animate={arriving !== null && arriving === order.indexOf(place)}
          />
        ))}
      </div>

      {/* Confetti placeholder: suppressed in performance mode and under reduced
          motion. `data-particles` is also what the CSS backstop in
          src/styles/global.css keys on, so a particle layer added later is
          covered whether or not its author remembers the flag. */}
      {particles ? <div aria-hidden="true" data-confetti="" data-particles="" /> : null}
    </div>
  );
}

/**
 * One step of the podium, revealed or waiting.
 *
 * The column and its block are always drawn, so the picture does not rearrange
 * itself around each name as it arrives; what the reveal adds is the colour,
 * the caption and the name.
 */
function PodiumPlace({
  place,
  name,
  revealed,
  animate,
}: {
  place: Place;
  name: string;
  revealed: boolean;
  animate: boolean;
}) {
  const { position, block } = PODIUM[place];
  const rise = revealed && animate ? 'wm-podium-rise' : '';
  const glow = place === 'gold' && revealed && animate ? 'wm-podium-gold' : '';

  return (
    <div
      className="flex flex-col items-center"
      data-podium-place={position}
      data-revealed={revealed}
    >
      <div
        className={`podium-block rounded-wm-sm p-4 text-center ${block} ${revealed ? '' : 'invisible'} ${rise} ${glow}`}
      >
        {/* §4.5: the name arrives after its block has risen. */}
        <span className={revealed && animate ? 'wm-podium-name' : undefined}>
          {revealed ? name : ''}
        </span>
      </div>
      <div className="mt-2 text-beamer-caption text-wm-text-muted">
        {revealed ? de.beamer.ceremony.positions[place] : ''}
      </div>
    </div>
  );
}
