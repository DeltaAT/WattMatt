# Historic tournament files

One `.wattmatt` file per `schemaVersion` that has ever been released, exactly as the build of
the day wrote it. `src/domain/migrations/fixtures.test.ts` opens every one of them through the
real migration runner, which is the only evidence that a file from an earlier version still
opens in this one (docs/FILE-FORMAT.md rule 7, issue #12).

**These files are archives. Never regenerate them.** The moment one is re-written by the
current build it stops being a file from an older version, and the test that reads it stops
proving anything — it would then only check that today's writer agrees with today's reader,
which every other test already does.

When `SCHEMA_VERSION` is bumped:

1. Leave every existing fixture untouched.
2. Add `v<previous>.wattmatt` here if the version that is being left behind has none yet.
3. Add the migration to `src/domain/migrations/registry.ts`.

A new version's fixture is the previous one opened and saved by the build that introduced it —
that is exactly what a host's file goes through, and it keeps every earlier fixture's data
intact so the chain stays comparable. `v3.wattmatt` is `v2.wattmatt` after `v2_to_v3`, and
`v4.wattmatt` is `v3.wattmatt` after `v3_to_v4`.

A fixture is a mid-tournament file on purpose — rounds, tables, a repechage, a bracket and a
log all populated. A migration that drops a section is invisible in an empty tournament, and
"works with a tournament loaded mid-tournament" is a Definition-of-Done box (CLAUDE.md §7).
