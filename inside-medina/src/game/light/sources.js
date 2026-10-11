import * as THREE from 'three';
import { angleOf, DEG } from './trace.js';
import { beamLampMesh } from '../../assets/lightprops.js';

// Light sources (FULL_GAME §6.2). A source is a ray entering the play plane: (x, y), an angle in degrees and an
// intensity (sun 1.0, searchlight 1.5, beam lamp 1.0, moon 0.5). clipByTerminator: dead while y ≤ T + 0.3 (true:
// the system's terminator; or a Terminator of its own).
// enabled: false, or a function read every trace.
const _c = new THREE.Color();
export class LightSource {
  constructor({ id, x = 0, y = 0, angle = 195, I = 1, enabled = true, clipByTerminator = false, kind = 'sun', width, color, hideFirst = false, glow = 1 } = {}) {
    if (id !== undefined) this.id = id;
    this.x = x; this.y = y; this.angle = angle; this.I = I; this.kind = kind;
    this.clipByTerminator = clipByTerminator; this.hideFirst = hideFirst;
    this.isSource = true;
    this.enabledFn = typeof enabled === 'function' ? enabled : null;
    this.on = enabled !== false;
    this.width = width ?? (kind === 'lamp' ? 0.03 : kind === 'moon' ? 0.9 : kind === 'searchlight' ? 0.42 : 0.34);
    this.fixed = color !== undefined && color !== null ? new THREE.Color(color) : null;
    this.glow = glow; // visual brightness of the beam (gameplay intensity is I)
    this.col = new THREE.Color(1, 0.85, 0.6);
  }
  get ox() { return this.x; }
  get oy() { return this.y; }
  get theta() { return this.angle; }
  live(sys) {
    if (!this.on || (this.enabledFn && !this.enabledFn())) return false;
    const T = this.clipByTerminator === true ? sys?.terminator : this.clipByTerminator || null;
    if (T && this.oy <= T.T + 0.3) return false;
    return true;
  }
  // the beam's colour, unit brightness (the renderer scales it by the segment's intensity)
  color(game) {
    if (this.fixed) return this.col.copy(this.fixed);
    const s = game.world.light?.sun?.color;
    if (!s) return this.col;
    // the live sun's hue, lifted toward warm white so a dim dusk sun still reads as sunlight
    const m = Math.max(s.r, s.g, s.b, 1e-3);
    _c.setRGB(s.r / m, s.g / m, s.b / m);
    return this.col.setRGB(1, 0.93, 0.8).lerp(_c, 0.7);
  }
  getState() { return { on: this.on, angle: this.angle }; }
  setState(s) { this.on = s.on; if (s.angle !== undefined) this.angle = s.angle; }
}

export class SunRay extends LightSource { constructor(o = {}) { super({ kind: 'sun', I: 1, ...o }); } }
// moonlight is weak (it half-opens a gold lock): a pale, cool haze rather than a hot line (the renderer draws a
// moon beam soft)
export class MoonRay extends LightSource { constructor(o = {}) { super({ kind: 'moon', I: 0.5, color: 0x9fb4e0, width: 0.9, glow: 0.5, ...o }); } }

// a brass lamp throwing a thin beam (tripwires): a mesh at (x, y, z) aimed along the angle
export class BeamLamp extends LightSource {
  constructor(game, o = {}) {
    super({ kind: 'lamp', I: 1, color: 0xffa860, glow: 0.8, ...o });
    this.game = game;
    if (o.mesh !== false) {
      this.mesh = beamLampMesh(game.mats);
      this.mesh.position.set(this.x - Math.cos(this.angle * DEG) * 0.13, this.y, o.z ?? 0);
      this.mesh.rotation.z = this.angle * DEG;
      game.add(this.mesh);
    }
  }
  render() { if (this.mesh) this.mesh.userData.lens.material.color.setRGB(5, 2.6, 1.1).multiplyScalar(this.on ? 1 : 0.05); }
}

// a searchlight's own beam as a light source (FULL_GAME §6.4: reflectable): from the lamp's (x, y) through its
// aim point at I 1.5. The first segment is the lamp's cone (not drawn again); reflections are.
export class SearchlightSource extends LightSource {
  constructor(sl, o = {}) {
    super({ kind: 'searchlight', I: 1.5, hideFirst: true, width: 0.42, glow: 1.1, ...o });
    this.sl = sl;
  }
  get ox() { return this.sl.origin.x; }
  get oy() { return this.sl.origin.y; }
  get theta() { const s = this.sl, a = s.game.held ? s.viewAim : s.aim; return angleOf(a.x - s.origin.x, a.y - s.origin.y); }
  live(sys) { return this.sl.enabled && super.live(sys); }
  color() { return this.col.copy(this.sl.beamColor || this.sl.baseColor); }
}
