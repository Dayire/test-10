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
    // wrong notch → the lock stays dark for 10 s (every room with a tilting or cranking solution): never latched, and
    // no petal stirs (level ≤ 0.02 throughout)
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
      const out = [], odd = [], glow = [];
      for (const R of rooms) {
        const lit = [];
        for (let n = -6; n < 6; n++) {
          const a = n * 15;
          M.checkpoint(R.cp); R.pre?.(); M.teleport(R.park, 0, 1);
          get(R.mirror).setState({ ...get(R.mirror).getState(), alpha: a });
          let max = 0;
          for (let i = 0; i < 20; i++) { sim(0.5, { x: 0 }); max = Math.max(max, get(R.lock).level); }
          if (get(R.lock).done || max >= 1) lit.push(a);
          else if (max > 0.02) glow.push({ lock: R.lock, a, max: +max.toFixed(3) }); // not even a petal stirs
          if (G.mode !== 'play' || G.player.dead) odd.push({ lock: R.lock, a, mode: G.mode, dead: G.player.dead });
        }
        out.push({ lock: R.lock, lit });
      }
      return { out, odd, glow };
    }); },
    check: (r) => {
      const want = { L4: [-45], LJ: [0], L7: [45], L8: [60], ML: [-45], LD1: [30] };
      const bad = r.out.filter((x) => JSON.stringify(x.lit) !== JSON.stringify(want[x.lock]));
      // a wrong notch leaves the lock dark: level ≤ 0.02 for 10 s (no partial light: in these rooms every light that
      // reaches a lock is strong enough to open it, so a half-open lock would be a stray beam). The one designed
      // partial is the moon on a gold lock (GL), which is not among these locks.
      // No setting of a lab mirror may end the chapter or kill the boy (a ray sent back into the fortress eye did)
      return bad.length || r.odd.length || r.glow.length ? `locks lit by other notches: ${JSON.stringify(bad)} glowing: ${JSON.stringify(r.glow)} odd: ${JSON.stringify(r.odd.slice(0, 4))}` : true;
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
    // III-B2 played as a player does: tucked at LM2 when the dazzle starts, he reacts after a delay, steps back, hops
    // over the stand and sprints out of the square (x 258). The crossing's slack is the latest start that still gets
    // him out unseen; a human needs the reaction and the hop, which the run above (teleported past the stand) skips.
    // Every start up to that slack must survive, and the slack must leave a player at least 3 s (6 s with assist; measured
    // at the integration: 4 s and 7.5 s, the lamp's sweep starting again behind him)
    name: 'the dazzle leaves time to cross', cp: 10,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const one = (delay, assist) => {
        M.checkpoint(10); G.assist = assist;
        get('LL1').setState({ level: 1, done: true }); get('G10').setState({ open: 1 });
        get('LM2').setState({ x: 235.25, y: 0, alpha: -45 });
        M.teleport(234.73, 0, 1);
        until(() => get('S2').dazzled > 0, { x: 0 }, 15);
        const S = get('S2'); let t = 0;
        const step = (inp) => { M.sim(1 / 120, inp); t += 1 / 120; };
        while (t < delay && !G.player.dead) step({ x: 0 });
        while (G.player.x > 234.2 && t < 30 && !G.player.dead) step({ x: -1 });
        // over the stand from wherever he stands: run, jump at its face, climb if he hangs
        while (!(G.player.x > 236.2 && G.player.state === 'ground') && t < 30 && !G.player.dead) { const p = G.player; step({ x: 1, y: p.state === 'hang' ? 1 : 0, jump: p.state === 'ground' && p.x > 234.15 && p.x < 234.7 && p.y < 0.3 }); }
        const over = +t.toFixed(2);
        while (G.player.x < 258 && t < 30 && !G.player.dead) step({ x: 1 });
        const out = { delay, over, out: +t.toFixed(2), dead: G.player.dead, x: +G.player.x.toFixed(1), lamp: S.state };
        // past the square: the lamp may not catch him on the way out
        for (let i = 0; i < 120 && !G.player.dead; i++) step({ x: 1 });
        out.dead = G.player.dead; G.assist = false;
        return out;
      };
      // the latest start (0.5 s steps) from which he gets out; each run: start delay / over the stand / out (s)
      const scan = (assist) => { const runs = []; let slack = -1; for (let d = 0; d <= 8; d += 0.5) { const r = one(d, assist); runs.push(`${d}/${r.over}/${r.out}${r.dead ? ` dead ${r.x}` : ''}`); if (r.dead) break; slack = d; } return { slack, runs }; };
      const plain = scan(false), assist = scan(true);
      return { slack: plain.slack, slackAssist: assist.slack, plain: plain.runs, assist: assist.runs };
    }); },
    check: (r) => (r.slack >= 3 && r.slackAssist >= 6 ? true : `crossing slack ${r.slack} s (assist ${r.slackAssist} s): ${JSON.stringify(r)}`),
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
    // II-E2: the idle clock kills ('sunset') when the last ray dies and the screen dims to indigo; the respawn resets
    // t, T and the look
    // the screen dims to indigo #0b1026 (§3.2), not black: read off the screen once the fade is complete
    name: 'idle sunset clock fails, respawn restores t', cp: 9,
    run: async ({ page }) => {
      await prep(page);
      const r = await page.evaluate(() => {
        const { M, G, get, until } = __neg;
        M.teleport(177, 0, 1);
        M.sim(0.2, { x: 0 });
        const started = get('clock').running;
        const c = () => G.player.dead; c.allowDeath = true;
        const t = until(c, { x: 0 }, 80);
        const kind = G.player.deathKind, clockT = get('clock').t;
        M.sim(2.0, { x: 0 });
        return { started, t, kind, clockT: +clockT.toFixed(2), target: G.fadeTarget, color: G.level.deathColor?.(kind) };
      });
      await page.waitForFunction(() => __medina.game.fade >= 0.999, null, { timeout: 60000, polling: 50 }).catch(() => {});
      await page.evaluate(() => new Promise((res) => { let n = 3; const f = () => (n-- <= 0 ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }));
      const png = (await page.screenshot()).toString('base64');
      r.screen = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
        const x = cv.getContext('2d'); x.drawImage(img, 0, 0);
        // the median of a grid of pixels (the grain moves single pixels by a step or two)
        const px = [];
        for (let i = 1; i < 8; i++) for (let j = 1; j < 6; j++) px.push(Array.from(x.getImageData(Math.floor(img.width * i / 8), Math.floor(img.height * j / 6), 1, 1).data).slice(0, 3));
        const med = (k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1];
        return [med(0), med(1), med(2)];
      }, png);
      r.after = await page.evaluate(() => {
        const { M, G, get } = __neg;
        M.sim(1.2, { x: 0 });
        return { t: get('clock').t, running: get('clock').running, T: get('T').T, keys: !!G.director.xKeys, mode: G.mode, x: G.player.x };
      });
      return r;
    },
    check: (r) => (r.started && r.kind === 'sunset' && near(r.clockT, 48.1, 0.3) && r.target === 1 && r.color === 0x0b1026 && near(r.screen[0], 11, 3) && near(r.screen[1], 16, 3) && near(r.screen[2], 38, 3)
      && r.after.t === 0 && !r.after.running && near(r.after.T, 4) && r.after.keys && r.after.mode === 'play' ? true : `clock ${JSON.stringify(r)}`),
  },
  {
    // II-E2 success: once L8 latches the sun sets over 6 s (the terminator climbs past the last ray), the clock never
    // kills, and later rooms start with the ray gone (no sunbeam across the night sky)
    name: 'a won clock sets the sun', cp: 9,
    run: async ({ page }) => { await prep(page); return page.evaluate(() => {
      const { M, G, get, until } = __neg;
      const ray = () => M.ext.light().beams.find((b) => b.src === 'lastRay').on;
      M.teleport(176.5, 0, 1); M.sim(0.2, { x: 0 });
      const started = get('clock').running;
      get('F3').setState({ ...get('F3').getState(), alpha: 60 }); M.teleport(193.5, 10.6, 1);
      const tLatch = until(() => get('L8').done, { x: 0 }, 5);
      const at = { ray: ray(), T: +get('T').T.toFixed(2) };
      M.sim(3, { x: 0 }); const mid = { ray: ray(), T: +get('T').T.toFixed(2) };
      M.sim(3.2, { x: 0 }); const set = { ray: ray(), T: +get('T').T.toFixed(2) };
      M.sim(45, { x: 0 });
      const later = { dead: G.player.dead, kind: G.player.deathKind, expired: get('clock').expired, ray: ray() };
      M.checkpoint(10); M.sim(0.2, { x: 0 });
      return { started, tLatch, at, mid, set, later, cp10: { ray: ray(), T: +get('T').T.toFixed(2) } };
    }); },
    check: (r) => (r.started && r.tLatch < 2 && r.at.ray && r.mid.T > r.at.T && !r.set.ray && r.set.T >= 12.3 && !r.later.dead && !r.later.expired && !r.later.ray && !r.cp10.ray ? true : `won clock ${JSON.stringify(r)}`),
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
    // §6.5: the brightest hit spot in view is the beam's priority pool light (a searchlight's own floor spot, already
    // lit by its rig spot, never takes it); off-screen spots never hold it
    name: "the beam's point light warms a spot in view", cp: 0,
    run: async ({ page }) => { await prep(page); return page.evaluate(async () => {
      const { M, G, get } = __neg;
      const out = [];
      const frames = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); };
      for (const [cp, x, y, setup] of [[0, 4, 0, null], [3, 53, 0, () => get('M2').setState({ ...get('M2').getState(), alpha: -45 })], [6, 117, 4, () => { get('M7').setState({ x: 119.9, y: 0, alpha: -30 }); get('F2').setState({ ...get('F2').getState(), alpha: 45 }); }],
        [8, 133, 0, null], [10, 236, 0, null], [11, 330, 0, null], [12, 475, 12, null]]) {
        M.checkpoint(cp); setup?.(); M.photo(x, y, 1, 0.5); await frames(4);
        const p = G.level.light.beams.pool, lk = G.camRig.look;
        // the spots a viewer can see: every drawn leg's end (not a searchlight's cone leg)
        const spots = [];
        for (const [src, R] of G.level.light.results) if (R.on) R.hits.forEach((h, i) => { if (h.kind !== 0 && !(i === 0 && src.hideFirst) && src.kind !== 'lamp') spots.push([+h.x.toFixed(2), +h.y.toFixed(2)]); });
        out.push({ cp, x, on: !!p?.enabled, px: p && +p.pos.x.toFixed(2), py: p && +p.pos.y.toFixed(2), look: +lk.x.toFixed(1), half: +G.viewHalfW.toFixed(1), near: spots.some(([sx, sy]) => Math.abs(sx - p.pos.x) < 0.5 && Math.abs(sy - p.pos.y) < 0.6) });
      }
      return out;
    }); },
    check: (r) => {
      const bad = r.filter((o) => o.on && (Math.abs(o.px - o.look) > o.half + 2 || !o.near));
      const lit = r.filter((o) => o.on).length;
      return bad.length || lit < 4 ? `pool light ${JSON.stringify(r)}` : true;
    },
  },
  {
    // the pieces Chapter IV builds on (FULL_GAME §5.2 IV-B, IV-D), built in the engine on the dawn plaza: a
    // photocell riding a lift that rises 1.2 m/s while the cell is dark and clamps (liftClamp) where a beam would
    // cross it, then rises on once the beam is gone; a hatch shut over a vertical ray until its lock latches, then
    // open (the ray passes, the solid is off), and shut again by restoring the snapshot taken before
    name: 'a photocell rides a lift; a hatch opens to its lock', cp: 12,
    run: async ({ page }) => { await prep(page); return page.evaluate(async () => {
      const { M, G } = __neg, sys = G.level.light;
      const Lm = await import('/src/game/light/index.js'), Pm = await import('/src/game/physics.js');
      const out = { sameModule: Lm.LightSystem === sys.constructor };
      const lift = new Pm.Body(445, 0, 2, 0.3, { kind: 'lift', solid: true, pushable: false });
      lift.kinematic = true; G.phys.addBody(lift);
      const OY = 0.8, pc = sys.add(new Lm.Photocell(G, { id: 'PCx', x: 0, y: 0, rides: { body: lift, ox: -0.05, oy: OY } }));
      const ray = sys.add(new Lm.SunRay({ id: 'liftRay', x: 452, y: 4.0, angle: 180 }));
      // IV-B's rule: where any beam crosses the cell's x, the lift stops with the cell's centre on it
      // (a leg that ends on the cell itself is followed on to the cell's x)
      const crossings = () => { const ys = []; for (const b of M.ext.light().beams) { if (!b.on) continue; for (let i = 0; i + 3 < b.pts.length; i += 2) { const [ax, ay, bx, by] = b.pts.slice(i, i + 4); if (ax !== bx && ((ax - pc.x) * (bx - pc.x) <= 0 || b.ends[i / 2] === 'target:PCx')) ys.push(ay + (pc.x - ax) * (by - ay) / (bx - ax)); } } return ys; };
      let atClamp = false;
      const run = (sec) => { let dark = null; for (let t = 0; t < sec; t += 1 / 120) {
        if (!(atClamp && pc.lit)) {
          const c = Lm.liftClamp(crossings(), OY, 0, 9, lift.y - 1e-6), up = Math.min(9, lift.y + 1.2 / 120);
          atClamp = c !== null && up >= c; lift.y = atClamp ? c : up;
        }
        M.sim(1 / 120, { x: 0 });
        if (dark === null && pc.y < 3.8 && pc.lit) dark = pc.y;
      } return dark; };
      out.litEarly = run(4);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.clamped = { liftY: +lift.y.toFixed(4), pcY: +pc.y.toFixed(4), lit: pc.lit, level: +pc.level.toFixed(2), value: pc.value, meshY: +pc.mesh.position.y.toFixed(3) };
      ray.on = false; run(0.6);
      out.after = { liftY: +lift.y.toFixed(3), lit: pc.lit, level: +pc.level.toFixed(2) };
      // the hatch
      const lk = sys.add(new Lm.SunLock(G, { id: 'LHx', x: 447.5, y: 6.5, degree: 2 }));
      const hatch = new Lm.Hatch(G, { id: 'HX', x0: 449, x1: 451, y0: 8.0, y1: 8.3, source: () => (lk.done ? 1 : 0) });
      G.entities.push(hatch);
      sys.add(new Lm.SunRay({ id: 'upRay', x: 450.4, y: 6, angle: 90 }));
      const toLock = sys.add(new Lm.SunRay({ id: 'lockRay', x: 452, y: 6.5, angle: 180 })); toLock.on = false;
      const up = () => { const b = M.ext.light().beams.find((q) => q.src === 'upRay'); return { end: b.ends[b.ends.length - 1], y: +b.pts[b.pts.length - 1].toFixed(2) }; };
      M.sim(0.1, { x: 0 });
      const snap = G.snapshot();
      out.shut = { ...up(), open: hatch.open, solid: hatch.solid.enabled, lock: lk.done };
      toLock.on = true; M.sim(2.0, { x: 0 });
      out.open = { ...up(), open: hatch.open, solid: hatch.solid.enabled, lock: lk.done };
      G.restore(snap); toLock.on = false; M.sim(0.1, { x: 0 });
      out.restored = { ...up(), open: hatch.open, solid: hatch.solid.enabled, lock: lk.done };
      return out;
    }); },
    check: (r) => {
      const c = r.clamped;
      if (!r.sameModule) return 'the lab and the test see different light modules';
      if (r.litEarly !== null) return `lit before the beam: ${JSON.stringify(r)}`;
      if (!near(c.liftY, 3.2, 0.011) || !near(c.pcY, 4.0, 0.011) || !c.lit || c.level < 0.99 || c.value !== 1 || !near(c.meshY, c.pcY, 0.01)) return `photocell clamp ${JSON.stringify(c)}`;
      if (r.after.lit || r.after.level > 0.01 || !(r.after.liftY > 3.6)) return `photocell after the beam: ${JSON.stringify(r.after)}`;
      if (r.shut.open !== 0 || !r.shut.solid || r.shut.lock || !r.shut.end.startsWith('solid') || !near(r.shut.y, 8.0, 0.02)) return `hatch shut ${JSON.stringify(r.shut)}`;
      if (r.open.open !== 1 || r.open.solid || !r.open.lock || !(r.open.y > 8.4)) return `hatch open ${JSON.stringify(r.open)}`;
      if (r.restored.open !== 0 || !r.restored.solid || r.restored.lock || !r.restored.end.startsWith('solid') || !near(r.restored.y, 8.0, 0.02)) return `hatch restored ${JSON.stringify(r.restored)}`;
      return true;
    },
  },
  {
    // IV-E's camera (light.md): the boy and the heliostat stay in the frame at the tower's foot, on its ladder and on
    // the roof, and at the capstan the fortress lamp comes into view with them; at 16:9 and on an upright screen
    name: 'IV-E frames the boy, the heliostat and the lamp', cp: 12, w: 640, h: 360,
    run: async ({ page }) => {
      await prep(page);
      const shot = (tag) => page.evaluate(async (tag) => {
        const { G } = __neg;
        await new Promise((r) => { let n = 50; const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        const p = G.player, c = G.camera, V = c.position.constructor; c.updateMatrixWorld();
        const pr = (x, y, z = 0) => { const v = new V(x, y, z).project(c); return [+v.x.toFixed(2), +v.y.toFixed(2)]; };
        const ins = (v) => Math.abs(v[0]) <= 0.97 && Math.abs(v[1]) <= 0.97;
        const P = { head: pr(p.x, p.y + 1.15), feet: pr(p.x, p.y + 0.05), H: pr(478, 14.5), lamp: pr(420, 9.3, -4) };
        return { tag, st: p.state, y: +p.y.toFixed(1), boy: ins(P.head) && ins(P.feet), H: ins(P.H), lamp: ins(P.lamp), P };
      }, tag);
      const out = [];
      await page.evaluate(() => { const { G, walkTo } = __neg; G.player.spawn(463, 0, 1); walkTo(466.8); });
      out.push(await shot('foot'));
      await page.evaluate(() => { const { G, walkTo, until } = __neg; walkTo(467.6); until(() => G.player.y > 5, { x: 0, y: 1 }, 12); });
      out.push(await shot('ladder'));
      await page.evaluate(() => { const { G, until } = __neg; until(() => G.player.state === 'ground' && G.player.y > 11.9, { x: 0.4, y: 1 }, 12); until(() => G.player.x > 470, { x: 1 }, 4); });
      out.push(await shot('roof'));
      await page.evaluate(() => { const { G, M, get, sim } = __neg; const c = get('capstan'); M.teleport(c.standX, c.y, -1); sim(0.3, { x: 0, grab: true }); });
      out.push(await shot('capstan'));
      await page.setViewportSize({ width: 390, height: 844 });
      out.push(await shot('capstan upright'));
      await page.evaluate(() => { const { G, until } = __neg; until(() => G.player.state !== 'capstan', { x: 0, grab: false }, 2); until(() => G.player.x < 471, { x: -1 }, 4); });
      out.push(await shot('roof upright'));
      return out;
    },
    check: (r) => {
      const bad = r.filter((s) => !s.boy || !s.H || (s.tag.startsWith('capstan') && (s.st !== 'capstan' || !s.lamp)));
      if (r.find((s) => s.tag === 'ladder')?.st !== 'climb') return `not on the ladder ${JSON.stringify(r.map((s) => [s.tag, s.st, s.y]))}`;
      return bad.length ? `out of frame ${JSON.stringify(bad)}` : true;
    },
  },
  {
    // the light census is the fixed rig's, here as in the souk (FULL_GAME §9.1)
    name: 'light census unchanged', cp: 0,
    run: async ({ page }) => page.evaluate(async () => { const lab = __medina.lights(); await __medina.loadChapter('souk', 0); const souk = __medina.lights(); await __medina.loadChapter('lab', 10); return { lab, souk, again: __medina.lights() }; }),
    check: (r) => (JSON.stringify(r.lab) === JSON.stringify(r.souk) && JSON.stringify(r.again) === JSON.stringify(r.lab) ? true : `census ${JSON.stringify(r)}`),
  },
];
