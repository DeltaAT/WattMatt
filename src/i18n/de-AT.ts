/**
 * Every user-visible string in WattMatt lives here (CLAUDE.md §1).
 * The full locale layout, typing and lookup helpers arrive with issue #6;
 * this seed only carries what the bootstrap shell renders.
 */
export const deAT = {
  app: {
    name: 'WattMatt',
    bootstrapNotice: 'Grundgerüst steht. Turnierfunktionen folgen.',
  },
} as const;

export type Locale = typeof deAT;
