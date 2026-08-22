import { useState } from 'react';

import { ColorSwatch } from '@/dev/ColorSwatch';
import {
  BEAMER_TYPE_SCALE,
  COLOR_GROUPS,
  COLOR_TOKENS,
  DURATIONS,
  EASINGS,
  HOST_TYPE_SCALE,
  RADIUS_SCALE,
  SPACING_SCALE,
  STAGGERS,
} from '@/dev/tokenCatalog';
import { TokenSection } from '@/dev/TokenSection';
import { useResolvedTokens } from '@/dev/useResolvedTokens';

/**
 * Dev-only visual review of every design token (issue #3).
 *
 * Reachable at `?window=tokens` while `pnpm dev` is running; `App.tsx` gates it
 * behind `import.meta.env.DEV`, so it is not part of a release build.
 *
 * The beamer section renders at real projected size on purpose. The acceptance
 * criterion for the tokens is "readable when projected at ≥ 3 m", and that can
 * only be judged by putting this page on the actual beamer.
 */

/*
 * Specimens are German-shaped (long compounds, a lot of digits) because that is
 * what the app renders, but deliberately free of umlauts: the German-string
 * lint rule rejects those outside `src/i18n`, and a dev page is not the place
 * to argue with it.
 */
const SAMPLE_WORD = 'Turnierbaum';
const SAMPLE_SENTENCE = 'Qualifikationsrunde 12 - Tisch 3 - Gruppe 41';
const SAMPLE_DIGITS = '0123456789';
const NUMERIC_COLUMN = ['1.041', '9.780', '3.111', '8.000'];
const DISPLAY_WEIGHTS = [500, 600, 700, 800];

/** Track is `w-64` (16rem), the dot `w-4` (1rem), plus `left-1` (0.25rem). */
const MOTION_DEMO_TRAVEL = 'translateX(14.5rem)';

