// Shared GLSL snippets: hashing, periodic (tileable) noise, fbm, voronoi.
// All "p*" functions tile over [0,1) when called with integer frequencies.

export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec2 qwrap(vec2 i, vec2 per){ return mod(i, per); }

// periodic value noise
float pvalue(vec2 p, vec2 per){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  float a = hash12(qwrap(i, per));
  float b = hash12(qwrap(i + vec2(1.,0.), per));
  float c = hash12(qwrap(i + vec2(0.,1.), per));
  float d = hash12(qwrap(i + vec2(1.,1.), per));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
// periodic gradient noise, ~[-0.7,0.7]
float pgrad(vec2 p, vec2 per){
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f*f*f*(f*(f*6.-15.)+10.);
  vec2 ga = hash22(qwrap(i, per))*2.-1.;
  vec2 gb = hash22(qwrap(i+vec2(1.,0.), per))*2.-1.;
  vec2 gc = hash22(qwrap(i+vec2(0.,1.), per))*2.-1.;
  vec2 gd = hash22(qwrap(i+vec2(1.,1.), per))*2.-1.;
  float va = dot(ga, f);
  float vb = dot(gb, f - vec2(1.,0.));
  float vc = dot(gc, f - vec2(0.,1.));
  float vd = dot(gd, f - vec2(1.,1.));
  return mix(mix(va,vb,u.x), mix(vc,vd,u.x), u.y);
}
// fbm on a [0,1) tile, frequencies are integer multiples so it tiles. returns ~[0,1]
float pfbm(vec2 uv, vec2 freq, int oct, float gain){
  float a = 0., amp = .5, n = 0.;
  vec2 f = freq;
  for (int i = 0; i < 9; i++){
    if (i >= oct) break;
    a += amp * pgrad(uv * f, f);
    n += amp; amp *= gain; f *= 2.;
  }
  return a / n * 0.9 + 0.5;
}
float pridged(vec2 uv, vec2 freq, int oct){
  float a = 0., amp = .5, n = 0.;
  vec2 f = freq;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    a += amp * (1. - abs(pgrad(uv * f, f) * 1.6));
    n += amp; amp *= .5; f *= 2.;
  }
  return a / n;
}
// periodic voronoi: x = F1, y = F2, z = cell hash, w = edge distance (approx F2-F1 style)
vec4 pvoronoi(vec2 uv, vec2 freq, float jitter){
  vec2 p = uv * freq;
  vec2 i = floor(p), f = fract(p);
  float F1 = 8., F2 = 8.; vec2 id = vec2(0.); vec2 mr = vec2(0.); vec2 mg = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = .5 + (hash22(qwrap(i + g, freq)) - .5) * jitter;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < F1){ F2 = F1; F1 = d; id = qwrap(i + g, freq); mr = r; mg = g; }
    else if (d < F2){ F2 = d; }
  }
  // exact edge distance (IQ)
  float md = 8.;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++){
    vec2 g = mg + vec2(float(x), float(y));
    vec2 o = .5 + (hash22(qwrap(i + g, freq)) - .5) * jitter;
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > .00001) md = min(md, dot(.5 * (mr + r), normalize(r - mr)));
  }
  return vec4(sqrt(F1), sqrt(F2), hash12(id + 17.13), md);
}
vec2 pvoronoiCenter(vec2 uv, vec2 freq, float jitter){
  vec2 p = uv * freq; vec2 i = floor(p), f = fract(p);
  float F1 = 8.; vec2 best = vec2(0.);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = .5 + (hash22(qwrap(i + g, freq)) - .5) * jitter;
    vec2 r = g + o - f; float d = dot(r,r);
    if (d < F1){ F1 = d; best = r; }
  }
  return best / freq; // offset from sample to cell center, in uv units
}
float sat(float x){ return clamp(x, 0., 1.); }
vec3 sat3(vec3 x){ return clamp(x, 0., 1.); }
float lin(float a, float b, float x){ return sat((x - a) / (b - a)); }
vec3 srgb2lin(vec3 c){ return pow(c, vec3(2.2)); }
vec3 hex(float r, float g, float b){ return srgb2lin(vec3(r,g,b)/255.); }
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
`;

// Non-periodic 3D noise used at runtime (sky, fog, wind, shafts)
export const NOISE3 = /* glsl */ `
float h13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.-2.*f);
  return mix(mix(mix(h13(i), h13(i+vec3(1,0,0)), u.x), mix(h13(i+vec3(0,1,0)), h13(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(h13(i+vec3(0,0,1)), h13(i+vec3(1,0,1)), u.x), mix(h13(i+vec3(0,1,1)), h13(i+vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm3(vec3 p){ float a = 0., s = .5; for (int i = 0; i < 5; i++){ a += s * vnoise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); s *= .5; } return a; }
`;
