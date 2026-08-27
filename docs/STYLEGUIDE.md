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
hue differences anyway. **Hue may never be the only thing that separates two states.**

This used to be spelled "three signals: colour, an icon, and a German text label". Issue #77
dropped the label from the group-round board — at the numeral sizes issue #75 gave that scene
there is no room beside a number for a word worth reading — so the rule is now stated as the
property it was always protecting, and what is left has to satisfy it without the word.

**A win/lose state must differ in at least two of these, one of which is not hue:**

1. **Luminance.** Two states must be tellable apart with the colour thrown away. Measured, not
   eyeballed: `src/styles/resultContrast.test.ts` composites what is actually painted — the
   loser's `opacity: .6` included — and asserts the separation.
2. **Geometry.** Border weight, ring, or shape. The winner's edge reads 6 px against the
   loser's 2 px. It must cost no layout: in the group box the extra 4 px are an inset
   shadow, so a result landing moves nothing.
3. **Weight.** Losers drop to `opacity: .6` and half saturation. Winners stay at full strength.
4. **An icon** (`✓` / `✗`, filled shapes, not thin outlines) where one fits.

On the round board all four are present. The numbers below are the ones that test pins:

| Pair, in greyscale | Ratio | |
| --- | --- | --- |
| winner edge vs loser edge | ≈ 3.2:1 | clears the 3:1 non-text target |
| winner fill vs loser fill | ≈ 1.4:1 | **the fills alone cannot carry it** |
| winner edge vs winner fill | ≈ 6.3:1 | the ring is what finds the winner in a grid of 32 |

The second row is why the border colours and the winner's ring are not decoration. A later
change that drops them "because the fill already says it" would leave a board that a real part
of the audience cannot read, and nothing would look wrong on a dev machine.

**One stated exception to the contrast table below.** The loser's number is dimmed with its
box and lands at ≈ 6.1:1, under the 7:1 beamer-text target. That dimming is what buys the
3.2:1 edge separation — without it the two borders are 1.5:1 apart and the whole scheme fails.
6.1:1 on a 64–160 px numeral is affordable; hue a twelfth of the room cannot see is not. The
digits themselves are `--wm-text` in every state — the box is coloured, never the number —
which took the loser's number from 3.2:1 to 6.1:1 when the muted colour went.

