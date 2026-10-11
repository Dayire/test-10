// Render budget table at the Chapter I tour spots (shadow vs main draw calls, triangles, post passes,
// programs, the flock's share) plus the presentation acceptance checks (FULL_GAME §11.4 P).
// Usage: node tools/perf.mjs [--port 5174 | BASE=url] [--tiers low,medium,high] [--frames 6]
//          [--out file.json] [--compare before.json] [--checks | --only checks | --only path] [--path 0] [--shots dir] [--w 640 --h 360]
// The table runs on any build (also the pre-presentation tree, for the "before" column); the checks
// use the new RenderSystem API and are skipped on builds without it.
// The §8.5 gate takes the heaviest frame at every spot: every shadow map refreshed (as on a 30 fps frame or after
// a camera snap), over a full sweep of the courtyard lamp wherever its spot is lit, plus every frame of the
// chapter's finale (the DepthWalk), and along the chapter's real path: its bot from the first step to the last,
// a frame with every map refreshed every 0.5 s of game time, so the states a player goes through (the rope ladder
// unrolled, the drawbridge lowered, the guard chasing) are gated too (--path 0 skips it). Low and medium run at
// 640 × 360 and again as a phone in landscape (844 × 390, the widest view); an explicit --w / --h runs that viewport alone.
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
const pathGate = String(arg('path', '1')) !== '0', PATH_EVERY = 0.5, CHAPTER = 'souk';
const BOTS = ['lib', CHAPTER].map((f) => new URL(`bots/${f}.js`, import.meta.url));
const pick = arg('check', null) ? String(arg('check')).split(',') : null; // run only these checks
const want = (k) => !pick || pick.includes(k);
const W = +arg('w', 640), H = +arg('h', 360), PHONE = [844, 390];
const views = (tier) => (arg('w', null) || arg('h', null) || !['low', 'medium'].includes(tier) ? [[W, H]] : [[W, H], PHONE]);
// FULL_GAME §8.5: draw calls (shadow + main) and triangles per frame, per tier
const BUDGET = { low: { calls: 130, tris: 400e3 }, medium: { calls: 180, tris: 550e3 }, high: { calls: 240, tris: 700e3 }, ultra: { calls: 280, tris: 900e3 } };
const SPOTS = [
  { name: 'souk', x: 9, y: 0 }, { name: 'raised', x: 24, y: 1.5 }, { name: 'rooftops', x: 54.8, y: 3.1 },
  { name: 'courtyard', x: 97, y: 0 }, { name: 'balcony', x: 126, y: 4.3 }, { name: 'chase', x: 166, y: 0 },
  { name: 'alley', x: 186.4, y: 0 },
];
const SWEEP = 9; // lamp aims from end to end of its sweep
if (shots) fs.mkdirSync(shots, { recursive: true });

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const result = { base: BASE, viewport: [W, H], tiers: {}, checks: {} };

