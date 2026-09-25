/* 🛒 LUNI ON THE PHONE (v121v58).

   Asked for: "Make a Luni app for the phone where players can list resources
   and items and buy stuff from the player market from the phone app."

   Defends, headless:
     · window.MythicLuni routes to the MARKET SCREEN'S OWN functions and never
       reimplements one: resMarketPost / resMarketTake / resMarketCancel for
       resources, listHeldItemForSale / cardMarketBuy / cardMarketCancel for
       items and cards;
     · _luniPhoneRows flattens the two differently-shaped markets (ResMarket
       holds raw rows, CardMarket holds mapped listings), hides my own rows
       from Browse, hides a sold-out or closed row, and sorts cheapest first —
       run for real against both shapes;
     · the phone registers the app, routes it, paints the board, opens a
       ticket whose Buy calls the seam with that listing's id, refuses a buy
       the wallet cannot cover, lists a resource with lot size / lots / price
       and an item with a price, and pulls a listing from the Mine tab.

   Run: node _luniphone_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
const MOD = readFileSync('./public/src/phone/handset.js', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
}

/* ── the seam ── */
{
  const i = SRC.indexOf('window.MythicLuni = {'), j = SRC.indexOf('window.MythicExchange = {', i);
  const seam = SRC.slice(i, j);
  ok(i > 0 && j > i, 'window.MythicLuni sits beside MythicExchange');
  ok(/await resMarketPost\(o\.id, lotSize, lots, \{ mode: 'cinders', price \}\)/.test(seam), 'listing a resource calls the market\'s own poster');
  ok(/listHeldItemForSale\(o\.id, price\)/.test(seam), 'listing an item calls the market\'s own item poster (which owns the escrow)');
  ok(/await resMarketTake\(raw, 1\)/.test(seam) && /await cardMarketBuy\(l\)/.test(seam), 'buying routes to resMarketTake / cardMarketBuy');
  ok(/await resMarketCancel\(raw\)/.test(seam) && /await cardMarketCancel\(l\)/.test(seam), 'cancelling routes to resMarketCancel / cardMarketCancel');
  ok(/lotSize \* lots > have/.test(seam), 'a resource listing bigger than the stores is refused before the market is called');
  ok(/App\.screen = 'market'/.test(seam), 'openFull goes to the market screen');
  ok(/_traderSlots\(\)/.test(seam), 'the listing cap comes from the same place both post paths read it');
}

/* ── _luniPhoneRows, run for real against both market shapes ── */
{
  const ctx = {
    Profile: { cloud: { userId: 'me' } },
    ResMarket: { open: [
      { id: 'r1', resource: 'metal', price: 40, currency: 'cinders', seller_id: 'them', seller_name: 'Vex', qty: 10, status: 'open' },
      { id: 'r2', resource: 'metal', price: 10, currency: 'cinders', seller_id: 'me',   seller_name: 'Me',  qty: 5,  status: 'open' },
      { id: 'r3', resource: 'metal', price: 5,  currency: 'cinders', seller_id: 'them', seller_name: 'Vex', qty: 0,  status: 'open' },
      { id: 'r4', resource: 'metal', price: 7,  currency: 'cinders', seller_id: 'them', seller_name: 'Vex', qty: 3,  status: 'sold' },
    ], mine: [{ id: 'r2', resource: 'metal', price: 10, currency: 'cinders', seller_id: 'me', seller_name: 'Me', qty: 5, status: 'open' }] },
    CardMarket: { open: [{ id: 'c1', kind: 'item', price: 25, sellerId: 'them', sellerName: 'Vex', item: { name: 'Ration Tin', icon: '🥫' } }], mine: [] },
    _resLots: (l) => ({ lotSize: l.qty | 0, lotsLeft: (l.qty | 0) > 0 ? 1 : 0 }),
    _meta: (id) => ({ id, name: 'Metal', icon: '⛓️' }),
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fnText('_luniPhoneRows'), ctx);
  const browse = vm.runInContext('_luniPhoneRows(false)', ctx);
  const ids = browse.map((r) => r.id).join();
  ok(ids === 'c1,r1', 'Browse: my own row, the sold-out row and the closed row are all gone, cheapest first', ids);
  ok(browse[1].name === 'Metal' && browse[1].lotSize === 10 && browse[1].seller === 'Vex' && browse[1].kind === 'res', 'a resource row carries name, lot size and seller', JSON.stringify(browse[1]));
  ok(browse[0].kind === 'item' && browse[0].name === 'Ration Tin' && browse[0].icon === '🥫', 'a card-market row carries its item name and icon', JSON.stringify(browse[0]));
  const mine = vm.runInContext('_luniPhoneRows(true)', ctx);
  ok(mine.length === 1 && mine[0].id === 'r2' && mine[0].mine === true, 'Mine: only my own listing', JSON.stringify(mine));
}

