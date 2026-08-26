# Packaging

How WattMatt becomes something a host can put on a laptop, and what has to be true of it
when that laptop has never been online. Issue #31.

The target is one Windows 11 x64 machine at a venue. Everything below exists because of
that one sentence.

---

## 1. What a release contains

| Artefact | What it is for |
| --- | --- |
| `WattMatt-<version>-setup.exe` | NSIS installer. The laptop that will run several events. |
| `WattMatt-<version>-portable.exe` | The same application as a single file. The laptop nobody was expecting to use. |
| `SHA256SUMS.txt` | So a copy on a USB stick can be checked against the one that was built. |

Both executables are the **same binary**; the installer wraps it, adds a Start-menu entry,
registers the `.wattmatt` file association and carries the WebView2 runtime. Nothing in
either one contacts a network — see §5.

```bash
pnpm package        # tauri build, then collect into release/
```

`release/` is git-ignored. `pnpm tauri build` alone leaves the installer in
`src-tauri/target/release/bundle/nsis/` and the portable executable in
`src-tauri/target/release/`; `tools/release/collect.js` copies both out under stable names
and writes the checksums.

Verifying a copy, on any Windows machine, offline:

```powershell
certutil -hashfile WattMatt-0.1.0-portable.exe SHA256
```

## 2. The icon and the version stamp

The icon is generated rather than drawn in an editor: `tools/icons/render.js` defines it as
geometry, `pnpm icons` writes every size Windows asks for into `src-tauri/icons/`, and the
result is committed. Regenerate and commit whenever the drawing changes — the build must
never depend on a generator step.

`icon.ico` carries 16, 24, 32, 48, 64, 128 and 256 px. The 48 px entry is the one that is
easy to lose and hard to notice: it is what Explorer draws a `.wattmatt` file with.

The executable's version info (right-click → Properties → Details) comes from
`src-tauri/tauri.conf.json`: `productName`, `version`, `publisher` and `copyright`. The same
`version` also names the installer, and `package.json`'s copy is stamped into every
tournament file the app writes. All three — `package.json`, `tauri.conf.json`,
`Cargo.toml` — must agree; `tools/packaging.test.js` fails the build if they do not.

## 3. WebView2

WattMatt renders in the WebView2 runtime, which is **part of Windows 11** and is present on
every supported target machine. The two artefacts handle its absence differently:

- **Installer** — carries the full WebView2 offline installer inside it
  (`webviewInstallMode: offlineInstaller`). Installing works start to finish with no
  internet, on a machine that has never had the runtime. That runtime is why the setup
  executable is around 210 MB against the application's own 4 MB, and it is worth every one
  of them: the alternative is an installer that works on the developer's laptop and fails at
  the venue.
- **Portable** — cannot install anything. If WebView2 is genuinely missing, the app shows
  a WebView2 error at startup and the way out is one of:
  1. run the installer instead (it brings the runtime);
  2. copy Microsoft's *Evergreen Standalone Installer* onto the same stick beforehand and
     run it first.

Do not switch `webviewInstallMode` to `downloadBootstrapper` or `embedBootstrapper`. Both
reach the network **while installing**, which is exactly the moment the target machine has
none. `tools/packaging.test.js` enforces this.

## 4. SmartScreen — the unsigned build

