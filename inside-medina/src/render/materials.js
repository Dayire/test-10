import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { patchMaterial } from './atmosphere.js';
import { SURFACES } from './textures.js';

// The low tier's far set (FULL_GAME §8.5): distant static geometry of every plain opaque material merges into one
// material per chunk. Each vertex names its source material in a palette (a PAL_N × 1 texture: the material's mean
// albedo, read from the smallest mip of its baked map, times its colour), so the far city keeps its colours, its
// vertex grime, its lighting, shadows and fog and loses only texture detail, in one draw instead of one per material.
// The palette's alpha is the material's metalness
const PAL_N = 64;
const PAINT = new THREE.ShaderMaterial({
  uniforms: { map: { value: null }, color: { value: new THREE.Color() }, useMap: { value: 0 }, metal: { value: 0 } },
  vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: 'uniform sampler2D map; uniform vec3 color; uniform float useMap, metal;\nvoid main() { vec3 c = useMap > .5 ? texture2D(map, vec2(.5), 16.).rgb : vec3(1.); gl_FragColor = vec4(c * color, metal); }',
  depthTest: false, depthWrite: false,
});
// a material the far set can stand in for: lit, opaque, one-sided, not emissive, cut out, swaying or translucent
export function farEligible(m) {
  return !!m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.transparent && !(m.alphaTest > 0) && m.side === THREE.FrontSide &&
    !(m.emissive && m.emissiveIntensity > 0 && m.emissive.getHex() !== 0) && m.defines?.USE_WIND === undefined && m.defines?.USE_TRANSLUCENCY === undefined;
}

// Material library. Geometry UVs are authored in metres; each material maps
// one texture tile to `tile` metres through a per-material UV scale.
// Cached materials live for the whole session (chapters never dispose them).
// A surface that was not baked yet is baked on first use.
export class Materials {
  static envScale = 1;
  constructor(tex, envMap, { baker = null } = {}) {
    this.tex = tex;
    this.envMap = envMap;
    this.baker = baker;
    this.cache = new Map();
    this.palette = []; // far-set entries: { mat, painted }
  }

