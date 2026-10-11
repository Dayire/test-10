import * as THREE from 'three';
import { PostFX } from './post.js';
import { FrameCap, DynRes, AutoQuality } from './dynres.js';
import { ShadowPolicy } from './shadowpolicy.js';
import { Particles, setActiveParticles } from './particles.js';
import { VIEW } from './fx.js';
import { installLdrEncode } from './atmosphere.js';
import { lut } from './lut.js';

// Quality tiers (FULL_GAME §9.2). scale: internal resolution (× min(DPR, scale)); dyn: dynamic
// resolution range as a fraction of it; shadowHz < 60 refreshes shadow maps at that rate; shadowReach: static
// casters whose shadow cannot land within that many metres behind the play plane stop casting; lite: chapters
// loaded on the tier build their geometry with fewer segments (geom.js DETAIL).
export const QUALITY = {
  ultra: { name: 'ultra', scale: 1.5, msaa: 4, shadow: 4096, dof: true, dofTaps: 48, rays: true, tex: 1, fxaa: false, dyn: [0.75, 1], shadowHz: 60, smallCull: false, shadowReach: Infinity, soft: true, ssao: true, flare: true, particles: 1 },
  high: { name: 'high', scale: 1.25, msaa: 4, shadow: 2048, dof: true, dofTaps: 36, rays: true, tex: 1, fxaa: false, dyn: [0.8, 1], shadowHz: 60, smallCull: false, shadowReach: Infinity, soft: true, ssao: true, flare: true, particles: 1 },
  medium: { name: 'medium', scale: 1.0, msaa: 2, shadow: 2048, dof: true, dofTaps: 16, rays: true, tex: 1, fxaa: true, dyn: [0.7, 1], shadowHz: 30, smallCull: true, shadowReach: 14, soft: true, ssao: false, flare: true, particles: 0.5 },
  low: { name: 'low', scale: 0.75, msaa: 0, shadow: 1024, dof: false, dofTaps: 16, rays: false, tex: 0.5, fxaa: true, dyn: [0.8, 1], shadowHz: 30, smallCull: true, shadowReach: 8, soft: false, ssao: false, flare: false, particles: 0.25, lite: true, alphaCasters: false },
};
export const TIERS = ['low', 'medium', 'high', 'ultra'];
// ?slowgpu: relative fill cost of each tier's passes for the synthetic GPU (medium = 1)
const SLOW_TIER = { low: 0.55, medium: 1, high: 1.35, ultra: 1.8 };

const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
// where three invalidates a multisampled colour buffer after each resolve (the same test as its WebGLTextures),
// the soft pass cannot draw onto the resolved scene: it is drawn in the main pass instead (hard additive)
const MSAA_INVALIDATED = typeof navigator !== 'undefined' && /OculusBrowser/.test(navigator.userAgent);

