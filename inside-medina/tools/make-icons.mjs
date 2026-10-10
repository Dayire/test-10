// App icons for the hosted build (public/icons/*.png): the boy's brass tray with its engraved rosette, lit by a
// low sun, on the night ink of the splash. Rendered in Chromium (Playwright) from SVG, so the icon shares the
// game's procedural geometry (the eight-point star of src/ui/glyphs.js).  node tools/make-icons.mjs
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { star8 } from '../src/ui/glyphs.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'public/icons');
fs.mkdirSync(OUT, { recursive: true });

// a glint: four long rays and four short ones
function sparkle(x, y, R) {
  const p = [];
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2, q = i % 4 === 0 ? R : i % 2 === 0 ? R * 0.38 : R * 0.1;
    p.push(`${(x + Math.cos(a) * q).toFixed(2)} ${(y + Math.sin(a) * q).toFixed(2)}`);
  }
  return `M${p.join('L')}Z`;
}
// r: the tray's radius as a share of the icon (maskable icons keep it inside the 80 % safe circle)
function svg(size, r) {
  const c = 50, R = 50 * r;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    return `M${c + Math.cos(a) * R * 0.5} ${c + Math.sin(a) * R * 0.5}L${c + Math.cos(a) * R * 0.78} ${c + Math.sin(a) * R * 0.78}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <defs>
    <radialGradient id="bg" cx="50%" cy="44%" r="70%"><stop offset="0" stop-color="#2a1a10"/><stop offset=".62" stop-color="#120c08"/><stop offset="1" stop-color="#0b0806"/></radialGradient>
    <radialGradient id="brass" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#ffe7b0"/><stop offset=".32" stop-color="#e6b766"/><stop offset=".7" stop-color="#a8742f"/><stop offset="1" stop-color="#5e3a14"/></radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0c8"/><stop offset=".5" stop-color="#b8843c"/><stop offset="1" stop-color="#4a2c0e"/></linearGradient>
    <radialGradient id="glint" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#fffaf0" stop-opacity="1"/><stop offset=".25" stop-color="#ffe2a8" stop-opacity=".7"/><stop offset="1" stop-color="#ffcf80" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100" height="100" fill="url(#bg)"/>
  <circle cx="${c}" cy="${c + R * 0.06}" r="${R * 1.04}" fill="#000" opacity=".35"/>
  <circle cx="${c}" cy="${c}" r="${R}" fill="url(#rim)"/>
  <circle cx="${c}" cy="${c}" r="${R * 0.9}" fill="url(#brass)"/>
  <g fill="none" stroke="#6b4318" stroke-linejoin="round" opacity=".85">
    <circle cx="${c}" cy="${c}" r="${R * 0.84}" stroke-width="${R * 0.018}"/>
    <path d="${star8(c, c, R * 0.72)}" stroke-width="${R * 0.03}"/>
    <path d="${star8(c, c, R * 0.48, 22.5)}" stroke-width="${R * 0.026}"/>
    <circle cx="${c}" cy="${c}" r="${R * 0.18}" stroke-width="${R * 0.026}"/>
    <path d="${rays}" stroke-width="${R * 0.016}" opacity=".6"/>
  </g>
  <circle cx="${c - R * 0.36}" cy="${c - R * 0.4}" r="${R * 0.55}" fill="url(#glint)" opacity=".55"/>
  <path d="${sparkle(c - R * 0.4, c - R * 0.42, R * 0.34)}" fill="#fffaf0" opacity=".95"/>
</svg>`;
}

const jobs = [
  ['icon-192.png', 192, 0.6], ['icon-512.png', 512, 0.6], ['maskable-512.png', 512, 0.48], ['apple-touch-icon.png', 180, 0.58], ['favicon-32.png', 32, 0.72],
];
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, size, r] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#0b0806">${svg(size, r)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(OUT, name), omitBackground: false });
  console.log(name, size);
}
await browser.close();
