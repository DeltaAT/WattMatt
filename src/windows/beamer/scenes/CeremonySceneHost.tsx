import type { SnapshotDelivery, TournamentSnapshot } from '@/domain/snapshot';
import { CeremonyScene } from '@/windows/beamer/scenes/CeremonyScene';
import { useCeremonyReveal } from '@/windows/beamer/useCeremonyReveal';

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
  const { mode, step } = useCeremonyReveal(sceneReveal, delivery, settled);

  return (
    <CeremonyScene tournament={tournament} settled={settled} revealMode={mode} revealStep={step} />
  );
}
