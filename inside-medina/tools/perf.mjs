// Render budget table at the Chapter I tour spots (shadow vs main draw calls, triangles, post passes,
// programs, the flock's share) plus the presentation acceptance checks (FULL_GAME §11.4 P).
// Usage: node tools/perf.mjs [--port 5174 | BASE=url] [--tiers low,medium,high] [--frames 6]
//          [--out file.json] [--compare before.json] [--checks | --only checks] [--shots dir] [--w 640 --h 360]
// The table runs on any build (also the pre-presentation tree, for the "before" column); the checks
// use the new RenderSystem API and are skipped on builds without it.
import { chromium } from 'playwright';
import fs from 'fs';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const port = arg('port', '5173');
const BASE = process.env.BASE || `http://127.0.0.1:${port}/`;
const tiers = String(arg('tiers', 'low,medium,high')).split(',');
const frames = +arg('frames', 6);
const out = arg('out', null), compare = arg('compare', null), checks = arg('checks', false), only = arg('only', null);
const shots = arg('shots', null);
const pick = arg('check', null) ? String(arg('check')).split(',') : null; // run only these checks
const want = (k) => !pick || pick.includes(k);
const W = +arg('w', 640), H = +arg('h', 360);
const SPOTS = [
  { name: 'souk', x: 9, y: 0 }, { name: 'raised', x: 24, y: 1.5 }, { name: 'rooftops', x: 54.8, y: 3.1 },
  { name: 'courtyard', x: 97, y: 0 }, { name: 'balcony', x: 126, y: 4.3 }, { name: 'chase', x: 166, y: 0 },
];
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const result = { base: BASE, viewport: [W, H], tiers: {}, checks: {} };

async function open(query, { w = W, h = H } = {}) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.setDefaultTimeout(600000);
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
    P.last = f;
  };
  // render n frames back to back on a simulated 60 fps clock (the rAF loop cannot interleave with a
  // synchronous loop), so time-based policies (30 Hz shadow maps) are measured at a real cadence
  P.sim60 = (n) => {
    const now = performance.now, list = [];
    let t = now.call(performance);
    performance.now = () => t;
    try { for (let i = 0; i < n; i++) { t += 1000 / 60; rs.render(scene, G.camera, G.time + i / 60); list.push(P.last); } } finally { performance.now = now; }
    return list;
  };
  // flock visibility for both the per-bird groups (old) and the instanced flock (new)
  P.flock = (v) => { const F = G.flock; if (!F) return; if (F.group) F.group.visible = v; else for (const b of F.birds) b.g.visible = v && b.state !== 'gone'; };
  P.flockReset = () => G.flock && G.flock.reset();
  // worst case: every bird of the level standing in view (and inside the sun's shadow frustum)
  P.flockGather = () => {
    const F = G.flock; if (!F) return 0;
    const look = G.camRig.look;
    F.birds.forEach((b, i) => {
      const x = look.x - 4 + (i % 9) * 1.0, y = look.y - 1.2 + Math.floor(i / 9) * 0.6, z = 1.5;
      b.state = 'idle';
      if (b.g) { b.g.position.set(x, y, z); b.g.visible = true; } else b.pos.set(x, y, z);
    });
    if (F.write) F.write();
    return F.birds.length;
  };
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
  // 60 fps cadence: shadow-pass calls per frame as a player would get them
  const s60 = await page.evaluate(() => window.__perf.sim60(12));
  await page.evaluate(() => window.__perf.flock(false));
  const off = await collect(page, Math.max(4, frames - 2));
  await page.evaluate(() => window.__perf.flock(true));
  const upd = on.filter((f) => f.shadowUpdates > 0), upd60 = s60.filter((f) => f.shadowUpdates > 0);
  return {
    shadowCalls: round(avg(on, 'shadowCalls')), shadowCallsPerUpdate: upd.length ? round(avg(upd, 'shadowCalls')) : 0,
    shadowCalls60: round(avg(s60, 'shadowCalls')), shadowUpdates60: round(upd60.length / s60.length),
    shadowCallsPerUpdate60: upd60.length ? round(avg(upd60, 'shadowCalls')) : 0, shadowTris60: Math.round(avg(s60, 'shadowTris')),
    shadowUpdateRate: round(upd.length / on.length), mainCalls: round(avg(on, 'mainCalls')), postCalls: round(avg(on, 'postCalls')),
    calls: round(avg(on, 'calls')), calls60: round(avg(s60, 'calls')), tris: Math.round(avg(on, 'tris')), shadowTris: Math.round(avg(on, 'shadowTris')), mainTris: Math.round(avg(on, 'mainTris')),
    flockCalls: round(avg(on, 'calls') - avg(off, 'calls')), flockMain: round(avg(on, 'mainCalls') - avg(off, 'mainCalls')),
    flockShadow: round(avg(on, 'shadowCalls') - avg(off, 'shadowCalls')), programs: on[on.length - 1].programs,
  };
}

