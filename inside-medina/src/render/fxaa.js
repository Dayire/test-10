import * as THREE from 'three';

// Output pass: takes the graded LDR image (sRGB-encoded, possibly a smaller sub-rect of its
// target when dynamic resolution is active) and writes the canvas: FXAA on the source texel
// grid, bilinear upscale, contrast-adaptive sharpening (CAS) when upscaling, then film grain
// and dithering at output resolution so the grain never scales with the render resolution.
const VS = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

const FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uMax, uTexel; uniform float uFxaa, uSharp, uGrain, uTime;
varying vec2 vUv;
vec3 T(vec2 uv){ return texture2D(tColor, clamp(uv, uTexel * .5, uMax - uTexel * .5)).rgb; }
float lum(vec3 c){ return dot(c, vec3(.299, .587, .114)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv * uMax;
  vec3 M = T(uv);
  vec3 NW = T(uv + vec2(-1., -1.) * uTexel), NE = T(uv + vec2(1., -1.) * uTexel);
  vec3 SW = T(uv + vec2(-1., 1.) * uTexel), SE = T(uv + vec2(1., 1.) * uTexel);
  float lM = lum(M), lNW = lum(NW), lNE = lum(NE), lSW = lum(SW), lSE = lum(SE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec3 col = M;
  if (uFxaa > .5 && lMax - lMin > max(.0312, lMax * .125)) {
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
    float red = max((lNW + lNE + lSW + lSE) * .03125, 1. / 128.);
    dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), vec2(-8.), vec2(8.)) * uTexel;
    vec3 a = .5 * (T(uv + dir * (1. / 3. - .5)) + T(uv + dir * (2. / 3. - .5)));
    vec3 b = a * .5 + .25 * (T(uv - dir * .5) + T(uv + dir * .5));
    float lb = lum(b);
    col = (lb < lMin || lb > lMax) ? a : b;
  }
  if (uSharp > 0.) {
    // CAS: sharpen less where local contrast is already high
    vec3 mn = min(M, min(min(NW, NE), min(SW, SE))), mx = max(M, max(max(NW, NE), max(SW, SE)));
    vec3 amp = sqrt(clamp(min(mn, 2. - mx) / max(mx, vec3(1e-4)), 0., 1.));
    vec3 w = amp * (-1. / mix(8., 5., uSharp));
    col = clamp(((NW + NE + SW + SE) * w + col) / (1. + 4. * w), 0., 1.);
  }
  float n = h12(gl_FragCoord.xy + fract(uTime) * 917.) - .5;
  float n2 = h12(gl_FragCoord.xy * 1.37 + fract(uTime * 1.3) * 331.) - .5;
  col += (n + n2) * uGrain + n / 255.;
  gl_FragColor = vec4(col, 1.);
}`;

export function createOutputMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false,
    uniforms: {
      tColor: { value: null }, uMax: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) },
      uFxaa: { value: 1 }, uSharp: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 },
    },
  });
}
