# Audio (package P)

Owner files: `src/core/audio.js` (the engine facade), `src/audio/{mixer,voices,instruments,music,ambience,sfx,maqam}.js`,
`tools/audio-tests.mjs`. The plan is FULL_GAME §9.4. Everything is synthesised in WebAudio: no samples.

## Graph

```
 sfx ─(death lowpass)─ sfxUser ─┬──────────────────────┐
 music ─────────────── musicUser ┼─ sends ─ reverb A/B ─┼─ gameDry ─ pauseLP ─ pauseGain ─┐
 amb ───────────────── ambUser ──┘   (pre-delay)        │                                 ├─ userMaster ─ master ─ glue ─ limiter ─ soft clip ─ out
 ui ────────────────── uiUser ──────────────────────────┴─────────────────────────────────┘
```

- `userMaster` carries the master volume and **mute**; `master` carries the fades (`fadeIn`/`fadeOut`).
  So `fadeIn` can never undo a mute.
- **Pause** ramps `pauseGain` to 0.18 and `pauseLP` to 650 Hz over 0.3 s; the `ui` bus bypasses both.
- Reverb: two convolvers crossfaded on a zone change (1.5 s), a shared pre-delay; impulse responses are
  generated once per (length, decay) and cached. Places: `alley` 1.2 s, `souk` 1.2 s, `courtyard` 2.6 s,
  `madrasa` 2.6 s, `cistern` 5.5 s (60 ms pre-delay), `minaret` 3.5 s, `open` 0.8 s, `menu` 2.6 s.
- Output: glue compressor (−16 dB, 3.5:1), limiter (−4 dB, 20:1), then a soft clip with a −1 dBFS ceiling.
  "Reduced dynamic range" lowers the glue threshold to −32 dB at 7:1 with make-up gain; "mono" folds
  the output to one channel.
- Visibility: with "mute in background" the master goes silent while the page is hidden. iOS
  "interrupted" or platform-suspended contexts resume on the next pointer, touch or key event, and when the
  game unpauses; never while the game is paused or after the game suspended the context itself.
- Voices: at most 32 transient sounds at once, each on a pre-built strip (filter → envelope → panner);
  only the sources are new. Priorities: ui 3 > music 2 > sfx 1 > ambience 0. A full pool steals a voice of
  equal or lower priority, the lowest priority first and then the one nearest its end. A steal is a real
  12 ms fade: the stolen strip keeps its filter, pan and bus and ramps out while the new note starts at once
  on one of 8 spare strips (a burst that outruns the spares drops the new note instead of cutting).
  Music may hold at most 24 voices and steals from itself beyond that, so effects and menu sounds always
  find one. A qanun tremolo (up to 12 re-plucks) is one voice. Karplus–Strong strings are rendered once per
  (pitch, brightness) and cached (up to 96 buffers, oldest evicted first).

## API (`new Audio()`)

