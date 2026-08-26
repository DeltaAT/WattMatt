import { writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { encodeIco, encodePng, ICO_SIZES, renderIcon } from './render.js';

/**
 * Writes every icon `pnpm tauri build` needs (issue #31).
 *
 * Run with `pnpm icons` after changing anything in `render.js`, and commit the
 * result — the build must not depend on a generator step, and a release must
 * not depend on this file being runnable years from now.
 *
 * Only the Windows set is produced. WattMatt ships to Windows 11 and nothing
 * else (CLAUDE.md §1), so the macOS `.icns` and the AppX tiles the Tauri
 * template ships are not stale here, they are absent.
 */

const PNG_SIZES = {
  '32x32.png': 32,
  '128x128.png': 128,
  // Tauri's name for the 2× asset; it is a 256 px image.
  '128x128@2x.png': 256,
  // The master, kept as the source anyone regenerating by other means starts
  // from. Not referenced by the bundle configuration.
  'icon.png': 512,
};

const iconsDirectory = new URL('../../src-tauri/icons/', import.meta.url);

function main() {
  for (const [name, size] of Object.entries(PNG_SIZES)) {
    const target = fileURLToPath(new URL(name, iconsDirectory));
    writeFileSync(target, encodePng(renderIcon(size), size));
    process.stdout.write(`${name} (${size}×${size})\n`);
  }

  const images = ICO_SIZES.map((size) => ({ size, pixels: renderIcon(size) }));
  writeFileSync(fileURLToPath(new URL('icon.ico', iconsDirectory)), encodeIco(images));
  process.stdout.write(`icon.ico (${ICO_SIZES.join(', ')})\n`);
}

main();
