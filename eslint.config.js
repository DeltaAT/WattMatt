// Baseline lint configuration. The WattMatt-specific rules — no hardcoded German
// strings outside `src/i18n`, no `Math.random()` in `src/domain` — arrive with the
// tooling issue (#2), which also wires this config into CI.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'src-tauri/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // CLAUDE.md §6: no `any`, named exports only.
      '@typescript-eslint/no-explicit-any': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ExportDefaultDeclaration',
          message: 'Named exports only (CLAUDE.md §6).',
        },
      ],
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
);
