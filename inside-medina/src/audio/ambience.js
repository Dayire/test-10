import { degreeHz, D3 } from './maqam.js';

// Ambience beds per theme (continuous loops plus scattered events) and the gameplay loops
// (searchlight hum, crate scrape, mirror wheels, capstan, lock charge, smoulder, tripwire, lift).
export const BEDS = {
  menu:    { wind: 0.7, murmur: 0, trickle: 0, birds: 0.2 },
  souk:    { wind: 1, murmur: 1, trickle: 0, birds: 1 },
  lab:     { wind: 0.6, murmur: 0.3, trickle: 0, birds: 0.3 },
  sundown: { wind: 0.8, murmur: 0.5, trickle: 1, birds: 0, smiths: 1, swifts: 1 },
  night:   { wind: 0.55, murmur: 0, trickle: 0, birds: 0, crickets: 1, dogs: 1, drips: 0.4 },
  dawn:    { wind: 1.2, murmur: 0, trickle: 0, birds: 1, chorus: 1 },
  credits: { wind: 0.6, murmur: 0, trickle: 0, birds: 0.6, chorus: 0.5 },
};

// Places: how a zone's walls colour the chapter's bed (multipliers on its fields; `add` sets a floor). A
// zone's `amb` is a level (a number, 1 = the bed as it is), a place name, or the name of another theme's bed.
export const PLACES = {
  alley: { wind: 0.8 },
  souk: {},
  courtyard: { wind: 0.6, murmur: 0.5, birds: 1.2 },
  madrasa: { wind: 0.5, murmur: 0.3, trickle: 0.6 },
  cistern: { wind: 0.15, murmur: 0, birds: 0, swifts: 0, crickets: 0.2, dogs: 0.3, add: { drips: 0.6 } },
  minaret: { wind: 1.3, murmur: 0.4 },
  open: { wind: 1.4 },
  roof: { wind: 1.3, murmur: 0.7 },
};
const BED_KEYS = ['wind', 'murmur', 'trickle', 'birds', 'smiths', 'swifts', 'crickets', 'dogs', 'drips', 'chorus'];

export const LOOPS = ['hum', 'scrape', 'mirrorRoll', 'capstan', 'lockCharge', 'ropeSmoulder', 'tripHum', 'lift'];
const NONE = {};
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

