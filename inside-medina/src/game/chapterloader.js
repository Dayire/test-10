import * as THREE from 'three';
import { Batcher, rng } from '../assets/geom.js';
import { G } from '../render/atmosphere.js';
import { Shafts } from '../render/shafts.js';
import { Dust, Flock } from '../render/fx.js';
import { registerSurfaces, yieldFrame } from '../render/textures.js';
import { createLevelKit } from './levelkit.js';
import { getChapter, meta } from '../chapters/index.js';

// backoff before each retry of a chain's import (a flaky network, a redeploy)
const RETRY_MS = [1200, 3000];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Loads and unloads chapters. Everything a chapter builds hangs under one
// root group (game.root), so unloading is one sweep: geometries, non-cached
// materials and their textures, sprite materials and the FX built on the
// root. Session assets (cached materials, baked surfaces, the env map, the
// glow sprite texture, the rig cookies) are never disposed. The light rig is
// fixed, so a chapter switch never changes the light census or recompiles.

// L: the contract every chapter build returns (docs/ARCHITECTURE.md)
export function emptyLevel() {
  return {
    entities: [], systems: [], interactables: [], triggers: [], checkpoints: [], cameraKeys: [], killZones: [],
    lanterns: [], lightSources: [], shaftSpots: [], dustRegions: [], flockSpots: [], covers: [], hints: [],
    credits: null, bounds: { x0: -20, x1: 220, y0: -10, y1: 40 }, shadowExtent: null, finale: null,
    prepare() {}, mix: () => ({}), safeZone: () => false, lookTarget: () => null, extraState: () => ({}),
  };
}

const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'envMap', 'displacementMap', 'specularMap', 'gradientMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap', 'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'anisotropyMap', 'specularColorMap', 'specularIntensityMap'];

// assets that outlive a chapter
function sessionAssets(game) {
  const mats = new Set(game.mats.cache.values());
  const tex = new Set();
  for (const t of Object.values(game.world.tex || {})) for (const v of Object.values(t || {})) if (v && v.isTexture) tex.add(v);
  if (game.world.env) tex.add(game.world.env);
  if (game.glowTex) tex.add(game.glowTex);
  for (const t of game.lightRig.textures()) tex.add(t);
  return { mats, tex };
}

export function disposeTree(root, keep) {
  const geos = new Set(), mats = new Set(), texs = new Set();
  root.traverse((o) => {
    const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    const shared = list.some((m) => m.userData?.medina || m.userData?.shared); // GLB override templates
    if (o.geometry && !shared && !o.geometry.userData?.shared) geos.add(o.geometry);
    for (const m of list) {
      if (keep.mats.has(m) || m.userData?.medina || m.userData?.shared) continue;
      mats.add(m);
      for (const k of TEX_KEYS) if (m[k] && m[k].isTexture) texs.add(m[k]);
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture) texs.add(u.value);
    }
  });
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  for (const t of texs) if (!keep.tex.has(t) && !t.userData?.shared) t.dispose();
  return { geometries: geos.size, materials: mats.size, textures: texs.size };
}

export class ChapterLoader {
  constructor(game) {
    this.game = game;
    this.busy = null;
    this.stats = null;
    this.scope = []; // chapter-lived subscriptions (kit.on, kit.onFrame, kit.registerExt), undone by unload
    this.card = null;
  }

  // loadChapter(id, cp, {reason, onProgress}) -> promise of L. reason: boot | start | chain | continue | select | restart | title
  // Loads run one at a time, in call order. A failure before the old chapter is disposed uncovers it again, unless
  // that chapter has ended (a chain, the credits: it can take no input): then the import is retried behind the card
  // with a backoff, and if it keeps failing the title comes up in place over the ended chapter (no fetch needed).
  // A failure after the unload falls back to the souk under the title (unless the souk itself failed).
  load(id, cp = 0, opts = {}) {
    const run = async () => {
      try {
        if (opts.delay) await wait(opts.delay);
        return await this._load(id, cp, opts);
      } catch (e) {
        console.error(e);
        this.game.emit('loadError', { id, cp, message: String(e?.message || e), attempt: opts.attempt || 0 });
        this.recover(id, cp, e, opts);
        throw e;
      }
    };
    const p = (this.busy || Promise.resolve()).then(run, run);
    const tail = p.catch(() => {});
    this.busy = tail;
    tail.then(() => { if (this.busy === tail) this.busy = null; });
    return p;
  }

