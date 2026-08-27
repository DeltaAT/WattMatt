import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { hexContrastRatio } from '@/styles/contrast';

/**
 * Guards the token system itself.
 *
 * Three things are worth failing a build over:
 *   1. A token named in docs/STYLEGUIDE.md or docs/MOTION.md is missing from
 *      tokens.css, or drifted away from the value the document states. Those
 *      documents are normative (CLAUDE.md §9), so the test reads them rather
 *      than repeating their contents.
 *   2. A colour literal appears outside the token file — the acceptance
 *      criterion of issue #3 and docs/STYLEGUIDE.md §5.
 *   3. A contrast target from docs/STYLEGUIDE.md §1 is not met. A projector in
 *      a lit room is unforgiving and nobody can eyeball a 7:1 ratio.
 */

const REPO_ROOT = process.cwd();
const TOKENS_FILE = 'src/styles/tokens.css';

const tokensCss = readFileSync(join(REPO_ROOT, TOKENS_FILE), 'utf8');

/** Every `--name: value;` declaration in a string of CSS. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  const pattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (const match of css.matchAll(pattern)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      // Comments and line breaks inside a value are noise for comparison.
      const normalised = value
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      found.set(name.toLowerCase(), normalised);
    }
  }
  return found;
}

/** Declarations inside the fenced css blocks of a Markdown document. */
function documentedTokens(markdownPath: string): Map<string, string> {
  const markdown = readFileSync(join(REPO_ROOT, markdownPath), 'utf8');
  const fence = /^```css$([\s\S]*?)^```$/gm;
  const blocks = [...markdown.matchAll(fence)].map((match) => match[1] ?? '');
  return declarations(blocks.join('\n'));
}

const declaredTokens = declarations(tokensCss);

