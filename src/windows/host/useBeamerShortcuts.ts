import { useEffect, useRef } from 'react';

import { isTextEntry } from '@/windows/host/textEntry';
import type { BeamerControlHandle } from '@/windows/host/useBeamerControl';

/**
 * The host's fast path (issue #28, docs/MOTION.md §2).
 *
 * `Space` skips, `B` blacks out and back, `1…9` stage a scene, `F` freezes and
 * releases, `?` opens the overview. `Strg+Z` is `useUndoShortcuts`', and stays
 * there — the two register separately because undo works before the beamer
 * column has anything to control.
 *
 * On `window`, for the reason the undo shortcuts are: the host's hands are on
 * the keyboard between decisions, and a blackout that only fired while the
 * right panel had focus would fail in the one moment it exists for.
 *
 * **None of these fire while the host is typing** (`isTextEntry`). That is not
 * politeness, it is the naming phase: a whole panel of text fields, in which
 * `B` has to be the letter B. It is also why every one of these is unmodified —
 * a shortcut that needed `Strg` would sit on top of the text field's own
 * editing keys instead.
 *
 * Keyboard actions never animate on the host side either: they commit and are
 * done (docs/MOTION.md §2, "keyboard-initiated actions never animate").
 */
export function useBeamerShortcuts(
  control: BeamerControlHandle,
  onShowShortcuts: () => void,
): void {
  // Read through a ref rather than captured: re-registering on every commit
  // would leave a gap between removing the old listener and adding the new one,
  // and a keypress that lands in it does nothing while the host is already
  // looking at the projector.
  const latest = useRef({ control, onShowShortcuts });
  latest.current = { control, onShowShortcuts };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A modifier makes this a different shortcut, not this one — `Strg+B` is
      // the browser's, `Strg+Z` is undo's. `Shift` is exempt because `?` is a
      // shifted key on an Austrian keyboard.
      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }
      if (isTextEntry(event.target)) {
        return;
      }
      // A held key is one press, not forty: `B` on autorepeat would otherwise
      // toggle the screen dark and light again several times a second.
      if (event.repeat) {
        return;
      }

      const { control: handle, onShowShortcuts: showShortcuts } = latest.current;

      // `event.code` for the space bar, so a layout that puts something else on
      // it still skips; `event.key` for the rest, because what the host reads
      // on the keycap is what they expect to press.
      if (event.code === 'Space') {
        /*
         * Taken from the focused control rather than shared with it
         * (docs/OPEN-QUESTIONS.md #77). A button keeps its `Enter`, so nothing
         * becomes unreachable — and a host whose focus is still on *Sieger
         * festlegen* after their last click gets a skip rather than a second,
         * accidental result.
         *
         * `preventDefault` because the default is scrolling, and neither the
         * beamer surface nor the host panel may move under the person reading
         * it.
         */
        event.preventDefault();
        handle.skip();
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'b') {
        event.preventDefault();
        handle.toggleBlackout();
        return;
      }

      if (key === 'f') {
        event.preventDefault();
        handle.toggleFreeze();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        showShortcuts();
        return;
      }

      // `1` through `9`, in the order of `SCENE_ORDER`. `0` is deliberately
      // nothing: there is no tenth scene, and a digit that did something
      // unexpected next to nine that do the same thing is worse than a digit
      // that does nothing.
      if (event.key >= '1' && event.key <= '9') {
        event.preventDefault();
        handle.showAt(Number(event.key));
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
