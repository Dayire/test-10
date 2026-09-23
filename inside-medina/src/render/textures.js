import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { NOISE } from './glsl.js';

// ---------------------------------------------------------------------------
// GPU texture baker: every surface is described by a GLSL `surf()` function
// that is evaluated into three textures (albedo+alpha, normal, ORM).
// Textures tile over [0,1) (unless `clamp` is set) and get mipmaps + aniso.
// ---------------------------------------------------------------------------

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;

function fragFor(surfCode, clamp) {
  return /* glsl */ `
precision highp float;
uniform vec2 uRes; uniform int uPass; uniform float uNormalStrength; uniform float uSeed;
${NOISE}
${surfCode}
vec2 wrapUV(vec2 uv){ ${clamp ? 'return clamp(uv, 0., 1.);' : 'return fract(uv);'} }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 alb; float h, r, ao, m, a;
  surf(uv, alb, h, r, ao, m, a);
  if (uPass == 0) {
    gl_FragColor = vec4(max(alb, 0.), a);
  } else if (uPass == 1) {
    vec2 ex = vec2(1. / uRes.x, 0.), ey = vec2(0., 1. / uRes.y);
    vec3 t3; float hl, hr, hd, hu, t1, t2, t4, t5;
    surf(wrapUV(uv - ex), t3, hl, t1, t2, t4, t5);
    surf(wrapUV(uv + ex), t3, hr, t1, t2, t4, t5);
    surf(wrapUV(uv - ey), t3, hd, t1, t2, t4, t5);
    surf(wrapUV(uv + ey), t3, hu, t1, t2, t4, t5);
    // height is expressed in "texture widths"; strength scales it
    vec2 g = vec2(hr - hl, hu - hd) * 0.5 * uRes * uNormalStrength / 1024.;
    vec3 n = normalize(vec3(-g, 1.));
    gl_FragColor = vec4(n * .5 + .5, 1.);
  } else {
    gl_FragColor = vec4(sat(ao), sat(r), sat(m), 1.);
  }
}`;
}

export class TextureBaker {
  constructor(renderer, { scale = 1 } = {}) {
    this.renderer = renderer;
    this.scale = scale; // global resolution multiplier (test mode uses 0.5)
    this.quad = new FullScreenQuad(null);
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.targets = [];
  }

