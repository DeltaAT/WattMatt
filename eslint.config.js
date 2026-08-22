import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { noHardcodedGerman } from './tools/eslint/no-hardcoded-german.js';

/**
 * The WattMatt-specific rules live at the bottom. They exist because the
 * conventions they guard are the ones that quietly rot: German strings drifting
 * into components, and impurity creeping into `src/domain`.
 */
const wattmatt = {
  rules: {
    'no-hardcoded-german': noHardcodedGerman,
  },
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'src-tauri/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,js}'],
    // Only the ordering rules are pulled in from import-x. Its recommended
    // preset also enables rules that need a module resolver, which would mean a
    // second opinion on the `@/` alias that tsc and Vite already agree on — and
    // a second thing to keep in sync. Unresolved imports fail typecheck anyway.
    plugins: { wattmatt, 'import-x': importX },
    rules: {
      // CLAUDE.md §6: no `any`, named exports only.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Named exports only (CLAUDE.md §6).',
        },
        {
          // Golden rule 7: randomness is seeded and logged, so any draw can be
          // reproduced and defended if a participant complains.
          selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
          message:
            'Math.random() is banned. Use the seeded RNG from @/domain/rng (CLAUDE.md golden rule 7).',
        },
      ],

      // Import ordering. Node builtins, then packages, then `@/`, then relative.
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          pathGroups: [{ pattern: '@/**', group: 'internal', position: 'before' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import-x/no-duplicates': 'error',
    },
  },

  // React components.
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'wattmatt/no-hardcoded-german': 'error',
    },
  },

  // Non-component source still must not carry German text (toasts, errors, …).
  {
    files: ['src/**/*.ts'],
    rules: {
      'wattmatt/no-hardcoded-german': 'error',
    },
  },

  /**
   * `src/domain` is pure (ARCHITECTURE.md §5): no clock, no randomness, no I/O.
   * Determinism is what makes the whole tournament reproducible from
   * (seed, ordered host decisions) — and what makes the unit tests meaningful.
   */
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Named exports only (CLAUDE.md §6).',
        },
        {
          selector: 'CallExpression[callee.object.name="Math"][callee.property.name="random"]',
          message:
            'Math.random() is banned. src/domain takes an injected Rng (ARCHITECTURE.md §5).',
        },
        {
          selector: 'CallExpression[callee.object.name="Date"][callee.property.name="now"]',
          message:
            'Date.now() is banned in src/domain. Take an injected Clock instead (ARCHITECTURE.md §5).',
        },
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'new Date() is banned in src/domain. Take an injected Clock instead (ARCHITECTURE.md §5).',
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'src/domain performs no I/O (ARCHITECTURE.md §5), and WattMatt is offline.',
        },
      ],
    },
  },

  // Tests assert on locale content and fixtures, so the German-string rule
  // would fight them. Everything else still applies.
  {
    files: ['src/**/*.test.{ts,tsx}', 'tools/**/*.test.js'],
    rules: {
      'wattmatt/no-hardcoded-german': 'off',
    },
  },

  // Build and tooling config run in Node.
  {
    files: ['*.config.{js,ts}', 'tools/**/*.js'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },

  // Must stay last: switches off everything Prettier already decides.
  prettier,
);
