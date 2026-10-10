// Every persistent read and write goes through here. localStorage can be
// missing, blocked (sandboxed frames, private modes) or throwing (quota,
// patched for tests); then values live in memory for the session and
// `available` is false so the UI can offer a save code instead.
const mem = new Map();
let ls = null;

export const storage = {
  available: false,
  disabled: false,
  init({ disabled = false } = {}) {
    this.disabled = disabled; ls = null; this.available = false;
    if (disabled) return this;
    try {
      const s = window.localStorage;
      const k = '__medina_probe';
      s.setItem(k, '1'); s.removeItem(k);
      ls = s; this.available = true;
    } catch { ls = null; }
    return this;
  },
  get(key) {
    if (ls) {
      try { const v = ls.getItem(key); if (v !== null) return v; } catch { this.available = false; }
    }
    return mem.has(key) ? mem.get(key) : null;
  },
  set(key, value) {
    const v = String(value);
    mem.set(key, v);
    if (!ls) return false;
    try { ls.setItem(key, v); return true; } catch { this.available = false; return false; }
  },
  remove(key) {
    mem.delete(key);
    if (ls) { try { ls.removeItem(key); } catch { this.available = false; } }
  },
  getJSON(key, fallback = null) {
    try { const v = this.get(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  setJSON(key, value) { return this.set(key, JSON.stringify(value)); },
};