| Call | Meaning |
|---|---|
| `start(ctx?)` | Inside a user gesture. An `OfflineAudioContext` may be passed (tests). |
| `play(name, x, data)` | A named sound at world x (panned and attenuated against the listener). Unknown names are ignored. |
| `update(dt, mix)` | Per frame. `mix = {crateSpeed, hum, tension, height, birds, chase, finale, zone, music: {state, intensity}, loops: {name: level \| {level, x, degree}}, drummer, drummerX}`. |
| `finale()` | The chapter's finale (I: the D-hijaz melody over the pad; IV: the ensemble cadence → Ajam → answered light). |
| `fadeIn(sec)`, `fadeOut(sec)`, `muted` | Kept. |
| `setPaused(p)` | Duck and filter the game buses (the ui bus keeps playing). |
| `setVolumes({master, music, sfx \| effects, amb \| ambience, ui, mono, reducedRange, muteInBackground})` | 0–10, perceptual (gain = (v/10)²). Stored until `start`. |
| `setMuted(on)` | Same as `muted = on`: acts on the user master, so fades never undo it. |
| `setChapter(audio, chapter?)` | `audio = {theme, verb?, zones?}`, `chapter` = the chapter definition. See the schema below. |
| `setZone(zone \| verbName \| null)` | Force a place over the chapter zone under the listener (fields of an object override the zone's); `mix.zone` does the same per frame; `null` clears it. |
| `ui(name)` | `hover, confirm, back, slider ({value}), toggle ({on}), card, open, close`. |
| `stinger(name, data)` | `checkpoint, lockOpen ({degree}), ropeSnap, dazzle, chapterEnd, answeredLight, catch`. |
| `setListener(x)`, `stats` | Listener x; voices, steals, music state, reverb, context state. |

Music states (`mix.music.state`): `silent`, `explore`, `tension`, `chase`, `clock` (Chapter II's sunset
clock; `intensity` 0–1 pushes the tempo 70 → 96 bpm), `credits`, `finale`. Precedence: an explicit
`mix.music.state`, then the game's `finale` and `chase` flags, then the zone's `music`, then `explore`.
`update` never throws: non-finite numbers in the mix or the zones are ignored.

### Chapter schema (`setChapter(def.audio, def)`)

| Field | Values |
|---|---|
| `theme` | A chapter id (`souk, sundown, night, dawn, lab`), `menu` or `credits`; or a maqam name (`hijaz, bayati, saba, rast`), which keeps the theme of `def.id` and sets that maqam. |
| `verb` | The chapter's default reverb place. |
| `zones[]` | `{x0, x1, verb, amb, music, tension, hum, drips}`; without zones the souk has its defaults (alleys 1.2 s, the courtyard and the finale square 2.6 s). |
| `zones[].verb` | `alley, souk, courtyard, madrasa, cistern, minaret, open` (`menu` for the title). |
| `zones[].amb` | A number (bed level, 1 = as is); a place that colours the chapter's bed (`alley, souk, courtyard, madrasa, cistern, minaret, open, roof`: the cistern kills the wind and adds drips, the courtyard halves the murmur…); or another theme's bed (`night`, `dawn`…). |
| `zones[].music` | A music state, or `none` (silent), `stealth` (tension), `souk` (explore); anything else is ignored. |
| `zones[].tension, hum, drips` | Numbers, used when the mix gives none. |

## Music

A look-ahead scheduler (`Music`): a 25 ms timer schedules everything that falls in the next 120 ms on
the audio clock, so onsets are sample-accurate whatever the frame rate; offline renders drive `tick()`.
Instruments: oud (Karplus–Strong), qanun (bright KS, tremolo on long notes), ney (bandpassed breath +
vibrato sine), darbuka / bendir (doum, tek, ka), singing bowl (partials 1, 2.76, 5.4), the drone pad.
Every chapter sits on D (`maqam.js`): Hijaz (menu, I), Bayati (II), Saba (III), Rast → Ajam (IV). The
drone pad is tonic, fifth and a beating unison; at night it keeps to tonic and octave (Saba's colour is in
its melody, and a detuned fifth would clash with the ney's A).

| Context | Music | Ambience |
|---|---|---|
| menu | oud taqsim in Hijaz; the ney leitmotif from the Chapter I finale melody | wind |
| I souk | drone; the oud and darbuka chase pulse; the D-hijaz finale | murmur, birds |
| II sundown | qanun ostinato and ney phrases; the clock pushes the tempo; the catch is a qanun swell | coppersmiths' tuned hammering, trickling vats, swifts |
| III night | sparse low drone, far ney; chase: maqsum at 120 bpm with oud | crickets, distant formant dogs, drips; tripwires hum at ~3.1 kHz until broken |
| IV dawn | ney solo; finale cadence resolving to Ajam, then the D–A–D–F♯ answered-light chord | wind whistling on the walls, the drummer, a bird chorus whose density follows `mix.birds` |
| credits | Chapter I's melody in Rast with qanun and ney | birds, wind |

**Light makes music**: `play('lockCharge', x, {level, degree})` (loop) tunes a bowl to that degree of the
chapter's maqam; `play('lockOpen', x, {degree})` strikes it and plays a stinger on the same degree.

## Names (`SFX_NAMES`, `STINGERS`, `UI_SOUNDS`)

Chapter I: `step ({surface, speed}), guardStep, jump, land ({speed, hard}), grab, climbUp, vine,
crateImpact, plateDown, plateUp, gateStart, bridgeStart, gateStop, gateSlam, bridgeSlam, grip, lever,
ladder, alarm, dart, shout, guardVault, guardFrustrated, grabbed, death, crawl, wings`.

Full game (§9.4): `mirrorGrip, notch ({notch}), mirrorRoll*, crank, capstan*, lockCharge*, lockOpen,
boltShut, ropeSmoulder*, ropeSnap, counterweight, dazzle, fixate, turret, dartGuard, guardStun,
guardSleep, tripHum*, plankCreak, plankFall, dyeSplash, lift*, liftStop, hatch, trayPick, trayInsert,
sunsetTick ({urgency}), lampsOn / lampsOff ({count, sec}), answeredLight`.
Loops (*) keep sounding while poked every frame through `play` (0.25 s hold) or `mix.loops`.

Music ducks under `death` and `alarm`.

## Tests (`tools/audio-tests.mjs`)

```
node tools/audio-tests.mjs --port 5174 [--sec 20] [--only themes,jitter,...]
```

`themes` (20 s of every theme with a scripted game mix: no NaN, peak ≤ −1 dBFS, RMS −30…−14 dBFS),
`jitter` (real-time context under a 4× CPU throttle with 8 ms of main-thread work per frame: onsets found
by an AudioWorklet are within 5 ms of their schedule), `muteFadeIn`, `uiWhilePaused`, `voiceCap` (200
rapid steps), `allNames` (every sfx, loop, stinger, ui sound and the finale), `voiceBudget` (the catch over
the sunset clock, a lock opening, the answered light, the dawn finale, and the dawn finale with a footstep
every 0.3 s: no steal, no drop, and the same peak as with a 512-voice pool), `stealFade` (a stolen sustained
note leaves no step in the waveform and is silent 50 ms later), `schema` (the foundation's chapter blocks:
maqam-named themes, place and bed names, unknown music names, null zones, frozen mix objects; Chapter I's
chase keeps its 0.21 s pulse), `resumeGuard` (a real context: the gesture resume leaves a paused game and a
context the game suspended alone; unpausing resumes one the platform suspended), `ksCache`.

Last run (SwiftShader container, 4 CPUs): every test passes. `voiceBudget`, `stealFade`, `schema` and
`resumeGuard` fail on the previous engine (`7a0f8e4`): the answered light lost 23 voices and peaked at
−12.4 dBFS instead of −4.2, a steal stepped the waveform by 0.26, the foundation's souk block threw a
non-finite `setTargetAtTime` on every update, and a key press resumed a context the paused game had suspended.

| Test | Result |
|---|---|
| themes (20 s each) | no NaN; peak / RMS dBFS: menu −7.6 / −27.8, souk −2.0 / −20.7, sundown −1.9 / −23.8, night −1.7 / −21.8, dawn −1.9 / −21.1, credits −3.7 / −26.0 |
| jitter (4× throttle) | 57 of 57 onsets found, none late, onset spread 0.14 ms (constant output latency 12 ms) |
| muteFadeIn | −104 dBFS RMS after `fadeIn` while muted |
| uiWhilePaused | ui confirm −40 dBFS over a −87 dBFS floor; the game mix drops from −26 to −41 dBFS when paused |
| voiceCap | 200 steps at once: at most 32 sounding voices (8 fading steals, the rest of the burst dropped) |
| allNames | 81 names, no failures, peak −1.6 dBFS |
| voiceBudget | catch over the 96 bpm clock, lock opening, answered light, dawn finale, dawn finale + 104 footstep voices: 0 steals, 0 drops, peaks equal to a 512-voice pool (−3.27, −7.81, −4.21, −1.85, −1.78 dBFS) |
| stealFade | largest sample step at the steal 0.011 (the sine's own: 0.011; a hard cut: 0.26); −64 dBFS 60 ms later |
| schema | souk / sundown / night / dawn / lab blocks: themes resolve to the chapter, maqams hijaz / bayati / saba / rast / hijaz, no error, chase state reached; the souk chase keeps its 0.21 s pulse |
| resumeGuard | stays suspended after the game suspends it and while paused; resumes on unpause and on a gesture |
| ksCache | 40 notes of one pitch → 1 buffer |
