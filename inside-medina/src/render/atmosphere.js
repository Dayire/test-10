import * as THREE from 'three';

// Global uniforms shared by every patched material (fog, wind, sun).
export const G = {
  uTime: { value: 0 },
  uSunDirV: { value: new THREE.Vector3(0, 1, 0) }, // sun direction in view space
  uUpV: { value: new THREE.Vector3(0, 1, 0) },     // world up in view space
  uFogSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uFogParams: { value: new THREE.Vector4(0.02, 0.08, 0.0, 0.0) }, // density, heightFalloff, baseHeight, cameraY
  uFogStart: { value: 4.0 },
  uWind: { value: new THREE.Vector3(1, 0, 0.2) },
  uWindStrength: { value: 1.0 },
  uSunColorW: { value: new THREE.Color(1, 0.85, 0.6) },
};

let installed = false;
export function installAtmosphereChunks() {
  if (installed) return; installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogPos;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogPos = mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogPos;
  uniform vec3 uSunDirV;
  uniform vec3 uUpV;
  uniform vec3 uFogSunColor;
  uniform vec4 uFogParams;
  uniform float uFogStart;
  vec3 applyAtmosphere(vec3 col, vec3 viewPos){
    float dist = length(viewPos);
    vec3 dir = viewPos / max(dist, 1e-4);
    float d = max(dist - uFogStart, 0.);
    float k = uFogParams.y;
    float camH = uFogParams.w - uFogParams.z;
    float dh = dot(dir, uUpV) * d;
    // optical depth of an exponential height fog between camera and point
    float od = uFogParams.x * exp(-k * camH) * d;
    od *= abs(k * dh) > 1e-3 ? (1. - exp(-k * dh)) / (k * dh) : 1.;
    float amt = 1. - exp(-max(od, 0.));
    float sunAmt = pow(max(dot(dir, uSunDirV), 0.), 5.);
    vec3 fc = mix(fogColor, uFogSunColor, sunAmt * .85);
    return mix(col, fc, amt);
  }
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = applyAtmosphere(gl_FragColor.rgb, vFogPos);
#endif`;
}

// Patch a built-in material so that it receives the shared uniforms and
// optional features: per-material UV scale, wind sway, backlit translucency.
export function patchMaterial(mat, opts = {}) {
  const uvScale = opts.uvScale ?? 1;
  mat.userData.uvScale = { value: new THREE.Vector2(uvScale, uvScale) };
  mat.userData.transl = { value: opts.translucency ?? 0 };
  mat.userData.translColor = { value: new THREE.Color(opts.translucencyColor ?? 0xffffff) };
  mat.userData.sway = { value: opts.sway ?? 0 };
  const defines = mat.defines || (mat.defines = {});
  if (opts.sway) defines.USE_WIND = '';
  if (opts.translucency) defines.USE_TRANSLUCENCY = '';
  if (opts.uvScale !== undefined && opts.uvScale !== 1) defines.USE_UVSCALE = '';
  const key = `${opts.sway ? 'w' : ''}${opts.translucency ? 't' : ''}${defines.USE_UVSCALE !== undefined ? 'u' : ''}`;
  mat.customProgramCacheKey = () => `medina-${key}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uSunDirV: G.uSunDirV, uUpV: G.uUpV, uFogSunColor: G.uFogSunColor, uFogParams: G.uFogParams,
      uFogStart: G.uFogStart, uTime: G.uTime, uWind: G.uWind, uWindStrength: G.uWindStrength,
      uUvScale: mat.userData.uvScale, uTransl: mat.userData.transl, uTranslColor: mat.userData.translColor,
      uSway: mat.userData.sway,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec2 uUvScale; uniform float uTime; uniform vec3 uWind; uniform float uWindStrength; uniform float uSway;
#ifdef USE_WIND
attribute float sway;
#endif`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_UVSCALE
#ifdef USE_MAP
  vMapUv *= uUvScale;
#endif
#ifdef USE_NORMALMAP
  vNormalMapUv *= uUvScale;
#endif
#ifdef USE_ROUGHNESSMAP
  vRoughnessMapUv *= uUvScale;
#endif
#ifdef USE_METALNESSMAP
  vMetalnessMapUv *= uUvScale;
#endif
#ifdef USE_AOMAP
  vAoMapUv *= uUvScale;
#endif
#ifdef USE_ALPHAMAP
  vAlphaMapUv *= uUvScale;
#endif
#endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_WIND
  {
    vec4 wp0 = vec4(transformed, 1.);
    #ifdef USE_INSTANCING
      wp0 = instanceMatrix * wp0;
    #endif
    wp0 = modelMatrix * wp0;
    float ph = dot(wp0.xyz, vec3(.7, .3, .5));
    float gust = .6 + .4 * sin(uTime * .7 + wp0.x * .05);
    vec3 disp = uWind * (sin(uTime * 1.9 + ph * 1.7) * .6 + sin(uTime * 3.7 + ph * 3.1) * .3) * gust;
    disp.y += sin(uTime * 2.3 + ph * 2.) * .15 * length(uWind);
    transformed += disp * sway * uSway * uWindStrength;
  }
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTransl; uniform vec3 uTranslColor;`)
      .replace('#include <lights_fragment_begin>', `#include <lights_fragment_begin>
#if defined(USE_TRANSLUCENCY) && NUM_DIR_LIGHTS > 0
  {
    // light passing through thin surfaces (leaves, cloth) when backlit by the sun
    vec3 L = directLight.direction;
    float back = max(dot(-normal, L), 0.) + max(dot(normal, L), 0.) * .0;
    float vd = pow(max(dot(normalize(vViewPosition), -L), 0.), 2.) * .8 + .2;
    reflectedLight.directDiffuse += diffuseColor.rgb * uTranslColor * directLight.color * back * vd * uTransl;
  }
#endif`);
  };
  return mat;
}
