import { deflateSync } from 'node:zlib';

/**
 * The WattMatt application icon, drawn from geometry rather than shipped as a
 * binary nobody can edit (issue #31).
 *
 * There is no image library in this project and there is not going to be one:
 * the icon is four straight strokes and a rounded square, and a generator that
 * is 200 lines of arithmetic can be read, reviewed and changed by whoever picks
 * the design up next. Every size Windows asks for comes out of the same
 * definition, so the 16 px taskbar icon and the 256 px Explorer tile can never
 * drift apart.
 *
 * Colours are the app's own tokens (docs/STYLEGUIDE.md §1). The mark is a
 * white `W` on the accent blue — legible on a light taskbar and on a dark one,
 * which a dark-on-dark icon in the app's own `--wm-bg` would not be.
 */

/** `--wm-accent`, the top of the background gradient. */
const ACCENT = [0x4c, 0x8d, 0xff];
/** `--wm-accent-strong`, the bottom of it. */
const ACCENT_STRONG = [0x2e, 0x6b, 0xff];
/** `--wm-text`. Never pure white — the same reason the UI never uses it. */
const MARK = [0xf2, 0xf5, 0xf9];

/** Corner radius as a fraction of the edge, in the Windows 11 ballpark. */
const CORNER = 0.225;

/**
 * The `W`, as a polyline in a unit square. Stroked with round caps and joins
 * rather than built as an outline: a join is then a disc at the vertex, which
 * is both the correct shape and the one that survives being rasterised at
 * 16 px without the mitre spikes a sharp `W` grows at that size.
 */
const STROKE = [
  [0.215, 0.29],
  [0.357, 0.71],
  [0.5, 0.445],
  [0.643, 0.71],
  [0.785, 0.29],
];

/** Half the stroke width, as a fraction of the edge. */
const STROKE_RADIUS = 0.066;

/**
 * Samples per pixel and axis. Eight gives 64 coverage levels, which is what
 * keeps the diagonals of the `W` from stepping visibly at 16 and 24 px — the
 * two sizes Windows shows most often and the two that flatter an icon least.
 */
const SUPERSAMPLE = 8;

/**
 * Renders the icon at `size` × `size` as non-premultiplied RGBA.
 *
 * Deterministic and dependency-free, which is what lets the tests assert on
 * pixels instead of on file bytes — `deflate` output is a function of the zlib
 * build, and an icon test that fails on a different Node version is a test
 * everybody learns to ignore.
 */
export function renderIcon(size) {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`icon size must be a positive integer, got ${size}`);
  }

  const pixels = Buffer.alloc(size * size * 4);
  const radius = CORNER * size;
  const strokeRadius = STROKE_RADIUS * size;
  const points = STROKE.map(([x, y]) => [x * size, y * size]);
  const step = 1 / SUPERSAMPLE;
  const samples = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      // Accumulated premultiplied colour, averaged at the end. Premultiplied
      // because a sample outside the rounded corner contributes no colour at
      // all, and averaging its RGB in would grey the edge.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        const y = py + (sy + 0.5) * step;
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = px + (sx + 0.5) * step;
          if (!insideRoundedSquare(x, y, size, radius)) {
            continue;
          }
          const colour = insideStroke(x, y, points, strokeRadius)
            ? MARK
            : gradient(y / size, ACCENT, ACCENT_STRONG);
          r += colour[0];
          g += colour[1];
          b += colour[2];
          a += 255;
        }
      }

      const offset = (py * size + px) * 4;
      if (a === 0) {
        continue;
      }
      // Unpremultiply: the covered samples carry the colour, all of them.
      const covered = a / 255;
      pixels[offset] = Math.round(r / covered);
      pixels[offset + 1] = Math.round(g / covered);
      pixels[offset + 2] = Math.round(b / covered);
      pixels[offset + 3] = Math.round(a / samples);
    }
  }

  return pixels;
}

