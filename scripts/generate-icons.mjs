/**
 * Generates every raster icon the app ships from one vector definition, so the
 * favicon, PWA icons and social preview can never drift from the in-app logo.
 *
 * Run with:  node scripts/generate-icons.mjs
 *
 * Rendering is done by hand rather than with a library: the shapes are simple
 * signed-distance fields, and this keeps the build free of native image deps.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/* Brand gradient endpoints, matching --brand-from / --brand-to in index.css. */
const BRAND_FROM = [124, 58, 237]; // violet
const BRAND_TO = [37, 99, 235]; // blue

/** Antialiasing factor. Every shape is drawn at N× then box-filtered down. */
const SS = 4;

// ---------------------------------------------------------------------------
// Geometry helpers, all operating in a 0..1 unit square
// ---------------------------------------------------------------------------

/** Distance from a point to a line segment. */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Distance to a rounded rectangle centred in the unit square. */
function distToRoundedRect(px, py, half, radius) {
  const qx = Math.abs(px - 0.5) - (half - radius);
  const qy = Math.abs(py - 0.5) - (half - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/**
 * The mark: a capital N drawn as a relay graph. The three strokes read as a
 * letter at favicon size, while the nodes at each vertex read as a network
 * once there are enough pixels to show them.
 */
const NODES = {
  topLeft: [0.30, 0.28],
  bottomLeft: [0.30, 0.72],
  topRight: [0.70, 0.28],
  bottomRight: [0.70, 0.72],
};

const STROKES = [
  [NODES.bottomLeft, NODES.topLeft], // left upright
  [NODES.topLeft, NODES.bottomRight], // diagonal
  [NODES.bottomRight, NODES.topRight], // right upright
];

/** Coverage of the glyph at a point, 0..1, given stroke and node radii. */
function glyphCoverage(px, py, strokeRadius, nodeRadius) {
  let minDist = Infinity;

  for (const [[ax, ay], [bx, by]] of STROKES) {
    minDist = Math.min(minDist, distToSegment(px, py, ax, ay, bx, by) - strokeRadius);
  }

  for (const [nx, ny] of Object.values(NODES)) {
    minDist = Math.min(minDist, Math.hypot(px - nx, py - ny) - nodeRadius);
  }

  return minDist <= 0 ? 1 : 0;
}


// ---------------------------------------------------------------------------
// A minimal monoline stroke font, built from the same segments-and-caps
// vocabulary as the mark so the wordmark reads as part of the same system.
// Glyphs are defined in a unit box: x 0..width, y 0 (top) .. 1 (bottom).
// ---------------------------------------------------------------------------

/** Emits a polyline approximating an arc, for the curved letters. */
function arc(cx, cy, rx, ry, fromDeg, toDeg, steps = 14) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI) / 180;
    points.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }

  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push([points[i], points[i + 1]]);
  }
  return segments;
}

const GLYPHS = {
  N: { width: 0.62, strokes: [[[0, 1], [0, 0]], [[0, 0], [0.62, 1]], [[0.62, 1], [0.62, 0]]] },
  O: { width: 0.68, strokes: arc(0.34, 0.5, 0.34, 0.5, 0, 360, 26) },
  S: {
    width: 0.60,
    strokes: [
      // Upper bowl: top-right end, sweeping up and over to the middle-left
      ...arc(0.30, 0.28, 0.28, 0.28, -45, -225, 18),
      // Crossover between the two bowls
      [[0.102, 0.478], [0.498, 0.522]],
      // Lower bowl: middle-right, round the bottom to the bottom-left end
      ...arc(0.30, 0.72, 0.28, 0.28, -45, 135, 18),
    ],
  },
  T: { width: 0.60, strokes: [[[0, 0], [0.60, 0]], [[0.30, 0], [0.30, 1]]] },
  R: {
    width: 0.62,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.32, 0]],
      ...arc(0.32, 0.26, 0.28, 0.26, -90, 90, 12),
      [[0.32, 0.52], [0, 0.52]],
      [[0.28, 0.52], [0.62, 1]],
    ],
  },
  F: { width: 0.56, strokes: [[[0, 0], [0, 1]], [[0, 0], [0.56, 0]], [[0, 0.48], [0.44, 0.48]]] },
  E: {
    width: 0.56,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.56, 0]],
      [[0, 0.48], [0.44, 0.48]],
      [[0, 1], [0.56, 1]],
    ],
  },
  D: {
    width: 0.64,
    strokes: [
      [[0, 0], [0, 1]],
      [[0, 0], [0.28, 0]],
      ...arc(0.28, 0.5, 0.36, 0.5, -90, 90, 16),
      [[0.28, 1], [0, 1]],
    ],
  },
};

