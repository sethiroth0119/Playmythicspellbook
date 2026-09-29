/* 📈🏢📰 v121v121 — the Crash Exchange stops charging above its own quote (the
   Foundation Reserve spread/slippage model is gone), every print in the game is
   recorded on one tape, the OPERATIONS desk lists player corporations priced
   off their real treasuries with a weekly report, and THE CRASH HERALD reports
   all of it. Run: node _cxdesk_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/133_corp_market.sql', 'utf8');

/* ── 1. the reserve is gone from the desk ── */
ok(!/% depth · spread 4% · slippage/.test(SRC) && !/cx-reserve-sub\'>' + fillPct/.test(SRC), 'the RESERVE depth / spread / slippage bar is gone from the screen');
ok(!/const quote = _cxQuoteBuy\(/.test(SRC) && !/const quote = _cxQuoteSell\(/.test(SRC), 'neither trade path quotes through the reserve any more');
ok(!/_cxReserveOnBuy\(id, qty, total\)/.test(SRC) && !/_cxReserveOnSell\(id, qty, net\)/.test(SRC), '…and neither moves a reserve pool');
ok(/const CX_TRADE_FEE = 0\.004;/.test(SRC) && /const CX_SELL_FEE  = 0\.006;/.test(SRC), 'the desk\'s whole take is two named constants');
ok(/📊 24H FLOW/.test(SRC) && /bought · ' \+ fl\.sells\.toLocaleString\(\) \+ ' sold/.test(SRC), 'the asset panel shows the 24h flow the tape recorded instead');

/* ── 2. the quote IS the charge ── */
ok(/function _cxFillPrice\(row, qty, dir\) \{/.test(SRC) && /return \{ px: Math\.max\(0\.01, Math\.sqrt\(pre \* post\)\), pre, post \};/.test(SRC), 'a fill is the average price the order walks through');
ok(/const quote = _cxQuoteOrder\(id, qty, \+1\);\n\s*const buyPx = quote\.px;/.test(SRC) && /const quoteS = _cxQuoteOrder\(id, qty, -1\);/.test(SRC), 'both trade paths price through the same quote function');
ok(/const _qB = tradable \? _cxQuoteOrder\(focus\.id, initQty, \+1\)/.test(SRC) && /const qt = _cxQuoteOrder\(focus\.id, q, \+1\);/.test(SRC), 'the trade boxes quote through it too, and requote as the size changes');
ok(/value="' \+ buyPxQ\.toFixed\(2\) \+ '" readonly/.test(SRC), 'the price box shows the quote rather than taking a typed number the charge ignored');

/* ── 3. the tape ── */
ok(/const CX_TAPE_CAP = 400;/.test(SRC) && /function _cxTapePush\(id, dir, qty, px, src\)/.test(SRC), 'one tape, capped');
ok(/function bumpMarketPriceUp\(id, qty, reason\) \{\n\s*try \{ const _tp = getMarketPrice\(id\); _cxTapePush\(id, \+1, qty, _tp && _tp\.current, reason \|\| 'buy'\); \}/.test(SRC)
  && /function dropMarketPriceDown\(id, qty, reason\) \{\n\s*try \{ const _tp = getMarketPrice\(id\); _cxTapePush\(id, -1, qty, _tp && _tp\.current, reason \|\| 'sell'\); \}/.test(SRC), 'every price writer in the game records what it did, with its reason');
ok(/function _cxFlow\(id, ms\)/.test(SRC) && /function _cxMovers\(ms, limit\)/.test(SRC), 'the flow and the movers are read off it');

/* ── 4. the corporation desk ── */
ok(/const CORP_SHARES_OUT = 10000;/.test(SRC) && /function _corpSharePx\(r\)/.test(SRC) && /function _corpBook\(r\)/.test(SRC), 'a share is priced off the corporation\'s own book');
ok(/const \{ data, error \} = await Cloud\.client\.rpc\('corp_market_list'\);/.test(SRC), 'the desk reads the aggregate register, not anybody\'s ledger');
ok(/rpc\('corp_share_trade', \{ p_corp_id: corpId, p_qty: qty, p_px: px \}\)/.test(SRC), 'a stake changes hands through the database');
ok(/\['ops',       'PLAYER CORPORATIONS'/.test(SRC) && /\(node === 'ops' \? _cxRenderOpsDesk\(\) : ''\)/.test(SRC), 'OPERATIONS lists the player corporations');
ok(/document\.querySelectorAll\('\[data-corp-buy\], \[data-corp-sell\]'\)/.test(SRC), 'its buy and sell buttons are wired');
ok(/security definer/.test(SQL) && /corp_market_list/.test(SQL) && /create policy cs_sel on public\.corp_shares for select to authenticated using \(holder_id = auth\.uid\(\)\)/.test(SQL), 'sql/133 publishes aggregates and keeps a holder\'s rows to the holder');
ok(/if v_new < 0 then raise exception/.test(SQL), '…and refuses a sale of shares the holder does not have, server-side');

/* ── 5. the newsroom ── */
ok(/function _cxHeraldStories\(\)/.test(SRC) && /THE CRASH HERALD/.test(SRC) && /data-cx-tab="news"/.test(SRC), 'the Crash Herald is a tab, written from the tape and the register');
ok(/Nothing here is invented\./.test(SRC), '…and says on the page where every line came from');

/* ── 6. run the maths for real ── */
{
  const g = {
    CX_PRICE_TICK_TRADE: 0.012, CX_PRICE_TICK_CRAFT: 0.008, CX_PRICE_MIN_FACTOR: 0.35, CX_PRICE_MAX_FACTOR: 3.50, CX_TRADE_FEE: 0.004, CX_SELL_FEE: 0.006,
    Math, Date, Object, Array, Number, String, isFinite,
  };
  const block = SRC.slice(SRC.indexOf('function _cxFillPrice(row, qty, dir) {'), SRC.indexOf('function bumpMarketPriceUp(id, qty, reason) {'));
  const api = new Function('g', 'with (g) { ' + block + ' return { cxImpactedPrice, _cxFillPrice }; }')(g);
  const row = { current: 100, base: 100, impactScale: 1 };
  const buy = api._cxFillPrice(row, 10, +1);
  const post = api.cxImpactedPrice(row, 10, +1, 'buy');
  ok(buy.pre === 100 && Math.abs(buy.post - post) < 1e-9 && buy.px > buy.pre && buy.px < buy.post,
    'run for real: 10 units of a 100 CR staple fill at ' + buy.px.toFixed(2) + ' — above the tile, below the mark the order leaves behind (' + buy.post.toFixed(2) + ')');
  /* the old model: post-impact mark × slippage(10/5000) × 1.04 */
  const oldPx = post * (1 + (10 / 5000) / (1 - 10 / 5000)) * 1.04;
  ok(buy.px < oldPx * 0.95, 'run for real: the same order cost ' + oldPx.toFixed(2) + ' under the reserve model and costs ' + buy.px.toFixed(2) + ' now', ((buy.px / oldPx - 1) * 100).toFixed(1) + '%');
  /* an instant round trip must be worth its fees and never a profit */
  const rowAfter = { current: buy.post, base: 100, impactScale: 1 };
  const sell = api._cxFillPrice(rowAfter, 10, -1);
  const paid = buy.px * 10 * 1.004, got = sell.px * 10 * 0.994;
  ok(got < paid && Math.abs(sell.px - buy.px) < 1e-6 && Math.abs(sell.post - 100) < 1e-6,
    'run for real: buy 10 then sell 10 pays ' + paid.toFixed(2) + ' and returns ' + got.toFixed(2) + ' — the fees, and the price is back where it started', (got - paid).toFixed(2));
}
{
  const block = SRC.slice(SRC.indexOf('const CORP_SHARES_OUT = 10000;'), SRC.indexOf('const CORP_RATING_COLOR'));
  const api = new Function('Math', block + '\nreturn { _corpBook, _corpSharePx, _corpWeekly };')(Math);
  /* the real register, read from the live database while this was built */
  const clarey = { treasury: 19582578, treasury_7d: 20396143, inflow_7d: 557908, outflow_7d: 1371473, vault_units: 27033, vault_kinds: 38, members: 6, ops_active: 23, float_held: 0 };
  const river  = { treasury: 4674387, treasury_7d: 62613, inflow_7d: 9800397, outflow_7d: 5188623, vault_units: 334352, members: 8, ops_active: 21, float_held: 0 };
  const empty  = { treasury: 0, treasury_7d: 0, inflow_7d: 0, outflow_7d: 0, vault_units: 0, members: 1, ops_active: 0, float_held: 0 };
  const pxC = api._corpSharePx(clarey), wC = api._corpWeekly(clarey);
  const pxR = api._corpSharePx(river), wR = api._corpWeekly(river);
  ok(Math.abs(pxC - 1997.35) < 1 && wC.rating === 'HOLD' && wC.delta < 0,
    'run for real: a 19.6M treasury with 27k units, 6 members and 23 ops prices at ' + pxC.toFixed(2) + ' a share and rates HOLD on a 4% dip', JSON.stringify({ pxC, r: wC.rating, pct: +wC.pct.toFixed(1) }));
  ok(pxR > 500 && wR.rating === 'STRONG BUY' && wR.earning === true,
    'run for real: a treasury that grew from 63k to 4.7M rates STRONG BUY', JSON.stringify({ pxR: +pxR.toFixed(2), r: wR.rating }));
  ok(api._corpWeekly(empty).rating === 'SPECULATIVE' && api._corpSharePx(empty) === 1,
    'run for real: one member, nothing running, no treasury → SPECULATIVE at the 1 CR floor');
  const crowded = Object.assign({}, clarey, { float_held: 10000 });
  ok(Math.abs(api._corpSharePx(crowded) / pxC - 1.75) < 0.01, 'run for real: a fully held float costs 75% more than an untouched one');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 121, 'BUILD_VERSION is v121v121 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
