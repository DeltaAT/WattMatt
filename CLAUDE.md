# CLAUDE.md

Working agreement for Claude Code and any other contributor on **WattMatt**.
Read this before touching the repository.

---

## 1. What WattMatt is

An **offline Windows 11 desktop app** that runs a live knockout tournament on one laptop.
It has two windows:

- **Host window** — on the laptop screen. Dense, functional control panel. The host does
  everything here.
- **Beamer window** — fullscreen on the projector. Presentation only, no controls, no cursor.

The app is used **live, in front of an audience**. A bug is not a stack trace, it is
fifty people staring at a broken screen. Correctness, recoverability and responsiveness
beat cleverness every single time.

---

## 2. Golden rules

1. **UI is German. Code is English.** Every user-visible string lives in `src/i18n/de-AT.ts`.
   No German identifiers, comments, commit messages, branch names or documentation.
   No hardcoded German strings in components — ever.
2. **Offline is non-negotiable.** No CDN, no Google Fonts, no telemetry, no update check,
   no external API. Fonts, icons and sounds are bundled at build time. A network call in
   runtime code is a bug.
3. **The host is always in control.** No timer, animation or automatic transition may take
   control away. Every automatic behaviour has a manual override. The host can always force
   what the beamer shows.
4. **The beamer is a pure view.** It holds no authoritative state. It renders what it is told.
   If the beamer window dies, closing and reopening it must restore the exact current picture.
5. **Animations never block state.** A click commits state immediately; the animation is a
   consequence, not a gate. Interrupting an animation is always allowed.
6. **Everything is undoable.** The host will misclick during a live event. Every mutation goes
   through an action and lands on the undo stack.
7. **Randomness is seeded and logged.** Never call `Math.random()`. Use the seeded RNG so any
   draw can be reproduced, tested, and defended if a participant complains.

---

## 3. Stack and commands

| Concern | Choice |
| --- | --- |
| Shell | Tauri 2 (Rust) |
| UI | React 18 + TypeScript (strict) |
| Build | Vite |
| Styling | Tailwind CSS with project tokens only |
| Motion | Motion (`framer-motion`) + CSS transitions |
| State | Zustand (host owns it) |
| Validation | Zod at every I/O boundary |
| Tests | Vitest |
| Package manager | pnpm |

```bash
pnpm tauri dev            # dev, both windows
pnpm test                 # unit tests
pnpm test -- --watch
pnpm typecheck            # tsc --noEmit
pnpm lint
pnpm tauri build          # release artefacts
```

---

## 4. Architecture invariants

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detail. Non-negotiables:

- `src/domain/**` is **pure**: no React, no Tauri, no `Date.now()`, no `Math.random()`,
  no file access. Clock and RNG are injected. Every function is deterministic and unit-tested.
- All state mutations happen through **actions** in `src/store/actions/**`. Components never
  mutate the store directly.
- After every committed action the store (a) broadcasts a snapshot to the beamer window and
  (b) schedules a debounced autosave. Both are handled centrally — do not do it per action.
- Rust (`src-tauri`) owns only: file read/write, window and monitor management, logging.
  No tournament logic in Rust.
- Data crossing a boundary (disk, IPC) is parsed with Zod. Never trust a `JSON.parse` result.

---

## 5. Domain glossary (short form)

Code uses the English term, the UI shows the German one. Full table in
[docs/GLOSSARY.md](docs/GLOSSARY.md) — extend it whenever a new concept appears.

| Code (EN) | UI (DE) |
| --- | --- |
| `Tournament` | Turnier |
| `Group` | Gruppe |
| `Table` | Tisch |
| `Match` | Partie |
| `Round` | Runde |
| `Qualifying round` | Qualifikationsrunde |
| `Repechage` | Hoffnungsrunde |
| `Bye` | Freilos |
| `Draw` | Auslosung |
| `Bracket` | Turnierbaum |
| `Round of 16` | Achtelfinale |
| `Third-place match` | Spiel um Platz 3 |
| `Award ceremony` | Siegerehrung |
| `Beamer scene` | Beamer-Ansicht |

---

## 6. Code conventions

- TypeScript `strict: true`. No `any`. Prefer discriminated unions over booleans for state.
- Named exports only. One component per file. Filenames `PascalCase.tsx` for components,
  `camelCase.ts` for everything else.
- IDs are opaque branded strings (`GroupId`, `MatchId`, `TableId`) — never bare `string`.
- Never index arrays to find entities; use lookup maps keyed by ID.
- No colour literals, no magic durations, no raw pixel values in components. Use tokens from
  [docs/STYLEGUIDE.md](docs/STYLEGUIDE.md) and motion presets from [docs/MOTION.md](docs/MOTION.md).
- Comments explain *why*, not *what*. Document every non-obvious tournament rule with a link
  to the relevant section of `docs/TOURNAMENT-RULES.md`.
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Branches: `feat/<issue-number>-short-slug`.

---

## 7. Definition of done

An issue is done when **all** of these hold:

- [ ] `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- [ ] New domain logic has unit tests, including the edge cases named in the issue.
- [ ] No new user-visible English string; all strings added to `de-AT.ts`.
- [ ] Works with the app started cold **and** with a tournament file loaded mid-tournament.
- [ ] The beamer picture is correct after closing and reopening the beamer window.
- [ ] Undo of the new action restores the previous state exactly.
- [ ] Docs updated if behaviour, schema or terminology changed.

---

## 8. Things that will bite you

- **Odd group counts.** Byes (`Freilos`) exist at every stage. Never assume even counts.
- **Fewer tables than matches.** Matches queue and wait for a free table. Never assume a
  1:1 mapping between matches and tables.
- **Power-of-two maths.** The repechage target is `2^ceil(log2(winners))`. If the winner
  count is already a power of two, the repechage is skipped entirely.
- **Small tournaments.** 4 or 8 groups must work. The final phase starts at whatever power
  of two is reached, not necessarily 16.
- **Second monitor missing.** The app must start and stay usable with one screen.
- **Mid-event crash.** Autosave + recovery is a feature, not a nice-to-have.

---

## 9. When unsure

Check [docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md). If the answer is not there, add the
question to that file and pick the option that is **most reversible** and **least surprising
to the host**. Do not invent tournament rules — they are normative in
`docs/TOURNAMENT-RULES.md` and changes go through an issue.
