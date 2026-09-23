import * as THREE from 'three';
import { installAtmosphereChunks } from '../render/atmosphere.js';
import { TextureBaker, bakeAll, SURFACE_NAMES } from '../render/textures.js';

export async function runTextureView(canvas) {
  installAtmosphereChunks();
  const q = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const baker = new TextureBaker(renderer, { scale: +(q.get('tex') || 0.25) });
  const names = (q.get('only') || '').split(',').filter(Boolean);
  const list = names.length ? names : SURFACE_NAMES;
  const tex = bakeAll(baker, list);
  const pass = q.get('pass') || 'map';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  const cols = Math.ceil(Math.sqrt(list.length * 16 / 9));
  const rows = Math.ceil(list.length / cols);
  const cam = new THREE.OrthographicCamera(0, cols, rows, 0, -1, 1);
  list.forEach((n, i) => {
    const m = new THREE.MeshBasicMaterial({ map: tex[n][pass], transparent: pass === 'map' });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), m);
    mesh.position.set((i % cols) + 0.5, rows - Math.floor(i / cols) - 0.5, 0);
    scene.add(mesh);
  });
  renderer.setRenderTarget(null);
  renderer.render(scene, cam);
  window.__frames = 1;
  window.__ready = true;
  const loop = () => { renderer.render(scene, cam); window.__frames++; requestAnimationFrame(loop); };
  loop();
}
