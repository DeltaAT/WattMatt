# Glossary — German ↔ English

Code uses the English term. The UI shows the German term, always via `src/i18n/de-AT.ts`.
Extend this table whenever a new domain concept appears, in the same commit.

## Core entities

| English (code) | German (UI) | Notes |
| --- | --- | --- |
| Tournament | Turnier | |
| Group | Gruppe | Participant unit; label configurable (Gruppe / Team / Spieler) |
| Group number | Gruppennummer | Identity until the naming phase |
| Table | Tisch | |
| Match | Partie | "Spiel" is also acceptable in UI copy |
| Round | Runde | |
| Host | Turnierleitung | Avoid "Host" in German UI |
| Beamer window | Beamer-Ansicht | "Beamer" is the correct AT/DE term for a projector |

## Phases and rounds

| English (code) | German (UI) |
| --- | --- |
| Setup | Vorbereitung |
| Qualifying round | Qualifikationsrunde / Runde 1 |
| Repechage | Hoffnungsrunde |
| Elimination round | Ausscheidungsrunde |
| Naming phase | Namenserfassung |
| Final phase | Finalphase |
| Round of 16 | Achtelfinale |
| Quarter-final | Viertelfinale |
| Semi-final | Halbfinale |
| Final | Finale |
| Third-place match | Spiel um Platz 3 |
| Award ceremony | Siegerehrung |

## States and actions

| English (code) | German (UI) |
| --- | --- |
| Draw (noun) | Auslosung |
| To draw | auslosen |
| Bye | Freilos |
| Winner | Sieger |
| Loser | Verlierer |
| Eliminated | ausgeschieden |
| Advance / move up | nachrücken |
| Bracket | Turnierbaum |
| Free (table) | frei |
| Occupied (table) | belegt |
| Disabled (table) | gesperrt |
| Waiting for table | wartet auf Tisch |
| Running | läuft |
| Finished | beendet |
| Undo | Rückgängig |
| Redo | Wiederholen |
| Action log | Verlauf |
| Blackout | Bildschirm aus |
| Performance mode | Performance-Modus |
| Bracket node | Turnierbaum-Knoten |
| Repechage draw | Auslosung der Hoffnungsrunde |
| Participant label | Teilnehmer-Bezeichnung |

## Files

| English (code) | German (UI) | Notes |
| --- | --- | --- |
| Tournament file | Turnierdatei | One tournament per `.wattmatt` file |
| Tournament library | Turnierordner | `%APPDATA%\WattMatt\tournaments` |
| Backup | Sicherung | `.bak1` … `.bak3` beside the file |
| To save | speichern | |
| Save as | Speichern unter… | |
| To open | öffnen | |
| To close (a tournament) | schließen | |
| Unsaved changes | Ungespeicherte Änderungen | |
| Start screen | Startbildschirm | Shown while no tournament is open |

Stored enum values are **English**, like every other identifier (CLAUDE.md rule 1): the file
holds `ROUND_OF_16` and `GROUP`, and `de-AT.ts` turns them into *Achtelfinale* and *Gruppe*.
See docs/OPEN-QUESTIONS.md #21.

## UI copy conventions

- Address the host with **"Sie"**. Buttons use the infinitive: *Runde starten*,
  *Sieger festlegen*, *Turnier speichern*.
- Austrian spelling: **ß** is kept (`Schließen`), *Jänner* over *Januar* if months appear.
- Umlauts are always written out properly — never `ae`, `oe`, `ue`.
- Error messages say what happened **and** what to do next:
  *"Die Turnierdatei konnte nicht gelesen werden. Öffnen Sie die letzte Sicherung?"*
- Never mix English into German UI text (no "Match starten", no "Bracket anzeigen").
