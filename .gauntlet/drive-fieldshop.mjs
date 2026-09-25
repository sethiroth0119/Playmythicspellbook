/* ══════════════════════════════════════════════════════════════════════════
   🏪 DRIVE-FIELDSHOP — does the trader engine reach the real game?

   tools/fieldshop-tests/run.mjs proves the MATHS. This proves the WIRING, and
   the two halves fail differently:

     • the module can be perfect and still refuse everything, if the host's
       category resolver emits strings the module has never heard of. That is
       exactly the defect the first draft shipped — traders specialised in
       'medicine' and 'healing' while the game emits 'consumable' and 'combat'
       — and no amount of unit testing the module would have caught it, because
       the unit test invented the same fictional taxonomy.

   So the load-bearing check here is AGREEMENT: every category index.html can
   actually produce, for every item in the live catalogue, must be a category
   some trader will buy. Anything else is an item that is silently unsellable.

   ⚠ IT PROVES THE TEST CAN FAIL. A deliberately bogus category is pushed
     through the same assertion and must be reported as unsellable. If it is
     not, this driver cannot see the defect it exists for.

   Run:  node .gauntlet/drive-fieldshop.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
const P = 8020 + (process.pid % 60);
const s = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => s.listen(P, '127.0.0.1', r));
const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
await pg.waitForFunction('!!window.MythicFieldShop', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(3500);

const r = await pg.evaluate(() => {
  const o = {};
  const FS = window.MythicFieldShop;
  o.mounted = !!FS;
  if (!FS) return o;
  o.attached = typeof FS.quote === 'function';
  o.traderCount = (FS.traderIds || []).length;
  o.shared = FS.shared;

  // Every item the game actually has.
  let ids = [];
  try {
    ids = (typeof getAllItems === 'function') ? getAllItems().map(i => i.id)
        : Object.keys(typeof HELD_ITEMS === 'object' ? HELD_ITEMS : {});
  } catch (e) {}
  o.itemCount = ids.length;

  // ── THE AGREEMENT CHECK ──────────────────────────────────────────────
  const VOCAB = new Set(FS.pure.CATEGORIES);
  const emitted = {}, offVocab = new Set(), unsellable = [];
  for (const id of ids) {
    let c = '';
    try { c = _fsCategoryOf(id); } catch (e) { c = '!threw'; }
    emitted[c] = (emitted[c] || 0) + 1;
    if (!VOCAB.has(c)) offVocab.add(c);
    if (!FS.traderIds.some(t => FS.pure.accepts(t, c))) unsellable.push(id + ':' + c);
  }
  o.emitted = emitted;
  o.offVocab = [...offVocab];
  o.unsellable = unsellable.slice(0, 6);
  o.unsellableCount = unsellable.length;

  // CONTROL: a category the module cannot know must read as unsellable.
  o.controlUnsellable = !FS.traderIds.some(t => FS.pure.accepts(t, 'not_a_real_category'));

  // ── A REAL QUOTE ON A REAL ITEM ──────────────────────────────────────
  /* ⚠ SKIP THE PLACEHOLDER. HELD_ITEMS carries an id literally called `none`
     (the "no item equipped" row) and it sorts first, so the first version of
     this probe ran the entire buy/sell loop against a non-item and printed
     "none (utility)" as if that were a result. */
  const PLACEHOLDER = new Set(['none', '', 'null', 'undefined']);
  const probe = ids.find(id => {
    if (PLACEHOLDER.has(String(id))) return false;
    try { return FS.quote('general', id).marketPx > 0; } catch (e) { return false; }
  });
  o.probeId = probe || null;
  if (probe) {
    const q = FS.quote('general', probe);
    o.q = { px: q.marketPx, bid: q.bid, ask: q.ask, tier: q.tier, cat: q.category, stock: q.stock };
    o.askOverBid = q.ask > q.bid;

    // ── THE LOOP, ON LIVE STATE ────────────────────────────────────────
    const sell = FS.sellToTrader('general', probe, 30);
    o.sold = sell.ok ? sell.qty : ('refused:' + sell.reason);
    const after = FS.quote('general', probe);
    o.stockRose = after.stock > q.stock;
    o.basisSet = after.costBasis > 0;
    o.askStillOverBid = after.ask > after.bid;

    // buy it straight back — must cost more than it paid
    const buy = FS.buyFromTrader('general', probe, sell.ok ? sell.qty : 1);
    o.roundTrip = (sell.ok && buy.ok) ? (buy.total - sell.total) : null;
    o.roundTripLoses = o.roundTrip === null ? null : o.roundTrip > 0;

    const audit = FS.auditAll(ids.slice(0, 120));
    o.auditChecked = audit.checked;
    o.auditClean = audit.clean;
    o.auditOffenders = audit.offenders.slice(0, 3);
  }

  // ── THE FLOAT ────────────────────────────────────────────────────────
  // A trader with no money must refuse, not conjure Cinder.
  try {
    const st = _fsStore();
    st.traders.medical.float = 0;
    const poor = FS.sellToTrader('medical', probe, 5);
    o.brokeRefuses = !poor.ok && poor.reason === 'trader_broke';
  } catch (e) { o.brokeRefuses = 'threw:' + e.message; }

  return o;
});

