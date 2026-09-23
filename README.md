# Medina

A one-level, Inside-style puzzle platformer set in a sun-bleached Moroccan/Andalusian medina. It runs in the browser with Three.js.
A small boy in a red tunic crosses a souk, rooftops, a watchman's courtyard, a ravine and a chase, then walks through a great pointed arch into the light.

The game lives in [`inside-medina/`](inside-medina/).

```bash
cd inside-medina
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # static build in dist/
```

Controls: **A/D** or **←/→** to move, **W/S** to climb and crawl, **Space** to jump, hold **Shift** to grab, **Esc** to pause. Gamepad and touch are supported.

Useful URL flags: `?cp=3` starts at a checkpoint (0–6), `?tier=low|medium|high|ultra` sets quality, and `?debug=1` shows an overlay.

## What's inside

- **3D assets.** Everything is procedural: architecture, props, ivy, both characters, and GPU-baked PBR textures.
- **Swappable models.** Any asset can be replaced by a GLB listed in `public/assets/models/manifest.json`, such as models made by Codex Astra. See [`docs/ASTRA_ASSET_BRIEF.md`](inside-medina/docs/ASTRA_ASSET_BRIEF.md).
- **Rendering.** Sun shadows, sky-driven image-based lighting, height fog with sun in-scatter, and volumetric sun shafts. Also bloom, depth of field, god rays, and an ACES filmic grade with adaptive quality tiers.
- **Mechanics.** Mantle and hang-climb ledges, push and pull crates, ivy and ladders, a lever, and a pressure-plated drawbridge. There is also searchlight stealth with real shadow cover, a guard chase and crawl spaces, plus checkpoints and instant respawn.
- **Sound.** Fully procedural WebAudio: ambience, foley and an oud finale.
- **Tests.** A headless bot plays the whole level (`node tools/playtest.mjs`), and failure paths have their own suite (`node tools/negative.mjs`).

Design notes: [`docs/ART_DIRECTION.md`](inside-medina/docs/ART_DIRECTION.md) and [`docs/DESIGN.md`](inside-medina/docs/DESIGN.md).
