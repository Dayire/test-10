# MEDINA: full game design and build plan

This document is the authoritative design for the full game. It was synthesised from three competing proposals ("light", "story", "platform") and two judge reviews. The base is the **light** proposal: its systemic light mechanic and its geometry-checked puzzles. Grafted onto it are the story proposal's emotional through-line and motifs, and the platform proposal's touch, UX and mobile plan. Every flaw the judges found is fixed in §10.

An engineer who reads only this document and the code should be able to build their package. Sections:

| § | Content |
|---|---|
| 0 | Pitch, pillars, the arc |
| 1 | Shared rules: player capabilities, coordinate conventions, light geometry |
| 2 | Chapter I: The Souk (existing level, adapted) |
| 3 | Chapter II: Brass at Sundown |
| 4 | Chapter III: The Lamp-Keepers |
| 5 | Chapter IV: The Timekeeper's Mirror |
| 6 | The original touch: **Sunwork** (full mechanic spec) |
| 7 | Menus and UX flow, saves, settings |
| 8 | Mobile and browser plan |
| 9 | Graphics tiers, per-chapter lighting presets, audio plan |
| 10 | Judge flaws and how this design fixes them; puzzle capability audit |
| 11 | Engineering plan: foundation, six work packages, schedule |
| 12 | Integration plan |
| 13 | Cut list and risks |

Repo: `/home/user/test-10/inside-medina`. Baseline HEAD: `807b875`. All units are metres, seconds and degrees. Code citations are `path:line` at the baseline.

---

## 0. Pitch

The medina is ruled at night by the **lamp-keepers**: the faceless hooded watchmen with plumb-hanging lanterns (`docs/ART_DIRECTION.md:44`). After sunset they own every light: the searchlights, the lanterns, the tripwire beams strung between brass sensors.

A boy crosses the city in one evening, one night and one dawn. On the way he learns the old craft of the coppersmiths and of the timekeeper (*muwaqqit*): polished brass trays, crank mirrors, astrolabe locks and a heliostat. He uses it to steer sunlight, then moonlight, then the lamp-keepers' own beams. At dawn he climbs the timekeeper's minaret, sets his own brass tray into the broken heliostat, and gives the sunrise back to the city. The fortress lamp goes out, every lamp-keeper's lantern dies, and far beyond the walls a light flashes back. Someone answered.

**The bookend loop** (from the story proposal):

1. Chapter I ends with the boy lifting a plain brass tray from the pedestal in the hero alley (`src/game/level1.js:499`). It flashes once in the low sun.
2. He carries it on his back for the rest of the game, an iconic silhouette like the scarf.
3. In Chapter IV it is the missing centre disc of the heliostat. He leaves it there.
4. The credits close on the Chapter I pedestal at golden hour. A new tray waits on it for the next child.

### 0.1 Pillars

The pillars of `docs/DESIGN.md:5-8` stay. One is added.

| Pillar | Meaning in the full game |
|---|---|
| Wordless | No text in play. Menus use short lowercase labels. Credits are the only prose. |
| Taught by the space | Every verb follows the ladder watch → old verb, new effect → set it → turn it → combine it (§6.7). |
| Instant, fair failure | Death fades to black and respawns at the checkpoint in ≤ 2.35 s (`game.js:214-218`). Light itself never kills (§6.6). |
| Light is the story | Golden hour → sunset → night → dawn. The time of day changes the geometry the player solves (§1.3). |
| **Light is the verb** (new) | Every new mechanic is something light does to the world. |

### 0.2 The arc

| Ch | Name (menus only) | Hour / look | Emotion | Threat | Maqam | Ends with | First play |
|---|---|---|---|---|---|---|---|
| I | the souk | golden hour, `goldenHour` | curiosity → pursuit → release | watchman's lamp, guard, falls | Hijaz (existing, `src/core/audio.js:266-285`) | takes the tray; it flashes in the sun | 8–10 min |
| II | brass at sundown | sunset → dusk, `sunset` → `dusk` | play, wonder, a race with the sun | dye vats, crumbling planks, the sunset clock | Bayati on D | catches the last ray; the city's lamps cascade **on** | 12–14 min |
| III | the lamp-keepers | night, `night` | fear; light belongs to the enemy | searchlights, tripwires, a patrol | Saba on D | climbs out of the moon well toward the timekeeper's house | 11–13 min |
| IV | the timekeeper's mirror | dawn → sunrise, `dawn` → `sunrise` | exhaustion → hope → release | the captain, the fortress lamp | Rast, resolving to Ajam | the heliostat; lamps cascade **off**; the answered light | 10–12 min |

Total first play is about 45 minutes.

### 0.3 Threaded motifs (wordless storytelling)

| Motif | I | II | III | IV |
|---|---|---|---|---|
| **Next destination on the skyline** | The coppersmiths' madrasa dome and the city-gate tower (§2) | The night quarter's lamp towers beyond the gate | The timekeeper's minaret, lit pale at the top | The far kasbah on the hills (the answer) |
| **Lamps** | A lantern-maker's stall: five lanterns, four lit, one dark | Lamps cascade **on** across the city as the sun dies | Lamp-keepers' star-cookie beams on every wall | Lamps cascade **off**, one by one, as the sun rises |
| **The heliostat** | A glint on the minaret during the finale (`level1.js:504`) | Its tower on the skyline | Seen through the moon-well shaft | Reached, repaired with the tray, aimed |
| **Pigeons** | Flocks scatter (`src/render/fx.js:95-100`) | Pigeons peck on the dye-works rims | Roosting motionless on eaves | Rise together at sunrise |
| **The boy's red** | The only moving red (`ART_DIRECTION.md:22`) | Red dye vat; red children's tunics on a line | — | The red scarf against the sunrise |

No call to prayer is imitated anywhere. The dawn has a generic long brass note.

---

## 1. Shared rules

### 1.1 Player capabilities (authoritative; every puzzle is checked against this)

Source: `src/game/player.js:4-13`, plus a scratch replica of the 120 Hz integrator.

| Capability | Value | Notes |
|---|---|---|
| Run / walk / crawl / push / pull | 4.1 / 0.8–1.75 / 1.15 / 1.35 / 1.1 m/s | Run when the stick is > 0.75 (`player.js:137`) |
| Jump apex | **0.89 m** above take-off | jumpV 6.35, GRAVITY 22 |
| Running jump, same height | **2.36 m** centre travel; 0.575 s airtime | 2.70 m with a 0.6 m drop |
| Standing jump | 1.25 m | |
| Gap rule (design) | Same-height gaps ≤ 2.2 m edge to edge | A gap is "impossible" only if gap − 0.75 > 2.36, i.e. ≥ 3.2 m (0.34 body + 0.41 coyote) |
| Hop obstacle | ≤ 0.85 m, `ledges:false` | |
| Step-up | ≤ 0.26 m, automatic, **not while gripping** | `player.js:220`; the grip branch never steps up (`player.js:193-211`) |
| Mantle | Ledge 0.5–1.12 m above the feet | `player.js:300` |
| Hang-climb | Ledge ≤ 2.5 m above the take-off floor; needs ≥ 0.56 m clear above the ledge | `player.js:263`, `:293-295` |
| Crawl gap | Clearance strictly between 0.56 and 1.16 m (use 0.62) | `player.js:232` |
| Falls | Stagger over 2.4 m; death over 6.6 m (measured from take-off or edge, not the apex) | `player.js:268-276` |
| Crate grip | Hold grab; face within 0.08 m; crate spans feet + 0.3 | `player.js:174-184` |
| Lever | Stand within 0.45 m of `x + dir·0.55`; hold grab and pull away | `entities.js:152-158` |
| Riders | `pushBody` carries any body whose bottom is at the pushed body's top | `physics.js:118-126` |
| Rising platforms | Player snaps up if the rise is < 0.1 m per step; snaps down onto lowering ones | `player.js:108-109` |
| Chase cost | Each hang-climb costs about 2.9 m of the guard's 3.95 m/s margin; a mantle about 1.7 m | |

### 1.2 Conventions for every chapter

- **Coordinates are local per chapter.** x right, y up, ground y = 0, play plane z = 0, facade line z = −1.6 (`level1.js:10`). Solids are written `(x0, y0, x1, y1)`.
- **Checkpoints** are `{x, minY?, spawn:{x, y, facing}}`. A checkpoint activates when the boy is grounded, `x ≥ cp.x` and `y ≥ minY` (the `minY` field is new; foundation). Spawns stand on a solid.
- **Gates** use the existing `Gate` class (`entities.js:81-129`, currently unused). It never crushes (`:110-117`). **Lift ≥ 1.3 m** so the boy (1.16) passes under.
- **Kerbs.** A 0.15 m kerb stops bodies but not the boy (step-up 0.26). Every wheeled mirror's solution position is defined by a kerb or a wall, never by a free position. This replaces "push it roughly here" with a deterministic stop.
- **Wheeled mirror stands are mantle-able** (0.8 m, `ledges:true`), so the boy can always climb over a mirror he has parked between himself and the exit.
- **Puzzle framing.** A puzzle room is ≤ 18 m wide. Its camera key uses `dist` 16.5–19 and `fov` 38–40, so the source, the tool and the target share one frame. The key's new `distPortrait` field applies when aspect < 1.
- **Kill zones.** `L.killZones = [{x0, x1, y0, y1, kind}]`. The boy dies when his feet enter one (dye `drown`, wells `fall`).

### 1.3 Light geometry

All light gameplay is **2D in the play plane**, traced against the same colliders the boy collides with (`physics.js:1-3`).

- **Angles** are measured counter-clockwise from +x. A ray at 195° travels left and 15° down.
- **Mirror surface angle** α ∈ [−90°, 90°), in **15° notches**. Reflection: **θr = 2α − θi**.
- **The time of day changes the geometry.**
  - At sunset (θs = 195°) every reflected direction is ≡ 15° (mod 30°), so beams are always diagonal.
  - With a horizontal sun (θs = 180°: the end of Chapter II, all of Chapter IV), reflections are multiples of 30°, so vertical and horizontal beams become possible.
- **Intensities.** Sun 1.0; searchlight 1.5; beam lamp 1.0; moon 0.5. Each reflection multiplies intensity by 0.95; tracing stops below 0.4.
- **The visual sun matches the gameplay sun.** Each chapter's preset has one global sun direction whose in-plane projection equals the authored ray angle within 5°. The light is never re-keyed per room. This fixes the judges' "shadows swim between rooms" flaw.

| Preset | sunDir | In-plane travel angle | Authored rays |
|---|---|---|---|
| `sunset` (II A–E1) | (0.80, 0.21, −0.56) | 194.7° | 195° |
| `dusk` clock (II E2) | blends to (0.82, 0.00, −0.57) over the first 8 s of the clock | 180° | 180° |
| `night` moon (III) | (−0.12, 0.86, −0.50) | 278° | 270° (moon well) |
| `sunrise` (IV) | (0.86, 0.06, −0.50) | 184° | 180° |

---

## 2. Chapter I: The Souk (existing level, golden hour)

The level stays as built: beats A–F in `docs/DESIGN.md:39-44`, checkpoints at x −100, 33, 57, 71.2, 120.3, 141.4, 185.9. It already teaches every base verb in order. The current 100 s bot remains its regression test.

