import * as THREE from 'three';

// Screen-space lens flare built from the bloom chain, so the sun, lanterns and beam glints flare
// without any per-light work:
//  - ghosts: soft discs mirrored through the centre, read from a blurred (1/8) bloom level so a
//    small lamp never turns into a hard coloured dot; radial dispersion tints only their rims;
//  - halo: a thin ring around the centre, from the sun only (uHalo follows its visibility);
//  - streak: a short horizontal smear of the brightest small sources (lamps, glints) from the
//    sharper 1/4 level.
// Lens dirt is a procedural smudge texture lit by bloom and flare, raised for the finale.
export const FLARE_FS = /* glsl */ `
uniform sampler2D tGhost, tStreak; uniform vec2 uGhostMax, uGhostTexel, uStreakMax, uStreakTexel;
uniform float uThreshold, uAspect, uGhost, uHalo, uStreak;
varying vec2 vUv;
vec3 G(vec2 uv){
  float inside = step(0., uv.x) * step(uv.x, 1.) * step(0., uv.y) * step(uv.y, 1.);
  vec3 c = texture2D(tGhost, clamp(uv * uGhostMax, uGhostTexel * .5, uGhostMax - uGhostTexel * .5)).rgb;
  return max(c - uThreshold, 0.) * inside;
}
vec3 disperse(vec2 uv, float k){ vec2 d = (uv - .5) * k; return vec3(G(uv + d).r, G(uv).g, G(uv - d).b); }
vec3 Sk(vec2 uv){ return max(texture2D(tStreak, clamp(uv * uStreakMax, uStreakTexel * .5, uStreakMax - uStreakTexel * .5)).rgb - uThreshold * 2., 0.); }
void main(){
  vec3 acc = vec3(0.);
  if (uGhost > 0.) {
    vec2 uv = 1. - vUv;                // mirrored through the centre
    vec2 gv = (vec2(.5) - uv) * .44;   // ghost spacing
    for (int i = 0; i < 4; i++){
      vec2 o = uv + gv * float(i);
      float w = pow(clamp(1. - length(vec2(.5) - o) / .7071, 0., 1.), 5.);
      vec3 tint = i == 0 ? vec3(1., .86, .7) : i == 1 ? vec3(.8, .9, 1.) : i == 2 ? vec3(1., .8, .62) : vec3(.86, .94, 1.);
      acc += disperse(o, .012 + .006 * float(i)) * w * tint * (i == 0 ? .6 : 1.);
    }
    acc *= uGhost;
  }
  if (uHalo > 0.) {
    vec2 uv = 1. - vUv;
    vec2 hv = normalize((vec2(.5) - uv) * vec2(uAspect, 1.) + 1e-5) / vec2(uAspect, 1.) * .36;
    vec2 ho = uv + hv;
    float hw = pow(clamp(1. - length(vec2(.5) - ho) / .7071, 0., 1.), 4.) * smoothstep(.1, .4, length((vUv - .5) * vec2(uAspect, 1.)));
    acc += disperse(ho, .03) * hw * vec3(1., .84, .66) * .35 * uHalo;
  }
  if (uStreak > 0.) {
    vec3 s = vec3(0.);
    for (int i = 1; i <= 8; i++){
      float fi = float(i), w = exp(-fi * .32);
      vec2 o = vec2(fi * uStreakTexel.x * 2.5 / uStreakMax.x, 0.);
      s += (Sk(vUv + o) + Sk(vUv - o)) * w;
    }
    // a pale warm white, so the streak reads as lens glare and not as an orange smear over the walls
    acc += s * vec3(1., .9, .8) * .12 * uStreak;
  }
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
