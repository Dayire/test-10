// Procedural sound design (WebAudio): ambience, foley, mechanisms and music.
// The engine lives in src/audio/: Mixer (buses, reverb zones, pause, mute, limiter), Voices
// (≤ 32 pooled voices), Synth (instruments), Music (look-ahead scheduler, maqam themes),
// Ambience (beds and gameplay loops) and the sfx / stinger / ui name tables.
import { Mixer, VERBS } from '../audio/mixer.js';
import { Voices } from '../audio/voices.js';
import { Synth } from '../audio/instruments.js';
import { Music } from '../audio/music.js';
import { Ambience } from '../audio/ambience.js';
import { playSfx, playStinger, playUi, SFX_NAMES, STINGERS, UI_SOUNDS } from '../audio/sfx.js';
import { degreeHz, D3, MAQAM, THEME_MAQAM } from '../audio/maqam.js';

export { SFX_NAMES, STINGERS, UI_SOUNDS };
const THEME_VERB = { menu: 'menu', souk: 'courtyard', sundown: 'souk', night: 'alley', dawn: 'open', credits: 'minaret', lab: 'courtyard' };
// themes are chapter ids (and menu / credits); a maqam name alone names its chapter
export const THEME_IDS = new Set(Object.keys(THEME_MAQAM));
const MAQAM_THEME = { hijaz: 'souk', bayati: 'sundown', saba: 'night', rast: 'dawn', ajam: 'dawn' };
// music states, and the names chapter zones may use for them
export const MUSIC_STATES = new Set(['silent', 'explore', 'tension', 'chase', 'clock', 'credits', 'finale', 'test']);
const MUSIC_ALIAS = { none: 'silent', quiet: 'silent', stealth: 'tension', souk: 'explore', calm: 'explore' };
const musicState = (v) => (typeof v !== 'string' ? null : MUSIC_STATES.has(v) ? v : MUSIC_ALIAS[v] ?? null);
const fin = (v, d) => (Number.isFinite(v) ? v : d);
// Chapter I places, used when the chapter definition brings no zones of its own: the souk alleys
// ring short, the walled courtyard and the finale square long (x in metres)
export const THEME_ZONES = {
  souk: [{ x0: -1e9, x1: 72.5, verb: 'alley' }, { x0: 72.5, x1: 112.2, verb: 'courtyard' }, { x0: 112.2, x1: 186, verb: 'alley' }, { x0: 186, x1: 1e9, verb: 'courtyard' }],
};

export class Audio {
  constructor() {
    this.ctx = null; this.started = false; this._muted = false;
    this.listenerX = 0;
    this.theme = 'souk'; this.zones = null; this.zone = null; this.zoneOverride = null; this.paused = false;
    this._zk = this._zo = undefined; this._zm = {};
    this.pendingVolumes = null; this.pendingChapter = null;
    this.muteInBackground = true;
    this.duckUntil = 0; this.duckAmt = 0; this.duckRelease = 1.5; this.boostUntil = 0;
    this.musicState = 'silent';
  }