  // ---- the far set (see PAL_N above)
  paletteIndex(mat) {
    let i = this.palette.findIndex((e) => e.mat === mat);
    if (i < 0 && this.palette.length < PAL_N) { i = this.palette.length; this.palette.push({ mat, painted: false }); }
    return i;
  }
  farSet() {
    if (this.cache.has('farSet')) return this.cache.get('farSet');
    this.palRT = new THREE.WebGLRenderTarget(PAL_N, 1, { type: THREE.UnsignedByteType, colorSpace: THREE.SRGBColorSpace, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false });
    this.palRT.texture.name = 'farPalette';
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true, envMap: this.envMap, envMapIntensity: Materials.envScale });
    patchMaterial(m, {});
    const base = m.onBeforeCompile, key = m.customProgramCacheKey, pal = { value: this.palRT.texture };
    m.customProgramCacheKey = () => `${key()}-far`;
    m.onBeforeCompile = (shader, r) => {
      base(shader, r);
      shader.uniforms.uPalette = pal;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float pal; varying float vPal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPal = pal;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uPalette; varying float vPal;')
        .replace('#include <color_fragment>', `#include <color_fragment>\n  vec4 palC = texture2D(uPalette, vec2((vPal + .5) / ${PAL_N}., .5));\n  diffuseColor.rgb *= palC.rgb;`)
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = palC.a;');
    };
    m.name = 'farSet';
    m.userData.envInt = 1;
    this.cache.set('farSet', m);
    return m;
  }
  // paint the entries not painted yet (after the bake that drew their maps; all of them again after a re-bake)
  paintPalette(renderer) {
    if (!this.palRT) return 0;
    const gen = this.baker?.generation ?? 0;
    if (this._palGen !== gen) { this._palGen = gen; for (const e of this.palette) e.painted = false; }
    const todo = this.palette.map((e, i) => [e, i]).filter(([e]) => !e.painted);
    if (!todo.length) return 0;
    const q = this._palQuad || (this._palQuad = new FullScreenQuad(PAINT)), prev = renderer.getRenderTarget(), rt = this.palRT, U = PAINT.uniforms;
    for (const [e, i] of todo) {
      U.map.value = e.mat.map; U.useMap.value = e.mat.map ? 1 : 0; U.color.value.copy(e.mat.color); U.metal.value = e.mat.metalness;
      rt.viewport.set(i, 0, 1, 1); rt.scissor.set(i, 0, 1, 1); rt.scissorTest = true;
      renderer.setRenderTarget(rt); q.render(renderer);
      e.painted = true;
    }
    rt.viewport.set(0, 0, PAL_N, 1); rt.scissorTest = false; U.map.value = null;
    renderer.setRenderTarget(prev);
    return todo.length;
  }

  // baked texture set for a surface, baking it now if a chapter forgot to list it
  surface(name) {
    if (!this.tex[name] && this.baker && SURFACES[name]) {
      console.warn(`surface ${name} baked on demand (add it to the chapter's needs)`);
      this.tex[name] = this.baker.bake({ name, ...SURFACES[name] });
    }
    return this.tex[name];
  }

  // chapter-specific material definitions (same schema as MATERIAL_DEFS)
  register(defs) { for (const [k, v] of Object.entries(defs)) if (!MATERIAL_DEFS[k]) MATERIAL_DEFS[k] = v; }

  // swap the environment map and/or its intensity scale on every cached material
  setEnv(tex, scale) {
    if (tex) this.envMap = tex;
    if (scale !== undefined && scale !== null) Materials.envScale = scale;
    for (const m of this.cache.values()) {
      if (!('envMap' in m) || !m.envMap) continue;
      if (tex) m.envMap = tex;
      m.envMapIntensity = (m.userData.envInt ?? 1) * Materials.envScale;
    }
  }

  std(name, surf, { tile = 2, color = 0xffffff, rough = 1, metal = 0, normalScale = 1, vertexColors = true, envInt = 1, side, alphaTest, sway, translucency, translucencyColor, emissive, emissiveIntensity, physical, transparent, opacity } = {}) {
    if (this.cache.has(name)) return this.cache.get(name);
    const t = surf ? this.surface(surf) : null;
    const Ctor = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
    const m = new Ctor({
      color, roughness: rough, metalness: metal,
      map: t?.map || null,
      normalMap: t?.normalMap || null,
      roughnessMap: t?.ormMap || null,
      metalnessMap: metal > 0 ? (t?.ormMap || null) : null,
      aoMap: t?.ormMap || null,
      aoMapIntensity: 1,
      vertexColors,
      envMap: this.envMap,
      envMapIntensity: envInt * Materials.envScale,
    });
    if (physical) Object.assign(m, physical);
    if (t?.normalMap) m.normalScale.set(normalScale, normalScale);
    if (side !== undefined) m.side = side;
    if (alphaTest !== undefined) { m.alphaTest = alphaTest; m.alphaToCoverage = true; }
    if (emissive !== undefined) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity ?? 1; }
    if (transparent) { m.transparent = true; m.opacity = opacity ?? 1; m.depthWrite = false; }
    patchMaterial(m, { uvScale: 1 / tile, sway, translucency, translucencyColor });
    m.name = name;
    m.userData.envInt = envInt;
    this.cache.set(name, m);
    return m;
  }

  get(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const def = MATERIAL_DEFS[name];
    if (!def) throw new Error(`unknown material ${name}`);
    return this.std(name, def.surf, def);
  }
}

