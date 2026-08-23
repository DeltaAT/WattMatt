import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Tauri injects this when developing against a device on the LAN. Unused for the
// Windows desktop target, but leaving it in keeps `tauri dev --host` working.
const host = process.env['TAURI_DEV_HOST'];

// Stamped into every .wattmatt file as `app.version` (docs/FILE-FORMAT.md).
// Read here, at build time, rather than by importing package.json into the
// bundle: only the version belongs in a release, not the dependency tree.
const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version: string };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // Everything ships inside the bundle: no CDN, no font host, no runtime fetch.
  // See CLAUDE.md §2 — a network call in runtime code is a bug.
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    sourcemap: true,
  },

  // Do not let Vite hide Rust compiler errors behind a cleared screen.
  clearScreen: false,

  server: {
    // Tauri expects a fixed port and fails loudly if it is taken.
    port: 1420,
    strictPort: true,
    host: host ?? false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },

  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tools/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Report on every source file, not just the ones a test happened to
      // import — otherwise an untested module silently counts as covered.
      // (Vitest 4 does this by default for everything matched by `include`.)
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/index.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        // Dev-only token review page (issue #3). Never part of a release bundle,
        // so its coverage number would only dilute the ones that matter.
        'src/dev/**',
        // Test fixtures. Not product code, and counting them inflates the
        // src/domain denominator with builders that exist to serve the tests
        // measuring it.
        'src/**/testFixtures.ts',
      ],
      thresholds: {
        // src/domain is the part a wrong result cannot be argued with, so it
        // carries the hard target from issue #2. The rest of the tree has no
        // threshold yet; UI coverage numbers would be noise at this stage.
        'src/domain/**': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