export class RenderSystem {
  constructor(canvas, tier = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.LinearSRGBColorSpace; // final pass encodes to sRGB itself
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    // without colour-renderable float targets: low tier, RGBA8 targets with an encoded scene
    this.halfFloat = !PARAMS.has('ldr') && (r.extensions.has('EXT_color_buffer_half_float') || r.extensions.has('EXT_color_buffer_float'));
    if (!this.halfFloat) { installLdrEncode(); tier = 'low'; }
    this.deviceTier = tier; this.autoMax = tier;
    this.tier = tier;
    this.q = this._q(tier);
    // URL test flags win over saved settings: ?noauto keeps the tier and the resolution fixed (quality
    // 'auto' and the dynres setting are ignored) unless ?dynres=1 asks for dynamic resolution; ?dynres=0
    // turns it off whatever the settings say
    this.noauto = PARAMS.has('noauto');
    this.urlDyn = PARAMS.has('dynres') ? PARAMS.get('dynres') !== '0' : this.noauto ? false : null;
    const dyn = this.urlDyn ?? true;
    this.user = { renderScale: 1, dynres: true, fpsCap: 'display', batterySaver: false, dof: true, grain: 60, brightness: 0, motionBlur: false, reduceFlashing: false, quality: 'auto' };
    this.cap = this._cap = new FrameCap();
    this.dyn = new DynRes(); this.dyn.enabled = dyn;
    this.auto = new AutoQuality();
    this.shadows = new ShadowPolicy(r);
    this.particles = new Particles(); setActiveParticles(this.particles);
    this.post = new PostFX(r, this.q);
    this._configureTier();
    this.frameTimes = [];
    this.autoQuality = !this.noauto;
    this.onTierChange = null;
    this.slowGpu = PARAMS.has('slowgpu') ? +PARAMS.get('slowgpu') || 8 : 0;
    this.coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.menuBackground = false;
    this.lost = false; this._lostCbs = []; this._restoredCbs = [];
    // a chapter root leaving the scene takes its live particles with it
    this._fxScene = null;
    this._onRemoved = (e) => { if (e.child !== this.particles.group && e.child.children.length) { this.clearEffects(); this.markDiscontinuity(); } };
    this._onAdded = (e) => { if (e.child !== this.particles.group && e.child.children.length) this.markDiscontinuity(); };
    this._camPos = null;
    this.frameStart = 0; this.cpuMs = 0; this.gpuMs = 0; this.clock = 0; this._skip = 0;
    this._initTimer();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; for (const f of this._lostCbs) f(e); }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._timerQueries = []; this._initTimer(); this.post.restored(); this.shadows.reset(); for (const f of this._restoredCbs) f(); }, false);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _q(tier) {
    const q = { ...QUALITY[tier], ldr: !this.halfFloat, ...(this.halfFloat ? {} : { msaa: 0 }) };
    if (MSAA_INVALIDATED && q.msaa > 0) q.soft = false;
    return q;
  }
  _configureTier() {
    const q = this.q;
    // a new tier has a new cost: what the resolution trials learnt no longer holds (the menu background keeps its half)
    const bg = this.menuBackground;
    this.dyn.setRange(bg ? 0.5 : q.dyn[0], bg ? 0.5 : 1); this.dyn.reset(bg ? 0.5 : 1); this.dyn.clearLimit();
    this.shadows.configure(q);
    this.particles.budget = q.particles;
    this.post.user.dof = this.user.dof && !this.user.batterySaver;
  }
  get scale() { return this.dyn.scale; }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const tierScale = Math.min(dpr, this.q.scale);
    const user = this.user.renderScale * (this.user.batterySaver ? 0.75 : 1);
    const outScale = Math.max(tierScale, Math.min(dpr, 1));
    const maxW = Math.max(1, Math.round(w * tierScale * user)), maxH = Math.max(1, Math.round(h * tierScale * user));
    const outW = Math.max(1, Math.round(w * outScale)), outH = Math.max(1, Math.round(h * outScale));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(outW, outH, false);
    this.w = maxW; this.h = maxH; this.outW = outW; this.outH = outH;
    this.cssW = w; this.cssH = h;
    this.post.setSize(maxW, maxH, outW, outH);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
    this.shadows.invalidate();
  }

  setTier(tier, { auto = false } = {}) {
    if (tier === this.tier || !QUALITY[tier]) return;
    if (!this.halfFloat && tier !== 'low') return;
    this.tier = tier;
    const keepParams = this.post.params, keepLimits = this.post.limits, keepUser = this.post.user;
    this.post.dispose();
    this.q = this._q(tier);
    this.post = new PostFX(this.renderer, this.q);
    Object.assign(this.post.params, keepParams); Object.assign(this.post.limits, keepLimits); Object.assign(this.post.user, keepUser);
    this._configureTier();
    this.resize();
    this._fxWarm = false;
    this.auto.restart(this.clock);
    if (!auto) this.autoMax = tier;
    this.onTierChange && this.onTierChange(tier, this.q);
  }

  // live settings (FULL_GAME §7.4): quality, renderScale (50–100 or 0.5–1), dynres, fpsCap (30 | 60 | 'display'),
  // batterySaver, dof, grain (0–100), brightness (−3…+3), motionBlur, reduceFlashing
  applySettings(s = {}) {
    const U = this.user;
    let resize = false;
    if (s.renderScale !== undefined) { const v = +s.renderScale; U.renderScale = Math.min(1, Math.max(0.5, v > 1 ? v / 100 : v)); resize = true; }
    if (s.dynres !== undefined) {
      U.dynres = !!s.dynres;
      const on = this.urlDyn ?? U.dynres;
      if (on !== this.dyn.enabled) { this.dyn.enabled = on; if (!on) this.dyn.reset(1); }
    }
    if (s.batterySaver !== undefined && !!s.batterySaver !== U.batterySaver) { U.batterySaver = !!s.batterySaver; resize = true; }
    if (s.fpsCap !== undefined) U.fpsCap = s.fpsCap;
    if (s.fpsCap !== undefined || s.batterySaver !== undefined) this.cap.set(this._capFps());
    if (s.dof !== undefined) U.dof = !!s.dof;
    this.post.user.dof = U.dof && !U.batterySaver;
    // brightness and grain: the LookDirector scales the look's exposure (1 + 0.08·b) and grain (grain / 60) as it
    // writes them every frame; P adds only the gamma lift it lacks, so nothing is applied twice
    if (s.grain !== undefined) U.grain = Math.max(0, Math.min(100, +s.grain) || 0);
    if (s.brightness !== undefined) {
      U.brightness = Math.max(-3, Math.min(3, +s.brightness || 0));
      this.post.params.userGamma = 1 - U.brightness * 0.04;
    }
    if (s.motionBlur !== undefined) U.motionBlur = !!s.motionBlur;
    if (s.reduceFlashing !== undefined) {
      U.reduceFlashing = !!s.reduceFlashing;
      Object.assign(this.post.limits, U.reduceFlashing ? { bloom: 0.34, flare: 0.15, rays: 0.9, dirt: 0.05 } : { bloom: Infinity, flare: Infinity, rays: Infinity, dirt: Infinity });
    }
    if (s.quality !== undefined) {
      U.quality = s.quality;
      if (s.quality === 'auto') { if (!this.noauto) { this.autoQuality = true; this.autoMax = this.deviceTier; } }
      else if (QUALITY[s.quality]) { this.autoQuality = false; this.setTier(s.quality); }
    }
    if (resize) this.resize();
  }
  _capFps() {
    if (this.menuBackground) return 30;
    if (this.user.batterySaver) return 30;
    const c = this.user.fpsCap;
    return c === 'display' || c === undefined || c === null ? 0 : +c;
  }
  // main-menu background: 30 fps at half resolution
  setMenuBackground(on) {
    if (!!on === this.menuBackground) return;
    this.menuBackground = !!on;
    this.cap.set(this._capFps());
    if (on) this.dyn.setRange(0.5, 0.5); else this.dyn.setRange(this.q.dyn[0], 1);
    this.dyn.reset(on ? 0.5 : 1);
    this.post.setScale(this.dyn.scale);
  }

  // colour look-up crossfade (lut.js): a, b are look names or LUT textures; amount 0 turns it off
  setLut(a, b = null, mix = 0, amount = 1) {
    const P = this.post.params, L = (x) => (typeof x === 'string' ? lut(x) : x || null);
    P.lutA = L(a); P.lutB = L(b); P.lutMix = mix; P.lut = amount;
  }

  // drop every live particle (a chapter unload; also automatic when a chapter root leaves the scene)
  clearEffects() { this.particles.clear(); }

  onContextLost(fn) { this._lostCbs.push(fn); return () => { this._lostCbs = this._lostCbs.filter((f) => f !== fn); }; }
  onContextRestored(fn) { this._restoredCbs.push(fn); return () => { this._restoredCbs = this._restoredCbs.filter((f) => f !== fn); }; }

  // rAF gate: false → skip this callback entirely (frame cap)
  beginFrame(now = performance.now()) {
    if (this.lost) return false;
    const ok = this.cap.begin(now);
    if (ok) this.frameStart = now;
    return ok;
  }

  // a discontinuity (a chapter root added or removed, a teleport, a long stall): the next frames carry compiles
  // and uploads, not the steady cost, so they are ignored and the windows start again
  markDiscontinuity(frames = 3) { this._skip = Math.max(this._skip | 0, frames); this.dyn.restart(); }

  // frame interval in ms of a rendered frame. Paused / hidden frames (and the first two after) are ignored, and
  // so are the frames after a discontinuity. Time is the sum of the tracked intervals (the rAF clock).
  trackFrame(ms, o = {}) {
    if (o.paused || o.hidden || (typeof document !== 'undefined' && document.hidden) || this.lost) { this.markDiscontinuity(2); return; }
    if (this.cap.skipped) return;
    if (!(ms > 0)) return;
    // a stall: over a second and well over the recent frames (a slow clock's frames are not stalls)
    const avg = this._ivAvg || ms;
    this._ivAvg = avg + (Math.min(ms, 4000) - avg) * 0.2;
    if (ms > 1000 && ms > avg * 3) { this.markDiscontinuity(2); return; }
    if (this._skip > 0) { this._skip--; return; }
    const now = this.clock += ms, D = this.dyn;
    const base = 1000 / Math.min(60, this.cap.fps || 60);
    let cost = ms, quantized = true, work;
    if (this.slowGpu) {
      // synthetic GPU: fixed CPU cost plus a fill cost that scales with the rendered pixels and the tier's passes
      cost = 4 + this.slowGpu * 2.4 * D.scale * D.scale * (SLOW_TIER[this.tier] ?? 1); quantized = false; work = cost;
    } else if (this.gpuMs > 0) {
      // with a GPU timer the interval only counts when our own work fills the frame (CPU-bound, unmeasured);
      // a long interval with little work is a throttled or display-limited clock, not a cost
      work = Math.max(this.gpuMs, this.cpuMs);
      if (!(ms > base * 1.15 && work > base * 0.6)) { cost = work; quantized = false; }
    }
    if (this.user.dynres && !this.menuBackground) D.update(cost, now, base, quantized, this.cpuMs);
    this.post.setScale(D.scale);
    if (!this.autoQuality) return;
    // a delivered period the resolution never changed, with the CPU idle, is the display's (a throttled rAF): it is
    // the tier's budget too
    const step = this.auto.update(cost, now, D.displayLimited ? D.budget(base) : base, {
      dynAtMin: D.atMin || D.limited > 0, dynAtMax: D.atMax, work,
      canUp: !this.coarse && !D.limited && TIERS.indexOf(this.tier) < TIERS.indexOf(this.autoMax),
    });
    if (step) {
      const idx = TIERS.indexOf(this.tier) + step;
      if (idx >= 0 && idx < TIERS.length) this.setTier(TIERS[idx], { auto: true });
    }
  }

  // GPU frame time from EXT_disjoint_timer_query_webgl2 where the browser exposes it
  _initTimer() {
    const gl = this.renderer.getContext();
    this._tq = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._timerQueries = [];
  }
  _timerBegin() {
    if (!this._tq || this._timerQueries.length > 4) return null;
    const gl = this.renderer.getContext(), q = gl.createQuery();
    gl.beginQuery(this._tq.TIME_ELAPSED_EXT, q);
    return q;
  }
  _timerEnd(q) {
    const gl = this.renderer.getContext();
    if (q) { gl.endQuery(this._tq.TIME_ELAPSED_EXT); this._timerQueries.push(q); }
    if (!this._tq) return;
    const disjoint = gl.getParameter(this._tq.GPU_DISJOINT_EXT);
    while (this._timerQueries.length) {
      const h = this._timerQueries[0];
      if (!gl.getQueryParameter(h, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(h, gl.QUERY_RESULT);
      if (!disjoint) this.gpuMs += (ns / 1e6 - this.gpuMs) * 0.2;
      gl.deleteQuery(h); this._timerQueries.shift();
    }
  }

  render(scene, camera, time) {
    if (this.lost) return;
    const t0 = performance.now();
    this.renderer.info.reset();
    if (this.particles.group.parent !== scene) { this.particles.attach(scene); this._fxWarm = false; }
    // the particles' programs for the pass that draws them (the soft pass sees no lights), before the first emit
    if (!this._fxWarm) { this._fxWarm = true; if (this.q.soft) this.post.compileSoft(this.particles.group, scene, camera); else this.renderer.compile(this.particles.group, camera, scene); }
    if (this._fxScene !== scene) {
      this._fxScene?.removeEventListener('childremoved', this._onRemoved); this._fxScene?.removeEventListener('childadded', this._onAdded);
      scene.addEventListener('childremoved', this._onRemoved); scene.addEventListener('childadded', this._onAdded); this._fxScene = scene;
    }
    // a teleport (respawn, checkpoint start, cut to a far shot) brings new geometry and shadow work into view: a
    // jump of more than 4 m that the camera's recent motion does not explain (a fast crane on slow frames is not one)
    const cp = camera.position;
    if (!this._camPos) { this._camPos = cp.clone(); this._camV = 0; }
    else {
      const d = cp.distanceTo(this._camPos);
      if (d > 4 && d > this._camV * 3 + 1) this.markDiscontinuity();
      this._camV += (Math.min(d, 20) - this._camV) * 0.3; this._camPos.copy(cp);
    }
    this.particles.update(time);
    VIEW.from(camera);
    this.post.setScale(this.dyn.scale);
    this.shadows.update(scene, camera, t0);
    const tq = this._timerBegin();
    this.post.render(scene, camera, time);
    this._timerEnd(tq);
    const t1 = performance.now();
    this.cpuMs = this.frameStart ? t1 - this.frameStart : t1 - t0;
    this.frameStart = 0;
  }

  get stats() {
    const i = this.renderer.info;
    return { tier: this.tier, scale: +this.dyn.scale.toFixed(3), cap: this.cap.fps, calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, gpuMs: +this.gpuMs.toFixed(2), cpuMs: +this.cpuMs.toFixed(2), p90: this.auto.p90, ...this.post.stats, shadows: { ...this.shadows.stats } };
  }

  dispose() { this.post.dispose(); this.particles.dispose(); this.renderer.dispose(); }
}
