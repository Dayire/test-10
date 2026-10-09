import { degreeHz, D3 } from './maqam.js';

// Every named sound effect. e = engine (hit / tone / pluck helpers that pan and attenuate by x).
// Unknown names fall through silently, so game code can emit events before a sound exists.
export const SFX_NAMES = [
  'step', 'guardStep', 'jump', 'land', 'grab', 'climbUp', 'vine', 'crateImpact', 'plateDown', 'plateUp', 'gateStart', 'bridgeStart',
  'gateStop', 'gateSlam', 'bridgeSlam', 'grip', 'lever', 'ladder', 'alarm', 'dart', 'shout', 'guardVault', 'guardFrustrated', 'grabbed',
  'death', 'crawl', 'wings',
  // light, mechanisms and story (full game)
  'mirrorGrip', 'notch', 'mirrorRoll', 'crank', 'capstan', 'lockCharge', 'lockOpen', 'boltShut', 'ropeSmoulder', 'ropeSnap', 'counterweight',
  'dazzle', 'fixate', 'turret', 'dartGuard', 'guardStun', 'guardSleep', 'tripHum', 'plankCreak', 'plankFall', 'dyeSplash', 'lift', 'liftStop',
  'hatch', 'trayPick', 'trayInsert', 'sunsetTick', 'lampsOn', 'lampsOff', 'answeredLight',
];
export const LOOP_SFX = { mirrorRoll: 1, capstan: 1, lockCharge: 1, ropeSmoulder: 1, tripHum: 1, lift: 1 };
export const STINGERS = ['checkpoint', 'lockOpen', 'ropeSnap', 'dazzle', 'chapterEnd', 'answeredLight', 'catch'];
export const UI_SOUNDS = ['hover', 'confirm', 'back', 'slider', 'card', 'toggle', 'open', 'close'];