// every bird gathered in view: the flock's full draw-call cost (shadow + main)
async function flockStress(page) {
  await page.evaluate(() => { window.__medina.photo(97, 0, 1, 0.4); window.__perf.flock(true); });
  await collect(page, 3);
  const birds = await page.evaluate(() => window.__perf.flockGather());
  await collect(page, 2);
  const on = await collect(page, 4);
  await page.evaluate(() => window.__perf.flock(false));
  const off = await collect(page, 4);
  await page.evaluate(() => { window.__perf.flock(true); window.__perf.flockReset(); });
  return { birds, calls: round(avg(on, 'calls') - avg(off, 'calls')), main: round(avg(on, 'mainCalls') - avg(off, 'mainCalls')), shadow: round(avg(on, 'shadowCalls') - avg(off, 'shadowCalls')) };
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
    const flock = await flockStress(page);
    process.stdout.write(`${tier} flock-all-in-view ${JSON.stringify(flock)}\n`);
    const info = await page.evaluate(() => { const rs = window.__medina.game.world.rs; return { fxaa: !!(rs.post.fxaaActive ?? rs.post.q?.fxaa), aa: rs.post.stats?.aa ?? null, msaa: rs.q.msaa, scale: rs.scale ?? rs.q.scale, w: rs.w, h: rs.h }; });
    result.tiers[tier] = { spots, programsFirstPass: p1, programsSecondPass: p2, flockAllInView: flock, info };
    await page.context().close();
  }
}

