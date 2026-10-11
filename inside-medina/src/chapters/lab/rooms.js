import * as THREE from 'three';
import { Crate, Gate, Searchlight, Guard, Trigger } from '../../game/entities.js';
import { Body } from '../../game/physics.js';
import { Drawbridge, RopeLadder } from '../../game/bridge.js';
import { LightSystem, SunRay, MoonRay, Mirror, Crank, Capstan, SunLock, LampEye, Sensor, BurnRope, Occluder, Terminator, SunClock } from '../../game/light/index.js';
import { starInlay, lightMaterials, starCookie } from '../../assets/lightprops.js';
import { hangingRug, pole, wire, basket, laundry, lanternMesh, barrel } from '../../assets/props.js';
import { ivyPatch, ivyCurtain } from '../../assets/foliage.js';
import { Batcher, boxMM, setColor, worldUV } from '../../assets/geom.js';
import { merlons } from '../../assets/architecture.js';

// The Sunwork lab (FULL_GAME §11.4 L): twelve rooms, one per verb of §6.7 plus the jump-fix and kerb rooms,
// built with the puzzle numbers of §3–5 (Chapter II's rooms keep their own x; the night rooms are Chapter III's
// moved by +176 / +255 / +140, the dawn rooms Chapter IV's by +330 / +310). The look follows the day: sunset
// for the brass rooms, the clock's dusk, night, then dawn to sunrise.
//   1 sunlock (II-A1)   2 shadow (II-A2)   3 kerb (II-B1)   4 tilt (II-B2)   5 jumpfix   6 bolt (II-C2)
//   7 crank (II-D1)     8 burn (II-D2)     9 clock (II-E2)  10 lamp (III-B1, B2)   11 wire (III-A, C2, D, E)
//   12 dawn (IV-A1, IV-C, IV-E)
export const ROOMS = ['sunlock', 'shadow', 'kerb', 'tilt', 'jumpfix', 'bolt', 'crank', 'burn', 'clock', 'lamp', 'wire', 'dawn'];
export const LOOK_KEYS = [
  { x: -10, preset: 'sunset' }, { x: 176, preset: 'sunset' }, { x: 204, preset: 'dusk' }, { x: 212, preset: 'night' },
  { x: 342, preset: 'night' }, { x: 352, preset: 'dawn' }, { x: 470, preset: 'sunrise' },
];
// the sky through an aperture: a glow brightest where the ray enters (low centre), its colour and strength the
// live sun's (a warm blaze at sunset, a dim blue under the moon); one material for every window
function apertureGlow() {
  const n = 64, c = document.createElement('canvas'); c.width = c.height = n;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(n * 0.5, n * 0.58, 0, n * 0.5, n * 0.58, n * 0.75);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, '#d8c6b0'); g.addColorStop(1, '#5a4a40');
  x.fillStyle = g; x.fillRect(0, 0, n, n);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.name = 'lab.aperture';
  return t;
}

