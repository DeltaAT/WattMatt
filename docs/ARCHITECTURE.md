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

The store holds the tournament twice, and the difference matters. `document` is the whole
`Tournament` — what the host owns, what actions mutate and what is written to disk. `tournament`
is the projection of it that the beamer is sent, and it is recomputed by `commit` rather than
assigned by any action: an action that changed the tournament and forgot to re-project it would
leave the projector one decision behind while the host screen looks correct. The same commit
marks the file modified, so "there is something unsaved" cannot be forgotten either.

```text
component → action → domain function (pure) → store commit
                                                 ├─▶ undo stack push
                                                 ├─▶ emit "state:snapshot" → beamer window
                                                 └─▶ debounced autosave → Rust → disk
```

The autosave leg is `store/autosave.ts`; see §6 "Saving, and being told about it". The undo leg
is `store/undo.ts`; see "Taking a decision back" below.

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
| `beamer:scene` | host → beamer | Revision, scene, `autoFollow` and `skipToken`, without the tournament payload |
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

### Taking a decision back

The undo stack (`store/undo.ts`) hangs off `commit` for the same reason the broadcast and the
autosave do: an action added by a later issue is undoable by construction, and there is no call
for its author to forget. What an action does have to supply is the German label — nothing
downstream can work out what the host would call the thing they just did.

```ts
store.commit(mutate, {
  undoLabel: de.undo.action.matchWinnerSet({ group: 7 }),
  log: { action: 'MATCH_WINNER_SET', payload: { matchId, winnerId } },
  urgent: true,
});
```

Four properties are load-bearing.

**It is a snapshot, not an inverse.** An inverse operation has to be written per action and is
wrong in exactly the cases nobody tested — the table it freed, the round it closed. A snapshot
cannot be incomplete, so "undo restores derived state too" is a property of the mechanism rather
than a promise each future action keeps. Fifty of them for a 64-group tournament serialise to a
few hundred KB, well inside the issue's 100 MB budget.

