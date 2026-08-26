import { useSyncExternalStore } from 'react';

import { de } from '@/i18n';
import type { BeamerPlacement } from '@/platform/beamerWindow';
import { reportProblem } from '@/store/problems';
import { beamerPreviewStore } from '@/store/session';
import { BeamerSurface } from '@/windows/beamer/BeamerSurface';
import { SafeBeamerPicture } from '@/windows/beamer/SafeBeamerPicture';

/**
 * What the audience is looking at, in the host's column
 * (issue #28, docs/STYLEGUIDE.md §4).
 *
 * The same scenes, the same surface and the same snapshot the projector is
 * rendering — reached through a second beamer store fed by the loopback leg of
 * the host channel (`@/store/session`). Nothing here reads the tournament
 * directly, and that is the whole design: a preview built from the host's own
 * state would show what the host has decided, which is not the same picture as
 * the one on the wall while a draw is still playing out, while the projector is
 * catching up, or while the host has the picture frozen.
 *
 * Sized by `beamer-preview` in `src/styles/global.css`: the beamer's own type
 * unit is derived from the viewport, and a thumbnail has to re-derive it from
 * its own box or every scene lays itself out for the laptop screen.
 */
export function BeamerPreview({
  placement,
  frozen,
  open,
}: {
  placement: BeamerPlacement;
  /** Whether the host is holding the picture — the room sees this frame, not the live one. */
  frozen: boolean;
  /** Whether there is a beamer window at all; the preview is drawn either way. */
  open: boolean;
}) {
  // The same getter for the server snapshot: there is no server, and the store
  // is readable from the first render. Without it `useSyncExternalStore` throws
  // whenever the panel is rendered to static markup, which is how every host
  // component in this codebase is tested.
  const view = useSyncExternalStore(
    beamerPreviewStore.subscribe,
    beamerPreviewStore.getState,
    beamerPreviewStore.getState,
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="wm-label">{de.beamerControl.preview.label}</h3>

      <div
        className="beamer-preview relative w-full overflow-hidden rounded-wm-md border border-wm-border-strong"
        data-frozen={frozen}
      >
        <BeamerSurface
          placement={placement}
          performanceMode={view.snapshot.tournament.performanceMode}
          embedded
        >
          {/*
            The same net the projector has, for the same reason and in the same
            place (issue #30). The preview draws the identical tree, so a scene
            that throws on the wall throws here too — and a thumbnail that went
            white while the projector held a picture would be a preview the host
            cannot trust at the moment they most need to.

            Reported locally rather than over the channel: this failure happened
            in the host window, and the message has no distance to travel.
          */}
          <SafeBeamerPicture
            view={view}
            onSceneFailure={(scene, error) =>
              reportProblem(
                'beamerScene',
                'beamer.preview-scene-failed',
                `${scene}: ${String(error)}`,
              )
            }
          />
        </BeamerSurface>

        {/*
          Over the picture rather than beside it: a frozen preview looks exactly
          like a working one, and the label has to be where the host is already
          looking when they wonder why nothing is moving.
        */}
        {frozen ? (
          <p className="absolute inset-x-0 bottom-0 bg-wm-live px-2 py-1 text-center text-host-xs font-medium text-wm-text">
            {de.beamerControl.freeze.badge}
          </p>
        ) : null}
      </div>

      {open ? null : (
        <p className="text-host-xs text-wm-text-faint">{de.beamerControl.preview.closed}</p>
      )}
    </div>
  );
}
