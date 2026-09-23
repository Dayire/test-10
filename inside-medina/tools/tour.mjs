// Usage: node tools/tour.mjs <outdir> "<query>" name:x:y:facing[:sim] ...
import { chromium } from 'playwright';
const [, , outdir, query, ...shots] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5173/';
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + '?' + query, { waitUntil: 'load' });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const s of shots) {
  const [name, x, y, facing = '1', sim = '0.4', extra = ''] = s.split(':');
  const r = await page.evaluate(([x, y, f, sim, extra]) => { const st = window.__medina.photo(+x, +y, +f, +sim); if (extra) eval(extra); return st; }, [x, y, facing, sim, extra]);
  const start = await page.evaluate(() => window.__frames);
  await page.waitForFunction((n) => window.__frames >= n, start + 3, { timeout: 300000 });
  await page.screenshot({ path: `${outdir}/${name}.png`, timeout: 300000 });
  const info = await page.evaluate(() => window.__info());
  console.log(name, JSON.stringify({ x: r.x, y: r.y, st: r.st, calls: info.calls, tris: info.tris }));
}
for (const l of logs.slice(-20)) console.log(l);
await browser.close();
