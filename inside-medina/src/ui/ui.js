// Minimal, Inside-like interface: almost nothing on screen during play.
// The chapter card and the credits are small stubs behind game.hooks; the
// shell package replaces them with the full screens.
const GLYPHS = {
  sunHigh: '<circle cx="50" cy="44" r="13"/><path d="M50 18v-8M50 78v-8M24 44h-8M84 44h-8M31.6 25.6l-5.7-5.7M74.1 68.1l-5.7-5.7M31.6 62.4l-5.7 5.7M74.1 19.9l-5.7 5.7"/><path d="M12 88h76"/>',
  sunHorizon: '<path d="M30 70a20 20 0 0 1 40 0"/><path d="M12 70h76M22 80h56M34 90h32"/><path d="M50 40v-10M30 50l-6-6M70 50l6-6"/>',
  crescent: '<path d="M62 18a32 32 0 1 0 0 64a26 26 0 1 1 0-64z"/><circle cx="76" cy="30" r="1.6"/><circle cx="82" cy="52" r="1.2"/>',
  sunRise: '<path d="M32 70a18 18 0 0 1 36 0"/><path d="M10 70h80"/><path d="M14 70v-16h10v-8h10v8h32v-8h10v8h10v16"/><path d="M50 36v-12M34 42l-7-7M66 42l7-7"/>',
  rosette: '<path d="M50 14l9 22 22-9-9 22 22 9-22 9 9 22-22-9-9 22-9-22-22 9 9-22-22-9 22-9-9-22 22 9z"/><circle cx="50" cy="50" r="10"/>',
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class UI {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="loading"><div class="lt">MEDINA</div><div class="lbar"><i></i></div><div class="lmsg">weaving the alleys…</div></div>
      <div id="title" class="hidden"><div class="t1">MEDINA</div><div class="t2">a short walk into the light</div><div class="t3">press any key or click</div></div>
      <div id="hint" class="hidden"></div>
      <div id="pause" class="hidden">
        <div class="pbox">
          <div class="pt">paused</div>
          <button data-a="resume">resume</button>
          <button data-a="checkpoint">restart from checkpoint</button>
          <button data-a="restart">restart chapter</button>
          <button data-a="title">title</button>
          <button data-a="quality">quality: <span class="q"></span></button>
          <button data-a="mute">sound: <span class="m">on</span></button>
          <button data-a="assets">asset sheet</button>
          <div class="keys"></div>
        </div>
      </div>
      <div id="card" class="hidden" aria-hidden="true"><svg class="cg" viewBox="0 0 100 100" aria-hidden="true"></svg><div class="cn"></div><div class="cl"></div></div>
      <div id="end" class="hidden"><div class="e1">MEDINA</div><div class="e2">thank you for walking with us</div><div class="e3"></div><button data-a="again">walk again</button><button data-a="assets">see how it was built</button></div>
      <div id="dbg" class="hidden"></div>`;
    this.el = (id) => root.querySelector('#' + id);
    this.handlers = {};
    root.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => this.handlers[b.dataset.a] && this.handlers[b.dataset.a]()));
    this.hintTimer = 0;
  }
  on(a, fn) { this.handlers[a] = fn; }
  progress(p, msg) { this.el('loading').querySelector('i').style.width = `${Math.round(p * 100)}%`; if (msg) this.el('loading').querySelector('.lmsg').textContent = msg; }
  hideLoading() { const l = this.el('loading'); l.classList.add('fade'); setTimeout(() => l.remove(), 1500); }
  showTitle(on) { this.el('title').classList.toggle('hidden', !on); }
  titleOpacity(a) { this.el('title').style.opacity = a; }
  keysHtml(device, labels) {
    if (device === 'gamepad') return '<b>stick</b> move &nbsp; <b>A</b> jump &nbsp; <b>X / RT</b> grab (hold) &nbsp; <b>start</b> pause';
    if (device === 'touch') return 'left pad: move / climb / crawl &nbsp; ⤒ jump &nbsp; ✋ grab (hold)';
    const k = labels ? { m: `${labels.left} ${labels.right} / `, u: `${labels.up} / `, d: `${labels.down} / ` } : { m: '', u: '', d: '' };
    return `<b>${k.m}← →</b> move &nbsp; <b>${k.u}↑</b> climb &nbsp; <b>${k.d}↓</b> crawl &nbsp; <b>space</b> jump &nbsp; <b>shift</b> grab (hold) &nbsp; <b>esc</b> pause`;
  }
  showHint(device, sec = 7, labels = null) { const h = this.el('hint'); h.innerHTML = this.keysHtml(device, labels); h.classList.remove('hidden'); this.hintTimer = sec; }
  hideHint() { this.el('hint').classList.add('hidden'); this.hintTimer = 0; }
  update(dt) { if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.el('hint').classList.add('hidden'); } }
  showPause(on, device, quality, muted, labels = null) {
    this.el('pause').classList.toggle('hidden', !on);
    if (on) { this.el('pause').querySelector('.keys').innerHTML = this.keysHtml(device, labels); this.el('pause').querySelector('.q').textContent = quality; this.el('pause').querySelector('.m').textContent = muted ? 'off' : 'on'; }
  }
  showEnd(on) { this.el('end').classList.toggle('hidden', !on); }
  debug(text) { const d = this.el('dbg'); d.classList.remove('hidden'); d.textContent = text; }

  // chapter card (game.hooks.card): resolves once the card covers the screen;
  // hide() keeps it up at least 2.5 s, then fades it out
  async card(m, { minSec = 2.5 } = {}) {
    const c = this.el('card');
    c.style.setProperty('--tone', m.tone || '#20140c');
    c.querySelector('.cn').textContent = m.numeral || '';
    c.querySelector('.cl').textContent = m.label || '';
    c.querySelector('.cg').innerHTML = GLYPHS[m.glyph] || GLYPHS.rosette;
    c.classList.remove('out'); c.classList.add('draw');
    c.classList.remove('hidden');
    const shown = performance.now();
    await wait(650);
    return {
      hide: async () => {
        const left = minSec * 1000 - (performance.now() - shown);
        if (left > 0) await wait(left);
        c.classList.add('out'); c.classList.add('hidden');
        await wait(900);
        c.classList.remove('draw', 'out');
      },
    };
  }

  // credits (game.hooks.credits): the lines over the end screen; resolves on "walk again" or after a while
  credits(lines) {
    const e = this.el('end');
    e.querySelector('.e3').innerHTML = lines.map((l) => `<div>${String(l).replace(/[<>&]/g, '')}</div>`).join('');
    this.showEnd(true);
    return new Promise((res) => {
      const done = () => { clearTimeout(t); this.handlers.again = prev; this.showEnd(false); res(); };
      const prev = this.handlers.again;
      this.handlers.again = done;
      const t = setTimeout(done, 12000 + lines.length * 1500);
    });
  }
}