/* ── THE PANEL. An engine nobody can reach is not a feature. ─────────────── */
const ui = await pg.evaluate(() => {
  const o = {};
  try { localStorage.setItem('mg_onboarded', '1'); } catch (e) {}
  // Give the player something to sell, then open the shop.
  try {
    Profile.itemInventory = Profile.itemInventory || {};
    const ids = Object.keys(HELD_ITEMS).filter(id => id !== 'none').slice(0, 3);
    ids.forEach(id => { Profile.itemInventory[id] = 12; });
    o.seeded = ids;
    App.screen = 'cinderShop';
    App.fsTrader = 'general';
    render();
  } catch (e) { o.err = String(e).slice(0, 140); }
  return o;
});
await pg.waitForTimeout(1200);
const panel = await pg.evaluate(() => {
  const o = {};
  const p = document.querySelector('.fs-panel');
  o.mounted = !!p;
  if (!p) return o;
  o.tabs = document.querySelectorAll('[data-fs-trader]').length;
  o.rows = document.querySelectorAll('.fs-row').length;
  o.sellBtns = document.querySelectorAll('[data-fs-sell]').length;
  o.title = (document.querySelector('.csx-title') || {}).textContent || '';
  // Nothing painted outside the panel, and the row list scrolls if long.
  const rows = p.querySelector('.fs-rows');
  o.overflowY = rows ? getComputedStyle(rows).overflowY : null;
  return o;
});

/* ⚠ THE SELL HANDLER IS ASYNC NOW — it tries the SHARED shelf (sql/059) before
   falling back to the local inventory. A synchronous click-then-read saw the
   wallet unchanged and reported a failure that was purely the test's own
   timing. Click, then wait for it to settle. */
const sale = await pg.evaluate(async () => {
  const o = {};
  const btn = document.querySelector('[data-fs-sell]');
  if (!btn) return o;
  const id = btn.dataset.fsSell;
  o.before = { gems: Profile.gems | 0, have: (Profile.itemInventory || {})[id] | 0 };
  btn.click();
  await new Promise(r => setTimeout(r, 1500));
  o.after = { gems: Profile.gems | 0, have: (Profile.itemInventory || {})[id] | 0 };
  o.paid = o.after.gems - o.before.gems;
  o.tookGoods = o.after.have < o.before.have;
  return o;
});
Object.assign(panel, sale);

/* 🧺 ═══ THE TRADERS' SHELF ═══════════════════════════════════════════════
   The second-hand counter — what traders bought FROM PLAYERS and are reselling.
   It is invisible without a signed-in cloud, which means everything above this
   point tested none of it: the panel simply does not render offline, and a
   driver that only checked "no crash" would call that a pass forever.

   ⚠ THE CLOUD SEAM IS STUBBED, THE PANEL IS NOT. MythicFieldShop.shelfShared
     is replaced with a function returning the shape the real SELECT returns, so
     every line of the panel's markup, its tab strip and its buy handler run for
     real. Standing up Supabase to prove a list renders would be testing
     Supabase.
   ⚠ AND THE CONTROL IS THE OFFLINE CASE, which the run above already is: with
     no shelf the panel must be ABSENT, not empty. An empty second-hand counter
     shown to a signed-out player is a promise the build cannot keep. */
