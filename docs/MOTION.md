# Motion Guidelines

Animation in WattMatt has two jobs, and they pull in opposite directions:

- **Host UI** — get out of the way. The host clicks hundreds of times per event.
- **Beamer UI** — build tension and make a draw feel like an event. The audience sees each
  moment once.

Every rule below follows from that split.

## 1. The three laws

1. **State commits instantly; animation is a consequence.** A click updates the store in the
   same frame. If the beamer is mid-animation when the next action arrives, the animation
   retargets or snaps to its end state. Nothing is ever queued behind a visual effect.
2. **The host can always skip.** `Space` jumps any beamer animation to its settled state.
   The host never has to wait for a reveal to finish before continuing.
3. **Animate `transform`, `opacity` and `filter` only.** Never animate `width`, `height`,
   `top`, `left`, `margin` or `box-shadow` on the beamer. Layout animation at 1080p on an
   integrated GPU drops frames, and the audience sees every dropped frame.

## 2. Should it animate at all?

| Frequency | Rule |
| --- | --- |
| Host actions repeated 100+ times (marking a winner, tabbing panels) | No animation beyond a 120 ms colour/press feedback |
| Host occasional (dialogs, drawers, toasts) | Standard 150–250 ms |
| Beamer scene changes | 400–600 ms |
| Beamer draws, bracket reveals, ceremony | Choreographed, up to 3 s, always skippable |

**Keyboard-initiated actions never animate.** They are the host's fast path.

## 3. Tokens

```css
/* easing — the CSS built-ins are too weak; these have intent */
--ease-out:      cubic-bezier(0.23, 1, 0.32, 1);      /* enter, reveal, feedback */
--ease-in-out:   cubic-bezier(0.77, 0, 0.175, 1);     /* on-screen movement */
--ease-dramatic: cubic-bezier(0.16, 1, 0.3, 1);       /* beamer reveals */
--ease-exit:     cubic-bezier(0.4, 0, 1, 1);          /* exits only */

/* duration */
--dur-instant: 100ms;  /* press feedback */
--dur-fast:    160ms;  /* host hover, colour change */
--dur-base:    240ms;  /* host dialogs, panels */
--dur-slow:    400ms;  /* beamer scene crossfade */
--dur-reveal:  600ms;  /* beamer single reveal */
--dur-story:   1200ms; /* beamer choreographed sequence step */

/* stagger */
--stagger-tight: 40ms; /* host lists */
--stagger-wide:  80ms; /* beamer cards */
```

**Never use `ease-in` on anything entering.** It delays the first movement — precisely the
moment the eye is watching — and makes the app feel sluggish at identical duration.

Springs (Motion): `{ type: 'spring', duration: 0.5, bounce: 0.2 }`. Keep bounce in `0.1–0.3`.
Use springs for interruptible things — drag, the draw landing, bracket advancement. Use CSS
transitions for anything that can retrigger rapidly, because keyframes restart from zero while
transitions retarget smoothly.

**Never animate from `scale(0)`.** Start at `scale(0.94)` with `opacity: 0`. Nothing in the
physical world appears out of nothing.

## 4. Scene choreography

### 4.1 Auslosung — the draw (the signature moment)

| Beat | Duration | What happens |
| --- | --- | --- |
| Anticipation | 600 ms | All eligible group numbers fade in on a grid and pulse gently. Audience sees the pool. |
| Shuffle | ~1200 ms | Numbers cycle in the pairing slot, `linear`, ~60 ms per tick, decelerating over the last 400 ms. |
| Reveal | 500 ms | The drawn number lands: `scale 0.94 → 1.04 → 1`, spring `bounce 0.25`, accent glow pulse, drawn number removed from the pool grid. |
| Placement | 400 ms | The completed match card slides to its table slot, `--ease-in-out`. |

Maximum 3 s per pairing. Pairings are drawn sequentially, not all at once — the sequence *is*
the entertainment. `Space` skips to the fully drawn board.

### 4.2 Result flip

The instant the host marks a winner:

- Winner card: background → `--wm-win-bg`, left border → `--wm-win` (6 px), `✓` scales
  `0.9 → 1` in 240 ms `--ease-out`, label `SIEGER` fades in.
- Loser card: background → `--wm-lose-bg`, `scale(0.98)`, `opacity: .6`, saturation down,
  `✗` fades in. 320 ms.
- The two run simultaneously — a stagger here would look like hesitation about the result.

### 4.3 Hoffnungsrunde — repechage draw

All losers on screen, dimmed. The drawn candidate lifts: `scale(1) → 1.06`, full opacity,
accent ring, 500 ms `--ease-dramatic`, while the others dim further to `opacity: .35`.
On accept: the card flies to the winners column with a Motion `layoutId` transition (600 ms
spring) and the target counter ticks up. On decline: 200 ms shake (±4 px, two cycles), then
fade to `opacity: .2` and desaturate.

