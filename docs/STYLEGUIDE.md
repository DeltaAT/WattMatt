# Style Guide

Two audiences, two visual languages, one token set.

| | Host UI | Beamer UI |
| --- | --- | --- |
| Viewing distance | 50 cm | 5–15 m |
| Priority | density, speed, no surprises | legibility, drama, one idea per screen |
| Base font size | 14–16 px | 32 px minimum |
| Motion | functional, < 250 ms | theatrical, 400–1200 ms |

## 1. Colour

Dark base for both windows. Projectors wash out dark greys and crush pure black, and a white
UI in a dark room is painful to look at.

```css
/* base */
--wm-bg:            #0E1116;  /* never #000 — projectors band and crush it */
--wm-bg-elevated:   #161B22;
--wm-surface:       #1C232D;
--wm-surface-hover: #232C38;
--wm-border:        #2A3340;
--wm-border-strong: #3B4757;

/* text */
--wm-text:          #F2F5F9;  /* never #FFF — reduces halation on a bright beamer */
--wm-text-muted:    #9AA7B8;
--wm-text-faint:    #6B7787;

/* brand */
--wm-accent:        #4C8DFF;
--wm-accent-strong: #2E6BFF;
--wm-accent-soft:   #16223A;

/* status */
--wm-win:           #2FD07A;  --wm-win-bg:   #0F3A28;
--wm-lose:          #FF5A5A;  --wm-lose-bg:  #3D1620;
--wm-live:          #FFB020;  --wm-live-bg:  #3A2A0C;  /* match running */
--wm-idle:          #6B7787;

/* podium */
--wm-gold:   #F5C542;
--wm-silver: #C9D1D9;
--wm-bronze: #CD7F32;
```

### Colour is never the only signal

Roughly 8 % of men have a red–green deficiency, and a beamer in a bright room destroys subtle
hue differences anyway. **Every win/lose state must carry three signals:**

1. colour (`--wm-win` / `--wm-lose`),
2. an icon (`✓` / `✗`, filled shapes, not thin outlines),
3. a German text label (`SIEGER` / `AUSGESCHIEDEN`).

Losers additionally drop to `opacity: .6` and desaturate. Winners keep full contrast and get a
left border of 6 px. The layout must remain readable in greyscale — test it.

### Contrast targets

| Context | Minimum |
| --- | --- |
| Beamer text on background | 7:1 |
| Host body text | 4.5:1 |
| Host non-text UI (borders, icons) | 3:1 |

## 2. Typography

Both families are OFL-licensed and **bundled as local `.woff2`** — no CDN, no Google Fonts.

| Role | Family | Notes |
| --- | --- | --- |
| UI | Inter Variable | `font-feature-settings: 'tnum' 1, 'cv05' 1` |
| Display / beamer headlines | Archivo Expanded | Wide, heavy, readable at distance |
| Numbers (group numbers, scores) | Archivo, tabular figures | Group numbers are the identity of a participant until the naming phase — treat them as a display element, not as body text |

**Never use a light or thin weight on the beamer.** Minimum weight 500; headlines 700–800.
Thin strokes disappear through a projector lens.

### Beamer type scale

The beamer root font size is resolution-relative so the same layout works on 720p, 1080p and
4 K without a single media query:

```css
.beamer-root { font-size: calc(100vw / 120); } /* 1 rem = 16 px at 1920 px wide */
```

| Token | rem | @1080p | Use |
| --- | --- | --- | --- |
| `beamer-hero` | 10 | 160 px | Winner name, single-number reveals |
| `beamer-h1` | 6 | 96 px | Scene title (`ACHTELFINALE`) |
| `beamer-h2` | 4 | 64 px | Group name in a match card |
| `beamer-h3` | 3 | 48 px | Table label, round label |
| `beamer-body` | 2 | 32 px | **Absolute minimum.** Anything smaller is unreadable at 10 m |
| `beamer-caption` | 1.5 | 24 px | Only for persistent chrome (clock, tournament name) |

### Host type scale

`12 / 14 / 16 / 20 / 24 / 32 px`. Body is 14 px, labels 12 px uppercase with `.04em` tracking.

## 3. Layout and spacing

- 8 px grid. Spacing tokens: `4 8 12 16 24 32 48 64 96`.
- Radii: `--wm-radius-sm: 6px`, `-md: 10px`, `-lg: 16px`, `-xl: 24px` (beamer cards).
- **Beamer safe area: 4 % inset on all sides.** Projectors overscan and are rarely aligned
  perfectly. Nothing important goes in the outer 4 %.
- The beamer is always laid out for **16:9**. Letterbox rather than reflow if the projector
  reports something else.
