import { useEffect, useMemo, useState } from 'react';

import type { SnapshotDelivery } from '@/domain/snapshot';

/**
 * Decide which reveal step the ceremony should show.
 *
 * - If sceneReveal?.mode === 'STEP' the host controls the step via scene.reveal.step.
 * - If sceneReveal?.mode === 'AUTO' the hook auto-advances through steps 0..2 with 500ms gaps.
 * - Absent, the scene is inert (no reveals).
 */
export function useCeremonyReveal(
  sceneReveal: { mode: 'AUTO' | 'STEP'; step: number } | undefined,
  delivery: SnapshotDelivery,
  settled: boolean,
) {
  const isStepMode = sceneReveal?.mode === 'STEP';
  const isAuto = sceneReveal?.mode === 'AUTO';

  const [autoStep, setAutoStep] = useState<number>(-1);

  useEffect(() => {
    if (!isAuto) {
      setAutoStep(-1);
      return;
    }

    // start auto reveal when delivery is live and the scene has settled
    if (delivery !== 'live' || !settled) {
      setAutoStep(-1);
      return;
    }

    let mounted = true;
    let step = 0;
    setAutoStep(step);

    const timers: number[] = [];
    // reveal: bronze(0) -> silver(1) -> gold(2) with 500ms between them
    for (let i = 1; i < 3; i++) {
      const t = window.setTimeout(() => {
        if (!mounted) return;
        step = i;
        setAutoStep(step);
      }, i * 500);
      timers.push(t);
    }

    return () => {
      mounted = false;
      timers.forEach((t) => clearTimeout(t));
    };
  }, [isAuto, delivery, settled]);

  const step = useMemo(() => {
    if (isStepMode) return sceneReveal!.step;
    if (isAuto) return autoStep;
    return -1;
  }, [isStepMode, isAuto, sceneReveal, autoStep]);

  return { mode: sceneReveal?.mode ?? null, step } as const;
}
