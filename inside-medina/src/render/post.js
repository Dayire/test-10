import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { LAYERS, SOFT } from './layers.js';
import { createOutputMaterial } from './fxaa.js';
import { FLARE_FS, dirtTexture } from './flare.js';
import { SSAO_FS, SSAO_BLUR_FS } from './ssao.js';

// HDR post chain. Every target is allocated once at the tier's maximum internal size; dynamic
// resolution renders into a viewport sub-rect, and every pass maps screen uv → source uv with
// that source's extent (uMax) and clamps its taps inside it, so nothing is ever reallocated.
//   scene (MSAA) → soft layer (beams, shafts, particles; depth-faded) → SSAO → bloom chain → flare
//   → DOF → god rays → final grade → [output: FXAA + CAS upscale + grain] → canvas
const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

function sm(frag, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
}

// LDR fallback (no float render targets): the scene is stored Reinhard-encoded, bloom at ¼ scale
const CODEC = /* glsl */ `
#ifdef LDR
vec3 dec(vec3 c){ c = min(c, vec3(.996)); return c / (1. - c); }
vec3 enc(vec3 c){ return c / (1. + c); }
const float BLOOM_STORE = .25;
#else
vec3 dec(vec3 c){ return c; }
vec3 enc(vec3 c){ return c; }
const float BLOOM_STORE = 1.;
#endif`;

const PREFILTER = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel, uMax; uniform float uThreshold, uKnee; varying vec2 vUv;
${CODEC}
vec3 s(vec2 o){ return min(dec(texture2D(tColor, clamp(vUv * uMax + o * uTexel, uTexel * .5, uMax - uTexel * .5)).rgb), vec3(40.)); }
void main(){
  vec3 c = (s(vec2(-1.,-1.)) + s(vec2(1.,-1.)) + s(vec2(-1.,1.)) + s(vec2(1.,1.))) * .25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0., 2. * uKnee); soft = soft * soft / (4. * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib * BLOOM_STORE, 1.);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel, uMax; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tColor, clamp(vUv * uMax + o * uTexel, uTexel * .5, uMax - uTexel * .5)).rgb; }
void main(){
  vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.));
  vec3 d = s(vec2(-2., 0.)), e = s(vec2(0., 0.)), f = s(vec2(2., 0.));
  vec3 g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
  vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
  vec3 o = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  gl_FragColor = vec4(o, 1.);
}`;

const UP = /* glsl */ `
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel, uLowMax, uHighMax; uniform float uRadius; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tLow, clamp(vUv * uLowMax + o * uTexel * uRadius, uTexel * .5, uLowMax - uTexel * .5)).rgb; }
void main(){
  vec3 o = s(vec2(0.)) * 4. + (s(vec2(-1., 0.)) + s(vec2(1., 0.)) + s(vec2(0., 1.)) + s(vec2(0., -1.))) * 2.
         + s(vec2(-1., -1.)) + s(vec2(1., -1.)) + s(vec2(-1., 1.)) + s(vec2(1., 1.));
  gl_FragColor = vec4(o / 16. + texture2D(tHigh, vUv * uHighMax).rgb, 1.);
}`;

const DOF = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel, uMax; uniform float uNear, uFar;
uniform vec4 uFocus; // focusDist, nearRange, farStart, farRamp
uniform vec2 uMaxBlur; // near max px, far max px (full-res texels)
varying vec2 vUv;
${CODEC}
vec2 cl(vec2 uv){ return clamp(uv, uTexel * .5, uMax - uTexel * .5); }
float viewDist(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, uNear, uFar); }
float coc(float z){
  float nearC = clamp((uFocus.x - uFocus.y - z) / max(uFocus.y, .01), 0., 1.) * uMaxBlur.x;
  float farC = clamp((z - uFocus.x - uFocus.z) / uFocus.w, 0., 1.) * uMaxBlur.y;
  return max(nearC, farC);
}
const float GA = 2.39996323;
void main(){
  vec2 uv = vUv * uMax;
  float cz = viewDist(uv); float cs = coc(cz);
  vec3 col = dec(texture2D(tColor, uv).rgb); float tot = 1.;
  float nearCov = 0.;
  float R = max(uMaxBlur.x, uMaxBlur.y);
  for (int i = 0; i < NTAPS; i++){
    float fi = float(i) + .5;
    float r = sqrt(fi / float(NTAPS)) * R;
    float a = fi * GA;
    vec2 tc = cl(uv + vec2(cos(a), sin(a)) * r * uTexel);
    vec3 sc = dec(texture2D(tColor, tc).rgb);
    float sz = viewDist(tc); float ss = coc(sz);
    if (sz > cz) ss = min(ss, cs * 2.);
    float m = smoothstep(r - .5, r + .5, ss);
    col += mix(col / tot, sc, m); tot += 1.;
    if (sz < cz - .5) nearCov += m;
  }
  col /= tot;
  float blend = max(smoothstep(.4, 1.5, cs), clamp(nearCov / float(NTAPS) * 3., 0., 1.));
  gl_FragColor = vec4(enc(col), blend);
}`;

