// Sunwork negatives on the lab (FULL_GAME §11.4 L): node tools/negative.mjs --chapter lab [--only name] [--port N]
// Every scenario asserts; the light API is __medina.ext.light(), entities are read from the live level.
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;
// in-page helpers shared by the scenarios (a classic script)
const LIB = `
window.__neg = (() => {
  const M = __medina, G = M.game;
  const L = () => G.level, light = () => G.level.light;
  const get = (id) => light().get(id) || G.level.entities.find((e) => e.id === id);
  const sim = (sec, inp = { x: 0 }) => M.sim(sec, inp);
  const until = (cond, inp = { x: 0 }, max = 20) => { let t = 0; while (!cond() && t < max) { M.sim(1 / 120, typeof inp === 'function' ? inp(M.state()) : inp); t += 1 / 120; if (G.player.dead && !cond.allowDeath) break; } return +t.toFixed(3); };
  const walkTo = (x, tol = 0.03) => until(() => Math.abs(G.player.x - x) < tol && Math.abs(G.player.body.vx) < 0.05, (s) => { const d = x - s.x; return { x: Math.abs(d) < tol ? 0 : Math.sign(d) * (Math.abs(d) < 0.5 ? 0.25 : 1) }; }, 15);
  // stand beside a mirror's stand on its left, facing it, and take it
  const gripLeft = (id) => { const m = get(id); walkTo(m.body.x - 0.55); until(() => G.player.facing === 1, { x: 0.15 }, 1); until(() => !!G.player.grip, { x: 0, grab: true }, 1); return G.player.grip?.mirror === m; };
  const T = (id) => get(id);
  return { M, G, L, light, get, sim, until, walkTo, gripLeft, T };
})();`;
const prep = async (page) => { await page.addScriptTag({ content: LIB }); };

