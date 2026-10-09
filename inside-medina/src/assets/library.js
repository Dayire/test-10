import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchMaterial } from '../render/atmosphere.js';
import { MATERIAL_DEFS } from '../render/materials.js';

// ---------------------------------------------------------------------------
// Asset override slot. Any procedural asset can be replaced by a GLB listed in
// public/assets/models/manifest.json (made in Blender, by Codex Astra, ...):
//   { "models": [ { "name": "barrel", "file": "barrel.glb" } ] }
// Contract (see docs/BLENDER_BRIEF.md): metres, +Y up, front faces +Z, pivot
// per slot, PBR metal/rough materials. A GLB material named after a game
// material ("rug", "burlap", "brass", ...) is swapped for the game's own, with
// UVs read as metres. "fabric" and "spice" are placeholders that each
// placement fills in. A float vertex attribute "_SWAY" (0 where the cloth is
// pinned, ~0.1-0.2 where it hangs free) drives the wind.
// ---------------------------------------------------------------------------
export const Overrides = {
  models: new Map(),
  used: new Set(), // names placed since the last clear (asset sheet labels)
  envMap: null,
  mats: null,
  async load(base = './assets/models/', envMap = null, mats = null) {
    this.envMap = envMap;
    this.mats = mats;
    let manifest;
    try {
      const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
      if (!r.ok) return 0;
      manifest = await r.json();
    } catch { return 0; }
    const list = (manifest.models || []).filter((m) => m && m.name && m.file);
    if (!list.length) return 0;
    const loader = new GLTFLoader();
    await Promise.all(list.map(async (m) => {
      try {
        const gltf = await loader.loadAsync(base + m.file);
        const root = gltf.scene;
        if (m.scale) root.scale.setScalar(m.scale);
        if (m.rotationY) root.rotation.y = m.rotationY;
        if (m.offset) root.position.fromArray(m.offset);
        root.updateMatrixWorld(true);
        root.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true; o.receiveShadow = true;
          const geo = o.geometry;
          if (geo.attributes._sway) { geo.setAttribute('sway', geo.attributes._sway); geo.deleteAttribute('_sway'); }
          const list = (Array.isArray(o.material) ? o.material : [o.material]).map((mat) => {
            if (this.mats && MATERIAL_DEFS[mat.name]) {
              const gm = this.mats.get(mat.name);
              if (gm.vertexColors && !geo.attributes.color) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
              return gm;
            }
            if (!mat.userData.medina) {
              if (this.envMap && 'envMap' in mat) { mat.envMap = this.envMap; mat.envMapIntensity = 0.6; }
              if (mat.map) mat.map.anisotropy = 8;
              patchMaterial(mat, {});
              mat.userData.medina = true;
            }
            return mat;
          });
          o.material = Array.isArray(o.material) ? list : list[0];
        });
        this.models.set(m.name, root);
        console.info(`[assets] override loaded: ${m.name} <- ${m.file}`);
      } catch (e) { console.warn(`[assets] failed to load ${m.file}`, e); }
    }));
    return this.models.size;
  },
  has(name) { if (!this.models.has(name)) return false; this.used.add(name); return true; },
  // dynamic instance (own meshes)
  instance(name) {
    const src = this.models.get(name);
    const c = src.clone(true);
    return c;
  },
  // static placement: merge into the level batcher with a world matrix.
  // remap: { placeholder material -> game material }, e.g. { fabric: 'fabricRed' }
  place(K, name, matrix, remap = {}) {
    const src = this.models.get(name);
    src.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = remap[mat.name] ?? mat.name;
      if (MATERIAL_DEFS[key]) { K.add(g, key, matrix); return; }
      if (!g.attributes.color) {
        g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        mat.vertexColors = false;
      }
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      K.add(g, mat, matrix);
    });
    return true;
  },
};
