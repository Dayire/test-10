# Medina: engine architecture

This is the contract every package builds against. The design is
`docs/FULL_GAME.md`; this file says how the code realises it. When a frozen
file needs a change, write `docs/requests/<package>.md` (file, change, reason,
test) and work around it through the hooks below meanwhile.

## 1. Lifetimes

| Lifetime | Objects | Created in |
|---|---|---|
| Session | renderer and post (`world.rs`), scene, sky, env map, baked surfaces, the material cache, the camera and `CameraRig`, the fixed `LightRig` (sun, hemi, `charLight`, pool, two spots), `LookDirector`, the boy (`Player`, rig, `Animator`), the glow-sprite texture, `Events`, `Save`, `window.__medina` | `boot.js`, `Game.initOnce()` |
| Chapter | everything under `game.root` (a `THREE.Group` named `chapter:<id>`): batched statics, entity meshes, Shafts, Dust, Flock, glow sprites; physics solids and bodies (except the boy's); vines, entities, systems, interactables, triggers, checkpoints; pool sources; rig-spot owners | `ChapterLoader` |

Nothing chapter-lived may be added to `game.scene` directly: use
`game.add(obj)` (adds to the root) or `game.track(obj)` for disposables that
live elsewhere (a texture, a material, an object outside the root).

## 2. Files and owners

Frozen after the foundation: `src/game/{game,camera,chapterloader,cinematics,levelkit,testapi,events}.js`,
`src/render/{look,lookdirector,lightrig,world,materials,textures,lightpool}.js`, `src/core/{storage,save}.js`,
`src/chapters/index.js`, `tools/lib/*`, `tools/{playtest,negative,cycle}.mjs`.
Handed over: `src/game/{player,animator,entities,bridge,physics}.js` to L; `boot.js`, `src/ui/**`,
`src/core/input.js` to U; `src/chapters/souk/**`, `tools/bots/souk.js`, `tools/neg/souk.mjs` to C2;
`src/chapters/<id>/**` (and `src/chapters/stub.js` until the last stub is gone) to each chapter package.
P owns `src/render/{post,renderer,sky,lighting,atmosphere,glsl,fx,shafts}.js` and `src/core/audio.js`;
the engine calls their newer APIs only through optional chaining.

## 3. Boot

`src/main.js` → `boot(canvas, params)`:

1. `storage.init()` (`?nosave=1` keeps everything in memory), `save.load()`.
2. Device class (FULL_GAME §8.4): coarse pointer with `deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4` → low tier, texture scale 0.5, pool 4; other coarse pointers → medium, 0.5, 4; desktop → high, 1, 6. The pool size is fixed here and never follows the tier.
3. `createWorld(canvas, {tier, texScale, bake: false})`, GLB overrides, `SESSION_SURFACES`, `new Game(...)`, `game.initOnce({pool})`, the `hooks.card` / `hooks.credits` stubs from `ui.js`, saved settings.
4. `game.loadChapter(id, cp, {reason: 'boot', onProgress})` paints the loading bar (bake in 200 ms slices, build sections, compile).
5. The loop: `rs.beginFrame?.(now)` (false skips the frame), `rs.trackFrame(ms, {paused, hidden})`, `game.frame(dt)`.

Lifecycle: `visibilitychange` (hidden) pauses and saves, `pagehide` saves, `resize` redraws a paused freeze-frame,
`webglcontextlost` pauses, `webglcontextrestored` → `game.recoverContext()` (re-bakes every surface into its own
targets, rebuilds the env map, reloads the chapter at its checkpoint).

| URL parameter | Effect |
|---|---|
| `?chapter=<id>&cp=<n>` | start there (`?cp=` alone: souk) |
| `?continue=1` | start at the save's `{chapter, cp}` |
| `?autostart=1` | skip the title and every intro (test contract) |
| `?hold=1` | requestAnimationFrame never advances the simulation; only `__medina.sim` does (determinism) |
| `?nosave=1` | saves stay in memory |
| `?tier= ?tex= ?pool= ?noauto=1` | quality tier, texture scale, pool size, no auto quality |
| `?debug=1` | state overlay |

`window.__boot` holds boot timestamps; `game.loader.stats` the last load's phase timings
(`cover, import, bake, build, merge, fx, compile, render`).

## 4. Chapters

### 4.1 Registry (`src/chapters/index.js`)

`CHAPTERS` lists `{id, n, numeral, glyph, label, next, exit, tone, dev?, load}` for `souk`, `sundown`, `night`,
`dawn` and `lab` (dev only: hidden from menus and the chain). `meta(id)` reads the metadata without loading;
`getChapter(id)` imports the module lazily and merges it. `exit` is the colour the screen fades to when the
chapter ends; `tone` colours its card. `PLAYABLE` excludes dev chapters.

### 4.2 Chapter module (`src/chapters/<id>/index.js`)

```js
export default {
  id, n, numeral, glyph, label, next,          // label: menus only; next: id or null (credits)
  look: 'goldenHour' | [{x, preset}],          // a preset name, or LookDirector x-keys
  surfaces: {name: SurfaceDef}, materials: {name: MaterialDef}, needs: ['plasterBlue', ...],
  audio: {theme, zones: [{x0, x1, verb, amb, music, tension, hum}]},   // handed to audio.setChapter?.()
  intro: {pos, look, fov, sway, dur, shadowFocus?}, menuShot: {pos, look, fov, sway, cp},
  credits?: [lines], seed?: 42, chunk?: 40,
  build(game, kit),   // function, async function or generator (yield a 0..1 progress between sections); returns L or fills kit.L
};
```

`kit = { K, root, L, r, batch, mats, phys, game, add(obj), track(obj), ...levelkit }`. `K` is the chapter's
Batcher kit (merged into `root` after the build), `r` the seeded random stream (`rng(seed ?? 42)`; consume it in a
stable order), `L` the level object below, pre-filled with empty lists.

Levelkit helpers (`src/game/levelkit.js`): `FZ` (facade line −1.6), `solid, vbox, ground, block, lantern, cp,
cam, shaft, facades, farBuilding, skyline({exclude, exclude3, excludeTrees, ...}), cypress, rubblePile,
crateMeshStatic, kerb(x0, x1, h = 0.15), killZone(x0, x1, y0, y1, kind)`.

### 4.3 The level object L

```js
L = { entities[], systems[], interactables[], triggers[], checkpoints[], cameraKeys[], killZones[],
      lanterns[], lightSources[], shaftSpots[], dustRegions[] (non-empty), flockSpots[], covers[], hints[],
      credits?, bounds: {x0, x1, y0, y1}, shadowExtent?, finale?: DepthWalkConfig,
      prepare(cp, game), mix(x, game), safeZone(x), lookTarget(player), extraState(), onComplete?(game) }
```

- **Entities**: optional `id`, `prestep()`, `step(dt)`, `render(alpha, dt)`, `dispose()`; mandatory `getState()` / `setState(s)`.
- **Systems**: `prestep?`, `step(dt)` (after physics), `render(alpha, dt)`, `getState`/`setState`, `dispose`.
- **Interactables**: `near(x, y, facing) → bool`, `grab(player)`, `release()`, `drive(input, dt, player)`, optional `playerState` (default `'lever'`).
- **Triggers**: `test(game)`, `getState`/`setState` (the `Trigger` class).
- **Snapshots** are keyed by `id`; entities, systems and triggers without one get `Kind#i` in build order. Saves never contain snapshots.
- **Checkpoints** `{x, minY?, spawn: {x, y, facing}}` activate when the boy is grounded, `x ≥ cp.x` and `y ≥ minY`.
- **Kill zones** `{x0, x1, y0, y1, kind}`: the boy dies (`kind`) when his feet enter one.
- `prepare(cp, game)` solves what precedes checkpoint `cp` (called for every start, including 0); `extraState()` is the chapter's part of `__medina.state().extra`.
- Lanterns `{mesh, phase, lit}` get a glow sprite unless `lit === false`; `lightSources` `{pos, intensity, phase}` become pool sources.

Coordinates are chapter local (FULL_GAME §1.2): x right, y up, ground y 0, play plane z 0.

### 4.4 The loader (`src/game/chapterloader.js`)

`game.loadChapter(id, cp, {reason, onProgress})` (queued; reasons `boot | start | chain | continue | select | restart | title`):

1. cover: fade the canvas (a chain fades to the finished chapter's `exit` colour, others to black), then `hooks.card(meta, {reason, from})` except for restart and title; the card resolves once it covers the screen and its `hide()` keeps it up at least 2.5 s;
2. mode `loading` (no simulation, no rendering);
3. unload: entity and system `dispose()`, the cinematic, rig spots released, pool sources cleared, then one sweep of the root disposing geometries, non-cached materials and their textures (cached materials, baked surfaces, the env map, the glow texture, the rig cookies and GLB-override templates are kept), tracked objects, `phys.clear([player.body])`, overrides dropped;
4. `resetChapterState()`;
5. the look (`director.apply` or `.keys`; the env map is rebuilt when the sky changes);
6. `registerSurfaces(def.surfaces)`, `mats.register(def.materials)`, progressive bake of `def.needs`;
7. `def.build(game, kit)` (generators yield to the browser every 8 ms), then the batch merges into the root;
8. FX on the root (`Shafts(root, director.sunDir, G)`, its dust, `Dust(root)`, `Flock(root, mats, L.flockSpots)`), glow sprites, pool sources;
9. camera keys, sorted checkpoints, the initial snapshot, `L.prepare(cp)`, the checkpoint snapshot, spawn;
10. `renderer.compileAsync` with hidden objects made visible, one warm-up render;
11. `enterChapter`: `save.begin`, `audio.setChapter?.()`, `chapterStart`, the intro shot (title on boot), fade in, card hidden.

## 5. Game (`src/game/game.js`)

**Modes** `boot | menu | loading | intro | play | dying | cutscene | finale | chapterEnd | credits`, plus `paused`.
Input reaches the boy in `play` and `finale`; the simulation runs in every mode but `boot` and `loading`.
`setMode(m)` emits `mode`.

**Fixed step (120 Hz)**: pin → entity `prestep` → system `prestep` → `player.step` → entity `step` →
`phys.stepBodies` → crush test (`body.crushes`) → system `step` → kill zones → (play) triggers and checkpoints →
player events → dying → cinematic update (finale, cutscene). Rendering interpolates with `alpha`.

**Pin** (what the boy reads): `x, y, jump, grab, jumpPressed, upPressed, downPressed, grabPressed, pointerPressed,
aimTarget` (the pointer's ray on z = 0 while `pointer.active`, or a scripted `{x, y}`).

**Flow API**: `newGame()`, `continueGame()`, `startChapter(id, cp)`, `loadChapter(id, cp, opts)`,
`completeChapter()` (save, `chapterEnd`, `L.onComplete`, then the next chapter behind its card or the credits),
`rollCredits()`, `restartCheckpoint()` (no death counted, fade out 0.25 s and in 0.3 s), `restartChapter()` (in place
from the initial snapshot), `toTitle()`, `setPaused(p)` (freeze-frame: one dimmed frame, then no rendering;
`audio.setPaused?.(p)` or a suspended context), `setMenuOpen(b)` (input zeroed), `startFinale()` (`L.finale` as a
DepthWalk), `fadeTo(target, {color, sec})`, `recoverContext()`, `redraw()`.

**Settings** `applySettings(s, {persist})` merges into `game.settings` and saves (debounced 500 ms):

| Key | Default | Applied by |
|---|---|---|
| `shake` 0–100 | 100 | `camRig.shakeScale` |
| `reduceMotion` | false | `camRig.reduceMotion` (no handheld drift) |
| `cameraDist` close / normal / wide or a number | normal | `camRig.distMul` 0.85 / 1 / 1.12 |
| `timeScale` 1 / 0.85 / 0.7 (or 100 / 85 / 70) | 1 | `game.timeScale` |
| `generous`, `coyote`, `buffer` | false | `player.tune` (0.18 / 0.2 when generous), `game.guardSpeedMul` 0.95 |
| `assist` | false | `game.assist` (chapters lengthen clocks and dazzles) |
| `brightness` −3…3, `grain` 0–100 | 0, 60 | `director.setUser` |
| `dof` | true | DOF blur off when false |
| `quality` auto / low / medium / high / ultra | auto | `rs.setTier`, `rs.autoQuality` |
| `fpsCap, renderScale, dynres` | null, 100, true | `rs.applySettings?.(s)` |
| `volumes{}` | {} | `audio.setVolumes?.(v)` |
| `hints, invertTilt, aimSnap, grabMode, crawlMode` | first, false, true, hold, hold | stored for U and L; `input.applySettings?.(s)` |

**Hooks** `game.hooks = {frame: [fn(dt, game)], card: fn(meta, opts) → Promise<{hide()}>, credits: fn(lines) → Promise, hint: fn(id, game)}`.

**Mix**: every frame `game.mix = {crateSpeed, hum: 0, tension: 0.1, height, birds: true, chase: false, finale,
zone: null, music: null, loops: {}, ...L.mix(x, game)}` → `audio.update(dt, mix)`; a changed `zone` calls
`audio.setZone?.(zone)`.

**Shadow focus**: the override's `shadowFocus` while an override shows (weight > 0.5), else the camera's look
(x, y, z −2; −8 in a finale).

**Determinism**: with `?hold=1` the sim advances only through `__medina.sim`; game time is sim time, so two runs
of a bot give identical end states (`tools/playtest.mjs --runs 2`).

`game.registerExt(name, fn)` publishes `__medina.ext[name]`; `game.emit(name, data)` is the event bus.

## 6. Cinematics (`src/game/cinematics.js`)

`DepthWalk(game, cfg)`: `{path: [{p, pause?, pose?, onArrive?}], from: [x, y], walkSpeed 1.55, autoWalkAfter 2,
camera(t, game, walk) → {pos, look, fov, shadowFocus?}, cameraBlend 3.2, sunTo?: {dir, color, colorAmt, sec},
fogMul?, grade?: {contrast, saturation}, letterbox?, rays?, bloom?, dof?: {near, far}, zEnd, endHold 4.2,
fade: {color, speed}, onEnd(game)}`. It drives the boy along a centripetal Catmull-Rom curve, pauses at waypoints
(`walk.pose` names the pose for the animator), writes every look change as a LookDirector override and restores
the preset on `stop()`. When the boy passes `zEnd` the screen fades to `fade.color`; `endHold` seconds later
`onEnd` runs (default `completeChapter()`). `introShot(game, shot)` and `menuShot(game, shot)` return camera
overrides with a live sway.

## 7. Rendering foundation

**Presets** (`src/render/look.js`): `goldenHour, sunset, dusk, night, dawn, sunrise` (FULL_GAME §9.3) share one
schema; every field blends (colours `#hex`, vectors arrays): sun direction, colour, intensity and disk; hemi; sky
zenith, horizon, ground, clouds, exposure; `night, stars, moon, moonDir, moonColor, moonSize`; fog colour, sun
colour, density, falloff, start; wind; post `exposure, bloom, bloomThreshold, vignette, grain, saturation,
contrast, shadowTint, highlightTint, lift, rays, rayColor`; `lanternPool, lanternGlow, glassGlow, poolColor`;
`envIntensity`; `shadowBias, shadowNormalBias`.

**LookDirector** (`game.director`): `apply(preset)`, `keys([{x, preset}])` with `update(x, dt)`, `blendTo(preset,
sec)`, `blendAt(from, to, t)`, `override(fields)` / `restore()`, `get(name)`, `setUser({brightness, grain})`. It
owns `director.sunDir` (= `world.sunDir`, read by shafts, atmosphere and the sun light) and writes the sky (and
`uNight, uStars, uMoonDir, uMoonColor, uMoonSize` when the sky has them), sun, hemi, fog, post, the pool colour and
multiplier, `glowMul`, `glassGlow.emissiveIntensity`, env intensity and `shafts.setSun?.(dir, colour)`; a sky change
rebuilds the PMREM.

**Light rig** (`game.lightRig`): one shadowed directional, one hemisphere, `charLight`, `pool` (N points fixed at
boot) and two shadowed spots whose `map` is always a cookie. `acquireSpot(owner)` / `releaseSpot(owner)` /
`releaseAll()`, `setCookie(tex)`, `setTier(t)`, `census()` → `{dir: 1, hemi: 1, point: 1 + N, spot: 2}`, identical in
every chapter. A searchlight takes a spot within view half-width + 10 m of the camera and frees it beyond + 14 m.

**Light pool** (`game.lightPool`): `add(pos, intensity, phase)` (static, flickers), `addDynamic(owner, priority,
{intensity})` (the owner moves it every frame and wins a light ahead of static sources), `remove`, `clear`,
`setColor`, `setMul`.

**Materials and surfaces**: `mats.register(defs)`, `mats.setEnv(tex, scale)`, `registerSurfaces(defs)`,
`SURFACES`, `bakeAsync(baker, names, onProgress, out, slice)`, `world.bake(names, onProgress)`,
`world.rebuildEnvironment()`, `baker.rebakeAll()`. A surface not listed in `needs` is baked on first use with a
warning.

## 8. Camera rig (`src/game/camera.js`)

Keys `{x, dist, distPortrait?, height, lookY, fov, ahead, side, yBias, focusBias, dofNear, dofFar, pitchBias}`
blended along x; `setKeys`, `reset()`, `paramsAt(x)`, `addShake(a)`, `setOverride(fn, blend)` /
`clearOverride(blend)`, `setSafeRect({x, y, w, h})` (lens shift through `setViewOffset`; null clears),
`distMul`, `shakeScale`, `reduceMotion`, `shadowFocus`, `curPos` / `curLook` (after overrides). Portrait screens
use `distPortrait` and a 52° horizontal field-of-view floor (46° in landscape).

## 9. Input (`src/core/input.js`)

`poll()` → `{x, y, jump, grab, pause, any, pointer}`; edges `jumpPressed, grabPressed, pausePressed,
anyPressed`; `pointer = {x, y (NDC), active, pressed, released, kind}` (left mouse or a touch on the canvas);
`nav = {up, down, left, right, confirm, back}` edges with repeat (400 ms, then 120 ms); `lastDevice`,
`keyLabels`, `override` (scripted input).

## 10. Saves (`src/core/storage.js`, `src/core/save.js`)

Every access goes through `storage` (try/catch, in-memory fallback, `available`). Key `medina.save.v1`:
`{v: 1, chapter, cp, unlocked: [ids], cps: {id: maxCp}, completed, settings: {}, stats: {playSec, deaths,
perChapter}, seenHints: {}, savedAt}`; thumbnails under `medina.v1.thumb.<id>`. Written on checkpoint advance
(debounced 1 s), chapter end (at once), settings (500 ms), pause, hidden page and pagehide (`flush(true)`). Continue
loads `{chapter, cp}` and the chapter's `prepare(cp)`. A turning rosette (top right) shows each write.

## 11. Test API and tools

`window.__medina`: `game, chapter(), loadChapter(id, cp) → Promise<state>, state() → {x, y, z, st, crawl, dead,
mode, cp, t, deaths, chapter, extra}, sim(sec, input | fn(state)) (input may carry aimTarget or pointer),
teleport(x, y, facing), checkpoint(i), finale(), restartCheckpoint(), setInput(o), closeup(pose), photo(x, y,
facing, sim), pause(p), events(n) (ring buffer of {name, t, data}), lights() (census), save(), info() (renderer
counts), ext{}`. `window.__info()` adds the state to `info()`.

| Command | What |
|---|---|
| `node tools/playtest.mjs --chapter souk [--cp N] [--from step] [--to step] [--runs 2]` | the chapter bot (`tools/bots/<chapter>.js` on `tools/bots/lib.js`); exit 0 on pass; several runs must agree on the end-state hash |
| `node tools/negative.mjs --chapter souk` | `tools/neg/<chapter>.mjs` as assertions; `--selftest-fail` must exit 1 |
| `node tools/negative.mjs --suite foundation [--artifact] [--base-port N]` | chain and Continue, throwing storage, title shadow focus, look round trip, context loss, boot budget; `--artifact` also rebuilds and boots the single-file build; `--base-port` times the boot against a server of the pre-foundation tree under the same load instead of the recorded baseline |
| `node tools/cycle.mjs [--cycles 3] [--path souk,lab,souk,sundown,souk]` | memory flat, programs stable, light census constant, no page errors |
| `node tools/probe.mjs "<query>" "<js>"`, `tools/tour.mjs`, `tools/shot.mjs` | ad hoc evaluation and screenshots; all take `--port`, `BASE=` and `--chapter` |
| `npm test`, `npm run test:souk`, `npm run test:foundation`, `npm run cycle` | the suites above |

The harness (`tools/lib/harness.mjs`) runs one headless Chromium on SwiftShader with the low-cost URL
(`autostart, tex 0.1, tier low, noauto, nosave, hold`). Bots are step lists `{name, input(s, G), until(s, G),
max}` that read the live level (`G.level`) inside their closures and end on entity state.
`docs/baselines/souk.json` and `docs/baselines/souk/` hold the pre-foundation reference (bot time, counts,
screenshots).

## 12. Registries

**Engine events** (`game.events`; payloads in `__medina.events()` keep plain values only):

| Event | Data |
|---|---|
| `chapterStart` | `{id, cp, reason}` |
| `checkpoint` | `{id, cp}` |
| `death` | `{kind, x, y}` (`shot, caught, fall, crushed, drown, sunset, ...`) |
| `respawn` | `{cp, restart}` |
| `chapterEnd` | `{id, next}` |
| `credits` | `{lines}` |
| `pause` | `{on}` |
| `mode` | `{mode}` |
| `land` | `{hard, speed}` |
| `impact` | `{x, speed, kind}` |
| `save` | `{chapter, cp}` |
| `contextLost`, `contextRestored` | `{}`, `{id, cp}` |

Chapters and entities may emit their own through `game.emit(name, data)`.

**Sound names** (`audio.play(name, x, data)`; unknown names fall through silently):

| Group | Names |
|---|---|
| Boy | `step` `{surface, speed}`, `jump`, `land`, `grab`, `grip`, `climbUp`, `vine`, `drop`, `crawl`, `death` |
| Mechanisms | `crateImpact`, `plateDown`, `plateUp`, `gateStart`, `gateStop`, `gateSlam`, `bridgeStart`, `bridgeSlam`, `lever`, `ladder` |
| Lamps and guards | `alarm`, `dart`, `shout`, `guardStep`, `guardVault`, `guardFrustrated`, `grabbed` |
| World | `wings` |
| Reserved (FULL_GAME §9.4) | `mirrorGrip`, `notch`, `mirrorRoll`, `crank`, `capstan`, `lockCharge`, `lockOpen`, `boltShut`, `ropeSmoulder`, `ropeSnap`, `counterweight`, `dazzle`, `fixate`, `turret`, `dartGuard`, `guardStun`, `guardSleep`, `tripHum`, `plankCreak`, `plankFall`, `dyeSplash`, `lift`, `liftStop`, `hatch`, `trayPick`, `trayInsert`, `sunsetTick`, `lampsOn`, `lampsOff`, `answeredLight` |
