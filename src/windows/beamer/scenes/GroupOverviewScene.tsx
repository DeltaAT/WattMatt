import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { GroupChip, type ChipScale } from '@/ui';
import { fitColumns, gridColumns } from '@/windows/beamer/fit';
import { useFitToStage } from '@/windows/beamer/useFitToStage';

/**
 * `GROUP_OVERVIEW`: everyone who is playing, on the projector (issue #14).
 *
 * The scene that is on while people arrive. It answers the question a room
 * fills up with — "am I in?" — without anybody having to ask the host, and it
 * is the reason a participant notices they were entered twice *before* the
 * draw rather than after it.
 *
 * That only works if **everybody** is on it. A field larger than the grid holds
 * used to fall off the bottom of an `overflow-hidden` stage, and the one person
 * whose chip was missing is exactly the person the scene exists for. So the
 * grid takes as many columns as the field needs and the whole thing is scaled
 * down until it fits (issue #55, `useFitToStage`).
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
  const { frame, content } = useFitToStage();

  return (
    <div
      className="beamer-safe-area flex h-full flex-col gap-6"
      data-scene="GROUP_OVERVIEW"
      data-settled={settled}
    >
      {/*
       * The header is outside the frame and never scales. It is the one line
       * that says what the room is looking at, and it is the same size whether
       * eight people turned up or eighty.
       */}
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
        <div className="min-h-0 flex-1 overflow-hidden" ref={frame}>
          <div className="beamer-fit" ref={content}>
            <ul
              className="grid auto-rows-min gap-4"
              style={gridColumns(fitColumns(tournament.groups.length, CELL_ASPECT))}
            >
              {tournament.groups.map((group) => (
                <GroupChip
                  key={group.id}
                  group={group}
                  participant={tournament.participantLabel}
                  scale={size}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The shape of a chip: a number, and a name beside it when there is one.
 *
 * 16:9 is the stage's own ratio, which makes the grid square-ish — `fitColumns`
 * reduces to `round(sqrt(count))` at this value. That is deliberate: it is
 * exactly the ladder this scene used before (4 columns at 16, 6 at 36, 8 at
 * 64), and it keeps going past 64 instead of clipping there.
 */
const CELL_ASPECT = 16 / 9;

/**
 * How much type each participant gets.
 *
 * Still three steps, and they still only ever go down: this is the *relative*
 * emphasis inside a chip, decided by how crowded the field is. Fitting the
 * scene onto the stage is `useFitToStage`'s job and happens on top of this, so
 * a field bigger than the densest step no longer needs a fourth one — it needs
 * the same chip, drawn smaller.
 *
 * `text-beamer-body` is the 32 px floor of docs/STYLEGUIDE.md §2, which now
 * holds for the field sizes a host normally has rather than absolutely: a chip
 * below it can be read by walking closer, and a chip that was cut off cannot be
 * read at all (issue #55, docs/OPEN-QUESTIONS.md #57).
 */
function density(count: number): Extract<ChipScale, `beamer${string}`> {
  if (count <= 16) {
    return 'beamerRoomy';
  }
  return count <= 36 ? 'beamerNormal' : 'beamerDense';
}
