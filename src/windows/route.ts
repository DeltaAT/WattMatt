/**
 * Which of the two windows this WebView is (docs/ARCHITECTURE.md §2).
 *
 * Both windows are the same bundle, told apart by `?window=`. Rust sets the
 * query string when it builds each window; nothing in the frontend may change
 * it at runtime, because a window that silently became the other one would take
 * a beamer scene onto the laptop screen mid-event.
 */
export type WindowRoute = 'host' | 'beamer' | 'tokens';

/** The window a bare URL means. */
const DEFAULT_ROUTE: WindowRoute = 'host';

/**
 * The `/tokens` review page is a developer tool from issue #3 and is dropped
 * from release builds together with the whole `src/dev` tree.
 */
const DEV_ONLY_ROUTES: ReadonlySet<WindowRoute> = new Set<WindowRoute>(['tokens']);

function isWindowRoute(value: string | null): value is WindowRoute {
  return value === 'host' || value === 'beamer' || value === 'tokens';
}

/**
 * Resolves the route from a location.
 *
 * An unknown or missing `?window=` resolves to the host rather than throwing:
 * the failure mode of a wrong guess is a host window where a beamer was meant,
 * which the host can see and fix. Throwing would be a white screen.
 *
 * @param location the window location to read `search` and `pathname` from
 * @param isDev whether dev-only routes are reachable at all
 */
export function resolveWindowRoute(
  location: Pick<Location, 'pathname' | 'search'>,
  isDev: boolean,
): WindowRoute {
  const requested = new URLSearchParams(location.search).get('window');
  const route: WindowRoute = isWindowRoute(requested)
    ? requested
    : location.pathname === '/tokens'
      ? 'tokens'
      : DEFAULT_ROUTE;

  return DEV_ONLY_ROUTES.has(route) && !isDev ? DEFAULT_ROUTE : route;
}
