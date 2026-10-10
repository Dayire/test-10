// In-page bot library (classic script, injected after __ready).
// A bot is a list of steps { name, input(s, G), until(s, G), max }: each step
// feeds input to __medina.sim one fixed step at a time until its condition
// holds. Steps read the live level through G.level inside their closures, so
// a chapter reload never leaves a bot holding stale entities. Steps should end
// on entity state, not on time.
window.__botlib = (() => {
  const M = window.__medina;
  const DT = 1 / 120;

  function create() {
    const G = M.game;
    const steps = [];
    const ticks = [];
    const R = (o) => ({ x: 1, ...o });
    const add = (name, input, until, max = 30) => steps.push({ name, input, until, max });
    const run = (name, x, extra = {}) => add(name, () => R(extra), (s) => s.x >= x, 30);
    const runLeft = (name, x, extra = {}) => add(name, () => ({ x: -1, ...extra }), (s) => s.x <= x, 30);
    const jumpAt = (name, x) => { run(name + ':approach', x); add(name + ':jump', () => R({ jump: true }), (s) => s.st !== 'ground', 1); };
    const hangClimb = (name) => {
      add(name + ':toHang', () => R({}), (s) => s.st === 'hang' || s.st === 'climbUp', 2);
      add(name + ':climb', () => R({ y: 1 }), (s) => s.st === 'ground', 2);
    };
    const mantle = hangClimb;
    const wait = (name, cond, input = { x: 0 }, max = 30) => add(name, () => input, cond, max);
    const crawlTo = (name, x, dir = 1) => add(name, () => ({ x: dir, y: -1 }), (s) => (dir > 0 ? s.x >= x : s.x <= x), 30);
    const tick = (fn) => ticks.push(fn);
    return { M, G, steps, ticks, R, add, run, runLeft, jumpAt, hangClimb, mantle, wait, crawlTo, tick, level: () => G.level };
  }

  // run steps [from .. to]; returns { ok, step, log, time, s }
  function runAll(B, { from = 0, to = null } = {}) {
    const { steps, ticks, G } = B;
    const log = [];
    const t0 = G.time;
    const start = typeof from === 'string' ? steps.findIndex((s) => s.name === from) : from;
    if (start < 0) return { ok: false, step: from, log: [`unknown step ${from}`], s: M.state() };
    for (let i = start; i < steps.length; i++) {
      const st = steps[i];
      let s = M.state(); let t = 0;
      while (!st.until(s, G) && t < st.max) {
        M.sim(DT, st.input(s, G));
        s = M.state(); t += DT;
        for (const f of ticks) f(s, G);
        if (s.dead) { log.push(`DEATH in ${st.name} at x=${s.x} (${G.player.deathKind})`); return { ok: false, step: st.name, log, s, time: +(G.time - t0).toFixed(2) }; }
      }
      if (t >= st.max) { log.push(`TIMEOUT ${st.name} at x=${s.x} y=${s.y} st=${s.st}`); return { ok: false, step: st.name, log, s, time: +(G.time - t0).toFixed(2) }; }
      log.push(`${st.name} ok t=${t.toFixed(2)} x=${s.x} y=${s.y}`);
      if (to && st.name === to) break;
    }
    return { ok: true, log, time: +(G.time - t0).toFixed(2), s: M.state() };
  }

  return { create, runAll, stepIndex: (B, n) => B.steps.findIndex((s) => s.name === n) };
})();
window.__bots = window.__bots || {};
