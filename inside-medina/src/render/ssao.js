// Half-resolution ambient occlusion from the depth buffer (high and ultra): view-space positions
// are rebuilt from depth, normals from the flatter neighbour on each axis, 12 spiral taps, then a
// depth-aware blur. The result darkens creases and contacts (pots on cobbles, sacks against walls)
// and fades out with distance so the haze stays clean.
export const SSAO_FS = /* glsl */ `
uniform sampler2D tDepth; uniform vec2 uMax, uTexel; uniform mat4 uProjInv; uniform float uRadius, uProjY, uTime;
varying vec2 vUv;
vec3 vpos(vec2 s){
  float d = texture2D(tDepth, clamp(s, vec2(0.), vec2(1.)) * uMax).x;
  vec4 v = uProjInv * vec4(s * 2. - 1., d * 2. - 1., 1.);
  return v.xyz / v.w;
}
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  float d0 = texture2D(tDepth, vUv * uMax).x;
  if (d0 > .99999) { gl_FragColor = vec4(1.); return; }
  vec3 p = vpos(vUv);
  vec2 px = uTexel / uMax;
  vec3 l = vpos(vUv - vec2(px.x, 0.)), r = vpos(vUv + vec2(px.x, 0.)), b = vpos(vUv - vec2(0., px.y)), t = vpos(vUv + vec2(0., px.y));
  vec3 dx = abs(r.z - p.z) < abs(p.z - l.z) ? r - p : p - l;
  vec3 dy = abs(t.z - p.z) < abs(p.z - b.z) ? t - p : p - b;
  vec3 n = normalize(cross(dx, dy));
  float rs = uRadius * uProjY / max(-p.z, .1) * .5;      // radius in uv
  rs = min(rs, .12);
  float rnd = h12(gl_FragCoord.xy) * 6.2831;
  float occ = 0.;
  const int N = 12;
  for (int i = 0; i < N; i++){
    float fi = float(i) + .5;
    float a = fi * 2.39996 + rnd, rr = sqrt(fi / float(N)) * rs;
    vec3 s = vpos(vUv + vec2(cos(a), sin(a)) * rr) - p;
    float vv = dot(s, s);
    occ += max(0., dot(s, n) - .015 * -p.z) / (vv + .02) * smoothstep(uRadius * uRadius * 4., uRadius * uRadius * .5, vv);
  }
  float ao = clamp(1. - occ * uRadius * 1.6 / float(N), 0., 1.);
  ao = mix(ao, 1., smoothstep(28., 55., -p.z));
  gl_FragColor = vec4(vec3(ao), 1.);
}`;

export const SSAO_BLUR_FS = /* glsl */ `
uniform sampler2D tAO, tDepth; uniform vec2 uMax, uTexel, uDepthMax; uniform vec2 uNearFar;
varying vec2 vUv;
float lin(float d){ return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x)); }
void main(){
  float z0 = lin(texture2D(tDepth, vUv * uDepthMax).x);
  float acc = 0., w = 0.;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++){
    vec2 o = vec2(float(x), float(y)) * uTexel;
    vec2 uv = clamp(vUv * uMax + o, uTexel * .5, uMax - uTexel * .5);
    float z = lin(texture2D(tDepth, uv / uMax * uDepthMax).x);
    float k = exp(-abs(z - z0) / max(.15, z0 * .03)) * (1. - .1 * float(x * x + y * y));
    acc += texture2D(tAO, uv).r * k; w += k;
  }
  gl_FragColor = vec4(vec3(acc / max(w, 1e-4)), 1.);
}`;
