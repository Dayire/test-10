// Usage: node tools/gallery.mjs <outdir> name[:yaw:pitch:dist:tag:targetY:dx] ...   (all stations when none given)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const [, , outdir = 'shots/gallery', ...req] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5173/';
const W = +(process.env.W || 1100), H = +(process.env.H || 620);
mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + '?dev=assets&tier=' + (process.env.TIER || 'high'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const all = await page.evaluate(() => window.__gallery.stations);
const shots = req.length ? req : all.map((s) => s.name);
for (const s of shots) {
  const [name, yaw, pitch, dist, tag = '', y, dx] = s.split(':');
  const o = {};
  if (yaw) o.yaw = +yaw; if (pitch) o.pitch = +pitch; if (dist) o.dist = +dist; if (y) o.y = +y; if (dx) o.dx = +dx;
  await page.evaluate(([n, o]) => window.__gallery.focus(n, o), [name, o]);
  const start = await page.evaluate(() => window.__frames);
  await page.waitForFunction((n) => window.__frames >= n, start + 3, { timeout: 300000 });
  const file = `${outdir}/${name}${tag ? '-' + tag : ''}.png`;
  await page.screenshot({ path: file, timeout: 300000 });
  console.log(file, JSON.stringify(all.find((a) => a.name === name)), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
for (const l of logs.slice(-20)) console.log(l);
await browser.close();
