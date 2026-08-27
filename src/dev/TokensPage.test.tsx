import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TokensPage } from '@/dev/TokensPage';

/**
 * The `/tokens` page is only useful if it actually shows every token — a review
 * page that quietly omits half the palette is worse than none, because it looks
 * complete. So this renders it and checks the token names against the CSS
 * rather than against a list copied out of the catalogue.
 *
 * Static rendering is enough here: `useResolvedTokens` reads the DOM inside an
 * effect, which does not run server-side, so the page has to survive its own
 * tokens being unresolved anyway (that is what an empty swatch looks like).
 */

const REPO_ROOT = process.cwd();
const tokensCss = readFileSync(join(REPO_ROOT, 'src/styles/tokens.css'), 'utf8');

/** Token names declared in the `:root` block, i.e. excluding the Tailwind mapping. */
function rootTokens(prefix: RegExp): string[] {
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? '';
  return [...root.matchAll(/(--[a-z0-9-]+)\s*:/gi)]
    .map((match) => match[1] ?? '')
    .filter((name) => prefix.test(name));
}

const markup = renderToStaticMarkup(<TokensPage />);

describe('the /tokens review page', () => {
  it('renders without a DOM', () => {
    expect(markup.length).toBeGreaterThan(1000);
  });

  it('lists every colour token', () => {
    // `--wm-fx-*` are lengths, not colours (issue #29): they belong to the
    // motion section below, which is where the page shows them. `--wm-podium-*`
    // are lengths too — the geometry of the `Siegerehrung` in beamer units
    // (issue #86) — and belong with the beamer geometry the page also leaves
    // out, because a swatch of a block width says nothing a reviewer can use.
    const colours = rootTokens(/^--wm-(?!space-|radius-|beamer-|font-|tracking-|fx-|podium-)/);
    expect(colours.length).toBe(22);
    expect(colours.filter((name) => !markup.includes(name))).toEqual([]);
  });

  it('lists every spacing and radius token', () => {
    const scales = rootTokens(/^--wm-(space|radius)-/);
    expect(scales.length).toBe(13);
    expect(scales.filter((name) => !markup.includes(name))).toEqual([]);
  });

  it('lists every motion token', () => {
    const motion = [
      ...rootTokens(/^--(dur|stagger)-/),
      // The effect lengths performance mode zeroes (issue #29).
      ...rootTokens(/^--wm-fx-/),
      ...['out', 'in-out', 'dramatic', 'exit'].map((name) => `--ease-${name}`),
    ];
    expect(motion.length).toBe(15);
    expect(motion.filter((name) => !markup.includes(name))).toEqual([]);
  });

  it('shows both type scales', () => {
    for (const size of ['hero', 'h1', 'h2', 'h3', 'body', 'caption']) {
      expect(markup).toContain(`text-beamer-${size}`);
    }
    for (const size of ['xs', 'sm', 'base', 'lg', 'xl', '2xl']) {
      expect(markup).toContain(`text-host-${size}`);
    }
  });

  it('renders the beamer samples inside a beamer root, at projected size', () => {
    expect(markup).toContain('beamer-root');
  });
});
