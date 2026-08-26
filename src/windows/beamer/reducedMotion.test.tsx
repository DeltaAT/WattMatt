// @vitest-environment jsdom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prefersReducedMotion, useReducedMotion } from '@/windows/beamer/reducedMotion';

/**
 * `prefers-reduced-motion` (issue #29, docs/MOTION.md §6).
 *
 * Two things are worth pinning. The default, because getting it wrong the safe
 * way — assuming "reduce" where nothing was asked — would silently strip the
 * motion out of a draw in front of an audience. And the *live* update, because
 * the beamer window is the one nobody can reach to reload: a value read once at
 * mount is a value that can be wrong for the rest of the evening.
 */

/** jsdom has no `matchMedia`. This is the smallest one that can change. */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initial;

  const media = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
  };

  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media),
  );

  return {
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('prefersReducedMotion', () => {
  it('is false where there is no matchMedia at all', () => {
    // jsdom and a server render both land here. Nobody has asked for anything,
    // so the beamer animates.
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reports what the media query says', () => {
    installMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('useReducedMotion', () => {
  it('starts from the setting as it stands', () => {
    installMatchMedia(true);
    expect(renderHook(() => useReducedMotion()).result.current).toBe(true);
  });

  it('follows the setting changing while the window is open', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    act(() => media.set(true));
    expect(result.current).toBe(true);

    // And back again: the setting is not one-way, and a scene that stayed calm
    // for the rest of the event would be a bug the host cannot undo.
    act(() => media.set(false));
    expect(result.current).toBe(false);
  });

  it('unsubscribes when the component goes', () => {
    const media = installMatchMedia(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(media.listenerCount).toBe(1);

    unmount();

    expect(media.listenerCount).toBe(0);
  });

  it('survives a window with no matchMedia', () => {
    expect(renderHook(() => useReducedMotion()).result.current).toBe(false);
  });
});