export function* buildLab(game, kit) {
  const { L, K, FZ, ground, block, vbox, lantern, cp, cam, farBuilding, kerb, killZone, solid, r } = kit;
  lightMaterials(game.mats);
  const light = new LightSystem(game, kit);
  L.systems.push(light);
  L.light = light;
  const E = (e) => { L.entities.push(e); return e; };
  const add = (e) => light.add(e);
  const solved = []; // per room: what prepare() sets when a later checkpoint starts
  const room = (name, solve) => solved.push({ name, solve });
  const gate = (id, x, h, lift, source, o = {}) => { const g = E(new Gate(game, { x, y0: o.y0 ?? 0, h, lift, w: o.w ?? 1.5, thick: o.thick ?? 0.8, kind: o.kind ?? 'pointed' })); g.id = id; g.source = source; return g; };
  const lock = (id, x, y, o = {}) => add(new SunLock(game, { id, x, y, ...o }));
  const sun = (id, x, y, angle = 195, o = {}) => add(new SunRay({ id, x, y, angle, ...o }));
  const star = (x, y = 0) => { const m = starInlay(game.mats); m.position.set(x, y + 0.002, 0.15); game.add(m); };
  const winMat = new THREE.MeshBasicMaterial({ map: apertureGlow(), color: 0xffffff, fog: false, toneMapped: true });
  // a puzzle room's frame (FULL_GAME §1.2): while the boy is between x0 and x1 the camera holds the room's centre
  // cx (keys at both ends and the middle, focusBias cx − x, no look-ahead), so the source, the tool and the target
  // share one frame; distPortrait fits the room's span inside the 52° field of a phone held upright
  const frame = (x0, x1, cx, o) => { for (const x of [x0, (x0 + x1) / 2, x1]) cam(x, { ...o, ahead: 0, focusBias: cx - x }); };
  // a wall in the play plane with apertures: [y0, y1] spans of solid stone, a glowing sky in each window
  const wall = (x0, x1, spans, { mat = 'sandstone', windows = [] } = {}) => {
    for (const [y0, y1] of spans) block(x0, x1, y0, y1, { mat, coping: y0 > 0 ? null : 'limestone', ledges: false });
    for (const [y0, y1] of windows) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 0.02, y1 - y0), winMat);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, FZ + 0.05); m.rotation.y = 0; game.add(m);
      vbox(x0 - 0.06, y0 - 0.08, FZ, x1 + 0.06, y0, 1.35, 'limestone', { base: y0 - 0.1, grimeAmt: 0.1 });
      vbox(x0 - 0.06, y1, FZ, x1 + 0.06, y1 + 0.08, 1.35, 'limestone', { base: y1, grimeAmt: 0.1 });
    }
  };
  const rugCover = (x, covers) => {
    hangingRug(K, x, 2.45, -0.8, { w: 1.9, h: 2.2 });
    covers.push(new THREE.Box3(new THREE.Vector3(x - 0.95, 0.2, -0.87), new THREE.Vector3(x + 0.95, 2.47, -0.73)));
    pole(K, x - 1.2, 0, 2.7, -0.8, 0.04); pole(K, x + 1.2, 0, 2.7, -0.8, 0.04);
    wire(K, new THREE.Vector3(x - 1.2, 2.62, -0.8), new THREE.Vector3(x + 1.2, 2.62, -0.8), { sag: 0.12, r: 0.01 });
  };

  // ================================================================ the street (floor, facades, far city)
  ground(-20, 140.5); ground(144, 520);
  block(-30, -4, 0, 14, { visual: false, ledges: false });
  const styles = ['peach', 'cream', 'ochre', 'white', 'blue', 'cream', 'peach', 'stone'];
  const SQ0 = 207.6, SQ1 = 257.4;
  ground(SQ0, SQ1, { z0: -8.4, z1: FZ - 0.3, collide: false });
  for (let x = -12, i = 0; x < 512; i++) {
    const w = 5 + r() * 4;
    const night = x > 206 && x < 345;
    const h = (night ? 8 : 7) + r() * 6, st = styles[i % styles.length];
    // the lamp room is an open square: no facade between the play plane and the lamp-keepers' wall, so the
    // cones fall whole from the lamps to the street
    for (const [a, b] of [[x, Math.min(x + w, SQ0)], [Math.max(x, SQ1), x + w]]) if (b - a > 0.4) farBuilding(a, b, FZ - 0.02, h, st, { depth: 4 });
    x += w;
  }
  for (let x = -40; x < 540;) { const w = 7 + r() * 9; farBuilding(x, x + w, -14 - r() * 12, 9 + r() * 8, styles[Math.floor(r() * styles.length)], { depth: 8, cast: false }); x += w + r() * 4; }
  yield 0.1;

  // ================================================================ 1 SUNLOCK: light opens (II-A1, watch)
  cp(-100, 1.5, 0, 1);
  block(-4, -3, 0, 12, { ledges: false, mat: 'plasterOchre' });
  const L1 = lock('L1', -2.75, 1.06, { degree: 0, rod: [[-2.75, 1.5, -0.6], [-3.2, 3.2, -1.2], [-1, 3.6, -1.5], [8, 3.6, -1.5], [12.6, 2.8, -1.5]] });
  const clothMesh = new THREE.Group();
  { const cl = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.55, 6, 8), game.mats.get('fabricRed')); setColor(cl.geometry, 0xffffff); cl.castShadow = true; clothMesh.add(cl); clothMesh.position.set(7.6, 3.65, 0.05); game.add(clothMesh); }
  pole(K, 5.6, 0, 4.7, 0.2, 0.05); pole(K, 9.6, 0, 4.7, 0.2, 0.05);
  wire(K, new THREE.Vector3(5.6, 4.55, 0.2), new THREE.Vector3(9.6, 4.55, 0.2), { sag: 0.15, r: 0.012 });
  const cloth = add(new Occluder(game, { id: 'cloth', x0: 7.0, y0: 2.9, x1: 8.2, y1: 4.4, mesh: clothMesh }));
  L.triggers.push(new Trigger({ id: 'gust', x0: 3, x1: 12, fn: (g) => { cloth.to({ y0: 4.4, y1: 5.0 }, 1.2); g.sfx('wings', 7.6); g.dust?.emit(new THREE.Vector3(6, 0.2, 0), { count: 18, spread: 2.5, up: 1.2, size: 0.9, alpha: 0.3 }); } }));
  const G1 = gate('G1', 13.0, 2.6, 2.5, () => (L1.done ? 1 : 0));
  wall(12.6, 13.4, [[2.6, 5.0], [5.8, 9]], { windows: [[5.0, 5.8]] });
  sun('sun1', 13.45, 5.4);
  frame(-3, 12.4, 5.15, { dist: 17.5, distPortrait: 18.6, height: 2.6, lookY: 3.6, fov: 39 }); // L1 −2.75 … the window 13.45
  room('sunlock', () => { L1.setState({ level: 1, done: true }); cloth.setState({ x0: 7.0, y0: 4.4, x1: 8.2, y1: 5.0 }); G1.setState({ open: 1 }); });
  L.hints.push({ x0: 3, x1: 12, after: 6, glyph: 'up', unless: () => L1.done });

  // ================================================================ 2 SHADOW: a crate's shadow (II-A2)
  cp(13.6, 14.0, 0, 1);
  block(17, 21, 0, 2.0, { mat: 'sandstone' });
  const post = boxMM(17.36, 2.0, -0.06, 17.44, 2.18, 0.02); K.add(post, 'brassAged');
  const L2 = lock('L2', 17.4, 2.5, { degree: 1, mount: 0.12 });
  const CR1 = E(new Crate(game, 18.5, 2.0, 1.0, { id: 'CR1' }));
  const G2 = gate('G2', 30.2, 2.6, 2.5, () => (L2.done ? 1 : 0));
  wall(29.8, 30.6, [[2.6, 5.6], [6.4, 12]], { windows: [[5.6, 6.4]] });
  sun('sun2', 30.65, 6.05);
  frame(15, 29.8, 23.8, { dist: 17.5, distPortrait: 15.6, height: 2.8, lookY: 3.8, fov: 39 }); // L2 17.4 … the window 30.65
  room('shadow', () => { CR1.setState({ x: 21.8, y: 0 }); L2.setState({ level: 1, done: true }); G2.setState({ open: 1 }); });
  yield 0.2;

  // ================================================================ 3 KERB: the first mirror, pushed to its stop (II-B1)
  cp(30.8, 31.2, 0, 1);
  const M1 = add(new Mirror(game, { id: 'M1', kind: 'wheeled', x: 33.0, alpha: -15, zone: { x0: 31.0, x1: 45.2 }, thetaHint: 195 }));
  kerb(40.35, 40.5); star(40.0);
  const L3 = lock('L3', 37.0, 4.2, { degree: 2 });
  const G3 = gate('G3', 46.0, 2.2, 2.0, () => (L3.done ? 1 : 0));
  wall(45.6, 46.4, [[2.2, 2.4], [3.2, 12]], { windows: [[2.4, 3.2]] });
  sun('sun3', 46.45, 2.93);
  // portrait (a 52° horizontal floor): rooms whose source, tool and target span ≤ 14 m come closer on a phone
  frame(32, 45.4, 39.45, { dist: 17.5, distPortrait: 16, height: 2.4, lookY: 2.9, fov: 39 }); // M1 33 … the window 46.45
  room('kerb', () => { M1.setState({ x: 40.0, y: 0, alpha: -15 }); L3.setState({ level: 1, done: true }); G3.setState({ open: 1 }); });

  // ================================================================ 4 TILT: an anchored mirror, tilted (II-B2)
  cp(46.6, 47.0, 0, 1);
  const M2 = add(new Mirror(game, { id: 'M2', kind: 'anchored', x: 55.0, alpha: 30, thetaHint: 195 }));
  const L4 = lock('L4', 56.23, 5.8, { degree: 3 });
  const G4 = gate('G4', 62.0, 2.4, 2.2, () => (L4.done ? 1 : 0));
  wall(61.6, 62.4, [[2.4, 2.6], [3.4, 12]], { windows: [[2.6, 3.4]] });
  sun('sun4', 62.45, 3.20);
  // compact (8 m from the floor spot to the window): it follows the boy, close on a phone
  for (const x of [48, 61]) cam(x, { dist: 17.5, distPortrait: 14, height: 2.8, lookY: 3.6, fov: 39, ahead: 0.8, focusBias: 1.2 });
  room('tilt', () => { M2.setState({ x: 55.0, y: 0, alpha: -45 }); L4.setState({ level: 1, done: true }); G4.setState({ open: 1 }); });
  L.hints.push({ x0: 53.5, x1: 55, after: 3, glyph: 'tilt', unless: (g) => L4.done || g.player.grip?.mirror !== M2 || M2.target !== 30 });
  yield 0.3;

  // ================================================================ 5 JUMPFIX: up tilts, it never jumps
  // An anchored mirror MJ at −45° must go UP three notches to 0° (the range stops it going round the other way);
  // with the old jump buffer every up-press threw the boy off the tray into a jump.
  cp(62.6, 63.0, 0, 1);
  const MJ = add(new Mirror(game, { id: 'MJ', kind: 'anchored', x: 71.0, alpha: -45, thetaHint: 195 }));
  const LJ = lock('LJ', 64.5, 2.94, { degree: 4 });
  const G5 = gate('G5', 80.0, 2.6, 2.4, () => (LJ.done ? 1 : 0));
  wall(79.6, 80.4, [[2.6, 3.2], [4.0, 12]], { windows: [[3.2, 4.0]] });
  sun('sun5', 80.45, 3.732);
  vbox(68.4, 1.7, FZ, 70.0, 1.9, -0.6, 'woodDark', { base: 1.7 }); // a balcony ledge above, out of reach unless he jumped
  frame(63.5, 79.4, 72.3, { dist: 17.5, distPortrait: 18.3, height: 2.4, lookY: 3.0, fov: 39 }); // LJ 64.5 … the window 80.45
  room('jumpfix', () => { MJ.setState({ x: 71.0, y: 0, alpha: 0 }); LJ.setState({ level: 1, done: true }); G5.setState({ open: 1 }); });
  L.hints.push({ x0: 69.5, x1: 71, after: 3, glyph: 'up', unless: (g) => LJ.done || g.player.grip?.mirror !== MJ });

  // ================================================================ 6 BOLT: light that locks (II-C2)
  cp(80.6, 81.0, 0, 1);
  block(94.5, 94.9, 0, 0.4, { ledges: false, mat: 'limestone', coping: null });
  const B1 = lock('B1', 94.7, 0.6, { r: 0.3, mode: 'bolt', degree: 5, mount: 1.3 });
  B1.setState({ level: 1, done: true }); // lit from the start: the gate never opens before the puzzle
  const CR3 = E(new Crate(game, 100.0, 0, 1.0, { id: 'CR3' }));
  const G6 = gate('G6', 104.0, 2.4, 2.2, () => 1 - B1.level);
  wall(103.6, 104.4, [[2.4, 2.8], [3.6, 12]], { windows: [[2.8, 3.6]] });
  sun('sun6', 104.45, 3.21);
  // the walk in follows him; from the bollard to the gate the frame holds the bolt, the crate and the window
  cam(81.5, { dist: 17.5, distPortrait: 14, height: 2.2, lookY: 2.6, fov: 39, ahead: 0.8, focusBias: 3 });
  frame(93, 103.4, 99.3, { dist: 17.5, distPortrait: 14, height: 2.2, lookY: 2.6, fov: 39 });
  room('bolt', () => { CR3.setState({ x: 95.4, y: 0 }); B1.setState({ level: 0, done: false }); G6.setState({ open: 1 }); });
  yield 0.4;

  // ================================================================ 7 CRANK: a chain through a crank mirror (II-D1)
  cp(104.6, 105.0, 0, 1);
  block(112.0, 118.9, 3.7, 4.0, { mat: 'woodDark', coping: null, z0: FZ, z1: 0.9 });
  for (let x = 112.4; x < 118.9; x += 1.3) K.add(boxMM(x - 0.08, 0, FZ, x + 0.08, 3.7, FZ + 0.4), 'woodDark');
  const ivy = { x0: 111.2, x1: 112.0, y0: 0, y1: 4.0, exit: { x: 112.4, y: 4.0 }, enabled: true };
  game.vines.push(ivy);
  ivyPatch(K, { x0: 111.0, x1: 112.2, y0: 0.1, y1: 4.4, z: FZ, density: 2.6, seed: 71 });
  ivyCurtain(K, { x0: 110.8, x1: 112.4, y: 4.6, z: FZ, maxLen: 1.2, seed: 72, density: 1.4 });
  const M7 = add(new Mirror(game, { id: 'M7', kind: 'wheeled', x: 115.0, alpha: 0, zone: { x0: 105, x1: 125.2 }, thetaHint: 195 }));
  kerb(120.25, 120.4); star(119.9);
  const F2 = add(new Mirror(game, { id: 'F2', kind: 'crank', x: 118.4, y: 6.8, alpha: -15, thetaHint: 105 }));
  add(new Crank(game, { id: 'K2', x: 118.2, y: 4.0, mirror: F2, dir: -1 }));
  const L7 = lock('L7', 125.3, 4.95, { degree: 6 });
  const G7 = gate('G7', 126.0, 2.4, 2.2, () => (L7.done ? 1 : 0));
  wall(125.6, 126.4, [[2.4, 2.6], [3.4, 12]], { windows: [[2.6, 3.4]] });
  sun('sun7', 126.45, 2.96);
  cam(105.5, { dist: 18, height: 3.2, lookY: 4.6, fov: 40, ahead: 0.6, focusBias: 2 });
  // lookY 2.4: on the gallery (y 4) the frame still holds M7 on the floor above the legend; on the floor, F2 and L7
  frame(110, 125.4, 118.8, { dist: 19.5, distPortrait: 17.4, height: 2.6, lookY: 2.4, fov: 40 }); // the ivy 111.2 … the window 126.45
  room('crank', () => { M7.setState({ x: 119.9, y: 0, alpha: -30 }); F2.setState({ alpha: 45 }); L7.setState({ level: 1, done: true }); G7.setState({ open: 1 }); });
  yield 0.5;

  // ================================================================ 8 BURN: two beams on a rope (II-D2)
  cp(126.6, 127.0, 0, 1);
  const pit = vbox(140.5, -9, FZ, 144, -8, 1.3, 'sandstone', { base: -9 }); solid(140.5, -9, 144, -8, { ledges: false });
  vbox(140.4, -8, FZ, 140.5, 0, 1.3, 'limestone', { base: -8 }); vbox(144, -8, FZ, 144.1, 0, 1.3, 'limestone', { base: -8 });
  { const dye = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 3.0), game.mats.std('dyeIndigo', null, { color: 0x1d2a6a, rough: 0.08, metal: 0, envInt: 1.5, vertexColors: false })); dye.rotation.x = -Math.PI / 2; dye.position.set(142.25, -0.4, -0.15); game.add(dye); }
  killZone(140.5, 144, -30, -0.35, 'drown');
  const ROPE = { x0: 134.85, y0: 6.8, x1: 135.15, y1: 8.0 };
  const cw = new THREE.Group();
  { const b = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.7, 0.8, 0.7)), game.mats.get('sandstone')); setColor(b.geometry, 0xd8d0c0); b.castShadow = true; cw.add(b); const ring = new THREE.Mesh(setColor(new THREE.TorusGeometry(0.1, 0.02, 6, 12), 0xffffff), game.mats.get('iron')); ring.position.y = 0.45; cw.add(ring); }
  cw.position.set(136.6, 6.2, -0.2); game.add(cw);
  K.add(boxMM(133.8, 8.3, FZ, 137.4, 8.55, 0.3), 'woodDark'); // the beam the pulleys hang from
  // the rig: the rope is tied to a ring on the wall (x 135, y 6.45), runs up through the burn point, over two
  // pulleys under the beam and down to the counterweight's ring; burnt, the weight falls with its end
  const PR = 0.16, pa = 135.0 + PR, pb = 136.6 - PR, py = 8.3 - 0.05 - PR;
  for (const px of [pa, pb]) {
    const w = new THREE.CylinderGeometry(PR, PR, 0.06, 18); w.rotateX(Math.PI / 2); w.translate(px, py, 0); K.add(w, 'iron', null, { cast: false });
    const strap = boxMM(px - 0.025, py, -0.05, px + 0.025, 8.3, 0.05); K.add(strap, 'iron', null, { cast: false });
  }
  K.add(boxMM(134.9, 6.38, FZ, 135.1, 6.52, FZ + 0.12), 'iron', null, { cast: false });
  { const ring = new THREE.TorusGeometry(0.06, 0.014, 6, 14); ring.translate(135.0, 6.45, -0.02); K.add(ring, 'iron', null, { cast: false });
    const arm = new THREE.CylinderGeometry(0.018, 0.018, -FZ - 0.02, 6); arm.rotateX(Math.PI / 2); arm.translate(135.0, 6.45, FZ / 2 - 0.01); K.add(arm, 'iron', null, { cast: false }); }
  const hemp = game.mats.get('hemp');
  const ropeSeg = (a, b, r = 0.02) => { const len = a.distanceTo(b), g = new THREE.CylinderGeometry(r, r, len, 6); g.translate(0, len / 2, 0); const m = new THREE.Mesh(setColor(g, 0xffffff), hemp); m.position.copy(a); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); m.castShadow = false; return m; };
  const over = ropeSeg(new THREE.Vector3(pa, py + PR, 0), new THREE.Vector3(pb, py + PR, 0)); game.add(over); // the run between the pulleys
  cw.add(ropeSeg(new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, py - 6.2, 0.2))); // down from the second pulley to the ring
  const cwState = { t: -1 };
  const rope = add(new BurnRope(game, { id: 'rope', ...ROPE, onBurnt: () => { cwState.t = 0; } }));
  const bridge = E(new Drawbridge(game, { x0: 140.5, x1: 144, y: 0, source: () => (rope.burnt && cwState.t > 0.6 ? 1 : 0) }));
  bridge.id = 'bridge';
  L.entities.push({ id: 'counterweight', step(dt) { if (cwState.t >= 0 && cwState.t < 2) { const was = cwState.t; cwState.t += dt; if (was < 0.6 && cwState.t >= 0.6) { game.sfx('counterweight', 136.6); game.camRig.addShake(0.4); game.dust?.emit(new THREE.Vector3(136.6, 0, 0), { count: 16, spread: 1.4, size: 0.9, alpha: 0.35 }); } } },
    render() { const t = Math.max(0, Math.min(0.6, cwState.t)); cw.position.y = cwState.t < 0 ? 6.2 : 6.2 - 0.5 * 17 * t * t; over.visible = cwState.t < 0; },
    getState: () => ({ t: cwState.t }), setState: (s) => { cwState.t = s.t; } });
  const M5 = add(new Mirror(game, { id: 'M5', kind: 'wheeled', x: 132.6, alpha: 0, zone: { x0: 127, x1: 140 }, thetaHint: 195 }));
  kerb(132.1, 132.25); kerb(133.69, 133.84); star(133.34);
  wall(146.1, 146.9, [[2.8, 4.2], [5.0, 9.95], [10.75, 14]], { windows: [[4.2, 5.0], [9.95, 10.75]] });
  sun('W7', 146.0, 10.35); sun('W8', 146.0, 4.59);
  cam(127, { dist: 18.5, height: 3.4, lookY: 4.8, fov: 40, ahead: 0.6, focusBias: 3 });
  frame(131, 146, 139, { dist: 18.5, distPortrait: 17, height: 3.4, lookY: 4.8, fov: 40 }); // M5 132.6 … the windows 146
  room('burn', () => { M5.setState({ x: 133.34, y: 0, alpha: -45 }); rope.setState({ heat: 1, burnt: true }); cwState.t = 2; bridge.setState({ angle: 0 }); });
  yield 0.6;

  // ================================================================ corridor, then 9 CLOCK: the last ray (II-E2)
  cp(147.5, 148.0, 0, 1);
  for (const x of [150, 172]) cam(x, { dist: 14, height: 2.0, lookY: 2.4, fov: 37, ahead: 1.6 });
  for (const x of [156, 164, 172]) lantern(x, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.2 });
  cp(175.5, 175.8, 0, 1);
  // the shadow line shades the corridor and the clock tower (x 146 to the square's edge), never the night square
  const term = add(new Terminator(game, { id: 'T', T: 4.0, range: [146, SQ0] }));
  const restoreLook = () => { if (!game.held && game.def) game.director.look(game.def.look, 'lab'); };
  const clock = add(new SunClock(game, { id: 'clock', T0: 4.0, rate: 0.16, y: 12, terminator: term, look: { from: 'sunset', to: 'dusk', sec: 8 }, onReset: restoreLook }));
  L.triggers.push(new Trigger({ id: 'clock', x0: 176, x1: 186, fn: () => clock.start() }));
  block(186, 194.5, 0, 4.6, { mat: 'sandstone' });
  block(189, 194.5, 4.6, 9.2, { mat: 'sandstone', coping: 'limestone' });
  block(190.5, 194.5, 9.2, 10.6, { mat: 'sandstone', coping: 'limestone' });
  const ivy9 = { x0: 185.2, x1: 186.0, y0: 0, y1: 4.6, exit: { x: 186.4, y: 4.6 }, enabled: true };
  const lad9 = { x0: 188.2, x1: 189.0, y0: 4.6, y1: 9.2, exit: { x: 189.4, y: 9.2 }, enabled: true };
  game.vines.push(ivy9, lad9);
  ivyPatch(K, { x0: 185.0, x1: 186.2, y0: 0.1, y1: 5.0, z: FZ, density: 2.6, seed: 91 });
  E(new RopeLadder(game, { x: 188.6, y0: 4.6, y1: 9.2, z: 0.05, vine: lad9 })).setState({ t: 1, target: 1 });
  const F3 = add(new Mirror(game, { id: 'F3', kind: 'crank', x: 194.6, y: 12.0, r: 0.6, alpha: -30, thetaHint: 180 }));
  add(new Crank(game, { id: 'K3', x: 194.1, y: 10.6, mirror: F3, dir: -1 }));
  const downVine = { x0: 194.5, x1: 195.3, y0: 0, y1: 10.6, exit: null, enabled: false };
  game.vines.push(downVine);
  const ladder9 = E(new RopeLadder(game, { x: 194.9, y0: 0, y1: 10.6, z: 0.15, vine: downVine }));
  // the catch: the ladder unrolls and the sun sets over 6 s (the terminator climbs past the last ray)
  const L8 = lock('L8', 199.2, 4.0, { degree: 7, onOpen: () => { ladder9.release(); clock.finish(6); } });
  block(199.5, 203.5, 5.0, 11.0, { mat: 'plasterOchre', coping: 'limestone' });
  merlons(K, { x0: 199.6, x1: 203.4, y: 11, z: -0.4, h: 0.5, mat: 'plasterCream' });
  const G9 = gate('G9', 201.5, 5.0, 4.6, () => (L8.done ? 1 : 0), { w: 3.4, thick: 0.6 });
  add(new SunRay({ id: 'lastRay', x: 214, y: 12.0, angle: 180, clipByTerminator: term }));
  L.triggers.push(new Trigger({ id: 'dusk', x0: 205.5, x1: 212, fn: () => restoreLook() }));
  cam(176, { dist: 19, distPortrait: 17.2, height: 4.8, lookY: 6.4, fov: 40, ahead: 1.0, focusBias: 4 });
  // the room's frame holds x 193 (the ivy 185.2 … L8 199.2); on the tower (tiers at y 4.6, 9.2, 10.6) it stays down
  // on the ray's whole path, F3 (y 12) to L8 (y 4): yBias undoes his height there (the camera follows the ground
  // he stands on)
  for (const [x, yb] of [[186, 0], [186.6, -3.0], [188.8, -3.0], [189.4, -6.4], [190.3, -6.4], [190.9, -7.8], [194.3, -7.8], [195.3, 0], [200.5, 0]]) cam(x, { dist: 19, distPortrait: 17.2, height: 4.8, lookY: 5.6, fov: 40, ahead: 0, focusBias: 193 - x, yBias: yb });
  room('clock', () => { L8.setState({ level: 1, done: true }); ladder9.setState({ t: 1, target: 1 }); G9.setState({ open: 1 }); clock.setState({ t: 0, running: false, expired: false, setT: 6 }); });
  yield 0.7;

  // ================================================================ 10 LAMP: bounce the lamp's own light, then dazzle it (III-B1, B2; +176)
  cp(207, 207.5, 0, 1);
  const coversA = [], coversB = [];
  for (const x of [215.5, 220, 224.5, 227]) rugCover(x, coversA);
  rugCover(246.5, coversB);
  const S1 = E(new Searchlight(game, { id: 'S1', origin: new THREE.Vector3(221, 13, -8), x0: 212, x1: 230, aimY: 0.4, speed: 3.0, pause: 1.3, covers: coversA, startX: 230, power: 200 }));
  light.lamp(S1);
  const LM1 = add(new Mirror(game, { id: 'LM1', kind: 'wheeled', x: 214.0, alpha: 0, zone: { x0: 212.3, x1: 232.5 }, thetaHint: 305 }));
  kerb(229.8, 229.95); star(229.45);
  const LL1 = lock('LL1', 231.5, 4.1, { degree: 0, mount: 0.12 });
  const G10 = gate('G10', 233.0, 2.6, 2.4, () => (LL1.done ? 1 : 0), { kind: 'horseshoe' });
  block(232.6, 233.4, 2.6, 9, { mat: 'plasterBlue', coping: 'limestone' });
  // the gateway: a wall runs back from the gate to the lamp-keepers' wall, parting the square into two courts (the
  // bounce, the dazzle), with a limestone coping; LL1 hangs from it on an iron arm
  vbox(232.6, 0, -8.4, 233.4, 9, FZ - 0.02, 'plasterBlue', { base: 0, grime: 2.5 });
  vbox(232.48, 9, -8.4, 233.52, 9.16, 1.36, 'limestone', { base: 9, grimeAmt: 0.1 });
  // limestone jambs frame the portcullis in front and behind (clear of the boy's path), merlons crown the gateway
  for (const x of [232.4, 233.6]) for (const [z0, z1] of [[FZ - 0.02, -0.75], [0.75, 1.36]]) vbox(x - 0.12, 0, z0, x + 0.12, 2.8, z1, 'limestone', { base: 0, grimeAmt: 0.2 });
  vbox(232.28, 2.6, 0.75, 233.72, 2.86, 1.4, 'limestone', { base: 2.6, grimeAmt: 0.15 });
  for (const z of [1.3, -3.1, -7.5]) merlons(K, { x0: 232.5, x1: 233.5, y: 9.16, z, depth: 0.3, h: 0.5, mat: 'plasterBlue' });
  { const arm = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6); arm.rotateZ(Math.PI / 2); arm.translate(232.05, 4.1, -0.08); K.add(setColor(arm, 0xffffff), 'iron'); }
  const S2 = E(new Searchlight(game, { id: 'S2', origin: new THREE.Vector3(246, 12, -8), x0: 234.5, x1: 254, aimY: 0.4, speed: 4.0, pause: 1.2, covers: coversB, startX: 254, power: 200 }));
  light.lamp(S2, { eye: 0.8, dazzle: 7 });
  const LM2 = add(new Mirror(game, { id: 'LM2', kind: 'anchored', x: 235.25, alpha: -30, thetaHint: 225 }));
  for (const [x, z] of [[221, -8.35], [246, -8.35]]) { vbox(x - 1.6, 11.4 + (x === 221 ? 1 : 0), z, x + 1.6, 11.65 + (x === 221 ? 1 : 0), z + 1.3, 'woodDark', { base: 11 }); }
  vbox(208, 0, -9.6, 258, 17, -8.4, 'plasterCream', { base: 0, grime: 3 });
  // lamp posts on the open square (no facade to hang a bracket on)
  for (const x of [210.5, 238.5, 256.5]) { pole(K, x, 0, 3.55, FZ + 0.25, 0.07); lantern(x, 3.3, FZ + 0.25, { bracketDir: 1, light: true, intensity: 2.0 }); }
  // a little higher than the street rooms: the lattice pools on the stones read from above
  cam(208, { dist: 18, distPortrait: 14, height: 4.6, lookY: 3.6, fov: 39, ahead: 1.0, focusBias: 2 });
  cam(256, { dist: 18, distPortrait: 14, height: 4.6, lookY: 3.6, fov: 39, ahead: 1.0, focusBias: 1 });
  room('lamp', () => { LM1.setState({ x: 229.45, y: 0, alpha: 0 }); LL1.setState({ level: 1, done: true }); G10.setState({ open: 1 }); LM2.setState({ x: 235.25, y: 0, alpha: -45 }); });
  yield 0.8;

  // ================================================================ 11 WIRE: tripwires, the guard the turret darts, the moon well (III-A, C2, D, E)
  cp(258.5, 259.0, 0, 1);
  // A1: a gust rolls a basket through the low wire; the turret darts it
  const bk = new Body(259.6, 0, 0.44, 0.42, { kind: 'basket', solid: false, pushable: false, light: 'block' });
  bk.kinematic = true; bk.enabled = false; game.phys.addBody(bk);
  const bkB = new Batcher(game.mats), bkG = new THREE.Group(); basket(bkB.kit(), 0, 0, 0, { r: 0.22, h: 0.42 }); bkB.build(bkG); bkG.visible = false; game.add(bkG);
  const bkS = { t: -1 };
  L.entities.push({ id: 'basket', step(dt) { if (bkS.t < 0) return; bkS.t += dt; bk.enabled = true; bk.x = 259.6 + Math.min(1.8 * bkS.t, 10.5); }, render() { bkG.visible = bkS.t >= 0; bkG.position.set(bk.x, 0, 0); bkG.rotation.z = -(bk.x - 259.6) / 0.22; },
    getState: () => ({ t: bkS.t }), setState: (s) => { bkS.t = s.t; bk.enabled = s.t >= 0; bk.x = 259.6 + Math.max(0, Math.min(1.8 * s.t, 10.5)); } });
  L.triggers.push(new Trigger({ id: 'gustBasket', x0: 259.4, x1: 262, fn: (g) => { bkS.t = 0; g.sfx('wings', 260); } }));
  const T1 = add(new Sensor(game, { id: 'T1', from: [264.0, 0.3], to: [265.4, 0.3] }));
  // A2: a crawl line under a low arcade
  block(269.5, 276.5, 1.6, 2.2, { mat: 'plasterPeach', coping: 'limestone', z0: FZ, z1: 1.0 });
  for (const x of [269.7, 276.3]) K.add(boxMM(x - 0.15, 0, -1.2, x + 0.15, 1.6, -0.9), 'limestone');
  const T2 = add(new Sensor(game, { id: 'T2', from: [270.2, 0.8], to: [276.0, 0.8] }));
  // C2: a high wire over two steps: walk under it, do not jump
  block(279, 280.5, 0, 0.25, { mat: 'limestone', coping: null }); block(280.5, 283.5, 0, 0.5, { mat: 'limestone', coping: null }); block(283.5, 285, 0, 0.25, { mat: 'limestone', coping: null });
  const T7 = add(new Sensor(game, { id: 'T7', from: [278.0, 1.8], to: [283.0, 1.8] }));
  // D: the patrol; the guard runs through T4 and the lamp-keepers' own turret darts him
  const S5 = E(new Searchlight(game, { id: 'S5', origin: new THREE.Vector3(305, 14, -8), mode: 'watch', watchAt: [300.7, 0.3], detect: false }));
  light.lamp(S5, { reflect: false, eye: 0 });
  const T4 = add(new Sensor(game, { id: 'T4', from: [300.0, 0.3], to: [301.4, 0.3], lamp: S5 }));
  const guard = E(new Guard(game, { x: 287.0, y: 0, speed: 3.95, blockX: 305.6 }));
  guard.id = 'guard11';
  L.triggers.push(new Trigger({ id: 'patrol', x0: 298, x1: 300, fn: () => guard.activate() }));
  solid(306, 0.62, 307.5, 6.0, { ledges: false });
  kit.rubblePile(305.8, 307.7, 0.62);
  // E: the moon well (+140): moonlight half-opens a gold lock, opens a silver one
  block(311.6, 312, 2.0, 15, { mat: 'sandstone', coping: null });
  block(312, 329.4, 14, 15, { mat: 'sandstone', coping: 'limestone' }); block(330.6, 344.6, 14, 15, { mat: 'sandstone', coping: 'limestone' });
  vbox(312, 0, -6, 344.6, 14, FZ - 0.05, 'sandstone', { base: 0, grime: 4 });
  const GL = lock('GL', 314.0, 1.2, { degree: 1 });
  const MM = add(new Mirror(game, { id: 'MM', kind: 'wheeled', x: 326.0, alpha: 15, zone: { x0: 312.5, x1: 339 }, thetaHint: 270 }));
  kerb(330.35, 330.5); star(330.0);
  add(new MoonRay({ id: 'moon', x: 330, y: 14, angle: 270 }));
  const ML = lock('ML', 336.0, 1.2, { metal: 'silver', degree: 4 });
  const G11 = gate('G11', 340.0, 2.6, 2.4, () => (ML.done ? 1 : 0));
  block(339.6, 340.4, 2.6, 14, { mat: 'sandstone', coping: null });
  for (const x of [262.5, 288.5, 308.5]) lantern(x, 3.2, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.0 });
  // on a phone the night street comes close: the wires are threads, the boy a silhouette in the dark
  cam(259, { dist: 16.5, distPortrait: 12, height: 2.2, lookY: 2.4, fov: 38, ahead: 1.6 });
  cam(296, { dist: 16.5, distPortrait: 12, height: 2.2, lookY: 2.6, fov: 38, ahead: 2.0 });
  cam(311, { dist: 19, distPortrait: 14.5, height: 4.6, lookY: 6.0, fov: 40, ahead: 0.8, focusBias: 6 });
  cam(342, { dist: 19, distPortrait: 14.5, height: 4.6, lookY: 6.0, fov: 40, ahead: 0.8, focusBias: 1 });
  room('wire', () => { bkS.t = 6; bk.enabled = true; bk.x = 270.1; guard.setState({ state: 'asleep', x: 303.6, y: 0, vx: 0, vy: 0, t: 5, facing: 1 }); MM.setState({ x: 330.0, y: 0, alpha: -45 }); ML.setState({ level: 1, done: true }); G11.setState({ open: 1 }); });
  yield 0.85;

  // ================================================================ 12 DAWN: light down into the shadow, sun shafts, the heliostat (IV-A1, C, E)
  cp(345.5, 346.0, 0, 1);
  block(344.6, 345.4, 2.8, 15, { mat: 'sandstone', coping: null });
  const keysT = [[330, 14], [346, 8], [370, 6], [416, 3], [480, 0]];
  const termD = add(new Terminator(game, { id: 'Tdawn', keys: keysT, range: [344, 520] }));
  // IV-A1 (+330): crank F1 brings the horizontal ray down to L1 in the shadow
  const F1 = add(new Mirror(game, { id: 'F1', kind: 'crank', x: 352, y: 9.0, r: 0.5, alpha: -30, thetaHint: 180 }));
  add(new Crank(game, { id: 'K1', x: 350.5, y: 0, mirror: F1, dir: -1 }));
  const LD1 = lock('LD1', 347.5, 1.25, { degree: 0 });
  const G12 = gate('G12', 354.0, 2.6, 2.4, () => (LD1.done ? 1 : 0));
  block(353.6, 354.4, 2.6, 7.5, { mat: 'plasterPeach', coping: 'limestone' });
  // the first ray of the sunrise enters from beyond the frame's right edge (the room's frame ends near x 365)
  add(new SunRay({ id: 'dawnRay', x: 374, y: 9.0, angle: 180, clipByTerminator: termD }));
  // IV-C: a lamp-keeper chases; sun shafts from rooftop mirrors stun him
  const captain = E(new Guard(game, { x: 372, y: 0, speed: 3.95, blockX: 429.6 }));
  captain.id = 'captain';
  L.triggers.push(new Trigger({ id: 'captain', x0: 378, x1: 380, fn: () => captain.activate() }));
  for (const x of [394, 405, 416]) { add(new SunRay({ id: 'shaft' + x, x, y: 12, angle: 270, width: 0.6 })); }
  block(398, 400, 0, 1.0, { mat: 'woodDark', coping: null });
  solid(430, 0.62, 431.5, 6.0, { ledges: false }); vbox(430, 0.62, FZ, 431.5, 6, 1.3, 'plasterOchre', { base: 0.62 });
  // IV-E (+310): the heliostat on the roof turns the sunrise onto the fortress lamp
  const fort = new THREE.Group();
  { const t = new THREE.Mesh(worldUV(new THREE.BoxGeometry(8, 15, 6)), game.mats.get('sandstone')); setColor(t.geometry, 0xc8b8a0); t.position.set(0, 7.5, 0); t.castShadow = true; t.receiveShadow = true; fort.add(t); }
  const fortLamp = new THREE.Group(); { const l = lanternMesh(game.mats, { s: 6, chain: 0 }); fortLamp.add(l); }
  fortLamp.position.set(0, 8.0 + 1.3, 3.2); fort.add(fortLamp);
  fort.position.set(420, 0, -7.2); game.add(fort);
  const glowMat = new THREE.SpriteMaterial({ map: game.glowTex, color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
  const fortGlow = new THREE.Sprite(glowMat); fortGlow.scale.setScalar(5); fortGlow.position.set(420, 8.0, -4); game.add(fortGlow);
  const fortSrc = game.lightPool?.addDynamic(fortGlow, 2, { intensity: 6, color: 0xffa860, distance: 14, decay: 1.4 });
  const fortState = { hit: false, t: 0 };
  const eye = add(new LampEye(game, { id: 'fortress', x: 420, y: 8.0, z: -4, r: 1.5, hold: 0.5, face: 0, onHit: () => { if (fortState.hit) return; fortState.hit = true; fortState.t = 0; game.sfx('answeredLight', 420); game.audio?.stinger?.('answeredLight'); game.emit('fortressOut', {}); } }));
  L.entities.push({ id: 'fortressLamp', step(dt) { if (!fortState.hit) return; const was = fortState.t; fortState.t += dt; if (was < 2.4 && fortState.t >= 2.4) game.completeChapter(); },
    render() { const t = fortState.t, k = fortState.hit ? (t < 0.5 ? 1 + t * 6 : Math.max(0, 4 - (t - 0.5) * 3)) : 1; fortGlow.material.opacity = 0.9 * Math.min(1, k); fortGlow.scale.setScalar(5 * Math.max(0.2, k)); if (fortSrc) { fortSrc.enabled = k > 0.05; fortSrc.pos.set(420, 8.0, -3); fortSrc.intensity = 6 * k; } },
    getState: () => ({ ...fortState }), setState: (s) => { fortState.hit = s.hit; fortState.t = s.t; }, dispose() { if (fortSrc) game.lightPool?.remove(fortSrc); } });
  block(468, 484, 0, 11.7, { mat: 'plasterCream', coping: null, ledges: false });
  block(468, 484, 11.7, 12.0, { mat: 'limestone', coping: null, ledges: false });
  block(468, 468.4, 12.0, 12.8, { mat: 'limestone', coping: null, ledges: false }); block(483.6, 484, 12.0, 12.8, { mat: 'limestone', coping: null, ledges: false });
  const roofVine = { x0: 467.2, x1: 468.0, y0: 0, y1: 12.0, exit: { x: 468.6, y: 12.0 }, enabled: true };
  game.vines.push(roofVine);
  E(new RopeLadder(game, { x: 467.6, y0: 0, y1: 12, z: 0.1, vine: roofVine })).setState({ t: 1, target: 1 });
  const H = add(new Mirror(game, { id: 'H', kind: 'continuous', x: 478, y: 14.5, r: 1.5, alpha: 20, thetaHint: 180, z: 0 }));
  // (raw geometries get a white vertex colour: the library's materials multiply by it, and without one they render black)
  { const ring = new THREE.Mesh(setColor(new THREE.TorusGeometry(1.62, 0.07, 8, 48), 0xffffff), game.mats.get('brassAged')); ring.position.set(478, 14.5, -0.1); game.add(ring);
    for (const sx of [-1, 1]) { const leg = new THREE.Mesh(setColor(new THREE.CylinderGeometry(0.06, 0.09, 2.6, 8), 0xffffff), game.mats.get('brassAged')); leg.position.set(478 + sx * 1.1, 13.2, -0.6); leg.rotation.z = sx * 0.45; leg.castShadow = true; game.add(leg); } }
  add(new Capstan(game, { id: 'capstan', x: 475.5, y: 12, mirror: H, dir: -1, rate: 6, magnet: { alpha: 3.2, window: 2 }, range: [-10, 40] }));
  add(new SunRay({ id: 'sunrise', x: 500, y: 14.5, angle: 180, clipByTerminator: termD }));
  frame(346, 353.8, 353.5, { dist: 18, distPortrait: 16.8, height: 3.6, lookY: 5.0, fov: 40 }); // LD1 347.5 … the ray 362
  cam(358, { dist: 15, height: 2.4, lookY: 2.8, fov: 38, ahead: 2.2 });
  cam(456, { dist: 15, height: 2.4, lookY: 2.8, fov: 38, ahead: 1.6 });
  cam(466, { dist: 20, distPortrait: 18, height: 6.0, lookY: 8.2, fov: 40, ahead: 0.6, focusBias: 1 });
  yield 0.95;

  // ================================================================ chapter hooks
  // the apertures glow with the live sky: the sun's colour and strength, plus the sky's own light
  const wl = game.world.light, skyC = new THREE.Color();
  L.entities.push({ id: 'apertures', step() {}, render() {
    const sn = wl?.sun, hm = wl?.hemi; if (!sn) return;
    winMat.color.copy(sn.color).multiplyScalar(Math.min(2, 0.3 * sn.intensity));
    if (hm) winMat.color.add(skyC.copy(hm.color).multiplyScalar(hm.intensity * 0.5));
  }, getState: () => ({}), setState() {} });
  // the lamp-keepers' star lattice on the rig's spots in the night rooms (restored to the disc when the lab unloads)
  const rig = game.lightRig;
  L.entities.push({ id: 'cookie', liveUnderTitle: true, on: null, step() {}, render() { const on = game.player.x > 206 && game.player.x < 345; if (on !== this.on) { this.on = on; rig?.setCookie(on ? starCookie() : null); } }, dispose() { rig?.setCookie(null); }, getState: () => ({}), setState() {} });
  L.dustRegions.push({ x0: -3, x1: 206, y0: 0.3, y1: 7, z0: -1.4, z1: 1.4 }, { x0: 345, x1: 490, y0: 0.3, y1: 8, z0: -1.4, z1: 1.4 });
  L.flockSpots.push({ x: 24, y: 2.0, z: 0.6, w: 2, n: 3 }, { x: 160, y: 0, z: 1.4, w: 3, n: 4 }, { x: 440, y: 0, z: 1.4, w: 3, n: 5 });
  L.bounds = { x0: -20, x1: 520, y0: -10, y1: 30 };
  L.shadowExtent = 26;
  L.rooms = solved;
  L.prepare = (i, g) => {
    // every room before checkpoint i is solved (checkpoint k + 1 starts room k + 1; the corridor checkpoint 8 adds none)
    const cpRoom = [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 9, 10, 11];
    const n = cpRoom[i] ?? 0;
    for (let k = 0; k < n; k++) solved[k].solve(g);
    if (i >= 1) g.triggers.find((t) => t.id === 'gust').fired = true;
    if (n > 10) { for (const id of ['gustBasket', 'patrol']) g.triggers.find((t) => t.id === id).fired = true; }
    light.setState(light.getState());
  };
  L.safeZone = (x) => (x > 306 && x < 345) || x > 431.5;
  L.deathColor = (kind) => (kind === 'sunset' ? 0x0b1026 : null); // the last light dies: the screen dims to indigo
  L.mix = (x, g) => {
    const chase = (guard.state === 'chase' || captain.state === 'chase') && !g.player.dead;
    return {
      zone: x > 311.6 && x < 345 ? 'cistern' : x > 206 && x < 345 ? 'alley' : x > 345 ? 'open' : 'courtyard',
      tension: S1.state === 'alarm' || S2.state === 'alarm' || chase ? 1 : x > 206 && x < 345 ? 0.35 : 0.1,
      chase, birds: x < 176 || x > 360,
      music: clock.running ? { state: 'clock', intensity: Math.min(1, clock.t / clock.duration) } : null,
      hum: x > 258 && x < 306 ? 0.6 : 0,
    };
  };
  L.extraState = () => {
    const api = light.api();
    return {
      locks: Object.fromEntries(api.targets.filter((t) => t.kind === 'lock' || t.kind === 'bolt').map((t) => [t.id, t.done ? 1 : t.level])),
      mirrors: Object.fromEntries(api.mirrors.map((m) => [m.id, [m.x, m.target]])),
      rope: rope.burnt, clock: +clock.t.toFixed(2), lamps: [S1.state, S2.state], guard: guard.state, captain: captain.state, fortress: fortState.hit,
    };
  };
  return L;
}
