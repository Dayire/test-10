import * as THREE from 'three';
import { Batcher, boxMM, worldUV, shadeByHeight, setColor, mat4, rng, extrude } from '../assets/geom.js';
import { building, wallWithOpenings, archFrame, arcade, dome, minaret, cornice, merlons, zellige, door, archOutline } from '../assets/architecture.js';
import { barrel, pot, rugRoll, hangingRug, sack, basket, cart, awning, drape, lanternMesh, bracket, laundry, wire, eave, stairs, stool, pole, souqCanopy } from '../assets/props.js';
import { ivyCurtain, ivyPatch, leafClump, grassTufts } from '../assets/foliage.js';
import { dressFacade } from '../assets/dressing.js';
import { Crate, Plate, Lever, Searchlight, Guard, Trigger } from './entities.js';
import { Drawbridge, RopeLadder } from './bridge.js';

const FZ = -1.6; // facade line

export function buildLevel(game) {
  const batch = new Batcher(game.mats, { chunk: 40 });
  const K = batch.kit();
  const phys = game.phys;
  const L = {
    checkpoints: [], cameraKeys: [], triggers: [], lanterns: [], shaftSpots: [], dustRegions: [], covers: [], lightSources: [],
    finale: null,
  };
  const r = rng(42);

  // ---------------------------------------------------------------- helpers
  const solid = (x0, y0, x1, y1, o) => phys.addSolid(x0, y0, x1, y1, o);
  const vbox = (x0, y0, z0, x1, y1, z1, mat, o = {}) => {
    const g = boxMM(x0, y0, z0, x1, y1, z1, o);
    shadeByHeight(g, { base: o.base ?? 0, grime: o.grime ?? 1.0, grimeAmt: o.grimeAmt ?? 0.3, seed: x0 });
    K.add(g, mat, null, { cast: o.cast !== false });
    return g;
  };
  const ground = (x0, x1, { z0 = FZ - 0.3, z1 = 9, y = 0, mat = 'cobbles', collide = true } = {}) => {
    if (collide) solid(x0, y - 3, x1, y, { ledges: false, surface: 'stone' });
    const g = boxMM(x0, y - 0.6, z0, x1, y, z1);
    shadeByHeight(g, { base: y - 0.6, grime: 0.1, grimeAmt: 0 });
    K.add(g, mat, null, { cast: false });
  };
  // gameplay block: collider + stone visual with coping
  const block = (x0, x1, y0, y1, { z0 = FZ, z1 = 1.3, mat = 'sandstone', coping = 'limestone', ledges = true, visual = true, surface = 'stone' } = {}) => {
    const s = solid(x0, y0, x1, y1, { ledges, surface });
    if (visual) {
      vbox(x0, y0, z0, x1, y1 - (coping ? 0.12 : 0), z1, mat, { base: y0, grime: 0.8 });
      if (coping) vbox(x0 - 0.04, y1 - 0.12, z0, x1 + 0.04, y1, z1 + 0.06, coping, { base: y1 - 0.2, grimeAmt: 0.1 });
    }
    return s;
  };
  const lantern = (x, y, z, { light = false, s = 1, bracketDir = 0, intensity = 3 } = {}) => {
    let p = new THREE.Vector3(x, y, z);
    if (bracketDir) p = bracket(K, x, y, z, { len: 0.55, dir: bracketDir });
    const m = lanternMesh(game.mats, { s });
    m.position.copy(p).add(new THREE.Vector3(0, -0.46 * s, 0));
    game.scene.add(m);
    const glow = { mesh: m, light: null, phase: r() * 10 };
    if (light) L.lightSources.push({ pos: m.position.clone().add(new THREE.Vector3(0, 0.18 * s, 0.15)), intensity, phase: glow.phase });
    L.lanterns.push(glow);
    return m;
  };
  const cp = (x, sx, sy, facing = 1) => L.checkpoints.push({ x, spawn: { x: sx, y: sy, facing } });
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

  // ================================================================ GROUND
  ground(-16, 136.8);
  ground(140.3, 205);
  // ravine walls + floor (lethal fall)
  solid(136.8, -10, 140.3, -9, { ledges: false });
  solid(128, -10, 136.8, -2.9, { ledges: false }); solid(140.3, -10, 150, -2.9, { ledges: false });
  vbox(136.4, -9.6, FZ - 6, 137.0, 0, 3, 'sandstone', { base: -9, grime: 8, grimeAmt: 0.85 });
  vbox(140.1, -9.6, FZ - 6, 140.7, 0, 3, 'sandstone', { base: -9, grime: 8, grimeAmt: 0.85 });
  vbox(136.8, -10, FZ - 6, 140.3, -9, 3, 'sand', { base: -10 });
  solid(-16, 0, -3.2, 12, { ledges: false }); // invisible start boundary
  solid(190.6, 0, 205, 14, { ledges: false }); // end boundary (right of the hero alley)

  // ================================================================ A — THE SOUK (x -14 .. 34)
  cp(-100, 1.5, 0, 1);
  facades([
    [-16, -6, 9.5, 'cream', { door: -10.5 }],
    [-6, -1, 7.5, 'blue', { door: -3.4, doorKind: 'horseshoe' }],
    [-1, 2.6, 3.0, 'peach', { door: false, noGroundWindows: true, merlons: true, depth: 4 }],
    [2.6, 9.2, 10.5, 'blue', { door: 6.2, doorKind: 'pointed', winKind: 'pointed' }],
    [9.2, 12.2, 3.2, 'ochre', { door: false, noGroundWindows: true, depth: 4 }],
    [12.2, 16.6, 8.5, 'white', { door: 14.2, doorKind: 'round' }],
  ]);
  // awnings / stalls on the low shops, goods beneath
  awning(K, { x0: -0.9, x1: 2.5, z0: FZ + 0.02, z1: 0.2, y0: 2.6, y1: 2.05, mat: 'fabricTan' });
  awning(K, { x0: 9.3, x1: 12.1, z0: FZ + 0.02, z1: 0.3, y0: 2.8, y1: 2.15, mat: 'fabricRed' });
  basket(K, -0.2, 0, -0.9); basket(K, 0.5, 0, -1.0, { r: 0.22 }); sack(K, 1.3, 0, -1.0); pot(K, 2.0, 0, -1.1, { kind: 'amphora' });
  rugRoll(K, 9.8, 0, -1.1, { seed: 3 }); rugRoll(K, 10.25, 0, -1.2, { seed: 4, r: 0.13, len: 1.5 }); rugRoll(K, 10.7, 0, -1.05, { seed: 5, len: 1.9 });
  hangingRug(K, 11.3, 2.05, -1.4, { w: 1.1, h: 1.7 });
  pot(K, 3.3, 0, -1.0, { kind: 'tall' }); pot(K, 3.9, 0, -1.2, { kind: 'jar' });
  zellige(K, { x0: -5.6, x1: -1.4, y0: 0.36, y1: 1.3, z: FZ + 0.02 });
  lantern(-3.4 + 1.1, 2.9, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  lantern(6.2 + 1.2, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  ivyCurtain(K, { x0: 3.0, x1: 8.8, y: 10.5, z: FZ, maxLen: 4.5, seed: 11, flowers: 0.6 });
  ivyCurtain(K, { x0: -5.8, x1: -2.5, y: 7.5, z: FZ, maxLen: 3, seed: 12 });
  ivyPatch(K, { x0: 12.4, x1: 14.5, y0: 4.5, y1: 8.4, z: FZ, seed: 13 });
  wire(K, new THREE.Vector3(-4, 7, FZ), new THREE.Vector3(12, 8, 4.5), { sag: 0.8 });
  laundry(K, new THREE.Vector3(2.8, 6.5, FZ), new THREE.Vector3(8.5, 6.2, FZ + 0.1), { sag: 0.4, seed: 7 });
  // sack pile obstacle (tutorial jump)
  solid(8.15, 0, 8.9, 0.7, { ledges: false, surface: 'cloth' });
  sack(K, 8.3, 0, 0.1, { s: 1.1 }); sack(K, 8.75, 0, -0.1, { s: 1.0, rot: 1.2 }); sack(K, 8.5, 0.4, 0.0, { s: 0.9, rot: 0.4 }); sack(K, 8.6, 0, 0.55, { s: 1.0, rot: 2 });
  basket(K, 7.6, 0, 0.6, { r: 0.2 });
  // foreground silhouettes
  rugRoll(K, -3.4, 0, 5.2, { seed: 8, r: 0.22, len: 2.4, lean: 0.18 }); rugRoll(K, -2.6, 0, 5.8, { seed: 9, r: 0.18, len: 2.1, lean: 0.1 });
  barrel(K, -1.2, 0, 6.2); pot(K, 12.8, 0, 6.0, { kind: 'jar', s: 0.9 }); basket(K, 13.6, 0, 6.4, { r: 0.24 });
  souqCanopy(K, { x0: -6, x1: 15.6, y: 6.3, seed: 3 });
  souqCanopy(K, { x0: 16.6, x1: 31, y: 7.6, seed: 4 });
  grassTufts(K, { x0: -2, x1: 34, z0: 1.0, z1: 7, n: 60, seed: 3 });
  // raised street (climb tutorial)
  block(16.2, 31, 0, 1.5, { z0: FZ, z1: 1.35, mat: 'sandstone', coping: 'limestone' });
  // collapsed stair rubble in front of it
  for (let i = 0; i < 7; i++) { const g = boxMM(14.9 + i * 0.16 + r() * 0.1, 0, 0.5 + r() * 0.6, 15.3 + i * 0.16 + r() * 0.2, 0.12 + r() * 0.25, 0.9 + r() * 0.5, { round: 0.03 }); K.add(g, 'limestone'); }
  facades([
    [16.6, 21, 9.5, 'blue', { y0: 1.5, door: 18.8, doorKind: 'pointed', groundY: 1.5 }],
    [21, 24, 3.0, 'peach', { y0: 1.5, door: false, noGroundWindows: true, depth: 4, groundY: 1.5 }],
    [24, 30.2, 8.0, 'ochre', { y0: 1.5, door: 27.2, doorKind: 'horseshoe', groundY: 1.5 }],
    [30.2, 34.2, 3.2, 'cream', { door: false, noGroundWindows: true, depth: 4 }],
  ]);
  awning(K, { x0: 21.1, x1: 23.9, z0: FZ + 0.02, z1: 0.1, y0: 4.1, y1: 3.55, mat: 'fabricTeal' });
  drape(K, new THREE.Vector3(18, 7.2, FZ), new THREE.Vector3(24, 6.6, 3.5), { width: 1.4, sag: 0.9, mat: 'fabricRed', twist: 0.3 });
  drape(K, new THREE.Vector3(23, 6.4, FZ), new THREE.Vector3(29, 7.0, 3.5), { width: 1.3, sag: 0.8, mat: 'fabricTan', twist: -0.2 });
  pot(K, 22.2, 1.5, -1.0, { kind: 'planter' }); leafClump(K, { x: 22.2, y: 2.0, z: -1.0, r: 0.35, seed: 21 });
  sack(K, 23.2, 1.5, -1.1); basket(K, 25.2, 1.5, -1.1);
  lantern(18.8 + 1.0, 4.5, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  ivyCurtain(K, { x0: 24.3, x1: 29.8, y: 9.5, z: FZ, maxLen: 3.5, seed: 14 });
  shaft(22.5, 1.5, 0.2, { w: 2.2, len: 14, intensity: 0.1 });
  shaft(0.8, 0, 0.3, { w: 2.6, len: 14, intensity: 0.1 });
  shaft(10.7, 0, 0.3, { w: 2.2, len: 14, intensity: 0.09 });
  L.dustRegions.push({ x0: -3, x1: 32, y0: 0.2, y1: 5, z0: -1.5, z1: 3 });
  cam(-6, { dist: 13.5, height: 1.5, lookY: 2.3, fov: 34, ahead: 1.6 });
  cam(15, { dist: 13.5, height: 1.5, lookY: 2.3, fov: 34, ahead: 1.8 });
  cam(28, { dist: 14, height: 1.6, lookY: 2.3, fov: 34, ahead: 1.8 });

  // ================================================================ B — CRATE & ROOFTOPS (x 34 .. 70)
  cp(33, 33.5, 0, 1);
  L.crateA = new Crate(game, 37.2, 0, 1.0);
  // terrace building (climb with the crate)
  block(42, 56, 0, 3.1, { z0: FZ, z1: 1.25, mat: 'plasterPeach', coping: 'limestone' });
  wallWithOpenings(K, { x0: 42, x1: 56, y0: 0, y1: 2.98, z: 1.26, depth: 0.05, mat: 'plasterPeach', openings: [{ kind: 'pointed', cx: 45.5, sill: 0.8, w: 0.8, hs: 1.0, rise: 0.5 }, { kind: 'pointed', cx: 49.5, sill: 0.8, w: 0.8, hs: 1.0, rise: 0.5 }, { kind: 'pointed', cx: 53.2, sill: 0, w: 1.2, hs: 1.5, rise: 0.75, recess: 0.3 }] });
  archFrame(K, { kind: 'pointed', cx: 45.5, sill: 0.72, w: 0.8, hs: 1.08, rise: 0.5, band: 0.1, z: 1.32, mat: 'limestone' });
  archFrame(K, { kind: 'pointed', cx: 49.5, sill: 0.72, w: 0.8, hs: 1.08, rise: 0.5, band: 0.1, z: 1.32, mat: 'limestone' });
  door(K, { cx: 53.2, sill: 0, w: 1.2, hs: 1.5, rise: 0.75, z: 1.1, kind: 'pointed' });
  // terrace props (behind the play plane)
  pot(K, 44.2, 3.1, -0.9, { kind: 'planter', s: 1.2 }); leafClump(K, { x: 44.2, y: 3.6, z: -0.9, r: 0.45, n: 220, seed: 31 });
  pot(K, 51.5, 3.1, -1.0, { kind: 'planter' }); leafClump(K, { x: 51.5, y: 3.55, z: -1.0, r: 0.38, seed: 32 });
  stool(K, 47.5, 3.1, -1.0); basket(K, 48.3, 3.1, -1.1);
  laundry(K, new THREE.Vector3(43, 5.3, -1.2), new THREE.Vector3(55, 5.1, -0.9), { sag: 0.35, seed: 5, cloths: 7 });
  pole(K, 43, 3.1, 5.4, -1.2); pole(K, 55, 3.1, 5.2, -0.9);
  facades([
    [34.2, 41.8, 7.2, 'blue', { door: 38.4, doorKind: 'horseshoe' }],
    [41.8, 49.5, 5.8, 'blue', { door: false, winKind: 'pointed', noGroundWindows: true }],
    [49.5, 56.4, 6.4, 'cream', { door: false, noGroundWindows: true }],
    [58.2, 64, 10, 'blue', { door: false }],
    [64, 71, 8.5, 'white', { door: 68.8, doorKind: 'round' }],
  ]);
  ivyCurtain(K, { x0: 42.3, x1: 48.8, y: 5.8, z: FZ, maxLen: 2.2, seed: 15, flowers: 0.8 });
  ivyCurtain(K, { x0: 59, x1: 63.5, y: 10, z: FZ, maxLen: 4, seed: 16 });
  lantern(38.4 + 1.1, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  // gap alley between rooftops (dark depth)
  vbox(56, 0, FZ - 8, 58.2, 0.02, FZ, 'cobbles', { cast: false });
  vbox(56.2, 0, FZ - 8.4, 58.0, 9, FZ - 8, 'plasterOchre', { base: 0, grime: 3 });
  // second rooftop
  block(58.2, 67, 0, 2.5, { z0: FZ, z1: 1.25, mat: 'plasterOchre', coping: 'limestone' });
  wallWithOpenings(K, { x0: 58.2, x1: 67, y0: 0, y1: 2.38, z: 1.26, depth: 0.05, mat: 'plasterOchre', openings: [{ kind: 'horseshoe', cx: 61, sill: 0.7, w: 0.7, hs: 0.9 }, { kind: 'horseshoe', cx: 64.5, sill: 0.7, w: 0.7, hs: 0.9 }] });
  pot(K, 60.2, 2.5, -1.0, { kind: 'amphora' }); pot(K, 65.5, 2.5, -1.1, { kind: 'planter' }); leafClump(K, { x: 65.5, y: 2.95, z: -1.1, r: 0.35, seed: 33 });
  // awning break-fall down into the courtyard
  solid(67.3, 1.5, 70.1, 1.65, { oneWay: true, ledges: false, surface: 'cloth' });
  awning(K, { x0: 67.2, x1: 70.2, z0: FZ + 0.02, z1: 0.9, y0: 2.05, y1: 1.52, mat: 'fabricRed', sag: 0.1 });
  // foreground
  barrel(K, 34.8, 0, 6.0); rugRoll(K, 33.6, 0, 5.6, { seed: 22, len: 2.3, r: 0.2 });
  pot(K, 57, 0, 5.4, { kind: 'tall', s: 1.3 });
  shaft(57.1, 0, 0.0, { w: 1.6, len: 12, intensity: 0.14 });
  cp(57.0, 54.8, 3.1, 1);
  cam(36, { dist: 12.5, height: 1.8, lookY: 1.8, fov: 34, ahead: 1.6 });
  cam(41, { dist: 13.5, height: 2.4, lookY: 2.3, fov: 35, ahead: 1.2 });
  cam(47, { dist: 15, height: 2.3, lookY: 2.6, fov: 36, ahead: 1.8, dofFar: 3 });
  cam(62, { dist: 15, height: 2.3, lookY: 2.4, fov: 36, ahead: 1.8, dofFar: 3 });
  cam(69, { dist: 14, height: 2.0, lookY: 2.2, fov: 35, ahead: 1.4 });

  // ================================================================ C — SEARCHLIGHT COURTYARD (x 70 .. 118)
  cp(71.2, 71.6, 0, 1);
  const arc = arcade(K, { x0: 71, x1: 112.4, z: -4.2, span: 2.3, pierW: 0.8, pierD: 0.8, hs: 2.4, upper: 1.3, mat: 'plasterPeach', galleryDepth: 3.0 });
  merlons(K, { x0: 71.1, x1: 112.3, y: arc.top, z: -4.15, h: 0.45, mat: 'plasterCream' });
  // tall palace wall enclosing the courtyard (puts it in shade), with a watchman's balcony + lamp
  facades([[70, 113.5, 19, 'cream', { door: false, winSkip: 0.55, depth: 5 }]], -8.35);
  ivyCurtain(K, { x0: 74, x1: 86, y: 19, z: -8.35, maxLen: 6, seed: 18 });
  const wb = { x: 93, y: 11.4, z: -8.35 };
  vbox(wb.x - 1.6, wb.y - 0.25, wb.z, wb.x + 1.6, wb.y, wb.z + 1.3, 'woodDark', { base: wb.y - 1 });
  for (const cx of [-1.3, 0, 1.3]) { const g = boxMM(wb.x + cx - 0.1, wb.y - 1.1, wb.z, wb.x + cx + 0.1, wb.y - 0.25, wb.z + 0.9); K.add(g, 'woodDark'); }
  const rail = new THREE.Shape(); rail.moveTo(0, 0); rail.lineTo(3.2, 0); rail.lineTo(3.2, 0.9); rail.lineTo(0, 0.9);
  const rg = new THREE.ShapeGeometry(rail); rg.translate(wb.x - 1.6, wb.y, wb.z + 1.28); K.add(worldUV(rg), 'lattice');
  archFrame(K, { kind: 'pointed', cx: wb.x, sill: wb.y, w: 1.2, hs: 1.4, rise: 0.8, band: 0.18, z: wb.z + 0.05, mat: 'limestone' });
  const dk = boxMM(wb.x - 0.6, wb.y, wb.z - 0.05, wb.x + 0.6, wb.y + 2.2, wb.z + 0.02); setColor(dk, 0xffffff); K.add(dk, 'darkInterior', null, { cast: false });
  minaret(K, { x: 93, z: -30, w: 3.6, h: 26, mat: 'sandstone' });
  // fountain in the courtyard (behind play plane)
  const basin = new THREE.CylinderGeometry(1.4, 1.5, 0.5, 32); basin.translate(90, 0.25, -2.5);
  K.add(worldUV(basin), 'zellige');
  const rim = new THREE.TorusGeometry(1.45, 0.08, 8, 32); rim.rotateX(Math.PI / 2); rim.translate(90, 0.5, -2.4); K.add(worldUV(rim), 'limestone');
  const water = new THREE.CircleGeometry(1.38, 32); water.rotateX(-Math.PI / 2); water.translate(90, 0.42, -2.4); setColor(water, 0xffffff);
  K.add(worldUV(water), game.mats.std('water', null, { color: 0x1c2a2c, rough: 0.05, metal: 0.0, envInt: 1.4 }), null, { cast: false });
  // hanging rugs as cover from the searchlight
  const coverXs = [76.6, 82.2, 87.6, 93.4, 98.8, 104.2, 108.4];
  for (let i = 0; i < coverXs.length; i++) {
    const x = coverXs[i];
    hangingRug(K, x, 2.45, -0.8, { w: 1.9, h: 2.2 });
    L.covers.push(new THREE.Box3(new THREE.Vector3(x - 0.95, 0.2, -0.87), new THREE.Vector3(x + 0.95, 2.47, -0.73)));
    pole(K, x - 1.2, 0, 2.7, -0.8, 0.04); pole(K, x + 1.2, 0, 2.7, -0.8, 0.04);
    wire(K, new THREE.Vector3(x - 1.2, 2.62, -0.8), new THREE.Vector3(x + 1.2, 2.62, -0.8), { sag: 0.12, r: 0.01 });
  }
  pot(K, 79.5, 0, -2.6, { kind: 'amphora' }); pot(K, 85, 0, -2.5, { kind: 'jar' }); cart(K, 101.5, 0, -2.6, { rot: 0.1 });
  for (const x of [74.2, 96.3, 110.6]) lantern(x, 3.0, -4.0, { light: true, intensity: 1.6 });
  grassTufts(K, { x0: 70, x1: 112, z0: -1.5, z1: 6, n: 70, seed: 9 });
  // foreground pillars of the near side of the courtyard (silhouettes)
  // velarium: sail strips over the front half of the courtyard (shade + back-lit glow)
  for (let i = 0; i < 6; i++) {
    const x0 = 72.5 + i * 6.6, x1 = x0 + 5.6;
    drape(K, new THREE.Vector3((x0 + x1) / 2, 8.6, -3.2), new THREE.Vector3((x0 + x1) / 2 + 0.4, 9.1, 7.5), { width: 5.4, sag: 0.9, mat: i % 2 ? 'fabricCream' : 'fabricTan', twist: 0.05 });
  }
  // right wall + rope ladder + lever
  block(113.5, 118, 0, 4.6, { z0: FZ, z1: 1.3, mat: 'plasterBlue', coping: 'limestone' });
  const ladderVine = { x0: 112.7, x1: 113.5, y0: 0, y1: 4.6, exit: { x: 114.1, y: 4.6 }, enabled: false };
  game.vines.push(ladderVine);
  L.ladder = new RopeLadder(game, { x: 113.1, y0: 0, y1: 4.6, z: 0.05, vine: ladderVine });
  L.lever = new Lever(game, { x: 110.7, y: 0, dir: -1, onPulled: () => L.ladder.release() });
  facades([[112.4, 120, 11, 'blue', { door: false }]]);
  block(118, 119.7, 0, 2.3, { z0: FZ, z1: 1.3, mat: 'plasterBlue', coping: 'limestone' });
  L.searchlight = new Searchlight(game, { origin: new THREE.Vector3(93, 12.0, -7.45), x0: 72.5, x1: 112.2, aimY: 0.4, speed: 3.1, pause: 1.2, covers: L.covers, startX: 100 });
  L.dustRegions.push({ x0: 72, x1: 112, y0: 0.3, y1: 6, z0: -1.5, z1: 2 });
  cam(71, { dist: 16.5, height: 2.9, lookY: 3.3, fov: 38, ahead: 1.0, dofFar: 2 });
  cam(108, { dist: 16.5, height: 2.9, lookY: 3.3, fov: 38, ahead: 1.0, dofFar: 2 });
  cam(115, { dist: 14, height: 2.2, lookY: 2.6, fov: 36, ahead: 1.2 });

  // ================================================================ D — BALCONY CRATE & DRAWBRIDGE (x 118 .. 141)
  cp(120.3, 120.6, 0, 1);
  facades([
    [120, 124.3, 9.5, 'blue', { door: false, winSkip: 0.6 }],
    [124.3, 131, 11.5, 'cream', { door: 127.6, doorKind: 'pointed' }],
    [131, 136.8, 8.5, 'blue', { door: 133.9, doorKind: 'horseshoe' }],
    [140.3, 147, 10, 'peach', { door: 143.4, doorKind: 'round' }],
  ]);
  // ivy wall to climb
  const vine = { x0: 121.4, x1: 124.0, y0: 0, y1: 4.3, exit: { x: 124.58, y: 4.3 }, enabled: true };
  game.vines.push(vine);
  ivyPatch(K, { x0: 121.1, x1: 124.3, y0: 0.1, y1: 4.9, z: FZ, density: 2.4, seed: 41 });
  ivyCurtain(K, { x0: 121.0, x1: 124.4, y: 5.2, z: FZ, maxLen: 1.5, seed: 42, density: 1.5 });
  // balcony with a crate on it
  solid(124.2, 4.0, 130.0, 4.3, { surface: 'wood' });
  vbox(124.2, 4.0, FZ, 130.0, 4.3, 0.9, 'wood', { base: 4 });
  for (let x = 124.6; x < 130; x += 1.1) { const g = boxMM(x - 0.08, 3.4, FZ, x + 0.08, 4.0, FZ + 0.5); K.add(g, 'woodDark'); }
  L.crateB = new Crate(game, 127.0, 4.3, 0.9);
  // plate, kerb, ravine, drawbridge
  L.plate = new Plate(game, 127.2, 129.1, 0);
  // stone lip at the ravine edge
  vbox(136.45, -0.02, FZ, 136.85, 0.08, 2.5, 'limestone', { base: 0 });
  L.bridge = new Drawbridge(game, { x0: 136.8, x1: 140.3, y: 0, source: () => L.plate.load });
  // canyon view through the ravine gap
  vbox(136.8, -9, FZ - 30, 140.3, -8.9, FZ, 'sand', { cast: false });
  vbox(136.0, -9, FZ - 30, 136.8, 14, FZ - 0.1, 'plasterBlue', { base: -9, grime: 4 });
  vbox(140.3, -9, FZ - 30, 141.1, 12, FZ - 0.1, 'plasterPeach', { base: -9, grime: 4 });
  vbox(136.0, -9, FZ - 31, 141.1, 16, FZ - 30, 'plasterCream', { base: -9, grime: 4 });
  laundry(K, new THREE.Vector3(136.8, 6, FZ - 6), new THREE.Vector3(140.3, 6.3, FZ - 7), { sag: 0.3, seed: 8, cloths: 3 });
  laundry(K, new THREE.Vector3(136.8, 8.5, FZ - 14), new THREE.Vector3(140.3, 8.2, FZ - 15), { sag: 0.3, seed: 9, cloths: 3 });
  shaft(138.5, -2, FZ - 10, { w: 3, d: 3, len: 22, intensity: 0.12 });
  lantern(133.9 + 1.0, 2.8, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  pot(K, 132, 0, -1.1, { kind: 'jar' }); sack(K, 132.6, 0, -1.1);
  rugRoll(K, 119.5, 0, 5.6, { seed: 31, len: 2.3, r: 0.2 }); barrel(K, 131, 0, 6.0);
  eave(K, { x0: 126, x1: 136, y: 8.2, z: 4.6, depth: 1.2 });
  cam(120, { dist: 14, height: 2.6, lookY: 2.7, fov: 36, ahead: 1.2 });
  cam(127, { dist: 15.5, height: 3.0, lookY: 3.0, fov: 37, ahead: 1.4 });
  cam(134, { dist: 15.5, height: 3.6, lookY: 0.9, fov: 38, ahead: 2.2 });
  cam(139, { dist: 14, height: 2.6, lookY: 1.2, fov: 36, ahead: 2.0 });

  // ================================================================ E — THE CHASE (x 141 .. 186)
  cp(141.4, 141.5, 0, 1);
  L.guard = new Guard(game, { x: 132.4, y: 0, speed: 3.95, blockX: 182.6 });
  L.triggers.push(new Trigger({ id: 'chase', x0: 144.2, x1: 190, fn: (g) => { L.guard.activate(); g.onChase && g.onChase(); } }));
  facades([
    [147, 153, 9, 'blue', { door: 150, doorKind: 'pointed' }],
    [153, 160, 3.2, 'ochre', { door: false, noGroundWindows: true, depth: 4 }],
    [160, 168, 11, 'blue', { door: 164, doorKind: 'horseshoe' }],
    [168, 176, 8, 'white', { door: false }],
    [176, 182.6, 10, 'blue', { door: false }],
    [182.6, 185.25, 6, 'peach', { door: false, depth: 4 }],
    [190.75, 205, 13, 'cream', { door: false }],
  ]);
  awning(K, { x0: 153.2, x1: 159.8, z0: FZ + 0.02, z1: 0.1, y0: 2.8, y1: 2.2, mat: 'fabricTan' });
  // barrels
  solid(149.55, 0, 150.45, 0.82, { ledges: false, surface: 'wood' });
  barrel(K, 149.8, 0, 0.1, { r: 0.28, h: 0.82 }); barrel(K, 150.2, 0, -0.45, { r: 0.28, h: 0.82 });
  // cart
  solid(155.4, 0, 158.3, 1.25, { surface: 'wood' });
  cart(K, 156.7, 0, 0.1, { w: 2.8 });
  const cartTop = boxMM(155.35, 1.0, -0.62, 158.35, 1.25, 0.62); K.add(cartTop, 'wood');
  // crates stack
  solid(163.4, 0, 164.4, 0.95, { surface: 'wood' });
  const cm = crateMeshStatic(game, 163.9, 0, 0.95); game.scene.add(cm);
  // high wall section
  block(170, 178, 0, 2.0, { z0: FZ, z1: 1.3, mat: 'sandstone', coping: 'limestone' });
  pot(K, 172, 2.0, -1.0, { kind: 'planter' }); leafClump(K, { x: 172, y: 2.45, z: -1.0, r: 0.35, seed: 51 });
  // rubble pile with a crawl tunnel
  solid(182.6, 0.62, 185.6, 5.5, { ledges: false });
  rubblePile(K, 182.4, 185.8, 0.62, r);
  laundry(K, new THREE.Vector3(147, 6.5, FZ), new THREE.Vector3(160, 5.5, 3.5), { sag: 0.6, seed: 12, cloths: 6 });
  lantern(150 + 1.1, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  lantern(164 + 1.1, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  ivyCurtain(K, { x0: 160.5, x1: 167.5, y: 11, z: FZ, maxLen: 5, seed: 17, flowers: 0.5 });
  rugRoll(K, 146, 0, 5.8, { seed: 41 }); barrel(K, 161, 0, 6.2); pot(K, 175, 0, 5.8, { kind: 'amphora', s: 1.3 });
  souqCanopy(K, { x0: 147, x1: 170, y: 6.8, seed: 7 });
  shaft(156.5, 0, 0.3, { w: 3, len: 14, intensity: 0.1 });
  cam(141, { dist: 12.5, height: 1.5, lookY: 1.6, fov: 34, ahead: 2.2 });
  cam(146, { dist: 12, height: 1.5, lookY: 1.6, fov: 35, ahead: 2.8 });
  cam(179, { dist: 11, height: 1.4, lookY: 1.5, fov: 34, ahead: 2.0 });
  cam(184, { dist: 9.5, height: 1.0, lookY: 1.1, fov: 34, ahead: 1.0 });

  // ================================================================ F — INTO THE LIGHT (hero alley along -z)
  cp(185.9, 186.2, 0, 1);
  L.finale = buildHeroAlley(game, batch, K, L, lantern);
  L.triggers.push(new Trigger({ id: 'finale', x0: 187.4, x1: 195, fn: (g) => g.startFinale && g.startFinale() }));
  cam(186.5, { dist: 9.5, height: 1.1, lookY: 1.3, fov: 36, ahead: 0.6 });

  // ================================================================ SKYLINE
  skyline(K, farBuilding, r);
  dome(K, { x: 61, y: 10, z: -44, r: 6.5, drumH: 3.5 });
  dome(K, { x: 150, y: 9, z: -38, r: 5 });
  minaret(K, { x: 30, z: -40, w: 3.4, h: 25 });
  minaret(K, { x: -8, z: -34, w: 3, h: 20, top: 'pyramid' });
  minaret(K, { x: 160, z: -46, w: 3.2, h: 24, top: 'pyramid' });

  const meshes = batch.build(game.scene);
  L.staticMeshes = meshes;
  return L;
}

function crateMeshStatic(game, x, y, s) {
  const Crate0 = new Crate(game, x, y, s);
  // not simulated: remove the physics body, keep the mesh (collider added separately)
  game.phys.bodies.splice(game.phys.bodies.indexOf(Crate0.body), 1);
  return Crate0.mesh;
}

function cypress(K, x, z, h) {
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
}

function rubblePile(K, x0, x1, gapY, r) {
  // big stones and broken beams stacked over a low tunnel
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
}

function skyline(K, farBuilding, r) {
  const styles = ['cream', 'peach', 'ochre', 'white', 'blue', 'cream', 'peach', 'stone'];
  // row 2 (just behind the street facades)
  for (let x = -40; x < 240;) { const w = 4 + r() * 6; if (x + w > 66 && x < 118) { x = 118; continue; } if (x + w > 176 && x < 203) { x = 203; continue; } farBuilding(x, x + w, -12 - r() * 5, 6 + r() * 5, styles[Math.floor(r() * styles.length)], { depth: 6 }); x += w + (r() < 0.25 ? 1.5 + r() * 3 : 0.2); }
  // row 3
  for (let x = -60; x < 260;) { const w = 5 + r() * 8; if (x + w > 174 && x < 205) { x = 205; continue; } farBuilding(x, x + w, -24 - r() * 12, 7 + r() * 7, styles[Math.floor(r() * styles.length)], { depth: 8, cast: false }); x += w + r() * 3; }
  // row 4 (hazy far city)
  for (let x = -100; x < 320;) { const w = 8 + r() * 14; farBuilding(x, x + w, -55 - r() * 40, 9 + r() * 12, styles[Math.floor(r() * styles.length)], { depth: 10, parapet: r() < 0.5, cast: false }); x += w + r() * 4; }
  // cypress and far domes punctuating the skyline
  for (let i = 0; i < 26; i++) { const x = -30 + i * 10 + r() * 6; if ((x > 64 && x < 120) || (x > 174 && x < 205)) continue; cypress(K, x, -20 - r() * 14, 7 + r() * 6); }
  for (const [dx, dz, dr] of [[12, -60, 4], [88, -70, 5], [118, -52, 3.5], [212, -58, 4.5], [-22, -66, 4]]) dome(K, { x: dx, y: 9, z: dz, r: dr, drumH: 2.5 });
}

// ---------------------------------------------------------------------------
// The hero alley: recreation of the reference composition, walked into depth.
// ---------------------------------------------------------------------------
function buildHeroAlley(game, batch, K, L, lantern) {
  const X = 188; // alley centre line
  const xl = 185.25, xr = 190.75; // wall faces
  const zEnd = -15; // arch wall front face
  // floor: cobbles along the alley & courtyard beyond
  const floor = boxMM(xl - 0.5, -0.6, -40, xr + 0.5, 0, FZ - 0.3); shadeByHeight(floor, { base: -0.6, grime: 0.1, grimeAmt: 0 }); K.add(floor, 'cobbles', null, { cast: false });
  const cfloor = boxMM(xl - 8, -0.6, -40, xr + 8, 0.01, zEnd - 0.6); K.add(cfloor, 'sand', null, { cast: false });

  // LEFT wall (faces +x): blue lower storey, yellow upper with tile roundels
  const KL = K.with(new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(xl, 0, 0)));
  // in KL local space: x -> -z world (x_local = -z_world), front face z_local=0 -> x_world = xl
  building(KL, { x0: 1.2, x1: -zEnd + 1, z: 0, y0: 0, height: 7.2, style: 'blue', door: 7.5, doorKind: 'pointed', depth: 5, merlons: false, winSkip: 0.75, noGroundWindows: true, seed: 901 });
  wallWithOpenings(KL, { x0: 1.2, x1: -zEnd + 1, y0: 7.2, y1: 15, z: 0.05, depth: 0.4, mat: 'plasterOchre', openings: [] });
  for (let i = 0; i < 9; i++) { // tile roundels band
    const cx = 2 + i * 1.5;
    const rd = new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24); rd.rotateX(Math.PI / 2); rd.translate(cx, 9.6, 0.1);
    KL.add(worldUV(rd), 'zellige', null, { cast: false });
    const rr = new THREE.TorusGeometry(0.46, 0.05, 6, 24); rr.translate(cx, 9.6, 0.12); KL.add(worldUV(rr), 'limestone');
  }
  cornice(KL, { x0: 1.2, x1: -zEnd + 1, y: 7.0, z: 0.05, profile: 'heavy', mat: 'limestone', scale: 0.9 });
  cornice(KL, { x0: 1.2, x1: -zEnd + 1, y: 14.6, z: 0.05, profile: 'classic', mat: 'limestone', scale: 1.2 });
  ivyCurtain(KL, { x0: 1.5, x1: 9.5, y: 14.8, z: 0.1, maxLen: 7, seed: 61, flowers: 0.3, density: 1.8, scale: 1.7 });
  ivyCurtain(KL, { x0: 2, x1: 12, y: 7.4, z: 0.3, maxLen: 2.2, seed: 62 });
  // big scalloped eave near the camera + beige stall awning + lantern
  eave(KL, { x0: 1.6, x1: 7.4, y: 6.6, z: 0.1, depth: 0.85, drop: 0.5, soffit: 'wood' });
  awning(KL, { x0: 6.6, x1: 10.6, z0: 0.05, z1: 2.2, y0: 2.9, y1: 2.2, mat: 'fabricTan', sag: 0.14, poles: true });
  const lp = new THREE.Vector3(xl + 0.02, 3.6, -9.2);
  const lb = bracket(K, lp.x, lp.y, lp.z, { len: 0.62, dir: 1 });
  void lb;
  const lan = lanternMesh(game.mats, { s: 1.25 }); lan.position.set(xl + 0.64, 3.6 - 0.6, -9.2); game.scene.add(lan);
  L.lanterns.push({ mesh: lan, light: null, phase: 1 });
  // right side (faces -x): arcade with red/cream horseshoe arches + stair + striped awning
  const KR = K.with(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(xr, 0, 0)));
  // local x -> +z world ... x_local = z_world ; choose range for z_world in [-14.5, -1.8]
  arcade(KR, { x0: -14.6, x1: -1.6, z: 0, y0: 2.2, span: 2.2, pierW: 0.7, pierD: 0.6, hs: 2.4, upper: 3.2, mat: 'plasterPeach', galleryDepth: 2.6 });
  // podium under the raised arcade
  const pod = boxMM(-14.6, 0, -3.4, -1.6, 2.2, 0.05); shadeByHeight(pod, { base: 0, grime: 1.4, grimeAmt: 0.35 }); KR.add(pod, 'plasterPeach');
  stairs(KR, { x0: -5.2, x1: -11.2, y0: 0, y1: 2.2, z0: -0.2, z1: 1.2, mat: 'limestone', rail: true, railSide: 'front' });
  ivyCurtain(KR, { x0: -14, x1: -2, y: 10.2, z: 0.1, maxLen: 6.5, seed: 63, flowers: 1.0, density: 2.2, scale: 1.8 });
  // striped red awning on the right, seen from below like the reference
  const KRa = K.with(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(xr, 0, 0)));
  awning(KRa, { x0: -6.8, x1: -3.9, z0: 0.05, z1: 1.7, y0: 2.5, y1: 1.95, mat: 'fabricRed', sag: 0.16, poles: false });
  // END wall with the great pointed arch
  const aw = 3.3, ahs = 4.3, arise = 2.2;
  wallWithOpenings(K, { x0: xl - 1, x1: xr + 1, y0: 0, y1: 9.2, z: zEnd, depth: 0.9, mat: 'plasterBlue', openings: [{ kind: 'pointed', cx: X, sill: 0, w: aw, hs: ahs, rise: arise, noInterior: true }] });
  archFrame(K, { kind: 'pointed', cx: X, sill: 0, w: aw, hs: ahs, rise: arise, band: 0.34, depth: 0.3, z: zEnd + 0.12, mat: 'limestone', steps: 2 });
  zellige(K, { x0: X - 2.6, x1: X - aw / 2 - 0.36, y0: 1.2, y1: 6.9, z: zEnd + 0.02, border: 0.06 });
  zellige(K, { x0: X + aw / 2 + 0.36, x1: X + 2.6, y0: 1.2, y1: 6.9, z: zEnd + 0.02, border: 0.06 });
  zellige(K, { x0: X - 2.6, x1: X + 2.6, y0: 6.9, y1: 7.4, z: zEnd + 0.02, border: 0.04 });
  cornice(K, { x0: xl - 1, x1: xr + 1, y: 7.6, z: zEnd + 0.02, profile: 'heavy', mat: 'limestone', scale: 1.0 });
  cornice(K, { x0: xl - 1, x1: xr + 1, y: 9.0, z: zEnd + 0.02, profile: 'classic', mat: 'limestone', scale: 1.0 });
  ivyCurtain(K, { x0: xl - 0.8, x1: xr + 0.8, y: 9.3, z: zEnd + 0.1, maxLen: 3.4, seed: 64, density: 2.4, scale: 1.7 });
  ivyPatch(K, { x0: X - 2.2, x1: X + 2.4, y0: 7.8, y1: 9.2, z: zEnd + 0.05, seed: 65, density: 1.5 });
  // courtyard beyond the arch (sunlit)
  const cz0 = zEnd - 0.9;
  building(K, { x0: xl - 6, x1: xr + 6, z: -29, y0: 0, height: 8.5, style: 'peach', door: X + 0.8, doorKind: 'round', depth: 4, seed: 902 });
  stairs(K, { x0: X - 3.8, x1: X - 1.2, y0: 0, y1: 1.4, z0: -27.8, z1: -25.6, mat: 'limestone', rail: false });
  building(K.with(new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(xl - 3, 0, 0))), { x0: -cz0 + 0.2, x1: 29, z: 0, y0: 0, height: 7, style: 'ochre', door: 22, depth: 3, seed: 903 });
  building(K.with(new THREE.Matrix4().makeRotationY(-Math.PI / 2).premultiply(new THREE.Matrix4().makeTranslation(xr + 4.5, 0, 0))), { x0: -29, x1: cz0 - 0.2, z: 0, y0: 0, height: 4.2, style: 'cream', door: -22, depth: 3, seed: 904 });
  // round tower with balcony behind the courtyard (reference mid-ground)
  const tw = new THREE.CylinderGeometry(2.2, 2.3, 11, 32); tw.translate(X + 2.5, 5.5, -33); K.add(worldUV(tw), 'plasterPeach');
  const twb = new THREE.CylinderGeometry(2.6, 2.6, 0.4, 32); twb.translate(X + 2.5, 8.2, -33); K.add(worldUV(twb), 'limestone');
  merlons(K, { x0: X + 0.3, x1: X + 4.7, y: 11, z: -30.8, h: 0.5 });
  drape(K, new THREE.Vector3(xl - 0.5, 5.6, zEnd - 1.4), new THREE.Vector3(xr + 0.5, 6.2, zEnd - 3.6), { width: 2.2, sag: 1.4, mat: 'fabricTeal', twist: 0.45 });
  drape(K, new THREE.Vector3(xl - 0.8, 6.4, zEnd - 5), new THREE.Vector3(xr + 1, 5.9, zEnd - 6.5), { width: 1.8, sag: 1.1, mat: 'fabricCream', twist: -0.3 });
  awning(K, { x0: X + 0.3, x1: X + 2.2, z0: -23.2, z1: -21.4, y0: 2.3, y1: 1.9, mat: 'fabricPink', sag: 0.2 });
  pot(K, X - 1.4, 0, -24.5, { kind: 'amphora' }); pot(K, X - 0.9, 0, -24.9, { kind: 'jar', s: 0.8 }); pot(K, X + 3, 0, -26, { kind: 'tall' });
  cart(K, X + 2.4, 0, -20.5, { w: 1.6, rot: 1.2 });
  grassTufts(K, { x0: X - 3, x1: X + 3, z0: -24, z1: -16, n: 30, seed: 71 });
  // alley props (reference foreground)
  rugRoll(K, xl + 0.35, 0, -2.2, { seed: 71, r: 0.2, len: 2.2, lean: 0.12 });
  rugRoll(K, xl + 0.75, 0, -1.9, { seed: 72, r: 0.17, len: 1.8, lean: -0.08 });
  barrel(K, xl + 1.3, 0, -5.6, { r: 0.32 });
  pot(K, xr - 0.6, 0, -6.4, { kind: 'jar' }); pot(K, xr - 0.4, 0, -7.0, { kind: 'amphora' });
  const pedestal = boxMM(xr - 1.5, 0, -12.2, xr - 1.0, 0.95, -11.7); K.add(pedestal, 'limestone');
  basket(K, xl + 1.2, 0, -9.2);
  grassTufts(K, { x0: xl + 0.2, x1: xr - 0.2, z0: -14, z1: -2, n: 40, seed: 72 });
  wire(K, new THREE.Vector3(xl - 0.1, 12.5, -4), new THREE.Vector3(xr + 0.1, 11.2, -6.5), { sag: 0.6 });
  // landmarks framing the sky
  minaret(K, { x: X - 6.5, z: -46, w: 3.6, h: 28, mat: 'sandstone' });
  // white round tower carrying the green-gold dome (reference, upper right)
  const tw2 = new THREE.CylinderGeometry(4.8, 5.0, 15, 40); tw2.translate(X + 2.6, 7.5, -33); const tw2u = worldUV(tw2); shadeByHeight(tw2u, { base: 0, grime: 4, grimeAmt: 0.25 }); K.add(tw2u, 'plasterWhite');
  dome(K, { x: X + 2.6, y: 15, z: -33, r: 5.0, drumH: 3.4, onion: 0.22, windows: 10 });
  ivyPatch(K, { x0: X - 1.5, x1: X + 3.5, y0: 13, y1: 19, z: -28.1, seed: 77, density: 1.4 });
  // sun shafts through the arch and over the courtyard
  L.shaftSpots.push({ p: new THREE.Vector3(X - 0.6, 0, zEnd + 3.5), o: { w: 2.6, d: 2.2, len: 16, intensity: 0.16 } });
  L.shaftSpots.push({ p: new THREE.Vector3(X - 1.5, 0, zEnd - 4), o: { w: 3.2, d: 3, len: 20, intensity: 0.12 } });
  L.dustRegions.push({ x0: xl, x1: xr, y0: 0.2, y1: 6, z0: -20, z1: -2 });
  return {
    X, zEnd,
    path: [new THREE.Vector3(187.6, 0, 0), new THREE.Vector3(188.1, 0, -1.6), new THREE.Vector3(188.0, 0, -6), new THREE.Vector3(188.0, 0, -12), new THREE.Vector3(188.0, 0, -17.5), new THREE.Vector3(188.2, 0, -22)],
    camPos: new THREE.Vector3(187.55, 0.45, 1.8),
    camLook: new THREE.Vector3(188.5, 8.4, -15),
    fov: 68,
    sunDir: new THREE.Vector3(0.3, 0.22, -0.93).normalize(),
  };
}
