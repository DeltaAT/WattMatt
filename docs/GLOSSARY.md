# Glossary — German ↔ English

Code uses the English term. The UI shows the German term, always via `src/i18n/de-AT.ts`.
Extend this table whenever a new domain concept appears, in the same commit.

## Core entities

| English (code) | German (UI) | Notes |
| --- | --- | --- |
| Tournament | Turnier | |
| Group | Gruppe | Participant unit; label configurable (Gruppe / Team / Spieler) |
| Team | Team | The `TEAM` participant label; plural `Teams` |
| Player | Spieler | The `PLAYER` participant label; plural is the same word |
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
| Elimination rounds (the phase) | Ausscheidungsrunden | Plural where the host reads their current position (issue #22) |
| Phase panel | Turnierverlauf | Where the tournament stands, and the one control that moves it on |
| Round history | Rundenverlauf | Every round of the evening, browsable and projectable |
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
| Table occupancy board | Tischbelegung |
| To block a table | sperren |
| To release a table | freigeben |
| Versus (between two groups) | gegen |
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
| Tournament settings | Turniereinstellungen |
| To start the tournament | Turnier starten |
| Pre-start check | Prüfung vor dem Start |
| Naming threshold (`settings.namingAt`) | Namen ab Feldgröße |
| RNG seed | Startwert der Auslosung |
| Group overview (beamer scene) | Gruppen / Teams / Spieler | Headed by the participant label itself |
| Round control panel | Aktuelle Runde | The host's screen for a running round (issue #17) |
| Match queue | Warteschlange | The matches waiting for a table |
| Round state `DRAWN` / `RUNNING` / `CLOSED` | ausgelost / läuft / abgeschlossen | |
| To start the draw | Auslosung starten | |
| To start the next match | Nächste Partie starten | Offered on a table that has come free |
| To close the round | Runde abschließen | |
| To correct a result | Ergebnis ändern | Needs a second, deliberate interaction |
| Live round summary | Zwischenstand | Winners, losers and the repechage target |
| Repechage candidate | Nachrücker | The loser a repechage draw has just produced (issue #21) |
| To draw a candidate | Nachrücker auslosen | |
| The pot of losers | Topf | Everybody eligible for a second chance |
| To accept the place | Nimmt an | One of the two answers to a draw |
| To decline the place | Verzichtet | The other; a decision, not a pass |
| Candidates still in the field | Im Feld | The winners column, on both screens |
| Places still open | Plätze frei | The counter the whole `REPECHAGE` scene is about |
| To hand out byes (§4 fallback 1) | Freilose vergeben | Always available, so the phase can always be left |
| To readmit the declined (§4 fallback 2) | Ausgeschiedene erneut zulassen | |
| To move to the next phase | Weiter zur … | Names the phase it leads to, never a bare *Weiter* (issue #22) |
| The field carried on | Im Feld | How many the phase hands to the next one |
| To show the pairings of a past round | Partien anzeigen | |
| To project a past round | Diese Runde auf den Beamer | Changes the picture only; the running round carries on |

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
