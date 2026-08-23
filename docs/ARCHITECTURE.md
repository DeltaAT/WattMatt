# Architecture

## 1. Why Tauri

| Option | Verdict |
| --- | --- |
| **Tauri 2 + React** | **Chosen.** ~10 MB installer, WebView2 ships with Windows 11, full CSS/GPU animation power, Rust for reliable file I/O. |
| Electron + React | Same UI capability, 120 MB+ bundle, heavier on an event laptop. Acceptable fallback if WebView2 ever becomes a problem. |
| WPF / .NET 8 | Native and fast, but the animation work required for the beamer is disproportionate. |

The UI runs in Chromium-based WebView2, so everything in [MOTION.md](MOTION.md) is available
without compromise. Rust handles the parts a browser cannot do well: atomic file writes,
monitor enumeration and window placement.

## 2. Windows

```text
┌─ Host window (laptop screen) ──────────┐   ┌─ Beamer window (projector) ─────┐
│ setup · rounds · results · beamer ctl  │   │ fullscreen · no chrome · no     │
│ live beamer preview thumbnail          │──▶│ cursor · one scene at a time    │
└────────────────────────────────────────┘   └─────────────────────────────────┘
```

- Both windows are separate WebViews served from the same bundle, routed by a query
  parameter (`?window=host` / `?window=beamer`).
- On startup Rust enumerates monitors. If a second monitor exists, the beamer window opens
  fullscreen on it. If not, it opens as a resizable preview window and the host is told so.
- The host can reassign the beamer to a different monitor at any time without losing state.
  Reassigning moves the existing window; the WebView is never reloaded, so the scene it is
  showing survives the move.
- Closing the beamer window never affects the tournament. Reopening restores the current scene.

### Which monitor the beamer gets

Two rules, and they are the reason `windows.rs` picks rather than takes the first entry:

- **Automatic selection only ever picks a non-primary monitor.** Windows enumerates monitors in
  whatever order the ports were detected, so "the second one in the list" is not a thing. If
  nothing non-primary is attached, the beamer becomes a windowed 16:9 preview rather than
  covering the laptop screen and burying the controls.
- **An explicit choice by the host always wins**, including the laptop screen (golden rule 3).
  The control panel flags that case, because it hides the host UI.

The remembered choice is an id, re-validated against a fresh enumeration every time. A monitor
that disappears is never silently replaced by the laptop screen: the beamer moves to another
non-primary monitor if one exists, and otherwise drops to a preview with the reason shown.

Rust re-reads the monitor set every two seconds and pushes a `beamer:status` event when it
changed — Tauri surfaces no display-change event, and a host who has to click to discover that
the projector fell out has already lost the room. Unplugging demotes the beamer to a preview,
replugging promotes it straight back.

### Staying awake

Windows is told to hold off sleep and the screensaver through `SetThreadExecutionState`
(`power.rs`). The state is per-thread and dies with the thread, so a dedicated long-lived thread
holds it rather than whichever pool thread happened to serve the command.

## 3. State flow

**Single source of truth: the Zustand store in the host window.**

```text
component → action → domain function (pure) → store commit
                                                 ├─▶ undo stack push
                                                 ├─▶ emit "state:snapshot" → beamer window
                                                 └─▶ debounced autosave → Rust → disk
```

- The beamer window subscribes to `state:snapshot` and to `beamer:scene`. It keeps a local
  copy purely for rendering and never writes back.
- On beamer startup it requests `state:request-snapshot`, so a restarted beamer immediately
  gets the full picture. This is what makes rule 4 in CLAUDE.md work.
- Snapshots are small (a few hundred KB at worst); no patching or diffing until profiling
  says otherwise.

### The event contract

| Event | Direction | Carries |
| --- | --- | --- |
| `state:snapshot` | host → beamer | The whole picture: revision, scene, `autoFollow`, tournament |
| `beamer:scene` | host → beamer | Revision, scene and `autoFollow`, without the tournament payload |
| `state:request-snapshot` | beamer → host | Nothing; its arrival is the message |
| `beamer:heartbeat` | beamer → host | A beat counter |

There is deliberately **no** event by which the beamer can change the tournament. Golden rule 4
holds because the contract has no such message, not because the beamer chooses not to send one.

`beamer:scene` exists so a blackout is not queued behind sixty-four groups of data. It is sent
whenever a commit left the tournament payload untouched — keyed on the tournament rather than on
the scene alone, because taking manual control changes `autoFollow` too, and a blackout that fell
back to the heavy channel because of that would be slowest exactly when it must be fastest.

Every message carries the store's `revision`. The beamer drops anything older than what it
already holds, so an out-of-order delivery cannot walk the projector backwards into a round that
has already finished.

### Catching up without replaying

A snapshot is flagged `live` or `catchUp`. A beamer that has just been reopened is answered with
`catchUp`, and renders the scene **settled**: no entry animation. Replaying the draw because the
projector was replugged would show the audience a draw that is not happening. The same guard
covers a re-delivered scene, so a reconnect never restarts an animation mid-event.

### Liveness

`beamer:status` (from Rust) answers whether the *window* is open. The heartbeat answers a
different question: whether the WebView inside it is still running. An open window whose renderer
has died reports itself as perfectly fine while showing the room a frozen picture, so the host
panel reads the heartbeat, not the window state. Three missed beats count as gone — one missed
beat is a busy WebView mid-animation, and a light that flickers during every draw is a light the
host learns to ignore.

