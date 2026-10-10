// Sunwork bot helpers (FULL_GAME §6.8), injected after tools/bots/lib.js. Each helper appends bot steps that
// end on entity state, never on time:
//   approach(id, side)  stand beside a mirror's stand (side -1: on its left, facing it)
//   pushMirrorTo(id, x, tol)  grip and push or pull it until in place (or against its kerb)
//   tiltTo(id, deg)     hold {grab, y: ±1} until the target notch matches, then wait for `settled`
//   crankTo(id, deg)    the same through a crank (the boy must be in the crank state)
//   aimAt(id, x, y)     grip held, aimTarget at (x, y) until the mirror settles on a notch
//   capstanTo(id, deg)  turn the capstan toward deg and let the magnet take it
//   waitLit(id), waitDone(id), waitBurnt(id), waitDazzled(lamp), waitFixated(lamp)
window.__lightlib = (() => {
  const M = window.__medina;
  const sys = () => M.game.level.light;
  const get = (id) => sys().get(id);
  const P = () => M.game.player;
  const lamp = (id) => M.game.level.entities.find((e) => e.id === id);

  function install(B) {
    const { add } = B;
    const standX = (id, side) => { const m = get(id); return m.body.x + side * (0.35 + 0.17 + 0.03); };
    const approach = (name, id, side = -1) => add(name, (s) => {
      const d = standX(id, side) - s.x;
      // the last centimetres at a creep, then face the stand
      if (Math.abs(d) < 0.02) return { x: P().facing === -side ? 0 : -side * 0.2 };
      return { x: Math.sign(d) * (Math.abs(d) < 0.5 ? 0.25 : 1) };
    }, (s) => Math.abs(s.x - standX(id, side)) < 0.03 && Math.abs(P().body.vx) < 0.05 && P().facing === -side && s.st === 'ground', 25);
    const grip = (name, id, side = -1) => add(name, () => ({ x: 0, grab: true }), () => P().grip?.mirror === get(id), 1.5);
    const release = (name) => add(name, () => ({ x: 0 }), () => !P().grip && P().state === 'ground', 1.5);
    const pushMirrorTo = (name, id, x, tol = 0.02) => {
      const st = { dir: 0, still: 0, last: null };
      const body = () => { const e = get(id); return e?.body || M.game.level.entities.find((q) => q.id === id)?.body; };
      const dir = () => { if (!st.dir) st.dir = Math.sign(x - body().x) || 1; return st.dir; };
      const spot = () => body().x - dir() * (body().w / 2 + 0.17 + 0.03);
      add(name + ':walk', (s) => { const d = spot() - s.x; if (Math.abs(d) < 0.02) return { x: P().facing === dir() ? 0 : dir() * 0.2 }; return { x: Math.sign(d) * (Math.abs(d) < 0.5 ? 0.25 : 1) }; },
        (s) => Math.abs(s.x - spot()) < 0.03 && Math.abs(P().body.vx) < 0.05 && P().facing === dir() && s.st === 'ground', 25);
      add(name + ':grip', () => ({ x: 0, grab: true }), () => P().grip === body(), 1.5);
      add(name + ':push', () => {
        const b = body(), d = x - b.x;
        if (st.last !== null && Math.abs(b.x - st.last) < 1e-4) st.still += 1 / 120; else st.still = 0;
        st.last = b.x;
        return { x: Math.abs(d) < tol ? 0 : Math.sign(d) * (Math.abs(d) < 0.15 ? 0.3 : 1), grab: true };
      }, () => Math.abs(body().x - x) < tol || st.still > 0.35, 40);
      add(name + ':stop', () => ({ x: 0, grab: true }), () => Math.abs(P().body.vx) < 0.02, 2);
    };
    // vertical input on a gripped mirror: up raises the far rim (+α facing right)
    const tiltTo = (name, id, deg) => {
      add(name, () => { const m = get(id); const d = deg - m.target; return { x: 0, grab: true, y: d === 0 ? 0 : Math.sign(d) * P().facing }; }, () => get(id).target === deg, 12);
      add(name + ':settle', () => ({ x: 0, grab: true, y: 0 }), () => get(id).settled, 2);
    };
    const crankTo = (name, id, deg) => {
      add(name, () => { const m = get(id); const d = deg - m.target; return { x: 0, grab: true, y: d === 0 ? 0 : Math.sign(d) }; }, () => get(id).target === deg, 15);
      add(name + ':settle', () => ({ x: 0, grab: true, y: 0 }), () => get(id).settled, 3);
    };
    const aimAt = (name, id, ax, ay) => add(name, () => ({ x: 0, grab: true, aimTarget: { x: ax, y: ay } }), () => get(id).settled && get(id)._aim, 6);
    const capstanTo = (name, id, deg, window = 1.5) => {
      add(name, () => { const m = get(id); return { x: Math.abs(m.alpha - deg) < window ? 0 : -Math.sign(m.alpha - deg), grab: true }; }, () => Math.abs(get(id).alpha - deg) < window, 30);
      add(name + ':magnet', () => ({ x: 0, grab: true }), () => Math.abs(get(id).alpha - deg) < 0.02, 3);
    };
    const waitLit = (name, id, max = 8) => add(name, () => ({ x: 0 }), () => get(id).lit, max);
    const waitDone = (name, id, max = 8, input = { x: 0 }) => add(name, () => input, () => get(id).done, max);
    const waitBurnt = (name, id, max = 8) => add(name, () => ({ x: 0 }), () => get(id).burnt, max);
    const waitDazzled = (name, id, max = 20, input = { x: 0 }) => add(name, typeof input === 'function' ? input : () => input, () => lamp(id).dazzled > 0, max);
    const waitFixated = (name, id, max = 10) => add(name, () => ({ x: 0 }), () => !!lamp(id).fix, max);
    Object.assign(B, { light: { sys, get, lamp, standX, approach, grip, release, pushMirrorTo, tiltTo, crankTo, aimAt, capstanTo, waitLit, waitDone, waitBurnt, waitDazzled, waitFixated } });
    return B;
  }
  return { install };
})();
