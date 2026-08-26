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
      /**
       * The round panel (issue #17). Each names its subject — the participant
       * whose result is about to disappear, the table the next pair is about to
       * leave again — because a host reaching for undo during a live event is
       * looking for one decision among the dozen they have just made.
       *
       * `matchWinnerSet` is the example from issue #11 and keeps the wording it
       * was written with, spelt in the words this tournament uses.
       */
      matchWinnerSet: (params: { participant: string }) =>
        `Sieger festgelegt: ${params.participant}`,
      matchWinnerCorrected: (params: { participant: string }) =>
        `Sieger geändert: ${params.participant}`,
      matchStarted: (params: { table: string }) => `Partie gestartet: ${params.table}`,
      roundDrawn: (params: { round: string }) => `Ausgelost: ${params.round}`,
      roundClosed: (params: { round: string }) => `Runde abgeschlossen: ${params.round}`,
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
      /**
       * Groups (issue #14). Each is handed the participant wording it needs —
       * `de.participant[label]` — because the host reads the undo button in the
       * words they chose for this tournament, not in the code's.
       */
      groupsAdded: (params: { participants: string }) => `${params.participants} angelegt`,
      groupRemoved: (params: { participant: string }) => `${params.participant} gelöscht`,
      participantLabelSet: (params: { participants: string }) =>
        `Bezeichnung geändert: ${params.participants}`,

      /**
       * Settings and the start of the tournament (issue #15). The threshold and
       * the name are read back out of the tournament, so the button says what
       * the host is about to lose rather than what they typed.
       */
      tournamentRenamed: (params: { name: string }) => `Turnier umbenannt: ${params.name}`,
      namingAtSet: (params: { n: number }) => `Namen ab ${params.n} Teilnehmenden`,
      performanceModeOn: 'Performance-Modus eingeschaltet',
      performanceModeOff: 'Performance-Modus ausgeschaltet',
      tournamentStarted: 'Turnier gestartet',

      /**
       * The `Hoffnungsrunde` (issue #21). Each names the participant it is
       * about, because the host reaching for undo has just said a number out
       * loud to the room and needs to see the same one on the button.
       */
      repechageStarted: 'Hoffnungsrunde gestartet',
      repechageCandidateDrawn: (params: { participant: string }) =>
        `Nachrücker gezogen: ${params.participant}`,
      repechageAccepted: (params: { participant: string }) => `Nachgerückt: ${params.participant}`,
      repechageDeclined: (params: { participant: string }) => `Verzichtet: ${params.participant}`,
      repechageByes: 'Freilose vergeben',
      repechageReopened: 'Ausgeschiedene erneut zugelassen',

      /**
       * The phase step (issue #22). It names the phase the tournament has just
       * moved into, because that is what the host announced to the room a
       * second ago and what is about to be taken back off the projector.
       */
      phaseAdvanced: (params: { phase: string }) => `Phase gewechselt: ${params.phase}`,

      /**
       * The naming phase (issue #23). Both name the participant by number,
       * because the number is what the host is looking at while they type and
       * the name on the button may be the very one that is about to disappear.
       */
      groupNamed: (params: { participant: string; name: string }) =>
        `Name erfasst: ${params.participant} — ${params.name}`,
      groupRenamed: (params: { participant: string; name: string }) =>
        `Name geändert: ${params.participant} — ${params.name}`,

      /**
       * The `Turnierbaum` (issue #24). Only the draw needs a label of its own:
       * a result in the bracket is a result like any other and reads back to
       * the host as `matchWinnerSet`, in the same words it does in every round
       * before it.
       */
      bracketDrawn: 'Turnierbaum ausgelost',

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

    /**
     * The phase panel (issue #22, docs/TOURNAMENT-RULES.md §1).
     *
     * The one control that moves the evening on, so the copy has to answer two
     * questions at a glance: where are we, and what happens when I press this.
     * The destination is named on the button rather than left as "Weiter",
     * because the host says it out loud to the room before they press it.
     */
    sectionLabel: 'Turnierverlauf',
    /** What each phase is called where the host reads their current position. */
    name: {
      SETUP: 'Vorbereitung',
      QUALIFYING: 'Qualifikationsrunde',
      REPECHAGE: 'Hoffnungsrunde',
      ELIMINATION: 'Ausscheidungsrunden',
      NAMING: 'Namenserfassung',
      BRACKET: 'Turnierbaum',
      CEREMONY: 'Siegerehrung',
    },
    /** How many are still in, beside the phase. */
    field: (params: { n: number }) => `${params.n} im Feld`,
    /** The button, with the phase it leads to spelt out. */
    advance: (params: { phase: string }) => `Weiter zur ${params.phase}`,
    /** Reached the end of what this issue can move: nothing to press. */
    noStep: 'In dieser Phase gibt es keinen nächsten Schritt.',
    /** On the disabled button, so the reason is where the click was aimed. */
    blocked: (params: { reason: string }) => `Nicht möglich: ${params.reason}`,
    roundNotDrawn: 'Die Runde ist noch nicht ausgelost. Losen Sie sie aus.',
    roundOpen: 'Die laufende Runde ist noch offen. Schließen Sie sie ab.',
    repechageOpen: 'Die Hoffnungsrunde ist noch nicht vollständig.',
    fieldTooLarge: (params: { n: number; final: number }) =>
      `Es sind noch ${params.n} im Feld. Die Finalphase beginnt bei ${params.final}. Losen Sie eine weitere Ausscheidungsrunde aus.`,
    /** What the panel says the step will do, above the button. */
    outlook: (params: { phase: string; n: number }) =>
      `Als Nächstes: ${params.phase} mit ${params.n} Teilnehmenden.`,
  },

  /**
   * The round history (issue #22).
   *
   * The host is asked "wen habe ich in der zweiten Runde geschlagen?" at every
   * tournament, so every round of the evening stays reachable — and any of them
   * can be put back on the projector without disturbing the round that is
   * running.
   */
  history: {
    sectionLabel: 'Rundenverlauf',
    empty: 'Es wurde noch keine Runde ausgelost.',
    /** On the row, beside the round's own label. */
    result: (params: { winners: number; losers: number }) =>
      `${params.winners} weiter, ${params.losers} ausgeschieden`,
    show: 'Partien anzeigen',
    hide: 'Partien ausblenden',
    showOnBeamer: 'Diese Runde auf den Beamer',
    /** The pairing itself, on one line: the winner first, then the loser. */
    pairing: (params: { winner: string; loser: string }) =>
      `${params.winner} schlägt ${params.loser}`,
    byePairing: (params: { participant: string }) => `${params.participant} — Freilos`,
    undecided: (params: { a: string; b: string }) => `${params.a} gegen ${params.b} — offen`,
  },

  /**
   * The naming phase (issue #23, docs/TOURNAMENT-RULES.md §6).
   *
   * The host types sixteen names with a room waiting, so the copy is built for
   * somebody who is looking at their keyboard: the labels are short, the
   * progress line is a single sentence they can catch out of the corner of an
   * eye, and every warning says whether it is a warning or a refusal — a
   * duplicate name is allowed, an empty one is not, and the difference has to be
   * readable at a glance.
   */
  naming: {
    label: 'Namen',
    sectionLabel: 'Namenserfassung',

    /**
     * What the phase is for, above the list. Said once, because the host reads
     * it the first time and never again.
     */
    intro:
      'Ab jetzt treten die Verbliebenen unter ihrem Namen an. Die Nummer bleibt als Kennung daneben stehen.',
    /** Under the list: the one thing that makes 16 names bearable. */
    keyboardHint: 'Mit der Tabulatortaste geht es ins nächste Feld.',

    /** On each row. The number is spelt out, so a screen reader has the row. */
    nameLabel: (params: { participant: string }) => `Name für ${params.participant}`,
    placeholder: 'Name eingeben',

    /** The counter the issue asks for, word for word. */
    progress: (params: { named: number; total: number }) =>
      `${params.named} von ${params.total} Namen erfasst`,
    /**
     * The gate in front of the Turnierbaum, said while the host can still do
     * something about it rather than as a greyed-out button afterwards (§6).
     */
    missing: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Name fehlt', 'Namen fehlen')} noch. Der Turnierbaum kann erst ausgelost werden, wenn alle Namen erfasst sind.`,
    complete: 'Alle Namen sind erfasst. Der Turnierbaum kann ausgelost werden.',

    /**
     * Duplicates are allowed and the copy says so in the same breath: two
     * teams may genuinely share a name, and a host who reads only the first
     * half of the warning goes looking for a mistake that is not there (§6).
     */
    duplicate: 'Dieser Name kommt mehrfach vor. Das ist erlaubt.',
    duplicateCount: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Name kommt', 'Namen kommen')} mehrfach vor. Das ist erlaubt.`,

    /** Why a field refused what was typed into it. */
    tooLong: (params: { n: number }) => `Höchstens ${params.n} Zeichen.`,
    empty: 'Ein Name darf nicht leer sein.',

    showOnBeamer: 'Wartebild auf den Beamer',
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
    /** A group id that no longer names a group — a file repaired by hand. */
    unknown: 'Unbekannt',
    /** On the chip, beside the number. Short: forty of them share one screen. */
    remove: 'Löschen',
    numberLabel: 'Gruppennummer',
    /**
     * The heading of the warning shown before a late entry is added. The same
     * sentence whatever the participants are called — it is about the draw.
     */
    afterDrawTitle: 'Die Auslosung ist bereits gelaufen',
  },

  /**
   * The three wordings `settings.participantLabel` selects between (issue #14,
   * docs/GLOSSARY.md "Teilnehmer-Bezeichnung").
   *
   * Three complete word sets rather than one set of sentences with a noun
   * spliced into them. German nouns carry gender — *keine* Gruppe, *kein* Team,
   * *kein* Spieler — so a template would produce copy that is wrong in two of
   * the three settings, and wrong in the way a native speaker notices
   * immediately. Written out, each string is reviewable as the sentence it is.
   *
   * The model stays `Group` throughout: the three words describe the same
   * thing, one participating unit with a number (CLAUDE.md golden rule 1).
   */
  participant: {
    GROUP: {
      one: 'Gruppe',
      many: 'Gruppen',
      /** The identity of a participant until the naming phase (§0). */
      numbered: (params: { n: number }) => `Gruppe ${params.n}`,
      /** "1 Gruppe" / "5 Gruppen" — German pluralisation via @/i18n/plural. */
      count: (params: { n: number }) => pluralizeDeAT(params.n, 'Gruppe', 'Gruppen'),
      add: 'Gruppe hinzufügen',
      bulkAddLabel: 'Anzahl Gruppen',
      bulkAdd: 'Gruppen anlegen',
      removeNumbered: (params: { n: number }) => `Gruppe ${params.n} löschen`,
      empty: 'Es ist noch keine Gruppe angelegt. Legen Sie mindestens zwei Gruppen an.',
      tooFew: 'Ein Turnier braucht mindestens zwei Gruppen.',
      drawn: 'Diese Gruppe ist bereits ausgelost und kann nicht mehr gelöscht werden.',
      showOnBeamer: 'Gruppen auf den Beamer',
      beamerEmpty: 'Es sind noch keine Gruppen angelegt.',
      /** The warning before a group is added to a tournament already drawn. */
      afterDrawBody:
        'Neue Gruppen spielen in den bereits ausgelosten Partien nicht mit und kommen erst bei der nächsten Auslosung dazu.',
      afterDrawConfirm: 'Gruppen trotzdem anlegen',
      /** Announced before the draw, while the host can still add one (issue #15). */
      byePreview:
        'Eine Gruppe erhält ein Freilos und kommt ohne Partie weiter. Mit einer weiteren Gruppe entfällt das Freilos.',
    },

    TEAM: {
      one: 'Team',
      many: 'Teams',
      numbered: (params: { n: number }) => `Team ${params.n}`,
      count: (params: { n: number }) => pluralizeDeAT(params.n, 'Team', 'Teams'),
      add: 'Team hinzufügen',
      bulkAddLabel: 'Anzahl Teams',
      bulkAdd: 'Teams anlegen',
      removeNumbered: (params: { n: number }) => `Team ${params.n} löschen`,
      empty: 'Es ist noch kein Team angelegt. Legen Sie mindestens zwei Teams an.',
      tooFew: 'Ein Turnier braucht mindestens zwei Teams.',
      drawn: 'Dieses Team ist bereits ausgelost und kann nicht mehr gelöscht werden.',
      showOnBeamer: 'Teams auf den Beamer',
      beamerEmpty: 'Es sind noch keine Teams angelegt.',
      afterDrawBody:
        'Neue Teams spielen in den bereits ausgelosten Partien nicht mit und kommen erst bei der nächsten Auslosung dazu.',
      afterDrawConfirm: 'Teams trotzdem anlegen',
      /** Announced before the draw, while the host can still add one (issue #15). */
      byePreview:
        'Ein Team erhält ein Freilos und kommt ohne Partie weiter. Mit einem weiteren Team entfällt das Freilos.',
    },

    PLAYER: {
      one: 'Spieler',
      /** Plural and singular are the same word; the count beside it disambiguates. */
      many: 'Spieler',
      numbered: (params: { n: number }) => `Spieler ${params.n}`,
      count: (params: { n: number }) => pluralizeDeAT(params.n, 'Spieler', 'Spieler'),
      add: 'Spieler hinzufügen',
      bulkAddLabel: 'Anzahl Spieler',
      bulkAdd: 'Spieler anlegen',
      removeNumbered: (params: { n: number }) => `Spieler ${params.n} löschen`,
      empty: 'Es ist noch kein Spieler angelegt. Legen Sie mindestens zwei Spieler an.',
      tooFew: 'Ein Turnier braucht mindestens zwei Spieler.',
      drawn: 'Dieser Spieler ist bereits ausgelost und kann nicht mehr gelöscht werden.',
      showOnBeamer: 'Spieler auf den Beamer',
      beamerEmpty: 'Es sind noch keine Spieler angelegt.',
      afterDrawBody:
        'Neue Spieler spielen in den bereits ausgelosten Partien nicht mit und kommen erst bei der nächsten Auslosung dazu.',
      afterDrawConfirm: 'Spieler trotzdem anlegen',
      /** Announced before the draw, while the host can still add one (issue #15). */
      byePreview:
        'Ein Spieler erhält ein Freilos und kommt ohne Partie weiter. Mit einem weiteren Spieler entfällt das Freilos.',
    },
  },

  /** The host's choices about a tournament (docs/FILE-FORMAT.md `settings`). */
  settings: {
    /** docs/GLOSSARY.md: the German for `participantLabel`. */
    participantLabel: 'Teilnehmer-Bezeichnung',

    /** The panel itself (issue #15). */
    sectionLabel: 'Turniereinstellungen',

    tournamentName: 'Name des Turniers',
    /**
     * Said next to the field, because renaming the event does not rename the
     * file it is being saved into (docs/OPEN-QUESTIONS.md #26) — and a host who
     * expects it to would look for the old name in Explorer that evening.
     */
    tournamentNameHint:
      'Der Dateiname bleibt gleich. Über „Speichern unter…“ lässt sich das Turnier unter einem neuen Dateinamen ablegen.',

    namingAt: 'Namen ab Feldgröße',
    namingAtHint:
      'Ab so vielen verbliebenen Teilnehmenden werden Namen erfasst. Vorher zählt die Nummer.',
    /** Why the field is greyed out from the naming phase on. */
    namingAtLocked:
      'Die Namenserfassung hat bereits begonnen. Die Feldgröße kann jetzt nicht mehr geändert werden.',

    performanceMode: 'Performance-Modus',
    performanceModeHint:
      'Für schwache Grafik oder einen trägen Beamer: Animationen laufen in halber Zeit. Jederzeit umschaltbar.',

    /**
     * The draw seed, shown and never editable (CLAUDE.md golden rule 7). It is
     * on screen so a disputed Auslosung can be reproduced afterwards, which is
     * the whole reason the number is stored at all.
     */
    seed: 'Startwert der Auslosung',
    seedHint: 'Mit diesem Wert lässt sich jede Auslosung später nachvollziehen.',
  },

  /**
   * The gate between setup and a running tournament (issue #15).
   *
   * Every check says what is missing **and** what to do about it: the host is
   * reading this with a room filling up behind them, and "zu wenige Gruppen" on
   * its own is a sentence they have to think about.
   */
  start: {
    sectionLabel: 'Turnier starten',
    action: 'Turnier starten',
    /** On the disabled button, so the reason is where the click was aimed. */
    blocked: (params: { reason: string }) => `Nicht möglich: ${params.reason}`,

    checksTitle: 'Prüfung vor dem Start',
    ready: 'Alles bereit. Das Turnier kann gestartet werden.',
    noUsableTable:
      'Es ist kein Tisch bespielbar. Legen Sie einen Tisch an oder geben Sie einen gesperrten Tisch frei.',
    tableShortage: (params: { matches: number; tables: number; queued: number }) =>
      `Für ${pluralizeDeAT(params.matches, 'Partie', 'Partien')} stehen nur ${pluralizeDeAT(params.tables, 'Tisch', 'Tische')} bereit. Zu Beginn warten ${pluralizeDeAT(params.queued, 'Partie', 'Partien')} auf einen freien Tisch.`,

    previewTitle: 'Erste Runde',
    previewMatches: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Partie', 'Partien')} in der Qualifikationsrunde`,

    /** After the start, where the button used to be. */
    running: 'Das Turnier läuft. Die Auslosung der ersten Runde folgt.',
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

    /**
     * The two targets of a match card (issue #17). The whole button is the
     * participant, because the host is aiming at a name across a busy screen
     * rather than reading a sentence — the verb lives in the label beside it.
     */
    winnerAction: (params: { participant: string }) => `${params.participant} gewinnt`,
    /** On the card of a decided match: "Sieger: Gruppe 4". */
    winnerIs: (params: { participant: string }) => `Sieger: ${params.participant}`,
    /**
     * A decided match is not flipped by one stray click (issue #17 acceptance
     * criteria): the host arms the card first, and only then are the two
     * targets back.
     */
    correct: 'Ergebnis ändern',
    correctPrompt: 'Neuen Sieger wählen',
    correctCancel: 'Ergebnis behalten',
  },

  /**
   * The round control panel: the screen the host stares at for most of the
   * event (issue #17).
   *
   * Short words and no sentences on the controls. The host is reading this
   * standing up, under time pressure, with the room waiting — every string here
   * is either a label they scan or a reason a control is doing nothing.
   */
  round: {
    label: 'Runde',
    title: (params: { n: number }) => `Runde ${params.n}`,

    sectionLabel: 'Aktuelle Runde',
    /** Between two rounds, and before the first draw of a phase. */
    none: 'Es ist keine Runde offen. Losen Sie die nächste Runde aus.',
    /** The three states of docs/FILE-FORMAT.md, as the host would say them. */
    state: {
      DRAWN: 'ausgelost',
      RUNNING: 'läuft',
      CLOSED: 'abgeschlossen',
    },
    /** The header's progress: "7 / 12 Partien entschieden". */
    progress: (params: { decided: number; total: number }) =>
      `${params.decided} / ${pluralizeDeAT(params.total, 'Partie', 'Partien')} entschieden`,

    tablesTitle: 'An den Tischen',
    queueTitle: 'Warteschlange',
    queueCount: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Partie', 'Partien')} wartet auf einen Tisch`,
    queueEmpty: 'Keine Partie wartet auf einen Tisch.',
    decidedTitle: 'Entschieden',
    decidedEmpty: 'Es ist noch keine Partie entschieden.',

    /**
     * On a free table while somebody is waiting. The table was already freed
     * when its winner was marked — what is left is the host's confirmation that
     * the next pair walks up, which never happens on its own (golden rule 3).
     */
    startNext: 'Nächste Partie starten',
    startNextOn: (params: { table: string }) => `Nächste Partie auf ${params.table} starten`,

    close: 'Runde abschließen',
    /** On the disabled button, so the reason is where the click was aimed. */
    closeBlocked: (params: { reason: string }) => `Nicht möglich: ${params.reason}`,
    closeNoRound: 'Es ist keine Runde offen, die abgeschlossen werden könnte.',
    closeUndecided: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Partie', 'Partien')} ohne Sieger. Legen Sie für jede Partie einen Sieger fest.`,

    showOnBeamer: 'Runde auf den Beamer',

    /** The live summary beside the matches (issue #17, docs/TOURNAMENT-RULES.md §3). */
    summaryTitle: 'Zwischenstand',
    summaryWinners: (params: { n: number }) => `${params.n} weiter`,
    summaryLosers: (params: { n: number }) => `${params.n} ausgeschieden`,
    summaryOpen: (params: { n: number }) => `${pluralizeDeAT(params.n, 'Partie', 'Partien')} offen`,
    /**
     * The repechage the draw already determines: every match yields exactly one
     * winner, so the field size at the close of the round is known from the
     * moment it is drawn (docs/TOURNAMENT-RULES.md §4, issue #20).
     */
    summaryRepechage: (params: { target: number; need: number }) =>
      `Hoffnungsrunde: Ziel ${params.target} — ${pluralizeDeAT(params.need, 'Platz', 'Plätze')} werden nachbesetzt.`,
    summaryRepechageSkipped: (params: { target: number }) =>
      `Die Hoffnungsrunde entfällt: ${params.target} kommen weiter, das ist bereits eine Zweierpotenz.`,
  },

  draw: {
    label: 'Auslosung',
    action: 'auslosen',

    /** The button that starts a round, and every reason it is greyed out. */
    start: 'Auslosung starten',
    blocked: (params: { reason: string }) => `Nicht möglich: ${params.reason}`,
    notADrawingPhase: 'In dieser Phase wird nicht ausgelost.',
    roundOpen: 'Die laufende Runde ist noch offen. Schließen Sie sie ab, bevor Sie neu auslosen.',
    qualifyingAlreadyDrawn:
      'Die Qualifikationsrunde ist bereits ausgelost. Es gibt nur eine davon.',
    /**
     * The `while |W| > 16` of docs/TOURNAMENT-RULES.md §5, as the host reads it:
     * another round here would take the field below the bracket the room has
     * been promised.
     */
    finalPhaseReached:
      'Das Feld ist bereits vollständig für die Finalphase. Wechseln Sie in die nächste Phase.',
  },

  outcome: {
    winner: 'Sieger',
    loser: 'Verlierer',
    eliminated: 'ausgeschieden',
    advance: 'nachrücken',
    bye: 'Freilos',
  },

  /**
   * The `Hoffnungsrunde` (issue #21, docs/TOURNAMENT-RULES.md §4).
   *
   * The most dramatic moment of the evening and the one the host has to narrate
   * out loud, so the copy is written to be *said*: the panel's words are the
   * words they will use at the microphone, and the two answer buttons are two
   * verbs that cannot be confused with each other from a metre away.
   */
  repechage: {
    label: 'Hoffnungsrunde',
    sectionLabel: 'Hoffnungsrunde',

    /**
     * What the phase is for, in one sentence, above the button that starts it.
     * The host reads this out; the room has no other explanation of why people
     * who just lost are being drawn again.
     */
    intro: (params: { target: number }) =>
      `Der Turnierbaum braucht ${params.target} Teilnehmende. Die fehlenden Plätze werden unter den Ausgeschiedenen ausgelost.`,
    start: 'Hoffnungsrunde starten',
    /** On the disabled start button, so the reason is where the click landed. */
    blocked: (params: { reason: string }) => `Nicht möglich: ${params.reason}`,
    notAfterQualifying: 'Die Hoffnungsrunde folgt auf die Qualifikationsrunde.',
    qualifyingNotClosed:
      'Die Qualifikationsrunde ist noch nicht abgeschlossen. Schließen Sie sie ab.',
    alreadyStarted: 'Die Hoffnungsrunde läuft bereits.',
    notNeeded: 'Die Hoffnungsrunde entfällt: das Feld ist bereits eine Zweierpotenz.',

    /** The live numbers, side by side, in the words the host says. */
    target: (params: { n: number }) => `Ziel: ${params.n}`,
    field: (params: { n: number }) => `Im Feld: ${params.n}`,
    slotsLeft: (params: { n: number }) => `${pluralizeDeAT(params.n, 'Platz', 'Plätze')} frei`,
    slotsFilled: 'Alle Plätze sind besetzt.',

    /** The draw itself. */
    draw: 'Nachrücker auslosen',
    drawPending: 'Erst entscheiden, dann weiter auslosen.',
    drawPoolEmpty: 'Es sind keine Ausgeschiedenen mehr im Topf.',
    drawn: (params: { participant: string }) => `Gezogen: ${params.participant}`,
    question: 'Nachrücken?',
    /**
     * The two answers. Both are complete verbs rather than `Ja` and `Nein`: the
     * host is aiming at one of two adjacent buttons while looking at the room,
     * and two words that share no letters are harder to hit by mistake than two
     * that are two characters long.
     */
    accept: 'Nimmt an',
    decline: 'Verzichtet',

    /** The three lists on the panel. */
    throughTitle: 'Im Feld',
    poolTitle: 'Im Topf',
    poolEmpty: 'Der Topf ist leer.',
    /**
     * The third list, deliberately not called `Verzichtet`: that is the word on
     * the button two centimetres away, and a column heading that repeats a
     * button is a column a host clicks at. These are the people the offer has
     * gone past for good.
     */
    declinedTitle: 'Ausgeschieden',
    declinedEmpty: 'Niemand hat verzichtet.',
    byes: (params: { n: number }) =>
      `${pluralizeDeAT(params.n, 'Freilos', 'Freilose')} für die nächste Runde`,

    showOnBeamer: 'Hoffnungsrunde auf den Beamer',
    complete: 'Das Feld ist vollständig.',

    /**
     * The fallback of §4: the pot has run dry with places still open. Both
     * answers are spelt out in full, because the host has to choose one in
     * front of a waiting room and neither is obviously right.
     */
    fallback: {
      title: 'Der Topf ist leer',
      body: (params: { n: number }) =>
        `Es sind noch ${pluralizeDeAT(params.n, 'Platz', 'Plätze')} frei, aber niemand steht mehr im Topf. Entscheiden Sie, wie das Feld gefüllt wird.`,
      byes: 'Freilose vergeben',
      byesBody: (params: { n: number }) =>
        `Die ${pluralizeDeAT(params.n, 'freie Platz', 'freien Plätze')} werden in der nächsten Runde als ${pluralizeDeAT(params.n, 'Freilos', 'Freilose')} vergeben. Das Turnier läuft sofort weiter.`,
      reopen: 'Ausgeschiedene erneut zulassen',
      reopenBody: (params: { n: number }) =>
        `${pluralizeDeAT(params.n, 'Teilnehmende:r hat', 'Teilnehmende haben')} verzichtet. Sie kommen neu gemischt zurück in den Topf und werden noch einmal gezogen.`,
      reopenNobody: 'Es hat niemand verzichtet, der zurückkommen könnte.',
    },
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

    /**
     * The `GROUP_OVERVIEW` scene: everyone who is playing (issue #14).
     *
     * Its heading is the participant wording — `Gruppen`, `Teams`, `Spieler` —
     * so there is no title here. What is left is the line under it, which is
     * the one thing the room cannot count for itself at 64 chips.
     */
    groupOverview: {
      count: (params: { participants: string }) => `${params.participants} am Start`,
    },

    /**
     * The `DRAW` scene: the auslosung, live in front of the room (issue #18).
     *
     * The heading is the round's own label (`Runde 1`), which the draw action
     * already wrote — so what is left here is the pool caption, the two things
     * a pairing can say instead of a table, and the word for a `Freilos` reveal.
     */
    draw: {
      title: 'Auslosung',
      /** Over the grid of numbers still to be drawn. */
      poolTitle: 'Noch zu ziehen',
      /**
       * The pool once it is empty — the draw is over and the board is complete.
       * Said rather than left blank, so an empty half of the screen reads as
       * finished rather than broken.
       */
      poolEmpty: 'Alle gezogen.',
      /**
       * A pairing that has been drawn but has no table yet
       * (docs/TOURNAMENT-RULES.md §3). The room needs to know the match exists
       * and is not being played yet, or people go looking for a table.
       */
      waitingForTable: 'Wartet auf Tisch',
      /**
       * A `Freilos` reveal. It gets the word as well as its own colour: a card
       * with one participant and an empty space looks like a bug from the back
       * of a room, and this is the audience's only explanation of why somebody
       * advanced without playing (rules §9 case 1).
       */
      byeAdvances: 'Freilos — steigt auf',
      /** Under the heading while the sequence is still running. */
      progress: (params: { drawn: number; total: number }) =>
        `${params.drawn} von ${params.total} gezogen`,
      /** Nothing to draw: a round with no matches, which should not happen. */
      empty: 'Es wurde nichts ausgelost.',
    },

    /**
     * The `ROUND_BOARD` scene: the live round, green and red (issue #19).
     *
     * What the audience looks at for most of the evening. Every result carries
     * three signals, never colour alone (docs/STYLEGUIDE.md §1) — the colour,
     * an icon, and one of the words below. Roughly 8 % of men have a red–green
     * deficiency, and a projector in a bright room flattens the hues anyway.
     */
    roundBoard: {
      /** The ribbon on each card. Short, because it sits above the pairing. */
      phase: {
        WAITING: 'WARTET',
        RUNNING: 'LÄUFT',
        FINISHED: 'BEENDET',
      },
      /** The third signal on a result, beside the colour and the icon. */
      winner: 'SIEGER',
      loser: 'AUSGESCHIEDEN',
      /** The heading over the matches that have no table yet. */
      queueTitle: 'Warteschlange',
      /** On a table with nothing on it this round. */
      tableIdle: 'Frei',
      tableDisabled: 'Gesperrt',
      /** Before anything has been drawn into this round. */
      empty: 'Es ist keine Partie angesetzt.',
    },

    /**
     * The `REPECHAGE` scene: the second chance, live (issue #21,
     * docs/MOTION.md §4.3).
     *
     * The room is watching people who have just lost being given a way back in,
     * and most of them do not know the rule. So the wall says the target, the
     * places left and what happened to each card in words — never in colour
     * alone (docs/STYLEGUIDE.md §1).
     */
    repechage: {
      title: 'Hoffnungsrunde',
      /** Over the pot of losers. */
      potTitle: 'Im Topf',
      /** Over the column that fills up as places are taken. */
      throughTitle: 'Weiter',
      /** The counter the whole scene is about: "Noch 3 Plätze frei". */
      slotsLeft: (params: { n: number }) =>
        `Noch ${pluralizeDeAT(params.n, 'Platz', 'Plätze')} frei`,
      /** Once the field is full. The counter must not simply vanish. */
      slotsFilled: 'Alle Plätze besetzt',
      target: (params: { n: number }) => `Ziel: ${params.n}`,
      /** The word on each card, beside its colour and its icon. */
      status: {
        POOL: 'IM TOPF',
        DRAWN: 'GEZOGEN',
        ACCEPTED: 'NACHGERÜCKT',
        DECLINED: 'VERZICHTET',
      },
      /** Byes owed to the next round after the *Freilose vergeben* fallback. */
      byes: (params: { n: number }) =>
        `${pluralizeDeAT(params.n, 'Freilos', 'Freilose')} in der nächsten Runde`,
      /** Nobody lost, so there is nobody to draw — a field that should skip. */
      empty: 'Es steht niemand im Topf.',
    },

    /**
     * The `NAMING` scene: a holding picture while the host types (issue #23).
     *
     * Deliberately says nothing about the names. The host is entering sixteen of
     * them one at a time, and a wall that filled up as they typed would show the
     * room a half-finished list, every typo on the way to being corrected, and
     * the order the host happened to work in. So the projector says what is
     * happening and how long it is — one idea per screen (docs/STYLEGUIDE.md §3)
     * — and the field of participants returns for the `Turnierbaum`.
     */
    naming: {
      title: 'Gleich geht es weiter',
      notice: 'Die Finalphase wird vorbereitet.',
      /** How many are through, which is the one number the room can be told. */
      field: (params: { participants: string }) => `${params.participants} in der Finalphase`,
    },

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
