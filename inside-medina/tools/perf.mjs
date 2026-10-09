// Render budget table at the Chapter I tour spots: shadow vs main draw calls, triangles,
// post passes, programs, and the flock's share; plus the presentation acceptance checks.
// Usage: node tools/perf.mjs [--port 5173 | BASE=url] [--tiers low,medium,high] [--frames 6]
//          [--out file.json] [--compare before.json] [--checks] [--only checks]
import { chromium } from 'playwright';
import fs from 'fs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const port = arg('port', '5173');
const BASE = process.env.BASE || `http://127.0.0.1:${port}/`;
const tiers = String(arg('tiers', 'low,medium,high')).split(',');
const frames = +arg('frames', 6);
const out = arg('out', null), compare = arg('compare', null), checks = arg('checks', false), only = arg('only', null);
const W = +arg('w', 640), H = +arg('h', 360);
const SPOTS = [
  { name: 'souk', x: 9, y: 0 }, { name: 'raised', x: 24, y: 1.5 }, { name: 'rooftops', x: 54.8, y: 3.1 },
  { name: 'courtyard', x: 97, y: 0 }, { name: 'balcony', x: 126, y: 4.3 }, { name: 'chase', x: 166, y: 0 },
];

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const result = { base: BASE, viewport: [W, H], tiers: {}, checks: {} };

