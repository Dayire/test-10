// Touch and mobile acceptance (FULL_GAME §8, §11.4 U): node tools/mobile-tests.mjs [--port 5176] [--only name] [--device name]
// Devices: iPhone 13 portrait and landscape (safe areas of the notch and the home bar), Pixel 7 (a punch-hole
// inset). Touches are real CDP touch events (Input.dispatchTouchEvent), so pointer and touch events, multi-touch
// identifiers and the browser's own hit testing are all exercised. Checks per device:
//   menus      the touch layer is hidden under the menus; every menu target is ≥ 44 px and inside the safe area;
//              a tap acts (new journey starts play)
//   controls   jump, grab and ⏸ are ≥ 44 px and inside the safe area; ⏸ opens the pause menu (layer hidden)
//   stick      floating stick: 0.5 of its radius walks, 1.0 runs (the boy's speed); it spawns under the thumb
//   jump       a tap on jump leaves the ground
//   grab       grab held with the stick pushes the souk's first crate (two fingers at once)
//   lens       the lens shift keeps the boy's projected position inside the play rect above the control band
//   aim        finger aim: a touch on the scene reaches the boy as pin.aimTarget at the touched world point; with the
//              Sunwork lab present (a gripped mirror) the mirror tilts to the touched notch
import { devices } from 'playwright';
import { parseArgs, launch } from './lib/harness.mjs';

const o = parseArgs(process.argv.slice(2), { port: 5176 });
const BASE = process.env.BASE || `http://127.0.0.1:${o.port}/`;
const Q = 'tex=0.1&tier=low&noauto=1&nosave=1';
const DEVICES = [
  { name: 'iPhone 13 portrait', d: devices['iPhone 13'], viewport: { width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone 13 landscape', d: devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, insets: { top: 0, bottom: 21, left: 47, right: 47 } },
  { name: 'Pixel 7', d: devices['Pixel 7'], viewport: { width: 412, height: 915 }, insets: { top: 26, bottom: 0, left: 0, right: 0 } },
].filter((x) => !o.device || x.name.toLowerCase().includes(String(o.device).toLowerCase()));
const only = o.only ? String(o.only).split(',') : null;
const browser = await launch();
const results = [];

const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { const f0 = window.__frames || 0, t0 = performance.now(); const t = () => ((window.__frames || 0) >= f0 + n || performance.now() - t0 > 20000 ? r() : requestAnimationFrame(t)); t(); }), n);
const ready = (page) => page.waitForFunction(() => window.__ready === true && window.__medina && window.__medina.game.mode !== 'loading', null, { timeout: 300000, polling: 100 });

