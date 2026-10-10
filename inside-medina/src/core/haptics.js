// Haptics (FULL_GAME §8.3): the Vibration API on phones (Android; iOS Safari has none) and the dual-rumble
// actuator on gamepads, picked by the device in use. off / low / full; nothing plays before the first user
// activation, and every call is feature-detected and guarded (iframes may block both).
export const HAPTICS = {
  land: { vib: 20, pad: [120, 0.6, 0.3] },
  crate: { vib: 15, pad: [150, 0.4, 0.6] },
  notch: { vib: 5, pad: [30, 0, 0.2] },
  lock: { vib: [15, 30, 15], pad: [80, 0.2, 0.5] },
  rope: { vib: 40, pad: [250, 0.8, 0.4] },
  slam: { vib: 60, pad: [250, 0.8, 0.4] },
  death: { vib: [40, 40, 80], pad: [300, 0.9, 0.5] },
};
const SCALE = { off: 0, low: 0.5, full: 1 };

export class Haptics {
  constructor(input) {
    this.input = input;
    this.level = 'low';
    this.count = 0; this.last = null; // what played (tests)
    this.canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }
  setLevel(l) { this.level = SCALE[l] !== undefined ? l : 'low'; }
  get active() {
    const ua = navigator.userActivation;
    return SCALE[this.level] > 0 && (!ua || ua.hasBeenActive);
  }

  play(name) {
    const h = HAPTICS[name];
    if (!h || !this.active) return false;
    const s = SCALE[this.level], dev = this.input?.lastDevice;
    if (dev === 'gamepad') return this.rumble(h.pad, s, name);
    if (dev === 'touch' && this.canVibrate) {
      const scale = (ms) => Math.max(1, Math.round(ms * (s < 1 ? 0.75 : 1)));
      const pat = Array.isArray(h.vib) ? h.vib.map((v, i) => (i % 2 ? v : scale(v))) : scale(h.vib);
      try { navigator.vibrate(pat); this.count++; this.last = name; return true; } catch { return false; }
    }
    return false;
  }

  rumble([ms, strong, weak], s, name) {
    let pads = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; } catch { return false; }
    const want = this.input?.pad?.index;
    const gp = pads.find((p) => p && p.connected && (want === undefined || p.index === want)) || pads.find((p) => p && p.connected);
    if (!gp) return false;
    const mag = (v) => Math.min(1, v * s);
    try {
      const a = gp.vibrationActuator;
      if (a && typeof a.playEffect === 'function') {
        a.playEffect('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: mag(strong), weakMagnitude: mag(weak) })?.catch?.(() => {});
      } else if (gp.hapticActuators && gp.hapticActuators[0]?.pulse) {
        gp.hapticActuators[0].pulse(mag(Math.max(strong, weak)), ms)?.catch?.(() => {});
      } else return false;
      this.count++; this.last = name;
      return true;
    } catch { return false; }
  }

  // engine and chapter events → haptics (land, crate impacts, notches, locks, ropes, slams, death)
  // onSound(fn): a subscription to the sounds the game plays (slams are sounds, not events)
  attach(game, onSound) {
    const E = game.events;
    E.on('land', (d) => { if (d?.hard) this.play('land'); });
    E.on('impact', (d) => { if ((d?.kind === 'crate' || d?.kind === 'mirror') && (d.speed ?? 0) > 3) this.play('crate'); });
    E.on('notch', () => this.play('notch'));
    E.on('lockOpen', () => this.play('lock'));
    E.on('ropeSnap', () => this.play('rope'));
    E.on('death', () => this.play('death'));
    onSound?.((name) => { if (name === 'bridgeSlam' || name === 'gateSlam') this.play('slam'); });
    return this;
  }
}
