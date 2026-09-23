import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { crateMesh, barrel, pot, rugRoll, sack, basket, cart, stool, lanternMesh } from '../assets/props.js';
import { dome, finial } from '../assets/architecture.js';

// Exports every swappable procedural asset as a GLB blockout (true size, pivot at
// the base centre, flat PBR colours) so an artist or Codex Astra can match it.
const COLORS = {
  wood: '#8a6446', woodDark: '#4a3322', iron: '#3a3634', brass: '#c79a4a', terracotta: '#b0613d', rug: '#7a1e1e',
  fabricTan: '#c49a6c', fabricCream: '#e2d6be', ropeMat: '#b8a58a', domeGlaze: '#8a8a4e', plasterWhite: '#dcd8cf',
  limestone: '#d8cdbd', darkInterior: '#140d09', glassGlow: '#ffc27a', goldLeaf: '#e0b060', zellige: '#1d2a3a',
};
const METAL = { iron: 0.9, brass: 1, goldLeaf: 1 };

function collector() {
  const group = new THREE.Group();
  const mats = {};
  const matFor = (name) => {
    const key = typeof name === 'string' ? name : name.name || 'mat';
    if (!mats[key]) mats[key] = new THREE.MeshStandardMaterial({ name: key, color: COLORS[key] || '#b0a090', roughness: METAL[key] ? 0.35 : 0.85, metalness: METAL[key] || 0 });
    return mats[key];
  };
  const K = {
    add(geo, mat, m = null) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (m) g.applyMatrix4(m);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      group.add(new THREE.Mesh(g, matFor(mat)));
    },
  };
  return { K, group };
}

export async function runExport() {
  const fakeMats = { get: (n) => new THREE.MeshStandardMaterial({ name: n, color: COLORS[n] || '#b0a090', roughness: 0.8, metalness: METAL[n] || 0 }) };
  const assets = {
    crate: () => crateMesh(fakeMats, 1),
    lantern: () => lanternMesh(fakeMats, { s: 1 }),
    barrel: (K) => barrel(K, 0, 0, 0),
    pot_amphora: (K) => pot(K, 0, 0, 0, { kind: 'amphora' }),
    pot_jar: (K) => pot(K, 0, 0, 0, { kind: 'jar' }),
    pot_tall: (K) => pot(K, 0, 0, 0, { kind: 'tall' }),
    pot_planter: (K) => pot(K, 0, 0, 0, { kind: 'planter' }),
    pot_bowl: (K) => pot(K, 0, 0, 0, { kind: 'bowl' }),
    rug_roll: (K) => rugRoll(K, 0, 0, 0, { lean: 0 }),
    sack: (K) => sack(K, 0, 0, 0),
    basket: (K) => basket(K, 0, 0, 0),
    cart: (K) => cart(K, 0, 0, 0),
    stool: (K) => stool(K, 0, 0, 0),
    dome: (K) => dome(K, { x: 0, y: 0, z: 0, r: 5 }),
    finial: (K) => finial(K, { x: 0, y: 0, z: 0, s: 1 }),
  };
  const out = {};
  const exporter = new GLTFExporter();
  for (const [name, fn] of Object.entries(assets)) {
    const { K, group } = collector();
    const obj = fn(K) || group;
    const root = obj.isObject3D && obj !== undefined && obj !== true ? obj : group;
    root.name = name;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const buf = await exporter.parseAsync(root, { binary: true });
    const bytes = new Uint8Array(buf);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    let tris = 0; root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    out[name] = { b64: btoa(bin), size: box.getSize(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)), tris: Math.round(tris) };
  }
  window.__export = out;
  window.__ready = true;
}
