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
    const values = Object.values(deAT.app);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value.trim()).not.toBe('');
    }
  });
});
