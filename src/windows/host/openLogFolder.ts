import { openLogDirectory } from '@/platform/log';
import { reportProblem } from '@/store/problems';

/**
 * The "Protokoll öffnen" button, as a call (issue #30).
 *
 * Fire and forget, and never throwing: it is reached from a click handler in a
 * healthy window and from the fallback of a window that has already failed, and
 * the second of those must not be able to fail again.
 *
 * A refusal becomes a toast rather than silence. A button that does nothing at
 * all is the exact failure this issue exists to remove, and `logUnavailable`
 * carries the folder path — which is the answer the host actually needed.
 */
export function openLogFolder(): void {
  void openLogDirectory().catch((error: unknown) => {
    reportProblem('logUnavailable', 'log.open-failed', error);
  });
}
