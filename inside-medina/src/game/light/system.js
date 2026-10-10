import { LightWorld, ALL, BLOCKERS, TARGET, MIRROR, BODY, NONE, KIND_NAME, notchOf } from './trace.js';
import { BeamRenderer } from './beams.js';
import { SearchlightSource } from './sources.js';
import { LampEye } from './targets.js';

// The LightSystem (FULL_GAME §6.2): one per chapter that uses Sunwork, registered in L.systems. It owns the
// light entities (sources, mirrors, targets, occluders, clocks) and steps, snapshots and renders them; every
// second fixed step (60 Hz) it traces each source against the colliders the boy collides with, plus mirror
// trays, light-only occluders and targets, and hands every target the light it received (target.onLight).
// Static solids are bucketed in a 4 m x-grid (rebuilt when the chapter's solid list changes); bodies (crates,
// mirror stands, the boy, guards) are always tested. Under the title it keeps tracing for the picture but no
// target charges.
//
//   const light = new LightSystem(game, kit);  L.systems.push(light);
//   light.add(new SunRay({ x, y, angle: 195 }));  const m = light.add(new Mirror(game, {...}));
//   __medina.ext.light() → { beams, targets, mirrors, lamps, stats, trace(x, y, θ), solve(id) }
export class LightSystem {
  constructor(game, kit = null, { traceHz = 60, maxSeg = 6, minI = 0.4 } = {}) {
    this.game = game; this.kit = kit; this.L = kit?.L || null;
    this.traceHz = traceHz; this.maxSeg = maxSeg; this.minI = minI;
    this.id = 'light';
    this.liveUnderTitle = true; // draws its beams under the title; targets never charge there
    this.world = new LightWorld();
    this.children = []; this.sources = []; this.mirrors = []; this.targets = []; this.occluders = []; this.planks = []; this.lamps = [];
    this.results = new Map();
    this.terminator = null;
    this.stats = { traceMs: 0, p95: 0, max: 0, passes: 0, segs: 0, samples: new Float64Array(600), k: 0 };
    this.acc = 0; this.passT = 1 / traceHz;
    this._n = -1; this._s0 = null; this._ents = null;
    this.lit = new Set();
    this.beams = new BeamRenderer(game, this);
    if (kit?.registerExt) kit.registerExt('light', () => this.api());
  }

  // register a light entity (by its role flags); interactables (cranks, the capstan) join the level's list
  add(e) {
    if (!e) return e;
    e.system = this;
    if (e.id === undefined || e.id === null) {
      const k = e.constructor?.name || 'Light';
      this._ids = this._ids || {};
      e.id = `${k}#${this._ids[k] = (this._ids[k] ?? -1) + 1}`;
    }
    this.children.push(e);
    if (e.isSource) this.sources.push(e);
    if (e.isMirror) this.mirrors.push(e);
    if (e.isTarget) this.targets.push(e);
    if (e.isOccluder) this.occluders.push(e);
    if (e.isPlank) this.planks.push(e);
    if (e.isTerminator) this.terminator = e;
    if (e.isLamp) this.lamps.push(e);
    if (e.interactable && this.L) this.L.interactables.push(e.interactable);
    if (e.isInteractable && this.L) this.L.interactables.push(e);
    e.attach?.(this);
    return e;
  }
  get(id) { return this.children.find((c) => c.id === id) || null; }

  // a searchlight joins Sunwork: its line of sight sees mirror trays and occluders, its beam is a reflectable
  // source (I 1.5), and its eye (r 0.8, at the lamp's real z) can be dazzled by reflections (FULL_GAME §6.4)
  lamp(sl, { eye = 0.8, reflect = true, dazzle = 7, onHit = null } = {}) {
    sl.light = this;
    if (!this.lamps.includes(sl)) this.lamps.push(sl);
    if (reflect) sl.source = this.add(new SearchlightSource(sl, { id: (sl.id || 'lamp') + '.beam' }));
    if (eye) sl.eye = this.add(new LampEye(this.game, { id: (sl.id || 'lamp') + '.eye', x: sl.origin.x, y: sl.origin.y, z: sl.origin.z, r: eye, lamp: sl, dazzle, onHit }));
    return sl;
  }

  // the static grid follows the physics world's solids; chapter entities may lend light-only shapes
  // (lightPlank: a raised drawbridge, lightBox: a box that blocks only light)
  sync() {
    const ph = this.game.phys, S = ph.solids;
    if (S.length !== this._n || S[0] !== this._s0 || S[S.length - 1] !== this._s1) {
      this.world.setStatic(S);
      this._n = S.length; this._s0 = S[0]; this._s1 = S[S.length - 1];
    }
    if (this._ents !== this.game.entities) {
      this._ents = this.game.entities;
      this._extraPlanks = []; this._extraBoxes = [];
      for (const e of this._ents) { if (e.lightPlank) this._extraPlanks.push(e.lightPlank); if (e.lightBox) this._extraBoxes.push(e.lightBox); }
    }
    const W = this.world;
    W.dynamic = ph.bodies;
    W.mirrors = this.mirrors;
    W.targets = this.targets;
    W.occluders = this._extraBoxes?.length ? this.occluders.concat(this._extraBoxes) : this.occluders;
    W.planks = this._extraPlanks?.length ? this.planks.concat(this._extraPlanks) : this.planks;
    return W;
  }

