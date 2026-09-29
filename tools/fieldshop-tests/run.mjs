/* ══════════════════════════════════════════════════════════════════════════
   🏪 EQUIPMENT & FIELD SHOP — the loop sweep

   The brief: "Run automated checks against every price update to detect
   profitable infinite buy/sell loops." This is that check, and it is the
   reason the pricing core is a pure module — every quote can be driven
   directly, so the sweep is exhaustive rather than a spot check.

   ⚠ IT PROVES IT CAN FAIL. The brief's ORIGINAL rule (list at cost basis ×
     1.15, ignoring the live bid) is re-implemented here as a control and swept
     with the same grid. It finds thousands of profitable round trips. If the
     control ever came back clean, this sweep would not be measuring anything
     and the run says so instead of passing.

   Run:  node tools/fieldshop-tests/run.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import T from '../../public/src/fieldshop/traders.js';

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

console.log('\n\u{1F3EA} EQUIPMENT & FIELD SHOP — PRICING\n');

/* ── 1. The bands and the worked examples from the brief ─────────────────── */
ok('stock 32 is HIGH demand', T.demandTier(32) === 'high', T.demandTier(32));
ok('stock 75 is NORMAL demand', T.demandTier(75) === 'normal', T.demandTier(75));
ok('stock 145 is OVERSTOCKED', T.demandTier(145) === 'over', T.demandTier(145));

const M = 1000;
const q32 = T.buyQuote(M, 32, 'medical', 'medical');
const q75 = T.buyQuote(M, 75, 'medical', 'medical');
const q145 = T.buyQuote(M, 145, 'medical', 'medical');
console.log('\n   the brief\'s worked example, 1,000 🔥 Advanced Medkit at a Medical Trader');
console.log('     32 in stock  → offer ' + q32 + ' 🔥   (brief: ~1,100)');
console.log('     75 in stock  → offer ' + q75 + ' 🔥   (brief: ~1,000)');
console.log('    145 in stock  → offer ' + q145 + ' 🔥   (brief: ~800)\n');
ok('low stock pays a premium over market', q32 > M, q32 + ' > ' + M);
ok('normal stock pays about market', q75 === M, String(q75));
ok('overstocked pays under market', q145 < M, q145 + ' < ' + M);
ok('145 units lands on the brief\'s ~800', q145 === 800, String(q145));
ok('the curve is monotonic — more stock never pays more',
   q32 > q75 && q75 > q145);

/* ── 1b. 🔴 THE VOCABULARY GUARD ──────────────────────────────────────────
   The first version of this module specialised traders in 'medicine',
   'healing', 'protective', 'damaged' — none of which the game can produce, so
   every trader refused almost everything. It went unnoticed because THIS TEST
   invented the same fictional categories. These three checks make the module
   and the test agree with each other on a single list, so the same mistake
   cannot hide in both places again. The host side is asserted separately, in
   the browser driver, against index.html's own resolver. */
const declared = new Set();
for (const id of T.TRADER_IDS) {
  T.TRADERS[id].primary.forEach(c => declared.add(c));
  T.TRADERS[id].secondary.forEach(c => declared.add(c));
}
const unknown = [...declared].filter(c => T.CATEGORIES.indexOf(c) < 0);
ok('no trader specialises in a category outside the vocabulary',
   unknown.length === 0, unknown.join(', ') || T.CATEGORIES.length + ' categories');
const orphan = T.CATEGORIES.filter(c => !T.TRADER_IDS.some(t => T.accepts(t, c)));
ok('every category has at least one trader who will buy it',
   orphan.length === 0, orphan.join(', ') || 'all covered');
const noPrimary = T.CATEGORIES.filter(c =>
  !T.TRADER_IDS.some(t => T.TRADERS[t].primary.indexOf(c) >= 0));
ok('every category has a SPECIALIST who pays top rate (else travel is pointless)',
   noPrimary.length === 0, noPrimary.join(', ') || 'all specialised');

/* ── 2. Specialization ───────────────────────────────────────────────────── */
const med = T.buyQuote(M, 40, 'medical', 'medical');
const gen = T.buyQuote(M, 40, 'general', 'medical');
const sal = T.buyQuote(M, 40, 'salvage', 'medical');
console.log('   a medical device, 40 in stock everywhere:');
console.log('     Medical Trader ' + med + ' 🔥 · General ' + gen + ' 🔥 · Salvage ' +
            (sal === 0 ? 'REFUSES' : sal + ' 🔥') + '\n');
ok('the specialist pays best', med > gen, med + ' > ' + gen);
ok('the generalist pays less than the specialist', gen > 0 && gen < med);
ok('the salvage trader refuses medical goods', sal === 0);
ok('…but takes scrap at its best rate',
   T.buyQuote(M, 40, 'salvage', 'scrap') > T.buyQuote(M, 40, 'general', 'scrap'));