The build is not code-signed (docs/OPEN-QUESTIONS.md #12). Windows therefore shows
**Microsoft Defender SmartScreen** the first time either executable runs on a machine:

> Der Computer wurde durch Windows geschützt.

The click-through is two steps, and the second one is deliberately not the default button:

1. **Weitere Informationen**
2. **Trotzdem ausführen**

Afterwards the machine remembers, and neither the installer nor the app asks again. This is
the paragraph issue #32 lifts into the German host manual — it belongs in front of the host
**before** the day of the event, because a warning nobody warned them about is a warning
they will decline.

The same applies to a file copied from a network share or downloaded in a browser: Windows
marks it and may add an *Entsperren* checkbox to the file's properties. Copying from a USB
stick does not.

## 5. What is guaranteed offline, and how

CLAUDE.md golden rule 2 says a network call in runtime code is a bug. Four things hold it up,
and the last one is the only one that cannot be argued with:

1. No updater. `createUpdaterArtifacts` is `false` and no updater plugin is a dependency.
2. No network-capable permission in `src-tauri/capabilities/` — nothing from `http:`,
   `shell:`, `updater:`, `upload:` or `websocket:`.
3. A content security policy that allows the WebView to reach `*.localhost` and nothing
   else, so even a stray `fetch` has nowhere to go.
4. `tools/packaging.test.js`, which reads the same files the build reads and fails if any of
   the three above stops being true.

Fonts, icons and every asset are bundled at build time. Building needs the internet;
running never does.

## 6. The `.wattmatt` file association

The installer registers the extension, so double-clicking a tournament in Explorer opens it
in WattMatt. The portable executable registers nothing — there is nothing to unregister
afterwards, which is the point of it.

What a double-click does depends on what is already happening:

| Situation | What happens |
| --- | --- |
| WattMatt is not running | It starts and opens the file. |
| WattMatt is running, no tournament open | The window is raised and the file opens. |
| WattMatt is running, that same file open | The window is raised. Nothing else. |
| WattMatt is running, a **different** tournament open | The window is raised, the file is **not** opened, and the host is told why. |

The last row is the one that matters during an event: a misclick in Explorer must not
replace a round in progress. The host closes the open tournament first — the same rule as
docs/OPEN-QUESTIONS.md #10, "one tournament per window set".

Only one WattMatt ever runs (`tauri-plugin-single-instance`). A second process hands its
path to the first and exits, so there is never a second beamer window fighting for the
projector or a second autosave writing over the first.

Rotated backups (`….wattmatt.bak1`) are **not** registered and are never opened by a
double-click. They are opened deliberately, from the notice that offers them.

One known blemish: the *right-click* menu entry Tauri's installer writes reads
"Open with WattMatt" — the verb's display name is hardcoded by the NSIS template and is not
configurable through `tauri.conf.json`. Double-clicking, which is what a host actually does,
shows nothing at all. Fixing it means a custom NSIS hook, which is not worth carrying for
one context-menu string.

## 7. Cutting a release

1. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml`. All three, or the build fails.
2. Merge that to `main`.
3. Tag it `v<version>` and push the tag.
4. `.github/workflows/release.yml` re-runs every gate, builds on `windows-latest`, and
   creates a **draft** release with both artefacts and the checksums attached.
5. Read the draft, then publish it by hand. The draft is deliberate: an unsigned build
   should not announce itself without somebody looking at it first.

`workflow_dispatch` runs the same job without a tag and without publishing anything, which
is how a build is checked before the tag that would announce it exists.

## 8. Verifying on a clean machine

Neither CI nor a developer laptop can prove this; the machine that has already built the app
is the one machine where "it works" means nothing. Before a release is published, on a
Windows 11 VM with **no network adapter** and a snapshot to roll back to:

- [ ] Copy the installer onto the VM from a stick. Run it. Confirm the SmartScreen warning
      appears and that §4's two steps get past it.
- [ ] Installation completes with no administrator prompt (it installs for the current user).
- [ ] WattMatt starts and both windows appear. The version in the executable's
      Properties → Details, and the one in the first line of
      `%APPDATA%\WattMatt\logs\`, both match the tag.
- [ ] Create a tournament, save it, close the app, double-click the saved `.wattmatt` file:
      it opens in WattMatt.
- [ ] With WattMatt running and that tournament open, double-click a *different* `.wattmatt`
      file: the window is raised, nothing is replaced, and a German notice says why.
- [ ] Roll the snapshot back. Copy only the **portable** executable onto the VM from a stick
      and run it from the stick. It starts, creates a tournament and saves it.
- [ ] Nothing anywhere in the run tries to reach the network. The VM has no adapter, so a
      dependency on one shows up as a hang or an error rather than as silence.
- [ ] Uninstall through Windows settings. The application is gone and
      `%APPDATA%\WattMatt\` — the tournaments, the backups and the logs — is still there.