The `Turnierbaum` and the `Siegerehrung` keep their words: the final phase is names, at sizes
that leave room beside them (issue #23).

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
| `beamer-body` | 2 | 32 px | **The floor a scene is designed to.** See the note below |
| `beamer-caption` | 1.5 | 24 px | Persistent chrome (clock, tournament name), and the bracket's table reference |

**32 px is a design floor, not a hard limit.** Every scene is laid out so that the field sizes
a host normally has land on it or above. Past that, the scene is scaled down until everything
fits rather than dropping what does not (`beamer-fit` and `useFitToStage`, issue #55) — a row
that ended up small can be read by walking closer, and a row that was cut off cannot be read at
all. Anything that goes below 32 px is a scene showing more than it was designed for, which is
the host's call to make; it is never the app quietly deciding what the room does not need to
see.

**A long name steps down before it is cut.** A participant's name is drawn at the step its card
offers, dropped one or two steps towards the 32 px floor when the line cannot hold it, and only
then truncated with an ellipsis (`fitNameType` in `@/ui/nameFit`, issue #23). The 40-character
limit on a name is chosen to be exactly what one card line holds at the floor, so a name a host
can type is always read whole; the ellipsis is there for the longer one a hand-repaired file can
carry. This is per *name* and composes with the per-*scene* scaling above.

A scene may move both ends of that ladder, and one does. A scene where the name *is* the
picture rather than a label on a card gives it more than one line and refuses to go all the way
down to 32 px: the `Siegerehrung` draws a name at `beamer-hero` over at most two lines and
stops at a floor of `beamer-h2` (`{ floor, lines }`, issue #86). The pair of numbers still
meets — two lines of 64 px hold exactly 40 characters — so the guarantee is the same one, at a
different size. Never three lines: at three the name is a paragraph and the block under it has
stopped reading as a podium.

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
- **Nothing is ever clipped or counted.** The stage is `overflow-hidden`, so a card that does
  not fit is a card nobody in the room can know about — and the person it was about is exactly
  the person looking for it. Scenes take more columns as the field grows and then scale the
  whole body down (`beamer-fit`), instead of slicing a list and printing "… und 3 weitere".
- Host hit targets: minimum 32 × 32 px, 40 px for destructive or high-frequency actions
  (setting a winner). The host is clicking fast, under pressure, possibly on a trackpad.

## 4. Component conventions

**Group chip** — the most repeated element in the app. Number in display font, name (once it
exists) beside it, status colour as a left border. Same component in host and beamer, size
driven by a `scale` prop.

**Group box** (`@/ui/GroupBox`, issue #88) — a participant's number, in a container of its
own. Two numerals with nothing between them but space read as one number at ten metres: `7 12`
is `712` to anybody who has not been told otherwise. So a number is never loose text on the
beamer. It gets a box, and it is this box in every group-round scene, driven by a `scale` prop
the way the group chip is.

One component, three states — `NEUTRAL` while the pairing is only drawn or still being played,
then `WINNER` or `LOSER`. **The three differ in paint and in nothing else.** Padding, radius,
border weight and the position of the number are identical in all of them, which is what makes
two separate promises true at once: nothing moves when a result lands (issue #77), and the box
the room watches a pairing land in during the `Auslosung` is the same object that turns green
or red on the round board (issue #88). `src/ui/GroupBox.test.tsx` compares the geometry of the
three states directly, and `groupBoxContinuity.test.tsx` compares the two scenes.

Two lengths in it are relative rather than tokens, and deliberately so:

- `min-w-[2ch]` on the numeral. The digits are tabular, so two of them are exactly the width a
  `12` needs — a `7` reserves it instead of drawing a narrower box, and a wider box therefore
  never implies anything about who is in it. A minimum, not a fixed width, so a three-digit
  field grows instead of clipping.
- `gap-[1.5ch]` between the two boxes of a pairing. "At least as wide as one numeral" only
  stays true across the type ladder if it is stated in numerals; the row keeps `wm-display`
  and its type step for exactly this reason, since that is what `ch` is measured in.

**Bracket node** (`BRACKET`, issue #90) — two name slots, and the number of the table the
match is on in the top-right corner. The table is a *reference*, not content: one type step
under the names at every density (`beamer-body` → `beamer-caption`), muted, and **absolutely
positioned**, so the names keep every pixel they had and no node changes height when a match
starts or ends. It lands over the box each slot reserves for `SIEGER` / `AUSGESCHIEDEN`, which
can never collide with it — that word appears only once the match is decided, and a decided
match has no table to name.

Whether there is one to name is `bracketNodeTableId` in `@/domain/bracket`, shared with the
host panel. A node keeps its `tableId` after it is played (docs/OPEN-QUESTIONS.md #37) but the
table itself went back to the pool, so only a `RUNNING` node names one. Everything else names
nothing at all — no placeholder, no dash and no `0`.

**Match card** — status ribbon at the top (`WARTET` / `LÄUFT` / `BEENDET`), the table above,
the two group boxes below it. What "participant" means differs by screen, and that difference
is the rule (issue #75):

- **On the beamer, in a group round, it is the bare number.** No `Gruppe`, no `Team`, no
  `Spieler`, and no name — `groupNumber` in `@/windows/groupLabel`. The word carries nothing
  and thirty-two copies of it are the width the numerals could have had. The numbers are
  therefore drawn in the display font with tabular figures, at `beamer-hero` where the field
  leaves room and never below `beamer-h2`; `useFitToStage` shrinks the board from there.
  The one word that stays is `Freilos`, because no number can express "advanced without
  playing" (docs/TOURNAMENT-RULES.md §9 case 1).
- **On the beamer, in the final phase, it is the name.** That is the entire point of the naming
  phase (issue #23) and nothing above applies to `BRACKET` or `CEREMONY`.
- **On the host screen it is the full label** — `groupLabel`, participant wording and all.
  A 50 cm control panel has no density problem, and the host needs the sentence.

Same rule for the table: on the beamer a match card names it by its number
(`tableNumber` in `@/windows/tableLabel`), which is the default label `Tisch 3` with the word
taken off. It sits above both group boxes and outside them, so a bare `3` over a bare `7`
cannot read as a third participant (issue #88). A table the host renamed keeps whatever they wrote — the label is their word for a
physical thing in the room. If a dry run shows a bare number over a bare number is ambiguous,
the fallback the issue holds in reserve is a compact `T` marker, not the whole word.

`settings.participantLabel` therefore no longer reaches a beamer **match card** at all. It
still decides the wording of the one-line scene headings that count participants rather than
name them — `GROUP_OVERVIEW`, `WELCOME`, `NAMING` — and the whole of the host UI.

**Podium** (`CEREMONY`, issue #86) — the last picture of the evening and the one the room
photographs, so it is sized to fill the stage rather than to sit in the middle of it. Three
bottom-aligned columns in the 2 · 1 · 3 arrangement, gold the tallest and the widest, and the
three columns plus their gaps come to 106 of the 110.4 units the safe area leaves. Each column
is a name at `beamer-hero` above its block, the block itself with the place number `1` / `2` /
`3` on its face at the same size, and the medal word below it at `beamer-h3`. The name is
exactly as wide as its block, which is what stops it overflowing one. Every length is a
multiple of the beamer unit (`--wm-podium-*`), never a `rem`: a podium built from Tailwind's
`h-40 w-48` is the same 160 × 192 device pixels on a 4K wall as in the host's 300 px preview.

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
