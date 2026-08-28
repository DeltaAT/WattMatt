import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GroupBox, type GroupBoxScale, type GroupBoxState } from '@/ui/GroupBox';

/**
 * The box a participant's number sits in (issue #88).
 *
 * Two claims are worth testing here rather than in either scene that uses it,
 * because both are about the box being *one* thing:
 *
 *  - **Geometry never changes.** Not between the three states, and not when a
 *    result lands. Issue #77 requires that nothing moves as a board turns over,
 *    and issue #88 requires that the box in the `Auslosung` is the box on the
 *    round board. A single stray padding class in one state breaks both, and
 *    neither scene's own test would notice.
 *  - **A `7` is the same size as a `12`.** The issue's second acceptance
 *    criterion — a wider box must not imply anything about who is in it.
 */

const box = (props: { number: string; state: GroupBoxState; scale: GroupBoxScale }) =>
  renderToStaticMarkup(<GroupBox {...props} />);

/** The class list of the box itself, in the order it is written. */
function boxClasses(markup: string): string[] {
  return (/^<span class="([^"]*)"/.exec(markup)?.[1] ?? '').split(' ').filter(Boolean);
}

/** Everything about the box that is not colour: what must never differ. */
function geometry(markup: string): string[] {
  return boxClasses(markup)
    .filter((name) => !/^(?:border-wm|bg-wm|text-wm|wm-result|opacity|saturate)/.test(name))
    .sort();
}

/** The class list of the numeral inside. */
function numberClasses(markup: string): string[] {
  return (/class="([^"]*)"[^>]*data-group-number/.exec(markup)?.[1] ?? '').split(' ');
}

/** The middle dot the neutral box used to draw, as a char code so it is visible. */
const DOT = String.fromCharCode(0xb7);

const STATES: GroupBoxState[] = ['NEUTRAL', 'WINNER', 'LOSER'];
const SCALES: GroupBoxScale[] = ['hero', 'h1', 'h2'];

