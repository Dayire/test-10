// Generate the swappable 3D assets with Codex Astra and wire them into the game.
// Needs network access to api.openai.com and an OpenAI key (see docs/ASTRA_ASSET_BRIEF.md).
//   node tools/astra-assets.mjs            # all assets
//   node tools/astra-assets.mjs barrel sack # only some
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MODEL = process.env.ASTRA_MODEL || 'gpt-6-astra';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'public/assets/models');
const manifestPath = path.join(outDir, 'manifest.json');

const ASSETS = {
  crate: ['pushable wooden market crate: planks, edge beams, diagonal brace', '1.0 x 1.0 x 1.0 m', 12000],
  barrel: ['oak barrel with staves and three iron hoops', 'diameter 0.60 m, height 0.86 m', 8000],
  pot_amphora: ['terracotta amphora with salt bloom near the rim', 'diameter 0.48 m, height 0.83 m', 8000],
  pot_jar: ['terracotta storage jar', 'diameter 0.46 m, height 0.50 m', 8000],
  pot_tall: ['tall slender terracotta jar', 'diameter 0.40 m, height 1.00 m', 8000],
  pot_planter: ['wide terracotta planter, no plant', 'diameter 0.54 m, height 0.36 m', 8000],
  pot_bowl: ['shallow terracotta bowl', 'diameter 0.40 m, height 0.15 m', 8000],
  rug_roll: ['rolled Persian rug standing upright along +Y with a visible spiral end', 'diameter 0.32 m, length 1.70 m', 8000],
  sack: ['burlap sack with a tied neck', '0.55 x 0.60 x 0.45 m', 8000],
  basket: ['woven palm basket', 'diameter 0.52 m, height 0.30 m', 8000],
  cart: ['two-wheeled wooden market cart, wheels 0.84 m diameter, shafts toward +X', 'body 2.4 m (x) x 1.2 m (z) x 1.0 m', 12000],
  stool: ['three-legged wooden stool', 'diameter 0.40 m, height 0.45 m', 8000],
  lantern: ['brass Moroccan lantern with 8 glass panes (name the glass material "glass"), hanging ring at y = 0.46 m', 'diameter 0.20 m, height 0.46 m', 8000],
  dome: ['drum with pointed windows topped by a green-gold glazed onion dome', 'base diameter 10 m, height about 9 m', 30000],
  finial: ['gilded jamour finial of stacked spheres', 'height 2.2 m', 8000],
};

const codex = (args, timeout) => spawnSync('npx', ['-y', '@openai/codex', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, timeout });

// 1) prove Astra is the model answering
const check = codex(['exec', '-m', MODEL, '--skip-git-repo-check', 'State only the exact model name you are running as, nothing else.'], 90000);
const reply = `${check.stdout}\n${check.stderr}`;
if (check.status !== 0 || !/astra/i.test(reply.split('\n').slice(-6).join(' '))) {
  console.error('Codex Astra did not answer as expected. Output:\n' + reply.slice(-2000));
  console.error('Check network access to api.openai.com and your OpenAI key (docs/ASTRA_ASSET_BRIEF.md).');
  process.exit(1);
}
console.log('Astra verified:', reply.trim().split('\n').slice(-1)[0]);

// 2) generate each asset
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ASSETS);
const made = [];
for (const name of wanted) {
  const [desc, size, budget] = ASSETS[name] || [];
  if (!desc) { console.warn('unknown asset', name); continue; }
  const blockout = fs.existsSync(path.join(root, 'exports', `${name}.glb`)) ? ` Match the proportions of the blockout exports/${name}.glb.` : '';
  const prompt = `You are Codex running ${MODEL}. Create a production-quality 3D asset as a single binary glTF file at public/assets/models/${name}.glb:
${name}: ${desc}. Real-world size ${size}. Metres, +Y up, front faces +Z, pivot at the centre of the base (y = 0).
PBR metal/rough materials with baseColor, normal and ORM textures (at most 2048 px). Style: a sun-bleached Moroccan/Andalusian
medina at golden hour; palette: powder-blue plaster #76a0bb peeling to ochre #9d734c, limestone #d0cbc4, terracotta, brass,
red/cream Cordoba voussoirs. Worn, hand-made, chipped edges, grime near the ground. At most ${budget} triangles.${blockout}
You may write and run Node scripts using the "three" package in node_modules (GLTFExporter) or any tool available.
Finish by printing the triangle count and bounding box of the file you wrote.`;
  console.log(`\n== ${name}`);
  const r = codex(['exec', '-m', MODEL, '--full-auto', '--skip-git-repo-check', prompt], 30 * 60 * 1000);
  const file = path.join(outDir, `${name}.glb`);
  const ok = fs.existsSync(file) && fs.readFileSync(file).subarray(0, 4).toString() === 'glTF';
  console.log(ok ? `   wrote ${name}.glb (${(fs.statSync(file).size / 1024).toFixed(0)} KB)` : `   FAILED (${r.status})\n${(r.stdout + r.stderr).slice(-800)}`);
  if (ok) made.push(name);
}

// 3) wire into the game
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { models: [] };
for (const name of made) if (!manifest.models.find((m) => m.name === name)) manifest.models.push({ name, file: `${name}.glb` });
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\n${made.length}/${wanted.length} Astra assets in the manifest. Compare with: node tools/tour.mjs <dir> "autostart=1" A:5:0 C:97:0 D:126:4.3`);
