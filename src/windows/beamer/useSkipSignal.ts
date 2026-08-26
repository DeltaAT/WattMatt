import { useEffect, useRef } from 'react';

/**
 * The host's `Space`, arriving from the other window (issue #28).
 *
 * `useSkipKey` only fires while the *beamer* window has focus, and with two
 * screens the host is typing on the laptop — so on a live stage the skip that
 * docs/MOTION.md §1 law 2 promises never happened (docs/OPEN-QUESTIONS.md #53).
 * This is the other half: the host bumps `skipToken` in the picture, and the
 * beamer skips when the number it is holding changes.
 *
 * A number rather than a message is what makes this safe. The first token a
 * window sees is whatever the host was on when it mounted, so a beamer reopened
 * after five skips does not fire five of them — and a re-delivered snapshot,
 * which the channel does routinely, carries the same number and does nothing.
 */
export function useSkipSignal(skipToken: number, skip: () => void, enabled: boolean): void {
  // Read through a ref rather than captured: `skip` changes identity whenever
  // the sequence advances, and re-arming this effect on it would compare the
  // token against itself and swallow a skip that arrived in the same frame.
  const latest = useRef(skip);
  latest.current = skip;

  /** The token this window started from. Null until the first render. */
  const seen = useRef<number | null>(null);

  useEffect(() => {
    if (seen.current === null) {
      seen.current = skipToken;
      return;
    }
    if (seen.current === skipToken) {
      return;
    }
    seen.current = skipToken;
    if (enabled) {
      latest.current();
    }
  }, [skipToken, enabled]);
}