async function open(query, { w = W, h = H, bots = false } = {}) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push(m.text()); });
  await page.goto(`${BASE}?autostart=1&tex=0.1&noauto=1&nosave=1&${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  // merged shadow casters are built a few milliseconds per frame: measure once they are in
  await page.waitForFunction(() => !window.__medina.game.world.rs.shadows?.building, null, { timeout: 300000 });
  await page.evaluate(installHooks);
  if (bots) for (const f of BOTS) await page.addScriptTag({ content: fs.readFileSync(f, 'utf8') });
  return page;
}

// per-frame counters split into shadow pass, scene pass(es) and post passes
function installHooks() {
  const M = window.__medina, G = M.game, rs = G.world.rs, r = rs.renderer, scene = G.scene;
  const P = window.__perf = { frames: [], cur: null };
  const fresh = () => ({ shadowCalls: 0, shadowTris: 0, shadowUpdates: 0, sceneCalls: 0, sceneTris: 0, postCalls: 0, flockMain: 0, flockShadow: 0 });
  const sm = r.shadowMap, smRender = sm.render;
  sm.render = function (...a) {
    const c = r.info.render.calls, t = r.info.render.triangles;
    P.inShadow = true;
    try { smRender.apply(this, a); } finally { P.inShadow = false; }
    if (!P.cur) return;
    const dc = r.info.render.calls - c;
    P.cur.shadowCalls += dc; P.cur.shadowTris += r.info.render.triangles - t; if (dc) P.cur.shadowUpdates++;
  };
  // draws of the flock's own meshes (per-bird groups in the old tree, instanced meshes in the new one)
  P.flockObjs = () => { const F = G.flock, set = new Set(); if (!F) return set; if (F.group) F.group.traverse((o) => set.add(o)); else for (const b of F.birds) b.g.traverse((o) => set.add(o)); return set; };
  let flockSet = P.flockObjs();
  const rbd = r.renderBufferDirect;
  r.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) {
    if (P.cur && flockSet.has(obj)) { if (P.inShadow) P.cur.flockShadow++; else P.cur.flockMain++; }
    return rbd.call(this, cam, sc, geo, mat, obj, grp);
  };
  P.refreshFlock = () => { flockSet = P.flockObjs(); };
  const rr = r.render;
  r.render = function (s, cam) {
    const c = r.info.render.calls, t = r.info.render.triangles;
    rr.call(this, s, cam);
    if (!P.cur) return;
    // the soft pass draws the scene's own objects through a scene of its own (post.softScene)
    if (s === scene || s === rs.post.softScene) { P.cur.sceneCalls += r.info.render.calls - c; P.cur.sceneTris += r.info.render.triangles - t; }
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
  // the heaviest frame: every shadow map refreshed, rendered synchronously by the game's own render (the lamp, the
  // camera and the characters update; the sim does not step, so nothing detects or dies)
  P.forced = (dt = 1 / 60) => { rs.shadows?.invalidate?.(); G.render(dt, 1); return P.last; };
  // and over a full sweep of the courtyard lamp, wherever its spot is lit: n aims from one end to the other
  P.sweep = (n) => {
    const sl = G.level?.searchlight, list = [P.forced(), P.forced()];
    if (!sl?.spot || !sl.enabled) return list;
    const keep = sl.aim.x;
    for (let i = 0; i < n; i++) { sl.aim.x = sl.x0 + (sl.x1 - sl.x0) * i / (n - 1); list.push(P.forced()); }
    sl.aim.x = keep; P.forced();
    return list;
  };
  // the chapter's finale from its checkpoint, every 0.5 s of it (the camera given that time to follow, then a
  // frame with every map refreshed), up to its end; last thing on a page (the chapter ends)
  P.finale = (cp) => {
    const M = window.__medina, list = [];
    if (!G.level?.finale) return list;
    M.checkpoint(cp); M.finale();
    for (let i = 0; i < 60 && G.mode === 'finale'; i++) {
      M.sim(0.5, { x: 0 }); G.render(0.25, 1); G.render(0.25, 1);
      const f = P.forced();
      if (G.mode === 'finale') list.push({ ...f, z: +(G.player.z || 0).toFixed(1) });
    }
    return list;
  };
  // the chapter's bot from its first step to its last. The game renders at 30 fps on the game's own clock without
  // drawing (the camera, entities, director and the shadow policy's schedule, scans and merges run as in play), and
  // every `every` s of game time draws a frame with every shadow map refreshed
  P.path = (chapter, every) => {
    const lib = window.__botlib, B = lib.create();
    window.__bots[chapter](B);
    let step = null;
    for (const st of B.steps) { const u = st.until; st.until = (s, g) => { step = st.name; return u(s, g); }; }
    const real = rs.render, clock = performance.now, list = [];
    let t = clock.call(performance), k = 0, acc = 0;
    const quiet = (sc, cam) => { sc.updateMatrixWorld(); cam.updateMatrixWorld(); rs.shadows?.update?.(sc, cam, t); };
    B.tick((s, g) => {
      if (++k % 4) return;
      t += 1000 / 30; acc += 1 / 30;
      if (acc + 1e-6 < every) { rs.render = quiet; try { g.render(1 / 30, 1); } finally { rs.render = real; } return; }
      acc = 0;
      const f = P.forced(1 / 30);
      list.push({ calls: f.shadowCalls + f.mainCalls, tris: f.shadowTris + f.mainTris, shadowCalls: f.shadowCalls, mainCalls: f.mainCalls, shadowTris: f.shadowTris, mainTris: f.mainTris, x: +s.x.toFixed(1), y: +s.y.toFixed(1), step, guard: g.level?.guard?.state ?? null });
    });
    performance.now = () => t;
    try { const r = lib.runAll(B, {}); return { ok: r.ok, step: r.ok ? null : r.step, time: r.time, list }; } finally { performance.now = clock; rs.render = real; }
  };
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
// the heaviest of forced frames: shadow + main calls and triangles (each its own maximum)
const heaviest = (list) => ({
  frames: list.length, calls: Math.max(0, ...list.map((f) => f.shadowCalls + f.mainCalls)), tris: Math.max(0, ...list.map((f) => f.shadowTris + f.mainTris)),
  shadowCalls: Math.max(0, ...list.map((f) => f.shadowCalls)), mainCalls: Math.max(0, ...list.map((f) => f.mainCalls)),
});
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
  const worst = heaviest(await page.evaluate((n) => window.__perf.sweep(n), SWEEP));
  return {
    worst,
    shadowCalls: round(avg(on, 'shadowCalls')), shadowCallsPerUpdate: upd.length ? round(avg(upd, 'shadowCalls')) : 0,
    shadowCalls60: round(avg(s60, 'shadowCalls')), shadowUpdates60: round(upd60.length / s60.length),
    shadowCallsPerUpdate60: upd60.length ? round(avg(upd60, 'shadowCalls')) : 0, shadowTris60: Math.round(avg(s60, 'shadowTris')),
    shadowTrisPerUpdate60: upd60.length ? Math.round(avg(upd60, 'shadowTris')) : 0,
    shadowUpdateRate: round(upd.length / on.length), mainCalls: round(avg(on, 'mainCalls')), postCalls: round(avg(on, 'postCalls')),
    calls: round(avg(on, 'calls')), calls60: round(avg(s60, 'calls')), tris: Math.round(avg(on, 'tris')), shadowTris: Math.round(avg(on, 'shadowTris')), mainTris: Math.round(avg(on, 'mainTris')),
    flockCalls: round(avg(on, 'flockMain') + avg(on, 'flockShadow')), flockMain: round(avg(on, 'flockMain')), flockShadow: round(avg(on, 'flockShadow')),
    flockToggle: round(avg(on, 'calls') - avg(off, 'calls')), programs: on[on.length - 1].programs,
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
  return { birds, calls: round(avg(on, 'flockMain') + avg(on, 'flockShadow')), main: round(avg(on, 'flockMain')), shadow: round(avg(on, 'flockShadow')), toggle: round(avg(on, 'calls') - avg(off, 'calls')) };
}

if (only !== 'checks') {
  for (const tier of tiers) for (const [w, h] of views(tier)) {
    const key = w === W && h === H ? tier : `${tier}@${w}x${h}`;
    const B = BUDGET[tier], budget = {}, spots = {};
    let p1 = null, p2 = null, flock = null, info = null, finale = null;
    if (only !== 'path') {
    const page = await open(`tier=${tier}`, { w, h });
    for (const s of SPOTS) { spots[s.name] = await measureSpot(page, s); process.stdout.write(`${key} ${s.name} ${JSON.stringify(spots[s.name])}\n`); }
    // programs after a second pass over every spot (warm-up stability)
    p1 = await page.evaluate(() => window.__medina.game.world.rs.renderer.info.programs.length);
    for (const s of SPOTS) { await page.evaluate(({ x, y }) => window.__medina.photo(x, y, 1, 0.2), s); await collect(page, 2); }
    p2 = await page.evaluate(() => window.__medina.game.world.rs.renderer.info.programs.length);
    flock = await flockStress(page);
    process.stdout.write(`${key} flock-all-in-view ${JSON.stringify(flock)}\n`);
    info = await page.evaluate(() => { const rs = window.__medina.game.world.rs; return { fxaa: !!(rs.post.fxaaActive ?? rs.post.q?.fxaa), aa: rs.post.stats?.aa ?? null, msaa: rs.q.msaa, scale: rs.scale ?? rs.q.scale, w: rs.w, h: rs.h }; });
    // the finale last: the chapter ends with it
    const fin = await page.evaluate(() => { const G = window.__medina.game; return G.level?.finale ? window.__perf.finale(G.checkpoints.length - 1) : []; });
    finale = fin.length ? { ...heaviest(fin), list: fin.map((f) => `${f.shadowCalls + f.mainCalls}/${Math.round((f.shadowTris + f.mainTris) / 1000)}k@z${f.z}`).join(' ') } : null;
    if (finale) process.stdout.write(`${key} finale ${JSON.stringify(finale)}\n`);
    // §8.5 budget per frame, gated on the heaviest frame (every shadow map refreshed, over the lamp's sweep where it
    // is lit, and through the finale). The 60 fps average (shadow-pass calls over the frames that refresh them or
    // not, on the policy's own schedule) is reported beside it
    for (const [k, v] of Object.entries(spots)) {
      const avgCalls = round(v.shadowCalls60 + v.mainCalls), avgTris = Math.round(v.shadowTris60 + v.mainTris);
      budget[k] = { calls: v.worst.calls, tris: v.worst.tris, avgCalls, avgTris, ok: !B || (v.worst.calls <= B.calls && v.worst.tris <= B.tris) };
    }
    if (finale) budget.finale = { calls: finale.calls, tris: finale.tris, avgCalls: null, avgTris: null, ok: !B || (finale.calls <= B.calls && finale.tris <= B.tris) };
    await page.context().close();
    }
    // the real path, on a page of its own (the bot starts the chapter from its first checkpoint)
    let path = null;
    if (pathGate) {
      const pp = await open(`tier=${tier}&hold=1&chapter=${CHAPTER}`, { w, h, bots: true });
      const r = await pp.evaluate(([c, e]) => window.__perf.path(c, e), [CHAPTER, PATH_EVERY]);
      await pp.context().close();
      const over = B ? r.list.filter((f) => f.calls > B.calls || f.tris > B.tris) : [];
      path = { ok: r.ok, failedStep: r.step, time: r.time, samples: r.list.length, ...heaviest(r.list), over: over.length, worst: [...r.list].sort((a, b) => b.calls - a.calls).slice(0, 6), worstTris: [...r.list].sort((a, b) => b.tris - a.tris).slice(0, 3) };
      process.stdout.write(`${key} path ${JSON.stringify(path)}\n`);
      budget.path = { calls: path.calls, tris: path.tris, avgCalls: null, avgTris: null, ok: r.ok && r.list.length > 0 && (!B || !over.length) };
    }
    result.tiers[key] = { tier, viewport: [w, h], spots, finale, path, programsFirstPass: p1, programsSecondPass: p2, flockAllInView: flock, info, budget };
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
    // the soft pass leaves the renderer's light state alone: no lit material re-validates its program per frame
    if (want('lightsStable')) result.checks.lightsStable = await lightsStable(page);
    // URL test flags win over saved settings: under ?noauto, quality 'auto' and dynres keep the tier and scale fixed
    if (want('settingsNoauto')) result.checks.settingsNoauto = await page.evaluate(() => {
      const rs = window.__medina.game.world.rs, snap = () => ({ auto: rs.autoQuality, dyn: rs.dyn.enabled, tier: rs.tier, scale: rs.dyn.scale });
      const before = snap();
      rs.applySettings({ quality: 'auto', dynres: true, fpsCap: null, renderScale: 100, grain: 60, brightness: 0, dof: true });
      const after = snap();
      // the same settings without the URL flags do turn both on
      const keep = [rs.noauto, rs.urlDyn, rs.autoMax];
      rs.noauto = false; rs.urlDyn = null; rs.applySettings({ quality: 'auto', dynres: false }); rs.applySettings({ dynres: true });
      const free = snap();
      [rs.noauto, rs.urlDyn] = keep; rs.autoQuality = false; rs.applySettings({ dynres: true }); rs.dyn.enabled = false; rs.dyn.reset(1);
      return { before, after, withoutFlags: { auto: free.auto, dyn: free.dyn }, ok: !before.auto && !before.dyn && !after.auto && !after.dyn && after.tier === before.tier && free.auto && free.dyn };
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
    // the sun's halo and strong ghosts need a strong key light: none around the moon, full on the golden-hour sun
    if (want('moonFlare')) result.checks.moonFlare = await moonFlare(page);
    // pigeons in view are drawn even when the boy is far away (menu, intro and cinematic shots)
    if (want('flockView')) result.checks.flockView = await page.evaluate(async () => {
      const M = window.__medina, G = M.game, V = G.camera.position.constructor;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      M.photo(9, 0, 1, 0.2); G.flock.reset();
      // the camera frames the pigeons at x 160 while the boy stands at x 9
      G.camRig.setOverride(() => ({ pos: new V(160, 2.5, 12), look: new V(160, 1, 0), fov: 34 }), 0.001); G.camRig.overrideW = 1;
      await frame(); await frame(); await frame();
      const fx = G.flock, inView = fx.birds.filter((b) => b.state !== 'gone' && Math.abs(b.pos.x - 160) < 6).length, nearBoy = fx.birds.filter((b) => b.state !== 'gone' && Math.abs(b.pos.x - 9) <= 30).length;
      const r = { drawn: fx.drawn, inView, nearBoy };
      G.camRig.override = null; G.camRig.overrideW = 0; G.camRig.overrideTarget = 0;
      return { ...r, ok: inView > 0 && fx.drawn >= inView + nearBoy };
    });
    // LUT crossfade: identity changes nothing, a look changes the frame, toggling compiles nothing
    if (want('lut')) result.checks.lut = await lutCheck(page);
    // lean shadow maps: an R8 colour attachment beside the depth texture three samples; the same frame with three's
    // own RGBA8 maps is identical
    if (want('leanMaps')) result.checks.leanMaps = await leanMapsCheck(page);
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
      const kinds = PT.particles.kinds, emitted = {}, progs0 = r.info.programs.length;
      for (const k of kinds) emitted[k] = PT.particles.emit(k, { x: 97, y: 1.5, z: 0.5 }, { count: 20 });
      await frame();
      // their programs were compiled for the soft pass before the first emit: nothing compiles mid-play
      out.particlesWarm = { before: progs0, after: r.info.programs.length, ok: r.info.programs.length === progs0 };
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
      // live particles leave with the chapter root they were emitted in (a direct child subtree of the scene)
      PT.particles.emit('moths', { x: 97, y: 1.5, z: 0.5 }, { count: 10 }); await frame();
      const aliveBefore = rs.particles.alive, Group = G.flock.group.constructor, g = new Group();
      g.add(new Group()); G.scene.add(g); G.scene.remove(g);
      out.particlesClear = { aliveBefore, aliveAfter: rs.particles.alive, ok: aliveBefore && !rs.particles.alive };
      out.ok = out.softOn.medium && out.softOn.shared && out.softOn.shaftOnBeams && Object.values(emitted).every((n) => n > 0) && pv && out.shafts.moved && out.shafts.restored && out.dispose.ok && out.particlesClear.ok && out.particlesWarm.ok;
      return out;
    });
    // medium's shadow schedule at 60 fps under the courtyard lamp: the sun's map every other frame, the lamp's at 15 Hz
    // on frames the sun skips, never both in one frame (that is the forced worst frame, which perf gates separately)
    if (want('schedule')) result.checks.schedule = await page.evaluate(async () => {
      const M = window.__medina, G = M.game, rs = G.world.rs, R = rs.renderer;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      rs.setTier('medium'); M.photo(97, 0, 1, 0.4); await frame(); await frame();
      const log = []; let cur = null;
      const sm = R.shadowMap, smr = sm.render;
      sm.render = function (lights, ...a) { if (cur && (this.autoUpdate || this.needsUpdate)) for (const l of lights) if (l.castShadow && (l.shadow.autoUpdate || l.shadow.needsUpdate)) cur.add(l.isDirectionalLight ? 'sun' : 'spot'); return smr.call(this, lights, ...a); };
      const now = performance.now; let t = now.call(performance); performance.now = () => t;
      try { for (let i = 0; i < 24; i++) { t += 1000 / 60; cur = new Set(); rs.render(G.scene, G.camera, G.time + i / 60); log.push(cur); cur = null; } } finally { performance.now = now; sm.render = smr; }
      rs.setTier('low'); await frame();
      const sun = log.filter((f) => f.has('sun')).length, spot = log.filter((f) => f.has('spot')).length, both = log.filter((f) => f.has('sun') && f.has('spot')).length;
      return { frames: log.length, sun, spot, both, ok: both === 0 && Math.abs(sun - 12) <= 1 && spot >= 4 && spot <= 7 };
    });
    // the merged boy casts exactly the parts authored as casters (not his ears and nose); a levelkit lantern casts
    // through the static proxies until it moves past a sway, then on its own (a scripted lamp keeps a live shadow)
    if (want('casters')) result.checks.casters = await page.evaluate(async () => {
      const M = window.__medina, G = M.game, S = G.world.rs.shadows;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      const url = (f) => performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes(`/src/assets/${f}`));
      const { Rig, BOY } = await import(url('character.js'));
      const plain = new Rig(BOY, G.mats, { merge: false }), count = (g) => (g.index ? g.index.count : g.attributes.position.count);
      const authored = plain.meshes.filter((m) => m.castShadow).reduce((a, m) => a + count(m.geometry), 0), all = plain.meshes.reduce((a, m) => a + count(m.geometry), 0);
      const merged = G.rig.shadowMeshes.reduce((a, m) => a + count(m.geometry), 0);
      for (const m of plain.meshes) m.geometry.dispose();
      const boy = { authored, merged, all, ok: merged === authored && authored < all };
      M.photo(97, 0, 1, 0.2); await frame(); await frame();
      const lan = G.level.lanterns.find((l) => { let f = false; l.mesh.traverse((o) => { f ||= !!o.userData.staticCaster; }); return f; });
      const parts = []; lan.mesh.traverse((o) => { if (o.isMesh && o.userData.staticCaster) parts.push(o); });
      const until = async (f) => { for (let i = 0; i < 200 && !f(); i++) await frame(); };
      // the static proxies' sources (settled casters, which come and go as props rest, apart)
      const statics = () => S.stats.proxied - (S.stats.settled || 0), inProxies = () => parts.filter((o) => S.meta.get(o)?.proxied).length;
      const before = { proxied: statics(), merged: inProxies(), cast: parts.filter((o) => o.castShadow).length };
      lan.mesh.position.x += 1;
      // a scan reads the world matrices the last frame rendered: scan every frame until it has seen the move
      await until(() => { S.nextScan = 0; return parts.every((o) => o.castShadow) && !S.building; });
      const after = { proxied: statics(), merged: inProxies(), cast: parts.filter((o) => o.castShadow).length };
      lan.mesh.position.x -= 1;
      const lantern = { parts: parts.length, before, after, ok: parts.length > 0 && before.cast === 0 && before.merged === parts.length && after.cast === parts.length && after.merged === 0 && after.proxied === before.proxied - parts.length };
      return { boy, lantern, ok: boy.ok && lantern.ok };
    });
    await page.context().close();
    // ?slowgpu=8: dynamic resolution drops within 2 s, recovers after 5 s of headroom, <= 1 tier change per 30 s
    // ?noauto keeps the resolution fixed unless ?dynres=1 asks for dynamic resolution (the settings cannot)
    const p2 = await open('tier=medium&slowgpu=8&dynres=1');
    // driven by 60 Hz frames handed to the renderer synchronously (the controllers' clock is the sum of the tracked
    // frames, and the synthetic GPU's cost a formula), so the outcome never depends on the machine's load
    if (want('slowgpu')) result.checks.slowgpu = await p2.evaluate(() => {
      const rs = window.__medina.game.world.rs; rs.autoQuality = true; rs.applySettings({ dynres: true, fpsCap: 60 });
      const param = rs.slowGpu; rs.dyn.reset(1); rs.cap.skipped = false;
      const log = []; const t0 = rs.clock; let tierChanges = 0, tier = rs.tier;
      const frame = () => { rs.trackFrame(1000 / 60); if (rs.tier !== tier) { tierChanges++; tier = rs.tier; } log.push([+((rs.clock - t0) / 1000).toFixed(2), +rs.dyn.scale.toFixed(3), rs.tier]); };
      const run = (ms) => { const end = rs.clock + ms; for (let i = 0; i < ms / 8 && rs.clock < end; i++) frame(); };
      const start = rs.dyn.scale;
      run(2000);
      const dropT = log.find((e) => e[1] < start - 0.01)?.[0] ?? null;
      const low = rs.dyn.scale;
      rs.slowGpu = 1; // headroom from here on
      const t1 = rs.clock;
      for (let i = 0; i < 2000 && rs.dyn.scale < start - 0.001 && rs.clock - t1 <= 15000; i++) frame();
      const recoverT = +((rs.clock - t1) / 1000).toFixed(2);
      run(1000);
      return { param, start, dropT, low, recoverT, recovered: rs.dyn.scale, tierChanges, tier: rs.tier, ok: param === 8 && dropT !== null && dropT <= 2 && rs.dyn.scale >= start - 0.001 && recoverT >= 5 && tierChanges <= 1, trace: log.filter((e, i) => i % 30 === 0) };
    });
    // sustained overload with auto quality: at most one tier change per 30 s, and it steps down
    // 120 s of 60 Hz frames handed to the renderer in one synchronous run (the synthetic GPU's cost is a formula of the
    // tier and the resolution, and the controllers' clock is the sum of the tracked frames): the machine's own load
    // never changes the outcome, as it did with the real loop on a shared machine. Long enough to see the lowest
    // tier hold: a step down asked for there once came back 30 s later as an "undo" to medium, and so on
    if (want('autoTier')) result.checks.autoTier = await p2.evaluate(() => {
      const rs = window.__medina.game.world.rs; rs.slowGpu = 40; rs.autoQuality = true; rs.cap.skipped = false;
      const t0 = rs.clock, changes = []; let tier = rs.tier;
      for (let i = 0; i < 120 * 60; i++) { rs.trackFrame(1000 / 60); if (rs.tier !== tier) { changes.push([+((rs.clock - t0) / 1000).toFixed(1), tier, rs.tier]); tier = rs.tier; } }
      rs.slowGpu = 0;
      const gaps = changes.slice(1).map((c, i) => c[0] - changes[i][0]);
      return { changes, ok: changes.length >= 1 && changes.length <= 2 && gaps.every((g) => g >= 30) && changes.every((c) => ['low', 'medium', 'high', 'ultra'].indexOf(c[2]) < ['low', 'medium', 'high', 'ultra'].indexOf(c[1])) };
    });
    await p2.context().close();
    // merged static shadow casters: the same frame with and without them (pixels and shadow-pass draws)
    if (want('shadowProxies')) result.checks.shadowProxies = await shadowProxies();
    // no GPU timer (Safari / iOS, most Android): the frame interval is the only signal
    if (want('dynSignal')) result.checks.dynSignal = await dynSignal();
    // the same through the real boot loop under a 30 Hz requestAnimationFrame stub with an idle GPU
    if (want('throttleLoop')) result.checks.throttleLoop = await throttleLoop();
    // LDR fallback (no float targets): RGBA8 chain on the low tier renders the same scene
    if (want('ldr')) result.checks.ldr = await ldrCheck();
    // the real game loop under a stubbed 120 Hz requestAnimationFrame renders 60 fps with fpsCap 60
    if (want('capLoop')) result.checks.capLoop = await capLoop();
    // context loss and restore: hooks fire, frames stop while lost and resume after
    if (want('contextLoss')) result.checks.contextLoss = await contextLoss();
  }
}

async function lightsStable(page) {
  return page.evaluate(async () => {
    const M = window.__medina, G = M.game, rs = G.world.rs, r = rs.renderer;
    const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
    rs.setTier('medium'); M.photo(97, 0, 1, 0.3);
    for (let i = 0; i < 4; i++) await frame();
    const lit = new Set();
    G.scene.traverse((o) => { const m = o.material; if (o.isMesh && o.visible && m && !Array.isArray(m) && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) lit.add(m); });
    const mats = [...lit], ver = () => mats.map((m) => r.properties.get(m).lightsStateVersion);
    const seq = [];
    for (let i = 0; i < 6; i++) { await frame(); seq.push(ver()); }
    const drawn = mats.filter((m, i) => seq[0][i] !== undefined).length;
    const changed = mats.filter((m, i) => seq.some((v) => v[i] !== seq[0][i])).length;
    // CPU time of the main scene pass, soft pass on and off (median of synchronous frames; informative)
    const scene = G.scene, rr = r.render, times = [];
    r.render = function (s, cam) { const t0 = performance.now(); rr.call(this, s, cam); if (s === scene) times.push(performance.now() - t0); };
    const med = (soft) => { rs.post.q.soft = soft; times.length = 0; for (let i = 0; i < 14; i++) rs.render(scene, G.camera, G.time); const t = times.slice(4).sort((a, b) => a - b); return +t[t.length >> 1].toFixed(2); };
    const mainMs = { softOn: med(true), softOff: med(false), softOn2: med(true) };
    r.render = rr; rs.post.q.soft = true;
    const soft = rs.post.stats.soft;
    rs.setTier('low'); await frame();
    return { tier: 'medium', soft, litMaterials: mats.length, drawn, changed, versions: [...new Set(seq.flat().filter((v) => v !== undefined))], mainMs, ok: soft && drawn > 10 && changed === 0 };
  });
}

// the real boot loop under a stubbed 120 Hz requestAnimationFrame (installed before the page runs)
async function capLoop() {
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    const S = window.__rafStub = { on: false, calls: 0, t: 0 };
    window.requestAnimationFrame = (cb) => (S.on ? setTimeout(() => { S.t += 1000 / 120; S.calls++; cb(S.t); }, 0) : raf(cb));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?autostart=1&tex=0.1&noauto=1&nosave=1&tier=low`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  const r = await page.evaluate(async () => {
    const rs = window.__medina.game.world.rs, S = window.__rafStub;
    let begins = 0; const bf = rs.beginFrame.bind(rs); rs.beginFrame = (now) => { begins++; return bf(now); };
    rs.applySettings({ fpsCap: 60 });
    S.t = performance.now(); S.on = true;
    await new Promise((res) => setTimeout(res, 500));
    // a real requestAnimationFrame still pending when the stub took over (a slow frame on a loaded machine) may have
    // set the cap's phase from the real clock, ahead of the stub's: restart the phase on the stub's clock
    await new Promise((res) => { const c = S.calls; const f = () => (S.calls > c + 1 ? res() : setTimeout(f, 10)); f(); });
    rs.cap.set(60);
    const f0 = window.__frames, c0 = S.calls, b0 = begins, t0 = S.t;
    await new Promise((res) => { const f = () => (S.calls - c0 >= 120 ? res() : setTimeout(f, 20)); f(); });
    const frames = window.__frames - f0, sec = (S.t - t0) / 1000, wired = begins - b0 > 0;
    S.on = false; rs.applySettings({ fpsCap: 'display' });
    return { stubCalls: S.calls - c0, frames, stubSec: +sec.toFixed(3), fps: +(frames / sec).toFixed(2), wired };
  });
  await context.close();
  // P's own branch predates the foundation's boot loop: until it calls rs.beginFrame (requests/P.md #1) the
  // cap cannot act on the loop, which is reported as pending rather than passed
  if (!r.wired) return { ...r, pending: 'the boot loop never calls rs.beginFrame (docs/requests/P.md #1)', ok: null };
  return { ...r, ok: Math.abs(r.fps - 60) <= 1.5 };
}

