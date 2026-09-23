import * as THREE from 'three';
import { NOISE3 } from './glsl.js';

// Procedural golden-hour sky with drifting cumulus, used both as the visible
// backdrop and as the source of the PBR environment map.
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
uniform vec3 uSunDir, uZenith, uHorizon, uGround, uSunColor, uCloudLit, uCloudShade;
uniform float uTime, uExposure, uSunDisk;
varying vec3 vDir;
${NOISE3}
float cloudField(vec2 p){
  float c = fbm3(vec3(p, uTime * .01));
  c += .35 * (fbm3(vec3(p * 2.7 + 3.1, uTime * .02)) - .5);
  return c;
}
void main(){
  vec3 d = normalize(vDir);
  float el = d.y;
  float h = max(el, 0.);
  vec3 col = mix(uHorizon, uZenith, pow(h, .5));
  float sd = max(dot(d, uSunDir), 0.);
  col += uSunColor * (pow(sd, 6.) * .45 + pow(sd, 32.) * .6) * smoothstep(-.05, .1, el);
  col += uSunColor * pow(sd, 1600.) * 60. * uSunDisk;
  if (el > 0.) {
    vec2 p = d.xz / (el + .12) * 1.1 + vec2(uTime * .006, uTime * .002);
    float c = cloudField(p);
    float cov = smoothstep(.42, .7, c) * smoothstep(.0, .18, el);
    float c2 = cloudField(p + uSunDir.xz * .09);
    float lit = sat(.55 + (c - c2) * 3.5);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSunColor * pow(sd, 5.) * .6 * (1. - smoothstep(.5, .9, c)); // silver lining
    col = mix(col, cc, cov * .95);
  }
  col = mix(col, uGround, smoothstep(.0, -.12, el));
  gl_FragColor = vec4(col * uExposure, 1.);
}`.replace('uniform vec3 uSunDir', 'float sat(float x){return clamp(x,0.,1.);}\nuniform vec3 uSunDir'),
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.scale.setScalar(900);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
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
  clone.scale.setScalar(50);
  scene.add(clone);
  const rt = pmrem.fromScene(scene, 0, 0.1, 100);
  pmrem.dispose();
  clone.material.dispose();
  return rt.texture;
}
