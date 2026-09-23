// Wrap the single-file build into an artifact page (the host supplies <html>/<head>/<body>).
import fs from 'fs';
import path from 'path';
const dist = path.resolve(process.argv[2] || 'dist-artifact');
const css = fs.readFileSync(path.resolve('src/ui/style.css'), 'utf8');
const page = `<title>Medina</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;500&display=swap">
<style>
${css}
</style>
<canvas id="c" tabindex="0" aria-label="Medina game view"></canvas>
<div id="ui"></div>
<script type="module" src="game.js"></script>
`;
fs.writeFileSync(path.join(dist, 'medina.html'), page);
fs.mkdirSync(path.join(dist, 'assets/models'), { recursive: true });
fs.writeFileSync(path.join(dist, 'assets/models/manifest.json'), '{ "models": [] }\n');
const kb = (f) => (fs.statSync(path.join(dist, f)).size / 1024).toFixed(0) + ' KB';
console.log('artifact page', kb('medina.html'), 'game.js', kb('game.js'));
