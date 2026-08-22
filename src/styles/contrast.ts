/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * docs/STYLEGUIDE.md §1 sets hard contrast targets (7:1 for beamer text, 4.5:1
 * for host body text, 3:1 for non-text UI) because a projector in a lit room
 * destroys anything weaker. Those targets are only worth stating if something
 * checks them, so the maths lives here and is used by both the token guard test
 * and the `/tokens` review page.
 *
 * Deliberately not in `src/domain` — this is presentation maths, not tournament
 * rules, and nothing here influences a result.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const LONG_HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * Parses `#rgb` / `#rrggbb` into 0–255 channels. Returns `undefined` rather
 * than throwing, because callers read these values out of `getComputedStyle`,
 * where an unresolved custom property legitimately comes back as an empty
 * string.
 */
export function parseHexColor(value: string): Rgb | undefined {
  const input = value.trim();

  const long = LONG_HEX.exec(input);
  if (long?.[1] !== undefined && long[2] !== undefined && long[3] !== undefined) {
    return {
      r: parseInt(long[1], 16),
      g: parseInt(long[2], 16),
      b: parseInt(long[3], 16),
    };
  }

  const short = SHORT_HEX.exec(input);
  if (short?.[1] !== undefined && short[2] !== undefined && short[3] !== undefined) {
    return {
      r: parseInt(short[1].repeat(2), 16),
      g: parseInt(short[2].repeat(2), 16),
      b: parseInt(short[3].repeat(2), 16),
    };
  }

  return undefined;
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.1 contrast ratio between two opaque colours, 1 to 21. Order-independent. */
export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Convenience wrapper for the two call sites that hold hex strings.
 * Returns `undefined` if either colour cannot be parsed.
 */
export function hexContrastRatio(foreground: string, background: string): number | undefined {
  const fg = parseHexColor(foreground);
  const bg = parseHexColor(background);
  if (fg === undefined || bg === undefined) {
    return undefined;
  }
  return contrastRatio(fg, bg);
}
