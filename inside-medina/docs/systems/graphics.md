# Graphics and performance (package P)

Owner files: `src/render/{renderer,post,dynres,shadowpolicy,layers,fxaa,ssao,flare,lut,particles,fx,shafts,sky,lighting,atmosphere,glsl}.js`,
`tools/perf.mjs`. The plan is FULL_GAME §9.2 (tiers), §8.5 (budgets) and §11.4 P; this page is how it is built and how to use it.

## Frame

```
rs.beginFrame(now) ─ false → skip the rAF callback (frame cap)
rs.render(scene, camera, time)
  particles.update · shadow policy (30 Hz maps, snaps, spot culling, small casters)
  scene → rtScene (MSAA, half float; RGBA8 + Reinhard encode without float targets)
         sky dome last among opaques (early-z)          layer 0
  soft pass → rtScene, scene depth bound as SOFT.uDepth layer BEAMS (3): shafts, beams, particles,
         drawn through post.softScene (the scene's own children, no lights: see below)
  SSAO (half res, high/ultra) → bloom chain (6 levels) → lens flare → DOF (half res) → god rays
  final grade (ACES, tints, S-curve, lift, gamma, LUT crossfade, vignette, letterbox, fade)
  output pass: FXAA + CAS upscale + grain at canvas resolution (when FXAA is on or scale < 1)
rs.trackFrame(ms, {paused, hidden}) → dynamic resolution, auto quality
```

Every post target is allocated once at the tier's maximum internal size. Dynamic resolution renders
into a viewport sub-rect of those targets, and every pass maps uv through its source's extent and
clamps its taps inside it, so a scale change never reallocates or recompiles.

**The soft pass and the light state.** three keys its light state by scene, and the camera's layers
decide which lights a render collects. Drawing the soft pass through the main scene with the camera on
`BEAMS` would collect no lights, change the light state twice a frame and send every lit material down the
program re-validation path (parameters, cache key, a full uniform upload) every frame. So the soft pass
renders `post.softScene`, a scene that shares the main scene's children array (nothing is re-parented)
but has a render state of its own: both light states stay constant (`lightsStable` check).

**MSAA resolve on mobile.** With the soft pass on (medium and up), the scene target always resolves its
multisampled buffers explicitly, also where `WEBGL_multisampled_render_to_texture` exists, so the depth
texture is never attached to the framebuffer the soft pass draws into. On tiled mobile GPUs that is one
extra full-size resolve blit per frame on medium (MSAA 2). Low has no MSAA and no soft pass, so it keeps the
implicit path. If medium proves too heavy on a phone, the cheaper trade is the soft pass off on that device
class, not MSAA off.

## Quality tiers (`QUALITY` in `renderer.js`)

| | low | medium | high | ultra |
|---|---|---|---|---|
| internal scale | 0.75 × CSS px | 1.0 | min(DPR, 1.25) | min(DPR, 1.5) |
| dynamic range (of that) | 0.8–1 (0.6–0.75 px) | 0.7–1 | 0.8–1 | 0.75–1 |
| AA | FXAA (+CAS below 1) | MSAA 2 + FXAA | MSAA 4 | MSAA 4 |
| sun shadow map / refresh | 1024 / 30 Hz | 2048 / 30 Hz | 2048 / every frame | 4096 / every frame |
| small-caster cull | on | on | off | off |
| DOF taps (half res) | off | 16 | 36 | 48 |
| god rays | off | on | on | on |
| soft beams and shafts | off (hard additive) | on | on | on |
| SSAO (half res) | off | off | on | on |
| particles | 25 % | 50 % | 100 % | 100 % |
| flares and lens dirt | off | on | on | on |

The sky is drawn after the opaques on every tier, the flock is instanced and characters carry the rim
term on every tier. Without `EXT_color_buffer_half_float`/`float` (or with `?ldr`), the renderer runs the
low tier on RGBA8 targets: every material stores `c / (1 + c)` (one line appended to `fog_fragment`) and
the post chain decodes it, so HDR bloom and the grade survive.