const shelf = await pg.evaluate(async () => {
  const o = {};
  const FS = window.MythicFieldShop;
  o.hasSeam = typeof FS.shelfShared === 'function';
  if (!o.hasSeam) return o;

  const shelfShown = () => Array.from(document.querySelectorAll('.fs-h1'))
    .some(x => /Traders/.test(x.textContent) && /Shelf/.test(x.textContent));

  /* CONTROL · no shared shelf ⇒ no panel at all.
     ⚠ THE RULE IS FORCED, NOT INFERRED FROM AMBIENT STATE. The first version
       just looked at the DOM before stubbing anything and called that "offline"
       — but this page boots with a Supabase client present, so isShared() was
       already true and the control was measuring the signed-IN case while
       claiming to measure the signed-out one. It failed, correctly, for a
       reason that had nothing to do with the panel. */
  const realIsShared = FS.isShared;
  FS.isShared = () => false;
  App._fsShelf = null; App._fsShelfLoading = false; App._fsShelfAt = 0;
  render();
  await new Promise(r => setTimeout(r, 500));
  o.absentWhenOffline = !shelfShown();
  FS.isShared = realIsShared;

  const ids = Object.keys(Profile.itemInventory || {});
  const A = ids[0] || 'medkit', B = ids[1] || 'fragGrenade';
  window.__shelfRows = [
    { itemId: A, traderId: 'general', stock: 4, costBasis: 300, at: '2026-08-26T00:00:00Z' },
    { itemId: B, traderId: 'general', stock: 2, costBasis: 900, at: '2026-08-26T00:00:00Z' },
  ];
  FS.shelfShared = async () => window.__shelfRows;
  // …and isShared(), which _fsShelfFetch asks BEFORE it starts a fetch.
  FS.isShared = () => true;
  FS.buyShared = async (tid, id, qty) => {
    const row = window.__shelfRows.find(x => x.itemId === id);
    if (!row || row.stock < qty) return { ok: false, reason: 'out_of_stock', shared: true };
    row.stock -= qty;
    return { ok: true, qty, unit: 345, total: 345 * qty, stock: row.stock, shared: true };
  };
  App._fsShelfAt = 0;                       // drop the 20 s cache
  render();
  await new Promise(r => setTimeout(r, 900));
  render();
  await new Promise(r => setTimeout(r, 400));

  const heads = Array.from(document.querySelectorAll('.fs-h1')).map(x => x.textContent);
  o.heads = heads;
  o.shown = heads.some(x => /Traders' Shelf/.test(x));
  o.buyBtns = document.querySelectorAll('[data-fsx-buy]').length;
  o.sourceCopy = Array.from(document.querySelectorAll('.fs-sub'))
    .map(x => x.textContent).find(x => /another player/.test(x)) || null;

  // Buying takes the money, gives the goods, and drops the shelf count.
  const btn = document.querySelector('[data-fsx-buy]');
  if (btn) {
    const id = btn.dataset.fsxBuy;
    Profile.gems = 500000;
    const g0 = Profile.gems | 0, h0 = (Profile.itemInventory || {})[id] | 0;
    btn.click();
    await new Promise(r => setTimeout(r, 1400));
    o.boughtId = id;
    o.spent = g0 - (Profile.gems | 0);
    o.gained = ((Profile.itemInventory || {})[id] | 0) - h0;
    o.shelfFell = (window.__shelfRows.find(x => x.itemId === id) || {}).stock === 3;
  }

  /* 🔴 CONTROL · the server refusing must NOT hand over an item. There is no
     local fallback on the buy side on purpose — buying locally out of a shelf
     that only exists on the server would be inventing the item. */
  FS.buyShared = async () => null;
  const btn2 = document.querySelector('[data-fsx-buy]');
  if (btn2) {
    const id2 = btn2.dataset.fsxBuy;
    const g1 = Profile.gems | 0, h1 = (Profile.itemInventory || {})[id2] | 0;
    btn2.click();
    await new Promise(r => setTimeout(r, 1200));
    o.refusedSpent = g1 - (Profile.gems | 0);
    o.refusedGained = ((Profile.itemInventory || {})[id2] | 0) - h1;
  }
  return o;
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
console.log('\n\u{1F3EA} FIELD SHOP — WIRING\n');
ok('the module mounted on window (else nothing below ran)', r.mounted === true);
if (r.mounted) {
  ok('the host attached (quotes are callable)', r.attached === true);
  ok('all six traders are present', r.traderCount === 6, r.traderCount + ' traders');
  console.log('   catalogue: ' + r.itemCount + ' items · categories emitted: ' +
              JSON.stringify(r.emitted) + '\n');

  console.log('  ── AGREEMENT · host resolver vs module vocabulary');
  ok('\u{1F3AF} the host emits no category the module has never heard of',
     (r.offVocab || []).length === 0, (r.offVocab || []).join(', ') || 'all in vocabulary');
  ok('\u{1F3AF} not one item in the catalogue is unsellable everywhere',
     r.unsellableCount === 0, r.unsellableCount ? (r.unsellableCount + ' e.g. ' + r.unsellable.join(', ')) : 'all sellable');
  ok('   CONTROL — a bogus category IS reported unsellable (the check can fail)',
     r.controlUnsellable === true);

  console.log('\n  ── A LIVE QUOTE');
  ok('a real item priced through the Crash Exchange', !!r.probeId, r.probeId || 'none found');
  if (r.q) {
    console.log('   ' + r.probeId + ' (' + r.q.cat + ') px ' + r.q.px +
                ' · stock ' + r.q.stock + ' · ' + r.q.tier + ' · bid ' + r.q.bid + ' / ask ' + r.q.ask);
    ok('\u{1F3AF} the ask is above the bid', r.askOverBid === true, r.q.ask + ' > ' + r.q.bid);
  }

  console.log('\n  ── THE LOOP, ON LIVE STATE');
  ok('the trader bought from the player', r.sold === 30 || (typeof r.sold === 'number' && r.sold > 0), String(r.sold));
  ok('its stock rose', r.stockRose === true);
  ok('a cost basis was recorded', r.basisSet === true);
  ok('the spread survived the purchase', r.askStillOverBid === true);
  ok('\u{1F3AF} buying it straight back COSTS the player money',
     r.roundTripLoses === true, r.roundTrip === null ? 'n/a' : ('+' + r.roundTrip + ' 🔥 out of pocket'));
  ok('\u{1F3AF} the live audit finds no profitable loop',
     r.auditClean === true, r.auditChecked + ' quotes checked' +
     (r.auditOffenders && r.auditOffenders.length ? ' :: ' + JSON.stringify(r.auditOffenders) : ''));

  console.log('\n  ── THE TILL');
  ok('\u{1F3AF} a trader with no Cinder REFUSES rather than conjuring it',
     r.brokeRefuses === true, String(r.brokeRefuses));

  console.log('\n  ── THE PANEL · can a player actually reach any of this?');
  ok('the shop is renamed', /Equipment & Field Shop/.test(panel.title || ''), (panel.title || '').trim());
  ok('\u{1F3AF} the Sell to a Trader panel rendered', panel.mounted === true, ui.err || '');
  ok('all six traders are pickable', panel.tabs === 6, panel.tabs + ' tabs');
  ok('the player\'s goods are listed', panel.rows > 0, panel.rows + ' rows');
  ok('the row list scrolls rather than clipping', panel.overflowY === 'auto', String(panel.overflowY));
  ok('\u{1F3AF} clicking Sell PAYS the player', (panel.paid | 0) > 0, '+' + (panel.paid | 0) + ' 🔥');
  ok('\u{1F3AF} …and TAKES the goods in the same tick', panel.tookGoods === true,
     panel.before ? (panel.before.have + ' → ' + panel.after.have) : 'n/a');

  console.log('\n  ── THE TRADERS\' SHELF · second-hand, sourced only from players');
  ok('the shelf seam exists (else nothing below ran)', shelf.hasSeam === true);
  if (shelf.hasSeam) {
    ok('\u{1F3AF} CONTROL · signed out, the panel is ABSENT — not an empty promise',
       shelf.absentWhenOffline === true);
    ok('\u{1F3AF} with a shelf, the panel renders', shelf.shown === true, JSON.stringify(shelf.heads));
    ok('every stocked line is buyable', (shelf.buyBtns | 0) >= 2, shelf.buyBtns + ' rows');
    ok('the copy says where the goods came from', /another player/.test(shelf.sourceCopy || ''),
       (shelf.sourceCopy || '').slice(0, 70));
    ok('\u{1F3AF} buying charges the SERVER\'s total', (shelf.spent | 0) === 345, shelf.spent + ' 🔥');
    ok('\u{1F3AF} …and hands over the goods', (shelf.gained | 0) === 1);
    ok('…and the shared shelf count falls', shelf.shelfFell === true);
    ok('\u{1F3AF} CONTROL · a server that does not answer gives NOTHING away',
       (shelf.refusedSpent | 0) === 0 && (shelf.refusedGained | 0) === 0,
       'spent ' + shelf.refusedSpent + ', gained ' + shelf.refusedGained);
  }

  console.log('\n   (trader stock is per-player in this build: shared=' + r.shared + ')');
}
console.log('\npage errors: ' + errs.length); errs.slice(0, 4).forEach(e => console.log('   ' + e));
console.log(fails ? ('\n' + fails + ' CHECK(S) FAILED') : '\nALL CHECKS PASSED');
await b.close(); s.close();
process.exit(fails ? 1 : 0);
