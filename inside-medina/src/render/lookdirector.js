import * as THREE from 'three';
import { G } from './atmosphere.js';
import { PRESETS, SKY_FIELDS } from './look.js';

// The LookDirector owns the time of day. It resolves presets (look.js) into
// live values, blends them over time or along x, layers temporary overrides
// on top (cinematics), and writes the result into the sky, the sun and hemi
// lights, fog, post-processing, the lantern pool, glow sprites (glowMul and
// glowColor, read by the game's lantern loop) and glass.
// Everything it writes is a uniform or a light parameter, so blending never
// recompiles a shader. A change of sky colours re-bakes the environment map;
// the maps a blend will reach (x keys, prebaked presets) are baked up front,
// under the card, and swapped in as the blend passes half-way.

const VEC = new Set(['sunDir', 'moonDir']);
const RGB = new Set(['shadowTint', 'highlightTint', 'lift', 'rayColor']);
const isHex = (v) => typeof v === 'string' && v[0] === '#';
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

function resolveValue(k, v) {
  if (v && v.isColor) return v.clone();
  if (v && v.isVector3) return v.clone().normalize();
  if (isHex(v)) return new THREE.Color(v);
  if (VEC.has(k)) return new THREE.Vector3(...v).normalize();
  if (RGB.has(k)) return [...v];
  return v;
}
export function resolveLook(p) {
  const out = {};
  for (const k of Object.keys(p)) out[k] = resolveValue(k, p[k]);
  return out;
}
function copyValue(dst, k, v) {
  if (v && (v.isColor || v.isVector3)) { if (dst[k] && dst[k].copy) dst[k].copy(v); else dst[k] = v.clone(); }
  else if (Array.isArray(v)) { if (Array.isArray(dst[k])) { dst[k][0] = v[0]; dst[k][1] = v[1]; dst[k][2] = v[2]; } else dst[k] = [...v]; }
  else dst[k] = v;
}
function copyLook(dst, src) { for (const k of Object.keys(src)) copyValue(dst, k, src[k]); return dst; }
function lerpLook(dst, a, b, t) {
  for (const k of Object.keys(a)) {
    const x = a[k], y = b[k] ?? x;
    if (x && x.isColor) { if (!dst[k]?.isColor) dst[k] = new THREE.Color(); dst[k].copy(x).lerp(y, t); }
    else if (x && x.isVector3) { if (!dst[k]?.isVector3) dst[k] = new THREE.Vector3(); dst[k].copy(x).lerp(y, t).normalize(); }
    else if (Array.isArray(x)) { if (!Array.isArray(dst[k])) dst[k] = [0, 0, 0]; for (let i = 0; i < 3; i++) dst[k][i] = x[i] + (y[i] - x[i]) * t; }
    else if (typeof x === 'number') dst[k] = x + (y - x) * t;
    else dst[k] = t < 0.5 ? x : y;
  }
  return dst;
}
const cache = new Map();
function resolved(name) {
  if (typeof name !== 'string') return resolveLook(name);
  if (!cache.has(name)) { if (!PRESETS[name]) throw new Error(`unknown look preset ${name}`); cache.set(name, resolveLook(PRESETS[name])); }
  return cache.get(name);
}
const skyKey = (L) => SKY_FIELDS.map((k) => { const v = L[k]; return v?.isColor ? v.getHexString() : v?.isVector3 ? v.toArray().map((n) => n.toFixed(3)).join() : String(v); }).join('|');
const keyCache = new WeakMap();
const keyOf = (L) => { let k = keyCache.get(L); if (!k) keyCache.set(L, k = skyKey(L)); return k; };
const disposeEnv = (t) => { if (t) { if (t.renderTarget) t.renderTarget.dispose(); else t.dispose?.(); } };
// the sky shader's uniforms for a look (sunColor: the sky's sun glow, when it differs from the light's)
function writeSky(U, c, sunColor = c.sunColor) {
  U.uSunDir.value.copy(c.sunDir);
  U.uZenith.value.copy(c.zenith); U.uHorizon.value.copy(c.horizon); U.uGround.value.copy(c.groundCol);
  U.uSunColor.value.copy(sunColor); U.uCloudLit.value.copy(c.cloudLit); U.uCloudShade.value.copy(c.cloudShade);
  U.uExposure.value = c.skyExposure;
  if (U.uSunDisk) U.uSunDisk.value = c.sunDisk;
  if (U.uNight) U.uNight.value = c.night ?? c.moon;
  if (U.uStars) U.uStars.value = c.stars;
  if (U.uMoonDir) U.uMoonDir.value.copy(c.moonDir);
  if (U.uMoonColor) U.uMoonColor.value.copy(c.moonColor);
  if (U.uMoonSize) U.uMoonSize.value = c.moonSize * c.moon;
}

