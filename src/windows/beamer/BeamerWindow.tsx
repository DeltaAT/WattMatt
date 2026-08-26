import { BeamerPicture } from '@/windows/beamer/BeamerPicture';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { FpsOverlay } from '@/windows/beamer/FpsOverlay';
import { useBeamerView } from '@/windows/beamer/useBeamerView';
import { useBeamerStatus } from '@/windows/useBeamerStatus';

/**
 * The projector window (docs/ARCHITECTURE.md §2).
 *
 * It renders what it is told and holds no authoritative state. Everything it
 * shows comes from the last snapshot the host sent; there is no path from here
 * back into the tournament (CLAUDE.md golden rule 4).
 */
export function BeamerWindow() {
  const status = useBeamerStatus();
  const view = useBeamerView();

  return (
    <BeamerSurface
      placement={status.placement}
      performanceMode={view.snapshot.tournament.performanceMode}
    >
      <BeamerPicture view={view} />

      {/*
        The frame-rate readout of docs/MOTION.md §6, dev builds only (issue
        #29). `import.meta.env.DEV` is a compile-time constant, so this whole
        branch — component, animation loop and all — is gone from a release
        bundle rather than merely switched off.
      */}
      {import.meta.env.DEV ? <FpsOverlay /> : null}
    </BeamerSurface>
  );
}
