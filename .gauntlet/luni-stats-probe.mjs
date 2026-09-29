/* ══════════════════════════════════════════════════════════════════════════
   LUNI MARKET STATS PROBE. Owner: "Add this to the player market Luni. Make
   different versions that fit for Resources and items" (Set / Supply / For Sale
   / Market Price / Lowest Ask / Last Sale / 7-Day / 30-Day / All-Time High /
   Copies sold today).
   Feeds the REAL _luniStatsModel / _luniStatsHtml a known sales history and a
   known board, and checks every number against arithmetic done here:
     CARD      set + serial supply, for-sale count, median market price, lowest
               ask, last sale, 7d / 30d change, all-time high, sold today;
     RESOURCE  every price per UNIT (lot of 5), for-sale in units, units sold;
     ITEM      no feed: asks only, and "—" where there is no sale.
   Also: an Aza sale is never averaged into a Cinder price.
   Usage: node .gauntlet/luni-stats-probe.mjs <candidate.html> [--url base]
   Needs the `public` preview server (8787). Exit 0 / 1 / 2.
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import fs from 'node:fs';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('usage: luni-stats-probe.mjs <candidate.html>'); process.exit(2); }
const BASE = (() => { const i = process.argv.indexOf('--url'); return i > 0 ? process.argv[i + 1] : 'http://localhost:8787'; })();
const html = fs.readFileSync(file, 'utf8');
if (!html.includes('_luniStatsModel')) { console.log(JSON.stringify({ ok: false, missing: 'the stats panel is not in this file' })); process.exit(2); }
const browser = await chromium.launch();
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
await page.route(/\/(index\.html)?(\?.*)?$/, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === '/' || u.pathname === '/index.html') return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  return route.continue();
});
let R;
try {
  await page.goto(BASE + '/index.html', { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => typeof _luniStatsModel === 'function', null, { timeout: 30000 });
  R = await page.evaluate(() => {
    const DAY = 86400000, now = Date.now();
    const ago = (d, h) => now - d * DAY - (h || 0) * 3600000;
    /* ── CARD ── */
    const CID = 'pl_card';
    Forge.cardSets = (Forge.cardSets || []).filter(x => x.id !== 'pl_set').concat([{ id: 'pl_set', name: 'Fall of El Paso', cardIds: [CID] }]);
    Serial.byCard = Object.assign({}, Serial.byCard || {}, { [CID]: { card_id: CID, claimed: 2841, total: 500000, kind: 'catalogue' } });
    const mkSale = (d, price, cur, qty) => ({ price, currency: cur || 'cinders', qty: qty || 1, at: ago(d, 1) });
    Luni.histYear['card:' + CID] = { rows: [
      mkSale(0, 1810), mkSale(0, 1850), mkSale(2, 1790), mkSale(5, 1830),   // last 7 days  → avg 1820
      mkSale(8, 1700), mkSale(10, 1660),                                     // days 7–14     → avg 1680
      mkSale(20, 1500), mkSale(35, 1400), mkSale(40, 1380), mkSale(200, 2680),
      mkSale(1, 99999, 'aza'),                                               // must be ignored
    ] };
    const cardL = (id, price, extra) => Object.assign({ id, sellerId: 's' + id, kind: 'card', cardId: CID, item: { id: CID, name: 'El Paso Card' }, price, priceCurrency: 'cinders' }, extra || {});
    App._luniBrowse = [cardL('a', 1775), cardL('b', 1900), cardL('c', 1840), cardL('d', 50, { priceCurrency: 'aza' })];
    const c = _luniStatsModel(App._luniBrowse[0], { kind: 'card', ref: CID });
    const cHtml = _luniStatsHtml(App._luniBrowse[0], { kind: 'card', ref: CID });
    /* ── RESOURCE (lots of 5) ── */
    Luni.histYear['res:ore'] = { rows: [ { price: 12, currency: 'cinders', qty: 10, at: ago(0, 2) }, { price: 10, currency: 'cinders', qty: 5, at: ago(3) } ] };
    const resL = (id, price, lots) => ({ id, sellerId: 's' + id, kind: 'item', _resource: true, _lotSize: 5, _lotsLeft: lots, item: { id: 'res_ore', name: '5 Ore' }, price, priceCurrency: 'cinders' });
    App._luniBrowse = [resL('r1', 60, 3), resL('r2', 55, 2)];
    const r = _luniStatsModel(App._luniBrowse[0], { kind: 'res', ref: 'ore' });
    const rHtml = _luniStatsHtml(App._luniBrowse[0], { kind: 'res', ref: 'ore' });
    /* ── ITEM ── */
    const itL = (id, price) => ({ id, sellerId: 's' + id, kind: 'item', item: { id: 'pl_sword', name: 'Rusty Blade', rarity: 'rare', slot: 'weapon' }, price, priceCurrency: 'cinders' });
    App._luniBrowse = [itL('i1', 300), itL('i2', 250)];
    const i = _luniStatsModel(App._luniBrowse[0], { kind: 'item', ref: 'pl_sword' });
    const iHtml = _luniStatsHtml(App._luniBrowse[0], { kind: 'item', ref: 'pl_sword' });
    const text = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.innerText; };
    return { c, r, i, cText: text(cHtml), rText: text(rHtml), iText: text(iHtml) };
  });
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e), pageErrors }));
  await browser.close(); process.exit(2);
}
await browser.close();
const f = [], near = (a, b) => a != null && Math.abs(a - b) < 0.06;
const { c, r, i } = R;
/* card: last 10 within 30d = 1810,1850,1790,1830,1700,1660,1500 → sorted median = 1790 */
if (c.setName !== 'Fall of El Paso') f.push('card: set');
if (c.supply !== 2841) f.push('card: supply from the serial register');
if (c.forSale !== 4) f.push('card: for sale counts every open listing');
if (c.market !== 1790) f.push('card: market price is the median of recent Cinder sales (' + c.market + ')');
if (c.lowestAsk !== 1775) f.push('card: lowest Cinder ask (Aza listing excluded)');
if (!c.last || c.last.price !== 1810 && c.last.price !== 1850) f.push('card: last sale is the newest Cinder sale');
if (!near(c.d7, ((1820 - 1680) / 1680) * 100)) f.push('card: 7-day change (' + c.d7 + ')');
if (c.ath !== 2680) f.push('card: all-time high (Aza sale ignored)');
if (c.soldToday !== 2) f.push('card: copies sold today');
if (!/Fall of El Paso/.test(R.cText) || !/\$/.test(R.cText)) f.push('card: panel shows the set and a $ price');
if (r.forSale !== 25) f.push('res: for sale in UNITS (3 lots×5 + 2 lots×5)');
if (r.lowestAsk !== 11) f.push('res: lowest ask per unit (55/5)');
if (r.soldToday !== 10) f.push('res: units sold today');
if (!/Units sold today/.test(R.rText) || !/\/ unit/.test(R.rText)) f.push('res: resource wording');
if (i.forSale !== 2 || i.lowestAsk !== 250 || i.last !== null || i.ath !== null) f.push('item: asks only, no invented sales');
if (!/Rusty Blade/.test(R.iText) || !/—/.test(R.iText)) f.push('item: item wording with — for no data');
console.log(JSON.stringify({ ok: !f.length, fails: f, card: c, res: r, item: i, pageErrors: pageErrors.slice(0, 5) }, null, 1));
process.exit(f.length ? 1 : 0);
