# Graphics and performance (package P; integration I0)

Owner files (the integrator's since the first integration pass): `src/render/{renderer,post,dynres,shadowpolicy,layers,fxaa,ssao,flare,lut,particles,fx,shafts,sky,lighting,atmosphere,glsl}.js`,
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
| shadowed spots refresh | 15 Hz | 15 Hz | every frame | every frame |
| merged static casters (proxies) | on | on | on | on |
| shadow reach (proxies behind the play plane) | 8 m | 14 m | all | all |
| small-caster cull | on | on | off | off |
| alpha-tested static casters (ivy, lattice) | off | on | on | on |
| geometry built for the tier (`lite`) | lighter, far set, 2 depth bands | full | full | full |
| DOF taps (half res) | off | 16 | 36 | 48 |
| god rays | off | on | on | on |
| soft beams and shafts | off (hard additive) | on | on | on |
| SSAO (half res) | off | off | on | on |
| particles | 25 % | 50 % | 100 % | 100 % |
| flares and lens dirt | off | on | on | on |

The sky is drawn after the opaques on every tier, the flock is instanced and characters carry the rim
term on every tier. A chapter loaded on low is built with lighter geometry (`DETAIL.lite` in
`src/assets/geom.js`: arch outlines, extrusion curves, lathes and tubes with about half their segments, no bevels
under 3 cm; set by the chapter loader around the build), which halves its triangles. Low also spends triangles to
save draws: the street and the play plane share 1 × chunk batches (`LITE_BANDS`), and the far city (the skyline's
rows 3 and 4 and its domes, added with `{set: 'far'}`) merges every plain opaque material into one `farSet` draw per
chunk, its vertices naming their material in a 64-entry palette painted after the bake from the smallest mip of each
baked map (times the material's colour; alpha = metalness). The far city keeps its colours, grime, lighting, shadows
and fog and loses only texture detail, which low's half-size textures and the haze had mostly taken already. A tier
change mid-chapter keeps the geometry the chapter was built with, as it keeps the texture scale. On every tier the
static batches chunk by depth (0.6 × chunk near the play plane, 2 × in the far city) and are culled by their world
box, the characters draw one skinned mesh per material, and hanging lanterns cast through the merged proxies. Without `EXT_color_buffer_half_float`/`float` (or with `?ldr`), the renderer runs the
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

**Frame clock.** `trackFrame` sums the intervals it is given, so every window below runs on the rAF clock (a
stubbed `requestAnimationFrame` or a synthetic feed drives it exactly like a display). Paused and hidden frames,
a stall (over 1 s and over three times the recent average), and the frames right after a discontinuity are not
counted: a chapter root added to or removed from the scene, a camera jump of more than 4 m that its recent
motion does not explain (respawn, checkpoint, cut), or `rs.markDiscontinuity()`.

**Dynamic resolution** (`DynRes`): the cost is GPU time when the timer query exists (the interval counts only
when our own CPU/GPU work fills the frame), otherwise the frame interval. Decisions use the 75th percentile of
the frames rendered at the current scale over at least 0.4 s: three frames or more, or any number on a slow clock
(frames averaging 150 ms or more, where one frame covers that time), so a single hitch (a GC pause, a compile)
never moves the scale. Above 112 % of budget the scale drops (scale² ∝ pixels, aiming at 92 %), one step per
window; after 5 s under 80 % it climbs 0.05 per window. A vsync-locked interval carries no headroom information:
it probes one step up after 4 s at budget, and a probe that does not hold returns to the scale it left and
doubles the wait.

Without a timer a long interval may be the display's, not ours: iOS Low Power Mode and browser battery saving
throttle `requestAnimationFrame` to 30 Hz with the GPU idle. So the first drop of an overload starts a **trial**:
if the delivered period does not get shorter even at the floor, lower resolution cannot help; the scale returns
to the highest one that reached that period and the period becomes the budget (`dyn.limited`). When the
resolution never helped and the CPU is idle (`dyn.displayLimited`) it is the tier's budget too, so a throttled
phone keeps its tier and its resolution after a dip of about 1.4 s. Frames faster than the limit end it; a tier
change clears it.

**Auto quality** (`AutoQuality`): p90 of 10 s windows. Steps down when p90 > 130 % of budget with the
dynamic scale at its floor or limited; steps up (desktop only, never while limited) after 30 s of headroom at
full scale; at most one change per 30 s, and an upgrade that does not hold doubles the wait before the next one.
A step down whose next window is not faster (median) is undone 30 s later, also on touch devices (an undo, not
an upgrade), and is not tried again at that frame time.
`?slowgpu=N` replaces the frame cost with a synthetic GPU (4 ms + N·2.4 ms·scale²·tier, the tier factor 0.55 on
low, 1 on medium, 1.35 on high, 1.8 on ultra) for tests.

**Shadow policy** (`ShadowPolicy`): low/medium refresh the sun map at 30 Hz (time based) and shadowed spots
at 15 Hz on the frames the sun skips (at 30 fps, every other frame together with the sun), all at once after a
camera snap (≥ 1.5 m or ≥ 10° in a frame) or `rs.shadows.invalidate()`; high and ultra refresh every frame.
Shadowed spot lights whose lit cone (truncated 2 m below its aim point, tested as an apex and an octagon
against the camera frustum) is off-screen, or dark, keep their old map.

*Merged static casters.* The level's batches (`batch:*` meshes with `matrixAutoUpdate = false`, or
`userData.staticCaster`) cast through proxies: their triangles in world space, 16-bit positions per tile (12 m of
x × a depth band: z ≥ −10, −20, −35, −60, beyond), one draw per tile instead of one per material and chunk. The
proxies use one front-sided material, so the depth pass draws back faces as for the batches (double-sided
sources are written with both windings); they cast into every shadow map and are invisible to every other pass
(`intersectsFrustum` answers only in the shadow pass, against the tile's world box). Alpha-tested, displaced or
clipped materials keep their own draws. A chapter root's proxies are built in the frame it arrives (a loader's
warm-up render, behind the card: about 70 ms for the souk here); a later change to a root is merged a few
milliseconds per frame (`rs.shadows.building`), and until then its batches cast as authored. Their vertex arrays
are freed once uploaded, so a restored context drops and rebuilds them (`rs.shadows.reset()`), and the shadow
pass hook follows the new `renderer.shadowMap` three creates on a restore. A root whose set of batches or their
visibility changes is rebuilt; set `userData.noProxy` on a batch that must keep casting on its own.
A tile's triangles are stored by sub-tile (3 m of x), and each shadow pass draws only the run of sub-tiles it needs
(`onBeforeShadow` sets the draw range): a spot's pass the ones inside its frustum (the searchlight's narrow cone
crosses a corner of most tiles it meets), the sun's the ones whose shadow can land in view. Triangles wider than a
sub-tile (long wall faces, cornices) go to 96 m tiles of their own, so they no longer stretch a tile's box over their
whole length. Sources are merged with their world matrix brought up to date first (a root's first frame has never been
rendered) and snapshotted for both passes of the merge; a `staticCaster` source that later moves more than 8 cm from
where it was merged leaves the proxies and casts on its own from the next scan.
In the sun's map a proxy (and each sub-tile) also needs its shadow to land in view: its box swept along the light
down to the lowest geometry under it (per 12 m column of x, over the columns the light carries it across) must meet
the camera frustum, tested plane by plane (the swept box is the box plus a segment, so its reach along a plane's
normal is the box's plus the segment's) with 1.5 m to spare, which changes nothing on screen. On low/medium
(`shadowReach` 8 / 14 m) a proxy whose shadow, from its front top edge along the current sun, cannot land
within that many metres behind the play plane stops casting into the sun's map: background roofs lose the
shadows of buildings further back. The sun direction is read every frame, so a low sun keeps its long shadows.

