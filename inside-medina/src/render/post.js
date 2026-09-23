import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

function sm(frag, uniforms, defines = {}) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false });
}

const PREFILTER = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
vec3 s(vec2 o){ return min(texture2D(tColor, vUv + o * uTexel).rgb, vec3(40.)); }
void main(){
  vec3 c = (s(vec2(-1.,-1.)) + s(vec2(1.,-1.)) + s(vec2(-1.,1.)) + s(vec2(1.,1.))) * .25;
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0., 2. * uKnee); soft = soft * soft / (4. * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(c * contrib, 1.);
}`;

const DOWN = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tColor, vUv + o * uTexel).rgb; }
void main(){
  vec3 a = s(vec2(-2., 2.)), b = s(vec2(0., 2.)), c = s(vec2(2., 2.));
  vec3 d = s(vec2(-2., 0.)), e = s(vec2(0., 0.)), f = s(vec2(2., 0.));
  vec3 g = s(vec2(-2., -2.)), h = s(vec2(0., -2.)), i = s(vec2(2., -2.));
  vec3 j = s(vec2(-1., 1.)), k = s(vec2(1., 1.)), l = s(vec2(-1., -1.)), m = s(vec2(1., -1.));
  vec3 o = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  gl_FragColor = vec4(o, 1.);
}`;

const UP = /* glsl */ `
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform float uRadius; varying vec2 vUv;
vec3 s(vec2 o){ return texture2D(tLow, vUv + o * uTexel * uRadius).rgb; }
void main(){
  vec3 o = s(vec2(0.)) * 4. + (s(vec2(-1., 0.)) + s(vec2(1., 0.)) + s(vec2(0., 1.)) + s(vec2(0., -1.))) * 2.
         + s(vec2(-1., -1.)) + s(vec2(1., -1.)) + s(vec2(-1., 1.)) + s(vec2(1., 1.));
  gl_FragColor = vec4(o / 16. + texture2D(tHigh, vUv).rgb, 1.);
}`;

const DOF = /* glsl */ `
#include <packing>
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uTexel; uniform float uNear, uFar;
uniform vec4 uFocus; // focusDist, nearRange, farStart, farRamp
uniform vec2 uMaxBlur; // near max px, far max px (in half-res px)
varying vec2 vUv;
float viewDist(vec2 uv){ float d = texture2D(tDepth, uv).x; return -perspectiveDepthToViewZ(d, uNear, uFar); }
float coc(float z){
  float nearC = clamp((uFocus.x - uFocus.y - z) / max(uFocus.y, .01), 0., 1.) * uMaxBlur.x;
  float farC = clamp((z - uFocus.x - uFocus.z) / uFocus.w, 0., 1.) * uMaxBlur.y;
  return max(nearC, farC);
}
const float GA = 2.39996323;
void main(){
  float cz = viewDist(vUv); float cs = coc(cz);
  vec3 col = texture2D(tColor, vUv).rgb; float tot = 1.;
  float nearCov = 0.;
  float R = max(uMaxBlur.x, uMaxBlur.y);
  for (int i = 0; i < NTAPS; i++){
    float fi = float(i) + .5;
    float r = sqrt(fi / float(NTAPS)) * R;
    float a = fi * GA;
    vec2 tc = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    vec3 sc = texture2D(tColor, tc).rgb;
    float sz = viewDist(tc); float ss = coc(sz);
    if (sz > cz) ss = min(ss, cs * 2.);
    float m = smoothstep(r - .5, r + .5, ss);
    col += mix(col / tot, sc, m); tot += 1.;
    if (sz < cz - .5) nearCov += m;
  }
  col /= tot;
  float blend = max(smoothstep(.4, 1.5, cs), clamp(nearCov / float(NTAPS) * 3., 0., 1.));
  gl_FragColor = vec4(col, blend);
}`;