## RenderSystem API (`world.rs`)

Kept: `setTier(t)`, `trackFrame(ms)`, `autoQuality`, `onTierChange`, `post.params.*` (every name of the
old chain), `render(scene, camera, time)`, `tier`, `q`, `w`, `h`, `cssW`, `cssH`, `renderer`.

| Call | Meaning |
|---|---|
| `beginFrame(now) → bool` | Frame cap. `false`: skip this rAF callback entirely. Keeps the phase, so 60 on a 120/144 Hz display is exact. |
| `trackFrame(ms, {paused, hidden})` | Interval of a rendered frame. Paused and hidden frames (and the two after them) are ignored. Drives dynamic resolution and auto quality. |
| `applySettings(s)` | Live settings (§7.4): `quality` (auto/low/medium/high/ultra), `renderScale` (50–100 or 0.5–1), `dynres`, `fpsCap` (30/60/'display'), `batterySaver` (30 fps, 0.75 scale, no DOF), `dof`, `grain` (0–100), `brightness` (−3…+3), `motionBlur` (stored; cut), `reduceFlashing` (caps bloom, flare, rays, dirt). URL test flags win: under `?noauto`, `quality: 'auto'` and `dynres` are ignored (fixed tier and resolution) unless `?dynres=1`; `?dynres=0` always turns it off. Brightness and grain have one owner per component: the LookDirector scales the look's exposure (1 + 0.08·b) and grain (grain / 60); `applySettings` adds only the gamma lift (`userGamma = 1 − 0.04·b`). `userExposure` and `grainScale` stay 1 unless a caller sets them. |
| `onContextLost(fn)`, `onContextRestored(fn)` | Return an unsubscribe function. While lost, `beginFrame` is false and `render` is a no-op; after a restore the post chain re-applies its state and the shadow maps refresh. Textures baked into render targets must be re-baked by the caller (F reloads the chapter). |
| `setMenuBackground(on)` | 30 fps at half resolution behind the menus. |
| `clearEffects()` | Drops every live particle. Also automatic when a direct child subtree of the scene is removed (a chapter root unloading), so effects never carry into the next chapter. |
| `world.light.setExtent(e)` | Half-width of the sun's shadow frustum (a chapter's `L.shadowExtent`; 22 m otherwise). |
| `stats` | tier, scale, cap, calls, tris, programs, gpuMs (EXT_disjoint_timer_query_webgl2 when exposed), cpuMs, p90, AA mode, passes, shadow-policy counters. |
| `particles` | The GPU particle system (also reachable as `particles` from `particles.js`). |
| `dyn`, `auto`, `cap`, `shadows` | DynRes, AutoQuality, FrameCap, ShadowPolicy (tests and tuning). |

**Dynamic resolution** (`DynRes`): the cost is GPU time when the timer query exists, otherwise the frame
interval. Above 110 % of budget the scale drops (scale² ∝ pixels, aiming at 92 %), at most every 250 ms;
after 5 s under 80 % it climbs 0.05 every 500 ms. A vsync-locked interval carries no headroom
information, so it probes one step up with exponential back-off.

**Auto quality** (`AutoQuality`): p90 of 10 s windows. Steps down when p90 > 130 % of budget with the
dynamic scale already at its floor; steps up (desktop only) after 30 s of headroom at full scale; at most
one change per 30 s, and an upgrade that does not hold doubles the wait before the next one.
`?slowgpu=N` replaces the frame cost with a synthetic GPU (4 ms + N·2.4 ms·scale²) for tests.

**Shadow policy** (`ShadowPolicy`): low/medium refresh the sun map at 30 Hz (time based), immediately
after a camera snap (≥ 1.5 m or ≥ 10° in a frame) or `rs.shadows.invalidate()`. Shadowed spot lights
whose 40 m cone is off-screen or dark keep their old map. On low/medium, static casters under 0.4 m tall
or more than 30 m behind the play plane stop casting; a caster counts as static once its world matrix
has been the same over two scans, so moving props and characters are never culled.

