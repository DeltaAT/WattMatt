// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { useWillChangeCleanup } from '@/windows/beamer/useWillChangeCleanup';

/**
 * `will-change` left behind after an animation (issue #29, docs/MOTION.md §6).
 *
 * The cost this guards is invisible in a screenshot: a forgotten hint promotes
 * a compositor layer for an element that is never going to move again, and the
 * beamer has dozens of those. So what is asserted is the *absence* of the hint
 * once each kind of animation has ended — including the ways an animation ends
 * that are easy to forget, namely being interrupted.
 */

afterEach(cleanup);

function Harness({ children }: { children?: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useWillChangeCleanup(root);

  return (
    <div ref={root} data-testid="root">
      <div data-testid="card" style={{ willChange: 'transform' }}>
        <span data-testid="inner" style={{ willChange: 'opacity' }} />
      </div>
      {children}
    </div>
  );
}

function mounted() {
  const view = render(<Harness />);
  return {
    root: view.getByTestId('root'),
    card: view.getByTestId('card'),
    inner: view.getByTestId('inner'),
  };
}

/** An animation event that bubbles, the way a real one does. */
function fire(element: Element, type: string): void {
  element.dispatchEvent(new Event(type, { bubbles: true }));
}

describe('useWillChangeCleanup', () => {
  for (const event of ['animationend', 'animationcancel', 'transitionend', 'transitioncancel']) {
    it(`clears the hint on ${event}`, () => {
      const { card } = mounted();
      expect(card.style.willChange).toBe('transform');

      fire(card, event);

      expect(card.style.willChange).toBe('auto');
    });
  }

  it('clears the hint on the element the animation was on, not on the root', () => {
    // The listener sits on the root because animation events bubble, which is
    // the whole reason one pair of listeners covers every scene. It must still
    // act on the target: clearing the root would leave every card hinted and
    // strip a hint from something that never animated.
    const { root, card, inner } = mounted();

    fire(inner, 'animationend');

    expect(inner.style.willChange).toBe('auto');
    expect(card.style.willChange).toBe('transform');
    expect(root.style.willChange).toBe('');
  });

  it('leaves other inline styles alone', () => {
    const { card } = mounted();
    card.style.transform = 'translateX(4px)';

    fire(card, 'transitionend');

    expect(card.style.transform).toBe('translateX(4px)');
  });

  it('lets a later animation set the hint again', () => {
    // `useBracketAdvance` writes the same inline property before every trip, so
    // the `auto` left here must be an override and never a lock.
    const { card } = mounted();
    fire(card, 'transitionend');
    expect(card.style.willChange).toBe('auto');

    card.style.willChange = 'transform';

    expect(card.style.willChange).toBe('transform');
  });

  it('stops listening when the surface unmounts', () => {
    const view = render(<Harness />);
    const card = view.getByTestId('card');
    const root = view.getByTestId('root');
    view.unmount();

    // The node is detached but still reachable; a listener that survived the
    // unmount would still fire on it.
    root.append(card);
    card.style.willChange = 'transform';
    fire(card, 'animationend');

    expect(card.style.willChange).toBe('transform');
  });
});