// --------------------------------------------------------------------------- acceptance checks (new API)
if (checks || only === 'checks') {
  const page = await open('tier=low');
  const has = await page.evaluate(() => typeof window.__medina.game.world.rs.beginFrame === 'function');
  if (!has) result.checks.skipped = 'renderer has no beginFrame (old build)';
  else {
    // FXAA active on low (and the output pass really runs: FXAA + CAS when upscaling)
    if (want('fxaaLow')) result.checks.fxaaLow = await page.evaluate(() => { const rs = window.__medina.game.world.rs; return { fxaaActive: rs.post.fxaaActive, aa: rs.post.stats.aa, internal: rs.post.stats.internal, output: rs.post.stats.output, ok: rs.post.fxaaActive && /fxaa/.test(rs.post.stats.aa) }; });
    // tier round trip leaks no render targets, textures, geometries, materials or programs
    if (want('tierRoundTrip')) result.checks.tierRoundTrip = await page.evaluate(async () => {
      const M = window.__medina, rs = M.game.world.rs, r = rs.renderer;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      // live materials: count ShaderMaterial / Material instances that were disposed vs created
      let created = 0, disposed = 0;
      const THREE_Material = Object.getPrototypeOf(Object.getPrototypeOf(rs.post.mFinal));
      const origDispose = THREE_Material.dispose;
      THREE_Material.dispose = function () { disposed++; return origDispose.call(this); };
      M.photo(97, 0, 1, 0.2); await frame(); await frame();
      const snap = () => ({ textures: r.info.memory.textures, geometries: r.info.memory.geometries, programs: r.info.programs.length, rts: rs.post.targets().length, mats: rs.post.materials().length });
      const trip = async () => { for (const t of ['medium', 'high', 'ultra', 'high', 'medium', 'low']) { const before = rs.post.materials().length; rs.setTier(t); created += rs.post.materials().length; void before; await frame(); } };
      await trip(); // first trip compiles each tier's programs and shadow-depth variants once
      const a = snap(); created = 0; disposed = 0;
      await trip(); await trip();
      const b = snap();
      THREE_Material.dispose = origDispose;
      return { before: a, after: b, postMaterialsCreated: created, postMaterialsDisposed: disposed, ok: a.textures === b.textures && a.geometries === b.geometries && a.programs === b.programs && a.rts === b.rts && disposed >= created };
    });
    // programs stable after warm-up: visiting every spot again compiles nothing new
    if (want('programsStable')) result.checks.programsStable = await page.evaluate(async (spots) => {
      const M = window.__medina, r = M.game.world.rs.renderer;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      for (const s of spots) { M.photo(s.x, s.y, 1, 0.2); await frame(); }
      const a = r.info.programs.length;
      for (const s of spots) { M.photo(s.x, s.y, 1, 0.2); await frame(); await frame(); }
      return { warm: a, after: r.info.programs.length, ok: a === r.info.programs.length };
    }, SPOTS);
    // frame cap 60 under a 120 Hz rAF (and jittered 120/144 Hz, and an exact 60 Hz display that must not halve)
    if (want('cap')) result.checks.cap = await page.evaluate(() => {
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
    // a real loop driven by a stubbed 120 Hz requestAnimationFrame: beginFrame gates it to 60 fps
    if (want('capLoop')) result.checks.capLoop = await page.evaluate(async () => {
      const rs = window.__medina.game.world.rs; rs.applySettings({ fpsCap: 60 });
      const raf = window.requestAnimationFrame;
      let t = performance.now(), ok = 0, all = 0; const t0 = t;
      const stub = (cb) => setTimeout(() => { t += 1000 / 120; cb(t); }, 0);
      await new Promise((res) => { const loop = (now) => { all++; if (rs.beginFrame(now)) ok++; if (now - t0 < 2000) stub(loop); else res(); }; stub(loop); });
      window.requestAnimationFrame = raf;
      rs.applySettings({ fpsCap: 'display' });
      const fps = +(ok / ((t - t0) / 1000)).toFixed(2);
      return { stubFrames: all, rendered: ok, fps, ok: Math.abs(fps - 60) <= 1 };
    });
    // paused and hidden frames never reach auto quality or dynamic resolution
    if (want('pausedIgnored')) result.checks.pausedIgnored = await page.evaluate(() => {
      const rs = window.__medina.game.world.rs, dyn = rs.dyn, aq = rs.auto;
      const s0 = dyn.scale, w0 = aq.win.length, d0 = dyn.enabled;
      dyn.enabled = true;
      for (let i = 0; i < 200; i++) rs.trackFrame(400, { paused: true });
      for (let i = 0; i < 200; i++) rs.trackFrame(400, { hidden: true });
      const r = { scale: dyn.scale, windowSamples: aq.win.length - w0 };
      dyn.enabled = d0;
      return { ...r, ok: r.scale === s0 && r.windowSamples === 0 };
    });
    // night sky: uNight = 1 shows stars (and a moon); uNight = 0 (today's look) shows none
    if (want('nightSky')) result.checks.nightSky = await nightSky(page);
    // the shared soft layer, particles, shafts.setSun and the dispose() contracts
    if (want('contracts')) result.checks.contracts = await page.evaluate(async () => {
      const M = window.__medina, G = M.game, rs = G.world.rs, r = rs.renderer;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      // the app's own module instances (same URLs as the page loaded them)
      const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(`/src/render/${f}`));
      const L = await import(url('layers.js')), PT = await import(url('particles.js'));
      const V3 = G.camera.position.constructor;
      const out = {};
      rs.setTier('medium'); M.photo(97, 0, 1, 0.2); await frame(); await frame();
      const sm0 = G.shafts.list[0]?.material.uniforms;
      out.softOn = { medium: L.SOFT.uSoftOn.value === 1 && L.SOFT.uDepth.value === rs.post.depthTex, shared: !!sm0 && sm0.uDepth === L.SOFT.uDepth, beamsLayer: L.LAYERS.BEAMS, shaftOnBeams: !!G.shafts.list[0]?.layers.isEnabled(L.LAYERS.BEAMS) };
      // particles: every kind emits through the module-level handle and draws on the soft layer
      const kinds = PT.particles.kinds, emitted = {};
      for (const k of kinds) emitted[k] = PT.particles.emit(k, { x: 97, y: 1.5, z: 0.5 }, { count: 20 });
      await frame();
      const pv = rs.particles.add.mesh.visible && rs.particles.alpha.mesh.visible && rs.particles.add.mesh.layers.isEnabled(L.LAYERS.BEAMS);
      out.particles = { kinds, emitted, visible: pv, budget: rs.particles.budget };
      // shafts follow a new sun
      const sh = G.shafts, q0 = sh.list[0]?.quaternion.clone();
      sh.setSun(new V3(0.8, 0.21, -0.56), '#ff9a52');
      const moved = q0 ? !sh.list[0].quaternion.equals(q0) : false, tint = sh.tint.value.toArray().map((v) => +v.toFixed(3));
      sh.setSun(new V3(0.6, 0.72, -0.34), '#ffcf96');
      out.shafts = { moved, tint, restored: sh.tint.value.toArray().every((v) => Math.abs(v - 1) < 1e-3) };
      // Dust / Flock / Shafts dispose leave no geometry behind
      await frame(); const g0 = r.info.memory.geometries;
      const d = new G.dust.constructor(G.scene, 32); d.emit(new V3(97, 0.1, 0.5));
      const f = new G.flock.constructor(G.scene, G.mats, [{ x: 98, y: 0, z: 1, w: 2, n: 6 }]);
      await frame(); const g1 = r.info.memory.geometries;
      d.dispose(); f.dispose(); await frame();
      out.dispose = { before: g0, withNew: g1, after: r.info.memory.geometries, ok: g1 > g0 && r.info.memory.geometries === g0 };
      rs.setTier('low'); await frame();
      out.ok = out.softOn.medium && out.softOn.shared && out.softOn.shaftOnBeams && Object.values(emitted).every((n) => n > 0) && pv && out.shafts.moved && out.shafts.restored && out.dispose.ok;
      return out;
    });
    await page.context().close();
    // ?slowgpu=8: dynamic resolution drops within 2 s, recovers after 5 s of headroom, <= 1 tier change per 30 s
    const p2 = await open('tier=medium&slowgpu=8&auto=1');
    if (want('slowgpu')) result.checks.slowgpu = await p2.evaluate(async () => {
      const rs = window.__medina.game.world.rs; rs.autoQuality = true; rs.applySettings({ dynres: true, fpsCap: 60 });
      // the URL turned the synthetic slow GPU on; hold it until frames flow so the timing starts at its onset
      const param = rs.slowGpu; rs.slowGpu = 1; rs.dyn.reset(1);
      await new Promise((res) => { const n = window.__frames; const f = () => (window.__frames >= n + 10 ? res() : setTimeout(f, 50)); f(); });
      rs.dyn.reset(1); rs.slowGpu = param;
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
      return { param, start, dropT, low, recoverT, recovered: rs.dyn.scale, tierChanges, tier: rs.tier, ok: param === 8 && dropT !== null && dropT <= 2 && rs.dyn.scale >= start - 0.001 && recoverT >= 5 && tierChanges <= 1, trace: log.filter((e, i) => i % 10 === 0) };
    });
    // sustained overload with auto quality: at most one tier change per 30 s, and it steps down
    if (want('autoTier')) result.checks.autoTier = await p2.evaluate(async () => {
      const rs = window.__medina.game.world.rs; rs.slowGpu = 40; rs.autoQuality = true;
      const t0 = performance.now(), changes = []; let tier = rs.tier;
      await new Promise((res) => { const f = () => { if (rs.tier !== tier) { changes.push([+((performance.now() - t0) / 1000).toFixed(1), tier, rs.tier]); tier = rs.tier; } if (performance.now() - t0 < 40000) setTimeout(f, 100); else res(); }; f(); });
      rs.slowGpu = 0;
      const gaps = changes.slice(1).map((c, i) => c[0] - changes[i][0]);
      return { changes, ok: changes.length >= 1 && changes.length <= 2 && gaps.every((g) => g >= 30) && changes.every((c) => ['low', 'medium', 'high', 'ultra'].indexOf(c[2]) < ['low', 'medium', 'high', 'ultra'].indexOf(c[1])) };
    });
    await p2.context().close();
    // LDR fallback (no float targets): RGBA8 chain on the low tier renders the same scene
    if (want('ldr')) result.checks.ldr = await ldrCheck();
    // context loss and restore: hooks fire, frames stop while lost and resume after
    if (want('contextLoss')) result.checks.contextLoss = await contextLoss();
  }
}

async function nightSky(page) {
  const take = async (night) => {
    await page.evaluate((night) => {
      const M = window.__medina, G = M.game, u = G.world.sky.uniforms;
      if (!window.__skySave) window.__skySave = { z: u.uZenith.value.clone(), h: u.uHorizon.value.clone(), n: u.uNight.value, s: u.uStars.value, sun: G.world.light.sun.intensity };
      const S = window.__skySave;
      if (night) { u.uZenith.value.set('#070b1a'); u.uHorizon.value.set('#1c2540'); u.uNight.value = 1; u.uStars.value = 1; G.world.light.sun.intensity = 0.9; }
      else { u.uZenith.value.copy(S.z); u.uHorizon.value.copy(S.h); u.uNight.value = S.n; u.uStars.value = S.s; G.world.light.sun.intensity = S.sun; }
      M.photo(60, 0, 1, 0.2);
    }, night);
    // look up at the sky above the rooftops
    await page.evaluate(() => { const G = window.__medina.game; G.camRig.setOverride(() => ({ pos: new G.camera.position.constructor(60, 3, 12), look: new G.camera.position.constructor(61, 60, -30), fov: 55 }), 0.001); G.camRig.overrideW = 1; });
    const n = await page.evaluate(() => window.__frames);
    await page.waitForFunction((k) => window.__frames >= k, n + 4);
    const png = await page.screenshot();
    if (shots) fs.writeFileSync(`${shots}/sky-${night ? 'night' : 'day'}.png`, png);
    return page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const w = img.width, h = Math.floor(img.height * 0.45), d = x.getImageData(0, 0, w, h).data;
      const L = (i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      let stars = 0, sum = 0;
      for (let y = 3; y < h - 3; y++) for (let xx = 3; xx < w - 3; xx++) {
        const i = (y * w + xx) * 4, l = L(i); sum += l;
        let m = 0; for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3]]) m += L(((y + dy) * w + xx + dx) * 4);
        let peak = true; for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) if (L(((y + dy) * w + xx + dx) * 4) > l) peak = false;
        // a star: a local peak standing out of a dark sky background
        if (peak && l > 0.2 && m / 4 < 0.3 && l > m / 4 + 0.1) stars++;
      }
      return { stars, meanSkyLum: +(sum / (w * h)).toFixed(3) };
    }, png.toString('base64'));
  };
  const night = await take(true), day = await take(false);
  await page.evaluate(() => { const G = window.__medina.game; G.camRig.override = null; G.camRig.overrideW = 0; G.camRig.overrideTarget = 0; });
  return { night, day, ok: night.stars >= 30 && night.stars > day.stars * 5 && night.meanSkyLum < day.meanSkyLum };
}