describe('tokens.css implements the normative documents', () => {
  const sources = [
    ['docs/STYLEGUIDE.md', documentedTokens('docs/STYLEGUIDE.md')],
    ['docs/MOTION.md', documentedTokens('docs/MOTION.md')],
  ] as const;

  for (const [source, documented] of sources) {
    it(`declares every token from ${source}`, () => {
      expect(documented.size).toBeGreaterThan(0);
      const missing = [...documented.keys()].filter((name) => !declaredTokens.has(name));
      expect(missing).toEqual([]);
    });

    it(`uses the exact values from ${source}`, () => {
      const drifted = [...documented].filter(([name, value]) => declaredTokens.get(name) !== value);
      expect(drifted).toEqual([]);
    });
  }

  // docs/STYLEGUIDE.md §3 states the radii in prose rather than in a fence, so
  // they cannot be extracted and are repeated here on purpose.
  it('declares the radius scale from docs/STYLEGUIDE.md §3', () => {
    expect(declaredTokens.get('--wm-radius-sm')).toBe('6px');
    expect(declaredTokens.get('--wm-radius-md')).toBe('10px');
    expect(declaredTokens.get('--wm-radius-lg')).toBe('16px');
    expect(declaredTokens.get('--wm-radius-xl')).toBe('24px');
  });

  it('declares the 8px spacing scale from docs/STYLEGUIDE.md §3', () => {
    // 4 8 12 16 24 32 48 64 96 px, expressed in rem against a 16px root.
    for (const px of [4, 8, 12, 16, 24, 32, 48, 64, 96]) {
      expect(declaredTokens.get(`--wm-space-${px}`)).toBe(`${px / 16}rem`);
    }
  });

  it('declares both type scales from docs/STYLEGUIDE.md §2', () => {
    // Beamer sizes are multiples of the resolution-relative unit, not rem:
    // rem resolves against <html> and would ignore `.beamer-root` entirely.
    const beamer = { hero: 10, h1: 6, h2: 4, h3: 3, body: 2, caption: 1.5 };
    for (const [name, multiple] of Object.entries(beamer)) {
      expect(declaredTokens.get(`--text-beamer-${name}`)).toBe(
        `calc(var(--wm-beamer-unit) * ${multiple})`,
      );
    }

    // Host scale: 12 / 14 / 16 / 20 / 24 / 32 px.
    const host = { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, '2xl': 32 };
    for (const [name, px] of Object.entries(host)) {
      expect(declaredTokens.get(`--text-host-${name}`)).toBe(`${px / 16}rem`);
    }
  });

  /*
   * The podium's geometry (issue #86, docs/STYLEGUIDE.md §4).
   *
   * "Fills the screen rather than sitting politely in the middle of it" is a
   * sentence about arithmetic, and this is the arithmetic: the stage is 120
   * units wide, the 4 % safe area takes 4.8 off each side, and what the three
   * columns and their two gaps come to has to land inside 110.4 without
   * stopping far short of it. A `max-w-5xl` and three `rem` blocks passed every
   * test in the repository while doing neither.
   */
  describe('the podium fills the stage it is drawn on', () => {
    /** The multiple of the beamer unit a geometry token is worth. */
    function units(name: string): number {
      const value = declaredTokens.get(name) ?? '';
      const found = /calc\(var\(--wm-beamer-unit\) \* ([\d.]+)\)/.exec(value)?.[1];
      expect(found, name).toBeDefined();
      return Number(found);
    }

    /** The stage inside the safe area, in beamer units. 4 % of 120, twice. */
    const USABLE_WIDTH = 120 - 2 * 4.8;

    it('reaches the safe area without crossing it', () => {
      const across =
        units('--wm-podium-width-gold') +
        units('--wm-podium-width-silver') +
        units('--wm-podium-width-bronze') +
        2 * units('--wm-podium-gap');

      expect(across).toBeLessThanOrEqual(USABLE_WIDTH);
      // And it is not a podium in the middle of a wall: nothing narrower than
      // nine tenths of the room it has is what the issue asked for.
      expect(across).toBeGreaterThan(USABLE_WIDTH * 0.9);
    });

    it('leaves the tallest column inside the safe area', () => {
      // 4 % padding resolves against the *width* in both axes, so the stage's
      // 67.5 units of height lose 4.8 twice as well.
      const usableHeight = 120 / (16 / 9) - 2 * 4.8;
      const tallest =
        units('--wm-podium-name-height') +
        units('--wm-podium-height-gold') +
        2 * units('--wm-podium-column-gap') +
        3; // the caption, one `beamer-h3` line

      expect(tallest).toBeLessThan(usableHeight);
    });

    it('makes gold clearly the tallest and the widest', () => {
      expect(units('--wm-podium-height-gold')).toBeGreaterThan(units('--wm-podium-height-silver'));
      expect(units('--wm-podium-height-silver')).toBeGreaterThan(
        units('--wm-podium-height-bronze'),
      );
      expect(units('--wm-podium-width-gold')).toBeGreaterThan(units('--wm-podium-width-silver'));
      expect(units('--wm-podium-width-silver')).toBe(units('--wm-podium-width-bronze'));
    });

    it('gives a name two full hero lines', () => {
      // The name box is what keeps the three blocks on one floor whether a name
      // takes one line or two, so it is exactly two lines of `beamer-hero`.
      expect(units('--wm-podium-name-height')).toBe(2 * 10);
    });

    it('scales the reveal travel with the blocks (docs/MOTION.md §4.5)', () => {
      // §4.5 named 40 px against a podium 2.4× smaller than this one. The
      // travel is a unit multiple for the same reason the sizes are, and it is
      // more than the 2.5 units the 40 px was.
      expect(units('--wm-podium-travel')).toBeGreaterThan(2.5);
    });
  });

  it('scales the beamer root with the 16:9 stage (docs/STYLEGUIDE.md §2)', () => {
    const globalCss = readFileSync(join(REPO_ROOT, 'src/styles/global.css'), 'utf8');
    const beamerRoot = /\.beamer-root\s*\{([\s\S]*?)\}/.exec(globalCss)?.[1] ?? '';
    expect(beamerRoot.replace(/\s+/g, '')).toContain('font-size:var(--wm-beamer-unit)');

    // The unit follows the letterboxed stage, not the raw viewport: on a
    // projector that is not 16:9 the two differ, and type sized to the
    // viewport would overrun the stage it is drawn into (§3, issue #4).
    expect(declaredTokens.get('--wm-beamer-stage-width')).toBe('min(100vw, calc(100vh * 16 / 9))');
    expect(declaredTokens.get('--wm-beamer-unit')).toBe('calc(var(--wm-beamer-stage-width) / 120)');
  });
});

