import { useEffect, useState } from 'react';

/**
 * Reads custom properties off the document root after mount.
 *
 * The `/tokens` page shows the value a browser actually computed rather than a
 * value copied into TypeScript. That is the whole point of the page: a token
 * that silently failed to reach the stylesheet shows up as an empty swatch
 * instead of looking correct.
 */
export function useResolvedTokens(names: readonly string[]): ReadonlyMap<string, string> {
  const [resolved, setResolved] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setResolved(new Map(names.map((name) => [name, computed.getPropertyValue(name).trim()])));
  }, [names]);

  return resolved;
}
