import * as THREE from 'three';
import { LAYERS, SOFT, SOFT_GLSL } from './layers.js';

// GPU particles: every particle is simulated in the vertex shader from its spawn state, so the
// CPU only writes a few floats per emitted particle into a ring buffer. Two instanced draws
// (additive and alpha-blended) cover every kind. They live on the soft layer, so smoke and dust
// fade into the geometry they touch.
//   particles.emit('embers' | 'smoke' | 'moths' | 'dust' | 'feathers', pos, opts)
const KINDS = {
  //          id  blend  life      size          colour     alpha  speed  spread
  embers:   { id: 0, add: true,  life: [1.2, 2.6], size: [0.035, 0.07], color: 0xff8a3a, alpha: 1.0, speed: 0.9, spread: 0.25 },
  smoke:    { id: 1, add: false, life: [3.0, 5.0], size: [0.35, 0.8],   color: 0x6e645c, alpha: 0.32, speed: 0.45, spread: 0.2 },
  moths:    { id: 2, add: false, life: [14, 22],   size: [0.05, 0.075], color: 0xd9c7a8, alpha: 0.95, speed: 1.0, spread: 0.6 },
  dust:     { id: 3, add: false, life: [0.9, 1.8], size: [0.12, 0.3],   color: 0xc7a882, alpha: 0.4, speed: 0.8, spread: 0.6 },
  feathers: { id: 4, add: false, life: [3.0, 4.5], size: [0.06, 0.1],   color: 0x8d8a92, alpha: 1.0, speed: 1.2, spread: 0.5 },
};

const VS = /* glsl */ `
attribute vec3 aP0; attribute vec3 aV0; attribute vec4 aT; attribute vec4 aC; attribute vec4 aK;
uniform float uTime;
varying vec4 vC; varying vec2 vQ; varying float vKind; varying float vAge; varying float vSeed;
vec3 turb(vec3 p, float t, float s){ return vec3(sin(t * 1.7 + p.y * 2.1 + s * 31.), sin(t * 1.3 + p.x * 1.9 + s * 17.), sin(t * 1.1 + p.x * 1.3 + s * 7.)); }
void main(){
  float age = uTime - aT.x, life = aT.y, k = aK.x, seed = aK.y;
  float u = age / life;
  vKind = k; vSeed = seed; vAge = u; vQ = position.xy * 2.;
  if (age < 0. || u >= 1.) { gl_Position = vec4(0., 0., 2., 1.); vC = vec4(0.); return; }
  vec3 p = aP0; float size = mix(aT.z, aT.w, u); float rot = 0.; float alpha = aC.a; vec2 stretch = vec2(1.);
  if (k < .5) {        // embers: buoyant, drag, flicker
    float d = (1. - exp(-1.6 * age)) / 1.6;
    p += aV0 * d + vec3(0., .55 * age * age * .5, 0.) + turb(aP0, age * 3., seed) * .06 * age;
    alpha *= (1. - u) * (.6 + .4 * sin(age * (18. + seed * 10.) + seed * 40.)) * smoothstep(0., .05, u);
  } else if (k < 1.5) { // smoke: slow rise, spreads, curls
    float d = (1. - exp(-.7 * age)) / .7;
    p += aV0 * d + vec3(0., .25 * age, 0.) + turb(aP0, age * .6, seed) * .18 * age;
    rot = seed * 6.28 + age * (seed - .5) * .9;
    alpha *= smoothstep(0., .12, u) * (1. - u) * (1. - u);
  } else if (k < 2.5) { // moths: orbit the emitter with jittery flight, wings flap
    float r = aV0.x * (.6 + .4 * sin(age * .7 + seed * 9.));
    float a = age * (1.6 + seed) * (seed > .5 ? 1. : -1.) + seed * 6.28;
    p += vec3(cos(a) * r, sin(age * 2.3 + seed * 5.) * aV0.y + sin(age * 9. + seed) * .04, sin(a) * r * .6);
    stretch = vec2(.5 + .5 * abs(sin(age * 34. + seed * 20.)), 1.);
    alpha *= smoothstep(0., .03, u) * smoothstep(1., .9, u);
  } else if (k < 3.5) { // dust: puff outward, settles
    float d = (1. - exp(-2.5 * age)) / 2.5;
    p += aV0 * d + vec3(0., -.12 * age * age, 0.);
    rot = seed * 6.28;
    alpha *= sin(min(1., u * 1.4) * 3.14159) * (1. - u * .4);
    size = mix(aT.z, aT.w, sqrt(u));
  } else {              // feathers: thrown out, then rock down like a leaf
    float d = (1. - exp(-3. * age)) / 3.;
    float fall = max(0., age - .3);
    p += aV0 * d + vec3(sin(age * 3.1 + seed * 6.) * .35, -.55 * fall, cos(age * 2.3 + seed * 3.) * .2);
    rot = sin(age * 3.1 + seed * 6.) * .9 + seed * 3.;
    stretch = vec2(.32, 1.);
    alpha *= smoothstep(1., .75, u);
  }
  vC = vec4(aC.rgb, alpha);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  float c = cos(rot), s = sin(rot);
  vec2 q = position.xy * stretch * size;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;
}`;

