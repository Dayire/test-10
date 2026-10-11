// The menus' layout audit at every menu text size (FULL_GAME §7.4: menu text 100 / 125 / 150 %). On the open screen:
// nothing runs out of the safe area unless it sits in a list that scrolls (and that list stays inside it), no
// settings value is clipped by its list, no two blocks (brand, chapter, controls, entries, legend, cards) meet, and
// one focus mark. Used by mobile-tests (phones) and ux-tests (desktop).

// runs in the page: the problems of the screen on top
export function audit() {
  const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const vis = (e) => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && +getComputedStyle(e).opacity > 0.05;
  const hit = (a, b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
  const name = (e) => `${e.className.split(' ')[0] || e.tagName}:${(e.dataset.k || e.dataset.id || e.textContent.trim()).replace(/\s+/g, ' ').slice(0, 18)}`;
  const out = [];
  const W = innerWidth, H = innerHeight, I = window.__ui.safeInsets();
  const safe = { l: I.l - 0.5, t: I.t - 0.5, r: W - I.r + 0.5, b: H - I.b + 0.5 };
  const top = window.__ui.focus.top?.el;
  if (!top) return ['no screen'];
  const scroller = (e) => { for (let p = e.parentElement; p && p !== top; p = p.parentElement) { const s = getComputedStyle(p); if (/auto|scroll/.test(s.overflowY + s.overflowX)) return p; } return null; };
  const outside = (b) => b.l < safe.l || b.t < safe.t || b.r > safe.r || b.b > safe.b;
  for (const e of top.querySelectorAll('.entry, .row, .tab, .ccard, .back, .legend span, .ctl span, .where, .brand > *, #confirm .item, .q, .skip')) {
    if (!vis(e)) continue;
    const b = R(e), sc = scroller(e);
    if (sc) {
      const s = R(sc);
      if (outside(s)) out.push(`list out of the safe area ${name(sc)} ${Math.round(s.l)},${Math.round(s.t)}-${Math.round(s.r)},${Math.round(s.b)}`);
      continue; // scrolled into view when focused
    }
    if (outside(b)) out.push(`off screen ${name(e)} ${Math.round(b.l)},${Math.round(b.t)}-${Math.round(b.r)},${Math.round(b.b)}`);
  }
  // settings rows: a value clipped by the list, a value's text overflowing, a label meeting its value
  const rows = top.querySelector('.rows');
  if (rows) {
    const rb = R(rows);
    for (const row of rows.querySelectorAll('.row')) {
      const rc = row.querySelector('.rc'), rl = row.querySelector('.rl'), a = R(rc);
      if (a.b < rb.t || a.t > rb.b) continue;
      if (a.r > rb.r + 0.5) out.push(`clipped value ${row.dataset.k} right ${Math.round(a.r)} > list ${Math.round(rb.r)}`);
      for (const v of rc.querySelectorAll('b, .val, em')) if (v.scrollWidth > v.clientWidth + 1) out.push(`overflowing text ${row.dataset.k}`);
      if (hit(R(rl), a)) out.push(`label meets value ${row.dataset.k}`);
    }
  }
  // blocks that meet (their visible pieces, not just their boxes)
  const blocks = [...top.querySelectorAll('.brand, .where, .ctl, .entries, .legend, header, .cards, .store:not(.hidden)')].filter((e) => vis(e) && e.childElementCount).map((e) => ({ k: e.className.split(' ')[0] || e.tagName, b: R(e), e }));
  const kids = (x) => { const k = [...x.e.querySelectorAll('.entry .lbl, .entry .sub, .ccard, span, h1, .tagline, .rule, .pg, i, em, kbd')].filter(vis).map(R).filter((r) => r.w > 2 && r.h > 2); return k.length ? k : [x.b]; };
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    const A = blocks[i], B = blocks[j];
    if (A.e.contains(B.e) || B.e.contains(A.e) || !A.b.w || !B.b.w || !hit(A.b, B.b)) continue;
    const ka = kids(A), kb = kids(B);
    if (ka.some((x) => kb.some((y) => hit(x, y)))) out.push(`overlap ${A.k} x ${B.k}`);
  }
  const f = top.querySelectorAll('.focused');
  if (f.length > 1) out.push(`focus marks ${f.length}`);
  return out;
}

