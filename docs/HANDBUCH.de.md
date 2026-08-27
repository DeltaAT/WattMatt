# WattMatt — Handbuch für die Turnierleitung

Dieses Handbuch ist das einzige Dokument in diesem Ordner, das auf Deutsch geschrieben ist.
Es richtet sich an die Person, die das Turnier leitet, nicht an die Entwicklung.

Wenn Sie WattMatt noch nie gesehen haben: Lesen Sie die Abschnitte 1 bis 4 einmal in Ruhe
durch, gehen Sie danach die [Checkliste vor der Veranstaltung](CHECKLISTE.de.md) durch und
spielen Sie ein Probeturnier mit vier Gruppen. Danach können Sie ein Turnier mit 16 Gruppen
leiten.

Wenn während der Veranstaltung etwas nicht so läuft wie erwartet:
[Wenn etwas nicht funktioniert](PROBLEME.de.md). Diese Seite ist eine Seite lang und zum
Ausdrucken gedacht.

---

## Inhalt

1. [Was WattMatt macht](#1-was-wattmatt-macht)
2. [Installation](#2-installation)
3. [Die beiden Fenster](#3-die-beiden-fenster)
4. [Das Steuerfenster im Überblick](#4-das-steuerfenster-im-überblick)
5. [Vorbereitung: Turnier anlegen](#5-vorbereitung-turnier-anlegen)
6. [Der Beamer](#6-der-beamer)
7. [Qualifikationsrunde](#7-qualifikationsrunde)
8. [Hoffnungsrunde](#8-hoffnungsrunde)
9. [Trostrunde](#9-trostrunde)
10. [Ausscheidungsrunden](#10-ausscheidungsrunden)
11. [Namenserfassung](#11-namenserfassung)
12. [Turnierbaum](#12-turnierbaum)
13. [Siegerehrung](#13-siegerehrung)
14. [Rückgängig machen](#14-rückgängig-machen)
15. [Speichern, Sicherung, Wiederherstellung](#15-speichern-sicherung-wiederherstellung)
16. [Tastenkürzel](#16-tastenkürzel)
17. [Die Beamer-Ansichten im Einzelnen](#17-die-beamer-ansichten-im-einzelnen)
18. [Wo WattMatt seine Dateien ablegt](#18-wo-wattmatt-seine-dateien-ablegt)
19. [Begriffe](#19-begriffe)

---

## 1. Was WattMatt macht

WattMatt leitet ein Ausscheidungsturnier auf einem einzigen Laptop. Sie sagen dem Programm,
wer mitspielt und wie viele Tische es gibt; WattMatt lost die Partien aus, verteilt sie auf
die Tische, hält fest, wer gewonnen hat, und zeigt dem Publikum auf der Leinwand, wo das
Turnier gerade steht.

Der Ablauf eines Abends ist immer derselbe:

```text
Vorbereitung
   ↓
Qualifikationsrunde     alle spielen einmal, die Hälfte scheidet aus
   ↓
Hoffnungsrunde          nur wenn nötig — siehe Abschnitt 8
   ↓
Ausscheidungsrunden     so oft, bis das Feld klein genug ist
   ↓
Namenserfassung         ab hier treten die Verbliebenen unter ihrem Namen an
   ↓
Turnierbaum             Achtelfinale, Viertelfinale, Halbfinale, Finale
   ↓
Siegerehrung
```

Drei Dinge, die Sie über WattMatt wissen sollten:

- **WattMatt braucht kein Internet.** Weder bei der Installation noch im Betrieb. Der Laptop
  darf den ganzen Abend ohne Netzverbindung sein.
- **Sie behalten die Kontrolle.** Nichts wechselt von selbst das Bild auf der Leinwand, außer
  Sie schalten es ausdrücklich ein. Kein Zähler und keine Animation nimmt Ihnen eine
  Entscheidung ab.
- **Alles lässt sich rückgängig machen.** Jeder Klick, den Sie bereuen, lässt sich mit einer
  Taste zurücknehmen. Sie müssen sich vor keinem Knopf fürchten.

---

## 2. Installation

Sie bekommen WattMatt in einer von zwei Ausführungen:

| Datei | Wofür |
| --- | --- |
| `WattMatt-<Version>-setup.exe` | Zum Installieren. Für den Laptop, der öfter im Einsatz ist. |
| `WattMatt-<Version>-portable.exe` | Läuft ohne Installation, auch direkt vom USB-Stick. |

Beide enthalten dasselbe Programm.

### 2.1 Die Warnung von Windows

**Das ist der wichtigste Absatz dieses Kapitels. Lesen Sie ihn, bevor Sie am Abend der
Veranstaltung davorstehen.**

WattMatt ist nicht digital signiert. Windows kennt das Programm deshalb nicht und zeigt beim
ersten Start ein blaues Fenster:

> **Der Computer wurde durch Windows geschützt**
>
> Von Microsoft Defender SmartScreen wurde der Start einer unbekannten App verhindert.

Das bedeutet nicht, dass mit der Datei etwas nicht stimmt. Es bedeutet nur, dass Microsoft das
Programm nicht kennt. So kommen Sie weiter:

1. Auf **Weitere Informationen** klicken. Das ist der kleine Text, nicht der große Knopf.
2. Auf **Trotzdem ausführen** klicken.

Windows merkt sich das. Ab dem zweiten Start fragt es nicht mehr — weder beim
Installationsprogramm noch beim Programm selbst.

> **Tun Sie das einmal zu Hause, nicht vor Publikum.** Eine Warnung, auf die niemand
> vorbereitet ist, wird weggeklickt — und dann startet das Programm nicht.

Haben Sie die Datei aus einem Netzwerkordner oder aus einem Anzeigeprogramm bezogen, kann
Windows zusätzlich ein Kästchen **Entsperren** in den Eigenschaften der Datei anzeigen
(Rechtsklick → *Eigenschaften* → ganz unten). Setzen Sie dort den Haken und bestätigen Sie mit
*OK*. Beim Kopieren von einem USB-Stick passiert das nicht.

### 2.2 Installieren

Doppelklick auf `WattMatt-<Version>-setup.exe`, die Warnung aus 2.1 wegklicken, dem
Installationsprogramm folgen. Es fragt **nicht** nach einem Verwalterkennwort — WattMatt wird
nur für das angemeldete Benutzerkonto eingerichtet.

Danach steht WattMatt im Startmenü, und Turnierdateien lassen sich im Explorer per Doppelklick
öffnen.

### 2.3 Ohne Installation verwenden

`WattMatt-<Version>-portable.exe` können Sie unmittelbar starten, auch vom USB-Stick. Es wird
nichts eingerichtet und nichts eingetragen. Zwei Unterschiede zur Installation:

- Turnierdateien lassen sich nicht per Doppelklick öffnen. Öffnen Sie sie im Programm über
  *Turnier öffnen*.
- Auf einem älteren Windows kann ein Systembestandteil fehlen, den WattMatt zum Anzeigen
  braucht (WebView2). Auf Windows 11 ist er immer vorhanden. Falls beim Start eine Meldung
  dazu erscheint, verwenden Sie stattdessen das Installationsprogramm aus 2.2 — es bringt den
  Bestandteil mit.

### 2.4 Prüfen, ob die Datei unterwegs beschädigt wurde

Wenn Sie zusätzlich eine Datei `SHA256SUMS.txt` bekommen haben, können Sie die Prüfsumme
vergleichen. Öffnen Sie die Eingabeaufforderung im Ordner mit der Datei und tippen Sie:

```text
certutil -hashfile WattMatt-0.1.0-portable.exe SHA256
```

Der angezeigte Wert muss mit der Zeile in `SHA256SUMS.txt` übereinstimmen. Das geht ohne
Netzverbindung.

---

## 3. Die beiden Fenster

WattMatt öffnet zwei Fenster, und sie haben ganz verschiedene Aufgaben:

**Das Steuerfenster** steht auf dem Laptop-Bildschirm. Hier arbeiten Sie. Es ist dicht
beschrieben, weil Sie alles auf einen Blick brauchen.

**Das Beamer-Fenster** läuft im Vollbild auf der Leinwand. Es zeigt nur an — es gibt dort
keine Knöpfe und keinen Mauszeiger. Was darauf zu sehen ist, bestimmen ausschließlich Sie.

Das Beamer-Fenster merkt sich nichts. Wenn es abstürzt oder Sie es versehentlich schließen,
öffnen Sie es einfach neu: Es zeigt sofort wieder genau das Bild, das vorher zu sehen war. Am
Turnier ändert sich dadurch nichts.

Ist kein zweiter Bildschirm angeschlossen, läuft der Beamer als kleines Fenster auf dem Laptop
mit, mit dem Vermerk *Vorschau*. Das Turnier funktioniert dann vollständig — nur sieht es eben
niemand außer Ihnen.

---

## 4. Das Steuerfenster im Überblick

```text
┌─────────────────────────────────────────────────────┬──────────────────────┐
│ Vereinsturnier 2026                Gespeichert 19:04│ Beamer               │
│ [Turnier speichern] [Speichern unter…] [schließen]  │ ┌──────────────────┐ │
├─────────────────────────────────────────────────────┤ │  Live-Vorschau   │ │
│ [Rückgängig: Sieger festgelegt] [Wiederholen]       │ └──────────────────┘ │
├─────────────────────────────────────────────────────┤ Auf der Leinwand: …  │
│                                                     │ [Bildschirm aus]     │
│  Turnierverlauf      wo das Turnier steht           │ [Bild einfrieren]    │
│  Aktuelle Runde      die Partien, die gerade laufen ├──────────────────────┤
│  Hoffnungsrunde      nur wenn sie gebraucht wird    │ Ansicht              │
│  Namenserfassung     nur in der Namensphase         │  1 Willkommen        │
│  Turnierbaum         nur in der Finalphase          │  2 Teilnehmerfeld    │
│  Rundenverlauf       alle bisherigen Runden         │  3 Tische            │
│  Turniereinstellungen                               │  4 Auslosung         │
│  Gruppen             wer mitspielt                  │  5 Runde             │
│  Tische              wo gespielt wird               │  6 Hoffnungsrunde    │
│  Turnier starten     nur in der Vorbereitung        │  7 Namenserfassung   │
│                                                     │  8 Turnierbaum       │
│                                                     │  9 Siegerehrung      │
│                                                     ├──────────────────────┤
│                                                     │ [Automatisch folgen] │
│                                                     │ [Animation übersprin]│
│                                                     │ [Beamer öffnen]      │
│                                                     │ Bildschirm           │
│                                                     │   Laptop-Bildschirm  │
│                                                     │   Beamer     (Aktiv) │
│                                                     │ [Tastenkürzel]       │
│                                                     │ [Protokoll öffnen]   │
└─────────────────────────────────────────────────────┴──────────────────────┘
```

Zwei Dinge dazu:

- **Die rechte Spalte ist immer da**, auch bevor ein Turnier geöffnet ist. Sie können den
  Beamer jederzeit steuern, unabhängig davon, was gerade läuft.
- **Die Bereiche in der Mitte kommen und gehen.** *Hoffnungsrunde*, *Namenserfassung* und
  *Turnierbaum* erscheinen erst, wenn sie an der Reihe sind, und verschwinden wieder. Was Sie
  nicht sehen, brauchen Sie gerade nicht.

---

## 5. Vorbereitung: Turnier anlegen

### 5.1 Turnier anlegen oder öffnen

Nach dem Start sehen Sie den Startbildschirm:

```text
        Turnier starten
        Legen Sie ein neues Turnier an oder öffnen Sie ein gespeichertes.

        Name des Turniers
        ┌─────────────────────────────────────┐
        │ Vereinsturnier 2026                 │
        └─────────────────────────────────────┘
        [ Neues Turnier ]   [ Turnier öffnen ]

        Zuletzt verwendet
          Vereinsturnier 2026
          Probelauf
```

Tippen Sie einen Namen ein und klicken Sie **Neues Turnier**. Das Turnier wird sofort auf der
Festplatte angelegt — Sie müssen nicht daran denken, es zu speichern, bevor es losgeht.

Ein bereits gespeichertes Turnier öffnen Sie über **Turnier öffnen** oder mit einem Klick auf
den Eintrag unter *Zuletzt verwendet*.

### 5.2 Turniereinstellungen

Vier Einstellungen, alle am besten vor dem Start getroffen:

| Einstellung | Was sie bewirkt |
| --- | --- |
| **Name des Turniers** | Steht auf der Leinwand. Der Dateiname ändert sich dadurch **nicht**. |
| **Teilnehmer-Bezeichnung** | *Gruppe*, *Team* oder *Spieler*. Ändert nur, wie WattMatt die Teilnehmenden benennt. |
| **Namen ab Feldgröße** | Ab wie vielen Verbliebenen Namen erfasst werden. Voreinstellung: 16. |
| **Performance-Modus** | Für schwache Grafik oder einen trägen Beamer: Animationen laufen in halber Zeit. Jederzeit umschaltbar. |

Darunter steht der **Startwert der Auslosung**. Diese Zahl können Sie nicht ändern, und das
ist Absicht: Mit ihr lässt sich jede Auslosung im Nachhinein nachvollziehen. Falls jemand
behauptet, die Auslosung sei nicht zufällig gewesen, ist diese Zahl Ihr Beleg.

**Namen ab Feldgröße** verdient einen Satz mehr. Bis zu dieser Feldgröße treten alle unter
ihrer Nummer an — *Gruppe 7* spielt gegen *Gruppe 12*. Sinkt das Feld auf diese Größe, fragt
WattMatt nach den Namen, und ab da steht der Name auf der Leinwand. Bei 16 ist das genau das
Achtelfinale. Sie können den Wert hochsetzen, wenn Sie von Anfang an mit Namen arbeiten
wollen. **Sobald die Namenserfassung begonnen hat, ist der Wert gesperrt** — sonst müssten Sie
mitten im Turnier Namen nachfordern, nach denen nie jemand gefragt wurde.

### 5.3 Tische anlegen

Im Bereich **Tische**:

- **Anzahl Tische** eintippen und **Tische anlegen** — legt gleich mehrere auf einmal an.
- **Tisch hinzufügen** legt einen einzelnen an.
- Jeder Tisch heißt zunächst *Tisch 1*, *Tisch 2* und so weiter. Über das Namensfeld können
  Sie ihn umbenennen, etwa in *Tisch beim Fenster*. Zwei Tische dürfen nicht gleich heißen.
- **Nach oben** und **Nach unten** ändern die Reihenfolge. Das ist auch die Reihenfolge, in
  der WattMatt die Tische bei der Auslosung belegt.
- **Sperren** nimmt einen Tisch aus dem Betrieb, ohne ihn zu löschen — der wackelige Tisch,
  das verschüttete Glas. Ein gesperrter Tisch bekommt keine Partie mehr zugeteilt.
  **Freigeben** macht es rückgängig.
- **Löschen** entfernt ihn ganz.

Sie können Tische **während des ganzen Turniers** anlegen, umbenennen, sperren und löschen.
Ein Tisch geht nicht vor der Veranstaltung kaputt, sondern mittendrin.

Läuft gerade eine Partie auf dem Tisch, den Sie sperren oder löschen wollen, fragt WattMatt,
was mit dieser Partie geschehen soll:

- **Partie zurück in die Warteschlange** — sie wartet auf den nächsten freien Tisch.
- **Partie auf einen freien Tisch verschieben** — Sie wählen den Tisch aus.

Ist kein anderer Tisch frei, geht die Partie in die Warteschlange.

### 5.4 Teilnehmende anlegen

Im Bereich **Gruppen** (oder *Teams* / *Spieler*, je nach Einstellung):

- **Anzahl Gruppen** eintippen und **Gruppen anlegen** — für 16 Gruppen genügt ein Eintrag.
- **Gruppe hinzufügen** legt eine einzelne an.
- Jede Gruppe bekommt eine Nummer, beginnend bei 1. **Diese Nummer bleibt das ganze Turnier
  über gleich** und wird nie ein zweites Mal vergeben. Löschen Sie *Gruppe 3*, rückt niemand
  auf die 3 nach.
- **Löschen** entfernt eine Gruppe — aber nur, solange sie noch nicht ausgelost wurde. Danach
  ist sie in Partien eingetragen und kann das Turnier nur noch verlassen, indem sie verliert
  oder in der Hoffnungsrunde verzichtet.

Auch Teilnehmende können Sie **während des Turniers** nachtragen. Wer zu spät kommt, kommt zu
spät — nicht gar nicht. WattMatt warnt Sie vorher: *Die Auslosung ist bereits gelaufen.* Neu
angelegte Gruppen spielen in den schon ausgelosten Partien nicht mit und kommen erst bei der
nächsten Auslosung dazu.

### 5.5 Prüfung vor dem Start

Ganz unten steht der Bereich **Turnier starten** mit der **Prüfung vor dem Start**. Er sagt
Ihnen, ob es losgehen kann:

```text
   Prüfung vor dem Start
   Alles bereit. Das Turnier kann gestartet werden.

   Erste Runde
   8 Partien in der Qualifikationsrunde

   [ Turnier starten ]
```

Zwei Dinge verhindern den Start:

- **Weniger als zwei Teilnehmende.** *Ein Turnier braucht mindestens zwei Gruppen.*
- **Kein bespielbarer Tisch.** *Es ist kein Tisch bespielbar. Legen Sie einen Tisch an oder
  geben Sie einen gesperrten Tisch frei.* Ein gesperrter Tisch zählt nicht mit.

Zwei Dinge verhindern den Start **nicht**, werden Ihnen aber gesagt:

- **Weniger Tische als Partien.** Dann warten Partien auf einen freien Tisch. WattMatt sagt
  Ihnen vorher, wie viele: *Für 8 Partien stehen nur 3 Tische bereit. Zu Beginn warten 5
  Partien auf einen freien Tisch.* Das ist normal und völlig in Ordnung.
- **Ungerade Teilnehmerzahl.** Dann bekommt eine Gruppe ein **Freilos** und kommt ohne Partie
  weiter. WattMatt weist Sie darauf hin, solange Sie noch jemanden nachtragen könnten.

**Turnier starten** wechselt in die Qualifikationsrunde und macht sonst nichts. Die Auslosung
der ersten Runde ist ein eigener Schritt — Sie entscheiden, wann sie beginnt.

---

## 6. Der Beamer

### 6.1 Beamer öffnen

Schließen Sie den Beamer an und stellen Sie Windows auf **Erweitern** (Windows-Taste + P →
*Erweitern*). **Nicht** auf *Duplizieren*: Beim Duplizieren zeigen beide Bildschirme dasselbe,
und Ihre Steuerung wäre auf der Leinwand zu sehen.

In der rechten Spalte, unter **Bildschirm**, stehen alle erkannten Bildschirme. Ein Klick auf
den gewünschten öffnet das Beamer-Fenster dort im Vollbild — Sie müssen es nicht vorher
öffnen. **Beamer öffnen** nimmt den Bildschirm, den Sie zuletzt gewählt haben — und wenn Sie
noch keinen gewählt haben, den zweiten. Auf den Laptop-Bildschirm legt sich der Beamer nur,
wenn Sie ihn ausdrücklich anklicken.

Die Zeile darunter sagt Ihnen, was gerade der Fall ist:

| Was dort steht | Was es bedeutet |
| --- | --- |
| *Beamer läuft im Vollbild.* | Alles in Ordnung. |
| *Beamer ist geschlossen. Ein zweiter Bildschirm ist bereit.* | Der Beamer ist angeschlossen, das Fenster ist zu. |
| *Beamer ist geschlossen. Es ist kein zweiter Bildschirm angeschlossen.* | Kabel prüfen. |
| *Kein zweiter Bildschirm gefunden. Der Beamer läuft als Fenster-Vorschau auf diesem Laptop.* | Sie können weiterarbeiten, das Publikum sieht nichts. |
| *Der gewählte Bildschirm ist nicht mehr da.* | Das Kabel hat sich gelöst. Sobald es wieder steckt, geht das Bild zurück auf die Leinwand. |
| *Beamer läuft im Vollbild auf dem Laptop-Bildschirm und verdeckt die Steuerung.* | Sie haben den falschen Bildschirm gewählt. Siehe [Wenn etwas nicht funktioniert](PROBLEME.de.md). |

Ist die Leinwand nicht im Seitenverhältnis 16:9, steht dort zusätzlich, dass das Bild mit
Balken angezeigt wird. Das ist kein Fehler: Lieber Balken als ein abgeschnittener Turnierbaum.

Darunter steht **Bildkanal**. Er sagt, ob das Beamer-Fenster noch antwortet:

- *Beamer meldet sich.* — alles gut.
- *Beamer meldet sich nicht. Bild auf der Leinwand prüfen.* — das Fenster ist zwar offen,
  reagiert aber nicht mehr. Schauen Sie zur Leinwand: Steht das Bild? Dann Beamer schließen
  und wieder öffnen.

**Steuerung nach vorne holen** holt das Steuerfenster in den Vordergrund, falls es hinter dem
Beamer-Fenster verschwunden ist.

### 6.2 Die Ansicht wählen

Unter **Ansicht** stehen neun Bilder, jedes mit seiner Ziffer. Ein Klick — oder die Ziffer auf
der Tastatur — legt es auf die Leinwand:

| Ziffer | Ansicht | Zeigt |
| --- | --- | --- |
| 1 | Willkommen | Den Namen des Turniers und die Zahl der angemeldeten Gruppen. Das Bild vor dem Beginn. |
| 2 | Teilnehmerfeld | Alle Teilnehmenden mit Nummer. |
| 3 | Tische | Welcher Tisch frei, belegt oder gesperrt ist. |
| 4 | Auslosung | Die laufende Auslosung, Paarung für Paarung. |
| 5 | Runde | Die Partien der Runde, grün und rot. |
| 6 | Hoffnungsrunde | Der Topf, die gezogenen Nachrücker, die freien Plätze. |
| 7 | Namenserfassung | Ein Wartebild, während Sie tippen. |
| 8 | Turnierbaum | Der Baum der Finalphase. |
| 9 | Siegerehrung | Das Podest. |

Die Reihenfolge ändert sich nie, auch wenn eine Ansicht gerade nichts zu zeigen hat. Ihre Hand
soll die Ziffern lernen können. *Auslosung* und *Runde* sind erst nach der ersten Auslosung
verfügbar; bis dahin steht *Erst nach der ersten Auslosung verfügbar.* daneben.

Über der Vorschau steht immer **Auf der Leinwand: …** — so wissen Sie auch ohne hinzusehen,
was das Publikum gerade sieht.

### 6.3 Automatisch folgen

**Automatisch folgen** ist ein Schalter. Ist er ein, wechselt die Leinwand mit dem Turnier mit:
Sie gehen in die Hoffnungsrunde, die Leinwand zeigt die Hoffnungsrunde.

Wichtig: Das passiert **nur beim Wechsel in eine neue Phase**, nie mittendrin. Wenn Sie den
Turnierbaum auflegen, um darüber zu sprechen, bleibt er stehen, auch wenn währenddessen
Ergebnisse eingetragen werden.

Sobald Sie selbst eine Ansicht wählen, schaltet sich *Automatisch folgen* ab. Danach steht das
Bild, bis Sie etwas anderes wählen. Einschalten müssen Sie es wieder selbst.

### 6.4 Die drei Nothelfer

**Bildschirm aus** (Taste `B`) macht die Leinwand sofort schwarz. Für den Moment, in dem etwas
zu sehen ist, das niemand sehen soll. Nochmals drücken bringt genau das Bild zurück, das
vorher zu sehen war. Der Knopf ist immer an derselben Stelle, ganz oben in der rechten Spalte.

**Bild einfrieren** (Taste `F`) hält die Leinwand an. Sie können in Ruhe weiterarbeiten,
Ergebnisse eintragen, eine Runde auslosen — das Publikum sieht davon nichts und behält das
letzte Bild. **Bild freigeben** lässt es wieder mitlaufen. Solange eingefroren ist, steht
*Eingefroren* über Ihrer Vorschau.

**Animation überspringen** (Leertaste) springt sofort ans Ende einer laufenden Animation. Wenn
die Auslosung zu langsam läuft, weil das Publikum unruhig wird: Leertaste.

---

## 7. Qualifikationsrunde

Ab hier arbeiten Sie fast nur noch im Bereich **Aktuelle Runde**.

### 7.1 Auslosen

```text
   Aktuelle Runde
   Es ist keine Runde offen. Losen Sie die nächste Runde aus.

   [ Auslosung starten ]
```

**Auslosung starten** mischt alle Verbliebenen und bildet Paare. Bei ungerader Anzahl bekommt
die zuletzt gezogene Gruppe ein **Freilos** und ist ohne Partie eine Runde weiter — auf der
Leinwand steht *Freilos — steigt auf*, damit im Saal niemand rätselt.

**Keine Wiederholungen.** Zwei Gruppen, die in diesem Turnier schon einmal gegeneinander
gespielt haben, werden nicht noch einmal zusammengelost. Darum kümmert sich das Programm von
selbst; Sie merken normalerweise nichts davon.

Die Partien werden der Reihe nach auf die freien Tische verteilt. Gibt es mehr Partien als
Tische, kommen die übrigen in die **Warteschlange**.

Legen Sie vorher die Ansicht **Auslosung** (Ziffer `4`) auf die Leinwand, dann sieht das
Publikum die Auslosung mitlaufen. Danach wechseln Sie auf **Runde** (Ziffer `5`).

### 7.2 Während der Runde

```text
   Runde 1        läuft        3 / 8 Partien entschieden

   An den Tischen
   ┌───────────────────────┐  ┌───────────────────────┐
   │ Tisch 1     läuft 04:12│  │ Tisch 2     läuft 01:55│
   │ [ Gruppe 4 ]           │  │ [ Gruppe 2 ]           │
   │      gegen             │  │      gegen             │
   │ [ Gruppe 9 ]           │  │ [ Gruppe 7 ]           │
   └───────────────────────┘  └───────────────────────┘

   Warteschlange                     2 Partien warten auf einen Tisch
     Gruppe 1 gegen Gruppe 11
     Gruppe 5 gegen Gruppe 16

   Entschieden
     Sieger: Gruppe 3      [ Ergebnis ändern ]

   Zwischenstand
     3 weiter · 3 ausgeschieden · 5 Partien offen
     Hoffnungsrunde: Ziel 8 — 1 Platz wird nachbesetzt.

   [ Runde abschließen ]
```

**Einen Sieger festlegen:** Klicken Sie auf der Karte auf die Gruppe, die gewonnen hat. Der
ganze Knopf ist die Gruppe — Sie müssen nicht zielen. Auf der Leinwand bekommt der Sieger sofort
einen kräftigen grünen Rahmen um seine Nummer und ein Hakerl, der Verlierer einen dünnen roten
Rahmen, ein Kreuzerl und wird blasser. Beides zugleich, in einer knappen Drittelsekunde, und
nichts auf der Leinwand verrutscht dabei.

Sobald ein Sieger feststeht, wird der Tisch frei.

**Die nächste Partie starten:** Wartet eine Partie und wird ein Tisch frei, erscheint dort
**Nächste Partie starten**. Das passiert nie von selbst — erst wenn die nächsten Spielenden
tatsächlich am Tisch stehen, klicken Sie.

**Ein Ergebnis korrigieren:** Klicken Sie auf der entschiedenen Karte auf **Ergebnis ändern**
und wählen Sie dann den richtigen Sieger. Der zweite Schritt ist Absicht: Ein einzelner
Fehlklick soll ein fertiges Ergebnis nicht umdrehen. Mit **Ergebnis behalten** brechen Sie ab.

**Der Zwischenstand** rechnet mit, wie viele weiter sind und wie viele ausgeschieden. Die
letzte Zeile sagt Ihnen schon während der Runde, ob eine Hoffnungsrunde nötig wird — oder dass
sie entfällt. Siehe Abschnitt 8.

### 7.3 Runde abschließen

**Runde abschließen** geht erst, wenn jede Partie einen Sieger hat. Fehlt einer, steht der
Grund auf dem Knopf: *3 Partien ohne Sieger. Legen Sie für jede Partie einen Sieger fest.*

Auch nach dem Abschließen können Sie Ergebnisse über **Rückgängig** noch zurücknehmen.

---

## 8. Hoffnungsrunde

### 8.1 Die Regel, in einem Satz für das Publikum

> „Der Turnierbaum braucht eine Zahl, die sich immer wieder halbieren lässt — 8, 16, 32. Nach
> dieser Runde sind wir aber 13. Damit wir auf 16 kommen, ziehen wir aus allen, die gerade
> ausgeschieden sind, drei zurück ins Turnier. Wer gezogen wird, entscheidet selbst, ob er die
> Chance annimmt."

Das ist die ganze Regel. Wenn jemand nachfragt, hier die längere Fassung:

- Der Turnierbaum funktioniert nur mit 2, 4, 8, 16 oder 32 Teilnehmenden. Bei jeder anderen
  Zahl ginge eine der Runden irgendwann nicht mehr auf.
- Nach der Qualifikationsrunde ist die Zahl der Verbliebenen fast nie eine dieser Zahlen.
- Deshalb wird auf die **nächstgrößere** dieser Zahlen aufgefüllt. Sind 13 weiter, ist das
  Ziel 16, und drei Plätze werden nachbesetzt.
- Nachbesetzt wird **nur unter denen, die gerade verloren haben**, und gezogen wird zufällig.
  Niemand wird ausgesucht.
- **Ist die Zahl schon eine dieser Zahlen, entfällt die Hoffnungsrunde vollständig.** Bei 16
  Verbliebenen gibt es keine — das ist keine Bevorzugung, sondern schlicht nicht nötig.

Das gilt **nur nach der Qualifikationsrunde**, also genau einmal pro Turnier. Danach halbiert
sich das Feld sauber, und eine zweite Hoffnungsrunde kann es gar nicht geben.

### 8.2 Ablauf am Bildschirm

Der Bereich **Hoffnungsrunde** erscheint von selbst, sobald er gebraucht wird. Wird er nicht
gebraucht, erscheint er nicht.

```text
   Hoffnungsrunde
   Der Turnierbaum braucht 16 Teilnehmende. Die fehlenden Plätze werden
   unter den Ausgeschiedenen ausgelost.

   Ziel: 16      Im Feld: 13      3 Plätze frei

   [ Hoffnungsrunde starten ]

   Im Feld              Im Topf              Ausgeschieden
     Gruppe 2             Gruppe 5             Gruppe 14
     Gruppe 4             Gruppe 8
     …                    …
```

1. **Hoffnungsrunde starten.** Legen Sie vorher Ansicht `6` auf die Leinwand — das Publikum
   sieht dann alle im Topf.
2. **Nachrücker auslosen.** Eine Karte wird gezogen und hervorgehoben. WattMatt fragt:
   **Nachrücken?**
3. Sie fragen die gezogene Person und klicken:
   - **Nimmt an** — sie ist im Feld, ein Platz weniger frei.
   - **Verzichtet** — sie ist endgültig ausgeschieden und wandert in die Spalte
     *Ausgeschieden*.
4. Zurück zu Schritt 2, bis alle Plätze besetzt sind. Erst entscheiden, dann weiter auslosen —
   der Knopf bleibt bis dahin gesperrt.

Ist das Feld voll, steht dort **Das Feld ist vollständig.**

### 8.3 Wenn der Topf leer wird

Haben so viele verzichtet, dass niemand mehr im Topf steht und trotzdem Plätze frei sind,
fragt WattMatt:

> **Der Topf ist leer**
>
> Es sind noch 2 Plätze frei, aber niemand steht mehr im Topf. Entscheiden Sie, wie das Feld
> gefüllt wird.

Sie haben zwei Möglichkeiten:

- **Freilose vergeben** — die freien Plätze werden in der nächsten Runde als Freilose
  vergeben. Es kommen also entsprechend viele ohne Partie eine Runde weiter. Das Turnier läuft
  sofort weiter. **Das ist die unauffälligere Wahl und im Zweifel die richtige.**
- **Ausgeschiedene erneut zulassen** — alle, die verzichtet haben, kommen neu gemischt zurück
  in den Topf und werden noch einmal gezogen. Sinnvoll, wenn jemand seine Meinung geändert
  hat. Hat niemand verzichtet, steht diese Möglichkeit nicht zur Verfügung.

Für das Publikum: „Es sind nicht genug zurückgekommen, um alle Plätze zu füllen. Die zwei
freien Plätze werden in der nächsten Runde als Freilose vergeben — zwei Paarungen spielen also
nicht, sondern kommen unmittelbar weiter."

---

## 9. Trostrunde

Sobald die Hoffnungsrunde abgeschlossen ist, fragt WattMatt einmal:

```text
┌─────────────────────────────────────────────────────────────┐
│ Trostrunde spielen?                                         │
│                                                             │
│ 8 sind ausgeschieden und könnten eine eigene Trostrunde      │
│ spielen. Der Sieger der Trostrunde kommt nicht ins           │
│ Hauptfeld zurück.                                            │
│                                                             │
│ [ Trostrunde starten ]  [ Keine Trostrunde ]                │
└─────────────────────────────────────────────────────────────┘
```

Die Trostrunde ist **freiwillig**. Sagen Sie *Keine Trostrunde*, läuft der Abend genau so
weiter wie bisher. Die Frage verschwindet dann; falls Sie es sich anders überlegen, machen Sie
die Entscheidung mit *Rückgängig* wieder auf (Abschnitt 14).

### 9.1 Der Satz für das Publikum

> „Wer in Runde 1 ausgeschieden ist und nicht nachgerückt ist, spielt jetzt die Trostrunde —
> ein eigenes kleines Turnier. Der Sieger der Trostrunde kommt **nicht** mehr ins Hauptfeld,
> aber er nimmt einen Titel mit nach Hause."

Sagen Sie den zweiten Halbsatz wirklich. Er ist die einzige Stelle, an der es Missverständnisse
gibt.

### 9.2 Wer dabei ist

Alle, die in Runde 1 verloren haben — **auch die, die in der Hoffnungsrunde verzichtet haben**.
Ein Verzicht bedeutet: nicht ins Hauptfeld. Er bedeutet nicht: nach Hause.

Nicht dabei ist, wer in der Hoffnungsrunde nachgerückt ist. Der spielt im Hauptfeld weiter.

Sind am Ende **weniger als zwei** übrig — weil die Hoffnungsrunde fast alle zurückgeholt hat —,
fragt WattMatt gar nicht erst. Eine Trostrunde mit einer einzigen Gruppe gibt es nicht.

### 9.3 Ablauf

Genau wie eine gewöhnliche Runde (Abschnitt 7): auslosen, Partien an die Tische, Sieger
festlegen, Runde abschließen. Bei ungerader Anzahl gibt es ein Freilos. Zwei Gruppen, die schon
einmal gegeneinander gespielt haben, werden auch hier nicht noch einmal gegeneinander gelost.

Das wiederholt sich, bis **eine** Gruppe übrig ist. Die ist der Sieger der Trostrunde, und
WattMatt schreibt das oben in die Trostrunden-Karte.

Es gibt hier keine zweite Hoffnungsrunde, keinen Turnierbaum, kein Spiel um Platz 3 — und
**keine Namenserfassung**: die Trostrunde bleibt bis zum Schluss bei Nummern. Wenn der Sieger
bei der Siegerehrung mit Namen genannt werden soll, sagen Sie den Namen einfach an.

### 9.4 Zwei Turniere gleichzeitig

Das ist der Teil, der Aufmerksamkeit braucht: ab jetzt laufen **zwei Runden gleichzeitig** —
das Hauptfeld und die Trostrunde. Beide haben ihre eigene Karte im Steuerfenster, untereinander,
beide mit eigenem *Auslosen*, eigener Warteschlange und eigenem *Runde abschließen*.

Die **Tische teilen sich beide**. Ein Tisch, auf dem eine Partie des Hauptfelds läuft, steht in
der Trostrunden-Karte als *belegt* — dort können Sie ihn nicht vergeben, und das ist Absicht.
Wird ein Tisch frei, entscheiden **Sie**, welche Karte ihn bekommt: drücken Sie
*Nächste Partie starten* auf der Karte, aus der die nächste Partie kommen soll.

> **Tipp für den Raum.** Sagen Sie am Anfang der Trostrunde, welche Tische dafür gedacht sind
> („Trostrunde an den beiden hinteren Tischen"), und vergeben Sie sie dann auch so. Das erspart
> Ihnen den ganzen Abend Nachfragen.

*Rückgängig* wirkt immer nur auf den Strang, in dem Sie gerade etwas gemacht haben. Ein Ergebnis
im Hauptfeld zurückzunehmen rührt die Trostrunde nicht an, und umgekehrt.

### 9.5 Auf die Leinwand

Beide Karten haben ihren eigenen Knopf *auf den Beamer*. Die Leinwand zeigt immer **eine**
Runde — die, die Sie zuletzt hingelegt haben. Wechseln Sie ruhig hin und her; das Publikum sieht
an der Überschrift, was es gerade anschaut (*Runde 3* oder *Trostrunde 2*).

---

## 10. Ausscheidungsrunden

Nach der Hoffnungsrunde ist das Feld eine Zahl, die sich sauber halbieren lässt. Ab jetzt
wiederholt sich immer dasselbe:

```text
Auslosung starten → Partien spielen → Sieger festlegen → Runde abschließen
                                  ↓
                        Weiter zur nächsten Phase
```

Das läuft genau wie in Abschnitt 7. Freilose gibt es hier normalerweise keine mehr, und auch
hier werden zwei Gruppen nicht zweimal gegeneinander gelost.

### 10.1 Wenn *Wiederholte Paarungen* erscheint

Sehr selten ist das Feld so klein und so weit gespielt, dass jede mögliche Paarung eine
Wiederholung wäre. Dann fragt WattMatt nach, **bevor** die Auslosung auf die Leinwand geht:

```text
   Wiederholte Paarungen

   2 Paarungen wiederholen sich. Alle anderen Kombinationen wurden in diesem
   Turnier bereits gespielt.
   Es gibt keine Auslosung mehr, in der niemand einem alten Gegner begegnet.
   Diese hier hat die wenigsten Wiederholungen.

   Gruppe 4 gegen Gruppe 9
   Gruppe 2 gegen Gruppe 7

   [ Auslosung so übernehmen ]   [ Abbrechen ]
```

Lesen Sie die Paarungen vor, bevor Sie übernehmen — im Saal fällt es sonst auf und wirkt wie
ein Fehler. **Abbrechen** ändert nichts; beim nächsten Versuch kommt dieselbe Frage wieder.

Die betroffenen Partien tragen für den Rest der Runde die Markierung **Wiederholung** auf
ihrer Karte, damit Sie nicht nachdenken müssen, welche es waren.

Im Bereich **Turnierverlauf** steht, wo Sie sind und was als Nächstes kommt:

```text
   Turnierverlauf
   Ausscheidungsrunden        32 im Feld
   Als Nächstes: Namenserfassung mit 16 Teilnehmenden.

   [ Weiter zur Namenserfassung ]
```

Der Knopf sagt immer, wohin er führt — Sie können ihn vorlesen, bevor Sie ihn drücken. Ist er
gesperrt, steht der Grund darauf, zum Beispiel: *Es sind noch 32 im Feld. Die Finalphase
beginnt bei 16. Losen Sie eine weitere Ausscheidungsrunde aus.*

Unter **Rundenverlauf** stehen alle bisherigen Runden. **Partien anzeigen** klappt eine Runde
auf und zeigt jede Paarung — *Gruppe 4 schlägt Gruppe 9*. Damit beantworten Sie die Frage
„gegen wen habe ich in der zweiten Runde gespielt?" in fünf Sekunden. **Diese Runde auf den
Beamer** legt eine alte Runde auf die Leinwand; an der laufenden Runde ändert das nichts.

---

## 11. Namenserfassung

Sinkt das Feld auf die eingestellte Feldgröße (voreingestellt 16), erscheint der Bereich
**Namenserfassung**.

```text
   Namenserfassung
   Ab jetzt treten die Verbliebenen unter ihrem Namen an.
   Die Nummer bleibt als Kennung daneben stehen.

   Gruppe 2   ┌──────────────────────────────┐
              │ Die Unbesiegbaren            │
              └──────────────────────────────┘
   Gruppe 4   ┌──────────────────────────────┐
              │                              │
              └──────────────────────────────┘
              …
   Mit der Tabulatortaste geht es ins nächste Feld.

   12 von 16 Namen erfasst
   4 Namen fehlen noch. Der Turnierbaum kann erst ausgelost werden,
   wenn alle Namen erfasst sind.
```

Praktisch:

- Nach jedem Namen die **Tabulatortaste** — dann springt der Schreibbalken ins nächste Feld,
  ohne dass Sie zur Maus greifen.
- Ein Name darf höchstens 40 Zeichen haben.
- **Zwei gleiche Namen sind erlaubt.** WattMatt sagt Ihnen zwar *Dieser Name kommt mehrfach
  vor. Das ist erlaubt.*, hindert Sie aber nicht. Zwei Mannschaften dürfen tatsächlich gleich
  heißen.
- Ein leerer Name ist nicht erlaubt.
- Die Nummer bleibt neben dem Namen stehen. Wer die ganze Zeit *Gruppe 7* war, bleibt
  erkennbar.

Während Sie tippen, zeigt die Leinwand ein Wartebild — *Gleich geht es weiter* — und nicht
Ihre halbfertige Liste. Das ist Absicht.

**Während Sie in einem Namensfeld tippen, sind die Tastenkürzel abgeschaltet**, sonst würde ein
`B` im Namen die Leinwand schwarz machen. Sie funktionieren wieder, sobald Sie das Textfeld
verlassen.

---

## 12. Turnierbaum

### 12.1 Auslosen

Sind alle Namen erfasst, erscheint **Turnierbaum auslosen**. Ein Klick verteilt die
Teilnehmenden zufällig auf die Plätze im Baum.

Die Runden heißen nach der Feldgröße:

| Im Feld | Runde |
| --- | --- |
| 16 | Achtelfinale |
| 8 | Viertelfinale |
| 4 | Halbfinale |
| 2 | Finale |

Beginnt Ihre Finalphase mit 8 statt 16, beginnt der Baum eben beim Viertelfinale. Das ist bei
kleinen Turnieren normal.

Auch hier gilt: in der **ersten** Runde des Baums treffen zwei Gruppen nicht noch einmal
aufeinander, wenn sie schon gegeneinander gespielt haben. Ab der zweiten Runde geht das nicht
mehr — wer dort auf wen trifft, entscheiden die Ergebnisse und nicht die Auslosung. Kommt es
dazu, steht **Wiederholung** auf der Partie, und Sie können es im Saal ansagen.

Die beiden Verlierer des Halbfinales spielen das **Spiel um Platz 3**. Es hängt als eigener
Knoten unter dem Baum und wird zur selben Zeit angesetzt wie das Finale.

### 12.2 Partien starten und entscheiden

Jede Partie im Baum bekommt einen Tisch, nach denselben Regeln wie in jeder Runde davor. Auf
jeder Karte steht, was sie gerade tut:

| Wort | Bedeutung |
| --- | --- |
| **Wartet auf Gegner** | Die Partie darunter läuft noch. |
| **Wartet auf Tisch** | Beide stehen fest, es ist kein Tisch frei. |
| **Läuft** | Wird gerade gespielt. |
| **Entschieden** | Der Sieger steht fest. |
| **Freilos** | Kommt ohne Partie weiter. |

Über **Auf Tisch** schicken Sie eine spielbare Partie an einen freien Tisch. Ist keiner frei,
steht dort *Kein Tisch frei.* Die Zeile *3 Partien spielbar* sagt Ihnen, wie viel Sie gerade
in Gang setzen könnten.

Den Sieger legen Sie fest wie in jeder Runde: Klick auf die Karte der Gewinnerin.

### 12.3 Ein Ergebnis im Baum ändern

Das ist der einzige Ort, an dem eine Korrektur etwas kostet. Wenn Sie im Achtelfinale den
falschen Sieger eingetragen haben und das Viertelfinale schon gespielt ist, kann das
Viertelfinale nicht bestehen bleiben — es wurde mit der falschen Person gespielt.

WattMatt sagt Ihnen deshalb vorher genau, was verloren geht:

> **Ergebnis ändern?**
>
> Die Unbesiegbaren wird als Sieger eingetragen. Die folgenden Ergebnisse bauen darauf auf und
> werden verworfen.
>
> - Viertelfinale: Die Unbesiegbaren schlägt Sturm Ost
> - Halbfinale: Sturm Ost schlägt Die Neuen
>
> Rückgängig macht diese Änderung samt der verworfenen Ergebnisse wieder rückgängig.
>
> [ Ändern und verwerfen ]   [ Abbrechen ]

Lesen Sie die Liste, bevor Sie bestätigen. Und keine Sorge: Auch das lässt sich mit
**Rückgängig** wieder zurücknehmen, verworfene Ergebnisse eingeschlossen.

### 12.4 Was die Leinwand zeigt

Unter **Beamer** im Turnierbaum-Bereich wählen Sie, wie viel vom Baum zu sehen ist:

- **Ganzer Baum** — alles, von der ersten Runde bis zum Finale.
- **Ab Viertelfinale**, **Ab Halbfinale**, **Ab Finale** — zeigt nur noch den hinteren Teil,
  damit die letzten Partien den ganzen Bildschirm füllen.

Für die letzten beiden Partien lohnt sich das: Zwei Karten auf einer Leinwand sind deutlich
eindrucksvoller als sechzehn.

### 12.5 Finale abschließen

Sind alle Partien entschieden — Finale und Spiel um Platz 3 —, ist **Finale abschließen**
verfügbar. Ist noch etwas offen, steht der Grund am Knopf: *Es sind noch Partien offen.
Entscheiden Sie zuerst alle Partien.*

---

## 13. Siegerehrung

Das Podest kommt **nie** von selbst. Sie entscheiden, wann es erscheint — Sie halten
vermutlich gerade eine Rede.

Zwei Knöpfe:

- **Siegerehrung starten** legt das Podest auf die Leinwand und baut es von selbst auf:
  zuerst Bronze, eine halbe Sekunde später Silber, dann Gold.
- **Nächsten Platz zeigen** überlässt das Tempo Ihnen. Jeder Druck stellt genau einen
  Platz dazu, in derselben Reihenfolge — Bronze, Silber, Gold. Sprechen Sie den Namen aus,
  dann drücken Sie. Nach Gold passiert nichts mehr; das Podest ist vollständig.

Die Knöpfe lassen sich mischen: Sie können den Aufbau starten und mit **Nächsten Platz
zeigen** dort übernehmen, wo er gerade steht.

Auf dem Podest steht Gold in der Mitte, Silber und Bronze daneben. Der dritte Platz ist die
Siegerin oder der Sieger des **Spiels um Platz 3**. Bei genau zwei Teilnehmenden gibt es
kein Spiel um Platz 3 — das Podest hat dann zwei Stufen, und der erste Druck zeigt Silber.

Ein bewährter Ablauf:

1. **Bildschirm aus** (`B`), solange Sie das Podest vorbereiten.
2. Ansprache halten.
3. `B` — die Leinwand geht auf das Podest.

---

## 14. Rückgängig machen

Direkt unter der Kopfzeile stehen zwei Knöpfe, und sie sagen immer, **was** sie zurücknehmen:

```text
   [ Rückgängig: Sieger festgelegt: Gruppe 4 ]   [ Wiederholen ]
```

Das ist der wichtigste Satz dieses Handbuchs: **Sie können jeden Klick zurücknehmen.** Einen
falschen Sieger, eine Auslosung, eine abgeschlossene Runde, einen gelöschten Tisch, ein
verworfenes Ergebnis im Turnierbaum. Alles.

- **Strg+Z** macht rückgängig.
- **Strg+Y** stellt wieder her.

Weil auf dem Knopf steht, was verschwindet, sehen Sie vor dem Klick, ob Sie den richtigen
Schritt zurücknehmen.

Eine Grenze gibt es: **Der Verlauf beginnt beim geöffneten Turnier.** Schließen Sie ein Turnier
und öffnen es wieder, ist der Verlauf leer. Die Ergebnisse bleiben natürlich alle erhalten —
nur zurücknehmen lassen sie sich dann nicht mehr.

---

## 15. Speichern, Sicherung, Wiederherstellung

### 15.1 WattMatt speichert selbst

**Sie müssen während des Turniers nicht speichern.** WattMatt schreibt nach jeder Entscheidung
von selbst auf die Festplatte, einen Sekundenbruchteil später.

In der Kopfzeile steht, wie es steht:

| Anzeige | Bedeutung |
| --- | --- |
| *Gespeichert 19:04* | Alles auf der Festplatte. |
| *Wird gespeichert…* | Läuft gerade. |
| *Nicht gespeichert* | Es gibt Änderungen, die noch nicht geschrieben sind. Normalerweise nur ganz kurz. |
| *Noch nicht auf der Festplatte* | Ungewöhnlich. Legen Sie über **Speichern unter…** einen Speicherort fest. |

**Turnier speichern** schreibt sofort. **Speichern unter…** legt eine Kopie an einem anderen
Ort ab — etwa auf einem USB-Stick am Ende des Abends.

### 15.2 Sicherungen

Vor jedem Speichern rückt WattMatt die alten Stände weiter: Neben Ihrer Turnierdatei liegen bis
zu drei Sicherungen mit den Endungen `.bak1`, `.bak2` und `.bak3`. `.bak1` ist die jüngste.

Diese Dateien öffnen sich **nicht** per Doppelklick. Wenn WattMatt eine Turnierdatei nicht
lesen kann, bietet es Ihnen von sich aus **Letzte Sicherung öffnen** an — das ist der Weg
dorthin.

### 15.3 Nach einem Absturz

Stürzt der Laptop mitten im Turnier ab oder geht der Strom aus, starten Sie WattMatt einfach
neu. Es meldet sich mit:

> **Turnier wiederherstellen**
>
> WattMatt wurde am 14.03. um 20:41 nicht ordentlich beendet. Das Turnier „Vereinsturnier
> 2026" kann im zuletzt gespeicherten Stand geöffnet werden.
>
> [ Turnier öffnen ]

Ein Klick, und Sie sind zurück — mit allen entschiedenen Partien der laufenden Runde. Es geht
höchstens die eine Entscheidung verloren, die im Moment des Absturzes gefallen ist.

### 15.4 Turnier schließen

**Turnier schließen** beendet nur das Turnier, nicht das Programm. Gibt es ungespeicherte
Änderungen, fragt WattMatt vorher:

- **Speichern und schließen** — der sichere Weg.
- **Änderungen verwerfen** — nur, wenn Sie genau wissen, was Sie verwerfen.

---

## 16. Tastenkürzel

Diese Kürzel gelten im ganzen Steuerfenster. **Während Sie in ein Textfeld tippen, sind sie
abgeschaltet** — sonst würde ein `B` in einem Namen die Leinwand schwarz machen.

| Taste | Wirkung |
| --- | --- |
| **Leertaste** | Laufende Animation überspringen |
| **B** | Bildschirm aus, nochmal für zurück |
| **F** | Bild einfrieren oder freigeben |
| **1 bis 9** | Ansicht auf den Beamer legen |
| **Strg+Z** | Letzte Aktion rückgängig machen |
| **Strg+Y** | Wieder herstellen |
| **?** | Diese Übersicht am Bildschirm |

Die Übersicht mit **?** ist kein Fragefenster: Das Turnier läuft dahinter weiter, und ein Klick
irgendwohin schließt sie wieder.

Zwei Kürzel, die Sie sich merken sollten, wenn Sie sich nur zwei merken:

- **B** — wenn etwas auf der Leinwand steht, das dort nicht hingehört.
- **Strg+Z** — wenn Sie danebengeklickt haben.

---

## 17. Die Beamer-Ansichten im Einzelnen

So sind die neun Ansichten aufgebaut. Das hilft, wenn Sie im Voraus wissen wollen, was das
Publikum zu sehen bekommt.

### 1 — Willkommen

```text
                       Sommerturnier

                            24

                       Gruppen am Start
                          6 Tische bereit
```

Das Bild für die halbe Stunde, in der sich der Saal füllt: der Name des Turniers und die Zahl
der angemeldeten Gruppen, groß genug für die letzte Reihe. Die Zahl wächst mit, während Sie
Gruppen anlegen — sie zuckt kurz auf und der Rest des Bildes bleibt ruhig stehen.

Diese Ansicht liegt von selbst auf der Leinwand, sobald ein Turnier angelegt ist und noch nicht
gestartet wurde. Sie zeigt bewusst **keine** Gruppennummern; wer schon angemeldet ist, steht
unter *Teilnehmerfeld* (Ziffer `2`).

Solange kein Turnier geöffnet ist, steht statt des Turniernamens `WattMatt` und darunter eine
Null.

### 2 — Teilnehmerfeld

```text
   Gruppen
   16 Gruppen am Start

   [ 1] [ 2] [ 3] [ 4]
   [ 5] [ 6] [ 7] [ 8]
   [ 9] [10] [11] [12]
   [13] [14] [15] [16]
```

Alle Teilnehmenden als Kacheln. Die Überschrift richtet sich nach der Teilnehmer-Bezeichnung.
Bei 40 Teilnehmenden werden die Kacheln kleiner und das Gitter breiter — es passt immer alles
auf ein Bild.

### 3 — Tische

```text
   Tische

   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ 1    4    9  │  │ 2    Frei    │  │ 3   Gesperrt │
   └──────────────┘  └──────────────┘  └──────────────┘
```

Wer wo spielt. Die Ansicht für den Moment, in dem das halbe Publikum wissen will, wo es
hinsoll. Links die Tischnummer, daneben groß die beiden Gruppennummern — auf der Leinwand
stehen nur Zahlen, ohne die Wörter *Tisch* und *Gruppe*. Haben Sie einen Tisch umbenannt,
steht Ihr eigener Name dafür da.

### 4 — Auslosung

```text
   Auslosung                                6 von 8 gezogen

   ┌──────────┐  ┌──────────┐  ┌──────────┐
   │    1     │  │    2     │  │  Wartet  │
   │  4    9  │  │  2    7  │  │  3   12  │
   └──────────┘  └──────────┘  └──────────┘

   ┌──────────┐  ┌┄┄┄┄┄┄┄┄┄┄┐  ┌┄┄┄┄┄┄┄┄┄┄┐
   │  Wartet  │  ┄          ┄  ┄          ┄
   │  1   11  │  ┄          ┄  ┄          ┄
   └──────────┘  └┄┄┄┄┄┄┄┄┄┄┘  └┄┄┄┄┄┄┄┄┄┄┘
```

Alle Plätze stehen von Anfang an da — leer und gestrichelt. Etwa jede halbe Sekunde füllt sich
einer davon: die Paarung erscheint einfach, ohne Zahlenrattern, und danach bewegt sich diese
Karte nie wieder. Bei 32 Paarungen dauert die ganze Auslosung rund 16 Sekunden.

Auf jeder Karte steht oben klein der Tisch — nur seine Nummer — oder **Wartet auf Tisch**, und
darunter groß die beiden Gruppennummern. Ein Freilos bekommt eine eigene Farbe und das Wort
*Freilos — steigt auf*.

Vor der Ziehung ist **keine** Nummer zu sehen: der Saal erfährt jede Paarung in dem Moment, in
dem sie fällt. Mit der **Leertaste** springen Sie sofort auf das fertige Bild.

### 5 — Runde

```text
   Runde 1

   1                          2                        Warteschlange
   ┌────────────────────┐    ┌────────────────────┐    ┌────────────┐
   │       LÄUFT        │    │      BEENDET       │    │   WARTET   │
   │  ┌──────────┐   │    │  ╔══════════╗   │    │ ┌──────┐ │
   │  │  ·    4  │   │    │  ║  ✓    2  ║   │    │ │ ·  1 │ │
   │  └──────────┘   │    │  ╚══════════╝   │    │ └──────┘ │
   │  ┌──────────┐   │    │  ┌──────────┐   │    │ ┌──────┐ │
   │  │  ·    9  │   │    │  │  ✗    7  │   │    │ │ · 11 │ │
   │  └──────────┘   │    │  └──────────┘   │    │ └──────┘ │
   └────────────────────┘    └────────────────────┘    └────────────┘
```

Das Bild, das den größten Teil des Abends auf der Leinwand steht. Über jeder Spalte steht die
Tischnummer, auf den Karten stehen die Gruppennummern — groß, weil auf der Leinwand kein Wort
davorsteht. Jede Karte trägt oben **WARTET**, **LÄUFT** oder **BEENDET**.

**Das Ergebnis steckt im Kästchen um die Nummer.** Der Sieger bekommt einen kräftigen grünen
Rahmen und ein Hakerl, der Ausgeschiedene einen dünnen roten Rahmen, ein Kreuzerl und wird
insgesamt blasser. Wörter wie *Sieger* stehen nicht mehr dabei — dafür sind die Zahlen jetzt
groß genug für die letzte Reihe.

Auf die Farbe allein ist dabei bewusst kein Verlass: etwa jeder zwölfte Mann unterscheidet Rot
und Grün schlecht, und ein heller Saal wäscht die Farben ohnehin aus. Deshalb sind Sieger und
Verlierer auch **ohne Farbe** auseinanderzuhalten — an der Rahmenstärke, an der Helligkeit und
am Zeichen. Die Nummer selbst bleibt in beiden Fällen gut lesbar.

### 6 — Hoffnungsrunde

```text
   Hoffnungsrunde              Ziel: 16        Noch 2 Plätze frei

   Im Topf                                    │  Weiter
                                              │
   [ 5 IM TOPF   ] [ 8 GEZOGEN   ]            │   [ 3 NACHGERÜCKT ]
   [14 VERZICHTET] [19 IM TOPF   ]            │   [ 7 NACHGERÜCKT ]
```

Links der Topf, rechts die, die es zurückgeschafft haben — beides als Gruppennummern, ohne das
Wort davor. Jede Karte sagt in Worten, was mit ihr passiert ist: **IM TOPF**, **GEZOGEN**,
**NACHGERÜCKT**, **VERZICHTET**. Oben rechts steht mit, wie viele Plätze noch frei sind.

### 7 — Namenserfassung

```text
                    Gleich geht es weiter
                 Die Finalphase wird vorbereitet.
                    16 Gruppen in der Finalphase
```

Ein Wartebild, mehr nicht. Es zeigt bewusst **nicht** die Namen, die Sie gerade eintippen.

### 8 — Turnierbaum

```text
   Achtelfinale                            16 in der Finalphase

   Achtelfinale    Viertelfinale   Halbfinale
   ┌──────────┐
   │ Adler    │──┐
   │ SIEGER   │  │ ┌──────────┐
   ├──────────┤  └─┤ Adler    │──┐
   │ Falken   │    ├──────────┤  │ ┌──────────┐
   │ AUSGESCH.│    │ Offen    │  └─┤ Offen    │
   └──────────┘    └──────────┘    └──────────┘

                                   Spiel um Platz 3
                                   ┌──────────┐
                                   │ Offen    │
                                   └──────────┘
```

Der Baum wächst von links nach rechts. Ein Platz, den noch niemand erreicht hat, heißt
**Offen**. Über **Beamer** im Steuerfenster können Sie auf den hinteren Teil umschalten.

### 9 — Siegerehrung

```text
   Siegerehrung

                     ┌──────────────┐
                     │              │
      ┌───────────┐  │    Adler     │  ┌──────────┐
      │  Falken   │  │              │  │  Sturm   │
      └───────────┘  └──────────────┘  └──────────┘
```

Das Podest: Gold in der Mitte, höher als die beiden anderen.

---

## 18. Wo WattMatt seine Dateien ablegt

Alles liegt unter `%APPDATA%\WattMatt`. Diesen Pfad können Sie im Explorer oben in die
Adresszeile eintippen.

| Was | Wo |
| --- | --- |
| Turniere | `%APPDATA%\WattMatt\tournaments` |
| Sicherungen | direkt neben der Turnierdatei, als `.bak1`, `.bak2`, `.bak3` |
| Protokoll | `%APPDATA%\WattMatt\logs` |

Das **Protokoll** ist eine technische Mitschrift — kein Turnierstand. Es hilft der Entwicklung,
wenn etwas schiefgegangen ist. Der Knopf **Protokoll öffnen** ganz unten in der rechten Spalte
öffnet den Ordner; darunter steht der Pfad, falls der Knopf einmal nicht funktioniert.

Ein Turnier weiterzugeben heißt: die `.wattmatt`-Datei kopieren. Mehr braucht es nicht.

---

## 19. Begriffe

| Wort | Bedeutung |
| --- | --- |
| **Gruppe / Team / Spieler** | Eine teilnehmende Einheit. Welches Wort verwendet wird, stellen Sie ein. |
| **Partie** | Ein Spiel zwischen zwei Teilnehmenden. |
| **Tisch** | Ein Platz, an dem gespielt wird. *frei*, *belegt* oder *gesperrt*. |
| **Runde** | Alle Partien, die gemeinsam ausgelost wurden. |
| **Auslosung** | Das zufällige Bilden der Paarungen. |
| **Freilos** | Kommt ohne Partie eine Runde weiter, weil die Zahl nicht aufgeht. |
| **Qualifikationsrunde** | Die erste Runde. Alle spielen einmal. |
| **Hoffnungsrunde** | Die zweite Chance für Ausgeschiedene. Siehe Abschnitt 8. |
| **Nachrücker** | Wer in der Hoffnungsrunde gezogen wurde. |
| **Topf** | Alle, die für die Hoffnungsrunde in Frage kommen. |
| **Ausscheidungsrunde** | Jede Runde nach der Hoffnungsrunde bis zur Finalphase. |
| **Namenserfassung** | Die Phase, in der aus Nummern Namen werden. |
| **Finalphase** | Alles ab dem Turnierbaum. |
| **Turnierbaum** | Achtelfinale bis Finale, als Baum dargestellt. |
| **Spiel um Platz 3** | Zwischen den beiden Verlierern des Halbfinales. |
| **Siegerehrung** | Das Podest am Ende. |
| **Warteschlange** | Partien, die auf einen freien Tisch warten. |
| **Zwischenstand** | Wie viele weiter, wie viele ausgeschieden, wie viele offen. |
| **Beamer-Ansicht** | Eines der neun Bilder, die auf die Leinwand können. |
| **Bildschirm aus** | Die Leinwand sofort schwarz schalten. Taste `B`. |
| **Bild einfrieren** | Die Leinwand anhalten, während Sie weiterarbeiten. Taste `F`. |
| **Automatisch folgen** | Die Leinwand wechselt mit der Turnierphase mit. |
| **Verlauf** | Die Liste Ihrer Schritte, die *Rückgängig* zurückgeht. |
| **Protokoll** | Die technische Mitschrift für den Fall eines Fehlers. |
| **Startwert der Auslosung** | Die Zahl, mit der sich jede Auslosung nachvollziehen lässt. |

---

## Und wenn doch etwas schiefgeht

- [Wenn etwas nicht funktioniert](PROBLEME.de.md) — eine Seite, zum Ausdrucken.
- [Checkliste vor der Veranstaltung](CHECKLISTE.de.md) — eine Seite, zum Abhaken.
