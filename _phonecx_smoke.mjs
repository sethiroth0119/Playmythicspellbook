/* 📈 CRASH EXCHANGE ON THE PHONE (v121v54).

   Asked for: "Make a Crash Exchange app for the phone."
   Defends, headless:
     · window.MythicExchange in index.html wraps the screen's own catalog,
       quote, buy and sell (no second pricing path), plus holdings and open();
     · the handset registers the app, routes it, and the app paints the market
       list from the seam, opens a ticket with a sparkline and Buy / Sell, and
       the ticket's buttons call the seam's buy / sell with the typed quantity;
     · the portfolio tab lists positions with P&L;
     · with no seam the app says so instead of throwing.

   Run: node _phonecx_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const MOD = readFileSync('./public/src/phone/handset.js', 'utf8');

/* ── the seam in index.html ── */
{
  const i = SRC.indexOf('window.MythicExchange = {'); const j = SRC.indexOf('window.MythicBank = {', i);
  const seam = SRC.slice(i, j);
  ok(i > 0 && j > i, 'window.MythicExchange sits beside MythicBank');
  ok(/_cxMarketCatalog\(\)/.test(seam) && /getMarketPrice\(id\)/.test(seam) && /_cxGetHistory\(id, '24H'\)/.test(seam) && /_cxQuoteOrder\(id, 1, \+1\)/.test(seam), 'list and quote use the screen\'s catalog, price, history and order quote (v121v121: the reserve quote is gone)');
  ok(/_cxExecuteBuy\(id, Math\.max\(1, qty \| 0\)\)/.test(seam) && /_cxExecuteSell\(id, Math\.max\(1, qty \| 0\)\)/.test(seam), 'buy and sell are the screen\'s own executors');
  ok(/App\.screen = 'crashExchange'; render\(\);/.test(seam) && /App\._cxFocusId = id/.test(seam), 'open() lands on the full screen focused on the asset');
  ok(/m\.resources && m\.resources\.items/.test(seam), 'only the resources channel is offered (cards / corps are read-only on the screen too)');
}

