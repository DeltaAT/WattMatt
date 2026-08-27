import { readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The animation review checklist of docs/MOTION.md §7, as a build gate
 * (issue #29).
 *
 * Four of its boxes are objective — `transition: all`, `ease-in` on an enter,
 * a `scale(0)` start, and animating a property that costs layout — and every
 * one of them is a thing somebody adds in thirty seconds during a fast UI
 * change and nobody notices again. A checklist a human ticks is exactly the
 * wrong instrument for those: the reviewer is the person who just wrote the
 * rule they are checking. So they are checked here instead, and the boxes that
 * genuinely need eyes — "does this animation have a purpose", "reviewed at 4×
 * slow motion" — stay with the reviewer, where they belong.
 *
 * The stylesheets are read as text on purpose. Tailwind's output is not
 * available to a unit test, and the rules that matter are hand-written CSS in
 * the two files below plus utility classes in components.
 */

const REPO_ROOT = process.cwd();
const STYLESHEETS = ['src/styles/global.css', 'src/styles/tokens.css'] as const;

/** Every non-test source file that can put motion on screen. */
function sources(directory: string): string[] {
  const collected: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })) {
    const child = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      collected.push(...sources(child));
    } else if (/\.(css|tsx?)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      collected.push(child);
    }
  }
  return collected;
}

const SOURCES = sources('src');

