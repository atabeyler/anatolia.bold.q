// Generates desktop/build/icon.ico from scratch using the same orbital brand
// language as the in-app logo / `client/public/icon-source.svg`, with no
// external image tooling — this sandbox has neither ImageMagick nor Pillow
// available. Re-run with `node desktop/build/generate-icon.js` if the design
// ever needs to change; it's a build asset generator, not a one-off throwaway
// script.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createCanvasFallbackPng } from './pngEncoder.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIZE = 256;
// electron-builder auto-derives a macOS .icns (and uses this directly for
// the Linux AppImage) from a single PNG, but requires it to be at least
// 1024x1024 -- the 256px master used for the Windows .ico is too small for
// that, hence a separate larger render.
const MAC_ICON_SIZE = 1024;

const BG_CORE = [10, 14, 26, 255];
const BG_EDGE = [18, 28, 46, 255];
const GUIDE = [91, 127, 166, 255];
const GOLD = [212, 175, 55, 255];
const RED = [194, 59, 94, 255];
const BLUE = [63, 127, 209, 255];
const CYAN = [79, 214, 232, 255];

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    Math.round(lerp(a[3], b[3], t)),
  ];
}

function setPixel(pixels, idx, color) {
  pixels[idx] = color[0];
  pixels[idx + 1] = color[1];
  pixels[idx + 2] = color[2];
  pixels[idx + 3] = color[3];
}

function ellipseBand(dx, dy, rx, ry, rot, thickness) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const xr = dx * cos + dy * sin;
  const yr = -dx * sin + dy * cos;
  const norm = Math.sqrt((xr * xr) / (rx * rx) + (yr * yr) / (ry * ry));
  return Math.abs(norm - 1) <= thickness / Math.min(rx, ry);
}

function ellipseDash(dx, dy, rx, ry, rot, totalDashes, onFraction) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const xr = dx * cos + dy * sin;
  const yr = -dx * sin + dy * cos;
  const theta = Math.atan2(yr / ry, xr / rx);
  const normalized = (theta + Math.PI) / (Math.PI * 2);
  const slot = (normalized * totalDashes) % 1;
  return slot <= onFraction;
}

function buildPixels(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 512;
  const guideOuter = 175 * scale;
  const guideInner = 150 * scale;
  const ringOuter = 96 * scale;
  const ringInner = 72 * scale;
  const ellipseRx = 222 * scale;
  const ellipseRy = 96 * scale;
  const dotX = cx - 6 * scale;
  const dotY = cy + 52 * scale;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const bgMix = clamp(dist / (size * 0.76), 0, 1);
      let color = mix(BG_EDGE, BG_CORE, 1 - bgMix);

      if (Math.abs(dist - guideOuter) <= 1.5 * scale) color = GUIDE;
      if (Math.abs(dist - guideInner) <= 1.25 * scale) color = mix(GUIDE, BG_CORE, 0.12);

      const ellipseDefs = [
        { rot: Math.PI / 10, color: GOLD, dashes: 16, on: 0.58 },
        { rot: -Math.PI / 180 * 58, color: RED, dashes: 16, on: 0.58 },
        { rot: Math.PI / 180 * 72, color: BLUE, dashes: 16, on: 0.58 },
      ];
      for (const ellipse of ellipseDefs) {
        if (ellipseBand(dx, dy, ellipseRx, ellipseRy, ellipse.rot, 1.7 * scale) && ellipseDash(dx, dy, ellipseRx, ellipseRy, ellipse.rot, ellipse.dashes, ellipse.on)) {
          color = ellipse.color;
        }
      }

      const ringBand = dist <= ringOuter && dist >= ringInner;
      const tail = dx > 0 && dy > 0 && dist > ringOuter * 0.65 && dist < ringOuter * 1.5 && Math.abs(dy - (0.25 * dx + 20 * scale)) < 5.5 * scale;
      if (ringBand || tail) color = GOLD;

      const dotDist = Math.sqrt((dx - (dotX - cx)) ** 2 + (dy - (dotY - cy)) ** 2);
      if (dotDist <= 13 * scale) color = CYAN;

      const i = (y * size + x) * 4;
      setPixel(pixels, i, color);
    }
  }
  return pixels;
}

const pixels = buildPixels(SIZE);
const png = createCanvasFallbackPng(SIZE, SIZE, pixels, zlib);

// Minimal single-image ICO container wrapping a PNG payload (the modern
// ICO format Windows Vista+ accepts for the 256x256 entry).
const iconDir = Buffer.alloc(6);
iconDir.writeUInt16LE(0, 0); // reserved
iconDir.writeUInt16LE(1, 2); // type: icon
iconDir.writeUInt16LE(1, 4); // 1 image

const entry = Buffer.alloc(16);
entry.writeUInt8(0, 0); // width (0 = 256)
entry.writeUInt8(0, 1); // height (0 = 256)
entry.writeUInt8(0, 2); // color palette
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // color planes
entry.writeUInt16LE(32, 6); // bits per pixel
entry.writeUInt32LE(png.length, 8); // image data size
entry.writeUInt32LE(iconDir.length + entry.length, 12); // offset

const ico = Buffer.concat([iconDir, entry, png]);
fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);

const macPixels = buildPixels(MAC_ICON_SIZE);
const macPng = createCanvasFallbackPng(MAC_ICON_SIZE, MAC_ICON_SIZE, macPixels, zlib);
fs.writeFileSync(path.join(__dirname, 'icon-mac.png'), macPng);

console.log('Wrote desktop/build/icon.ico, icon.png and icon-mac.png');
