import * as THREE from 'three';

const O = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

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
    this._tmp = new THREE.Vector3(); this._lp = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._mi = new THREE.Matrix4();
  }

  // half-width of the sun's shadow frustum in metres (a chapter's L.shadowExtent; the loader passes 22 otherwise)
  setExtent(e) {
    e = +e;
    if (!(e > 0) || e === this.extent) return;
    this.extent = e;
    const s = this.sun.shadow.camera;
    s.left = -e; s.right = e; s.top = e * 0.8; s.bottom = -e * 0.8;
    s.updateProjectionMatrix();
  }

  setShadowSize(n) {
    if (this.sun.shadow.mapSize.x === n) return;
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  update(focus) {
    // light-space basis (scratch vectors: this runs every frame)
    const d = this.sunDir;
    const up = Math.abs(d.y) > 0.99 ? X : Y;
    this._m.lookAt(O, this._tmp.copy(d).negate(), up);
    this._mi.copy(this._m).invert();
    // snap focus in light space
    const texel = (2 * this.extent) / this.sun.shadow.mapSize.x;
    const lp = this._lp.copy(focus).applyMatrix4(this._mi);
    lp.x = Math.round(lp.x / texel) * texel;
    lp.y = Math.round(lp.y / texel) * texel;
    const snapped = lp.applyMatrix4(this._m);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(d, 80);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
  }
}