  _rt(size, srgb) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      anisotropy: this.aniso,
    });
    this.targets.push(rt);
    return rt;
  }

  bake(def) {
    const size = Math.max(64, Math.round((def.size || 1024) * this.scale));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: fragFor(def.glsl, !!def.clamp),
      uniforms: {
        uRes: { value: new THREE.Vector2(size, size) },
        uPass: { value: 0 },
        uNormalStrength: { value: def.normalStrength ?? 1.0 },
        uSeed: { value: def.seed ?? 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = mat;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const out = {};
    const passes = def.passes || ['map', 'normalMap', 'ormMap'];
    const passIndex = { map: 0, normalMap: 1, ormMap: 2 };
    for (const p of passes) {
      const rt = this._rt(size, p === 'map');
      if (def.clamp) { rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping; }
      mat.uniforms.uPass.value = passIndex[p];
      r.setRenderTarget(rt);
      this.quad.render(r);
      rt.texture.name = `${def.name}.${p}`;
      out[p] = rt.texture;
    }
    r.setRenderTarget(prev);
    mat.dispose();
    return out;
  }
}

// ---------------------------------------------------------------------------
// Surface definitions. Colours are authored in sRGB via hex() and converted.
// uv spans one texture tile; physical size of a tile is set on the material.
// ---------------------------------------------------------------------------

const PLASTER = (paint, paint2, under, opts = {}) => /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  // warm lime plaster underneath
  float n1 = pfbm(uv, vec2(6.), 6, .55);
  float n2 = pfbm(uv + .37, vec2(24.), 4, .5);
  vec3 under = ${under} * (0.82 + 0.36 * n1) * (0.92 + 0.16 * n2);
  // occasional exposed brick/stone course under the plaster
  float brickRow = floor(uv.y * 22.);
  vec2 bq = vec2(uv.x * 11. + mod(brickRow, 2.) * .5, uv.y * 22.);
  float bmask = step(.72, pfbm(uv + .11, vec2(3.), 4, .5));
  vec2 bf = fract(bq); float bedge = min(min(bf.x, 1. - bf.x) * 2.2, min(bf.y, 1. - bf.y));
  vec3 brick = hex(170., 112., 78.) * (0.75 + 0.5 * hash12(floor(bq) + 3.));
  // paint layer
  float pn = pfbm(uv, vec2(3.), 7, .56);
  float peelMask = pn + (pfbm(uv + .5, vec2(12.), 4, .5) - .5) * .25;
  float thr = ${opts.peel ?? '0.36'};
  float paintA = smoothstep(thr, thr + .018, peelMask);
  float edge = smoothstep(thr - .01, thr + .02, peelMask) - smoothstep(thr + .02, thr + .05, peelMask);
  float wash = pfbm(uv + .21, vec2(4.), 5, .5);
  float streak = pfbm(vec2(uv.x * 1., uv.y * .12), vec2(16., 2.), 4, .5);
  vec3 paint = mix(${paint}, ${paint2}, smoothstep(.3, .75, wash));
  paint *= 0.9 + 0.2 * pfbm(uv + .73, vec2(40.), 3, .5);
  paint *= mix(1., .82, smoothstep(.55, .8, streak)); // weather streaks
  // hairline cracks
  vec4 vc = pvoronoi(uv + (vec2(pfbm(uv, vec2(8.), 3, .5), pfbm(uv + .3, vec2(8.), 3, .5)) - .5) * .05, vec2(5.), .9);
  float crack = (1. - smoothstep(0., .012, vc.w)) * smoothstep(.45, .6, pfbm(uv + .9, vec2(4.), 4, .5));
  vec3 base = mix(under, brick * (0.7 + 0.3 * smoothstep(0., .12, bedge)), bmask * (1. - paintA) * .85);
  alb = mix(base, paint, paintA);
  alb = mix(alb, alb * 1.25 + .03, edge * .7);
  alb *= 1. - crack * .55;
  h = n2 * .25 + n1 * .5 + paintA * .9 + edge * .35 - crack * .8 - (1. - smoothstep(0., .1, bedge)) * bmask * (1. - paintA) * .5;
  h *= .02;
  r = mix(.93, .78, paintA) - n2 * .06;
  ao = 1. - crack * .6 - (1. - paintA) * .08;
}`;

const SURFACES = {
  plasterBlue: {
    size: 1024, normalStrength: 2.2,
    glsl: PLASTER('hex(112.,152.,182.)', 'hex(140.,176.,198.)', 'hex(184.,150.,112.)', { peel: '0.31' }),
  },
  plasterPeach: {
    size: 1024, normalStrength: 2.0,
    glsl: PLASTER('hex(214.,160.,118.)', 'hex(226.,184.,142.)', 'hex(190.,128.,86.)', { peel: '0.30' }),
  },
  plasterCream: {
    size: 1024, normalStrength: 2.0,
    glsl: PLASTER('hex(226.,210.,184.)', 'hex(236.,224.,204.)', 'hex(188.,146.,104.)', { peel: '0.28' }),
  },
  plasterOchre: {
    size: 512, normalStrength: 2.0,
    glsl: PLASTER('hex(206.,150.,92.)', 'hex(220.,176.,120.)', 'hex(170.,112.,70.)', { peel: '0.26' }),
  },
  plasterWhite: {
    size: 512, normalStrength: 1.8,
    glsl: PLASTER('hex(222.,219.,212.)', 'hex(236.,232.,226.)', 'hex(180.,160.,140.)', { peel: '0.3' }),
  },
  limestone: {
    size: 1024, normalStrength: 1.6,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float n1 = pfbm(uv, vec2(4.), 7, .55);
  float n2 = pfbm(uv + .5, vec2(32.), 4, .5);
  vec4 pv = pvoronoi(uv, vec2(48.), 1.);
  float pore = 1. - smoothstep(.05, .16, pv.x);
  pore *= step(.55, pv.z);
  float veins = smoothstep(.47, .5, pfbm(vec2(uv.x + uv.y * .3, uv.y), vec2(3., 6.), 5, .6)) - smoothstep(.5, .53, pfbm(vec2(uv.x + uv.y * .3, uv.y), vec2(3., 6.), 5, .6));
  vec3 c1 = hex(222., 212., 194.), c2 = hex(204., 186., 160.);
  alb = mix(c1, c2, smoothstep(.35, .7, n1)) * (0.93 + 0.14 * n2);
  alb *= 1. - pore * .35 - veins * .08;
  h = (n1 * .6 + n2 * .3 - pore * .6) * .012;
  r = .74 + n2 * .1;
  ao = 1. - pore * .5;
}` },
  sandstone: {
    size: 1024, normalStrength: 1.8,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  // ashlar blocks
  float rows = 8.;
  float row = floor(uv.y * rows);
  float cols = 4.;
  vec2 q = vec2(uv.x * cols + hash11(row + 3.1) * .5 + mod(row, 2.) * .5, uv.y * rows);
  vec2 f = fract(q); vec2 id = vec2(mod(floor(q.x), cols), row);
  float e = min(min(f.x, 1. - f.x) * (rows / cols) * 1.0, min(f.y, 1. - f.y));
  float joint = 1. - smoothstep(.02, .07, e);
  float n1 = pfbm(uv, vec2(5.), 6, .55);
  float n2 = pfbm(uv + .3, vec2(40.), 3, .5);
  float bh = hash12(id + 7.);
  vec3 c = mix(hex(214.,168.,128.), hex(196.,146.,104.), bh) * (.86 + .28 * n1) * (.94 + .12 * n2);
  alb = mix(c, hex(160.,126.,98.), joint * .8);
  float bulge = smoothstep(0., .25, e);
  h = (bulge * .8 + n1 * .5 + n2 * .2 - joint * .6) * .02;
  r = .86 - n2 * .08;
  ao = 1. - joint * .45;
}` },
  zellige: {
    size: 1024, normalStrength: 1.4,
    glsl: /* glsl */ `