const RAYMASK = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSun, uMax; uniform float uAspect; varying vec2 vUv;
${CODEC}
void main(){
  vec2 uv = vUv * uMax;
  float d = texture2D(tDepth, uv).x;
  vec3 c = dec(texture2D(tColor, uv).rgb);
  float sky = step(.99999, d);
  float l = dot(c, vec3(.2126,.7152,.0722));
  vec2 dv = (vUv - uSun) * vec2(uAspect, 1.);
  float prox = exp(-dot(dv, dv) * 1.5);
  float m = sky * max(min(l, 8.) - 1.05, 0.) * (.15 + prox * 1.6) + max(l - 3.0, 0.) * .08;
  gl_FragColor = vec4(vec3(m), 1.);
}`;

const RAYBLUR = /* glsl */ `
uniform sampler2D tMask; uniform vec2 uSun, uMax, uTexel; uniform float uDensity, uDecay; varying vec2 vUv;
void main(){
  vec2 delta = (vUv - uSun) * uDensity / float(RSAMPLES);
  vec2 tc = vUv; float illum = 1.; float acc = 0.;
  for (int i = 0; i < RSAMPLES; i++){
    tc -= delta;
    acc += texture2D(tMask, clamp(tc * uMax, uTexel * .5, uMax - uTexel * .5)).r * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(vec3(acc / float(RSAMPLES)), 1.);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tColor, tBloom, tDof, tRays, tFlare, tAO, tDirt;
uniform vec2 uSceneMax, uSceneTexel, uBloomMax, uDofMax, uRaysMax, uFlareMax, uAOMax;
uniform float uBloom, uRays, uExposure, uVignette, uGrain, uTime, uSaturation, uContrast, uFade, uCA, uLetterbox, uDofOn, uRaysOn;
uniform float uFlare, uDirt, uAO, uAOOn, uFlareOn, uGamma;
uniform vec3 uShadowTint, uHighlightTint, uFadeColor, uRayColor, uLift;
uniform vec2 uRes;
varying vec2 vUv;
${CODEC}
vec3 aces(vec3 x){
  const mat3 m1 = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 m2 = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = m1 * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), 0., 1.);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 S(vec2 uv){ return dec(texture2D(tColor, clamp(uv * uSceneMax, uSceneTexel * .5, uSceneMax - uSceneTexel * .5)).rgb); }
void main(){
  vec2 uv = vUv;
  vec2 cc = uv - .5;
  vec3 col;
  if (uCA > 0.) {
    vec2 off = cc * dot(cc, cc) * uCA;
    col = vec3(S(uv - off).r, S(uv).g, S(uv + off).b);
  } else col = S(uv);
  if (uDofOn > .5) { vec4 d = texture2D(tDof, uv * uDofMax); col = mix(col, dec(d.rgb), d.a); }
  if (uAOOn > .5) col *= mix(1., texture2D(tAO, uv * uAOMax).r, uAO);
  float dirt = uDirt > 0. ? dot(texture2D(tDirt, uv).rgb, vec3(.333)) : 0.;
  vec3 bloom = texture2D(tBloom, uv * uBloomMax).rgb / BLOOM_STORE;
  col += bloom * uBloom * (1. + dirt * uDirt * 5.);
  if (uFlareOn > .5) col += texture2D(tFlare, uv * uFlareMax).rgb / BLOOM_STORE * uFlare * (1. + dirt * uDirt * 6.);
  if (uRaysOn > .5) col += texture2D(tRays, uv * uRaysMax).r * uRayColor * uRays;
  col *= uExposure;
  vec3 x = aces(col);
  float L = dot(x, vec3(.2126,.7152,.0722));
  x *= mix(uShadowTint, vec3(1.), smoothstep(.0, .45, L));
  x = mix(x, x * uHighlightTint, smoothstep(.35, .95, L));
  x = mix(vec3(L), x, uSaturation);
  x = clamp(x, 0., 1.);
  // gentle s-curve in perceptual space
  vec3 p = toSRGB(x);
  p = mix(p, p * p * (3. - 2. * p), uContrast);
  p = p + uLift * (1. - p);
  p = pow(p, vec3(uGamma));
  float vig = smoothstep(.95, .25, length(cc * vec2(uRes.x / uRes.y, 1.) * .9));
  p *= mix(1., vig, uVignette);
  p = mix(p, uFadeColor, uFade);
  float bars = step(abs(cc.y), .5 - uLetterbox);
  p *= bars;
  if (uGrain > 0.) {
    float n = h12(gl_FragCoord.xy + fract(uTime) * 917.) - .5;
    float n2 = h12(gl_FragCoord.xy * 1.37 + fract(uTime * 1.3) * 331.) - .5;
    p += (n + n2) * uGrain + (n) / 255.;
  }
  gl_FragColor = vec4(p, 1.);
}`;

const sub = (n, k) => Math.max(1, Math.ceil(n / k));

export class PostFX {
  constructor(renderer, q) {
    this.r = renderer;
    this.q = q;
    this.quad = new FullScreenQuad(null);
    this.params = {
      exposure: 1.0, bloom: 0.35, bloomThreshold: 1.2, bloomKnee: 0.6,
      vignette: 0.45, grain: 0.035, saturation: 1.0, contrast: 0.12, ca: 0.0,
      shadowTint: new THREE.Color(0.93, 0.95, 1.05), highlightTint: new THREE.Color(1.03, 1.0, 0.94),
      lift: new THREE.Color(0.02, 0.018, 0.02),
      fade: 0, fadeColor: new THREE.Color(0, 0, 0), letterbox: 0,
      rays: 0.6, rayColor: new THREE.Color(1.0, 0.78, 0.52), rayDensity: 0.9, rayDecay: 0.965,
      focus: 13, nearRange: 3.5, farStart: 14, farRamp: 60, nearBlur: 10, farBlur: 5,
      sunScreen: new THREE.Vector2(0.5, 1.2), sunVisible: 0,
      // new: lens flare and dirt, ambient occlusion, user brightness / grain
      flare: 0.3, flareThreshold: 3.5, dirt: 0, ao: 0.55, aoRadius: 0.55,
      userExposure: 1, userGamma: 1, grainScale: 1,
    };
    this.limits = { bloom: Infinity, flare: Infinity, rays: Infinity, dirt: Infinity };
    this.user = { dof: true };
    this.scale = 1;
    this.maxW = this.maxH = this.outW = this.outH = 1;
    this.stats = { aa: '', passes: 0, internal: [1, 1], output: [1, 1], soft: false };
    this._st = new THREE.Vector2();
    this.warmed = false;
    this._build();
  }

  // compile every pass once up front so a later switch (dynamic resolution, the finale's god rays)
  // never stalls on a shader compile
  warm() {
    this.warmed = true;
    const r = this.r;
    this.rtLdr.viewport.set(0, 0, 1, 1);
    for (const m of this.materials()) { this.quad.material = m; r.setRenderTarget(this.rtLdr); this.quad.render(r); }
  }

  _build() {
    const q = this.q, r = this.r;
    const ldr = !!q.ldr;
    const ht = ldr ? THREE.UnsignedByteType : THREE.HalfFloatType;
    this.defs = ldr ? { LDR: '' } : {};
    this.depthTex = new THREE.DepthTexture(1, 1);
    this.depthTex.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: ht, samples: q.msaa, depthTexture: this.depthTex, depthBuffer: true });
    this.rtScene.texture.minFilter = THREE.LinearFilter; this.rtScene.texture.generateMipmaps = false;
    // keep the explicit resolve path even where multisampled render-to-texture exists, so the depth
    // texture is never attached to the framebuffer the soft pass draws into
    if (q.msaa > 0) r.properties.get(this.rtScene).__useRenderToTexture = false;
    const mk = (type = ht) => new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.levels = 6;
    this.down = []; this.up = [];
    for (let i = 0; i < this.levels; i++) { this.down.push(mk()); this.up.push(mk()); }
    this.rtDof = mk();
    this.rtRayMask = mk(); this.rtRays = mk();
    this.rtFlare = q.flare ? mk() : null;
    this.rtAO = q.ssao ? mk(THREE.UnsignedByteType) : null; this.rtAO2 = q.ssao ? mk(THREE.UnsignedByteType) : null;
    this.rtLdr = mk(THREE.UnsignedByteType);
    const D = this.defs;
    this.mPre = sm(PREFILTER, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uMax: { value: new THREE.Vector2(1, 1) }, uThreshold: { value: 1 }, uKnee: { value: .5 } }, D);
    this.mDown = sm(DOWN, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uMax: { value: new THREE.Vector2(1, 1) } });
    this.mUp = sm(UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uLowMax: { value: new THREE.Vector2(1, 1) }, uHighMax: { value: new THREE.Vector2(1, 1) }, uRadius: { value: 1 } });
    this.mDof = sm(DOF, {
      tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uMax: { value: new THREE.Vector2(1, 1) }, uNear: { value: .1 }, uFar: { value: 1000 },
      uFocus: { value: new THREE.Vector4() }, uMaxBlur: { value: new THREE.Vector2() },
    }, { NTAPS: q.dofTaps || 36, ...D });
    this.mRayMask = sm(RAYMASK, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uMax: { value: new THREE.Vector2(1, 1) }, uAspect: { value: 1 } }, D);
    this.mRayBlur = sm(RAYBLUR, { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uMax: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uDensity: { value: .9 }, uDecay: { value: .96 } }, { RSAMPLES: 48 });
    this.mFlare = q.flare ? sm(FLARE_FS, { tBloom: { value: null }, uMax: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: .9 }, uAspect: { value: 1 } }) : null;
    this.mAO = q.ssao ? sm(SSAO_FS, { tDepth: { value: null }, uMax: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uProjInv: { value: new THREE.Matrix4() }, uRadius: { value: .5 }, uProjY: { value: 1 }, uTime: { value: 0 } }) : null;
    this.mAOBlur = q.ssao ? sm(SSAO_BLUR_FS, { tAO: { value: null }, tDepth: { value: null }, uMax: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2() }, uDepthMax: { value: new THREE.Vector2(1, 1) }, uNearFar: { value: new THREE.Vector2() } }) : null;
    this.dirtTex = q.flare ? dirtTexture() : null;
    this.mFinal = sm(FINAL, {
      tColor: { value: null }, tBloom: { value: null }, tDof: { value: null }, tRays: { value: null }, tFlare: { value: null }, tAO: { value: null }, tDirt: { value: this.dirtTex },
      uSceneMax: { value: new THREE.Vector2(1, 1) }, uSceneTexel: { value: new THREE.Vector2() }, uBloomMax: { value: new THREE.Vector2(1, 1) }, uDofMax: { value: new THREE.Vector2(1, 1) },
      uRaysMax: { value: new THREE.Vector2(1, 1) }, uFlareMax: { value: new THREE.Vector2(1, 1) }, uAOMax: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: .3 }, uRays: { value: .5 }, uExposure: { value: 1 }, uVignette: { value: .4 }, uGrain: { value: .03 }, uTime: { value: 0 },
      uSaturation: { value: 1 }, uContrast: { value: .1 }, uFade: { value: 0 }, uCA: { value: 0 }, uLetterbox: { value: 0 }, uDofOn: { value: 1 }, uRaysOn: { value: 1 },
      uFlare: { value: 0 }, uDirt: { value: 0 }, uAO: { value: 0 }, uAOOn: { value: 0 }, uFlareOn: { value: 0 }, uGamma: { value: 1 },
      uShadowTint: { value: new THREE.Color() }, uHighlightTint: { value: new THREE.Color() }, uFadeColor: { value: new THREE.Color() }, uRayColor: { value: new THREE.Color() },
      uLift: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(1, 1) },
    }, D);
    this.mOut = createOutputMaterial();
  }

  // every render target this chain owns (leak checks)
  targets() { return [this.rtScene, this.rtDof, this.rtRayMask, this.rtRays, this.rtLdr, this.rtFlare, this.rtAO, this.rtAO2, ...this.down, ...this.up].filter(Boolean); }
  materials() { return [this.mPre, this.mDown, this.mUp, this.mDof, this.mRayMask, this.mRayBlur, this.mFlare, this.mAO, this.mAOBlur, this.mFinal, this.mOut].filter(Boolean); }
  get fxaaActive() { return !!this.q.fxaa; }

  // maxW/maxH: allocated internal size (tier scale × render scale); outW/outH: canvas size
  setSize(maxW, maxH, outW = maxW, outH = maxH) {
    this.maxW = maxW; this.maxH = maxH; this.outW = outW; this.outH = outH;
    this.rtScene.setSize(maxW, maxH);
    this.rtLdr.setSize(maxW, maxH);
    let lw = sub(maxW, 2), lh = sub(maxH, 2);
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(lw, lh); this.up[i].setSize(lw, lh);
      lw = sub(lw, 2); lh = sub(lh, 2);
    }
    this.rtDof.setSize(sub(maxW, 2), sub(maxH, 2));
    this.rtRayMask.setSize(sub(maxW, 4), sub(maxH, 4));
    this.rtRays.setSize(sub(maxW, 4), sub(maxH, 4));
    if (this.rtFlare) this.rtFlare.setSize(sub(maxW, 4), sub(maxH, 4));
    if (this.rtAO) { this.rtAO.setSize(sub(maxW, 2), sub(maxH, 2)); this.rtAO2.setSize(sub(maxW, 2), sub(maxH, 2)); }
  }
  setScale(s) { this.scale = Math.min(1, Math.max(0.25, s)); }

  // render into the [0,w]×[0,h] corner of a target; returns its uv extent
  _vp(rt, w, h) { rt.viewport.set(0, 0, w, h); rt.scissorTest = false; rt._sub = rt._sub || new THREE.Vector2(); return rt._sub.set(w / rt.width, h / rt.height); }
  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.quad.render(this.r);
    this.stats.passes++;
  }

  render(scene, camera, time) {
    const r = this.r, P = this.params, q = this.q, L = this.limits;
    const iw = Math.max(1, Math.round(this.maxW * this.scale)), ih = Math.max(1, Math.round(this.maxH * this.scale));
    const output = !!q.fxaa || iw !== this.outW || ih !== this.outH;
    this.stats.passes = 0; this.stats.internal[0] = iw; this.stats.internal[1] = ih; this.stats.output[0] = this.outW; this.stats.output[1] = this.outH;
    this.stats.aa = [q.msaa ? `msaa${q.msaa}` : '', q.fxaa ? 'fxaa' : '', output && iw < this.outW ? 'cas' : ''].filter(Boolean).join('+') || 'none';

    // --- scene, then the soft layer with the scene depth bound
    const sceneMax = this._vp(this.rtScene, iw, ih);
    const soft = !!q.soft;
    const mask = camera.layers.mask;
    if (soft) camera.layers.disable(LAYERS.BEAMS); else camera.layers.enable(LAYERS.BEAMS);
    SOFT.uDepth.value = null; SOFT.uSoftOn.value = 0; SOFT.uNearFar.value.set(camera.near, camera.far);
    if (!this.warmed) this.warm();
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    if (soft) {
      SOFT.uDepth.value = this.depthTex; SOFT.uSoftOn.value = 1;
      SOFT.uRes.value.set(this.rtScene.width, this.rtScene.height);
      const sm = r.shadowMap, au = sm.autoUpdate, nu = sm.needsUpdate, ac = r.autoClear, mu = scene.matrixWorldAutoUpdate;
      sm.autoUpdate = false; sm.needsUpdate = false; r.autoClear = false; scene.matrixWorldAutoUpdate = false;
      camera.layers.set(LAYERS.BEAMS);
      r.render(scene, camera);
      sm.autoUpdate = au; sm.needsUpdate = nu; r.autoClear = ac; scene.matrixWorldAutoUpdate = mu;
    }
    camera.layers.mask = mask;
    this.stats.soft = soft;
    const sceneTexel = this._st.set(1 / this.rtScene.width, 1 / this.rtScene.height);

    // --- ambient occlusion (half res)
    let aoMax = null;
    if (this.mAO && P.ao > 0.01) {
      const u = this.mAO.uniforms;
      aoMax = this._vp(this.rtAO, sub(iw, 2), sub(ih, 2));
      u.tDepth.value = this.depthTex; u.uMax.value.copy(sceneMax); u.uTexel.value.copy(sceneTexel);
      u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uProjY.value = camera.projectionMatrix.elements[5]; u.uRadius.value = P.aoRadius; u.uTime.value = time;
      this._pass(this.mAO, this.rtAO);
      const b = this.mAOBlur.uniforms;
      this._vp(this.rtAO2, sub(iw, 2), sub(ih, 2));
      b.tAO.value = this.rtAO.texture; b.tDepth.value = this.depthTex; b.uMax.value.copy(aoMax); b.uDepthMax.value.copy(sceneMax);
      b.uTexel.value.set(1 / this.rtAO.width, 1 / this.rtAO.height); b.uNearFar.value.set(camera.near, camera.far);
      this._pass(this.mAOBlur, this.rtAO2);
    }

    // --- bloom
    const pu = this.mPre.uniforms;
    pu.tColor.value = this.rtScene.texture; pu.uTexel.value.copy(sceneTexel); pu.uMax.value.copy(sceneMax);
    pu.uThreshold.value = P.bloomThreshold; pu.uKnee.value = P.bloomKnee;
    let lw = sub(iw, 2), lh = sub(ih, 2);
    const ext = [];
    ext[0] = this._vp(this.down[0], lw, lh).clone();
    this._pass(this.mPre, this.down[0]);
    for (let i = 1; i < this.levels; i++) {
      const src = this.down[i - 1];
      lw = sub(lw, 2); lh = sub(lh, 2);
      const du = this.mDown.uniforms;
      du.tColor.value = src.texture; du.uTexel.value.set(1 / src.width, 1 / src.height); du.uMax.value.copy(ext[i - 1]);
      ext[i] = this._vp(this.down[i], lw, lh).clone();
      this._pass(this.mDown, this.down[i]);
    }
    let low = this.down[this.levels - 1], lowMax = ext[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      const uu = this.mUp.uniforms;
      uu.tLow.value = low.texture; uu.tHigh.value = this.down[i].texture;
      uu.uTexel.value.set(1 / low.width, 1 / low.height); uu.uLowMax.value.copy(lowMax); uu.uHighMax.value.copy(ext[i]);
      this._vp(this.up[i], Math.round(ext[i].x * this.up[i].width), Math.round(ext[i].y * this.up[i].height));
      this._pass(this.mUp, this.up[i]);
      low = this.up[i]; lowMax = ext[i];
    }

    // --- lens flare from the quarter-res bloom level
    // flares belong to the sun: lamps only ghost faintly while the sun is off screen
    const flareAmt = Math.min(P.flare * (0.35 + 0.65 * P.sunVisible), L.flare);
    const flareOn = !!this.mFlare && flareAmt > 0.01;
    let flareMax = null;
    if (flareOn) {
      const f = this.mFlare.uniforms;
      f.tBloom.value = this.down[1].texture; f.uMax.value.copy(ext[1]); f.uTexel.value.set(1 / this.down[1].width, 1 / this.down[1].height);
      f.uThreshold.value = P.flareThreshold * (q.ldr ? 0.25 : 1); f.uAspect.value = iw / ih;
      flareMax = this._vp(this.rtFlare, sub(iw, 4), sub(ih, 4));
      this._pass(this.mFlare, this.rtFlare);
    }

    // --- depth of field
    const dofOn = q.dof && this.user.dof && (P.nearBlur > 0.1 || P.farBlur > 0.1);
    let dofMax = null;
    if (dofOn) {
      const u = this.mDof.uniforms;
      u.tColor.value = this.rtScene.texture; u.tDepth.value = this.depthTex;
      u.uTexel.value.copy(sceneTexel); u.uMax.value.copy(sceneMax);
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uFocus.value.set(P.focus, P.nearRange, P.farStart, P.farRamp);
      // blur radius is given in half-res pixels of a 1080p frame; convert to internal texel steps
      const k = (ih / 1080) * 2;
      u.uMaxBlur.value.set(P.nearBlur * k, P.farBlur * k);
      dofMax = this._vp(this.rtDof, sub(iw, 2), sub(ih, 2));
      this._pass(this.mDof, this.rtDof);
    }

    // --- god rays
    const raysOn = q.rays && P.sunVisible > 0.01 && P.rays > 0.01;
    let raysMax = null;
    if (raysOn) {
      const m = this.mRayMask.uniforms;
      m.tColor.value = this.rtScene.texture; m.tDepth.value = this.depthTex; m.uMax.value.copy(sceneMax);
      m.uSun.value.copy(P.sunScreen); m.uAspect.value = iw / ih;
      const maskMax = this._vp(this.rtRayMask, sub(iw, 4), sub(ih, 4)).clone();
      this._pass(this.mRayMask, this.rtRayMask);
      const b = this.mRayBlur.uniforms;
      b.tMask.value = this.rtRayMask.texture; b.uSun.value.copy(P.sunScreen); b.uMax.value.copy(maskMax); b.uTexel.value.set(1 / this.rtRayMask.width, 1 / this.rtRayMask.height);
      b.uDensity.value = P.rayDensity; b.uDecay.value = P.rayDecay;
      raysMax = this._vp(this.rtRays, sub(iw, 4), sub(ih, 4));
      this._pass(this.mRayBlur, this.rtRays);
    }

    // --- final grade
    const f = this.mFinal.uniforms;
    f.tColor.value = this.rtScene.texture; f.uSceneMax.value.copy(sceneMax); f.uSceneTexel.value.copy(sceneTexel);
    f.tBloom.value = this.up[0].texture; f.uBloomMax.value.copy(ext[0]);
    f.tDof.value = this.rtDof.texture; if (dofMax) f.uDofMax.value.copy(dofMax);
    f.tRays.value = this.rtRays.texture; if (raysMax) f.uRaysMax.value.copy(raysMax);
    f.tFlare.value = this.rtFlare ? this.rtFlare.texture : null; if (flareMax) f.uFlareMax.value.copy(flareMax);
    f.tAO.value = this.rtAO2 ? this.rtAO2.texture : null; if (aoMax) f.uAOMax.value.copy(aoMax);
    f.uDofOn.value = dofOn ? 1 : 0; f.uRaysOn.value = raysOn ? 1 : 0; f.uFlareOn.value = flareOn ? 1 : 0; f.uAOOn.value = aoMax ? 1 : 0;
    f.uBloom.value = Math.min(P.bloom, L.bloom); f.uRays.value = Math.min(P.rays, L.rays) * P.sunVisible; f.uExposure.value = P.exposure * P.userExposure;
    f.uFlare.value = flareAmt; f.uDirt.value = this.dirtTex ? Math.min(Math.max(P.dirt, 0.3 * THREE.MathUtils.smoothstep(P.rays * P.sunVisible, 0.7, 1.6)), L.dirt) : 0; f.uAO.value = P.ao; f.uGamma.value = P.userGamma;
    f.uVignette.value = P.vignette; f.uTime.value = time;
    f.uGrain.value = output ? 0 : P.grain * P.grainScale;
    f.uSaturation.value = P.saturation; f.uContrast.value = P.contrast; f.uFade.value = P.fade; f.uCA.value = P.ca;
    f.uLetterbox.value = P.letterbox;
    f.uShadowTint.value.copy(P.shadowTint); f.uHighlightTint.value.copy(P.highlightTint);
    f.uFadeColor.value.copy(P.fadeColor); f.uRayColor.value.copy(P.rayColor); f.uLift.value.copy(P.lift);
    if (output) {
      f.uRes.value.set(iw, ih);
      this._vp(this.rtLdr, iw, ih);
      this._pass(this.mFinal, this.rtLdr);
      // --- output: FXAA + CAS upscale + grain at canvas resolution
      const o = this.mOut.uniforms, ratio = iw / this.outW;
      o.tColor.value = this.rtLdr.texture; o.uMax.value.set(iw / this.rtLdr.width, ih / this.rtLdr.height); o.uTexel.value.set(1 / this.rtLdr.width, 1 / this.rtLdr.height);
      o.uFxaa.value = q.fxaa ? 1 : 0; o.uSharp.value = ratio < 0.999 ? Math.min(0.8, 0.3 + (1 - ratio) * 1.5) : 0;
      o.uGrain.value = P.grain * P.grainScale; o.uTime.value = time;
      r.setViewport(0, 0, this.outW, this.outH);
      this._pass(this.mOut, null);
    } else {
      f.uRes.value.set(this.outW, this.outH);
      r.setViewport(0, 0, this.outW, this.outH);
      this._pass(this.mFinal, null);
    }
  }

  dispose() {
    for (const t of this.targets()) t.dispose();
    this.depthTex.dispose();
    for (const m of this.materials()) m.dispose();
    if (this.dirtTex) this.dirtTex.dispose();
    // the quad's geometry is three's shared full-screen triangle: never dispose it
    if (SOFT.uDepth.value === this.depthTex) { SOFT.uDepth.value = null; SOFT.uSoftOn.value = 0; }
  }
}
