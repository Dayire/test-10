import * as THREE from 'three';
import { PostFX } from './post.js';
import { FrameCap, DynRes, AutoQuality } from './dynres.js';
import { ShadowPolicy } from './shadowpolicy.js';
import { Particles, setActiveParticles } from './particles.js';
import { installLdrEncode } from './atmosphere.js';

// Quality tiers (FULL_GAME §9.2). scale: internal resolution (× min(DPR, scale)); dyn: dynamic
// resolution range as a fraction of it; shadowHz < 60 refreshes shadow maps at that rate.
export const QUALITY = {
  ultra: { name: 'ultra', scale: 1.5, msaa: 4, shadow: 4096, dof: true, dofTaps: 48, rays: true, tex: 1, fxaa: false, dyn: [0.75, 1], shadowHz: 60, smallCull: false, soft: true, ssao: true, flare: true, particles: 1 },
  high: { name: 'high', scale: 1.25, msaa: 4, shadow: 2048, dof: true, dofTaps: 36, rays: true, tex: 1, fxaa: false, dyn: [0.8, 1], shadowHz: 60, smallCull: false, soft: true, ssao: true, flare: true, particles: 1 },
  medium: { name: 'medium', scale: 1.0, msaa: 2, shadow: 2048, dof: true, dofTaps: 16, rays: true, tex: 1, fxaa: true, dyn: [0.7, 1], shadowHz: 30, smallCull: true, soft: true, ssao: false, flare: true, particles: 0.5 },
  low: { name: 'low', scale: 0.75, msaa: 0, shadow: 1024, dof: false, dofTaps: 16, rays: false, tex: 0.5, fxaa: true, dyn: [0.8, 1], shadowHz: 30, smallCull: true, soft: false, ssao: false, flare: false, particles: 0.25 },
};
export const TIERS = ['low', 'medium', 'high', 'ultra'];

