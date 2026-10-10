// One screenshot: node tools/shot.mjs "<query>" <out.png> [frames=3] [w=1280] [h=720] [evalJs] [--chapter id] [--port 5173]
import { parseArgs, launch, openPage, baseUrl } from './lib/harness.mjs';
const o = parseArgs(process.argv.slice(2), { chapter: '' });
const [query = '', out = 'shot.png', frames = '3', w = '1280', h = '720', evalJs = ''] = o._;
const q = new URLSearchParams(query);
if (o.chapter) q.set('chapter', o.chapter);
const browser = await launch();
const P = await openPage(browser, { w: +w, h: +h, quiet: true });
const logs = [];
P.page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
const t0 = Date.now();
try { await P.goto(baseUrl(o) + (q.toString() ? '?' + q.toString() : '')); } catch { logs.push('TIMEOUT waiting for __ready'); }
if (evalJs) { try { const r = await P.page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerr] ' + e.message); } }
const start = await P.page.evaluate(() => window.__frames || 0);
try { await P.page.waitForFunction((n) => (window.__frames || 0) >= n, start + (+frames), { timeout: 240000 }); } catch { logs.push('TIMEOUT waiting frames'); }
await P.page.screenshot({ path: out, timeout: 300000 });
const info = await P.page.evaluate(() => (window.__medina ? window.__medina.info() : null)).catch(() => null);
console.log(`shot ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (info) console.log('info', JSON.stringify(info));
for (const l of [...P.errors.map((e) => `[pageerror] ${e}`), ...logs].slice(-40)) console.log(l);
await browser.close();
