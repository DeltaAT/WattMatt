import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  hexContrastRatio,
  parseHexColor,
  relativeLuminance,
} from '@/styles/contrast';

describe('parseHexColor', () => {
  it('parses six-digit hex', () => {
    expect(parseHexColor('#0E1116')).toEqual({ r: 14, g: 17, b: 22 });
  });

  it('parses three-digit hex by doubling each channel', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    // getComputedStyle returns custom properties with their leading space intact.
    expect(parseHexColor(' #f2f5f9 ')).toEqual(parseHexColor('#F2F5F9'));
  });

  it('returns undefined for an unresolved custom property', () => {
    expect(parseHexColor('')).toBeUndefined();
  });

  it('returns undefined for colour formats it does not handle', () => {
    expect(parseHexColor('rgb(14 17 22)')).toBeUndefined();
    expect(parseHexColor('#0e11')).toBeUndefined();
    expect(parseHexColor('#gggggg')).toBeUndefined();
  });
});

describe('relativeLuminance', () => {
  it('anchors at the WCAG endpoints', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('uses the linear branch below the 0.03928 threshold', () => {
    // 10/255 = 0.0392… — just under the knee, so the divide-by-12.92 branch.
    expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 12);
  });
});

describe('contrastRatio', () => {
  it('returns 21 for black against white', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 10);
  });

  it('returns 1 for a colour against itself', () => {
    expect(contrastRatio({ r: 76, g: 141, b: 255 }, { r: 76, g: 141, b: 255 })).toBeCloseTo(1, 10);
  });

  it('is order-independent', () => {
    const light = { r: 242, g: 245, b: 249 };
    const dark = { r: 14, g: 17, b: 22 };
    expect(contrastRatio(light, dark)).toBeCloseTo(contrastRatio(dark, light), 10);
  });
});

describe('hexContrastRatio', () => {
  it('matches the known ratio of the two base text tokens', () => {
    expect(hexContrastRatio('#F2F5F9', '#0E1116')).toBeCloseTo(17.29, 1);
  });

  it('returns undefined when either colour is unparseable', () => {
    expect(hexContrastRatio('#F2F5F9', 'var(--wm-bg)')).toBeUndefined();
    expect(hexContrastRatio('', '#0E1116')).toBeUndefined();
  });
});
