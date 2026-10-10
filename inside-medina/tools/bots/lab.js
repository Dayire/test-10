// The Sunwork lab bot: all twelve rooms from the first step to the heliostat (FULL_GAME §11.4 L).
// Built on tools/bots/lib.js and tools/bots/lightlib.js (loaded here when the runner did not inject it).
// Steps end on entity state (locks done, mirrors settled, lamps dazzled), never on time.
window.__bots = window.__bots || {};
if (!window.__lightlib) {
  const x = new XMLHttpRequest();
  x.open('GET', new URL('tools/bots/lightlib.js?bust=' + Math.random().toString(36).slice(2), document.baseURI).href, false); x.send();
  (0, eval)(x.responseText);
}
window.__bots.lab = (B) => {
  window.__lightlib.install(B);
  const { add, run, runLeft, jumpAt, hangClimb, wait, crawlTo, tick, G } = B;
  const { get, lamp, pushMirrorTo, tiltTo, crankTo, capstanTo, waitDone, waitBurnt, waitDazzled } = B.light;
  const ent = (id) => G.level.entities.find((e) => e.id === id);
  const P = () => G.player;
  let jumps = 0, wasAir = false;
  tick((s) => { const air = s.st === 'air'; if (air && !wasAir && P().body.vy > 3) jumps++; wasAir = air; });
  const gateOpen = (id, need = 0.55) => wait(id + ':open', () => ent(id).open > need, { x: 0 }, 6);
  const mantleOver = (name, x) => { jumpAt(name, x); hangClimb(name); };
  // over a stand or a low block, from wherever he stands (on it already, or below it): run, jump at its face, climb
  const over = (name, face, past) => add(name, (s) => ({ x: 1, y: s.st === 'hang' ? 1 : 0, jump: s.st === 'ground' && s.x > face - 0.75 && s.x < face - 0.2 && s.y < face * 0 + 0.3 }), (s) => s.x > past && s.st === 'ground', 6);
  // jumps while gripping (the jump-fix room checks this stays 0)
  const gripJumps = { n: 0 };
  tick((s) => { if (P().grip?.mirror && s.st === 'air') gripJumps.n++; });

  // ---- 1 sunlock: walk past the gust; the cloth lifts, the lock latches, the gate rises
  run('gust', 4.0);
  waitDone('L1', 'L1', 6);
  gateOpen('G1');
  run('G1', 14.5);
  // ---- 2 shadow: climb the shelf, push the crate off it
  jumpAt('shelf', 16.35); hangClimb('shelf');
  add('pushCR1', () => ({ x: 1 }), () => ent('CR1').body.y < 1.5, 10);
  add('stopCR1', () => ({ x: -1 }), () => P().body.vx < -0.1 || P().body.x < 20.3, 1);
  wait('CR1landed', () => ent('CR1').body.grounded && ent('CR1').body.y < 0.05, { x: 0 }, 3);
  waitDone('L2', 'L2', 6);
  add('offShelf', () => ({ x: 1 }), (s) => s.st === 'ground' && s.y === 0, 4);
  gateOpen('G2');
  run('G2', 31.4);
  // ---- 3 kerb: push the first mirror to its stop
  pushMirrorTo('M1', 'M1', 40.0);
  B.light.release('M1:release');
  waitDone('L3', 'L3', 6);
  gateOpen('G3', 0.65);
  add('backM1', () => ({ x: -1 }), (s) => s.x < 38.9, 2);
  mantleOver('overM1', 39.15);
  run('G3', 47.2);
  // ---- 4 tilt: five notches down
  pushMirrorTo('M2', 'M2', 55.0, 0.5);
  tiltTo('M2:tilt', 'M2', -45);
  B.light.release('M2:release');
  waitDone('L4', 'L4', 6);
  gateOpen('G4');
  add('backM2', () => ({ x: -1 }), (s) => s.x < 53.9, 2);
  mantleOver('overM2', 54.15);
  run('G4', 63.2);
  // ---- 5 jumpfix: three notches UP with the up key; never a jump
  pushMirrorTo('MJ', 'MJ', 71.0, 0.5);
  add('MJ:up', () => ({ x: 0, grab: true, y: 1 }), () => get('MJ').target === 0, 3);
  add('MJ:settle', () => ({ x: 0, grab: true, y: 0 }), () => get('MJ').settled, 1);
  add('MJ:noJump', () => ({ x: 0, grab: true }), () => gripJumps.n === 0 && P().grip?.mirror === get('MJ'), 0.1);
  B.light.release('MJ:release');
  waitDone('LJ', 'LJ', 6);
  gateOpen('G5');
  add('backMJ', () => ({ x: -1 }), (s) => s.x < 69.9, 2);
  mantleOver('overMJ', 70.15);
  run('G5', 81.2);
  // ---- 6 bolt: the dash fails by design; the crate is the lasting shadow
  jumpAt('bollard', 93.7);
  wait('bollardLand', (s) => s.st === 'ground', { x: 1 }, 2);
  run('toCR3', 98.3);
  mantleOver('onCR3', 98.85);
  run('offCR3', 101.2); wait('downCR3', (s) => s.st === 'ground' && s.y === 0, { x: 0.5 }, 3);
  pushMirrorTo('CR3', 'CR3', 95.4); // crates take the same grip
  B.light.release('CR3:release');
  wait('B1dark', () => get('B1').level < 0.05, { x: 0 }, 4);
  gateOpen('G6');
  run('G6', 105.2);
  // ---- 7 crank: wheeled M7 to the kerb, tilt, climb, crank
  pushMirrorTo('M7', 'M7', 119.9);
  tiltTo('M7:tilt', 'M7', -30);
  B.light.release('M7:release');
  runLeft('toIvy', 111.6);
  add('climbIvy', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 3.9 && s.st === 'ground'), 8);
  wait('onGallery', (s) => s.st === 'ground' && s.y > 3.9, { x: 0 }, 2);
  add('toK2', (s) => { const d = 117.65 - s.x; return { x: Math.abs(d) < 0.05 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.3 : 1) }; }, (s) => Math.abs(s.x - 117.65) < 0.08 && Math.abs(P().body.vx) < 0.1, 6);
  add('grabK2', () => ({ x: 0, grab: true }), (s) => s.st === 'crank', 1);
  crankTo('F2:crank', 'F2', 45);
  waitDone('L7', 'L7', 6, { x: 0, grab: true });
  add('releaseK2', () => ({ x: 0 }), (s) => s.st === 'ground', 1);
  add('galleryEdge', () => ({ x: 0.4 }), (s) => s.st === 'air', 4);
  add('fall', () => ({ x: 0 }), (s) => s.st === 'ground' && s.y < 0.9, 3);
  wait('land', () => P().landLock <= 0, { x: 0 }, 1);
  gateOpen('G7');
  over('overM7', 119.55, 120.6);
  run('G7', 127.2);
  // ---- 8 burn: M5 to its kerb, three notches down; two beams burn the rope
  pushMirrorTo('M5', 'M5', 133.34);
  tiltTo('M5:tilt', 'M5', -45);
  B.light.release('M5:release');
  waitBurnt('rope', 'rope', 6);
  wait('bridge', () => ent('bridge').angle < 0.02, { x: 0 }, 5);
  mantleOver('overM5', 132.6);
  run('cross', 148.2);
  // ---- 9 clock: the race up the tower, crank the last ray down
  run('corridor', 175.9);
  run('clockStart', 184.9);
  add('climbIvy9', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 4.5 && s.st === 'ground'), 8);
  wait('tier1', (s) => s.st === 'ground' && s.y > 4.5, { x: 0 }, 2);
  run('toLadder9', 188.6);
  add('climbLadder9', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 9.1 && s.st === 'ground'), 8);
  wait('tier2', (s) => s.st === 'ground' && s.y > 9.1, { x: 0 }, 2);
  jumpAt('tier3', 189.95); hangClimb('tier3');
  add('toK3', (s) => { const d = 193.55 - s.x; return { x: Math.abs(d) < 0.05 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.3 : 1) }; }, (s) => Math.abs(s.x - 193.55) < 0.08 && Math.abs(P().body.vx) < 0.1, 6);
  add('grabK3', () => ({ x: 0, grab: true }), (s) => s.st === 'crank', 1);
  crankTo('F3:crank', 'F3', 60);
  waitDone('L8', 'L8', 6, { x: 0, grab: true });
  add('releaseK3', () => ({ x: 0 }), (s) => s.st === 'ground', 1);
  wait('ladderDown', () => G.vines.some((v) => v.x0 === 194.5 && v.enabled), { x: 0 }, 3);
  add('toEdge', (s) => ({ x: 0.5, grab: s.x > 194.15 }), (s) => s.st === 'climb', 4);
  add('climbDown', () => ({ y: -1 }), (s) => s.st === 'ground' && s.y < 0.1, 15);
  gateOpen('G9', 0.35);
  run('greatGate', 207.6);
  // ---- 10 lamp: hide behind the rugs, push the mirror to the kerb, let the lamp light its own lock; dazzle S2
  // Where S1 cannot see: a rug (z -0.8) hides the boy when the lamp's line to his head and chest crosses it,
  // i.e. within 1.05 m of the rug's centre projected from the lamp onto the play plane.
  const S = () => lamp('S1'), S2 = () => lamp('S2');
  const zones = () => { const o = S().origin; return S().covers.map((b) => { const c = (b.min.x + b.max.x) / 2, zc = (b.min.z + b.max.z) / 2, k = (0 - o.z) / (zc - o.z); return { x: o.x + (c - o.x) * k, half: 0.95 * k - 0.05 }; }); };
  const hidden = (x) => zones().some((z) => Math.abs(z.x - x) < z.half - 0.03);
  const LM1 = () => get('LM1');
  const pushTo = (bx) => (s) => ({ x: s.x < bx - 0.03 ? (bx - s.x < 0.2 ? 0.3 : 1) : 0, grab: true });
  add('LM1:walk', (s) => { const d = B.light.standX('LM1', -1) - s.x; return { x: Math.abs(d) < 0.02 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.25 : 1) }; }, (s) => Math.abs(s.x - B.light.standX('LM1', -1)) < 0.03 && Math.abs(P().body.vx) < 0.05, 10);
  add('LM1:grip', () => ({ x: 0, grab: true }), () => P().grip?.mirror === LM1(), 1.5);
  // into the first rug's shadow
  add('LM1:cover1', pushTo(zones()[0]?.x ?? 214.9), (s) => hidden(s.x) && s.x > 214.4, 6);
  // the beam sweeps right past him: follow it to the third rug before it comes back
  add('LM1:wait1', () => ({ x: 0, grab: true }), (s) => S().dir > 0 && S().pause <= 0 && S().aim.x > s.x + 1.6 && S().aim.x < s.x + 4, 30);
  add('LM1:cover3', pushTo(224.9), (s) => s.x > 224.85, 12);
  add('LM1:wait3', () => ({ x: 0, grab: true }), (s) => S().dir < 0 && S().aim.x < s.x - 2.2, 20);
  add('LM1:kerb', (s) => ({ x: LM1().body.x < 229.45 - 0.02 ? 1 : 0, grab: true }), () => LM1().body.x > 229.42 || (LM1().body.x > 229.3 && Math.abs(P().body.vx) < 0.01), 8);
  B.light.release('LM1:release');
  add('LM1:hide', (s) => { const z = zones()[3]; const d = z.x - s.x; return { x: Math.abs(d) < 0.06 ? 0 : Math.sign(d) * 0.6 }; }, (s) => Math.abs(s.x - zones()[3].x) < 0.08 && Math.abs(P().body.vx) < 0.05, 4);
  waitDone('LL1', 'LL1', 30);
  gateOpen('G10', 0.6);
  // S1 swings away left; S2 must be far right before he steps into its range
  add('LL1:wait', () => ({ x: 0 }), (s) => S().dir < 0 && S().aim.x < s.x - 3.6 && S().pause <= 0, 20);
  over('overLM1', 229.1, 230.3);
  add('toGate10', (s) => ({ x: s.x < 232.2 ? 0.6 : 0 }), (s) => s.x > 232.1 && Math.abs(P().body.vx) < 0.05, 4);
  add('waitS2', () => ({ x: 0 }), () => S2().aim.x > 246 && (S2().dir < 0 || S2().pause > 0), 20);
  add('toLM2', (s) => { const d = B.light.standX('LM2', -1) - s.x; return { x: Math.abs(d) < 0.02 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.25 : 1) }; }, (s) => Math.abs(s.x - B.light.standX('LM2', -1)) < 0.03 && Math.abs(P().body.vx) < 0.05, 8);
  add('LM2:grip', () => ({ x: 0, grab: true }), () => P().grip?.mirror === get('LM2'), 1.5);
  tiltTo('LM2:tilt', 'LM2', -45);
  waitDazzled('S2', 'S2', 30, { x: 0, grab: true });
  B.light.release('LM2:release');
  add('backLM2', () => ({ x: -1 }), (s) => s.x < 234.2, 1);
  over('overLM2', 234.9, 236.2);
  run('sprint', 258.8);
  // ---- 11 wire: the basket shows the turret; hurdle, crawl, walk under, the patrol, the moon well
  run('basket', 259.8);
  wait('basketDarted', () => get('T1').state === 'clear' && ent('basket').getState().t > 4, { x: 0 }, 12);
  wait('T1clear', () => get('T1').state === 'clear', { x: 0 }, 8);
  run('T1run', 263.5);
  add('T1jump', () => ({ x: 1, jump: true }), (s) => s.st !== 'ground', 1);
  wait('T1land', (s) => s.st === 'ground', { x: 1 }, 2);
  run('toT2', 269.6);
  crawlTo('T2crawl', 276.6);
  add('stand', () => ({ x: 0.4 }), (s) => !s.crawl, 2);
  run('T7walk', 286.0);
  run('patrol', 299.5);
  add('T4jump', () => ({ x: 1, jump: true }), (s) => s.st !== 'ground', 1);
  wait('T4land', (s) => s.st === 'ground', { x: 1 }, 2);
  run('hole', 308.0);
  wait('guardAsleep', () => ent('guard11').state === 'asleep', { x: 0 }, 6);
  pushMirrorTo('MM', 'MM', 330.0);
  tiltTo('MM:tilt', 'MM', -45);
  B.light.release('MM:release');
  waitDone('ML', 'ML', 6);
  gateOpen('G11');
  add('backMM', () => ({ x: -1 }), (s) => s.x < 328.9, 2);
  mantleOver('overMM', 329.15);
  run('G11', 346.2);
  // ---- 12 dawn: bring the light down, outrun the captain under the sun shafts, turn the heliostat
  add('toK1', (s) => { const d = 349.95 - s.x; return { x: Math.abs(d) < 0.05 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.3 : 1) }; }, (s) => Math.abs(s.x - 349.95) < 0.08 && Math.abs(P().body.vx) < 0.1, 6);
  add('grabK1', () => ({ x: 0, grab: true }), (s) => s.st === 'crank', 1);
  crankTo('F1:crank', 'F1', 30);
  waitDone('LD1', 'LD1', 6, { x: 0, grab: true });
  add('releaseK1', () => ({ x: 0 }), (s) => s.st === 'ground', 1);
  gateOpen('G12');
  run('plaza', 397.2);
  mantleOver('block', 397.45);
  run('door', 432.2);
  wait('stand12', (s) => !s.crawl, { x: 0.3 }, 3);
  run('toRoof', 467.6);
  add('climbRoof', () => ({ y: 1 }), (s) => s.st === 'climbUp' || (s.y > 11.9 && s.st === 'ground'), 15);
  wait('onRoof', (s) => s.st === 'ground' && s.y > 11.9, { x: 0 }, 2);
  add('toCapstan', (s) => { const d = 474.9 - s.x; return { x: Math.abs(d) < 0.05 ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.3 : 1) }; }, (s) => Math.abs(s.x - 474.9) < 0.08 && Math.abs(P().body.vx) < 0.1, 8);
  add('grabCapstan', () => ({ x: 0, grab: true }), (s) => s.st === 'capstan', 1);
  capstanTo('H:turn', 'H', 3.2, 1.6);
  add('fortress', () => ({ x: 0, grab: true }), (s) => s.extra.fortress, 5);
  add('end', () => ({ x: 0 }), (s) => s.mode === 'chapterEnd' || s.mode === 'loading' || G.suspended, 6);
  return {
    summary: () => `jumps while gripping a mirror: ${gripJumps.n}; trace p95 ${G.level?.light?.p95?.().toFixed(3) ?? '?'} ms`,
  };
};
