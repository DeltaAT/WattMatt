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

    letterboxNotice:
      'Dieser Bildschirm ist nicht 16:9. Das Bild wird mit Balken angezeigt, statt umgebrochen zu werden.',
  },
} as const;

export type Locale = typeof deAT;