async function ldrCheck() {
  const shot = async (q) => {
    const page = await open(q);
    const r = await page.evaluate(async () => {
      const M = window.__medina, rs = M.game.world.rs;
      M.photo(9, 0, 1, 0.4);
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 2 ? res() : requestAnimationFrame(t)); t(); });
      await frame();
      return { tier: rs.tier, ldr: !!rs.post.q.ldr, halfFloat: rs.halfFloat, sceneType: rs.post.rtScene.texture.type };
    });
    const png = await page.screenshot();
    if (shots) fs.writeFileSync(`${shots}/${/ldr/.test(q) ? 'ldr' : 'hdr'}-low.png`, png);
    const lum = await page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, img.width, img.height).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (d.length / 4) / 255;
    }, png.toString('base64'));
    await page.context().close();
    return { ...r, meanLum: +lum.toFixed(3) };
  };
  const ldr = await shot('tier=high&ldr=1'), hdr = await shot('tier=low');
  return { ldr, hdr, ok: ldr.ldr && ldr.tier === 'low' && ldr.sceneType === 1009 && Math.abs(ldr.meanLum - hdr.meanLum) / hdr.meanLum < 0.12 };
}

async function contextLoss() {
  const page = await open('tier=low');
  const r = await page.evaluate(async () => {
    const M = window.__medina, rs = M.game.world.rs, gl = rs.renderer.getContext();
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return { skipped: 'no WEBGL_lose_context' };
    const ev = { lost: 0, restored: 0 };
    rs.onContextLost(() => ev.lost++); const off = rs.onContextRestored(() => ev.restored++);
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    const f0 = window.__frames;
    ext.loseContext(); await wait(300);
    const whileLost = { lost: rs.lost, begin: rs.beginFrame(performance.now() + 1000), frames: window.__frames - f0 };
    let renderError = null; try { rs.render(M.game.scene, M.game.camera, 0); } catch (e) { renderError = e.message; }
    ext.restoreContext(); await wait(800);
    const f1 = window.__frames; await wait(1500);
    off();
    return { ev, whileLost, renderError, afterRestore: { lost: rs.lost, contextLost: gl.isContextLost(), framesIn1500ms: window.__frames - f1 } };
  });
  await page.context().close();
  return { ...r, ok: !!r.skipped || (r.ev.lost === 1 && r.ev.restored === 1 && r.whileLost.lost && r.whileLost.begin === false && !r.renderError && !r.afterRestore.lost && !r.afterRestore.contextLost && r.afterRestore.framesIn1500ms > 0) };
}

