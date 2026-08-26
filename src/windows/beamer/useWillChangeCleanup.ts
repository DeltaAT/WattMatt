import { useEffect, type RefObject } from 'react';

/**
 * Takes `will-change` back off once the animation that needed it has finished
 * (issue #29, docs/MOTION.md §6).
 *
 * `will-change` is a promise to the compositor that something is about to move,
 * and it is paid for with a promoted layer whether or not anything moves. §6
 * therefore allows it "only during an animation" — but a CSS class cannot
 * express "during": the class that carries the hint is still on the element
 * long after its keyframes have run out, and on the beamer that element is one
 * of dozens. A few forgotten layers is a memory cost; a hundred of them on a
 * 64-group bracket is the frame budget.
 *
 * So the hint is cleared here instead, from the one place that can see every
 * animation: a delegated listener on the beamer root. Animation and transition
 * events bubble, so a single pair of listeners covers every scene — including
 * the ones nobody has written yet, which is the same reason performance mode is
 * a token redefinition rather than a rule per effect.
 *
 * **Written inline, and only ever set to `auto`.** Overriding the class rather
 * than removing it is what makes this safe to run against a hint that came from
 * a stylesheet. Motion that sets the hint from JavaScript — `useBracketAdvance`,
 * the only one — writes the same inline property, so its next trip simply
 * overwrites the `auto` left here and the two never fight.
 *
 * Cancellations count as endings. An interrupted animation is the normal case
 * on this window (golden rule 5: interrupting an animation is always allowed),
 * and an interrupted one is precisely the one that would otherwise never be
 * cleaned up.
 */
export function useWillChangeCleanup(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = root.current;
    if (element === null) {
      return;
    }

    const clear = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement || target instanceof SVGElement) {
        target.style.willChange = 'auto';
      }
    };

    const events = [
      'animationend',
      'animationcancel',
      'transitionend',
      'transitioncancel',
    ] as const;

    for (const name of events) {
      element.addEventListener(name, clear);
    }

    return () => {
      for (const name of events) {
        element.removeEventListener(name, clear);
      }
    };
  }, [root]);
}
