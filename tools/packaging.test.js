import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * What the release must never quietly grow (issue #31).
 *
 * "No updater, no telemetry, no network permission" is the kind of property
 * that is true on the day it is written and false two dependency bumps later,
 * because the thing that breaks it is always a one-line addition that looked
 * harmless. Every clause below is a line somebody could add to a config file
 * without anybody noticing until an offline laptop at a venue hangs on a
 * connection that is never going to be made (CLAUDE.md golden rule 2).
 *
 * It reads the same files `pnpm tauri build` reads, so it cannot drift from
 * what actually ships.
 */

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), 'utf-8');
}

const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const cargo = read('src-tauri/Cargo.toml');

const capabilities = readdirSync(fileURLToPath(new URL('src-tauri/capabilities/', root)))
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, ...JSON.parse(read(`src-tauri/capabilities/${name}`)) }));

/** Every `scheme://host` the string mentions. */
function origins(csp) {
  return [...csp.matchAll(/[a-z]+:\/\/[^\s;]+/g)].map((match) => match[0]);
}

describe('the offline guarantee', () => {
  /**
   * The permissions that would let the app reach the network, run something
   * else, or replace itself. None of them is needed to run a tournament, and
   * each of them is one line in a capability file.
   */
  it.each(capabilities)('grants $name nothing that can reach the network', (capability) => {
    for (const permission of capability.permissions) {
      const name = typeof permission === 'string' ? permission : permission.identifier;
      expect(name, `${capability.name}: ${name}`).not.toMatch(
        /^(http|shell|updater|upload|websocket|geolocation|notification|deep-link):/,
      );
    }
  });

  it('depends on no plugin that talks to the outside world', () => {
    expect(cargo).not.toMatch(
      /tauri-plugin-(http|shell|updater|upload|websocket|geolocation|notification|deep-link)\b/,
    );
  });

  it('ships no updater and builds no update artefacts', () => {
    expect(config.bundle.createUpdaterArtifacts).toBe(false);
    expect(config.plugins?.updater).toBeUndefined();
    expect(config.bundle.publisher).toBeDefined();
  });

  /**
   * The last line of defence: even a stray `fetch` in a component cannot reach
   * anything, because the content security policy has nowhere to send it. Only
   * `*.localhost` is allowed, which is how Tauri's own asset and IPC channels
   * are addressed.
   */
  it('allows the WebView to talk to nothing but Tauri itself', () => {
    for (const origin of origins(config.app.security.csp)) {
      expect(origin, origin).toMatch(/^https?:\/\/[a-z-]+\.localhost$/);
    }
  });

  /** `pnpm tauri dev` may reach Vite, and Vite only. */
  it('confines even the development policy to this machine', () => {
    for (const origin of origins(config.app.security.devCsp)) {
      expect(origin, origin).toMatch(/^(https?|ws):\/\/([a-z-]+\.)?localhost(:\d+)?$/);
    }
  });
});

describe('the Windows bundle', () => {
  it('builds the NSIS installer the release ships', () => {
    expect(config.bundle.active).toBe(true);
    expect(config.bundle.targets).toContain('nsis');
  });

  /**
   * The installer carries WebView2 rather than fetching it. The target laptop
   * is offline from the moment it arrives at the venue, and an installer that
   * downloads a runtime is an installer that fails there — see
   * docs/PACKAGING.md "WebView2".
   */
  it('installs WebView2 from the bundle instead of downloading it', () => {
    expect(['offlineInstaller', 'fixedRuntime']).toContain(
      config.bundle.windows.webviewInstallMode.type,
    );
  });

  /** No administrator, no UAC prompt: a host may not be an admin on the laptop. */
  it('installs for the current user', () => {
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  /** The installer is part of the UI, and the UI is German (CLAUDE.md §1). */
  it('speaks German while installing', () => {
    expect(config.bundle.windows.nsis.languages).toEqual(['German']);
    expect(config.bundle.windows.nsis.displayLanguageSelector).toBe(false);
  });

  /**
   * The executable is named after the product rather than after the Cargo
   * crate, which is what `tools/release/collect.js` looks for and what a host
   * sees in the install folder and in the task manager.
   */
  it('names the executable after the product', () => {
    expect(config.mainBinaryName).toBe(config.productName);
  });

  it('stamps the executable with a copyright for its version info', () => {
    expect(config.bundle.copyright).not.toBe('');
  });

  it('references only icons that exist', () => {
    for (const icon of [...config.bundle.icon, config.bundle.windows.nsis.installerIcon]) {
      expect(existsSync(fileURLToPath(new URL(`src-tauri/${icon}`, root))), icon).toBe(true);
    }
  });
});

describe('the file association', () => {
  /**
   * Double-clicking a tournament opens it (issue #31). Exactly one extension,
   * and it is the one the app writes: registering anything else would mean
   * WattMatt claiming files it cannot open.
   */
  it('claims .wattmatt and nothing else', () => {
    expect(config.bundle.fileAssociations).toHaveLength(1);
    expect(config.bundle.fileAssociations[0].ext).toEqual(['wattmatt']);
  });

  /** Shown in Explorer's "Type" column, so it is German like the rest of the UI. */
  it('describes itself to Explorer in German', () => {
    expect(config.bundle.fileAssociations[0].description).toBe('WattMatt-Turnier');
  });

  /** The extension Rust filters arguments on has to be the registered one. */
  it('registers the extension the app actually writes', () => {
    const rust = read('src-tauri/src/fs.rs');
    expect(rust).toMatch(/TOURNAMENT_EXTENSION: &str = "wattmatt"/);
  });
});

describe('the version', () => {
  /**
   * Three files carry it and all three are read by something different: Vite
   * stamps `package.json`'s into every `.wattmatt` file (docs/FILE-FORMAT.md),
   * Tauri puts `tauri.conf.json`'s into the executable's version info and into
   * the installer's file name, and Cargo builds the crate at its own. A build
   * where they disagree produces a file that claims one version, an installer
   * that claims another, and a support question nobody can answer.
   *
   * It is also what `tools/release/collect.js` relies on: it derives Tauri's
   * output path from `package.json`.
   */
  it('is the same in package.json, tauri.conf.json and Cargo.toml', () => {
    const { version } = JSON.parse(read('package.json'));
    expect(config.version).toBe(version);
    expect(cargo).toMatch(new RegExp(`^version = "${version}"$`, 'm'));
  });
});
