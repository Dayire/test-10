import * as THREE from 'three';
import { LightPool } from './lightpool.js';

// The fixed light rig. Every chapter renders with exactly the same lights:
// one shadowed directional (sun or moon, never removed), one hemisphere, the
// character fill, N pool points (fixed at boot by device class) and two
// shadowed rig spots shared by searchlights. Lamps acquire a spot near the
// camera and release it off-screen; a free spot sits at intensity 0 without
// shadow updates. Both spots always carry a cookie map, so swapping cookies
// never recompiles. census() must be the same in every chapter.

function discCookie() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 128, 128);
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.8, '#ffffff'); g.addColorStop(1, '#b8b8b8');
  x.fillStyle = g; x.beginPath(); x.arc(64, 64, 64, 0, Math.PI * 2); x.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.name = 'cookie.disc';
  return t;
}

export class LightRig {
  constructor(scene, world, { pool = 6, tier = 'high' } = {}) {
    this.scene = scene; this.world = world;
    this.sun = world.light.sun; this.hemi = world.light.hemi;
    // subtle character fill so the boy reads in deep shade
    this.charLight = new THREE.PointLight(0xffd2a0, 1.2, 4.5, 1.5);
    this.charLight.name = 'charLight';
    scene.add(this.charLight);
    this.pool = new LightPool(scene, pool);
    this.cookies = { disc: discCookie() };
    this.cookie = this.cookies.disc;
    this.spots = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xfff0d0, 0, 60, 0.11, 0.35, 1.5);
      s.name = `rigSpot${i}`;
      s.castShadow = true;
      // render each shadow map once so a free spot never samples a missing depth map
      s.shadow.autoUpdate = false; s.shadow.needsUpdate = true;
      s.shadow.bias = -0.0004; s.shadow.normalBias = 0.03;
      s.shadow.camera.near = 5; s.shadow.camera.far = 80;
      s.map = this.cookie;
      s.userData.owner = null;
      s.position.set(0, -50, 0); s.target.position.set(0, -60, 0);
      scene.add(s, s.target);
      this.spots.push(s);
    }
    this.setTier(tier);
  }

  textures() { return Object.values(this.cookies); }

  acquireSpot(owner) {
    let s = this.spots.find((x) => x.userData.owner === owner);
    if (s) return s;
    s = this.spots.find((x) => !x.userData.owner);
    if (!s) return null;
    s.userData.owner = owner; s.shadow.autoUpdate = true; s.shadow.needsUpdate = true;
    return s;
  }
  releaseSpot(owner) {
    for (const s of this.spots) {
      if (s.userData.owner !== owner) continue;
      s.userData.owner = null; s.intensity = 0; s.shadow.autoUpdate = false;
    }
  }
  releaseAll() { for (const s of this.spots) this.releaseSpot(s.userData.owner); }
  spotOwners() { return this.spots.map((s) => s.userData.owner); }
  // cookie for both spots: null = the soft disc (Chapter III sets its star lattice)
  setCookie(tex) { this.cookie = tex || this.cookies.disc; for (const s of this.spots) s.map = this.cookie; }

  setTier(tier) {
    const n = tier === 'high' || tier === 'ultra' ? 2048 : 1024;
    for (const s of this.spots) {
      if (s.shadow.mapSize.x === n) continue;
      s.shadow.mapSize.set(n, n);
      if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
      s.shadow.needsUpdate = true;
    }
  }

  // light counts by type in the whole scene (must be constant across chapters)
  census() {
    const c = { dir: 0, hemi: 0, point: 0, spot: 0 };
    this.scene.traverse((o) => {
      if (!o.isLight) return;
      if (o.isDirectionalLight) c.dir++; else if (o.isHemisphereLight) c.hemi++;
      else if (o.isPointLight) c.point++; else if (o.isSpotLight) c.spot++;
      else c[o.type] = (c[o.type] || 0) + 1;
    });
    return c;
  }
}