float astroid(vec2 p, float r){ p = abs(p) / r; return pow(p.x, .6) + pow(p.y, .6) - 1.; }
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float N = 6.; // cells per tile
  vec2 g = uv * N; vec2 id = floor(g); vec2 f = fract(g) - .5;
  // centre roundel
  float dc = length(f) - .30;
  // corner four-point stars
  vec2 fc = fract(g + .5) - .5; vec2 idc = floor(g + .5);
  float ds = astroid(fc, .30) * .16;
  // small diamonds between
  float dd = (abs(f.x) + abs(f.y + .5) - .09);
  float dd2 = (abs(f.x + .5) + abs(f.y) - .09);
  float light = min(min(dc, ds), min(dd, dd2));
  float grout = smoothstep(.0, .012, abs(light) - .008);
  float isLight = step(light, 0.);
  // navy field tile seams (square grid, offset)
  vec2 sq = fract(g * 2.) - .5; float seam = smoothstep(.47, .49, max(abs(sq.x), abs(sq.y)));
  float tid = hash12(isLight > .5 ? (light == dc ? id : idc + 50.) : floor(g * 2.) + 99.);
  vec3 navy = mix(hex(24., 38., 58.), hex(36., 56., 80.), tid);
  vec3 cream = mix(hex(222., 214., 196.), hex(236., 230., 214.), tid);
  vec3 c = mix(navy, cream, isLight);
  c = mix(c, hex(150., 140., 120.), (1. - grout) * .9);
  c = mix(c, hex(150., 140., 120.), seam * (1. - isLight) * .8);
  // missing / broken tiles reveal plaster
  float miss = step(.9, hash12(idc + 13.)) * step(.35, pfbm(uv, vec2(3.), 4, .5));
  vec3 plaster = hex(190., 150., 108.) * (.8 + .4 * pfbm(uv, vec2(20.), 4, .5));
  float glaze = pfbm(uv + .6, vec2(30.), 3, .5);
  alb = mix(c * (.92 + .16 * glaze), plaster, miss);
  float bump = smoothstep(0., .06, -light) * isLight;
  h = mix((grout * .7 + bump * .3 - seam * .3) + glaze * .05, -.4 + pfbm(uv, vec2(20.), 3, .5) * .3, miss) * .01;
  r = mix(mix(.22, .9, 1. - grout), .95, miss) + glaze * .08;
  ao = 1. - (1. - grout) * .4 - miss * .2;
}` },
  cobbles: {
    size: 1024, normalStrength: 3.5,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  vec2 warp = (vec2(pfbm(uv, vec2(4.), 3, .5), pfbm(uv + .4, vec2(4.), 3, .5)) - .5) * .06;
  vec4 v = pvoronoi(uv + warp, vec2(9.), .85);
  float sn = pfbm(uv, vec2(64.), 3, .5);
  float edge = v.w; // distance to cell border
  float stone = smoothstep(.02, .11, edge);
  float dome = pow(sat(edge / .45), .45);
  float sand = pfbm(uv + .77, vec2(40.), 5, .55);
  float cid = v.z;
  vec3 sc = mix(hex(150., 132., 112.), hex(176., 160., 138.), cid);
  sc = mix(sc, hex(128., 118., 108.), step(.8, fract(cid * 7.13)) * .8);
  sc *= .85 + .3 * pfbm(uv + cid, vec2(24.), 4, .5);
  vec3 sandc = mix(hex(170., 144., 110.), hex(196., 170., 132.), sand);
  float sandOver = smoothstep(.55, .75, pfbm(uv + .2, vec2(6.), 5, .5)) * .6; // sand drifting over stones
  alb = mix(sandc, sc, stone * (1. - sandOver * (1. - dome)));
  h = (stone * (dome * .9 + sn * .08) + (1. - stone) * sand * .15) * .03;
  r = mix(.97, .72 - sn * .1, stone);
  ao = mix(.55, 1., smoothstep(.0, .2, edge));
}` },
  sand: {
    size: 512, normalStrength: 2.0,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float n = pfbm(uv, vec2(6.), 7, .55);
  vec4 pv = pvoronoi(uv, vec2(40.), 1.);
  float peb = (1. - smoothstep(.12, .25, pv.x)) * step(.7, pv.z);
  alb = mix(hex(168., 142., 110.), hex(198., 172., 136.), n) * (1. - peb * .25);
  h = (n * .4 + peb * .5) * .02;
  r = .96; ao = 1. - peb * .2;
}` },
  wood: {
    size: 1024, normalStrength: 1.6,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float planks = 5.;
  float pid = floor(uv.y * planks);
  float pf = fract(uv.y * planks);
  float gap = 1. - smoothstep(.0, .035, min(pf, 1. - pf));
  float off = hash11(pid + 1.3);
  float grain = pfbm(vec2(uv.x + off, uv.y * 1.), vec2(2., 40.), 5, .6);
  float fine = pfbm(vec2(uv.x * 1. + off, uv.y), vec2(4., 160.), 3, .5);
  float knot = 1. - smoothstep(.0, .05, length((fract(vec2(uv.x * 2. + off, uv.y * planks)) - .5) * vec2(1., .5)) - hash11(pid * 3.1) * .02);
  knot *= step(.6, hash11(pid + 9.));
  vec3 c = mix(hex(92., 62., 40.), hex(142., 104., 68.), grain) * (.88 + .24 * fine) * (.85 + .3 * off);
  float weather = pfbm(uv + .5, vec2(3.), 5, .5);
  c = mix(c, hex(150., 136., 118.), smoothstep(.55, .85, weather) * .55);
  c = mix(c, hex(60., 40., 26.), knot * .8);
  alb = c * (1. - gap * .7);
  h = (grain * .3 + fine * .2 - gap * 1. - knot * .2) * .012;
  r = .82 + fine * .1; ao = 1. - gap * .6;
}` },
  woodDark: {
    size: 512, normalStrength: 1.6,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float grain = pfbm(vec2(uv.x, uv.y), vec2(2., 32.), 5, .6);
  float fine = pfbm(uv, vec2(4., 128.), 3, .5);
  alb = mix(hex(58., 36., 22.), hex(104., 70., 44.), grain) * (.85 + .3 * fine);
  h = (grain * .3 + fine * .2) * .01; r = .7 + fine * .15; ao = 1.;
}` },
  roofTiles: {
    size: 512, normalStrength: 3.0,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float cols = 6., rows = 5.;
  vec2 q = vec2(uv.x * cols, uv.y * rows);
  vec2 id = floor(q); vec2 f = fract(q);
  float barrel = sqrt(sat(1. - pow(abs(f.x - .5) * 2., 2.)));
  float overlap = smoothstep(.0, .25, f.y);
  float t = hash12(mod(id, vec2(cols, rows)) + 5.);
  vec3 c = mix(hex(150., 70., 40.), hex(190., 104., 60.), t) * (.8 + .4 * pfbm(uv, vec2(16.), 4, .5));
  c = mix(c, hex(110., 104., 84.), smoothstep(.6, .9, pfbm(uv + .3, vec2(4.), 4, .5)) * .6); // lichen
  float gapx = smoothstep(.0, .08, min(f.x, 1. - f.x));
  alb = c * (.55 + .45 * gapx) * (.75 + .25 * overlap);
  h = (barrel * .8 - (1. - overlap) * .3) * .03;
  r = .8; ao = mix(.5, 1., gapx * overlap);
}` },
  domeGlaze: {
    size: 512, normalStrength: 1.4,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float rows = 24., cols = 32.;
  float row = floor(uv.y * rows);
  vec2 q = vec2(uv.x * cols + mod(row, 2.) * .5, uv.y * rows);
  vec2 f = fract(q); vec2 id = vec2(mod(floor(q.x), cols), row);
  float e = min(min(f.x, 1. - f.x) * 1.3, min(f.y, 1. - f.y));
  float grout = 1. - smoothstep(.02, .08, e);
  float t = hash12(id + 3.);
  vec3 c = mix(hex(128., 132., 70.), hex(170., 160., 88.), t);
  c = mix(c, hex(92., 116., 76.), step(.85, t) * .7);
  float weather = smoothstep(.55, .8, pfbm(vec2(uv.x, uv.y * .5), vec2(8., 2.), 5, .5));
  c = mix(c, hex(210., 204., 192.), weather * .7);
  alb = mix(c, hex(120., 110., 90.), grout * .8);
  h = (smoothstep(0., .2, e) - grout * .5) * .006;
  r = mix(.28, .9, max(grout, weather * .8)); ao = 1. - grout * .35;
}` },
  rug: {
    size: 1024, normalStrength: 1.2, clamp: true,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  vec3 red = hex(120., 28., 30.), navy = hex(30., 40., 72.), ivory = hex(222., 204., 168.), gold = hex(196., 140., 64.), rose = hex(170., 72., 70.);
  vec2 p = uv - .5; vec2 ap = abs(p);
  float border = max(ap.x / .5, ap.y / .5);
  vec3 c;
  if (border > .86) {
    // outer border: navy with repeating gold/ivory motifs
    float t = (ap.x > ap.y) ? uv.y : uv.x;
    float mot = abs(fract(t * 18.) - .5);
    float band = abs(border - .93) / .07;
    c = navy;
    c = mix(c, gold, step(mot + band * .5, .35));
    c = mix(c, ivory, step(abs(border - .87), .006) + step(abs(border - .995), .006));
    c = mix(c, rose, step(mot + band * .5, .15));
  } else if (border > .8) {
    c = mix(ivory, red, step(.5, fract((ap.x > ap.y ? uv.y : uv.x) * 60.)) * .3);
  } else {
    // field: lattice of diamonds with medallion
    vec2 q = p * vec2(7., 11.);
    vec2 f = fract(q) - .5;
    float dia = abs(f.x) + abs(f.y);
    c = red;
    c = mix(c, navy, step(abs(dia - .42), .05));
    c = mix(c, ivory, step(dia, .12));
    c = mix(c, gold, step(abs(dia - .25), .03));
    float med = length(p * vec2(1.6, 1.)) ;
    float medS = abs(ap.x) * 1.6 + abs(ap.y);
    c = mix(c, navy, step(medS, .34));
    c = mix(c, ivory, step(abs(medS - .3), .012));
    c = mix(c, gold, step(medS, .18) * step(.12, medS));
    c = mix(c, red, step(med, .07));
  }
  float weave = pfbm(uv, vec2(180.), 2, .5);
  float wear = smoothstep(.5, .85, pfbm(uv, vec2(5.), 5, .5));
  alb = c * (.8 + .3 * weave) * (1. - wear * .25) + wear * .03;
  h = weave * .004; r = .95; ao = 1.;
}` },
  fabricTan: { size: 512, normalStrength: 1.0, glsl: stripeSurf([['hex(196.,154.,108.)', 0.16], ['hex(170.,126.,82.)', 0.02], ['hex(206.,168.,122.)', 0.2], ['hex(150.,104.,66.)', 0.015], ['hex(196.,154.,108.)', 0.1]]) },
  fabricRed: { size: 512, normalStrength: 1.0, glsl: stripeSurf([['hex(150.,50.,46.)', 0.06], ['hex(220.,170.,150.)', 0.018], ['hex(176.,78.,70.)', 0.05], ['hex(222.,190.,170.)', 0.012], ['hex(120.,36.,36.)', 0.03]]) },
  fabricTeal: { size: 512, normalStrength: 1.0, glsl: stripeSurf([['hex(40.,70.,76.)', 0.12], ['hex(214.,200.,170.)', 0.035], ['hex(58.,96.,98.)', 0.08], ['hex(170.,80.,54.)', 0.015], ['hex(214.,200.,170.)', 0.02], ['hex(40.,70.,76.)', 0.05]]) },
  fabricPink: { size: 256, normalStrength: 1.0, glsl: stripeSurf([['hex(224.,150.,140.)', 0.2], ['hex(240.,200.,186.)', 0.03], ['hex(206.,120.,112.)', 0.04]]) },
  fabricIndigo: { size: 256, normalStrength: 1.0, glsl: stripeSurf([['hex(38.,48.,96.)', 0.25], ['hex(200.,190.,170.)', 0.02], ['hex(52.,66.,120.)', 0.1]]) },
  fabricSaffron: { size: 256, normalStrength: 1.0, glsl: stripeSurf([['hex(214.,150.,50.)', 0.3], ['hex(180.,110.,30.)', 0.05]]) },
  fabricCream: { size: 256, normalStrength: 1.0, glsl: stripeSurf([['hex(226.,214.,190.)', 0.4], ['hex(206.,190.,160.)', 0.02]]) },
  brass: {
    size: 256, normalStrength: 0.6,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  a = 1.; m = 1.;
  float n = pfbm(uv, vec2(6.), 6, .55);
  float pat = smoothstep(.55, .75, pfbm(uv + .3, vec2(4.), 5, .5));
  alb = mix(hex(214., 164., 84.), hex(120., 110., 70.), pat * .8);
  m = 1. - pat * .7;
  h = n * .004; r = .28 + n * .25 + pat * .4; ao = 1.;
}` },
  iron: {
    size: 256, normalStrength: 0.8,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  a = 1.;
  float n = pfbm(uv, vec2(8.), 6, .55);
  float rust = smoothstep(.5, .8, pfbm(uv + .5, vec2(5.), 5, .5));
  alb = mix(hex(46., 42., 40.), hex(120., 62., 34.), rust);
  m = 1. - rust; h = (n + rust * .5) * .006; r = .55 + rust * .35; ao = 1.;
}` },
  terracotta: {
    size: 512, normalStrength: 1.0,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float n = pfbm(uv, vec2(5.), 6, .55);
  float rings = pfbm(vec2(uv.x * .2, uv.y), vec2(1., 60.), 3, .5);
  float salt = smoothstep(.62, .85, pfbm(uv + .2, vec2(4.), 5, .5));
  alb = mix(hex(164., 82., 48.), hex(196., 116., 72.), n) * (.92 + .16 * rings);
  alb = mix(alb, hex(206., 190., 170.), salt * .5);
  h = (n * .5 + rings * .3) * .008; r = .86; ao = 1.;
}` },
  ivyLeaf: {
    size: 512, normalStrength: 1.5, clamp: true,
    glsl: /* glsl */ `
