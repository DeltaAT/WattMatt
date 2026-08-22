import { describe, expect, it } from 'vitest';

// Imported through the alias on purpose: this is what proves the `@/*` path
// mapping is wired identically in tsconfig, Vite and Vitest (issue #1).
import { de, deAT } from '@/i18n';

describe('de-AT locale seed', () => {
  it('is reachable through the @/ path alias', () => {
    expect(deAT).toBe(de);
  });

  it('exposes the product name unchanged', () => {
    expect(deAT.app.name).toBe('WattMatt');
  });

  it('contains only non-empty strings', () => {
    const entries = flatten(deAT);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, value] of entries) {
      expect(value.trim(), path).not.toBe('');
    }
  });

  /*
   * An empty or missing string reaches the audience as a blank line on the
   * projector, so the whole tree is walked rather than one group of it.
   */
  it('is nested strings all the way down', () => {
    for (const [path, value] of flatten(deAT)) {
      expect(typeof value, path).toBe('string');
    }
  });
});

/** Every leaf of the locale, as `[dotted.path, value]`. */
function flatten(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') {
    return [[prefix, node]];
  }
  if (node === null || typeof node !== 'object') {
    // Reported by the caller with its path rather than thrown here.
    return [[prefix, node as string]];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}