export function playSfx(e, name, x, data = {}) {
  const r = Math.random;
  const hit = (o) => e.hit(x, o), tone = (o) => e.tone(x, o);
  switch (name) {
    case 'step': {
      const surf = data.surface || 'stone', k = Math.min(1, 0.35 + (data.speed || 3) / 5);
      if (surf === 'wood') { hit({ f: 700 + r() * 200, q: 2.5, dur: 0.09, gain: 0.22 * k }); tone({ f: 160, f2: 90, dur: 0.08, gain: 0.12 * k }); }
      else if (surf === 'cloth') hit({ f: 500, q: 0.7, dur: 0.12, gain: 0.12 * k, type: 'lowpass' });
      else if (surf === 'metal' || surf === 'brass') { hit({ f: 2600, q: 6, dur: 0.07, gain: 0.12 * k }); tone({ f: 900 + r() * 200, dur: 0.12, gain: 0.03 * k, type: 'triangle' }); }
      else { hit({ f: 2200 + r() * 900, q: 1.4, dur: 0.05, gain: 0.16 * k }); hit({ f: 380, q: 0.9, dur: 0.07, gain: 0.14 * k, type: 'lowpass' }); }
      break;
    }
    case 'guardStep': hit({ f: 300, q: 0.8, dur: 0.12, gain: 0.3, type: 'lowpass' }); hit({ f: 1600, q: 1.2, dur: 0.05, gain: 0.12 }); break;
    case 'jump': hit({ f: 900, q: 0.6, dur: 0.18, gain: 0.08, attack: 0.04 }); break;
    case 'land': { const s = Math.min(1, (data.speed || 4) / 12); tone({ f: 110, f2: 45, dur: 0.18, gain: 0.25 * s + 0.08 }); hit({ f: 700, q: 0.7, dur: 0.14, gain: 0.2 * s + 0.06, type: 'lowpass' }); break; }
    case 'grab': hit({ f: 1400, q: 1.5, dur: 0.06, gain: 0.16 }); hit({ f: 400, q: 0.6, dur: 0.1, gain: 0.08, type: 'lowpass' }); break;
    case 'climbUp': hit({ f: 1100, q: 0.8, dur: 0.35, gain: 0.08, attack: 0.08, pitchDrop: 0.6 }); break;
    case 'vine': hit({ f: 2600, q: 0.6, dur: 0.22, gain: 0.08, attack: 0.02 }); break;
    case 'crateImpact': tone({ f: 90, f2: 40, dur: 0.35, gain: 0.5 }); hit({ f: 500, q: 0.8, dur: 0.25, gain: 0.35, type: 'lowpass' }); hit({ f: 1800, q: 3, dur: 0.12, gain: 0.12, delay: 0.02 }); break;
    case 'plateDown': tone({ f: 180, f2: 120, dur: 0.12, gain: 0.25 }); hit({ f: 2500, q: 5, dur: 0.05, gain: 0.2 }); tone({ f: 520, dur: 0.4, gain: 0.05, type: 'triangle', delay: 0.05 }); break;
    case 'plateUp': tone({ f: 140, f2: 190, dur: 0.1, gain: 0.15 }); break;
    case 'gateStart': case 'bridgeStart': e.creak(x, 1.6); e.chains(x, 1.4); break;
    case 'gateStop': hit({ f: 300, q: 1, dur: 0.2, gain: 0.2, type: 'lowpass' }); break;
    case 'gateSlam': case 'bridgeSlam': tone({ f: 70, f2: 35, dur: 0.6, gain: 0.55 }); hit({ f: 400, q: 0.7, dur: 0.4, gain: 0.35, type: 'lowpass' }); break;
    case 'grip': hit({ f: 1200, q: 1.2, dur: 0.06, gain: 0.12 }); break;
    case 'lever': [523, 1244, 1861, 2873].forEach((f, i) => tone({ f, dur: 0.9 - i * 0.15, gain: 0.08 / (i + 1) })); tone({ f: 120, f2: 60, dur: 0.2, gain: 0.3 }); break;
    case 'ladder': hit({ f: 1500, q: 0.5, dur: 1.2, gain: 0.1, attack: 0.1, pitchDrop: 0.3 }); for (let i = 0; i < 8; i++) tone({ f: 300 + r() * 200, dur: 0.05, gain: 0.12, type: 'triangle', delay: 0.1 + i * 0.12 }); break;
    case 'alarm': e.horn(); e.duckMusic(0.5, 2.5); break;
    case 'dart': hit({ f: 3000, q: 0.8, dur: 0.25, gain: 0.25, attack: 0.2, pitchDrop: 0.4 }); tone({ f: 900, f2: 300, dur: 0.06, gain: 0.2, delay: 0.25 }); break;
    case 'shout': e.voice(x, 150, 0.7); break;
    case 'guardVault': hit({ f: 600, q: 0.6, dur: 0.2, gain: 0.2, type: 'lowpass' }); break;
    case 'guardFrustrated': e.voice(x, 120, 0.9); tone({ f: 80, f2: 50, dur: 0.3, gain: 0.35, delay: 0.3 }); break;
    case 'grabbed': tone({ f: 60, f2: 30, dur: 0.8, gain: 0.6 }); break;
    case 'death': tone({ f: 55, f2: 28, dur: 1.6, gain: 0.5 }); e.duck(); e.duckMusic(0.85, 2.2, 2); break;
    case 'crawl': hit({ f: 800, q: 0.6, dur: 0.2, gain: 0.08, type: 'lowpass' }); break;
    case 'wings': {
      const now = e.ctx.currentTime;
      if (e._lastWings && now - e._lastWings < 0.25) break;
      e._lastWings = now;
      for (let i = 0; i < 7; i++) hit({ f: 1200 + r() * 900, q: 0.8, dur: 0.06, gain: 0.09, delay: i * 0.075 + r() * 0.02 });
      break;
    }
    // ---- mirrors and cranks
    case 'mirrorGrip': hit({ f: 1400, q: 1.5, dur: 0.05, gain: 0.12 }); tone({ f: 2350, dur: 0.35, gain: 0.035, type: 'triangle', delay: 0.01 }); break;
    case 'notch': hit({ f: 3600, q: 4, dur: 0.02, gain: 0.12 }); tone({ f: 1750 + (data.notch || 0) * 12, dur: 0.05, gain: 0.05, type: 'triangle' }); break;
    case 'crank': for (let i = 0; i < 3; i++) hit({ f: 2600 + r() * 600, q: 5, dur: 0.02, gain: 0.1, delay: i * 0.05 }); e.creak(x, 0.35); break;
    case 'mirrorRoll': case 'capstan': case 'lockCharge': case 'ropeSmoulder': case 'tripHum': case 'lift':
      e.amb.poke(name, data.level ?? 1, x, data); break;
    // ---- locks
    case 'lockOpen': {
      const f = degreeHz(e.music.maqam, data.degree ?? 0, D3 * 2);
      e.synth.bowl(e.mix.sfx, f, { gain: 0.16 * e.dist(x), dur: 5, pan: e.pan(x) });
      hit({ f: 320, q: 0.8, dur: 0.18, gain: 0.25, type: 'lowpass' });
      for (let i = 0; i < 5; i++) tone({ f: f * (2 + i * 0.5), dur: 0.5, gain: 0.025, delay: 0.05 + i * 0.06, type: 'triangle' });
      e.stinger('lockOpen', data);
      break;
    }
    case 'boltShut': hit({ f: 240, q: 0.9, dur: 0.2, gain: 0.35, type: 'lowpass' }); tone({ f: 420, f2: 380, dur: 0.18, gain: 0.08, type: 'square', lp: 1800 }); break;
    // ---- rope and counterweight
    case 'ropeSnap': hit({ f: 2200, q: 0.7, dur: 0.07, gain: 0.45, type: 'highpass' }); tone({ f: 190, f2: 60, dur: 0.4, gain: 0.25 }); e.stinger('ropeSnap'); break;
    case 'counterweight': tone({ f: 62, f2: 28, dur: 0.9, gain: 0.65 }); hit({ f: 300, q: 0.7, dur: 0.6, gain: 0.45, type: 'lowpass' }); for (let i = 0; i < 6; i++) hit({ f: 1400 + r() * 1600, q: 2, dur: 0.04, gain: 0.08, delay: 0.1 + r() * 0.5 }); break;
    // ---- lamps and tripwires
    case 'dazzle': e.stinger('dazzle'); hit({ f: 5200, q: 0.5, dur: 1.2, gain: 0.06, attack: 0.6 }); break;
    case 'fixate': { const v = e.synth.tone(e.mix.sfx, { f: 300, f2: 520, dur: 0.35, gain: 0.07 * e.dist(x), type: 'sawtooth', lp: 1400, pan: e.pan(x) }); void v; break; }
    case 'turret': tone({ f: 600, f2: 900, dur: 0.12, gain: 0.06, type: 'sawtooth', lp: 2000 }); hit({ f: 2400, q: 3, dur: 0.03, gain: 0.15, delay: 0.12 }); break;
    case 'dartGuard': hit({ f: 3000, q: 0.8, dur: 0.22, gain: 0.22, attack: 0.18, pitchDrop: 0.4 }); hit({ f: 500, q: 0.8, dur: 0.1, gain: 0.25, type: 'lowpass', delay: 0.22 }); break;
    case 'guardStun': e.voice(x, 175, 0.45); hit({ f: 900, q: 0.6, dur: 0.25, gain: 0.08, type: 'lowpass' }); break;
    case 'guardSleep': tone({ f: 85, f2: 40, dur: 0.4, gain: 0.35 }); hit({ f: 420, q: 0.6, dur: 1.4, gain: 0.05, type: 'lowpass', attack: 0.3, delay: 0.3 }); break;
    // ---- places
    case 'plankCreak': e.creak(x, 0.45); break;
    case 'plankFall': hit({ f: 1800, q: 1, dur: 0.06, gain: 0.3 }); hit({ f: 600, q: 0.5, dur: 0.7, gain: 0.08, attack: 0.2, pitchDrop: 0.4, delay: 0.05 }); tone({ f: 90, f2: 45, dur: 0.3, gain: 0.25, delay: 0.85 }); break;
    case 'dyeSplash': hit({ f: 900, q: 0.6, dur: 0.4, gain: 0.35 }); tone({ f: 210, f2: 70, dur: 0.25, gain: 0.25 }); for (let i = 0; i < 6; i++) tone({ f: 900 + r() * 1200, f2: 500, dur: 0.05, gain: 0.04, delay: 0.15 + r() * 0.5 }); break;
    case 'liftStop': tone({ f: 70, f2: 45, dur: 0.3, gain: 0.35 }); e.chains(x, 0.4); break;
    case 'hatch': e.creak(x, 0.9); tone({ f: 75, f2: 40, dur: 0.4, gain: 0.4, delay: 0.85 }); hit({ f: 350, q: 0.8, dur: 0.3, gain: 0.25, type: 'lowpass', delay: 0.85 }); break;
    // ---- story
    case 'trayPick': e.synth.bowl(e.mix.sfx, D3 * 4, { gain: 0.08 * e.dist(x), dur: 3, pan: e.pan(x) }); hit({ f: 700, q: 0.6, dur: 0.2, gain: 0.06, type: 'lowpass' }); break;
    case 'trayInsert': hit({ f: 2600, q: 6, dur: 0.06, gain: 0.25 }); tone({ f: 260, f2: 200, dur: 0.2, gain: 0.2 }); e.synth.bowl(e.mix.sfx, D3 * 2, { gain: 0.2 * e.dist(x), dur: 7, pan: e.pan(x) }); break;
    case 'sunsetTick': { const u = data.urgency ?? 0; hit({ f: 1900 + u * 900, q: 9, dur: 0.035, gain: 0.12 + u * 0.08 }); tone({ f: 880 + u * 300, dur: 0.04, gain: 0.03 }); break; }
    case 'lampsOn': case 'lampsOff': {
      const on = name === 'lampsOn', n = data.count ?? 14, span = data.sec ?? 6;
      for (let i = 0; i < n; i++) {
        const d = (i / n) * span + r() * 0.2, f = degreeHz(e.music.maqam, on ? i % 7 : 6 - (i % 7), D3 * 4);
        hit({ f: on ? 700 : 500, q: 0.7, dur: on ? 0.25 : 0.4, gain: 0.05, type: 'lowpass', delay: d, attack: 0.03 });
        tone({ f, dur: 1.2, gain: 0.018, type: 'sine', delay: d + 0.02 });
      }
      break;
    }
    case 'answeredLight': e.answeredLight(); break;
    default: break;
  }
}

