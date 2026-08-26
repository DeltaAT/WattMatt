import { TokensPage } from '@/dev/TokensPage';
import { setLogSource } from '@/platform/log';
import { reportProblem } from '@/store/problems';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { BeamerWindow } from '@/windows/beamer';
import { HostErrorFallback, HostWindow, openLogFolder } from '@/windows/host';
import { resolveWindowRoute } from '@/windows/route';

/**
 * Picks the window this WebView is (docs/ARCHITECTURE.md §2).
 *
 * The route is read once, at module scope: both windows are created by Rust
 * with their query string already set, and a window that changed identity
 * mid-session would be a beamer scene appearing on the laptop screen.
 *
 * Vite substitutes a literal `false` for `import.meta.env.DEV` in a release
 * build, so the token page branch — and with it the whole `src/dev` tree — is
 * dropped from the bundle rather than merely being unreachable.
 */
const route = resolveWindowRoute(window.location, import.meta.env.DEV);

// Every log entry from this window says which window it came from, and the two
// of them share a file (src-tauri/src/logging.rs). Set here because this is the
// one place that knows the answer, and before the first render because a
// failure during it is exactly the entry worth attributing correctly.
setLogSource(route === 'beamer' ? 'beamer' : 'host');

/**
 * Each window gets an error boundary, and they are deliberately different
 * (issue #30).
 *
 * The host's is a screen with a way out, because the host can read it and act
 * on it. The beamer's is `--wm-bg` and nothing else, because fifty people are
 * looking at it: a message on the projector is a message the host spends the
 * next ten minutes being asked about, and a black screen is indistinguishable
 * from the blackout they already know.
 *
 * The scene-level boundary inside the beamer surface catches the common case
 * and keeps the letterbox and the holding picture (`SafeBeamerPicture`). This
 * outer one only ever fires if the surface itself failed, which is the case
 * where there is nothing left to keep.
 */
export function App() {
  if (import.meta.env.DEV && route === 'tokens') {
    return <TokensPage />;
  }

  if (route === 'beamer') {
    return (
      <ErrorBoundary
        onError={(error) => reportProblem('unexpected', 'beamer.window-failed', error)}
        fallback={() => <div className="h-full w-full bg-wm-bg" data-beamer-failure="" />}
      >
        <BeamerWindow />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary
      onError={(error) => reportProblem('unexpected', 'host.window-failed', error)}
      fallback={(retry) => <HostErrorFallback onRetry={retry} onOpenLog={openLogFolder} />}
    >
      <HostWindow />
    </ErrorBoundary>
  );
}
