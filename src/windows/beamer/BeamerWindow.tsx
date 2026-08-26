import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { FpsOverlay } from '@/windows/beamer/FpsOverlay';
import { reportSceneFailure } from '@/windows/beamer/reportSceneFailure';
import { SafeBeamerPicture } from '@/windows/beamer/SafeBeamerPicture';
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
      {/*
        Never a bare `BeamerPicture`: a scene that throws must land on the
        holding picture inside this surface, not take the window with it
        (issue #30). The host is told over the channel — the projector is
        usually behind them, and this is the one failure they cannot see.
      */}
      <SafeBeamerPicture view={view} onSceneFailure={reportSceneFailure} />

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
