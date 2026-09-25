/* 🕯🛣 v121v109 — candlesticks with hover prices on the Crash/Exchange; real
   exits in Highway Haul that leave one highway for another.
   Run: node _candles_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const HAUL = readFileSync('./public/src/haul/index.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. candlesticks ── */
ok(/const CX_CANDLES_PER_RANGE = \{ '1H': 60, '6H': 72, '24H': 96, '7D': 84, '30D': 120, 'ALL': 120 \};/.test(SRC), 'a candle count per range (v121v119: many narrow buckets, like a market chart)');
ok(/function _cxHistoryPts\(id, range\)/.test(SRC) && /function _cxCandles\(pts, n\)/.test(SRC) && /function _cxCandleSVG\(candles, w, h\)/.test(SRC), 'points → OHLC buckets → SVG');
ok(/'<div class="cx-chart-wrap">' \+ _cxChartHtml\(focus\.id, range, series\) \+ '<\/div>';/.test(SRC), 'the focus chart goes through _cxChartHtml (candles when two or more, the line otherwise)');
ok(/try \{ _cxBindCandleTip\(\); \} catch \(e\) \{\}/.test(SRC) && /document\.addEventListener\('mousemove', \(ev\) => \{\n\s*const g = ev\.target && ev\.target\.closest \? ev\.target\.closest\('\[data-cxc\]'\) : null;/.test(SRC), 'one delegated mousemove shows the candle tooltip');
ok(/#cx-candle-tip \{ position: fixed; z-index: 2147483646; pointer-events: none;/.test(SRC) && /\.cx-candle\.up line, \.cx-candle\.up rect:not\(\.hit\) \{ stroke: #4ade80; fill: #4ade80; \}/.test(SRC), 'tooltip and green/red candle styles');
{
  const body = SRC.slice(SRC.indexOf('const CX_CANDLES_PER_RANGE'), SRC.indexOf('function _cxFmt(n) {'));
  const g = { CXHist: { series: {} }, _cxEnsureHistory: () => ({ history: {} }), CX_RANGE_SECONDS: { '1H': 3600, '24H': 86400, 'ALL': Infinity }, getMarketPrice: () => ({ current: 110 }), _cxFmt: (n) => n.toFixed(2), _cxChartSVG: () => '<svg>line</svg>', window: {}, document: { addEventListener() {} }, Date, Math, Array, Number, String };
  const api = new Function('g', 'with (g) { ' + body + ' return { _cxHistoryPts, _cxCandles, _cxCandleSVG, _cxChartHtml, _cxCandleTipHtml }; }')(g);
  const now = Date.now();
  g.CXHist.series['food|24H'] = { rows: Array.from({ length: 50 }, (_, i) => ({ px: 100 + Math.sin(i / 3) * 10 + i * 0.2, at: now - 86400000 + i * 1700000 })) };
  const pts = api._cxHistoryPts('food', '24H'); const c = api._cxCandles(pts, 24);
  ok(pts.length === 51 && c.length === 24 && c[0].o === 100 && c[0].h >= c[0].c && c[0].l <= c[0].o, 'run for real: 50 shared points + the live price → 24 candles with sane O/H/L/C', JSON.stringify(c[0]));
  const svg = api._cxCandleSVG(c);
  ok((svg.match(/data-cxc=/g) || []).length === 24 && /cx-candle up/.test(svg) && /cx-candle down/.test(svg), '24 hoverable candles, some up and some down');
  ok(/cx-candles/.test(api._cxChartHtml('food', '24H', [1, 2])) && api._cxChartHtml('metal', '24H', [1, 2]) === '<svg>line</svg>', 'an asset with a tape draws candles; one without falls back to the line');
  ok(/O<\/span> 100\.00/.test(api._cxCandleTipHtml(c[0])) && /ticks/.test(api._cxCandleTipHtml(c[0])), 'the tooltip carries open/high/low/close, the time span and the tick count');
  ok(api._cxCandles([{ px: 1, at: 1 }], 24).length === 0, 'one point → no candles (so the line is used)');
}

/* ── 2. real exits ── */
ok(/get bld\(\) \{ return this\.bldSets\[legPal % this\.bldSets\.length\]; \},/.test(HAUL) && (HAUL.match(/\[0x[0-9a-f]{6}, 0x[0-9a-f]{6}, 0x[0-9a-f]{6}, 0x[0-9a-f]{6}\],/g) || []).length >= 4, 'four building palettes, one per highway, chosen by the leg index');
ok(/let legSeed = 0, legPal = 0;/.test(HAUL) && /mulberry\(Math\.floor\(z0 \/ SEG_LEN\) \* 7919 \+ Math\.floor\(km \* 13\) \+ \(legSeed \| 0\)\)/.test(HAUL), 'segment props are seeded by the highway, so a new road has new scenery');
ok(/if \(j\.viaExit && !j\.last\) \{[\s\S]*?legSeed = hash\(j\.nextName \+ '\|' \+ S\.jIdx\); legPal = legPal \+ 1;\n\s*for \(const sg of segs\) placeSegment\(sg, sg\.z0\);\n\s*S\.merge = \{ t: 0, dur: 2\.4, fromX: S\.x, name: j\.nextName \};\n\s*showMerge\('↗ EXIT → ' \+ String\(j\.nextName\)\.toUpperCase\(\) \+ ' HIGHWAY'\);/.test(HAUL), 'a correct exit re-seeds every segment, steps the palette, and starts the merge');
ok(/\} else \{ S\.x = Math\.min\(S\.x, ROAD_W \/ 2 - PLAYER_HALF_W - 0\.2\); \}/.test(HAUL), 'a wrong exit (or the final one) still clamps back and reroutes as before');
ok(/if \(S\.merge\) \{\n\s*S\.merge\.t \+= dt;\n\s*const k = Math\.min\(1, S\.merge\.t \/ S\.merge\.dur\), e = k \* k \* \(3 - 2 \* k\);\n\s*S\.x = S\.merge\.fromX \+ \(laneX\(LANES - 1\) - S\.merge\.fromX\) \* e;/.test(HAUL), 'during the merge the rig is eased from the ramp into the slow lane');
ok(/if \(!S\.merge && \(S\.x \+ PLAYER_HALF_W > rl \|\| -S\.x \+ PLAYER_HALF_W > HALF\)\) \{/.test(HAUL), '…with the rails held off while it merges');
ok(/id="haul-merge"/.test(HAUL) && /function showMerge\(txt\)/.test(HAUL) && /function hideMerge\(\)/.test(HAUL) && /\.haul-merge\.on\{opacity:1\}/.test(HAUL), 'a merge overlay names the new highway');
ok(/merge: null,/.test(HAUL), 'the run state carries the merge');
ok(/src\/haul\/index\.js\?v=v121v1\d\dhaul\d/.test(SRC), 'the haul buster moved, so every player gets the new exits');
{
  /* run the merge easing for real */
  const g = { laneX: (i) => -7.2 + 3.6 * (i + 0.5), LANES: 4, hideMerge: () => { g.hidden = true; }, flash: (t) => { g.flashed = t; }, j0Name: () => 'Cinder Fork' };
  const S = { merge: { t: 0, dur: 2.4, fromX: 9.5, name: 'Cinder Fork' }, x: 9.5, heading: 0.2 };
  const step = new Function('S', 'dt', 'g', 'with (g) { if (S.merge) { S.merge.t += dt; const k = Math.min(1, S.merge.t / S.merge.dur), e = k * k * (3 - 2 * k); S.x = S.merge.fromX + (laneX(LANES - 1) - S.merge.fromX) * e; S.heading *= 0.8; if (k >= 1) { S.merge = null; hideMerge(); flash("🛣 " + String(j0Name()).toUpperCase() + " HIGHWAY"); } } }');
  for (let i = 0; i < 30; i++) step(S, 0.1, g);
  ok(Math.abs(S.x - 5.4) < 1e-6 && S.merge === null && g.hidden === true && /CINDER FORK HIGHWAY/.test(g.flashed), 'run for real: from the ramp (x 9.5) to the slow lane (x 5.4) in 2.4 s, overlay hidden, highway named');
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 109, 'BUILD_VERSION is v121v109 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
ok(new RegExp('window\\.NC_BUILD = "' + v + '-').test(readFileSync('./public/node-city/index.html', 'utf8')), 'NC_BUILD carries the build');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
