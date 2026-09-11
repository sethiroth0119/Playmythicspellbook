/* 💬 v121v112 — tooltips: one engine (src/hubui/tips.js) for every title,
   every hub tile / menu item / phone app / camp control, and every resource
   icon under the pointer. Runs the shipped engine against a tiny fake DOM.
   Run: node _tips_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const TIPS = readFileSync('./public/src/hubui/tips.js', 'utf8').replace(/\r\n/g, '\n');
const MM = readFileSync('./public/main-menu/index.html', 'utf8').replace(/\r\n/g, '\n');
const PH = readFileSync('./public/src/phone/handset.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. wired in ── */
ok(/<script src="src\/hubui\/tips\.js\?v=v121v1\d\d" defer><\/script>/.test(SRC), 'the game loads the engine (classic script, so it can read the resource tables by name)');
ok(/<script src="\.\.\/src\/hubui\/tips\.js\?v=v121v1\d\d" defer><\/script>/.test(MM), 'so does the cinematic main menu (its own document)');
ok(/id="\$\{p\.id\}" style="--portal-accent: \$\{p\.accent \|\| '#c8a060'\}" data-tip="\$\{escapeHtml\(String\(p\.name \|\| ''\) \+ \(p\.sub \? ' — ' \+ String\(p\.sub\)\.replace\(\/<\[\^>\]\*>\/g, ''\) : ''\)\)\}"/.test(SRC), 'every hub tile carries "name — sub" (one markup site, ~50 tiles)');
ok(/data-md-nav="\$\{i\}" data-tip="\$\{escapeHtml\(sec\.t \+ ' — ' \+ sec\.s\)\}"/.test(SRC), 'every fallback-menu item carries "title — subtitle"');
ok(/data-app="' \+ a\.id \+ '" data-tip="' \+ esc\(a\.name \+ ' — ' \+ a\.sub\) \+ '"/.test(PH), 'every phone app carries "name — sub"');
ok(/const CHUD_TIPS = \{/.test(SRC) && /<div class="chud-res" data-tip="\$\{escapeHtml\(CHUD_TIPS\[label\] \|\| label\)\}">/.test(SRC), 'every camp HUD resource chip says what it is');
ok(/#mx-tip\{position:fixed;z-index:2147483000;pointer-events:none;/.test(TIPS), 'the bubble sits above every in-app modal and never takes the pointer');

/* ── 2. the table ── */
const tipBy = TIPS.slice(TIPS.indexOf('const TIP_BY = ['), TIPS.indexOf('];', TIPS.indexOf('const TIP_BY = [')));
const rows = (tipBy.match(/^\s*\['/gm) || []).length;
ok(rows >= 50, 'TIP_BY names at least fifty controls that never had a title', rows);
for (const sel of ['.nav-item[data-label="The Camp"]', '.luni-nav-btn[data-tab="browse"]', '.cinder-icon', '.aza-icon', '#camp-wh-open', '[data-dpxtab="barracks"]', '[data-build]', '.dpx-collect[data-act="collect"]', '[data-rescue]', '[data-mia]', '.dpx-empty', '.cmpx-room', '#hub-back'])
  ok(tipBy.includes("'" + sel + "'") || tipBy.includes(sel + ','), 'names ' + sel);

/* ── 3. run the engine on a fake DOM ── */
{
  const listeners = {};
  const mkEl = (tag) => ({ tagName: String(tag).toUpperCase(), nodeType: 1, children: [], style: {}, _attrs: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }, removeAttribute(k) { delete this._attrs[k]; }, matches() { return false; }, get parentElement() { return this.parentNode || null; }, offsetWidth: 120, offsetHeight: 30, getBoundingClientRect: () => ({ left: 100, top: 100, width: 80, height: 30, bottom: 130 }), isConnected: true, innerHTML: '', textContent: '' });
  const document = { head: mkEl('head'), body: mkEl('body'), createElement: mkEl, addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); }, caretPositionFromPoint: null };
  const ctx = { window: null, document, Intl, MutationObserver: class { observe() {} }, setTimeout, clearTimeout, console, String, Map, Object, Array, Math, Number, RegExp,
    RESOURCES: [{ id: 'food', name: 'Food', icon: '🥫' }, { id: 'ammo', name: 'Ammo', icon: '🔫' }, { id: 'water', name: 'Water', icon: '💧' }, { id: 'catGasoline', name: 'Cat Gasoline', icon: '🔥' }],
    SALVAGE_RES: [{ id: 'scrap', name: 'Scrap Metal', icon: '🔩' }] };
  ctx.window = ctx; ctx.innerWidth = 1200; ctx.innerHeight = 800;
  vm.createContext(ctx);
  vm.runInContext(TIPS, ctx);
  ok(ctx.__mxTips === true && document.body.children.some((c) => c.id === 'mx-tip') && typeof ctx.mxTipResolve === 'function', 'the engine boots on a bare DOM and mounts its bubble');
  ok(['mousemove', 'touchstart', 'touchend', 'focusin', 'keydown', 'scroll'].every((t) => listeners[t] && listeners[t].length), 'it listens for the mouse, a long press, keyboard focus, and the things that should hide it');
  const el = (attrs, sels, tag) => { const e = mkEl(tag || 'div'); Object.assign(e._attrs, attrs); e.matches = (sel) => sel.split(',').map((s) => s.trim()).some((s) => (sels || []).includes(s)); return e; };
  const r1 = ctx.mxTipResolve(el({ 'data-tip': 'hello' }));
  ok(r1 && r1.text === 'hello', '1. data-tip wins');
  const r2 = ctx.mxTipResolve(el({ title: 'native one' }));
  ok(r2 && r2.text === 'native one' && r2.native === true, '2. a title becomes a tooltip (flagged native, so the browser bubble is parked while ours shows)');
  const r3 = ctx.mxTipResolve(el({}, ['.dpx-empty']));
  ok(r3 && /Empty deployment slot/.test(r3.text), '3. a table entry: the empty deploy slot');
  const r3b = ctx.mxTipResolve(el({}, ['.nav-item[data-label="The Camp"]'], 'button'));
  ok(r3b && /^The Camp — /.test(r3b.text), '   …and a main-menu row');
  const parent = el({ 'data-tip': 'the card' }); const kid = el({}, [], 'span'); parent.appendChild(kid);
  const r4 = ctx.mxTipResolve(kid);
  ok(r4 && r4.text === 'the card', '4. a plain span climbs to its card\'s tip');
  const parent2 = el({ 'data-tip': 'the card' }); const btn = el({}, [], 'button'); parent2.appendChild(btn);
  ok(ctx.mxTipResolve(btn) === null, '   …but a BUTTON with no tip of its own does not borrow its container\'s');
  const rt = ctx.mxTipResolve(el({}, [], 'button'));
  ok(rt === null, '5. a control with nothing to say gets no bubble');
  // resource icons under the pointer
  const text = { nodeType: 3, data: '🥫 12 · 🔫 4 · 🔥 300 · 🔩 2' };
  const at = (off) => { document.caretPositionFromPoint = () => ({ offsetNode: text, offset: off }); return ctx.mxTipIconAt(10, 10); };
  ok(at(0) && at(0).text === '🥫 Food', 'the pointer on 🥫 names Food (from RESOURCES)');
  ok(at(1) && at(1).text === '🥫 Food', '…anywhere on the grapheme');
  ok(at(3) === null, 'the pointer on "12" says nothing');
  ok(at(text.data.indexOf('🔫')) && at(text.data.indexOf('🔫')).text === '🔫 Ammo', '…on 🔫 names Ammo');
  ok(at(text.data.indexOf('🔥')) && /^🔥 Cinder/.test(at(text.data.indexOf('🔥')).text), '…on 🔥 names Cinder (TIP_ICONS — no table carries it)');
  ok(at(text.data.indexOf('🔩')) && at(text.data.indexOf('🔩')).text === '🔩 Scrap Metal', '…on 🔩 names Scrap Metal (from SALVAGE_RES)');
  ok(ctx.mxTipIcons().size >= 8, 'the icon map holds the tables plus the currencies', ctx.mxTipIcons().size);
  const rr = ctx.mxTipResolve(el({}, [], 'span'), 10, 10);
  ok(rr && rr.text === '🔩 Scrap Metal', 'resolve() falls through to the icon under the pointer when nothing else names the element');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 112, 'BUILD_VERSION is v121v112 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