describe('colour literals live only in the token file', () => {
  /** Files that can put a colour on screen. Tests carry colour fixtures on purpose. */
  function renderingSources(directory: string): string[] {
    const collected: string[] = [];
    for (const entry of readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })) {
      const child = posix.join(directory, entry.name);
      if (entry.isDirectory()) {
        collected.push(...renderingSources(child));
      } else if (/\.(css|tsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        collected.push(child);
      }
    }
    return collected;
  }

  // `#0f0`, `#0e1116`, `#0e1116ff` — but not `#root`, which is a selector.
  const HEX_COLOUR = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;

  it('finds no hex colour outside src/styles/tokens.css', () => {
    const offenders: string[] = [];
    for (const file of [...renderingSources('src'), 'index.html']) {
      if (file === TOKENS_FILE) {
        continue;
      }
      const contents = readFileSync(join(REPO_ROOT, file), 'utf8');
      for (const match of contents.matchAll(HEX_COLOUR)) {
        offenders.push(`${file}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans the files it claims to scan', () => {
    // A silently empty file list would make the assertion above meaningless.
    const scanned = renderingSources('src').map((file) =>
      relative('src', file).split(sep).join('/'),
    );
    expect(scanned).toContain('styles/global.css');
    expect(scanned).toContain('App.tsx');
    expect(scanned).not.toContain('styles/contrast.test.ts');
  });
});

describe('contrast targets from docs/STYLEGUIDE.md §1', () => {
  function token(name: string): string {
    const value = declaredTokens.get(name);
    expect(value, `token ${name} is not declared`).toBeDefined();
    return value ?? '';
  }

  function ratio(foreground: string, background: string): number {
    const value = hexContrastRatio(token(foreground), token(background));
    expect(value, `${foreground} on ${background} is not a pair of hex tokens`).toBeDefined();
    return value ?? 0;
  }

  const BEAMER_TEXT = 7;
  const HOST_BODY_TEXT = 4.5;

  it('clears 7:1 for beamer text on both beamer backgrounds', () => {
    expect(ratio('--wm-text', '--wm-bg')).toBeGreaterThanOrEqual(BEAMER_TEXT);
    expect(ratio('--wm-text', '--wm-surface')).toBeGreaterThanOrEqual(BEAMER_TEXT);
  });

  it('clears 7:1 for the status colours the beamer relies on', () => {
    expect(ratio('--wm-win', '--wm-bg')).toBeGreaterThanOrEqual(BEAMER_TEXT);
    expect(ratio('--wm-live', '--wm-bg')).toBeGreaterThanOrEqual(BEAMER_TEXT);
  });

  it('clears 4.5:1 for host body and muted text on both host surfaces', () => {
    for (const background of ['--wm-bg', '--wm-surface']) {
      expect(ratio('--wm-text', background)).toBeGreaterThanOrEqual(HOST_BODY_TEXT);
      expect(ratio('--wm-text-muted', background)).toBeGreaterThanOrEqual(HOST_BODY_TEXT);
    }
  });

  it('clears 4.5:1 for text on every status background', () => {
    for (const background of ['--wm-win-bg', '--wm-lose-bg', '--wm-live-bg', '--wm-accent-soft']) {
      expect(ratio('--wm-text', background)).toBeGreaterThanOrEqual(HOST_BODY_TEXT);
    }
  });

  it('clears 4.5:1 for the podium colours on the beamer background', () => {
    for (const podium of ['--wm-gold', '--wm-silver', '--wm-bronze']) {
      expect(ratio(podium, '--wm-bg')).toBeGreaterThanOrEqual(HOST_BODY_TEXT);
    }
  });
});