/**
 * Draws a word into an RGBA buffer.
 * `x`/`y` is the top-left of the text box, `size` the cap height in pixels.
 */
function drawWord(rgba, canvasWidth, word, x, y, size, thickness, colour) {
  const tracking = 0.20 * size;
  let cursor = x;

  for (const character of word.toUpperCase()) {
    const glyph = GLYPHS[character];
    if (!glyph) {
      cursor += 0.45 * size + tracking;
      continue;
    }

    const segments = glyph.strokes.map(([[ax, ay], [bx, by]]) => [
      cursor + ax * size,
      y + ay * size,
      cursor + bx * size,
      y + by * size,
    ]);

    // Only touch the glyph's bounding box rather than scanning the canvas
    const minX = Math.max(0, Math.floor(cursor - thickness));
    const maxX = Math.min(canvasWidth - 1, Math.ceil(cursor + glyph.width * size + thickness));
    const minY = Math.max(0, Math.floor(y - thickness));
    const maxY = Math.ceil(y + size + thickness);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        let dist = Infinity;
        for (const [ax, ay, bx, by] of segments) {
          dist = Math.min(dist, distToSegment(px + 0.5, py + 0.5, ax, ay, bx, by));
        }

        // Soft edge over one pixel gives cheap antialiasing
        const coverage = Math.min(1, Math.max(0, thickness - dist + 0.5));
        if (coverage <= 0) continue;

        const offset = (py * canvasWidth + px) * 4;
        for (let channel = 0; channel < 3; channel++) {
          rgba[offset + channel] = Math.round(
            rgba[offset + channel] * (1 - coverage) + colour[channel] * coverage
          );
        }
      }
    }

    cursor += glyph.width * size + tracking;
  }
}

/** Total advance width of a word, for centring. */
function measureWord(word, size) {
  const tracking = 0.20 * size;
  let width = 0;
  for (const character of word.toUpperCase()) {
    const glyph = GLYPHS[character];
    width += (glyph ? glyph.width * size : 0.45 * size) + tracking;
  }
  return width - tracking;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGBA pixel data as a PNG buffer. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  // Each scanline is prefixed with filter type 0 (None)
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Icon rendering
// ---------------------------------------------------------------------------

/**
 * Renders the app icon.
 *
 * @param size      output edge length in pixels
 * @param options.padding    inset of the tile, as a fraction. Maskable icons
 *                           need generous padding so the safe zone survives
 *                           whatever shape the launcher crops to.
 * @param options.fullBleed  skip the rounded tile and fill the whole canvas
 */
function renderIcon(size, { padding = 0, fullBleed = false } = {}) {
  const dim = size * SS;
  const accum = Buffer.alloc(dim * dim * 4);

  const tileHalf = 0.5 - padding;
  const tileRadius = fullBleed ? 0 : tileHalf * 0.44;

  // Glyph geometry shrinks with the tile so proportions stay constant
  const scale = tileHalf / 0.5;
  const strokeRadius = 0.062 * scale;
  const nodeRadius = 0.088 * scale;

  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const px = (x + 0.5) / dim;
      const py = (y + 0.5) / dim;

      const inTile = fullBleed
        ? true
        : distToRoundedRect(px, py, tileHalf, tileRadius) <= 0;

      const offset = (y * dim + x) * 4;
      if (!inTile) continue;

      // 135° linear gradient across the tile
      const t = Math.min(1, Math.max(0, (px + py) / 2));
      const r = Math.round(BRAND_FROM[0] + (BRAND_TO[0] - BRAND_FROM[0]) * t);
      const g = Math.round(BRAND_FROM[1] + (BRAND_TO[1] - BRAND_FROM[1]) * t);
      const b = Math.round(BRAND_FROM[2] + (BRAND_TO[2] - BRAND_FROM[2]) * t);

      // Glyph coordinates are relative to the tile, not the canvas
      const gx = 0.5 + (px - 0.5) / scale;
      const gy = 0.5 + (py - 0.5) / scale;
      const onGlyph = glyphCoverage(gx, gy, strokeRadius / scale, nodeRadius / scale);

      accum[offset] = onGlyph ? 255 : r;
      accum[offset + 1] = onGlyph ? 255 : g;
      accum[offset + 2] = onGlyph ? 255 : b;
      accum[offset + 3] = 255;
    }
  }

  // Box-filter the supersampled buffer down to the requested size
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * (size * SS) + (x * SS + sx)) * 4;
          const alpha = accum[o + 3];
          // Premultiply so transparent corners don't darken the edge
          r += accum[o] * alpha;
          g += accum[o + 1] * alpha;
          b += accum[o + 2] * alpha;
          a += alpha;
        }
      }

      const offset = (y * size + x) * 4;
      if (a === 0) {
        out.writeUInt32BE(0, offset);
      } else {
        out[offset] = Math.round(r / a);
        out[offset + 1] = Math.round(g / a);
        out[offset + 2] = Math.round(b / a);
        out[offset + 3] = Math.round(a / (SS * SS));
      }
    }
  }

  return encodePng(size, size, out);
}

