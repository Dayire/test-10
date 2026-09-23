# Codex Astra asset brief

The request was to have **Codex Astra** build the 3D assets and co-author the mood board.
From this cloud session Codex could not reach OpenAI, so every asset in the game is procedural (built in code) for now.
The game is ready to swap any of them for Astra-made models with no code change.

## What happened

- `@openai/codex` 0.154.0 installed and started. Its default model is `gpt-6-astra`.
- Every request to `api.openai.com`, `auth.openai.com` and `chatgpt.com` was refused by the environment's network policy (HTTP 403 on CONNECT).
- No OpenAI credentials are configured in the environment (`codex login status` reports "Not logged in").
- So no Astra output exists in this repository. Nothing here should be read as coming from Astra.

## How to run it

1. Allow `api.openai.com` (plus `auth.openai.com` and `chatgpt.com` if you log in with ChatGPT) in the environment's network settings, or run locally.
2. Provide a key: `printenv OPENAI_API_KEY | npx @openai/codex login --with-api-key`.
3. Confirm Astra is the model answering before generating anything:

```bash
npx @openai/codex exec -m gpt-6-astra --skip-git-repo-check \
  "Before anything else, state the exact model name you are running as."
```

4. Run `node tools/astra-assets.mjs`. It stops unless the model answering names itself Astra. It then generates every asset with the prompt template below, validates each `.glb` and adds it to the manifest. Pass asset names to generate only some.
5. Or do it by hand: write `.glb` files into `public/assets/models/`, list them in `public/assets/models/manifest.json` and reload the game:

```json
{ "models": [ { "name": "barrel", "file": "barrel.glb" }, { "name": "lantern", "file": "lantern.glb" } ] }
```

Optional per-entry fields: `scale`, `rotationY`, `offset: [x, y, z]`.

## Asset contract

| Rule | Value |
| --- | --- |
| Format | glTF binary (`.glb`), one asset per file |
| Units / axes | metres, +Y up, the front faces +Z |
| Pivot | centre of the base, at y = 0 |
| Materials | PBR metal/rough, baseColor + normal + ORM, textures ≤ 2048 px |
| Budget | props ≤ 8k triangles, crate / cart ≤ 12k, dome ≤ 30k |
| Look | see `docs/ART_DIRECTION.md`: worn, sun-bleached, hand-made; no pristine CG edges |

| name | size (m) | notes |
| --- | --- | --- |
| `crate` | 1.0 × 1.0 × 1.0 | pushable market crate, planks + edge beams + diagonal brace; physics box stays 1 m |
| `barrel` | Ø 0.60, h 0.86 | oak staves, three iron hoops |
| `pot_amphora` | Ø 0.48, h 0.83 | terracotta, salt bloom near the rim |
| `pot_jar` | Ø 0.46, h 0.50 | terracotta storage jar |
| `pot_tall` | Ø 0.40, h 1.00 | tall slender jar |
| `pot_planter` | Ø 0.54, h 0.36 | wide planter (plants are added by the game) |
| `pot_bowl` | Ø 0.40, h 0.15 | shallow bowl |
| `rug_roll` | Ø 0.32, length 1.70 along +Y | rolled Persian rug, visible spiral end |
| `sack` | 0.55 × 0.60 × 0.45 | burlap sack with a tied neck |
| `basket` | Ø 0.52, h 0.30 | woven palm basket |
| `cart` | 2.4 (x) × 1.2 (z) × 1.0 | two wheels Ø 0.84, shafts toward +x |
| `stool` | Ø 0.40, h 0.45 | three-legged wooden stool |
| `lantern` | Ø 0.20, h 0.46 | brass Moroccan lantern, 8 glass panes, hanging ring at y = 0.46; name the glass material `glass` |
| `dome` | base Ø 10, h ≈ 9 | drum with pointed windows + green-gold glazed onion dome, scaled by the game |
| `finial` | h 2.2 | gilded jamour finial (stacked spheres) |

Characters (`boy`, `guard`) are driven by the procedural animator. A replacement must be rigged with these bone names: `pelvis, spine, chest, neck, head, shoulderL/R, elbowL/R, wristL/R, hipL/R, kneeL/R, ankleL/R, skirt`.

## Blockouts to match

`npm run assets` (with `npm run dev` running) exports every swappable asset as a GLB blockout to `exports/`. Each one has the exact size and pivot the game uses, with flat colours. Give Astra the blockout alongside the prompt so its model drops in without rescaling.

| asset | exported size (x × y × z, m) | triangles |
| --- | --- | --- |
| crate | 1.00 × 1.00 × 1.05 | 1380 |
| lantern | 0.20 × 0.49 × 0.20 | 448 |
| barrel | 0.63 × 0.86 × 0.63 | 1812 |
| pot_amphora | 0.48 × 0.83 × 0.48 | 528 |
| pot_jar | 0.46 × 0.50 × 0.46 | 384 |
| pot_tall | 0.40 × 1.00 × 0.40 | 432 |
| pot_planter | 0.54 × 0.36 × 0.54 | 288 |
| pot_bowl | 0.40 × 0.15 × 0.40 | 240 |
| rug_roll | 0.32 × 1.70 × 0.32 | 60 |
| sack | 0.56 × 0.63 × 0.46 | 648 |
| basket | 0.56 × 0.31 × 0.56 | 240 |
| cart (with shafts and load) | 4.04 × 1.39 × 1.56 | 2744 |
| stool | 0.39 × 0.49 × 0.40 | 128 |
| dome (r = 5) | 11.06 × 12.12 × 11.06 | 5736 |
| finial | 0.48 × 2.20 × 0.48 | 760 |

## Prompt template

```text
You are Codex running gpt-6-astra. Create a production-quality 3D asset as a single .glb:
<name>: <description from the table>. Real-world size <size>. Metres, +Y up, front +Z,
pivot at the centre of the base (y=0). PBR metal/rough with baseColor, normal and ORM
textures (≤2048px). Style: a sun-bleached Moroccan/Andalusian medina at golden hour
(reference palette: powder-blue plaster #76a0bb peeling to ochre #9d734c, limestone
#d0cbc4, terracotta, brass, red/cream Cordoba voussoirs). Worn, hand-made, chipped
edges, grime near the ground. ≤ <budget> triangles. Write it to public/assets/models/<name>.glb
and print the triangle count and bounding box.
```

## Judging Astra versus procedural

Load the game once without overrides and once with the manifest filled, then compare the same shots.
`node tools/tour.mjs <dir> "autostart=1" A:5:0 C:97:0 D:126:4.3` captures them.
Keep the Astra version when it reads better at gameplay distance, stays inside the palette, and doesn't break the frame rate.