  prestep() { for (const c of this.children) c.prestep?.(); }

  step(dt) {
    const held = this.game.held;
    for (const c of this.children) if (!held || c.liveUnderTitle) c.step?.(dt, this);
    this.acc += dt;
    if (this.acc + 1e-9 < this.passT) return;
    const pdt = this.acc; this.acc = 0;
    this.pass(pdt, held);
  }

  // trace every source; targets and lit bodies hear about it (not under the title)
  pass(dt = this.passT, held = false) {
    const t0 = performance.now();
    const W = this.sync();
    const T = this.targets;
    for (const t of T) { t._I = 0; t._Ir = 0; t._hit = null; }
    for (const m of this.mirrors) { m._lit = 0; m._bestI = 0; }
    this.lit.clear();
    let segs = 0;
    for (const src of this.sources) {
      let R = this.results.get(src);
      if (!R) { R = { pts: [], hits: [], pool: [], n: 0, I: 0, on: false }; this.results.set(src, R); }
      R.on = src.live(this);
      if (!R.on) { R.n = 0; R.pts.length = 0; R.hits.length = 0; continue; }
      W.trace(src.ox, src.oy, src.theta, src.I, { maxSeg: this.maxSeg, minI: this.minI, out: R, skip: src.skip || null });
      segs += R.n;
      for (const h of R.hits) {
        if (h.kind === TARGET) { const g = h.obj; g._I += h.I; if (h.seg > 0) g._Ir += h.I; if (!g._hit || h.I > g._hit.I) g._hit = h; }
        else if (h.kind === MIRROR) { const m = h.obj; m._lit += h.I; if (h.I > m._bestI) { m._bestI = h.I; m._inTheta = h.theta; } }
        else if (h.kind === BODY) { const o = h.obj.owner; if (o?.onLight) { o._lightI = (this.lit.has(o) ? o._lightI : 0) + h.I; this.lit.add(o); } }
      }
    }
    for (const m of this.mirrors) if (!m._bestI) m._inTheta = null; // unlit: finger aim falls back on thetaHint
    const ms = performance.now() - t0;
    const S = this.stats;
    S.traceMs = ms; S.passes++; S.segs = segs; S.max = Math.max(S.max, ms);
    S.samples[S.k++ % S.samples.length] = ms;
    if (held) return;
    for (const t of T) t.onLight?.(t._I, dt, this);
    for (const o of this.lit) o.onLight(o._lightI, dt, this);
  }

  p95() {
    const S = this.stats, n = Math.min(S.k, S.samples.length);
    if (!n) return 0;
    const a = Array.from(S.samples.subarray(0, n)).sort((x, y) => x - y);
    return a[Math.min(n - 1, Math.floor(n * 0.95))];
  }

  render(alpha, dt) {
    for (const c of this.children) c.render?.(alpha, dt, this);
    this.beams.update(dt);
  }

  getState() { const s = {}; for (const c of this.children) if (c.getState) s[c.id] = c.getState(); return s; }
  setState(s) {
    for (const c of this.children) if (c.setState && s && c.id in s) c.setState(s[c.id]);
    this.acc = 0;
    this.pass(this.passT, true); // the picture matches the restored state at once (nothing charges)
  }
  dispose() { for (const c of this.children) { try { c.dispose?.(); } catch (e) { console.error(e); } } this.beams.dispose(); }

  // a straight line clear of light blockers (the unified searchlight rule: lit = seen)
  clear(x0, y0, x1, y1, skip = null, skip2 = null) { return this.sync().clear(x0, y0, x1, y1, skip, skip2, BLOCKERS); }

  // would mirror m at surface angle a send light into any target? (finger aim's soft snap)
  probe(m, a) {
    const old = m.alpha; m.alpha = a;
    const W = this.sync();
    const R = this._probe || (this._probe = { pts: [], hits: [], pool: [] });
    let lit = false;
    for (const src of this.sources) {
      if (!src.live(this)) continue;
      W.trace(src.ox, src.oy, src.theta, src.I, { maxSeg: this.maxSeg, minI: this.minI, out: R, skip: src.skip || null });
      const end = R.hits[R.hits.length - 1];
      if (end && end.kind === TARGET && !end.obj.done && end.obj.wantsLight !== false && R.hits.some((q) => q.obj === m)) { lit = true; break; }
    }
    m.alpha = old;
    return lit;
  }

