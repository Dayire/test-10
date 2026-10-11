// Fold the artifact build into one page (FULL_GAME §8.7): dist-artifact/medina.html holds the splash, every CSS
// rule (fonts as data URIs) and the whole game module inline; nothing is fetched but the page itself. The host
// supplies <html>/<head>/<body>, so medina.html is a fragment; test.html wraps it the way the host
// does, for local runs (tools/ux-tests.mjs loads it inside a sandboxed iframe).
import fs from 'fs';
import path from 'path';

const dist = path.resolve(process.argv[2] || 'dist-artifact');
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.\//, '')), 'utf8');
const between = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); return i < 0 || j < 0 ? '' : s.slice(i + a.length, j); };
const head = between(html, '<head>', '</head>'), body = between(html, '<body>', '</body>');
// the inline splash style, then every stylesheet the build linked
const styles = [...head.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
for (const m of head.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) styles.push(read(m[1]));
for (const m of body.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)) styles.push(read(m[1]));
// anything the CSS still links (a font the page also preloads is emitted as a file) becomes a data URI
const MIME = { woff2: 'font/woff2', woff: 'font/woff', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' };
const css = styles.join('\n').replace(/url\((['"]?)\.\/([^'")]+\.(woff2|woff|png|jpg|svg))\1\)/g, (all, q, f, ext) => {
  const file = path.join(dist, f);
  return fs.existsSync(file) ? `url(data:${MIME[ext]};base64,${fs.readFileSync(file).toString('base64')})` : all;
});
// the module: inline, with every closing-tag sequence escaped so the HTML parser never ends the script early
const src = /<script[^>]+type="module"[^>]+src="([^"]+)"/.exec(html)?.[1] || './game.js';
const js = read(src).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\u0021--');
const metas = [...head.matchAll(/<meta (?:name="(?:viewport|theme-color|color-scheme|description)")[^>]*>/g)].map((m) => m[0]).join('\n');
const markup = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '').trim();
const page = `<title>Medina</title>
${metas}
<style>
${css}
</style>
${markup}
<script type="module">
${js}
</script>
`;
fs.writeFileSync(path.join(dist, 'medina.html'), page);
// local test page: the host skeleton around the fragment
fs.writeFileSync(path.join(dist, 'test.html'), `<!doctype html><html><head><meta charset="utf-8"></head><body>\n${page}</body></html>\n`);
const mb = (f) => fs.statSync(path.join(dist, f)).size / 1048576;
const size = mb('medina.html');
console.log(`artifact medina.html ${size.toFixed(2)} MB (game module ${mb(src.replace(/^\.\//, '')).toFixed(2)} MB)${size > 3 ? '  OVER the 3 MB target' : ''}`);
if (/serviceWorker\.register/.test(js)) console.log('warning: the artifact module still registers a service worker');
