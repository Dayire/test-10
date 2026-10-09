import { degreeHz, THEME_MAQAM, LEITMOTIF, D3 } from './maqam.js';

// Look-ahead music scheduler: a 25 ms timer schedules every event that falls inside the next
// 120 ms on the audio clock, so onsets are sample-accurate whatever the frame rate. Offline
// rendering drives tick() directly. Each theme turns (state, intensity) into beats of events.
export const HORIZON = 0.12, TIMER_MS = 25;

export class Music {
  constructor(engine) {
    this.e = engine; this.ctx = engine.ctx; this.syn = engine.synth; this.bus = engine.mix.music;
    this.theme = 'souk'; this.maqam = 'hijaz'; this.state = 'silent'; this.intensity = 0;
    this.bpm = 70; this.genT = 0; this.beat = 0; this.queue = []; this.timer = null;
    this.stats = { events: 0, late: 0, maxLate: 0 }; this.trace = null;
    this.phraseT = 0; this.rng = 1;
  }
  rnd() { this.rng = (this.rng * 16807) % 2147483647; return this.rng / 2147483647; }
  start(realtime = true) { this.genT = this.ctx.currentTime + 0.05; if (realtime && !this.timer) this.timer = setInterval(() => this.tick(), TIMER_MS); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  setTheme(theme) {
    if (theme === this.theme) return;
    this.theme = theme; this.maqam = THEME_MAQAM[theme] || 'hijaz';
    this.queue.length = 0; this.genT = Math.max(this.genT, this.ctx.currentTime + 0.05); this.phraseT = this.ctx.currentTime + 1.5;
  }
  setState(state, intensity = this.intensity) {
    if (state !== this.state) {
      this.state = state; this.queue = this.queue.filter((q) => q.keep);
      this.genT = this.ctx.currentTime + 0.03; this.beat = 0; this.phraseT = Math.min(this.phraseT, this.ctx.currentTime + 1.2);
    }
    this.intensity = intensity;
  }
  at(t, fn, keep = false) {
    const q = this.queue; let i = q.length;
    while (i > 0 && q[i - 1].t > t) i--;
    q.splice(i, 0, { t, fn, keep });
  }
  hz(deg, oct = 0) { return degreeHz(this.maqam, deg, D3 * Math.pow(2, oct)); }

  tick() {
    const now = this.ctx.currentTime, end = now + HORIZON;
    let guard = 0;
    while (this.genT < end + 0.25 && guard++ < 64) this.generate();
    const q = this.queue;
    while (q.length && q[0].t < end) {
      const ev = q.shift();
      const late = Math.max(0, now - ev.t);
      this.stats.events++;
      if (late > 0.0005) { this.stats.late++; this.stats.maxLate = Math.max(this.stats.maxLate, late); }
      if (this.trace) this.trace.push([ev.t, Math.max(ev.t, now)]);
      ev.fn(Math.max(ev.t, now));
    }
  }

  // one beat of the current theme / state
  generate() {
    const t = this.genT, st = this.state, th = this.theme, S = this.syn, B = this.bus;
    let bpm = 70;
    if (st === 'test') { bpm = 120; for (let k = 0; k < 4; k++) this.at(t + k * 0.125, (w) => S.tone(B, { when: w, f: 1000, dur: 0.03, gain: 0.5, attack: 0.0005, prio: 3 })); }
    else if (st === 'chase') {
      if (th === 'souk' || th === 'lab') {
        // the original pulse: 8 steps of 0.21 s, doum on even steps, tek on 3 and 7, oud on 0 3 6
        const step = 0.21;
        for (let k = 0; k < 4; k++) {
          const s = (this.beat * 4 + k) % 8, w0 = t + k * step;
          if (s % 2 === 0) this.at(w0, (w) => S.drum(B, 'doum', { when: w, gain: 0.55 }));
          else if (s === 3 || s === 7) this.at(w0, (w) => S.drum(B, 'tek', { when: w, gain: 0.45 }));
          if (s === 0 || s === 3 || s === 6) { const f = [146.83, 155.56, 185.0, 196.0][Math.floor(this.rnd() * 4)]; this.at(w0, (w) => S.oud(B, f, { when: w, gain: 0.18, bright: 0.7 })); }
        }
        this.genT = t + 4 * step; this.beat++; return;
      }
      // maqsum at 120 bpm: D T - T D - T -, with an oud riff
      bpm = 120;
      const e = 60 / bpm / 2, pat = ['doum', 'tek', null, 'tek', 'doum', null, 'tek', 'ka'];
      for (let k = 0; k < 8; k++) if (pat[k]) this.at(t + k * e, (w) => S.drum(B, pat[k], { when: w, gain: pat[k] === 'doum' ? 0.6 : 0.42 }));
      const riff = [0, 1, 2, 1, 0, -1, 0, 3];
      for (let k = 0; k < 8; k += (this.rnd() < 0.5 ? 1 : 2)) { const f = this.hz(riff[k]); this.at(t + k * e, (w) => S.oud(B, f, { when: w, gain: 0.15, bright: 0.65 })); }
      this.genT = t + 8 * e; this.beat++; return;
    } else if (th === 'sundown' && (st === 'explore' || st === 'clock' || st === 'tension')) {
      // qanun ostinato; the sunset clock pushes the tempo 70 → 96 bpm
      bpm = st === 'clock' ? 70 + 26 * Math.min(1, this.intensity) : 70;
      const e = 60 / bpm / 2, ost = [0, 2, 3, 4, 3, 2, 0, -1];
      const g = st === 'clock' ? 0.16 + 0.08 * this.intensity : 0.1;
      for (let k = 0; k < 8; k++) { const f = this.hz(ost[k]); this.at(t + k * e, (w) => S.qanun(B, f, { when: w, dur: 0.2, gain: g * (k % 4 === 0 ? 1 : 0.7) })); }
      if (st === 'clock') for (const k of [0, 3, 6]) this.at(t + k * e, (w) => S.drum(B, k ? 'ka' : 'bendir', { when: w, gain: 0.3 + 0.2 * this.intensity }));
      if (st === 'explore' && t > this.phraseT) this.phrase(t + 2 * e, 'ney', 0.09);
      this.genT = t + 8 * e; this.beat++; return;
    } else if (st === 'explore' || st === 'tension' || st === 'credits') {
      if (th === 'menu' && t > this.phraseT) {
        if (this.rnd() < 0.6) this.taqsim(t); else this.phrase(t, 'ney', 0.1, LEITMOTIF.slice(0, 8));
      } else if (th === 'night' && t > this.phraseT) this.phrase(t, 'ney', 0.07, null, -1);
      else if (th === 'dawn' && t > this.phraseT) this.phrase(t, 'ney', 0.1);
      else if ((th === 'credits' || st === 'credits') && t > this.phraseT) { const end = this.melody(t, LEITMOTIF, 0.6, true); for (let k = 0; k < 4; k++) this.at(t + k * 2.4, (w) => this.syn.ney(this.bus, this.hz([0, 4, 2, 0][k], 1), { when: w, dur: 2.2, gain: 0.07 })); this.phraseT = end + 2.5; }
    }
    this.genT = t + 60 / bpm;
    this.beat++;
  }

  // a short ney (or oud) phrase on the maqam, then a rest
  phrase(t, inst, gain, degs = null, oct = 0) {
    const S = this.syn, B = this.bus;
    const n = degs ? degs.length : 3 + Math.floor(this.rnd() * 4);
    let d = Math.floor(this.rnd() * 3), w = t;
    for (let i = 0; i < n; i++) {
      d = degs ? degs[i] : Math.max(-2, Math.min(6, d + (this.rnd() < 0.5 ? -1 : 1) * (this.rnd() < 0.8 ? 1 : 2)));
      const dur = i === n - 1 ? 1.8 + this.rnd() : 0.45 + this.rnd() * 0.6, f = this.hz(d, oct + (inst === 'ney' ? 1 : 0));
      if (inst === 'ney') this.at(w, (x) => S.ney(B, f, { when: x, dur: dur * 0.95, gain }));
      else this.at(w, (x) => S.oud(B, f, { when: x, gain }));
      w += dur;
    }
    this.phraseT = w + 3 + this.rnd() * 6;
  }
  // free-rhythm oud improvisation: runs that settle on the tonic
  taqsim(t) {
    const S = this.syn, B = this.bus;
    let d = 4, w = t;
    const n = 5 + Math.floor(this.rnd() * 5);
    for (let i = 0; i < n; i++) {
      d += this.rnd() < 0.6 ? -1 : 1; if (i === n - 1) d = 0;
      const f = this.hz(d), g = 0.16 + this.rnd() * 0.05;
      this.at(w, (x) => S.oud(B, f, { when: x, gain: g }));
      if (this.rnd() < 0.3) this.at(w + 0.07, (x) => S.oud(B, f, { when: x, gain: g * 0.6 }));
      w += 0.18 + this.rnd() * (i === n - 1 ? 1.4 : 0.5);
    }
    this.at(w, (x) => S.oud(B, this.hz(0, -1), { when: x, gain: 0.14, bright: 0.25 }));
    this.phraseT = w + 2.5 + this.rnd() * 3;
  }
  melody(t, degs, beat = 0.45, qanun = false) {
    const S = this.syn, B = this.bus;
    let w = t;
    degs.forEach((d, i) => {
      const f = this.hz(d);
      this.at(w, (x) => S.oud(B, f, { when: x, gain: 0.24, bright: 0.45 }), true);
      if (qanun && i % 2 === 0) this.at(w, (x) => S.qanun(B, f * 2, { when: x, dur: 0.2, gain: 0.07 }), true);
      if (i % 4 === 0) this.at(w, (x) => S.oud(B, this.hz(0, -1), { when: x, gain: 0.16, bright: 0.2 }), true);
      w += i % 4 === 3 ? beat * 2 : beat;
    });
    this.phraseT = w + 6;
    return w;
  }

  // finales. souk: the D-hijaz melody over the pad. dawn: ensemble cadence → Ajam → the answered-light chord
  finale(kind = this.theme) {
    const t = this.ctx.currentTime + 0.8;
    if (kind !== 'dawn') return this.melody(t, LEITMOTIF, 0.45);
    const S = this.syn, B = this.bus;
    const end = this.melody(t, [4, 3, 2, 1, 2, 3, 2, 1, 0, 1, 2, 0], 0.5, true);
    for (let k = 0; k < 12; k++) this.at(t + k * 0.5, (w) => S.drum(B, k % 4 === 0 ? 'bendir' : 'ka', { when: w, gain: 0.35 }), true);
    this.at(t + 1, (w) => S.ney(B, this.hz(4, 1), { when: w, dur: 4, gain: 0.08 }), true);
    // resolve to Ajam: the neutral third rises to the major third
    this.at(end, (w) => { this.maqam = 'ajam'; S.ney(B, degreeHz('ajam', 2, D3 * 2), { when: w, dur: 3.5, gain: 0.1 }); S.qanun(B, degreeHz('ajam', 2, D3), { when: w, dur: 2.5, gain: 0.12 }); }, true);
    this.at(end + 3.6, (w) => this.e.answeredLight(w), true);
    return end + 3.6;
  }
}

