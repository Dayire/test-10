import * as THREE from 'three';
import { worldUV, shadeByHeight, setColor, extrude, boxMM, mat4, rng, tube } from './geom.js';
import { archOutline } from './architecture.js';
import { pot } from './props.js';
import { leafClump } from './foliage.js';

// ---------------------------------------------------------------------------
// Facade dressing: the small architectural clutter that makes a medina wall
// feel lived-in. Works in facade-local space (wall front at z, facing +z).
// ---------------------------------------------------------------------------

// Cairo/Fez style projecting wooden bay window with lattice panels
export function mashrabiyaBay(K, { cx, sill, w, h, z, depth = 0.55 }) {
  const x0 = cx - w / 2 - 0.12, x1 = cx + w / 2 + 0.12;
  const y0 = sill - 0.25, y1 = sill + h + 0.25;
  // base with corbels
  K.add(boxMM(x0 - 0.05, y0 - 0.12, z, x1 + 0.05, y0, z + depth + 0.06), 'woodDark');
  for (const fx of [0.15, 0.5, 0.85]) {
    const cxx = x0 + (x1 - x0) * fx;
    const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(depth * 0.8, 0); s.quadraticCurveTo(depth * 0.2, -0.1, 0, -0.45); s.lineTo(0, 0);
    const g = extrude(s, 0.09); g.rotateY(-Math.PI / 2); g.translate(cxx + 0.045, y0 - 0.12, z);
    K.add(worldUV(g), 'woodDark');
  }
  // frame posts
  for (const px of [x0, x1]) for (const pz of [z + 0.03, z + depth]) K.add(boxMM(px - 0.04, y0, pz - 0.04, px + 0.04, y1, pz + 0.04), 'woodDark');
  // lattice panels: front + two sides
  const front = new THREE.PlaneGeometry(x1 - x0 - 0.06, y1 - y0 - 0.06); front.translate((x0 + x1) / 2, (y0 + y1) / 2, z + depth);
  K.add(worldUV(front), 'lattice');
  for (const px of [x0, x1]) {
    const side = new THREE.PlaneGeometry(depth - 0.06, y1 - y0 - 0.06); side.rotateY(Math.PI / 2); side.translate(px, (y0 + y1) / 2, z + depth / 2);
    K.add(worldUV(side), 'lattice');
  }
  // dark interior behind the lattice so it reads as a screen
  const dark = boxMM(x0 + 0.05, y0 + 0.05, z + 0.02, x1 - 0.05, y1 - 0.05, z + 0.06); setColor(dark, 0xffffff);
  K.add(dark, 'darkInterior', null, { cast: false });
  // little cap roof
  const cap = boxMM(x0 - 0.1, y1, z, x1 + 0.1, y1 + 0.08, z + depth + 0.14);
  K.add(cap, 'woodDark');
  const tiles = boxMM(x0 - 0.12, y1 + 0.08, z, x1 + 0.12, y1 + 0.13, z + depth + 0.16);
  K.add(tiles, 'roofTiles');
}

// row of protruding beam ends under a floor line
export function beamEnds(K, { x0, x1, y, z, step = 0.55 }) {
  for (let x = x0 + step * 0.5; x < x1 - 0.1; x += step) K.add(boxMM(x - 0.06, y - 0.12, z - 0.02, x + 0.06, y, z + 0.28, { round: 0.015 }), 'woodDark');
}

// roof drain spout with a dark stain below
export function drainSpout(K, { x, y, z }) {
  const g = new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8, 1, true, 0, Math.PI); g.rotateX(Math.PI / 2); g.rotateZ(Math.PI); g.translate(x, y, z + 0.27);
  K.add(worldUV(g), 'terracotta');
  const stain = new THREE.PlaneGeometry(0.35, Math.min(2.6, y - 0.4)); stain.translate(x, y - 0.2 - Math.min(2.6, y - 0.4) / 2, z + 0.012);
  const c = stain.attributes.position; const col = new Float32Array(c.count * 3);
  for (let i = 0; i < c.count; i++) { const k = 0.55; col[i * 3] = k; col[i * 3 + 1] = k * 0.97; col[i * 3 + 2] = k * 0.94; }
  stain.setAttribute('color', new THREE.BufferAttribute(col, 3));
  K.add(worldUV(stain), 'stain', null, { cast: false });
}

// planter box on a window sill
export function sillPlanter(K, { cx, sill, z, seed }) {
  K.add(boxMM(cx - 0.32, sill - 0.02, z, cx + 0.32, sill + 0.14, z + 0.26), 'terracotta');
  leafClump(K, { x: cx, y: sill + 0.2, z: z + 0.13, r: 0.22, n: 70, seed });
}

// painted wooden shop board above a door (geometric band, no lettering)
export function shopBoard(K, { cx, y, z, w = 1.8 }) {
  K.add(boxMM(cx - w / 2, y, z, cx + w / 2, y + 0.42, z + 0.06), 'woodDark');
  K.add(boxMM(cx - w / 2 + 0.06, y + 0.07, z + 0.06, cx + w / 2 - 0.06, y + 0.35, z + 0.075), 'zellige', null, { cast: false });
}

export function dressFacade(K, { x0, x1, z, y0 = 0, top, openings = [], seed = 1, floors = 2 }) {
  const r = rng(seed * 7 + 3);
  const fh = (top - y0) / Math.max(1, floors);
  for (const op of openings) {
    if (op.isDoor) {
      if (r() < 0.35) shopBoard(K, { cx: op.cx, y: op.sill + op.hs + op.rise + 0.35, z: z + 0.04, w: op.w + 0.8 });
      continue;
    }
    const upper = op.sill > y0 + 2;
    const k = r();
    if (upper && k < 0.3 && op.w > 0.55) mashrabiyaBay(K, { cx: op.cx, sill: op.sill, w: op.w, h: op.hs + op.rise * 0.6, z: z + 0.02 });
    else if (k < 0.55) sillPlanter(K, { cx: op.cx, sill: op.sill - 0.08, z: z + 0.05, seed: Math.floor(r() * 1000) });
  }
  if (floors > 1 && r() < 0.7) beamEnds(K, { x0: x0 + 0.3, x1: x1 - 0.3, y: y0 + fh - 0.1, z });
  if (r() < 0.8) drainSpout(K, { x: x0 + 0.4 + r() * (x1 - x0 - 0.8), y: top - 0.45, z });
}
