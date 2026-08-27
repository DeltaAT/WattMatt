import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { useCountPulse } from '@/windows/beamer/useCountPulse';

/**
 * `WELCOME`: the screen the room fills up in front of (issue #74).
 *
 * The half hour before a tournament starts is the longest single stretch the
 * projector is on and the only one nobody had written a picture for. People are
 * arriving, registering and looking at the wall, and what they want to know is
 * two things: that they are in the right room, and how big this is going to be.
 *
 * So: the tournament's name, and a count that grows while they watch. The count
 * is the scene — it is at `beamer-hero`, in the display font, and everything
 * else is arranged around it (docs/STYLEGUIDE.md §2, §3 "one idea per screen").
 *
 * **Not a roster.** No numbers, no names, no chips. "Am I in?" is a different
 * question with a different answer and it already has a screen —
 * `GROUP_OVERVIEW` — which the host stages when they want it. A welcome screen
 * that also listed sixty-four numbers would be neither.
 *
 * **Only the number moves.** Every line here is drawn at every count, including
 * zero, so the layout is identical at 0 and at 64 and nothing reflows as the
 * field grows. The tick is a scale pulse on the digits alone
 * (`useCountPulse`, docs/MOTION.md §4.7): the host adds groups in bursts, and a
 * screen that re-entered for each of them would strobe at the audience.
 */
export function WelcomeScene({
  tournament,
  settled,
  delivery,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in. */
  settled: boolean;
  /**
   * Why this snapshot arrived. The count ticks only for a change this window
   * watched happen — never for a beamer catching up, and never for an undo.
   */
  delivery: SnapshotDelivery;
}) {
  const words = de.participant[tournament.participantLabel];
  // Counted off the snapshot's own groups rather than sent as a number, like
  // `NamingScene` does: the beamer derives what it draws, so this count cannot
  // drift from the chips `GROUP_OVERVIEW` would show (CLAUDE.md golden rule 4).
  const count = tournament.groups.length;
  const pulse = useCountPulse(count, delivery);

  return (
    <div
      className="beamer-safe-area flex h-full flex-col items-center justify-center gap-8 text-center"
      data-scene="WELCOME"
      data-settled={settled}
    >
      {/*
        The product name stands in while no tournament is open. The host can
        stage this scene at any time, including from the start screen, and a
        heading that was simply missing would leave the count floating over an
        empty wall (issue #28's "reachable at any time").
      */}
      <h1 className="wm-display text-beamer-h1 font-extrabold" data-tournament-name="">
        {tournament.name === '' ? de.beamer.idleTitle : tournament.name}
      </h1>

      <p className="wm-display wm-tnum text-beamer-hero" data-group-count="">
        {/*
          Keyed on the generation, not on the count: that is what makes the
          browser run the keyframes again rather than leave a finished animation
          on an element it is reusing. `inline-block` because a transform does
          nothing to an inline box.
        */}
        <span
          key={pulse}
          className={pulse === 0 ? 'inline-block' : 'wm-count-pulse inline-block'}
          data-count-value=""
        >
          {count}
        </span>
      </p>

      <p className="text-beamer-h2 text-wm-text-muted" data-count-label="">
        {de.beamer.welcome.atTheStart({ participants: words.word({ n: count }) })}
      </p>

      {/*
        The optional line the issue asks for, drawn unconditionally: a line that
        appeared when the first table was added would move everything above it,
        which is the one thing this scene must not do while people are watching
        the number.
      */}
      <p className="wm-tnum text-beamer-body text-wm-text-faint" data-table-count="">
        {de.beamer.welcome.tables({ tables: de.table.count({ n: tournament.tables.length }) })}
      </p>
    </div>
  );
}