async function open(query) {
  const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push(m.text()); });
  await page.goto(`${BASE}?autostart=1&tex=0.1&noauto=1&nosave=1&${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  await page.evaluate(installHooks);
  return page;
}

// per-frame counters split into shadow pass, scene pass(es) and post passes
function installHooks() {
  const M = window.__medina, G = M.game, rs = G.world.rs, r = rs.renderer, scene = G.scene;
  const P = window.__perf = { frames: [], cur: null };
  const fresh = () => ({ shadowCalls: 0, shadowTris: 0, shadowUpdates: 0, sceneCalls: 0, sceneTris: 0, postCalls: 0 });
  const sm = r.shadowMap, smRender = sm.render;
  sm.render = function (...a) {
    const c = r.info.render.calls, t = r.info.render.triangles;
    smRender.apply(this, a);
    if (!P.cur) return;
    const dc = r.info.render.calls - c;
    P.cur.shadowCalls += dc; P.cur.shadowTris += r.info.render.triangles - t; if (dc) P.cur.shadowUpdates++;
  };
  const rr = r.render;
  r.render = function (s, cam) {
    const c = r.info.render.calls, t = r.info.render.triangles;
    rr.call(this, s, cam);
    if (!P.cur) return;
    if (s === scene) { P.cur.sceneCalls += r.info.render.calls - c; P.cur.sceneTris += r.info.render.triangles - t; }
    else P.cur.postCalls += r.info.render.calls - c;
  };
  const rsr = rs.render;
  rs.render = function (...a) {
    P.cur = fresh();
    rsr.apply(this, a);
    const f = P.cur; P.cur = null;
    f.mainCalls = f.sceneCalls - f.shadowCalls; f.mainTris = f.sceneTris - f.shadowTris;
    f.calls = r.info.render.calls; f.tris = r.info.render.triangles; f.programs = r.info.programs.length;
    f.textures = r.info.memory.textures; f.geometries = r.info.memory.geometries;
    P.frames.push(f);
  };
  // flock visibility toggle that works for both the per-bird groups and the instanced flock
  P.flock = (v) => { const F = G.flock; if (!F) return; if (F.group) F.group.visible = v; else for (const b of F.birds) b.g.visible = v && b.state !== 'gone'; };
  P.flockReset = () => G.flock && G.flock.reset();
}

async function collect(page, n) {
  await page.evaluate(() => { window.__perf.frames.length = 0; });
  await page.waitForFunction((k) => window.__perf.frames.length >= k, n, { timeout: 600000 });
  return page.evaluate(() => window.__perf.frames.slice());
}
const avg = (fs, k) => fs.reduce((a, f) => a + f[k], 0) / fs.length;
const round = (v) => Math.round(v * 10) / 10;

async function measureSpot(page, s) {
  await page.evaluate(({ x, y }) => { window.__medina.photo(x, y, 1, 0.4); window.__perf.flockReset(); window.__perf.flock(true); }, s);
  await collect(page, 3); // settle (camera snap, shadow refresh)
  const on = await collect(page, frames);
  await page.evaluate(() => window.__perf.flock(false));
  const off = await collect(page, Math.max(4, frames - 2));
  await page.evaluate(() => window.__perf.flock(true));
  const upd = on.filter((f) => f.shadowUpdates > 0);
  return {
    shadowCalls: round(avg(on, 'shadowCalls')), shadowCallsPerUpdate: upd.length ? round(avg(upd, 'shadowCalls')) : 0,
    shadowUpdateRate: round(upd.length / on.length), mainCalls: round(avg(on, 'mainCalls')), postCalls: round(avg(on, 'postCalls')),
    calls: round(avg(on, 'calls')), tris: Math.round(avg(on, 'tris')), shadowTris: Math.round(avg(on, 'shadowTris')), mainTris: Math.round(avg(on, 'mainTris')),
    flockCalls: round(avg(on, 'calls') - avg(off, 'calls')), flockMain: round(avg(on, 'mainCalls') - avg(off, 'mainCalls')),
    flockShadow: round(avg(on, 'shadowCalls') - avg(off, 'shadowCalls')), programs: on[on.length - 1].programs,
  };
}

if (only !== 'checks') {
  for (const tier of tiers) {
    const page = await open(`tier=${tier}`);
    const spots = {};
    for (const s of SPOTS) { spots[s.name] = await measureSpot(page, s); process.stdout.write(`${tier} ${s.name} ${JSON.stringify(spots[s.name])}\n`); }
    // programs after a second pass over every spot (warm-up stability)
    const p1 = await page.evaluate(() => window.__medina.game.world.rs.renderer.info.programs.length);
    for (const s of SPOTS) { await page.evaluate(({ x, y }) => window.__medina.photo(x, y, 1, 0.2), s); await collect(page, 2); }
    const p2 = await page.evaluate(() => window.__medina.game.world.rs.renderer.info.programs.length);
    const info = await page.evaluate(() => { const rs = window.__medina.game.world.rs; return { fxaa: !!(rs.post.fxaaActive ?? rs.post.q?.fxaa), msaa: rs.q.msaa, scale: rs.scale ?? rs.q.scale, w: rs.w, h: rs.h }; });
    result.tiers[tier] = { spots, programsFirstPass: p1, programsSecondPass: p2, info };
    await page.context().close();
  }
}

// --------------------------------------------------------------------------- acceptance checks (new API)
if (checks || only === 'checks') {
  const page = await open('tier=low');
  const has = await page.evaluate(() => typeof window.__medina.game.world.rs.beginFrame === 'function');
  if (!has) result.checks.skipped = 'renderer has no beginFrame (old build)';
  else {
    // FXAA active on low
    result.checks.fxaaLow = await page.evaluate(() => { const rs = window.__medina.game.world.rs; return { fxaaActive: rs.post.fxaaActive, aaPasses: rs.post.stats?.aa }; });
    // tier round trip leaks no render targets, textures, geometries or programs
    result.checks.tierRoundTrip = await page.evaluate(async () => {
      const M = window.__medina, rs = M.game.world.rs, r = rs.renderer;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      M.photo(97, 0, 1, 0.2); await frame(); await frame();
      const snap = () => ({ textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs.length, rts: rs.post.targets().length });
      const trip = async () => { for (const t of ['medium', 'high', 'ultra', 'high', 'medium', 'low']) { rs.setTier(t); await frame(); } };
      await trip(); // first trip compiles each tier's programs and shadow-depth variants once
      const a = snap();
      await trip(); await trip();
      const b = snap();
      return { before: a, after: b, ok: a.textures === b.textures && a.geometries === b.geometries && a.programs === b.programs && a.rts === b.rts };
    });
    // frame cap 60 under a 120 Hz rAF (and jittered 120/144 Hz, and an exact 60 Hz display that must not halve)
    result.checks.cap = await page.evaluate(() => {
      const rs = window.__medina.game.world.rs;
      const run = (hz, cap, jitter = 0, sec = 10) => {
        rs.applySettings({ fpsCap: cap }); rs._cap.last = -1;
        let t = 1000, n = 0, rnd = 1;
        const N = Math.round(hz * sec);
        for (let i = 0; i < N; i++) { rnd = (rnd * 16807) % 2147483647; t += 1000 / hz + (rnd / 2147483647 - 0.5) * 2 * jitter; if (rs.beginFrame(t)) n++; }
        return +(n / sec).toFixed(2);
      };
      const r = { '120Hz cap60': run(120, 60), '120Hz±1ms cap60': run(120, 60, 1), '144Hz cap60': run(144, 60), '60Hz cap60': run(60, 60, 0.8), '60Hz cap30': run(60, 30, 0.8), '120Hz display': run(120, 'display') };
      rs.applySettings({ fpsCap: 'display' });
      return { fps: r, ok: Math.abs(r['120Hz cap60'] - 60) <= 1 && Math.abs(r['120Hz±1ms cap60'] - 60) <= 1 && Math.abs(r['144Hz cap60'] - 60) <= 1.5 && r['60Hz cap60'] >= 59 && Math.abs(r['60Hz cap30'] - 30) <= 1 && r['120Hz display'] >= 119 };
    });
    // the real rAF loop under a stubbed 120 Hz requestAnimationFrame: beginFrame gates rendering to ~60 fps
    result.checks.capLoop = await page.evaluate(async () => {
      const rs = window.__medina.game.world.rs; rs.applySettings({ fpsCap: 60 });
      let t = performance.now(), ok = 0, all = 0; const t0 = t;
      await new Promise((res) => { const tick = () => { t += 1000 / 120; all++; if (rs.beginFrame(t)) ok++; if (t - t0 < 2000) setTimeout(tick, 0); else res(); }; tick(); });
      rs.applySettings({ fpsCap: 'display' });
      return { stubFrames: all, rendered: ok, fps: +(ok / ((t - t0) / 1000)).toFixed(2) };
    });
    await page.context().close();
    // ?slowgpu=8: dynamic resolution drops within 2 s, recovers after 5 s of headroom, <= 1 tier change per 30 s
    const p2 = await open('tier=medium&slowgpu=8&auto=1');
    result.checks.slowgpu = await p2.evaluate(async () => {
      const rs = window.__medina.game.world.rs; rs.autoQuality = true; rs.applySettings({ dynres: true, fpsCap: 60 });
      const log = []; const t0 = performance.now(); let tierChanges = 0, tier = rs.tier;
      const sample = () => { if (rs.tier !== tier) { tierChanges++; tier = rs.tier; } log.push([+((performance.now() - t0) / 1000).toFixed(2), +rs.dyn.scale.toFixed(3), rs.tier]); };
      const wait = (ms) => new Promise((res) => { const end = performance.now() + ms; const f = () => { sample(); if (performance.now() < end) setTimeout(f, 50); else res(); }; f(); });
      const start = rs.dyn.scale;
      await wait(2000);
      const dropT = log.find((e) => e[1] < start - 0.01)?.[0] ?? null;
      const low = rs.dyn.scale;
      rs.slowGpu = 1; // headroom from here on
      const t1 = performance.now();
      await new Promise((res) => { const f = () => { sample(); if (rs.dyn.scale >= start - 0.001 || performance.now() - t1 > 15000) res(); else setTimeout(f, 50); }; f(); });
      const recoverT = +((performance.now() - t1) / 1000).toFixed(2);
      await wait(1000);
      return { start, dropT, low, recoverT, recovered: rs.dyn.scale, tierChanges, tier: rs.tier, ok: dropT !== null && dropT <= 2 && rs.dyn.scale >= start - 0.001 && recoverT >= 5 && tierChanges <= 1, trace: log.filter((e, i) => i % 10 === 0) };
    });
    await p2.context().close();
    // programs stable after warm-up at every tier (compile everything once, then visit all spots)
  }
}

if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
if (compare && fs.existsSync(compare) && Object.keys(result.tiers).length) {
  const before = JSON.parse(fs.readFileSync(compare, 'utf8'));
  console.log('\n tier    spot        shadow calls (per update)   main calls     post   tris (k)        flock calls   programs');
  for (const tier of Object.keys(result.tiers)) {
    const A = before.tiers[tier], B = result.tiers[tier];
    if (!A) continue;
    let sA = 0, sB = 0, fA = 0, fB = 0;
    for (const s of SPOTS) {
      const a = A.spots[s.name], b = B.spots[s.name];
      sA += a.shadowCalls; sB += b.shadowCalls; fA += a.flockCalls; fB += b.flockCalls;
      console.log(` ${tier.padEnd(7)} ${s.name.padEnd(10)} ${String(a.shadowCalls).padStart(6)} → ${String(b.shadowCalls).padEnd(6)} (${a.shadowCallsPerUpdate} → ${b.shadowCallsPerUpdate})`.padEnd(54) +
        `${a.mainCalls} → ${b.mainCalls}`.padEnd(15) + `${a.postCalls} → ${b.postCalls}`.padEnd(9) + `${Math.round(a.tris / 1000)} → ${Math.round(b.tris / 1000)}`.padEnd(16) + `${a.flockCalls} → ${b.flockCalls}`.padEnd(14) + `${a.programs} → ${b.programs}`);
    }
    console.log(` ${tier.padEnd(7)} TOTAL      shadow ${round(sA)} → ${round(sB)} (${round((sB / sA - 1) * 100)} %), flock ${round(fA)} → ${round(fB)} (${round(fB - fA)} calls)`);
  }
}
if (Object.keys(result.checks).length) console.log('\nchecks', JSON.stringify(result.checks, null, 1));
if (errors.length) console.log('\nerrors:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await browser.close();
const failed = Object.values(result.checks).some((c) => c && c.ok === false) || errors.length > 0;
process.exit(failed ? 1 : 0);
