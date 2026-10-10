// Chapter I negatives: the game must kill, respawn and restore correctly, and
// the foundation's Chapter I fixes must hold. Values come from the pre-refactor
// baseline (docs/baselines/souk.json).
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;

export const scenarios = [
  {
    name: 'spotted by lamp', cp: 3,
    run: ({ page }) => page.evaluate(() => { const M = __medina; for (let i = 0; i < 1400; i++) { const s = M.sim(1 / 120, { x: 1 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, x: s.x }; } return { died: false, x: M.state().x }; }),
    check: (r) => (r.died && r.kind === 'shot' ? true : `expected a dart ('shot'), got ${JSON.stringify(r)}`),
  },
  {
    name: 'respawn after lamp',
    run: ({ page }) => page.evaluate(() => { const M = __medina; const s = M.sim(3, { x: 0 }); return { x: s.x, cp: s.cp, deaths: s.deaths, mode: s.mode, crateA: s.extra.crateA, deathEvents: M.events().filter((e) => e.name === 'death').length }; }),
    check: (r) => (near(r.x, 71.6) && r.cp === 3 && r.deaths === 1 && r.mode === 'play' && near(r.crateA[0], 41.5) && r.deathEvents === 1 ? true : `bad respawn ${JSON.stringify(r)}`),
  },
  {
    name: 'caught by guard', cp: 5,
    run: ({ page }) => page.evaluate(() => { const M = __medina; M.sim(1.0, { x: 1 }); for (let i = 0; i < 1200; i++) { const s = M.sim(1 / 120, { x: 0 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, gx: s.extra.gx, x: s.x }; } return { died: false, s: M.state() }; }),
    check: (r) => (r.died && r.kind === 'caught' ? true : `expected 'caught', got ${JSON.stringify(r)}`),
  },
  {
    name: 'guard reset on respawn',
    run: ({ page }) => page.evaluate(() => { const M = __medina; const s = M.sim(3, { x: 0 }); return { guard: s.extra.guard, x: s.x, snap: M.game.level.guard.getState().state }; }),
    check: (r) => (r.guard === 'hidden' && r.snap === 'hidden' && near(r.x, 141.5) ? true : `guard not reset ${JSON.stringify(r)}`),
  },
  {
    name: 'fall into ravine', cp: 4,
    run: ({ page }) => page.evaluate(() => { const M = __medina; M.teleport(135.5, 0); for (let i = 0; i < 1000; i++) { const s = M.sim(1 / 120, { x: 1 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, y: s.y }; } return { died: false, s: M.state() }; }),
    check: (r) => (r.died && r.kind === 'fall' ? true : `expected 'fall', got ${JSON.stringify(r)}`),
  },
  {
    name: 'plate with boy only',
    run: ({ page }) => page.evaluate(() => { const M = __medina; M.sim(3, { x: 0 }); M.teleport(128.1, 0); const s = M.sim(2, { x: 0 }); return { plate: s.extra.plate, bridge: s.extra.bridge }; }),
    check: (r) => (near(r.plate, 0.35, 0.001) && r.bridge > 1.5 ? true : `the boy alone must not lower the bridge ${JSON.stringify(r)}`),
  },
  {
    name: 'crate crush', cp: 4,
    run: ({ page }) => page.evaluate(() => { const M = __medina, G = M.game; M.teleport(131.0, 0); G.level.crateB.setState({ x: 131.0, y: 4.3 }); G.level.crateB.body.vx = 0; G.level.crateB.body.y = 3.0; for (let i = 0; i < 300; i++) { const s = M.sim(1 / 120, { x: 0 }); if (s.dead) return { died: true, kind: G.player.deathKind }; } return { died: false }; }),
    check: (r) => (r.died && r.kind === 'crushed' ? true : `expected 'crushed', got ${JSON.stringify(r)}`),
  },
  {
    // the pause menu's "restart from checkpoint": back at the spawn, no death counted, under 0.6 s
    name: 'restart checkpoint is not a death', cp: 1,
    run: ({ page }) => page.evaluate(() => {
      const M = __medina, G = M.game;
      M.sim(0.8, { x: 1 });
      const moved = M.state().x;
      const t0 = G.time;
      const ok = G.restartCheckpoint();
      let tr = null;
      for (let i = 0; i < 240 && tr === null; i++) { M.sim(1 / 120, { x: 0 }); if (G.mode === 'play') tr = G.time - t0; }
      const s = M.sim(0.5, { x: 0 });
      return { ok, moved, x: s.x, cp: s.cp, deaths: s.deaths, mode: s.mode, respawnAfter: tr && +tr.toFixed(3), fadeIn: +(1 / G.fadeSpeed).toFixed(2), deathEvents: M.events().filter((e) => e.name === 'death').length, respawnEvents: M.events().filter((e) => e.name === 'respawn').length };
    }),
    check: (r) => (r.ok && r.moved > 34.5 && near(r.x, 33.5, 0.05) && r.cp === 1 && r.deaths === 0 && r.deathEvents === 0 && r.respawnEvents === 1 && r.mode === 'play' && r.respawnAfter <= 0.3 && r.respawnAfter + r.fadeIn <= 0.6 ? true : `restart failed ${JSON.stringify(r)}`),
  },
  {
    // Guard.getState used to report 'hidden' whatever the guard was doing
    name: 'guard snapshot is its real state', cp: 5,
    run: ({ page }) => page.evaluate(() => { const M = __medina; M.sim(1.0, { x: 1 }); const st = M.game.level.guard.getState(); return { state: st.state, x: +st.x.toFixed(2), extra: M.state().extra.guard }; }),
    check: (r) => (r.state === 'chase' && r.extra === 'chase' ? true : `guard state ${JSON.stringify(r)}`),
  },
  {
    // the plate weighs bodies by weight or kind: a guard weighs nothing, the boy 0.35, a crate 1
    name: 'plate ignores the guard', cp: 4,
    run: ({ page }) => page.evaluate(() => { const L = __medina.game.level; __medina.teleport(120, 0); L.guard.activate(128.15); L.guard.body.y = 0; L.plate.step(1 / 120); const guardLoad = L.plate.load; L.guard.deactivate(); L.crateB.setState({ x: 128.15, y: 0 }); L.plate.step(1 / 120); return { guardLoad, crateLoad: L.plate.load }; }),
    check: (r) => (r.guardLoad === 0 && r.crateLoad === 1 ? true : `plate loads ${JSON.stringify(r)}`),
  },
  {
    // starting at the last checkpoint must not wake the guard (prepare used x > 186 for the checkpoint at 185.9)
    name: 'last checkpoint skips the chase', cp: 6,
    run: ({ page }) => page.evaluate(() => { const M = __medina; const s = M.sim(1.5, { x: 0 }); return { x: s.x, guard: s.extra.guard, chase: M.game.triggers.find((t) => t.id === 'chase').fired }; }),
    check: (r) => (r.guard === 'hidden' && r.chase === true ? true : `chase woke up ${JSON.stringify(r)}`),
  },
];
