import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * These tests run the *real* eslint.config.js rather than a hand-built rule
 * harness. The acceptance criteria of issue #2 are about what CI does to a
 * pull request, so file scoping — which rule applies to which directory — is
 * part of what has to be verified, not an implementation detail.
 */

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {ESLint} */
let eslint;

beforeAll(() => {
  eslint = new ESLint({
    cwd: projectRoot,
    overrideConfigFile: fileURLToPath(new URL('../../eslint.config.js', import.meta.url)),
  });
});

/**
 * @param {string} filePath repo-relative path the snippet pretends to live at
 * @param {string} code
 * @returns {Promise<string[]>} rule ids of every reported error
 */
async function lint(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? [])
    .filter((message) => message.severity === 2)
    .map((message) => message.ruleId ?? 'fatal');
}

describe('hardcoded German strings', () => {
  it('rejects German text rendered as JSX children in a component', async () => {
    const rules = await lint(
      'src/windows/host/RoundPanel.tsx',
      'export function RoundPanel() {\n  return <div>Runde läuft</div>;\n}\n',
    );
    expect(rules).toContain('wattmatt/no-hardcoded-german');
  });

  it('rejects text rendered as JSX children even without German characters', async () => {
    // "Sieger" carries no umlaut. Inline UI text is a finding regardless of
    // language, which is what keeps the rule from depending on a word list.
    const rules = await lint(
      'src/windows/beamer/scenes/Result.tsx',
      'export function Result() {\n  return <p>Sieger</p>;\n}\n',
    );
    expect(rules).toContain('wattmatt/no-hardcoded-german');
  });

  it('rejects a German string literal in a non-component source file', async () => {
    const rules = await lint(
      'src/store/actions/markWinner.ts',
      "export const message = 'Ungültige Auswahl';\n",
    );
    expect(rules).toContain('wattmatt/no-hardcoded-german');
  });

  it('rejects German in a user-visible JSX attribute', async () => {
    const rules = await lint(
      'src/ui/Button.tsx',
      'export function Button() {\n  return <button title="Partie beenden" />;\n}\n',
    );
    expect(rules).toContain('wattmatt/no-hardcoded-german');
  });

  it('allows German inside the locale file itself', async () => {
    const rules = await lint(
      'src/i18n/de-AT.ts',
      "export const deAT = { round: 'Runde läuft' } as const;\n",
    );
    expect(rules).not.toContain('wattmatt/no-hardcoded-german');
  });

  it('allows a component that takes its text from the locale', async () => {
    const rules = await lint(
      'src/windows/host/RoundPanel.tsx',
      "import { de } from '@/i18n';\n\nexport function RoundPanel() {\n  return <div>{de.app.name}</div>;\n}\n",
    );
    expect(rules).not.toContain('wattmatt/no-hardcoded-german');
  });

  it('does not flag className and other non-visible attributes', async () => {
    const rules = await lint(
      'src/ui/Card.tsx',
      'export function Card() {\n  return <div className="flex items-center" data-testid="card" />;\n}\n',
    );
    expect(rules).not.toContain('wattmatt/no-hardcoded-german');
  });
});

describe('domain purity', () => {
  it('rejects Math.random() in src/domain', async () => {
    const rules = await lint(
      'src/domain/draw.ts',
      'export function pick() {\n  return Math.random();\n}\n',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rejects Date.now() in src/domain', async () => {
    const rules = await lint(
      'src/domain/progression.ts',
      'export function stamp() {\n  return Date.now();\n}\n',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rejects new Date() in src/domain', async () => {
    const rules = await lint(
      'src/domain/progression.ts',
      'export function stamp() {\n  return new Date();\n}\n',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rejects Math.random() outside src/domain too (golden rule 7)', async () => {
    const rules = await lint(
      'src/store/actions/draw.ts',
      'export function seed() {\n  return Math.random();\n}\n',
    );
    expect(rules).toContain('no-restricted-syntax');
  });

  it('allows an injected clock and rng', async () => {
    const rules = await lint(
      'src/domain/draw.ts',
      'interface Rng {\n  next(): number;\n}\n\nexport function pick(rng: Rng) {\n  return rng.next();\n}\n',
    );
    expect(rules).not.toContain('no-restricted-syntax');
  });
});

describe('code conventions', () => {
  it('rejects a default export', async () => {
    const rules = await lint('src/ui/Chip.ts', 'const chip = 1;\nexport default chip;\n');
    expect(rules).toContain('no-restricted-syntax');
  });

  it('rejects explicit any', async () => {
    const rules = await lint('src/store/state.ts', 'export const value: any = 1;\n');
    expect(rules).toContain('@typescript-eslint/no-explicit-any');
  });
});