  recover(id, cp, e, opts = {}) {
    const g = this.game, card = this.card, { reason = 'start', attempt = 0 } = opts;
    const hide = () => { if (card) Promise.resolve(card.hide?.()).catch(() => {}); };
    this.card = null;
    if (e?.stage === 'cover') {
      // nothing was disposed. A chapter that has ended cannot take control back: retry, then the title over it
      const ended = reason === 'chain' || g.mode === 'chapterEnd' || g.mode === 'credits';
      if (ended && g.level) {
        if (attempt < RETRY_MS.length) {
          g.suspended = true;
          this.load(id, cp, { ...opts, attempt: attempt + 1, delay: RETRY_MS[attempt], card }).catch(() => {});
        } else {
          g.suspended = false;
          try { g.titleHere(); } catch (err) { console.error(err); }
          hide();
        }
        return;
      }
      g.suspended = false;
      hide();
      if (g.level) { g.fadeTarget = 0; g.fadeSpeed = 1.2; }
      return;
    }
    g.suspended = false;
    if (id === 'souk' || reason === 'boot') return; // nothing safer to fall back to (boot reports the error)
    this.load('souk', 0, { reason: 'title' }).then(hide, hide).catch(() => {});
  }

  async _load(id, cp, { reason = 'start', onProgress = null, card: keepCard = null } = {}) {
    const g = this.game, t0 = performance.now();
    const prog = (p, msg) => { try { onProgress?.(p, msg); } catch { /* ui gone */ } };
    const phases = {}; let tp = t0;
    const mark = (k) => { const t = performance.now(); phases[k] = Math.round(t - tp); tp = t; };
    // 1. cover the screen (the sim waits from here): the card (U's or the stub) over a canvas fade to the
    // exit colour; the module is imported before anything is disposed
    let def;
    try {
      const m = meta(id);
      if (!m) throw new Error(`unknown chapter ${id}`);
      g.suspended = true;
      if (reason !== 'boot') {
        // a chain fades to the finished chapter's exit colour, everything else to black
        const exit = reason === 'chain' && g.def ? (meta(g.def.id)?.exit || '#000000') : '#000000';
        if (g.paused) g.setPaused(false);
        if (g.fade < 0.999) await g.fadeTo(1, { color: exit, sec: reason === 'restart' ? 0.35 : 0.8 });
        // a retry keeps the card that is already up
        if (keepCard) this.card = keepCard;
        else if (g.hooks.card && reason !== 'restart' && reason !== 'title') this.card = await g.hooks.card(m, { reason, from: g.def?.id ?? null });
      }
      mark('cover');
      def = await getChapter(id);
      mark('import');
    } catch (e) { if (e && typeof e === 'object') e.stage = 'cover'; throw e; }
    const card = this.card;
    // 2. suspend the sim
    g.setMode('loading');
    // 3-4. dispose the old chapter
    this.unload();
    // 5. per-chapter game fields
    g.resetChapterState();
    mark('unload');
    prog(0.02, 'opening the gate…');
    g.def = def; g.chapterId = id;
    // 6. time of day (re-bakes the env map when the sky changes)
    if (Array.isArray(def.look)) g.director.apply(def.look[0].preset).keys(def.look);
    else g.director.apply(def.look || 'goldenHour');
    // 7. surfaces and materials this chapter needs, baked progressively
    if (def.surfaces) registerSurfaces(def.surfaces);
    if (def.materials) g.mats.register(def.materials);
    if (def.needs?.length && g.world.bake) await g.world.bake(def.needs, (p, n) => prog(0.05 + p * 0.4, n));
    mark('bake');
    // 8. build
    const root = new THREE.Group(); root.name = `chapter:${id}`;
    g.scene.add(root); g.root = root;
    const L = Object.assign(emptyLevel(), {});
    g.level = L;
    const batch = new Batcher(g.mats, { chunk: def.chunk ?? 40 });
    const K = batch.kit();
    const r = rng(def.seed ?? 42);
    const helpers = createLevelKit(g, { K, root, L, r });
    const kit = { ...helpers, K, root, L, r, batch, mats: g.mats, phys: g.phys, game: g, add: (o) => g.add(o), track: (o) => g.track(o), ...this.scopedKit() };
    prog(0.46, 'raising walls…');
    let out = def.build(g, kit);
    if (out && typeof out.next === 'function') {
      let s = out.next(), ty = performance.now();
      while (!s.done) {
        if (typeof s.value === 'number') prog(0.46 + 0.36 * Math.min(1, s.value), 'raising walls…');
        if (performance.now() - ty > 8) { await yieldFrame(); ty = performance.now(); }
        s = out.next();
      }
      out = s.value;
    } else if (out && typeof out.then === 'function') out = await out;
    if (out && out !== L) Object.assign(L, out);
    mark('build');
    batch.build(root);
    mark('merge');
    prog(0.84, 'hanging the lanterns…');
    await yieldFrame();
    // 9. FX on the chapter root, glow sprites and pool sources
    g.wireChapter(L);
    mark('fx');
    // 10-11. camera, checkpoints, snapshot, prepare, spawn
    const startCp = Math.max(0, Math.min(cp | 0, g.checkpoints.length - 1));
    g.placeAt(startCp);
    prog(0.88, 'lighting the lanterns…');
    // 12. compile every material (hidden ones too) before the first frame, then one warm-up render
    await this.warm(phases);
    prog(1, 'ready');
    this.stats = { id, ms: Math.round(performance.now() - t0), reason, phases };
    // 13. reveal
    this.card = null;
    g.enterChapter({ reason, card });
    return L;
  }