/* ── 3. Cost basis — the brief's batch example ───────────────────────────── */
let lot = { stock: 0, costBasis: 0 };
lot = T.acquire(lot, 50, 900);
lot = T.acquire(lot, 25, 1000);
lot = T.acquire(lot, 25, 1100);
const wavg = (50 * 900 + 25 * 1000 + 25 * 1100) / 100;
ok('weighted average cost basis over three batches',
   Math.abs(lot.costBasis - wavg) < 1e-9, lot.costBasis.toFixed(2) + ' vs ' + wavg.toFixed(2));
ok('…and stock is the sum', lot.stock === 100, String(lot.stock));
const after = T.release(lot, 40);
ok('selling does not re-price what remains',
   after.stock === 60 && Math.abs(after.costBasis - wavg) < 1e-9,
   after.stock + ' left at ' + after.costBasis.toFixed(2));

/* ── 4. 🔴 THE SWEEP — is any same-trader round trip profitable? ─────────── */
/* The control is the brief's rule as literally written. */
const controlSell = (costBasis) => Math.max(1, Math.ceil(costBasis * (1 + T.SHOP.markup)));

const CATS = T.CATEGORIES;
const PRICES = [12, 60, 150, 400, 1000, 2500, 9000];
const STOCKS = [];
for (let s = 0; s <= 400; s += 1) STOCKS.push(s);
/* Cost bases spanning everything a trader could plausibly hold: bought while
   overstocked, at par, and while desperate. */
const BASIS_MULT = [0.35, 0.5, 0.8, 1.0, 1.15, 1.25, 2.0];

let checked = 0, shipBad = [], ctlBad = 0;
for (const tid of T.TRADER_IDS) {
  for (const cat of CATS) {
    if (!T.accepts(tid, cat)) continue;
    for (const px of PRICES) {
      for (const bm of BASIS_MULT) {
        const basis = px * bm;
        for (const st of STOCKS) {
          checked++;
          const r = T.auditRoundTrip(basis, px, st, tid, cat);
          if (r.profitable) shipBad.push(tid + '/' + cat + ' px' + px + ' basis' + Math.round(basis) +
                                         ' stock' + st + ' ask' + r.ask + ' bid' + r.bid);
          // control: list off the cost basis alone, exactly as specified
          const cAsk = controlSell(basis);
          const cBid = T.buyQuote(px, Math.max(0, st - 1), tid, cat);
          if (cBid > cAsk) ctlBad++;
        }
      }
    }
  }
}
console.log('   swept ' + checked.toLocaleString() + ' (trader × category × price × cost-basis × stock) combinations\n');
ok('   CONTROL — the brief\'s literal rule DOES print Cinder (proves the sweep works)',
   ctlBad > 0, ctlBad.toLocaleString() + ' profitable round trips');
ok('\u{1F3AF} SHIPPED — not one profitable same-trader round trip',
   shipBad.length === 0, shipBad.length ? shipBad.slice(0, 3).join(' | ') : checked.toLocaleString() + ' clean');

/* Every round trip should lose about the markup. */
let worst = -Infinity;
for (const tid of T.TRADER_IDS) for (const cat of CATS) {
  if (!T.accepts(tid, cat)) continue;
  for (const st of [0, 25, 50, 51, 75, 100, 101, 145, 300]) {
    const r = T.auditRoundTrip(1000 * 0.8, 1000, st, tid, cat);
    if (!r.refused && r.ask > 0) worst = Math.max(worst, r.profit / r.ask);
  }
}
ok('the worst case still loses at least 10% of the ask',
   worst <= -0.10, 'worst round trip = ' + (worst * 100).toFixed(1) + '%');

/* ── 5. The trader's float — it cannot pay with money it does not have ──── */
ok('a broke trader buys nothing', T.affordableQty(0, 500, 10) === 0);
ok('a trader buys only what it can pay for', T.affordableQty(1200, 500, 10) === 2,
   String(T.affordableQty(1200, 500, 10)));
ok('a rich trader takes the whole lot', T.affordableQty(999999, 500, 10) === 10);

/* ── 6. Hostile input ────────────────────────────────────────────────────── */
const hostile = [NaN, Infinity, -Infinity, -5, null, undefined, '12', {}];
let bad = null;
for (const v of hostile) {
  for (const fn of [
    () => T.buyQuote(v, 10, 'medical', 'medical'),
    () => T.sellQuote(v, 1000, 10, 'medical', 'medical'),
    () => T.demandMultiplier(v),
    () => T.acquire({ stock: v, costBasis: v }, 5, v).costBasis,
  ]) {
    let out; try { out = fn(); } catch (e) { bad = String(v) + ' THREW ' + e.message; break; }
    if (typeof out === 'number' && !isFinite(out)) { bad = String(v) + ' → ' + out; break; }
  }
  if (bad) break;
}
ok('hostile input never yields NaN/Infinity and never throws', bad === null, bad || 'clean');

console.log('');
if (fails) { console.log('❌ ' + fails + ' CHECK(S) FAILED'); process.exit(1); }
console.log('✅ FIELD SHOP: all checks green');