async function device(dev) {
  const ctx = await browser.newContext({ ...dev.d, viewport: dev.viewport, screen: dev.viewport, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: dev.insets });
  // touches: each call lists every finger still down (CDP semantics); end lifts them all
  const fingers = new Map();
  const touch = async (type, id, x, y) => {
    if (type === 'end') fingers.clear(); else fingers.set(id, { x, y, id, radiusX: 8, radiusY: 8, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd', touchPoints: type === 'end' ? [] : [...fingers.values()] });
  };
  const tap = async (x, y) => { await touch('start', 1, x, y); await frames(page, 1); await touch('end'); await frames(page, 2); };
  const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const W = dev.viewport.width, H = dev.viewport.height, I = dev.insets;
  const safe = { x0: I.left, y0: I.top, x1: W - I.right, y1: H - I.bottom };
  // visible interactive targets of the open screen (and the touch layer): size and safe-area containment
  const targets = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && !e.hidden && getComputedStyle(e).visibility !== 'hidden').map((e) => {
    const b = e.getBoundingClientRect(); const s = e.closest('.rows'); const sb = s?.getBoundingClientRect();
    return { k: e.dataset.k || e.dataset.id || e.className.split(' ')[0] || e.tagName, x: b.x, y: b.y, w: b.width, h: b.height, clipped: sb ? (b.bottom > sb.bottom + 1 || b.top < sb.top - 1) : false };
  }), sel);
  const judge = (list) => {
    const bad = [];
    for (const t of list) {
      if (t.clipped) continue; // scrolled out of its list (it scrolls into view when focused)
      if (t.w < 44 || t.h < 44) bad.push(`${t.k} ${Math.round(t.w)}x${Math.round(t.h)}`);
      if (t.x < safe.x0 - 0.5 || t.y < safe.y0 - 0.5 || t.x + t.w > safe.x1 + 0.5 || t.y + t.h > safe.y1 + 0.5) bad.push(`${t.k} outside safe area @${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.w)}x${Math.round(t.h)}`);
    }
    return bad;
  };
  const check = (name, ok, evidence) => {
    if (only && !only.some((s) => name.includes(s))) return;
    results.push({ name: `${dev.name}: ${name}`, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${`${dev.name}: ${name}`.padEnd(34)} ${JSON.stringify(evidence)?.slice(0, 420)}`);
  };
  const want = (n) => !only || only.some((s) => n.includes(s));

  // ------------------------------------------------------------------ menus over the title, then play by a tap
  if (want('menus') || want('controls')) {
    await page.goto(`${BASE}?${Q}`); await ready(page); await frames(page, 4);
    const hidden = await page.evaluate(() => { const t = document.getElementById('touch'); return { exists: !!t, hide: t?.classList.contains('hide'), vis: t && getComputedStyle(t).visibility }; });
    const menuBad = judge(await targets('#main .entry'));
    await page.evaluate(() => __ui.settings.open()); await frames(page, 3); await page.waitForTimeout(600);
    const setBad = [];
    for (let t = 0; t < 5; t++) { await page.evaluate((t) => __ui.settings.setTab(t), t); await frames(page, 2); setBad.push(...judge(await targets('#settings .tab, #settings .rows .item'))); }
    await page.evaluate(() => __ui.focus.close(__ui.settings.screen));
    await page.evaluate(() => __ui.focus.open(__ui.chapters.screen)); await frames(page, 3); await page.waitForTimeout(600);
    const chBad = judge(await targets('#chapters .ccard'));
    await page.evaluate(() => __ui.focus.close(__ui.chapters.screen));
    await page.evaluate(() => __ui.confirm({ text: 'begin a new journey?', yes: () => {} })); await frames(page, 2); await page.waitForTimeout(500);
    const cfBad = judge(await targets('#confirm .item'));
    await page.evaluate(() => __ui.focus.close(__ui.confirmS)); await frames(page, 2); await page.waitForTimeout(500);
    // a tap on "new journey" acts
    const nj = await page.evaluate(() => { const b = document.querySelector('#main .entry[data-k="new"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await tap(...centre(nj));
    await page.waitForFunction(() => __medina.game.mode === 'play', null, { timeout: 60000 });
    await frames(page, 4); await page.waitForTimeout(400);
    const shown = await page.evaluate(() => { const t = document.getElementById('touch'); return { hide: t.classList.contains('hide'), vis: getComputedStyle(t).visibility, device: __ui.input.lastDevice }; });
    check('menus', hidden.exists && hidden.hide && hidden.vis === 'hidden' && !menuBad.length && !setBad.length && !chBad.length && !cfBad.length && !shown.hide && shown.vis === 'visible' && shown.device === 'touch',
      { hiddenInMenu: hidden, menuBad, setBad: setBad.slice(0, 4), chBad, cfBad, inPlay: shown });
    // the controls, then ⏸
    const ctl = await page.evaluate(() => { const r = __ui.touch.rects(); return { jump: r.jump, grab: r.grab, pause: r.pause }; });
    const ctlBad = judge(Object.entries(ctl).map(([k, r]) => ({ k, ...r })));
    await tap(...centre(ctl.pause));
    await page.waitForFunction(() => __medina.game.paused && __ui.focus.top?.el.id === 'pause', null, { timeout: 30000 }).catch(() => {});
    await frames(page, 2); await page.waitForTimeout(500);
    const paused = await page.evaluate(() => ({ paused: __medina.game.paused, top: __ui.focus.top?.el.id, hide: document.getElementById('touch').classList.contains('hide') }));
    const pauseBad = judge(await targets('#pause .entry'));
    check('controls', !ctlBad.length && paused.paused && paused.top === 'pause' && paused.hide && !pauseBad.length, { sizes: Object.fromEntries(Object.entries(ctl).map(([k, r]) => [k, [Math.round(r.x), Math.round(r.y), Math.round(r.w)]])), ctlBad, paused, pauseBad });
  }

  // ------------------------------------------------------------------ gameplay (deterministic: the sim reads the live touch input)
  if (want('stick') || want('jump') || want('grab') || want('lens')) {
    await page.goto(`${BASE}?${Q}&autostart=1&hold=1&chapter=souk&cp=0`); await ready(page); await frames(page, 3);
    // the sim reads the live input: poll() each step, with the previous state kept for the sim's own press edges
    const run = (sec) => page.evaluate((sec) => { const G = __medina.game; let vmax = 0, ymax = 0; const n = Math.round(sec * 120); for (let i = 0; i < n; i++) { __medina.sim(1 / 120, () => { const prev = G.input.state; const s = G.input.poll(); G.input.state = prev; return s; }); vmax = Math.max(vmax, Math.abs(G.player.body.vx)); ymax = Math.max(ymax, G.player.y); } return { vx: +G.player.body.vx.toFixed(2), vmax: +vmax.toFixed(2), ymax: +ymax.toFixed(2), x: +G.player.x.toFixed(2), st: G.player.state, inX: +G.input.state.x.toFixed(2) }; }, sec);
    const R = await page.evaluate(() => __ui.touch.radius());
    // jump: a tap on the button, standing in the open street
    await page.evaluate(() => { __medina.teleport(3, 0, 1); }); await run(0.3);
    const jr = await page.evaluate(() => __ui.touch.rects().jump);
    const y0 = await page.evaluate(() => __medina.state().y);
    await touch('start', 2, ...centre(jr)); await frames(page, 1);
    const jumped = await run(0.25);
    await touch('end'); await frames(page, 1);
    await run(0.8);
    check('jump', jumped.ymax > y0 + 0.4, { y0, ymax: jumped.ymax, st: jumped.st });
    // stick: the thumb lands in the left zone, the base appears under it
    const sx = dev.viewport.width > dev.viewport.height ? 140 : 90, sy = H - I.bottom - 150;
    await page.evaluate(() => { __medina.teleport(4, 0, 1); });
    await touch('start', 1, sx, sy); await frames(page, 2);
    const base = await page.evaluate(() => { const b = __ui.touch.base.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
    await touch('move', 1, sx + 0.5 * R, sy); await frames(page, 1);
    const walk = await run(0.8);
    await touch('move', 1, sx + 1.0 * R, sy); await frames(page, 1);
    const runS = await run(0.8);
    await touch('end'); await frames(page, 1);
    const stop = await run(0.4);
    check('stick', Math.abs(base[0] - sx) < 3 && Math.abs(base[1] - sy) < 3 && walk.inX === 0.5 && walk.vx > 0.4 && walk.vx < 2.5 && runS.vmax > 3.9 && runS.inX === 1 && stop.inX === 0,
      { R, base: base.map(Math.round), walk, run: runS, released: stop.inX });
    // grab + push: the souk's first crate (36.7–37.7); stick right and grab held together
    await page.evaluate(() => { __medina.teleport(35.6, 0, 1); });
    await run(0.2);
    const cx0 = await page.evaluate(() => __medina.game.level.crateA.body.x);
    const gr = await page.evaluate(() => __ui.touch.rects().grab);
    await touch('start', 1, sx, sy); await touch('move', 1, sx + 0.6 * R, sy); await touch('start', 3, ...centre(gr)); await frames(page, 1);
    const pushing = await run(1.6);
    const grip = await page.evaluate(() => ({ grip: !!__medina.game.player.grip, st: __medina.game.player.animState?.().st, crate: +__medina.game.level.crateA.body.x.toFixed(2), ctx: __ui.touch.el.dataset.ctx, grab: __ui.input.touch.grab }));
    await touch('end'); await frames(page, 1);
    check('grab', grip.crate > cx0 + 0.3 && grip.grab, { cx0, ...grip, x: pushing.x });
    // lens shift: in play the boy's projection sits inside the play rect (portrait: above the control band)
    await page.waitForTimeout(1200); await frames(page, 6);
    const lens = await page.evaluate(() => {
      const G = __medina.game, p = G.player, v = { x: p.x, y: p.y + 0.6, z: 0 };
      const V = new (G.camera.position.constructor)(v.x, v.y, v.z).project(G.camera);
      const px = (V.x * 0.5 + 0.5) * innerWidth, py = (-V.y * 0.5 + 0.5) * innerHeight, r = __ui.playRect();
      return { px: Math.round(px), py: Math.round(py), rect: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])), view: !!G.camera.view?.enabled, safeRect: G.camRig.safeRect };
    });
    const inside = lens.px >= lens.rect.x && lens.px <= lens.rect.x + lens.rect.w && lens.py >= lens.rect.y && lens.py <= lens.rect.y + lens.rect.h;
    const centred = Math.abs(lens.py - (lens.rect.y + lens.rect.h / 2)) < lens.rect.h * 0.3;
    check('lens', inside && centred && lens.view, lens);
  }

  // ------------------------------------------------------------------ finger aim
  if (want('aim')) {
    await page.goto(`${BASE}?${Q}&autostart=1&hold=1&chapter=lab&cp=0`); await ready(page); await frames(page, 3);
    const lab = await page.evaluate(() => ({ light: typeof __medina.ext.light === 'function', mirrors: __medina.ext.light?.().mirrors?.length || 0 }));
    let res;
    if (!lab.mirrors) {
      // the stub lab: a touch on the scene must reach the boy as the world point under the finger
      // a point right of the controls' zone, a third of the way down: its world point on the play plane
      const pt = await page.evaluate(() => {
        const G = __medina.game, C = G.camera, V3 = C.position.constructor, sx = innerWidth * 0.62, sy = innerHeight * 0.34;
        const d = new V3((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(C).sub(C.position).normalize();
        const t = -C.position.z / d.z;
        return { want: [+(C.position.x + d.x * t).toFixed(3), +(C.position.y + d.y * t).toFixed(3)], sx, sy, hit: document.elementFromPoint(sx, sy)?.tagName };
      });
      await touch('start', 4, pt.sx, pt.sy); await frames(page, 2);
      // the world point under the finger with the camera of this moment, and the boy's pin from the live input
      const got = await page.evaluate(({ sx, sy }) => {
        const G = __medina.game, C = G.camera, V3 = C.position.constructor;
        const d = new V3((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(C).sub(C.position).normalize();
        const t = -C.position.z / d.z, want = [C.position.x + d.x * t, C.position.y + d.y * t];
        const prev = G.input.state, st = G.input.poll(); G.input.state = prev;
        const pin = G.makePin(st, true);
        return { want: want.map((v) => +v.toFixed(3)), aim: pin.aimTarget && [+pin.aimTarget.x.toFixed(3), +pin.aimTarget.y.toFixed(3)], kind: st.pointer?.kind, active: st.pointer?.active };
      }, pt);
      await touch('end'); await frames(page, 2);
      const err = got.aim ? Math.hypot(got.aim[0] - got.want[0], got.aim[1] - got.want[1]) : 99;
      res = [got.active && got.kind === 'touch' && err < 0.05 && pt.hit === 'CANVAS', { stub: true, hit: pt.hit, ...got, err: +err.toFixed(4), note: 'lab stub: no mirror on this branch; aimTarget checked' }];
    } else {
      // the Sunwork lab: grip M2 (room "tilt", checkpoint 3), touch the lock L4: the mirror settles on −45°
      await page.evaluate(() => { __medina.checkpoint(3); __medina.teleport(54.3, 0, 1); });
      const step = (n) => page.evaluate((n) => { const G = __medina.game; for (let i = 0; i < n; i++) __medina.sim(1 / 120, () => { const prev = G.input.state; const s = G.input.poll(); G.input.state = prev; return s; }); }, n);
      await step(60);
      const gr = await page.evaluate(() => __ui.touch.rects().grab);
      await touch('start', 3, ...centre(gr)); await frames(page, 1); await step(6); await touch('end'); await frames(page, 1); await step(30);
      const pt = await page.evaluate(() => { const G = __medina.game; const V = new (G.camera.position.constructor)(56.23, 5.8, 0).project(G.camera); return { sx: (V.x * 0.5 + 0.5) * innerWidth, sy: (-V.y * 0.5 + 0.5) * innerHeight }; });
      await touch('start', 4, pt.sx, pt.sy); await frames(page, 2);
      await step(120);
      const got = await page.evaluate(() => { const G = __medina.game; const m = __medina.ext.light().mirrors.find((q) => q.id === 'M2'); return { alpha: m.alpha, notch: m.notch, settled: m.settled, grip: !!G.player.grip, aim: G.player.aimAt, aiming: __ui.touch.aiming, hit: null }; });
      await touch('end'); await frames(page, 2);
      res = [got.grip && Math.round(got.alpha) === -45, { lab: true, ...got }];
    }
    check('aim', res[0], res[1]);
  }
  if (errors.length) check('no page errors', false, errors.slice(0, 4));
  await ctx.close();
}

for (const dev of DEVICES) await device(dev);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
