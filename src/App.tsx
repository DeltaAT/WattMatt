import { TokensPage } from '@/dev/TokensPage';
import { de } from '@/i18n';

function isTokensRoute(): boolean {
  const { pathname, search } = window.location;
  return pathname === '/tokens' || new URLSearchParams(search).get('window') === 'tokens';
}

/**
 * Placeholder shell. The real dual-window routing (`?window=host` /
 * `?window=beamer`, see ARCHITECTURE.md §2) arrives with issue #4.
 */
export function App() {
  // The token review page is a developer tool, reachable under `pnpm dev` at
  // `/tokens` (issue #3) or at `?window=tokens`, which is the routing shape the
  // real windows use. Vite substitutes a literal `false` for
  // `import.meta.env.DEV` in a release build, so the branch — and with it the
  // whole `src/dev` tree — is dropped from the bundle rather than merely being
  // unreachable.
  if (import.meta.env.DEV && isTokensRoute()) {
    return <TokensPage />;
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-2">
      <h1 className="text-host-2xl wm-display font-bold">{de.app.name}</h1>
      <p className="text-host-sm text-wm-text-muted">{de.app.bootstrapNotice}</p>
    </main>
  );
}
