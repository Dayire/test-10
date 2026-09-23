// Usage: node tools/shot.mjs "<query>" <out.png> [frames=3] [w=1280] [h=720] [evalJs]
import { chromium } from 'playwright';
const [, , query = '', out = 'shot.png', frames = '3', w = '1280', h = '720', evalJs = ''] = process.argv;
const base = process.env.BASE || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(base + (query ? '?' + query : ''), { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 240000 });
} catch (e) { logs.push('TIMEOUT waiting for __ready'); }
if (evalJs) { try { const r = await page.evaluate(evalJs); if (r !== undefined) logs.push('[eval] ' + JSON.stringify(r)); } catch (e) { logs.push('[evalerr] ' + e.message); } }
const start = await page.evaluate(() => window.__frames || 0);
try {
  await page.waitForFunction((n) => (window.__frames || 0) >= n, start + (+frames), { timeout: 240000 });
} catch (e) { logs.push('TIMEOUT waiting frames'); }
await page.screenshot({ path: out });
const info = await page.evaluate(() => window.__info ? window.__info() : null).catch(() => null);
console.log(`shot ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (info) console.log('info', JSON.stringify(info));
for (const l of logs.slice(-40)) console.log(l);
await browser.close();
