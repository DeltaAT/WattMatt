# `.wattmatt` file format

One tournament = one file. Files are portable: copy it to a USB stick, open it on another
laptop, continue. No hidden state outside the file except UI preferences.

## Location

| Purpose | Path |
| --- | --- |
| Default library | `%APPDATA%/WattMatt/tournaments/` |
| Backups | next to the file: `name.wattmatt.bak1` … `.bak3` |
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
      "payload": { "matchId": "mt_1", "winnerId": "grp_1" } }
  ]
}
```

## Rules

Rules 1 and 2 are live as of issue #9: `src-tauri/src/fs.rs` does the temp-file-fsync-rename
dance and `src/store/persistence.ts` refuses a file that does not parse, offering the newest
backup instead. Rules 3, 4 and 5 belong to issue #10 — #9 only *finds* backups, it never writes
one. Rule 7 is issue #12's: it is listed as a task on #9, and moving it is recorded on that issue
and in docs/OPEN-QUESTIONS.md #27 rather than decided here.

1. **Validate on read.** Parse with Zod. A file that fails validation is never partially
   loaded — the host gets a clear German error and the option to open a backup.
2. **Atomic writes.** Write to `name.wattmatt.tmp`, `fsync`, then rename over the target.
   A power cut must never produce a truncated tournament.
3. **Rotate backups.** Before each save, shift `.bak2 → .bak3`, `.bak1 → .bak2`,
   current → `.bak1`.
4. **Autosave** is debounced at 500 ms after the last committed action, and forced
   immediately on round close, phase change and app exit.
5. **Recovery.** On startup, if the last session did not exit cleanly, offer to reopen the
   last tournament at its last autosaved state.
6. **`log` is append-only** and is what makes a draw auditable. It is not used to rebuild
   state — the snapshot fields are authoritative. Undo works on an in-memory snapshot stack.
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
