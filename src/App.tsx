import { TokensPage } from '@/dev/TokensPage';
import { BeamerWindow } from '@/windows/beamer';
import { HostWindow } from '@/windows/host';
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

export function App() {
  if (import.meta.env.DEV && route === 'tokens') {
    return <TokensPage />;
  }

  if (route === 'beamer') {
    return <BeamerWindow />;
  }

  return <HostWindow />;
}
