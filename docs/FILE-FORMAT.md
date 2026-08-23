# `.wattmatt` file format

One tournament = one file. Files are portable: copy it to a USB stick, open it on another
laptop, continue. No hidden state outside the file except UI preferences.

## Location

| Purpose | Path |
| --- | --- |
| Default library | `%APPDATA%/WattMatt/tournaments/` |
| Backups | next to the file: `name.wattmatt.bak1` … `.bak3` |
| Pre-migration copy | next to the file: `name.wattmatt.v1.bak` (rule 7) |
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

All seven rules are live. #9 landed the atomic write and the "open a backup instead" answer;
#10 landed the rotation, the debounced autosave and the crash recovery; #11 landed the writer
behind the action log; #12 landed the migration framework, the refusal of a newer file and the
preservation of unknown fields.

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

   **Taking back a beamer scene writes nothing**, for the same reason the scene action itself
   writes nothing. Undoing a blackout is still a blackout: it moves the projector, and it must
   not rewrite the tournament, append an entry, dirty the file or trigger a save on its way. An
   undo is only audited when the step it takes back changed the tournament.
7. **Migrations.** Bump `schemaVersion` on any breaking change and add a migration in
   `src/domain/migrations/`. Never silently drop unknown fields — preserve them on save.

   Three things happen when a file is opened (`openTournamentAt` in
   `src/store/persistence.ts`), and the order is the whole design.

   **The version is read before the file is parsed.** A v1 file cannot satisfy a v4 schema,
   so anything that parsed first could only ever report a merely-old file as corrupt.
   `readSchemaVersion` reads the one field and places it: current, outdated, newer, or not
   one of ours at all.

   **A newer file is refused, never opened partially.** The host is told *Diese Datei stammt
   aus einer neueren Version von WattMatt* and is deliberately **not** offered a backup: the
   `bak1`…`bak3` beside it were written by that same newer build and refuse in exactly the
   same way. A build that does not know what a field means cannot judge whether dropping it
   loses a round, and the first save would be how the host found out.

   **An outdated file is copied aside before it is migrated**, to
   `name.wattmatt.v<from>.bak` — outside the rotating chain of rule 3, which covers minutes
   during a busy round and would push the pre-migration state off the end long before anyone
   wanted it. The copy is made once and never overwritten; the first one is the true original.
   If it cannot be made, the file is **not opened**. That is the one place where a failed
   backup is fatal rather than best effort: the autosave rewrites the file in the new format
   within half a second of the host's first click, and without the copy the file as the
   previous version wrote it stops existing at that moment.

   The migration itself is pure and in memory (`src/domain/migrations/`). Nothing on the open
   path writes to the file, which is what makes "a migration that fails never overwrites the
   original" a property of the code rather than a promise.

   **Unknown top-level fields are carried, not dropped.** `tournamentFileSchema` describes
   what this build knows; anything else at the top level is picked up by `carriedFields`,
   held beside the tournament in the store, and written back by `withCarriedFields` on every
   save. That is what lets an older WattMatt open a newer build's file, record a winner, and
   hand the file back with the newer build's fields intact. Nested objects still parse
   strictly, and `schema.test.ts` leans on it: a field added to `settings` or to a `match`
   here but forgotten in the schema fails the round-trip assertion. The top level has its own
   guard instead — `covers every top-level field of the documented example` — which does not
   depend on strictness (docs/OPEN-QUESTIONS.md #27).

### Adding a migration

1. Change `tournamentSchema` and bump `SCHEMA_VERSION` in `src/domain/schema.ts`.
2. Add `src/domain/migrations/v<n>_to_v<n+1>.ts` exporting one `Migration`. It takes the raw
   JSON of the old version and returns the raw JSON of the new one. It may throw: a field the
   new version needs and the old file cannot supply is a refusal, not a guess.
3. Append it to `MIGRATIONS` in `src/domain/migrations/registry.ts`. The array has to be
   contiguous up to `SCHEMA_VERSION`; `runner.test.ts` asserts it, because a gap is a file
   that opens on the laptop of whoever wrote the migration and refuses on the host's.
4. Copy a file written by the *previous* build into `tests/fixtures/` as `v<n>.wattmatt`.
   `fixtures.test.ts` finds it by name and opens every fixture through the real runner.
   Fixtures are archives — never regenerate one, or it stops being a file from an older
   version and the test stops proving anything.
5. Update the example above and this document if the shape changed.