export class LookDirector {
  constructor(world, { mats } = {}) {
    this.world = world; this.mats = mats || world.mats;
    if (!world.sunDir) world.sunDir = new THREE.Vector3().fromArray(PRESETS.goldenHour.sunDir).normalize();
    this.sunDir = world.sunDir; // the one sun every system reads
    this.name = 'goldenHour';
    this.base = copyLook({}, resolved('goldenHour'));
    this.cur = copyLook({}, this.base);
    this.ov = {};
    this.blend = null; this.xKeys = null;
    this.user = { exposure: 1, grain: 1 };
    this.pool = null; this.shafts = null; this.glowMul = 1; this.glowColor = new THREE.Color(PRESETS.goldenHour.glowColor);
    this.envKey = skyKey(this.base); this.envScale = -1;
    // baked environment maps by sky key: the current one, the x keys' and prebaked presets (pinned per chapter)
    this.envs = new Map(); this.pinned = new Set(); this.chapter = null;
    if (world.env) this.envs.set(this.envKey, world.env);
  }

  // instant switch; the environment map follows the sky (from the cache, else baked now)
  apply(preset) {
    this.blend = null; this.xKeys = null;
    this.name = typeof preset === 'string' ? preset : 'custom';
    this.base = copyLook({}, resolved(preset)); // fresh: no field of the previous preset survives
    this.write();
    this.useEnv(this.cur, skyKey(this.cur));
    return this;
  }
  // a chapter's look (a preset, or x keys) with the environment maps its blends need; a new chapter drops the rest
  look(look, chapter = null) {
    if (chapter !== this.chapter) { this.chapter = chapter; this.pinned.clear(); }
    if (Array.isArray(look)) this.apply(look[0].preset).keys(look); else this.apply(look || 'goldenHour');
    const keep = new Set([this.envKey, ...this.pinned, ...(this.xKeys || []).map((k) => keyOf(k.L))]);
    for (const [k, t] of this.envs) if (!keep.has(k)) { this.envs.delete(k); if (t !== this.world.env) disposeEnv(t); }
    return this;
  }
  // x-keyed blend: [{x, preset}] (Chapter IV); update(x) follows the boy. Every key's environment map is baked now.
  keys(xKeys) {
    this.blend = null;
    this.xKeys = xKeys && xKeys.length ? xKeys.slice().sort((a, b) => a.x - b.x).map((k) => ({ x: k.x, L: resolved(k.preset), name: typeof k.preset === 'string' ? k.preset : 'custom' })) : null;
    for (const k of this.xKeys || []) this.envFor(k.L);
    return this;
  }
  // a timed blend on game time (step(dt), called by the game's fixed step: it pauses with the game, waits through
  // loads and follows __medina.sim); call prebake(preset) under the chapter's card first, or the target's map is
  // baked here. A blend that must stay in step with gameplay (a clock) drives blendAt() from its own step instead.
  blendTo(preset, sec = 1) {
    this.xKeys = null;
    const to = resolved(preset);
    this.blend = { from: copyLook({}, this.base), to, t: 0, dur: Math.max(1e-3, sec), name: typeof preset === 'string' ? preset : 'custom' };
    this.blend.fromEnv = this.envSnapshot();
    this.envFor(to);
    if (sec <= 0) { this.blend.t = 1; this.update(); }
    return this;
  }
  step(dt) { const b = this.blend; if (b && b.t < 1) b.t = Math.min(1, b.t + dt / b.dur); }
  // set the blend position directly (clocks that own their own time)
  blendAt(from, to, t) {
    this.blend = null; this.xKeys = null;
    const a = resolved(from), b = resolved(to); t = Math.max(0, Math.min(1, t));
    lerpLook(this.base, a, b, t);
    this.followEnv(a, b, t);
    return this;
  }
  // bake a preset's environment map now (under a card) so a later blend to it swaps instead of baking mid-play
  prebake(preset) { const L = resolved(preset); this.envFor(L); this.pinned.add(keyOf(L)); return this; }
  // temporary per-field values on top of the preset (cinematics); restore() drops them
  override(fields) { for (const k of Object.keys(fields)) copyValue(this.ov, k, resolveValue(k, fields[k])); return this; }
  restore() { this.ov = {}; this.write(); return this; }
  // resolved copy of a preset (for relative overrides)
  get(name) { return copyLook({}, name ? resolved(name) : this.base); }
  rebake() { this.envKey = null; this.useEnv(this.cur, skyKey(this.cur)); }