export function TokensPage() {
  const resolved = useResolvedTokens(COLOR_TOKENS);
  const background = resolved.get('--wm-bg') ?? '';
  const [playing, setPlaying] = useState(false);

  return (
    <div className="bg-wm-bg text-wm-text min-h-full">
      <div className="mx-auto flex max-w-6xl flex-col gap-12 p-8">
        <header className="flex flex-col gap-2">
          <p className="wm-label">{'WattMatt · design tokens'}</p>
          <h1 className="text-host-2xl wm-display font-extrabold">{'Token review'}</h1>
          <p className="text-host-sm text-wm-text-muted max-w-2xl">
            {
              'Every value below is read from the live stylesheet, not from TypeScript. An empty swatch or a missing sample means the token never reached the CSS.'
            }
          </p>
        </header>

        <TokenSection
          title={'Colour'}
          subtitle={
            'Contrast is measured against --wm-bg. Targets: 7:1 beamer text, 4.5:1 host body text, 3:1 non-text UI.'
          }
        >
          <div className="flex flex-col gap-8">
            {COLOR_GROUPS.map((group) => (
              <div key={group.title} className="flex flex-col gap-3">
                <p className="wm-label">{group.title}</p>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {group.entries.map((entry) => (
                    <ColorSwatch
                      key={entry.token}
                      token={entry.token}
                      value={resolved.get(entry.token) ?? ''}
                      background={background}
                      note={entry.note}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TokenSection>

        <TokenSection
          title={'Typography'}
          subtitle={
            'Inter Variable for UI, Archivo Variable at 125% width for display. Both bundled locally.'
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border-wm-border bg-wm-bg-elevated rounded-wm-md flex flex-col gap-2 border p-4">
              <p className="wm-label">{'--font-ui · Inter Variable'}</p>
              <p className="text-host-xl">{SAMPLE_SENTENCE}</p>
              <p className="text-host-sm text-wm-text-muted">{SAMPLE_DIGITS}</p>
            </div>
            <div className="border-wm-border bg-wm-bg-elevated rounded-wm-md flex flex-col gap-2 border p-4">
              <p className="wm-label">{'--font-display · Archivo Expanded'}</p>
              <p className="text-host-xl wm-display font-extrabold">{SAMPLE_SENTENCE}</p>
              <div className="flex flex-col">
                {DISPLAY_WEIGHTS.map((weight) => (
                  <p
                    key={weight}
                    className="text-host-lg wm-display"
                    style={{ fontWeight: weight }}
                  >
                    {`${weight} · ${SAMPLE_WORD}`}
                  </p>
                ))}
              </div>
            </div>
          </div>

          <div className="border-wm-border bg-wm-bg-elevated rounded-wm-md flex flex-col gap-3 border p-4">
            <p className="wm-label">{"font-feature-settings: 'tnum' 1"}</p>
            <div className="grid grid-cols-2 gap-8">
              <div>
                <p className="text-host-xs text-wm-text-faint">{'tabular (the app default)'}</p>
                <div className="wm-tnum text-host-lg flex flex-col">
                  {NUMERIC_COLUMN.map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-host-xs text-wm-text-faint">{'proportional (for comparison)'}</p>
                <div
                  className="text-host-lg flex flex-col"
                  style={{
                    fontFeatureSettings: "'tnum' 0",
                    fontVariantNumeric: 'proportional-nums',
                  }}
                >
                  {NUMERIC_COLUMN.map((value) => (
                    <span key={value}>{value}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </TokenSection>

        <TokenSection
          title={'Host type scale'}
          subtitle={'12 / 14 / 16 / 20 / 24 / 32 px. Body is text-host-sm.'}
        >
          <div className="flex flex-col gap-2">
            {HOST_TYPE_SCALE.map((entry) => (
              <div
                key={entry.token}
                className="border-wm-border flex items-baseline gap-4 border-b pb-2"
              >
                <code className="text-host-xs text-wm-text-muted wm-tnum w-40 shrink-0">
                  {`${entry.token} · ${entry.atFullHd}`}
                </code>
                <span className={entry.token}>{SAMPLE_SENTENCE}</span>
                <span className="text-host-xs text-wm-text-faint ml-auto shrink-0">
                  {entry.use}
                </span>
              </div>
            ))}
          </div>
        </TokenSection>
      </div>

      {/*
        Full-bleed and inside `.beamer-root`, so the samples are the size they
        will be on the projector. `cursor-auto` overrides the beamer's hidden
        cursor, which would otherwise make this page hard to review.
      */}
      <div className="beamer-root border-wm-border cursor-auto overflow-x-auto border-y">
        <div className="mx-auto flex max-w-6xl flex-col gap-12 p-8">
          <TokenSection
            title={'Beamer type scale'}
            subtitle={
              'Rendered at true projected size: 1 unit = 100vw / 120. Resize the window to check 720p and 4K.'
            }
          >
            <div className="flex flex-col gap-6">
              {BEAMER_TYPE_SCALE.map((entry) => (
                <div key={entry.token} className="flex flex-col gap-1">
                  <code className="text-host-xs text-wm-text-muted wm-tnum">
                    {`${entry.token} · ${entry.atFullHd} @1080p · ${entry.use}`}
                  </code>
                  <span className={`${entry.token} wm-display`}>{SAMPLE_WORD}</span>
                </div>
              ))}
            </div>
          </TokenSection>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl flex-col gap-12 p-8">
        <TokenSection
          title={'Spacing'}
          subtitle={'8px grid. The Tailwind numeric utilities land on the same values.'}
        >
          <div className="flex flex-col gap-2">
            {SPACING_SCALE.map((entry) => (
              <div key={entry.token} className="flex items-center gap-4">
                <code className="text-host-xs text-wm-text-muted wm-tnum w-40 shrink-0">
                  {entry.token}
                </code>
                <div
                  className="bg-wm-accent h-3 rounded-full"
                  style={{ width: `var(${entry.token})` }}
                />
                <code className="text-host-xs text-wm-text-faint wm-tnum">
                  {`${entry.px}px · ${entry.utility}`}
                </code>
              </div>
            ))}
          </div>
        </TokenSection>

        <TokenSection title={'Radii'} subtitle={'Corner radii scale with the size of the surface.'}>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {RADIUS_SCALE.map((entry) => (
              <div
                key={entry.token}
                className="border-wm-border-strong bg-wm-surface flex h-28 flex-col justify-end gap-1 border-2 p-3"
                style={{ borderRadius: `var(${entry.token})` }}
              >
                <code className="text-host-xs text-wm-text">{entry.utility}</code>
                <code className="text-host-xs text-wm-text-faint">{entry.use}</code>
              </div>
            ))}
          </div>
        </TokenSection>

        <TokenSection
          title={'Motion'}
          subtitle={
            'Play the row to compare curves and durations side by side. Only transform is animated.'
          }
        >
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            className="border-wm-border-strong bg-wm-surface hover:bg-wm-surface-hover rounded-wm-md text-host-sm w-fit border px-4 py-2 transition-colors duration-[var(--dur-fast)] ease-out"
          >
            {playing ? 'Reset' : 'Play'}
          </button>

          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex flex-1 flex-col gap-3">
              <p className="wm-label">{'Easing'}</p>
              {EASINGS.map((entry) => (
                <div key={entry.token} className="flex flex-col gap-1">
                  <code className="text-host-xs text-wm-text-muted">
                    {`${entry.token} · ${entry.use}`}
                  </code>
                  <div className="bg-wm-surface rounded-wm-sm relative h-6 w-64 overflow-hidden">
                    <div
                      className="bg-wm-accent absolute top-1 left-1 h-4 w-4 rounded-full transition-transform"
                      style={{
                        transitionDuration: 'var(--dur-story)',
                        transitionTimingFunction: `var(${entry.token})`,
                        transform: playing ? MOTION_DEMO_TRAVEL : 'translateX(0)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-1 flex-col gap-3">
              <p className="wm-label">{'Duration'}</p>
              {DURATIONS.map((entry) => (
                <div key={entry.token} className="flex flex-col gap-1">
                  <code className="text-host-xs text-wm-text-muted">
                    {`${entry.token} · ${entry.use}`}
                  </code>
                  <div className="bg-wm-surface rounded-wm-sm relative h-6 w-64 overflow-hidden">
                    <div
                      className="bg-wm-live absolute top-1 left-1 h-4 w-4 rounded-full transition-transform"
                      style={{
                        transitionDuration: `var(${entry.token})`,
                        transitionTimingFunction: 'var(--ease-out)',
                        transform: playing ? MOTION_DEMO_TRAVEL : 'translateX(0)',
                      }}
                    />
                  </div>
                </div>
              ))}

              <p className="wm-label pt-2">{'Stagger'}</p>
              {STAGGERS.map((entry) => (
                <code key={entry.token} className="text-host-xs text-wm-text-muted">
                  {`${entry.token} · ${entry.use}`}
                </code>
              ))}
            </div>
          </div>
        </TokenSection>
      </div>
    </div>
  );
}
