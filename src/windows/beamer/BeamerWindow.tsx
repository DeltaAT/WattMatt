import { de } from '@/i18n';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { useBeamerStatus } from '@/windows/useBeamerStatus';

/**
 * The projector window (docs/ARCHITECTURE.md §2).
 *
 * It renders what it is told and holds no authoritative state. The scene model
 * and the snapshot channel arrive with issue #5; what this issue owns is the
 * surface those scenes will be drawn on, and the guarantee that reopening this
 * window re-establishes it from scratch.
 */
export function BeamerWindow() {
  const status = useBeamerStatus();

  return (
    <BeamerSurface placement={status.placement}>
      <div className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4">
        <h1 className="wm-display text-beamer-h1">{de.beamer.idleTitle}</h1>
        <p className="text-beamer-body text-wm-text-muted">{de.beamer.idleNotice}</p>
      </div>
    </BeamerSurface>
  );
}
