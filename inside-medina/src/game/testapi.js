import * as THREE from 'three';
import { CHAPTERS } from '../chapters/index.js';

// window.__medina: the generic test API every bot, negative suite and tool
// uses. state() is the chapter-independent core plus L.extraState() under
// `extra`; sim() advances the fixed-step simulation without rendering (the
// only way time moves with ?hold=1); ext holds per-system APIs registered
// with game.registerExt(name, fn).
const STEP = 1 / 120;

export function installTestApi(g) {
  const M = {
    game: g,
    ext: g.ext,
    chapter: () => g.chapterId,
    // the chapter registry the loader reads (tests add or patch entries here: a dev server may serve the module
    // under a versioned URL, so importing it again can give another instance)
    registry: CHAPTERS,
    loadChapter: (id, cp = 0, opts = {}) => g.loadChapter(id, cp, { reason: 'select', ...opts }).then(() => M.state()),
    state: () => {
      const p = g.player;
      return {
        x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +(p.z || 0).toFixed(3), st: p.state, crawl: p.crawling, dead: p.dead,
        mode: g.mode, cp: g.cpIndex, t: +g.time.toFixed(2), deaths: g.stats.deaths, chapter: g.chapterId,
        extra: g.level?.extraState?.() ?? {},
      };
    },
    // run the simulation without rendering: seconds, input object or fn(state) -> input ({x, y, jump, grab, aimTarget, pointer})
    sim: (seconds, input) => {
      const n = Math.round(seconds / STEP);
      for (let i = 0; i < n; i++) {
        if (g.mode === 'loading' || g.mode === 'boot' || g.suspended || !g.level) break;
        const st = typeof input === 'function' ? input(M.state()) : input;
        const prevState = g.input.state;
        const s = { x: 0, y: 0, jump: false, grab: false, pause: false, any: true, pointer: null, ...st };
        g.input.prev = prevState; g.input.state = s;
        g.input.jumpPressed = !!s.jump && !prevState.jump; g.input.grabPressed = !!s.grab && !prevState.grab;
        if (g.mode === 'intro') g.beginPlay();
        g.fixed(STEP, s, true);
        g.time += STEP;
      }
      g.player.prev.set(g.player.x, g.player.y);
      return M.state();
    },
    teleport: (x, y = 0, facing = 1) => { g.player.spawn(x, y, facing); g.camRig.snapNext = true; return M.state(); },
    // the chapter as a fresh load at checkpoint i leaves it (initial snapshot, prepare(i), spawn)
    checkpoint: (i) => { g.restore(g.initialSnap); g.placeAt(i); g.respawn(); return M.state(); },
    // jump to the chapter's scripted finale (L.finale.from = [x, y])
    finale: () => {
      const F = g.level?.finale;
      if (!F) return null;
      const [x, y] = F.from || [g.player.x, g.player.y];
      g.player.spawn(x, y, 1);
      if (g.mode === 'intro') g.beginPlay();
      g.setMode('play');
      g.startFinale();
      return M.state();
    },
    setInput: (o) => { g.input.override = o; },
    restartCheckpoint: () => g.restartCheckpoint(),
    // close camera on the boy; pose: run|walk|idle|air|hang|climb|push|pull|crawl|dead
    closeup: (pose = 'idle', dist = 3.2, phase = 0.2, yawOff = 0) => {
      const pl = g.player;
      g.camRig.setOverride(() => ({ pos: new THREE.Vector3(pl.x + 0.2, pl.y + 0.9, (pl.z || 0) + dist), look: new THREE.Vector3(pl.x, pl.y + 0.62, pl.z || 0), fov: 35 }), 0.001);
      g.camRig.overrideW = 1; g.camRig.overrideTarget = 1;
      g.debugPose = { pose, phase, yawOff };
    },
    // put the boy somewhere and settle the camera instantly (for screenshots)
    photo: (x, y = 0, facing = 1, simSec = 0.4) => {
      g.fade = 0; g.fadeTarget = 0; g.titleFade = undefined; g.ui.showTitle(false);
      if (g.mode === 'intro') g.beginPlay();
      g.setMode('play'); g.dieT = 0; g.deathKind = null;
      g.player.spawn(x, y, facing);
      if (g.rig.scarf) g.rig.scarf.reset();
      if (simSec > 0) M.sim(simSec, { x: 0 });
      g.camRig.override = null; g.camRig.overrideW = 0; g.camRig.overrideTarget = 0;
      g.camRig.groundY = g.player.y; g.camRig.snapNext = true; g.camRig.aheadX = facing * g.camRig.paramsAt(x).ahead;
      g.ui.hideHint?.();
      return M.state();
    },
    pause: (p) => g.setPaused(p),
    events: (n = 0) => g.events.recent(n),
    lights: () => g.lightRig.census(),
    save: () => JSON.parse(JSON.stringify(g.save.data)),
    info: () => {
      const r = g.world.rs.renderer;
      return { tier: g.world.rs.tier, calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures, programs: r.info.programs?.length ?? 0 };
    },
  };
  window.__medina = M;
  return M;
}
