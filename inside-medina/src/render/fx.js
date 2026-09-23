import * as THREE from 'three';

// Small pooled effects: dust puffs (landings, crate impacts, footfalls) and
// pigeons that scatter when the boy runs close.

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Dust {
  constructor(scene, n = 48) {
    this.pool = [];
    const tex = puffTexture();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xc7a882, transparent: true, depthWrite: false, opacity: 0 }));
      m.visible = false; m.userData = { t: 1, life: 1, v: new THREE.Vector3(), s0: 0.2, s1: 0.8, a: 0.4 };
      scene.add(m); this.pool.push(m);
    }
    this.i = 0;
  }
  emit(pos, { count = 8, spread = 0.5, up = 0.6, life = 0.9, size = 0.5, alpha = 0.35, color = 0xc7a882 } = {}) {
    for (let k = 0; k < count; k++) {
      const m = this.pool[this.i++ % this.pool.length];
      const u = m.userData;
      m.position.set(pos.x + (Math.random() - 0.5) * 0.3, pos.y + 0.05, pos.z + (Math.random() - 0.5) * 0.3);
      const a = Math.random() * Math.PI * 2;
      u.v.set(Math.cos(a) * spread * (0.5 + Math.random()), up * (0.3 + Math.random() * 0.7), Math.sin(a) * spread * 0.6);
      u.t = 0; u.life = life * (0.7 + Math.random() * 0.6); u.s0 = size * 0.4; u.s1 = size * (1 + Math.random()); u.a = alpha;
      m.material.color.set(color);
      m.visible = true;
    }
  }
  update(dt) {
    for (const m of this.pool) {
      if (!m.visible) continue;
      const u = m.userData;
      u.t += dt / u.life;
      if (u.t >= 1) { m.visible = false; continue; }
      u.v.multiplyScalar(Math.exp(-2.5 * dt)); u.v.y -= 0.15 * dt;
      m.position.addScaledVector(u.v, dt);
      const s = u.s0 + (u.s1 - u.s0) * Math.sqrt(u.t);
      m.scale.set(s, s, s);
      m.material.opacity = u.a * Math.sin(Math.min(1, u.t * 1.4) * Math.PI) * (1 - u.t * 0.4);
    }
  }
}

// --- pigeons -----------------------------------------------------------------
function pigeonGeometry() {
  const body = new THREE.SphereGeometry(0.1, 10, 8); body.scale(0.8, 0.75, 1.6);
  const head = new THREE.SphereGeometry(0.055, 8, 6); head.translate(0, 0.07, 0.14);
  const tail = new THREE.ConeGeometry(0.05, 0.14, 6); tail.rotateX(-Math.PI / 2 - 0.3); tail.translate(0, 0.02, -0.19);
  return [body, head, tail];
}

export class Flock {
  constructor(scene, mats, spots) {
    this.birds = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x7c7a82, roughness: 0.8 });
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x5f5c66, roughness: 0.85, side: THREE.DoubleSide });
    const parts = pigeonGeometry();
    const wingG = new THREE.BufferGeometry();
    wingG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0.32, 0, -0.02, 0, 0, -0.1], 3));
    wingG.computeVertexNormals();
    for (const s of spots) {
      for (let i = 0; i < s.n; i++) {
        const g = new THREE.Group();
        for (const p of parts) { const m = new THREE.Mesh(p, mat); m.castShadow = true; g.add(m); }
        const wl = new THREE.Mesh(wingG, wingMat), wr = new THREE.Mesh(wingG, wingMat);
        wr.scale.x = -1; g.add(wl, wr);
        const home = new THREE.Vector3(s.x + (Math.random() - 0.5) * s.w, s.y, s.z + (Math.random() - 0.5) * 0.8);
        g.position.copy(home);
        g.rotation.y = Math.random() * Math.PI * 2;
        scene.add(g);
        this.birds.push({ g, wl, wr, home, state: 'idle', t: Math.random() * 5, v: new THREE.Vector3(), peck: Math.random() * 3, flap: 0 });
      }
    }
  }
  reset() { for (const b of this.birds) { b.state = 'idle'; b.g.position.copy(b.home); b.g.visible = true; b.wl.rotation.z = 0; b.wr.rotation.z = 0; } }
  update(dt, px, py, speed, onScatter) {
    for (const b of this.birds) {
      b.t += dt;
      if (b.state === 'idle') {
        // peck and shuffle
        b.peck -= dt;
        if (b.peck < 0) { b.peck = 0.6 + Math.random() * 2.5; b.g.rotation.y += (Math.random() - 0.5) * 1.2; }
        b.g.children[1].position.y = Math.max(0, Math.sin(b.t * 9) * 0.03) * (b.peck < 0.3 ? 1 : 0);
        b.wl.rotation.z = 0.05; b.wr.rotation.z = 0.05;
        const d = Math.hypot(b.home.x - px, b.home.y - py);
        if (d < (speed > 2.5 ? 3.2 : 1.6)) {
          b.state = 'fly'; b.t = 0;
          const dir = Math.sign(b.home.x - px) || 1;
          b.v.set(dir * (2.2 + Math.random() * 1.5), 3.2 + Math.random() * 1.5, -1.5 - Math.random() * 2.5);
          b.g.rotation.y = Math.atan2(b.v.x, b.v.z);
          onScatter && onScatter(b.home.x);
        }
      } else if (b.state === 'fly') {
        b.v.y += 0.8 * dt;
        b.g.position.addScaledVector(b.v, dt);
        const f = Math.sin(b.t * 38);
        b.wl.rotation.z = f * 1.1; b.wr.rotation.z = f * 1.1;
        if (b.t > 5) { b.state = 'gone'; b.g.visible = false; }
      }
    }
  }
}