const DS = THREE.DoubleSide;
export const MATERIAL_DEFS = {
  plasterBlue: { surf: 'plasterBlue', tile: 3.2, normalScale: 1 },
  plasterPeach: { surf: 'plasterPeach', tile: 3.2 },
  plasterCream: { surf: 'plasterCream', tile: 3.2 },
  plasterOchre: { surf: 'plasterOchre', tile: 3.0 },
  plasterWhite: { surf: 'plasterWhite', tile: 3.0 },
  limestone: { surf: 'limestone', tile: 1.6 },
  sandstone: { surf: 'sandstone', tile: 3.0 },
  zellige: { surf: 'zellige', tile: 1.2, envInt: 1.4 },
  cobbles: { surf: 'cobbles', tile: 2.6, normalScale: 1.2 },
  sand: { surf: 'sand', tile: 3 },
  wood: { surf: 'wood', tile: 1.4 },
  woodDark: { surf: 'woodDark', tile: 1.2 },
  roofTiles: { surf: 'roofTiles', tile: 1.3 },
  domeGlaze: { surf: 'domeGlaze', tile: 1, envInt: 1.6 },
  rug: { surf: 'rug', tile: 1, side: DS },
  fabricTan: { surf: 'fabricTan', tile: 1.6, side: DS, sway: 1, translucency: 0.55, translucencyColor: 0xffc890 },
  fabricRed: { surf: 'fabricRed', tile: 1.2, side: DS, sway: 1, translucency: 0.55, translucencyColor: 0xffb090 },
  fabricTeal: { surf: 'fabricTeal', tile: 1.8, side: DS, sway: 1, translucency: 0.6, translucencyColor: 0xd8f0d0 },
  fabricPink: { surf: 'fabricPink', tile: 1.2, side: DS, sway: 1, translucency: 0.7, translucencyColor: 0xffc0b0 },
  fabricIndigo: { surf: 'fabricIndigo', tile: 1.0, side: DS, sway: 1, translucency: 0.4 },
  fabricSaffron: { surf: 'fabricSaffron', tile: 1.0, side: DS, sway: 1, translucency: 0.6 },
  fabricCream: { surf: 'fabricCream', tile: 1.0, side: DS, sway: 1, translucency: 0.7 },
  brass: { surf: 'brass', tile: 0.5, metal: 1, rough: 1, envInt: 1.3 },
  iron: { surf: 'iron', tile: 0.6, metal: 1, rough: 1 },
  terracotta: { surf: 'terracotta', tile: 0.8 },
  ivy: { surf: 'ivyLeaf', tile: 1, side: DS, alphaTest: 0.45, sway: 1, translucency: 0.9, translucencyColor: 0xc8ff80 },
  blossom: { surf: 'blossom', tile: 1, side: DS, alphaTest: 0.45, sway: 1, translucency: 0.8, translucencyColor: 0xffa0d0 },
  grass: { surf: 'grass', tile: 1, side: DS, alphaTest: 0.4, sway: 1, translucency: 0.8, translucencyColor: 0xfff0a0 },
  lattice: { surf: 'lattice', tile: 1.0, side: DS, alphaTest: 0.5 },
  cypress: { surf: 'sand', tile: 2, color: 0x33452a, rough: 0.95, envInt: 0.4, translucency: 0.3, translucencyColor: 0x80a060 },
  woodPlank: { surf: 'woodPlank', tile: 1.2 },
  glazeGreen: { surf: 'glaze', tile: 0.6, color: 0x5a8c4c, envInt: 1.4 },
  glazeCobalt: { surf: 'glaze', tile: 0.6, color: 0x3d66b4, envInt: 1.4 },
  glazeWhite: { surf: 'glaze', tile: 0.6, color: 0xf4ecdc, envInt: 1.3 },
  glazeTile: { surf: 'glaze', tile: 0.9, color: 0x4e8a55, envInt: 1.6 },
  wicker: { surf: 'wicker', tile: 0.45 },
  burlap: { surf: 'burlap', tile: 0.6, translucency: 0.12 },
  spicePaprika: { surf: 'powder', tile: 0.35, color: 0xc8421e },
  spiceTurmeric: { surf: 'powder', tile: 0.35, color: 0xe6a824 },
  spiceCumin: { surf: 'powder', tile: 0.35, color: 0x9c6a36 },
  spiceHenna: { surf: 'powder', tile: 0.35, color: 0x74903c },
  spiceRose: { surf: 'powder', tile: 0.35, color: 0xbc5a7a },
  stain: { surf: null, color: 0x3a2c22, rough: 1, transparent: true, opacity: 0.35, envInt: 0 },
  glassGlow: { surf: null, color: 0xffc27a, rough: 0.3, emissive: 0xffa550, emissiveIntensity: 3.0, vertexColors: false },
  darkInterior: { surf: null, color: 0x140d09, rough: 1, vertexColors: false, envInt: 0 },
  ropeMat: { surf: 'fabricCream', tile: 0.3, color: 0xb8a58a },
  goldLeaf: { surf: 'brass', tile: 0.4, metal: 1, rough: 0.6, color: 0xffe0a0, envInt: 1.6 },
  skin: { surf: null, color: 0x9c7560, rough: 0.6, vertexColors: false, translucency: 0.25, translucencyColor: 0xff8060 },
  hair: { surf: null, color: 0x24170f, rough: 0.7, vertexColors: false },
  tunicRed: { surf: 'fabricRed', tile: 0.6, color: 0xffffff, vertexColors: false, translucency: 0.2 },
  clothRed: { surf: null, color: 0xa3281e, rough: 0.85, vertexColors: false, translucency: 0.25, translucencyColor: 0xff7050 },
  clothTrousers: { surf: null, color: 0x52422f, rough: 0.92, vertexColors: false },
  clothScarf: { surf: 'fabricCream', tile: 1.0, color: 0xd9c7a2, rough: 0.95, vertexColors: false, side: DS, translucency: 0.2 },
  leather: { surf: null, color: 0x3a2518, rough: 0.7, vertexColors: false },
  robeDark: { surf: 'fabricIndigo', tile: 0.8, color: 0x7a7f96, vertexColors: false, side: DS },
  robeGuard: { surf: null, color: 0x2b2a33, rough: 0.9, vertexColors: false, side: DS },
  wrapGuard: { surf: null, color: 0x4a3c30, rough: 0.9, vertexColors: false, side: DS },
};