// the frame rendered with the shadow proxies and again with the batches casting as authored, at fixed time, read
// back right after rendering: high must match (the view-swept cull changes nothing on screen), low may only lose
// background shadows (reach); the shadow pass must lose at least 30 % of the draws it has without them
async function shadowProxies() {
  const out = {};
  for (const tier of ['high', 'low']) {
    const page = await open(`tier=${tier}`);
    if (!(await page.evaluate(() => typeof window.__medina.game.world.rs.shadows.setProxies === 'function'))) { await page.context().close(); return { skipped: 'no shadow proxies (old build)', ok: true }; }
    out[tier] = await page.evaluate(async (spots) => {
      const M = window.__medina, G = M.game, rs = G.world.rs, r = rs.renderer, gl = r.getContext(), S = rs.shadows, sm = r.shadowMap;
      const frame = () => new Promise((res) => { const n = window.__frames; const t = () => (window.__frames > n + 1 ? res() : requestAnimationFrame(t)); t(); });
      const grain = rs.post.params.grain;
      let calls = 0, tris = 0;
      const smr = sm.render;
      sm.render = function (...a) { const c = r.info.render.calls, t = r.info.render.triangles; try { return smr.apply(this, a); } finally { calls += r.info.render.calls - c; tris += r.info.render.triangles - t; } };
      const shot = () => {
        rs.post.params.grain = 0; calls = 0; tris = 0;
        S.invalidate(); rs.render(G.scene, G.camera, 12.5);
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return { px, calls, tris };
      };
      const cmp = (A, B) => { let sum = 0, n = 0, diff = 0; for (let i = 0; i < A.length; i += 4) { let d = 0; for (let c = 0; c < 3; c++) { const v = Math.abs(A[i + c] - B[i + c]); sum += v; d = Math.max(d, v); } n += 3; if (d > 16) diff++; } return { mad: +(sum / n).toFixed(3), diffPct: +(diff / (A.length / 4) * 100).toFixed(3) }; };
      const res = {};
      for (const s of spots) {
        M.photo(s.x, s.y, 1, 0.4); await frame(); await frame();
        const on = shot(), on2 = shot();
        S.setProxies(false); const off = shot(); S.setProxies(true, { sync: true });
        res[s.name] = { shadowCalls: [off.calls, on.calls], shadowTris: [off.tris, on.tris], repeat: cmp(on.px, on2.px), ...cmp(off.px, on.px) };
      }
      sm.render = smr; rs.post.params.grain = grain;
      return { stats: { ...S.stats }, spots: res };
    }, SPOTS);
    if (shots) {
      for (const st of [true, false]) {
        await page.evaluate((st) => { const M = window.__medina; M.game.world.rs.shadows.setProxies(st, { sync: true }); M.photo(97, 0, 1, 0.4); }, st);
        const n = await page.evaluate(() => window.__frames); await page.waitForFunction((k) => window.__frames >= k, n + 3);
        fs.writeFileSync(`${shots}/proxies-${st ? 'on' : 'off'}-${tier}-courtyard.png`, await page.screenshot());
      }
    }
    await page.context().close();
  }
  const sp = (t) => Object.values(out[t].spots);
  const fewer = (t) => sp(t).reduce((a, v) => a + v.shadowCalls[1], 0) <= 0.7 * sp(t).reduce((a, v) => a + v.shadowCalls[0], 0);
  out.ok = fewer('high') && fewer('low') && sp('high').every((v) => v.repeat.mad === 0 && v.mad < 0.4 && v.diffPct < 0.3) && sp('low').every((v) => v.mad < 2);
  return out;
}

