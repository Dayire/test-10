import * as THREE from 'three';
import { LAYERS, SOFT_GLSL, softUniforms } from '../../render/layers.js';
import { MIRROR, NONE, TARGET } from './trace.js';
import { lightTextures } from '../../assets/lightprops.js';
import { G } from '../../render/atmosphere.js';

// How Sunwork's light looks (FULL_GAME §6.5): every traced segment is a camera-facing ribbon (one draw for all
// beams) with a hot core, a dusty haze and drifting motes, never thinner than a couple of pixels so a phone
// still reads it; where a beam ends there is a sunspot glow, where it reflects a star glint (one instanced draw
// for both), and the brightest spot is a priority source of the light pool, so a real point light warms the
// wall. All of it lives on LAYERS.BEAMS and fades into geometry through the soft pass (hard additive on low).

const MAXQ = 96, MAXG = 64;
const BEAM_VS = /* glsl */ `
attribute vec3 aA; attribute vec3 aB; attribute vec4 aCol; attribute vec4 aP;
uniform float uMinPx; uniform float uViewH;
varying vec4 vCol; varying vec2 vQ; varying float vLen; varying float vS; varying vec3 vP;
void main(){
  float side = position.x, end = position.y;
  vec3 ax = aB - aA; float L = length(ax); ax /= max(L, 1e-5);
  vec3 P = mix(aA, aB, end);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 sd = cross(ax, toCam); float sl = length(sd); sd = sl > 1e-4 ? sd / sl : vec3(0., 1., 0.);
  vec4 vp = viewMatrix * vec4(P, 1.);
  float px = 2. * max(-vp.z, .1) / (projectionMatrix[1][1] * uViewH);
  float w = max(aP.x, uMinPx * px);
  P += sd * side * w;
  vCol = aCol; vQ = vec2(side, end); vLen = L; vS = end * L + aP.w; vP = vec3(aP.y, aP.z, w / max(aP.x, 1e-4));
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.);
}`;
const BEAM_FS = /* glsl */ `
uniform float uTime; uniform float uHC;
varying vec4 vCol; varying vec2 vQ; varying float vLen; varying float vS; varying vec3 vP;
${SOFT_GLSL}
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  float x = abs(vQ.x);
  // a widened (pixel-floored) beam keeps its energy: a thin far beam is a crisp line, not a fat glow
  float k = 1. / max(vP.z, 1.);
  float core = exp(-x * x * 30.) * (1. + uHC * .8);
  float halo = exp(-x * x * 4.5) * .42 * k;
  float s = vS;
  float dust = .7 + .55 * n3(vec3(s * 2.1 - uTime * .32, x * 2.5, uTime * .18));
  float motes = smoothstep(.78, .98, n3(vec3(s * 7. - uTime * .55, x * 5., uTime * .45))) * 1.3;
  float t = vQ.y * vLen;
  float ends = smoothstep(0., max(vP.x, 1e-3), t);
  if (vP.y > 0.) ends *= 1. - smoothstep(vLen - vP.y, vLen, t);
  float a = (core * (.85 + .3 * dust) + halo * (dust + motes)) * ends * vCol.a;
  a *= softFade(.16) * softNear(1.2);
  gl_FragColor = vec4(vCol.rgb * a, 1.);
  #include <fog_fragment>
}`;
const GLOW_VS = /* glsl */ `
attribute vec3 iPos; attribute vec4 iCol; attribute vec4 iP;
varying vec2 vUv; varying vec4 vCol; varying float vKind;
void main(){
  vec3 P = iPos + normalize(cameraPosition - iPos) * iP.z;
  vec4 mv = viewMatrix * vec4(P, 1.);
  float c = cos(iP.w), s = sin(iP.w);
  vec2 q = position.xy * iP.x;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vUv = position.xy + .5; vCol = iCol; vKind = iP.y;
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FS = /* glsl */ `
uniform sampler2D uGlint;
varying vec2 vUv; varying vec4 vCol; varying float vKind;
${SOFT_GLSL}
void main(){
  vec2 q = vUv * 2. - 1.; float r2 = dot(q, q);
  float a;
  if (vKind < .5) a = exp(-r2 * 6.) * .75 + exp(-r2 * 40.) * .9;
  else a = pow(texture2D(uGlint, vUv).a, 1.4) * 1.8; // the canvas keeps its strength in alpha (r is 1 wherever a > 0)
  a *= softFade(.1);
  gl_FragColor = vec4(vCol.rgb * a * vCol.a, 1.);
  #include <fog_fragment>
}`;

export class BeamRenderer {
  constructor(game, sys) {
    this.game = game; this.sys = sys;
    // ribbons: four corners per segment, the segment's ends and look in per-vertex attributes
    const g = this.geo = new THREE.BufferGeometry();
    const corner = new Float32Array(MAXQ * 4 * 3), idx = new Uint16Array(MAXQ * 6);
    for (let i = 0; i < MAXQ; i++) {
      corner.set([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], i * 12);
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    }
    g.setAttribute('position', new THREE.BufferAttribute(corner, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    for (const [k, n] of [['aA', 3], ['aB', 3], ['aCol', 4], ['aP', 4]]) { const a = new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); }
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: softUniforms({ uTime: G.uTime, uMinPx: { value: 2.2 }, uViewH: { value: 720 }, uHC: { value: 0 } }),
    });
    const m = this.mesh = new THREE.Mesh(g, this.mat);
    m.frustumCulled = false; m.renderOrder = 6; m.name = 'sunwork:beams';
    m.layers.set(LAYERS.BEAMS);
    game.add(m);
    // glows: instanced billboards (sunspots, glints)
    const q = new THREE.InstancedBufferGeometry();
    q.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    q.setIndex([0, 1, 2, 2, 1, 3]);
    for (const [k, n] of [['iPos', 3], ['iCol', 4], ['iP', 4]]) { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAXG * n), n); a.setUsage(THREE.DynamicDrawUsage); q.setAttribute(k, a); }
    q.instanceCount = 0;
    q.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.qgeo = q;
    this.gmat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: softUniforms({ uGlint: { value: lightTextures().glint } }),
    });
    const gm = this.glows = new THREE.Mesh(q, this.gmat);
    gm.frustumCulled = false; gm.renderOrder = 7; gm.name = 'sunwork:glows';
    gm.layers.set(LAYERS.BEAMS);
    game.add(gm);
    // the brightest spot lights the wall around it
    this.pool = game.lightPool?.addDynamic(this, 3, { intensity: 0, color: 0xffd9a0, distance: 6, decay: 1.4 }) || null;
    this.flick = 0;
    this._c = new THREE.Color();
  }

  quad(i, ax, ay, az, bx, by, bz, c, a, w, fadeIn, fadeOut, s0) {
    const A = this.geo.attributes;
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      A.aA.setXYZ(v, ax, ay, az); A.aB.setXYZ(v, bx, by, bz);
      A.aCol.setXYZW(v, c.r, c.g, c.b, a);
      A.aP.setXYZW(v, w, fadeIn, fadeOut, s0);
    }
  }
  glow(i, x, y, z, c, a, size, kind, lift, rot = 0) {
    const A = this.qgeo.attributes;
    A.iPos.setXYZ(i, x, y, z); A.iCol.setXYZW(i, c.r, c.g, c.b, a); A.iP.setXYZW(i, size, kind, lift, rot);
  }

  update(dt) {
    const g = this.game, sys = this.sys;
    const rs = g.world.rs;
    this.mat.uniforms.uViewH.value = Math.max(1, rs?.h || rs?.renderer?.domElement?.height || 720);
    this.mat.uniforms.uHC.value = g.settings?.highContrast ? 1 : 0;
    const reduce = g.settings?.reduceFlashing ? 0.55 : 1;
    let nq = 0, ng = 0, best = null, bestI = 0, bestCol = null;
    const t = g.time;
    for (const [src, R] of sys.results) {
      if (!R.on || !R.n) continue;
      const col = src.color(g), glow = src.glow ?? 1;
      const lamp = src.kind === 'lamp';
      for (let i = 0; i < R.n && nq < MAXQ; i++) {
        const h = R.hits[i];
        const ax = R.pts[i * 2], ay = R.pts[i * 2 + 1], bx = R.pts[i * 2 + 2], by = R.pts[i * 2 + 3];
        if (!(i === 0 && src.hideFirst)) {
          // a beam that ends in a lamp behind the plane is drawn into it (§6.1)
          const bz = h.kind === TARGET && h.obj.z !== undefined && h.obj.kind === 'eye' ? h.obj.z : 0;
          const len = Math.hypot(bx - ax, by - ay);
          const fadeIn = i === 0 ? Math.min(0.6, len * 0.3) : 0.04;
          const fadeOut = h.kind === NONE ? Math.min(len * 0.7, 25) : 0;
          const bright = (lamp ? 1.6 : 2.2) * glow * Math.min(1.6, h.I);
          this.quad(nq++, ax, ay, 0, bx, by, bz, col, bright, src.width * 0.5, fadeIn, fadeOut, i * 3.7 + (src.x || 0));
        }
        if (h.kind === NONE || ng >= MAXG) continue;
        const flick = 0.9 + 0.1 * Math.sin(t * 13 + i * 2.1 + bx);
        if (h.kind === MIRROR) {
          // a star glint on the tray, above the bloom threshold
          this.glow(ng++, h.x, h.y, 0, col, 1.7 * Math.min(1.5, h.I) * flick * reduce, (0.7 + 0.3 * h.I) * (lamp ? 0.6 : 1), 1, 0.3, t * 0.15 + i);
        } else {
          const lock = h.kind === TARGET && h.obj.shape === 'circle';
          const px = lock ? h.obj.x : h.x + h.nx * 0.03, py = lock ? h.obj.y : h.y + h.ny * 0.03;
          const pz = lock && h.obj.z !== undefined ? h.obj.z : 0;
          const sz = lock ? (h.obj.r || 0.35) * 3.4 : (lamp ? 0.22 : 0.85 + 0.45 * h.I);
          this.glow(ng++, px, py, pz, col, (lamp ? 0.9 : 1.5) * Math.min(1.6, h.I) * flick * reduce, sz, 0, lock ? 0.12 : 0.06);
          if (!lamp && h.I > bestI) { bestI = h.I; best = h; bestCol = col; }
        }
      }
    }
    this.geo.setDrawRange(0, nq * 6);
    for (const k of ['aA', 'aB', 'aCol', 'aP']) { const a = this.geo.attributes[k]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, nq * 4 * a.itemSize); }
    this.qgeo.instanceCount = ng;
    for (const k of ['iPos', 'iCol', 'iP']) { const a = this.qgeo.attributes[k]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, ng * a.itemSize); }
    const P = this.pool;
    if (P) {
      if (best) {
        P.enabled = true;
        P.pos.set(best.x + best.nx * 0.35, best.y + best.ny * 0.35 + 0.05, 0.35);
        this.flick += dt;
        P.intensity = (2.4 + 1.6 * Math.min(1.5, bestI)) * (0.94 + 0.06 * Math.sin(this.flick * 11));
        if (P.color) P.color.copy(bestCol).lerp(this._c.setRGB(1, 0.95, 0.85), 0.2);
      } else P.enabled = false;
    }
  }

  dispose() {
    if (this.pool) this.game.lightPool?.remove(this.pool);
    this.pool = null;
  }
}