const FS = /* glsl */ `
${SOFT_GLSL}
varying vec4 vC; varying vec2 vQ; varying float vKind; varying float vAge; varying float vSeed;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main(){
  float r2 = dot(vQ, vQ);
  float a;
  if (vKind < .5) a = exp(-r2 * 4.) + exp(-r2 * 30.) * .8;                          // ember: hot core + glow
  else if (vKind < 1.5) a = smoothstep(1., .2, sqrt(r2)) * (.55 + .45 * vn(vQ * 2.5 + vSeed * 13. + vAge * 1.5)) * softFade(.8);
  else if (vKind < 2.5) { vec2 q = abs(vQ); a = smoothstep(.95, .7, length(vec2(q.x * .8 - .45, q.y * 1.3))) + step(q.x, .08) * step(q.y, .6); }
  else if (vKind < 3.5) a = smoothstep(1., 0., sqrt(r2)) * (.6 + .4 * vn(vQ * 3. + vSeed * 7.)) * softFade(.4);
  else { float spine = smoothstep(.12, 0., abs(vQ.x)) * step(vQ.y, .9); a = max(smoothstep(1., .75, length(vQ * vec2(1., .95))) * (.75 + .25 * sin(vQ.y * 40.)), spine); }
  a *= vC.a;
  if (a < .003) discard;
  #ifdef ADDITIVE
  gl_FragColor = vec4(vC.rgb * a * 3., 1.);
  #else
  gl_FragColor = vec4(vC.rgb, min(a, 1.));
  #endif
  #include <fog_fragment>
}`;

class Pool {
  constructor(n, additive) {
    this.n = n; this.i = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, size) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.P0 = mk('aP0', 3); this.V0 = mk('aV0', 3); this.T = mk('aT', 4); this.C = mk('aC', 4); this.K = mk('aK', 4);
    for (let i = 0; i < n; i++) this.T.array[i * 4] = -1e6; // all dead
    g.instanceCount = n;
    this.uTime = { value: 0 };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {}, uniforms: { ...SOFT, uTime: this.uTime },
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = additive ? 7 : 6;
    this.mesh.name = additive ? 'particles+' : 'particles';
    this.mesh.layers.set(LAYERS.BEAMS);
    this.dirty0 = -1; this.dirty1 = -1; this.wrapped = false;
    this.until = -1; this.mesh.visible = false;
  }
  slot() {
    const i = this.i; this.i = (this.i + 1) % this.n;
    if (this.dirty0 < 0) { this.dirty0 = i; this.dirty1 = i; } else if (i < this.dirty1) this.wrapped = true; else this.dirty1 = i;
    return i;
  }
  flush() {
    if (this.dirty0 < 0) return;
    for (const a of [this.P0, this.V0, this.T, this.C, this.K]) {
      a.clearUpdateRanges();
      if (this.wrapped) a.addUpdateRange(0, this.n * a.itemSize);
      else a.addUpdateRange(this.dirty0 * a.itemSize, (this.dirty1 - this.dirty0 + 1) * a.itemSize);
      a.needsUpdate = true;
    }
    this.dirty0 = this.dirty1 = -1; this.wrapped = false;
  }
  clear() { for (let i = 0; i < this.n; i++) this.T.array[i * 4] = -1e6; this.dirty0 = 0; this.dirty1 = this.n - 1; this.flush(); this.until = -1; this.mesh.visible = false; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); this.mesh.removeFromParent(); }
}

const _c = new THREE.Color();
const rand = (a, b) => a + Math.random() * (b - a);

