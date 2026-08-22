import { de } from '@/i18n';

/**
 * Placeholder shell. The real dual-window routing (`?window=host` /
 * `?window=beamer`, see ARCHITECTURE.md §2) arrives with issue #4.
 */
export function App() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-2">
      <h1 className="text-2xl font-semibold">{de.app.name}</h1>
      <p className="text-sm">{de.app.bootstrapNotice}</p>
    </main>
  );
}
