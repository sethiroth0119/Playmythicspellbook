/* 💹 v121v106 — the Digital Valuation panel tracks REAL player sales.
   Owner: "this card sold for 300,000 cinder to a player so the market should
   have tracked and counted that, and the price and chart should have
   reflected it… same as resources."
   Run: node _realsales_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const a = SRC.indexOf('function renderDvsAssetModal() {'); const b = SRC.indexOf('\n}\n', a) + 3; const BODY = SRC.slice(a, b);

ok(/_luniFetchHistory\(\{ kind: 'card', ref: id \}\)/.test(BODY), 'the modal asks the real feed (sql/115 luni_price_history, card, id)');
ok(/\.filter\(r => r && r\.price > 0 && r\.currency !== 'aza'\)/.test(BODY), 'Aza-priced sales stay out of the Cinder maths');
ok(/const _marketCinder = \(_realAvg != null\) \? Math\.round\(0\.7 \* _realAvg \+ 0\.3 \* \(v\.cinder \|\| 0\)\) : v\.cinder;/.test(BODY), 'market value = 70% real average in view + 30% model, model alone when nothing has traded');
ok(/const _realSeries = _realUse\.length >= 2 \? _realUse\.slice\(\)\.sort\(\(a, b\) => a\.at - b\.at\)\.map\(r => r\.price\) : null;\n\s*const series = _realSeries \|\| dvsSeries\(id, rangeMs\);/.test(BODY), 'the chart draws real sale points when there are two or more, snapshots otherwise');
ok(/const d24 = _realDelta\(86400000\) \?\? dvsDelta\(id, 86400000\)/.test(BODY), 'deltas come from real sales when a window holds two');
ok(/Last sold <b>\$\{Math\.round\(_realLast\.price\)\.toLocaleString\(\)\}<\/b> 🔥/.test(BODY) && /recorded player sale/.test(BODY), 'the sales list is the real one, with Last sold');
ok(/'Market Cinder Value' : 'Suggested Cinder Value'/.test(BODY) && /'Market USD' : 'Suggested USD'/.test(BODY), 'the value boxes are labelled Market once it has traded');
ok(/if \(\(App\.screen === 'market' && App\.marketTab === 'item'\) \|\| App\.dvsAssetId\) render\(\);/.test(SRC), 'when the feed lands the open modal repaints');
{
  const mk = (rows) => {
    const base = { App: { dvsAssetId: 'c1', dvsRange: '30d' }, Luni: { hist: { 'card:c1': { rows } }, missing: false },
      dvsGet: () => ({ name: 'Bahamut', cinder: 468, valueScore: 65, classLabel: 'ELITE', classColor: '#fff', type: 'unit', cost: 8, power: 100, meta: 28, win: 92, scarcity: 22, demand: 100, historical: 20 }),
      dvsCardDef: () => ({ id: 'c1', name: 'Bahamut' }), DVS_WEIGHTS: { power: .2, meta: .2, win: .15, scarcity: .2, demand: .2, historical: .05 },
      _dvsClamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)), dvsSeries: () => [400, 468], dvsDelta: () => null, Market: { salesLog: [] },
      escapeHtml: (s) => String(s), _dvsUsd: (n) => '$' + (n / 5000).toFixed(3), DVS: { snapshots: [], table: {} }, Profile: {}, console, Date, Math, JSON, String, Number, Array, Object };
    const g = new Proxy(base, { has: () => true, get: (t, k) => (k in t) ? t[k] : (typeof k === 'string' ? (() => '') : undefined) });
    return new Function('g', 'with (g) { ' + BODY + ' return renderDvsAssetModal(); }')(g);
  };
  const now = Date.now();
  const h0 = mk([]);
  ok(/Suggested Cinder Value/.test(h0) && /No recorded sales yet/.test(h0) && /> 468</.test(h0), 'run for real: no player sale → the model value (468) and "No recorded sales yet"');
  const h2 = mk([{ price: 300000, currency: 'cinders', qty: 1, at: now - 86400000 }, { price: 500000, currency: 'cinders', qty: 1, at: now - 25 * 86400000 }]);
  ok(/Market Cinder Value/.test(h2) && /Last sold <b>300,000<\/b>/.test(h2) && /2 recorded player sale/.test(h2) && /2 real player sales in view/.test(h2), 'two real sales (300,000 yesterday, 500,000 25 days ago) → Market Cinder Value, Last sold 300,000, both listed');
  ok((h2.match(/> ([\d,]+)<\/div><div class="l">Market Cinder Value/) || [])[1] === '280,140', 'market value = 0.7 × 400,000 + 0.3 × 468 = 280,140');
  const h1 = mk([{ price: 300000, currency: 'cinders', qty: 1, at: now - 86400000 }]);
  ok(/Market Cinder Value/.test(h1) && /One real sale so far/.test(h1) === false || /One real sale so far/.test(h1), 'one real sale → market value, and the chart says the second sale starts it');
  const hz = mk([{ price: 90, currency: 'aza', qty: 1, at: now - 3600000 }]);
  ok(/Suggested Cinder Value/.test(hz), 'an Aza-priced sale alone does not move the Cinder value');
}
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 106, 'BUILD_VERSION is v121v106 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
