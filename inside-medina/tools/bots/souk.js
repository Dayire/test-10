// Chapter I bot: the whole souk from the first step to the walk into the light.
// Built on tools/bots/lib.js; chapter state is read from G.level (live) and
// s.extra (__medina.state().extra).
window.__bots = window.__bots || {};
window.__bots.souk = (B) => {
  const { steps, add, run, jumpAt, hangClimb, wait, R, tick, level } = B;
  const G = B.G;
  // safe x-ranges behind the rug covers for the courtyard lamp (from the live level)
  let safeCache = null;
  const safeSpots = () => {
    const L = level();
    if (safeCache && safeCache.L === L) return safeCache.list;
    const lamp = L.searchlight.origin;
    const list = L.covers.map((b) => {
      const c = (b.min.x + b.max.x) / 2, zc = (b.min.z + b.max.z) / 2;
      const s = (0 - lamp.z) / (zc - lamp.z);
      return { x: lamp.x + (c - lamp.x) * s, half: 0.95 * s - 0.35 };
    });
    safeCache = { L, list };
    return list;
  };
  // closest guard distance during the chase
  window.__minGuard = 99;
  tick((s) => { const g = level().guard; if (g && g.state === 'chase') window.__minGuard = Math.min(window.__minGuard, Math.abs(g.body.x - s.x)); });

  // --- A: souk
  jumpAt('sacks', 7.35);
  wait('landSacks', (s) => s.st === 'ground' && s.x > 9, { x: 1 }, 3);
  jumpAt('ledge', 15.55); hangClimb('ledge');
  run('raisedStreet', 31.5); wait('dropA', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 3);
  // --- B: crate
  run('pushCrate', 40.2);
  wait('crateAtWall', () => level().crateA.body.x > 41.45, { x: 1 }, 10);
  add('backOff', () => ({ x: -1 }), (s) => s.x < 40.5, 3);
  add('settle', () => ({ x: 0 }), () => Math.abs(G.player.body.vx) < 0.05, 1);
  add('jumpCrate', () => R({ jump: true }), (s) => s.st !== 'ground', 1);
  hangClimb('crate');
  add('onCrate', () => ({ x: 0.3 }), (s) => s.x > 41.3, 2);
  add('jumpTerrace', () => R({ jump: true }), (s) => s.st !== 'ground', 1);
  hangClimb('terrace');
  jumpAt('gap', 55.75);
  wait('landRoof2', (s) => s.st === 'ground' && s.y > 2 && s.x > 58, { x: 1 }, 3);
  run('roof2', 67.5); wait('awning', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 4);
  // --- C: searchlight courtyard (reactive: wait behind a rug while the beam is near)
  let target = 0;
  add('stealth', (s) => {
    const sl = level().searchlight; const beam = sl.aim.x, dir = sl.dir;
    const safe = safeSpots();
    const next = safe.find((z) => z.x > s.x + 0.3) || { x: 110.2, half: 0.3 };
    const here = safe.find((z) => Math.abs(z.x - s.x) < z.half);
    // how long until the beam reaches the next spot vs how long the boy needs
    const dist = next.x - s.x;
    const tBoy = dist / 4.1 + 0.3;
    const beamIn = (x) => { const b = beam + dir * sl.speed * tBoy; return Math.abs(b - x) < 3.2 || (dir > 0 ? (beam < x + 3 && b > x - 3) : (beam > x - 3 && b < x + 3)); };
    const pathClear = !beamIn(next.x) && !beamIn((s.x + next.x) / 2) && Math.abs(beam - s.x) > 3.2 && sl.pause <= 0.0 || (sl.pause > 0 && Math.abs(beam - (s.x + next.x) / 2) > 6);
    if (here && !pathClear) { target = here.x; }
    else if (pathClear) target = next.x;
    const d = target - s.x;
    return { x: Math.abs(d) < 0.08 ? 0 : Math.sign(d) * (Math.abs(d) < 0.6 ? 0.5 : 1) };
  }, (s) => s.x > 109.9 && s.x < 110.6, 120);
  add('grabLever', () => ({ x: 0, grab: true }), (s) => s.st === 'lever', 1);
  add('pullLever', () => ({ x: -1, grab: true }), (s) => s.extra.lever, 3);
  add('releaseLever', () => ({ x: 0 }), (s) => s.st === 'ground', 1);
  wait('ladderDown', (s) => s.extra.ladder, { x: 0 }, 4);
  add('toLadder', () => ({ x: 1 }), (s) => s.x > 112.9, 3);
  add('climbLadder', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 4.5 && s.st === 'ground'), 8);
  wait('topLadder', (s) => s.st === 'ground', { x: 0 }, 2);
  run('roofC', 119.8); wait('dropC', (s) => s.st === 'ground' && s.y === 0, { x: 1 }, 4);
  // --- D: vine, balcony crate, plate, bridge
  run('toVine', 122.5);
  add('climbVine', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 4 && s.st === 'ground'), 8);
  wait('onBalcony', (s) => s.st === 'ground' && s.y > 4, { x: 0 }, 2);
  add('pushBalconyCrate', () => ({ x: 1 }), () => level().crateB.body.y < 3, 8);
  add('stopAtEdge', () => ({ x: -1 }), () => G.player.body.vx < 0, 1);
  wait('crateLanded', () => level().crateB.body.grounded && level().crateB.body.y < 0.1, { x: 0 }, 3);
  add('dropDown', () => ({ x: 1 }), (s) => s.st === 'ground' && s.y === 0, 5);
  add('faceCrate', () => ({ x: -0.4 }), (s) => s.x - level().crateB.body.x < 0.67 && G.player.facing < 0, 5);
  add('gripCrate', () => ({ x: -0.5, grab: true }), () => !!G.player.grip, 2);
  add('pushToPlate', () => ({ x: -1, grab: true }), () => level().plate.load > 0.9 && level().crateB.body.x < 128.6, 10);
  add('release', () => ({ x: 0 }), () => !G.player.grip, 1);
  wait('bridgeDown', (s) => s.extra.bridge < 0.05, { x: 0 }, 4);
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
  // --- F: the walk into the light (ends in the alley; --to finale stops here)
  add('finale', () => ({ x: 1, y: 1 }), (s) => s.mode === 'chapterEnd' || s.mode === 'loading' || (s.mode === 'finale' && s.z < -13.3), 40);
  return {
    summary: () => `closest guard distance during chase: ${(window.__minGuard ?? 99).toFixed(2)} m`,
    minGuard: () => window.__minGuard,
  };
};
