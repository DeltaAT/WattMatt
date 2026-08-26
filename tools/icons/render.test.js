import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  encodeIco,
  encodePng,
  ICO_SIZES,
  readIcoSizes,
  readPngSize,
  renderIcon,
} from './render.js';

/**
 * The icon is generated, so it is tested on pixels rather than on file bytes:
 * `deflate` output is a property of the zlib build, and an icon test that goes
 * red on a different Node version is a test everybody learns to skip.
 *
 * The committed files are checked structurally, which is what catches the one
 * mistake that actually happens — `render.js` changed and `pnpm icons` was
 * never run, or a size Windows needs quietly disappeared from the `.ico`.
 */

const ICONS = new URL('../../src-tauri/icons/', import.meta.url);

function read(name) {
  return readFileSync(fileURLToPath(new URL(name, ICONS)));
}

/** The RGBA of the pixel at a fraction of the way across and down. */
function sample(pixels, size, xFraction, yFraction) {
  const x = Math.floor(xFraction * size);
  const y = Math.floor(yFraction * size);
  const offset = (y * size + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

describe('the WattMatt icon', () => {
  it('renders one RGBA quadruple per pixel', () => {
    expect(renderIcon(16)).toHaveLength(16 * 16 * 4);
    expect(renderIcon(256)).toHaveLength(256 * 256 * 4);
  });

  it('refuses a size that is not a positive whole number', () => {
    expect(() => renderIcon(0)).toThrow(RangeError);
    expect(() => renderIcon(12.5)).toThrow(RangeError);
  });

  it('rounds its corners away', () => {
    const size = 128;
    const pixels = renderIcon(size);
    expect(sample(pixels, size, 0, 0)[3]).toBe(0);
    expect(sample(pixels, size, 0.99, 0)[3]).toBe(0);
    expect(sample(pixels, size, 0, 0.99)[3]).toBe(0);
    expect(sample(pixels, size, 0.99, 0.99)[3]).toBe(0);
  });

  it('draws a light mark on the accent blue', () => {
    const size = 128;
    const pixels = renderIcon(size);

    // Halfway down the left arm of the W, and above the W where the background
    // is all there is.
    const [markR, markG, markB, markA] = sample(pixels, size, 0.286, 0.5);
    expect(markA).toBe(255);
    expect(Math.min(markR, markG, markB)).toBeGreaterThan(0xe0);

    const [backR, backG, backB, backA] = sample(pixels, size, 0.5, 0.12);
    expect(backA).toBe(255);
    expect(backB).toBeGreaterThan(0xf0);
    expect(backB - backR).toBeGreaterThan(0x40);
    expect(backG).toBeGreaterThan(backR);
  });

  /** Top to bottom, `--wm-accent` into `--wm-accent-strong`. */
  it('shades the background from the lighter accent to the stronger one', () => {
    const size = 128;
    const pixels = renderIcon(size);
    const top = sample(pixels, size, 0.5, 0.1);
    const bottom = sample(pixels, size, 0.5, 0.9);
    expect(top[0]).toBeGreaterThan(bottom[0]);
    expect(top[1]).toBeGreaterThan(bottom[1]);
  });

  /** Diagonals at 16 px are the whole reason for supersampling. */
  it('antialiases rather than stepping', () => {
    const size = 64;
    const pixels = renderIcon(size);
    const partial = [];
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] > 0 && pixels[index] < 255) {
        partial.push(pixels[index]);
      }
    }
    expect(partial.length).toBeGreaterThan(0);
  });
});

describe('the PNG encoder', () => {
  it('writes a truecolour-with-alpha image of the size it was given', () => {
    const png = encodePng(renderIcon(32), 32);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(readPngSize(png)).toEqual({ width: 32, height: 32 });
    // IHDR: 8 bits per channel, colour type 6.
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('refuses pixel data that does not match the size', () => {
    expect(() => encodePng(renderIcon(16), 32)).toThrow(RangeError);
  });
});

describe('the ICO encoder', () => {
  const ico = encodeIco(ICO_SIZES.map((size) => ({ size, pixels: renderIcon(size) })));

  it('carries every size in its directory', () => {
    expect(readIcoSizes(ico)).toEqual(ICO_SIZES);
  });

  /** The byte is a byte, so the format spells 256 as 0. */
  it('writes the 256 px entry as a zero', () => {
    const last = 6 + (ICO_SIZES.length - 1) * 16;
    expect(ico[last]).toBe(0);
    expect(ico[last + 1]).toBe(0);
  });

  it('points every entry at data inside the file', () => {
    const count = ico.readUInt16LE(4);
    for (let index = 0; index < count; index += 1) {
      const entry = 6 + index * 16;
      const bytes = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset).toBeGreaterThanOrEqual(6 + count * 16);
      expect(offset + bytes).toBeLessThanOrEqual(ico.length);
    }
  });

  /** Small entries are DIBs, the two large ones are PNGs. */
  it('stores the small sizes as bitmaps and the large ones as PNGs', () => {
    const at = (index) => {
      const entry = 6 + index * 16;
      return ico.subarray(
        ico.readUInt32LE(entry + 12),
        ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8),
      );
    };
    // BITMAPINFOHEADER is 40 bytes and says so in its first field.
    expect(at(0).readUInt32LE(0)).toBe(40);
    expect(at(ICO_SIZES.indexOf(256)).subarray(1, 4).toString('ascii')).toBe('PNG');
  });

  it('needs at least one image', () => {
    expect(() => encodeIco([])).toThrow(RangeError);
  });
});

describe('the committed icons', () => {
  it('are the sizes the bundle configuration names', () => {
    expect(readPngSize(read('32x32.png'))).toEqual({ width: 32, height: 32 });
    expect(readPngSize(read('128x128.png'))).toEqual({ width: 128, height: 128 });
    expect(readPngSize(read('128x128@2x.png'))).toEqual({ width: 256, height: 256 });
    expect(readPngSize(read('icon.png'))).toEqual({ width: 512, height: 512 });
  });

  /**
   * 48 is the one that is easy to lose and hard to notice: it is what Explorer
   * draws a `.wattmatt` file with, and without it the shell stretches the 32 px
   * entry (issue #31, file association).
   */
  it('ship an .ico with every size Windows asks for, 48 px included', () => {
    const sizes = readIcoSizes(read('icon.ico'));
    expect(sizes).toEqual(ICO_SIZES);
    expect(sizes).toContain(48);
  });

  /**
   * The one mistake that actually happens: `render.js` changed and `pnpm icons`
   * was never run, so the repository ships the previous drawing.
   *
   * Checked through the `.ico`'s 32 px entry because that one is an
   * uncompressed bitmap, which makes the comparison exact without depending on
   * what `deflate` happened to produce. Comparing the PNGs byte for byte would
   * fail on a different zlib for no reason at all.
   */
  it('are the drawing the generator produces today', () => {
    const ico = read('icon.ico');
    const index = ICO_SIZES.indexOf(32);
    const entry = 6 + index * 16;
    const offset = ico.readUInt32LE(entry + 12);
    const expected = renderIcon(32);

    for (let row = 0; row < 32; row += 1) {
      for (let column = 0; column < 32; column += 1) {
        // The bitmap is bottom-up and BGRA; the render is top-down and RGBA.
        const stored = offset + 40 + ((31 - row) * 32 + column) * 4;
        const rendered = (row * 32 + column) * 4;
        expect([ico[stored + 2], ico[stored + 1], ico[stored], ico[stored + 3]]).toEqual([
          expected[rendered],
          expected[rendered + 1],
          expected[rendered + 2],
          expected[rendered + 3],
        ]);
      }
    }
  });
});
