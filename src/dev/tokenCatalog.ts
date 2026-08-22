/**
 * What the `/tokens` review page renders.
 *
 * The catalogue is data rather than markup so the page cannot drift from the
 * token file by accident: adding a token means adding one line here, and every
 * swatch resolves its actual value out of the live stylesheet at runtime.
 *
 * All labels are English on purpose — this page is a developer tool that never
 * ships to a host or an audience (see `App.tsx`, guarded by `import.meta.env.DEV`),
 * so CLAUDE.md §1 does not apply to it.
 */

export interface ColorTokenEntry {
  /** Custom property name, e.g. `--wm-surface`. */
  readonly token: string;
  /** Why it exists, when that is not obvious from the name. */
  readonly note?: string;
}

export interface ColorGroup {
  readonly title: string;
  readonly entries: readonly ColorTokenEntry[];
}

export const COLOR_GROUPS: readonly ColorGroup[] = [
  {
    title: 'Base',
    entries: [
      { token: '--wm-bg', note: 'never pure black — projectors band and crush it' },
      { token: '--wm-bg-elevated' },
      { token: '--wm-surface' },
      { token: '--wm-surface-hover' },
      { token: '--wm-border' },
      { token: '--wm-border-strong' },
    ],
  },
  {
    title: 'Text',
    entries: [
      { token: '--wm-text', note: 'never pure white — reduces halation on a bright beamer' },
      { token: '--wm-text-muted' },
      { token: '--wm-text-faint', note: 'decorative only — below the 4.5:1 body-text target' },
    ],
  },
  {
    title: 'Brand',
    entries: [
      { token: '--wm-accent' },
      { token: '--wm-accent-strong' },
      { token: '--wm-accent-soft' },
    ],
  },
  {
    title: 'Status',
    entries: [
      { token: '--wm-win' },
      { token: '--wm-win-bg' },
      { token: '--wm-lose' },
      { token: '--wm-lose-bg' },
      { token: '--wm-live', note: 'match running' },
      { token: '--wm-live-bg' },
      { token: '--wm-idle' },
    ],
  },
  {
    title: 'Podium',
    entries: [{ token: '--wm-gold' }, { token: '--wm-silver' }, { token: '--wm-bronze' }],
  },
];

/** Every colour token, for the one-shot `getComputedStyle` read on mount. */
export const COLOR_TOKENS: readonly string[] = COLOR_GROUPS.flatMap((group) =>
  group.entries.map((entry) => entry.token),
);

export interface ScaleEntry {
  readonly token: string;
  /** Rendered size at 1080p, so a reviewer can compare against the style guide. */
  readonly atFullHd: string;
  readonly use: string;
}

export const BEAMER_TYPE_SCALE: readonly ScaleEntry[] = [
  { token: 'text-beamer-hero', atFullHd: '160px', use: 'winner name, single-number reveals' },
  { token: 'text-beamer-h1', atFullHd: '96px', use: 'scene title' },
  { token: 'text-beamer-h2', atFullHd: '64px', use: 'group name in a match card' },
  { token: 'text-beamer-h3', atFullHd: '48px', use: 'table label, round label' },
  { token: 'text-beamer-body', atFullHd: '32px', use: 'absolute minimum on the beamer' },
  { token: 'text-beamer-caption', atFullHd: '24px', use: 'persistent chrome only' },
];

export const HOST_TYPE_SCALE: readonly ScaleEntry[] = [
  { token: 'text-host-2xl', atFullHd: '32px', use: 'panel headline' },
  { token: 'text-host-xl', atFullHd: '24px', use: 'section title' },
  { token: 'text-host-lg', atFullHd: '20px', use: 'emphasis' },
  { token: 'text-host-base', atFullHd: '16px', use: 'dense table body' },
  { token: 'text-host-sm', atFullHd: '14px', use: 'body — the host default' },
  { token: 'text-host-xs', atFullHd: '12px', use: 'labels, uppercase, .04em tracking' },
];

export interface SpacingEntry {
  readonly token: string;
  readonly px: number;
  /** The Tailwind utility that lands on the same value. */
  readonly utility: string;
}

export const SPACING_SCALE: readonly SpacingEntry[] = [
  { token: '--wm-space-4', px: 4, utility: 'p-1' },
  { token: '--wm-space-8', px: 8, utility: 'p-2' },
  { token: '--wm-space-12', px: 12, utility: 'p-3' },
  { token: '--wm-space-16', px: 16, utility: 'p-4' },
  { token: '--wm-space-24', px: 24, utility: 'p-6' },
  { token: '--wm-space-32', px: 32, utility: 'p-8' },
  { token: '--wm-space-48', px: 48, utility: 'p-12' },
  { token: '--wm-space-64', px: 64, utility: 'p-16' },
  { token: '--wm-space-96', px: 96, utility: 'p-24' },
];

export interface RadiusEntry {
  readonly token: string;
  readonly utility: string;
  readonly use: string;
}

export const RADIUS_SCALE: readonly RadiusEntry[] = [
  { token: '--wm-radius-sm', utility: 'rounded-wm-sm', use: 'chips, inputs' },
  { token: '--wm-radius-md', utility: 'rounded-wm-md', use: 'buttons, host cards' },
  { token: '--wm-radius-lg', utility: 'rounded-wm-lg', use: 'panels, dialogs' },
  { token: '--wm-radius-xl', utility: 'rounded-wm-xl', use: 'beamer cards' },
];

export interface EasingEntry {
  readonly token: string;
  readonly utility: string;
  readonly use: string;
}

export const EASINGS: readonly EasingEntry[] = [
  { token: '--ease-out', utility: 'ease-out', use: 'enter, reveal, feedback' },
  { token: '--ease-in-out', utility: 'ease-in-out', use: 'on-screen movement' },
  { token: '--ease-dramatic', utility: 'ease-dramatic', use: 'beamer reveals' },
  { token: '--ease-exit', utility: 'ease-exit', use: 'exits only' },
];

export interface DurationEntry {
  readonly token: string;
  readonly use: string;
}

export const DURATIONS: readonly DurationEntry[] = [
  { token: '--dur-instant', use: 'press feedback' },
  { token: '--dur-fast', use: 'host hover, colour change' },
  { token: '--dur-base', use: 'host dialogs, panels' },
  { token: '--dur-slow', use: 'beamer scene crossfade' },
  { token: '--dur-reveal', use: 'beamer single reveal' },
  { token: '--dur-story', use: 'beamer choreographed sequence step' },
];

export const STAGGERS: readonly DurationEntry[] = [
  { token: '--stagger-tight', use: 'host lists' },
  { token: '--stagger-wide', use: 'beamer cards' },
];
