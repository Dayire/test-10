import * as THREE from 'three';
import { NOISE3 } from './glsl.js';

// Procedural sky with drifting cumulus, used both as the visible backdrop and as the source of
// the PBR environment map. Night adds a star field and a moon; uNight = 0 is the golden-hour look.
// The dome is drawn after every opaque object (renderOrder) at the far plane, so early-z rejects
// every covered pixel instead of shading the whole sky first.
export const SKY_RENDER_ORDER = 1e6;

export function createSky(params) {
  const uniforms = {
    uSunDir: { value: params.sunDir.clone() },
    uZenith: { value: new THREE.Color(params.zenith) },
    uHorizon: { value: new THREE.Color(params.horizon) },
    uGround: { value: new THREE.Color(params.ground) },
    uSunColor: { value: new THREE.Color(params.sunColor) },
    uCloudLit: { value: new THREE.Color(params.cloudLit) },
    uCloudShade: { value: new THREE.Color(params.cloudShade) },
    uTime: { value: 0 },
    uExposure: { value: params.exposure ?? 1 },
    uSunDisk: { value: 1 },
    // night: 0 = day; stars 0..1; moon direction, colour and angular radius (radians)
    uNight: { value: params.night ?? 0 },
    uStars: { value: params.stars ?? 0 },
    uMoonDir: { value: (params.moonDir || new THREE.Vector3(-0.12, 0.86, -0.5)).clone().normalize() },
    uMoonColor: { value: new THREE.Color(params.moonColor ?? '#dfe7ff') },
    uMoonSize: { value: params.moonSize ?? 0.045 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position, 0.)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.);
  gl_Position = p.xyww;
}`,
    fragmentShader: /* glsl */ `
float sat(float x){ return clamp(x, 0., 1.); }
uniform vec3 uSunDir, uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudShade, uMoonDir, uMoonColor;
uniform float uTime, uExposure, uSunDisk, uNight, uStars, uMoonSize;
varying vec3 vDir;
${NOISE3}
float cloudField(vec2 p){
  float c = fbm3(vec3(p, uTime * .01));
  c += .35 * (fbm3(vec3(p * 2.7 + 3.1, uTime * .02)) - .5);
  return c;
}
float starLayer(vec3 d, float scale, float density, float size){
  vec3 p = d * scale, id = floor(p), f = fract(p) - .5;
  float h = h13(id);
  if (h < 1. - density) return 0.;
  vec3 o = vec3(h13(id + 1.3), h13(id + 2.7), h13(id + 5.1)) - .5;
  float r = length(f - o * .6);
  float tw = .65 + .35 * sin(uTime * (1.5 + h * 4.) + h * 91.);
  return smoothstep(size, 0., r) * (.35 + 2.6 * fract(h * 37.13)) * tw;
}
void main(){
  vec3 d = normalize(vDir);
  float el = d.y;
  float h = max(el, 0.);
  float day = 1. - uNight;
  vec3 col = mix(uHorizon, uZenith, pow(h, .5));
  float sd = max(dot(d, uSunDir), 0.);
  col += uSunColor * (pow(sd, 6.) * .45 + pow(sd, 32.) * .6) * smoothstep(-.05, .1, el) * day;
  col += uSunColor * pow(sd, 1600.) * 60. * uSunDisk * day;
  if (uNight > 0.) {
    vec3 md = normalize(uMoonDir);
    float ang = acos(clamp(dot(d, md), -1., 1.));
    if (uStars > 0.) {
      float s = starLayer(d, 70., .022, .16) * 2.2 + starLayer(d, 160., .06, .2) + starLayer(d, 340., .12, .22) * .45;
      // a faint milky band
      float band = exp(-pow(dot(d, normalize(vec3(.3, .5, .81))) * 3.2, 2.)) * (.5 + .5 * fbm3(d * 9.));
      col += (vec3(.9, .95, 1.) * s + vec3(.55, .6, .8) * band * .05) * uStars * smoothstep(.0, .22, el) * smoothstep(uMoonSize * 4., uMoonSize * 9., ang);
    }
    // moon disc with maria and a soft halo
    float disc = smoothstep(uMoonSize, uMoonSize * .9, ang);
    vec3 t = d - md * dot(d, md);
    float maria = .78 + .22 * smoothstep(.35, .7, fbm3(t * (9. / uMoonSize) + 4.));
    float limb = .82 + .18 * sqrt(max(0., 1. - pow(ang / uMoonSize, 2.)));
    col = mix(col, uMoonColor * 2.2 * maria * limb, disc * uNight);
    col += uMoonColor * (exp(-ang / (uMoonSize * 2.5)) * .35 + exp(-ang * 3.) * .06) * uNight * (1. - disc);
  }
  if (el > 0.) {
    vec2 p = d.xz / (el + .12) * 1.1 + vec2(uTime * .006, uTime * .002);
    float c = cloudField(p);
    float cov = smoothstep(.42, .7, c) * smoothstep(.0, .18, el);
    float c2 = cloudField(p + uSunDir.xz * .09);
    float lit = sat(.55 + (c - c2) * 3.5);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunColor * pow(sd, 5.) * .6 * (1. - smoothstep(.5, .9, c)) * day; // silver lining
    if (uNight > 0.) cc += uMoonColor * pow(max(dot(d, normalize(uMoonDir)), 0.), 6.) * .35 * (1. - smoothstep(.5, .9, c)) * uNight;
    col = mix(col, cc, cov * .95);
  }
  col = mix(col, uGround, smoothstep(.0, -.12, el));
  gl_FragColor = vec4(col * uExposure, 1.);
  #include <fog_fragment>
}`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(900);
  mesh.frustumCulled = false;
  mesh.renderOrder = SKY_RENDER_ORDER;
  mesh.name = 'sky';
  return { mesh, uniforms };
}

export function buildEnvironment(renderer, skyMesh) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const clone = skyMesh.clone();
  clone.material = skyMesh.material.clone();
  clone.material.uniforms = THREE.UniformsUtils.clone(skyMesh.material.uniforms);
  clone.material.uniforms.uSunDisk.value = 0.0; // avoid fireflies in reflections
  clone.material.uniforms.uStars.value = 0.0;
  clone.scale.setScalar(50);
  scene.add(clone);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  clone.material.dispose();
  return rt.texture;
}