// every menu screen at every text size: the title (a journey under way, so continue shows its chapter), the five
// settings tabs (each row brought into view), the chapter select, a confirm, and the pause in play. The page is a
// held title (no autostart). Returns { '<size> <screen>': [problems] } for the screens with problems.
export async function auditTextSizes(page, { sizes = [100, 125, 150], touch = false, settle = 1500 } = {}) {
  // the reveals are done (a software renderer may hold a frame for seconds: the transitions start late)
  const wait = async (ms) => {
    await page.waitForTimeout(ms);
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming?.().iterations === Infinity), null, { timeout: 20000, polling: 100 }).catch(() => {});
  };
  const run = () => page.evaluate(audit);
  const res = {};
  const note = (k, list) => { if (list.length) res[k] = [...new Set([...(res[k] || []), ...list])]; };
  await page.evaluate(() => document.fonts?.ready);
  await page.evaluate(() => {
    const d = __ui.save.data;
    Object.assign(d, { chapter: 'dawn', cp: 2, unlocked: ['souk', 'sundown', 'night', 'dawn'], cps: { souk: 6, sundown: 10, night: 7, dawn: 2 } });
    __ui.save.exists = true; __ui.fillMain(); __ui.chapters.refresh?.();
  });
  for (const ms of sizes) {
    await page.evaluate((ms) => { __ui.focus.closeAll({ instant: true }); __ui.setSetting('menuScale', ms); __ui.openMain(); }, ms);
    await wait(settle);
    note(`${ms} title`, await run());
    await page.evaluate(() => __ui.settings.open());
    for (let t = 0; t < 5; t++) {
      await page.evaluate((t) => __ui.settings.setTab(t), t); await wait(t ? 700 : settle);
      note(`${ms} settings ${t}`, await run());
      const n = await page.evaluate(() => document.querySelectorAll('#settings .rows .row').length);
      for (let i = 1; i < n; i += 2) {
        await page.evaluate((i) => __ui.focus.set(document.querySelectorAll('#settings .rows .row')[i]), i); await wait(200);
        note(`${ms} settings ${t}`, await run());
      }
    }
    await page.evaluate(() => { __ui.focus.close(__ui.settings.screen); __ui.focus.open(__ui.chapters.screen); }); await wait(settle);
    note(`${ms} chapters`, await run());
    await page.evaluate(() => { __ui.focus.close(__ui.chapters.screen); __ui.confirm({ glyph: 'linkBroken', text: 'forget every chapter reached?', yes: () => {} }); }); await wait(900);
    note(`${ms} confirm`, await run());
    await page.evaluate(() => __ui.focus.closeAll({ instant: true }));
  }
  // the pause in play
  await page.evaluate(() => { __ui.setSetting('menuScale', 100); __ui.openMain(); });
  await page.evaluate(() => { __ui.focus.closeAll(); __medina.game.introInput(); });
  await page.waitForFunction(() => __medina.game.mode === 'play', null, { timeout: 60000 });
  if (touch) await page.evaluate(() => __ui.input.setDevice?.('touch'));
  await wait(800);
  for (const ms of sizes) {
    await page.evaluate((ms) => { __ui.setSetting('menuScale', ms); __ui.requestPause(); }, ms);
    await page.waitForFunction(() => __ui.focus.top?.el.id === 'pause', null, { timeout: 30000 });
    await wait(settle);
    note(`${ms} pause`, await run());
    await page.evaluate(() => __ui.resume()); await wait(600);
  }
  await page.evaluate(() => __ui.setSetting('menuScale', 100));
  return res;
}