  // ---- environment maps
  // the cached map for a look's sky, or one baked now: the sky uniforms take that look for the bake, then the
  // director writes the live values back
  envFor(L, key = keyOf(L)) {
    let t = this.envs.get(key);
    if (t) return t;
    const w = this.world, U = w.sky?.uniforms;
    if (!U || !w.bakeEnvironment) return null;
    if (L !== this.cur) writeSky(U, L);
    t = w.bakeEnvironment();
    if (L !== this.cur) this.write();
    this.envs.set(key, t);
    return t;
  }
  useEnv(L, key) {
    if (key === this.envKey) return;
    this.envKey = key;
    const t = this.envFor(L, key);
    if (t && this.world.useEnvironment) this.world.useEnvironment(t);
    else if (!t) { this.world.rebuildEnvironment?.(); if (this.world.env) this.envs.set(key, this.world.env); }
  }
  // a blend shows the map of the side it is nearer, switching with a little hysteresis (a swap keeps every program)
  followEnv(a, b, t) {
    const ka = keyOf(a), kb = keyOf(b);
    if (ka === kb) return;
    const near = t > 0.55 ? 1 : t < 0.45 ? 0 : this.envKey === kb ? 1 : this.envKey === ka ? 0 : t >= 0.5 ? 1 : 0;
    if (near) this.useEnv(b, kb); else this.useEnv(a, ka);
  }
  // the current map as a blend's starting side (a blend may start from a mid-blend look)
  envSnapshot() { const L = copyLook({}, this.cur); keyCache.set(L, this.envKey); return L; }
  // after a lost context every baked map is gone: forget them and bake the current sky again
  resetEnvs() {
    const cur = this.world.env;
    for (const t of this.envs.values()) if (t !== cur) disposeEnv(t);
    this.envs.clear();
    this.world.rebuildEnvironment?.();
    this.envKey = skyKey(this.cur);
    if (this.world.env) this.envs.set(this.envKey, this.world.env);
    return this;
  }
  setUser({ brightness, grain } = {}) {
    if (brightness !== undefined) this.user.exposure = 1 + 0.08 * brightness;
    if (grain !== undefined) this.user.grain = grain / 60;
  }

