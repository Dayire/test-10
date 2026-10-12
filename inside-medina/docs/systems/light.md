# Sunwork: the light mechanic (package L)

Owner files: `src/game/light/**`, `src/assets/lightprops.js`, `src/game/{player,animator,entities,bridge,physics}.js`,
`src/chapters/lab/**`, `tools/bots/{lab,lightlib}.js`, `tools/neg/lab.mjs`, `tools/light-unit.mjs`. The design is
FULL_GAME §6 (with §1.3 and the puzzles of §3–5); this page is how it is built and how chapters use it.

## Model

Light is 2D in the play plane (x right, y up, metres; angles in degrees counter-clockwise from +x), traced every
second fixed step (60 Hz) against the colliders the boy collides with. A mirror's surface angle α turns in 15°
notches; a beam arriving at θi leaves at θr = 2α − θi; each reflection keeps 95 % of the intensity and a beam
stops below 0.4. Sun 1.0, searchlight 1.5, beam lamp 1.0, moon 0.5.

What blocks light: enabled solids (one-way cloth too) unless `light: 'pass'`; bodies (crates, mirror stands, the
boy, guards) unless `light: 'pass'`; mirror trays; light-only `Occluder` boxes; light-only planks (a raised
drawbridge: any entity's `lightPlank` / `lightBox`). Targets (locks, photocells, eyes, sensors, ropes) absorb the
beam that reaches them; a target is lit where the beam enters its circle (or box).

**Trays reflect on both faces.** The fixtures of §3–5 need it (II-B2 starts on the underside at +30° and is solved
on the top face at −45°; IV-A1's crank is solved on its underside). `oneSided: true` makes the back face (against
the normal (−sin α, cos α)) block instead.

## Code map

| File | Content |
|---|---|
| `light/trace.js` | Pure (Node-safe): angle maths (`reflect`, `wrapAlpha`, `notchOf`, `alphaFor`), ray against box / tray / circle, `LightWorld` (statics bucketed in a 4 m x-grid; bodies, occluders, planks, mirrors and targets always tested), `trace()`, `clear()` (line of sight) |
| `light/logic.js` | Pure rules: `chargeLevel`, `heatStep`, `keyed`, `clockT` / `clockDeath`, `magnet`, `liftClamp`, `crossAt` |
| `light/system.js` | `LightSystem` (a chapter system), `physicsWorld(game)` (line of sight for chapters without one) |
| `light/sources.js` | `SunRay`, `MoonRay`, `BeamLamp`, `SearchlightSource` |
| `light/mirror.js` | `Mirror` (wheeled, anchored, crank, continuous), `Crank`, `Capstan` |
| `light/targets.js` | `SunLock` (latch, hold, bolt), `Photocell`, `LampEye`, `Sensor` (tripwire + dart turret), `BurnRope`, `Occluder` |
| `light/time.js` | `Terminator`, `SunClock`, `Hatch` |
| `light/beams.js` | `BeamRenderer`: ribbons, sunspots and glints on `LAYERS.BEAMS`, the priority pool light |
| `light/index.js` | everything above, one import |
| `assets/lightprops.js` | `trayMesh`, `mirrorStand`, `crankBracket`, `crankHandle`, `capstanMesh`, `rosetteLock`, `beamLampMesh`, `sensorMesh`, `ropeMesh`, `starInlay`, `starCookie`, `lightTextures`, `lightMaterials` (registers `mirrorBrass`, `brassAged` (a satin patina, metal 0.6, rough 0.55, so it keeps a warm value at dusk and night), `silverPlate`, `ironDark`, `hemp`) |

## Using it in a chapter

```js
import { LightSystem, SunRay, Mirror, Crank, SunLock } from '../../game/light/index.js';
const light = new LightSystem(game, kit);            // registers __medina.ext.light
L.systems.push(light);
light.add(new SunRay({ id: 'sun3', x: 46.45, y: 2.93, angle: 195 }));
const M1 = light.add(new Mirror(game, { id: 'M1', kind: 'wheeled', x: 33, alpha: -15, zone: { x0: 31, x1: 45.2 }, thetaHint: 195 }));
const L3 = light.add(new SunLock(game, { id: 'L3', x: 37, y: 4.2, degree: 2 }));
const G3 = new Gate(game, { x: 46, h: 2.2, lift: 2.0 }); G3.source = () => (L3.done ? 1 : 0); L.entities.push(G3);
// a crank: the handle is an interactable the system adds to L.interactables
const F2 = light.add(new Mirror(game, { id: 'F2', kind: 'crank', x: 118.4, y: 6.8, alpha: -15, thetaHint: 105 }));
light.add(new Crank(game, { id: 'K2', x: 118.2, y: 4.0, mirror: F2, dir: -1 }));
// a searchlight joins: tray-aware line of sight, a reflectable beam, an eye that can be dazzled
const S2 = new Searchlight(game, { id: 'S2', origin, x0, x1, aimY: 0.4, covers }); L.entities.push(S2); light.lamp(S2, { dazzle: 7 });
```

The system owns its children: it steps, snapshots (`getState` aggregates them by id) and renders them; do not add
them to `L.entities`. `prepare(cp)` sets solved states with each child's `setState`. Gates, hatches and bridges stay
ordinary entities driven by `source()` closures (`lock.done`, `1 - bolt.level`, `rope.burnt`). A `Gate` is a lattice
portcullis and lets light through by default (`light: 'block'` for a solid door): lifted, it slides up past the window
above it, which would otherwise shut the ray that holds a sun-bolt.

| Entity | Main options | State |
|---|---|---|
| `SunRay` / `MoonRay` / `BeamLamp` | `x, y, angle, I, enabled (bool or fn), clipByTerminator (true: the system's terminator, or a Terminator), width, color` | `{on}` |
| `Mirror` | `kind, x, y (floor, or the pivot for crank / continuous), alpha, r 0.4, pivotH 1.2, zone {x0, x1}, home, killY, thetaHint, range [lo, hi], oneSided, enabled, z` | `{x, y, alpha}` |
| `Crank` | `x, y (handle floor), mirror, dir (the side he stands, -1 left), stand 0.42 (he is taken within the lever's 0.45 m of x + dir·0.55 and works it from x + dir·stand, where both hands reach the wheel)` | via the mirror |
| `Capstan` | `x, y, mirror (continuous), dir, rate 6, magnet {alpha, window 2}, range, stand 0.9 (from the drum's axis: the eight bars pass in front of him)` | via the mirror |
| `SunLock` | `x, y, r 0.35, need (0.8 gold, 0.4 silver), mode latch / hold / bolt, chargeT 0.6, decayT 0.5, metal gold / silver / iron, degree, mount (stem length to the wall), rod [[x, y, z], …], onOpen, rides {body, ox, oy}` | `{level, done}`; `value` = gate source |
| `Photocell` | a hold-mode lock, r 0.15, chargeT 0.08, may `ride` a body | `{level, done}` |
| `LampEye` | `x, y, z, r 0.8, lamp, onHit, hold 0.1, dazzle 7, face` (reflected light only; assist +50 %; with `face` (deg) only light travelling toward that face counts: the fortress lamp looks east, so a beam sent straight back from the west never ends the chapter). Refractory: while its lamp is `blind` (dazzled or settling) it neither fires nor re-arms; it re-arms 0.5 s after the reflection has left it once the lamp sees again | `{fired}` |
| `Sensor` | `from [x, y], to [x, y], darkT 0.2, lamp (a Searchlight to slave)` — creates its own `BeamLamp` | `{state}` |
| `BurnRope` | `x0, y0, x1, y1, need 1.6, burnT 1.5, cool 0.5, onBurnt` | `{heat, burnt}` |
| `Occluder` | `x0, y0, x1, y1, mesh`; `to({y0, y1}, sec)` | `{x0, y0, x1, y1}` |
| `Terminator` | `T, keys [[x, T], …], range [x0, x1] (where its shadow line is drawn)` | `{T}` |
| `SunClock` | `T0, rate, y (the ray it kills), terminator, look {from, to, sec}, onExpire (default: die 'sunset'), onReset`; `finish(sec 6)`: the race is won, the sun sets (T climbs past the ray, nobody dies) | `{t, running, expired, setT}` |
| `Hatch` | `x0, x1, y0, y1, source, hinge` | `{open}` |

### Player states and input (§6.3)

- **Grip a mirror** exactly like a crate (hold grab beside its stand). ←/→ push or pull (wheeled); an anchored stand
  never moves and walking away lets it go. **Tilt**: |y| > 0.6 and |y| > 1.2·|x| steps one notch at once, then every
  0.22 s while held; up raises the far rim (+α facing right), `settings.invertTilt` flips it. The tray turns to its
  notch in 0.15 s (`settled`). Tilting input never pushes the stand.
- **Crank**: hold grab within 0.45 m of its stand point; ↑/↓ step notches (up is +α); state `crank`; he turns a
  little into the wheel (both cranks and the capstan stand behind the play plane).
- **Capstan**: ←/→ turn the continuous mirror at 6°/s; state `capstan`; the magnet pulls within ±2° once the input
  is released.
- **The jump-buffer fix**: an up-press buffers a jump only when the boy holds nothing — never while gripping a crate
  or a mirror, in the lever, crank or capstan states, or with grab held next to something he can take; a jump
  buffered by an up-press just before a grab is dropped. Only the jump button jumps from those states (it drops
  the grip; from a crank or the capstan it lets go and jumps).
- **Latched grips**: `settings.grabMode === 'toggle'`, or touch (`input.lastDevice === 'touch'`) on a mirror, crank
  or capstan: a tap takes it, the next tap lets it go, however long that tap is held (the releasing press never
  takes the prop again until grab is released; lab negative "a second tap lets a latched grip go").
- **Finger / mouse aim**: while gripping or cranking, `pin.aimTarget` sets the wanted reflection θr* = the direction
  from the pivot to the point; α* = (θr* + θi)/2, θi the beam lighting the tray (or `thetaHint`), rounded to a notch,
  on whichever turn of the tray's line (α, α ± 180) lies inside its travel nearest the current notch (`Mirror.fit`:
  from +75 a wanted −75 is −75, never a clamped +90).
  With `settings.aimSnap` (default on), if that notch lights no target but a neighbour does (a probe trace), the
  neighbour wins.
