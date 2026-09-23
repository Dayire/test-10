// Headless automated playthrough: node tools/playtest.mjs [fromStepName] [cp]
import { chromium } from 'playwright';
import fs from 'fs';
const [, , from = '', cp = ''] = process.argv;
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 480, height: 270 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:5173/?autostart=1&tex=0.1&tier=low&noauto=1${cp ? '&cp=' + cp : ''}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
await page.addScriptTag({ content: fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8') });
const r = await page.evaluate(([from]) => { const b = window.__bot; const i = from ? b.stepIndex(from) : 0; return b.runAll(Math.max(0, i)); }, [from]);
console.log(r.log.join('\n'));
console.log(r.ok ? `PASS total game time ${r.time}s` : `FAIL at ${r.step}`, JSON.stringify(r.s));
await browser.close();
process.exit(r.ok ? 0 : 1);
