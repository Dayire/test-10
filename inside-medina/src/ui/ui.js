// Minimal, Inside-like interface: almost nothing on screen during play.
export class UI {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div id="loading"><div class="lt">MEDINA</div><div class="lbar"><i></i></div><div class="lmsg">weaving the alleys…</div></div>
      <div id="title" class="hidden"><div class="t1">MEDINA</div><div class="t2">a short walk into the light</div><div class="t3">press any key</div></div>
      <div id="hint" class="hidden"></div>
      <div id="pause" class="hidden">
        <div class="pbox">
          <div class="pt">paused</div>
          <button data-a="resume">resume</button>
          <button data-a="checkpoint">restart from checkpoint</button>
          <button data-a="restart">restart level</button>
          <button data-a="quality">quality: <span class="q"></span></button>
          <button data-a="mute">sound: <span class="m">on</span></button>
          <div class="keys"></div>
        </div>
      </div>
      <div id="end" class="hidden"><div class="e1">MEDINA</div><div class="e2">thank you for walking with us</div><button data-a="again">walk again</button></div>
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
  keysHtml(device) {
    if (device === 'gamepad') return '<b>stick</b> move &nbsp; <b>A</b> jump &nbsp; <b>X / RT</b> grab (hold) &nbsp; <b>start</b> pause';
    if (device === 'touch') return 'left pad: move / climb / crawl &nbsp; ⤒ jump &nbsp; ✋ grab (hold)';
    return '<b>A D / ← →</b> move &nbsp; <b>W / ↑</b> climb &nbsp; <b>S / ↓</b> crawl &nbsp; <b>space</b> jump &nbsp; <b>shift</b> grab (hold) &nbsp; <b>esc</b> pause';
  }
  showHint(device, sec = 7) { const h = this.el('hint'); h.innerHTML = this.keysHtml(device); h.classList.remove('hidden'); this.hintTimer = sec; }
  update(dt) { if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.el('hint').classList.add('hidden'); } }
  showPause(on, device, quality, muted) {
    this.el('pause').classList.toggle('hidden', !on);
    if (on) { this.el('pause').querySelector('.keys').innerHTML = this.keysHtml(device); this.el('pause').querySelector('.q').textContent = quality; this.el('pause').querySelector('.m').textContent = muted ? 'off' : 'on'; }
  }
  showEnd(on) { this.el('end').classList.toggle('hidden', !on); }
  debug(text) { const d = this.el('dbg'); d.classList.remove('hidden'); d.textContent = text; }
}