/** CSS with comments stripped: every rule below reasons about declarations. */
function code(file: string): string {
  return readFileSync(join(REPO_ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** `file: match` for every hit of `pattern` across `files`. */
function offenders(files: readonly string[], pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const match of code(file).matchAll(pattern)) {
      found.push(`${file}: ${match[0].replace(/\s+/g, ' ').trim()}`);
    }
  }
  return found;
}

describe('the checklist scans the files it claims to scan', () => {
  it('covers both stylesheets and every beamer scene', () => {
    // A silently empty file list would make every assertion below vacuous.
    expect(SOURCES).toContain('src/styles/global.css');
    expect(SOURCES).toContain('src/windows/beamer/scenes/DrawScene.tsx');
    expect(SOURCES).toContain('src/windows/beamer/scenes/BracketScene.tsx');
    expect(SOURCES.length).toBeGreaterThan(50);
  });
});

describe('docs/MOTION.md §7: no `transition: all`', () => {
  it('finds no `transition: all` in the stylesheets', () => {
    // `all` transitions whatever happens to change, including the layout
    // properties §1 law 3 bans and the ones nobody thought about.
    expect(offenders(STYLESHEETS, /transition(?:-property)?\s*:\s*all\b/gi)).toEqual([]);
  });

  it('finds no `transition-all` utility in a component', () => {
    expect(offenders(SOURCES, /\btransition-all\b/g)).toEqual([]);
  });
});

describe('docs/MOTION.md §1 law 3: only transform, opacity and filter animate', () => {
  /**
   * "Never animate `width`, `height`, `top`, `left`, `margin` or `box-shadow`
   * on the beamer." Layout animation at 1080p on an integrated GPU drops
   * frames, and the audience sees every dropped frame.
   */
  const BANNED = ['width', 'height', 'top', 'left', 'margin', 'box-shadow'] as const;

  it('names no banned property in a `transition` declaration', () => {
    for (const property of BANNED) {
      const pattern = new RegExp(`transition(?:-property)?\\s*:[^;]*\\b${property}\\b`, 'gi');
      expect(offenders(STYLESHEETS, pattern), `transition of ${property}`).toEqual([]);
    }
  });

  it('sets no banned property inside a keyframe', () => {
    // A keyframe that mentions a property *is* animating it, whatever the
    // values are — the browser interpolates between them either way.
    const keyframes = /@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/gi;
    const blocks = STYLESHEETS.flatMap((file) =>
      [...code(file).matchAll(keyframes)].map((match) => [file, match[0]] as const),
    );
    expect(blocks.length).toBeGreaterThan(8);

    const found: string[] = [];
    for (const [file, block] of blocks) {
      for (const property of BANNED) {
        // `margin` also matches `margin-left`; `top` must not match
        // `stroke-dashoffset`, so a property is only a hit at the start of a
        // declaration.
        if (new RegExp(`(?:^|[{;\\s])${property}[a-z-]*\\s*:`, 'i').test(block)) {
          found.push(`${file}: ${block.slice(0, block.indexOf('{'))} sets ${property}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('animates a beamer utility only through transform, opacity, filter or a ring', () => {
    // The positive form of the same rule: whatever a `wm-*` keyframe touches
    // has to be on this list. `stroke-dashoffset` is the bracket connector
    // drawing itself in (§4.4) — a paint on an SVG path, not a layout.
    const ALLOWED = new Set([
      'transform',
      'opacity',
      'filter',
      'background-color',
      // Paint-only, exactly like `background-color`: a colour change on a
      // border of fixed width triggers no layout (issue #77). `border-width`
      // would, and is not on this list.
      'border-color',
      'stroke-dashoffset',
      'stroke-dasharray',
    ]);

    const keyframes = /@keyframes\s+(wm-[a-z0-9-]+)[^{]*\{((?:[^{}]*\{[^{}]*\}\s*)*)\}/gi;
    const found: string[] = [];
    for (const file of STYLESHEETS) {
      for (const [, name, body] of code(file).matchAll(keyframes)) {
        for (const [, property] of (body ?? '').matchAll(/(?:^|[{;\s])([a-z-]+)\s*:/g)) {
          if (property !== undefined && !ALLOWED.has(property)) {
            found.push(`${file}: @keyframes ${String(name)} animates ${property}`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe('docs/MOTION.md §3: no `ease-in` on anything entering', () => {
  it('uses no bare `ease-in` easing anywhere', () => {
    // "It delays the first movement — precisely the moment the eye is watching."
    // `--ease-in-out` and `--ease-instant` are different tokens and must not
    // trip the check, so the match ends at a word boundary that is not `-`.
    expect(offenders(STYLESHEETS, /\bease-in(?![-a-z])/g)).toEqual([]);
  });

  it('uses no `ease-in` utility on a beamer element', () => {
    const beamer = SOURCES.filter((file) => file.startsWith('src/windows/beamer/'));
    expect(beamer.length).toBeGreaterThan(10);
    expect(offenders(beamer, /\bease-in(?![-a-z])/g)).toEqual([]);
  });
});

describe('docs/MOTION.md §3: nothing animates from `scale(0)`', () => {
  it('starts every scale at 0.9 or above', () => {
    // "Nothing in the physical world appears out of nothing."
    const found: string[] = [];
    for (const file of STYLESHEETS) {
      for (const [whole, value] of code(file).matchAll(
        /scale\(\s*(0?\.\d+|0|\d+(?:\.\d+)?)\s*\)/g,
      )) {
        if (value !== undefined && Number(value) < 0.9) {
          found.push(`${file}: ${whole}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

describe('docs/MOTION.md §6: `will-change` only during an animation', () => {
  it('hints only on classes whose animation is guaranteed to end', () => {
    // A `will-change` in a class outlives the animation that needed it, so the
    // hint is only acceptable where something takes it off again — which is
    // `useWillChangeCleanup`, on the `animationend` a finite keyframe reaches.
    // An infinite animation or a transition class never gets there, and a hint
    // on one of those is a promoted layer for the rest of the evening.
    const css = code('src/styles/global.css');
    const rules = /(@utility\s+[a-z0-9-]+|\.[a-z0-9_.:-]+(?:::[a-z-]+)?)\s*\{([^{}]*)\}/gi;

    const hinted: string[] = [];
    for (const [, selector, body] of css.matchAll(rules)) {
      if (body !== undefined && /will-change\s*:/.test(body) && selector !== undefined) {
        expect(body, `${selector} hints will-change without an animation`).toMatch(/animation:/);
        expect(body, `${selector} hints will-change on an infinite animation`).not.toMatch(
          /infinite/,
        );
        hinted.push(selector.trim());
      }
    }

    // The two reveals of §4.1 and §4.3, the welcome count's tick of §4.7, and
    // nothing else. `wm-bracket-advance` deliberately carries no hint: every
    // slot in the tree wears it.
    expect(hinted.sort()).toEqual([
      '@utility wm-count-pulse',
      '@utility wm-draw-reveal',
      '@utility wm-repechage-lift',
    ]);
  });

  it('leaves the beamer with no `will-change` a component sets and forgets', () => {
    // The one place JavaScript sets the hint is `useBracketAdvance`, which sets
    // it on the chip it is about to move; `useWillChangeCleanup` is what takes
    // it off. Anything else writing the property is a leak by construction.
    const setters = offenders(SOURCES, /willChange\s*=/g).map((entry) => entry.split(':')[0]);
    expect([...new Set(setters)].sort()).toEqual([
      'src/windows/beamer/useBracketAdvance.ts',
      'src/windows/beamer/useWillChangeCleanup.ts',
    ]);
  });
});

describe('docs/MOTION.md §6: performance mode switches off what it says it does', () => {
  const performanceBlock =
    /\.beamer-root\[data-performance-mode='true'\]\s*\{([^}]*)\}/.exec(
      code('src/styles/global.css'),
    )?.[1] ?? '';

  it('halves every duration and removes every stagger', () => {
    expect(performanceBlock).not.toBe('');
    const declared = new Map(
      [...performanceBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(([, name, value]) => [
        name ?? '',
        (value ?? '').trim(),
      ]),
    );

    const base = code('src/styles/tokens.css');
    for (const [, name, value] of base.matchAll(/(--(?:dur|stagger)-[a-z]+)\s*:\s*(\d+)ms/gi)) {
      // `--dur-blackout` is the one duration that must not shrink: §4.6 names
      // 200 ms as the feel of the control itself, and the host pressing it
      // wants the room dark, not the fade cheaper.
      if (name === '--dur-blackout') {
        expect(declared.has(name)).toBe(false);
        continue;
      }

      const reduced = declared.get(name ?? '');
      expect(reduced, `${String(name)} is not redefined in performance mode`).toBeDefined();
      // §6: "durations × 0.5, [...] no stagger". A stagger that was merely
      // halved would still deal a 64-card board out over two and a half
      // seconds on the machine that could least afford it.
      const expected = name?.startsWith('--stagger') ? 0 : Math.round(Number(value) / 2);
      expect(`${String(name)}: ${String(reduced)}`).toBe(`${String(name)}: ${String(expected)}ms`);
    }
  });

  it('removes the glow and the blur', () => {
    expect(performanceBlock).toMatch(/--wm-fx-glow-spread\s*:\s*0px/);
    expect(performanceBlock).toMatch(/--wm-fx-blur\s*:\s*0px/);
  });

  it('changes no property that could move a box', () => {
    // "Performance mode is visibly faster and never breaks a layout" — the
    // issue's third acceptance criterion. It holds by construction as long as
    // the block only ever redefines custom properties.
    const declarations = [...performanceBlock.matchAll(/([a-z-]+)\s*:/gi)].map(
      ([, property]) => property ?? '',
    );
    expect(declarations.length).toBeGreaterThan(8);
    expect(declarations.filter((property) => !property.startsWith('--'))).toEqual([]);
  });
});

describe('docs/MOTION.md §6: reduced motion is answered for every beamer animation', () => {
  it('overrides every finite `wm-` animation utility the beamer uses', () => {
    // §6 keeps opacity and colour and drops movement. An animation with no
    // answer under `prefers-reduced-motion` is one that keeps moving for a
    // viewer who asked it not to — so the check is that every utility carrying
    // a transform is *named* somewhere inside a reduced-motion block, whether
    // by redefining its keyframes or by switching it off.
    const css = code('src/styles/global.css');

    const reducedBlocks = [
      ...css.matchAll(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/g),
    ].map((match) => match[1] ?? '');
    expect(reducedBlocks.length).toBeGreaterThan(3);
    const reduced = reducedBlocks.join('\n');

    // Which keyframes actually move something.
    const moving = new Set<string>();
    for (const [, name, body] of css.matchAll(
      /@keyframes\s+(wm-[a-z0-9-]+)[^{]*\{((?:[^{}]*\{[^{}]*\}\s*)*)\}/gi,
    )) {
      if (name !== undefined && /transform\s*:\s*(?!none)/.test(body ?? '')) {
        moving.add(name);
      }
    }
    expect(moving.size).toBeGreaterThan(3);

    // An answer can take either shape, and both are in the file already: the
    // keyframes are redefined under the media query (the draw's reveal), or the
    // rule that runs them is (the result tick's `animation: none`). So a
    // keyframe counts as answered when it, or a selector that plays it, is
    // named inside a reduced-motion block.
    const players = new Map<string, string[]>();
    for (const [, selector, body] of css.matchAll(
      /(@utility\s+[a-z0-9-]+|\.[a-z0-9_.:[\]=-]+(?:\s+\[[a-z-]+\])?)\s*\{([^{}]*)\}/gi,
    )) {
      const played = /animation:\s*(wm-[a-z0-9-]+)/.exec(body ?? '')?.[1];
      if (played !== undefined && selector !== undefined) {
        players.set(played, [...(players.get(played) ?? []), selector.trim()]);
      }
    }

    const unanswered = [...moving].filter(
      (name) =>
        !reduced.includes(name) &&
        !(players.get(name) ?? []).some((selector) => reduced.includes(selector)),
    );
    expect(unanswered).toEqual([]);
  });

  it('answers the motions JavaScript owns', () => {
    // The draw's pace (#18, retimed by #76), the bracket FLIP (#25) and the
    // repechage's travelling highlight (#89) are not keyframes and no media
    // query can reach them, so they read the setting themselves. Two of the
    // three are `setTimeout` intervals and live in the hook that owns the
    // timers, not in the scene that owns the picture.
    for (const file of [
      'src/windows/beamer/useDrawSequence.ts',
      'src/windows/beamer/useBracketAdvance.ts',
      'src/windows/beamer/useRepechageTravel.ts',
    ]) {
      expect(code(file), `${file} ignores prefers-reduced-motion`).toMatch(/useReducedMotion/);
    }
  });
});
