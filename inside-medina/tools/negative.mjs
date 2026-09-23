// Failure-path tests: the game must kill and respawn correctly.
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 320, height: 180 }, ignoreHTTPSErrors: true })).newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
async function fresh(cp) {
  await page.goto(`http://127.0.0.1:5173/?autostart=1&tex=0.1&tier=low&noauto=1&cp=${cp}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000 });
}
const results = [];
// 1. searchlight: run straight across the courtyard
await fresh(3);
results.push(['spotted by lamp', await page.evaluate(() => { const M = __medina; for (let i = 0; i < 1400; i++) { const s = M.sim(1 / 120, { x: 1 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, x: s.x }; } return { died: false, s: M.state() }; })]);
// respawn restores the checkpoint
results.push(['respawn after lamp', await page.evaluate(() => { const M = __medina; M.sim(3, { x: 0 }); return M.state(); })]);
// 2. chase: stop after triggering
await fresh(5);
results.push(['caught by guard', await page.evaluate(() => { const M = __medina; M.sim(1.0, { x: 1 }); for (let i = 0; i < 1200; i++) { const s = M.sim(1 / 120, { x: 0 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, gx: s.gx, x: s.x }; } return { died: false, s: M.state() }; })]);
results.push(['guard reset on respawn', await page.evaluate(() => { const M = __medina; M.sim(3, { x: 0 }); return { guard: M.state().guard, x: M.state().x }; })]);
// 3. ravine: walk into it without the bridge
await fresh(4);
results.push(['fall into ravine', await page.evaluate(() => { const M = __medina; M.teleport(135.5, 0); for (let i = 0; i < 1000; i++) { const s = M.sim(1 / 120, { x: 1 }); if (s.dead) return { died: true, kind: M.game.player.deathKind, y: s.y }; } return { died: false, s: M.state() }; })]);
// 4. plate alone lifts nothing; plate with crate lowers the bridge
results.push(['plate with boy only', await page.evaluate(() => { const M = __medina; M.sim(3, { x: 0 }); M.teleport(128.1, 0); M.sim(2, { x: 0 }); const s = M.state(); return { plate: s.plate, bridge: s.bridge }; })]);
// 5. crate falling on the boy kills
await fresh(4);
results.push(['crate crush', await page.evaluate(() => { const M = __medina, G = M.game; M.teleport(131.0, 0); G.level.crateB.setState({ x: 131.0, y: 4.3 }); G.level.crateB.body.vx = 0; G.level.crateB.body.y = 3.0; for (let i = 0; i < 300; i++) { const s = M.sim(1 / 120, { x: 0 }); if (s.dead) return { died: true, kind: G.player.deathKind }; } return { died: false }; })]);
for (const [n, r] of results) console.log(n.padEnd(24), JSON.stringify(r));
await browser.close();
