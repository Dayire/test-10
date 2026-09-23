import * as THREE from 'three';
import { rng } from './geom.js';

// Leaves are camera-independent cards batched into one geometry per call.
// Atlas: 2x2 cells in the ivyLeaf texture. `sway` grows along hanging strands.

class LeafBuilder {
  constructor() { this.pos = []; this.uv = []; this.nor = []; this.sw = []; this.idx = []; this.n = 0; }
  leaf(c, normal, size, rot, cell, sway, tilt = 0) {
    const n = normal.clone().normalize();
    const up = Math.abs(n.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    let t = new THREE.Vector3().crossVectors(up, n).normalize();
    let b = new THREE.Vector3().crossVectors(n, t).normalize();
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const tt = t.clone().multiplyScalar(cr).addScaledVector(b, sr);
    const bb = b.clone().multiplyScalar(cr).addScaledVector(t, -sr);
    // tilt the card away from the wall a bit so it catches light
    const nn = n.clone().addScaledVector(bb, tilt).normalize();
    const h = size / 2;
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    const cu = (cell % 2) * 0.5, cv = Math.floor(cell / 2) * 0.5;
    const uvs = [[cu, cv], [cu + 0.5, cv], [cu + 0.5, cv + 0.5], [cu, cv + 0.5]];
    for (let i = 0; i < 4; i++) {
      const [a, bq] = corners[i];
      const p = c.clone().addScaledVector(tt, a).addScaledVector(bb, bq).addScaledVector(n, (bq + h) * tilt * 0.6);
      this.pos.push(p.x, p.y, p.z); this.nor.push(nn.x, nn.y, nn.z); this.uv.push(uvs[i][0], uvs[i][1]); this.sw.push(sway);
    }
    const o = this.n; this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sw, 1));
    const col = new Float32Array(this.n * 3).fill(1);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(this.idx);
    return g;
  }
}

// Ivy hanging from a horizontal edge (x0..x1 at height y, wall face at z facing +z)
export function ivyCurtain(K, { x0, x1, y, z, density = 1, maxLen = 3, minLen = 0.4, seed = 1, normal = new THREE.Vector3(0, 0, 1), flowers = 0 }) {
  const r = rng(seed);
  const L = new LeafBuilder();
  const F = new LeafBuilder();
  const strands = Math.max(1, Math.round((x1 - x0) * 5 * density));
  for (let s = 0; s < strands; s++) {
    const sx = x0 + r() * (x1 - x0);
    const len = minLen + Math.pow(r(), 1.6) * (maxLen - minLen);
    const out = r.range(0.02, 0.18);
    let px = sx, pz = z + 0.03 + out * 0.3, py = y + 0.05;
    const steps = Math.max(3, Math.round(len / 0.055));
    const wig = r.range(0.5, 2.0), ph = r() * 6;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      px = sx + Math.sin(t * wig * 3 + ph) * 0.08;
      pz = z + 0.03 + out * Math.sin(Math.min(1, t * 3) * Math.PI / 2) + Math.sin(t * 5 + ph) * 0.03;
      py = y + 0.05 - t * len;
      const nrm = normal.clone().add(new THREE.Vector3(r.range(-0.5, 0.5), r.range(-0.2, 0.6), r.range(0, 0.4))).normalize();
      const size = r.range(0.07, 0.13) * (1 - t * 0.35);
      const c = new THREE.Vector3(px + r.range(-0.05, 0.05), py, pz + r.range(0, 0.05));
      L.leaf(c, nrm, size, r() * 6.28, Math.floor(r() * 4), 0.02 + t * t * 0.35 * len / 2, r.range(0.1, 0.5));
      if (r() < 0.5) L.leaf(c.clone().add(new THREE.Vector3(r.range(-0.06, 0.06), r.range(-0.03, 0.03), 0.02)), nrm, size * 0.85, r() * 6.28, Math.floor(r() * 4), 0.02 + t * t * 0.35 * len / 2, 0.3);
      if (flowers > 0 && r() < flowers * 0.25) F.leaf(c.clone().add(new THREE.Vector3(0, 0, 0.04)), nrm, size * 0.8, r() * 6.28, Math.floor(r() * 4), 0.02 + t * t * 0.3, 0.2);
    }
  }
  // a mat of leaves along the top edge
  const mat = Math.round((x1 - x0) * 40 * density);
  for (let i = 0; i < mat; i++) {
    const c = new THREE.Vector3(x0 + r() * (x1 - x0), y + r.range(-0.12, 0.2), z + r.range(0.0, 0.2));
    const nrm = new THREE.Vector3(r.range(-0.4, 0.4), r.range(0.3, 1), r.range(0.3, 1));
    L.leaf(c, nrm, r.range(0.08, 0.15), r() * 6.28, Math.floor(r() * 4), 0.02, 0.3);
  }
  K.add(L.geometry(), 'ivy', null, { cast: true });
  if (F.n) K.add(F.geometry(), 'blossom', null, { cast: false });
}

