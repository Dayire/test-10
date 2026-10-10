// Shared Playwright harness for bots, negatives and tools: one headless
// Chromium on SwiftShader, the low-cost test URL and small page helpers.
// Flags: --chapter --cp --from --to --port --tier --tex --hold (default on) --w --h
// (BASE overrides the whole origin, e.g. BASE=http://127.0.0.1:5174/).
import { chromium } from 'playwright';
import fs from 'fs';

export const ROOT = new URL('../../', import.meta.url);

export function parseArgs(argv = process.argv.slice(2), defaults = {}) {
  const o = { chapter: 'souk', cp: undefined, from: '', to: '', port: 5173, tier: 'low', tex: 0.1, hold: true, w: 480, h: 270, _: [], ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const [k, v] = a.slice(2).split('=');
    const next = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = next;
  }
  o.port = +o.port; o.w = +o.w; o.h = +o.h;
  o.hold = !['0', 'false', 'off', 'no'].includes(String(o.hold));
  if (o.cp !== undefined) o.cp = +o.cp;
  return o;
}

export function baseUrl(o) { return process.env.BASE || `http://127.0.0.1:${o.port}/`; }

// the test URL: autostart, tiny textures, low tier, fixed quality, no saves, sim only advanced by the bot
export function gameUrl(o, extra = {}) {
  const q = new URLSearchParams({ autostart: '1', tex: String(o.tex), tier: o.tier, noauto: '1', nosave: '1' });
  if (o.chapter) q.set('chapter', o.chapter);
  if (o.cp !== undefined) q.set('cp', String(o.cp));
  if (o.hold) q.set('hold', '1');
  for (const [k, v] of Object.entries(extra)) { if (v === null || v === undefined || v === false) q.delete(k); else q.set(k, String(v)); }
  return baseUrl(o) + '?' + q.toString();
}

export async function launch() {
  return chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
}

// open a page (own context), collect page errors and console errors, optionally go to a URL and wait for __ready
export async function openPage(browser, { url = null, w = 480, h = 270, init = null, timeout = 300000, quiet = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const errors = [], consoleErrors = [];
  page.on('pageerror', (e) => { errors.push(e.message); if (!quiet) console.log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|favicon|Failed to load resource/.test(m.text())) consoleErrors.push(m.text()); });
  if (init) await page.addInitScript(init);
  const h2 = { page, ctx, errors, consoleErrors, async goto(u) { await page.goto(u); await waitReady(page, timeout); }, close: () => ctx.close() };
  if (url) await h2.goto(url);
  return h2;
}

export async function waitReady(page, timeout = 300000) {
  await page.waitForFunction(() => window.__ready === true && window.__medina && window.__medina.game.mode !== 'loading', null, { timeout, polling: 100 });
}

// wait until the game reaches a mode (loader chains are asynchronous)
export async function waitMode(page, mode, timeout = 120000) {
  await page.waitForFunction((m) => window.__medina && window.__medina.game.mode === m, mode, { timeout, polling: 100 });
}

export async function inject(page, rel) {
  await page.addScriptTag({ content: fs.readFileSync(new URL(rel, ROOT), 'utf8') });
}

// short stable hash of a JSON value (end states)
export function hash(v) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function exists(rel) { return fs.existsSync(new URL(rel, ROOT)); }