### Beamer scene model

The host does not send "screens", it sends a scene descriptor:

```ts
type BeamerScene =
  | { id: 'IDLE' }
  | { id: 'BLACKOUT' }
  | { id: 'GROUP_OVERVIEW' }
  | { id: 'TABLE_OVERVIEW' }
  | { id: 'DRAW'; roundId: RoundId }
  | { id: 'ROUND_BOARD'; roundId: RoundId }
  | { id: 'REPECHAGE'; roundId: RoundId }
  | { id: 'BRACKET' }
  | { id: 'CEREMONY' };
```

`autoFollow` (default on) makes the scene follow the tournament phase. The host can turn it
off and drive the beamer manually at any moment — see issue *Beamer control center*. Staging a
scene by hand turns it off on the spot: manual control always wins (golden rule 3).

## 4. Module layout

```text
src/
  domain/
    ids.ts             branded IDs — a GroupId is never a TableId
    types.ts           entities, phases and state unions, each as a Zod schema
    schema.ts          the .wattmatt file shape, schema version
    factory.ts         createTournament(), file wrap/unwrap
    lookup.ts          index entities by ID; nothing reaches an entity by position
    rng.ts             seeded PRNG (mulberry32) + Fisher-Yates shuffle
    draw.ts            pairing, byes, table assignment
    repechage.ts       power-of-two target, candidate draw
    progression.ts     phase transitions
    bracket.ts         bracket construction, third-place match
    selectors.ts       derived data (standings, free tables, …)
  store/
    tournamentStore.ts host-owned truth; `commit` bumps the revision
    beamerStore.ts     the beamer's read-only mirror, frozen in dev
    actions/           one file per use case
    undo.ts
    sync.ts            snapshot broadcast, wired once per window
    syncContract.ts    the typed event contract between the windows
    heartbeat.ts       beamer liveness
    session.ts         the one store each window owns
    persistence.ts     autosave orchestration
  platform/
    tauri.ts           the IPC boundary: invoke + listen, every payload Zod-parsed
    windowSync.ts      the Tauri transport behind sync.ts
    beamerWindow.ts    monitor list, beamer placement, sleep inhibition
    beamerSummary.ts   pure reading of a placement: is the audience seeing this?
    seed.ts            crypto.getRandomValues — the one non-deterministic step
  windows/
    route.ts           `?window=` → host | beamer
    useBeamerStatus.ts live placement, shared by both windows
    host/              panels, dialogs, control center
    beamer/scenes/     one component per BeamerScene id
  ui/                  Button, Card, GroupChip, TableChip, motion presets
  i18n/
    de-AT.ts           every user-visible string, one typed tree
    t.ts               `t('round.title', { n: 2 })`, typed dotted-path keys
    plural.ts          German singular/plural via Intl.PluralRules
    format.ts          date/time via Intl, locale `de-AT`
src-tauri/src/
  main.rs
  fs.rs                atomic write, backups, recovery
  windows.rs           monitor enumeration, window placement
  power.rs             holds off sleep and the screensaver during an event
  logging.rs           rolling log file
```

## 5. Determinism and testability

`src/domain` never touches the outside world. Every function that needs randomness takes an
`Rng` instance; every function that needs time takes a `Clock`. This makes the entire
tournament reproducible from `(seed, ordered list of host decisions)` — which is exactly what
the unit tests replay, and exactly what makes a disputed draw defensible.

This is a lint rule, not a convention. `src/domain/**` may not import React, Zustand, Tauri,
Node builtins, or any other `src/` layer; `Math.random()`, `Date.now()`, `new Date()` and
`fetch` are rejected there too. The layering is one-way — everything may import the domain,
the domain imports nobody — so a violation fails `pnpm lint` and therefore CI.

### The draw stream

Randomness has exactly one source: `createRng(seed, cursor)` in `src/domain/rng.ts`.
`Math.random()` is banned everywhere, tooling and config included — a second source of
randomness would make the reproducibility claim false without making any test fail.

The seed is drawn once, from `crypto.getRandomValues` in `src/platform/seed.ts`, when the
tournament is created. It is written to the file and never changes. **The cursor is the part
that is easy to miss:** it records how many values have been consumed, and without it a
tournament reopened after a crash would restart the stream and re-draw pairings the room has
already watched. Both fields are persisted (docs/FILE-FORMAT.md), and `(seed, cursor)` is
enough to reproduce any draw in the event — which is what makes a disputed pairing
defensible rather than a matter of trust.

Resuming is O(1): mulberry32 advances its state by a constant, so the state after *n* draws
is `initial + n × step`. The tests check that seek against an actual replay rather than
trusting the arithmetic.

Schemas and types are one definition, not two: every entity is declared as a Zod schema and
its TypeScript type is `z.infer`red from it. A schema that drifts from its type is then not
expressible, and the thing the compiler checks against is the same thing that parses data at
the boundary.

## 6. Error handling

- Rust returns typed errors; the frontend maps them to German messages from `de-AT.ts`.
- Any unexpected exception shows a non-blocking German error toast **and** writes to the
  rolling log at `%APPDATA%/WattMatt/logs/`. The tournament never silently continues in a
  broken state, but it also never hard-crashes to a white screen during an event.
