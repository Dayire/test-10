// Headless playthrough of a chapter with its bot (tools/bots/<chapter>.js).
//   node tools/playtest.mjs [--chapter souk] [--cp N] [--from step] [--to step] [--runs N] [--port 5173] [--tier low] [--hold 0|1]
// Legacy: node tools/playtest.mjs [fromStepName] [cp]
// Each run reloads the page; with --runs > 1 the end-state hashes must match (determinism).
// Exit code 0 only if every run passes (and, for several runs, the hashes agree).
import { parseArgs, launch, openPage, gameUrl, inject, hash, exists } from './lib/harness.mjs';

const o = parseArgs();
if (o._[0] && !o.from) o.from = o._[0];
if (o._[1] !== undefined && o.cp === undefined) o.cp = +o._[1];
const runs = +(o.runs || 1);
if (!exists(`tools/bots/${o.chapter}.js`)) { console.log(`no bot for chapter ${o.chapter}`); process.exit(1); }

const browser = await launch();
const results = [];
let ok = true;
for (let k = 0; k < runs; k++) {
  const P = await openPage(browser, { url: gameUrl(o), w: o.w, h: o.h });
  await inject(P.page, 'tools/bots/lib.js');
  await inject(P.page, `tools/bots/${o.chapter}.js`);
  const r = await P.page.evaluate(([chapter, from, to]) => {
    const lib = window.__botlib, B = lib.create();
    const extra = window.__bots[chapter](B) || {};
    const res = lib.runAll(B, { from: from || 0, to: to || null });
    const s = window.__medina.state(), p = window.__medina.game.player;
    res.end = { ...s, vx: p.body.vx, vy: p.body.vy };
    if (extra.summary) res.log.push(extra.summary());
    if (extra.minGuard) res.minGuard = extra.minGuard();
    return res;
  }, [o.chapter, o.from, o.to]);
  r.hash = hash(r.end);
  r.errors = P.errors;
  results.push(r);
  if (runs === 1 || !r.ok) console.log(r.log.join('\n'));
  const pass = r.ok && !P.errors.length;
  console.log(`${pass ? 'PASS' : `FAIL at ${r.step}`} total game time ${r.time}s  end ${JSON.stringify({ x: r.end.x, y: r.end.y, z: r.end.z, mode: r.end.mode, cp: r.end.cp, deaths: r.end.deaths })}  hash ${r.hash}${P.errors.length ? `  pageerrors ${P.errors.length}` : ''}`);
  ok = ok && pass;
  await P.close();
}
if (runs > 1) {
  const same = results.every((r) => r.hash === results[0].hash);
  console.log(same ? `DETERMINISTIC ${runs} runs, hash ${results[0].hash}` : `NONDETERMINISTIC hashes ${results.map((r) => r.hash).join(' ')}`);
  ok = ok && same;
}
if (o.json) { const fs = await import('fs'); fs.writeFileSync(o.json, JSON.stringify(results.map(({ log, ...r }) => r), null, 1)); }
await browser.close();
process.exit(ok ? 0 : 1);