- A grip survives a step down of up to 0.26 m (a kerb), so pushing a stand off a rail kerb keeps the hands on it.
- `L.deathColor(kind)` (a chapter hook): the colour the screen dims to on that death (the lab: indigo `#0b1026` for
  `sunset`). The engine's `updateDying` fades to it (requests/L.md #2, applied at the integration), and the final pass
  display-encodes the fade colour (#8), so the screen ends on the colour's own hex (11, 16, 38).
- `player.reachable()` → `'mirror' | 'crank' | 'capstan' | 'crate' | 'lever' | null`: what grab holds or would take
  now (the touch grab button's icon, requests/L.md #5). `player.shoulders()` (world, as last drawn) and
  `player.armReach()` (0.43 m: arm and palm) let props choose holds he can reach.
- `player.animContext()` adds `tilt {age, dir, rim}`, `crankA`, `capstanV`; animator states `crank`, `capstan`,
  `reach`, `sit` (DepthWalk poses `reach` / `insert` / `sit`), the tilt overlay on push / pull, the guard's
  `shieldEyes` and `asleep`, and the `sunset` death (a slow kneel).

### Searchlights (§6.4: one rule, "lit = seen")

The lamp sees the boy when his head (0.85 h) or chest (0.5 h) is inside its cone (×0.92 of the spot angle), no
cover box crosses the 3D line, and the 2D line from the lamp to the point crosses no light blocker (solids, solid
bodies, mirror trays, guards). Chapters without a LightSystem use `physicsWorld(game)` (solids and bodies only).
Chapter I is unchanged: its courtyard has no blocker between the lamp and the floor (the souk bot keeps its
hash, all 13 souk negatives pass). New: `mode 'sweep' | 'watch'` (`watchAt`, `detect`), `power` (520; the lab's night
lamps 200, so the lattice pool survives the bloom), `dazzle(sec)` (aim up 8 m and back toward the lamp by up to 4 m,
clear of the walls at the end of its sweep; the beam whitens, sees nothing), `fixate(target, {while})` (a 0.05 rad wedge on the target), `light.lamp(sl)`. The
cone is on `LAYERS.BEAMS` with `softFade` and ends with the fog chunk (requests/P.md #9). It still takes one of the
rig's two spots near the view.

The dazzle's lifecycle: `dazzled` for `sec` (7, 10.5 with assist), then `recover` for 0.9 s: the aim eases back
onto the street (no jump) while the sweep runs on toward the far end with no pause, away from the rest that blinded
it; `blind` is true in both states (nothing is seen, its eye cannot fire). It then sweeps normally and sees the boy
again within one sweep cycle; at its rest the mirror can dazzle it again. A blind beam fades out over the last 70 %
of its reach (it ends in the air near its aim) instead of showing its cut end; the whitening and the lens boost are
halved again by `reduceFlashing`.

### Guards

`stun(sec)`: shield-eyes, no chase, then 2 s of immunity; `stun(Infinity)`: the asleep collapse (a turret dart): the
knees buckle, then he falls back flat on the stones (the pelvis a torso's half depth up, one knee raised, the robe
flattened), his lantern set down upright beside him (a lantern never sinks through the floor), his body (a light and
line-of-sight blocker) dropping to 0.45 m while he lies there. `onLight(I, dt, sys, sky)`: daylight
of I ≥ 0.8 stuns for 1.2 s (a sun shaft, a reflected sunbeam); `sky` is the share of sun and moon rays, so a
searchlight's or a tripwire's own beam never stuns a lamp-keeper. Steps of ≤ 0.26 m are climbed, not vaulted.

## Rendering

- Every traced segment is a camera-facing ribbon (one draw for all beams, 96 segments): a hot core, a dusty haze
  and drifting motes, faded into geometry by the soft pass; its half-width never drops under 2.2 px, in render
  pixels and in CSS pixels (whichever is wider: a phone renders at 2× or more), so thin beams still read on a phone;
  on a screen under 900 CSS px tall a tripwire keeps 3 px and glows 30 % more. A segment that ends in a lamp's eye
  is drawn to the lamp's real z. A searchlight's own first segment is its cone, not a ribbon.
- Moonlight is weak (it half-opens a gold lock), so a moon beam is drawn soft: a faint core in a wide, pale, cool
  haze (`#9fb4e0`, 0.9 m) that dies out before the ribbon's edge, thick with slow dust.
- Where a beam ends: a sunspot glow; on a lock, a halo ring just outside its rim, drawn behind the petals (its
  strength follows I / need) so the petals stay silhouetted against it; where it reflects: a star glint above the
  bloom threshold (one instanced draw for all three; the glint texture keeps its strength in alpha).
  `settings.reduceFlashing` dims them, the rod glints and the dazzle.
- `settings.highContrast`: beams and tripwires gain an outline along both ribbon edges (and a 3.4 px floor), a
  searchlight cone its silhouette line, and every lock a bright rim ring.
- The brightest end spot in view is a priority dynamic source of the light pool (priority 3), so a real point light
  warms the wall around it; the census never changes. Only spots within the view (half-width + 1.5 m of the
  camera's look) compete, nearest the look among equals; a searchlight's own cone leg (it has a rig spot) and
  tripwire threads never do; a jump to another spot fades the light in there.
- Beam colours: the sun's beams take the live key light's hue (lifted toward warm white), the moon's are silver-blue,
  a searchlight's follow its lamp (red in alarm, white when dazzled), tripwires are thin amber lines.
- Locks read by shape: twelve brass petals hinged on the rim. Closed they meet over the lens as a domed bud (a disc
  of radius r); with the level they swing out through the camera side (half: a crown standing toward the camera)
  until, open, they lie past the rim as a twelve-ray sunburst (~1.9 r) around the lens. The lens glow follows the
  level and stays under the bloom threshold (0.9 at full, +0.35 latched). Silver for moon-locks, iron for bolts
  (whose petals close while lit); a latch sends a glint along its brass rod. The petals are re-composed only when
  they move.
- The terminator is an invisible slab toward the sun whose shadow edge sits at T on the play plane. It is drawn into
  the sun's shadow map only (an empty draw range in every camera pass and other lights' shadow maps). With a
  `range` it is cut to that stretch of the play plane in light space, so its ends are fixed in the world (the lab's
  clock terminator shades x 146 to the night square's edge and never the square, under the moon or the dusk sun).
- The boy's hands hold the prop: the player gives the animator world points (`handHolds`) chosen from his real
  shoulders and his reach, and a two-bone IK over the pose puts the wrists there, eased in and out. A tray: each
  hand on the rim point nearest its shoulder (0.2 m apart at least); a hand the rim is out of reach of (a tray
  stood on end) steadies the stand by its top edge instead, with a margin both ways so it never flickers; for a rim
  above his shoulders he stands tall on his toes. A crank: both hands on the wheel's near rim, carried round with
  the wheel through a turn and re-gripped (past 50°, or once the tray settles). The capstan: both hands on one of
  its eight bars at the points nearest his shoulders, kept while he reaches it, then the next bar (hand over hand).
  A hold that moves with its prop is followed exactly; a new hold is glided to. Measured: every tray notch on
  both sides, both cranks at every angle and the capstan idle or turning either way put each wrist a palm (0.05 m)
  from its hold (0.066 m at most while the capstan turns).
- `starCookie()` is the lamp-keepers' eight-point star lattice for the rig spots (`lightRig.setCookie`): four bold
  stars across, so they read where the pool lies far off or across the stones at a slant; the lab uses it in its
  night rooms. While the rig carries it, a searchlight's cone shows the lattice's shafts (streaks from the lamp,
  read off the lattice around the cone's axis); with the disc cookie (Chapter I) the cone is unchanged.
- Draw calls (chapters fill rooms with these props): the parts that move together share one mesh, a second metal is a
  vertex tint on the first (iron on a cart's wood, the engraving on the dish), the tray's axle rides the stand (a
  cylinder about z needs no turning) and small parts cast no shadow. A wheeled or anchored mirror is 3 draws (2
  shadow casters), a crank tray 2, a crank 2, the capstan 2, a lock 3 (2), a sensor 4 (1), the rope 1.

## Sounds and events

Sounds (P's names): `mirrorGrip`, `notch {notch, stop, steps}`, `mirrorRoll {speed}`, `crank`, `capstan`,
`lockCharge {level, degree}`, `lockOpen {degree, bolt?, hold?}`, `boltShut`, `ropeSmoulder {heat}`, `ropeSnap`,
`counterweight`, `dazzle`, `fixate`, `turret`, `dart`, `dartGuard`, `alarm {tripwire}`, `guardStun`, `guardSleep`,
`tripHum`, `sunsetTick {urgency}`, `answeredLight`; stingers `lockOpen`, `ropeSnap`, `dazzle`.
Events (`game.events`, for haptics, hints and tests): `notch {id, notch, alpha, aim?}`, `lockOpen {id, degree}`,
`ropeSnap {id}`, `alarm {id, by}`, `dart {id, at}`, `dazzle {id, sec}`, `lampDazzled {id, sec}`, `lampFixate {id}`,
`guardStun {x, sec}`, `guardAsleep {x}`, `mirrorLost {id, x}`, `mirrorHome {id}`, `clock {id, on, duration?, expired?}`.

## Test API

`__medina.ext.light()` → `{beams: [{src, on, I, pts, ends}], targets: [{id, kind, level, done, lit, I, state}],
mirrors: [{id, kind, x, y, alpha, target, notch, settled, lost, enabled}], lamps: [{id, state, dazzled, fixated, aim}],
stats: {traceMs, p95, max, passes, segs}, T, trace(x, y, θ, I) → {pts, hits}, solve(targetId, {depth 3}) → [{mirrorId:
degrees}], resetStats(), samples(), sys}`.

## The lab (`?chapter=lab`)

Twelve rooms (`ROOMS` in `src/chapters/lab/rooms.js`), one per verb of §6.7 plus the jump-fix and kerb rooms, built
on the numbers of §3–5 (Chapter II's rooms keep their x; the night rooms are Chapter III's moved +176 / +255 / +140,
dawn Chapter IV's +330 / +310): **1 sunlock** (II-A1 laundry gust), **2 shadow** (II-A2), **3 kerb** (II-B1), **4 tilt**
(II-B2), **5 jumpfix** (an anchored tray that must go up three notches), **6 bolt** (II-C2), **7 crank** (II-D1), **8 burn**
(II-D2), **9 clock** (II-E2 with the terminator and the sunset → dusk blend), **10 lamp** (III-B1 bounce, III-B2 dazzle),
**11 wire** (III-A basket and tripwires, C2 walk-under, D the darted guard, E the moon well), **12 dawn** (IV-A1 under
the descending terminator, IV-C sun shafts on a captain, IV-E the heliostat and the fortress lamp). The look follows
the day (sunset → dusk → night → dawn → sunrise); `?look=<preset>` holds one preset for every room. Each puzzle room
holds its frame while the boy is in it (`frame(x0, x1, cx)`: keys at both ends and the middle with focusBias cx − x
and no look-ahead), so the source, the tool and the target share one frame, and `distPortrait` fits the room's span
inside a phone's 52° field; the compact rooms (tilt, the bolt's work zone) follow him closer on a phone. On the clock tower the frame stays down on the
ray's whole path (yBias keys undo his height: the camera follows the ground he stands on), so F3 and L8 share it
while he cranks; the crank room's frame keeps M7 on the floor above the legend while he cranks on the gallery; the
dawn ray enters from beyond the frame's edge; the night rooms come closer on a phone. A won sunset
clock sets the sun over 6 s (the last ray is gone in the night rooms). The burn room's rope is tied to a wall ring
and runs up through the burn point, over two pulleys under the beam, down to the counterweight; the window
apertures glow with the live sky (the sun's colour and strength, plus the sky's light). In the lamp square the gate stands at the
front of a wall that parts the square into two courts, LL1 on an iron arm from it. Checkpoints
start each room with the earlier ones solved. The lamp room is an open square (no facades in front of the
lamp-keepers' wall), so the cones fall whole from the lamps to the street. Tripwires hum (`tripHum`) within 3 m.

**IV-E's camera** (what the chapter's own heliostat needs too, FULL_GAME §5.2 P4). The rail alone cannot frame it: the
camera follows the ground he climbs, so a look high enough for the mirror from the street puts him under the frame on
the roof, and the fortress lamp lies 58 m from the mirror, behind the facade line (z −4). The lab holds two shots
(camera overrides from the `heliostatShots` entity, released with `clearOverride(blend, shot)` so they never cut a
cinematic that replaced them): the whole tower and its heliostat while he is at its foot or on its ladder (the frame
stays, he climbs through it), and while he works the capstan the line from the heliostat to the fortress lamp: side-on
on a landscape screen (x 414 … 483, the distance fitted to the aspect), down the beam from behind the mirror on an
upright phone. On the roof the room's frame holds x 476 (ladder head, capstan, heliostat, the sunrise from the right).
The street in front of the fortress stays under 6.4 m, so the beam and the lamp read over its roofs. A tap on the
fortress lamp aims the beam within the magnet's window.

## Tests

```
node tools/light-unit.mjs                       # pure Node: maths, primitives, 100 random traces vs brute force, §3–5 fixtures
node tools/playtest.mjs --chapter lab --port N  # the lab bot, all twelve rooms
node tools/negative.mjs --chapter lab --port N  # the lab negatives
```

Measured on the dev server (headless Chromium, SwiftShader), on the branch head after the second fix round:

| Check | Result |
|---|---|
| `light-unit.mjs` | 30 / 30: maths, primitives, 100 random traces against brute force (worst error 2.8e-14 m), finger aim inside a tray's travel (28 aims from the ends and the middle), every traced hit of §3–5 |
| lab bot | all twelve rooms, 0 deaths, 287.39 s of game time, 0 jumps while gripping, trace p95 0.200 ms, end hash `75367c06` (the crank and capstan stand points moved); the same on the integration branch |
| lab negatives | 24 / 24 (after the integration's fixes: IV-E keeps the boy, the heliostat and the fortress lamp in frame at 16:9 and upright; a hidden guard snapshots as built at all 13 checkpoints after a chase; 22 / 22 at the integration): up never jumps (100 trials), a second tap lets a latched grip go (touch M2 and K2, toggle CR3; taps of 2, 12 and 60 steps), the jump button, wrong notch (×12 in six rooms, never latched, level ≤ 0.02), one beam never burns, bolt dash, tripwires, the darted guard, dazzle crossing, the dazzle's end, the dazzle's real crossing (tucked at LM2, a late start, a step back, the hop over the stand and the sprint out: a player may start up to 4 s after the dazzle begins, 7.5 s with assist), the idle sunset clock (the screen reads (11, 15, 37) at the end of the fade: `#0b1026`), a won clock sets the sun, lost mirror, death restores, finger aim, lit = seen, sun shafts, p95, the beam's point light in view, a photocell on a lift and a hatch to its lock (new), census |
| hands on props | wrist-to-hold distance after render frames, 37 cases (M2 every notch from −90 to +90 from the left, every other from the right; K2 and K1 at every 30°; the capstan idle and turning either way for 0.6 to 3.6 s): every wrist a palm (0.05 m) from its hold, 0.066 m at most while the capstan turns (the summed miss of both wrists was up to 0.89 m on a tray stood on end, 0.47 m on a crank and 0.57 m on the capstan turning right) |
| trace cost | p95 0.20 ms, median 0.10 ms over 600 passes with 22 sources (budget 0.35 ms) |
| Chapter I | souk bot hash unchanged (`7bd4df65`, 85.37 s, 0 deaths), souk negatives 13 / 13 under the one searchlight rule |
| census | `{dir 1, hemi 1, point 7, spot 2}` in the lab, the souk and the lab again (lab negative) |
| props | lab-wide 115 meshes / 67 shadow casters for 62 light entities (152 / 93 before the merge); a wheeled mirror 3 draws (6 before); the burn room's pulley rig adds two rope meshes (no shadow), its wheels and straps go into the static batch |
| draw calls (medium, frames with a shadow update) | 0@4 175, 1@19 203, 3@53 200 (207 before), 4@70 204, 5@98 185, 6@114 187, 7@131 184, 9@190 245, 10@216 189, 11@330 147, 12@350 175, 12@475 137; frames without one about 100. The rest above §8.5's 180 is the lab's scenery (facades and far city), which the chapters budget themselves |
| LDR cone (P.md #9) | `?ldr=1&tier=low` courtyard cone matches the float path (mean luma 83.0 vs 85.8); `perf.mjs --check ldr` passes (measured on the previous round; the cone's code is unchanged) |
| foundation | 15 / 17 (boot budget passes, median 22132 ms against 23893; context loss passes): the two failures assume the one-preset lab stub (requests/L.md #6, patch included; with it applied both pass: the dev end at the heliostat reloads x 1.5 and keeps the save, and the lab holds 5 maps for its 5 presets) |