// 2x2 atlas of ivy leaves
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.;
  vec2 cell = floor(uv * 2.); vec2 f = fract(uv * 2.) * 2. - 1.;
  float v = hash12(cell + 2.);
  vec2 p = f * vec2(1., 1.) + vec2(0., .15);
  float ang = atan(p.x, p.y);
  float rad = length(p);
  // 5-lobed ivy silhouette
  float lobes = .62 + .2 * cos(ang * 5.) * smoothstep(.0, 1., abs(ang) / 3.1416 + .2) + .12 * cos(ang * 2.);
  lobes *= mix(.9, 1.05, v);
  float inside = smoothstep(lobes, lobes - .03, rad);
  float stem = step(abs(p.x), .025) * step(p.y, -.2) * step(-.95, p.y);
  a = max(inside, stem);
  float vein = 1. - smoothstep(.0, .025, abs(fract(ang * 5. / 6.2832 + .5) - .5) * rad);
  vec3 dark = mix(hex(40., 64., 30.), hex(58., 74., 34.), v);
  vec3 light = mix(hex(92., 120., 52.), hex(120., 128., 58.), v);
  alb = mix(dark, light, smoothstep(.1, .8, rad)) ;
  alb = mix(alb, hex(150., 160., 90.), vein * .35 * inside);
  alb = mix(alb, hex(150., 110., 60.), step(.82, v) * .5); // few autumn leaves
  h = (1. - rad) * .02 - vein * .004; r = .55; ao = 1.;
}` },
  grass: {
    size: 256, normalStrength: 0.5, clamp: true,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 0.;
  for (int i = 0; i < 14; i++){
    float fi = float(i);
    float x0 = .15 + .7 * hash11(fi * 3.7);
    float lean = (hash11(fi * 9.1) - .5) * .7;
    float len = .45 + .5 * hash11(fi * 1.3);
    float x = x0 + lean * uv.y * uv.y;
    float w = .018 * (1. - uv.y / len);
    a = max(a, step(abs(uv.x - x), w) * step(uv.y, len));
  }
  alb = mix(hex(120., 104., 60.), hex(186., 164., 104.), uv.y);
  h = 0.; r = .9; ao = mix(.5, 1., uv.y);
}` },
  blossom: {
    size: 256, normalStrength: 1.0, clamp: true,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.;
  vec2 cell = floor(uv * 2.); vec2 f = fract(uv * 2.) * 2. - 1.;
  float v = hash12(cell + 7.);
  float ang = atan(f.y, f.x); float rad = length(f);
  float petals = .55 + .35 * pow(abs(cos(ang * 2.5 + v * 3.)), .7);
  a = smoothstep(petals, petals - .06, rad);
  vec3 c = mix(hex(214., 70., 140.), hex(236., 120., 176.), v);
  alb = mix(hex(250., 230., 170.), c, smoothstep(.08, .25, rad));
  h = (1. - rad) * .01; r = .6; ao = 1.;
}` },
  lattice: {
    size: 512, normalStrength: 1.0,
    glsl: /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.;
  vec2 g = fract(uv * 8.) - .5;
  float d1 = abs(abs(g.x) + abs(g.y) - .35);
  float d2 = min(abs(g.x), abs(g.y));
  float bar = min(d1, d2 * 1.2);
  a = 1. - smoothstep(.055, .075, bar);
  float grain = pfbm(uv, vec2(4., 64.), 3, .5);
  alb = mix(hex(70., 44., 26.), hex(112., 76., 46.), grain);
  h = (1. - smoothstep(0., .07, bar)) * .01; r = .75; ao = 1.;
}` },
};