export function playStinger(e, name, data = {}) {
  const S = e.synth, B = e.mix.music, t = e.ctx.currentTime + 0.02, M = e.music.maqam;
  const hz = (d, o = 0) => degreeHz(M, d, D3 * Math.pow(2, o));
  e.stingerBoost(name === 'answeredLight' || name === 'chapterEnd' ? 6 : 2.5);
  switch (name) {
    case 'checkpoint': S.bowl(B, hz(0, 1), { when: t, gain: 0.09, dur: 4 }); S.bowl(B, hz(4, 1), { when: t + 0.12, gain: 0.05, dur: 3.5 }); break;
    case 'lockOpen': { const d0 = data.degree ?? 0; for (let i = 0; i < 4; i++) S.qanun(B, hz(d0 + i * 2, 1), { when: t + 0.15 + i * 0.09, dur: 0.2, gain: 0.08 }); break; }
    case 'ropeSnap': S.drum(B, 'bendir', { when: t, gain: 0.5 }); S.qanun(B, hz(1, 0), { when: t, dur: 0.2, gain: 0.12 }); S.qanun(B, hz(0, 0) * 1.06, { when: t, dur: 0.2, gain: 0.1 }); break;
    case 'dazzle': { // inverted swell
      const v = S.noiseHit(B, { when: t, f: 3000, q: 0.4, dur: 1.4, gain: 0.0001, type: 'highpass' });
      if (v) { const g = v.env.gain; g.cancelScheduledValues(t); g.setValueAtTime(0.0001, t); g.exponentialRampToValueAtTime(0.16, t + 1.1); g.linearRampToValueAtTime(0, t + 1.16); }
      S.bowl(B, hz(0, 2), { when: t + 1.15, gain: 0.06, dur: 2.5 });
      break;
    }
    case 'chapterEnd': { const seq = [4, 3, 2, 1, 0]; seq.forEach((d, i) => S.oud(B, hz(d), { when: t + i * 0.42, gain: 0.22 })); S.bowl(B, hz(0, 1), { when: t + seq.length * 0.42, gain: 0.12, dur: 6 }); S.oud(B, hz(0, -1), { when: t + seq.length * 0.42, gain: 0.2, bright: 0.2 }); break; }
    case 'answeredLight': e.answeredLight(t); break;
    case 'catch': for (let i = 0; i < 6; i++) S.qanun(B, hz(i, 1), { when: t + i * 0.07, dur: 0.6, gain: 0.07 + i * 0.012 }); S.bowl(B, hz(0, 1), { when: t + 0.45, gain: 0.1, dur: 5 }); break;
    default: break;
  }
}