  // subscriptions that live as long as the chapter: unload() undoes them
  scopedKit() {
    const g = this.game, S = this.scope;
    return {
      on: (name, fn) => { const off = g.events.on(name, fn); S.push(off); return off; },
      onFrame: (fn) => { g.hooks.frame.push(fn); const off = () => { const i = g.hooks.frame.indexOf(fn); if (i >= 0) g.hooks.frame.splice(i, 1); }; S.push(off); return off; },
      registerExt: (name, fn) => { g.registerExt(name, fn); S.push(() => { if (g.ext[name] === fn) delete g.ext[name]; }); return fn; },
    };
  }

  async warm(phases = {}) {
    const g = this.game, rs = g.world.rs;
    let t = performance.now();
    const hidden = [];
    g.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      if (rs.renderer.compileAsync) await rs.renderer.compileAsync(g.scene, g.camera);
      else rs.renderer.compile(g.scene, g.camera);
    } catch (e) { console.warn('compile', e); }
    phases.compile = Math.round(performance.now() - t); t = performance.now();
    g.render(0.016, 0);
    phases.render = Math.round(performance.now() - t);
    for (const o of hidden) o.visible = false;
    await yieldFrame();
  }

  // dispose the current chapter (everything under game.root and what it registered)
  unload() {
    const g = this.game;
    if (!g.root) return null;
    const L = g.level;
    for (const e of [...(L?.entities || []), ...(L?.systems || [])]) { try { e.dispose?.(); } catch (err) { console.error(err); } }
    for (const off of this.scope.splice(0)) { try { off(); } catch (err) { console.error(err); } }
    g.cinema?.stop?.({ audio: false }); g.cinema = null;
    g.player.scripted = null; g.player.lever = null; g.player.grip = null;
    g.camRig.reset();
    g.lightRig.releaseAll();
    g.lightPool.clear();
    const keep = sessionAssets(g);
    const res = disposeTree(g.root, keep);
    for (const o of g.tracked) {
      if (o.isObject3D) { o.removeFromParent(); disposeTree(o, keep); } else if (!keep.tex.has(o) && !keep.mats.has(o)) o.dispose?.();
    }
    g.tracked.clear();
    g.scene.remove(g.root);
    g.root = null; g.level = null;
    g.shafts = null; g.dust = null; g.flock = null; g.director.shafts = null;
    g.phys.clear([g.player.body]);
    g.director.restore();
    return res;
  }
}

// glow sprite texture for lanterns (session asset)
export function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,220,170,1)'); gr.addColorStop(0.25, 'rgba(255,170,90,.45)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.name = 'glow';
  return t;
}

// FX the loader builds on the chapter root (Shafts/Dust/Flock keep their constructors)
export function buildChapterFX(game, L) {
  const root = game.root;
  const shafts = new Shafts(root, game.director.sunDir, G);
  for (const s of L.shaftSpots) shafts.add(s.p, s.o);
  if (L.dustRegions.length) shafts.addDust(L.dustRegions, L.dustCount ?? 1400);
  for (const s of L.lightSources) game.lightPool.add(s.pos, s.intensity, s.phase);
  const dust = new Dust(root, 64);
  const flock = new Flock(root, game.mats, L.flockSpots);
  for (const l of L.lanterns) {
    if (l.lit === false) continue;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: game.glowTex, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
    sp.scale.setScalar(0.9);
    sp.position.set(0, l.mesh.userData.glowY ?? 0.2, 0);
    l.mesh.add(sp);
    l.sprite = sp;
  }
  return { shafts, dust, flock };
}
