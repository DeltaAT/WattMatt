/**
 * Every user-visible string in WattMatt lives here (CLAUDE.md §1).
 * The full locale layout, typing and lookup helpers arrive with issue #6;
 * this seed only carries what the two-window shell renders.
 */
export const deAT = {
  app: {
    name: 'WattMatt',
    bootstrapNotice: 'Grundgerüst steht. Turnierfunktionen folgen.',
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
