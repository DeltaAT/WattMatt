# Open Questions

Decisions made with incomplete information. Each has a **current assumption** so work is not
blocked. Confirm or overrule them; changes go through an issue.

| # | Question | Current assumption |
| --- | --- | --- |
| 1 | "Grandstand at the end" — what exactly? | Interpreted as **Siegerehrung**: an animated podium showing 1st, 2nd and 3rd place, triggered manually by the host. If a standings *table* of all participants was meant, that is a separate scene and needs its own issue. |
| 2 | Are matches best-of-one? | Yes. The host clicks a winner; no scores, no sets, no draws. Adding scores later would touch the whole `Match` model. |
| 3 | Can a match end in a draw? | No. A winner must always be picked. |
| 4 | Final phase when fewer than 16 groups remain | The final phase starts at whatever power of two is reached (16, 8, 4 or 2) and names are entered then. A 32-group tournament reaches 16; a 10-group tournament reaches 8. |
| 5 | Is the repechage possible more than once? | No. Only after the qualifying round, because from then on the field is a power of two and halves cleanly. |
| 6 | Who decides accept/decline in the repechage? | The team decides, the host records it. Declining means elimination — the group does not return to the pool (except via the §4 fallback). |
| 7 | Team size / number of players per group | Not modelled. A group is one opaque unit with a number and, later, a name. |
| 8 | Are participant names needed earlier than the final phase? | No, but `settings.namingAt` makes the threshold configurable in case a host wants names from the start. |
| 9 | Sound effects | Out of scope for v1. If added: bundled locally, off by default, host-toggleable. |
| 10 | Multiple tournaments open at once | No. One tournament per window set. Switching files closes the current tournament (with a save prompt). |
| 11 | Repository visibility and licence | Repo created **private**. Licence undecided — add one before making it public. |
| 12 | Code signing the installer | Not planned. Windows SmartScreen will warn on first run; the host manual explains the click-through. |
| 13 | Printing / exporting results | Out of scope for v1. A PDF export of the bracket would be a natural v1.1 feature. |
| 14 | Touchscreen use by the host | Assumed mouse/trackpad. Hit targets are sized generously anyway (≥ 32 px). |
