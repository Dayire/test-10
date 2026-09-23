// Scripted playthrough executed inside the page (window.__medina).
// Each step: { name, input: (s, G) => input, until: (s, G) => bool, max: seconds }
window.__bot = (() => {
  const M = window.__medina, G = M.game, L = G.level;
  const log = [];
  const R = (o) => ({ x: 1, ...o });
  // safe x-ranges behind rug covers for the courtyard lamp
  const lamp = L.searchlight.origin;
  const safe = L.covers.map((b) => { const c = (b.min.x + b.max.x) / 2, zc = (b.min.z + b.max.z) / 2; const t = (-lamp.z + zc) / (-lamp.z); const k = 1 / (1 - (zc - lamp.z) / (0 - lamp.z) + t - t); const s = (0 - lamp.z) / (zc - lamp.z); const x = lamp.x + (c - lamp.x) * s; return { x, half: 0.95 * s - 0.35 }; });
  const steps = [];
  const run = (name, x, extra = {}) => steps.push({ name, input: () => R(extra), until: (s) => s.x >= x, max: 30 });
  const jumpAt = (name, x) => { run(name + ':approach', x); steps.push({ name: name + ':jump', input: () => R({ jump: true }), until: (s) => s.st !== 'ground', max: 1 }); };
  const hangClimb = (name) => { steps.push({ name: name + ':toHang', input: () => R({}), until: (s) => s.st === 'hang' || s.st === 'climbUp', max: 2 }); steps.push({ name: name + ':climb', input: () => R({ y: 1 }), until: (s) => s.st === 'ground', max: 2 }); };
  const mantle = hangClimb;
  const wait = (name, cond, input = { x: 0 }, max = 30) => steps.push({ name, input: () => input, until: cond, max });

  // --- A: souk
  jumpAt('sacks', 7.35);
  wait('landSacks', (s) => s.st === 'ground' && s.x > 9, { x: 1 }, 3);
  jumpAt('ledge', 15.55); hangClimb('ledge');
  run('raisedStreet', 31.5); wait('dropA', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 3);
  // --- B: crate
  run('pushCrate', 40.2);
  wait('crateAtWall', () => L.crateA.body.x > 41.45, { x: 1 }, 10);
  steps.push({ name: 'backOff', input: () => ({ x: -1 }), until: (s) => s.x < 40.5, max: 3 });
  steps.push({ name: 'settle', input: () => ({ x: 0 }), until: (s) => Math.abs(G.player.body.vx) < 0.05, max: 1 });
  steps.push({ name: 'jumpCrate', input: () => R({ jump: true }), until: (s) => s.st !== 'ground', max: 1 });
  hangClimb('crate');
  steps.push({ name: 'onCrate', input: () => ({ x: 0.3 }), until: (s) => s.x > 41.3, max: 2 });
  steps.push({ name: 'jumpTerrace', input: () => R({ jump: true }), until: (s) => s.st !== 'ground', max: 1 });
  hangClimb('terrace');
  jumpAt('gap', 55.75);
  wait('landRoof2', (s) => s.st === 'ground' && s.y > 2 && s.x > 58, { x: 1 }, 3);
  run('roof2', 67.5); wait('awning', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 4);
  // --- C: searchlight courtyard
  let target = 0;
  steps.push({
    name: 'stealth', max: 120,
    input: (s) => {
      const sl = L.searchlight; const beam = sl.aim.x, dir = sl.dir;
      const next = safe.find((z) => z.x > s.x + 0.3) || { x: 110.2, half: 0.3 };
      const here = safe.find((z) => Math.abs(z.x - s.x) < z.half);
      const danger = (bx) => Math.abs(bx - s.x) < 3.5;
      // how long until the beam reaches the next spot vs how long the boy needs
      const dist = next.x - s.x;
      const tBoy = dist / 4.1 + 0.3;
      const beamIn = (x) => { const b = beam + dir * sl.speed * tBoy; return Math.abs(b - x) < 3.2 || (dir > 0 ? (beam < x + 3 && b > x - 3) : (beam > x - 3 && b < x + 3)); };
      const pathClear = !beamIn(next.x) && !beamIn((s.x + next.x) / 2) && Math.abs(beam - s.x) > 3.2 && sl.pause <= 0.0 || (sl.pause > 0 && Math.abs(beam - (s.x + next.x) / 2) > 6);
      if (here && !pathClear) { target = here.x; }
      else if (pathClear) target = next.x;
      const d = target - s.x;
      return { x: Math.abs(d) < 0.08 ? 0 : Math.sign(d) * (Math.abs(d) < 0.6 ? 0.5 : 1) };
    },
    until: (s) => s.x > 109.9 && s.x < 110.6,
  });
  steps.push({ name: 'grabLever', input: () => ({ x: 0, grab: true }), until: (s) => s.st === 'lever', max: 1 });
  steps.push({ name: 'pullLever', input: () => ({ x: -1, grab: true }), until: (s) => s.lever, max: 3 });
  steps.push({ name: 'releaseLever', input: () => ({ x: 0 }), until: (s) => s.st === 'ground', max: 1 });
  wait('ladderDown', (s) => s.ladder, { x: 0 }, 4);
  steps.push({ name: 'toLadder', input: (s) => ({ x: 1 }), until: (s) => s.x > 112.9, max: 3 });
  steps.push({ name: 'climbLadder', input: () => ({ y: 1 }), until: (s) => s.st === 'climbUp' || (s.y > 4.5 && s.st === 'ground'), max: 8 });
  wait('topLadder', (s) => s.st === 'ground', { x: 0 }, 2);
  run('roofC', 119.8); wait('dropC', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 4);
  // --- D: vine, balcony crate, plate, bridge
  run('toVine', 122.5);
  steps.push({ name: 'climbVine', input: () => ({ y: 1 }), until: (s) => s.st === 'climbUp' || (s.y > 4 && s.st === 'ground'), max: 8 });
  wait('onBalcony', (s) => s.st === 'ground' && s.y > 4, { x: 0 }, 2);
  steps.push({ name: 'pushBalconyCrate', input: () => ({ x: 1 }), until: () => L.crateB.body.y < 3, max: 8 });
  steps.push({ name: 'stopAtEdge', input: () => ({ x: -1 }), until: (s) => G.player.body.vx < 0, max: 1 });
  wait('crateLanded', () => L.crateB.body.grounded && L.crateB.body.y < 0.1, { x: 0 }, 3);
  steps.push({ name: 'dropDown', input: () => ({ x: 1 }), until: (s) => s.st === 'ground' && s.y === 0, max: 5 });
  steps.push({ name: 'faceCrate', input: (s) => ({ x: -0.4 }), until: (s) => s.x - L.crateB.body.x < 0.67 && G.player.facing < 0, max: 5 });
  steps.push({ name: 'gripCrate', input: () => ({ x: -0.5, grab: true }), until: () => !!G.player.grip, max: 2 });
  steps.push({ name: 'pushToPlate', input: () => ({ x: -1, grab: true }), until: () => L.plate.load > 0.9 && L.crateB.body.x < 128.6, max: 10 });
  steps.push({ name: 'release', input: () => ({ x: 0 }), until: () => !G.player.grip, max: 1 });
  wait('bridgeDown', (s) => s.bridge < 0.05, { x: 0 }, 4);
  run('crossBridge', 141.6);
  // --- E: chase
  run('chaseStart', 144.5);
  jumpAt('barrels', 148.9);
  wait('landBarrels', (s) => s.st === 'ground', { x: 1 }, 2);
  jumpAt('cart', 154.9); hangClimb('cart');
  run('cartTop', 158.4); wait('offCart', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 3);
  jumpAt('crates', 162.7); wait('landCrates', (s) => s.st === 'ground', { x: 1 }, 2);
  jumpAt('wall', 169.4); hangClimb('wall');
  run('wallTop', 178.3); wait('offWall', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 3);
  run('tunnel', 185.9);
  wait('stand', (s) => !s.crawl, { x: 0.3 }, 3);
  // --- F: finale
  steps.push({ name: 'finale', input: () => ({ x: 1, y: 1 }), until: (s) => s.mode === 'end' || (s.mode === 'finale' && s.z < -13.3), max: 40 });

  function runAll(fromIndex = 0, toName = null) {
    const t0 = G.time;
    for (let i = fromIndex; i < steps.length; i++) {
      const st = steps[i];
      let s = M.state(); let t = 0; let deathSeen = false;
      const dt = 1 / 120;
      while (!st.until(s, G) && t < st.max) {
        const inp = st.input(s, G);
        M.sim(dt, inp);
        s = M.state(); t += dt;
        if (L.guard.state === 'chase') { const d = Math.abs(L.guard.body.x - s.x); window.__minGuard = Math.min(window.__minGuard ?? 99, d); }
        if (s.dead && !deathSeen) { deathSeen = true; log.push(`DEATH in ${st.name} at x=${s.x} (${G.player.deathKind})`); return { ok: false, step: st.name, log, s }; }
      }
      if (t >= st.max) { log.push(`TIMEOUT ${st.name} at x=${s.x} y=${s.y} st=${s.st}`); return { ok: false, step: st.name, log, s }; }
      log.push(`${st.name} ok t=${t.toFixed(2)} x=${s.x} y=${s.y}`);
      if (toName && st.name === toName) break;
    }
    log.push(`closest guard distance during chase: ${(window.__minGuard ?? 99).toFixed(2)} m`);
    return { ok: true, log, time: (G.time - t0).toFixed(1), s: M.state() };
  }
  return { steps, runAll, stepIndex: (n) => steps.findIndex((s) => s.name === n), safe };
})();
