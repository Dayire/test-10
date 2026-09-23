import * as THREE from 'three';
import { installAtmosphereChunks, G } from './atmosphere.js';
import { RenderSystem } from './renderer.js';
import { createSky, buildEnvironment } from './sky.js';
import { TextureBaker, bakeAll } from './textures.js';
import { Materials } from './materials.js';
import { Lighting } from './lighting.js';
import { LOOK } from './look.js';

export function createWorld(canvas, { tier = 'high', texScale = 1, onProgress } = {}) {
  installAtmosphereChunks();
  const rs = new RenderSystem(canvas, tier);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(new THREE.Color(LOOK.fogColor), 0.0001);
  const sky = createSky({
    sunDir: LOOK.sunDir, zenith: LOOK.zenith, horizon: LOOK.horizon, ground: LOOK.groundCol,
    sunColor: LOOK.sunColor, cloudLit: LOOK.cloudLit, cloudShade: LOOK.cloudShade, exposure: LOOK.skyExposure,
  });
  scene.add(sky.mesh);
  const env = buildEnvironment(rs.renderer, sky.mesh);
  const baker = new TextureBaker(rs.renderer, { scale: texScale * rs.q.tex });
  const tex = bakeAll(baker, undefined, onProgress);
  Materials.envScale = LOOK.envIntensity;
  const mats = new Materials(tex, env);
  const light = new Lighting(scene, {
    sunDir: LOOK.sunDir, sunColor: LOOK.sunColor, sunIntensity: LOOK.sunIntensity,
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
  return { rs, scene, sky, env, tex, mats, light };
}

const _v = new THREE.Vector3();
// per-frame update of the shared atmosphere uniforms
export function updateAtmosphere(world, camera, time) {
  G.uTime.value = time;
  world.sky.uniforms.uTime.value = time;
  camera.updateMatrixWorld();
  const view = camera.matrixWorldInverse;
  _v.copy(LOOK.sunDir).transformDirection(view);
  G.uSunDirV.value.copy(_v);
  _v.set(0, 1, 0).transformDirection(view);
  G.uUpV.value.copy(_v);
  G.uFogParams.value.w = camera.position.y;
  // sun screen position for god rays
  const p = world.rs.post.params;
  const sp = _v.copy(camera.position).addScaledVector(LOOK.sunDir, 500).project(camera);
  const inFront = LOOK.sunDir.dot(camera.getWorldDirection(new THREE.Vector3())) > 0;
  p.sunScreen.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
  const off = Math.max(Math.abs(sp.x), Math.abs(sp.y));
  p.sunVisible = inFront ? THREE.MathUtils.clamp(1.6 - off, 0, 1) : 0;
}
