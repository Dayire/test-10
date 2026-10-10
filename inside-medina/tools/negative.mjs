// Failure-path suites: node tools/negative.mjs [--chapter souk | --suite foundation] [--only name] [--selftest-fail] [--port 5173]
// Runs tools/neg/<chapter>.mjs. Each scenario { name, cp?, query?, fresh?, run(ctx) -> result, check(result) -> true | 'why' }
// opens a fresh page when it names a checkpoint, a query or fresh: true; otherwise it continues on the previous page.
// Every scenario is asserted; the exit code is 1 if any fails. --selftest-fail adds a deliberately broken assertion.
import { parseArgs, launch, openPage, gameUrl, exists } from './lib/harness.mjs';

const o = parseArgs(process.argv.slice(2), { w: 320, h: 180 });
const suite = o.suite || o.chapter;
if (!exists(`tools/neg/${suite}.mjs`)) { console.log(`no negative suite for ${suite}`); process.exit(1); }
const mod = await import(new URL(`./neg/${suite}.mjs`, import.meta.url));
let scenarios = mod.scenarios.slice();
if (o.only) scenarios = scenarios.filter((s) => s.name.includes(o.only));
if (o.selftestFail) scenarios.push({ name: 'selftest: broken assertion', cp: 0, run: async ({ page }) => page.evaluate(() => __medina.state().x), check: (x) => (x === -12345 ? true : `x is ${x}, the selftest expects -12345`) });

const browser = await launch();
let P = null, failed = 0;
const t0 = Date.now();
for (const sc of scenarios) {
  let res, verdict;
  try {
    if (!P || sc.cp !== undefined || sc.query || sc.fresh) {
      if (P) await P.close();
      const opts = { ...o, chapter: sc.chapter ?? (o.suite ? 'souk' : o.chapter), cp: sc.cp };
      P = await openPage(browser, { url: sc.url === false ? null : gameUrl(opts, sc.query || {}), w: sc.w || o.w, h: sc.h || o.h, init: sc.init || null, quiet: true });
    }
    res = await sc.run({ page: P.page, P, o, gameUrl, openPage, browser });
    verdict = sc.check(res);
    if (verdict === true && P.errors.length && !sc.allowErrors) verdict = `page errors: ${P.errors.slice(0, 3).join(' | ')}`;
  } catch (e) { verdict = `threw: ${e.message.split('\n')[0]}`; }
  const ok = verdict === true;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${sc.name.padEnd(36)} ${JSON.stringify(res)?.slice(0, 220)}${ok ? '' : `\n      -> ${verdict}`}`);
  if (P && P.errors.length) P.errors.length = 0;
}
if (P) await P.close();
await browser.close();
console.log(`${scenarios.length - failed}/${scenarios.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
