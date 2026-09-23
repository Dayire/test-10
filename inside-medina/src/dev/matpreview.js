import * as THREE from 'three';
import { createWorld, updateAtmosphere } from '../render/world.js';
import { MATERIAL_DEFS } from '../render/materials.js';
import { worldUV, setColor } from '../assets/geom.js';

export async function runMaterialPreview(canvas) {
  const q = new URLSearchParams(location.search);
  const world = createWorld(canvas, { tier: q.get('tier') || 'high', texScale: +(q.get('tex') || 1) });
  const { scene, mats, rs, light } = world;
  const camera = new THREE.PerspectiveCamera(35, rs.cssW / rs.cssH, 0.1, 2000);
  rs.camera = camera;
  camera.position.set(0, 2.2, 15);
  camera.lookAt(0, 1.6, 0);
  const names = Object.keys(MATERIAL_DEFS).filter((n) => MATERIAL_DEFS[n].surf);
  const cols = 8;
  names.forEach((n, i) => {
    const m = mats.get(n);
    const x = (i % cols - (cols - 1) / 2) * 2.1;
    const y = 0.5 + Math.floor(i / cols) * 2.1;
    let g;
    if (n === 'ivy' || n === 'grass' || n === 'lattice' || n === 'rug') g = new THREE.PlaneGeometry(1.7, 1.7);
    else g = worldUV(new THREE.BoxGeometry(1.7, 1.7, 0.6, 1, 1, 1));
    if (n === 'ivy' || n === 'grass' || n === 'rug' || n === 'lattice') {
      const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), uv.getY(k));
      m.userData.uvScale.value.set(1, 1);
    }
    setColor(g, 0xffffff);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, 0);
    mesh.rotation.y = -0.25;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  });
  const white = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.8, envMap: world.env }));
  white.position.set(-6, 0.3, 3); white.castShadow = true; scene.add(white);
  const chrome = new THREE.Mesh(new THREE.SphereGeometry(0.8, 48, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, metalness: 1, envMap: world.env }));
  chrome.position.set(6, 0.3, 3); scene.add(chrome);
  const ground = new THREE.Mesh(setColor(worldUV(new THREE.BoxGeometry(40, 0.2, 20)), 0xffffff), mats.get('cobbles'));
  ground.position.set(0, -0.6, -2); ground.receiveShadow = true; scene.add(ground);
  const back = new THREE.Mesh(setColor(worldUV(new THREE.BoxGeometry(40, 10, 0.5)), 0xffffff), mats.get('plasterBlue'));
  back.position.set(0, 4, -4); back.receiveShadow = true; back.castShadow = true; scene.add(back);
  let t = 0;
  const frame = () => {
    t += 1 / 60;
    light.update(new THREE.Vector3(0, 2, 0));
    updateAtmosphere(world, camera, t);
    rs.render(scene, camera, t);
    window.__frames = (window.__frames || 0) + 1;
    requestAnimationFrame(frame);
  };
  frame();
  window.__ready = true;
}
