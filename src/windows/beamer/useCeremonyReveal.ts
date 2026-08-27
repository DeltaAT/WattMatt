import { useEffect, useMemo, useRef, useState } from 'react';

import type { SnapshotDelivery } from '@/domain/snapshot';

/** docs/MOTION.md §4.5: bronze, then silver, then gold, 500 ms apart. */
const GAP_MS = 500;

/**
 * The last place there can be, so a step of 2 is the whole podium.
 *
 * A field of 2 has no `Spiel um Platz 3` and therefore only two places, but the
 * scene compares this against the places it actually has — a step past the end
 * is simply "all of them" (docs/TOURNAMENT-RULES.md §9 case 10).
 */
const EVERY_PLACE = 2;

/** Nothing revealed yet: the podium is up and still empty. */
const NOTHING = -1;

/**
 * How far the `Siegerehrung` has been revealed (issues #27 and #69).
 *
 * The step is a fact about *this window* — how much of the sequence it has
 * watched — rather than about the tournament, which is why it is a hook here
 * and not a field of the snapshot. What the snapshot carries is the host's
 * decision: which mode, and, in `STEP`, exactly which place.
 *
 * - **`STEP`** is the host stepping through the podium themselves. The step is
 *   theirs, it lives in the scene descriptor, and it therefore survives the
 *   beamer window being closed and reopened mid-ceremony (golden rule 4).
 * - **`AUTO`** runs §4.5's sequence, but only on a **live** snapshot. A window
 *   that has just been reopened, or an undo, arrives as `catchUp` and is handed
 *   the finished podium instead: the room watched the reveal twenty seconds
 *   ago, and replaying it would announce three results that have already been
 *   announced. The same answer `useBracketAdvance` and `useResultFlip` give.
 * - **Absent**, the scene has no reveal at all and shows the settled podium.
 *
 * Nothing here starts on its own. §8 is explicit that the podium must never
 * fire the instant the final is decided — so `AUTO` only ever runs because the
 * host pressed *Siegerehrung starten*, and even then not before the scene has
 * settled.
 */
export function useCeremonyReveal(
  sceneReveal: { mode: 'AUTO' | 'STEP'; step: number } | undefined,
  delivery: SnapshotDelivery,
  settled: boolean,
) {
  const isStepMode = sceneReveal?.mode === 'STEP';
  const isAuto = sceneReveal?.mode === 'AUTO';
  const live = delivery === 'live';

  const [autoStep, setAutoStep] = useState<number>(NOTHING);

  useEffect(() => {
    if (!isAuto) {
      setAutoStep(NOTHING);
      return;
    }

    // A reveal this window did not watch: the podium as it now stands, without
    // the sequence that got it there.
    if (!live) {
      setAutoStep(EVERY_PLACE);
      return;
    }

    // Not while the scene is still arriving — the first place would rise
    // through the crossfade that is putting the podium on the wall.
    if (!settled) {
      setAutoStep(NOTHING);
      return;
    }

    let mounted = true;
    setAutoStep(0);

    const timers: number[] = [];
    for (let place = 1; place <= EVERY_PLACE; place += 1) {
      const timer = window.setTimeout(() => {
        if (!mounted) return;
        setAutoStep(place);
      }, place * GAP_MS);
      timers.push(timer);
    }

    return () => {
      mounted = false;
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [isAuto, live, settled]);

  const step = useMemo(() => {
    if (isStepMode) return sceneReveal?.step ?? NOTHING;
    if (isAuto) return autoStep;
    return NOTHING;
  }, [isStepMode, isAuto, sceneReveal, autoStep]);

  // How far the podium stood the last time this window looked. A ref rather
  // than state, for the reason `useBracketAdvance` gives: it is the *previous*
  // picture, and re-rendering because it changed would be re-rendering because
  // the render happened.
  const resting = useRef(NOTHING);
  // The one place that is arriving, and only for a window that is watching it
  // happen. A reopened beamer and an undo both come in as `catchUp` and get a
  // podium that is simply standing there — three blocks rising for results the
  // room heard called out twenty seconds ago is the ceremony's version of
  // replaying the evening.
  const arriving = live && step > resting.current ? step : null;

  useEffect(() => {
    resting.current = step;
  });

  return { mode: sceneReveal?.mode ?? null, step, arriving } as const;
}
