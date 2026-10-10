// Screenshots along a chapter: node tools/tour.mjs <outdir> "<query>" name:x:y:facing[:sim[:js]] ... [--chapter id] [--port 5173]
// W / H set the viewport (default 1280 x 720); BASE or --port pick the server.
import { parseArgs, launch, openPage, baseUrl } from './lib/harness.mjs';
const o = parseArgs(process.argv.slice(2), { chapter: '' });
const [outdir, query = '', ...shots] = o._;
const W = +(process.env.W || 1280), H = +(process.env.H || 720);
const q = new URLSearchParams(query);
if (o.chapter) q.set('chapter', o.chapter);
const browser = await launch();
const t0 = Date.now();
const P = await openPage(browser, { w: W, h: H, quiet: true });
const logs = [];
P.page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
await P.goto(baseUrl(o) + '?' + q.toString());
console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
for (const s of shots) {
  const [name, x, y, facing = '1', sim = '0.4', extra = ''] = s.split(':');
  const r = await P.page.evaluate(([x, y, f, sim, extra]) => { const st = window.__medina.photo(+x, +y, +f, +sim); if (extra) eval(extra); return st; }, [x, y, facing, sim, extra]);
  const start = await P.page.evaluate(() => window.__frames);
  await P.page.waitForFunction((n) => window.__frames >= n, start + 3, { timeout: 300000 });
  await P.page.screenshot({ path: `${outdir}/${name}.png`, timeout: 300000 });
  const info = await P.page.evaluate(() => window.__medina.info());
  console.log(name, JSON.stringify({ x: r.x, y: r.y, st: r.st, calls: info.calls, tris: info.tris }));
}
for (const l of [...P.errors.map((e) => `[pageerror] ${e}`), ...logs].slice(-20)) console.log(l);
await browser.close();
