import type { BeamerViewState } from '@/store/beamerStore';
import { BeamerScenePlaceholder } from '@/windows/beamer/BeamerScenePlaceholder';
import { useBlackout } from '@/windows/beamer/useBlackout';

/**
 * Everything inside the 16:9 stage: the staged scene, and the blackout veil
 * that can be over it (issue #28).
 *
 * One component rather than two identical trees, because the host's live
 * preview draws exactly this and the projector draws exactly this. A preview
 * that assembled the picture itself would be a preview that could drift, and
 * the one thing it is for is being trusted at a glance.
 */
export function BeamerPicture({ view }: { view: BeamerViewState }) {
  const settled = !view.animate;
  const blackout = useBlackout(view.snapshot.scene, settled);

  return (
    <>
      <BeamerScenePlaceholder
        scene={blackout.under}
        tournament={view.snapshot.tournament}
        // The covered scene has been on screen for a while; it must not replay
        // its entrance under the veil on its way out.
        settled={blackout.veil || settled}
        delivery={view.snapshot.delivery}
        skipToken={view.snapshot.skipToken}
      />

      {/*
        Inside the stage rather than over the whole root: the letterbox bars are
        already `--wm-bg`, which is the colour the veil fades to.
      */}
      {blackout.veil ? (
        <div className="wm-blackout-veil absolute inset-0" data-blackout-veil="" />
      ) : null}
    </>
  );
}
