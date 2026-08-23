# `.wattmatt` file format

One tournament = one file. Files are portable: copy it to a USB stick, open it on another
laptop, continue. No hidden state outside the file except UI preferences.

## Location

| Purpose | Path |
| --- | --- |
| Default library | `%APPDATA%/WattMatt/tournaments/` |
| Backups | next to the file: `name.wattmatt.bak1` … `.bak3` |
| Session marker | `%APPDATA%/WattMatt/session.json` (never tournament data) |
| Logs | `%APPDATA%/WattMatt/logs/` |
| UI preferences | `%APPDATA%/WattMatt/settings.json` (never tournament data) |

The host may save anywhere via *Speichern unter…*.

The default library is created on first use, not on install, and is listed straight from disk:
the start screen's *Zuletzt verwendet* is that listing, newest first, rather than a remembered
list of files (docs/OPEN-QUESTIONS.md #25). A tournament is written into it the moment it is
created, under a file name derived from its name and made unique against what is already there
(#26) — so autosave has a target from the first click and a flat battery during setup costs
nothing. `%APPDATA%/WattMatt` is deliberately the product name rather than the bundle
identifier; see #24.

## Encoding

UTF-8 JSON, pretty-printed with 2 spaces. Human-readable and diff-friendly on purpose: if
something goes badly wrong at an event, the file can be repaired in Notepad.

## Schema (v1)

```jsonc
{
  "schemaVersion": 1,
  "app": { "name": "WattMatt", "version": "0.1.0" },
  "id": "tnm_01HX…",
  "name": "Vereinsturnier 2026",
  "createdAt": "2026-08-22T17:04:00+02:00",
  "updatedAt": "2026-08-22T19:31:12+02:00",

  // These two are the whole record of the draw stream. The generator is
  // mulberry32 seeded through an xmur3 hash of rngSeed (src/domain/rng.ts);
  // changing either algorithm replays every saved tournament differently and
  // is a schemaVersion bump under rule 7, not a refactor.
  "rngSeed": "8f3c1a7e…",          // draws are reproducible from this
  "rngCursor": 42,                  // how many values have been consumed

  "settings": {
    "participantLabel": "GROUP",    // GROUP | TEAM | PLAYER — affects German UI only
    "namingAt": 16,                 // field size at which names are required
    "performanceMode": false
  },

  "phase": "QUALIFYING",

  "tables": [
    { "id": "tbl_1", "label": "Tisch 1", "status": "OCCUPIED", "currentMatchId": "mt_3" }
  ],

  "groups": [
    // name is null until the naming phase. status: ACTIVE | ELIMINATED
    { "id": "grp_1", "number": 1, "name": null, "status": "ACTIVE" }
  ],

  "rounds": [
    {
      "id": "rnd_1",
      "index": 1,
      "kind": "QUALIFYING",         // QUALIFYING | REPECHAGE | ELIMINATION | BRACKET
      "label": "Runde 1",
      "state": "RUNNING",           // DRAWN | RUNNING | CLOSED
      "matches": [
        {
          "id": "mt_1",
          "tableId": "tbl_1",
          "a": "grp_1",
          "b": "grp_7",             // null = Freilos
          "winnerId": "grp_1",
          "status": "DONE"          // WAITING_FOR_TABLE | READY | RUNNING | DONE
        }
      ]
    }
  ],

  "repechage": {
    "target": 16,
    "draws": [ { "groupId": "grp_9", "accepted": true } ],  // accepted null = not yet answered
    "fallbackUsed": null            // null | BYES | REOPEN_DECLINED
  },

  "bracket": {
    "size": 16,
    "nodes": [
      // ROUND_OF_16 | QUARTER_FINAL | SEMI_FINAL | FINAL | THIRD_PLACE.
      // English per CLAUDE.md rule 1; the German names are UI copy in de-AT.ts.
      { "id": "bn_1", "round": "ROUND_OF_16", "slotA": "grp_3", "slotB": "grp_12",
        "winnerId": null, "nextNodeId": "bn_9", "tableId": null }
    ],
    "thirdPlaceNodeId": "bn_15"     // null at size 2 — nobody left to play for third
  },

  "log": [
    { "at": "2026-08-22T18:02:11+02:00", "action": "MATCH_WINNER_SET",
      "payload": { "matchId": "mt_1", "winnerId": "grp_1" } },
    // An undo appends; it never removes the entry above (rule 6).
    { "at": "2026-08-22T18:02:19+02:00", "action": "ACTION_UNDONE",
      "payload": { "action": "MATCH_WINNER_SET", "label": "Sieger festgelegt: Gruppe 1" } }
  ]
}
```

## Rules

Rules 1 to 6 are live. #9 landed the atomic write and the "open a backup instead" answer;
#10 landed the rotation, the debounced autosave and the crash recovery; #11 landed the writer
behind the action log. Rule 7 is issue #12's:
it is listed as a task on #9, and moving it is recorded on that issue and in
docs/OPEN-QUESTIONS.md #27 rather than decided here.

1. **Validate on read.** Parse with Zod. A file that fails validation is never partially
   loaded — the host gets a clear German error and the option to open a backup.
2. **Atomic writes.** Write to `name.wattmatt.tmp`, `fsync`, then rename over the target.
   A power cut must never produce a truncated tournament.
3. **Rotate backups.** Before each save, shift `.bak2 → .bak3`, `.bak1 → .bak2`,
   current → `.bak1` (`rotate_backups` in `src-tauri/src/fs.rs`, called by the
   `write_tournament` command so an autosave and an explicit *Speichern* behave identically).

   Three details are load-bearing. The chain is walked **oldest first**, or `bak1` lands on a
   `bak2` that has not moved yet and three recovery points collapse into one. The last step is
   a **copy, not a rename**: a rename would leave the tournament with no file at its own path
   for the length of the write that follows.

   And the rotation happens **between the temp write and the rename**, not before both. A save
   that fails, fails while writing the temp file — so putting the rotation after it means a
   failed save spends nothing. Rotating first would push `bak3` off the end on every failed
   attempt: three tries onto a full disk and the chain is three copies of the file already on
   disk, exactly when the depth is needed.

4. **Autosave** is debounced at 500 ms after the last committed action, and forced
   immediately on round close, phase change, window close and app exit
   (`src/store/autosave.ts`). It hangs off `TournamentStore.commit`, so an action added by a
   later issue is autosaved by construction. An "urgent" commit
   (`commit(mutate, { urgent: true })`) is what skips the debounce — the call sites for round
   close and phase change arrive with those issues.

   Autosave never opens a dialog. A tournament whose first write failed has no path, and the
   host is offered *Speichern unter…* through the `notWritten` notice instead: a native save
   dialog appearing half a second after the host stopped typing would take the machine away
   from them mid-event (CLAUDE.md golden rule 3).

   A write that fails leaves the tournament `modified` and raises a warning the host cannot
   dismiss, which clears itself when a write succeeds. It also **tries again by itself** after
   `AUTOSAVE_RETRY_MS`, so a host who pushes the USB stick back in between rounds does not
   have to click anything for the tournament to be written. A tournament that changed *while*
   the bytes were in flight also stays `modified`: the file holds the `documentRevision` that
   was serialised, not the one the host has now.

5. **Recovery.** `%APPDATA%/WattMatt/session.json` is written when the app starts and deleted
   when it exits cleanly (`src-tauri/src/session.rs`), and it records which tournament the
   session was autosaving. A marker still present at the next start is therefore the evidence
   that the last run was killed, and the host is offered that tournament by name. The marker
   carries a path and a start time and nothing else — the tournament's own file is the state.
6. **`log` is append-only** and is what makes a draw auditable. It is not used to rebuild
   state — the snapshot fields are authoritative. Undo works on an in-memory snapshot stack.

   Entries are written by `TournamentStore.commit` (issue #11), from the `log` an action
   passes with its mutation — centrally, like the broadcast and the autosave, so an action
   added by a later issue is audited by construction. `updatedAt` moves with the entry and
   only with it: a recorded decision is what "the tournament changed" means, while opening a
   file or marking one saved is not.

   Only an action that changes the tournament writes one. A beamer scene deliberately does
   not: the log lives in the file, so an entry for a blackout would rewrite the tournament,
   push the commit onto the heavy sync channel and trigger an autosave — for the one action
   that must never queue behind sixty-four groups of data.

   **An undo appends, it does not erase.** Taking a decision back writes `ACTION_UNDONE`
   naming what was undone, and a redo writes `ACTION_REDONE`; the entries the undone action
   itself wrote stay exactly where they are. The log is therefore the one place that still
   knows the host set the wrong winner, which is the point of having it. For the same reason
   `rngCursor` is never rewound either — see docs/OPEN-QUESTIONS.md #32.
7. **Migrations.** Bump `schemaVersion` on any breaking change and add a migration in
   `src/domain/migrations/`. Never silently drop unknown fields — preserve them on save.

   **Not implemented yet — issue #12 owns it.** `tournamentFileSchema` (issue #7) parses
   *strictly*: an unknown field is dropped, not preserved. This is deliberate rather than
   overlooked. The v1 schema is the only one that has ever existed, so there is no forward
   field to preserve yet; and making the schema permissive today would disarm the test that
   guards the schema itself, which asserts that the example above survives a parse
   unchanged. Under a permissive schema an unknown key round-trips untouched, so a field
   added to this document but forgotten in the schema would pass silently — exactly the
   regression that test exists to catch. Issue #12 introduces preservation together with
   the version negotiation that makes it meaningful.