  // ctx: optional (an OfflineAudioContext for tests); must run inside a user gesture otherwise
  start(ctx = null) {
    if (this.started) return;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
    this.mix = new Mixer(ctx);
    this.voices = new Voices(ctx);
    this.synth = new Synth(ctx, this.voices);
    this.music = new Music(this);
    this.amb = new Ambience(this);
    // names kept from the single-file engine
    this.master = this.mix.master; this.lowpass = this.mix.lowpass; this.sfxBus = this.mix.sfx; this.musicBus = this.mix.music;
    this.mix._muted = this._muted; this.mix.applyMaster(0);
    if (this.pendingVolumes) this.mix.setVolumes(this.pendingVolumes);
    this.master.gain.setValueAtTime(0, ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
    this.started = true;
    const pc = this.pendingChapter;
    this.setChapter(...(pc || [{ theme: this.theme }]));
    this.music.start(!this.offline);
    if (!this.offline && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { this.mix.background = document.hidden && this.muteInBackground; this.mix.applyMaster(0.08); });
      // iOS "interrupted" (calls, Siri) and contexts the platform suspended resume on the next gesture; a
      // context the game itself suspended (an older pause path) and the paused game stay as they are
      const suspend = ctx.suspend.bind(ctx), resume0 = ctx.resume.bind(ctx);
      ctx.suspend = (...a) => { this.appSuspended = true; return suspend(...a); };
      ctx.resume = (...a) => { this.appSuspended = false; return resume0(...a); };
      const resume = () => { if (!this.paused && !this.appSuspended && this.ctx.state !== 'running' && this.ctx.state !== 'closed') resume0().catch(() => {}); };
      for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, resume, { passive: true });
    }
  }

  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; if (this.mix) this.mix.muted = this._muted; }
  // the mute that survives fadeIn (it acts on the user master, fades act on master)
  setMuted(on) { this.muted = on; }

  setListener(x) { if (Number.isFinite(x)) this.listenerX = x; }
  pan(x) { return Math.max(-1, Math.min(1, (fin(x, this.listenerX) - this.listenerX) / 9)); }
  dist(x) { return Math.max(0.15, 1 - Math.abs(fin(x, this.listenerX) - this.listenerX) / 30); }
  hit(x, o) { return this.synth.noiseHit(this.mix.sfx, { ...o, gain: (o.gain ?? 0.3) * this.dist(x), pan: this.pan(x) }); }
  tone(x, o) { return this.synth.tone(this.mix.sfx, { ...o, gain: (o.gain ?? 0.3) * this.dist(x), pan: this.pan(x) }); }

  // ------------------------------------------------------------------ events
  play(name, x, data) {
    if (!this.started || this._muted) return;
    playSfx(this, name, fin(x, this.listenerX), data || {});
  }
  // menu sounds: on the ui bus, never ducked by pause
  ui(name, data) { if (this.started && !this._muted) playUi(this, name, data || {}); }
  // short musical cues on the music bus
  stinger(name, data) { if (this.started && !this._muted) playStinger(this, name, data || {}); }
  stingerBoost(sec) { this.boostUntil = Math.max(this.boostUntil, this.ctx.currentTime + sec); }

  creak(x, dur) {
    const ctx = this.ctx, t = ctx.currentTime, v = this.voices.acquire(this.mix.sfx, t, t + dur + 0.1, 1);
    if (!v) return;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
    v.filter.type = 'bandpass'; v.filter.frequency.setValueAtTime(900, t); v.filter.Q.setValueAtTime(6, t);
    const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.18 * this.dist(x), t + 0.1); g.linearRampToValueAtTime(0.0, t + dur);
    this.voices.setPan(v, this.pan(x)); this.voices.feed(v, o); v.srcs.push(lfo);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }
  chains(x, dur) { for (let i = 0; i < 14; i++) this.tone(x, { f: 1800 + Math.random() * 2400, dur: 0.05, gain: 0.05, type: 'square', delay: Math.random() * dur }); }
  horn() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [98, 98.8, 146.8]) {
      const v = this.voices.acquire(this.mix.sfx, t, t + 1.7, 2);
      if (!v) continue;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f, t + 0.3);
      v.filter.type = 'lowpass'; v.filter.frequency.setValueAtTime(900, t); v.filter.Q.setValueAtTime(0.7, t);
      const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(0.12, t + 0.2); g.linearRampToValueAtTime(0.0, t + 1.6);
      this.voices.setPan(v, 0); this.voices.feed(v, o); o.start(t); o.stop(t + 1.7);
    }
    for (let i = 0; i < 3; i++) this.tone(this.listenerX, { f: 80, f2: 45, dur: 0.3, gain: 0.5, delay: 0.15 + i * 0.28 });
  }
  // formant voice (shouts) and distant dogs
  voice(x, f0, dur, gain = 0.25, dest = null) {
    const ctx = this.ctx, t = ctx.currentTime, v = this.voices.acquire(dest || this.mix.sfx, t, t + dur + 0.1, 1);
    if (!v) return;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.3, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
    const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain * this.dist(x), t + 0.05); g.exponentialRampToValueAtTime(0.001, t + dur);
    for (const [f, q, a] of [[700, 6, 1], [1150, 8, 0.6], [2500, 10, 0.3]]) {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const ga = ctx.createGain(); ga.gain.value = a; o.connect(bp); bp.connect(ga); this.voices.feed(v, ga, false);
    }
    this.voices.setPan(v, this.pan(x)); v.srcs.push(o);
    o.start(t); o.stop(t + dur + 0.1);
  }
  bark(x, gain) {
    const n = 1 + Math.floor(Math.random() * 3), ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.28 + Math.random() * 0.1), f0 = 260 + Math.random() * 60;
      const v = this.voices.acquire(this.mix.amb, t, t + 0.25, 0);
      if (!v) return;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.4, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t + 0.16);
      v.filter.type = 'bandpass'; v.filter.frequency.setValueAtTime(900, t); v.filter.Q.setValueAtTime(3, t);
      const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain, t + 0.015); g.exponentialRampToValueAtTime(0.001, t + 0.2);
      this.voices.setPan(v, this.pan(x)); this.voices.feed(v, o); o.start(t); o.stop(t + 0.25);
    }
  }
  duck() { const f = this.mix.lowpass.frequency, t = this.ctx.currentTime; f.cancelScheduledValues(t); f.setValueAtTime(20000, t); f.exponentialRampToValueAtTime(400, t + 0.6); f.exponentialRampToValueAtTime(20000, t + 3.2); }
  duckMusic(amount, hold = 1.5, release = 1.5) {
    const t = this.ctx.currentTime;
    this.duckAmt = t < this.duckUntil ? Math.max(this.duckAmt, amount) : amount;
    this.duckUntil = t + hold; this.duckRelease = release;
  }
  // the chord that answers from the hills: D–A–D–F♯ (Ajam), oud + qanun + ney + bowls
  answeredLight(when) {
    const S = this.synth, B = this.mix.music, t = Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime);
    const ch = [D3, D3 * 1.5, D3 * 2, degreeHz('ajam', 2, D3 * 2)];
    ch.forEach((f, i) => { S.oud(B, f, { when: t + i * 0.06, gain: 0.2 }); S.qanun(B, f * 2, { when: t + 0.3 + i * 0.05, dur: 2.2, gain: 0.07 }); });
    S.ney(B, ch[3] * 2, { when: t + 0.5, dur: 4, gain: 0.09 });
    S.bowl(B, D3 * 2, { when: t, gain: 0.14, dur: 8 }); S.bowl(B, D3 * 3, { when: t + 0.4, gain: 0.08, dur: 7 });
    this.stingerBoost(8);
  }

  // ------------------------------------------------------------------ chapter, zones, settings
  // audio: the chapter's audio block { theme, verb?, zones: [{ x0, x1, verb, amb, music, tension, hum, drips }] };
  // chapter: the chapter definition (its id names the theme when audio.theme is a maqam name).
  // theme: a chapter id (souk, sundown, night, dawn, lab), menu or credits; a maqam name instead
  // (hijaz, bayati, saba, rast) keeps the chapter's theme and sets the maqam.
  setChapter(audio = {}, chapter = null) {
    const a = audio || {}, raw = a.theme;
    const theme = THEME_IDS.has(raw) ? raw : THEME_IDS.has(chapter?.id) ? chapter.id : THEME_IDS.has(a.id) ? a.id : MAQAM_THEME[raw] || 'souk';
    const maqam = MAQAM[raw] ? raw : null;
    if (!this.started) { this.pendingChapter = [a, chapter]; this.theme = theme; return; }
    this.theme = theme;
    this.zones = Array.isArray(a.zones) && a.zones.length ? a.zones : THEME_ZONES[theme] || null;
    this.zone = null; this._zk = this._zo = undefined;
    this.music.setTheme(theme, maqam); this.amb.setTheme(theme);
    this.mix.setVerb(VERBS[a.verb] ? a.verb : THEME_VERB[theme] || 'courtyard', 2);
  }
  // force a place: a reverb name or { verb, amb, music, tension, hum, drips } over the chapter zone under the
  // listener (null clears it); mix.zone does the same per frame
  setZone(zone) { this.zoneOverride = zone ?? null; if (this.started) this.applyZone(this.listenerX); }
  // the zone in effect: the chapter zone under the listener, its fields overridden by the forced zone
  applyZone(x, over = this.zoneOverride) {
    const xz = this.zones ? this.zones.find((q) => x >= q.x0 && x < q.x1) || null : null;
    if (xz === this._zk && over === this._zo) return this._zm;
    this._zk = xz; this._zo = over;
    const z = this._zm = { ...(xz || {}) };
    if (typeof over === 'string') z.verb = over;
    else if (over && typeof over === 'object') Object.assign(z, over);
    this.zone = xz || over ? z : null;
    this.amb.zone = z;
    this.mix.setVerb(VERBS[z.verb] ? z.verb : THEME_VERB[this.theme] || 'courtyard', 1.5);
    return z;
  }
  // volumes 0–10: master, music, sfx (effects), amb (ambience), ui; flags: mono, reducedRange, muteInBackground
  setVolumes(v = {}) {
    if (v.muteInBackground !== undefined) this.muteInBackground = !!v.muteInBackground;
    if (!this.started) { this.pendingVolumes = { ...(this.pendingVolumes || {}), ...v }; return; }
    this.mix.setVolumes(v);
  }
  // pause: duck and filter the game buses over 0.3 s; the ui bus keeps playing
  setPaused(p) {
    this.paused = !!p;
    if (!this.started) return;
    this.mix.setPaused(this.paused);
    // unpausing is a gesture: a context the platform interrupted meanwhile resumes with it
    if (!p && !this.offline && !this.appSuspended && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
  }

  // ------------------------------------------------------------------ per-frame
  // mix: { crateSpeed, hum, tension, height, birds, chase, finale, zone, music: { state, intensity }, loops: {}, drummer, drummerX }
  update(dt, mix = {}) {
    if (!this.started) return;
    mix = mix || {};
    const t = this.ctx.currentTime;
    // the chapter zone under the listener, overridden by mix.zone (or setZone when mix names none)
    const zm = this.applyZone(fin(this.listenerX, 0), mix.zone ?? this.zoneOverride);
    const m = mix.music || {};
    // a zone's tension and hum are floors under the mix's (the game's generic mix always carries tension 0.1 and
    // hum 0, so a zone that asks for more gets it; a chapter mix that wants more still wins)
    const tension = Math.max(fin(mix.tension, 0.1), fin(zm.tension, 0));
    const hum = Math.max(fin(mix.hum, 0), fin(zm.hum, 0));
    // an explicit state, then the game's flags (finale, chase), then the zone's music, then explore
    const state = musicState(m.state) ?? (mix.finale ? 'finale' : mix.chase ? 'chase' : null) ?? musicState(zm.music) ?? 'explore';
    this.musicState = state;
    this.music.setState(state === 'finale' ? 'silent' : state, fin(m.intensity, tension));
    // music bus: Chapter I explores over the drone alone, as it always has
    if (state !== 'finale') {
      let level = { silent: 0, explore: this.theme === 'souk' || this.theme === 'lab' ? 0 : 0.85, tension: 0.85, chase: 0.9, clock: 1, credits: 1, test: 1 }[state] ?? 0.85;
      if (t < this.boostUntil) level = Math.max(level, 0.9);
      this.mix.music.gain.setTargetAtTime(level, t, state === 'chase' ? 0.5 : 1.5);
    }
    // ducking under death and alarms
    const duck = t < this.duckUntil ? 1 - this.duckAmt : 1;
    this.mix.musicUser.gain.setTargetAtTime(Math.pow(this.mix.volumes.music / 10, 2) * duck, t, t < this.duckUntil ? 0.08 : this.duckRelease / 3);
    this.amb.update(fin(dt, 0), { ...mix, tension, hum });
    if (!this.music.timer) this.music.tick();
  }
  drum(g, f = 90) { this.synth.drum(this.mix.music, f > 100 ? 'tek' : 'doum', { gain: g }); }

  // finale: Chapter I's D-hijaz oud melody over a warm pad (Chapter IV: the ensemble cadence)
  finale() {
    if (!this.started) return;
    const t = this.ctx.currentTime, g = this.mix.music.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(1.0, t + 3);
    this.music.finale(this.theme);
    this.amb.padHeld = true;
    this.amb.pad.gain.cancelScheduledValues(t); this.amb.pad.gain.setTargetAtTime(0.5, t, 2.0);
    this.amb.padFilter.frequency.setTargetAtTime(1400, t, 3.0);
  }
  fadeOut(sec = 3) { if (!this.started) return; const t = this.ctx.currentTime, g = this.master.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.0, t + sec); }
  fadeIn(sec = 2) { if (!this.started) return; const t = this.ctx.currentTime, g = this.master.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0.9, t + sec); this.amb.padHeld = false; }

  get stats() { return this.started ? { voices: this.voices.active, stolen: this.voices.stolen, dropped: this.voices.dropped, started: this.voices.started, music: { ...this.music.stats, state: this.music.state, theme: this.theme, maqam: this.music.maqam }, verb: this.mix.verbName, state: this.ctx.state } : null; }
}
