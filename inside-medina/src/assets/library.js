import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchMaterial } from '../render/atmosphere.js';

// ---------------------------------------------------------------------------
// Asset override slot. Any procedural asset can be replaced by a GLB listed in
// public/assets/models/manifest.json, e.g. models from Codex Astra:
//   { "models": [ { "name": "barrel", "file": "barrel.glb" } ] }
// Contract (see docs/ASTRA_ASSET_BRIEF.md): metres, +Y up, front faces +Z,
// pivot at the centre of the base (y = 0), PBR metal/rough materials.
// ---------------------------------------------------------------------------
export const Overrides = {
  models: new Map(),
  envMap: null,
  async load(base = './assets/models/', envMap = null) {
    this.envMap = envMap;
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
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const mat of mats) {
            if (mat.userData.medina) continue;
            if (this.envMap && 'envMap' in mat) { mat.envMap = this.envMap; mat.envMapIntensity = 0.6; }
            if (mat.map) mat.map.anisotropy = 8;
            patchMaterial(mat, {});
            mat.userData.medina = true;
          }
        });
        this.models.set(m.name, root);
        console.info(`[assets] override loaded: ${m.name} <- ${m.file}`);
      } catch (e) { console.warn(`[assets] failed to load ${m.file}`, e); }
    }));
    return this.models.size;
  },
  has(name) { return this.models.has(name); },
  // dynamic instance (own meshes)
  instance(name) {
    const src = this.models.get(name);
    const c = src.clone(true);
    return c;
  },
  // static placement: merge into the level batcher with a world matrix
  place(K, name, matrix) {
    const src = this.models.get(name);
    src.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!g.attributes.color) {
        const n = g.attributes.position.count; const c = new Float32Array(n * 3).fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
        mat.vertexColors = false;
      }
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      K.add(g, mat, matrix);
    });
    return true;
  },
};