/* ── the phone app, run for real ── */
function sandbox(seam) {
  const els = {};
  const mkEl = (tag) => {
    const el = { tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, className: '', hidden: false, _html: '', attributes: {},
      set innerHTML(v) { this._html = String(v); this.children = []; parse(this, this._html); }, get innerHTML() { return this._html; },
      get textContent() { return this._html.replace(/<[^>]+>/g, ''); }, set textContent(v) { this._html = String(v); },
      appendChild(c) { this.children.push(c); c.parentNode = this; if (c.id) els[c.id] = c; return c; }, remove() {}, setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') { this.id = v; els[v] = this; } },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { const out = []; const walk = (n) => { n.children.forEach((c) => { if (match(c, sel)) out.push(c); walk(c); }); }; walk(this); return out; },
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, focus() {}, animate() { return {}; }, addEventListener() {}, getBoundingClientRect() { return { width: 320, height: 640 }; },
      get firstChild() { return this.children[0] || { style: {}, innerHTML: '' }; }, getAttribute(k) { return this.attributes[k]; },
    };
    return el;
  };
  const match = (el, sel) => {
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return (' ' + el.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0;
    const m = sel.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/); if (m) { const k = m[1]; return k in el.attributes && (m[2] == null || el.attributes[k] === m[2]); }
    return el.tagName.toLowerCase() === sel;
  };
  /* a tiny tag parser: enough for the phone's markup (no nesting rules beyond a stack) */
  function parse(root, html) {
    const stack = [root]; const re = /<(\/?)([a-z0-9]+)([^>]*)>/gi; let m;
    while ((m = re.exec(html))) {
      const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3];
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = mkEl(tag);
      const am = attrs.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g);
      for (const a of am) { const k = a[1], v = a[2] == null ? '' : a[2]; el.attributes[k] = v; if (k === 'id') { el.id = v; els[v] = el; } if (k === 'class') el.className = v; if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v; if (k === 'value') el.value = v; if (k === 'disabled') el.disabled = true; }
      stack[stack.length - 1].children.push(el); el.parentNode = stack[stack.length - 1];
      if (!/^(input|br|img|span-void|polyline|hr)$/.test(tag) || tag === 'span-void') { if (!/^(input|br|img|polyline|hr)$/.test(tag)) stack.push(el); }
    }
  }
  const body = mkEl('body'), head = mkEl('head');
  const document = { body, head, hidden: false, getElementById: (id) => els[id] || null, createElement: (t) => mkEl(t), addEventListener() {}, querySelector: () => null, activeElement: body };
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, get length() { return 0; }, key: () => null };
  const window = { MythicNotify: { state: () => ({ unread: 0 }), render() {}, markRead() {}, clear() {} }, MythicChatSeam: { unread: () => 0 }, innerWidth: 400, innerHeight: 800, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  if (seam) window.MythicExchange = seam;
  const ctx = { window, document, localStorage, navigator: { onLine: true }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Date, Number, Math, String, Array, Object, JSON, console, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: (f) => 1, Image: class {}, FileReader: class {}, URL: { createObjectURL: () => '' } };
  ctx.window.document = document; ctx.window.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const html = (el) => el ? (el._html || '') + el.children.map(html).join('') : '';
  return { H: ctx.window.MythicHandset, els, window, html };
}
const calls = [];
const seam = {
  signedIn: () => true, wallet: () => 12345,
  list: () => [{ id: 'fuel', name: 'Fuel', icon: '⛽', cat: 'energy', price: 42.5, base: 40, delta: 6.25, vol: 900, qty: 3, avgCost: 39 }, { id: 'scrap', name: 'Scrap', icon: '🔩', cat: 'basic', price: 5, base: 6, delta: -16.7, vol: 12000, qty: 0, avgCost: 0 }],
  quote: (id) => ({ id, name: id === 'fuel' ? 'Fuel' : 'Scrap', icon: '⛽', price: 42.5, base: 40, delta: 6.25, vol: 900, buyPx: 44.2, series: [40, 41, 39, 42, 43, 42.5], qty: id === 'fuel' ? 3 : 0, avgCost: 39 }),
  holdings: () => [{ id: 'fuel', name: 'Fuel', icon: '⛽', qty: 3, avgCost: 39, price: 42.5, value: 127.5, pnl: 10.5, pnlPct: 8.97 }],
  buy: (id, q) => { calls.push(['buy', id, q]); return { ok: true, msg: 'Bought ' + q }; },
  sell: (id, q) => { calls.push(['sell', id, q]); return { ok: true, msg: 'Sold ' + q }; },
  fmt: (n) => Number(n).toFixed(2), open: () => true,
};
{
  const { H, els, html } = sandbox(seam);
  const P = () => html(els['mgp-pane']);
  ok(H && H.apps().some((a) => a.id === 'cx' && /Crash Exchange/.test(a.name)), 'the phone lists a Crash Exchange app');
  H.open('cx');
  const pane = els['mgp-pane'];
  ok(H.app() === 'cx' && pane && /Fuel/.test(P()) && /Scrap/.test(P()) && /12,345/.test(P()), 'the market tab paints every listed resource and the wallet');
  ok(/▲ 6\.3%/.test(P()) && /▼ 16\.7%/.test(P()), 'each row shows its 24h move');
  const row = pane.querySelector('[data-cx-pick="fuel"]');
  ok(!!row, 'rows are tappable');
  row.onclick();
  ok(/mgp-cx-spark/.test(P()) && /polyline/.test(P()) && /44\.20/.test(P()) && /You hold <b>3<\/b>/.test(P()), 'the ticket shows a sparkline, the reserve buy quote and my position');
  const qty = els['mgp-cx-qty']; qty.value = '7';
  els['mgp-cx-buy'].onclick();
  ok(calls.length === 1 && calls[0][0] === 'buy' && calls[0][1] === 'fuel' && calls[0][2] === 7, 'Buy calls the seam with the asset and the typed quantity', JSON.stringify(calls));
  qty.value = '99';
  els['mgp-cx-sell'].onclick();
  ok(calls.length === 2 && calls[1][0] === 'sell' && calls[1][2] === 3, 'Sell never asks for more than I hold', JSON.stringify(calls));
  ok(/Sold 3/.test(html(els['mgp-cx-msg'])), 'the ticket reports the order result');
  els['mgp-cx-back'].onclick();
  ok(/Search resources/.test(P()), 'back returns to the market list');
  pane.querySelector('[data-ct="port"]').onclick();
  ok(/avg 39\.00/.test(P()) && /\+10\.50/.test(P()) && /\+9\.0%/.test(P()), 'the portfolio tab lists positions with P&L');
  H.close();
}
{
  const { H, els, html } = sandbox(null);
  H.open('cx');
  ok(/not available on this build/.test(html(els['mgp-pane'])), 'no seam → a message, not a throw');
}
ok(/window\.BUILD_VERSION = 'v121v(5[4-9]|[6-9]\d|\d{3,})'/.test(SRC), 'build v121v54 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
