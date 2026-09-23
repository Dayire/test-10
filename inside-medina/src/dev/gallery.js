import * as THREE from 'three';
import { createWorld, updateAtmosphere } from '../render/world.js';
import { Batcher, boxMM, shadeByHeight } from '../assets/geom.js';
import { crateMesh, barrel, pot, rugRoll, hangingRug, sack, basket, cart, awning, lanternMesh, bracket, eave, stairs, stool } from '../assets/props.js';
import { wallWithOpenings, archFrame, zellige, arcade, dome, cornice, spandrels, archBead } from '../assets/architecture.js';
import { ivyCurtain, ivyPatch, grassTufts } from '../assets/foliage.js';
import { dressFacade } from '../assets/dressing.js';
import { Rig, BOY, GUARD } from '../assets/character.js';
import { Animator } from '../game/animator.js';

// Asset sheet: every hand-built model on a strip of street, lit exactly like the
// game (same sky, sun, fog and post chain). Drag to orbit, wheel to zoom,
// arrows / list to jump between models. `?dev=assets&focus=lantern` or `#assets`.
const SPACING = 5;

export function runGallery(canvas, { focus: focusName } = {}) {
  const q = new URLSearchParams(location.search);
  const world = createWorld(canvas, { tier: q.get('tier') || 'high' });
  const { scene, mats, rs, light } = world;
  const camera = new THREE.PerspectiveCamera(32, rs.cssW / rs.cssH, 0.05, 2000);
  rs.camera = camera;
  const K = new Batcher(mats, { chunk: 1000 });
  const stations = [];
  const lights = [];
  const rigs = [];
  let sx = 0;
  const station = (name, label, build, view = {}) => {
    const x = sx; sx += view.width || SPACING;
    const cx = x + (view.width || SPACING) / 2 - SPACING / 2;
    const tris0 = triCount(K), kids0 = scene.children.length;
    build(x);
    let tris = triCount(K) - tris0;
    for (const o of scene.children.slice(kids0)) o.traverse((m) => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; });
    stations.push({ name, label, x: cx, y: view.y ?? 0.6, z: view.z ?? 0, dist: view.dist ?? 3, yaw: view.yaw ?? 0.35, pitch: view.pitch ?? 0.12, tris: Math.round(tris) });
  };
  const addObj = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } }); scene.add(o); return o; };
  const lamp = (pos, intensity = 2.2) => { const l = new THREE.PointLight(0xffb060, intensity, 5, 2); l.position.copy(pos); scene.add(l); lights.push(l); };

  // ------------------------------------------------------------ stations
  station('lantern', 'Brass lantern on a forged scroll bracket', (x) => {
    wallWithOpenings(K, { x0: x - 1.6, x1: x + 1.6, y0: 0, y1: 3.6, z: -0.6, mat: 'plasterBlue' });
    const tip = bracket(K, x, 2.6, -0.6, { len: 0.62, dir: 1 });
    const m = lanternMesh(mats, { s: 1.25 });
    addObj(m, tip.x, tip.y, tip.z);
    lamp(new THREE.Vector3(tip.x, tip.y + m.userData.glowY, tip.z + 0.25));
  }, { y: 2.2, dist: 2.2, yaw: 0.5, pitch: 0.05 });
  station('barrel', 'Oak barrel', (x) => {
    barrel(K, x - 0.45, 0, 0, { r: 0.32 });
    barrel(K, x + 0.4, 0, -0.2, { r: 0.3, rot: 1 });
  }, { y: 0.5, dist: 2.6 });
  station('pots', 'Terracotta pots and jars', (x) => {
    pot(K, x - 1.1, 0, 0, { kind: 'amphora' });
    pot(K, x - 0.45, 0, 0.1, { kind: 'jar', glaze: 'fez' });
    pot(K, x + 0.2, 0, -0.1, { kind: 'tall', glaze: 'green' });
    pot(K, x + 0.85, 0, 0.1, { kind: 'planter' });
    pot(K, x + 1.35, 0, 0.3, { kind: 'bowl', glaze: 'cobalt' });
  }, { y: 0.45, dist: 3.4 });
  station('rugs', 'Rolled and hanging rugs', (x) => {
    wallWithOpenings(K, { x0: x - 1.8, x1: x + 1.8, y0: 0, y1: 3.4, z: -0.8, mat: 'plasterPeach' });
    hangingRug(K, x + 0.7, 2.7, -0.72, { w: 1.3, h: 2.0 });
    rugRoll(K, x - 1.0, 0, -0.45, { seed: 71, r: 0.2, len: 2.2, lean: 0.12 });
    rugRoll(K, x - 0.6, 0, -0.3, { seed: 72, r: 0.17, len: 1.8, lean: -0.08 });
    rugRoll(K, x + 0.2, 0, 0.3, { seed: 73, r: 0.15, len: 1.6, upright: false, rot: 0.3 });
  }, { y: 1.0, dist: 4.2 });
  station('sack', 'Spice sacks, grain sacks and a basket', (x) => {
    sack(K, x - 1.05, 0, -0.1, { kind: 'open', spice: 'spicePaprika' }); sack(K, x - 0.55, 0, 0.15, { kind: 'open', spice: 'spiceTurmeric', s: 0.9 });
    sack(K, x - 0.1, 0, -0.35, { kind: 'open', spice: 'spiceHenna', s: 0.95 }); sack(K, x + 0.45, 0, 0.1, { kind: 'tied', rot: 1.3 });
    sack(K, x + 1.1, 0, -0.3, { kind: 'lying', rot: 0.4 }); basket(K, x + 0.7, 0, 0.75, { r: 0.22 });
  }, { y: 0.35, dist: 3.4, pitch: 0.3 });
  station('crate', 'Pushable crate', (x) => {
    addObj(crateMesh(mats, 1), x, 0, 0, 0.25);
  }, { y: 0.5, dist: 3.0 });
  station('cart', 'Market cart and stool', (x) => {
    cart(K, x - 0.3, 0, 0, { w: 1.8, rot: 0.3 });
    stool(K, x + 1.4, 0, 0.6);
  }, { y: 0.6, dist: 4.6 });
  station('eave', 'Scalloped eave and stall awning', (x) => {
    wallWithOpenings(K, { x0: x - 2.2, x1: x + 2.2, y0: 0, y1: 4.2, z: -0.8, mat: 'plasterBlue' });
    eave(K, { x0: x - 2.0, x1: x + 0.6, y: 3.4, z: -0.8, depth: 0.85, drop: 0.5, soffit: 'wood' });
    awning(K, { x0: x + 0.4, x1: x + 2.1, z0: -0.75, z1: 0.9, y0: 2.4, y1: 1.8, mat: 'fabricTan', sag: 0.14 });
  }, { y: 2.4, dist: 4.8, pitch: -0.12 });
  station('arch', 'Pointed limestone arch with zellige', (x) => {
    const aw = 1.5, ahs = 1.9, ar = 1.0;
    wallWithOpenings(K, { x0: x - 2.2, x1: x + 2.2, y0: 0, y1: 4.2, z: -0.6, depth: 0.6, mat: 'plasterBlue', openings: [{ kind: 'pointed', cx: x, sill: 0, w: aw, hs: ahs, rise: ar, noInterior: false, recess: 1.2 }] });
    archFrame(K, { kind: 'pointed', cx: x, sill: 0, w: aw, hs: ahs, rise: ar, band: 0.22, depth: 0.22, z: -0.6 + 0.1, mat: 'limestone', steps: 2 });
    zellige(K, { x0: x - 1.95, x1: x - aw / 2 - 0.26, y0: 0.5, y1: 3.1, z: -0.58, border: 0.05 });
    zellige(K, { x0: x + aw / 2 + 0.26, x1: x + 1.95, y0: 0.5, y1: 3.1, z: -0.58, border: 0.05 });
    zellige(K, { x0: x - 1.95, x1: x + 1.95, y0: 3.1, y1: 3.3, z: -0.58, border: 0.04 });
    spandrels(K, { kind: 'pointed', cx: x, sill: 0, w: aw, hs: ahs, rise: ar, band: 0.22, x0: x - aw / 2 - 0.26, x1: x + aw / 2 + 0.26, yTop: 3.1, z: -0.58 });
    archBead(K, { kind: 'pointed', cx: x, sill: 0, w: aw, hs: ahs, rise: ar, grow: 0.015, z: -0.32, r: 0.025 });
    archBead(K, { kind: 'pointed', cx: x, sill: 0, w: aw, hs: ahs, rise: ar, grow: 0.22, z: -0.41, r: 0.022 });
    cornice(K, { x0: x - 2.2, x1: x + 2.2, y: 3.42, z: -0.58, profile: 'heavy', mat: 'limestone', scale: 0.7 });
  }, { y: 1.7, dist: 5.4, yaw: 0.25 });
  station('arcade', 'Horseshoe arcade with red and cream voussoirs', (x) => {
    arcade(K, { x0: x - 2.4, x1: x + 2.4, z: -0.4, y0: 0, span: 1.9, pierW: 0.55, pierD: 0.5, hs: 1.8, upper: 1.2, mat: 'plasterPeach', galleryDepth: 1.6 });
    stairs(K, { x0: x + 2.4, x1: x + 1.2, y0: 0, y1: 0.7, z0: -0.2, z1: 0.8, rail: true });
  }, { y: 1.6, dist: 6, yaw: 0.3, width: 6 });
  station('dome', 'Glazed dome with gilded finial', (x) => {
    const tw = new THREE.CylinderGeometry(1.5, 1.55, 1.2, 40); tw.translate(x, 0.6, -0.4); K.add(tw, 'plasterWhite');
    dome(K, { x, y: 1.2, z: -0.4, r: 1.3, drumH: 0.9, onion: 0.22, windows: 10 });
  }, { y: 2.4, dist: 7.5, pitch: 0.2, width: 6 });
  station('ivy', 'Ivy with pink blossom', (x) => {
    wallWithOpenings(K, { x0: x - 2, x1: x + 2, y0: 0, y1: 4, z: -0.6, mat: 'plasterOchre' });
    ivyCurtain(K, { x0: x - 1.8, x1: x + 1.2, y: 3.9, z: -0.5, maxLen: 3.2, seed: 61, flowers: 0.8, density: 2.2, scale: 1.5 });
    ivyPatch(K, { x0: x + 0.6, x1: x + 1.9, y0: 0.2, y1: 1.6, z: -0.55, seed: 65, density: 1.5 });
    grassTufts(K, { x0: x - 1.8, x1: x + 1.8, z0: -0.5, z1: 0.6, n: 26, seed: 72 });
  }, { y: 2.0, dist: 5.2 });
  station('facade', 'Facade dressing (mashrabiya, spouts, planters)', (x) => {
    wallWithOpenings(K, { x0: x - 2.4, x1: x + 2.4, y0: 0, y1: 5, z: -0.6, mat: 'plasterCream', openings: [{ kind: 'pointed', cx: x - 1, sill: 1.6, w: 0.8, hs: 1.1, rise: 0.5 }, { kind: 'horseshoe', cx: x + 1.1, sill: 1.6, w: 0.8, hs: 1.1, rise: 0.4 }] });
    dressFacade(K, { x0: x - 2.4, x1: x + 2.4, z: -0.6, top: 5, openings: [{ kind: 'pointed', cx: x - 1, sill: 1.6, w: 0.8, hs: 1.1, rise: 0.5 }, { kind: 'horseshoe', cx: x + 1.1, sill: 1.6, w: 0.8, hs: 1.1, rise: 0.4 }], seed: 5 });
  }, { y: 2.4, dist: 6.4, width: 6 });
  station('characters', 'The boy and the watchman', (x) => {
    for (const [spec, dx] of [[BOY, -0.45], [GUARD, 0.55]]) {
      const rig = new Rig(spec, mats);
      rig.root.position.set(x + dx, 0, 0.2);
      rig.root.rotation.y = dx < 0 ? 0.5 : -0.4;
      rig.root.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      if (rig.scarf) scene.add(rig.scarf.mesh);
      scene.add(rig.root);
      const anim = new Animator(rig, { scale: spec === GUARD ? 1.5 : 1 });
      let lan = null;
      if (spec === GUARD) {
        lan = lanternMesh(mats, { s: 1.1, chain: 0.02 }); lan.position.set(0, -0.07, 0.01); rig.j.wristR.add(lan);
        lamp(new THREE.Vector3(x + dx + 0.3, 0.9, 0.6), 1.6);
      }
      rigs.push({ rig, anim, lan });
    }
  }, { y: 0.9, dist: 3.6, pitch: 0.05 });

  // shared street strip and back wall
  const x0 = -SPACING / 2 - 1, x1 = sx - SPACING / 2 + 1;
  const ground = boxMM(x0 - 20, -0.4, -12, x1 + 20, 0, 8); shadeByHeight(ground, { base: -0.4, grime: 0.1, grimeAmt: 0 }); K.add(ground, 'cobbles', null, { cast: false });
  const back = boxMM(x0 - 20, 0, -3.2, x1 + 20, 6, -2.8); shadeByHeight(back, { base: 0, grime: 1.4, grimeAmt: 0.3 }); K.add(back, 'plasterCream');
  K.build(scene);

  // ------------------------------------------------------------ camera
  const view = { i: 0, yaw: 0, pitch: 0, dist: 3, t: new THREE.Vector3(), cur: null };
  const goTo = (i, o = {}) => {
    view.i = (i + stations.length) % stations.length;
    const s = stations[view.i];
    view.t.set(s.x, s.y, s.z);
    view.yaw = o.yaw ?? s.yaw; view.pitch = o.pitch ?? s.pitch; view.dist = o.dist ?? s.dist;
    if (o.y !== undefined) view.t.y = o.y;
    if (o.dx !== undefined) view.t.x += o.dx;
    view.cur = null;
    ui.show(view.i);
  };
  const place = (dt) => {
    const want = new THREE.Vector3(Math.sin(view.yaw) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.yaw) * Math.cos(view.pitch)).multiplyScalar(view.dist).add(view.t);
    if (!view.cur || dt === 0) view.cur = { p: want.clone(), t: view.t.clone() };
    const k = 1 - Math.exp(-8 * dt);
    view.cur.p.lerp(want, k); view.cur.t.lerp(view.t, k);
    camera.position.copy(view.cur.p); camera.lookAt(view.cur.t);
    const p = rs.post.params;
    p.focus = camera.position.distanceTo(view.cur.t); p.nearRange = 1.2; p.farStart = p.focus + 2.5; p.farRamp = 30;
  };

  // ------------------------------------------------------------ ui
  const ui = galleryUI(stations, (i) => goTo(i));
  let drag = null;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.006; view.pitch = THREE.MathUtils.clamp(view.pitch + (e.clientY - drag.y) * 0.004, -0.2, 1.2);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.001), 0.6, 20); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') goTo(view.i + 1);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') goTo(view.i - 1);
  });

  const start = Math.max(0, stations.findIndex((s) => s.name === focusName));
  goTo(start);
  place(0);
  let t = 0, last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    t += dt;
    place(dt);
    for (const { rig, anim, lan } of rigs) {
      anim.update(dt, { speed: 0, vx: 0, vy: 0, grounded: true, facing: 1 });
      if (rig.scarf) rig.scarf.update(dt, new THREE.Vector3(1.2, 0, -0.6));
      if (lan) {
        rig.j.shoulderR.rotation.x = -0.5; rig.j.elbowR.rotation.x = -0.9;
        rig.j.wristR.updateWorldMatrix(true, false);
        lan.quaternion.copy(rig.j.wristR.getWorldQuaternion(new THREE.Quaternion()).invert());
      }
    }
    for (const l of lights) l.intensity = 2.2 * (0.92 + 0.08 * Math.sin(t * 13) * Math.sin(t * 7.3));
    light.update(view.t);
    updateAtmosphere(world, camera, t);
    rs.render(scene, camera, t);
    window.__frames = (window.__frames || 0) + 1;
    requestAnimationFrame(frame);
  };
  frame();
  window.__gallery = {
    stations: stations.map((s) => ({ name: s.name, tris: s.tris })),
    focus: (name, o = {}) => { const i = stations.findIndex((s) => s.name === name); goTo(i < 0 ? 0 : i, o); place(0); return stations[view.i].name; },
  };
  window.__ready = true;
}

