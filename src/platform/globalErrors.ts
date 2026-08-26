import { reportProblem } from '@/store/problems';

/**
 * The net under everything React's boundaries cannot see (issue #30).
 *
 * An error boundary catches exceptions thrown while *rendering*. It does not
 * catch a click handler that threw, a promise nobody awaited, a timer callback,
 * or an event listener — and during a live event those are most of the code
 * that runs. Without these two listeners such a failure reaches the console and
 * stops there: the host clicks *Ergebnis eintragen*, nothing happens, and
 * nothing anywhere says why.
 *
 * Both are registered on `window`, once per window, from `main.tsx`. They
 * report rather than swallow: the default behaviour — the console, and for a
 * rejection a warning nobody sees — is left in place, so `pnpm tauri dev` still
 * shows exactly what it always did.
 */

/**
 * Registers the handlers and returns the call that removes them again.
 *
 * The return value exists for the tests. Nothing in the app removes them: they
 * are meant to outlive every component in the window, which is the whole point.
 */
export function installGlobalErrorHandlers(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    // `event.error` is the thrown value and carries the stack; `event.message`
    // is all that survives a cross-origin script, which in an offline app with
    // an inlined bundle should never happen — but "should never" is not a
    // reason to log nothing.
    reportProblem('unexpected', 'window.error', event.error ?? event.message);
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    reportProblem('unexpected', 'window.unhandled-rejection', event.reason);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
