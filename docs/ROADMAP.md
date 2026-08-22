# Roadmap

Seven milestones, 33 issues. Order matters: each milestone depends on the previous one.
Issue numbers are stable and referenced from `CLAUDE.md` and the code.

## M0 — Foundation (#1–#6)

The skeleton: project, tooling, tokens, two windows, state sync, i18n.
At the end of M0 the app opens two windows, the beamer mirrors host state, and every visible
string comes from the German locale file.

## M1 — Domain & persistence (#7–#12)

Pure tournament model, seeded randomness, `.wattmatt` file I/O, autosave, undo, migrations.
At the end of M1 there is no UI for tournaments yet, but the domain is fully unit-tested and a
tournament survives a crash.

## M2 — Setup phase (#13–#15)

Tables, groups, settings and pre-start validation. First phase the host can actually use.

## M3 — Qualifying & repechage (#16–#22)

The heart of the app: draw engine, table queueing, result marking, the green/red board, the
repechage with accept/decline, and round progression. At the end of M3 a full tournament can
be run up to the final phase.

## M4 — Final phase (#23–#27)

Naming, bracket generation with third-place match, bracket scene, bracket control, ceremony.
At the end of M4 a tournament can be run end to end.

## M5 — Control & polish (#28–#30)

Beamer control center, performance mode, error handling and logging. This is what turns a
working app into one that can be trusted in front of an audience.

## M6 — Release (#31–#33)

Installer, German host manual, and a full dry run with 5, 13 and 40 groups.

---

## Suggested build order for a solo developer

1. #7, #8 first — the domain is the risky part and it is testable without any UI.
2. #1–#6 to get something on screen.
3. #16 and #20 with tests **before** their UIs. The draw and repechage rules are where bugs
   hide, and they are far cheaper to find in Vitest than on stage.
4. Then walk the phases in order.

Do not start M4 before M3 is genuinely done — an unfinished qualifying phase means an
untestable bracket.
