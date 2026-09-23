import * as THREE from 'three';
import { worldUV, setColor } from '../assets/geom.js';

// Drawbridge hinged on the far side of a ravine; lowered while its source is > 0.9
export class Drawbridge {
  constructor(game, { x0, x1, y = 0, source }) {
    this.game = game; this.x0 = x0; this.x1 = x1; this.y = y; this.source = source;
    this.len = x1 - x0;
    this.angle = Math.PI / 2; // raised
    this.solid = game.phys.addSolid(x0, y - 0.25, x1, y, { ledges: false, surface: 'wood', kind: 'bridge' });
    this.solid.enabled = false;
    const grp = new THREE.Group();
    const planks = [];
    const n = Math.round(this.len / 0.28);
    for (let i = 0; i < n; i++) {
      const g = new THREE.BoxGeometry(this.len / n - 0.02, 0.1, 1.5 + (i % 2) * 0.06);
      g.translate(-(i + 0.5) * this.len / n, -0.05, 0.15);
      planks.push(g);
    }
    for (const g of planks) { worldUV(g); setColor(g, 0xffffff); const m = new THREE.Mesh(g, game.mats.get('wood')); m.castShadow = m.receiveShadow = true; grp.add(m); }
    for (const z of [-0.55, 0.85]) {
      const beam = new THREE.BoxGeometry(this.len, 0.16, 0.12); beam.translate(-this.len / 2, -0.16, z); worldUV(beam); setColor(beam, 0xffffff);
      const m = new THREE.Mesh(beam, game.mats.get('woodDark')); m.castShadow = true; grp.add(m);
    }
    grp.position.set(x1, y, 0);
    game.scene.add(grp);
    this.mesh = grp;
    this.moving = false;
  }
  step(dt) {
    const down = this.source() > 0.9;
    const target = down ? 0 : Math.PI / 2;
    const prev = this.angle;
    const sp = down ? 1.6 : 1.2;
    this.angle += Math.sign(target - this.angle) * Math.min(Math.abs(target - this.angle), sp * dt);
    this.solid.enabled = this.angle < 0.06;
    const moving = Math.abs(this.angle - prev) > 1e-5;
    if (moving && !this.moving) this.game.sfx('bridgeStart', this.x0);
    if (!moving && this.moving) this.game.sfx(this.angle < 0.01 ? 'bridgeSlam' : 'gateStop', this.x0);
    this.moving = moving;
    // anything standing on a rising bridge falls off
  }
  render() { this.mesh.rotation.z = -this.angle; }
  getState() { return { angle: this.angle }; }
  setState(s) { this.angle = s.angle; this.solid.enabled = this.angle < 0.06; }
}

// Rope ladder unrolled by a lever: becomes a climbable zone
export class RopeLadder {
  constructor(game, { x, y0, y1, z = 0.1, vine }) {
    this.game = game; this.vine = vine; this.x = x; this.y0 = y0; this.y1 = y1;
    this.t = 0; this.target = 0;
    vine.enabled = false;
    const grp = new THREE.Group();
    const len = y1 - y0;
    for (const sx of [-0.25, 0.25]) {
      const r = new THREE.CylinderGeometry(0.018, 0.018, len, 6); r.translate(sx, -len / 2, 0); worldUV(r); setColor(r, 0xffffff);
      grp.add(new THREE.Mesh(r, game.mats.get('ropeMat')));
    }
    const rungs = Math.floor(len / 0.32);
    for (let i = 0; i < rungs; i++) {
      const g = new THREE.CylinderGeometry(0.025, 0.025, 0.56, 6); g.rotateZ(Math.PI / 2); g.translate(0, -0.2 - i * 0.32, 0); worldUV(g); setColor(g, 0xffffff);
      grp.add(new THREE.Mesh(g, game.mats.get('woodDark')));
    }
    grp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    grp.position.set(x, y1, z);
    game.scene.add(grp);
    this.mesh = grp;
    this.len = len;
  }
  release() { this.target = 1; this.game.sfx('ladder', this.x); }
  step(dt) {
    this.t = Math.min(this.target, this.t + dt * 1.2);
    this.vine.enabled = this.t > 0.98;
  }
  render() {
    const k = Math.max(0.02, this.t);
    this.mesh.scale.y = k;
    this.mesh.rotation.z = Math.sin(this.game.time * 1.3) * 0.01 * k;
  }
  getState() { return { t: this.t, target: this.target }; }
  setState(s) { this.t = s.t; this.target = s.target; this.vine.enabled = this.t > 0.98; }
}