// rs.trackFrame fed synchronously with the frames of a device without a GPU timer (the clock is the sum of the
// intervals, so a minute of frames takes milliseconds): a hitch and a throttled 30 Hz clock must cost nothing,
// while real GPU or CPU overload still lowers the resolution and the tier
async function dynSignal() {
  const page = await open('tier=medium&dynres=1');
  const r = await page.evaluate(() => {
    const rs = window.__medina.game.world.rs, AQ = rs.auto.constructor;
    const vs = (c) => Math.ceil(c / (1000 / 60) - 1e-6) * (1000 / 60);
    const TF = { low: 0.55, medium: 1, high: 1.35, ultra: 1.8 };
    const keep = { tq: rs._tq, auto: rs.autoQuality, coarse: rs.coarse, dyn: rs.dyn.enabled };
    const run = (sec, frame, { tier = 'medium', coarse = true } = {}) => {
      rs.setTier(tier); rs.dyn.enabled = true; rs.user.dynres = true; rs.dyn.reset(1); rs.dyn.clearLimit(); rs.dyn.backoff = 4000;
      rs.auto = new AQ(); rs.autoQuality = true; rs.coarse = coarse; rs._tq = null; rs._skip = 0; rs.cap.skipped = false;
      let t = 0, minScale = 1, below = 0, last = 0;
      const changes = [], from = rs.tier;
      while (t < sec * 1000) {
        const f = frame(t, rs.dyn.scale, rs.tier); t += f.ms; last = f.ms;
        rs.cpuMs = f.cpu; rs.gpuMs = 0;
        const before = rs.tier;
        rs.trackFrame(f.ms, {});
        if (rs.tier !== before) changes.push([+(t / 1000).toFixed(1), before, rs.tier]);
        minScale = Math.min(minScale, rs.dyn.scale); if (rs.dyn.scale < 0.95) below += f.ms;
      }
      const D = rs.dyn;
      return { from, tier: rs.tier, scale: +D.scale.toFixed(3), minScale: +minScale.toFixed(3), secBelow95: +(below / 1000).toFixed(1), lastMs: +last.toFixed(1), limited: +D.limited.toFixed(1), displayLimited: D.displayLimited, changes, undos: rs.auto.undos };
    };
    const out = {
      // one 250 ms hitch on a vsync-locked 60 Hz phone
      hitch60: run(60, (t) => ({ ms: t > 5000 && t < 5017 ? 250 : 1000 / 60, cpu: 5 })),
      // a throttled 30 Hz rAF (iOS Low Power Mode, battery saving) with an idle GPU, on a phone and on a desktop
      throttle30: run(90, () => ({ ms: 1000 / 30, cpu: 5 })),
      throttle30Desktop: run(90, () => ({ ms: 1000 / 30, cpu: 5 }), { tier: 'high', coarse: false }),
      // controls: a fill-bound GPU (lower resolution reaches 60), a GPU only a lower tier saves, and a CPU-bound
      // frame no tier helps (the step down is undone once, 30 s later)
      gpuBound: run(40, (t, s) => ({ ms: vs(4 + 22 * s * s), cpu: 5 })),
      gpuBoundTier: run(60, (t, s, tier) => ({ ms: vs((4 + 30 * s * s) * TF[tier]), cpu: 5 })),
      cpuBound: run(90, () => ({ ms: vs(22), cpu: 20 })),
    };
    rs.setTier('medium'); rs._tq = keep.tq; rs.autoQuality = keep.auto; rs.coarse = keep.coarse; rs.dyn.enabled = keep.dyn; rs.dyn.reset(1); rs.dyn.clearLimit(); rs.auto = new AQ();
    return out;
  });
  await page.context().close();
  const { hitch60: h, throttle30: t, throttle30Desktop: td, gpuBound: g, gpuBoundTier: gt, cpuBound: c } = r;
  r.ok = h.minScale >= 0.999 && !h.changes.length &&
    t.tier === 'medium' && !t.changes.length && t.scale === 1 && t.secBelow95 <= 3 && t.displayLimited && Math.abs(t.limited - 33.3) < 0.5 &&
    td.tier === 'high' && !td.changes.length && td.scale === 1 &&
    !g.changes.length && g.scale <= 0.76 && Math.abs(g.lastMs - 16.7) < 0.1 && !g.limited &&
    gt.changes.length === 1 && gt.tier === 'low' && Math.abs(gt.lastMs - 16.7) < 0.1 &&
    c.changes.length === 2 && c.changes[0][2] === 'low' && c.changes[1][2] === 'medium' && c.changes[1][0] - c.changes[0][0] >= 30 && c.undos === 1;
  return r;
}

