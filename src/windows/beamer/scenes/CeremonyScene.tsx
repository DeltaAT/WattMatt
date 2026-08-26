import type { GroupId } from '@/domain/ids';
import type { TournamentSnapshot } from '@/domain/snapshot';
import { de } from '@/i18n';
import { useReducedMotion } from '@/windows/beamer/reducedMotion';

/**
 * `CEREMONY`: the award podium (issue #27).
 *
 * Deliberate minimal implementation for now: a three-block podium in the
 * 2 · 1 · 3 arrangement with data attributes the tests and the host panel use.
 * Animations, confetti and step-by-step controls are added later; the scene
 * must render deterministically from the snapshot so it is testable.
 */
export function CeremonyScene({
  tournament,
  settled,
  revealMode = null,
  revealStep = -1,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  revealMode?: 'AUTO' | 'STEP' | null;
  revealStep?: number;
}) {
  // Consume reveal props to satisfy the compiler when they are unused.
  void revealMode;
  void revealStep;

  // docs/MOTION.md §6: particles are the first thing both performance mode and
  // reduced motion drop. The 150-particle burst of §4.5 is the heaviest thing
  // the beamer ever draws, and it carries no information — the podium already
  // says who won — so it is the cheapest thing to give up on weak hardware and
  // the most obviously right thing to give up for a viewer who asked for calm.
  const reducedMotion = useReducedMotion();
  const particles = !tournament.performanceMode && !reducedMotion;
  // The podium draws from the bracket winners where available; fall back to
  // group numbered labels when no winner names exist.
  const groupsById = new Map(tournament.groups.map((g) => [g.id, g]));

  // Simple derivation: final winner -> gold, final loser -> silver, thirdPlace winner -> bronze
  const gold: unknown | null =
    tournament.bracket?.nodes.find((n) => n.round === 'FINAL')?.winnerId ?? null;
  const bronze: unknown | null =
    tournament.bracket?.nodes.find((n) => n.round === 'THIRD_PLACE')?.winnerId ?? null;
  // The final node's slots can be used to find the loser when winner is known.
  const finalNode = tournament.bracket?.nodes.find((n) => n.round === 'FINAL') ?? null;
  let silver: unknown | null = null;
  if (finalNode) {
    if (finalNode.slotA !== null && finalNode.slotB !== null && finalNode.winnerId !== null) {
      silver = finalNode.winnerId === finalNode.slotA ? finalNode.slotB : finalNode.slotA;
    }
  }

  function labelFor(id: unknown | null): string {
    if (id === null) return '';
    const g = groupsById.get(id as unknown as GroupId);
    if (!g) return '';
    return g.name ?? (de.participant.GROUP.numbered({ n: g.number }) as string);
  }

  const left = labelFor(silver); // position 2
  const middle = labelFor(gold); // position 1
  const right = labelFor(bronze); // position 3

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
        {/* 2 · 1 · 3 arrangement */}
        <div className="flex flex-col items-center" data-podium-place="2">
          <div className="podium-block h-24 w-40 rounded-wm-sm bg-wm-bronze p-4 text-center font-semibold">
            {left}
          </div>
          <div className="mt-2 text-beamer-caption text-wm-text-muted">
            {de.beamer.ceremony.positions.bronze}
          </div>
        </div>

        <div className="flex flex-col items-center" data-podium-place="1">
          <div className="podium-block h-40 w-48 rounded-wm-sm bg-wm-gold p-4 text-center font-extrabold">
            {middle}
          </div>
          <div className="mt-2 text-beamer-caption text-wm-text-muted">
            {de.beamer.ceremony.positions.gold}
          </div>
        </div>

        <div className="flex flex-col items-center" data-podium-place="3">
          <div className="podium-block h-20 w-36 rounded-wm-sm bg-wm-silver p-4 text-center font-semibold">
            {right}
          </div>
          <div className="mt-2 text-beamer-caption text-wm-text-muted">
            {de.beamer.ceremony.positions.silver}
          </div>
        </div>
      </div>

      {/* Confetti placeholder: suppressed in performance mode and under reduced
          motion. `data-particles` is also what the CSS backstop in
          src/styles/global.css keys on, so a particle layer added later is
          covered whether or not its author remembers the flag. */}
      {particles ? <div aria-hidden="true" data-confetti="" data-particles="" /> : null}
    </div>
  );
}
