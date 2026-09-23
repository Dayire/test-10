import * as THREE from 'three';

// Volumetric-looking sun shafts: soft additive slabs aligned with the sun,
// with drifting dust. Placed by the level where sunlight squeezes through gaps.
const VS = /* glsl */ `
varying vec3 vL; varying vec3 vW;
void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity, uTime; uniform vec3 uSize;
varying vec3 vL; varying vec3 vW;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  vec3 q = vL / uSize; // -0.5..0.5, y along the shaft (0.5 = sun end)
  float ex = 1. - smoothstep(.2, .5, abs(q.x));
  float ez = 1. - smoothstep(.15, .5, abs(q.z));
  float ey = smoothstep(-.5, -.3, q.y) * (1. - smoothstep(.25, .5, q.y));
  float streak = .65 + .35 * n3(vec3(vL.x * 2.2, vL.y * .15 + uTime * .05, vL.z * 2.2));
  float dust = .8 + .4 * n3(vW * 2.1 + vec3(uTime * .1, -uTime * .07, 0.));
  float a = ex * ez * ey * streak * dust * uIntensity;
  // fade when viewed along the shaft (avoids hard slabs)
  gl_FragColor = vec4(uColor * a, 1.);
}`;

export class Shafts {
  constructor(scene, sunDir, globals) {
    this.scene = scene; this.sunDir = sunDir.clone().normalize(); this.g = globals;
    this.list = [];
    this.group = new THREE.Group(); this.group.name = 'shafts';
    scene.add(this.group);
    this.dust = null;
  }
  // p: point on the lit ground end; w,d: cross-section; len: length toward the sun
  add(p, { w = 1.5, d = 1.2, len = 12, intensity = 0.12, color = 0xffd9a0 } = {}) {
    const geo = new THREE.BoxGeometry(w, len, d);
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uTime: this.g.uTime, uSize: { value: new THREE.Vector3(w, len, d) } },
    });
    const m = new THREE.Mesh(geo, mat);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.sunDir);
    m.position.copy(p).addScaledVector(this.sunDir, len * 0.5 - 0.3);
    m.renderOrder = 5;
    this.group.add(m);
    this.list.push(m);
    return m;
  }
  // floating dust motes around given regions
  addDust(regions, count = 1500) {
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = regions[i % regions.length];
      pos[i * 3] = r.x0 + Math.random() * (r.x1 - r.x0);
      pos[i * 3 + 1] = r.y0 + Math.random() * (r.y1 - r.y0);
      pos[i * 3 + 2] = r.z0 + Math.random() * (r.z1 - r.z0);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.g.uTime, uSun: { value: this.sunDir }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
attribute float seed; uniform float uTime; uniform float uScale; varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(uTime * (.2 + seed * .3) + seed * 40.) * .35;
  p.y += sin(uTime * (.15 + seed * .2) + seed * 17.) * .3 + mod(uTime * .02 * (seed - .5), 1.);
  p.z += cos(uTime * (.18 + seed * .25) + seed * 9.) * .3;
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.6 + seed * 1.2) * uScale * 14. / -mv.z;
  vA = (.4 + .6 * sin(uTime * (1. + seed) + seed * 30.) * .5 + .3) * smoothstep(40., 8., -mv.z);
}`,
      fragmentShader: /* glsl */ `
varying float vA;
void main(){ vec2 c = gl_PointCoord - .5; float d = dot(c, c); if (d > .25) discard; gl_FragColor = vec4(vec3(1., .85, .6) * (1. - d * 4.) * vA * .22, 1.); }`,
    });
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.dust = pts;
    return pts;
  }
}
