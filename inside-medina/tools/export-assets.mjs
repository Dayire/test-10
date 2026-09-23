// Export the procedural assets as GLB blockouts: node tools/export-assets.mjs [outdir]
// Requires the dev server (npm run dev) on 127.0.0.1:5173.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
const outdir = path.resolve(process.argv[2] || 'exports');
fs.mkdirSync(outdir, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://127.0.0.1:5173/?dev=export');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
const data = await page.evaluate(() => window.__export);
const rows = [];
for (const [name, a] of Object.entries(data)) {
  fs.writeFileSync(path.join(outdir, `${name}.glb`), Buffer.from(a.b64, 'base64'));
  rows.push(`${name.padEnd(12)} ${a.size.join(' x ').padEnd(22)} ${String(a.tris).padStart(6)} tris`);
}
console.log(rows.join('\n'));
console.log(`wrote ${rows.length} GLB files to ${outdir}`);
await browser.close();