**Two fields are never rewound**, and they are left out of the snapshot's *type* so they cannot
be rewound by accident. `log` is append-only (docs/FILE-FORMAT.md rule 6): rolling it back would
erase the record of the decision being undone. `rngCursor` is a stream position — the room has
already watched those numbers, and rewinding would make a redraw reproduce the pairing the host
just rejected while giving two different draws the same `(seed, cursor)`
(docs/OPEN-QUESTIONS.md #32).

**An unlabelled commit that replaces the tournament clears the stack.** That is not a decision
inside a tournament, it is the tournament being replaced — a new one, an opened file, a close —
and the steps behind it describe something that is no longer on the screen. Undo does not reach
across a document switch (docs/OPEN-QUESTIONS.md #20).

**The beamer follows an undo settled.** The commit is flagged `settled`, and `sync.ts` sends it
as a `catchUp` delivery: the projector moves to the restored picture without animating into it.
Replaying the pairing reveal because the host corrected a misclick would show the audience a
draw that is not happening.

An undo is itself a commit — urgent, so a crash a second after a correction cannot hand back the
version the host has just disowned — and it appends `ACTION_UNDONE` to the log rather than
pretending it never happened. Redo is discarded as soon as anything new is committed, so the
history never branches.

**An undo costs what the step cost.** The two sentences above describe taking back a decision.
A step that only moved the projector is taken back the way it was made: the entry carries
`touchedDocument`, and when it is false the undo leaves the tournament, the log and the file
alone and goes out on the scene channel. Undoing a blackout is still a blackout, and it must not
queue behind sixty-four groups of data any more than the blackout did (docs/FILE-FORMAT.md
rule 6).

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
  | { id: 'WELCOME' }
  | { id: 'BLACKOUT' }
  | { id: 'GROUP_OVERVIEW' }
  | { id: 'TABLE_OVERVIEW' }
  | { id: 'DRAW'; roundId: RoundId }
  | { id: 'ROUND_BOARD'; roundId: RoundId; split?: boolean }
  | { id: 'REPECHAGE' }
  | { id: 'NAMING' }
  | { id: 'BRACKET' }
  | { id: 'CEREMONY' };
```

`WELCOME` is the picture of the whole setup phase: the tournament's name and a live count of
how many are registered, at `beamer-hero`, updated on every commit like everything else
(issue #74). It is a count and never a roster — who is in is `GROUP_OVERVIEW`, a different
question with a different screen. It takes position 1 of `SCENE_ORDER` from `IDLE`, because the
positions are the keyboard shortcuts and they stop at nine; `IDLE` survives as the descriptor
the app stages for itself when no tournament is open at all, and is no longer anything the host
reaches for.

`ROUND_BOARD.split` puts both tracks on the wall at once (issue #79, docs/TOURNAMENT-RULES.md
§10). A flag rather than a scene of its own, because the nine switcher positions are the
keyboard shortcuts and a tenth would move every digit the host's hand has learned — and because
splitting is a property of the board the host already staged, the way `BRACKET.focus` is. The
second board is not named: it is the other track's open round, which the snapshot already
carries, so a descriptor pointing at it could go stale the moment that round closed. A split
staged while only one track is live falls back to the single board rather than drawing an empty
half.

`REPECHAGE` deliberately carries no round: the phase is not one, and everything it shows lives
in `tournament.repechage` (docs/OPEN-QUESTIONS.md #59).

`NAMING` is a holding picture and shows **no names** — the host is entering them one field at a
time behind it, and a wall that followed along would put a half-filled field in front of the
audience (issue #23, docs/TOURNAMENT-RULES.md §6). It is staged by the step into the naming
phase, so the projector is protected without the host having to think about it.

`autoFollow` (default on) makes the scene follow the tournament phase, and `sceneForPhase`
(`domain/sceneCatalog.ts`) is the whole of that rule. It is consulted at **exactly two moments**:
a phase step, and the host turning auto-follow back on. Never on an ordinary commit — a host who
put the `Turnierbaum` on the wall to talk over it must not lose it because a result landed
(docs/OPEN-QUESTIONS.md #76). Staging a scene by hand turns `autoFollow` off on the spot and it
stays off until the host hands the beamer back: manual control always wins (golden rule 3).

### Holding the picture, and jumping an animation

Two host controls sit beside the scene and neither is a scene (issue #28).

**Freeze** (`state.frozen`) is a hold. While it is on, `startHostSync` sends the projector
nothing at all — not the scene, not the result just marked, not the round being drawn ahead — and
answers a catch-up request with the picture captured at the freeze, so a beamer reopened mid-freeze
shows the room what it was already looking at rather than the work in progress. Releasing sends the
current state whole and flagged `catchUp`: the room is shown where the evening got to, not shown
twenty minutes replayed at speed. It is deliberately not on the undo stack
(docs/OPEN-QUESTIONS.md #75).

**Skip** (`state.skipToken`) is a monotonic counter carried in the picture rather than a command
channel. The beamer skips when the number it holds changes, so a re-delivered snapshot skips
nothing and a beamer reopened after five skips fires none of them. This is what makes
`Space` work from the *host* window, where the host's hands actually are
(docs/OPEN-QUESTIONS.md #53).

### The host's live preview

The host column renders the real scenes from a second `BeamerStore`, fed by the loopback leg of
the host channel (`createLoopbackChannel`, `mergeTransports`). The preview is therefore a genuine
beamer — same store, same sync layer, same messages — and cannot disagree with the wall. It sends
no heartbeat: a liveness light a preview could keep lit would report the projector healthy while
the room stares at a frozen picture.

## 4. Module layout

```text
src/
  domain/
    ids.ts             branded IDs — a GroupId is never a TableId
    types.ts           entities, phases and state unions, each as a Zod schema
    schema.ts          the .wattmatt file shape, schema version, carried unknown fields
    migrations/        one step per schemaVersion, and the runner that chains them
    factory.ts         createTournament(), file wrap/unwrap
    fileName.ts        tournament name -> a file name Windows accepts
    lookup.ts          index entities by ID; nothing reaches an entity by position
    snapshot.ts        what the beamer is sent, and the one place that projects it
    groups.ts          the group lifecycle: create, number, remove — numbers are never reused
    settings.ts        the tournament's own settings (participant wording)
    tables.ts          the table lifecycle: create, rename, reorder, block, occupy, free
    rng.ts             seeded PRNG (mulberry32) + Fisher-Yates shuffle
    history.ts         who has already played whom — derived, never stored
    pairing.ts         the rematch-free pairing of a shuffled field, and its fallback
    draw.ts            pairing, byes, table assignment
    repechage.ts       power-of-two target, the shuffled pot, candidate draw, §4 fallback
    consolation.ts     the Trostrunde: who is in it, when it may start, when it is decided
    progression.ts     the phase machine: what the field carries, where it goes next
    bracket.ts         bracket construction, third-place match
    sceneCatalog.ts    every scene the host can stage, and the one a phase implies
    selectors.ts       derived data (standings, free tables, …)
  store/
    tournamentStore.ts host-owned truth; `commit` bumps the revision
    beamerStore.ts     the beamer's read-only mirror, frozen in dev
    actions/           one file per use case
    undo.ts           the snapshot stack: what an undo puts back, and what it never does
    sync.ts            snapshot broadcast, wired once per window
    syncContract.ts    the typed event contract between the windows
    heartbeat.ts       beamer liveness
    problems.ts        what failed and has not been dismissed; one toast per kind
    session.ts         the one store each window owns
    persistence.ts     new / open / save / save-as, and the one autosave write
    persistenceRuntime.ts  the real file and dialog dependencies, wired once
    autosave.ts        the 500 ms debounce, forced saves, and what the host is shown
  platform/
    tauri.ts           the IPC boundary: invoke + listen, every payload Zod-parsed
    windowSync.ts      the Tauri transport behind sync.ts, plus the host's own loopback
    beamerWindow.ts    monitor list, beamer placement, sleep inhibition
    beamerSummary.ts   pure reading of a placement: is the audience seeing this?
    tournamentFile.ts  read/write/list files, and the native open/save dialogs
    clock.ts           the wall clock the domain is not allowed to read
    log.ts             the rolling log's frontend half, and "Protokoll öffnen"
    globalErrors.ts    the two window listeners React's boundaries cannot replace
    session.ts         the crash marker: what the last run left behind
    launch.ts          a tournament that arrived from Explorer rather than a dialog
    seed.ts            crypto.getRandomValues — the one non-deterministic step
    id.ts              the tournament id, from the same entropy source
  windows/
    route.ts           `?window=` → host | beamer
    useBeamerStatus.ts live placement, shared by both windows
    useNow.ts          the display clock behind running times; never committed
    groupLabel.ts      what a participant is called, on both screens
    host/              panels, dialogs, control center
    beamer/scenes/     one component per BeamerScene id
    beamer/fit.ts      how many columns a grid takes, and how far a scene shrinks
    beamer/useFitToStage.ts  measures the stage and scales the scene body to it
    beamer/useRepechageBeat.ts  which card this window may animate, if any
    beamer/useRepechageTravel.ts where the Hoffnungsrunde's highlight is, hop by hop
    beamer/useBracketAdvance.ts which chip moves into the round above, and from where
    beamer/useBlackout.ts    the 200 ms veil, and the picture kept under it
    beamer/useSkipSignal.ts  the host's Space, arriving from the other window
    beamer/BeamerPicture.tsx the stage contents, shared with the host's preview
    beamer/reducedMotion.ts  whether this window was asked to hold still
    host/ProblemToasts.tsx    the German toast stack, over the panels
    host/HostErrorFallback.tsx what fills the window when its tree could not be drawn
    beamer/SafeBeamerPicture.tsx the boundary both windows draw the picture through
    beamer/BeamerHoldingScene.tsx the neutral picture a failed scene is replaced by
  ui/                  Button, Card, GroupChip, TableChip, motion presets
    ErrorBoundary.tsx  the one class component: catch, report, draw something else
  i18n/
    de-AT.ts           every user-visible string, one typed tree
    t.ts               `t('round.title', { n: 2 })`, typed dotted-path keys
    plural.ts          German singular/plural via Intl.PluralRules
    format.ts          date/time and running durations, locale `de-AT`
src-tauri/src/
  main.rs
  fs.rs                atomic write, backup rotation, the tournament library
  session.rs           the session marker that turns a crash into a recovery offer
  windows.rs           monitor enumeration, window placement
  power.rs             holds off sleep and the screensaver during an event
  logging.rs           rolling log file, rotation, the panic hook
  launch.rs            the tournament the app was started with, and one instance only
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

**The generator is part of the file format.** A tournament stores `(rngSeed, rngCursor)` and
nothing else about the stream, so changing mulberry32 or the xmur3 seed hash silently
replays every saved tournament differently — including the one someone is disputing. Golden
vectors in `rng.test.ts` pin the stream; changing it is a `schemaVersion` bump and a
migration (docs/FILE-FORMAT.md rule 7), never a refactor.

**Undo never rewinds the cursor.** It is a stream position, not tournament state: the room has
already watched those numbers, and a cursor that went backwards would let two different draws
claim the same `(seed, cursor)` — which is the whole of the reproducibility claim. See "Taking a
decision back" in §3 and docs/OPEN-QUESTIONS.md #32.

Both halves are wired: issue #9 calls `generateSeed()` when a tournament is created, and
`drawRound` in `src/domain/draw.ts` (issue #16) writes `rng.cursor` back into `rngCursor` in
the same object that carries the pairings it produced. `startRepechage` and the
`REOPEN_DECLINED` fallback in `src/domain/repechage.ts` (issue #20) do the same for the shuffle
that fills the pot, and `drawBracket` in `src/domain/bracket.ts` (issue #24) for the one shuffle
the whole `Turnierbaum` comes out of. All four *default* their generator to
`createRng(rngSeed, rngCursor)`, so a caller cannot draw from the wrong position by mistake —
which is the failure mode docs/OPEN-QUESTIONS.md #23 exists to prevent: a tournament reopened
after a crash would otherwise restart the stream and re-deal pairings the room has watched.

Schemas and types are one definition, not two: every entity is declared as a Zod schema and
its TypeScript type is `z.infer`red from it. A schema that drifts from its type is then not
expressible, and the thing the compiler checks against is the same thing that parses data at
the boundary.

## 6. Error handling

### Saving, and being told about it

Every commit that leaves the tournament ahead of its file schedules a write 500 ms later
(`store/autosave.ts`). It hangs off `commit` for the same reason the beamer broadcast does:
an action added by a later issue is autosaved by construction, and there is no call for its
author to forget. An action that must not wait passes `{ urgent: true }` and the debounce is
skipped — round close and phase change, per docs/FILE-FORMAT.md rule 4.

Two consequences are easy to miss and both are deliberate.

**The window's close button is always intercepted**, even with nothing unsaved. The close has
to flush the pending write and clear the session marker before the process goes; letting Tauri
close the window straight away would lose up to half a second of a live event and would greet
the next start with a recovery offer for a tournament nothing happened to.

**A save only marks the file clean if the tournament has not moved on.** The write is
asynchronous and, at a 500 ms cadence, most writes overlap the host's next click. The writer
captures `documentRevision`; if the store has passed it by the time the bytes land, the file
stays `modified` and the write that is already scheduled catches up. Reporting otherwise would
tell the host a result is safe when it is not in the bytes on disk.

`documentRevision` is a second counter beside `revision`, and the difference is the point.
`revision` moves for everything a commit does, including staging a beamer scene or taking
manual control — none of which a `.wattmatt` file contains. Keying the file state on it would
mark a perfectly current file unsaved because the host pressed a beamer button mid-write, and
charge them a redundant write and a backup rotation for it every time.

- Rust returns typed errors; the frontend maps them to German messages from `de-AT.ts`.
- Any unexpected exception shows a non-blocking German error toast **and** writes to the
  rolling log at `%APPDATA%/WattMatt/logs/`. The tournament never silently continues in a
  broken state, but it also never hard-crashes to a white screen during an event.

### Never a white screen

Issue #30 makes that last sentence structural rather than aspirational. Four nets, in the
order a failure meets them.

**A boundary per window** (`ui/ErrorBoundary.tsx`). React unmounts the whole tree on an
exception thrown while rendering, which on the projector is a white rectangle in front of
the audience. The two fallbacks are deliberately different: the host gets a screen with
*Erneut versuchen* and *Protokoll öffnen*, the beamer gets `--wm-bg` and nothing else.
A message on the projector is a message the host spends the next ten minutes being asked
about; a black screen is indistinguishable from the blackout the room has already seen.

**A boundary per scene** (`beamer/SafeBeamerPicture.tsx`), inside `BeamerSurface` so the
letterbox, the background and the hidden cursor survive the scene that failed. It is
reset by the *staged scene id*, not by every snapshot: a scene that threw will throw again
on the next commit, so retrying on each one would flicker and fill the log. Staging
anything else — the blackout is one key away — makes the projector try again.

**Two window listeners** (`platform/globalErrors.ts`). A boundary sees renders. It does
not see a click handler that threw, an unawaited promise or a timer callback, and during
an event those are most of the code that runs. Without them the host presses a button,
nothing happens, and nothing anywhere says why.

**The panic hook** (`src-tauri/src/logging.rs`). The release profile aborts on panic, so
the hook is the only record that will ever exist of the one failure no `catch` can reach.

### Being told, and telling the log

Everything above reports through one call, `reportProblem(kind, event, cause)`
(`store/problems.ts`). It writes the log entry *and* raises the toast, in that order,
because a site that did one and forgot the other is indistinguishable from one that worked.

The `kind` is the contract, exactly as `FileErrorKind` is: the German sentence is picked
from `de.error.*` by kind, and the exception itself — English, technical, written for
whoever reads the log — never reaches the screen. Repeats of a kind collapse into one card
with a count, which is not cosmetic: a broken sync fails on *every* commit, and a host who
has dismissed forty identical toasts during one round will dismiss the forty-first without
reading it.

File failures do **not** come through here. They have their own strip at the top of the
host window (`FileNotice`) because they carry a way out — a backup to open, a place to
save — and because an autosave that has stopped working must not be dismissible at all.

The projector reports over the channel (`BEAMER_PROBLEM_EVENT`). It is the second and last
message the beamer may send and it carries no tournament data: golden rule 4 survives
because the contract has no message that could break it, not because the beamer chooses
not to send one. Without it the one person who can stage a different scene is the last to
find out that the current one cannot be drawn — which, with the projector behind them, is
never.

### The log itself

`%APPDATA%/WattMatt/logs/wattmatt.log`, plain text, one line per entry, rotated at 1 MiB
with five archives behind it. Plain text because of who reads it: the host, afterwards, in
Notepad. Newlines inside a message are folded, so a JavaScript stack stays one entry and
one `findstr` hit rather than a dozen.

Timestamps are UTC, because Rust has no timezone database without a dependency and a log
that guessed at local time would be wrong for half the year. The frontend writes one
`session.started` entry carrying the host's own clock and offset, which is what makes the
UTC stamps translatable back to the evening the host remembers.
