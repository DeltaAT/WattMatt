import { pluralizeDeAT } from '@/i18n/plural';

/**
 * Every user-visible string in WattMatt lives here (CLAUDE.md §1).
 *
 * A leaf is either a plain string, or a function that takes a params object
 * and returns one — the latter for text that needs a count or a name spliced
 * in (`t('round.title', { n: 2 })`, docs/GLOSSARY.md). `t()` in `@/i18n/t`
 * resolves either kind by dotted path.
 *
 * Terminology follows docs/GLOSSARY.md; copy follows its "UI copy
 * conventions" section (Sie-form, infinitive buttons, no English loanwords).
 */
export const deAT = {
  app: {
    name: 'WattMatt',
    bootstrapNotice: 'Grundgerüst steht. Turnierfunktionen folgen.',
  },

  common: {
    cancel: 'Abbrechen',
    /**
     * Closes a message that reports something already over. Distinct from
     * `cancel`, which calls off an action the host could still go through with.
     */
    dismiss: 'Ausblenden',
  },

  /**
   * Taking a decision back (issue #11, CLAUDE.md golden rule 6).
   *
   * The buttons name the step they would take rather than saying only
   * "Rückgängig": the host misclicks during a live event, and the one thing
   * they need before pressing it again is what is about to disappear.
   */
  undo: {
    undo: 'Rückgängig',
    redo: 'Wiederholen',
    /** With a step to take: the button reads the decision it would take back. */
    undoStep: (params: { label: string }) => `Rückgängig: ${params.label}`,
    redoStep: (params: { label: string }) => `Wiederholen: ${params.label}`,

    /**
     * Why the button is doing nothing, on the button itself.
     *
     * The history does not reach across a tournament: opening or closing one
     * starts it over, because the steps behind it describe a tournament that is
     * no longer on the screen (docs/OPEN-QUESTIONS.md #20).
     */
    nothingToUndo:
      'Es gibt nichts rückgängig zu machen. Der Verlauf beginnt beim geöffneten Turnier.',
    nothingToRedo: 'Es wurde nichts rückgängig gemacht, das wiederholt werden könnte.',

    /**
     * What the actions call themselves on the stack. One entry per action that
     * commits, added by the issue that adds the action.
     */
    action: {
      /** The example from issue #11; issue #17 wires the action itself. */
      matchWinnerSet: (params: { group: number }) => `Sieger festgelegt: Gruppe ${params.group}`,
      sceneShown: 'Beamer-Ansicht gewechselt',

      /** Tables (issue #13). Each names the table, because a host taking a step
       * back needs to know which piece of furniture is about to move. */
      tablesAdded: (params: { n: number }) =>
        `${pluralizeDeAT(params.n, 'Tisch', 'Tische')} angelegt`,
      tableRenamed: (params: { label: string }) => `Tisch umbenannt: ${params.label}`,
      tableMoved: (params: { label: string }) => `Tisch verschoben: ${params.label}`,
      tableRemoved: (params: { label: string }) => `Tisch gelöscht: ${params.label}`,
      tableDisabled: (params: { label: string }) => `Tisch gesperrt: ${params.label}`,
      tableEnabled: (params: { label: string }) => `Tisch freigegeben: ${params.label}`,
      blackout: 'Bildschirm ausgeschaltet',
      autoFollowOn: 'Beamer folgt dem Turnier',
      autoFollowOff: 'Beamer wird von Hand gesteuert',
    },
  },

  /** Everything around the `.wattmatt` file itself (docs/FILE-FORMAT.md). */
  file: {
    /** The file-type row of the native open and save dialogs. */
    filterLabel: 'WattMatt-Turnier',
    openDialogTitle: 'Turnier öffnen',
    saveDialogTitle: 'Turnier speichern unter',
    /**
     * The stem used when a tournament name yields no usable file name — a name
     * made only of characters Windows refuses, or a reserved device name.
     */
    fallbackName: 'Turnier',

    save: 'Turnier speichern',
    saveAs: 'Speichern unter…',
    close: 'Turnier schließen',

    /**
     * The discreet state line beside the buttons (issue #10). A word and a time,
     * never a modal: the host has to be able to answer "is this on disk?" from
     * across the room while doing something else.
     */
    stateSaved: 'Gespeichert',
    stateSavedAt: (params: { time: string }) => `Gespeichert ${params.time}`,
    stateSaving: 'Wird gespeichert…',
    stateModified: 'Nicht gespeichert',
    stateUnwritten: 'Noch nicht auf der Festplatte',

    /** Offered next to a file that could not be read (docs/FILE-FORMAT.md rule 1). */
    openBackup: 'Letzte Sicherung öffnen',
    noBackup: 'Es ist keine Sicherung vorhanden.',

    /**
     * Reported after a file from an older WattMatt was brought up to date
     * (docs/FILE-FORMAT.md rule 7, issue #12).
     *
     * A notice and not an error: nothing went wrong, and the tournament is
     * open. It is said out loud all the same, because the file the host has on
     * the stick is about to be written in a format their other laptop may not
     * read — and because the copy of the original is only useful to someone who
     * knows it is there (CLAUDE.md golden rule 3).
     *
     * One sentence and no heading, unlike `recovery` below: every notice in the
     * `FileNotice` strip is a single line, and a heading only this one carried
     * would make it look like the more important of the two things the host can
     * be told there.
     */
    migrated: (params: { from: number }) =>
      `Die Datei wurde mit einer älteren Version von WattMatt (Format ${params.from}) angelegt und beim Öffnen auf das aktuelle Format gebracht. Die ursprüngliche Datei liegt unverändert daneben.`,

    /**
     * Offered when the last session did not exit cleanly (docs/FILE-FORMAT.md
     * rule 5). An offer, not an error: nothing is broken, there is simply a
     * tournament waiting where the host left it.
     */
    recovery: {
      title: 'Turnier wiederherstellen',
      body: (params: { name: string; at: string }) =>
        `WattMatt wurde am ${params.at} nicht ordentlich beendet. Das Turnier „${params.name}“ kann im zuletzt gespeicherten Stand geöffnet werden.`,
      open: 'Turnier öffnen',
    },

    unsaved: {
      title: 'Ungespeicherte Änderungen',
      body: 'Das Turnier wurde seit der letzten Speicherung geändert. Speichern Sie, bevor Sie es schließen.',
      saveAndClose: 'Speichern und schließen',
      discard: 'Änderungen verwerfen',
    },
  },

  startScreen: {
    title: 'Turnier starten',
    subtitle: 'Legen Sie ein neues Turnier an oder öffnen Sie ein gespeichertes.',
    nameLabel: 'Name des Turniers',
    namePlaceholder: 'Vereinsturnier 2026',
    create: 'Neues Turnier',
    open: 'Turnier öffnen',
    recentTitle: 'Zuletzt verwendet',
    recentEmpty: 'Es ist noch kein Turnier gespeichert.',
    /** The library the recent list is read from, shown so it can be found. */
    libraryHint: (params: { path: string }) => `Ordner: ${params.path}`,
  },

  /**
   * Every entry here says what happened **and** what to do next
   * (docs/GLOSSARY.md "UI copy conventions"). Enforced by de-AT.test.ts: a
   * host reading an error mid-event has no time to work out the next step.
   */
  error: {
    fileUnreadable:
      'Die Turnierdatei konnte nicht gelesen werden. Öffnen Sie die letzte Sicherung.',
    fileInvalid:
      'Die Turnierdatei passt nicht zum erwarteten Format. Öffnen Sie die letzte Sicherung.',
    /**
     * A file from a newer WattMatt (docs/FILE-FORMAT.md rule 7). The way out is
     * the newer version, not a backup: the rotated backups beside the file were
     * written by the same build and are just as unreadable here.
     */
    fileFromNewerVersion:
      'Diese Datei stammt aus einer neueren Version von WattMatt. Öffnen Sie das Turnier auf einem Gerät mit der neueren Version.',
    fileMigrationFailed:
      'Die Turnierdatei konnte nicht auf das aktuelle Format gebracht werden. Öffnen Sie die letzte Sicherung.',
    saveFailed:
      'Das Turnier konnte nicht gespeichert werden. Prüfen Sie den Speicherort und versuchen Sie es erneut.',
    fileNotWritten:
      'Das neue Turnier liegt noch nicht auf der Festplatte. Wählen Sie über „Speichern unter…“ einen Speicherort.',
    fileMissing:
      'Die Turnierdatei ist an diesem Ort nicht mehr vorhanden. Prüfen Sie, ob der Datenträger noch angesteckt ist.',
    fileLocked:
      'Auf die Turnierdatei darf nicht zugegriffen werden. Schließen Sie andere Programme, die sie geöffnet haben.',
    autosaveFailed:
      'Das Turnier wird gerade nicht automatisch gespeichert. Wählen Sie über „Speichern unter…“ einen anderen Speicherort.',
  },

  tournament: {
    label: 'Turnier',
    /** docs/GLOSSARY.md: avoid "Host" in German UI — "Turnierleitung" instead. */
    hostLabel: 'Turnierleitung',
  },

  phase: {
    setup: 'Vorbereitung',
    qualifyingRound: 'Qualifikationsrunde',
    repechage: 'Hoffnungsrunde',
    eliminationRound: 'Ausscheidungsrunde',
    namingPhase: 'Namenserfassung',
    finalPhase: 'Finalphase',
  },

  bracket: {
    label: 'Turnierbaum',
    roundOf16: 'Achtelfinale',
    quarterFinal: 'Viertelfinale',
    semiFinal: 'Halbfinale',
    final: 'Finale',
    thirdPlaceMatch: 'Spiel um Platz 3',
    awardCeremony: 'Siegerehrung',
  },

  group: {
    label: 'Gruppe',
    numberLabel: 'Gruppennummer',
    /** The identity of a participant until the naming phase (§0). */
    numbered: (params: { n: number }) => `Gruppe ${params.n}`,
    /** A group id that no longer names a group — a file repaired by hand. */
    unknown: 'Unbekannt',
    /** "1 Gruppe" / "5 Gruppen" — German pluralisation via @/i18n/plural. */
    count: (params: { n: number }) => pluralizeDeAT(params.n, 'Gruppe', 'Gruppen'),
  },

  /**
   * Tables and the live occupancy board (issue #13).
   *
   * The board is read at a glance from across the room, so its words are short
   * and its status words are the three of docs/TOURNAMENT-RULES.md §0 and
   * nothing else.
   */
  table: {
    label: 'Tisch',
    free: 'frei',
    occupied: 'belegt',
    disabled: 'gesperrt',
    waitingForTable: 'wartet auf Tisch',

    sectionLabel: 'Tische',
    boardLabel: 'Tischbelegung',
    /** "1 Tisch" / "5 Tische". */
    count: (params: { n: number }) => pluralizeDeAT(params.n, 'Tisch', 'Tische'),
    /** The name a table is created with; the host renames it if the room differs. */
    defaultLabel: (params: { n: number }) => `Tisch ${params.n}`,
    empty: 'Es ist noch kein Tisch angelegt. Legen Sie mindestens einen Tisch an.',

    add: 'Tisch hinzufügen',
    /** The "Anzahl Tische" quick-add of issue #13. */
    quickAddLabel: 'Anzahl Tische',
    quickAdd: 'Tische anlegen',

    nameLabel: 'Tischbezeichnung',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    disable: 'Sperren',
    enable: 'Freigeben',
    remove: 'Löschen',

    /**
     * Beside the match on the board: "läuft 12:31".
     *
     * Not "läuft seit 12:31": `duration` is elapsed time, and "seit" in front
     * of a `mm:ss` reads as a clock time on a board that is glanced at from
     * across the room — the one reading the host must not have to double-check
     * mid-round.
     */
    runningFor: (params: { duration: string }) => `läuft ${params.duration}`,
    /** A table that says it is busy with a match nobody can find any more. */
    unknownMatch: 'Partie nicht auffindbar',
    showOnBeamer: 'Tische auf den Beamer',

    /**
     * The question a host is asked before a table with a match on it goes away.
     *
     * There is no "leave it there": the table is going, so the match has to go
     * somewhere, and the host says where.
     */
    occupiedDialog: {
      title: 'Auf diesem Tisch läuft eine Partie',
      removeBody: (params: { label: string }) =>
        `Der Tisch „${params.label}“ soll gelöscht werden. Entscheiden Sie, was mit der laufenden Partie geschieht.`,
      disableBody: (params: { label: string }) =>
        `Der Tisch „${params.label}“ soll gesperrt werden. Entscheiden Sie, was mit der laufenden Partie geschieht.`,
      requeue: 'Partie zurück in die Warteschlange',
      moveTo: 'Partie auf einen freien Tisch verschieben',
      moveTargetLabel: 'Freier Tisch',
      noFreeTable: 'Es ist kein anderer Tisch frei. Die Partie geht zurück in die Warteschlange.',
    },
  },

  match: {
    label: 'Partie',
    running: 'läuft',
    finished: 'beendet',
    /** Between the two groups of a match: "Gruppe 4 gegen Gruppe 9". */
    versus: 'gegen',
  },

  round: {
    label: 'Runde',
    title: (params: { n: number }) => `Runde ${params.n}`,
  },

  draw: {
    label: 'Auslosung',
    action: 'auslosen',
  },

  outcome: {
    winner: 'Sieger',
    loser: 'Verlierer',
    eliminated: 'ausgeschieden',
    advance: 'nachrücken',
    bye: 'Freilos',
  },

  beamer: {
    /** Shown on the beamer itself while no scene has been selected. */
    idleTitle: 'WattMatt',
    idleNotice: 'Bereit.',
    /** The windowed preview must be unmistakable, even from across the room. */
    previewBadge: 'Vorschau',
    /**
     * Shown for a scene the beamer knows about but cannot draw yet. The scene
     * components arrive with issues #18, #19, #25 and #27.
     */
    scenePending: 'Ansicht wird vorbereitet.',

    /** The `TABLE_OVERVIEW` scene: who plays where (issue #13). */
    tableOverview: {
      title: 'Tische',
      free: 'Frei',
      disabled: 'Gesperrt',
      empty: 'Es sind keine Tische angelegt.',
    },
  },

  beamerControl: {
    sectionLabel: 'Beamer',
    open: 'Beamer öffnen',
    close: 'Beamer schließen',
    monitorsLabel: 'Bildschirm',
    primaryMonitor: 'Laptop-Bildschirm',
    unnamedMonitor: 'Unbenannter Bildschirm',
    activeMonitor: 'Aktiv',
    noMonitors: 'Keine Bildschirme erkannt.',
    focusHost: 'Steuerung nach vorne holen',
    blackout: 'Bildschirm aus',
    performanceMode: 'Performance-Modus',

    status: {
      closed: 'Beamer ist geschlossen. Ein zweiter Bildschirm ist bereit.',
      closedNoSecondMonitor:
        'Beamer ist geschlossen. Es ist kein zweiter Bildschirm angeschlossen.',
      projected: 'Beamer läuft im Vollbild.',
      projectedOnPrimary:
        'Beamer läuft im Vollbild auf dem Laptop-Bildschirm und verdeckt die Steuerung.',
      previewNoSecondMonitor:
        'Kein zweiter Bildschirm gefunden. Der Beamer läuft als Fenster-Vorschau auf diesem Laptop.',
      previewMonitorLost:
        'Der gewählte Bildschirm ist nicht mehr da. Der Beamer läuft als Fenster-Vorschau, bis der Beamer wieder angesteckt wird.',
    },

    /**
     * Whether the beamer's WebView is still answering. Distinct from whether
     * the window is open: a live window with a dead renderer shows the audience
     * a frozen picture and reports itself as fine.
     */
    liveness: {
      label: 'Bildkanal:',
      alive: 'Beamer meldet sich.',
      silent: 'Beamer meldet sich nicht. Bild auf der Leinwand prüfen.',
      notRunning: 'Beamer ist geschlossen.',
    },

    letterboxNotice:
      'Dieser Bildschirm ist nicht 16:9. Das Bild wird mit Balken angezeigt, statt umgebrochen zu werden.',
  },
} as const;

export type Locale = typeof deAT;
