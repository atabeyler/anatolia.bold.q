// Generates desktop/build/icon.ico from scratch (navy square, gold "Q" ring)
// with no external image tooling — this sandbox has neither ImageMagick nor
// Pillow available. Re-run with `node desktop/build/generate-icon.js` if the
// design ever needs to change; it's a build asset generator, not a one-off
// throwaway script.
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

const NAVY = [15, 30, 61, 255];
const GOLD = [212, 175, 55, 255];

function buildPixels(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.38;
  const innerR = size * 0.26;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // The "Q" tail: a diagonal gold bar in the lower-right quadrant.
      const tail = dx > 0 && dy > 0 && Math.abs(dx - dy) < size * 0.07 && dist < outerR * 1.15;

      let color = NAVY;
      if (tail || (dist <= outerR && dist >= innerR)) color = GOLD;

      const i = (y * size + x) * 4;
      pixels[i] = color[0];
      pixels[i + 1] = color[1];
      pixels[i + 2] = color[2];
      pixels[i + 3] = color[3];
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
