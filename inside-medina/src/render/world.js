import * as THREE from 'three';
import { installAtmosphereChunks, G } from './atmosphere.js';
import { RenderSystem } from './renderer.js';
import { createSky, buildEnvironment } from './sky.js';
import { TextureBaker, bakeAll, bakeAsync } from './textures.js';
import { Materials } from './materials.js';
import { Lighting } from './lighting.js';
import { LOOK } from './look.js';
import { Overrides } from '../assets/library.js';

// a software rasteriser (SwiftShader, llvmpipe): every present is expensive there
export function isSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch { return false; }
}

// bake: true bakes every surface now (dev views); false leaves it to world.bake(names)
export function createWorld(canvas, { tier = 'high', texScale = 1, onProgress, bake = true } = {}) {
  installAtmosphereChunks();
  const rs = new RenderSystem(canvas, tier);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(LOOK.fogColor), 0.0001);
  const sunDir = LOOK.sunDir.clone(); // the LookDirector writes this; everything reads it
  const sky = createSky({
    sunDir, zenith: LOOK.zenith, horizon: LOOK.horizon, ground: LOOK.groundCol,
    sunColor: LOOK.sunColor, cloudLit: LOOK.cloudLit, cloudShade: LOOK.cloudShade, exposure: LOOK.skyExposure,
  });
  scene.add(sky.mesh);
  const env = buildEnvironment(rs.renderer, sky.mesh);
  const baker = new TextureBaker(rs.renderer, { scale: texScale * rs.q.tex });
  const tex = bake ? bakeAll(baker, undefined, onProgress) : {};
  Materials.envScale = LOOK.envIntensity;
  const mats = new Materials(tex, env, { baker });
  const light = new Lighting(scene, {
    sunDir, sunColor: LOOK.sunColor, sunIntensity: LOOK.sunIntensity,
    skyColor: LOOK.hemiSky, groundColor: LOOK.hemiGround, hemiIntensity: LOOK.hemiIntensity,
    shadowSize: rs.q.shadow, shadowExtent: 22,
  });
  G.uFogSunColor.value.set(LOOK.fogSunColor);
  G.uFogParams.value.set(LOOK.fogDensity, LOOK.fogFalloff, 0, 0);
  G.uFogStart.value = LOOK.fogStart;
  const p = rs.post.params;
  const lp = LOOK.post;
  Object.assign(p, { exposure: lp.exposure, bloom: lp.bloom, bloomThreshold: lp.bloomThreshold, vignette: lp.vignette, grain: lp.grain, saturation: lp.saturation, contrast: lp.contrast });
  p.shadowTint.setRGB(...lp.shadowTint); p.highlightTint.setRGB(...lp.highlightTint); p.lift.setRGB(...lp.lift);
  rs.onTierChange = (t, q) => light.setShadowSize(q.shadow);
  const world = { rs, scene, sky, env, tex, mats, light, baker, sunDir };
  world.rebuildEnvironment = () => rebuildEnvironment(world);
  // progressive bake of the surfaces a chapter needs, each slice followed by a painted frame. On a GPU a frame
  // is cheap, so a slice is about one surface per frame (16 ms on touch devices, 33 ms on desktop) and input and
  // menus stay responsive; a software rasteriser pays dearly for every present, so it bakes in 200 ms slices.
  world.software = isSoftwareGL(rs.renderer);
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries */ }
  world.bakeSlice = world.software ? 200 : coarse ? 16 : 33;
  world.bake = (names, onProgress, slice = world.bakeSlice) => bakeAsync(baker, names.filter((n) => !tex[n]), onProgress, tex, slice);
  return world;
}

// re-bake the PMREM from the current sky uniforms (after a time-of-day change)
export function rebuildEnvironment(world) {
  const old = world.env;
  world.env = buildEnvironment(world.rs.renderer, world.sky.mesh);
  world.mats.setEnv(world.env);
  // materials outside the cache that sample the old map: GLB override templates (and their placed clones),
  // and any chapter material that took world.env
  if (old && old !== world.env) {
    if (Overrides.envMap === old) Overrides.envMap = world.env;
    const swap = (o) => { const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of list) if (m.envMap === old) { m.envMap = world.env; } };
    for (const root of Overrides.models.values()) root.traverse(swap);
    world.scene.traverse(swap);
  }
  // the PMREM texture belongs to a render target: disposing the texture alone leaks the target
  if (old && old !== world.env) { if (old.renderTarget) old.renderTarget.dispose(); else old.dispose(); }
  return world.env;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
// per-frame update of the shared atmosphere uniforms
export function updateAtmosphere(world, camera, time) {
  const sun = world.sunDir || LOOK.sunDir;
  G.uTime.value = time;
  world.sky.uniforms.uTime.value = time;
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;
  _v.copy(sun).transformDirection(view);
  G.uSunDirV.value.copy(_v);
  _v.set(0, 1, 0).transformDirection(view);
  G.uUpV.value.copy(_v);
  G.uFogParams.value.w = camera.position.y;
  // sun screen position for god rays
  const p = world.rs.post.params;
  const sp = _v.copy(camera.position).addScaledVector(sun, 500).project(camera);
  const inFront = sun.dot(camera.getWorldDirection(_d)) > 0;
  p.sunScreen.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
  p.sunVisible = inFront ? THREE.MathUtils.clamp(1.6 - off, 0, 1) : 0;
}
