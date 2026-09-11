/* 🃏 THE ACTIVATION SPLASH — "when card effects activate show the card art
   on the screen for 2 seconds so players can see what card is using its
   effect … just one — if it is a chain, show it with how many cards are in
   the chain."

   Runs the shipped src/battle/activate.js against a tiny fake DOM (no jsdom
   in this repo) and drives announce(): a lone activation raises one splash
   with the card art and holds the beat for 2 s; a three-link chain raises
   exactly ONE splash, on the first link, wearing "CHAIN · 3 CARDS"; a hidden
   enemy card raises none; the pulse and band still run.

   Run: node _activatefx_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };

/* ── the fake DOM ─────────────────────────────────────────────────────── */
const byId = new Map();
class El {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase(); this.children = []; this.parentNode = null;
    this._attrs = {}; this._html = ''; this._id = '';
    this.style = { cssText: '', setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } };
    const self = this;
    this.classList = {
      add(...c) { c.forEach((x) => { if (!self._cls.includes(x)) self._cls.push(x); }); },
      remove(...c) { self._cls = self._cls.filter((x) => !c.includes(x)); },
      contains(x) { return self._cls.includes(x); },
      toggle(x, on) { if (on) this.add(x); else this.remove(x); },
    };
    this._cls = [];
  }
  get id() { return this._id; }
  set id(v) { if (this._id) byId.delete(this._id); this._id = v; byId.set(v, this); }
  get className() { return this._cls.join(' '); }
  set className(v) { this._cls = String(v).split(/\s+/).filter(Boolean); }
  get isConnected() { let n = this; while (n) { if (n === doc.body) return true; n = n.parentNode; } return false; }
  set innerHTML(v) { this._html = String(v); }
  get innerHTML() { return this._html; }
  get outerHTML() { return '<' + this.tagName.toLowerCase() + '>' + this._html + '</' + this.tagName.toLowerCase() + '>'; }
  set textContent(v) { this._html = String(v); }
  get textContent() { return this._html; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] == null ? null : this._attrs[k]; }
  removeAttribute(k) { delete this._attrs[k]; }
  addEventListener() {} removeEventListener() {}
  cloneNode() { const e = new El(this.tagName); e._html = this._html; e._cls = this._cls.slice(); return e; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const m = /^#([\w-]+)\s+\.([\w-]+)$/.exec(sel) || /^\.([\w-]+)$/.exec(sel);
    const cls = m ? m[m.length - 1] : null;
    const walk = (n) => { for (const c of n.children) { if (cls && c.classList.contains(cls)) out.push(c); walk(c); } };
    if (/^#/.test(sel) && !cls) { const e = byId.get(sel.slice(1)); return e ? [e] : []; }
    if (!cls) return [];
    walk(/^#/.test(sel) ? (byId.get(sel.slice(1, sel.indexOf(' '))) || this) : this);
    return out;
  }
}
const doc = {
  body: new El('body'), head: new El('head'), documentElement: new El('html'),
  createElement: (t) => new El(t),
  getElementById: (id) => byId.get(id) || null,
  querySelector: (s) => doc.body.querySelector(s),
  querySelectorAll: (s) => doc.body.querySelectorAll(s),
};
const sandbox = {
  document: doc, setTimeout, clearTimeout, console: { info() {}, warn: (...a) => console.log('   [warn]', ...a) },
  matchMedia: () => ({ matches: false }), performance: { now: () => Date.now() },
  getComputedStyle: () => ({ zoom: '1' }), innerWidth: 1280, innerHeight: 720,
  Object, Array, String, Number, Math, Date, isFinite, parseFloat, JSON, CSS: { escape: (s) => s },
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(readFileSync('./public/src/battle/activate.js', 'utf8'), sandbox, { filename: 'activate.js' });
const FX = sandbox.ActivateFX;
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const rootEl = () => doc.getElementById('afx-root');
const splashes = () => (rootEl() ? rootEl().querySelectorAll('.afx-splash') : []);
const bands = () => (rootEl() ? rootEl().querySelectorAll('.afx-band') : []);

console.log('\n=== 1. the module loads and knows the splash ===');
ok(!!FX && FX.version === 'r7-activate-1.1.0-splash', 'ActivateFX loaded (' + (FX && FX.version) + ')');
ok(FX.timings().splash === 2000, 'the splash is 2 seconds');

console.log('\n=== 2. one activation → one splash with the card art, for two seconds ===');
{
  FX.announce({ name: 'Blue-Eyes Wyrm', cardId: 'bew', artUrl: 'assets/art/bew.png', owner: 'player', zone: 'field', effects: ['Deals 25 damage.'] });
  await tick(30);
  const sp = splashes();
  ok(sp.length === 1, 'exactly one splash is on screen');
  ok(sp[0] && /bew\.png/.test(sp[0].style.backgroundImage || ''), 'and it carries the card art');
  ok(sp[0] && /Blue-Eyes Wyrm/.test(sp[0].innerHTML) && /ON THE FIELD/.test(sp[0].innerHTML), 'with the card\'s name and what kind of activation it is');
  ok(sp[0] && !/afx-chain/.test(sp[0].innerHTML), 'no chain badge on a lone activation');
  ok(bands().length === 1, 'the explain band still runs beside it');
  const d = FX.debug();
  ok(d.playing && d.playing.name === 'Blue-Eyes Wyrm', 'the beat is live');
  await tick(1700);
  ok(FX.isPlaying() && splashes().length === 1, 'still up at 1.7 s — the beat was stretched to the splash');
  await tick(700);
  ok(!FX.isPlaying() && splashes().length === 0, 'gone by 2.4 s, every node removed');
  const t = FX.debug().trace.slice(-1)[0];
  ok(t && t.splash === true, 'the trace records that a splash was shown');
}

console.log('\n=== 3. a chain: one splash, on the first link, wearing the chain size ===');
{
  FX.resetMatch();
  for (let i = 0; i < 3; i++) {
    FX.announce({ name: 'Link ' + (i + 1), cardId: 'c' + i, artUrl: 'assets/art/c' + i + '.png', owner: i === 1 ? 'ai' : 'player', zone: 'hand', chainIndex: i, chainLen: 3, forceTier: 'flash' });
  }
  await tick(30);
  let sp = splashes();
  ok(sp.length === 1 && /c0\.png/.test(sp[0].style.backgroundImage), 'link 1 raises the splash with ITS art');
  ok(/CHAIN · 3 CARDS/.test(sp[0].innerHTML), 'and it says how many cards are in the chain: CHAIN · 3 CARDS');
  await tick(2200);                      // link 1 done, link 2 running
  const d2 = FX.debug();
  ok(d2.playing && d2.playing.name === 'Link 2', 'link 2 is now playing');
  ok(splashes().length === 0 && bands().length === 1, 'link 2 has NO splash — only its pulse and band');
  FX.skipAll();
  const tr = FX.debug().trace;
  ok(tr.filter((x) => x.splash).length === 1, 'across the whole chain exactly one splash was shown');
}

console.log('\n=== 4. what never splashes ===');
{
  FX.resetMatch();
  FX.announce({ name: 'Enemy card', cardId: 'x', artUrl: 'assets/art/x.png', owner: 'ai', zone: 'facedown', hidden: true });
  await tick(30);
  ok(splashes().length === 0 && bands().length === 1, 'a hidden enemy card shows no art — the band says "Enemy card" and nothing more');
  FX.skipAll();
  FX.announce({ name: 'Bare', cardId: 'b', owner: 'player', zone: 'field' });
  await tick(30);
  ok(splashes().length === 0, 'a card with no art and no frame raises no splash');
  FX.skipAll();
  FX.announce({ name: 'Framed', cardId: 'f', frameUrl: 'assets/Frames/unit.png', icon: '🐺', owner: 'player', zone: 'field' });
  await tick(30);
  const sp = splashes();
  ok(sp.length === 1 && /afx-glyph/.test(sp[0].innerHTML) && /🐺/.test(sp[0].innerHTML), 'a card with only a frame shows the frame with its icon');
  FX.skipAll();
  ok(!FX.isPlaying() && splashes().length === 0, 'skipAll clears it');
}

console.log('\n=== 5. the page ===');
{
  const IX = readFileSync('./public/index.html', 'utf8');
  ok(/src="src\/battle\/activate\.js\?v=v121v21"/.test(IX), 'index.html loads the new activate.js (cache key bumped)');
  const A = readFileSync('./public/src/battle/activate.js', 'utf8');
  ok(/@keyframes afx-splash\{/.test(A) && /\.afx-splash\.afx-foe/.test(A) && /prefers-reduced-motion/.test(A), 'the splash has its rise-hold-fade keyframes, an enemy tint, and a reduced-motion fallback');
}

console.log(fails ? '\n❌ ' + fails + ' FAILURES' : '\n✅ ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
