/* ══════════════════════════════════════════════════════════════════════════
   🏪 FIELD SHOP — the client and the server must price IDENTICALLY

   The pricing exists twice: /src/fieldshop/traders.js draws the screen, and
   sql/059's _fs_bid/_fs_ask decide what the server actually pays. Duplication
   is unavoidable — the server must not take a price from a client — so the
   duplication is TESTED instead of trusted.

   🔴 THIS ALREADY CAUGHT A REAL DIVERGENCE. JavaScript prices in binary
   floating point; Postgres prices in `numeric`, which is exact. 1000 × 1.0 ×
   0.82 is 819.9999999999999 as a double and exactly 820 as a numeric, so a
   bare Math.floor() paid the player one Cinder less than the server did — 210
   Cinder of drift across this grid, on prices the player can SEE. traders.js
   now floors and ceils with a 1e-9 nudge; this is what proves it worked.

   ⚠ THE EXPECTED VALUES ARE MEASURED FROM THE LIVE DATABASE, NOT DERIVED HERE.
     Re-deriving them in JS would compare JavaScript against itself and pass no
     matter how far the server drifted. To refresh them after a deliberate
     pricing change, run this against the database and paste the row back in:

       select count(*),
              sum(public._fs_bid(1000, s.v, tc.trader_id, tc.category)),
              sum(public._fs_ask(800, 1000, s.v, tc.trader_id, tc.category)),
              sum(public._fs_bid(1000, s.v, tc.trader_id, tc.category) * s.v)
         from generate_series(0, 400) s(v)
         cross join (select trader_id, category from public.fieldshop_trader_cat) tc;

   Run:  node tools/fieldshop-tests/crosscheck.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import T from '../../public/src/fieldshop/traders.js';

/* Measured on ktsiasyjusesawtrwrjc, 2026-08-25, after sql/059 was applied.
   Three independent aggregates so two offsetting errors cannot cancel out. */
const SQL = {
  pairs: 42,
  points: 16842,
  sumBid: 9590602n,
  sumAsk: 16228282n,
  sumBidXStock: 1422233988n,
};

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };

const pairs = [];
for (const t of T.TRADER_IDS) for (const c of T.CATEGORIES) if (T.accepts(t, c)) pairs.push([t, c]);

let points = 0, sumBid = 0n, sumAsk = 0n, sumBidXStock = 0n;
for (const [t, c] of pairs) {
  for (let s = 0; s <= 400; s++) {
    points++;
    const bid = T.buyQuote(1000, s, t, c);
    const ask = T.sellQuote(800, 1000, s, t, c);
    sumBid += BigInt(bid); sumAsk += BigInt(ask); sumBidXStock += BigInt(bid) * BigInt(s);
  }
}

console.log('\n\u{1F3EA} FIELD SHOP — CLIENT vs SERVER PRICING\n');
ok('the same trader×category pairs exist on both sides', pairs.length === SQL.pairs,
   'JS ' + pairs.length + ' / SQL ' + SQL.pairs);
ok('the same number of grid points', points === SQL.points, 'JS ' + points + ' / SQL ' + SQL.points);
ok('\u{1F3AF} sum of every BID matches the server exactly', sumBid === SQL.sumBid,
   'JS ' + sumBid + ' / SQL ' + SQL.sumBid);
ok('\u{1F3AF} sum of every ASK matches the server exactly', sumAsk === SQL.sumAsk,
   'JS ' + sumAsk + ' / SQL ' + SQL.sumAsk);
ok('\u{1F3AF} …and the stock-weighted sum too (catches offsetting errors)',
   sumBidXStock === SQL.sumBidXStock, 'JS ' + sumBidXStock + ' / SQL ' + SQL.sumBidXStock);

console.log('');
if (fails) {
  console.log('❌ ' + fails + ' CHECK(S) FAILED — the screen and the server would show different prices.');
  console.log('   Either traders.js changed and sql/059 did not, or the reverse.');
  process.exit(1);
}
console.log('✅ CROSS-CHECK: client and server price identically across ' +
            SQL.points.toLocaleString() + ' grid points');