if (out) fs.writeFileSync(out, JSON.stringify(result, null, 1));
if (compare && fs.existsSync(compare) && Object.keys(result.tiers).length) {
  const before = JSON.parse(fs.readFileSync(compare, 'utf8'));
  const pct = (a, b) => (a ? `${round((b / a - 1) * 100)} %` : 'n/a');
  console.log('\n tier    spot        shadow calls @60fps (per update)    main calls   post     calls @60fps   tris (k)     flock calls   programs');
  for (const tier of Object.keys(result.tiers)) {
    const A = before.tiers[tier], B = result.tiers[tier];
    if (!A) continue;
    let sA = 0, sB = 0, fA = 0, fB = 0;
    for (const s of SPOTS) {
      const a = A.spots[s.name], b = B.spots[s.name];
      const a60 = a.shadowCalls60 ?? a.shadowCalls, b60 = b.shadowCalls60 ?? b.shadowCalls;
      sA += a60; sB += b60; fA += a.flockCalls; fB += b.flockCalls;
      console.log(` ${tier.padEnd(7)} ${s.name.padEnd(10)} ${String(a60).padStart(6)} → ${String(b60).padEnd(6)} (${a.shadowCallsPerUpdate60 ?? a.shadowCallsPerUpdate} → ${b.shadowCallsPerUpdate60 ?? b.shadowCallsPerUpdate})`.padEnd(58) +
        `${a.mainCalls} → ${b.mainCalls}`.padEnd(13) + `${a.postCalls} → ${b.postCalls}`.padEnd(9) + `${a.calls60 ?? a.calls} → ${b.calls60 ?? b.calls}`.padEnd(15) +
        `${Math.round(a.tris / 1000)} → ${Math.round(b.tris / 1000)}`.padEnd(13) + `${a.flockCalls} → ${b.flockCalls}`.padEnd(14) + `${a.programs} → ${b.programs}`);
    }
    console.log(` ${tier.padEnd(7)} TOTAL      shadow @60fps ${round(sA)} → ${round(sB)} (${pct(sA, sB)}), flock at the spots ${round(fA)} → ${round(fB)} (${round(fB - fA)} calls)` +
      (A.flockAllInView ? `, flock all in view ${A.flockAllInView.calls} → ${B.flockAllInView.calls} (${round(B.flockAllInView.calls - A.flockAllInView.calls)} calls)` : '') +
      `, programs ${A.programsFirstPass}/${A.programsSecondPass} → ${B.programsFirstPass}/${B.programsSecondPass}`);
  }
}
if (Object.keys(result.checks).length) {
  const brief = JSON.parse(JSON.stringify(result.checks));
  if (brief.slowgpu?.trace) brief.slowgpu.trace = brief.slowgpu.trace.filter((e, i) => i % 4 === 0);
  console.log('\nchecks', JSON.stringify(brief, null, 1));
  for (const [k, v] of Object.entries(result.checks)) if (v && typeof v === 'object' && 'ok' in v) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${k}`);
}
if (errors.length) console.log('\nerrors:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await browser.close();
const failed = Object.values(result.checks).some((c) => c && c.ok === false) || errors.length > 0;
process.exit(failed ? 1 : 0);
