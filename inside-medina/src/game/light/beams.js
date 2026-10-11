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
attribute vec3 aA; attribute vec3 aB; attribute vec4 aCol; attribute vec4 aP; attribute vec2 aS;
uniform float uMinPx; uniform float uViewH;
varying vec4 vCol; varying vec2 vQ; varying float vLen; varying float vS; varying vec3 vP; varying float vSoft;
void main(){
  float side = position.x, end = position.y;
  vec3 ax = aB - aA; float L = length(ax); ax /= max(L, 1e-5);
  vec3 P = mix(aA, aB, end);
  vec3 toCam = normalize(cameraPosition - P);
  vec3 sd = cross(ax, toCam); float sl = length(sd); sd = sl > 1e-4 ? sd / sl : vec3(0., 1., 0.);
  vec4 vp = viewMatrix * vec4(P, 1.);
  float px = 2. * max(-vp.z, .1) / (projectionMatrix[1][1] * uViewH);
  float w = max(aP.x, uMinPx * aS.y * px);
  P += sd * side * w;
  vCol = aCol; vQ = vec2(side, end); vLen = L; vS = end * L + aP.w; vP = vec3(aP.y, aP.z, w / max(aP.x, 1e-4)); vSoft = aS.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.);
}`;
const BEAM_FS = /* glsl */ `
uniform float uTime; uniform float uHC;
varying vec4 vCol; varying vec2 vQ; varying float vLen; varying float vS; varying vec3 vP; varying float vSoft;
${SOFT_GLSL}
float h3(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  float x = abs(vQ.x);
  // a widened (pixel-floored) beam keeps its energy: a thin far beam is a crisp line, not a fat glow
  // soft (moonlight): a faint core in a wide pale haze, thick with dust and motes
  float k = 1. / max(vP.z, 1.), so = vSoft;
  float core = exp(-x * x * mix(30., 6., so)) * (1. + uHC * .8) * (1. - .78 * so);
  float halo = exp(-x * x * mix(4.5, 1.4, so)) * (.42 + .2 * so) * k;
  float s = vS;
  // (the noise reads the signed side, so the dust is never mirrored about the beam's axis)
  float dust = .7 + .55 * n3(vec3(s * mix(2.1, 1.1, so) - uTime * .32, vQ.x * mix(2.5, 1.2, so) + 7., uTime * .18));
  float motes = smoothstep(.78, .98, n3(vec3(s * mix(7., 4., so) - uTime * .55, vQ.x * 5. + 7., uTime * .45))) * (1.3 - .5 * so);
  float t = vQ.y * vLen;
  float ends = smoothstep(0., max(vP.x, 1e-3), t);
  if (vP.y > 0.) ends *= 1. - smoothstep(vLen - vP.y, vLen, t);
  float a = (core * (.85 + .3 * dust) + halo * (dust + motes)) * ends * vCol.a;
  a *= mix(1., 1. - smoothstep(.45, 1., x), so); // a soft beam's haze dies out before the ribbon's edge
  // high contrast: a crisp outline along both edges of the ribbon
  a += uHC * smoothstep(.6, .76, x) * (1. - smoothstep(.86, .98, x)) * ends * min(vCol.a, 1.4) * .8;
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
  else if (vKind > 1.5) { float d = sqrt(r2) - .6; a = exp(-d * d * 90.) * .85 + exp(-r2 * 2.2) * .16; } // a lock's halo: a ring just outside the rim
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
    for (const [k, n] of [['aA', 3], ['aB', 3], ['aCol', 4], ['aP', 4], ['aS', 2]]) { const a = new THREE.BufferAttribute(new Float32Array(MAXQ * 4 * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); }
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

  // soft: 0 a sunbeam's hot core, 1 moonlight's haze; px: the pixel floor's multiplier
  quad(i, ax, ay, az, bx, by, bz, c, a, w, fadeIn, fadeOut, s0, soft = 0, px = 1) {
    const A = this.geo.attributes;
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      A.aA.setXYZ(v, ax, ay, az); A.aB.setXYZ(v, bx, by, bz);
      A.aCol.setXYZW(v, c.r, c.g, c.b, a);
      A.aP.setXYZW(v, w, fadeIn, fadeOut, s0);
      A.aS.setXY(v, soft, px);
    }
  }
  glow(i, x, y, z, c, a, size, kind, lift, rot = 0) {
    const A = this.qgeo.attributes;
    A.iPos.setXYZ(i, x, y, z); A.iCol.setXYZW(i, c.r, c.g, c.b, a); A.iP.setXYZW(i, size, kind, lift, rot);
  }

  update(dt) {
    const g = this.game, sys = this.sys;
    const rs = g.world.rs;
    // the pixel floor holds in render pixels and in CSS pixels, whichever is wider (a phone renders at 2× or more)
    const cssH = rs?.cssH || (typeof window !== 'undefined' ? window.innerHeight : 0) || 720;
    this.mat.uniforms.uViewH.value = Math.max(1, Math.min(rs?.h || rs?.renderer?.domElement?.height || 720, cssH));
    // tripwires are threads: on a small screen they keep 3 px and glow a little more
    const small = cssH < 900, wirePx = small ? 3 / 2.2 : 1, wireGlow = small ? 1.3 : 1;
    const hc = g.settings?.highContrast ? 1 : 0;
    this.mat.uniforms.uHC.value = hc;
    this.mat.uniforms.uMinPx.value = hc ? 3.4 : 2.2; // room for the outline on thin beams
    const reduce = g.settings?.reduceFlashing ? 0.55 : 1;
    let nq = 0, ng = 0, best = null, bestI = 0, bestD = 0, bestCol = null;
    const t = g.time;
    // the pool light goes to the brightest spot in view (nearest the view's focus among equals); a searchlight's own
    // first leg is its cone, which already has a rig spot, and a tripwire's beam is a thread, so neither competes
    const cr = g.camRig, lk = cr ? (cr.override ? cr.curLook : cr.look) : null;
    const fx = lk ? lk.x : g.player.x, fy = lk ? lk.y : g.player.y + 2;
    const rw = (g.viewHalfW || 12) + 1.5, rh = (g.viewHalfW || 12) / Math.max(0.3, g.camera?.aspect || 1.78) + 1.5;
    for (const [src, R] of sys.results) {
      if (!R.on || !R.n) continue;
      const col = src.color(g), glow = src.glow ?? 1;
      const lamp = src.kind === 'lamp', soft = src.soft ?? (src.kind === 'moon' ? 1 : 0);
      for (let i = 0; i < R.n && nq < MAXQ; i++) {
        const h = R.hits[i];
        const ax = R.pts[i * 2], ay = R.pts[i * 2 + 1], bx = R.pts[i * 2 + 2], by = R.pts[i * 2 + 3];
        const drawn = !(i === 0 && src.hideFirst);
        if (drawn) {
          // a beam that ends in a lamp behind the plane is drawn into it (§6.1)
          const bz = h.kind === TARGET && h.obj.z !== undefined && h.obj.kind === 'eye' ? h.obj.z : 0;
          const len = Math.hypot(bx - ax, by - ay);
          const fadeIn = i === 0 ? Math.min(0.6, len * 0.3) : 0.04;
          const fadeOut = h.kind === NONE ? Math.min(len * 0.7, 25) : 0;
          const bright = (lamp ? 1.6 * wireGlow : 2.2) * glow * Math.min(1.6, h.I);
          this.quad(nq++, ax, ay, 0, bx, by, bz, col, bright, src.width * 0.5, fadeIn, fadeOut, i * 3.7 + (src.x || 0), soft, lamp ? wirePx : 1);
        }
        if (h.kind === NONE || ng >= MAXG) continue;
        // a searchlight's cone leg ends in its own rig spot's pool (or in the air, blind): no sunspot of its own
        // there (a tray still glints, a lock still shows its halo)
        if (!drawn && h.kind !== MIRROR && h.kind !== TARGET) continue;
        const flick = 0.9 + 0.1 * Math.sin(t * 13 + i * 2.1 + bx);
        if (h.kind === MIRROR) {
          // a star glint on the tray, above the bloom threshold
          this.glow(ng++, h.x, h.y, 0, col, 1.7 * Math.min(1.5, h.I) * flick * reduce, (0.7 + 0.3 * h.I) * (lamp ? 0.6 : 1), 1, 0.3, t * 0.15 + i);
        } else {
          const lock = h.kind === TARGET && h.obj.shape === 'circle' && h.obj.kind !== 'eye' && h.obj.kind !== 'sensor';
          if (lock) {
            // light on a lock is a halo around its rim, behind the petals (they stay silhouetted against it)
            const o = h.obj, k = Math.min(1.2, h.I / (o.need || 1));
            this.glow(ng++, o.x, o.y, o.z ?? 0, col, 1.1 * k * flick * reduce, (o.r || 0.35) * 4.2, 2, -0.04);
          } else {
            const px = h.x + h.nx * 0.03, py = h.y + h.ny * 0.03;
            const pz = h.kind === TARGET && h.obj.z !== undefined ? h.obj.z : 0;
            const sz = lamp ? 0.22 : (0.85 + 0.45 * h.I) * (1 + 0.5 * soft);
            this.glow(ng++, px, py, pz, col, (lamp ? 0.9 : 1.5 - 0.7 * soft) * Math.min(1.6, h.I) * flick * reduce, sz, 0, 0.06);
          }
          if (drawn && !lamp && !(h.kind === TARGET && h.obj.kind === 'eye') && Math.abs(h.x - fx) <= rw && Math.abs(h.y - fy) <= rh) {
            const d = Math.hypot(h.x - fx, h.y - fy), I = Math.min(1.6, h.I);
            if (!best || I > bestI + 0.02 || (I > bestI - 0.02 && d < bestD)) { bestI = I; bestD = d; best = h; bestCol = col; }
          }
        }
      }
    }
    this.geo.setDrawRange(0, nq * 6);
    for (const k of ['aA', 'aB', 'aCol', 'aP', 'aS']) { const a = this.geo.attributes[k]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, nq * 4 * a.itemSize); }
    this.qgeo.instanceCount = ng;
    for (const k of ['iPos', 'iCol', 'iP']) { const a = this.qgeo.attributes[k]; a.needsUpdate = true; a.clearUpdateRanges?.(); a.addUpdateRange?.(0, ng * a.itemSize); }
    const P = this.pool;
    if (P) {
      if (best) {
        const x = best.x + best.nx * 0.35, y = best.y + best.ny * 0.35 + 0.05;
        // a spot that moves with its beam is followed; a jump to another spot fades in there (no light sliding
        // across the room, no pop)
        if (!P.enabled || Math.hypot(x - P.pos.x, y - P.pos.y) > 0.6) this.fadeK = 0;
        this.fadeK = Math.min(1, (this.fadeK ?? 1) + dt * 4);
        P.enabled = true;
        P.pos.set(x, y, 0.35);
        this.flick += dt;
        P.intensity = (2.4 + 1.6 * Math.min(1.5, bestI)) * (0.94 + 0.06 * Math.sin(this.flick * 11)) * this.fadeK * this.fadeK;
        if (P.color) P.color.copy(bestCol).lerp(this._c.setRGB(1, 0.95, 0.85), 0.2);
      } else P.enabled = false;
    }
  }

  dispose() {
    if (this.pool) this.game.lightPool?.remove(this.pool);
    this.pool = null;
  }
}
