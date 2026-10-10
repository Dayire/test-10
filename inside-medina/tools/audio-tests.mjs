// Audio acceptance tests (FULL_GAME §11.4 P). Offline renders (OfflineAudioContext) for levels and
// coverage, a real-time context under a 4× CPU throttle for scheduler timing.
// Usage: node tools/audio-tests.mjs [--port 5173 | BASE=url] [--sec 20] [--only name,name]
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const BASE = process.env.BASE || `http://127.0.0.1:${arg('port', '5173')}/`;
const SEC = +arg('sec', 20);
const only = arg('only', '') ? arg('only').split(',') : null;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('404')) errors.push(m.text()); });
await page.goto(BASE + 'package.json');
await page.evaluate(async (base) => {
  const mod = await import(base + 'src/core/audio.js');
  window.AudioMod = mod;
  window.VoicesMod = await import(base + 'src/audio/voices.js');
  // deterministic randomness for comparable renders
  let seed = 99;
  window.seedRandom = (s) => { seed = s; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; };
  const SR = 48000;
  // render `sec` seconds: onTick(A, t) runs every dt on the audio clock (OfflineAudioContext.suspend)
  window.renderOffline = async ({ sec, setup, onTick, dt = 0.05, seed = 1 }) => {
    window.seedRandom(seed);
    const ctx = new OfflineAudioContext(2, Math.round(SR * sec), SR);
    const A = new mod.Audio(); A.start(ctx);
    if (setup) setup(A, ctx);
    let err = null;
    const step = (t) => ctx.suspend(t).then(() => {
      try { onTick && onTick(A, t); A.update(dt, A._mix || {}); } catch (e) { err = err || e.message; }
      if (t + dt < sec - 0.01) step(+(t + dt).toFixed(4));
      ctx.resume();
    });
    try { onTick && onTick(A, 0); A.update(dt, A._mix || {}); } catch (e) { err = e.message; }
    step(dt);
    const buf = await ctx.startRendering();
    return { buf, A, err };
  };
  window.measure = (buf, t0 = 0, t1 = Infinity) => {
    let peak = 0, sum = 0, n = 0, nan = 0;
    const a = Math.floor(t0 * buf.sampleRate), b = Math.min(buf.length, Math.floor(t1 * buf.sampleRate));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = a; i < b; i++) { const v = d[i]; if (!Number.isFinite(v)) { nan++; continue; } const av = Math.abs(v); if (av > peak) peak = av; sum += v * v; n++; }
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { nan, peakDb: +db(peak).toFixed(2), rmsDb: +db(Math.sqrt(sum / Math.max(1, n))).toFixed(2) };
  };
}, BASE);

const results = {};
const run = async (name, fn) => {
  if (only && !only.includes(name)) return;
  const t0 = Date.now();
  try { results[name] = await fn(); } catch (e) { results[name] = { ok: false, error: e.message }; }
  results[name].sec = +((Date.now() - t0) / 1000).toFixed(1);
  console.log(name.padEnd(14), JSON.stringify(results[name]));
};

// 1. twenty seconds of every theme with a plausible game mix: no NaN, peak ≤ −1 dBFS, RMS −30…−14 dBFS
await run('themes', async () => page.evaluate(async (sec) => {
  const plans = {
    menu: (t) => ({ music: { state: 'explore' } }),
    souk: (t) => ({ tension: t > 9 ? 1 : 0.2, chase: t > 9 && t < 17, birds: t < 9, height: 1, hum: t > 4 && t < 9 ? 0.6 : 0 }),
    sundown: (t) => ({ music: { state: t > 8 ? 'clock' : 'explore', intensity: Math.max(0, (t - 8) / 12) }, tension: 0.3, loops: { mirrorRoll: t > 3 && t < 6 ? 1 : 0, lockCharge: t > 5 && t < 7 ? { level: 0.8, degree: 2 } : 0 } }),
    night: (t) => ({ music: { state: t > 10 ? 'chase' : 'explore' }, tension: t > 10 ? 1 : 0.4, loops: { tripHum: 1 }, zone: t > 15 ? 'cistern' : 'alley' }),
    dawn: (t) => ({ music: { state: t > 12 ? 'finale' : 'explore' }, birds: Math.min(1, t / 10), drummer: t < 10 ? 1 : 0, height: 8 }),
    credits: (t) => ({ music: { state: 'credits' }, birds: 0.5 }),
  };
  const out = {};
  let ok = true;
  for (const [theme, plan] of Object.entries(plans)) {
    const { buf, err } = await window.renderOffline({
      sec, seed: theme.length * 7,
      setup: (A) => A.setChapter({ theme }),
      onTick: (A, t) => {
        A._mix = plan(t);
        A.setListener(t * 3);
        if (Math.round(t * 20) % 6 === 0) A.play('step', t * 3, { speed: 4 });
        if (Math.abs(t - 5) < 0.026) A.play('land', t * 3, { speed: 8, hard: true });
        if (theme === 'dawn' && Math.abs(t - 12) < 0.026) A.finale();
        if (theme === 'souk' && Math.abs(t - 17.5) < 0.026) A.finale();
      },
    });
    const m = window.measure(buf);
    const pass = !err && m.nan === 0 && m.peakDb <= -1 && m.rmsDb >= -30 && m.rmsDb <= -14;
    ok = ok && pass;
    out[theme] = { ...m, err, pass };
  }
  return { ok, ...out };
}, SEC));

