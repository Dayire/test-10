// Leak and census cycle: node tools/cycle.mjs [--cycles 3] [--path souk,lab,souk,sundown,souk] [--port 5173]
// Loads the chapters in order (the first one at boot), several times over, and asserts:
//   geometries and textures at every souk load within +2 of the first souk load,
//   renderer programs stable from the second cycle on,
//   __medina.lights() identical after every load,
//   no page errors.
import { parseArgs, launch, openPage, gameUrl } from './lib/harness.mjs';

const o = parseArgs(process.argv.slice(2), { w: 480, h: 270 });
const path = (o.path || 'souk,lab,souk,sundown,souk').split(',');
const cycles = +(o.cycles || 3);
const browser = await launch();
const P = await openPage(browser, { url: gameUrl({ ...o, chapter: path[0], cp: 0 }), w: o.w, h: o.h });
const page = P.page;
const sample = async (id) => page.evaluate(async (id) => {
  const M = __medina;
  const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  if (id) await M.loadChapter(id, 0);
  await frames(4);
  const i = M.info();
  return { id: M.chapter(), geos: i.geos, tex: i.tex, programs: i.programs, lights: M.lights(), ms: M.game.loader.stats?.ms };
}, id);

const rows = [];
rows.push({ cycle: 0, ...(await sample(null)) });
for (let c = 1; c <= cycles; c++) for (const id of path.slice(1)) rows.push({ cycle: c, ...(await sample(id)) });
// back to the first chapter at the end of a cycle when the path does not end there
console.log('cycle  chapter   geos  tex  programs  load ms  lights');
for (const r of rows) console.log(`${String(r.cycle).padEnd(6)} ${r.id.padEnd(9)} ${String(r.geos).padStart(4)} ${String(r.tex).padStart(4)} ${String(r.programs).padStart(9)} ${String(r.ms ?? '').padStart(8)}  ${JSON.stringify(r.lights)}`);

const fails = [];
const first = rows.find((r) => r.id === path[0]);
for (const r of rows.filter((x) => x.id === path[0])) {
  if (r.geos > first.geos + 2) fails.push(`geometries ${r.geos} > ${first.geos} + 2 (cycle ${r.cycle})`);
  if (r.tex > first.tex + 2) fails.push(`textures ${r.tex} > ${first.tex} + 2 (cycle ${r.cycle})`);
}
// programs per chapter must not grow once every chapter has been seen (from the second cycle on)
const byId = {};
for (const r of rows.filter((x) => x.cycle >= 2)) (byId[r.id] ||= []).push(r.programs);
for (const [id, list] of Object.entries(byId)) if (Math.max(...list) !== Math.min(...list)) fails.push(`programs for ${id} vary from cycle 2 on: ${list.join(', ')}`);
const c2 = rows.filter((x) => x.cycle >= 2).map((r) => r.programs);
if (c2.length && Math.max(...c2) > Math.max(...rows.filter((x) => x.cycle === 1).map((r) => r.programs))) fails.push(`programs grew after the first cycle: ${c2.join(', ')}`);
const L0 = JSON.stringify(rows[0].lights);
for (const r of rows) if (JSON.stringify(r.lights) !== L0) fails.push(`light census changed in ${r.id}: ${JSON.stringify(r.lights)}`);
if (P.errors.length) fails.push(`page errors: ${P.errors.slice(0, 3).join(' | ')}`);
if (P.consoleErrors.length) fails.push(`console errors: ${P.consoleErrors.slice(0, 3).join(' | ')}`);
await P.close();
await browser.close();
console.log(fails.length ? `FAIL\n  ${fails.join('\n  ')}` : `PASS ${rows.length} loads: memory flat, programs stable, light census constant, no page errors`);
process.exit(fails.length ? 1 : 0);