- Beamer screens show **one idea at a time**. If a scene needs a scrollbar, it is the wrong scene.
- Host hit targets: minimum 32 × 32 px, 40 px for destructive or high-frequency actions
  (setting a winner). The host is clicking fast, under pressure, possibly on a trackpad.

## 4. Component conventions

**Group chip** — the most repeated element in the app. Number in display font, name (once it
exists) beside it, status colour as a left border. Same component in host and beamer, size
driven by a `scale` prop.

**Match card** — two group chips separated by a `VS` divider, table label in the corner,
status ribbon at the top (`WARTET` / `LÄUFT` / `BEENDET`).

**Table chip** — label plus status dot: grey `frei`, amber `belegt`, dark red `gesperrt`.
The host's table overview is a live occupancy board and must be readable at a glance.

**Host shell** — left: phase navigation; centre: current round; right: beamer control column
with a live preview thumbnail of exactly what the audience sees.

## 5. Non-negotiables

- No colour literal in a component. Tokens only.
- No `text-transform: uppercase` on German text longer than three words (compound nouns
  become unreadable).
- No pure white surfaces anywhere in the beamer window.
- No thin borders on the beamer: minimum 2 px, 4 px for emphasis.
- Nothing on the beamer may depend on hover — nobody is hovering on a projector.

## 6. Tokens in code

The tokens above are implemented in `src/styles/tokens.css`, which is the **only** file in the
repository allowed to contain a colour literal. `src/styles/tokens.test.ts` enforces that, checks
every token in this document against the file, and asserts the contrast targets in §1.

| Where | What |
| --- | --- |
| `src/styles/tokens.css` | `:root` block with the tokens exactly as named here, plus the Tailwind `@theme` mapping |
| `src/styles/fonts.css` | `@font-face` for both families, from local Fontsource packages |
| `src/styles/global.css` | element defaults, `.beamer-root`, and the custom utilities below |

Tokens reach components as Tailwind utilities, not as raw `var()`:

- colour — `bg-wm-surface`, `text-wm-win`, `border-wm-border-strong`, …
- radii — `rounded-wm-sm` … `rounded-wm-xl`
- type — `text-host-xs` … `text-host-2xl`, `text-beamer-caption` … `text-beamer-hero`
- easing — `ease-out`, `ease-in-out`, `ease-dramatic`, `ease-exit` (the first two deliberately
  replace Tailwind's weaker built-ins, see [MOTION.md](MOTION.md) §3)
- spacing — the numeric utilities (`p-1` = 4 px … `p-24` = 96 px) land on the scale in §3
- durations — `duration-[var(--dur-base)]`; Tailwind has no theme namespace for them

Four project utilities carry rules that are easy to forget:

| Utility | Effect |
| --- | --- |
| `wm-display` | Archivo at `font-stretch: 125%` — the "Expanded" of §2 |
| `wm-tnum` | `font-feature-settings: 'tnum' 1` for a numeric display whose context lost the body default |
| `wm-label` | 12 px uppercase with `.04em` tracking, muted — the host label style of §2 |
| `beamer-safe-area` | the 4 % inset of §3 |
| `beamer-stage` | the 16:9 area a scene is drawn into; the surplus becomes letterbox bars (§3) |

### The beamer unit

`--wm-beamer-unit` is the whole beamer type scale: `.beamer-root` sets its `font-size` to it, and
every `text-beamer-*` token is a multiple of it. The tokens use the unit rather than `rem` on
purpose — `rem` resolves against `<html>` and would ignore `.beamer-root` entirely.

The unit is one 120th of the **stage**, not of the viewport:

```css
--wm-beamer-stage-width: min(100vw, calc(100vh * 16 / 9));
--wm-beamer-unit: calc(var(--wm-beamer-stage-width) / 120);
```

On a 16:9 display `min()` picks `100vw` and this is exactly the `100vw / 120` above. On anything
else the two differ, and that difference is the point: §3 letterboxes rather than reflows, so a
unit derived from the full viewport would size type for a stage that is not there — on 21:9 the
headline would run past the letterboxed edge. The `beamer-stage` utility draws the stage itself.

One consequence is worth knowing before it bites: one unit is only 16 px at 1080p, far below the
32 px floor. **Beamer text must always carry an explicit `text-beamer-*` token.** Inherited text
on the beamer is a bug, not a small style.

### Reviewing tokens

`pnpm dev`, then open `?window=tokens`. The page renders every token — swatches with their live
computed value and contrast ratio, both type scales, spacing, radii and a motion playground. It is
dev-only and is dropped from a release build. The beamer scale renders there at true projected
size, so the only honest way to sign off on §2 is to put that page on the actual beamer.
