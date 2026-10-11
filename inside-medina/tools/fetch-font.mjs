// Vendor Cormorant Garamond (SIL Open Font License 1.1, Christian Thalmann) as WOFF2 latin subsets:
// node tools/fetch-font.mjs  →  src/ui/fonts/*.woff2 and src/ui/fonts.css (the @font-face rules style.css imports).
// The hosted build serves them with hashed names (the service worker caches them, so the city reads offline);
// the artifact build inlines them as data URIs. If the fetch fails, the vendored files and fonts.css are left as
// they were (the page loads no remote font: without the files the type falls back to Georgia).
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'src/ui/fonts');
const FAMILY = 'Cormorant Garamond';
const URL_CSS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,500;1,400&display=swap';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const res = await fetch(URL_CSS, { headers: { 'user-agent': UA } }).catch((e) => ({ ok: false, statusText: e.message }));
if (!res.ok) { console.log(`fetch-font: could not fetch the stylesheet (${res.status || ''} ${res.statusText}); keeping the vendored files`); process.exit(0); }
const css = await res.text();
// the latin block of each face
const faces = [...css.matchAll(/\/\* latin \*\/\s*@font-face\s*{([^}]*)}/g)].map((m) => {
  const b = m[1];
  return { style: /font-style:\s*(\w+)/.exec(b)[1], weight: /font-weight:\s*(\d+)/.exec(b)[1], url: /url\(([^)]+)\)/.exec(b)[1], range: /unicode-range:\s*([^;]+);/.exec(b)[1] };
});
if (!faces.length) { console.log('fetch-font: no latin faces in the stylesheet'); process.exit(0); }
fs.mkdirSync(OUT, { recursive: true });
// a variable font serves several weights from one file: one rule with a weight range
const byUrl = new Map();
for (const f of faces) { const g = byUrl.get(f.url); if (g) g.weights.push(+f.weight); else byUrl.set(f.url, { ...f, weights: [+f.weight] }); }
for (const old of fs.readdirSync(OUT)) if (old.endsWith('.woff2')) fs.unlinkSync(path.join(OUT, old));
const rules = [];
for (const f of byUrl.values()) {
  const lo = Math.min(...f.weights), hi = Math.max(...f.weights);
  const name = `cormorant-${f.style === 'italic' ? 'italic' : 'roman'}${lo === hi ? `-${lo}` : ''}.woff2`;
  const r = await fetch(f.url, { headers: { 'user-agent': UA } });
  if (!r.ok) { console.log(`fetch-font: ${f.url} → ${r.status}`); process.exit(0); }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`${name} ${(buf.length / 1024).toFixed(1)} KB (weights ${lo === hi ? lo : `${lo}–${hi}`})`);
  rules.push(`@font-face { font-family: '${FAMILY}'; font-style: ${f.style}; font-weight: ${lo === hi ? lo : `${lo} ${hi}`}; font-display: swap; src: url('./fonts/${name}') format('woff2'); unicode-range: ${f.range}; }`);
}
fs.writeFileSync(path.join(ROOT, 'src/ui/fonts.css'), `/* ${FAMILY} (latin), SIL Open Font License 1.1, © Christian Thalmann. Vendored by tools/fetch-font.mjs */\n${rules.join('\n')}\n`);
console.log(`fetch-font: ${faces.length} faces → src/ui/fonts.css`);