function stripeSurf(stripes) {
  // stripes: [colorExpr, width] pattern repeated across u; weave normal
  const total = stripes.reduce((s, x) => s + x[1], 0);
  let code = '';
  let acc = 0;
  stripes.forEach(([c, w], i) => {
    acc += w / total;
    code += `${i === 0 ? '' : 'else '}if (t < ${acc.toFixed(5)}) c = ${c};\n`;
  });
  return /* glsl */ `
void surf(vec2 uv, out vec3 alb, out float h, out float r, out float ao, out float m, out float a){
  m = 0.; a = 1.;
  float t = fract(uv.x * 2.);
  vec3 c = vec3(0.);
  ${code}
  else c = ${stripes[stripes.length - 1][0]};
  float wx = sin(uv.x * 6.2832 * 220.), wy = sin(uv.y * 6.2832 * 220.);
  float weave = .5 + .25 * wx * sign(wy) ;
  float dirt = pfbm(uv, vec2(4.), 5, .5);
  float fade = pfbm(uv + .3, vec2(2.), 4, .5);
  alb = c * (.9 + .12 * weave) * (.82 + .3 * dirt);
  alb = mix(alb, alb * 1.15 + .02, smoothstep(.55, .8, fade) * .5);
  h = weave * .0015 + dirt * .002; r = .92; ao = 1.;
}`;
}

export const SURFACE_NAMES = Object.keys(SURFACES);

export function bakeAll(baker, names = SURFACE_NAMES, onProgress) {
  const out = {};
  names.forEach((n, i) => {
    out[n] = baker.bake({ name: n, ...SURFACES[n] });
    onProgress && onProgress((i + 1) / names.length, n);
  });
  return out;
}