const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

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
    // test runs (?noauto) keep a fixed resolution unless ?dynres=1 asks for it
    const dyn = PARAMS.has('dynres') ? PARAMS.get('dynres') !== '0' : !PARAMS.has('noauto');
    this.user = { renderScale: 1, dynres: dyn, fpsCap: 'display', batterySaver: false, dof: true, grain: 60, brightness: 0, motionBlur: false, reduceFlashing: false, quality: 'auto' };
    this.cap = this._cap = new FrameCap();
    this.dyn = new DynRes(); this.dyn.enabled = dyn;
    this.auto = new AutoQuality();
    this.shadows = new ShadowPolicy(r);
    this.particles = new Particles(); setActiveParticles(this.particles);
    this.post = new PostFX(r, this.q);
    this._configureTier();
    this.frameTimes = [];
    this.autoQuality = true;
    this.onTierChange = null;
    this.slowGpu = PARAMS.has('slowgpu') ? +PARAMS.get('slowgpu') || 8 : 0;
    this.coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.menuBackground = false;
    this.lost = false; this._lostCbs = []; this._restoredCbs = [];
    this.frameStart = 0; this.cpuMs = 0; this.gpuMs = 0;
    this._initTimer();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; for (const f of this._lostCbs) f(e); }, false);
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._timerQueries = []; this._initTimer(); this.post.restored(); this.shadows.invalidate(); for (const f of this._restoredCbs) f(); }, false);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  _q(tier) { return { ...QUALITY[tier], ldr: !this.halfFloat, ...(this.halfFloat ? {} : { msaa: 0 }) }; }
  _configureTier() {
    const q = this.q;
    this.dyn.setRange(q.dyn[0], 1); this.dyn.reset(1);
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
    this.auto.restart(performance.now());
    if (!auto) this.autoMax = tier;
    this.onTierChange && this.onTierChange(tier, this.q);
  }

  // live settings (FULL_GAME §7.4): quality, renderScale (50–100 or 0.5–1), dynres, fpsCap (30 | 60 | 'display'),
  // batterySaver, dof, grain (0–100), brightness (−3…+3), motionBlur, reduceFlashing
  applySettings(s = {}) {
    const U = this.user;
    let resize = false;
    if (s.renderScale !== undefined) { const v = +s.renderScale; U.renderScale = Math.min(1, Math.max(0.5, v > 1 ? v / 100 : v)); resize = true; }
    if (s.dynres !== undefined) { U.dynres = !!s.dynres; this.dyn.enabled = U.dynres; if (!U.dynres) this.dyn.reset(1); }
    if (s.batterySaver !== undefined && !!s.batterySaver !== U.batterySaver) { U.batterySaver = !!s.batterySaver; resize = true; }
    if (s.fpsCap !== undefined) U.fpsCap = s.fpsCap;
    if (s.fpsCap !== undefined || s.batterySaver !== undefined) this.cap.set(this._capFps());
    if (s.dof !== undefined) U.dof = !!s.dof;
    this.post.user.dof = U.dof && !U.batterySaver;
    if (s.grain !== undefined) { U.grain = Math.max(0, Math.min(100, +s.grain)); this.post.params.grainScale = U.grain / 60; }
    if (s.brightness !== undefined) {
      U.brightness = Math.max(-3, Math.min(3, +s.brightness));
      this.post.params.userExposure = Math.pow(2, U.brightness * 0.18);
      this.post.params.userGamma = 1 - U.brightness * 0.035;
    }
    if (s.motionBlur !== undefined) U.motionBlur = !!s.motionBlur;
    if (s.reduceFlashing !== undefined) {
      U.reduceFlashing = !!s.reduceFlashing;
      Object.assign(this.post.limits, U.reduceFlashing ? { bloom: 0.34, flare: 0.15, rays: 0.9, dirt: 0.05 } : { bloom: Infinity, flare: Infinity, rays: Infinity, dirt: Infinity });
    }
    if (s.quality !== undefined) {
      U.quality = s.quality;
      if (s.quality === 'auto') { this.autoQuality = true; this.autoMax = this.deviceTier; }
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

  onContextLost(fn) { this._lostCbs.push(fn); return () => { this._lostCbs = this._lostCbs.filter((f) => f !== fn); }; }
  onContextRestored(fn) { this._restoredCbs.push(fn); return () => { this._restoredCbs = this._restoredCbs.filter((f) => f !== fn); }; }

  // rAF gate: false → skip this callback entirely (frame cap)
  beginFrame(now = performance.now()) {
    if (this.lost) return false;
    const ok = this.cap.begin(now);
    if (ok) this.frameStart = now;
    return ok;
  }

  // frame interval in ms of a rendered frame. Paused / hidden frames (and the first two after) are ignored.
  trackFrame(ms, o = {}) {
    if (o.paused || o.hidden || (typeof document !== 'undefined' && document.hidden) || this.lost) { this._skip = 2; return; }
    if (this.cap.skipped) return;
    if (this._skip > 0) { this._skip--; return; }
    if (!(ms > 0)) return;
    const now = performance.now();
    const budget = 1000 / Math.min(60, this.cap.fps || 60);
    let cost = ms, quantized = true, work;
    if (this.slowGpu) {
      // synthetic GPU: fixed CPU cost plus a fill cost that scales with the rendered pixels
      cost = 4 + this.slowGpu * 2.4 * this.dyn.scale * this.dyn.scale; quantized = false; work = cost;
    } else if (this.gpuMs > 0) {
      work = Math.max(this.gpuMs, this.cpuMs);
      cost = Math.max(work, ms > budget * 1.15 ? ms : 0); quantized = false;
    }
    if (this.user.dynres && !this.menuBackground) this.dyn.update(cost, now, budget, quantized);
    this.post.setScale(this.dyn.scale);
    if (!this.autoQuality) return;
    const step = this.auto.update(this.slowGpu ? cost : ms, now, budget, {
      dynAtMin: this.dyn.atMin, dynAtMax: this.dyn.atMax, work,
      canUp: !this.coarse && TIERS.indexOf(this.tier) < TIERS.indexOf(this.autoMax),
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
    if (this.particles.group.parent !== scene) { this.particles.attach(scene); this.renderer.compile(this.particles.group, camera, scene); }
    this.particles.update(time);
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