## Layers and the soft pass (`layers.js`)

```js
import { LAYERS, SOFT, SOFT_GLSL, softUniforms, toBeams } from '../render/layers.js';
const mat = new THREE.ShaderMaterial({
  uniforms: softUniforms({ uColor: { value: c } }),     // { ...SOFT, ... }
  fragmentShader: `${SOFT_GLSL} ... float a = core * softFade(0.6) * softNear(1.5); ...`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
toBeams(mesh); // mesh.layers.set(LAYERS.BEAMS)
```

`LAYERS.BEAMS` (3) is drawn after the opaque scene with the resolved scene depth bound as `SOFT.uDepth`
(`uRes`, `uNearFar`, `uSoftOn` alongside). `softFade(range)` is 0 where the fragment touches geometry
and 1 once it is `range` metres in front; `softNear(d)` fades volumes closer than `d` to the camera.
On low (`uSoftOn = 0`) the layer is drawn in the main pass and `softFade` returns 1: hard additive.
Materials on BEAMS must not use scene lights (the soft pass sees none). Shafts, dust motes and particles
use it; L's beams do the same (fallback: layer 3 drawn as usual if this file is absent).

**Every custom shader ends with `#include <fog_fragment>`**, on any layer: in the LDR fallback that chunk
stores the colour Reinhard-encoded and the post chain decodes it; a shader without it is decoded too
bright there (the Chapter I searchlight cone is the one left, requests/P.md #9).

## Effects

- **Particles** (`particles.js`): `particles.emit(kind, pos, opts)` with kind `embers | smoke | moths |
  dust | feathers`; opts `count, spread, speed, dir, life, size, color, alpha, radius (moth orbit), delay,
  stagger`. Simulated in the vertex shader from the spawn state, two instanced draws (additive and
  alpha) for every kind, counts scaled by the tier budget. Returns the number emitted. Their programs are
  compiled for the pass that draws them (the soft pass's light-less state on medium and up) when the system
  attaches and after a tier change, so the first emission never compiles mid-play.
- **Dust** (`new Dust(scene, n)`, `emit(pos, opts)`, `update(dt)`, `dispose()`): puffs on the GPU.
- **Flock** (`new Flock(scene, mats, spots)`, `reset()`, `update(dt, x, y, speed, onScatter)`,
  `dispose()`): three instanced draws (body, head, wings) for any number of birds. Only birds within 30 m of
  the boy or inside the camera's view (`VIEW` in `fx.js`, the play-plane x and half-width the renderer
  writes every frame) are drawn, so menu, intro and cinematic shots far from the boy still show theirs.
- **Shafts** (`new Shafts(scene, sunDir, G)`, `add(p, o)`, `addDust(regions, n)`, `setSun(dir, colour,
  intensity?)`, `dispose()`): `setSun` re-aims every shaft from its ground point and tints shafts and
  dust relative to the golden-hour sun they were authored under. It allocates nothing and returns at once
  when the sun has not changed (the LookDirector calls it on every write).
- **Sky** (`createSky`): uniforms `uNight` (0 = today's look), `uStars`, `uMoonDir`, `uMoonColor`,
  `uMoonSize` (a multiplier of `MOON_RADIUS` = 0.045 rad, about ten times the real moon for readability;
  the LookDirector writes the preset's `moonSize × moon`, so 0 hides the moon). Night gives a three-layer
  star field with a faint band, a moon with maria, limb darkening and halo, and clouds as dark silhouettes
  with moonlit rims. `buildEnvironment` turns the stars off for the PMREM.
- **Rim light** (`atmosphere.js`): materials named in `RIM_MATERIALS` (or `userData.rim = true`) get a
  fresnel rim, strongest against the sun; `G.uRimColor` / `G.uRimStrength` can be retinted per preset.
- **Flare** (`flare.js`, medium+): soft ghosts from a blurred bloom level, a halo ring for the sun only,
  and a short pale-warm streak on small bright sources (lamps, glints). `params.flare`, `flareThreshold`,
  `flareStreak` (0.5). **Lens dirt** rises with the god rays (the finale) or `params.dirt`.
- **Output pass** (`fxaa.js`): FXAA, then contrast-adaptive sharpening on luma only (no coloured fringes),
  at most 0.5 and only when upscaling, then grain at output resolution.
- **SSAO** (high/ultra): half-res, depth-aware blur; it fades out in direct light and inside the glow
  of lamps (bloom), and is applied before the DOF composite.
- **LUT** (`lut.js`): `lut(name)` bakes (once, shared) a 32³ 3D look-up table from a colourist-style
  grade (`grade({lift, gamma, gain, sat, contrast, shadows, highlights, balance, bands})`, where bands
  are hue-selective saturation / hue shift / value), applied after the analytic grade:
  `post.params.lutA`, `lutB`, `lutMix` (crossfade) and `lut` (amount, 0 = off, the default).
  `LUT_LOOKS` has one look per lighting preset; `goldenHour` is the identity, so the souk keeps the
  grade it was tuned with. `rs.setLut(a, b, mix, amount)` takes names or textures.

New `post.params`: `flare, flareThreshold, flareStreak, dirt, ao, aoRadius, userExposure, userGamma,
grainScale, lut, lutA, lutB, lutMix`. `post.limits` caps `bloom, flare, rays, dirt` (reduce flashing).

## Cut

Per the cut list: motion blur and raymarched fog (ultra-only). `applySettings({motionBlur})` is stored
and ignored.

## Measuring (`tools/perf.mjs`)

```
node tools/perf.mjs --port 5174 --tiers low,medium,high --out after.json --compare before.json
node tools/perf.mjs --port 5174 --only checks --shots /tmp/shots
```

The table visits the six Chapter I tour spots per tier and reports shadow-pass vs main calls, triangles,
post passes and programs, the flock's share (with and without every bird in view), and shadow calls on a
simulated 60 fps clock (the rAF loop cannot interleave with that synchronous loop, so time-based
policies are measured at a real cadence; SwiftShader frames are far slower than 33 ms). After the table it
prints the §8.5 budget per tier and spot (shadow + main calls, triangles) and warns when a spot is over. It
runs on any build, so the "before" column comes from the pre-presentation tree. The checks: FXAA on low,
tier round trip (targets, textures, geometries, programs, post materials), programs stable after warm-up,
frame cap (10 s of 120/144 Hz timestamps), the light state stable across frames with the soft pass on
(`lightsStable`, plus the main pass's CPU time with the soft pass on and off), URL flags over settings
(`settingsNoauto`), paused and hidden frames ignored, the night sky with the LookDirector's values (stars, a
dark sky, a moon disc of the expected size), pigeons in view far from the boy (`flockView`), the LUT, the
soft-layer / particles / shafts / dispose / particle-clearing / particle-warm-up contracts, `?slowgpu=8&dynres=1` (drop within
2 s, recovery after 5 s, ≤ 1 tier change), sustained overload (one step down, ≥ 30 s apart), the LDR
fallback, the real boot loop under a 120 Hz `requestAnimationFrame` stub installed before boot
(`capLoop`; reported as pending on a tree whose loop does not call `beginFrame`) and context loss.

### Last run

SwiftShader, 640 × 360, `tex=0.1`; "before" is the pre-presentation tree (`0f7b31b`). Shadow calls are per
frame at a 60 fps cadence; the flock column counts its own draws (main + shadow).

| tier | shadow calls / frame (6 spots) | flock draws at the spots | flock, all 27 birds in view | calls / frame, souk spot | programs (1st / 2nd pass) |
|---|---|---|---|---|---|
| low | 859 → 306 (−64 %) | 164 → 22 | 216 → 5 | 265 → 162 | 49 / 49 → 62 / 62 |
| medium | 852 → 304 (−64 %) | 159 → 22 | 216 → 5 | 270 → 164 | 50 / 50 → 62 / 62 |
| high | 856 → 648 (−24 %, culling and spot policy only) | 161 → 22 | 216 → 5 | 267 → 212 | 50 / 50 → 64 / 64 |

**§8.5 budget** (shadow + main calls / triangles per frame at 60 fps; the souk, raised, rooftops,
courtyard, balcony and chase spots):

| tier | budget | measured | over |
|---|---|---|---|
| low | 130 / 400 k | 149 / 351 k, 151 / 433 k, 145 / 451 k, 167 / 570 k, 177 / 631 k, 155 / 505 k | every spot (calls); at its 30 fps target, where the shadow map refreshes every frame, 192–244 calls |
| medium | 180 / 550 k | 149 / 351 k, 151 / 433 k, 145 / 451 k, 167 / 569 k, 177 / 622 k, 155 / 506 k | courtyard and balcony (triangles) |
| high | 240 / 700 k | 196 / 497 k, 199 / 589 k, 189 / 600 k, 236 / 830 k, 259 / 895 k, 208 / 662 k | courtyard (triangles), balcony (both) |

What is left over is structural: about 55 per-material level batches in the shadow pass and 70 in the main
pass, each spanning the play plane to 90 m behind it, and characters made of about 21 rigid parts each.
requests/P.md #10 asks for near/far batch splits (far set without shadows) and merged character meshes.

Per shadow update (culling alone) the souk spot goes 133 → 86 calls on low/medium; triangles at the
souk spot 630 k → 489 k. Every check passes: FXAA (+CAS) on low, the tier round trip (textures 123,
geometries 296, programs 58, 17 targets before and after; 118 post materials created and 118 disposed),
programs stable (62), the cap (60.0 fps at 120 / 144 Hz, 30 at cap 30, 120 uncapped), the light state
(56 lit materials on medium, none re-validated over 6 frames; main pass 1.0–1.1 ms with the soft pass on and
1.0 ms off, against 36 materials re-validated per frame and 1.4–1.6 ms on the previous tree), settings under
`?noauto`, paused and hidden frames ignored, night sky (166 stars against 0 by day, mean sky luminance 0.12,
moon disc 0.93 against 0.33 around it, radius 16 px for an expected 16.9), pigeons in view (12 drawn: 8 near
the boy, 4 in view 151 m away), the contracts (particles cleared when a chapter root leaves), `?slowgpu=8`
(scale 1 → 0.85 in 1.7 s, back to 1 after 9.2 s of headroom, no tier change), sustained overload (one step
medium → low), the LDR fallback (RGBA8 targets, mean luminance within 9 % of the float path), the LUT
(identity within 0.3/255 of no LUT, one final program) and context loss. `capLoop` is pending on this branch
(the boot loop predates `beginFrame`); on the foundation's tree with these files it renders 60.0 fps under the
120 Hz stub.

**Integration with the foundation** (F's tree `b5fb61d` with P's files): `?noauto&tier=high` keeps the high
tier at scale 1 for 25 s; the souk's audio block resolves to the souk theme in Hijaz, a level mix with
`zone: null` runs, and the chase keeps its 0.21 s pulse; the light state is stable with the light rig (census
dir 1, hemi 1, point 7, spot 2); the night stub's sky shows stars and a moon disc with the director's
`uMoonSize = moonSize × moon`; brightness +3 and grain 100 give exposure 1.24× and grain 1.67× from the
director and gamma 0.88 from P, each once (before: 1.80× and 2.78×); F's leak cycle (13 loads: memory flat,
programs stable, light census constant), the souk bot (85.4 s, no death) and all 12 foundation negatives pass.

Golden-hour tour screenshots (seeded, 1280 × 720, high / medium / low) compared with the old tree at the
six tour spots and the finale: same composition and light; sharper on low (FXAA + luma CAS instead of a plain
bilinear upscale), a rim on the characters, soft particles and shafts, cinematic ghosts and a faint pale lamp
glare on medium+, and lantern glow intact (SSAO no longer darkens it).
