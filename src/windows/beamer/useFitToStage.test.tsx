// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useFitToStage } from '@/windows/beamer/useFitToStage';

/**
 * Shrinking a scene body until it fits (issue #55).
 *
 * The arithmetic is `fit.test.ts`'s. What is checked here is the wiring — that
 * the hook measures the *frame* against the *content*, that it measures the
 * content unscaled rather than at whatever scale it left behind last time, and
 * that it says so on the element. A hook that scaled off its own previous
 * output would drift a little further down on every result the host marked, and
 * the board would quietly shrink to nothing over an evening.
 *
 * jsdom does no layout, so the two measurements are stubbed. That is the whole
 * of what a browser contributes here: everything else in the hook is arithmetic
 * and DOM writes, which jsdom does honestly.
 */

/** Pins what the two elements report, the way a real layout would. */
function stubLayout({ frame, content }: { frame: number; content: number }) {
  const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight');

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset['role'] === 'frame' ? frame : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get(this: HTMLElement) {
      // The natural height, and only while nothing is scaling it. The hook has
      // to reset `--wm-fit` before it reads, which is exactly what this catches.
      if (this.dataset['role'] !== 'content') {
        return 0;
      }
      const fit = Number(this.style.getPropertyValue('--wm-fit') || '1');
      return content * fit;
    },
  });

  return () => {
    restore('clientHeight', clientHeight);
    restore('scrollHeight', scrollHeight);
  };
}

function restore(name: string, descriptor: PropertyDescriptor | undefined) {
  if (descriptor === undefined) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    return;
  }
  Object.defineProperty(HTMLElement.prototype, name, descriptor);
}

let undoStub: (() => void) | null = null;

afterEach(() => {
  // Explicit, because this suite has no global auto-cleanup: two mounted
  // scenes would make `content` ambiguous and the stub outlive its test.
  cleanup();
  undoStub?.();
  undoStub = null;
});

function Scene() {
  const { frame, content } = useFitToStage();

  return (
    <div data-role="frame" data-testid="frame" ref={frame}>
      <div className="beamer-fit" data-role="content" data-testid="content" ref={content}>
        <p>board</p>
      </div>
    </div>
  );
}

function mount() {
  const view = render(<Scene />);
  return { view, content: view.getByTestId('content') };
}

describe('useFitToStage', () => {
  it('leaves a body that already fits at full size', () => {
    undoStub = stubLayout({ frame: 900, content: 600 });

    const { content } = mount();

    expect(content.style.getPropertyValue('--wm-fit')).toBe('1');
    expect(content.dataset['fit']).toBe('1.000');
  });

  it('shrinks a body that is taller than its frame', () => {
    undoStub = stubLayout({ frame: 900, content: 1800 });

    const { content } = mount();

    expect(content.style.getPropertyValue('--wm-fit')).toBe('0.5');
    expect(content.dataset['fit']).toBe('0.500');
  });

  /*
   * The drift case. A hook that measured the content at the scale it had
   * already applied would compute a fresh reduction from an already-reduced
   * height, and the board would step down a little on every render — every
   * result the host marks — until it was unreadable.
   */
  it('measures the same scale however often it re-renders', () => {
    undoStub = stubLayout({ frame: 900, content: 1800 });

    const { view, content } = mount();
    view.rerender(<Scene />);
    view.rerender(<Scene />);

    expect(content.style.getPropertyValue('--wm-fit')).toBe('0.5');
  });

  /*
   * A window that has not been laid out, or one that is hidden. Guessing a
   * shrink from a measurement that does not exist would put the scene on the
   * projector at an arbitrary size; leaving it alone shows it at its natural
   * one and the next measurement corrects it.
   */
  it('does not scale when there is nothing to measure', () => {
    const { content } = mount();

    expect(content.style.getPropertyValue('--wm-fit')).toBe('1');
  });

  /*
   * The beamer window is dragged onto the projector, the projector reports a
   * different resolution, the host presses fullscreen. None of those re-render
   * the scene, and every one of them changes the box it has to fit into — so a
   * board that fitted the laptop screen would stay at its old scale and hang
   * off the bottom of the projector.
   */
  it('re-fits when the window it is in changes size', () => {
    const observed: Element[] = [];
    const resize: { fire: (() => void) | null } = { fire: null };
    let disconnected = 0;
    const real = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        resize.fire = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      unobserve() {}
      disconnect() {
        disconnected += 1;
      }
    } as unknown as typeof ResizeObserver;

    // Nothing to measure at first, so the board is left at full size.
    const { view, content } = mount();
    expect(content.style.getPropertyValue('--wm-fit')).toBe('1');
    expect(observed).toEqual([view.getByTestId('frame')]);

    // The projector turns out to be half the height the laptop screen was.
    undoStub = stubLayout({ frame: 900, content: 1800 });
    resize.fire?.();

    expect(content.style.getPropertyValue('--wm-fit')).toBe('0.5');

    // And it stops watching on the way out, rather than holding the window.
    view.unmount();
    expect(disconnected).toBe(1);
    // A late notification after unmount has no elements left to measure and
    // must not throw at a projector nobody is looking after.
    expect(() => resize.fire?.()).not.toThrow();

    globalThis.ResizeObserver = real;
  });

  it('survives an environment without a ResizeObserver', () => {
    const observer = globalThis.ResizeObserver;
    // @ts-expect-error — deliberately removing it, which is the case under test.
    delete globalThis.ResizeObserver;
    undoStub = stubLayout({ frame: 900, content: 1800 });

    try {
      const { content } = mount();
      expect(content.style.getPropertyValue('--wm-fit')).toBe('0.5');
    } finally {
      globalThis.ResizeObserver = observer;
    }
  });
});
