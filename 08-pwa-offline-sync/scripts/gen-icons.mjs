// Generates app icons (SVG + PNG) without external dependencies (PNG encoded with node:zlib).
// Usage: node scripts/gen-icons.mjs
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const BG = [15, 118, 110];      // #0f766e teal
const FG = [255, 255, 255];
const ACC = [250, 204, 21];     // #facc15 sync dot

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
// Shape in unit coordinates (0..1): clipboard outline + check mark + accent dot.
function shade(u, v, maskable) {
  const s = maskable ? 0.72 : 0.86; // content scale (maskable safe zone)
  const x = (u - 0.5) / s + 0.5, y = (v - 0.5) / s + 0.5;
  // board: rounded rect 0.24..0.76 x 0.2..0.84, stroke 0.05
  const inRR = (x0, y0, x1, y1, r) => { const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y)); return Math.hypot(x - cx, y - cy) <= r; };
  const board = inRR(0.22, 0.2, 0.78, 0.86, 0.07) && !inRR(0.28, 0.26, 0.72, 0.8, 0.03);
  const clip = inRR(0.38, 0.14, 0.62, 0.27, 0.04);
  const check = Math.min(segDist(x, y, 0.35, 0.55, 0.46, 0.66), segDist(x, y, 0.46, 0.66, 0.66, 0.42)) < 0.045;
  const dot = Math.hypot(x - 0.74, y - 0.78) < 0.11;
  if (dot) return ACC;
  if (board || clip || check) return FG;
  return null;
}
function iconPixel(maskable) {
  return (px, py, size) => {
    const u = px / size, v = py / size;
    if (!maskable) {
      // rounded-square background with transparent corners
      const r = 0.2; const cx = Math.max(r, Math.min(1 - r, u)), cy = Math.max(r, Math.min(1 - r, v));
      if (Math.hypot(u - cx, v - cy) > r) return [0, 0, 0, 0];
    }
    // 2x2 supersampling for smoother edges
    let acc = [0, 0, 0];
    for (const [dx, dy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
      const c = shade(u + dx / size, v + dy / size, maskable) || BG;
      acc = acc.map((a, i) => a + c[i] / 4);
    }
    return [...acc.map(Math.round), 255];
  };
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<rect width="100" height="100" rx="20" fill="#0f766e"/>
<g transform="translate(50 50) scale(0.86) translate(-50 -50)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
<rect x="25" y="23" width="50" height="60" rx="5" stroke-width="6"/>
<rect x="38" y="14" width="24" height="13" rx="4" fill="#fff" stroke="none"/>
<path d="M35 55 L46 66 L66 42" stroke-width="9"/>
</g>
<circle cx="70.6" cy="74.1" r="9.5" fill="#facc15"/>
</svg>
`;

await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, 'icon.svg'), svg);
await writeFile(join(OUT, 'icon-192.png'), png(192, iconPixel(false)));
await writeFile(join(OUT, 'icon-512.png'), png(512, iconPixel(false)));
await writeFile(join(OUT, 'icon-maskable-512.png'), png(512, iconPixel(true)));
await writeFile(join(OUT, 'apple-touch-icon.png'), png(180, iconPixel(true)));
console.log('icons written to', OUT);