*Small casters.* On low/medium, other static casters under 0.4 m tall or more than 30 m behind the play plane
stop casting, as do meshes flagged `userData.smallCaster` (the flock); a caster counts as static once its world
matrix has been the same over two scans, so moving props and characters are never culled. The policy restores
only the `castShadow` values it changed itself: a flag another package changes is the authored value from then
on (a proxied batch is the exception, see `noProxy`). Spot lights are tracked in a `WeakMap`.

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
  dust relative to the golden-hour sun they were authored under. Their brightness follows `G.uSunLight`, the
  key light's intensity relative to the golden-hour sun (written by `Lighting.update`; `intensity`, when
  passed, is the same ratio), so they fade at dusk and stop drawing at dawn before the sun is up. It allocates
  nothing and returns at once when the sun has not changed (the LookDirector calls it on every write).
- **Sky** (`createSky`): uniforms `uNight` (0 = today's look), `uStars`, `uMoonDir`, `uMoonColor`,
  `uMoonSize` (a multiplier of `MOON_RADIUS` = 0.045 rad, about ten times the real moon for readability;
  the LookDirector writes the preset's `moonSize × moon`, so 0 hides the moon). Night gives a three-layer
  star field with a faint band, a moon with maria, limb darkening and halo, and clouds as dark silhouettes
  with moonlit rims. `buildEnvironment` turns the stars off for the PMREM.
- **Rim light** (`atmosphere.js`): materials named in `RIM_MATERIALS` (or `userData.rim = true`) get a
  fresnel rim, strongest against the sun. `Lighting.update` derives it from the live key light every frame:
  its colour half way to white, strength 0.55 × √(intensity / 7). Golden hour keeps the warm rim, the night's
  moon gives a faint cool one, dawn before sunrise none. `world.light.rimAuto = false` hands
  `G.uRimColor` / `G.uRimStrength` to the caller.
- **Flare** (`flare.js`, medium+): soft ghosts from a blurred bloom level, a halo ring for the sun only,
  and a short pale-warm streak on small bright sources (lamps, glints). `params.flare`, `flareThreshold`,
  `flareStreak` (0.5). The sun's share (halo, strong ghosts, lower threshold) is `sunVisible` scaled by the key
  light's strength (`G.uSunLight` 0.2 → 0.6), so the moon, whose direction the night look also reports as
  `sunVisible`, gets only the faint lamp ghosts (`post.stats.flareSun`). **Lens dirt** rises with the god rays
  (the finale) or `params.dirt`.
- **Soft pass and MSAA.** Where three invalidates a multisampled colour buffer after each resolve (the Oculus
  Browser, the same test as three's `WebGLTextures`), the soft pass is off and the BEAMS layer is drawn in the
  main pass (hard additive), since drawing onto the resolved buffer would lose the scene there.
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

The table visits the six Chapter I tour spots and the hero alley per tier (low and medium also as a phone in
landscape, 844 × 390, unless `--w`/`--h` pick one viewport) and reports shadow-pass vs main calls, triangles,
post passes and programs, the flock's share (with and without every bird in view), and shadow calls on a
simulated 60 fps clock (the rAF loop cannot interleave with that synchronous loop, so time-based
policies are measured at a real cadence; SwiftShader frames are far slower than 33 ms). After the table it
prints the §8.5 budget per tier and spot (shadow + main calls, triangles) and fails the run when a spot is over (and
when a check fails or is pending). The gate is the heaviest frame: every shadow map refreshed in one frame
(`P.forced`: the game's own render, so the lamp, the camera and the characters update, while the sim stands still),
over a full sweep of the courtyard lamp wherever its spot is lit (`P.sweep`, 9 aims), plus every frame of the
chapter's finale from its last checkpoint (`P.finale`, every 0.5 s); the 60 fps average is printed beside it. It
runs on any build, so the "before" column comes from the pre-presentation tree. The checks: FXAA on low,
tier round trip (targets, textures, geometries, programs, post materials), programs stable after warm-up,
frame cap (10 s of 120/144 Hz timestamps), the light state stable across frames with the soft pass on
(`lightsStable`, plus the main pass's CPU time with the soft pass on and off), URL flags over settings
(`settingsNoauto`), paused and hidden frames ignored, the night sky with the LookDirector's values (stars, a
dark sky, a moon disc of the expected size), pigeons in view far from the boy (`flockView`), the LUT, the
soft-layer / particles / shafts / dispose / particle-clearing / particle-warm-up contracts, `?slowgpu=8&dynres=1` (drop within
2 s, recovery after 5 s, ≤ 1 tier change), sustained overload (one step down, ≥ 30 s apart), the LDR
fallback, the real boot loop under a 120 Hz `requestAnimationFrame` stub installed before boot
(`capLoop`; reported as pending on a tree whose loop does not call `beginFrame`) and context loss. Added with
the frame-clock work: `moonFlare` (no sun halo on the moon, the full one on the golden-hour sun),
`shadowProxies` (the frame with and without merged casters at the six spots on high and low: pixels and
shadow draws), `dynSignal` (`trackFrame` fed a minute or more of frames from a device without a GPU timer: a
250 ms hitch at 60 Hz, a 30 Hz throttle on a phone and on a desktop, a fill-bound GPU, a GPU only a lower tier
saves, a CPU-bound frame no tier helps) and `throttleLoop` (the real boot loop under a 30 Hz rAF stub whose
clock `performance.now` follows, GPU timer hidden: the tier and the resolution must hold).

### Integration run (I0)

SwiftShader, `tex=0.1`, `node tools/perf.mjs --tiers low,medium,high` (low and medium at 640 × 360 and as a phone in
landscape, 844 × 390; high at 640 × 360). Each cell is the heaviest frame at the spot, calls (shadow + main) /
triangles: every shadow map refreshed in the same frame (as on low's own 30 fps frames, on high, and on any tier after
a camera snap), over a full sweep of the courtyard lamp wherever its spot is lit; the finale cell is the heaviest frame
of the whole DepthWalk, sampled every 0.5 s. `perf.mjs` fails a run when any cell is over its tier's budget.

| tier | budget | souk | raised | rooftops | courtyard | balcony | chase | hero alley | finale |
|---|---|---|---|---|---|---|---|---|---|
| low | 130 / 400 k | 97 / 210 k | 87 / 202 k | 77 / 201 k | 94 / 257 k | 108 / 289 k | 105 / 263 k | 105 / 249 k | 113 / 268 k |
| low, 844 × 390 | 130 / 400 k | 108 / 239 k | 94 / 207 k | 96 / 252 k | 105 / 287 k | 115 / 296 k | 120 / 280 k | 111 / 254 k | 115 / 270 k |
| medium | 180 / 550 k | 123 / 290 k | 125 / 284 k | 113 / 347 k | 128 / 453 k | 135 / 459 k | 132 / 396 k | 143 / 407 k | 149 / 413 k |
| medium, 844 × 390 | 180 / 550 k | 132 / 296 k | 137 / 314 k | 139 / 488 k | 137 / 485 k | 146 / 493 k | 151 / 457 k | 151 / 410 k | 155 / 415 k |
| high | 240 / 700 k | 126 / 297 k | 127 / 288 k | 118 / 353 k | 155 / 462 k | 173 / 471 k | 141 / 404 k | 146 / 411 k | 156 / 425 k |

The first integration pass had gated six spots at 16:9 on an average of a simulated 60 fps run. Measured this way it
was over: low 135 calls at the chase on a phone, 131 / 138 at the hero alley, 131–147 through the finale; medium
563 k triangles at the courtyard as the lamp swept (and, once the lanterns' shadows were merged where they hang, 655 k
at the balcony on a phone). What brought every cell under:

| lever | where | effect |
|---|---|---|
| merged characters | `character.js` | the boy: 22 → 6 main draws, 21 → 2 per shadow pass (`rig.shadowMeshes`, one per material side, authored casters only) |
| static lanterns | `levelkit.lantern`, `staticCaster` | the swaying lanterns cast through the proxies: −24 shadow draws at the courtyard |
| depth chunks, box culling | `geom.js` `Batcher` | main-pass triangles −30 to −40 % on every tier for 0–6 more draws |
| far set (low) | `Batcher` `far`, `mats.farSet` | the skyline's far rows and domes in one palette draw per chunk: −8 to −14 draws (phone) |
| two depth bands (low) | `LITE_BANDS` | the street and the play plane share 1 × chunk batches: −5 to −18 draws for +11 to +25 k triangles (phone) |
| sub-tile shadow ranges | `shadowpolicy.js` | a pass draws only the 3 m sub-tiles it needs; wide triangles have tiles of their own |
| swept-shape sun cull | `shadowpolicy.js` | the swept box tested plane by plane, down to the lowest geometry under it. With the sub-tiles: the balcony's shadow triangles 194 → 109 k on low, its sun pass 210 → 127 k and lamp pass 103 → 90 k on medium (phone) |
| sway counts as static | `shadowpolicy.js` | the rolled-up rope ladder (16 meshes) stops casting on low and medium |
| lite geometry (low) | `geom.js` `DETAIL` | half the curve segments, no bevels under 3 cm: low's triangles halve |
| no cut-out shadows (low) | `QUALITY.low.alphaCasters` | ivy and lattice batches stop casting on low |

The `shadowProxies` check renders each spot with and without the proxies (high: mean difference ≤ 0.02/255, at most
0.021 % of pixels differ by more than 16/255; low ≤ 0.055/255): the culling changes nothing on screen. Two bugs of the
first pass are fixed with it: the lanterns had been merged at the world origin (their world matrices were read before
the chapter's first render), so they cast no shadow where they hang; and the rubble pile over the crawl tunnel, whose
stones the first pass had turned about their own centres, stood as huge floating blocks over the tunnel, the hero
alley and the finale. Its stones and beams had never shown before (they turned about the world origin, 50 m off
screen), so they are left out and the tunnel looks as reviewed.

High at 960 × 540 (`tex=0.5`, seeded): the tour spots match `4c166b2` within grain, the cloth's wind and the flock's
random positions (0.31–0.80 % of pixels differ by more than 24/255 at the six spots, the hero alley 0.69 %), and match
`docs/baselines/souk` as closely as `4c166b2` itself does (0.24–2.82 % against its 0.17–2.94 %); the finale frames
show the reviewed composition. Low keeps its look: the far set
changes the distant city's texture detail only, and its tour matches the first pass's within 1.3 % of pixels (thin
distant railings alias differently). Programs: 47–48 on low (one more for the far set), stable after warm-up.

**Texture memory** (§8.5, the touch classes' `tex=0.5`, 844 × 390 CSS px at DPR 3; unchanged by I0): the baked
surfaces (34 surfaces × albedo, normal, ORM, with mips) take 13.6 MB on low and 54.3 MB on medium, plus 2.6 MB of
LUT, sky and particle textures on medium: 14 / 57 MB against 60 / 80 MB. Counting every render target as well, medium
reaches 115 MB: the post chain 10 MB and the shadow maps 48 MB, half of which is the RGBA8 colour attachment three
allocates beside each depth texture and never samples (an R8 attachment would save 18 MB on medium, 9 MB on low).

**Boot** (FULL_GAME §8.6). The profile of a boot on SwiftShader was two thirds shader compiles: the 34 surface bakes
(each program evaluated `surf()` five times for its normals) and the scene's programs at the first frame. A surface's
program now evaluates `surf()` once and one shared program derives its normal and ORM maps (every texture matches the
old bake within 1/255), and the loader issues every program before the build so the driver compiles while the level
is built (`world.prebake` / `world.finishBake`). Boot to `__ready`, each boot from a blank page: 6.2–7.0 s against
10.7–11.4 s for `4c166b2`. The foundation suite's boot check (interleaved ABBA pairs against the pre-foundation tree,
6.4–6.9 s against 7.9–8.8 s) gives pair ratios of 0.78–0.88, median 0.81, against its 1.1 budget. Its earlier noise
(single boots of 6 to 16 s) was the Google Fonts stylesheet both trees link, fetched over the network before their
scripts run; the check now answers it with an empty one, and counts only pairs whose two boots shared the machine
with about the same outside load.

### Presentation package run (P)

SwiftShader, 640 × 360, `tex=0.1`; "before" is the pre-presentation tree (`0f7b31b`). The flock column counts
its own draws (main + shadow).

| tier | shadow calls / frame at 60 fps (6 spots) | per shadow update | flock draws at the spots | flock, all 27 birds in view | calls / frame at 60 fps, souk spot | programs (1st / 2nd pass) |
|---|---|---|---|---|---|---|
| low | 859 → 161.5 (−81 %) | 859 → 329 (−62 %) | 164 → 12 | 216 → 3 | 265 → 141.5 | 49 / 49 → 57 / 57 |
| medium | 852 → 172.8 (−80 %) | 852 → 353 (−59 %) | 159 → 12 | 216 → 3 | 270 → 146.5 | 50 / 50 → 61 / 61 |
| high | 856 → 401 (−53 %, every frame) | 856 → 402 (−53 %) | 161 → 22 | 216 → 5 | 267 → 177 | 50 / 50 → 67 / 67 |

"Per shadow update" sums the calls of the frames that refresh a map (the sun's, a spot's or both): it is the
cost per frame at low's own 30 fps, where the sun refreshes every frame and the courtyard's searchlight every
other one. At the two searchlight spots it is 146 → 76 (courtyard) and 150 → 69 (balcony) on low.

**§8.5 budget** (shadow + main calls / triangles per frame at 60 fps; the souk, raised, rooftops,
courtyard, balcony and chase spots):

| tier | budget | measured | over |
|---|---|---|---|
| low | 130 / 400 k | 128.5 / 303 k, 130.5 / 411 k, 124 / 402 k, 136.5 / 449 k, 146.5 / 511 k, 133.5 / 463 k | five spots, by 0.5–16.5 calls and 2–111 k triangles; at its own 30 fps, 146–181 calls |
| medium | 180 / 550 k | 131.5 / 306 k, 133 / 413 k, 125.5 / 406 k, 136.8 / 450 k, 148.5 / 514 k, 136 / 467 k | none |
| high | 240 / 700 k | 161 / 406 k, 162 / 549 k, 154 / 511 k, 188 / 677 k, 203 / 681 k, 171.5 / 587 k | none |

Low's remainder is the main pass, which P does not own: 101–112 draws and 213–354 k triangles before any
shadow, of which the boy alone is 22 draws (21 rigid parts), and up to 28 swaying lanterns that cast on their
own. requests/P.md #10 asks for merged character meshes, `staticCaster` lanterns and a cheaper far set on low.

The merged casters change nothing on screen: the `shadowProxies` check renders each spot with and without them
at a fixed time and reads the frame back (high: mean difference ≤ 0.048/255, at most 0.053 % of pixels differ
by more than 16/255, shadow-edge texels; low, with the reach cut: ≤ 0.067/255), while the shadow pass loses
36 % (high) and 54 % (low) of the draws it has without them. Built in 50–90 ms when a chapter root arrives
(the souk: 156 batches, 540 k triangles, 109 proxies, positions at 6 bytes a vertex, about 10 MB of vertex
buffer and no CPU copy).

Every check passes on this tree: FXAA (+CAS) on low, the tier round trip, programs stable, the cap (60 fps at
120 / 144 Hz, 30 at cap 30, 120 uncapped), the light state, settings under `?noauto`, paused and hidden
frames ignored, night sky (183 stars, mean sky luminance 0.11, the moon disc at 0.94 against 0.32 around it,
15.7 px for 16.9 expected, measured without bloom), `moonFlare` (sun share 0 with the moon in view at intensity
0.9, 1 with the golden-hour sun), pigeons in view, the LUT, the contracts, `?slowgpu=8` (scale 1 → 0.85 in 1.0 s on
SwiftShader's 0.9–1.2 s medium frames, back to 1 after 9.7 s, no tier change), sustained overload (one step
medium → low), `shadowProxies`, `dynSignal`, `throttleLoop`, the LDR fallback and context loss (the proxies cast
into the sun's map again after a restore: 13 draws before and after). `capLoop` is pending
on this branch (the boot loop predates `beginFrame`).

`dynSignal` (synthetic frames through `rs.trackFrame`, no GPU timer, touch device unless noted):

| scenario | before (verifier, F + P) | now |
|---|---|---|
| one 250 ms hitch at 60 Hz, 60 s | 0.9 → 0.7 within 2 s, 0.8 after 61 s | scale stays 1 |
| 30 Hz rAF, idle GPU, 90 s | 0.7 at 8 s, tier medium → low at about 39 s, for good | under 0.95 for 1.3 s, back to 1, `limited` 33.3 ms, tier medium |
| the same on a desktop (high) | — | under 0.95 for 0.8 s, back to 1, high |
| fill-bound GPU (4 + 22 ms·scale²) | — | settles at 0.72 (60 fps), probes 0.77 with back-off |
| GPU only a lower tier saves | — | medium → low at 10 s, 60 fps, kept |
| CPU-bound, no tier helps | — | medium → low at 10 s, undone at 40 s, not tried again |

`throttleLoop` (the real loop, 30 Hz stub, 25 s): scale 1 → 0.7 → 1 within 1.8 s, then `limited` 33.3 ms,
tier medium, no change.

**Integration with the foundation** (F's tree `cfaa953` with these files): the souk bot passes (85.4 s, no
death), the 13 souk negatives pass, and so does the leak cycle (13 loads: memory flat, programs stable, light
census constant). The foundation's context-loss negative caught a regression here: three replaces
`renderer.shadowMap` on a restore, so the merged casters lost their shadow-pass hook and the reloaded courtyard
came back without static shadows (11 % of pixels off); the policy now re-hooks whatever shadow map the renderer
has, and the scene matches within 1.4 % (budget 3 %). Its boot-budget negative is noisy on this machine: one run in
three over (19.2 s against 16.6 s, the base tree itself ranging 12.7–21.0 s between runs), two under (18.8 against
18.9, 15.1 against 20.1); the merged casters add about 70–200 ms to the first chapter load. Every perf check
passes there: `capLoop` (the real loop under a 120 Hz stub renders 60.0 fps), `nightSky` through the director's
`night` preset (184 stars, a 15.8 px disc for 16.9 expected, measured without bloom), `moonFlare` (the night
look's moon: sun share 0), `throttleLoop`, `dynSignal`, `?slowgpu=8` (1.0 s), `shadowProxies` (high 36 % and
low 54 % fewer shadow draws, mean difference ≤ 0.065/255), `contextLoss` (the proxies cast again once the chapter
has reloaded) and the rest. The night stub seen on medium: the moon is a disc with its own glow and no sun halo,
the boy's rim is faint and cool; at golden hour it stays warm.

Golden-hour tour screenshots (seeded, 1280 × 720, high / medium / low) compared with the old tree at the
six tour spots and the finale: same composition and light; sharper on low (FXAA + luma CAS instead of a plain
bilinear upscale), a rim on the characters, soft particles and shafts, cinematic ghosts and a faint pale lamp
glare on medium+, and lantern glow intact (SSAO no longer darkens it).