  // the notch settings (up to `depth` mirrors near the target) that light it; each a {mirrorId: degrees}
  solve(targetId, { depth = 3, range = 30, need = true } = {}) {
    const tg = this.targets.find((t) => t.id === targetId);
    if (!tg) return null;
    const tx = tg.x ?? (tg.x0 + tg.x1) / 2;
    const ms = this.mirrors.filter((m) => m.enabled !== false && m.kind !== 'continuous' && Math.abs(m.x - tx) < range).sort((a, b) => Math.abs(a.x - tx) - Math.abs(b.x - tx)).slice(0, depth);
    const saved = ms.map((m) => m.alpha);
    const ranges = ms.map((m) => { const [lo, hi] = m.range || [-90, 75]; const out = []; for (let a = lo; a <= Math.min(hi, lo + 179) + 1e-9; a += m.notchDeg) out.push(a); return out; });
    const W = this.sync(), out = [];
    const idx = ms.map(() => 0);
    const tmp = { pts: [], hits: [], pool: [] };
    for (;;) {
      ms.forEach((m, i) => { m.alpha = ranges[i][idx[i]]; });
      let I = 0;
      for (const src of this.sources) {
        if (!src.live(this)) continue;
        const R = W.trace(src.ox, src.oy, src.theta, src.I, { maxSeg: this.maxSeg, minI: this.minI, out: tmp, skip: src.skip || null });
        for (const h of R.hits) if (h.kind === TARGET && h.obj === tg) I += h.I;
      }
      if (need ? I >= (tg.need ?? 1e-9) - 1e-9 : I > 0) out.push(Object.fromEntries(ms.map((m) => [m.id, m.alpha])));
      let k = 0;
      while (k < ms.length) { idx[k]++; if (idx[k] < ranges[k].length) break; idx[k] = 0; k++; }
      if (k === ms.length || !ms.length) break;
    }
    ms.forEach((m, i) => { m.alpha = saved[i]; });
    return out;
  }

  // __medina.ext.light()
  api() {
    const r3 = (v) => (typeof v === 'number' ? +v.toFixed(3) : v);
    const beams = [];
    for (const [src, R] of this.results) beams.push({ src: src.id, on: !!R.on, I: r3(R.I), pts: R.on ? R.pts.map(r3) : [], ends: R.on ? R.hits.map((h) => `${KIND_NAME[h.kind]}${h.obj?.id ? ':' + h.obj.id : h.obj?.owner?.id ? ':' + h.obj.owner.id : ''}`) : [] });
    return {
      beams,
      targets: this.targets.map((t) => ({ id: t.id, kind: t.kind || t.constructor.name, level: r3(t.level ?? t.heat ?? 0), done: !!(t.done || t.burnt), lit: !!t.lit, I: r3(t.I ?? t._I ?? 0), state: t.state })),
      mirrors: this.mirrors.map((m) => ({ id: m.id, kind: m.kind, x: r3(m.x), y: r3(m.y), alpha: r3(m.alpha), target: r3(m.target), notch: notchOf(m.alpha), settled: m.settled, lost: !!m.lostT, enabled: m.enabled !== false })),
      lamps: this.lamps.map((l) => ({ id: l.id, state: l.state, dazzled: l.dazzled > 0, fixated: !!l.fix, aim: [r3(l.aim?.x), r3(l.aim?.y)] })),
      stats: { traceMs: r3(this.stats.traceMs), p95: r3(this.p95()), max: r3(this.stats.max), passes: this.stats.passes, segs: this.stats.segs },
      T: this.terminator ? r3(this.terminator.T) : null,
      trace: (x, y, theta, I = 1) => {
        const R = this.sync().trace(x, y, theta, I, { maxSeg: this.maxSeg, minI: this.minI });
        return { pts: R.pts.map(r3), hits: R.hits.map((h) => ({ kind: KIND_NAME[h.kind], id: h.obj?.id ?? h.obj?.owner?.id ?? null, x: r3(h.x), y: r3(h.y), I: r3(h.I), theta: r3(h.theta) })) };
      },
      solve: (id, o) => this.solve(id, o),
      resetStats: () => { this.stats.k = 0; this.stats.max = 0; },
      samples: () => Array.from(this.stats.samples.subarray(0, Math.min(this.stats.k, this.stats.samples.length))),
      sys: this,
    };
  }
}

// Chapters without a LightSystem (the souk) still need searchlight line of sight against the physics world:
// a shared tracer over game.phys, rebuilt when the solid list changes
const PW = new WeakMap();
export function physicsWorld(game) {
  const ph = game.phys;
  let W = PW.get(ph);
  if (!W) { W = new LightWorld(); PW.set(ph, W); }
  const S = ph.solids;
  if (W._n !== S.length || W._s0 !== S[0] || W._s1 !== S[S.length - 1]) { W.setStatic(S); W._n = S.length; W._s0 = S[0]; W._s1 = S[S.length - 1]; }
  W.dynamic = ph.bodies;
  return W;
}
export { ALL, BLOCKERS, NONE };
