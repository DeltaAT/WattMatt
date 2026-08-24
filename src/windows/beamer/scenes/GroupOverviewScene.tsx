import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { GroupChip, type ChipScale } from '@/ui';

/**
 * `GROUP_OVERVIEW`: everyone who is playing, on the projector (issue #14).
 *
 * The scene that is on while people arrive. It answers the question a room
 * fills up with — "am I in?" — without anybody having to ask the host, and it
 * is the reason a participant notices they were entered twice *before* the
 * draw rather than after it.
 *
 * One idea per screen (docs/STYLEGUIDE.md §3): numbers and names, no status
 * counts, no controls, nothing that depends on hover. The chips are the same
 * component the host grid uses, at a bigger scale (§4) — two chip components
 * would eventually disagree about who is still in.
 */
export function GroupOverviewScene({
  tournament,
  settled,
}: {
  tournament: TournamentSnapshot;
  /** False only while the scene is animating in; nothing here animates yet. */
  settled: boolean;
}) {
  const words = de.participant[tournament.participantLabel];
  const size = density(tournament.groups.length);

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="GROUP_OVERVIEW"
      data-settled={settled}
    >
      <header className="flex items-baseline gap-6">
        <h1 className="wm-display text-beamer-h1 font-extrabold">{words.many}</h1>
        {tournament.groups.length === 0 ? null : (
          <p className="wm-tnum text-beamer-body text-wm-text-muted" data-group-count="">
            {de.beamer.groupOverview.count({
              participants: words.count({ n: tournament.groups.length }),
            })}
          </p>
        )}
      </header>

      {tournament.groups.length === 0 ? (
        <p className="text-beamer-body text-wm-text-muted">{words.beamerEmpty}</p>
      ) : (
        <ul className={`grid flex-1 auto-rows-min gap-4 ${COLUMNS[size]}`}>
          {tournament.groups.map((group) => (
            <GroupChip
              key={group.id}
              group={group}
              participant={tournament.participantLabel}
              scale={size}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * How much room each participant gets.
 *
 * A beamer scene that needs a scrollbar is the wrong scene
 * (docs/STYLEGUIDE.md §3), and the size of the field is the host's decision
 * rather than the designer's — so the grid gets denser instead of taller. The
 * densest step holds 64 chips inside the safe area at 1080p, which is the
 * number issue #14 names; `text-beamer-body` is the absolute floor at 32 px
 * (§2), so a field larger than that is a scene that needs a different design,
 * not a smaller font.
 */
function density(count: number): Extract<ChipScale, `beamer${string}`> {
  if (count <= 16) {
    return 'beamerRoomy';
  }
  return count <= 36 ? 'beamerNormal' : 'beamerDense';
}

const COLUMNS: Record<Extract<ChipScale, `beamer${string}`>, string> = {
  beamerRoomy: 'grid-cols-4',
  beamerNormal: 'grid-cols-6',
  beamerDense: 'grid-cols-8',
};
