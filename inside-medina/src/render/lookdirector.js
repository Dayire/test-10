import * as THREE from 'three';
import { G } from './atmosphere.js';
import { PRESETS, SKY_FIELDS } from './look.js';

// The LookDirector owns the time of day. It resolves presets (look.js) into
// live values, blends them over time or along x, layers temporary overrides
// on top (cinematics), and writes the result into the sky, the sun and hemi
// lights, fog, post-processing, the lantern pool, glow sprites and glass.
// Everything it writes is a uniform or a light parameter, so blending never
// recompiles a shader. A change of sky colours re-bakes the environment map.

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
    this.pool = null; this.shafts = null; this.glowMul = 1;
    this.envKey = skyKey(this.base); this.envScale = -1;
  }

  // instant switch; re-bakes the environment if the sky changed
  apply(preset) {
    this.blend = null; this.xKeys = null;
    this.name = typeof preset === 'string' ? preset : 'custom';
    copyLook(this.base, resolved(preset));
    this.write();
    const key = skyKey(this.cur);
    if (key !== this.envKey) { this.envKey = key; this.world.rebuildEnvironment?.(); }
    return this;
  }
  // x-keyed blend: [{x, preset}] (Chapter IV); update(x) follows the boy
  keys(xKeys) {
    this.blend = null;
    this.xKeys = xKeys && xKeys.length ? xKeys.slice().sort((a, b) => a.x - b.x).map((k) => ({ x: k.x, L: resolved(k.preset) })) : null;
    return this;
  }
  blendTo(preset, sec = 1) {
    this.xKeys = null;
    this.blend = { from: copyLook({}, this.base), to: resolved(preset), t: 0, dur: Math.max(1e-3, sec), name: typeof preset === 'string' ? preset : 'custom' };
    if (sec <= 0) this.update(0, 1);
    return this;
  }
  // set the blend position directly (clocks that own their own time)
  blendAt(from, to, t) { this.blend = null; this.xKeys = null; lerpLook(this.base, resolved(from), resolved(to), Math.max(0, Math.min(1, t))); return this; }
  // temporary per-field values on top of the preset (cinematics); restore() drops them
  override(fields) { for (const k of Object.keys(fields)) copyValue(this.ov, k, resolveValue(k, fields[k])); return this; }
  restore() { this.ov = {}; this.write(); return this; }
  // resolved copy of a preset (for relative overrides)
  get(name) { return copyLook({}, name ? resolved(name) : this.base); }
  rebake() { this.envKey = skyKey(this.cur); this.world.rebuildEnvironment?.(); }
  setUser({ brightness, grain } = {}) {
    if (brightness !== undefined) this.user.exposure = 1 + 0.08 * brightness;
    if (grain !== undefined) this.user.grain = grain / 60;
  }

  update(x = 0, dt = 0) {
    const b = this.blend;
    if (b) {
      b.t = Math.min(1, b.t + dt / b.dur);
      lerpLook(this.base, b.from, b.to, smooth(b.t));
      if (b.t >= 1) { this.blend = null; this.name = b.name; }
    } else if (this.xKeys) {
      const K = this.xKeys;
      if (x <= K[0].x) copyLook(this.base, K[0].L);
      else if (x >= K[K.length - 1].x) copyLook(this.base, K[K.length - 1].L);
      else { let i = 0; while (K[i + 1].x < x) i++; lerpLook(this.base, K[i].L, K[i + 1].L, smooth((x - K[i].x) / (K[i + 1].x - K[i].x))); }
    }
    this.write();
  }

  write() {
    const c = copyLook(this.cur, this.base);
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
    const U = w.sky?.uniforms;
    if (U) {
      U.uSunDir.value.copy(c.sunDir);
      U.uZenith.value.copy(c.zenith); U.uHorizon.value.copy(c.horizon); U.uGround.value.copy(c.groundCol);
      U.uSunColor.value.copy(c.sunColor); U.uCloudLit.value.copy(c.cloudLit); U.uCloudShade.value.copy(c.cloudShade);
      U.uExposure.value = c.skyExposure;
      if (U.uSunDisk) U.uSunDisk.value = c.sunDisk;
      if (U.uNight) U.uNight.value = c.night ?? c.moon;
      if (U.uStars) U.uStars.value = c.stars;
      if (U.uMoonDir) U.uMoonDir.value.copy(c.moonDir);
      if (U.uMoonColor) U.uMoonColor.value.copy(c.moonColor);
      if (U.uMoonSize) U.uMoonSize.value = c.moonSize * c.moon;
    }
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
    const glass = this.mats?.cache?.get('glassGlow');
    if (glass) glass.emissiveIntensity = 3.0 * c.glassGlow;
    if (Math.abs(c.envIntensity - this.envScale) > 1e-4) { this.envScale = c.envIntensity; this.mats?.setEnv?.(null, c.envIntensity); }
    this.shafts?.setSun?.(c.sunDir, c.sunColor);
  }
}
