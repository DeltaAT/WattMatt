// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useSkipSignal } from '@/windows/beamer/useSkipSignal';

/**
 * The host's skip, arriving from the other window (issue #28,
 * docs/OPEN-QUESTIONS.md #53).
 *
 * The whole point of a counter rather than a message is what these check: it
 * fires exactly once per press, never on arrival, and never for a snapshot the
 * channel re-delivered.
 */

afterEach(cleanup);

function mounted(skip: () => void, token = 0, enabled = true) {
  return renderHook(
    ({ skipToken, isEnabled }: { skipToken: number; isEnabled: boolean }) => {
      useSkipSignal(skipToken, skip, isEnabled);
    },
    { initialProps: { skipToken: token, isEnabled: enabled } },
  );
}

describe('the skip signal', () => {
  it('skips when the number the beamer is holding changes', () => {
    const skip = vi.fn();
    const { rerender } = mounted(skip);

    rerender({ skipToken: 1, isEnabled: true });

    expect(skip).toHaveBeenCalledTimes(1);
  });

  /*
   * A beamer reopened after five skips must not fire five of them. The first
   * token a window sees is simply where the host had got to.
   */
  it('does not fire for whatever the host had reached when it mounted', () => {
    const skip = vi.fn();
    mounted(skip, 5);

    expect(skip).not.toHaveBeenCalled();
  });

  /*
   * The channel re-delivers the same revision routinely — a catch-up request,
   * React mounting the beamer twice under StrictMode.
   */
  it('does nothing for a re-delivered picture carrying the same number', () => {
    const skip = vi.fn();
    const { rerender } = mounted(skip, 3);

    rerender({ skipToken: 3, isEnabled: true });
    rerender({ skipToken: 3, isEnabled: true });

    expect(skip).not.toHaveBeenCalled();
  });

  it('swallows a skip that arrives with nothing left to skip', () => {
    const skip = vi.fn();
    const { rerender } = mounted(skip, 0, false);

    rerender({ skipToken: 1, isEnabled: false });

    expect(skip).not.toHaveBeenCalled();

    // And is not remembered: the sequence that starts afterwards is not
    // skipped by a press the host aimed at the one before it.
    rerender({ skipToken: 1, isEnabled: true });
    expect(skip).not.toHaveBeenCalled();
  });

  it('fires once per press when several arrive in a row', () => {
    const skip = vi.fn();
    const { rerender } = mounted(skip);

    rerender({ skipToken: 1, isEnabled: true });
    rerender({ skipToken: 2, isEnabled: true });

    expect(skip).toHaveBeenCalledTimes(2);
  });
});
