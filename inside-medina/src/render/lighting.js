import * as THREE from 'three';

// Sun + sky fill. The shadow frustum follows the camera focus and is snapped
// to shadow-map texels so shadows never shimmer while scrolling.
export class Lighting {
  constructor(scene, p) {
    this.p = p;
    this.sunDir = p.sunDir.clone().normalize();
    this.sun = new THREE.DirectionalLight(p.sunColor, p.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(p.shadowSize, p.shadowSize);
    const s = this.sun.shadow.camera;
    this.extent = p.shadowExtent || 20;
    s.left = -this.extent; s.right = this.extent; s.top = this.extent * 0.8; s.bottom = -this.extent * 0.8;
    s.near = 1; s.far = 180;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(p.skyColor, p.groundColor, p.hemiIntensity);
    scene.add(this.hemi);
    this._tmp = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._mi = new THREE.Matrix4();
  }

  setShadowSize(n) {
    if (this.sun.shadow.mapSize.x === n) return;
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  update(focus) {
    // light-space basis
    const d = this.sunDir;
    const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    this._m.lookAt(new THREE.Vector3(0, 0, 0), d.clone().negate(), up);
    this._mi.copy(this._m).invert();
    // snap focus in light space
    const texel = (2 * this.extent) / this.sun.shadow.mapSize.x;
    const lp = focus.clone().applyMatrix4(this._mi);
    lp.x = Math.round(lp.x / texel) * texel;
    lp.y = Math.round(lp.y / texel) * texel;
    const snapped = lp.applyMatrix4(this._m);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(d, 80);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
}
