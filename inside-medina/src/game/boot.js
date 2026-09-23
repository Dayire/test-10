import { createWorld } from '../render/world.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { UI } from '../ui/ui.js';
import { Game } from './game.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export async function boot(canvas, params) {
  const ui = new UI(document.getElementById('ui'));
  const P = Object.fromEntries(params.entries());
  const tier = P.tier || (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
  ui.progress(0.05, 'mixing the plaster…');
  await nextFrame();
  const world = createWorld(canvas, { tier, texScale: +(P.tex || 1), onProgress: (p, n) => ui.progress(0.05 + p * 0.45) });
  if (P.noauto) world.rs.autoQuality = false;
  ui.progress(0.5, 'raising walls…');
  await nextFrame();
  const input = new Input();
  const audio = new Audio();
  const game = new Game(world, input, audio, ui, P);
  game.init((p, msg) => ui.progress(0.5 + p * 0.45, msg));
  ui.progress(0.97, 'lighting the lanterns…');
  await nextFrame();
  // shader warm-up: compile everything before the first visible frame
  world.rs.renderer.compile(world.scene, game.camera);
  game.render(0.016, 0);
  await nextFrame();
  ui.hideLoading();
  if (!P.autostart) ui.showTitle(true); else game.beginPlay();
  ui.on('resume', () => game.setPaused(false));
  ui.on('checkpoint', () => { game.setPaused(false); game.player.die('restart'); game.dieT = 1.6; });
  ui.on('restart', () => { game.setPaused(false); game.restartLevel(); });
  ui.on('quality', () => { const order = ['low', 'medium', 'high', 'ultra']; const i = order.indexOf(world.rs.tier); world.rs.autoQuality = false; world.rs.setTier(order[(i + 1) % order.length]); ui.showPause(true, input.lastDevice, world.rs.tier, audio.muted); });
  ui.on('mute', () => { audio.muted = !audio.muted; if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.9; ui.showPause(true, input.lastDevice, world.rs.tier, audio.muted); });
  ui.on('again', () => { game.restartLevel(); audio.fadeIn(2); });
  canvas.addEventListener('pointerdown', () => { if (game.mode === 'intro') game.beginPlay(); canvas.focus(); });
  let last = performance.now();
  window.__ready = true;
  const loop = (now) => {
    const dt = (now - last) / 1000; last = now;
    world.rs.trackFrame(dt * 1000);
    game.frame(dt);
    window.__frames = (window.__frames || 0) + 1;
    if (P.debug) ui.debug(debugText(game, world));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__info = () => ({ tier: world.rs.tier, calls: world.rs.renderer.info.render.calls, tris: world.rs.renderer.info.render.triangles, geos: world.rs.renderer.info.memory.geometries, tex: world.rs.renderer.info.memory.textures, state: window.__medina.state() });
}

function debugText(game, world) {
  const s = window.__medina.state();
  const i = world.rs.renderer.info.render;
  return `x ${s.x} y ${s.y} ${s.st}${s.crawl ? '/crawl' : ''} cp ${s.cp} mode ${s.mode}\ncalls ${i.calls} tris ${(i.triangles / 1000).toFixed(0)}k tier ${world.rs.tier}\nbeam ${s.beam} guard ${s.guard} ${s.gx}`;
}
