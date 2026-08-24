// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useSkipKey } from '@/windows/beamer/useSkipKey';

/**
 * `Space` skips the draw (issue #18).
 *
 * Registered on the window rather than on an element, because the beamer
 * surface has no focusable controls at all — no cursor, no chrome, nothing to
 * tab to (docs/STYLEGUIDE.md §3).
 */

function mount(skip: () => void, enabled = true) {
  function Probe({ on }: { on: boolean }) {
    useSkipKey(skip, on);
    return null;
  }
  const view = render(<Probe on={enabled} />);
  return { rerender: (on: boolean) => view.rerender(<Probe on={on} />), unmount: view.unmount };
}

function press(code: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { code, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

describe('the skip key', () => {
  it('skips on Space', () => {
    const skip = vi.fn();
    mount(skip);

    press('Space');
    expect(skip).toHaveBeenCalledTimes(1);
  });

  /* Space scrolls a document by default, and the beamer surface must never
   * move under the audience. */
  it('swallows the keypress', () => {
    mount(vi.fn());
    expect(press('Space').defaultPrevented).toBe(true);
  });

  it('ignores every other key', () => {
    const skip = vi.fn();
    mount(skip);

    for (const code of ['Enter', 'KeyS', 'ArrowRight', 'Escape']) {
      press(code);
    }
    expect(skip).not.toHaveBeenCalled();
  });

  /* A held space bar must skip once, not once per repeat — the second skip
   * would land on whatever scene came next. */
  it('ignores an auto-repeat', () => {
    const skip = vi.fn();
    mount(skip);

    press('Space');
    press('Space', { repeat: true });
    press('Space', { repeat: true });

    expect(skip).toHaveBeenCalledTimes(1);
  });

  it('does nothing once there is nothing left to skip', () => {
    const skip = vi.fn();
    mount(skip, false);

    press('Space');
    expect(skip).not.toHaveBeenCalled();
  });

  it('stops listening when the sequence completes', () => {
    const skip = vi.fn();
    const probe = mount(skip, true);

    probe.rerender(false);
    press('Space');

    expect(skip).not.toHaveBeenCalled();
  });

  it('leaves no listener behind when the scene goes away', () => {
    const skip = vi.fn();
    const probe = mount(skip);

    probe.unmount();
    press('Space');

    expect(skip).not.toHaveBeenCalled();
  });
});
