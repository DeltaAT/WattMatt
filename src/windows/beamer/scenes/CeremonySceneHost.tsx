import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import { CeremonyScene } from '@/windows/beamer/scenes/CeremonyScene';
import { useCeremonyReveal } from '@/windows/beamer/useCeremonyReveal';

/**
 * The `Siegerehrung` with its reveal hooked up (issues #27 and #69).
 *
 * The split every animated scene in this window uses: the hook knows what this
 * window has watched, the scene is a pure function of a snapshot and a step.
 */
export function CeremonySceneHost({
  tournament,
  settled,
  delivery,
  sceneReveal,
}: {
  tournament: TournamentSnapshot;
  settled: boolean;
  delivery: SnapshotDelivery;
  sceneReveal: { mode: 'AUTO' | 'STEP'; step: number } | undefined;
}) {
  const { mode, step, arriving } = useCeremonyReveal(sceneReveal, delivery, settled);

  return (
    <CeremonyScene
      tournament={tournament}
      settled={settled}
      revealMode={mode}
      revealStep={step}
      arriving={arriving}
    />
  );
}
