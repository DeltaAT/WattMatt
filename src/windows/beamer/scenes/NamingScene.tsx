import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';

/**
 * `NAMING`: the holding picture while the host types names (issue #23,
 * docs/TOURNAMENT-RULES.md §6).
 *
 * The one scene defined by what it does **not** show. Behind it the host is
 * entering sixteen names one field at a time, and a wall that followed along
 * would put a half-finished list in front of the audience — every typo on the
 * way to being corrected, and the arbitrary order the host happened to work in.
 * The room would read that as the field, and start asking who the missing eight
 * are.
 *
 * So it says three things and no more: that the evening is still going, what
 * comes next, and how many are through. Names return to the projector with the
 * `Turnierbaum`, all at once, which is the moment they are meant to land.
 *
 * Nothing animates. This scene is on screen for several minutes while nothing
 * happens, and motion with nothing behind it reads as a page that is stuck
 * (docs/MOTION.md §3).
 */
export function NamingScene({
  tournament,
  settled,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in; nothing here animates. */
  settled: boolean;
}) {
  const words = de.participant[tournament.participantLabel];
  // Counted off the snapshot's own groups rather than sent as a number: the
  // beamer holds no state and derives what it draws, so the count cannot drift
  // from the chips the very next scene will show (CLAUDE.md golden rule 4).
  const remaining = tournament.groups.filter((group) => group.status === 'ACTIVE').length;

  return (
    <div
      className="beamer-safe-area flex h-full flex-col items-center justify-center gap-6 text-center"
      data-scene="NAMING"
      data-settled={settled}
    >
      {/*
        The tournament's name as chrome, above the message: somebody walking
        into the room during this phase has nothing else to tell them what they
        have walked into (issue #19 uses it the same way).
      */}
      {tournament.name === '' ? null : (
        <p className="text-beamer-caption text-wm-text-muted" data-tournament-name="">
          {tournament.name}
        </p>
      )}

      <h1 className="wm-display text-beamer-h1 font-extrabold">{de.beamer.naming.title}</h1>

      <p className="text-beamer-h3 text-wm-text-muted">{de.beamer.naming.notice}</p>

      {remaining === 0 ? null : (
        <p className="wm-tnum text-beamer-body text-wm-text-muted" data-naming-field="">
          {de.beamer.naming.field({ participants: words.count({ n: remaining }) })}
        </p>
      )}
    </div>
  );
}