| # | Change | Owner | Detail |
|---|---|---|---|
| 1 | Move | F | `git mv src/game/level1.js src/chapters/souk/level.js`. Scene adds go to the chapter root. Level-1 hacks leave `game.js`: `prepareForCheckpoint` (`game.js:100-108`) becomes `L.prepare(i, game)`; `safeZone` (`:122`) becomes `L.safeZone`; the audio x-ranges (`:411-413`) become `L.mix`; flock spots (`:67-70`) become `L.flockSpots`; the intro shot (`:425-434`) becomes `def.intro`; the finale numbers (`:246-308`) become `L.finale`; level fields in `state()` (`:441`) become `L.extraState()`. |
| 2 | End of chapter | F | The finale ends at `F.zEnd` instead of the literal `pl.z < -13.2` (`game.js:299`). It calls `game.completeChapter()` instead of `ui.showEnd` (`game.js:306`). The warm-white fade (`game.js:301`) carries into the Chapter II card. |
| 3 | The tray | C2 | Insert waypoint **(188.7, 0, −11.95)** into the finale path (`level1.js:515`), between (188.0, 0, −6) and (188.0, 0, −12), with `pause: 1.4, pose: 'reach'`. The pedestal (x 189.25–189.75, top 0.95, z −12.2…−11.7) holds a tray mesh (`trayMesh()`, L's `src/assets/lightprops.js`). On arrival the tray is re-parented to the boy's right wrist. At the next waypoint it moves to his back (chest bone, offset −z 0.12). A 0.6 s flare sprite flashes on the tray as he turns toward the sun. |
| 4 | Heliostat glint | C2 | On the finale minaret at (X − 6.5, z −46) (`level1.js:504`), add a brass disc of radius 1.2 at its lantern stage. It flashes (emissive 6 + glint sprite) twice while the finale sun swings (`game.js:286-291`). |
| 5 | Motifs | C2 | The tan-awning stall goods (`level1.js:119-121`) become a lantern-maker's stall: five `lanternMesh` (`src/assets/props.js:500`), one with `{lit:false}`. Add the coppersmiths' madrasa dome (x 232, z −36) and the city-gate tower (x 300, z −70) to the skyline (`level1.js:408-419`); they are outside the skyline exclusion bands. |
| 6 | Unified searchlight rule | L | The searchlight also checks 2D line of sight against light-blocking solids (§6.4). The courtyard (x 72.5–112.2, lamp at (93, 12, −7.45), `level1.js:262`) has no blocking solid between the lamp and the floor. Only the cloth awning at 67.3–70.1 (y 1.5–1.65) lies near the path, and the lamp-to-boy line clears it (y 1.92 at x 70.1). So the stealth section plays the same. The souk bot and negatives must still pass. |
| 7 | Bugs fixed | F | Shadow focus hard-coded to (188, 3, −9) under any override (`game.js:406`). The "restart from checkpoint" shortcut is cancelled by `onDeath` (`boot.js:38` vs `game.js:209`). `prepareForCheckpoint` `x > 186` is dead for the checkpoint at 185.9 (`game.js:106`). `Guard.getState` always returns `'hidden'` (`entities.js:392`). The lever pose reads `level.lever.t` (`game.js:364`). The intro sway is frozen (`game.js:427-432`). The plate counts the guard as full weight (`entities.js:63`). Mute is undone by `fadeIn` (`boot.js:41`, `audio.js:287`; that one is fixed by P). |
| 8 | No Sunwork | — | Chapter I has no LightSystem. Light is only atmosphere and threat here. |

**Hand-over.** Warm-white fade → card **II** (setting-sun glyph on burnt orange) → Chapter II opens side-on in the sunlit courtyard beyond the great arch, with the tray on the boy's back.

---

## 3. Chapter II: Brass at Sundown (sunset → dusk)

**Look.** `sunset` from x 0 to 176. The clock in E2 blends `sunset` → `dusk`.

**Setting.**
- The courtyard beyond the arch.
- The coppersmiths' souk: polished trays hanging everywhere, the distant hammering of tuned resonators.
- The dyers' vats.
- The Madrasa of the Astrolabe.
- The city-gate tower.

**Pacing.** Six light puzzles, two flow beats (the vats, the rooftop plank run) and one timed set piece. This caps the judges' "lock → gate monotony".

### 3.1 Beat table

| # | x (m) | Beat | Teaches / tests |
|---|---|---|---|
| A | −3–31 | Beyond the arch | A1 (watch): a gust lifts laundry out of a sunbeam, a rosette lock lights and a gate rises: *light opens*. **P1 (A2):** push a crate off a 2.0 m shelf so its shadow leaves a lock: *occlusion*, using a known verb. |
| B | 31–62.4 | Coppersmiths' souk | **P2 (B1):** the first wheeled mirror, already at the right angle; push it into the beam. **P3 (B2):** an anchored mirror; *tilt* it. |
| C | 62.4–104.4 | Dyers' vats and dye-works yard | Flow beat: rim hops over lethal dye vats; push a crate into a 3.4 m vat as a stepping stone. **P4 (C2):** the *sun-bolt*: an inverse lock that holds a gate shut while lit. The boy's own shadow opens it, but too briefly; a crate is the lasting shadow. |
| D | 104.4–144 | Madrasa of the Astrolabe | **P5 (D1):** chain a wheeled mirror into a *crank* mirror on a gallery. **P6 (D2):** *converge* two beams on a hemp rope; it burns, the counterweight falls and the drawbridge drops over the dye pit. |
| E | 144–206 | The last ray | E1 flow: barrels, ivy wall, a run over **crumbling planks** above a lethal light well. E2 set piece: the **sunset clock**; climb the gate tower against the rising shadow, crank the horizontal last ray down onto the great gate's lock. |

**Checkpoints (activation x → spawn x, y):**

| cp | x | spawn | `prepare(i)` restores |
|---|---|---|---|
| 0 | −100 | (1.5, 0) | — |
| 1 | 13.6 | (14.0, 0) | G1 open, cloth lifted |
| 2 | 30.8 | (31.2, 0) | crate CR1 fallen at 21.3–22.3, G2 open |
| 3 | 46.6 | (47.0, 0) | M1 at the kerb, G3 open |
| 4 | 62.6 | (63.0, 0) | M2 α −45°, G4 open |
| 5 | 88.6 | (89.0, 0) | crate CRV in vat V5 |
| 6 | 104.6 | (105.0, 0) | CR3 at bollard, G6 open |
| 7 | 126.6 | (127.0, 0) | M7 at kerb α −30°, F2 α +45°, G7 open |
| 8 | 144.4 | (145.0, 0) | rope burnt, bridge down |
| 9 | 152.0, minY 5.5 | (153.0, 5.6) | planks restored |
| 10 | 175.5 | (175.8, 0) | clock reset to idle (sun 195°) |

### 3.2 Geometry and puzzles

Every ray below runs on the line y = y0 + (x − x0)·tan 15° (θ 195°). Every hit was checked with the scratch tracer, which WP-L ports into `tools/light-unit.mjs` fixtures (§11.4). Locks have r = 0.35 unless stated.

**A1. Laundry gust (scripted watch).**

| Element | Value |
|---|---|
| Start wall | x −4…−3, up to 12 |
| Gate G1 | x 12.8–13.2, h 2.6, lift 2.5; source `L1.done` |
| Wall | x 12.6–13.4 at y 2.6–5.0 and 5.8–9; the window between them |
| Ray | from (13.45, 5.4), θ 195° |
| Lock L1 | latching, at (−2.75, 1.06) on the start wall |
| Cloth occluder | light-only box x 7.0–8.2, y 2.9–4.4. It blocks the ray at (8.2, 3.99). |
| Trigger | x 3: the cloth animates to y 4.4–5.0 over 1.2 s. The ray reaches L1 at (−2.41, 1.15). G1 lifts. |

**P1 (A2). Crate on the shelf.**

| Element | Value |
|---|---|
| Shelf | x 17.0–21.0, h 2.0, ledges on (hang-climb from the floor) |
| Lock L2 | latching, on a post at (17.4, 2.5) |
| Crate CR1 | 1.0 m, on the shelf at x 18.0–19.0 |
| Wall | x 29.8–30.6, with G2 (h 2.6, lift 2.5) below a window at y 5.6–6.4 |
| Ray | from (30.65, 6.05) |

- **Before:** the ray stops on the crate at (19, 2.93).
- **Solution:** climb the shelf and push CR1 right. It topples off at x ≈ 21.15, where support drops below 35 % (`physics.js:149-153`), and falls to about 21.3–22.3. The ray then reaches L2 at (17.74, 2.59). The boy drops 2.0 m (safe) and walks through G2.

**P2 (B1). First mirror: push.**

| Element | Value |
|---|---|
| G3 | x 45.6–46.4, h 2.2, lift 2.0; window y 2.4–3.2 |
| Ray | from (46.45, 2.93). It lands on the floor at x 35.5, a sunspot that is the first hint. |
| Wheeled mirror M1 | starts at x 33.0, α −15° (already correct) |
| Kerb | x 40.35–40.5, h 0.15. M1 stops with its centre at **40.0**. A brass star is inlaid in the cobbles there. |
| Lock L3 | (37.0, 4.2) on a facade bracket |

- **Solution:** push M1 right to the kerb. The 135° reflection hits L3 at (37.25, 3.95). The traced tolerance is x 39.4–40.6, so the kerb sits well inside it.

**P3 (B2). Tilt.**

| Element | Value |
|---|---|
| G4 | x 61.6–62.4, h 2.4, lift 2.2; window y 2.6–3.4 |
| Ray | from (62.45, 3.20) |
| Anchored mirror M2 | x 55.0, starts at α +30° (reflects at 225° onto the floor at 53.8) |
| Lock L4 | (56.23, 5.8) |

- **Solution:** grip M2 and tilt **down 5 notches** to −45°. The reflection sweeps 225° → (15°: misses the tray) → 165° → 135° → 105° → **75° → L4** at (56.14, 5.46).
- **Hint:** the HintDirector shows the tilt glyph if the boy grips M2 for 3 s without tilting (§7.6).

**C flow beat. The dyers' vats (x 62.4–88.4).** Pit floors are at −1.0, the dye surface is drawn at −0.4, and each pit is a kill zone `{y < −0.35, kind 'drown'}`. Rims are solid columns from −1.0 to 0.

| Segment | x | Width | Check |
|---|---|---|---|
| Landing | 62.4–66.0 | — | |
| Vat V1 | 66.0–67.4 | 1.4 | needs 1.06 of travel |
| Rim | 67.4–68.0 | 0.6 | Stopping distance at run is 0.35 m, so the rim can be stopped on |
| Vat V2 | 68.0–69.8 | 1.8 | needs 1.46 |
| Rim | 69.8–70.4 | 0.6 | |
| Vat V3 | 70.4–71.8 | 1.4 | |
| Rim | 71.8–72.4 | 0.6 | |
| Vat V4 | 72.4–74.4 | 2.0 | needs 1.66 < 2.36 |
| Platform | 74.4–80.0 | — | Crate **CRV** (1.0) at 76.5–77.5 |
| **Big vat V5** | 80.0–83.4 | **3.4** | Impossible: needs 2.65 > 2.36 even with perfect coyote time |
| Platform | 83.4–86.0 | — | |
| Vat V6 | 86.0–87.6 | 1.6 | |
| Dye-works yard | 87.6– | — | ground y 0 |

- **Solution:** push CRV right. It topples at x0 > 79.65 and falls beside the wall to x 80.0–81.1, with its top flush at 0. The remaining gap is 81.1 → 83.4 = 2.3, which needs 1.96 of travel.
- The dye surfaces use `mats.std('water')` tinted saffron, indigo, poppy and henna. Pigeons peck on the rims.

**P4 (C2). Sun-bolt.**

| Element | Value |
|---|---|
| G6 | x 103.6–104.4, h 2.4, lift 2.2; lintel 2.4–2.8; window 2.8–3.6 |
| Ray | from (104.45, 3.21) |
| Bolt B1 | `mode:'bolt'`, at (94.7, 0.6), r 0.3, iron. Above a stone bollard x 94.5–94.9, h 0.4, `ledges:false` (a hop, and a crate stop). |
| G6 source | `1 − B1.level`: the gate opens while the bolt is dark |
| Crate CR3 | starts at x 99.5–100.5, under the ray. It does not block it: the ray is at 2.15 at x 100.5. |

- **The boy's own shadow** blocks the ray whenever he stands at x 94.53–96.96 (tracer). G6 then opens over about 1.1 s and starts closing about 1.3 s after he leaves. He needs about 2.2 s to reach it, so the dash visibly fails. The Gate's never-crush rule keeps that safe.
- **Solution (fixed from the light proposal):** mantle CR3 (1.0), drop behind it on its right, and **push it left** until it stops against the bollard (crate at 94.9–95.9). It then blocks the ray permanently, at (95.9, 0.92). Any crate whose right face is ≤ 96.2 works.
- *Why not pull:* when pulling, the boy stands between the crate and the 0.4 m bollard and cannot step up while gripping. He stops first, leaving the crate's right face at about 96.24, outside the tolerance.

**P5 (D1). Chain.**

| Element | Value |
|---|---|
| G7 | x 125.6–126.4, h 2.4, lift 2.2; window 2.6–3.4 |
| Ray | from (126.45, 2.96) |
| Gallery | solid x 112.0–118.9, y 3.7–4.0. Ivy vine x 111.2–112.0, y 0–4.0, exit (112.4, 4.0) (format of `level1.js:277`). |
| Crank mirror F2 | pivot (118.4, 6.8), r 0.4, starts at α −15°. Its crank is on the gallery at x 118.2. |
| Wheeled M7 | starts at x 115, α 0 (passes under the gallery: stand 0.8 + tray 1.6 < 3.7) |
| Kerb | x 120.25–120.4: M7 stops with its centre at **119.9** |
| Lock L7 | (125.3, 4.95) |

- **Solution:**
  1. Push M7 to the kerb and tilt it to −30° (two notches down). Its 105° reflection reaches F2, which at −15° throws a spot onto the gallery floor at x 115.6.
  2. Climb the ivy, crank F2 **up 4 notches** to +45°. The 345° reflection hits L7 at (124.96, 5.04).
- **Checks:**
  - Traced tolerance for M7 is x 119.6–120.2.
  - F2 at +15° bounces the light back onto M7: a visible miss.
  - The boy at the crank never blocks the beam.
  - The exit is past M7: he mantles its 0.8 m stand.

**P6 (D2). Burn.**

| Element | Value |
|---|---|
| Rope target | box 0.3 × 1.2 centred at (135.0, 7.4); holds the drawbridge counterweight |
| Dye pit | x 140.5–144, floor −8 (lethal) |
| Drawbridge | x0 140.5, x1 144, hinged right (`bridge.js:25,43`), tip at y 3.5 when raised; source `rope.burnt ? 1 : 0` |
| Ray W7 | from (146.0, 10.35): hits the rope directly (I 1.0). The rope smoulders (smoke, ember glow) but does not burn: the hint "it needs more". |
| Ray W8 | from (146.0, 4.59); at x 144 it is at 4.06, clearing the raised bridge |
| Mirror M5 | on a floor rail with kerbs; centre limited to 132.6–**133.34** (the right kerb is the stop). Starts at 132.6, α 0 (its stand blocks W8 at (131.35, 0.67)). |

- **Solution:** push M5 right to its kerb and tilt to −45° (three notches down). The 75° reflection reaches the rope (traced tolerance 132.94–133.74).
- Total intensity 1.95 ≥ 1.6. After 1.5 s the rope snaps, the counterweight crashes and the bridge lowers at 1.6 rad/s (`bridge.js:34`).
- **No soft-lock:** the rope is a latch, and the bridge state is in the snapshot.

**E1. Rooftop run (x 144–176).**

| Element | Value |
|---|---|
| Ground | 144.0–150.2 (bridge landing at 144) |
| Barrels | 146.6–147.4, h 0.82, `ledges:false` (hop) |
| Ivy | vine x 150.2–151.0, y 0–5.6, exit (151.4, 5.6) |
| Roof wall | 151.0–158.0, top 5.6 (7 m of run-up) |
| **Crumble planks** | top 5.6, 0.25 thick: 158.0–159.5, 159.8–161.3, 161.6–163.1, 163.4–164.9. Each sags 0.15 m in its first 0.5 s and drops **0.7 s after first contact**. |
| Light well under the planks | x 158–165.2, floor −2.0 (a 7.6 m fall: lethal) |
| Roof | 165.2–171.0, top 5.6 |
| Steps down | 171.0–173.0 top 3.2 (drop 2.4); 173.0–174.6 top 1.0 (drop 2.2); ground (drop 1.0) |

- **Timing:** running spends (1.5 + 0.34)/4.1 = 0.45 s on each plank (safe). Walking spends 1.05 s (the plank falls). The 0.3 gaps are narrower than the body (0.34), so the boy never drops between planks.
- A decorative shadow line (the Terminator, §6.2) sits at 3 m and creeps upward.

**E2. The last ray (timed set piece, x 176–206).**
- **Clock.** The trigger at x 176 starts the **SunClock**. Terminator height T rises from 4.0 at 0.16 m/s. The single horizontal ray at y 12.0 dies when T ≥ 11.7, at t = 48 s. In the first 8 s the LookDirector swings the sun to the horizon (`sunset` → `dusk` start), so shadows lengthen diegetically.
- **Tower:**

  | Tier | x | y | Access |
  |---|---|---|---|
  | 1 | 186–194.5 | 0–4.6 | ivy on the left face, x 185.2–186.0 |
  | 2 | 189–194.5 | 4.6–9.2 | rope ladder, already down, x 188.2–189.0 |
  | 3 | 190.5–194.5 | 9.2–10.6 | 1.4 m ledge: hang-climb |

- **Crank mirror F3:** pivot (194.6, 12.0), r 0.6. It overhangs the tower's right edge so the downward leg clears the stone. The crank is at x 194.1 on tier 3. It starts at α −30°, sending the ray into the sky.
- **Solution:** crank **up 6 notches** to +60°. The ray reflects at 300° onto lock **L8** at (199.2, 4.0) on the gatehouse (x 199.5–203.5), hitting (199.04, 4.31).
  - +30° hits the tower and +45° hits the ground at 194.6: visible misses.
  - L8 lifts the great gate (Gate, lift 4.6) and unrolls a rope ladder on the tower's right face.
  - The horizontal ray passes over the boy's head (11.76).
- **Budget:** the bot needs about 16.5 s from the trigger to latched, so there is about 30 s of slack. Assist adds +50 %.
- **Failure:** the light dies, the screen dims to indigo (death kind `sunset`), and the boy respawns at checkpoint 10 with the clock reset.
- **Success:** the sun sets over 6 s (look → `dusk`). The city's lamps cascade **on** over 6 s, as pool sources, glow sprites and window emissives (§9.2).

**Ending.** Climb down the unrolled ladder. Walking through the gate (trigger x 204) fades to `#0b1026`, then card **III** (crescent on indigo).

---

## 4. Chapter III: The Lamp-Keepers (night)

**Look.** `night`. The moon is the single shadowed directional light, colour `#9fb4ff`, intensity 0.9. The sky shows stars and a moon disc. Lanterns run at pool ×2.2 and glass emissive ×1.7. The lamp-keepers' searchlights project an **8-point star-lattice cookie** onto the walls: the signature night image, done with the rig spots' `map` (§9.1, §6.4).

**Tripwire language.** A beam lamp sends a thin beam to a brass sensor. When the sensor is dark for more than 0.2 s:

1. The horn sounds.
2. The sensor's **dart turret** (a small brass "eye" on the sensor housing) fixes on whatever broke the beam.
3. If a searchlight is slaved to the wire, it swings onto the occluder.
4. 1.05 s later the turret darts the occluder. This reuses the alarm-to-shot timing of `entities.js:258-263`.

The turret needs no line of sight; the sensor knows where its beam was cut. In 2D a beam is a line, so every tripwire is one of three readable kinds:

| Kind | Geometry | Verb |
|---|---|---|
| Short and low | ≤ 1.6 m long, y ≤ 0.35 | jump over (a run jump stays above 0.3 m for ≈ 1.95 m) |
| Long, mid height | y 0.65–1.0 | crawl under (crawl body 0.56) |
| High | ≥ 1.8 m above the floor the boy walks on | walk under; do not jump |

**Pacing.** Four light puzzles, a tripwire gauntlet (flow), and a chase.

### 4.1 Beat table

| # | x (m) | Beat | Teaches / tests |
|---|---|---|---|
| A | −3–36 | Curfew | A1 (watch): a gust rolls an empty basket through a low tripwire; horn; the turret darts the basket. Then the boy jumps the same hurdle. A2: a crawl line under a low arcade. Tower lamp S0 sweeps the open street. |
| B | 36–82 | The lamp's own light | **P1 (B1):** bounce the sweeping searchlight off a mirror onto a lock. **P2 (B2):** tilt one notch so the beam goes back into the lamp (*dazzle*), then sprint while it is blind. The tray is also a shield. |
| C | 82–128 | Decoy and the gauntlet | **P3 (C1):** drop a crate through a balcony tripwire to pin a fast searchlight, then cross underneath. C2 flow: rooftop tripwire gauntlet (jump, crawl, walk-under) at running pace. |
| D | 128–168 | The patrol | A lantern guard bursts out and chases. The boy jumps tripwire T4; the guard runs through it and **the lamp-keepers' own turret darts their man**. |
| E | 168–212 | The moon well | **P4 (E):** moonlight (I 0.5) only half-opens a gold sun-lock but opens a silver moon-lock (needs 0.4). Mirror under the well, tilt, climb toward dawn. |

**Checkpoints:** −100 → (1.5, 0) · 20.5 → (20.8, 0) · 36.5 → (36.8, 0) · 57.5 → (57.8, 0) · 82.5 → (82.8, 0) · 106.5 → (106.8, 0) · 128.5 → (128.8, 0) · 168.5 → (168.8, 0).

### 4.2 Geometry and puzzles

All searchlights use the unified rule (§6.4). Covers are hanging rugs: Box3 x ± 0.95, y 0.2–2.47, z −0.87…−0.73, as in `level1.js:240`.

**A. Curfew.**
- **S0:** origin (20, 14, −8); sweeps x 14–34 at 2.0 m/s, pausing 2.0 s at each end.
- **A1:** tripwire T1 from (11.0, 0.3) to (12.4, 0.3). A trigger at x 4 rolls the basket (kinematic, scripted along the ground at 1.8 m/s) through it. The turret darts the basket, and the alarm clears after 4 s.
- **A2:** arcade roof solid x 23.5–31.5, y 1.6–2.2 (blocks S0's line of sight). Under it, crawl line T2 runs from (24.2, 0.8) to (31.0, 0.8).
  - Standing breaks it: the head is at 1.16 > 0.8. Crawling clears it (0.56). Auto-crawl does not trigger (1.6 > 1.16), so the boy must hold ↓ for 5.9 s.
  - The **crawl toggle** setting exists for this (§7.4).
- **Open street** x 14–23.5: cross while S0 rests at its far end (x 34).

**P1 (B1). Lamp bounce.**

| Element | Value |
|---|---|
| S1 | origin (45, 13, −8); sweep x 36–54 at 3.0 m/s; pause 1.3 s |
| Rugs | x 39.5, 44.0, 48.5, 51.0 |
| Wheeled M1 | starts at 38.0, α 0 (already correct) |
| Kerb | x 53.8–53.95 → M1 centre **53.45** |
| Lock L1 | (55.5, 4.1); lifts lattice gate G1 at x 57 (h 2.6, lift 2.4) |

- **Solution:** push M1 from rug to rug while S1 is at the far left. At the kerb, the lamp's rest at x 54 strikes the flat tray and reflects at 54° onto L1, hitting (55.3, 3.82). Traced tolerance is 53.2–53.7.
- I = 1.5 × 0.95 = 1.43 ≥ 0.8, and the 1.3 s pause is longer than the 0.6 s charge.
- When S1's aim passes x 53.0–53.5, its beam hits M1's stand: a harmless flicker.
- **Exit:** cross G1 on the return sweep. Detection range ends at x1 + 3 = 57 (`entities.js:251`).

**P2 (B2). Dazzle.**

| Element | Value |
|---|---|
| S2 | origin (70, 12, −8); sweep x 58.5–78 at 4.0 m/s; pause 1.2 s |
| Anchored M2 | x 59.25, α −30° (inlay). At the left rest the reflection goes up at 75° and flashes on the tower wall left of the lamp: "almost". |
| LampEye | circle r 0.8 at (70, 12) |
| Emergency rug | x 70.5 |

- **Solution:** grip M2 and tilt one notch to −45°. At the left rest the reflection runs at 45° back into the lamp, hitting (69.53, 11.35). It still hits for aim y 0.15–0.65, which covers the ±0.25 aim wobble of `entities.js:246`.
- S2 is **dazzled for 7 s** (aim swings up 8 m, the beam whitens, detection off).
- **Shield:** the boy tucked against M2's left side is shielded. The tray blocks the lamp-to-head line at (59.08, 1.37) and the lamp-to-chest line.
- **Sprint:** 21.8 m to x 81 takes 5.3 s, inside the 7 s dazzle.
- −15° and −60° miss (105° and 15°).

**P3 (C1). Decoy.**

| Element | Value |
|---|---|
| S3 | origin (95, 14, −8); fast sweep x 85–105 at 4.5 m/s; no ground cover |
| Balcony | solid x 94.5–99.0, y 3.7–4.0; on it, tripwire T3 from (96.0, 4.3) to (97.4, 4.3), slaved to S3 |
| Hanging crate | 96.2–97.2, bottom at 7.0, on a rope to lever LV at x 85.0 (`dir −1`) |
| Alcove | LV stands under an overhang solid x 84–86.5, y 2.2–6, which blocks S3's line of sight to the lever spot |

- **Solution:** pull LV. The crate falls 3.0 m onto the balcony and breaks T3. S3 fixates on the crate (narrow 0.05 rad wedge) for as long as T3 stays dark, which is permanently. The turret darts the crate, harmlessly. The boy runs 85 → 106 (5.1 s) while S3 stares at the balcony.
- **Without the decoy:** a 21 m open crossing under a 4.5 m/s sweep is death.

**C2 flow. The rooftop gauntlet (x 106–128).**

| Wire | From → to | Kind |
|---|---|---|
| T5 | (110.0, 0.3) → (111.4, 0.3) | low: jump |
| T6 | (114.0, 0.8) → (120.0, 0.8), under an arcade x 113.5–120.5, y 1.6–2.2 | mid: crawl |
| T7 | (122.5, 1.8) → (127.5, 1.8), over two 0.25 m steps at x 123.5 and 125.0 | high: walk, don't jump. The top step puts the head at 1.66 < 1.8; a jump reaches 2.55. |

All are turret-armed. This beat recombines the three wire kinds at pace, with no new verb.

**D. The patrol.**
- **Trigger** at x 131 activates a lantern guard at x 120 (11 m head start, close to Chapter I's 11.8 m, `level1.js:310-311`). He bursts out of a door.
- **Obstacles:**

  | Obstacle | x | Size | Cost |
  |---|---|---|---|
  | Barrels | 136.0–136.8 | 0.82 | hop: none |
  | Cart | 142–145 | 1.25 | hang-climb: −2.9 m |
  | Wall | 150–156 | top 2.0, drop 2.0 on the far side | hang-climb: −2.9 m |

- **T4** runs from (160.0, 0.3) to (161.4, 0.3), watched by S5: a `watch` lamp at (165, 14, −8) with fixed aim on T4, a visual only.
- **The boy jumps T4** with about 5.2 m of margin left. The guard (0.5 × 1.8, `entities.js:294`) breaks it for (1.4 + 0.5)/3.95 = 0.48 s > 0.2 s. S5 swings onto him, and 1.05 s later the turret darts him: `guard.stun(Infinity)`, the asleep collapse, at about x 165.
- **Crawl hole:** solid x 166.0–167.5 from 0.62 up. Guard `blockX` 165.6; safe zone x > 166.0.

**P4 (E). The moon well.**
- **Cistern:** x 172–200. West wall at 171.6–172. Stair door at x 199.6–200.4 (a Gate, h 2.6, lift 2.4).
- **Moonbeam:** vertical, θ 270°, I 0.5, falling from the well mouth at (190, 14).
- **Moon-lock ML:** silver, needs 0.4, at **(196.0, 1.2)**: right of the well, so the boy (pushing from the left) is never in the leg. This is a fix: the light proposal put it on the left, where the beam at y 1.2 grazed the boy's head (1.16).
- **Gold sun-lock GL:** needs 0.8, at (174.0, 1.2) on the west wall. The contrast lesson.
- **Wheeled M:** starts at x 186, α +15°. The moon spot lands on the floor at x 190 beside a brass inlay.
- **Kerb:** x 190.35–190.5 → M centre **190.0**. Traced tolerance is only ±0.28, so the kerb is essential.
- **Solution:** push M right to the kerb, then tilt **down 4 notches** to −45°. θr = 0°, and the beam reaches ML at (195.65, 1.2). The stair door opens.
  - The boy standing at 189.48 does not block it.
  - +45° sends the beam left onto GL, whose petals open halfway (0.475/0.8) and stop: *moonlight is too weak for sun-locks*.
  - −30° and −60° miss.
- **The climb:** a 12 m stair tower (x 200.4–212) of rope ladders and landings within §1.1, ending in a trigger at y ≥ 12. The minaret's top is lit pale through the shaft.

**Hand-over.** Pale-blue fade `#9fb0d8` → card **IV** (sun rising over the walls).

---

## 5. Chapter IV: The Timekeeper's Mirror (dawn → sunrise)

**Look.** Dawn is `dawn`: sun below the horizon, directional intensity 0, pink horizon, morning mist. It blends to `sunrise` keyed along x (0 → 150). The sun is horizontal (θs = 180°).

**Descending light.** The Terminator (§6.2) height T is keyed on the boy's x:

| x | 0 | 16 | 40 | 86 | 150 |
|---|---|---|---|---|---|
| T (m) | 14 | 8 | 6 | 3 | 0 |

Horizontal rays exist only above T. Each pool lantern and glow sprite goes out as the line passes its height: the lamps cascade **off**.

**Atmosphere (cut-able).** In A, a drummer walks the street below (z −0.6) on a 0.9 s beat. Windows ahead of him light up on the beat (window emissive and pool sources only, no gameplay).

**Pacing.** Four light puzzles, a traversal beat, a chase and the finale.

### 5.1 Beat table

| # | x (m) | Beat | Teaches / tests |
|---|---|---|---|
| A | 0–40 | First light | **P1 (A1):** crank the first ray down into the shadow. A2: rooftop traversal (hang-climb, 2.0 gap over a lethal well, chimney hop, drops). |
| B | 40–86 | The water clock | **P2 (B):** the **photocell lift**: aim the light to choose the floor where the lift stops. |
| C | 86–140 | The last watch | Chase. Lamp-keepers cannot bear the sun: vertical sun shafts from rooftop signal mirrors stun the captain. Crawl door into the minaret's yard. |
| D | 140–172 | Inside the minaret | **P3 (D):** a three-mirror chain over two levels (wheeled mirror plus two cranks) opens the roof hatch. |
| E | roof, x 158–174, y 12–16 | The heliostat | **P4 (E):** set the tray into the great mirror, turn the capstan, aim the sunrise at the lamp-keepers' fortress. Finale, the answered light, credits. |

**Checkpoints:**

| cp | x | minY | spawn |
|---|---|---|---|
| 0 | −100 | — | (1.5, 0) |
| 1 | 24.5 | — | (25.0, 0) |
| 2 | 40.5 | — | (41.0, 0) |
| 3 | 86.5 | — | (86.8, 0) |
| 4 | 140.5 | — | (141.0, 0) |
| 5 | 164.5 | 3.9 | (164.5, 4.0) on floor 1 |
| 6 | 164.0 | 11.9 | (164.0, 12.0) on the roof |

### 5.2 Geometry and puzzles

**P1 (A1). Bring the light down.**

| Element | Value |
|---|---|
| Crank mirror F1 | pivot (22, 9.0), r 0.5, on a facade bracket (no solid in the path). It catches the horizontal ray at y 9.0, which is live because T at x 20 is ≈ 7.7. Crank handle at (20.5, 0). |
| Lock L1 | (17.5, 1.25), down in the shadow |
| Gate G1 | x 23.6–24.4, h 2.6, lift 2.4 |

- **Solution:** crank F1 from −30° up **4 notches** to +30°. θr = 240°, hitting L1 at (17.56, 1.31).
  - +15° lands a spot on the ground at 6.41: "almost".
  - 0° lets the ray pass.
- The leg passes 6.4 m over the crank, well above the boy.

**A2. Rooftops (x 24.4–40).**

| Element | Value |
|---|---|
| Stairs | 26.0–27.0, four 0.25 m steps up to 1.0 |
| Roof R1 | 27.0–31.0, top 1.0 |
| Wall R2 | 31.0–34.0, top 2.4: a 1.4 hang-climb |
| Gap | 34.0–36.0 (2.0), well floor −5 (a 7.4 m fall: lethal) |
| Roof R3 | 36.0–40.0, top 2.4, with a chimney 37.6–38.2 rising 0.7 (hop, `ledges:false`) |
| Drop | 2.4 to the ground at 40 |

**P2 (B). Photocell lift (fixed from the light proposal: the stop height is computed, not measured).**

| Element | Value |
|---|---|
| Crank handle | (56, 0) inside the water-clock house |
| Crank mirror F | pivot (54, 10.73), r 0.5; catches the horizontal ray at y 10.73; starts at α 45° (beam straight down onto the floor at x 54: a visible spot) |
| Lift | platform solid x 60–62 from y_p − 0.3 to y_p, with y_p ∈ [0, 9]. A 0.5 m rail on its left edge (below the photocell; light passes over it). It sits flush in a pit at rest. |
| Photocell PC | hold-mode lock, r 0.15, riding the lift at (59.95, y_p + 0.8) |
| Exit ledge E2 | solid x 62–75, from 0 to **6.5**. Lintel solid x 62–63.2, y 7.8–10.3. |
| Ray corridor | no solid crosses y 10.4–11.1 for x 54–86. The ray enters through a parapet gap at x 86. |

- **Lift rule (deterministic):**
  - While loaded (load ≥ 0.35) and PC dark, the lift rises at 1.2 m/s.
  - Each step it computes where any beam crosses x = 59.95. If PC's centre would pass that height, the lift **clamps** to y_p = y_beam − 0.8 and holds while lit.
  - Unloaded, it descends at 1.0 m/s.
  - At the top (9.0) it waits 1.5 s and descends even when loaded. That is the reset rule, so there is no dead end.
  - Riders are carried as the Plate carries them (`entities.js:71-72`). The rise is 0.01 m per step, under the 0.1 snap (`player.js:109`).
- **Outcomes** (θr = 2α − 180°; beam height at x 59.95):

  | F α | θr | Beam at PC | Lift |
  |---|---|---|---|
  | 45° | 270° | never (straight down at x 54) | rises to 9, waits, returns |
  | 60° | 300° | 0.42 | rises past it, never lit → top |
  | **75°** | **330°** | **7.295** | **stops at y_p = 6.495**, beside E2 (6.5): step 0.005 |
  | 90° | 0° | 10.73 | PC would need y_p 9.93 > 9 → top |

- With F at 75° and the lift at rest, the leg lands on E2's face at (62, 6.11): a bright spot on the doorway sill, the hint "there".
- **Skill bypass (allowed).** Riding up with F wrong, the boy can step off onto E2 only while y_p ∈ (6.24, 6.64) (step-up 0.26 below, lintel 7.8 above). That is a 0.33 s window.
- **Exit:** E2 → 75–77 top 4.1 (drop 2.4) → 77–79 top 1.9 (drop 2.2) → ground 79 (drop 1.9).

**C. The last watch (chase).**
- **Captain:** a Guard (`entities.js:287-394`, speed 3.95) bursts from a door at x 84 when the boy passes the trigger at x 90 (6 m head start).
- **Layout:**

  | Element | x | Size |
  |---|---|---|
  | Barrels | 96.0–96.8 | 0.82 |
  | Wall | 102–108 | top 2.0 |
  | Sun shaft | 110.0 | vertical, 0.6 wide |
  | Crates (static) | 116.0–117.0 | 1.0 |
  | Sun shaft | 121.0 | |
  | Cart | 125–128 | 1.25 |
  | Sun shaft | 131.0 | |
  | Crawl door | 138.0–139.5 | from 0.62 up |

- **Sun shafts:** light segments from (x, 12) straight down, I 1.0, cast by rooftop signal mirrors (dressing).
  - They do nothing to the boy. A guard whose body overlaps a segment with I ≥ 0.8 is `stun(1.2)`: shield-eyes pose, then 2 s of immunity.
- **Safety:** `blockX` 137.6; safe zone x > 138.
- **Tuning gate (the only tuned numbers in the game):** C4 may move the head start (5–9 m) and the shaft x positions until both hold:
  - with shafts, the bot's minimum guard distance is 2.0–4.0 m;
  - with shafts disabled (`__medina.ext.dawn().shafts(false)`), the bot is caught.
- **The fortress:** the lamp-keepers' fortress tower stands at x 106–114, z −4. Its great lamp is a static beacon at play-plane point **(110, 8.0)** (LampEye r 1.5), with no detection. The boy runs under it here; he aims at it in E.

**P3 (D). The minaret chain.**

| Element | Value |
|---|---|
| Yard | ground x 140–160 |
| West wall | 159.6–160, from 2.0 to 16 (a door below) |
| East wall | 172–172.4: sill 0–0.6, window 0.6–1.8, wall 1.8–16 |
| Floor 1 | x 160–169.5, y 3.7–4.0 (the hole 169.5–172 is on the right) |
| Roof | x 158–160 and 162–174, y 11.7–12.0; **Hatch** x 160–162 (solid until open) |
| Rafter | light-blocking solid x 162.5–169.0, y 9.0–9.3 (without it C1 at −60° alone sends a 150° leg from (170.8, 6.0) into L_TOP: 12 of the 1727 wrong settings would light the lock) |
| Ray | horizontal, y 1.2, through the east window |
| Wheeled M | starts at x 166, α 0 (edge-on; the ray passes to the west wall) |
| Kerb | 171.15–171.3 → M centre **170.8** |
| Ladder 1 | vine x 169.6–170.2, y 0–4.0, exit (169.2, 4.0) |
| Crank C1 | pivot (170.8, 6.0), r 0.4, α 0; handle on floor 1 at x 168.8 |
| Crank C2 | pivot (161.2, 6.0), r 0.4, α 0; handle on floor 1 at x 162.4 |
| Lock L_TOP | (161.2, 11.4), under the hatch |
| Ladder 2 | vine x 160.2–160.8, y 4.0–12.0, exit (162.6, 12.0); usable once the hatch is open |

- **Solution:**
  1. M to the kerb, tilted 3 notches down to −45°: the ray goes straight up through the hole.
  2. C1 to −45°: left along y 6.0, over the boy's head on floor 1 (5.16).
  3. C2 to −45°: straight up to L_TOP, hitting (161.2, 11.05).
  - Cranks can be set in any order.
- **Checks (tracer):** the boy on ladder 1 (x 169.9) and on floor 1 never blocks a leg. L_TOP latches and the hatch swings open. With the rafter, all 1727 wrong settings stay dark (`tools/light-unit.mjs`, the `IV-D minaret chain` fixture).

**P4 (E). The heliostat (finale).**

| Element | Value |
|---|---|
| Roof | y 12, parapets 158–158.4 and 173.6–174 (top 12.8) |
| Great mirror H | pivot (168, 14.5), r 1.5, on a bronze astrolabe frame. Its centre disc is missing. |
| Tray insertion | grab at H's base (x 167.2): a scripted 1.5 s `reach` (the boy unslings the tray and sets it in the ring). Without it, H does not reflect. |
| Capstan | handle at (165.5, 12). Hold grab and push ←/→: H turns continuously at **6°/s**. Touch/mouse: the finger target sets the desired α directly. |
| Sunrise ray | y 14.5, from the right (180°) |
| Target | fortress lamp LampEye (110, 8.0), r 1.5 |
| Start | α 20°: a spot lands on the roof at 165, then sweeps across the city as he turns |

- **Camera (from the lab's IV-E):** the rail cannot hold this room. Hold a shot of the whole minaret top while he climbs
  to the roof (the rail follows the ground he climbs, so it either loses the mirror from below or the boy from above),
  and while he works the capstan frame the mirror-to-fortress line (side-on on landscape screens, down the beam from
  behind the mirror on an upright phone), with no facade above the beam between them. light.md "IV-E's camera".
- **Solution α = 3.2°** (θr 186.4°). The traced hit window is α ≈ 2.5–3.6°.
- **Magnet (fixes "only playable with assist"):** whenever |α − 3.2| ≤ 2° and the input is released, α eases to 3.2 over 0.4 s and the beam visibly snaps onto the lamp. All devices get this; it is not an assist toggle.
- **Constraint:** no play-plane solid above the line y = 8.0 + (x − 110)·0.112 for x ∈ [111.5, 166.5]. That line is 13.38 at the west parapet (top 12.8) and 11.36 at x 140.
- **Finale sequence** (`L.finale`, F's cinematics):
  1. After 0.5 s on target, the fortress lamp flares and dies.
  2. The camera override cranes up and back over the city.
  3. Every pool lantern and glow sprite fades in a cascade from the fortress outward. Lamp-keepers' lanterns on the walls go out one by one.
  4. The LookDirector goes to full `sunrise`. Pigeons rise.
  5. **The answered light:** far beyond the walls, a kasbah on the hills (z −300) flashes back three times (flare sprite plus pool source) and the "answered light" chord plays. This is guaranteed, not gated behind secrets.
  6. The boy sits on the parapet beside the heliostat. The tray stays in the mirror.
  7. Fade to `#fff3dc`, then credits over the morning city (U's credits screen, C4's data).
  8. **Epilogue:** the loader loads `souk` in `epilogue` mode. There is no boy. A 6 s camera override frames the Chapter I pedestal at golden hour with a new tray on it. Then the title. The main menu background is the epilogue shot from then on.

---

## 6. The original touch: Sunwork

### 6.1 Model

Light is computed in the play plane, in metres, at the fixed step (`game.js:15`): traced every second fixed step (60 Hz).
- Rays are traced against the colliders the boy collides with, so what you see is what is true.
- Visuals may cheat in z:
  - trays tilt 25° toward the camera so their polished face shows;
  - a segment that ends at a lamp behind the plane (searchlights at z −7.45…−8) is drawn with its last vertex at the lamp's real z.

Gameplay stays strictly 2D: deterministic, unit-testable, and using the physics world as the occluders.

**What blocks light:**
- Enabled solids, including one-way cloth (shade), unless the solid has `light:'pass'`.
- Solid bodies (crates, mirror stands).
- Mirror trays (both faces reflect; `oneSided: true` makes the back face block). II-B2 starts on the underside at +30° and IV-A1's crank is solved on its underside.
- The boy's body (0.34 × 1.16, or 0.56 tall when crawling).
- Guard bodies.
- Light-only `Occluder` boxes, and any entity's light-only plank or box (a raised drawbridge).

Ladders, vines and lattice gates let light through (a `Gate` is a lattice portcullis: `light: 'pass'` by default,
`light: 'block'` for a solid door; a lifted solid gate would cut the II-C2 window ray and hold G6 open).

### 6.2 Entities (all in `src/game/light/`, owned by WP-L)

| Entity | Fields | Behaviour | Snapshot |
|---|---|---|---|
| `LightSystem` | `sources, mirrors, targets, occluders, traceHz 60, maxSeg 6, minI 0.4` | Registered as a chapter system (`L.systems`). Traces each source, records beams, calls `target.onLight(I, dt, hit)`. Static solids are bucketed in a 4 m x-grid at build; ≤ 12 moving bodies are always tested. | aggregates children by id |
| `SunRay` / `BeamLamp` / `MoonRay` | `x, y, angle, I, enabled(), clipByTerminator` | A ray entering through an aperture. `clipByTerminator` disables it while its y ≤ T + 0.3. | enabled |
| `SearchlightSource` | adapter on a `Searchlight` | Ray from the lamp's (x, y) through its aim point, I 1.5 | — |
| `Mirror` | `kind: wheeled \| anchored \| crank \| continuous`, `alpha, notch 15, r 0.4, pivotH 1.2, home, zone, thetaHint` | Wheeled: a Body (`kind 'mirror'`, 0.7 × 0.8, pushable, `ledges:true`, weight 0.5, surface wood), so crate grip works unchanged (`player.js:174-184`). Anchored: the same but `pushBody` returns 0. Crank: no body, driven by a `Crank`. Continuous: the heliostat. | `{x, y, alpha}` |
| `SunLock` | `need 0.8, mode latch \| hold \| bolt, chargeT 0.6, decayT 0.5, tone, metal gold \| silver \| iron` | Light-only circle, r 0.35. `level` rises at 1/chargeT while lit with I ≥ need and decays at 1/decayT. Latch at 1 sets `done`. Below `need` it displays I/need (petals half-open) but never charges past it. Drives mechanisms via `source()` closures (like `level1.js:259`, `:290`). | `{level, done}` |
| `Photocell` | a hold-mode SunLock, r 0.15, chargeT 0.08, `rides` a body | Used by C4's lift | via the lift |
| `Sensor` (tripwire) | `from, to, lamp?, darkT 0.2, turret:true` | A BeamLamp-to-sensor line. Dark > 0.2 s → `alarm(occluder)`: horn, turret fixes, the slaved searchlight `fixate(occluder)`, dart after 1.05 s. A dart on the boy is `die('shot')`; on a guard, `stun(Infinity)`; on anything else it is harmless. Alarm clears 4 s after the line is restored. | `{alarm, t}` |
| `BurnRope` | box, `need 1.6, burnT 1.5, cool 0.5/s, onBurnt` | Sums the I of all beams hitting it. Smoke, then embers (P particles). | `{heat, burnt}` |
| `Occluder` | box; animatable | Blocks light only | `{y0, y1}` |
| `LampEye` | circle r 0.8 (1.5 for the fortress) at a lamp; `face` (deg) for an eye behind a window | Reflected hit ≥ 0.1 s → `lamp.dazzle(7)` or `onHit()`; with `face` only light travelling toward that face counts (the IV-E fortress lamp looks east). While its lamp is blind it neither fires nor re-arms. | — |
| `Terminator` | `T(t or x)` | (a) Gameplay: `clipByTerminator` sources die below T. (b) Visual: an invisible shadow-caster slab (`colorWrite:false`, `castShadow:true`, 60 × 2 m in light space). Every frame it is placed along −sunDir at 0.4 × the sun shadow camera's distance from the camera focus, top at T + D·tan(sun elevation). Its shadow line on the facades sits at T. Zero shader cost. | `{T}` |
| `SunClock` | `duration, T0, rate, onExpire` | Drives Terminator T over time and the LookDirector time blend; `assist` +50 % duration | `{t, running}` |
| `Crank` | handle (x, y), mirror, `dir` | Interactable. Player state `crank`. | via the mirror |
| `Capstan` | handle, continuous mirror, rate 6°/s, `magnet {alpha, window 2°}` | Interactable. Player state `capstan`. | via the mirror |
| `Hatch` | solid plus mesh, `source()` | Opens over 0.8 s; the solid is disabled when open | `{open}` |

**Changes to existing classes (WP-L):**

| Class | Change |
|---|---|
| `Searchlight` (`entities.js:185-284`) | Unified detection (§6.4); `reflectable`; `dazzle(sec)`; `fixate(target, {while})`; `mode: 'sweep' \| 'watch'`. Acquires a rig spot from F's light rig instead of owning a SpotLight. After a dazzle (7 s, assist 10.5 s) the beam settles back onto the street over 0.9 s while the sweep runs on away from the rest that blinded it, still blind; the eye re-arms only once the lamp sees again, and it sees the boy again within one sweep cycle. |
| `Guard` (`entities.js:287-394`) | `stun(sec)` (shield-eyes pose; `Infinity` gives the asleep collapse, the body dropping to 0.45 m); `onLight` stun rule (daylight only: sun or moon rays, direct or reflected, I ≥ 0.8, 1.2 s, 2 s immunity; a searchlight's or a tripwire's own beam never stuns); auto step-up ≤ 0.26 instead of a 0.34 s vault for stairs (`:344-348`). The real `getState` is done by F. |
| `Lever` | Becomes an interactable (F did the plumbing) |

### 6.3 Input and player states (no new buttons)

| State | Entry | Controls | Exit |
|---|---|---|---|
| **grip (mirror)** | As crate grip (hold grab, adjacent). On touch, grab is **sticky** on mirrors and cranks by default: tap ✋ to latch, tap again to release. | ←/→ push or pull (wheeled). **Tilt:** vertical input, or finger/mouse aim (below). | Release grab, jump (drops grip and jumps), or walk away (anchored) |
| **crank** | Hold grab within 0.45 m of a crank handle (the near test of `entities.js:158`) | ↑/↓ step notches; finger/mouse aim | Release grab or jump |
| **capstan** | Hold grab at the capstan | ←/→ (or stick) turn continuously at 6°/s; finger/mouse aim | Release grab or jump |

**Tilt rules:**
- **Notch stepping.** |y| > 0.6 and |y| > 1.2·|x| steps one notch immediately, then repeats every 0.22 s while held.
  - "Up" raises the far rim (+α when facing right); there is an *invert tilt* setting.
  - The tray animates to the notch in 0.15 s. `settled` is true when it arrives.
  - A click sound and a 5 ms haptic tick play per notch.
- **Jump-buffer fix (fixes the judges' top flaw).** Today an up-edge with y > 0.6 sets `jumpBuf` when no vine is near (`player.js:74`), and a buffered jump on the ground drops the grip and jumps (`player.js:151-154`). WP-L changes `player.js:74` so the up-edge **never** sets `jumpBuf` while `grip` is set (crate or mirror) or in states `lever | crank | capstan`. Only the jump button jumps from those states.
- **Finger / mouse aim** (the platform proposal's graft, kept puzzle-honest):
  - While gripping a mirror or in crank/capstan, `pin.aimTarget` (the world point under the pointer, from F) sets the desired reflection direction θr* = atan2(target − pivot).
  - Then α* = (θr* + θi)/2 mod 180. θi is the current incident beam angle, or the mirror's authored `thetaHint` if it is unlit.
  - α* rounds to the nearest notch.
  - **Soft snap:** if that notch lights no target but the notch ±1 does (probe trace), use the neighbour. No further assist, so puzzles keep their thinking.
  - Pointer input: on touch, a touch on the scene outside the controls. On desktop, holding the left mouse button on the canvas.
- **Animation (WP-L, `animator.js`):**
  - a `tilt` overlay on the push and pull poses (`animator.js:199-220`): arms up to the rim;
  - `crank` (two hands on the wheel, torso twist);
  - `capstan` (pushing a bar);
  - `reach` (pickup / insert);
  - `sit`;
  - guard `shieldEyes` and `asleep`;
  - the `sunset` death (a slow kneel into the dark).

### 6.4 Searchlights: one rule everywhere ("lit = seen")

A searchlight sees the boy if **all** of these hold:
- His head point (0.85·h) or chest point (0.5·h) lies inside the 3D cone, as today (`entities.js:227-236`; ×0.92 of the spot angle).
- The 2D segment from the lamp's (x, y) to that point crosses no light-blocking solid, solid body, mirror tray or guard.
- No cover Box3 intersects the 3D segment, as today.

Seen for 0.18 s → alarm → 1.05 s → dart (`entities.js:255-263`), unchanged.

Consequences:
- Chapter I plays the same (§2 row 6).
- The mirror is a shield (III-B2).
- A balcony throws real shadow (III-C1).
- Only the lamp's own eye sees: reflected searchlight light does not detect.

**Lamps and the light rig.** The fixed light rig has **two shadowed spots** (§9.1).
- A searchlight acquires a spot while it is within (view half-width + 10 m) of the camera focus, and releases it only when it is more than (view half-width + 4 m) off-screen. So slot changes never pop on screen.
- Chapters keep ≤ 2 searchlights within any 40 m window. Chapter III S0 is enabled only for x < 36.
- An unassigned lamp draws its beam cone and ground pool without a light.
- Both spots always carry a `map`: the soft-disc cookie by default, the star-lattice cookie in Chapter III. Swapping one non-null map for another never recompiles.

### 6.5 Tracing, performance, feedback

**Budget.** ≤ 8 sources × 6 segments per trace. 95th percentile ≤ 0.35 ms per trace in SwiftShader, measured as `__medina.ext.light().stats.traceMs`.

**Beam rendering:**
- **Core:** an additive ribbon reusing the dusty beam shader (`entities.js:164-183`) on render layer `LAYERS.BEAMS` (P's `src/render/layers.js`).
- **Haze:** depth-faded when P's soft-layer pass is on.
- **End:** a sunspot decal on the surface hit.
- **Mirrors:** a glint sprite and emissive flash above the bloom threshold.
- The brightest hit spot is a priority dynamic source in the LightPool (F), so a real point light warms the wall. The light count never changes.

**Locks are readable without colour:**
- **Shape:** a 12-petal rosette whose petals open with `level`.
- **Sound:** a singing-bowl tone (partials 1, 2.76, 5.4) tuned to a degree of the chapter's maqam. Its volume follows `level`. Solving a chapter's locks plays its scale.
- **Latch:** a brass rod along the cornice carries a travelling glint toward the mechanism.
- **Bolt:** iron, petals closed while lit.
- **Moon-lock:** silver.
- **High-contrast option:** outlines beams and lock rims.

### 6.6 Failure modes and soft-lock prevention

- **Light never kills.** Deaths come from what light triggers: tripwire darts, searchlight darts, the sunset expiring (`sunset`), crushes, and the usual falls and dye.
- **Lost mirrors.** A wheeled mirror outside its `zone`, or below the kill plane, fades and reappears at `home` after 2 s.
- **Kerbs** keep stands from being lost off ledges.
- **One-shot mechanisms** latch (locks, ropes, hatches) or reset (the lift's top rule, gates driven by hold-mode locks).
- **Restart checkpoint** works (F fixes `boot.js:38`).

### 6.7 Teaching ladder and development matrix

| Verb | Watch | Old verb, new effect | Already set | Turn it | Twist | Combine |
|---|---|---|---|---|---|---|
| Sun-lock | II-A1 | II-A2 (crate shadow) | II-B1 | II-B2 | II-C2 bolt (light locks); III moon-lock | IV-B photocell; IV-D chain |
| Occlusion | — | II-A2 | — | — | II-C2 own shadow; III-B2 tray shield; III-C1 balcony | III-D the guard is the occluder |
| Wheeled mirror | — | — | II-B1 | II-B2 tilt | III-B1 bounce the enemy's lamp | IV-D first link |
| Crank | — | — | — | II-D1 | II-E2 last ray (clock) | IV-A1; IV-D; IV-E capstan |
| Convergence | — | — | — | — | II-D2 burn | — |
| Dazzle | — | — | — | — | III-B2 | IV-C sun stuns; IV-E dazzles the fortress |
| Tripwire | III-A1 | III-A2 | — | — | III-C1 decoy | III-D the lamp darts its own |
| Time of day | II-E1 shadow line | II-E2 clock | III night (no sun) | IV descending light | — | IV-E sunrise |

**Hints** are wordless glyphs from U's HintDirector, declared by chapters (§7.6), for example "gripping M2 for 3 s without tilting → tilt glyph".

### 6.8 Test API (WP-L)

`__medina.ext.light()` returns:
```
{ beams: [{src, pts, I}],
  targets: [{id, level, done, lit}],
  mirrors: [{id, x, alpha, notch, settled}],
  lamps: [{id, state}],
  stats: {traceMs} }
```
Also: `trace(x, y, theta)` → `{pts, hits}`, and `solve(targetId)` → the notch combinations that hit, up to depth 3.

Bot helpers live in `tools/bots/lightlib.js`:

| Helper | Behaviour |
|---|---|
| `pushMirrorTo(id, x, tol)` | grip and push or pull until in place |
| `tiltTo(id, deg)` | hold `{grab:true, y:±1}` until the notch matches, then wait for `settled` |
| `crankTo(id, deg)` | the same through a crank |
| `aimAt(id, x, y)` | uses `aimTarget` |
| `waitLit(id)`, `waitBurnt(id)`, `waitDazzled(lamp)`, `waitFixated(lamp)` | wait on entity state |

Bot steps end on entity state, never on time.

**Puzzle invariants become negative tests**, for example:
- "L4 is hit only at M2 α −45°";
- "L7 has no solution with M7 off the kerb";
- "L3 has no 0-bounce solution";
- "one beam never burns the rope".

---

## 7. Menus and UX (wordless in play; short lowercase labels in menus)

### 7.1 Flow

```
Splash (CSS wordmark + turning brass rosette, < 0.3 s; keeps animating during sync work)
  └─► Main menu over a LIVE shot of the save's chapter at its checkpoint (souk intro shot for new players)
        continue   (only with a save; enabled once that chapter is built) → camera blends to the rail (as beginPlay, game.js:193-200)
        new journey (glyph confirm ✓/✕ if a save exists) → Chapter I establishing shot
        chapters   → 4 cards → checkpoint pips → start
        settings   → graphics | audio | controls | accessibility
        credits
        (asset sheet: dev builds only)
  In play: pause = Esc/P, pad Start, ⏸ touch button; auto on blur/visibilitychange/pad disconnect
        → resume | restart checkpoint | restart chapter | chapters | settings | title
  Chapter end → fade to the chapter's exit colour → card (numeral + time-of-day glyph, ≥ 2.5 s and until built) → next chapter's intro
  Chapter IV end → credits → epilogue (Ch I pedestal) → main menu (epilogue background, all chapters unlocked)
?autostart=1 skips every menu (test contract).
```

### 7.2 Screens

| Screen | Spec |
|---|---|
| **Loading / splash** | The existing wordmark. A brass rosette turns with a compositor-only CSS animation. A progress hairline is fed by F's progressive bake, so it really paints (today it jumps 5 → 50 → 97 %, `boot.js:14-27`). |
| **Main** | Landscape: a left column at 8vw, 48 px rows. Portrait: a bottom sheet. Entries stagger in; the focused item shows a small animated 8-point star. Menu dimming uses post `fade`/`vignette`, not `backdrop-filter` (`style.css:24`). The background renders at 30 fps and 0.5× resolution. Pointer parallax on desktop (±0.6 m). |
| **Chapters** | Four arched cards: numeral, time-of-day glyph (sun high / sun on the horizon / crescent / rising sun), thumbnail, checkpoint pips (pick any reached checkpoint). Thumbnails are 320 × 180 JPEGs (q 0.7) captured on first reaching a chapter's intro, stored under `medina.v1.thumb.<id>`; the fallback is a palette gradient. Locked chapters are dark arches. |
| **Pause** | Freeze-frame: render one darkened frame, then stop rendering until resume (F). Audio ducks the game buses; the UI bus stays live (P). A ⏸ button sits in the top-left safe area (top-right when left-handed). |
| **Card** | A CSS overlay: numeral plus glyph drawing itself, at least 2.5 s and until the next chapter is built, compiled and warmed. Any input after 1.5 s of the intro shot skips to play. |
| **Credits** | In-world crane over the sunrise city; slow vertical scroll on the right. Lines: MEDINA · made entirely of code · three.js · credits. "thank you for walking with us" (`ui.js:21`) moves here. Skippable after the first completion. |
| **Data** | Reset progress (glyph confirm). When storage is unavailable, a broken-link glyph appears, plus a "save code" export/import (base64, about 120 characters). |

### 7.3 Saves (`src/core/save.js`, F)

- **Key** `medina.save.v1`:
  ```
  {v:1, chapter, cp, unlocked:[ids], cps:{id:maxCp}, completed:bool,
   settings:{…}, stats:{playSec, deaths, perChapter}, seenHints:{}}
  ```
  Thumbnails use separate keys.
- **Written:** on checkpoint advance (debounced 1 s; replaces `game.js:170-173`), chapter end, settings change (debounced 500 ms), pause, `visibilitychange` (hidden) and `pagehide`.
- **Never saves entity snapshots** (they are index-fragile, `game.js:110-119`). Continue loads `{chapter, cp}` and calls `L.prepare(cp)`.
- **Storage access:** every access goes through `storage.js` (try/catch, in-memory fallback, `available` flag). `?nosave=1` disables it for tests.
- A small turning rosette in a corner is the wordless save indicator.

### 7.4 Settings (every option, with defaults)

**Graphics**

| Option | Values | Default |
|---|---|---|
| quality | auto / low / medium / high / ultra | auto (§8.4) |
| render scale | 50–100 % | 100 |
| dynamic resolution | on / off | on |
| frame cap | 30 / 60 / display | 60 on mobile, display on desktop |
| battery saver | on / off (30 fps, scale 0.75, DOF off) | off |
| depth of field | on / off | on |
| film grain | 0–100 | 60 |
| motion blur | cut (§13.1 #2): no row in the shell | — |
| brightness | −3…+3, with a calibration rosette glyph (matters for Chapter III) | 0 |
| camera | close / normal / wide (rail `dist` ×0.85 / 1 / 1.12) | close on portrait phones, otherwise normal |

**Audio:** master, music, effects, ambience (0–10); mute in background; mono; reduced dynamic range.

**Controls**

| Option | Values | Default |
|---|---|---|
| touch stick | floating / fixed | floating |
| touch size | S / M / L | M |
| touch opacity | 20–80 % | 45 % |
| left-handed | on / off | off |
| grab | hold / toggle | hold (keyboard and pad); sticky on mirrors for touch |
| crawl | hold / toggle | hold |
| invert tilt | on / off | off |
| aim snap | on / off (the ±1-notch soft snap) | on |
| vibration | off / low / full | low |
| control hints | always / first time / never | first time |
| keys | read-only list | — |

**Accessibility**

| Option | Values | Default |
|---|---|---|
| camera shake | 0–100 % (scales `addShake`, `camera.js:49`) | 100 |
| reduce motion | no handheld drift (`camera.js:98-106`) | off |
| reduce flashing | caps glints, dazzle, flares, bloom spikes | off |
| high-contrast | beam and lock outlines; tripwire and searchlight-cone outlines | off |
| visual sound cues | edge glyphs for horn, shout, drum | off |
| generous timing | coyote 0.1 → 0.18, buffer 0.14 → 0.2, chase guards −5 % | off |
| assist | sunset clock and dazzle +50 % | off |
| game speed | 100 / 85 / 70 % | 100 |
| menu text size | 100 / 125 / 150 % | 100 |

Settings apply live through `game.applySettings(s)` (F; full key list in §11.2). Texture scale applies at the next chapter load.

### 7.5 Focus navigation (`src/ui/focus.js`, U)

- One roving-focus layer with a screen stack. Each screen declares its focusables and remembers its last focus.
- `Input` feeds nav edges `nav{up, down, left, right, confirm, back}` with repeat (400 ms, then 120 ms):

  | Device | Navigate | Confirm | Back | Other |
  |---|---|---|---|---|
  | Keyboard | arrows / WASD | Enter / Space | Esc / Backspace | |
  | Gamepad | d-pad / stick | A | B | Start = pause; LB/RB = tabs |
  | Pointer | hover focuses | click | | |
  | Touch | | tap acts | | drag adjusts sliders |

- **While a menu is open:**
  - the global Tab/Space `preventDefault` (`input.js:13`) is lifted;
  - game input is zeroed (`game.setMenuOpen(true)`);
  - `#touch` hides. It moves into `#ui`'s stacking context; today it paints over every overlay (`style.css:4`, `input.js:78`).
- Hidden screens use `hidden` plus `inert` (today: opacity only, `style.css:10`). Focus ring via `:focus-visible` (`style.css:28`). Targets ≥ 44 px (today about 27 px, `style.css:27`). `role` and `aria-label` on every control.

### 7.6 HintDirector (wordless onboarding, U)

- Chapters declare `L.hints = [{x0, x1, y0?, y1?, after, glyph, unless(game)}]`. `glyph` is one of `jump | grab | up | down | tilt | crank | aim | crawl`.
- When the boy stays inside a zone past `after` seconds and `unless` is false, a device-specific glyph pulses near him: a keycap, a pad button, or a ghost thumb doing the gesture. It fades once the action happens.
- This replaces the 9 s text hint (`game.js:196`, `ui.js:33-38`), which truncates on phones (`style.css:22`).
- Seen hints are recorded in the save.

---

## 8. Mobile and browser plan

### 8.1 Touch scheme (U)

| Control | Spec |
|---|---|
| Move | **Floating stick:** touchstart anywhere in the left 45 % (excluding the top 18 % and ⏸) spawns the base under the thumb. Radius 56 px × size; dead zone 12 %; run at ≥ 75 % (matches `player.js:137`). Vertical threshold 0.55 with hysteresis and a 200 ms dominant-axis lock. Today the stick is fixed, divides by 50, threshold 0.45 (`input.js:84-86`). |
| Climb assist | Inside a vine's x-range, a diagonal of ≥ 35° counts as up |
| Jump | 84 px bottom-right; hit zone 1.4× the visual |
| Grab | 72 px, up-left of jump. Context icon: ✋ (crate or lever), ☼ (mirror, crank, capstan). Sticky on mirrors, cranks and the capstan by default. |
| Scene touch | A touch outside the controls reports `pointer` to `Input.poll`. F turns it into `pin.aimTarget` (finger aim, §6.3). |
| Pause | ⏸ 44 px in the top corner, inside the safe area |
| Multi-touch | Every control tracks its own `touch.identifier` (today any `touchend` releases a button, `input.js:96-98`). All touch state clears on `blur` and `visibilitychange`. |
| Device switching | The touch UI fades out when a keyboard or pad is used (extends `lastDevice`), and fades to 25 % after 5 s idle |
| Gestures | `touch-action:none`, `overscroll-behavior:none`, `user-select:none`, `-webkit-touch-callout:none`; block `contextmenu`, `dblclick`, `gesturestart` |

### 8.2 Orientation, camera, lifecycle

- **Landscape is preferred; portrait is fully supported.** F adds to `camera.js`:
  - `distPortrait` keys;
  - a portrait horizontal-FOV floor of 52° (today 46°, `camera.js:71`);
  - **lens shift** `camRig.setSafeRect(rectPx)` via `PerspectiveCamera.setViewOffset`, which keeps the boy centred in the play rect above the control band (portrait band = max(160 px, 24 vh)). U calls it.
- A one-time rotate-phone glyph for 3 s, never blocking. `screen.orientation.lock('landscape')` is tried only after a successful fullscreen request (installed PWA or Android), in try/catch.
- **Safe areas:** `env(safe-area-inset-*)` on controls and menus (`viewport-fit=cover` is already set, `index.html:5`).
- **Lifecycle:**
  - `visibilitychange` (hidden) → pause, duck audio, stop rendering, save. The player returns to the pause menu.
  - The iOS audio "interrupted" state resumes on the next gesture (P).
  - `navigator.wakeLock` during play (guarded).
  - `webglcontextlost` → a "tap to reload" glyph card; `restored` → re-bake and reload the chapter at its checkpoint (P hooks in the renderer, U the card, F the reload).

### 8.3 Haptics (`src/core/haptics.js`, U; off / low / full; feature-detected; after user activation)

| Event | Android `vibrate` (ms) | Gamepad `dual-rumble` (ms, strong, weak) |
|---|---|---|
| hard landing | 20 | 120, .6, .3 |
| crate impact | 15 | 150, .4, .6 |
| notch | 5 | 30, 0, .2 |
| lock opens | [15, 30, 15] | 80, .2, .5 |
| rope snap / bridge slam | 40 / 60 | 250, .8, .4 |
| death | [40, 40, 80] | 300, .9, .5 |

iOS Safari has no Vibration API, so iOS gets none. Pads use `vibrationActuator.playEffect`, or Firefox `hapticActuators[0].pulse`. Xbox/PlayStation glyphs are chosen from the vendor id in `gp.id`; non-`standard` mappings use a fallback map.

### 8.4 Defaults by device (F, `boot.js`)

| Device class | Test | Tier | Texture scale | Pool lights (fixed at boot) |
|---|---|---|---|---|
| low-end touch | coarse pointer and (`deviceMemory ≤ 4` or `hardwareConcurrency ≤ 4`) | low | 0.5 | 4 |
| touch | coarse pointer | medium | 0.5 (≈ 54 MB instead of ≈ 217 MB) | 4 |
| desktop | otherwise | high | 1 | 6 |

The pool size is set by **device class, never by tier**, so runtime tier changes never recompile.

**WebGL:**
- WebGL2 is required; without it, a static glyph card says it can't run.
- Without `EXT_color_buffer_half_float`/`float`: low tier with RGBA8 targets (P).

### 8.5 Performance budget per tier

Baseline (measured): 180–240 calls and 564–676 k triangles per frame; shadows are about 2/3 of geometry work.

| Tier | Target | Internal res | Calls (shadow + main) | Triangles | Texture memory |
|---|---|---|---|---|---|
| low | 30 fps, iPhone 11 / Pixel 6a | 0.75× CSS, dynamic 0.6–0.75 | ≤ 130 | ≤ 400 k | ≤ 60 MB |
| medium | 60 fps, iPhone 13+ / Pixel 7 | 1.0×, dynamic 0.7–1.0 | ≤ 180 | ≤ 550 k | ≤ 80 MB (touch) |
| high | 60 fps at 1080p, GTX 1060 / M1 | min(DPR, 1.25) | ≤ 240 | ≤ 700 k | ≤ 220 MB |
| ultra | 60 fps at 1440p, RTX 3070 | min(DPR, 1.5) | ≤ 280 | ≤ 900 k | ≤ 260 MB |

**Frame-rate control (P):**
- Frame cap: today the loop is uncapped (`boot.js:50-57`).
- Auto-quality uses p90 over 10 s windows with hysteresis, can upgrade after 30 s of headroom (desktop only), and ignores paused and hidden frames. Today it is median-only and downgrade-only (`renderer.js:58-67`).
- With dynamic resolution, a 30 ms injected frame drops scale within 2 s.

### 8.6 Loading budget

| Milestone | Desktop | Mid phone | SwiftShader CI gate | Today |
|---|---|---|---|---|
| Splash painted | 0.2 s | 0.5 s | — | immediate |
| Menu interactive | 1 s | 2 s | ≤ 3 s | ≈ 10–11 s |
| Live background + Continue | 3.5 s | 7 s | ≤ 11 s | 10–11 s |
| Chapter switch behind the card | 2.5 s | 5 s | ≤ 12 s | n/a |

How:
- per-chapter bake lists (`bakeAll(baker, names)`, `textures.js:613`; boot passes `undefined` today, `world.js:22`);
- one surface per frame;
- `renderer.compileAsync`;
- chapter `build` may be a generator that yields every 8 ms;
- dev views removed from the release build.

### 8.7 Hosted build and artifact build (U)

**Hosted:**
- Hashed filenames (fixed today, `vite.config.js:11-15`); keep `base:'./'`.
- `public/manifest.webmanifest` (standalone, landscape, theme `#0b0806`), with icons rendered from the procedural tray and rosette by `tools/make-icons.mjs` (Playwright).
- A small service worker (cache-first for hashed assets, network-first for HTML). It registers **only** when not in the artifact build, `window.top === window`, and on https.
- Cormorant Garamond: vendor a WOFF2 subset if `tools/fetch-font.mjs` can fetch it; otherwise keep the Google Fonts link (allowed in artifacts) with a Georgia fallback.

**Artifact** (claude.ai sandboxed iframe, ≤ 16 MB; target ≤ 3 MB):
- `tools/make-artifact.mjs` inlines the JS (today a separate `game.js`, `make-artifact.mjs:14`) and **all** CSS files into one `medina.html`.
- `import.meta.env.VITE_ARTIFACT` strips the dev routes and GLTFExporter (`main.js:3-10`).
- No service worker. Fullscreen button only if `document.fullscreenEnabled`. No pointer lock, `alert`, `print` or `location.reload` (the asset-sheet reload, `boot.js:43`, is dev-only).
- Storage through the wrapper. Audio starts inside the gesture (already, `boot.js:46-47`).

---

## 9. Graphics, lighting presets, audio

### 9.1 Fixed light rig (F, `src/render/lightrig.js`)

| Light | Count | Shadow | Notes |
|---|---|---|---|
| Directional sun / moon | 1 | yes | never removed; intensity 0 at dawn |
| Hemisphere | 1 | — | |
| Character fill (`charLight`) | 1 | — | `game.js:72-73` |
| Pool points | N = 4 (touch) or 6 (desktop), fixed at boot | — | Lanterns, guard lanterns and beam hit spots as priority sources |
| Rig spots | 2 | yes (1024 on low/medium, 2048 on high+) | Shared by searchlights; intensity 0 and `shadow.autoUpdate=false` when unassigned; always carry a `map` |

`rig.census()` returns `{dir:1, hemi:1, point:1+N, spot:2}` and must be constant across chapters.

### 9.2 Quality tiers

| Feature (owner P unless stated) | low | medium | high | ultra |
|---|---|---|---|---|
| Internal res | 0.75× (dyn 0.6–0.75) | 1.0× (dyn 0.7–1.0) | min(DPR, 1.25) | min(DPR, 1.5) |
| AA | FXAA (+CAS when scale < 1) | MSAA 2 + FXAA | MSAA 4 | MSAA 4 |
| Sun shadow | 1024, 30 Hz | 2048, 30 Hz | 2048 | 4096 |
| Small-caster cull (batches < 0.4 m tall, or > 30 m behind the play plane) | on | on | off | off |
| Sky drawn after opaques (early-z) | yes | yes | yes | yes |
| DOF taps | off | 16 (half res) | 36 | 48 |
| God rays | off | on | on | on |
| Soft (depth-faded) beams and shafts | off (hard additive) | on | on | on |
| SSAO half-res (cut-able) | blobs only | blobs only | on | on |
| Particles (embers, smoke, moths, dust, feathers) | 25 % | 50 % | 100 % | 100 % |
| Instanced flock | yes | yes | yes | yes |
| Rim light on characters | yes | yes | yes | yes |
| Sun / lamp flares, finale lens dirt | off | on | on | on |
| Motion blur, raymarched fog (cut-able) | — | — | — | on |

### 9.3 Per-chapter lighting presets (F `look.js`; LookDirector blends)

The goldenHour column is today's `LOOK` (`src/render/look.js:6-37`). Presets are uniform-only, so blending costs about 0. A sky (env) change re-bakes the PMREM under the card (10–50 ms).

| Field | goldenHour (I) | sunset (II) | dusk (II end) | night (III) | dawn (IV a) | sunrise (IV b) |
|---|---|---|---|---|---|---|
| sunDir | (.6, .72, −.34) | (.80, .21, −.56) | (.82, .00, −.57) | moon (−.12, .86, −.50) | (.86, −.05, −.50) | (.86, .06, −.50) |
| sun colour / intensity | #ffcf96 / 7.0 | #ff9a52 / 5.5 | #ff6a3a / 0.4 | #9fb4ff / 0.9 | #ffb08a / 0.0 | #ffd9a8 / 6.5 |
| hemi sky / ground / I | #9fb0cf / #8a6546 / .95 | #8a8fb8 / #6a4030 / .8 | #5a6a9a / #3a2c30 / .6 | #23304f / #1a1612 / .35 | #6f7fb0 / #5a4a4a / .6 | #a8b8d8 / #8a6a50 / .9 |
| sky zenith / horizon | #5d7cb4 / #dcc8bb | #4d5f96 / #f0a477 | #2a3360 / #c4705a | #070b1a / #1c2540 | #3a4f86 / #e8a6a0 | #6d8fc7 / #ffd2a0 |
| stars / moon | 0 / 0 | 0 / 0 | 0.3 / 0 | 1 / 1 | 0.4 / 0 | 0 / 0 |
| fog colour / sun colour / density | #b9a594 / #f7c58c / .022 | #b48a7a / #ff9e62 / .026 | #6b5466 / #c4705a / .030 | #1a2236 / #4a5a8a / .030 | #c9a9b2 / #f0a088 / .030 (low falloff: mist) | #c9b8a8 / #ffc890 / .020 |
| exposure / bloom / threshold | 1.05 / .28 / 1.6 | 1.08 / .32 / 1.4 | 1.2 / .38 / 1.0 | 1.35 / .45 / 0.9 | 1.15 / .30 / 1.3 | 1.0 / .36 / 1.5 |
| contrast / saturation | .14 / 1.02 | .16 / 1.06 | .15 / .95 | .18 / .85 | .14 / .95 | .15 / 1.05 |
| lantern pool × / glow × / glass emissive × | 1 / 1 / 1 | 1 / 1 / 1 | 1.8 / 1.6 / 1.4 | 2.2 / 2.0 / 1.7 | 1.4 / 1.2 / 1.2 | .6 / .5 / .5 |
| env intensity / rays | .55 / .35 | .5 / .5 | .35 / 0 | .25 / 0 | .4 / .3 | .6 / 1.2 (1.8 at the finale) |
| shadow bias / normalBias | −.00025 / .035 | −.0004 / .05 | — | −.0003 / .04 | — | −.0005 / .06 |

**Per-chapter use:**

| Ch | `def.look` |
|---|---|
| I | `goldenHour` (the finale's sun swing stays a scripted override) |
| II | `sunset` for x 0–176; the SunClock time-blends to `dusk` |
| III | `night` |
| IV | x-keys: `dawn` at 0 → blend to `sunrise` by 150; the finale forces full `sunrise` |

### 9.4 Audio plan (P)

**Buses:**
- sources → `sfx` / `music` (automated) / a new `amb` / `ui` → user gains `sfxUser`, `musicUser`, `ambUser`, `uiUser` → `userMaster` → the existing compressor (`audio.js:15-17`).
- Ambience currently wires straight to dry and reverb (`audio.js:65,72,77,82`) and moves to `amb`.
- The `ui` bus bypasses the duck and keeps playing during pause.

**Fixes:**
- **Mute** acts on `userMaster`, fixing `fadeIn` undoing mute (`boot.js:41`, `audio.js:287`).
- **Pause** ducks and filters the game buses over 0.3 s instead of `ctx.suspend()` (`game.js:205`).
- Visibility and iOS interrupted handling.
- Voice cap ≤ 32 with pooled nodes.
- **Karplus–Strong buffers cached per pitch.** Today 2.4 s is rendered in JS for every note (`audio.js:129-152`).

**Music engine:**
- A look-ahead scheduler (25 ms timer, 120 ms horizon) replaces the frame-locked chase pulse (`audio.js:252-261`).
- Instruments: oud (KS), qanun (bright KS + tremolo), ney (bandpassed noise + vibrato sine), bendir/darbuka (doum + tek), drone pad (`audio.js:74-78`), singing bowl.

| Context | Music | Ambience bed | Reverb |
|---|---|---|---|
| Menu | slow oud taqsim in Hijaz; ney leitmotif from the I finale melody | wind | 2.6 s |
| I | as today (drone, oud chase, D-hijaz finale `audio.js:266-285`) on the scheduler | souk murmur, birds | alley 1.2 s / courtyard 2.6 s |
| II | Bayati on D: qanun ostinato and ney. The sunset clock pushes the tempo 70 → 96 bpm. The catch is a qanun swell. | coppersmith hammering (tuned resonators), trickling vats, swifts | souk 1.2 s / madrasa 2.6 s |
| III | Saba, sparse: low drone, far ney phrases. Chase: darbuka maqsum at 120 bpm with oud. | crickets, distant dogs (formant barks), drips; each tripwire a faint 2–4 kHz sine that cuts out when broken | alley 1.2 s / cistern 5.5 s with pre-delay |
| IV | Rast; dawn ney solo. Finale: full ensemble cadencing, resolving to Ajam on the sunrise, then the "answered light" chord (D–A–D–F♯). Credits: Chapter I's melody in Rast. | wind on the walls, the drummer, a bird chorus whose density follows the sun | minaret 3.5 s / open 0.8 s |

- **Light makes music:** each sun-lock's bowl is tuned to a degree of the chapter's maqam (`lockCharge {level, degree}`, `lockOpen {degree}`).
- **Stingers:** checkpoint, lock open, rope snap, dazzle (inverted swell), chapter end, answered light.
- **UI sounds:** hover (soft brass tick), confirm (two-note qanun), back (descending pluck), slider tick (pitched by value), card (bowl strike).

**New SFX names** (unknown names already fall through, `audio.js:197`):

| Group | Names |
|---|---|
| Mirrors | `mirrorGrip`, `notch`, `mirrorRoll` (loop), `crank`, `capstan` (loop) |
| Locks | `lockCharge` (loop), `lockOpen`, `boltShut` |
| Rope | `ropeSmoulder` (loop), `ropeSnap`, `counterweight` |
| Lamps and tripwires | `dazzle`, `fixate`, `turret`, `dartGuard`, `guardStun`, `guardSleep`, `tripHum` (loop) |
| Places | `plankCreak`, `plankFall`, `dyeSplash`, `lift` (loop), `liftStop`, `hatch` |
| Story | `trayPick`, `trayInsert`, `sunsetTick`, `lampsOn`, `lampsOff`, `answeredLight` |

**Mix:**
- Music ducks under death and alarm. Approximately −18 LUFS through gain staging; a "reduced dynamic range" option for phone speakers.
- The mix comes from `game.mix` (F), which merges generic fields with `L.mix(x, game)`: `{crateSpeed, hum, tension, height, birds, chase, finale, zone, music:{state, intensity}, loops:{}}`.

---

## 10. Judge flaws fixed, and puzzle capability audit

### 10.1 Flaws found by the judges and where they are fixed

| Flaw | Fix | § |
|---|---|---|
| Tilt with vertical input triggers the up-edge jump (`player.js:74`, `:151-154`) | Up-edge never buffers a jump while gripping or in lever/crank/capstan; WP-L acceptance test | 6.3 |
| Chapter II too dense (≈ 9 lock → gate puzzles) | 6 puzzles + 2 flow beats (vats, plank run) + 1 set piece; mirror-on-crate (C1) cut | 3 |
| Stick tilt fiddly on touch | Finger aim with ±1-notch soft snap; sticky grab on mirrors for touch | 6.3, 8.1 |
| Visual sun re-keyed per room makes shadows swim | One sun per preset matching the authored angle within 5°; time blends only in the clock and dawn (diegetic) | 1.3 |
| Two contradictory searchlight models | One rule everywhere ("lit = seen"); Chapter I re-validated | 6.4 |
| Photocell lift depends on a measured stop height | The lift clamps analytically to the beam crossing (6.495, E2 at 6.5); top reset rule | 5.2 |
| Heliostat needs ±0.7° | 6°/s capstan plus a ±2° magnet for everyone | 5.2 |
| Thin emotional arc | The tray bookend, the answered light, lamp cascades on and off, skyline foreshadowing, the epilogue pedestal | 0 |
| Graphics measured too late | P (graphics, perf, audio) runs in phase 0, parallel to F, on disjoint files | 11.5 |
| WP-L too wide | F does the plumbing (interactables, plate weight, generic loop, rig spots, animState move); L keeps the light system, states and lab | 11 |
| Spot-pool pops | Off-screen acquire/release hysteresis; ≤ 2 lamps per 40 m | 6.4 |
| F vs graphics file overlap | Render files partitioned: F owns look/world/materials/textures/lightpool/new director and rig; P owns post/renderer/sky/lighting/atmosphere/glsl/fx/shafts. F passes the chapter root as the `scene` argument of `Shafts`/`Dust`/`Flock`, so it needs no edits there. | 11.2 |
| P2-C2 pull blocked by the bollard (no step-up while gripping) | Solution is a push from the right | 3.2 |
| P2-C1 "hop the 0.8 stand" impossible | Room cut; all stands are mantle-able | 1.2 |
| Moon-well beam at 1.2 grazes the boy's head | Lock moved to the right of the well | 4.2 |
| Free-position mirror tolerances (III-E only ±0.28 m) | Kerb stops for every wheeled solution | 1.2 |
| III-C2 "lamp sees through mirrors" unspecified | Cut; replaced by the tripwire gauntlet flow beat; only the lamp's own eye sees | 4.2 |
| Tripwire under a roof can't be darted by a searchlight | Sensors carry their own dart turret | 4 |
| Chase with three stuns has no tension | The Chapter IV chase is the one tuned beat, with a two-sided acceptance gate | 5.2 |
| Lantern star cookie vs. searchlight in the same spot slot (story) | Cookies go on the rig spots' `map`, always non-null | 6.4 |
| Big vat "impossible" margin too thin (3.2 m) | 3.4 m (needs 2.65 > 2.36) | 3.2 |

### 10.2 Capability audit (every traversal and puzzle step)

| Where | Required move | Number | Limit | OK |
|---|---|---|---|---|
| II-A2 | hang-climb the shelf | 2.0 | ≤ 2.5 | ✓ |
| II-A2 | drop off the shelf | 2.0 | ≤ 2.4 safe | ✓ |
| II-B1/D1/D2, III-B1/E, IV-D | push a wheeled mirror (body 0.7 × 0.8) to a kerb | kerb 0.15 | body can't pass; boy steps over (0.26) | ✓ |
| II-C vats | gaps 1.4 / 1.8 / 2.0 / 1.6 from 0.6 rims | needs ≤ 1.66 | 2.36 | ✓ |
| II-C V5 | without the crate | needs 2.65 | > 2.36 | impossible ✓ |
| II-C V5 | with the crate | needs ≤ 2.06 | 2.36 | ✓ |
| II-C2 | mantle CR3 | 1.0 | 0.5–1.12 | ✓ |
| II-C2 | hop the bollard | 0.4 | jump | ✓ |
| II-D1 | ivy to the gallery; mantle M7's stand | 4.0 vine; 0.8 | vine; mantle | ✓ |
| II-E1 | barrels | 0.82 | hop ≤ 0.85 | ✓ |
| II-E1 | plank run vs. walk | 0.45 s vs 1.05 s | 0.7 s | ✓ |
| II-E1 | drops | 2.4, 2.2, 1.0 | ≤ 2.4 | ✓ |
| II-E2 | ivy 4.6; ladder 4.6; ledge 1.4 hang | — | — | ✓ |
| II-E2 | head under the ray | 11.76 < 12.0 | — | ✓ |
| III-A2 / C2 T6 | crawl under the 0.8 line | 0.56 < 0.8 | standing 1.16 breaks it | ✓ |
| III-C2 T7 | walk under the 1.8 line on 0.25 steps | head 1.66 | jump 2.55 breaks it | ✓ |
| III-A1 / T5 / T4 | run-jump a 1.4 low line | ≈ 1.95 m above 0.3 | 1.74 needed | ✓ |
| III-D | cart 1.25, wall 2.0 | hang-climbs | ≤ 2.5 | ✓ |
| III-D | drop off the wall | 2.0 | ≤ 2.4 | ✓ |
| III-D | crawl hole | 0.62 | 0.56–1.16 | ✓ |
| III-D | guard margin at T4 | ≈ 5.2 m | > 0 | ✓ |
| IV-A2 | stairs 0.25; R2 1.4 hang; gap 2.0 | — | — | ✓ |
| IV-A2 | well depth | 7.4 | > 6.6 lethal (intended) | ✓ |
| IV-A2 | chimney hop; drop | 0.7; 2.4 | — | ✓ |
| IV-B | lift step to E2 | 0.005 | ≤ 0.26 | ✓ |
| IV-B | lift rise per step | 0.01 m | < 0.1 snap | ✓ |
| IV-B | descent drops | 2.4 / 2.2 / 1.9 | ≤ 2.4 | ✓ |
| IV-C | wall 2.0, crates 1.0, cart 1.25 | hang / mantle / hang | — | ✓ |
| IV-C | crawl door | 0.62 | 0.56–1.16 | ✓ |
| IV-D | ladders; head under the y 6.0 leg | 5.16 < 6.0 | — | ✓ |
| IV-E | head under the y 14.5 ray | 13.16 | — | ✓ |

---

## 11. Engineering plan

### 11.1 Ownership and freeze rules

- **Foundation (F) lands first.** After it merges, F's engine files are **frozen**: `game.js`, `camera.js`, `chapterloader.js`, `cinematics.js`, `levelkit.js`, `testapi.js`, `events.js`, `look.js`, `lookdirector.js`, `lightrig.js`, `world.js`, `materials.js`, `textures.js`, `lightpool.js`, `storage.js`, `save.js`, `src/chapters/index.js`, and the `tools/lib/*`, `tools/playtest.mjs`, `tools/negative.mjs`, `tools/cycle.mjs` runners.
- A package needing a change in a frozen file writes `docs/requests/<wp>.md` (file, change, reason, test). The integrator applies it. Packages work around through the hooks in §11.2 meanwhile.
- **Ownership is exclusive.** Each file in §11.4 has exactly one owner after F. Files F modifies and then hands over: `player/animator/entities/bridge/physics.js` → L; `boot.js`, `ui.js`, `style.css`, `input.js` → U; `src/chapters/souk/**` and `tools/bots/souk.js`, `tools/neg/souk.mjs` → C2; chapter stubs → their chapter package.
- **No package owns `game.js`.** `boot.js` and `ui.js` belong to U alone.
- **Existing `src/assets/*` files are frozen.** New builders go in new files: L's `src/assets/lightprops.js`, or chapter folders.
- **Each package runs in its own git worktree and dev-server port:** P 5174, L 5175, U 5176, C2 5177, C3 5178, C4 5179. F uses 5173.

### 11.2 Foundation (F): spec

**Goal.** Multiple chapters, presets, saves, a fixed light rig and a generic test API, with Chapter I behaving exactly as today.

**F1. Chapter contract.**
```js
// src/chapters/<id>/index.js
export default {
  id, n, numeral, glyph, label,              // label: menus only
  next,                                       // id of the next chapter or null
  look: 'goldenHour' | [{x, preset}],         // LookDirector keys
  surfaces: {name: SurfaceDef}, materials: {name: MaterialDef}, needs: ['plasterBlue', ...],
  audio: {theme, zones: [{x0, x1, verb, amb, music, tension, hum}]},
  intro: {pos, look, fov, dur}, menuShot: {pos, look, fov, cp},
  build(game, kit) /* function, async function or generator; returns L */,
};
// kit = { K (Batcher kit), root (THREE.Group), track(obj), add(obj), mats, phys, levelkit helpers }
// L = { entities[], systems[], interactables[], triggers[], checkpoints[], cameraKeys[], killZones[],
//       lanterns[], lightSources[], shaftSpots[], dustRegions[] (non-empty), flockSpots[], covers[],
//       hints[], credits?, bounds:{x0,x1,y0,y1}, shadowExtent?,
//       prepare(cp, game), mix(x, game), safeZone(x), lookTarget(pl), extraState(),
//       finale?: DepthWalkConfig, onComplete? }
```
- Entities: optional `id`, `prestep()`, `step(dt)`, `render(alpha, dt)`, `dispose()`; **mandatory** `getState()` / `setState(s)`.
- Systems: `step(dt)`, `render(alpha, dt)`, `getState`/`setState`, `dispose`.
- Interactables: `near(x, y, facing) → bool`, `grab(player)`, `release()`, `drive(input, dt, player)`.
- Snapshots are keyed by `id` (auto `Kind#i` from build order when absent).

**F2. `src/chapters/index.js`** registers `souk`, `sundown`, `night`, `dawn` and `lab` (dev only, hidden from menus) with lazy `import()`. Each of `sundown`, `night`, `dawn` and `lab` gets a **30 m stub**: floor, spawn, one checkpoint, and an end trigger calling `completeChapter()`.

**F3. `src/game/chapterloader.js`.** `loadChapter(id, cp, {reason})` (promise):
1. Fade out, or show the card through `hooks.card`.
2. Suspend the sim.
3. Dispose the old root: geometries, non-cached materials and textures, sprite materials, Shafts/Dust/Flock created on the root. **Never** the `mats.cache` entries.
4. `phys.clear([player.body])`; empty `vines`, `interactables`, `systems`.
5. Reset game fields (gameplay map §8a.7).
6. `lookDirector.apply(def.look)`. Rebuild the env map when the preset's sky changes.
7. Register and bake missing surfaces asynchronously (one per frame).
8. `def.build` (await or iterate the generator).
9. Construct Shafts(root, sunDir), Dust, Flock(root, mats, L.flockSpots) and the glow sprites; add pool sources.
10. `camRig.setKeys` + `reset()`.
11. Sort checkpoints; take the initial snapshot; `L.prepare(cp)`; spawn.
12. `renderer.compileAsync(scene, camera)`; one warm-up render.
13. Fade in.

`cycle()` leak checks use `renderer.info`.

**F4. `src/game/game.js` (then frozen).**

| Area | Change |
|---|---|
| Lifetimes | `initOnce()` (camera, rig, player, light rig, FX pools, test API) vs per-chapter state |
| Generic loop | `prestep?.()` / `step` / `render(alpha, dt)` over `L.entities` and `L.systems`, replacing `:52-53`, `:156-157`, `:374-376`; bodies with `crushes:true` replace the crate crush loop (`:163-166`); `phys.onImpact` uses `b.onImpact?.()` or `kind 'crate'` |
| Kill zones | `L.killZones` |
| Interactables | `game.interactNear(x, y, facing)` replaces `leverNear` (`:123`) |
| Pin | adds `upPressed`, `downPressed`, `grabPressed`, `pointerPressed`, `aimTarget` (pointer ray onto z = 0 while `pointer.active` in play) |
| Modes | `boot \| menu \| loading \| intro \| play \| dying \| cutscene \| finale \| chapterEnd \| credits`, plus a separate `paused` flag |
| Flow API | `newGame()`, `continueGame()`, `startChapter(id, cp)`, `completeChapter()`, `restartCheckpoint()` (respawn without counting a death, ≤ 0.6 s fade; fixes `boot.js:38`), `restartChapter()`, `toTitle()`, `setPaused(p)` (freeze-frame: renders 1 dimmed frame then stops; calls `audio.setPaused?.(p)`, else falls back to suspend), `setMenuOpen(b)` (zeros input) |
| Settings | `applySettings(s)`, keys: `shake, reduceMotion, cameraDist, timeScale, coyote, buffer, assist, hints, invertTilt, aimSnap, grabMode, crawlMode, fpsCap, renderScale, dynres, dof, grain, brightness, quality, volumes{}` (F applies the engine ones; the rest are forwarded to `rs.applySettings?.()` / `audio.setVolumes?.()` / `input.applySettings?.()`) |
| Events | `game.events.on/off/emit`: `chapterStart{id,cp}`, `checkpoint{id,cp}`, `death{kind}`, `respawn`, `chapterEnd{id,next}`, `credits{lines}`, `pause{on}`, `mode{mode}`, `land{hard,speed}`, `impact{x,speed}`, `save`, and any entity `game.emit(name, data)` |
| Hooks | `game.hooks = {frame: [], card: null, credits: null, hint: null}` |
| Mix | `game.mix` = generic fields + `L.mix(x, game)` → `audio.update(dt, mix)` |
| Shadow focus | from the camera rig's look, or the override result's `shadowFocus` (fixes `:406`) |
| Determinism | `params.hold` (`?hold=1`): rAF never advances the sim; only `__medina.sim` does |
| Saves | on checkpoint and chapterEnd |
| Misc | `game.registerExt(name, fn)` → `__medina.ext[name]`; `game.timeScale`; `minY` on checkpoints |

**F5. `src/game/cinematics.js`.**
- **`DepthWalk`**, generalised from `game.js:246-308`:
  - `{path:[{p, pause?, pose?, onArrive?}], walkSpeed 1.55, autoWalkAfter 2, camera(fn), sunTo?, fogMul?, grade?, letterbox?, zEnd, onEnd}`;
  - drives the boy scripted along a Catmull-Rom curve;
  - restores every look mutation through the LookDirector.
- **`introShot(def.intro)`** with **live** sway (fixes the frozen `t`, `game.js:427-432`).
- **`menuShot`.**

**F6. `src/game/levelkit.js`.**
- From `level1.js:24-94`: `vbox, ground, block, lantern, facades, farBuilding`.
- `skyline({exclude: [[x0, x1], ...]})`, `cypress`, `rubblePile`, `crateMeshStatic`, `kerb(x0, x1, h = 0.15)`, `killZone()`.

**F7. Render (F-owned files only).**

| File | Change |
|---|---|
| `look.js` | Preset schema plus all six presets of §9.3 |
| `lookdirector.js` | `apply(preset)`, `keys(xKeys)`, `update(x)`, `blendTo(preset, sec)`, `override(fields)`, `restore()`. Writes: sky uniforms (existing ones, plus `uNight, uStars, uMoonDir, uMoonColor, uMoonSize` **if present**: P adds them); `light.sun` colour/intensity; `light.sunDir` and its own `sunDir` (replaces `LOOK.sunDir`); `light.sun.shadow.bias/normalBias`; hemi; `scene.fog.color`; `G.uFogSunColor/uFogParams/uFogStart/uWindStrength`; post params `exposure, bloom, threshold, contrast, saturation, lift, rays, rayColor, vignette, grain, fade, fadeColor, letterbox` (names as in `post.js:157-166`); LightPool colour and multiplier; glow-sprite colour and multiplier; `glassGlow.emissiveIntensity`; `shafts.setSun?.(dir, colour)` |
| `world.js` | `updateAtmosphere` reads the director's sun (`:48`, `:55`); `rebuildEnvironment(skyUniforms)` (calls the existing `buildEnvironment`, `sky.js:71-84`, then `mats.setEnv`); progressive bake |
| `materials.js` | `register(defs)`, `setEnv(tex, scale)` over `mats.cache` (re-applies `envMapIntensity`) |
| `textures.js` | Export `SURFACES`, `registerSurfaces(defs)`, `bakeAsync(names, onProgress)` (one surface per frame) |
| `lightpool.js` | Priority and dynamic sources (`addDynamic(owner, priority)`), `setColor`, `setMul`, `clear()` |
| `lightrig.js` | §9.1: `acquireSpot(owner)` / `releaseSpot`, `census()` |

**F8. Gameplay files (then handed to L).**

| File | Change |
|---|---|
| `physics.js` | `clear(keep)`, `removeBody`, `removeSolid`, `Body.weight`, solid flags `light: 'block' \| 'pass'` (read later by L) |
| `entities.js` | Every scene add goes through `game.add(obj)` (the chapter root). `Guard.getState` returns the real state (`:392`). `Plate` sums `b.weight ?? (kind === 'player' ? 0.35 : kind === 'guard' ? 0 : 1)` (fixes `:63`). `Searchlight` acquires a rig spot. The guard's lantern light becomes a pool priority source (removes its PointLight, `:306-310`). `Lever` registers as an interactable. Crates get `crushes:true`. |
| `bridge.js` | Tracked adds |
| `player.js` | `spawn` resets `z`, `scripted`, `fvx`; `interactNear`; per-instance `this.tune = {...P}` (assists change coyote and buffer); **`animState()` / `animContext()`** moved here from `game.js:335-366` (L extends them for its new states) |
| `animator.js` | `leverT` comes from `ctx` (fixes `:364`) |

**F9. `src/game/camera.js` (then frozen).**
- `reset()`, `distPortrait`, `distMul`, `shakeScale`, `reduceMotion`;
- portrait FOV floor 52°;
- `setSafeRect(px)` lens shift via `setViewOffset`;
- override results may return `shadowFocus`.

**F10. Input** (minimal; then U):
- `poll()` adds `pointer: {x, y (NDC), active, pressed, released, kind}`. Desktop: left mouse on the canvas.
- `nav{up, down, left, right, confirm, back}` edges.

**F11. Saves:** `src/core/storage.js` and `src/core/save.js` (§7.3).

**F12. `boot.js`** (then U):
- `?chapter=`, `?cp=`, `?hold=1`, `?nosave=1`, `?continue=1`; `?autostart` kept.
- Device-class defaults (§8.4).
- Progressive bake and `compileAsync`.
- The loop calls `rs.beginFrame?.(now)` (false → skip the frame) and `rs.trackFrame(ms, {paused, hidden})`.
- `visibilitychange` → `game.setPaused(true)`.
- Registers `hooks.card` and `hooks.credits` stubs from `ui.js`.

**F13. `ui.js`** (then U): minimal card and credits stubs; keeps the existing pause menu working through the new flow API.

**F14. Chapter I** moved and adapted (§2 rows 1, 2, 7). `L.finale` uses DepthWalk.

**F15. Test API (`src/game/testapi.js`).**
- `__medina = {game, chapter(), loadChapter(id, cp) → promise, state() → {x, y, z, st, crawl, dead, mode, cp, t, deaths, chapter, extra: L.extraState()}, sim(sec, input | fn), teleport, checkpoint(i), finale(), setInput, closeup, photo, pause, events() (ring buffer), lights() (census), save(), ext:{}}`.
- `sim` accepts `aimTarget`.

**F16. Tools.**

| File | Content |
|---|---|
| `tools/lib/harness.mjs` | Chromium + SwiftShader; `--chapter --cp --from --to --port --tier --hold` (default on) |
| `tools/playtest.mjs` | Loads `tools/bots/<chapter>.js` |
| `tools/negative.mjs` | Runs `tools/neg/<chapter>.mjs`; **asserts and sets the exit code** (today it only prints, `negative.mjs:28-29`) |
| `tools/bots/lib.js` | `run, jumpAt, hangClimb, mantle, wait, crawlTo`. Re-reads `M.game.level` inside the closures (fixes `bot.js:4`). |
| `tools/bots/souk.js` | Moved from `tools/bot.js` |
| `tools/neg/souk.mjs` | The 5 old scenarios as assertions, plus "restart checkpoint is not a death" |
| `tools/cycle.mjs` | Leak and census cycle |
| `tools/probe.mjs`, `tour.mjs`, `shot.mjs` | Honour `--port` / `BASE` and `--chapter` |
| `package.json` | Scripts `test`, `test:souk`, `cycle` |
| `docs/ARCHITECTURE.md` | The contracts of this section, plus the event and SFX name registry |

**F17. Bugs:** all of §2 row 7 except mute (P).

**F18. Baseline.** Before refactoring, record `docs/baselines/souk.json` (bot game time, `__info` counts, boot time) and 6 tour screenshots.

**Foundation acceptance:**
1. `node tools/playtest.mjs --chapter souk` passes; total sim time within ±2 s of the baseline.
2. `node tools/playtest.mjs --chapter souk --cp 3 --from stealth` passes.
3. `node tools/negative.mjs --chapter souk` passes every scenario and exits 0. A deliberately broken assertion (`--selftest-fail`) exits 1.
4. `node tools/cycle.mjs` (souk → lab → souk → sundown → souk, ×3):
   - geometries and textures within +2 of the first souk load;
   - `programs.length` stable from the second cycle on;
   - `__medina.lights()` constant;
   - no `pageerror`.
5. Chain: `?chapter=souk&cp=6` + `__medina.finale()` → `chapterEnd` event → card → `sundown` stub loads; the save equals `{chapter:'sundown', cp:0}`; reloading with `?continue=1` lands in sundown.
6. With `Storage.prototype.getItem/setItem` patched to throw: boots, plays, saves in memory, no errors.
7. Determinism: two `?hold=1` souk bot runs give identical end-state hashes.
8. Title shot: the sun shadow camera target is within 10 m of the camera look x (not at x 188).
9. LookDirector round trip: `apply('night')` then `apply('goldenHour')` screenshot differs < 1 % from the baseline at 480 × 270.
10. Boot to `__ready` ≤ baseline + 10 %; the loading bar paints ≥ 10 distinct values.
11. `npm run build:artifact` builds and `dist-artifact/test.html` reaches `__ready`.

### 11.3 Work packages (six)

Each package's brief is §11.4 plus the design sections it cites (§2–§9). Together they are complete: an agent needs only this document and the code.

| WP | Title | Owns | Depends on | Phase |
|---|---|---|---|---|
| **P** | Presentation: graphics, performance, audio | `src/render/{post,renderer,sky,lighting,atmosphere,glsl,fx,shafts}.js`; new `src/render/{layers,fxaa,lut,ssao,dynres,shadowpolicy,flare,particles}.js`; `src/core/audio.js`; new `src/audio/**`; `tools/{perf,audio-tests}.mjs`; `docs/systems/{graphics,audio}.md` | none (contracts in §11.2 F7, §9.4) | 0 (∥ F) |
| **L** | Sunwork: light system, player states, lab | `src/game/{player,animator,entities,bridge,physics}.js`; `src/game/light/**`; `src/assets/lightprops.js`; `src/chapters/lab/**`; `tools/bots/{lab,lightlib}.js`; `tools/neg/lab.mjs`; `tools/light-unit.mjs`; `docs/systems/light.md` | F | 1 |
| **U** | Shell: menus, input, mobile, distribution | `src/ui/**`; `src/core/{input,haptics}.js`; `src/game/boot.js`; `src/main.js`; `index.html`; `public/**`; `vite.config.js`; `tools/{vite.artifact.config.js,make-artifact.mjs,make-icons.mjs,fetch-font.mjs,ux-tests.mjs,mobile-tests.mjs}`; `docs/systems/ux.md` | F | 1 (∥ L) |
| **C2** | Chapter II, plus Chapter I narrative grafts | `src/chapters/sundown/**`; `src/chapters/souk/**`; `tools/bots/{sundown,souk}.js`; `tools/neg/{sundown,souk}.mjs`; `docs/chapters/sundown.md` | F, L | 2 |
| **C3** | Chapter III | `src/chapters/night/**`; `tools/bots/night.js`; `tools/neg/night.mjs`; `docs/chapters/night.md` | F, L | 2 (∥ C2) |
| **C4** | Chapter IV, finale, credits, epilogue | `src/chapters/dawn/**`; `tools/bots/dawn.js`; `tools/neg/dawn.mjs`; `tools/fullgame.mjs`; `docs/chapters/dawn.md` | F, L (U's credits screen optional: F's stub works) | 3 |

### 11.4 Package specs and acceptance

**P: Presentation.**
- **Graphics:** §9.2 features, in priority order:
  1. sky after opaques;
  2. FXAA + CAS;
  3. shadow policy (30 Hz on low/medium with an immediate update on camera snaps; small-caster cull);
  4. frame cap via `rs.beginFrame`, dynamic resolution (viewport sub-rect, no reallocation), two-way auto-quality ignoring paused frames;
  5. night sky uniforms (`uNight, uStars, uMoonDir, uMoonColor, uMoonSize`);
  6. instanced Flock with the same constructor;
  7. rim term for the character materials;
  8. **soft layer pass:** `LAYERS.BEAMS` drawn after the scene with shared uniforms `SOFT = {uDepth, uRes, uNearFar, uSoftOn}` exported from `layers.js`; shafts use it, and so do L's beams;
  9. GPU particles `particles.emit(kind, pos, opts)` (embers, smoke, moths, dust, feathers);
  10. flares and finale lens dirt;
  11. `setTier` leak fix (`post.js:291-293`);
  12. context-loss hooks `rs.onContextLost/onContextRestored`;
  13. half-float fallback;
  14. shaft `setSun(dir, colour)` + dust colour uniform (`shafts.js:79`);
  15. then cut-ables: LUT, SSAO, motion blur.
- **Audio:** §9.4 in full. Public API kept: `start, play(name, x, data), update(dt, mix), finale, fadeIn, fadeOut, muted`. Added: `setPaused, setVolumes, setChapter(audioDef), setZone, ui(name), stinger(name)`.
- **Acceptance:**
  - `tools/perf.mjs` table (shadow vs main calls, tris, programs) at the six Chapter I tour spots, before and after:
    - shadow-pass calls −30 % on low/medium;
    - −100 calls from the flock;
    - FXAA active on low;
    - programs stable after warm-up;
    - a tier round-trip leaks no render targets or materials;
    - `?slowgpu=8` drops the scale within 2 s and recovers after 5 s of headroom, with ≤ 1 tier change per 30 s;
    - cap 60 holds under a 120 Hz rAF stub.
  - Night sky renders: a screenshot with `uNight=1` shows stars.
  - The souk bot still passes.
  - Audio offline tests:
    - 20 s per theme: no NaN, peak ≤ −1 dBFS, RMS −30…−14;
    - scheduler onset jitter ≤ 5 ms under 4× CPU throttle;
    - mute survives `fadeIn`;
    - a UI sound plays while paused;
    - 200 rapid steps leave ≤ 32 voices;
    - every §9.4 name renders without error.

**L: Sunwork.**
- §6 in full: LightSystem and all entities of §6.2; Searchlight and Guard changes; the jump-buffer fix; grip-tilt, crank and capstan states with finger aim and soft snap; animator poses; beam rendering on `LAYERS.BEAMS` (fallback layer 3 if P is absent); priority pool spots; `trayMesh()`, mirror, crank, rosette lock, bolt, rope and sensor-turret meshes in `src/assets/lightprops.js`; mirror material registered via `mats.register`.
- **Lab chapter** (`?chapter=lab`): 12 rooms, one per verb in §6.7 plus jump-fix and kerb rooms. Each is built with the exact puzzle geometry of §3–5 where possible, so chapters reuse proven numbers.
- **Acceptance:**
  - `node tools/light-unit.mjs` (pure Node):
    - reflection and notch maths;
    - ray against box, segment and circle;
    - 100 random traces against brute force;
    - every hit listed in §3–5 reproduced (fixtures: II-A1 … IV-E).
  - Lab bot passes all rooms.
  - Lab negatives: wrong notch → lock dark for 10 s; one beam never burns; bolt dash fails; walking a hurdle or standing in a crawl line → `shot`; dazzle lets the boy run in the open and no dazzle kills; idle sunset clock fails and the respawn restores `t`; a mirror pushed out of its zone respawns in ≤ 3 s; death and respawn restore angles and locks; **pressing up while gripping a mirror never jumps** (100 trials).
  - Trace p95 ≤ 0.35 ms.
  - Beam screenshots at 390 × 844 and 1280 × 720.
  - Souk bot and negatives still pass (unified searchlight).
  - `__medina.lights()` unchanged.

**U: Shell.**
- §7 and §8 (except rendering): screens, FocusManager, settings, chapter select with thumbnails, cards, credits, HintDirector, save-code fallback, touch overhaul, haptics, lifecycle, orientation glyph, `camRig.setSafeRect` wiring, PWA, artifact single file, icons, font.
- **Acceptance:**
  - `tools/ux-tests.mjs`:
    - keyboard only: boot → settings → music 4 → back → new journey → play 2 s → Esc → title → continue resumes the same chapter and checkpoint;
    - the same with a stubbed gamepad;
    - storage throwing: playable, settings in memory, save code round-trips;
    - settings persist across reload;
    - `?autostart=1` skips menus.
  - `tools/mobile-tests.mjs` (iPhone 13 portrait and landscape, Pixel 7; CDP touch):
    - floating stick 0.5 → walk, 1.0 → run;
    - jump; grab + crate push; ⏸ opens pause;
    - finger aim tilts a lab mirror to the touched notch;
    - targets ≥ 44 px inside the safe areas;
    - the lens shift keeps the boy's projected y inside the safe rect;
    - the touch UI hides in menus.
  - Artifact: one HTML ≤ 3 MB that runs in `test.html` in a sandboxed iframe with no console errors and no service worker.
  - Hosted build: installable manifest; reloads offline.

**C2: Chapter II + Chapter I grafts.**
- §3 complete, plus §2 rows 3–5. Crumble planks, dye vats and the terminator use are local or L's.
- **Acceptance:**
  - Bot passes from cp 0 and from every checkpoint.
  - Negatives:
    - each lock stays dark with the wrong setup (shelf crate in place; M2 at every other notch; M7 off the kerb; one beam on the rope);
    - bolt dash fails;
    - V5 jump without the crate drowns;
    - walking the planks falls;
    - idle sunset clock → `sunset` and the respawn resets the clock;
    - `prepare(cp)` assertions.
  - Souk bot passes through the tray pickup to `chapterEnd`.
  - Perf: every checkpoint at medium ≤ 180 calls and ≤ 550 k tris; build time ≤ 1.2 × souk.
  - Tour screenshots per beat (landscape high, portrait medium).

**C3: Chapter III.**
- §4 complete.
- **Acceptance:**
  - Bot passes from cp 0 and from every checkpoint.
  - Negatives:
    - walking T1, standing in T2/T6, jumping under T7 → `shot`;
    - B1 with M1 off the kerb never charges;
    - B2 without the tilt dies in the open; dazzle crossing survives;
    - C1 without the decoy dies;
    - the guard is asleep after T4 and never reaches the hole;
    - moon on GL leaves it at 0.59 level (open = false);
    - ML lights only at −45°.
  - ≤ 2 searchlights hold rig spots at any time; `__medina.lights()` constant.
  - Perf and screenshots as C2.

**C4: Chapter IV, finale, credits, epilogue.**
- §5 complete: Lift, heliostat mesh and tray insertion, the captain chase, the fortress, the cascade-off, the answered light, credits data, the epilogue load of `souk`.
- **Acceptance:**
  - Bot passes to the `credits` event from cp 0 and from every checkpoint.
  - Negatives:
    - lift with F ≠ 75° never stops at E2 (top reset seen);
    - L1 dark except at +30°;
    - chain dark if any mirror is wrong;
    - chase with `shafts(false)` → caught; with shafts, the bot's minimum guard distance is 2.0–4.0 m;
    - H without the tray never reflects;
    - the magnet engages within ±2°.
  - `tools/fullgame.mjs`: souk cp 6 → sundown → night → dawn → credits → epilogue → title, checking the save at every `chapterEnd`.
  - Perf and screenshots as C2.

### 11.5 Schedule (at most two agents at once)

| Phase | Agent A | Agent B | Notes |
|---|---|---|---|
| 0 | **F** | **P** | Disjoint files. P tests on the pre-F tree (souk) and keeps every public API and param name. |
| 1 | **L** | **U** | Both after F merges; P merges first if done (render files only). |
| 2 | **C2** | **C3** | After L merges. |
| 3 | **C4** | **Integration I** | The integrator merges F → P → L → U → C2 → C3 and runs the matrix while C4 builds. |
| 4 | **Integration II** | — | Merge C4, full matrix, artifact, docs, publish. |

The critical path is F → L → C2/C3 → C4 → integration. SwiftShader bots cost about 100 s per chapter, so packages test mid-chapter with `--cp` and `--from`.

---

## 12. Integration plan

1. **Merge order:** F → P → L → U → C2 → C3 → C4.
   - After each merge, run `npm test` (every available chapter bot and negative suite) plus `node tools/cycle.mjs`.
   - Apply `docs/requests/*.md` to frozen files, with the requester's test.
2. **Contract stitching** (expected small edits in frozen files):
   - `game.js` wires `audio.setPaused/setChapter/setZone` when P exists;
   - the LookDirector writes P's night-sky uniforms;
   - L's beams use P's `SOFT` uniforms;
   - U's card and credits screens replace F's stubs (via hooks, no `game.js` edit expected).
3. **Full matrix** (two Chromium instances at a time):
   - all four chapter bots from cp 0 and from the middle checkpoint;
   - all negative suites;
   - lab and `light-unit`;
   - `cycle.mjs`; `ux-tests`; `mobile-tests`; audio tests;
   - `perf.mjs` per chapter × tier.
4. **Chain:** `tools/fullgame.mjs` (about 8–10 min in SwiftShader with `?hold=1`). Reload mid-chain and Continue lands on the right checkpoint.
5. **Leak cycle:** I → II → III → IV → I. Memory within +5 %; programs stable after the first full cycle; light census constant.
6. **Device emulation:** iPhone 13 and Pixel 7 profiles with 4× CPU throttle, plus desktop 1280 × 720. Check the §8.5 budgets by proxy (calls, tris, programs, texture MB) and the §8.6 load gates.
7. **Contact sheet:** every checkpoint in landscape 1280 × 720 and portrait 390 × 844, plus menus, cards and credits. Reviewed against `docs/ART_DIRECTION.md` and §0.3 motifs.
8. **Artifact:** `npm run build:artifact` (the current artifact is stale). Smoke-test in `test.html` with storage throwing, no gamepads and no vibrate. Publish.
9. **Docs:** rewrite `docs/DESIGN.md` (four beat tables, controls including touch and pause, Sunwork rules) and update `docs/ARCHITECTURE.md`.
10. **Manual checklist:** first-mirror readability, tilt hint, night brightness calibration, finale and epilogue, mute/pause/visibility on a real phone if available (GPU timings remain estimates on this machine).

---

## 13. Cut list and risks

### 13.1 Cut order (first cut first)

| # | Cut | Fallback |
|---|---|---|
| 1 | Secrets / collectibles (never built; stretch only) | — |
| 2 | Ultra-only: motion blur, raymarched fog, second shadow cascade | — |
| 3 | SSAO | contact blobs |
| 4 | LUT crossfade | analytic grade per preset |
| 5 | Chapter thumbnails | palette gradients |
| 6 | Drummer windows (IV-A atmosphere) | — |
| 7 | Gyro/pointer menu parallax; save-code export | — |
| 8 | PWA service worker | plain static hosting |
| 9 | III-C2 gauntlet | shorten to T5 only |
| 10 | IV-B photocell lift | a crank-and-gate room using the same F mirror and E2 |
| 11 | II-E1 crumble planks | plain roof run |
| 12 | Epilogue load of souk | a still painted card of the pedestal |
| 13 | Last resort: merge III and IV into one night-to-dawn chapter | III-A, B, D, E, then IV-D and IV-E; keeps the tray, the cascades and the answered light |

**Never cut:**
- the foundation and the fixed light rig;
- Sunwork core verbs: sun-lock, mirror push/tilt, occlusion, crank, dazzle, tripwire;
- all four chapters' main paths;
- the tray bookend and the answered light;
- continue / new / chapters / settings / pause;
- touch controls, including finger aim and the pause button;
- saves with the storage fallback;
- the single-file artifact;
- the asserting bot suites.

### 13.2 Risks

| Risk | Mitigation |
|---|---|
| Thin beams unreadable on phones | Glints, sunspot decals, puzzle keys with `distPortrait`, `camera: close` default in portrait, high-contrast option |
| Shader recompiles on chapter switch | Fixed rig sized by device class; spots always with `map`; `compileAsync` behind the card; programs-count gates |
| F is long (critical path) | P runs alongside; F's spec is explicit; stubs let U and L start the moment F lands |
| Trace cost on mobile | 4 m grid, 60 Hz, ≤ 8 sources |
| Bot nondeterminism | `?hold=1`; steps end on entity state; reactive stealth steps |
| Merge conflicts | Exclusive ownership; frozen engine; request files |
| iOS memory / context loss | tex 0.5 on touch; per-chapter bake and dispose; context-loss reload at the checkpoint |
| Sunset-clock frustration | ≥ 30 s slack; assist +50 % |
| SwiftShader cannot measure GPU time | Gate on counts and CPU time; real-device frame times are estimates |
| Cultural sensitivity | No sacred text or call-to-prayer imitation; respectful crafts; folk lamp-keepers, not demons |