describe('the group box', () => {
  it('draws the number it is given', () => {
    expect(box({ number: '12', state: 'NEUTRAL', scale: 'hero' })).toContain('>12<');
  });

  it('says which state it is in', () => {
    for (const state of STATES) {
      expect(box({ number: '7', state, scale: 'h1' })).toContain(`data-outcome="${state}"`);
    }
  });

  /*
   * The issue's third acceptance criterion: "the box a group sits in during the
   * draw is the same box that later turns green or red — no visual
   * discontinuity when the round starts". Only paint may differ between the
   * three states; every length must be identical.
   */
  it('has the same geometry in all three states', () => {
    for (const scale of SCALES) {
      const shapes = STATES.map((state) => geometry(box({ number: '7', state, scale })));

      expect(shapes[1], scale).toEqual(shapes[0]);
      expect(shapes[2], scale).toEqual(shapes[0]);
    }
  });

  /* 2 px of border in every state, and never more: the winner's extra 4 px are
   * an inset shadow, which paints inside a box already laid out (issue #77). */
  it('never changes its border weight for a result', () => {
    for (const state of STATES) {
      const classes = boxClasses(box({ number: '7', state, scale: 'hero' }));

      expect(classes, state).toContain('border-[2px]');
      expect(classes.filter((name) => name.startsWith('border-['))).toHaveLength(1);
    }
  });

  /*
   * The issue's second acceptance criterion. `wm-tnum` gives every digit the
   * same advance, so a minimum of two of them is exactly the width a `12`
   * needs — and a `7` reserves it rather than drawing a narrower box.
   */
  it('gives a one-digit number the same box as a two-digit one', () => {
    const one = box({ number: '7', state: 'NEUTRAL', scale: 'hero' });
    const two = box({ number: '12', state: 'NEUTRAL', scale: 'hero' });

    expect(boxClasses(two)).toEqual(boxClasses(one));
    expect(numberClasses(two)).toEqual(numberClasses(one));
    expect(numberClasses(one)).toContain('min-w-[2ch]');
    expect(numberClasses(one)).toContain('wm-tnum');
  });

  /*
   * Issue #100. The neutral box used to draw a `·`, and on a pairing that put
   * one squarely in the gap between the two numbers — the one place issue #88
   * wanted empty, because a mark between two numerals is what lets them read
   * as a single string again. The slot stays reserved so a result landing
   * still moves nothing; it is simply blank until there is a result.
   */
  it('draws no glyph at all while there is no result', () => {
    const markup = box({ number: '7', state: 'NEUTRAL', scale: 'hero' });

    expect(markup).toContain('data-outcome-icon=""></span>');
    expect(markup).not.toContain(DOT);
  });

  /*
   * "Centre on the numeral, not on the text box" (issue #100).
   *
   * `justify-center` centres the row — glyph, gap and number — so the numeral
   * itself sat half a glyph right of the box's middle, and a box stretched to
   * the width of a match card sat a long way right of it. The fix is a mirror
   * of the glyph slot on the other side, which is only a fix while the two are
   * the same width.
   */
  it('reserves the same width on both sides of the numeral', () => {
    for (const scale of SCALES) {
      for (const state of STATES) {
        const markup = box({ number: '12', state, scale });
        const icon = /class="([^"]*)"[^>]*data-outcome-icon/.exec(markup)?.[1] ?? '';
        const balance = /class="([^"]*)"[^>]*data-outcome-balance/.exec(markup)?.[1] ?? '';

        const widths = (classes: string) =>
          classes
            .split(' ')
            .filter((name) => /^(?:w-|shrink-|text-beamer-)/.test(name))
            .sort();

        expect(widths(balance), `${scale} / ${state}`).toEqual(widths(icon));
        expect(widths(icon), `${scale} / ${state}`).toContain('w-[1.2em]');
      }
    }
  });

  /* The mirror is a spacer, not a second signal: whatever the glyph slot says,
   * the other side says nothing. */
  it('keeps the mirrored slot empty in every state', () => {
    for (const state of STATES) {
      expect(box({ number: '7', state, scale: 'h1' }), state).toContain(
        'data-outcome-balance=""></span>',
      );
    }
  });

  /*
   * Three signals, of which two are not hue (docs/STYLEGUIDE.md §1): the ring
   * is geometry, the dimming is luminance, and the glyph is neither. Read as
   * units, because counting rings and ticks across a document passes just as
   * happily when the loser is wearing the tick.
   */
  it('separates a winner from a loser without colour', () => {
    const winner = box({ number: '7', state: 'WINNER', scale: 'h1' });
    const loser = box({ number: '8', state: 'LOSER', scale: 'h1' });

    expect(winner).toContain('✓');
    expect(boxClasses(winner)).toContain('wm-result-ring');
    expect(boxClasses(winner)).not.toContain('opacity-60');

    expect(loser).toContain('✗');
    expect(boxClasses(loser)).not.toContain('wm-result-ring');
    expect(boxClasses(loser)).toContain('opacity-60');
  });

  /*
   * The one stated exception in docs/STYLEGUIDE.md §1 turns on this: the box is
   * coloured and the digits are not, so a number is exactly as readable when
   * its match is lost as when it is won.
   */
  it('draws the digits at full contrast in every state', () => {
    for (const state of STATES) {
      expect(boxClasses(box({ number: '7', state, scale: 'h1' })), state).toContain('text-wm-text');
    }
  });

  /*
   * The flip belongs to the moment a result is decided, not to the state of
   * being decided (issue #29). A beamer that is merely catching up carries the
   * colour, the ring and the glyph without replaying an hour of the evening.
   */
  describe('the flip', () => {
    it('runs only when the window watched the result land', () => {
      const caughtUp = renderToStaticMarkup(<GroupBox number="7" state="WINNER" scale="h1" />);
      const live = renderToStaticMarkup(<GroupBox number="7" state="WINNER" scale="h1" flip />);

      expect(caughtUp).not.toContain('wm-result-win');
      expect(caughtUp).toContain('wm-result-ring');
      expect(live).toContain('wm-result-win');
    });

    it('never runs on a box that has no result', () => {
      const markup = renderToStaticMarkup(<GroupBox number="7" state="NEUTRAL" scale="h1" flip />);

      expect(markup).not.toContain('wm-result-win');
      expect(markup).not.toContain('wm-result-lose');
    });
  });

  /*
   * 32 px is the floor for anything on a projector (docs/STYLEGUIDE.md §2). The
   * numeral is well above it at every step; the glyph beside it is the part
   * that could quietly fall through, since it is deliberately the smaller of
   * the two.
   */
  it('keeps every step above the beamer type floor', () => {
    for (const scale of SCALES) {
      const markup = box({ number: '7', state: 'WINNER', scale });

      for (const smaller of ['text-host-xs', 'text-host-sm', 'text-beamer-caption']) {
        expect(markup, `${scale} / ${smaller}`).not.toContain(smaller);
      }
    }
  });

  /* A number is a number, not a numbered thing: the ladder must actually
   * ladder, or a `scale` prop that does nothing would pass everything above. */
  it('draws a bigger number at a bigger scale', () => {
    const steps = SCALES.map((scale) =>
      numberClasses(box({ number: '7', state: 'NEUTRAL', scale })).find((name) =>
        name.startsWith('text-beamer-'),
      ),
    );

    expect(steps).toEqual(['text-beamer-hero', 'text-beamer-h1', 'text-beamer-h2']);
  });
});
