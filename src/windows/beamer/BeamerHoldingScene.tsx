import { de } from '@/i18n';

/**
 * What the projector shows instead of a scene that threw (issue #30).
 *
 * The audience is the whole reason this component exists, so it says nothing
 * about a failure: no message, no stack, no red. It is the idle picture — the
 * product name and a quiet line — because that is what a room reads as "the
 * next thing is being set up" rather than as "something is broken", and the
 * host does not need fifty people asking about it for the rest of the evening.
 *
 * The problem is reported where it can be acted on: on the host screen, as
 * `de.error.beamerScene` (`SafeBeamerPicture`).
 */
export function BeamerHoldingScene() {
  return (
    <div
      className="beamer-safe-area flex h-full flex-col items-center justify-center gap-4"
      data-scene="HOLDING"
      // The projector never animates its way into a failure: the picture the
      // room was looking at is gone already, and a scene sliding in would draw
      // attention to the moment it went (docs/MOTION.md §6).
      data-settled="true"
    >
      <h1 className="wm-display text-beamer-h1">{de.beamer.idleTitle}</h1>
      <p className="text-beamer-body text-wm-text-muted">{de.beamer.holdingNotice}</p>
    </div>
  );
}
