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

  it('contains only non-empty strings and interpolation functions', () => {
    const entries = flatten(deAT);
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, value] of entries) {
      if (typeof value !== 'string') {
        continue;
      }
      expect(value.trim(), path).not.toBe('');
    }
  });

  it('is strings or functions all the way down', () => {
    for (const [path, value] of flatten(deAT)) {
      expect(['string', 'function'], path).toContain(typeof value);
    }
  });

  it('states what happened and what to do next in every error message', () => {
    for (const [path, value] of flatten(deAT.error, 'error')) {
      const sentences = String(value)
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => sentence.trim() !== '');
      expect(sentences.length, `${path}: "${String(value)}"`).toBeGreaterThanOrEqual(2);
    }
  });

  /*
   * A decomposed "ä" (a + U+0308) looks identical in an editor but is two code
   * points, and the bundled subset fonts carry no combining marks — it reaches
   * the projector as a broken glyph. NFC keeps every umlaut a single character.
   */
  it('keeps umlauts and ß as precomposed single characters (NFC)', () => {
    for (const [path, value] of flatten(deAT)) {
      if (typeof value !== 'string') {
        continue;
      }
      expect(value, path).not.toMatch(/[\u0300-\u036F]/u);
      expect(value.normalize('NFC'), path).toBe(value);
    }
  });

  it('never carries an English loanword flagged in docs/GLOSSARY.md', () => {
    // "Bracket", "Round" and co. are the English *code* terms — the German UI
    // copy must not leak them (docs/GLOSSARY.md "UI copy conventions").
    const banned = ['Match starten', 'Bracket anzeigen', 'Host'];
    for (const [path, value] of flatten(deAT)) {
      if (typeof value !== 'string') {
        continue;
      }
      for (const word of banned) {
        expect(value, `${path}: "${value}"`).not.toContain(word);
      }
    }
  });
});

/** Every leaf of the locale, as `[dotted.path, value]`. */
function flatten(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node === 'string' || typeof node === 'function') {
    return [[prefix, node]];
  }
  if (node === null || typeof node !== 'object') {
    // Reported by the caller with its path rather than thrown here.
    return [[prefix, node]];
  }
  return Object.entries(node).flatMap(([key, child]) =>
    flatten(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}
