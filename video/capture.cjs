// Frame-by-frame capture harness for the browser demos: the page exposes window.render(t); we step t deterministically.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const [,, html, outdir, mode = 'canvas'] = process.argv; const W = 1280, H = 720, FPS = 30, N = 150;
(async () => {
  fs.mkdirSync(path.join(outdir, 'frames'), { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', e => { console.error('PAGE ERROR', e.message); process.exitCode = 1; });
  await p.goto('file://' + path.resolve(html)); await p.waitForFunction(() => typeof window.render === 'function'); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
  for (let i = 0; i < N; i++) {
    const t = i / FPS;
    await p.evaluate(t => window.render(t), t);
    if (mode === 'canvas') {  // read the canvas pixels directly — exact, no compositor involved
      const url = await p.evaluate(() => document.querySelector('canvas').toDataURL('image/png'));
      fs.writeFileSync(path.join(outdir, 'frames', String(i).padStart(4, '0') + '.png'), Buffer.from(url.split(',')[1], 'base64'));
    } else await p.screenshot({ path: path.join(outdir, 'frames', String(i).padStart(4, '0') + '.png') });
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(outdir, 'frames', '%04d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(outdir, 'out.mp4')]);
  console.log('encoded', path.join(outdir, 'out.mp4'));
})();