const RAYMASK = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uAspect; varying vec2 vUv;
void main(){
  float d = texture2D(tDepth, vUv).x;
  vec3 c = texture2D(tColor, vUv).rgb;
  float sky = step(.99999, d);
  float l = dot(c, vec3(.2126,.7152,.0722));
  vec2 dv = (vUv - uSun) * vec2(uAspect, 1.);
  float prox = exp(-dot(dv, dv) * 1.5);
  float m = sky * max(min(l, 8.) - 1.05, 0.) * (.15 + prox * 1.6) + max(l - 3.0, 0.) * .08;
  gl_FragColor = vec4(vec3(m), 1.);
}`;

const RAYBLUR = /* glsl */ `
uniform sampler2D tMask; uniform vec2 uSun; uniform float uDensity, uDecay; varying vec2 vUv;
void main(){
  vec2 delta = (vUv - uSun) * uDensity / float(RSAMPLES);
  vec2 tc = vUv; float illum = 1.; float acc = 0.;
  for (int i = 0; i < RSAMPLES; i++){
    tc -= delta;
    acc += texture2D(tMask, tc).r * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(vec3(acc / float(RSAMPLES)), 1.);
}`;

const FINAL = /* glsl */ `
uniform sampler2D tColor, tBloom, tDof, tRays;
uniform float uBloom, uRays, uExposure, uVignette, uGrain, uTime, uSaturation, uContrast, uFade, uCA, uLetterbox, uDofOn, uRaysOn;
uniform vec3 uShadowTint, uHighlightTint, uFadeColor, uRayColor, uLift;
uniform vec2 uRes;
varying vec2 vUv;
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
void main(){
  vec2 uv = vUv;
  vec2 cc = uv - .5;
  vec3 col;
  if (uCA > 0.) {
    vec2 off = cc * dot(cc, cc) * uCA;
    col = vec3(texture2D(tColor, uv - off).r, texture2D(tColor, uv).g, texture2D(tColor, uv + off).b);
  } else col = texture2D(tColor, uv).rgb;
  if (uDofOn > .5) { vec4 d = texture2D(tDof, uv); col = mix(col, d.rgb, d.a); }
  col += texture2D(tBloom, uv).rgb * uBloom;
  if (uRaysOn > .5) col += texture2D(tRays, uv).r * uRayColor * uRays;
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
  float vig = smoothstep(.95, .25, length(cc * vec2(uRes.x / uRes.y, 1.) * .9));
  p *= mix(1., vig, uVignette);
  p = mix(p, uFadeColor, uFade);
  float bars = step(abs(cc.y), .5 - uLetterbox);
  p *= bars;
  float n = h12(gl_FragCoord.xy + fract(uTime) * 917.) - .5;
  float n2 = h12(gl_FragCoord.xy * 1.37 + fract(uTime * 1.3) * 331.) - .5;
  p += (n + n2) * uGrain + (n) / 255.;
  gl_FragColor = vec4(p, 1.);
}`;

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
    };
    this._build();
  }

  _build() {
    const q = this.q;
    const ht = THREE.HalfFloatType;
    this.depthTex = new THREE.DepthTexture(1, 1);
    this.depthTex.type = THREE.UnsignedIntType;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: ht, samples: q.msaa, depthTexture: this.depthTex, depthBuffer: true });
    this.rtScene.texture.minFilter = THREE.LinearFilter; this.rtScene.texture.generateMipmaps = false;
    const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: ht, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.levels = 6;
    this.down = []; this.up = [];
    for (let i = 0; i < this.levels; i++) { this.down.push(mk()); this.up.push(mk()); }
    this.rtDof = mk();
    this.rtRayMask = mk(); this.rtRays = mk();
    this.mPre = sm(PREFILTER, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1 }, uKnee: { value: .5 } });
    this.mDown = sm(DOWN, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = sm(UP, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.mDof = sm(DOF, {
      tColor: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: .1 }, uFar: { value: 1000 },
      uFocus: { value: new THREE.Vector4() }, uMaxBlur: { value: new THREE.Vector2() },
    }, { NTAPS: q.dofTaps || 36 });
    this.mRayMask = sm(RAYMASK, { tColor: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.mRayBlur = sm(RAYBLUR, { tMask: { value: null }, uSun: { value: new THREE.Vector2() }, uDensity: { value: .9 }, uDecay: { value: .96 } }, { RSAMPLES: 48 });
    this.mFinal = sm(FINAL, {
      tColor: { value: null }, tBloom: { value: null }, tDof: { value: null }, tRays: { value: null },
      uBloom: { value: .3 }, uRays: { value: .5 }, uExposure: { value: 1 }, uVignette: { value: .4 }, uGrain: { value: .03 }, uTime: { value: 0 },
      uSaturation: { value: 1 }, uContrast: { value: .1 }, uFade: { value: 0 }, uCA: { value: 0 }, uLetterbox: { value: 0 }, uDofOn: { value: 1 }, uRaysOn: { value: 1 },
      uShadowTint: { value: new THREE.Color() }, uHighlightTint: { value: new THREE.Color() }, uFadeColor: { value: new THREE.Color() }, uRayColor: { value: new THREE.Color() },
      uLift: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(1, 1) },
    });
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.rtScene.setSize(w, h);
    let lw = Math.max(1, w >> 1), lh = Math.max(1, h >> 1);
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(lw, lh); this.up[i].setSize(lw, lh);
      lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
    }
    this.rtDof.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.rtRayMask.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.rtRays.setSize(Math.max(1, w >> 2), Math.max(1, h >> 2));
    this.mFinal.uniforms.uRes.value.set(w, h);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.quad.render(this.r);
  }

  render(scene, camera, time) {
    const r = this.r, P = this.params, q = this.q;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);

    // --- bloom
    this.mPre.uniforms.tColor.value = this.rtScene.texture;
    this.mPre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this.mPre.uniforms.uThreshold.value = P.bloomThreshold;
    this.mPre.uniforms.uKnee.value = P.bloomKnee;
    this._pass(this.mPre, this.down[0]);
    for (let i = 1; i < this.levels; i++) {
      const src = this.down[i - 1];
      this.mDown.uniforms.tColor.value = src.texture;
      this.mDown.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      this._pass(this.mDown, this.down[i]);
    }
    let low = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      this.mUp.uniforms.tLow.value = low.texture;
      this.mUp.uniforms.tHigh.value = this.down[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
      this._pass(this.mUp, this.up[i]);
      low = this.up[i];
    }

    // --- depth of field
    const dofOn = q.dof && (P.nearBlur > 0.1 || P.farBlur > 0.1);
    if (dofOn) {
      const u = this.mDof.uniforms;
      u.tColor.value = this.rtScene.texture; u.tDepth.value = this.depthTex;
      u.uTexel.value.set(1 / this.w, 1 / this.h);
      u.uNear.value = camera.near; u.uFar.value = camera.far;
      u.uFocus.value.set(P.focus, P.nearRange, P.farStart, P.farRamp);
      // blur radius is given in half-res pixels; convert to full-res texel steps (x2)
      const k = (this.h / 1080) * 2;
      u.uMaxBlur.value.set(P.nearBlur * k, P.farBlur * k);
      this._pass(this.mDof, this.rtDof);
    }

    // --- god rays
    const raysOn = q.rays && P.sunVisible > 0.01 && P.rays > 0.01;
    if (raysOn) {
      const m = this.mRayMask.uniforms;
      m.tColor.value = this.rtScene.texture; m.tDepth.value = this.depthTex;
      m.uSun.value.copy(P.sunScreen); m.uAspect.value = this.w / this.h;
      this._pass(this.mRayMask, this.rtRayMask);
      const b = this.mRayBlur.uniforms;
      b.tMask.value = this.rtRayMask.texture; b.uSun.value.copy(P.sunScreen);
      b.uDensity.value = P.rayDensity; b.uDecay.value = P.rayDecay;
      this._pass(this.mRayBlur, this.rtRays);
    }

    // --- final
    const f = this.mFinal.uniforms;
    f.tColor.value = this.rtScene.texture;
    f.tBloom.value = this.up[0].texture;
    f.tDof.value = this.rtDof.texture;
    f.tRays.value = this.rtRays.texture;
    f.uDofOn.value = dofOn ? 1 : 0;
    f.uRaysOn.value = raysOn ? 1 : 0;
    f.uBloom.value = P.bloom; f.uRays.value = P.rays * P.sunVisible; f.uExposure.value = P.exposure;
    f.uVignette.value = P.vignette; f.uGrain.value = P.grain; f.uTime.value = time;
    f.uSaturation.value = P.saturation; f.uContrast.value = P.contrast; f.uFade.value = P.fade; f.uCA.value = P.ca;
    f.uLetterbox.value = P.letterbox;
    f.uShadowTint.value.copy(P.shadowTint); f.uHighlightTint.value.copy(P.highlightTint);
    f.uFadeColor.value.copy(P.fadeColor); f.uRayColor.value.copy(P.rayColor); f.uLift.value.copy(P.lift);
    this._pass(this.mFinal, null);
  }

  dispose() {
    [this.rtScene, this.rtDof, this.rtRayMask, this.rtRays, ...this.down, ...this.up].forEach((t) => t.dispose());
  }
}
