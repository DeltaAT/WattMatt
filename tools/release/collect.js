import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Gathers what `pnpm tauri build` produced into `release/` (issue #31).
 *
 * Two artefacts, because a venue is two situations. The installer is what a
 * laptop that will run several events gets. The portable executable is what
 * goes on a USB stick for the laptop nobody was expecting to use — it is the
 * same binary the installer wraps, and it needs nothing installed but WebView2
 * (docs/PACKAGING.md).
 *
 * Tauri names its output after the version, which is exactly the thing that
 * changes between releases, so the paths are derived rather than typed. A
 * missing artefact fails loudly: a release with one of the two silently absent
 * is discovered by the person who needed it.
 */

const root = new URL('../../', import.meta.url);

function path(relative) {
  return fileURLToPath(new URL(relative, root));
}

const { version } = JSON.parse(readFileSync(path('package.json'), 'utf-8'));

/** Matches `productName` in src-tauri/tauri.conf.json. */
const PRODUCT = 'WattMatt';

const artefacts = [
  {
    from: `src-tauri/target/release/bundle/nsis/${PRODUCT}_${version}_x64-setup.exe`,
    to: `${PRODUCT}-${version}-setup.exe`,
    what: 'NSIS installer',
  },
  {
    from: `src-tauri/target/release/${PRODUCT}.exe`,
    to: `${PRODUCT}-${version}-portable.exe`,
    what: 'portable executable',
  },
];

function main() {
  const target = path('release/');
  mkdirSync(target, { recursive: true });

  const lines = [];
  for (const { from, to, what } of artefacts) {
    let bytes;
    try {
      bytes = readFileSync(path(from));
    } catch {
      throw new Error(`the ${what} is missing: ${from}\nRun \`pnpm tauri build\` first.`);
    }
    copyFileSync(path(from), path(`release/${to}`));
    const digest = createHash('sha256').update(bytes).digest('hex');
    lines.push(`${digest}  ${to}`);
    process.stdout.write(`${to}  (${what}, ${(bytes.length / 1024 / 1024).toFixed(1)} MB)\n`);
  }

  // So a copy on a stick can be checked against the one that was built —
  // `certutil -hashfile <file> SHA256` on any Windows machine, offline.
  writeFileSync(path('release/SHA256SUMS.txt'), `${lines.join('\n')}\n`);
  process.stdout.write('SHA256SUMS.txt\n');
}

main();
