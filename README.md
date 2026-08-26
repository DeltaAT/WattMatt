# WattMatt

Offline tournament management and beamer presentation app for Windows 11.

WattMatt runs on a **single laptop at the venue** — no network, no server, no cloud.
The host controls the tournament on the laptop screen; a second, fullscreen window is
projected onto the beamer for the audience.

| | |
| --- | --- |
| **UI language** | German (de-AT) |
| **Code, comments, commits, docs** | English |
| **Target** | Windows 11 x64, fully offline at runtime |
| **Stack** | Tauri 2 · React 18 · TypeScript · Vite · Tailwind CSS · Motion · Zustand · Zod |

## What it does

1. The host creates a tournament, adds **tables** and **groups** (participants are just
   numbers until the final phase).
2. WattMatt draws opponents **randomly**, assigns each match to a **table**, and shows the
   draw on the beamer with animations.
3. The host clicks the winner of each match — winners turn green, losers red, live on the beamer.
4. If the number of winners is not a power of two, a **repechage** (`Hoffnungsrunde`) draws
   losers back in one by one; each drawn team may accept or decline.
5. Rounds repeat until the final phase is reached. Then the host enters **names** and
   WattMatt builds a **tournament bracket** including a third-place match.
6. The event closes with an animated **award ceremony** (`Siegerehrung`).

The exact, normative algorithm lives in [`docs/TOURNAMENT-RULES.md`](docs/TOURNAMENT-RULES.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [CLAUDE.md](CLAUDE.md) | Working agreement for AI agents and contributors |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Processes, windows, state flow, module layout |
| [docs/TOURNAMENT-RULES.md](docs/TOURNAMENT-RULES.md) | Normative tournament algorithm and edge cases |
| [docs/FILE-FORMAT.md](docs/FILE-FORMAT.md) | `.wattmatt` file schema, persistence, recovery |
| [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md) | Design tokens, colour, typography, layout |
| [docs/MOTION.md](docs/MOTION.md) | Animation principles and scene choreography |
| [docs/GLOSSARY.md](docs/GLOSSARY.md) | German ↔ English domain terminology |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Installer, portable build, WebView2, SmartScreen, releases |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Milestones and issue map |
| [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md) | Decisions that still need the product owner |

## Quick start

> Requires Node 20+, pnpm 10+, Rust stable (MSVC toolchain) and the
> Visual Studio Build Tools. Internet is needed **to build**, never **to run**.

```bash
pnpm install
pnpm tauri dev        # runs host + beamer window
pnpm typecheck        # tsc --noEmit
pnpm lint             # eslint
pnpm format           # prettier --write
pnpm test             # domain unit tests
pnpm test:coverage    # unit tests + coverage thresholds
pnpm tauri build      # NSIS installer + portable exe in src-tauri/target/release
pnpm package          # the same build, collected into release/ with checksums
pnpm icons            # regenerate the app icon (tools/icons/)
```

The installer registers the `.wattmatt` extension, so double-clicking a tournament opens it.
Only one WattMatt ever runs: a second one hands its file over to the first and exits.
[docs/PACKAGING.md](docs/PACKAGING.md) covers the artefacts, the WebView2 requirement and the
SmartScreen warning an unsigned build produces.

With a second monitor attached, `pnpm tauri dev` opens the beamer fullscreen on it. With a
single screen it opens as a windowed 16:9 preview instead and says so in the host panel — the
app is fully usable either way. Both windows are the same bundle, told apart by `?window=host`
and `?window=beamer`, so `pnpm dev` in a browser can serve either one.

## Repository layout

```text
src/
  domain/        pure tournament logic (no React, no I/O, fully unit-tested)
  store/         Zustand store, actions, undo stack
  windows/host/  host control UI
  windows/beamer/ presentation UI (scenes)
  ui/            shared primitives, tokens, motion presets
  i18n/          de-AT.ts — every visible string
src-tauri/       Rust: file I/O, window & monitor management, logging
tools/           build-time tooling: the lint rules, the icon generator, packaging
docs/            documentation (English)
```

## Licence

TBD — see [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md).