export const scenarios = [
  {
    // FULL_GAME §6.3: the up-edge never buffers a jump while gripping (or in lever / crank / capstan states).
    // 100 trials on the anchored tray MJ, the wheeled tray M1 and the crank K2: grab, then up at a random delay
    // (same frame included), held or tapped; the boy must never leave the ground, and the tray must tilt.
    name: 'pressing up while gripping never jumps', cp: 4,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, sim, until, walkTo } = __neg;
      let rnd = 7; const R = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
      const out = { trials: 0, jumps: 0, air: 0, tilted: 0, kinds: {}, fails: [] };
      const kinds = ['MJ', 'M1', 'K2'];
      for (let k = 0; k < 100; k++) {
        const kind = kinds[k % 3];
        const cp = kind === 'MJ' ? 4 : kind === 'M1' ? 2 : 6;
        M.checkpoint(cp);
        let t0;
        if (kind === 'K2') {
          // on the gallery, at the crank
          G.player.spawn(117.65, 4.0, 1); sim(0.2);
        } else {
          const m = get(kind); walkTo(m.body.x - 0.55); until(() => G.player.facing === 1, { x: 0.15 }, 1);
        }
        const target0 = kind === 'K2' ? get('F2').target : get(kind).target;
        const y0 = G.player.y;
        const delay = Math.floor(R() * 5) === 0 ? 0 : R() * 0.35;     // a fifth press up in the grab frame
        const hold = R() < 0.5;                                     // held, or tapped every few frames
        const tapEvery = 2 + Math.floor(R() * 10);
        let airborne = false, steps = 0;
        const total = 1.4;
        for (let t = 0; t < total; t += 1 / 120, steps++) {
          const up = t >= delay && (hold || (steps % (tapEvery * 2)) < tapEvery);
          const s = M.sim(1 / 120, { x: 0, grab: true, y: up ? 1 : 0 });
          if (s.st === 'air' || G.player.body.vy > 0.5 || G.player.y > y0 + 0.05) airborne = true;
        }
        const target1 = kind === 'K2' ? get('F2').target : get(kind).target;
        out.trials++; out.kinds[kind] = (out.kinds[kind] || 0) + 1;
        if (airborne) { out.jumps++; out.fails.push({ k, kind, delay: +delay.toFixed(3), hold }); }
        if (target1 !== target0) out.tilted++;
      }
      return out;
    }); },
    check: (r) => (r.trials === 100 && r.jumps === 0 && r.tilted >= 95 ? true : `jumped in ${r.jumps} of ${r.trials} trials (tilted ${r.tilted}): ${JSON.stringify(r.fails.slice(0, 5))}`),
  },
  {
    // §6.3 / §8.1: a latched grip (touch on a mirror, a crank; grab 'toggle' on anything) is taken by a tap and let go
    // by the next one, however long that tap is held: the releasing tap never takes the prop again. Hold mode on a
    // keyboard keeps the plain rule (a grip lasts as long as grab is held)
    name: 'a second tap lets a latched grip go', cp: 3,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, walkTo, until, sim } = __neg;
      const out = {};
      const holding = (k) => (k === 'K2' ? G.player.state === 'crank' : !!G.player.grip);
      const press = (n) => { const seen = []; for (let i = 0; i < n; i++) { M.sim(1 / 120, { x: 0, grab: true }); seen.push(holding(out.k)); } return seen; };
      const idle = (n = 24) => { for (let i = 0; i < n; i++) M.sim(1 / 120, { x: 0 }); };
      const setups = {
        M2: () => { G.input.lastDevice = 'touch'; M.checkpoint(3); walkTo(get('M2').body.x - 0.55); until(() => G.player.facing === 1, { x: 0.15 }, 1); idle(); },
        K2: () => { G.input.lastDevice = 'touch'; M.checkpoint(6); G.player.spawn(117.65, 4.0, 1); sim(0.3); },
        CR3: () => { G.input.lastDevice = 'keyboard'; G.settings.grabMode = 'toggle'; M.checkpoint(5); const c = get('CR3'); M.teleport(c.body.x + c.body.w / 2 + 0.19, 0, -1); idle(36); },
      };
      for (const k of ['M2', 'K2', 'CR3']) {
        out.k = k; const r = out[k] = { runs: [] };
        for (const n of [2, 12, 60]) {
          setups[k]();
          press(12); idle();
          const taken = holding(k) && G.player.latch;
          const during = press(n); idle();
          const released = !holding(k) && !G.player.latch;
          // a third tap takes it again: the latch still works after a release
          press(12); idle();
          r.runs.push({ n, taken, during: during.filter(Boolean).length, released, again: holding(k) && G.player.latch });
          press(12); idle(); // let go before the next run
        }
      }
      // hold mode on a keyboard: no latch, the grip ends with the press
      G.settings.grabMode = 'hold'; out.k = 'M2'; G.input.lastDevice = 'keyboard'; M.checkpoint(3); walkTo(get('M2').body.x - 0.55); until(() => G.player.facing === 1, { x: 0.15 }, 1); idle();
      const held = press(12); idle();
      out.hold = { during: held.filter(Boolean).length, after: !!G.player.grip, latch: G.player.latch };
      G.input.lastDevice = 'keyboard'; delete out.k;
      return out;
    }); },
    check: (r) => {
      const bad = [];
      for (const k of ['M2', 'K2', 'CR3']) for (const x of r[k].runs) if (!x.taken || x.during || !x.released || !x.again) bad.push({ k, ...x });
      if (r.hold.during < 11 || r.hold.after || r.hold.latch) bad.push({ hold: r.hold });
      return bad.length ? `latched grips: ${JSON.stringify(bad)}` : true;
    },
  },
  {
    // a jump still works from the ground, and the jump button drops a grip and jumps
    name: 'the jump button still jumps from a grip', cp: 4,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, walkTo, until, sim } = __neg;
      const m = get('MJ'); walkTo(m.body.x - 0.55); until(() => G.player.facing === 1, { x: 0.15 }, 1);
      until(() => !!G.player.grip, { x: 0, grab: true }, 1);
      const gripped = !!G.player.grip;
      M.sim(1 / 120, { x: 0, grab: true, jump: true });
      let air = false; for (let i = 0; i < 30; i++) { const s = M.sim(1 / 120, { x: 0, grab: true, jump: true }); if (s.st === 'air') air = true; }
      sim(1, { x: 0 });
      // up with nothing held, away from vines: still a jump
      walkTo(66); let air2 = false; M.sim(1 / 120, { x: 0, y: 1 }); for (let i = 0; i < 30; i++) { const s = M.sim(1 / 120, { x: 0, y: 1 }); if (s.st === 'air') air2 = true; }
      return { gripped, jumpFromGrip: air, upJumpsFree: air2 };
    }); },
    check: (r) => (r.gripped && r.jumpFromGrip && r.upJumpsFree ? true : `jump paths ${JSON.stringify(r)}`),
  },
  {
    // wrong notch → the lock stays dark for 10 s (every room with a tilting or cranking solution)
    name: 'wrong notch: the lock stays dark 10 s', cp: 0,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, sim } = __neg;
      const rooms = [
        { cp: 3, mirror: 'M2', lock: 'L4', right: -45, park: 47.5 },
        { cp: 4, mirror: 'MJ', lock: 'LJ', right: 0, park: 63.5 },
        { cp: 6, mirror: 'F2', lock: 'L7', right: 45, park: 105.5, pre: () => get('M7').setState({ x: 119.9, y: 0, alpha: -30 }) },
        { cp: 9, mirror: 'F3', lock: 'L8', right: 60, park: 176.5 },
        { cp: 11, mirror: 'MM', lock: 'ML', right: -45, park: 312.5, pre: () => get('MM').setState({ x: 330, y: 0, alpha: 15 }) },
        { cp: 12, mirror: 'F1', lock: 'LD1', right: 30, park: 346.5 },
      ];
      const out = [], odd = [];
      for (const R of rooms) {
        const lit = [];
        for (let n = -6; n < 6; n++) {
          const a = n * 15;
          M.checkpoint(R.cp); R.pre?.(); M.teleport(R.park, 0, 1);
          get(R.mirror).setState({ ...get(R.mirror).getState(), alpha: a });
          let max = 0;
          for (let i = 0; i < 20; i++) { sim(0.5, { x: 0 }); max = Math.max(max, get(R.lock).level); }
          if (get(R.lock).done || max >= 1) lit.push(a);
          if (G.mode !== 'play' || G.player.dead) odd.push({ lock: R.lock, a, mode: G.mode, dead: G.player.dead });
        }
        out.push({ lock: R.lock, lit });
      }
      return { out, odd };
    }); },
    check: (r) => {
      const want = { L4: [-45], LJ: [0], L7: [45], L8: [60], ML: [-45], LD1: [30] };
      const bad = r.out.filter((x) => JSON.stringify(x.lit) !== JSON.stringify(want[x.lock]));
      // no setting of a lab mirror may end the chapter or kill the boy (a ray sent back into the fortress eye did)
      return bad.length || r.odd.length ? `locks lit by other notches: ${JSON.stringify(bad)} odd: ${JSON.stringify(r.odd.slice(0, 4))}` : true;
    },
  },
  {
    // II-D2: one beam smoulders the rope, it never burns
    name: 'one beam never burns the rope', cp: 7,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { get, sim } = __neg;
      let maxI = 0, maxHeat = 0;
      for (let i = 0; i < 40; i++) { sim(0.25, { x: 0 }); maxI = Math.max(maxI, get('rope').I); maxHeat = Math.max(maxHeat, get('rope').heat); }
      // M5 to its kerb, tilted: two beams burn it
      get('M5').setState({ x: 133.34, y: 0, alpha: -45 });
      let t = 0; while (!get('rope').burnt && t < 5) { sim(0.1, { x: 0 }); t += 0.1; }
      return { maxI: +maxI.toFixed(3), maxHeat, burntAlone: maxHeat >= 1, twoBurn: get('rope').burnt, t: +t.toFixed(2), bridge: get('bridge').angle };
    }); },
    check: (r) => (near(r.maxI, 1, 1e-6) && r.maxHeat === 0 && !r.burntAlone && r.twoBurn && r.t <= 1.8 ? true : `rope ${JSON.stringify(r)}`),
  },
  {
    // II-C2: standing in his own shadow opens the bolt's gate, but the dash to it fails
    name: 'bolt dash fails', cp: 5,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until, walkTo } = __neg;
      // hop the bollard, stand in the shadow until the gate is fully open
      M.teleport(95.6, 0, 1);
      const tOpen = until(() => get('G6').open > 0.99, { x: 0 }, 6);
      const bolt = get('B1').level;
      let maxX = 0, t = 0;
      while (t < 5) { const s = M.sim(1 / 120, { x: 1 }); maxX = Math.max(maxX, s.x); t += 1 / 120; }
      return { tOpen, bolt, maxX: +maxX.toFixed(2), gate: +get('G6').open.toFixed(2), dead: G.player.dead };
    }); },
    check: (r) => (r.tOpen < 3 && r.bolt < 0.05 && r.maxX < 103.4 && r.gate < 0.5 && !r.dead ? true : `the dash got through ${JSON.stringify(r)}`),
  },
  {
    // III-A / C2: walking the hurdle, standing in the crawl line, jumping under the high wire → the turret darts him
    name: 'tripwires: walk, stand, jump → shot', cp: 11,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const out = {};
      const die = (setup, inp, max = 6) => { M.checkpoint(11); for (const id of ['gustBasket']) G.triggers.find((t) => t.id === id).fired = true; setup(); const c = () => G.player.dead; c.allowDeath = true; const t = until(c, inp, max); return { dead: G.player.dead, kind: G.player.deathKind, t }; };
      out.walkT1 = die(() => M.teleport(262.5, 0, 1), { x: 0.4 });
      out.standT2 = die(() => M.teleport(272.5, 0, 1), { x: 0 });
      out.jumpT7 = die(() => M.teleport(281.5, 0.5, 1), (s) => ({ x: 0, jump: s.st === 'ground' && G.player.y > 0.45 }));
      // and the right moves clear them: crawl T2, walk under T7
      M.checkpoint(11); G.triggers.find((t) => t.id === 'gustBasket').fired = true;
      M.teleport(269.6, 0, 1);
      until(() => G.player.x > 276.6, { x: 1, y: -1 }, 12);
      M.sim(1.2, { x: 0.3 });
      const t2 = get('T2').state;
      until(() => G.player.x > 286, { x: 1 }, 6); M.sim(1.5, { x: 0 });
      return { ...out, crawl: { state: t2, dead: G.player.dead }, walkT7: { state: get('T7').state, dead: G.player.dead } };
    }); },
    check: (r) => (['walkT1', 'standT2', 'jumpT7'].every((k) => r[k].dead && r[k].kind === 'shot') && !r.crawl.dead && r.crawl.state === 'clear' && !r.walkT7.dead && r.walkT7.state === 'clear' ? true : `tripwires ${JSON.stringify(r)}`),
  },
  {
    // III-D: the guard runs through T4 and the lamp-keepers' own turret darts him; the slaved lamp fixates him.
    // The tripwire's own beam never stuns him (only daylight does), so he falls past the wire, about x 305; asleep
    // he lies low (no 1.8 m shadow), and once the line is whole again T4 clears and S5 lets him go
    name: 'the turret darts the guard', cp: 11,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      G.triggers.find((t) => t.id === 'gustBasket').fired = true;
      M.teleport(296, 0, 1);
      let fix = false, jumped = false, stunned = false;
      const g = get('guard11');
      const t = until(() => g.state === 'asleep', (s) => { if (get('S5').fix) fix = true; if (g.state === 'stunned') stunned = true; const j = s.x > 299.45 && s.x < 299.7 && s.st === 'ground' && !jumped; if (j) jumped = true; return { x: 1, jump: j }; }, 10);
      until(() => G.player.x > 308, { x: 1 }, 4);
      M.sim(5, { x: 0 });
      return { asleep: g.state, t, fix, stunned, gx: +g.body.x.toFixed(2), gh: g.body.h, T4: get('T4').state, S5fix: !!get('S5').fix, dead: G.player.dead, x: G.player.x };
    }); },
    check: (r) => (r.asleep === 'asleep' && r.fix && !r.stunned && !r.dead && r.gx > 302 && r.gx < 306 && r.gh <= 0.5 && r.T4 === 'clear' && !r.S5fix ? true : `guard ${JSON.stringify(r)}`),
  },
  {
    // III-B2: without the dazzle the open run is death; with it, the boy crosses alive (and the tray shields him)
    name: 'dazzle lets him run; no dazzle kills', cp: 10,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const open = () => { get('LL1').setState({ level: 1, done: true }); get('G10').setState({ open: 1 }); };
      // no dazzle: LM2 left at −30
      M.checkpoint(10); open(); M.teleport(236.2, 0, 1);
      const c = () => G.player.dead || G.player.x > 258; c.allowDeath = true;
      until(c, { x: 1 }, 10);
      const plain = { dead: G.player.dead, kind: G.player.deathKind, x: G.player.x };
      // dazzle: tucked at LM2 (−45), wait for the lamp's left rest, then run
      M.checkpoint(10); open(); get('LM2').setState({ x: 235.25, y: 0, alpha: -45 });
      M.teleport(234.73, 0, 1);
      let seen = 0;
      const t = until(() => get('S2').dazzled > 0, () => { seen = Math.max(seen, get('S2').seen); return { x: 0 }; }, 15);
      const shielded = !G.player.dead && get('S2').state !== 'alarm';
      M.teleport(236.2, 0, 1);
      until(c, { x: 1 }, 10);
      return { plain, dazzle: { t, shielded, seen: +seen.toFixed(2), dead: G.player.dead, x: +G.player.x.toFixed(1) } };
    }); },
    check: (r) => (r.plain.dead && r.plain.kind === 'shot' && r.dazzle.shielded && !r.dazzle.dead && r.dazzle.x > 257 ? true : `dazzle ${JSON.stringify(r)}`),
  },
  {
    // III-B2: a dazzle lasts 7 s (10.5 s with assist) and then ends: the beam settles back onto the street without
    // a jump, the lamp sweeps away from the rest that blinded it, and it sees the boy again within one sweep cycle
    name: 'a dazzle ends and the lamp sees again', cp: 10,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const one = (assist) => {
        M.checkpoint(10); G.assist = assist;
        get('LL1').setState({ level: 1, done: true }); get('G10').setState({ open: 1 });
        get('LM2').setState({ x: 235.25, y: 0, alpha: -45 });
        M.teleport(234.73, 0, 1);
        until(() => get('S2').dazzled > 0, { x: 0 }, 15);
        const S = get('S2');
        M.teleport(241, 0, 1); // in the open, in the sweep
        let t = 0, dazzleT = null, seenBlind = 0, jump = 0, prevY = S.aim.y, settleY = null;
        const cycle = 2 * (S.x1 - S.x0) / S.speed + 2 * S.pauseT;
        while (t < 30 && !G.player.dead && S.state !== 'alarm') {
          M.sim(1 / 120, { x: 0 }); t += 1 / 120;
          if (dazzleT === null && S.state !== 'dazzled') dazzleT = t;
          if (S.blind) seenBlind = Math.max(seenBlind, S.seen);
          if (dazzleT !== null) jump = Math.max(jump, Math.abs(S.aim.y - prevY));
          if (settleY === null && dazzleT !== null && !S.blind) settleY = S.aim.y;
          prevY = S.aim.y;
        }
        G.assist = false;
        return { dazzleT: +(dazzleT ?? -1).toFixed(2), seenAfter: dazzleT === null ? null : +(t - dazzleT).toFixed(2), cycle: +cycle.toFixed(2), seenBlind, jump: +jump.toFixed(3), settleY: settleY && +settleY.toFixed(2), state: S.state, dead: G.player.dead, kind: G.player.deathKind };
      };
      return { plain: one(false), assist: one(true) };
    }); },
    check: (r) => {
      const ok = (o, sec) => near(o.dazzleT, sec, 0.05) && o.seenBlind === 0 && o.jump < 0.3 && o.seenAfter !== null && o.seenAfter <= o.cycle + 1 && (o.state === 'alarm' || o.kind === 'shot');
      return ok(r.plain, 7) && ok(r.assist, 10.5) ? true : `dazzle lifecycle ${JSON.stringify(r)}`;
    },
  },
  {
    // II-E2: the idle clock kills ('sunset') when the last ray dies; the respawn resets t, T and the look
    name: 'idle sunset clock fails, respawn restores t', cp: 9,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      M.teleport(177, 0, 1);
      M.sim(0.2, { x: 0 });
      const started = get('clock').running;
      const c = () => G.player.dead; c.allowDeath = true;
      const t = until(c, { x: 0 }, 80);
      const kind = G.player.deathKind, clockT = get('clock').t;
      M.sim(3.2, { x: 0 });
      return { started, t, kind, clockT: +clockT.toFixed(2), after: { t: get('clock').t, running: get('clock').running, T: get('T').T, keys: !!G.director.xKeys, mode: G.mode, x: G.player.x } };
    }); },
    check: (r) => (r.started && r.kind === 'sunset' && near(r.clockT, 48.1, 0.3) && r.after.t === 0 && !r.after.running && near(r.after.T, 4) && r.after.keys && r.after.mode === 'play' ? true : `clock ${JSON.stringify(r)}`),
  },
  {
    // §6.6: a wheeled mirror pushed out of its zone fades and is home again within 3 s
    name: 'a lost mirror comes home in 3 s', cp: 2,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until, walkTo } = __neg;
      const m = get('M1');
      // from its right side, push it left out of the room
      M.teleport(m.body.x + 0.55, 0, -1); M.sim(0.1, { x: 0 });
      until(() => !!G.player.grip, { x: 0, grab: true }, 1);
      const tLost = until(() => m.lostT > 0, { x: -1, grab: true }, 12);
      let t = 0; while (m.lostT > 0 && t < 5) { M.sim(1 / 120, { x: 0 }); t += 1 / 120; }
      return { tLost, back: +t.toFixed(2), x: m.body.x, alpha: m.alpha, grip: !!G.player.grip };
    }); },
    check: (r) => (r.back <= 3 && r.back >= 1.9 && near(r.x, 33, 0.01) && r.alpha === -15 && !r.grip ? true : `mirror ${JSON.stringify(r)}`),
  },
  {
    // a death puts back the checkpoint's angles and locks (and keeps the locks solved before it)
    name: 'death and respawn restore angles and locks', cp: 3,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until, gripLeft } = __neg;
      const before = { L3: get('L3').done, M2: get('M2').target, L4: get('L4').done };
      gripLeft('M2');
      until(() => get('M2').target === -45, { x: 0, grab: true, y: -1 }, 5);
      until(() => get('L4').done, { x: 0, grab: true }, 3);
      const solved = { L4: get('L4').done, M2: get('M2').target, G4: get('G4').open };
      G.player.die('fall');
      M.sim(3, { x: 0 });
      return { before, solved, after: { L3: get('L3').done, M2: get('M2').target, M2a: get('M2').alpha, L4: get('L4').done, L4level: get('L4').level, G4: get('G4').open, x: G.player.x, mode: G.mode } };
    }); },
    check: (r) => (r.before.L3 && r.before.M2 === 30 && r.solved.L4 && r.after.L3 && r.after.M2 === 30 && r.after.M2a === 30 && !r.after.L4 && r.after.L4level === 0 && r.after.G4 === 0 && r.after.mode === 'play' ? true : `restore ${JSON.stringify(r)}`),
  },
  {
    // finger aim (§6.3): the pointer picks the notch that sends the beam toward it; aim snap prefers a lit target
    name: 'finger aim and soft snap', cp: 3,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until, gripLeft } = __neg;
      gripLeft('M2');
      M.sim(0.2, { x: 0, grab: true });
      // aim straight at the lock: the notch that hits it
      until(() => get('M2').settled && get('M2').target === -45, { x: 0, grab: true, aimTarget: { x: 56.23, y: 5.8 } }, 3);
      const exact = get('M2').target;
      // aim a little beside it: the raw notch lights nothing, the neighbour lights the lock, snap takes it
      M.checkpoint(3); gripLeft('M2'); M.sim(0.2, { x: 0, grab: true });
      until(() => get('M2').settled && get('M2').target !== 30, { x: 0, grab: true, aimTarget: { x: 57.6, y: 4.2 } }, 3);
      const snapped = get('M2').target;
      G.settings.aimSnap = false;
      M.checkpoint(3); gripLeft('M2'); M.sim(0.2, { x: 0, grab: true });
      until(() => get('M2').settled && get('M2').target !== 30, { x: 0, grab: true, aimTarget: { x: 57.6, y: 4.2 } }, 3);
      const raw = get('M2').target;
      G.settings.aimSnap = true;
      return { exact, snapped, raw };
    }); },
    check: (r) => (r.exact === -45 && r.snapped === -45 && r.raw !== -45 ? true : `aim ${JSON.stringify(r)}`),
  },
  {
    // §6.4: the unified rule in the lab: a balcony or a tray between the lamp and the boy hides him
    name: 'lit = seen: trays and solids hide him', cp: 10,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get } = __neg;
      const S2 = get('S2');
      get('LM2').setState({ x: 235.25, y: 0, alpha: -45 });
      M.teleport(234.73, 0, 1); M.sim(0.1, { x: 0 });
      const p = G.player.body;
      const head = new (S2.aim.constructor)(p.x, p.y + p.h * 0.85, 0);
      S2.aim.set(p.x, 0.6, 0);
      const behindTray = S2.visible(head);
      M.teleport(240, 0, 1); M.sim(0.05, { x: 0 });
      const head2 = new (S2.aim.constructor)(G.player.x, 0.99, 0);
      S2.aim.set(G.player.x, 0.6, 0);
      const open = S2.visible(head2);
      return { behindTray, open };
    }); },
    check: (r) => (!r.behindTray && r.open ? true : `line of sight ${JSON.stringify(r)}`),
  },
  {
    // IV-C: a sun shaft stuns a lamp-keeper (shield eyes 1.2 s, then 2 s of immunity); the boy is untouched
    name: 'sun shafts stun the captain', cp: 12,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const cap = get('captain');
      get('LD1').setState({ level: 1, done: true }); get('G12').setState({ open: 1 });
      M.teleport(401, 0, 1);
      cap.activate(388);
      const states = new Set(); let stuns = 0, prev = cap.state;
      for (let i = 0; i < 120 * 6; i++) { M.sim(1 / 120, { x: 0 }); if (cap.state === 'stunned' && prev !== 'stunned') stuns++; prev = cap.state; states.add(cap.state); }
      return { stuns, states: [...states], dead: G.player.dead, kind: G.player.deathKind };
    }); },
    check: (r) => (r.stuns >= 1 && r.states.includes('stunned') ? true : `captain ${JSON.stringify(r)}`),
  },
  {
    // §6.5 budget: trace p95 ≤ 0.35 ms across the lab (sampled while the bot-like boy walks every room)
    name: 'trace p95 ≤ 0.35 ms', cp: 0,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G } = __neg;
      const api = M.ext.light();
      api.resetStats();
      for (const cp of [0, 3, 6, 7, 9, 10, 11, 12]) { M.checkpoint(cp); M.sim(4, { x: 0.3 }); }
      const s = M.ext.light().samples().sort((a, b) => a - b);
      const p95 = s[Math.floor(s.length * 0.95)], med = s[Math.floor(s.length / 2)];
      return { n: s.length, p95: +p95.toFixed(4), median: +med.toFixed(4), max: +s[s.length - 1].toFixed(3), sources: G.level.light.sources.length };
    }); },
    check: (r) => (r.n > 400 && r.p95 <= 0.35 ? true : `trace ${JSON.stringify(r)}`),
  },
  {
    // the light census is the fixed rig's, here as in the souk (FULL_GAME §9.1)
    name: 'light census unchanged', cp: 0,
    run: async ({ page }) => page.evaluate(async () => { const lab = __medina.lights(); await __medina.loadChapter('souk', 0); const souk = __medina.lights(); await __medina.loadChapter('lab', 10); return { lab, souk, again: __medina.lights() }; }),
    check: (r) => (JSON.stringify(r.lab) === JSON.stringify(r.souk) && JSON.stringify(r.again) === JSON.stringify(r.lab) ? true : `census ${JSON.stringify(r)}`),
  },
];