function gradient(t, from, to) {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** A square with rounded corners, filling the whole canvas. */
function insideRoundedSquare(x, y, size, radius) {
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** The polyline stroked with round caps and joins: a union of capsules. */
function insideStroke(x, y, points, radius) {
  for (let i = 0; i + 1 < points.length; i += 1) {
    if (insideCapsule(x, y, points[i], points[i + 1], radius)) {
      return true;
    }
  }
  return false;
}

function insideCapsule(x, y, [ax, ay], [bx, by], radius) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared === 0 ? 0 : clamp01(((x - ax) * abx + (y - ay) * aby) / lengthSquared);
  const dx = x - (ax + abx * t);
  const dy = y - (ay + aby * t);
  return dx * dx + dy * dy <= radius * radius;
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes non-premultiplied RGBA as an 8-bit truecolour-with-alpha PNG. */
export function encodePng(pixels, size) {
  const expected = size * size * 4;
  if (pixels.length !== expected) {
    throw new RangeError(`expected ${expected} bytes for ${size}×${size}, got ${pixels.length}`);
  }

  // Filter type 0 (none) on every row. The images are flat colour over a
  // gradient, so deflate does the work and a filter would only cost time.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** The `width × height` an encoded PNG declares, for tests and for tooling. */
export function readPngSize(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError('not a PNG');
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

// ---------------------------------------------------------------------------
// ICO
// ---------------------------------------------------------------------------

/**
 * The sizes the `.ico` carries.
 *
 * 48 is in here for a reason that only shows up once a file association exists
 * (issue #31): Explorer draws `.wattmatt` files at 48 px in its default view,
 * and an `.ico` without that entry gets a 32 px icon stretched by the shell.
 */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/**
 * Below this, entries are stored as a Windows DIB rather than as a PNG.
 *
 * Windows itself reads PNG at every size, but the small entries are the ones
 * that end up in the places with the oldest code — shortcut overlays, the
 * Alt-Tab list, third-party shells — and a DIB there costs a few kilobytes and
 * removes the question.
 */
const DIB_MAX = 64;

/** Packs rendered images into a Windows `.ico`. */
export function encodeIco(images) {
  if (images.length === 0) {
    throw new RangeError('an .ico needs at least one image');
  }

  const encoded = images.map(({ size, pixels }) => ({
    size,
    data: size <= DIB_MAX ? encodeDib(pixels, size) : encodePng(pixels, size),
  }));

  const directory = Buffer.alloc(6 + encoded.length * 16);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // type: icon
  directory.writeUInt16LE(encoded.length, 4);

  let offset = directory.length;
  encoded.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    // 256 is written as 0: the field is a single byte and the format says so.
    directory[entry] = size >= 256 ? 0 : size;
    directory[entry + 1] = size >= 256 ? 0 : size;
    directory[entry + 2] = 0; // palette size: none, this is truecolour
    directory[entry + 3] = 0; // reserved
    directory.writeUInt16LE(1, entry + 4); // colour planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([directory, ...encoded.map(({ data }) => data)]);
}

/** The size of every image in an `.ico`, in the order they are stored. */
export function readIcoSizes(ico) {
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    sizes.push(ico[entry] === 0 ? 256 : ico[entry]);
  }
  return sizes;
}

/**
 * A 32-bit bottom-up DIB with the AND mask an `.ico` entry still has to carry.
 *
 * The mask is all zeros — "opaque everywhere" — because the alpha channel is
 * what actually cuts the corners out. It cannot be left off: the header says
 * the bitmap is twice as tall as the image, and a reader that trusts it would
 * run off the end of the buffer.
 */
function encodeDib(pixels, size) {
  const xor = size * size * 4;
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = maskStride * size;
  const out = Buffer.alloc(40 + xor + mask);

  out.writeUInt32LE(40, 0); // BITMAPINFOHEADER
  out.writeInt32LE(size, 4);
  out.writeInt32LE(size * 2, 8); // image plus mask, as the format demands
  out.writeUInt16LE(1, 12); // planes
  out.writeUInt16LE(32, 14); // bits per pixel
  out.writeUInt32LE(0, 16); // BI_RGB
  out.writeUInt32LE(xor + mask, 20);

  for (let row = 0; row < size; row += 1) {
    // Bottom-up.
    const source = (size - 1 - row) * size * 4;
    for (let column = 0; column < size; column += 1) {
      const from = source + column * 4;
      const to = 40 + (row * size + column) * 4;
      out[to] = pixels[from + 2]; // B
      out[to + 1] = pixels[from + 1]; // G
      out[to + 2] = pixels[from]; // R
      out[to + 3] = pixels[from + 3]; // A
    }
  }

  return out;
}
