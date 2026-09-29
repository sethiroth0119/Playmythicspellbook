/* 📈 v121v107 — the Crash/Exchange on the REAL shared tape (sql/131).
   Owner: "make it look and feel like a real stock market where it shows the
   1 hour and all-time highs and real data vs all the players."
   Run: node _cxtape_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const SQL = readFileSync('./sql/131_cx_price_history.sql', 'utf8').replace(/\r\n/g, '\n');

/* ── the server tape ── */
ok(/create table if not exists public\.cx_price_history \(/.test(SQL) && /create trigger cx_prices_history after insert or update on public\.cx_prices/.test(SQL), 'sql/131: a history table fed by a trigger on every shared price change');
ok(/if tg_op = 'UPDATE' and old\.current_px is not distinct from new\.current_px then return new; end if;/.test(SQL), '…that skips writes where the price did not move');
ok(/create policy cxh_sel on public\.cx_price_history for select to authenticated using \(true\);/.test(SQL) && !/for insert/.test(SQL.slice(SQL.indexOf('cx_price_history enable row level security'), SQL.indexOf('_cx_price_history_append'))), 'read-only to players; no client insert policy');
ok(/function public\.cx_history\(p_asset text, p_seconds integer default 86400\)/.test(SQL) && /ceil\(w\.n \/ 400\.0\)/.test(SQL), 'cx_history downsamples a range to ~400 points');
ok(/function public\.cx_stats\(p_asset text\)/.test(SQL) && /interval '1 hour'/.test(SQL) && /order by px desc, at asc limit 1/.test(SQL), 'cx_stats: 1 h / 24 h high-low, all-time high with its date, the price 24 h ago');
ok(/function public\.cx_stats_all\(\)/.test(SQL) && /spark double precision\[\]/.test(SQL), 'cx_stats_all: the same per asset plus a 16-point spark');

/* ── the client ── */
ok(/const CXHist = \{ series: \{\}, stats: \{\}, all: null, allAt: 0, inflight: \{\} \};\nconst CX_HIST_TTL_MS = 60000;/.test(SRC), 'a 60 s cache with one fetch in flight per key');
ok(/function _cxGetHistory\(id, range, opts\) \{[\s\S]{0,700}?if \(e && e\.rows && e\.rows\.length >= 2\) \{\n\s*const px = e\.rows\.map\(r => r\.px\);/.test(SRC), 'the chart draws the shared tape when it has two points for the range');
ok(/function _cxDelta24\(id, p\) \{[\s\S]*?s\.px24ago > 0[\s\S]*?\(\(p\.current - s\.px24ago\) \/ s\.px24ago\) \* 100/.test(SRC), '24 h change is measured against the shared price 24 h ago');
ok((SRC.match(/delta: _cxDelta24\(/g) || []).length === 5 && !/delta: p\.delta24h/.test(SRC), 'every market and portfolio row uses it (5 sites; the base-price delta is gone)');
ok(/'<div class="cx-tb-ind" title="Highest and lowest shared price in the last hour">1H <b>' \+ _cxFmt\(st\.h1\)/.test(SRC), 'the toolbar shows the 1 H high / low');
ok(/ATH <b style="color:#b6f0c8">' \+ _cxFmt\(st\.ath\)/.test(SRC) && /set ' \+ _athDate/.test(SRC) && /ATL <b style="color:#e8b6b6">' \+ _cxFmt\(st\.atl\)/.test(SRC), '…and the all-time high (with its date) and low');
ok(/range \+ ' HIGH <b>' \+ _cxFmt\(high\)/.test(SRC) && /● LIVE/.test(SRC), '…the range high/low, and a LIVE mark when the line is the shared tape');
ok(/const sparkData = \(_sst && _sst\.spark && _sst\.spark\.length >= 2\) \? _sst\.spark : _cxGetHistory\(r\.id, 'ALL', \{ local: true \}\)\.slice\(-30\);/.test(SRC), 'table sparks are the shared 24 h spark; the local tape only as a fallback and never a fetch per row');
ok(/function renderCrashExchange\(\) \{\n  try \{ _cxFetchStatsAll\(\); \} catch \(e\) \{\}/.test(SRC), 'opening the exchange asks for every asset\'s stats once a minute');
{
  const cut = (a, b) => SRC.slice(SRC.indexOf(a), SRC.indexOf(b, SRC.indexOf(a)));
  const body = cut('const CXHist = {', 'function cxCloudQueuePush(') + cut('function _cxGetHistory(id, range, opts) {', 'function _cxGenSyntheticSeries(');
  const calls = [];
  const g = { CX_RANGE_SECONDS: { '1H': 3600, '24H': 86400, 'ALL': Infinity }, App: { screen: 'x' }, initCloud: () => true,
    Cloud: { ready: true, client: { rpc: (n, a) => { calls.push(n); return Promise.resolve({ data: [], error: null }); } } }, Profile: { cloud: { signedIn: true, userId: 'u' } },
    getMarketPrice: () => ({ current: 105, delta24h: 3.3 }), _cxEnsureHistory: () => ({ history: {} }), _cxBasePrice: () => 100, CX_HISTORY_CAP_PER_ID: 80,
    _cxGenSyntheticSeries: () => [100, 101], getCrashExchange: () => ({ prices: {} }), CX_PRICE_MIN_FACTOR: 0.1, CX_PRICE_MAX_FACTOR: 10, console, Date, Math, JSON, Promise, Array, Number };
  const api = new Function('g', 'with (g) { ' + body + ' return { CXHist, _cxGetHistory, _cxDelta24, _cxRangeSeconds, _cxFetchStatsAll }; }')(g);
  api.CXHist.series['food|24H'] = { at: Date.now(), rows: [{ px: 90, at: 1 }, { px: 100, at: 2 }, { px: 110, at: 3 }] };
  ok(JSON.stringify(api._cxGetHistory('food', '24H')) === '[90,100,110,105]', 'run for real: the shared points plus the live price as the last point');
  api._cxGetHistory('metal', '24H'); api._cxGetHistory('metal', '24H');
  ok(calls.filter(c => c === 'cx_history').length === 1, 'two reads of a thin asset → one fetch (in-flight guard)');
  api._cxGetHistory('metal', '24H', { local: true });
  ok(calls.filter(c => c === 'cx_history').length === 1, 'a local read (table spark) never fetches');
  api.CXHist.all = { metal: { px24ago: 80, spark: [1, 2, 3] } };
  ok(api._cxDelta24('metal', { current: 100, delta24h: 3.3 }).toFixed(1) === '25.0' && api._cxDelta24('none', { current: 100, delta24h: 3.3 }) === 3.3, '24 h Δ: 80 → 100 is +25%; no tape → the old base delta');
  ok(api._cxRangeSeconds('ALL') === 315360000 && api._cxRangeSeconds('1H') === 3600, 'ALL asks for ten years, 1H for an hour');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 107, 'BUILD_VERSION is v121v107 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
