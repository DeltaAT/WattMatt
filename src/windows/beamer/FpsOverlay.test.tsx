// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FpsOverlay } from '@/windows/beamer/FpsOverlay';

/**
 * The dev-build frame-rate readout (issue #29, docs/MOTION.md §6).
 *
 * The number itself is the point: a readout that is merely *present* while
 * being wrong is worse than none, because the 60 fps budget would then be
 * signed off against it. So the frames are driven by hand and the arithmetic is
 * checked, including the case the loop starts in — before a full window has
 * elapsed there is no rate to report and it must say so rather than guess.
 */

/** A `requestAnimationFrame` whose clock this test owns. */
function installFrames() {
  const pending = new Map<number, FrameRequestCallback>();
  let next = 1;
  let now = 0;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const handle = next++;
    pending.set(handle, callback);
    return handle;
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    pending.delete(handle);
  });

  return {
    /** Advance the clock by `ms` and deliver one frame. */
    frame(ms: number) {
      now += ms;
      const due = [...pending.entries()];
      pending.clear();
      act(() => {
        for (const [, callback] of due) {
          callback(now);
        }
      });
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FpsOverlay', () => {
  it('says nothing until it has a full window to measure', () => {
    installFrames();
    const view = render(<FpsOverlay />);

    expect(view.getByText(/—/)).toBeDefined();
  });

  it('reports the rate for frames arriving every 16 ms', () => {
    const frames = installFrames();
    const view = render(<FpsOverlay />);

    // The first frame only starts the window; the 32nd after it is the one that
    // closes it, at 512 ms.
    for (let i = 0; i < 33; i += 1) {
      frames.frame(16);
    }

    // 32 frames over 512 ms is 62.5 — the budget, as measured rather than as
    // hoped for.
    expect(view.container.textContent).toBe('63 fps');
  });

  it('reports the drop when frames start taking twice as long', () => {
    const frames = installFrames();
    const view = render(<FpsOverlay />);
    for (let i = 0; i < 17; i += 1) {
      frames.frame(33);
    }

    // 16 frames over 528 ms — the 30 fps a projector stutters at.
    expect(view.container.textContent).toBe('30 fps');
  });

  it('measures each window on its own, so a recovery shows up', () => {
    // A scene that stutters as it arrives and settles afterwards is the normal
    // case on this window. A readout that averaged over the whole session would
    // never show it recovering.
    const frames = installFrames();
    const view = render(<FpsOverlay />);
    for (let i = 0; i < 17; i += 1) {
      frames.frame(33);
    }
    expect(view.container.textContent).toBe('30 fps');

    for (let i = 0; i < 32; i += 1) {
      frames.frame(16);
    }

    expect(view.container.textContent).toBe('63 fps');
  });

  it('stops asking for frames once it is gone', () => {
    const frames = installFrames();
    const view = render(<FpsOverlay />);
    frames.frame(16);
    expect(frames.pendingCount).toBe(1);

    view.unmount();

    expect(frames.pendingCount).toBe(0);
  });

  it('is marked as decoration, so nothing reads it out or clicks it', () => {
    installFrames();
    const view = render(<FpsOverlay />);
    const overlay = view.container.querySelector('[data-fps-overlay]');

    expect(overlay?.getAttribute('aria-hidden')).toBe('true');
    expect(overlay?.className).toContain('pointer-events-none');
  });
});