function triCount(K) {
  let n = 0;
  for (const [, g] of K.groups) for (const geo of g.geos) n += geo.attributes.position.count / 3;
  return Math.round(n);
}

function galleryUI(stations, onPick) {
  const root = document.getElementById('ui');
  root.innerHTML = '';
  const st = document.createElement('style');
  st.textContent = `
  .gl-head { position: fixed; left: 24px; top: 20px; pointer-events: none; text-shadow: 0 1px 12px rgba(30,15,5,.6); }
  .gl-head .k { font-size: 12px; letter-spacing: .4em; color: rgba(251,239,220,.7); }
  .gl-head .n { font-size: clamp(22px, 3.4vw, 38px); font-weight: 300; color: #fbefdc; margin-top: 2px; }
  .gl-head .m { font-family: Georgia, serif; font-size: 12px; color: rgba(251,239,220,.65); margin-top: 4px; }
  .gl-list { position: fixed; left: 0; right: 0; bottom: 14px; display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; padding: 0 16px; pointer-events: auto; }
  .gl-list button { font-family: Georgia, serif; font-size: 12px; letter-spacing: .05em; color: rgba(251,239,220,.8); background: rgba(12,7,4,.35); border: 1px solid rgba(251,239,220,.18); border-radius: 20px; padding: 5px 11px; cursor: pointer; }
  .gl-list button[aria-current="true"] { color: #1d130b; background: #f3cf96; border-color: #f3cf96; }
  .gl-hint { position: fixed; right: 24px; top: 24px; font-family: Georgia, serif; font-size: 12px; color: rgba(251,239,220,.6); pointer-events: none; }
  .gl-back { position: fixed; right: 20px; top: 48px; font-family: Georgia, serif; font-size: 13px; color: rgba(251,239,220,.85); background: rgba(12,7,4,.35); border: 1px solid rgba(251,239,220,.25); border-radius: 20px; padding: 6px 14px; cursor: pointer; pointer-events: auto; }
  .gl-back:hover, .gl-back:focus-visible { color: #1d130b; background: #f3cf96; outline: none; }
  @media (max-width: 560px) { .gl-hint { display: none; } .gl-back { top: 16px; right: 16px; } .gl-head { top: 56px; left: 16px; } }`;
  document.head.appendChild(st);
  const head = document.createElement('div'); head.className = 'gl-head';
  head.innerHTML = '<div class="k">MEDINA · ASSET SHEET</div><div class="n"></div><div class="m"></div>';
  const list = document.createElement('div'); list.className = 'gl-list';
  const hint = document.createElement('div'); hint.className = 'gl-hint'; hint.textContent = 'drag to orbit · wheel to zoom · ← → to browse';
  const back = document.createElement('button'); back.className = 'gl-back'; back.textContent = '← back to the game';
  back.addEventListener('click', () => { location.hash = ''; location.reload(); });
  const btns = stations.map((s, i) => { const b = document.createElement('button'); b.textContent = s.name; b.addEventListener('click', () => onPick(i)); list.appendChild(b); return b; });
  root.append(head, list, hint, back);
  return {
    show(i) {
      const s = stations[i];
      head.querySelector('.n').textContent = s.label;
      head.querySelector('.m').textContent = `${s.tris.toLocaleString()} triangles · built in code, no external assets`;
      btns.forEach((b, k) => b.setAttribute('aria-current', k === i ? 'true' : 'false'));
    },
  };
}
