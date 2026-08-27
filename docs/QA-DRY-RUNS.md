# QA Dry Runs

The last gate before WattMatt is trusted in front of an audience (issue #33). Five scenarios,
each chosen to exercise a different corner of [TOURNAMENT-RULES.md](TOURNAMENT-RULES.md) §9.

The runs come in two halves and **both** have to be done before a release:

- **The scripted half** — `src/qa/`, run with `pnpm qa:dry-run`. It plays every scenario end to
  end through the real store and checks everything a machine can check. It is part of
  `pnpm test`, so it runs in CI on every push.
- **The room half** — the checklist at the bottom of this document. A projector, ten metres of
  floor, a cable to pull out. No test can do any of it, so nobody should pretend otherwise.

A box in either half that nobody can produce evidence for counts as **failed**, not passed
(CLAUDE.md §7).

---

## 1. The five scenarios

| # | Scenario | What it is for |
| --- | --- | --- |
| 1 | **5 groups, 2 tables** | Odd count, `Freilos`, final phase reached at 4 |
| 2 | **13 groups, 3 tables** | `Freilos`, repechage 7 → 8, no elimination round, queueing |
| 3 | **40 groups, 6 tables** | Repechage 20 → 32, one elimination round to 16, full bracket, heavy queueing |
| 4 | **2 groups, 1 table** | Degenerate case: one match, no qualifying round, no `Spiel um Platz 3` (§9 case 5) |
| 5 | **Decline-heavy** (20 groups, 4 tables) | Most repechage candidates decline, forcing **both** §4 fallbacks |

Scenario 5 is not a size, it is an answering pattern: the host says *Nein* to nearly everybody,
the pot runs dry, the host readmits the declined (*Ausgeschiedene erneut zulassen*), most of them
say no a second time, and what is still open becomes `Freilose`. It is the only run that reaches
both halves of §4's fallback dialog and the only one whose bracket is built on a field short of
its own power of two.

---

## 2. What the scripted half checks

`src/qa/dryRun.ts` is a scripted host. It presses buttons — every mutation goes through
`@/store/actions`, nothing is written by hand — and it treats an action that commits nothing as a
failure rather than a no-op, because every call site is something the panel would have offered.

**After every single host action** (not once per scenario, and not once per phase) it does the
three things that actually go wrong at a live event:

| Check | How it is really done |
| --- | --- |
| The laptop dies | The tournament is created through `createTournamentDocument` on a fake library and autosaved after every action. The check reads back **the bytes the autosave wrote** and reopens them through `openTournamentAt` — schema version, Zod, migrations and all — then compares the recovered tournament, every decided result and every table's occupancy against what the host had. |
| The beamer window dies | A fresh beamer store subscribes over the real sync transports, whose payloads round-trip through JSON and the shipping schemas. Its snapshot must equal the host's catch-up snapshot, and `animate` must be false. |
| The host misclicks | *Rückgängig* five times, then five redos. The tournament after the undos must equal the one from five actions earlier — table occupancy compared separately, so a failure names it — and the tournament after the redos must equal the one the host was on. Run once per phase that is at least six actions long, and once more after the `Siegerehrung` so even the two-participant run gets it. |
| Nobody plays the same opponent twice | Every pairing of the finished evening is read out of the rounds and the tree and checked for a repeat. A pairing a *draw* decided may never repeat; a bracket round above the first may, and that exception is asserted rather than assumed (issue #72, §3 and §7). |

Two more properties are checked structurally rather than by assertion:

- **Nothing advances without the host.** The runner throws the moment any action other than
  *Turnier starten*, *Weiter*, *Turnierbaum auslosen* or *Finale abschließen* moves the phase.
  There is no timer and no effect that could; this is the check that keeps it that way.
- **The beamer can draw what it is handed.** `src/qa/beamerRender.test.tsx` renders the reopened
  beamer's view in every phase through `SafeBeamerPicture`, error boundary included, and fails if
  a scene throws, if the picture lands on the holding scene, or if any of the one-off animation
  classes (`wm-result-*`, `wm-repechage-*`, `wm-draw-reveal`, `data-arriving`) is on the page.
  A reopened beamer that replays a result the room watched ten minutes ago is golden rule 4's
  failure exactly.

What it deliberately does **not** model is the autosave debounce window. A crash within 500 ms of
a non-urgent commit costs that commit by design ([FILE-FORMAT.md](FILE-FORMAT.md) rule 4); that is
`src/store/autosave.test.ts`'s question, not this one. Draws, round closes, phase changes and
every repechage decision are `urgent` and are on disk before the next thing happens.

Undo is compared on everything except `log`, `rngCursor` and `updatedAt`, and not for
convenience: the undo stack leaves all three moving forward on purpose (`src/store/undo.ts`).
The audit trail records that the host stepped back, the RNG cursor never rewinds — so a redrawn
round cannot repeat pairings the room has already seen — and the file's clock keeps ticking.

---

## 3. Results

Recorded from `pnpm qa:dry-run`. Every scenario completed with **no workaround**: no action was
refused, no phase advanced by itself, no recovery lost a result, no reopened beamer replayed
anything.

| Scenario | Phases | Rounds drawn | Matches played | `Freilose` | Peak queue | Repechage | Bracket | Host actions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 groups, 2 tables | SETUP → QUALIFYING → REPECHAGE → NAMING → BRACKET → CEREMONY | Runde 1: 3 | 6 | 1 | 0 | target 4, 1 drawn, 1 accepted | 4 | 23 |
| 13 groups, 3 tables | SETUP → QUALIFYING → REPECHAGE → NAMING → BRACKET → CEREMONY | Runde 1: 7 | 14 | 1 | 3 | target 8, 1 drawn, 1 accepted | 8 | 41 |
| 40 groups, 6 tables | SETUP → QUALIFYING → REPECHAGE → ELIMINATION → NAMING → BRACKET → CEREMONY | Runde 1: 20, Runde 2: 16 | 52 | 0 | 14 | target 32, 12 drawn, 12 accepted | 16 | 138 |
| 2 groups, 1 table | SETUP → QUALIFYING → NAMING → BRACKET → CEREMONY | none | 1 | 0 | 0 | skipped (§9 case 2) | 2 | 9 |
| Decline-heavy, 20 groups, 4 tables | SETUP → QUALIFYING → REPECHAGE → NAMING → BRACKET → CEREMONY | Runde 1: 10 | 23 | 3 | 6 | target 16, 20 drawn, 3 accepted, 17 declined, fallback `BYES` | 16 | 102 |

The four bracket sizes 16, 8, 4 and 2 are all reached, which is §9 case 10 covered outright: the
final phase adapts, and the `Spiel um Platz 3` exists at every size except two.

The two-participant run is worth reading twice. It draws **no qualifying round at all** — the one
match those two play *is* the `Finale` (§9 case 5, OPEN-QUESTIONS.md #62) — and its bracket has no
third-place node.

### How long does a 40-group tournament take?

**About 75 minutes**: 48 of them people playing (twelve waves of matches across six tables),
20 the host making 122 decisions, 5 typing sixteen names, and 90 seconds of draws.

That number is a **model, not a measurement**, and it is stated as arithmetic so it can be
argued with. `DEFAULT_TIMING` in `src/qa/dryRun.ts` assumes:

| | |
| --- | --- |
| One match, pair sitting down to winner marked | 4 min |
| One host decision (read the panel, click, tell the room) | 10 s |
| One animated draw the room watches | 30 s |
| Typing one participant's name | 20 s |

Matches on different tables run **at the same time**: a round is played in waves, every free table
is filled, and the wave costs one match time however many tables are in it. That is why 20
matches on 6 tables cost four waves and not twenty.

Under those assumptions:

| Scenario | Modelled length | Host actions |
| --- | --- | --- |
| 5 groups, 2 tables | 18 min | 23 |
| 13 groups, 3 tables | 33 min | 41 |
| 40 groups, 6 tables | **75 min** | 138 |
| 2 groups, 1 table | 6 min | 9 |
| Decline-heavy, 20 groups | 52 min | 102 |

**This is the number to replace first.** Time one real round at the next event, put the measured
match length into `DEFAULT_TIMING`, and the whole table becomes a measurement — the match count,
the queue depth and the number of decisions in it are already real.

---

## 4. What still needs a room

None of this can be automated, and none of it may be skipped before a release. Do it once per
scenario for the sizes you can stage, and at minimum once with 40 groups, which is the only run
where the host is under real pressure.

### Per scenario

- [ ] **Unplug and replug the projector** mid-round. The host window stays usable, the beamer
      window comes back on the same picture, and no result is lost. Also start the app with the
      second monitor already missing (CLAUDE.md §8) and confirm it is usable on one screen.
- [ ] **Readable at 10 m** on a real projector in a lit room: group numbers, names, the round
      board, the bracket and the podium. Nothing thinner than weight 500 on the beamer
      ([STYLEGUIDE.md](STYLEGUIDE.md) §2).
- [ ] **Greyscale.** Put the projector into greyscale (or photograph the wall and desaturate) and
      confirm every win/lose state is still readable. The three signals of STYLEGUIDE.md §1 —
      colour, icon, German word — are unit-tested for the round board, the bracket and the
      repechage; what the room adds is whether the projector's own colour rendering keeps them
      apart.
- [ ] **Kill the app for real** — Task Manager, not a reload — mid-round, and reopen. The
      scripted half proves the file is complete; this proves Windows, WebView2 and the file lock
      agree.
- [ ] **The host is never surprised.** Nothing on the wall moves that the host did not press.

### Once per release

- [ ] The whole 40-group run, timed with a stopwatch, and the measured match length written back
      into `DEFAULT_TIMING`.
- [ ] A table taken out of service *while a match is on it*, mid-round, and the host asked what
      happens to that match (issue #13).
- [ ] A participant added after the first draw, with the warning shown (issue #14).

---

## 5. Findings

Bugs found by these runs get their own issue; blockers are fixed before release (issue #33).

| Finding | Issue | State |
| --- | --- | --- |
| `CEREMONY`: the podium's second and third places carry each other's colour and caption — the runner-up stands on a bronze block captioned *Bronze*, the third-place winner on a silver block captioned *Silber*. The reveal props (`revealMode`, `revealStep`) are discarded, so the host's step-by-step reveal does nothing and §8's "revealed bronze → silver → gold" never happens. | [#69](https://github.com/DeltaAT/WattMatt/issues/69) | Open. **Release blocker** — it is the last picture the audience sees. |

Two gaps in the scripted half, recorded so they are not mistaken for coverage:

- `CeremonyScene` has no greyscale or three-signal test of its own, unlike every other scene that
  carries an outcome. The podium does carry text captions and three different block heights, so
  it should survive greyscale — but nothing holds it to that. The test belongs with the #69 fix.
- The scripted half checks the *snapshot* a reopened beamer receives and that it renders; it does
  not check that the projector's window geometry, monitor assignment or cursor suppression
  survive a replug. That is the first manual box above.

---

## 6. Keeping this document honest

Run `pnpm qa:dry-run`. It prints the table of §3 as JSON, so the numbers here can be regenerated
rather than remembered. If they have moved, the tournament shape has moved — find out why before
editing the table.

The scenarios themselves live in `src/qa/dryRun.test.ts`. Adding one is a `Scenario` entry with
what it is expected to produce; the checks come with it.