export function playUi(e, name, data = {}) {
  const S = e.synth, U = e.mix.ui, t = e.ctx.currentTime;
  switch (name) {
    case 'hover': S.tone(U, { when: t, f: 2650, dur: 0.035, gain: 0.035, type: 'triangle', prio: 3 }); break;
    case 'confirm': S.pluck(U, D3 * 4, { when: t, gain: 0.26, bright: 0.85, body: 2400, dur: 1.2, prio: 3 }); S.pluck(U, D3 * 6, { when: t + 0.09, gain: 0.22, bright: 0.85, body: 2400, dur: 1.2, prio: 3 }); break;
    case 'back': S.pluck(U, D3 * 3, { when: t, gain: 0.22, bright: 0.5, dur: 1, prio: 3 }); S.pluck(U, D3 * 2, { when: t + 0.08, gain: 0.2, bright: 0.5, dur: 1, prio: 3 }); break;
    case 'slider': { const v = Math.max(0, Math.min(1, data.value ?? 0.5)); S.tone(U, { when: t, f: 600 * Math.pow(3, v), dur: 0.04, gain: 0.05, type: 'triangle', prio: 3 }); break; }
    case 'toggle': S.tone(U, { when: t, f: data.on ? 1320 : 990, dur: 0.05, gain: 0.05, type: 'triangle', prio: 3 }); break;
    case 'card': S.bowl(U, D3 * 2, { when: t, gain: 0.12, dur: 4.5, prio: 3 }); break;
    case 'open': S.pluck(U, D3 * 2, { when: t, gain: 0.12, bright: 0.6, dur: 1.2, prio: 3 }); break;
    case 'close': S.pluck(U, D3 * 1.5, { when: t, gain: 0.1, bright: 0.4, dur: 1, prio: 3 }); break;
    default: break;
  }
}
