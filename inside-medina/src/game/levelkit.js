import * as THREE from 'three';
import { boxMM, worldUV, shadeByHeight, setColor, rng } from '../assets/geom.js';
import { building, dome, merlons, archOutline } from '../assets/architecture.js';
import { lanternMesh, bracket } from '../assets/props.js';
import { dressFacade } from '../assets/dressing.js';
import { Crate } from './entities.js';

// Level-building helpers shared by every chapter. Coordinates are chapter
// local: x right, y up, ground at y 0, play plane z 0, facade line z FZ.
// Everything drawn goes into the chapter's Batcher kit (K) or its root, so the
// chapter loader can dispose it in one sweep. `r` is the chapter's seeded
// random stream: helpers that consume it must be called in a stable order.
export const FZ = -1.6;

export function createLevelKit(game, { K, root, L, r = rng(42) }) {
  const phys = game.phys;
  const solid = (x0, y0, x1, y1, o) => phys.addSolid(x0, y0, x1, y1, o);
  const vbox = (x0, y0, z0, x1, y1, z1, mat, o = {}) => {
    const g = boxMM(x0, y0, z0, x1, y1, z1, o);
    shadeByHeight(g, { base: o.base ?? 0, grime: o.grime ?? 1.0, grimeAmt: o.grimeAmt ?? 0.3, seed: x0 });
    K.add(g, mat, null, { cast: o.cast !== false });
    return g;
  };
  const ground = (x0, x1, { z0 = FZ - 0.3, z1 = 17, y = 0, mat = 'cobbles', collide = true } = {}) => {
    if (collide) solid(x0, y - 3, x1, y, { ledges: false, surface: 'stone' });
    const g = boxMM(x0, y - 0.6, z0, x1, y, z1);
    shadeByHeight(g, { base: y - 0.6, grime: 0.1, grimeAmt: 0 });
    K.add(g, mat, null, { cast: false });
  };
  // gameplay block: collider + stone visual with coping
  const block = (x0, x1, y0, y1, { z0 = FZ, z1 = 1.3, mat = 'sandstone', coping = 'limestone', ledges = true, visual = true, surface = 'stone', light } = {}) => {
    const s = solid(x0, y0, x1, y1, { ledges, surface, light });
    if (visual) {
      vbox(x0, y0, z0, x1, y1 - (coping ? 0.12 : 0), z1, mat, { base: y0, grime: 0.8 });
      if (coping) vbox(x0 - 0.04, y1 - 0.12, z0, x1 + 0.04, y1, z1 + 0.06, coping, { base: y1 - 0.2, grimeAmt: 0.1 });
    }
    return s;
  };
  // hanging lantern (optionally on a forged bracket); light: true adds a pool source
  const lantern = (x, y, z, { light = false, s = 1, bracketDir = 0, yaw, chain, intensity = 3, lit = true } = {}) => {
    let p = new THREE.Vector3(x, y, z);
    if (bracketDir) p = bracket(K, x, y, z, { len: 0.55, dir: bracketDir, yaw });
    const m = lanternMesh(game.mats, { s, chain: chain ?? (bracketDir ? 0.06 : 0.3), lit });
    m.position.copy(p);
    root.add(m);
    const glow = { mesh: m, light: null, phase: r() * 10, lit };
    if (light && lit) L.lightSources.push({ pos: m.position.clone().add(new THREE.Vector3(0, m.userData.glowY, 0.15)), intensity, phase: glow.phase });
    L.lanterns.push(glow);
    return m;
  };
  // checkpoint: activates when grounded with x >= x (and y >= minY)
  const cp = (x, sx, sy, facing = 1, { minY } = {}) => L.checkpoints.push(minY === undefined ? { x, spawn: { x: sx, y: sy, facing } } : { x, minY, spawn: { x: sx, y: sy, facing } });
  const cam = (x, o) => L.cameraKeys.push({ x, ...o });
  const shaft = (x, y, z, o) => L.shaftSpots.push({ p: new THREE.Vector3(x, y, z), o });
  const facades = (list, z = FZ) => {
    for (const f of list) {
      const [x0, x1, h, style, o = {}] = f;
      const y0 = o.y0 ?? 0;
      const b = building(K, { x0, x1, z, y0, height: h, style, seed: Math.round(x0 * 7 + 3), depth: o.depth ?? 6, ...o });
      if (o.dress !== false && h > 2.5) dressFacade(K, { x0, x1, z, y0, top: b.top, openings: b.openings, seed: Math.round(x0 * 3 + 1), floors: Math.max(1, Math.round(h / 3.4)) });
    }
  };
  const farBuilding = (x0, x1, z, h, style, o = {}) => {
    const mats = { blue: 'plasterBlue', peach: 'plasterPeach', cream: 'plasterCream', ochre: 'plasterOchre', white: 'plasterWhite', stone: 'sandstone' };
    const m = mats[style] || 'plasterCream';
    const d = o.depth ?? 7;
    const rr = rng(Math.round(x0 * 13 + z));
    const tint = new THREE.Color().setHSL(0.08 + rr() * 0.04, 0.15, 0.82 + rr() * 0.16);
    const g = boxMM(x0, 0, z - d, x1, h, z, {});
    shadeByHeight(g, { base: 0, grime: 3, grimeAmt: 0.25, tint });
    K.add(g, m, null, { cast: o.cast !== false });
    // setback upper storey
    if (rr() < 0.35 && x1 - x0 > 5) {
      const w = (x1 - x0) * (0.35 + rr() * 0.3), sx = x0 + rr() * (x1 - x0 - w);
      const u = boxMM(sx, h, z - d + 1, sx + w, h + 2.6 + rr() * 1.5, z - 1.2, {}); shadeByHeight(u, { base: h, grime: 0.5, grimeAmt: 0.1, tint }); K.add(u, m, null, { cast: o.cast !== false });
    }
    // rooftop clutter: stair house, water tank, laundry
    if (rr() < 0.5) { const cx = x0 + 1 + rr() * (x1 - x0 - 2); K.add(boxMM(cx - 0.7, h, z - 3.5, cx + 0.7, h + 2.1, z - 2), m, null, { cast: false }); }
    if (rr() < 0.3) { const cx = x0 + 1 + rr() * (x1 - x0 - 2); const t = new THREE.CylinderGeometry(0.5, 0.5, 1.1, 12); t.translate(cx, h + 0.75, z - 4.5); K.add(worldUV(t), 'iron', null, { cast: false }); }
    if (o.parapet !== false) merlons(K, { x0: x0 + 0.1, x1: x1 - 0.1, y: h, z: z + 0.01, h: 0.5, mat: 'plasterCream' });
    const n = Math.floor((x1 - x0) / 2.2);
    for (let f = 1; f < h / 3.2; f++) for (let i = 0; i < n; i++) {
      if (rr() < 0.45) continue;
      const cx = x0 + (i + 0.5) * ((x1 - x0) / n), sy = f * 3.2 - 1.9;
      const pts = archOutline(rr() < 0.5 ? 'pointed' : 'round', 0.62, 0.8, 0.4);
      const sh = new THREE.Shape(); sh.moveTo(-0.31, 0); pts.forEach((v) => sh.lineTo(v.x, v.y)); sh.lineTo(0.31, 0);
      const wg = new THREE.ShapeGeometry(sh, 6); wg.translate(cx, sy, z + 0.02); setColor(wg, 0xffffff);
      K.add(worldUV(wg), 'darkInterior', null, { cast: false });
    }
  };
  const cypress = (x, z, h) => {
    const prof = [];
    const n = 18;
    for (let i = 0; i <= n; i++) { const t = i / n; const rr = h * 0.13 * Math.pow(Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5 + 0.2) * (1 - t * 0.95), 0.9) + 0.02; prof.push(new THREE.Vector2(rr, t * h)); }
    const g = new THREE.LatheGeometry(prof, 14);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const k = 1 + 0.18 * Math.sin(py * 3.1 + Math.atan2(pz, px) * 3) * Math.sin(py * 7.3 + px * 5);
      pos.setX(i, px * k); pos.setZ(i, pz * k);
    }
    g.computeVertexNormals(); g.translate(x, 0, z);
    setColor(g, 0xffffff);
    K.add(g, 'cypress');
    const tr = boxMM(x - 0.1, 0, z - 0.1, x + 0.1, 0.6, z + 0.1); K.add(tr, 'woodDark');
  };
  // far city in three rows plus cypresses and domes; exclusion bands keep
  // hero views clear (rows: [x0, x1] skipped when a building would overlap)
  const skyline = ({ x0 = -40, x1 = 240, exclude = [], exclude3 = exclude, excludeTrees = exclude, x3 = [-60, 260], x4 = [-100, 320], trees = 26, domes = [[12, -60, 4], [88, -70, 5], [118, -52, 3.5], [212, -58, 4.5], [-22, -66, 4]] } = {}) => {
    const styles = ['cream', 'peach', 'ochre', 'white', 'blue', 'cream', 'peach', 'stone'];
    const skip = (bands, a, b) => { for (const [e0, e1] of bands) if (b > e0 && a < e1) return e1; return null; };
    // row 2 (just behind the street facades)
    for (let x = x0; x < x1;) { const w = 4 + r() * 6; const s = skip(exclude, x, x + w); if (s !== null) { x = s; continue; } farBuilding(x, x + w, -12 - r() * 5, 6 + r() * 5, styles[Math.floor(r() * styles.length)], { depth: 6 }); x += w + (r() < 0.25 ? 1.5 + r() * 3 : 0.2); }
    // row 3
    for (let x = x3[0]; x < x3[1];) { const w = 5 + r() * 8; const s = skip(exclude3, x, x + w); if (s !== null) { x = s; continue; } farBuilding(x, x + w, -24 - r() * 12, 7 + r() * 7, styles[Math.floor(r() * styles.length)], { depth: 8, cast: false }); x += w + r() * 3; }
    // row 4 (hazy far city)
    for (let x = x4[0]; x < x4[1];) { const w = 8 + r() * 14; farBuilding(x, x + w, -55 - r() * 40, 9 + r() * 12, styles[Math.floor(r() * styles.length)], { depth: 10, parapet: r() < 0.5, cast: false }); x += w + r() * 4; }
    // cypress and far domes punctuating the skyline
    for (let i = 0; i < trees; i++) { const x = x0 + 10 + i * 10 + r() * 6; if (excludeTrees.some(([e0, e1]) => x > e0 && x < e1)) continue; cypress(x, -20 - r() * 14, 7 + r() * 6); }
    for (const [dx, dz, dr] of domes) dome(K, { x: dx, y: 9, z: dz, r: dr, drumH: 2.5 });
  };
  // big stones and broken beams stacked over a low tunnel
  const rubblePile = (x0, x1, gapY) => {
    for (let i = 0; i < 26; i++) {
      const cx = x0 + r() * (x1 - x0), cy = gapY + 0.2 + Math.pow(r(), 1.5) * 3.2, cz = -1.2 + r() * 2.4;
      const s = 0.35 + r() * 0.5;
      const g = boxMM(cx - s, cy - s * 0.6, cz - s, cx + s, cy + s * 0.6, cz + s, { round: 0.06 });
      g.applyMatrix4(new THREE.Matrix4().makeRotationZ((r() - 0.5) * 0.5));
      K.add(g, r() < 0.5 ? 'sandstone' : 'limestone');
    }
    const lintel = boxMM(x0 - 0.1, gapY, -1.3, x1 + 0.2, gapY + 0.3, 1.3); K.add(lintel, 'woodDark');
    for (let i = 0; i < 5; i++) { const g = boxMM(x0 - 0.3 + i * 0.7, gapY + 0.2, -1.4, x0 + i * 0.7 + 0.1, gapY + 2.6, -1.25); g.applyMatrix4(new THREE.Matrix4().makeRotationZ(0.3 - i * 0.12)); K.add(g, 'woodDark'); }
    const back = boxMM(x0, 0, -1.8, x1, gapY + 3.5, -1.5); K.add(back, 'sandstone');
    const dark = boxMM(x0 + 0.1, 0, -1.4, x1 - 0.1, gapY, -1.3); setColor(dark, 0xffffff); K.add(dark, 'darkInterior', null, { cast: false });
  };
  // a crate mesh that never moves (its collider is added separately)
  const crateMeshStatic = (x, y, s) => {
    const c = new Crate(game, x, y, s);
    phys.removeBody(c.body);
    return c.mesh;
  };
  // low stone kerb: stops bodies, the boy steps over it (step-up 0.26)
  const kerb = (x0, x1, h = 0.15, { z0 = -0.9, z1 = 0.9, mat = 'limestone', y = 0 } = {}) => {
    const s = solid(x0, y, x1, y + h, { ledges: false, surface: 'stone', kind: 'kerb' });
    vbox(x0, y, z0, x1, y + h, z1, mat, { base: y, grimeAmt: 0.15 });
    return s;
  };
  // the boy dies when his feet enter the box
  const killZone = (x0, x1, y0, y1, kind = 'fall') => { const z = { x0, x1, y0, y1, kind }; L.killZones.push(z); return z; };
  return { FZ, K, root, r, solid, vbox, ground, block, lantern, cp, cam, shaft, facades, farBuilding, skyline, cypress, rubblePile, crateMeshStatic, kerb, killZone };
}
