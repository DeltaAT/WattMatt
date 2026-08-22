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