export class Particles {
  constructor({ capacity = 2048 } = {}) {
    this.add = new Pool(capacity >> 1, true);
    this.alpha = new Pool(capacity, false);
    this.group = new THREE.Group(); this.group.name = 'particles';
    this.group.add(this.add.mesh, this.alpha.mesh);
    this.budget = 1; this.time = 0; this.emitted = 0;
  }
  // kind: embers | smoke | moths | dust | feathers; pos: {x,y,z}
  // opts: count, spread, speed, dir {x,y,z}, life [a,b] | n, size [a,b] | n, color, alpha, radius (moth orbit)
  emit(kind, pos, opts = {}) {
    const K = KINDS[kind];
    if (!K || !pos) return 0;
    const want = (opts.count ?? (kind === 'moths' ? 3 : kind === 'smoke' ? 4 : 10)) * this.budget;
    const n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
    const pool = K.add ? this.add : this.alpha;
    const life = opts.life ?? K.life, size = opts.size ?? K.size, spread = opts.spread ?? K.spread, speed = opts.speed ?? K.speed;
    const dir = opts.dir || { x: 0, y: kind === 'smoke' || kind === 'embers' ? 1 : 0.6, z: 0 };
    _c.set(opts.color ?? K.color);
    for (let k = 0; k < n; k++) {
      const i = pool.slot();
      const P = pool.P0.array, V = pool.V0.array, T = pool.T.array, C = pool.C.array, Kd = pool.K.array;
      const ox = (Math.random() - 0.5) * spread, oy = (Math.random() - 0.5) * spread * 0.5, oz = (Math.random() - 0.5) * spread;
      P[i * 3] = pos.x + ox * (kind === 'moths' ? 0 : 1); P[i * 3 + 1] = pos.y + oy; P[i * 3 + 2] = (pos.z ?? 0) + oz * (kind === 'moths' ? 0 : 1);
      if (kind === 'moths') { V[i * 3] = opts.radius ?? rand(0.25, 0.6); V[i * 3 + 1] = rand(0.08, 0.25); V[i * 3 + 2] = 0; }
      else {
        const a = Math.random() * Math.PI * 2, s = speed * rand(0.4, 1.1);
        V[i * 3] = dir.x * s + Math.cos(a) * spread * s; V[i * 3 + 1] = dir.y * s * rand(0.6, 1.2); V[i * 3 + 2] = dir.z * s + Math.sin(a) * spread * s * 0.6;
      }
      T[i * 4] = this.time + (opts.delay ?? 0) + (opts.stagger ? k * opts.stagger : 0);
      T[i * 4 + 1] = Array.isArray(life) ? rand(life[0], life[1]) : life;
      const s0 = Array.isArray(size) ? rand(size[0], size[1]) : size;
      T[i * 4 + 2] = kind === 'smoke' ? s0 * 0.45 : kind === 'dust' ? s0 * 0.4 : s0;
      T[i * 4 + 3] = kind === 'embers' ? s0 * 0.3 : kind === 'smoke' ? s0 * 2.6 : kind === 'dust' ? s0 * 2 : s0;
      const v = 0.9 + Math.random() * 0.2;
      C[i * 4] = _c.r * v; C[i * 4 + 1] = _c.g * v; C[i * 4 + 2] = _c.b * v; C[i * 4 + 3] = opts.alpha ?? K.alpha;
      Kd[i * 4] = K.id; Kd[i * 4 + 1] = Math.random(); Kd[i * 4 + 2] = 0; Kd[i * 4 + 3] = 0;
      pool.until = Math.max(pool.until, T[i * 4] + T[i * 4 + 1]);
    }
    this.emitted += n;
    return n;
  }
  update(time) {
    this.time = time;
    for (const p of [this.add, this.alpha]) { p.uTime.value = time; p.flush(); p.mesh.visible = time <= p.until; }
  }
  get alive() { return this.time <= Math.max(this.add.until, this.alpha.until); }
  attach(scene) { if (this.group.parent !== scene) scene.add(this.group); }
  clear() { this.add.clear(); this.alpha.clear(); }
  dispose() { this.add.dispose(); this.alpha.dispose(); this.group.removeFromParent(); }
}

// module-level handle so any system can emit without plumbing: particles.emit(kind, pos, opts)
let active = null;
export function setActiveParticles(p) { active = p; }
export const particles = {
  emit: (kind, pos, opts) => (active ? active.emit(kind, pos, opts) : 0),
  clear: () => active && active.clear(),
  get system() { return active; },
  kinds: Object.keys(KINDS),
};
