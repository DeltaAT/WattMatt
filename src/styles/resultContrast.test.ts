import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, parseHexColor, relativeLuminance, type Rgb } from '@/styles/contrast';

/**
 * Issue #77's second acceptance criterion, computed rather than eyeballed.
 *
 * > Screenshot the decided board and convert it to greyscale — winner and loser
 * > must still be tellable apart. If they are not, the mitigations above have
 * > failed and this needs rethinking before it goes in front of an audience.
 *
 * A test runner cannot screenshot a projector, but greyscale *is* arithmetic:
 * converting an image to grey is exactly the relative-luminance function
 * `@/styles/contrast` already implements for the §1 targets. So this composites
 * what the two states actually paint — including the loser's `opacity: .6` over
 * the beamer background — and asks how far apart the results are.
 *
 * The answer matters because the issue is knowingly removing a signal. Roughly
 * 8 % of men have a red–green deficiency and a projector in a lit room flattens
 * hue further, so "green means won" is a sentence a real part of the audience
 * cannot read. Everything asserted below is a difference that survives having
 * no hue at all.
 *
 * **The finding this test exists to pin down:** the fills alone do *not* carry
 * it. `--wm-win-bg` against the dimmed `--wm-lose-bg` is about 1.4:1 in
 * greyscale, which is not a difference anybody reads from ten metres. The edge
 * does — about 3.2:1 — which is why the border colour and the winner's extra
 * 4 px of ring are not decoration and must not be "simplified away" later.
 */

const TOKENS = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

/** The value of a token, as written in `tokens.css`. */
function token(name: string): string {
  const found = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(TOKENS)?.[1];
  if (found === undefined) {
    throw new Error(`${name} is not declared in tokens.css`);
  }
  return found.trim();
}

function colour(name: string): Rgb {
  const parsed = parseHexColor(token(name));
  if (parsed === undefined) {
    throw new Error(`${name} is not a hex colour: ${token(name)}`);
  }
  return parsed;
}

/**
 * What `opacity` actually paints: the element composited over what is behind it.
 *
 * CSS compositing happens in sRGB, which is what these channels are, so this is
 * the same arithmetic the compositor does.
 */
function over(front: Rgb, back: Rgb, alpha: number): Rgb {
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return { r: mix(front.r, back.r), g: mix(front.g, back.g), b: mix(front.b, back.b) };
}

/** docs/STYLEGUIDE.md §1: the target for non-text UI, which a border is. */
const NON_TEXT_TARGET = 3;

/** The loser's dimming, from `OUTCOME_BOX` in `RoundBoardScene.tsx`. */
const LOSER_OPACITY = 0.6;

const bg = colour('--wm-bg');
const win = colour('--wm-win');
const winFill = colour('--wm-win-bg');
const lose = colour('--wm-lose');
const loseFill = colour('--wm-lose-bg');

/** The loser as it is actually painted: its colours at .6 over the stage. */
const loserEdge = over(lose, bg, LOSER_OPACITY);
const loserFill = over(loseFill, bg, LOSER_OPACITY);

describe('a decided result in greyscale (issue #77)', () => {
  /*
   * The one that carries the result. Above §1's 3:1 bar for non-text UI, which
   * is the same bar a border between two adjacent surfaces has to clear.
   */
  it('separates the two edges by more than the non-text contrast target', () => {
    expect(contrastRatio(win, loserEdge)).toBeGreaterThanOrEqual(NON_TEXT_TARGET);
  });

  /*
   * And in the right direction. A pair of colours can be 3:1 apart with the
   * loser being the brighter one, which would read as the loser having won.
   */
  it('makes the winner the brighter of the two, not merely the different one', () => {
    expect(relativeLuminance(win)).toBeGreaterThan(relativeLuminance(loserEdge));
    expect(relativeLuminance(winFill)).toBeGreaterThan(relativeLuminance(loserFill));
  });

  /*
   * The finding. This is deliberately asserted rather than left implicit: it is
   * the reason `wm-result-ring` and the border colours exist, and a future
   * change that drops them "because the fill already says it" would be wrong in
   * a way nobody notices until an event.
   */
  it('records that the fills alone cannot carry it', () => {
    const fills = contrastRatio(winFill, loserFill);

    expect(fills).toBeLessThan(NON_TEXT_TARGET);
    // Pinned so a token edit that changed the picture shows up here rather than
    // in a dry run: if this starts failing, re-read the whole file.
    expect(fills).toBeGreaterThan(1.2);
    expect(fills).toBeLessThan(1.6);
  });

  /*
   * The winner's own edge against its own fill: a bright ring on a dark box.
   * This is what makes the winner findable at a glance in a grid of thirty-two,
   * before anybody reads a single number.
   */
  it('rings the winner far more strongly than the loser', () => {
    const winnerRing = contrastRatio(win, winFill);
    const loserRing = contrastRatio(loserEdge, loserFill);

    expect(winnerRing).toBeGreaterThanOrEqual(NON_TEXT_TARGET);
    expect(winnerRing).toBeGreaterThan(loserRing * 2);
  });

  /*
   * And the number stays readable in both. Issue #77 colours the box and not
   * the digits, but the loser's dimming reaches the digits too — so the text
   * target has to be checked against what is actually painted, not against the
   * token in isolation.
   *
   * The loser lands at about 6.1:1, under §1's 7:1 for beamer text, and that is
   * a **stated exception** rather than an oversight (docs/STYLEGUIDE.md §1).
   * The dimming is what buys the 3.2:1 edge separation asserted above: without
   * it the two borders are 1.5:1 apart and the greyscale criterion fails
   * outright. 6.1:1 on a 64–160 px numeral is a trade this scene can afford;
   * hue that a twelfth of the room cannot see is not.
   */
  const BEAMER_TEXT_TARGET = 7;
  const DIMMED_FLOOR = 6;

  it('keeps the winner number at the beamer text target', () => {
    expect(contrastRatio(colour('--wm-text'), winFill)).toBeGreaterThanOrEqual(BEAMER_TEXT_TARGET);
  });

  it('keeps the dimmed loser number above the stated exception floor', () => {
    const dimmedText = over(colour('--wm-text'), bg, LOSER_OPACITY);

    expect(contrastRatio(dimmedText, loserFill)).toBeGreaterThanOrEqual(DIMMED_FLOOR);
    expect(contrastRatio(dimmedText, loserFill)).toBeLessThan(BEAMER_TEXT_TARGET);
  });

  /*
   * And issue #77 *improved* this rather than costing it. Before, the loser's
   * digits were `--wm-text-muted` **and** dimmed, which is 3.2:1 — half the
   * target. "Colour the box, not the digits" is what took them back to full
   * strength.
   */
  it('reads better than the muted digits it replaced', () => {
    const dimmedText = over(colour('--wm-text'), bg, LOSER_OPACITY);
    const dimmedMuted = over(colour('--wm-text-muted'), bg, LOSER_OPACITY);

    expect(contrastRatio(dimmedText, loserFill)).toBeGreaterThan(
      contrastRatio(dimmedMuted, loserFill),
    );
  });
});
