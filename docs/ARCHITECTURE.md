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
off and drive the beamer manually at any moment — see issue *Beamer control center*.

## 4. Module layout

```text
src/
  domain/
    types.ts           branded IDs, entities, phases
    schema.ts          Zod schemas, file schema version
    rng.ts             seeded PRNG + shuffle
    draw.ts            pairing, byes, table assignment
    repechage.ts       power-of-two target, candidate draw
    progression.ts     phase transitions
    bracket.ts         bracket construction, third-place match
    selectors.ts       derived data (standings, free tables, …)
  store/
    tournamentStore.ts
    actions/           one file per use case
    undo.ts
    sync.ts            snapshot broadcast
    persistence.ts     autosave orchestration
  platform/
    tauri.ts           the IPC boundary: invoke + listen, every payload Zod-parsed
    beamerWindow.ts    monitor list, beamer placement, sleep inhibition
    beamerSummary.ts   pure reading of a placement: is the audience seeing this?
  windows/
    route.ts           `?window=` → host | beamer
    useBeamerStatus.ts live placement, shared by both windows
    host/              panels, dialogs, control center
    beamer/scenes/     one component per BeamerScene id
  ui/                  Button, Card, GroupChip, TableChip, motion presets
  i18n/de-AT.ts
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

## 6. Error handling

- Rust returns typed errors; the frontend maps them to German messages from `de-AT.ts`.
- Any unexpected exception shows a non-blocking German error toast **and** writes to the
  rolling log at `%APPDATA%/WattMatt/logs/`. The tournament never silently continues in a
  broken state, but it also never hard-crashes to a white screen during an event.