// the real boot loop under a 30 Hz requestAnimationFrame stub (fake timestamps, installed before boot) with the GPU
// timer hidden: the tier and the resolution hold. performance.now follows the stub's clock too, so a frame's own
// work takes no time on it, as on a throttled phone whose CPU and GPU idle most of each 33 ms
async function throttleLoop() {
  const context = await browser.newContext({ viewport: { width: 320, height: 180 } });
  await context.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window), now = performance.now.bind(performance);
    const S = window.__rafStub = { on: false, calls: 0, t: 0 };
    performance.now = () => (S.on ? S.t : now());
    window.requestAnimationFrame = (cb) => (S.on ? setTimeout(() => { S.t += 1000 / 30; S.calls++; cb(S.t); }, 0) : raf(cb));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}?autostart=1&tex=0.1&noauto=1&nosave=1&tier=medium&dynres=1`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
  const r = await page.evaluate(async () => {
    const rs = window.__medina.game.world.rs, S = window.__rafStub;
    rs._tq = null; rs.gpuMs = 0; rs.coarse = true; rs.autoQuality = true; rs.applySettings({ fpsCap: 60 });
    S.t = performance.now(); S.on = true;
    const t0 = S.t, log = [], cpu = [], wait = (ms) => new Promise((res) => window.setTimeout(res, ms));
    let minScale = 1, tier = rs.tier; const changes = [];
    await new Promise((res) => { const f = () => {
      const st = (S.t - t0) / 1000;
      if (rs.tier !== tier) { changes.push([+st.toFixed(1), tier, rs.tier]); tier = rs.tier; }
      minScale = Math.min(minScale, rs.dyn.scale); cpu.push(rs.cpuMs);
      if (!log.length || log[log.length - 1][1] !== +rs.dyn.scale.toFixed(3)) log.push([+st.toFixed(1), +rs.dyn.scale.toFixed(3), rs.tier]);
      if (st >= 25) res(); else wait(30).then(f); }; f(); });
    S.on = false; rs.applySettings({ fpsCap: 'display' }); rs.autoQuality = false;
    cpu.sort((a, b) => a - b);
    return { stubSec: +((S.t - t0) / 1000).toFixed(1), frames: S.calls, tier: rs.tier, scale: rs.dyn.scale, minScale: +minScale.toFixed(3), limited: +rs.dyn.limited.toFixed(1), displayLimited: rs.dyn.displayLimited, cpuP50: +cpu[cpu.length >> 1].toFixed(1), changes, log: log.slice(0, 12) };
  });
  await context.close();
  return { ...r, ok: r.tier === 'medium' && !r.changes.length && r.scale === 1 && r.displayLimited };
}

async function nightSky(page) {
  const take = async (night) => {
    const via = await page.evaluate((night) => {
      const M = window.__medina, G = M.game, u = G.world.sky.uniforms, D = G.director;
      // the foundation's LookDirector rewrites every sky uniform each frame: drive it (the night preset, then the
      // chapter's own look back)
      if (D && D.apply) {
        if (night) D.apply('night'); else if (G.restartChapterLook) G.restartChapterLook(); else D.apply('goldenHour');
        M.photo(60, 0, 1, 0.2);
        return 'director';
      }
      if (!window.__skySave) window.__skySave = { z: u.uZenith.value.clone(), h: u.uHorizon.value.clone(), n: u.uNight.value, s: u.uStars.value, m: u.uMoonSize.value, sun: G.world.light.sun.intensity };
      const S = window.__skySave;
      // the values the LookDirector writes for the night preset: uNight = night, uStars = stars, uMoonSize = moonSize (1) × moon (1)
      if (night) { u.uZenith.value.set('#070b1a'); u.uHorizon.value.set('#1c2540'); u.uNight.value = 1; u.uStars.value = 1; u.uMoonSize.value = 1 * 1; G.world.light.sun.intensity = 0.9; }
      else { u.uZenith.value.copy(S.z); u.uHorizon.value.copy(S.h); u.uNight.value = S.n; u.uStars.value = S.s; u.uMoonSize.value = S.m; G.world.light.sun.intensity = S.sun; }
      M.photo(60, 0, 1, 0.2);
      return 'uniforms';
    }, night);
    // look up at the sky above the rooftops; the disc is the sky shader's, so it is measured without bloom and lens
    // flare (the night look's bloom widens the bright area around the moon)
    await page.evaluate((night) => { const L = window.__medina.game.world.rs.post.limits; if (!window.__skyLimits) window.__skyLimits = { bloom: L.bloom, flare: L.flare }; if (night) { L.bloom = 0; L.flare = 0; } else Object.assign(L, window.__skyLimits); }, night);
    await page.evaluate(() => { const G = window.__medina.game; G.camRig.setOverride(() => ({ pos: new G.camera.position.constructor(60, 3, 12), look: new G.camera.position.constructor(61, 60, -30), fov: 55 }), 0.001); G.camRig.overrideW = 1; });
    const n = await page.evaluate(() => window.__frames);
    await page.waitForFunction((k) => window.__frames >= k, n + 4);
    const png = await page.screenshot();
    if (shots) fs.writeFileSync(`${shots}/sky-${night ? 'night' : 'day'}.png`, png);
    return page.evaluate(async (b64) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
      // the moon: where it projects, its expected radius in pixels, and how its disc stands out of the sky
      const G = window.__medina.game, cam = G.camera, u = G.world.sky.uniforms;
      const p = cam.position.clone().addScaledVector(u.uMoonDir.value.clone().normalize(), 500).project(cam);
      const mx = (p.x * 0.5 + 0.5) * img.width, my = (0.5 - p.y * 0.5) * img.height;
      const rPx = (0.045 * u.uMoonSize.value) / (cam.fov * Math.PI / 180) * img.height;
      const full = x.getImageData(0, 0, img.width, img.height).data;
      const lumAt = (px, py) => { const i = (Math.round(py) * img.width + Math.round(px)) * 4; return (0.2126 * full[i] + 0.7152 * full[i + 1] + 0.0722 * full[i + 2]) / 255; };
      const ring = (r0, r1) => { let s = 0, n = 0; for (let a = 0; a < 64; a++) for (let rr = r0; rr <= r1; rr += 0.5) { const px = mx + Math.cos(a / 64 * 6.283) * rr, py = my + Math.sin(a / 64 * 6.283) * rr; if (px >= 0 && py >= 0 && px < img.width && py < img.height) { s += lumAt(px, py); n++; } } return n ? s / n : null; };
      let bright = 0; const R = Math.ceil(rPx * 3);
      for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) { const px = mx + xx, py = my + yy; if (px >= 0 && py >= 0 && px < img.width && py < img.height && lumAt(px, py) > 0.55) bright++; }
      const onScreen = p.z < 1 && mx > rPx && my > rPx && mx < img.width - rPx && my < img.height - rPx;
      const moon = { onScreen, x: Math.round(mx), y: Math.round(my), rPx: +rPx.toFixed(1), disc: onScreen ? +ring(0, rPx * 0.6).toFixed(3) : null, around: onScreen ? +ring(rPx * 2.5, rPx * 3.5).toFixed(3) : null, brightRadius: +Math.sqrt(bright / Math.PI).toFixed(1) };
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
      return { stars, meanSkyLum: +(sum / (w * h)).toFixed(3), moon, flareSun: window.__medina.game.world.rs.post.stats.flareSun ?? null };
    }, png.toString('base64')).then((r) => ({ ...r, via }));
  };
  const night = await take(true), day = await take(false);
  await page.evaluate(() => { if (window.__skyLimits) Object.assign(window.__medina.game.world.rs.post.limits, window.__skyLimits); });
  await page.evaluate(() => { const G = window.__medina.game; G.camRig.override = null; G.camRig.overrideW = 0; G.camRig.overrideTarget = 0; });
  // stars, a dark sky, and a moon disc of about the expected size standing out of it
  const m = night.moon, moonOk = m.onScreen && m.disc > m.around + 0.3 && m.brightRadius > m.rPx * 0.5 && m.brightRadius < m.rPx * 1.6;
  return { night, day, moonOk, ok: night.stars >= 30 && night.stars > day.stars * 5 && night.meanSkyLum < day.meanSkyLum && night.meanSkyLum < 0.2 && moonOk };
}

async function moonFlare(page) {
  const take = async (night) => {
    await page.evaluate((night) => {
      const M = window.__medina, G = M.game, rs = G.world.rs, D = G.director, L = G.world.light;
      rs.setTier('medium');
      if (D && D.apply) { if (night) D.apply('night'); else if (G.restartChapterLook) G.restartChapterLook(); else D.apply('goldenHour'); }
      else { if (window.__sunI === undefined) window.__sunI = L.sun.intensity; L.sun.intensity = night ? 0.9 : window.__sunI; }
      M.photo(60, 0, 1, 0.2);
      // look straight at the key light (the moon's direction at night)
      const V = G.camera.position.constructor, d = (D?.sunDir || G.world.sunDir || L.sunDir).clone().normalize(), p = new V(60, 3, 12);
      G.camRig.setOverride(() => ({ pos: p, look: p.clone().addScaledVector(d, 50), fov: 50 }), 0.001); G.camRig.overrideW = 1;
    }, night);
    const n = await page.evaluate(() => window.__frames);
    await page.waitForFunction((k) => window.__frames >= k, n + 4);
    if (shots) fs.writeFileSync(`${shots}/flare-${night ? 'moon' : 'sun'}.png`, await page.screenshot());
    return page.evaluate(() => { const rs = window.__medina.game.world.rs; return { sunVisible: +rs.post.params.sunVisible.toFixed(2), flareSun: rs.post.stats.flareSun ?? null, keyLight: +window.__medina.game.world.light.sun.intensity.toFixed(2) }; });
  };
  const moon = await take(true), sun = await take(false);
  await page.evaluate(() => { const G = window.__medina.game; G.camRig.override = null; G.camRig.overrideW = 0; G.camRig.overrideTarget = 0; G.world.rs.setTier('low'); });
  return { moon, sun, ok: moon.sunVisible > 0.5 && moon.flareSun !== null && moon.flareSun < 0.02 && sun.sunVisible > 0.5 && sun.flareSun > 0.5 };
}

async function leanMapsCheck(page) {
  await page.evaluate(() => { window.__medina.game.world.rs.setTier('medium'); window.__medina.photo(97, 0, 1, 0.4); });
  const n = await page.evaluate(() => window.__frames);
  await page.waitForFunction((k) => window.__frames >= k, n + 3);
  const r = await page.evaluate(() => {
    const M = window.__medina, G = M.game, rs = G.world.rs, gl = rs.renderer.getContext(), P = rs.post.params;
    const grain = P.grain; P.grain = 0;
    const lights = []; G.scene.traverse((o) => { if (o.isLight && o.castShadow && o.shadow?.map) lights.push(o); });
    const shot = () => {
      rs.shadows.invalidate(); rs.render(G.scene, G.camera, 12.5);
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const mad = (X, Y) => { let s = 0, k = 0; for (let i = 0; i < X.length; i += 4) { s += Math.abs(X[i] - Y[i]) + Math.abs(X[i + 1] - Y[i + 1]) + Math.abs(X[i + 2] - Y[i + 2]); k += 3; } return +(s / k).toFixed(3); };
    const bytes = () => lights.reduce((b, l) => b + l.shadow.map.width * l.shadow.map.height * ((l.shadow.map.texture.format === 1028 ? 1 : 4) + 4), 0);
    const formats = lights.map((l) => `${l.type}:${l.shadow.map.width}:${l.shadow.map.texture.format === 1028 ? 'R8' : 'RGBA8'}`);
    const lean = bytes(), A = shot(), A2 = shot();
    // three's own maps: an RGBA8 target with the same depth texture settings
    for (const l of lights) {
      const old = l.shadow.map, od = old.depthTexture, rt = new old.constructor(old.width, old.height);
      const d = rt.depthTexture = new od.constructor(old.width, old.height, od.type);
      d.format = od.format; d.compareFunction = od.compareFunction; d.minFilter = od.minFilter; d.magFilter = od.magFilter; d.name = od.name;
      l.shadow.map = rt; od.dispose(); old.dispose(); l.shadow.needsUpdate = true; // a map never drawn is never sampled
    }
    const full = bytes(), B = shot();
    for (const l of lights) { l.shadow.map.depthTexture.dispose(); l.shadow.map.dispose(); l.shadow.map = null; } // lean ones again next frame
    P.grain = grain; rs.setTier('low');
    return { formats, mb: { lean: +(lean / 1048576).toFixed(1), threes: +(full / 1048576).toFixed(1) }, mad: { repeat: mad(A, A2), threes: mad(A, B) } };
  });
  return { ...r, ok: r.formats.length >= 3 && r.formats.every((f) => f.endsWith('R8')) && r.mad.repeat === 0 && r.mad.threes === 0 && r.mb.lean < r.mb.threes };
}

async function lutCheck(page) {
  await page.evaluate(() => { window.__medina.photo(9, 0, 1, 0.4); });
  const n = await page.evaluate(() => window.__frames);
  await page.waitForFunction((k) => window.__frames >= k, n + 3);
  // identical frames (same state, same time) read back right after rendering, so only the LUT differs
  const r = await page.evaluate(() => {
    const M = window.__medina, G = M.game, rs = G.world.rs, gl = rs.renderer.getContext(), P = rs.post.params;
    const grain = P.grain; P.grain = 0;
    // the final pass's own program must not change when a LUT is switched on, crossfaded or off
    const progs = new Set(), finalProgram = () => rs.renderer.properties.get(rs.post.mFinal).currentProgram?.id;
    const shot = () => {
      rs.render(G.scene, G.camera, 12.5); progs.add(finalProgram());
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    };
    const mad = (X, Y) => { let s = 0, k = 0; for (let i = 0; i < X.length; i += 4) { s += Math.abs(X[i] - Y[i]) + Math.abs(X[i + 1] - Y[i + 1]) + Math.abs(X[i + 2] - Y[i + 2]); k += 3; } return +(s / k).toFixed(3); };
    rs.setLut(null, null, 0, 0); const A = shot(), A2 = shot();
    rs.setLut('identity', null, 0, 1); const B = shot();
    rs.setLut('night', null, 0, 1); const C = shot();
    rs.setLut('identity', 'night', 0.5, 1); const H = shot();
    rs.setLut('night', null, 0, 0.5); const Q = shot();
    rs.setLut(null, null, 0, 0); P.grain = grain;
    return { mad: { repeat: mad(A, A2), identity: mad(A, B), night: mad(A, C), crossfadeHalf: mad(A, H), amountHalf: mad(A, Q) }, finalPrograms: [...progs] };
  });
  // a look to view
  await page.evaluate(() => window.__medina.game.world.rs.setLut('night', null, 0, 1));
  const n2 = await page.evaluate(() => window.__frames);
  await page.waitForFunction((k) => window.__frames >= k, n2 + 3);
  if (shots) fs.writeFileSync(`${shots}/lut-night.png`, await page.screenshot());
  await page.evaluate(() => window.__medina.game.world.rs.setLut(null, null, 0, 0));
  const m = r.mad;
  return { ...r, ok: m.repeat === 0 && m.identity < 1 && m.night > 2 && m.crossfadeHalf > m.identity && m.crossfadeHalf < m.night && m.amountHalf < m.night && r.finalPrograms.length === 1 && r.finalPrograms[0] !== undefined };
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
    // frames rendered and the shadow proxies built (a few milliseconds a frame): counted in frames, never in wall time,
    // so a loaded machine only takes longer
    const frames = (n, max = 60000) => new Promise((res) => { const f0 = window.__frames, t0 = performance.now(); const f = () => (window.__frames >= f0 + n || performance.now() - t0 > max ? res(window.__frames - f0) : setTimeout(f, 20)); f(); });
    // the shadow policy at rest: a scan every frame (it scans once a second on its own) until the proxied and settled
    // casters stay the same for six scans with nothing left to build
    const settle = async () => {
      const S = rs.shadows; let same = 0, last = null;
      for (let i = 0; i < 900 && same < 6; i++) { S.nextScan = 0; await frames(1); const k = `${S.stats?.proxied}|${S.stats?.settled}|${S.stats?.proxies}`; same = !S.building && k === last ? same + 1 : 0; last = k; }
      return frames(5);
    };
    // draws of merged static casters in the sun's map in one forced refresh (through whatever shadowMap the
    // renderer has then: a restore replaces it, and the proxies must still reach the new one)
    // the same view both times: the photo's camera snap rendered by the game itself before counting
    const shadowDraws = () => {
      M.photo(97, 0, 1, 0.2); M.game.render(1 / 60, 1); M.game.render(1 / 60, 1);
      const r = rs.renderer, rbd = r.renderBufferDirect; let n = 0;
      r.renderBufferDirect = function (cam, sc, geo, mat, obj, grp) { if (cam.isOrthographicCamera && obj.userData.shadowProxy) n++; return rbd.call(this, cam, sc, geo, mat, obj, grp); };
      try { rs.shadows.invalidate(); rs.render(M.game.scene, M.game.camera, M.game.time); } finally { r.renderBufferDirect = rbd; }
      return n;
    };
    M.photo(97, 0, 1, 0.2); await settle();
    const drawsBefore = shadowDraws(), proxiesBefore = rs.shadows.stats?.proxies;
    const f0 = window.__frames;
    ext.loseContext(); await wait(300);
    const whileLost = { lost: rs.lost, begin: rs.beginFrame(performance.now() + 1000), frames: window.__frames - f0 };
    let renderError = null; try { rs.render(M.game.scene, M.game.camera, 0); } catch (e) { renderError = e.message; }
    // the foundation reloads the chapter at its checkpoint after a restore: wait for it
    const reload = M.game.events?.next ? M.game.events.next('chapterStart') : null;
    ext.restoreContext(); await wait(800);
    if (reload) { await reload; await new Promise((res) => { const f = () => (M.game.mode !== 'loading' ? res() : setTimeout(f, 100)); f(); }); M.photo(97, 0, 1, 0.2); await settle(); }
    const framesAfter = await frames(10);
    off();
    const drawsAfter = shadowDraws();
    return { ev, whileLost, renderError, afterRestore: { lost: rs.lost, contextLost: gl.isContextLost(), frames: framesAfter }, shadowDraws: [drawsBefore, drawsAfter], proxies: [proxiesBefore, rs.shadows.stats?.proxies], hasProxies: typeof rs.shadows.setProxies === 'function' };
  });
  await page.context().close();
  return { ...r, ok: !!r.skipped || (r.ev.lost === 1 && r.ev.restored === 1 && r.whileLost.lost && r.whileLost.begin === false && !r.renderError && !r.afterRestore.lost && !r.afterRestore.contextLost && r.afterRestore.frames >= 10 && (!r.hasProxies || (r.shadowDraws[0] > 0 && r.shadowDraws[1] > 0 && Math.abs(r.shadowDraws[1] - r.shadowDraws[0]) <= 0.2 * r.shadowDraws[0]))) };
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
      if (!a || !b) continue;
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
if (Object.keys(result.tiers).length) {
  console.log('\n§8.5 budget (calls shadow + main, triangles; the heaviest frame: every shadow map refreshed, over the lamp\'s sweep, the finale and the bot\'s path; [60 fps average]):');
  for (const [key, T] of Object.entries(result.tiers)) {
    const B = BUDGET[T.tier ?? key], over = Object.entries(T.budget || {}).filter(([, v]) => !v.ok);
    console.log(` ${key.padEnd(16)} budget ${B ? `${B.calls} calls / ${B.tris / 1000}k tris` : 'n/a'}: ` + Object.entries(T.budget || {}).map(([k, v]) => `${k} ${v.calls}/${Math.round(v.tris / 1000)}k${v.avgCalls === null ? '' : ` [${v.avgCalls}/${Math.round(v.avgTris / 1000)}k]`}${v.ok ? '' : ' OVER'}`).join(', ') + (over.length ? `  (FAIL ${over.length} spot${over.length > 1 ? 's' : ''} over)` : ''));
  }
}
if (Object.keys(result.checks).length) {
  const brief = JSON.parse(JSON.stringify(result.checks));
  if (brief.slowgpu?.trace) brief.slowgpu.trace = brief.slowgpu.trace.filter((e, i) => i % 4 === 0);
  console.log('\nchecks', JSON.stringify(brief, null, 1));
  for (const [k, v] of Object.entries(result.checks)) if (v && typeof v === 'object' && 'ok' in v) console.log(`${v.ok === null ? 'PENDING' : v.ok ? 'PASS' : 'FAIL'} ${k}${v.pending ? ` (${v.pending})` : ''}`);
}
if (errors.length) console.log('\nerrors:\n' + [...new Set(errors)].slice(0, 20).join('\n'));
await browser.close();
// any failed or pending check, a spot over its tier's budget, or a page error fails the run
const overBudget = Object.entries(result.tiers).flatMap(([t, T]) => Object.entries(T.budget || {}).filter(([, v]) => !v.ok).map(([k]) => `${t} ${k}`));
const pending = Object.entries(result.checks).filter(([, c]) => c && typeof c === 'object' && c.ok === null).map(([k]) => k);
const failedChecks = Object.entries(result.checks).filter(([, c]) => c && c.ok === false).map(([k]) => k);
if (overBudget.length) console.log(`over budget: ${overBudget.join(', ')}`);
if (pending.length) console.log(`pending: ${pending.join(', ')}`);
const failed = failedChecks.length > 0 || pending.length > 0 || overBudget.length > 0 || errors.length > 0;
console.log(failed ? `PERF FAIL${failedChecks.length ? ` (checks: ${failedChecks.join(', ')})` : ''}` : 'PERF PASS');
process.exit(failed ? 1 : 0);
