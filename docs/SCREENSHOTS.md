# Screenshots for the host manual

The shot list [docs/HANDBUCH.de.md](HANDBUCH.de.md) is written around, and how to take it.
Issue #32 asks for screenshots of the host UI and of every beamer scene; this file is the
part of that task that can be written before the app has been driven through a real
tournament.

**Status: not captured yet.** The manual currently carries hand-drawn layout sketches in
fenced `text` blocks instead. Those are not placeholders to be deleted — they survive a
redesign, they print in black and white, and they are readable in a terminal. A screenshot
sits *beside* the sketch it illustrates, never in place of it.

## Why these are not captured in the same change as the manual

Every shot worth having is a shot of a tournament with plausible data in it: sixteen named
teams, a round half decided, a repechage with two places left. Producing that state means
running the app and playing a tournament through, which is exactly what
**issue #33 (QA: full dry runs with 5, 13 and 40 groups)** does. Taking the shots during those
runs costs nothing extra and yields pictures of a real evening; taking them from a synthetic
fixture beforehand costs a screenshot harness and yields pictures of a fixture.

So: **capture during the #33 dry runs**, then add them to the manual in a follow-up commit.
The 13-group run is the right one for most shots — it is the only field size that reaches
every phase including a repechage that actually has to draw.

## Capture rules

- **Windows 11, the same machine and resolution the manual describes.** Not a browser, not
  `pnpm dev` — the manual documents the packaged app.
- **Host window:** `Win + Shift + S` → *Window* mode, or `Alt + PrintScreen`. Capture the
  whole host window including the beamer column on the right; the column is referenced in
  most of the manual.
- **Beamer scenes:** capture the fullscreen beamer output, i.e. `Win + PrintScreen` with the
  beamer window focused on the projector display. A shot of the windowed preview is not a
  shot of a beamer scene — the type scales with the surface.
- **Real German data.** Team names a host would recognise, table names that are not all
  `Tisch 1..n`, a plausible tournament name. No `Test`, no `asdf`, no English.
- **No personal data.** Invented team names only.
- **PNG**, unscaled, no annotations, no drop shadows, no window borders added afterwards.
- Store under `docs/img/`, named exactly as the table below.
- Reference them from the manual as a standard Markdown image pointing at `img/<file>.png`,
  with a **German** alt text.

## Shot list

### Host window

| File | Manual section | State to capture |
| --- | --- | --- |
| `host-startscreen.png` | 5.1 | Start screen with two or three entries under *Zuletzt verwendet*. |
| `host-overview.png` | 4 | Whole host window mid-round, so every panel named in §4 is visible at once. |
| `host-settings.png` | 5.2 | *Turniereinstellungen*, participant label on *Team*, seed visible. |
| `host-tables.png` | 5.3 | *Tische* with one running, one free and one `gesperrt` table. |
| `host-groups.png` | 5.4 | *Gruppen* with 13 numbered chips. |
| `host-prestart.png` | 5.5 | *Prüfung vor dem Start*, ready, with the table-shortage hint showing. |
| `host-beamer-column.png` | 6.1, 6.2 | The beamer column alone, beamer projected, a scene staged. |
| `host-round.png` | 7.2 | *Aktuelle Runde*: two tables running, a queue, a decided match, the *Zwischenstand* including the repechage line. |
| `host-repechage.png` | 8.2 | *Hoffnungsrunde* with a candidate drawn and *Nachrücken?* awaiting an answer. |
| `host-repechage-fallback.png` | 8.3 | The *Der Topf ist leer* dialog. Needs a run where enough participants decline. |
| `host-naming.png` | 10 | *Namenserfassung*, roughly two thirds filled in, one duplicate warning visible. |
| `host-bracket.png` | 11.2 | *Turnierbaum* panel, quarter-finals playable. |
| `host-bracket-correct.png` | 11.3 | The *Ergebnis ändern?* dialog listing at least two discarded results. |
| `host-undo.png` | 13 | The undo row with a real step name on the button. |
| `host-shortcuts.png` | 15 | The `?` overview. |

### Beamer scenes

One per scene, in `SCENE_ORDER` (`src/domain/sceneCatalog.ts`) — the order the manual's §16
uses.

| File | Scene | State to capture |
| --- | --- | --- |
| `beamer-1-welcome.png` | `WELCOME` | Before the doors open, with a couple of dozen registered so the count is on the wall. |
| `beamer-2-groups.png` | `GROUP_OVERVIEW` | 40 participants, so the dense grid is what the reader sees. |
| `beamer-3-tables.png` | `TABLE_OVERVIEW` | A mix of occupied, free and `gesperrt`. |
| `beamer-4-draw.png` | `DRAW` | Mid-sequence: about half the slots filled, the rest still empty and dashed, one *Wartet auf Tisch*. Include at least one pairing of a single-digit against a double-digit number — issue #88's criterion is that the two read as peers in separate boxes. |
| `beamer-4-draw-bye.png` | `DRAW` | The `Freilos` reveal (odd field — the 13-group run). |
| `beamer-5-round.png` | `ROUND_BOARD` | One `LÄUFT`, one `BEENDET` with a green winner box and a dimmed red loser box, a non-empty *Warteschlange*. Set the hall up with more tables than the round uses — since issue #87 the unused ones are not on the board, and the shot should show that. **Also save a greyscale copy** — issue #77's acceptance criterion is that the two are still tellable apart with the colour gone. |
| `beamer-6-repechage.png` | `REPECHAGE` | A card in `GEZOGEN`, one `VERZICHTET`, places left on the counter. |
| `beamer-7-naming.png` | `NAMING` | The holding picture. |
| `beamer-8-bracket.png` | `BRACKET` | Full tree, round of 16 decided, `Spiel um Platz 3` visible. |
| `beamer-8-bracket-final.png` | `BRACKET` | Same tree zoomed to *Ab Halbfinale*. |
| `beamer-9-ceremony.png` | `CEREMONY` | The finished podium. |

### Installation

| File | Manual section | State to capture |
| --- | --- | --- |
| `smartscreen-1.png` | 2.1 | The SmartScreen dialog as it first appears, with *Weitere Informationen* not yet clicked. |
| `smartscreen-2.png` | 2.1 | The same dialog expanded, showing *Trotzdem ausführen*. |

These two are worth more than any other shot in the list: §2.1 exists because a host who has
not seen this dialog before will decline it. Capture them on a machine that has never run the
build — once Windows has remembered the choice, the dialog cannot be produced again without
resetting SmartScreen's cache. The clean VM of docs/PACKAGING.md §8 is the place to do it.

## When the shots land

Adding them is a docs change like any other: drop the files into `docs/img/`, insert the image
next to the sketch it belongs with, and delete nothing. Markdown is `.prettierignore`d, so
there is no formatting step. Update the **Status** line at the top of this file when the list
is complete.
