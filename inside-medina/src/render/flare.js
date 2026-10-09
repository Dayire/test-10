import * as THREE from 'three';

// Screen-space lens flare built from the bloom chain (so the sun, lanterns and beam glints all
// flare without any per-light work): mirrored ghosts with a chromatic shift and a soft halo.
// Lens dirt is a procedural smudge texture lit by bloom and flare, raised for the finale.
export const FLARE_FS = /* glsl */ `
uniform sampler2D tBloom; uniform vec2 uMax, uTexel; uniform float uThreshold, uAspect;
varying vec2 vUv;
vec3 B(vec2 uv){
  uv = clamp(uv, uTexel, uMax - uTexel);
  vec3 c = texture2D(tBloom, uv).rgb;
  return max(c - uThreshold, 0.);
}
vec3 chroma(vec2 uv, vec2 dir, float k){
  return vec3(B((uv + dir * k) * uMax).r, B(uv * uMax).g, B((uv - dir * k) * uMax).b);
}
void main(){
  vec2 uv = 1. - vUv;                // mirrored through the centre
  vec2 gv = (vec2(.5) - uv) * .42;   // ghost spacing
  vec3 acc = vec3(0.);
  for (int i = 0; i < 4; i++){
    vec2 o = fract(uv + gv * float(i));
    float w = pow(1. - length(vec2(.5) - o) / .7071, 6.);
    vec3 tint = i == 1 ? vec3(.85, .92, 1.) : i == 2 ? vec3(1., .88, .74) : vec3(.95, .95, 1.);
    acc += chroma(o, normalize(gv + 1e-5) * .0025, float(i + 1)) * w * tint;
  }
  vec2 hv = normalize((vec2(.5) - uv) * vec2(uAspect, 1.) + 1e-5) / vec2(uAspect, 1.) * .38;
  vec2 ho = fract(uv + hv);
  float hw = pow(1. - length(vec2(.5) - ho) / .7071, 5.) * smoothstep(.05, .35, length((vUv - .5) * vec2(uAspect, 1.)));
  acc += chroma(ho, hv * .02, 1.) * hw * vec3(1., .82, .6) * .7;
  gl_FragColor = vec4(acc, 1.);
}`;

// procedural lens dirt: smudges, soft bokeh specks and a few wipe streaks
export function dirtTexture(size = 512) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, size, size);
  let seed = 3;
  const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) { // broad smudges
    const px = r() * size, py = r() * size, rad = size * (0.08 + r() * 0.22);
    const g = x.createRadialGradient(px, py, 0, px, py, rad);
    const a = 0.05 + r() * 0.08;
    g.addColorStop(0, `rgba(255,240,220,${a})`); g.addColorStop(1, 'rgba(255,240,220,0)');
    x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 70; i++) { // bokeh specks with a brighter rim
    const px = r() * size, py = r() * size, rad = size * (0.004 + r() * 0.018);
    const g = x.createRadialGradient(px, py, rad * 0.6, px, py, rad);
    const a = 0.1 + r() * 0.25;
    g.addColorStop(0, `rgba(255,250,240,${a * 0.5})`); g.addColorStop(0.85, `rgba(255,250,240,${a})`); g.addColorStop(1, 'rgba(255,250,240,0)');
    x.fillStyle = g; x.beginPath(); x.arc(px, py, rad, 0, Math.PI * 2); x.fill();
  }
  x.lineCap = 'round';
  for (let i = 0; i < 7; i++) { // wipe streaks
    x.strokeStyle = `rgba(255,245,230,${0.03 + r() * 0.04})`; x.lineWidth = size * (0.01 + r() * 0.03);
    x.beginPath(); const sx = r() * size, sy = r() * size; x.moveTo(sx, sy);
    x.quadraticCurveTo(sx + (r() - 0.5) * size * 0.6, sy + (r() - 0.5) * size * 0.3, sx + (r() - 0.5) * size, sy + (r() - 0.5) * size * 0.4); x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