// Ivy climbing over a wall region (patch), leaves lying on the wall
export function ivyPatch(K, { x0, x1, y0, y1, z, density = 1, seed = 2, normal = new THREE.Vector3(0, 0, 1), axis = 'z' }) {
  const r = rng(seed);
  const L = new LeafBuilder();
  const n = Math.round((x1 - x0) * (y1 - y0) * 90 * density);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  for (let i = 0; i < n; i++) {
    // blobby coverage: denser in the middle / top
    const u = r() * 2 - 1, v = r() * 2 - 1;
    const d = u * u + v * v;
    if (d > 1 || r() > (1 - d) * 0.9 + 0.1 * (v + 1) / 2) continue;
    const a = cx + u * rx, b = cy + v * ry;
    const c = axis === 'z' ? new THREE.Vector3(a, b, z + r.range(0.01, 0.08)) : new THREE.Vector3(z + r.range(0.01, 0.08) * Math.sign(normal.x), b, a);
    const nrm = normal.clone().add(new THREE.Vector3(r.range(-0.4, 0.4), r.range(-0.1, 0.6), r.range(-0.4, 0.4))).normalize();
    L.leaf(c, nrm, r.range(0.07, 0.13), r() * 6.28, Math.floor(r() * 4), 0.015, 0.25);
  }
  if (L.n) K.add(L.geometry(), 'ivy', null, { cast: true });
}

// bush / potted plant clump
export function leafClump(K, { x, y, z, r: rad = 0.35, n = 160, seed = 3, mat = 'ivy' }) {
  const r = rng(seed);
  const L = new LeafBuilder();
  for (let i = 0; i < n; i++) {
    const dir = new THREE.Vector3(r.range(-1, 1), r.range(-0.2, 1), r.range(-1, 1)).normalize();
    const c = new THREE.Vector3(x, y, z).addScaledVector(dir, rad * Math.cbrt(r()));
    L.leaf(c, dir, r.range(0.08, 0.14), r() * 6.28, Math.floor(r() * 4), 0.05 + (c.y - y) * 0.1, 0.2);
  }
  K.add(L.geometry(), mat, null, { cast: true });
}

export function grassTufts(K, { x0, x1, z0, z1, y = 0, n = 20, seed = 5, h = 0.35 }) {
  const r = rng(seed);
  const pos = [], uv = [], nor = [], sw = [], idx = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const cx = r.range(x0, x1), cz = r.range(z0, z1);
    const hh = h * r.range(0.6, 1.3), w = hh * 0.9;
    for (let j = 0; j < 3; j++) {
      const a = (j / 3) * Math.PI + r() * 0.5;
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
      const P = [[cx - dx, y, cz - dz], [cx + dx, y, cz + dz], [cx + dx, y + hh, cz + dz], [cx - dx, y + hh, cz - dz]];
      const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let q = 0; q < 4; q++) { pos.push(...P[q]); uv.push(...U[q]); nor.push(0, 1, 0); sw.push(q >= 2 ? 0.12 : 0); }
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3); k += 4;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(k * 3).fill(1), 3));
  g.setIndex(idx);
  K.add(g, 'grass', null, { cast: false });
}
