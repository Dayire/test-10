import * as THREE from 'three';

// Render layers. Objects on BEAMS (beams, sun shafts, haze, soft particles) are drawn after
// the opaque scene in a second "soft" pass that can read the scene depth, so additive
// volumes fade where they meet geometry instead of cutting hard lines into it.
// Materials on BEAMS must not use scene lights (ShaderMaterial / MeshBasicMaterial): the soft pass
// draws through a scene of its own that sees no lights.
// Every custom shader, on any layer, ends its fragment shader with `#include <fog_fragment>`: in the
// LDR fallback (no float render targets) that chunk stores the colour Reinhard-encoded and the post
// chain decodes it, so a shader without it comes out too bright there.
export const LAYERS = { DEFAULT: 0, BEAMS: 3 };

// Shared uniforms of the soft pass, updated by PostFX every frame. Spread them into a
// ShaderMaterial's uniforms ({ ...SOFT, uColor: … }) and include SOFT_GLSL in its fragment shader:
//   `${SOFT_GLSL} void main(){ … gl_FragColor = vec4(c * softFade(.6), 1.); #include <fog_fragment> }`
// uDepth is null (an empty texture) whenever the soft pass is off, so no material ever samples
// a depth texture that is attached to the framebuffer it draws into.
export const SOFT = {
  uDepth: { value: null },
  uRes: { value: new THREE.Vector2(1, 1) },      // allocated size of the depth texture (gl_FragCoord → uv)
  uNearFar: { value: new THREE.Vector2(0.1, 1000) },
  uSoftOn: { value: 0 },
};

export const SOFT_GLSL = /* glsl */ `
uniform sampler2D uDepth; uniform vec2 uRes; uniform vec2 uNearFar; uniform float uSoftOn;
float softLinear(float d){ return uNearFar.x * uNearFar.y / (uNearFar.y - d * (uNearFar.y - uNearFar.x)); }
// 0 where the fragment touches opaque geometry, 1 once it is \`range\` metres in front of it
float softFade(float range){
  if (uSoftOn < .5) return 1.;
  float scene = softLinear(texture2D(uDepth, gl_FragCoord.xy / uRes).x);
  return clamp((scene - softLinear(gl_FragCoord.z)) / range, 0., 1.);
}
// fade volumes that get closer than \`near\` metres to the camera (avoids slabs filling the screen)
float softNear(float near){ return smoothstep(near * .35, near, softLinear(gl_FragCoord.z)); }
`;

export function softUniforms(extra = {}) { return { ...SOFT, ...extra }; }

// put an object (and its children) on the beams layer only
export function toBeams(obj) { obj.traverse((o) => o.layers.set(LAYERS.BEAMS)); return obj; }