// 2. scheduler onset jitter ≤ 5 ms under a 4× CPU throttle (real-time context, onsets detected by an AudioWorklet)
await run('jitter', async () => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = await page.evaluate(async () => {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    // an onset is the first sample above the threshold after 40 ms below it
    const code = `class Onsets extends AudioWorkletProcessor {
      constructor(){ super(); this.since = 1e9; }
      process(inputs){ const ch = inputs[0][0]; if (!ch) return true;
        for (let i = 0; i < ch.length; i++){
          if (Math.abs(ch[i]) > 0.05) { if (this.since > 0.04 * sampleRate) this.port.postMessage((currentFrame + i) / sampleRate); this.since = 0; }
          else this.since++; }
        return true; } }
      registerProcessor('onsets', Onsets);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const A = new window.AudioMod.Audio(); A.start(ctx);
    A.setVolumes({ amb: 0, sfx: 0 }); A.amb.pad.disconnect(); A.mix.sends.music.gain.value = 0;
    A.master.gain.cancelScheduledValues(0); A.master.gain.value = 0.9;
    const node = new AudioWorkletNode(ctx, 'onsets'); A.mix.out.connect(node);
    const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(ctx.destination); // keep the detector pulled
    const onsets = [];
    node.port.onmessage = (e) => onsets.push(e.data);
    A.music.trace = [];
    A.update(0.016, { music: { state: 'test' } });
    // keep the main thread as busy as a heavy game frame: ~8 ms of work per animation frame
    let busy = true;
    const work = () => { const e = performance.now() + 8; while (performance.now() < e) { /* frame work */ } if (busy) requestAnimationFrame(work); };
    requestAnimationFrame(work);
    const upd = setInterval(() => A.update(0.016, { music: { state: 'test' } }), 16);
    await new Promise((res) => setTimeout(res, 8000));
    busy = false; clearInterval(upd); A.music.stop();
    await new Promise((res) => setTimeout(res, 300));
    const tr = A.music.trace.slice(4, -4);
    // match each scheduled click to the nearest detected onset
    const errs = [];
    for (const [intended] of tr) {
      let best = Infinity;
      for (const o of onsets) { const d = o - intended; if (Math.abs(d) < Math.abs(best)) best = d; }
      if (Math.abs(best) < 0.06) errs.push(best * 1000);
    }
    const late = tr.map(([i, w]) => (w - i) * 1000);
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    const lat = ctx.baseLatency || 0;
    ctx.close();
    return {
      scheduled: tr.length, detected: errs.length, maxLateMs: +Math.max(0, ...late).toFixed(2), lateEvents: late.filter((v) => v > 0.5).length,
      chainLatencyMs: abs.length ? +abs[Math.floor(abs.length / 2)].toFixed(2) : null,
      onsetJitterMs: abs.length ? +(abs[abs.length - 1] - abs[0]).toFixed(2) : null, baseLatency: lat,
      debug: { onsets: onsets.length, firstOnsets: onsets.slice(0, 3), firstTrace: tr.slice(0, 3) },
    };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { ...r, ok: r.scheduled > 40 && r.detected >= r.scheduled * 0.9 && r.maxLateMs <= 5 && r.onsetJitterMs <= 5 };
});

// 3. mute survives fadeIn (and a full game mix) — output stays digital silence
await run('muteFadeIn', async () => page.evaluate(async () => {
  const { buf } = await window.renderOffline({
    sec: 4, setup: (A) => { A.setChapter({ theme: 'night' }); A.muted = true; A.fadeIn(1); },
    onTick: (A, t) => { A._mix = { music: { state: 'chase' }, tension: 1 }; if (Math.abs(t - 1) < 0.026) A.fadeIn(0.5); },
  });
  const m = window.measure(buf, 0.05);
  return { ...m, ok: m.rmsDb === -Infinity || m.rmsDb < -100 };
}));

// 4. a UI sound plays while paused; the game buses are ducked
await run('uiWhilePaused', async () => page.evaluate(async () => {
  const quietGame = (A) => { A.setVolumes({ music: 0, sfx: 0, amb: 0 }); };
  const ui = await window.renderOffline({ sec: 3, setup: (A) => { quietGame(A); A.setPaused(true); }, onTick: (A, t) => { if (Math.abs(t - 1) < 0.026) A.ui('confirm'); } });
  const none = await window.renderOffline({ sec: 3, setup: (A) => { quietGame(A); A.setPaused(true); } });
  const game = (p) => window.renderOffline({ sec: 4, seed: 5, setup: (A) => { A.setChapter({ theme: 'souk' }); A.setPaused(p); }, onTick: (A) => { A._mix = { birds: false, tension: 0.2 }; } });
  const playing = window.measure((await game(false)).buf, 2, 4), paused = window.measure((await game(true)).buf, 2, 4);
  const u = window.measure(ui.buf, 1, 1.5), n = window.measure(none.buf, 1, 1.5);
  return { uiRmsDb: u.rmsDb, silentRmsDb: n.rmsDb, gamePlayingDb: playing.rmsDb, gamePausedDb: paused.rmsDb, ok: u.rmsDb > -45 && u.rmsDb - n.rmsDb > 30 && playing.rmsDb - paused.rmsDb > 10 };
}));

// 5. 200 rapid steps leave ≤ 32 voices
await run('voiceCap', async () => page.evaluate(async () => {
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const A = new window.AudioMod.Audio(); A.start(ctx);
  let maxActive = 0;
  for (let i = 0; i < 200; i++) { A.play('step', i * 0.01, { speed: 4 }); maxActive = Math.max(maxActive, A.voices.active); }
  const s = A.stats;
  const buf = await ctx.startRendering();
  const m = window.measure(buf);
  return { maxActive, after: s.voices, pool: A.voices.pool.length, stolen: s.stolen, started: s.started, nan: m.nan, ok: maxActive <= 32 && s.voices <= 32 && m.nan === 0 };
}));

// 6. every sound name (sfx, loops, stingers, ui, finales) renders without error
await run('allNames', async () => page.evaluate(async () => {
  const { SFX_NAMES, STINGERS, UI_SOUNDS } = window.AudioMod;
  const list = [...SFX_NAMES.map((n) => ['play', n]), ...STINGERS.map((n) => ['stinger', n]), ...UI_SOUNDS.map((n) => ['ui', n])];
  const loops = ['mirrorRoll', 'capstan', 'lockCharge', 'ropeSmoulder', 'tripHum', 'lift', 'hum', 'scrape'];
  const dt = 0.25, sec = list.length * dt + loops.length * 0.5 + 4;
  const failed = [];
  const { buf, err } = await window.renderOffline({
    sec, dt: 0.05, setup: (A) => A.setChapter({ theme: 'sundown' }),
    onTick: (A, t) => {
      const i = Math.round(t / dt);
      if (Math.abs(t - i * dt) < 0.026 && i < list.length) {
        const [kind, name] = list[i];
        try { A[kind](name, A.listenerX + 2, { level: 1, degree: 3, value: 0.5, speed: 6, hard: true, count: 6, sec: 1 }); } catch (e) { failed.push(`${kind}:${name}: ${e.message}`); }
      }
      const j = Math.floor((t - list.length * dt) / 0.5);
      A._mix = { loops: j >= 0 && j < loops.length ? { [loops[j]]: { level: 1, degree: 2 } } : {}, tension: 0.3 };
      if (Math.abs(t - (sec - 3.5)) < 0.026) { A.finale(); }
    },
  });
  const m = window.measure(buf);
  return { names: list.length + loops.length + 1, failed, err, ...m, ok: !failed.length && !err && m.nan === 0 && m.peakDb <= -1 };
}));

// 8. the densest cues fit the pool: no steal or drop, and the same peak as with an unlimited pool; footsteps
// during the dawn finale are never dropped
await run('voiceBudget', async () => page.evaluate(async () => {
  // each cue over the music that plays under it in the game
  const cues = {
    catch: { theme: 'sundown', sec: 5, mix: { music: { state: 'clock', intensity: 1 } }, at: (A) => A.stinger('catch') },
    lockOpen: { theme: 'sundown', sec: 6, mix: { music: { state: 'explore' } }, at: (A) => A.play('lockOpen', A.listenerX, { degree: 2 }) },
    answeredLight: { theme: 'dawn', sec: 9, mix: { finale: true }, at: (A) => A.stinger('answeredLight') },
    dawnFinale: { theme: 'dawn', sec: 16, mix: { finale: true }, at: (A) => A.finale() },
    dawnFinaleSteps: { theme: 'dawn', sec: 16, mix: { finale: true }, at: (A) => A.finale(), steps: 0.3 },
  };
  const render = (c, pool) => window.renderOffline({
    sec: c.sec, seed: 3,
    setup: (A, ctx) => {
      if (pool) A.synth.voices = A.voices = new window.VoicesMod.Voices(ctx, pool);
      A.setChapter({ theme: c.theme }); A.master.gain.cancelScheduledValues(0); A.master.gain.value = 0.9;
      if (c.mix.finale) A.mix.music.gain.value = 1;
    },
    onTick: (A, t) => {
      A._mix = { ...c.mix, birds: 0 };
      if (Math.abs(t - 0.5) < 0.026) c.at(A);
      if (c.steps && t > 0.5 && Math.round(t * 20) % Math.round(c.steps * 20) === 0) { A.play('step', A.listenerX + 1, { speed: 4 }); A._steps = (A._steps || 0) + 2; }
    },
  });
  const out = {};
  let ok = true;
  for (const [name, c] of Object.entries(cues)) {
    const small = await render(c), big = await render(c, 512);
    const a = window.measure(small.buf), b = window.measure(big.buf), s = small.A.stats;
    const pass = !small.err && s.stolen === 0 && s.dropped === 0 && a.nan === 0 && Math.abs(a.peakDb - b.peakDb) <= 0.5;
    ok = ok && pass;
    out[name] = { stolen: s.stolen, dropped: s.dropped, started: s.started, steps: small.A._steps, peakDb: a.peakDb, peakDbUnlimited: b.peakDb, err: small.err, pass };
  }
  return { ok, ...out };
}));

// 9. a stolen voice fades out over ~10 ms (no step in the waveform) and the new note starts on time
await run('stealFade', async () => page.evaluate(async () => {
  const { buf, A } = await window.renderOffline({
    sec: 1.5, seed: 4,
    setup: (A) => {
      A.setVolumes({ amb: 0, music: 0 }); A.mix.sends.sfx.gain.value = 0;
      A.master.gain.cancelScheduledValues(0); A.master.gain.value = 0.9;
      const B = A.mix.sfx, V = A.voices, ctx = A.ctx;
      // the victim: a sustained sine (at a crest when the steal comes), lowest priority, nearest its end;
      // 31 silent reserved voices fill the rest of the pool
      const v = V.acquire(B, 0, 1.45, 0), o = ctx.createOscillator(); o.frequency.value = 220.25;
      v.env.gain.setValueAtTime(0.25, 0); V.feed(v, o, false); o.start(0); o.stop(1.45);
      for (let i = 0; i < 31; i++) V.acquire(B, 0, 1.47 + 0.002 * i, 0); // reserved, silent
    },
    onTick: (A, t) => {
      A._mix = { birds: 0 };
      if (Math.abs(t - 1.0) < 0.026) A._v = A.synth.tone(A.mix.sfx, { f: 3000, dur: 0.2, gain: 1e-6, prio: 1 });
    },
  });
  const d = buf.getChannelData(0), sr = buf.sampleRate;
  const maxStep = (t0, t1) => { let m = 0; for (let i = Math.floor(t0 * sr) + 1; i < Math.floor(t1 * sr); i++) m = Math.max(m, Math.abs(d[i] - d[i - 1])); return m; };
  const before = maxStep(0.9, 0.99), steal = maxStep(0.99, 1.04);
  const after = window.measure(buf, 1.06, 1.3), during = window.measure(buf, 0.9, 0.99);
  const s = A.stats;
  return { stolen: s.stolen, dropped: s.dropped, newVoice: !!A._v, maxStepBefore: +before.toFixed(5), maxStepAtSteal: +steal.toFixed(5), rmsBeforeDb: during.rmsDb, rmsAfterDb: after.rmsDb,
    ok: s.stolen === 1 && !!A._v && steal <= before * 1.5 && after.rmsDb < during.rmsDb - 40 };
}));

// 10. the chapter audio schema the foundation passes (FULL_GAME §11.2): maqam-named themes resolve to the
// chapter, zone amb names a bed or place, unknown music names fall back, null zones and frozen inputs are fine
await run('schema', async () => page.evaluate(async () => {
  const souk = { theme: 'hijaz', zones: [
    { x0: -100, x1: 70, verb: 'alley', amb: 'souk', music: 'souk', tension: 0.1 },
    { x0: 70, x1: 118, verb: 'courtyard', amb: 'courtyard', music: 'stealth', tension: 0.35, hum: 1 },
    { x0: 118, x1: 300, verb: 'alley', amb: 'souk', music: 'souk', tension: 0.1 }] };
  const stub = (theme) => ({ theme, zones: [{ x0: -100, x1: 100, verb: 'alley', amb: 'souk', music: 'none', tension: 0.1 }] });
  const cases = [['souk', souk, 'hijaz'], ['sundown', stub('bayati'), 'bayati'], ['night', stub('saba'), 'saba'], ['dawn', stub('rast'), 'rast'], ['lab', stub('hijaz'), 'hijaz']];
  const out = {};
  let ok = true;
  for (const [id, audio, maqam] of cases) {
    const seen = { verbs: new Set(), states: new Set() };
    const { buf, A, err } = await window.renderOffline({
      sec: 8, seed: id.length,
      setup: (A) => A.setChapter(audio, { id, audio }),
      onTick: (A, t) => {
        const x = t * 14; A.setListener(x);
        // the foundation's mix: generic fields, then the chapter's; zone null for the first half
        A._mix = Object.freeze({ crateSpeed: 0, hum: 0, tension: 0.1, height: 0, birds: true, chase: t > 5 && t < 7, finale: false,
          zone: t < 4 ? null : x > 70 && x < 118 ? 'courtyard' : 'alley', music: null, loops: Object.freeze({}) });
        if (Math.abs(t - 4) < 0.026) A.setZone('alley');
        seen.verbs.add(A.mix.verbName); seen.states.add(A.musicState);
      },
    });
    const m = window.measure(buf);
    const pass = !err && m.nan === 0 && A.theme === id && A.music.maqam === maqam && seen.states.has('chase') && !seen.states.has('souk') && !seen.states.has('none') && (id !== 'souk' || seen.verbs.has('courtyard'));
    ok = ok && pass;
    out[id] = { theme: A.theme, maqam: A.music.maqam, verbs: [...seen.verbs], states: [...seen.states], err, nan: m.nan, pass };
  }
  // Chapter I's chase keeps its own pulse (0.21 s steps), not the maqsum, when the chapter names its maqam
  const pulse = await window.renderOffline({ sec: 3, setup: (A) => { A.setChapter(souk, { id: 'souk' }); A.music.trace = []; }, onTick: (A) => { A._mix = { chase: true, zone: null }; } });
  const tr = pulse.A.music.trace.map((e) => e[0]), gaps = tr.slice(1).map((v, i) => +(v - tr[i]).toFixed(3)).filter((g) => g > 0.01);
  out.soukChase = { gaps: [...new Set(gaps)].slice(0, 6), pulse: gaps.length > 4 && gaps.every((g) => Math.abs(g - 0.21) < 0.002 || Math.abs(g - 0.42) < 0.002) };
  ok = ok && out.soukChase.pulse;
  return { ok, ...out };
}));

// 7. Karplus–Strong buffers are cached per pitch
await run('ksCache', async () => page.evaluate(async () => {
  const ctx = new OfflineAudioContext(2, 4800, 48000);
  const A = new window.AudioMod.Audio(); A.start(ctx);
  // 40 notes of a pitch (an oud's brightness) read one buffer; the instrument itself reads the same entry
  const S = A.synth, t0 = performance.now();
  for (let i = 0; i < 40; i++) S.ksBuffer(146.83, 0.45); S.oud(A.mix.music, 146.83); const first = S.ks.size;
  for (let i = 0; i < 40; i++) S.ksBuffer(220, 0.45); S.oud(A.mix.music, 220); const ms = performance.now() - t0;
  return { buffers: S.ks.size, firstPitchBuffers: first, ms: +ms.toFixed(1), ok: first === 1 && S.ks.size === 2 };
}));

const ok = Object.values(results).every((r) => r.ok) && !errors.length;
if (errors.length) console.log('errors:', errors.slice(0, 10));
console.log(ok ? 'AUDIO TESTS PASS' : 'AUDIO TESTS FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
