import * as THREE from 'three';
import { PostFX } from './post.js';

export const QUALITY = {
  ultra: { name: 'ultra', scale: 1.5, msaa: 4, shadow: 4096, dof: true, dofTaps: 48, rays: true, tex: 1 },
  high: { name: 'high', scale: 1.25, msaa: 4, shadow: 2048, dof: true, dofTaps: 36, rays: true, tex: 1 },
  medium: { name: 'medium', scale: 1.0, msaa: 2, shadow: 2048, dof: true, dofTaps: 24, rays: true, tex: 1 },
  low: { name: 'low', scale: 0.75, msaa: 0, shadow: 1024, dof: false, dofTaps: 16, rays: false, tex: 0.5 },
};
export const TIERS = ['low', 'medium', 'high', 'ultra'];

export class RenderSystem {
  constructor(canvas, tier = 'high') {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.LinearSRGBColorSpace; // final pass encodes to sRGB itself
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.tier = tier;
    this.q = { ...QUALITY[tier] };
    this.post = new PostFX(r, this.q);
    this.frameTimes = [];
    this.autoQuality = true;
    this.onTierChange = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(dpr, this.q.scale);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(w * scale), Math.round(h * scale), false);
    this.w = Math.round(w * scale); this.h = Math.round(h * scale);
    this.cssW = w; this.cssH = h;
    this.post.setSize(this.w, this.h);
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  setTier(tier) {
    if (tier === this.tier) return;
    this.tier = tier;
    const keepParams = this.post.params;
    this.post.dispose();
    this.q = { ...QUALITY[tier] };
    this.post = new PostFX(this.renderer, this.q);
    Object.assign(this.post.params, keepParams);
    this.resize();
    this.onTierChange && this.onTierChange(tier, this.q);
  }

  // adaptive quality: step down when frames are consistently slow
  trackFrame(dtMs) {
    if (!this.autoQuality) return;
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length < 120) return;
    const s = [...this.frameTimes].sort((a, b) => a - b);
    const p50 = s[Math.floor(s.length * 0.5)];
    this.frameTimes.length = 0;
    const idx = TIERS.indexOf(this.tier);
    if (p50 > 24 && idx > 0) this.setTier(TIERS[idx - 1]);
  }

  render(scene, camera, time) {
    this.renderer.info.reset();
    this.post.render(scene, camera, time);
  }
}
