/* 🛒 LUNI — the Player Market as a storefront.

   Asked for: "redesign our Player Market to look and function like eBay:
   items have their own pages showing the seller, ratings and comments, one
   image, price action, eBay-style auctions; keep every function; call it Luni."

   Defends, headless:
     · the pure helpers (listing lookup across all three stores, the price
       key, the seller id rule, the watchlist, the sparkline, the stars);
     · the item page: seller card, price/auction block, the SAME data-act
       buttons Browse binds, watchlist, price action, reviews form;
     · the header (logo, search + category, nav), the item / watch tabs, the
       tile → item-page opener with the 💎 chip kept for DVS;
     · the bid modal now finds cloud auctions;
     · sql/115: reviews table with RLS, buyer-only rating RPC, summary and
       price-history RPCs, grants;
     · Overrun's description tells it apart from Crush.

   Run: node _luni_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8');
function fnText(name) {
  const i = SRC.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('cannot find function ' + name);
  let d = 0, j = SRC.indexOf('{', i);
  for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}

console.log('\n=== 1. helpers ===');
{
  const store = {};
  const ctx = {
    Profile: { cloud: { userId: '11111111-2222-3333-4444-555555555555', signedIn: true }, gems: 100, sovereigns: 2 },
    CardMarket: { open: [{ id: 'c1', kind: 'card', cardId: 'goblin', item: { id: 'goblin', name: 'Goblin' }, sellerId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', sellerName: 'Rook', price: 50, listingType: 'fixed' }], mine: [] },
    ResMarket: { open: [{ id: 'r1', seller_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', seller_name: 'Rook', resource: 'metal', qty: 100, price: 5, currency: 'cinders', status: 'open', lot_size: 100, lots_total: 1, lots_left: 1, created_at: new Date().toISOString() }], mine: [] },
    Market: { listings: [{ id: 'n1', kind: 'item', item: { id: 'potion', name: 'Potion' }, sellerId: 'npc_tinker', sellerName: 'Tinker', price: 9 }], salesLog: [{ cardId: 'goblin', price: 40, currency: 'cinders', at: Date.now() - 1000 }] },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    _meta: (id) => ({ id, name: 'Metal', icon: '⛓️' }), _resLots: (r) => ({ lotSize: r.lot_size, lotsTotal: r.lots_total, lotsLeft: r.lots_left, unitsLeft: r.lot_size * r.lots_left, unitsTotal: r.lot_size }),
    console, Date, Math, JSON, String, Number, Array, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(['_luniUid', '_luniWatchKey', '_luniWatchList', '_luniWatched', '_luniToggleWatch', '_luniFindListing', '_luniKeyOf', '_luniSellerUid', '_luniLocalSales', '_luniStars', '_luniAgo', '_luniSparkline', '_resListingToTile'].map(fnText).join('\n'), ctx);
  const run = (c) => vm.runInContext(c, ctx);
  ok(run("_luniFindListing('c1').item.name") === 'Goblin' && run("_luniFindListing('r1')._resource") === true && run("_luniFindListing('n1').sellerName") === 'Tinker' && run("_luniFindListing('zz')") === null, 'a listing is found in the card store, the resource store or the local store');
  ok(JSON.stringify(run("_luniKeyOf(_luniFindListing('c1'))")) === '{"kind":"card","ref":"goblin"}' && JSON.stringify(run("_luniKeyOf(_luniFindListing('r1'))")) === '{"kind":"res","ref":"metal"}' && JSON.stringify(run("_luniKeyOf(_luniFindListing('n1'))")) === '{"kind":"item","ref":"potion"}', 'price keys: card id, resource id, item id');
  ok(run("_luniSellerUid(_luniFindListing('c1'))") === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' && run("_luniSellerUid(_luniFindListing('n1'))") === null && run("_luniSellerUid({ sellerId: 'player' })") === '11111111-2222-3333-4444-555555555555', 'seller uid: a real account id, never an NPC, "player" = me');
  ok(run("_luniToggleWatch('c1')") === true && run("_luniWatched('c1')") === true && run("_luniToggleWatch('c1')") === false && run("_luniWatched('c1')") === false && run("_luniWatchKey()") === 'luni_watch:11111111-2222-3333-4444-555555555555', 'the watchlist toggles and is keyed by account');
  ok(run("_luniLocalSales({ kind: 'card', ref: 'goblin' }).length") === 1 && run("_luniLocalSales({ kind: 'card', ref: 'other' }).length") === 0, 'local sales feed the chart too');
  const spark = run("_luniSparkline([{ price: 10, at: 1 }, { price: 20, at: 2 }, { price: 15, at: 3 }])");
  ok(/<svg class="luni-spark"/.test(spark) && /luni-spark-line/.test(spark) && /luni-spark-dot/.test(spark) && run("_luniSparkline([{ price: 10, at: 1 }])") === '', 'a sparkline needs two sales; one sale draws nothing');
  ok((run("_luniStars(4.5)").match(/luni-star on/g) || []).length === 4 && /luni-star half/.test(run("_luniStars(4.5)")), 'stars: 4.5 is four full and a half');
}

console.log('\n=== 2. the item page and the storefront ===');
{
  const it = fnText('renderLuniItem');
  ok(/marketTileVisual\(l\)/.test(it) && /luni-gallery-img/.test(it), 'one image, the one the game already uses for the listing');
  ok(/luni-seller/.test(it) && /_luniStars\(sum\.avg\)/.test(it) && /% positive/.test(it) && /sold<\/div>/.test(it), 'seller card with stars, % positive, ratings count and items sold');
  ok(/data-act="bid"/.test(it) && /data-act="buynow"/.test(it) && /data-act="buy"/.test(it) && /data-act="history"/.test(it), 'the page uses the same buy / bid / buy-now / history actions Browse binds');
  ok(/data-auction-timer="\$\{escapeHtml\(l\.id\)\}"/.test(it) && /current bid/.test(it) && /starting bid/.test(it) && /top bidder/.test(it), 'auctions show the live countdown, bid count and top bidder');
  ok(/data-luni-watch=/.test(it) && /Add to Watchlist/.test(it), 'watchlist button');
  ok(/📈 Price action/.test(it) && /_luniSparkline\(use\)/.test(it) && /30-day average/.test(it) && /vs average/.test(it), 'price action: sparkline, last sold, 30-day average, range, this listing vs average');
  ok(/id="luni-rate-form"/.test(it) && /name="luni-stars"/.test(it) && /maxlength="280"/.test(it) && /!isMine && _luniUid\(\)/.test(it), 'a rating form with 1–5 stars and a 280-char comment, never on your own listing');
  ok(/Similar listings/.test(it) && /App\._luniBrowse/.test(it), 'similar listings from the same board');
  const hd = fnText('_luniHeaderHtml');
  ok(/luni-logo/.test(hd) && /id="luni-search"/.test(hd) && /id="luni-cat"/.test(hd) && /luni-search-btn/.test(hd) && /luni-nav/.test(hd) && /Watchlist/.test(hd) && /🔨 Auctions/.test(hd) && /Buy It Now/.test(hd), 'storefront header: logo, search with category, nav with Watchlist, Auctions, Buy It Now');
  ok(/else if \(tab === 'watch'\) body = /.test(SRC) && /else if \(tab === 'item'\) body = renderLuniItem\(\);/.test(SRC), 'renderMarket has the Watchlist and item tabs');
  ok(/else if \(filter === 'res'\) filtered = filtered\.filter\(l => !!l\._resource\);/.test(SRC), 'the Resources category filters the board');
  ok(/function bindLuniTiles\(fromTab\)/.test(SRC) && /if \(e\.target\.closest\('button, a, input, select, \[data-dvs-card\]'\)\) return;/.test(SRC), 'a tile opens its item page unless a button or the 💎 chip was clicked');
  ok(/const dvsAttr = '';/.test(SRC) && /<div class="dvs-tile-score" data-dvs-card=/.test(SRC), 'the Valuation opener moved to the score chip');
  const bm = fnText('renderBidModal');
  ok(/const l = _luniFindListing\(App\._bidModalListingId\);/.test(bm), 'the bid modal finds cloud auctions (it only searched the local store before)');
  ok(/\.mkt-page \.forge-tabs \{ display: none; \}/.test(SRC) && /\.mkt-page\.is-item \.luni-intro \{ display: none; \}/.test(SRC), 'old tab bar hidden behind the nav; intro hidden on item pages');
  ok(/rpc\('luni_seller_summary', \{ p_seller: uid \}\)/.test(SRC) && /rpc\('luni_price_history', \{ p_kind: key\.kind, p_ref: key\.ref, p_days: 30 \}\)/.test(SRC) && /rpc\('luni_rate', \{ p_seller: rf\.dataset\.seller/.test(SRC), 'the three RPCs are called with the right names');
  ok(/Crush sends it to the enemy hero instead/.test(SRC), 'Overrun says how it differs from Crush');
}

console.log('\n=== 3. sql/115 ===');
{
  const q = readFileSync('./sql/115_luni_market.sql', 'utf8');
  ok(/create table if not exists public\.luni_reviews/.test(q) && /stars between 1 and 5/.test(q) && /char_length\(comment\) <= 280/.test(q) && /luni_reviews_not_self check \(seller_id <> rater_id\)/.test(q), 'reviews table: 1–5 stars, 280 chars, never yourself');
  ok(/enable row level security/.test(q) && /revoke insert, update, delete on public\.luni_reviews from anon, authenticated/.test(q), 'clients read reviews; only the RPC writes');
  ok(/if not public\._luni_bought_from\(me, p_seller\) then return jsonb_build_object\('ok', false, 'reason', 'no_purchase'\)/.test(q), 'only a buyer can rate a seller');
  ok(/on conflict \(rater_id, seller_id, listing_id\) do update/.test(q), 'a re-rating updates instead of stacking');
  ok(/function public\.luni_seller_summary\(p_seller uuid\)/.test(q) && /'positive'/.test(q) && /'sold'/.test(q) && /'recent'/.test(q), 'seller summary: avg, count, % positive, sold, recent comments');
  ok(/function public\.luni_price_history\(p_kind text, p_ref text, p_days integer default 30\)/.test(q) && /c\.status = 'sold' and c\.card_id = p_ref/.test(q) && /e\.kind = 'sale' and e\.resource = p_ref/.test(q) && /limit 200/.test(q), 'price history: sold cards and resource sales, capped');
  ok(/grant execute on function public\.luni_rate/.test(q) && /revoke all on function public\._luni_bought_from\(uuid, uuid\) from public, anon, authenticated/.test(q), 'grants: players call the three RPCs, the purchase check stays internal');
}
ok(/window\.BUILD_VERSION = 'v12[1-9]v\d+'/.test(SRC), 'build version present');

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