/** Packs PNGs into a multi-resolution .ico, which older browsers still ask for. */
function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directory = [];
  let offset = 6 + entries.length * 16;

  for (const { size, png } of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // palette
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    directory.push(entry);
    offset += png.length;
  }

  return Buffer.concat([
    header,
    ...directory,
    ...entries.map((entry) => entry.png),
  ]);
}

/** The social preview card: the mark beside the wordmark on a dark field. */
function renderOgImage(width = 1200, height = 630) {
  const rgba = Buffer.alloc(width * height * 4);

  const markSize = 200;
  const markX = (width - markSize) / 2;
  const markY = 130;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;

      // Dark backdrop with a subtle brand-tinted diagonal wash
      const t = (x / width + y / height) / 2;
      rgba[offset] = Math.round(9 + 26 * t);
      rgba[offset + 1] = Math.round(9 + 14 * t);
      rgba[offset + 2] = Math.round(14 + 52 * t);
      rgba[offset + 3] = 255;

      // The mark, drawn in the same geometry as the icons
      const lx = (x - markX) / markSize;
      const ly = (y - markY) / markSize;
      if (lx < 0 || lx > 1 || ly < 0 || ly > 1) continue;

      if (distToRoundedRect(lx, ly, 0.5, 0.22) > 0) continue;

      const gt = Math.min(1, Math.max(0, (lx + ly) / 2));
      const onGlyph = glyphCoverage(lx, ly, 0.062, 0.088);

      rgba[offset] = onGlyph
        ? 255
        : Math.round(BRAND_FROM[0] + (BRAND_TO[0] - BRAND_FROM[0]) * gt);
      rgba[offset + 1] = onGlyph
        ? 255
        : Math.round(BRAND_FROM[1] + (BRAND_TO[1] - BRAND_FROM[1]) * gt);
      rgba[offset + 2] = onGlyph
        ? 255
        : Math.round(BRAND_FROM[2] + (BRAND_TO[2] - BRAND_FROM[2]) * gt);
    }
  }

  const wordSize = 92;
  const wordWidth = measureWord('NOSTRFEED', wordSize);
  drawWord(
    rgba,
    width,
    'NOSTRFEED',
    (width - wordWidth) / 2,
    markY + markSize + 70,
    wordSize,
    7,
    [255, 255, 255]
  );

  return encodePng(width, height, rgba);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const targets = [
  ['favicon-16.png', renderIcon(16)],
  ['favicon-32.png', renderIcon(32)],
  ['apple-touch-icon.png', renderIcon(180)],
  ['icon-192.png', renderIcon(192)],
  ['icon-512.png', renderIcon(512)],
  // Maskable icons are cropped to a circle by some launchers, so the artwork
  // is inset to keep the glyph inside the safe zone.
  ['icon-maskable-512.png', renderIcon(512, { padding: 0.14, fullBleed: true })],
  ['og-image.png', renderOgImage()],
];

for (const [name, buffer] of targets) {
  writeFileSync(join(OUT, name), buffer);
  console.log(`${name.padEnd(26)} ${(buffer.length / 1024).toFixed(1)} KB`);
}

const ico = encodeIco([
  { size: 16, png: renderIcon(16) },
  { size: 32, png: renderIcon(32) },
  { size: 48, png: renderIcon(48) },
]);
writeFileSync(join(OUT, 'favicon.ico'), ico);
console.log(`${'favicon.ico'.padEnd(26)} ${(ico.length / 1024).toFixed(1)} KB`);