export class Ambience {
  constructor(engine) {
    const e = this.e = engine, ctx = this.ctx = e.ctx, S = e.synth, M = e.mix;
    this.theme = 'souk'; this.bed = BEDS.souk; this.zone = {}; this.beds = new Map(); this._ml = {};
    const G = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // wind: brown noise through a wandering band
    const w = S.src(S.brown, true), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    this.wind = G(0); const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = G(0.06); lfo.connect(lg); lg.connect(this.wind.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.043; const lg2 = G(240); lfo2.connect(lg2); lg2.connect(bp.frequency);
    w.connect(bp); bp.connect(this.wind); this.wind.connect(M.amb);
    // whistle on the walls (dawn): a narrow band riding the same wind
    this.whistle = G(0); const wb = ctx.createBiquadFilter(); wb.type = 'bandpass'; wb.frequency.value = 1150; wb.Q.value = 9;
    const lg3 = G(160); lfo2.connect(lg3); lg3.connect(wb.frequency); w.connect(wb); wb.connect(this.whistle); this.whistle.connect(M.amb);
    // city murmur
    const m = S.src(S.pink, true), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    this.murmur = G(0); m.connect(lp); lp.connect(this.murmur); this.murmur.connect(M.amb);
    // trickling vats
    const tr = S.src(S.white, true), tb = ctx.createBiquadFilter(); tb.type = 'bandpass'; tb.frequency.value = 2200; tb.Q.value = 1.6;
    this.trickle = G(0); this.trickleMod = G(0.5); tr.connect(tb); tb.connect(this.trickleMod); this.trickleMod.connect(this.trickle); this.trickle.connect(M.amb);
    for (const s of [w, lfo, lfo2, m, tr]) s.start();
    // drone pad (music side, follows tension); retuned per chapter tonic
    this.pad = G(0); this.padFilter = ctx.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 520; this.padFilter.Q.value = 0.7;
    this.padOsc = [];
    for (const f of [D3 / 2, D3 * 0.75, D3 * 1.003]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const og = G(0.05); o.connect(og); og.connect(this.padFilter); o.start(); this.padOsc.push(o); }
    this.padFilter.connect(this.pad); this.pad.connect(M.musicUser);
    // gameplay loops
    this.loops = {};
    this.mkLoops();
    this.next = { bird: 3, smith: 1, swift: 4, cricket: 0.5, dog: 6, drip: 2, drum: 0, crackle: 0, chain: 0 };
    this.clock = 0;
  }

  mkLoops() {
    const ctx = this.ctx, S = this.e.synth, sfx = this.e.mix.sfx;
    const G = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const L = this.loops;
    const loop = (name, out) => { L[name] = { g: out, level: 0, hold: 0, x: null, data: null }; out.connect(sfx); };
    // searchlight hum
    const hum = G(0); for (const [f, a] of [[55, 0.5], [110, 0.25], [165, 0.12], [331, 0.05]]) { const o = ctx.createOscillator(); o.frequency.value = f; const og = G(a * 0.12); o.connect(og); og.connect(hum); o.start(); }
    loop('hum', hum);
    // crate scrape
    const sc = S.src(S.white, true), sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 420; sbp.Q.value = 3;
    const sg = G(0); sc.connect(sbp); sbp.connect(sg); sc.start(); loop('scrape', sg); this.scrapeF = sbp;
    // mirror wheels on cobbles
    const mr = S.src(S.brown, true), mbp = ctx.createBiquadFilter(); mbp.type = 'bandpass'; mbp.frequency.value = 260; mbp.Q.value = 1.4;
    const mg = G(0); mr.connect(mbp); mbp.connect(mg); mr.start(); loop('mirrorRoll', mg);
    // capstan / crank wood creak
    const co = ctx.createOscillator(); co.type = 'sawtooth'; co.frequency.value = 62; const clfo = ctx.createOscillator(); clfo.frequency.value = 7; const clg = G(14); clfo.connect(clg); clg.connect(co.frequency);
    const cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 820; cbp.Q.value = 5; const cg = G(0); co.connect(cbp); cbp.connect(cg); co.start(); clfo.start(); loop('capstan', cg);
    // lock charge: a sustained bowl whose pitch is the lock's maqam degree
    const lc = G(0); this.lockOsc = [];
    for (const [m, a] of [[1, 0.5], [2.76, 0.22], [5.4, 0.08]]) { const o = ctx.createOscillator(); o.frequency.value = D3 * 2 * m; const og = G(a * 0.3); o.connect(og); og.connect(lc); o.start(); this.lockOsc.push([o, m]); }
    loop('lockCharge', lc);
    // rope smoulder: hiss (crackles are events)
    const rs = S.src(S.pink, true), rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 1800; const rg = G(0); rs.connect(rhp); rhp.connect(rg); rs.start(); loop('ropeSmoulder', rg);
    // tripwire: faint high sine, cut when broken
    const to = ctx.createOscillator(); to.frequency.value = 3100; const tlfo = ctx.createOscillator(); tlfo.frequency.value = 5.5; const tlg = G(18); tlfo.connect(tlg); tlg.connect(to.frequency);
    const tg = G(0); const tg0 = G(0.03); to.connect(tg0); tg0.connect(tg); to.start(); tlfo.start(); loop('tripHum', tg);
    // lift: motor drone
    const lo = ctx.createOscillator(); lo.type = 'sawtooth'; lo.frequency.value = 48; const llp = ctx.createBiquadFilter(); llp.type = 'lowpass'; llp.frequency.value = 240;
    const lgain = G(0); const l0 = G(0.25); lo.connect(llp); llp.connect(l0); l0.connect(lgain); lo.start(); loop('lift', lgain);
  }

  setTheme(theme) {
    this.theme = theme; this.bed = BEDS[theme] || BEDS.souk;
    const t = this.ctx.currentTime;
    const root = D3;
    // Saba's colour is in its melody (the flat fourth); the drone keeps to tonic and octave at night
    [root / 2, theme === 'night' ? root : root * 0.75, root * 1.003].forEach((f, i) => this.padOsc[i].frequency.setTargetAtTime(f, t, 0.5));
  }
  // the bed a zone hears: the theme's bed, coloured by a place or replaced by another theme's bed
  bedFor(amb) {
    if (typeof amb !== 'string') return this.bed;
    const key = `${this.theme}|${amb}`;
    let b = this.beds.get(key);
    if (!b) {
      const P = PLACES[amb];
      if (P) {
        b = { ...this.bed };
        for (const k of BED_KEYS) if (P[k] !== undefined) b[k] = (b[k] ?? 0) * P[k];
        if (P.add) for (const k of Object.keys(P.add)) b[k] = Math.max(b[k] ?? 0, P.add[k]);
      } else b = BEDS[amb] || this.bed;
      this.beds.set(key, b);
    }
    return b;
  }
  poke(name, level = 1, x = null, data = null) { const l = this.loops[name]; if (!l) return; l.hold = 0.25; l.level = Math.max(l.level, level); l.x = x; l.data = data; }

  update(dt, mix) {
    const ctx = this.ctx, t = ctx.currentTime, e = this.e, S = e.synth, A = e.mix.amb;
    const z = this.zone || NONE;
    const B = this.bedFor(z.amb);
    const zAmb = Math.max(0, fin(z.amb, 1));
    dt = fin(dt);
    this.clock += dt;
    // beds
    this.wind.gain.setTargetAtTime(Math.max(0, 0.12 + fin(mix.height) * 0.015) * (B.wind ?? 1) * zAmb, t, 1.5);
    this.whistle.gain.setTargetAtTime(0.03 * (B.chorus ? 1 : 0) * zAmb, t, 2);
    this.murmur.gain.setTargetAtTime(0.07 * (B.murmur ?? 0) * zAmb, t, 1.5);
    this.trickle.gain.setTargetAtTime(0.05 * (B.trickle ?? 0) * zAmb, t, 1.5);
    if (B.trickle) this.trickleMod.gain.setTargetAtTime(0.3 + Math.random() * 0.7, t, 0.08);
    // pad follows tension
    const tension = Math.max(0, Math.min(1.5, fin(mix.tension, 0.1)));
    if (!this.padHeld) {
      this.pad.gain.setTargetAtTime(tension * 0.35 + 0.05, t, 1.2);
      this.padFilter.frequency.setTargetAtTime(420 + tension * 900, t, 1.0);
    }
    // scattered events
    const N = this.next, rx = () => e.listenerX + (Math.random() - 0.5) * 24;
    const birds = (typeof mix.birds === 'number' ? fin(mix.birds) : mix.birds ? 1 : 0) * (B.birds ?? 0);
    if ((N.bird -= dt) < 0 && birds > 0.01) {
      const n = 2 + Math.floor(Math.random() * 4), base = 2400 + Math.random() * 1500, bx = rx();
      for (let i = 0; i < n; i++) S.tone(A, { f: base * (1 + Math.random() * 0.2), f2: base * (1.3 + Math.random() * 0.4), dur: 0.08, gain: 0.03, delay: i * 0.11, pan: e.pan(bx), prio: 0 });
      N.bird = (4 + Math.random() * 9) / Math.max(0.25, birds * (B.chorus ? 3 : 1));
    }
    if (B.smiths && (N.smith -= dt) < 0) { // coppersmiths: tuned resonators struck in short bursts
      const f = degreeHz('bayati', Math.floor(Math.random() * 5), D3 * 4), n = 1 + Math.floor(Math.random() * 4), bx = rx();
      for (let i = 0; i < n; i++) for (const [m, a] of [[1, 1], [2.71, 0.45], [5.2, 0.2]]) S.noiseHit(A, { f: f * m, q: 60, dur: 0.6 / m, gain: 0.05 * a, delay: i * 0.32, pan: e.pan(bx), prio: 0 });
      N.smith = 1.5 + Math.random() * 3.5;
    }
    if (B.swifts && (N.swift -= dt) < 0) {
      const n = 2 + Math.floor(Math.random() * 4), bx = rx();
      for (let i = 0; i < n; i++) S.tone(A, { f: 4200 + Math.random() * 900, f2: 3100, dur: 0.18, gain: 0.018, type: 'triangle', delay: i * 0.09 + Math.random() * 0.05, pan: e.pan(bx), prio: 0 });
      N.swift = 5 + Math.random() * 9;
    }
    if (B.crickets && (N.cricket -= dt) < 0) {
      const f = 4300 + Math.random() * 600, bx = rx();
      for (let i = 0; i < 3; i++) S.tone(A, { f, dur: 0.035, gain: 0.02, delay: i * 0.06, pan: e.pan(bx), prio: 0 });
      N.cricket = 0.35 + Math.random() * 0.6;
    }
    if (B.dogs && (N.dog -= dt) < 0) { e.bark(rx(), 0.05 + Math.random() * 0.04); N.dog = 9 + Math.random() * 16; }
    const drips = Math.max(B.drips ?? 0, fin(z.drips));
    if (drips && (N.drip -= dt) < 0) { S.tone(A, { f: 1300 + Math.random() * 500, f2: 900, dur: 0.07, gain: 0.04 * drips, pan: e.pan(rx()), prio: 0 }); N.drip = (0.8 + Math.random() * 2.5) / drips; }
    if (fin(mix.drummer) > 0 && (N.drum -= dt) < 0) {
      N.beat = (N.beat || 0) + 1;
      S.drum(A, N.beat % 2 ? 'bendir' : 'ka', { gain: 0.25 * fin(mix.drummer), pan: e.pan(fin(mix.drummerX, e.listenerX)) });
      N.drum = Math.max(N.drum + 0.9, -0.2);
    }
    // gameplay loops: mix.loops = { name: level | { level, x, degree } } (read, never written)
    const src = mix.loops || NONE, ml = this._ml;
    for (const name of LOOPS) ml[name] = src[name];
    if (ml.hum === undefined && mix.hum !== undefined) ml.hum = mix.hum;
    if (ml.scrape === undefined && mix.crateSpeed !== undefined) ml.scrape = Math.min(1, fin(mix.crateSpeed) / 1.2);
    for (const name of LOOPS) {
      const l = this.loops[name];
      const v = ml[name];
      let level = Math.max(0, fin(typeof v === 'object' && v ? v.level ?? 1 : +(v || 0)));
      if (l.hold > 0) { l.hold -= dt; level = Math.max(level, l.level); } else l.level = 0;
      const data = typeof v === 'object' && v ? v : l.data;
      const k = { hum: 1, scrape: 0.22, mirrorRoll: 0.35, capstan: 0.12, lockCharge: 0.16, ropeSmoulder: 0.06, tripHum: 1, lift: 0.3 }[name];
      l.g.gain.setTargetAtTime(level * k, t, name === 'hum' ? 0.3 : 0.05);
      if (name === 'scrape') this.scrapeF.frequency.setTargetAtTime(350 + level * 250 + Math.random() * 80, t, 0.05);
      if (name === 'lockCharge' && Number.isFinite(data?.degree)) for (const [o, m] of this.lockOsc) o.frequency.setTargetAtTime(degreeHz(e.music.maqam, data.degree, D3 * 2) * m, t, 0.05);
      if (name === 'ropeSmoulder' && level > 0.05 && (N.crackle -= dt) < 0) { S.noiseHit(e.mix.sfx, { f: 2500 + Math.random() * 3000, q: 2, dur: 0.02, gain: 0.08 * level, pan: e.pan(data?.x ?? l.x ?? e.listenerX), prio: 0 }); N.crackle = 0.04 + Math.random() * 0.2 / level; }
      if (name === 'lift' && level > 0.05 && (N.chain -= dt) < 0) { S.tone(e.mix.sfx, { f: 2200 + Math.random() * 1600, dur: 0.04, gain: 0.03 * level, type: 'square', prio: 0 }); N.chain = 0.08 + Math.random() * 0.12; }
    }
  }
}