  // per rendered frame: the timed blend where step() has brought it, or the x keys at the boy's x
  update(x = 0) {
    const b = this.blend;
    if (b) {
      lerpLook(this.base, b.from, b.to, smooth(b.t));
      this.followEnv(b.fromEnv, b.to, smooth(b.t));
      if (b.t >= 1) { this.blend = null; this.name = b.name; }
    } else if (this.xKeys) {
      const K = this.xKeys;
      // name: the key the blend is nearer
      if (x <= K[0].x) { copyLook(this.base, K[0].L); this.useEnv(K[0].L, keyOf(K[0].L)); this.name = K[0].name; }
      else if (x >= K[K.length - 1].x) { const k = K[K.length - 1]; copyLook(this.base, k.L); this.useEnv(k.L, keyOf(k.L)); this.name = k.name; }
      else {
        let i = 0; while (K[i + 1].x < x) i++;
        const t = smooth((x - K[i].x) / (K[i + 1].x - K[i].x));
        lerpLook(this.base, K[i].L, K[i + 1].L, t);
        this.followEnv(K[i].L, K[i + 1].L, t);
        this.name = K[t < 0.5 ? i : i + 1].name;
      }
    }
    this.write();
  }

  write() {
    const c = copyLook(this.cur, this.base);
    // a field only an override set (a cinematic's letterbox or fade) leaves with the override
    for (const k in c) if (!(k in this.base) && !(k in this.ov)) delete c[k];
    for (const k of Object.keys(this.ov)) copyValue(c, k, this.ov[k]);
    const w = this.world, L = w.light;
    this.sunDir.copy(c.sunDir);
    if (L) {
      L.sunDir.copy(c.sunDir);
      L.sun.color.copy(c.sunColor); L.sun.intensity = c.sunIntensity;
      L.sun.shadow.bias = c.shadowBias; L.sun.shadow.normalBias = c.shadowNormalBias;
      L.hemi.color.copy(c.hemiSky); L.hemi.groundColor.copy(c.hemiGround); L.hemi.intensity = c.hemiIntensity;
    }
    if (w.scene?.fog) w.scene.fog.color.copy(c.fogColor);
    G.uFogSunColor.value.copy(c.fogSunColor);
    G.uFogParams.value.x = c.fogDensity; G.uFogParams.value.y = c.fogFalloff;
    G.uFogStart.value = c.fogStart; G.uWindStrength.value = c.wind;
    // the sky's sun glow keeps the preset's colour under an override (a cinematic tints the light, not the sky,
    // as Chapter I's finale always has); an override may set skySunColor for the sky itself
    const U = w.sky?.uniforms;
    if (U) writeSky(U, c, this.ov.skySunColor || this.base.sunColor);
    const P = w.rs?.post?.params;
    if (P) {
      P.exposure = c.exposure * this.user.exposure; P.bloom = c.bloom; P.bloomThreshold = c.bloomThreshold;
      P.vignette = c.vignette; P.grain = c.grain * this.user.grain; P.saturation = c.saturation; P.contrast = c.contrast;
      P.shadowTint.setRGB(...c.shadowTint); P.highlightTint.setRGB(...c.highlightTint); P.lift.setRGB(...c.lift);
      P.rays = c.rays; P.rayColor.setRGB(...c.rayColor);
      P.letterbox = c.letterbox ?? 0;
      if (c.fade !== undefined) P.fade = c.fade;
    }
    if (this.pool) { this.pool.setColor(c.poolColor); this.pool.setMul(c.lanternPool); }
    this.glowMul = c.lanternGlow;
    if (c.glowColor) this.glowColor.copy(c.glowColor);
    const glass = this.mats?.cache?.get('glassGlow');
    if (glass) glass.emissiveIntensity = 3.0 * c.glassGlow;
    if (Math.abs(c.envIntensity - this.envScale) > 1e-4) { this.envScale = c.envIntensity; this.mats?.setEnv?.(null, c.envIntensity); }
    this.shafts?.setSun?.(c.sunDir, c.sunColor);
  }
}