/* ── the phone app, run for real ── */
function sandbox(seam) {
  const els = {};
  const mkEl = (tag) => ({
    tagName: tag.toUpperCase(), children: [], style: {}, dataset: {}, className: '', hidden: false, _html: '', attributes: {},
    set innerHTML(v) { this._html = String(v); this.children = []; parse(this, this._html); }, get innerHTML() { return this._html; },
    get textContent() { return this._html.replace(/<[^>]+>/g, ''); }, set textContent(v) { this._html = String(v); },
    appendChild(c) { this.children.push(c); c.parentNode = this; if (c.id) els[c.id] = c; return c; }, remove() {},
    setAttribute(k, v) { this.attributes[k] = v; if (k === 'id') { this.id = v; els[v] = this; } },
    getAttribute(k) { return this.attributes[k]; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { const out = []; const walk = (n) => { n.children.forEach((c) => { if (match(c, sel)) out.push(c); walk(c); }); }; walk(this); return out; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, focus() {}, animate() { return {}; }, addEventListener() {},
    getBoundingClientRect() { return { width: 320, height: 640 }; }, get firstChild() { return this.children[0] || { style: {}, innerHTML: '' }; },
  });
  const match = (el, sel) => {
    if (sel.startsWith('#')) return el.id === sel.slice(1);
    if (sel.startsWith('.')) return (' ' + el.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0;
    const m = sel.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/); if (m) { const k = m[1]; return k in el.attributes && (m[2] == null || el.attributes[k] === m[2]); }
    return el.tagName.toLowerCase() === sel;
  };
  function parse(root, html) {
    const stack = [root]; const re = /<(\/?)([a-z0-9]+)([^>]*)>/gi; let m;
    while ((m = re.exec(html))) {
      const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3];
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = mkEl(tag);
      for (const a of attrs.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
        const k = a[1], v = a[2] == null ? '' : a[2];
        el.attributes[k] = v;
        if (k === 'id') { el.id = v; els[v] = el; }
        if (k === 'class') el.className = v;
        if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
        if (k === 'value') el.value = v;
        if (k === 'disabled') el.disabled = true;
      }
      stack[stack.length - 1].children.push(el); el.parentNode = stack[stack.length - 1];
      if (!/^(input|br|img|polyline|hr)$/.test(tag)) stack.push(el);
    }
  }
  const body = mkEl('body'), head = mkEl('head');
  const document = { body, head, hidden: false, getElementById: (id) => els[id] || null, createElement: (t) => mkEl(t), addEventListener() {}, querySelector: () => null, activeElement: body };
  const store = {};
  const localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; }, get length() { return 0; }, key: () => null };
  const window = { MythicNotify: { state: () => ({ unread: 0 }), render() {}, markRead() {}, clear() {} }, MythicChatSeam: { unread: () => 0 }, innerWidth: 400, innerHeight: 800, addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  if (seam) window.MythicLuni = seam;
  const ctx = { window, document, localStorage, navigator: { onLine: true }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Date, Number, Math, String, Array, Object, JSON, console, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 1, Image: class {}, FileReader: class {}, URL: { createObjectURL: () => '' } };
  ctx.window.document = document; ctx.window.localStorage = localStorage;
  vm.createContext(ctx);
  vm.runInContext(MOD, ctx);
  const html = (el) => el ? (el._html || '') + el.children.map(html).join('') : '';
  return { H: ctx.window.MythicHandset, els, html };
}
const calls = [];
let refreshes = 0;
const seam = {
  signedIn: () => true, wallet: () => 500, walletAza: () => 100, fmt: (n) => Number(n).toLocaleString(), usd: (n) => '$' + (n / 5000).toFixed(2),
  slots: () => ({ used: 1, max: 5 }),
  refresh: async () => { refreshes++; return true; },
  browse: () => [
    { id: 'r1', kind: 'res', name: 'Metal', icon: '⛓️', price: 40, currency: 'cinders', seller: 'Vex', lotSize: 10, lots: 3, mine: false },
    /* priced in Aza at 300: affordable against the 500 Cinder wallet, NOT
       against the 100 Aza purse — so this row only reads correctly if the
       ticket weighs the price against the purse it is priced in. */
    { id: 'z1', kind: 'res', name: 'Relic Dust', icon: '✨', price: 300, currency: 'aza', seller: 'Vex', lotSize: 2, lots: 1, mine: false },
    { id: 'c1', kind: 'item', name: 'Ration Tin', icon: '🥫', price: 9000, currency: 'cinders', seller: 'Vex', lotSize: 0, lots: 1, mine: false },
  ],
  mine: () => [{ id: 'r2', kind: 'res', name: 'Metal', icon: '⛓️', price: 10, currency: 'cinders', seller: 'Me', lotSize: 5, lots: 2, mine: true }],
  sellable: () => ({ resources: [{ id: 'metal', name: 'Metal', icon: '⛓️', have: 120 }], items: [{ id: 'ration', name: 'Ration Tin', icon: '🥫', have: 2 }] }),
  list: async (o) => { calls.push(['list', o.kind, o.id, o.price, o.lotSize, o.lots]); return { ok: true, msg: 'Listed.' }; },
  buy: async (id) => { calls.push(['buy', id]); return { ok: true, msg: 'Bought.' }; },
  cancel: async (id) => { calls.push(['cancel', id]); return { ok: true, msg: 'Pulled.' }; },
  openFull: () => true,
};
/* the app's buttons are async — let their await chains settle before asserting */
const tick = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
{
  const { H, els, html } = sandbox(seam);
  const P = () => html(els['mgp-pane']);
  ok(H && H.apps().some((a) => a.id === 'luni' && a.name === 'Luni'), 'the phone lists a Luni app');
  H.open('luni');
  ok(refreshes === 1, 'opening the app reads the market itself — it never waits for the market screen to have been visited', 'refreshes=' + refreshes);
  ok(H.app() === 'luni' && /Metal/.test(P()) && /Ration Tin/.test(P()) && /1 \/ 5/.test(P()), 'Browse paints the board and my listing count');
  ok(/Search the market/.test(P()), 'Browse has a search');
  ok(/id="mgp-luni-refresh"/.test(P()), 'and a refresh control');
  const pane = els['mgp-pane'];
  pane.querySelector('[data-luni-pick="r1"]').onclick();
  ok(/10 per lot/.test(P()) && /3 lots left/.test(P()) && /from Vex/.test(P()) && /\$0\.01/.test(P()), 'the ticket shows the lot size, lots left, seller and USD');
  els['mgp-luni-buy'].onclick();
  await tick();
  ok(calls.length === 1 && calls[0][0] === 'buy' && calls[0][1] === 'r1', 'Buy calls the seam with that listing id', JSON.stringify(calls));
  ok(/Search the market/.test(P()), 'a bought listing drops the ticket and returns to the board');
  /* a listing the wallet cannot cover */
  pane.querySelector('[data-luni-pick="c1"]').onclick();
  ok(/not enough for this/.test(P()) && els['mgp-luni-buy'].disabled === true, 'a listing above the wallet says so and cannot be bought');
  ok(calls.length === 1, 'and clicking it buys nothing');
  /* the Aza row: 300 Aza against a 100 Aza purse is short, even though the
     Cinder wallet holds 500 — the ticket must weigh the right purse */
  pane.querySelector('[data-lt="browse"]').onclick();
  pane.querySelector('[data-luni-pick="z1"]').onclick();
  ok(/Wallet 👑 100/.test(P()) && /not enough for this/.test(P()) && els['mgp-luni-buy'].disabled === true, 'an Aza listing is weighed against the Aza purse, not the Cinder wallet');
  /* sell — the tab switch is also what drops the open ticket */
  pane.querySelector('[data-lt="sell"]').onclick();
  ok(/Metal/.test(P()) && /Ration Tin/.test(P()) && /you hold 120/.test(P()), 'Sell lists the resources and items I hold');
  pane.querySelector('[data-luni-sell="res:metal"]').onclick();
  ok(/mgp-luni-lotsize/.test(P()) && /mgp-luni-lots"/.test(P()) && /mgp-luni-price/.test(P()), 'a resource form asks for lot size, lots and price');
  els['mgp-luni-lotsize'].value = '25'; els['mgp-luni-lots'].value = '4'; els['mgp-luni-price'].value = '300';
  els['mgp-luni-list'].onclick();
  await tick();
  ok(calls.length === 2 && JSON.stringify(calls[1]) === JSON.stringify(['list', 'res', 'metal', 300, 25, 4]), 'listing a resource passes the typed lot size, lots and price', JSON.stringify(calls[1]));
  pane.querySelector('[data-lt="sell"]').onclick();
  pane.querySelector('[data-luni-sell="item:ration"]').onclick();
  ok(!/mgp-luni-lotsize/.test(P()) && /mgp-luni-price/.test(P()), 'an item form is the price alone — no lots');
  els['mgp-luni-price'].value = '80';
  els['mgp-luni-list'].onclick();
  await tick();
  ok(calls.length === 3 && calls[2][1] === 'item' && calls[2][2] === 'ration' && calls[2][3] === 80, 'listing an item passes its price', JSON.stringify(calls[2]));
  /* mine */
  pane.querySelector('[data-lt="mine"]').onclick();
  ok(/Metal/.test(P()) && /Pull/.test(P()), 'Mine lists my listings with a Pull button');
  pane.querySelector('[data-luni-cancel="r2"]').onclick();
  await tick();
  ok(calls.length === 4 && calls[3][0] === 'cancel' && calls[3][1] === 'r2', 'Pull cancels that listing through the seam', JSON.stringify(calls[3]));
  H.close();
}
{
  /* the exact shape of the bug this round fixed: an empty board while the
     fetch is still out must read as "reading", never as "nothing is listed" */
  const never = new Promise(() => {});
  const { H, els, html } = sandbox(Object.assign({}, seam, { browse: () => [], mine: () => [], refresh: () => never }));
  H.open('luni');
  ok(/Reading the market…/.test(html(els['mgp-pane'])) && !/Nothing is listed/.test(html(els['mgp-pane'])), 'a fetch that has not answered says it is reading, never "nothing is listed"');
}
{
  const { H, els, html } = sandbox(null);
  H.open('luni');
  ok(/not available on this build/.test(html(els['mgp-pane'])), 'no seam → a message, not a throw');
}
{
  const { H, els, html } = sandbox(Object.assign({}, seam, { signedIn: () => false }));
  H.open('luni');
  ok(/Sign in to trade on Luni/.test(html(els['mgp-pane'])), 'signed out → an invitation, not an empty board');
}
ok(/window\.BUILD_VERSION = 'v121v(5[8-9]|[6-9]\d|\d{3,})'/.test(SRC), 'build v121v58 or later');
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
