// Evaluate JS in a running game: node tools/probe.mjs "<query>" "<js>" [--chapter id] [--port 5173]
// The query is appended to the page URL (?chapter= is added when --chapter is given).
import { parseArgs, launch, openPage, baseUrl } from './lib/harness.mjs';
const o = parseArgs(process.argv.slice(2), { w: 640, h: 360, chapter: '' });
const [query = '', js = '__medina.state()'] = o._;
const q = new URLSearchParams(query);
if (o.chapter) q.set('chapter', o.chapter);
const browser = await launch();
const P = await openPage(browser, { url: baseUrl(o) + '?' + q.toString(), w: o.w, h: o.h });
P.page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) console.log('[console]', m.text()); });
const r = await P.page.evaluate(js);
console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
await browser.close();