### 4.4 Turnierbaum — bracket

- **First reveal:** nodes stagger in left-to-right at `--stagger-wide`, `opacity 0 → 1`,
  `translateX(-12px) → 0`. Connector lines draw with `stroke-dashoffset` over 500 ms,
  starting 200 ms after their nodes.
- **Advancement:** the winning group chip *moves* into the next node — never fade out and
  fade in. The audience must be able to follow the team with their eyes. Spring,
  `duration 0.6, bounce 0.15`. Implemented as a measured FLIP against `--dur-reveal` and
  `--ease-dramatic` rather than a Motion `layoutId`, because the library is not a dependency
  and one motion system is worth more than the overshoot (issue #25,
  `useBracketAdvance`, docs/OPEN-QUESTIONS.md #70).
- **Focus:** the currently active round is at full opacity; decided rounds sit at `.75`;
  future rounds at `.45`. Transition 400 ms.

### 4.5 Siegerehrung — ceremony

Bronze → silver → gold, 500 ms apart. Each podium block rises with
`translateY(40px) → 0` plus `opacity`, spring `bounce 0.2`; the name arrives 150 ms after its
block. Gold gets a 1200 ms glow bloom and a confetti burst capped at **150 particles**,
auto-stopping after 6 s. Triggered manually by the host — never automatically.

### 4.6 Scene transitions

Crossfade 400 ms `--ease-out`, outgoing `translateY(-8px)`, incoming `translateY(8px) → 0`,
plus a 4 px blur on the outgoing layer. The blur is not decoration: it hides the moment where
two different scenes are visible at once, which otherwise reads as two objects rather than one
transformation. Blackout is a hard 200 ms fade to `--wm-bg` — when the host wants the screen
gone, they want it gone.

## 5. Host UI micro-interactions

| Element | Behaviour |
| --- | --- |
| Button `:active` | `transform: scale(0.97)`, 100 ms `--ease-out` |
| Winner button hover | Background only, 160 ms. No movement — the host aims at it repeatedly |
| Panel/dialog | `scale(0.96) → 1` + opacity, 240 ms, `transform-origin` at the trigger (modals stay centred) |
| Toast | Enter 300 ms from the same edge it exits to; exit 200 ms (exits are always faster than enters) |
| List insert/remove | 40 ms stagger, max 8 items animated, rest appear instantly |
| Table status change | Colour transition only, 160 ms. No pulsing — it would be permanently in motion |

## 6. Performance budget

- Target: **60 fps at 1920 × 1080 on integrated graphics.** Test on the actual event laptop,
  not on a dev machine.
- Maximum ~60 simultaneously animated elements on the beamer. Above that, animate a container.
- `will-change` only during an animation; remove it afterwards.
- Keep `blur()` under 20 px and never blur a full-screen layer for longer than 400 ms.
- Prefer CSS animations for predetermined sequences — they run off the main thread and stay
  smooth while React is busy. Use Motion for dynamic and interruptible motion.

### Performance mode (`Performance-Modus`)

A host toggle for weak hardware or a laggy projector: durations × 0.5, particles off,
blur off, stagger off, glow effects off. It must be switchable **mid-event** without
reloading the beamer window.

It is `settings.performanceMode`, set in the host's settings panel (issue #15) and carried to
the projector in every snapshot, which is what makes it reach a window that is already showing
something. The beamer root carries it as `data-performance-mode`, and `src/styles/global.css`
redefines the duration and stagger tokens under that attribute — so a scene picks it up without
reading the flag itself. The rest of the list above (particles, blur, glow) and reduced motion
are issue #29's.

### Reduced motion

Respect `prefers-reduced-motion: reduce`: keep opacity and colour transitions (they carry
meaning), drop movement, scale and particles. Reduced motion means *fewer and gentler*
animations, not zero — the audience still needs to see that something changed.

## 7. Review checklist

Before merging anything animated:

- [ ] Does this animation have a purpose beyond "looks cool"? If the host sees it 100× per
      event, it should not exist.
- [ ] Is it skippable and interruptible?
- [ ] `transition: all` anywhere? Replace with explicit properties.
- [ ] Any `ease-in` on an entering element? Replace with `--ease-out`.
- [ ] Any `scale(0)` start? Raise to `0.94` + opacity.
- [ ] Exit faster than enter?
- [ ] Still 60 fps with 32 match cards on screen?
- [ ] Correct with `prefers-reduced-motion` and in performance mode?
- [ ] Reviewed at 4× slow motion — do colours cross-fade cleanly, is the transform origin right?

Review animations again the next day with fresh eyes. Timing problems that are invisible
during development are obvious after a night's sleep.
