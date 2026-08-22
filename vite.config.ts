import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri injects this when developing against a device on the LAN. Unused for the
// Windows desktop target, but leaving it in keeps `tauri dev --host` working.
const host = process.env['TAURI_DEV_HOST'];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
