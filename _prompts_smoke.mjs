/* ✏️🕯 v121v119 — Athena's rename / name prompts await the game's async
   "Enter a value" modal (no more "[object Promise]" names), and the exchange
   candles look like a market chart: fixed narrow candles, quiet buckets carried
   forward as dojis, a right-hand price axis, time labels, the last price tagged.
   Run: node _prompts_smoke.mjs */
import { readFileSync } from 'fs';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const SRC = readFileSync('./public/index.html', 'utf8').replace(/\r\n/g, '\n');
const ED = readFileSync('./public/src/mapforge/mapforge.editor.js', 'utf8').replace(/\r\n/g, '\n');
const WD = readFileSync('./public/src/widgets/widgets.editor.js', 'utf8').replace(/\r\n/g, '\n');

/* ── 1. the prompts ── */
ok(/^async function askText\(msg, def\) \{/m.test(ED) && /if \(r && typeof r\.then === 'function'\) \{ try \{ r = await r; \} catch \(e\) \{ r = null; \} \}/.test(ED), 'askText awaits a prompt that returns a Promise (the game\'s themed modal) and passes a plain string through');
ok(/name = await askText\('Rename “' \+ cur \+ '” to:', cur\); if \(name == null\) return false;/.test(ED), 'rename (library item, model, sound, prefab, cloud file) waits for the answer');
ok(/askText\('Name this object:', o\.n \|\| ''\)\.then\(\(nm\) => \{ if \(nm != null\) \{/.test(ED) && /renderOutliner\(\); \} \}\); \} else \{ const sel = libSel \? entryByKey\(libSel\) : null; if \(sel\) renameEntry\(sel\); \} return; \}/.test(ED), 'F2 on a selected object waits too, and still falls through to the library item');
ok(/askText\('Prefab name:', prefabById\(id\)\.name\)\.then\(\(nm\) => \{ if \(nm\) renamePrefab\(id, nm\); \}\);/.test(ED), 'prefab rename waits');
ok(/async function relinkAsset\(id\) \{[\s\S]{0,200}const url = await askText\('URL this model is served from/.test(ED), 'relink-a-model waits');
ok(/onclick = async \(\) => \{ const u = await askText\('Model or sound URL/.test(ED), 'the content browser\'s URL door waits');
ok(/gameId\(\(await askText\('Mini-game id \(letters, digits, - and _\):', S\.map\.game \|\| ''\)\) \|\| ''\)/.test(ED), 'the custom game id waits');
ok((ED.match(/window\.prompt\(/g) || []).length === 3, 'only askText itself, its comment, and the clipboard fallback that only DISPLAYS a URL still touch window.prompt', (ED.match(/window\.prompt\(/g) || []).length);
ok(/onclick = async \(\) => \{ let k = window\.prompt\('Variable name \(e\.g\. --gold\):', '--'\); if \(k && typeof k\.then === 'function'\) \{ try \{ k = await k; \} catch \(e\) \{ k = null; \} \}/.test(WD), 'the widget designer\'s new-variable prompt waits as well');
{
  const body = ED.slice(ED.indexOf('async function askText(msg, def) {'), ED.indexOf('  /* Rename whatever the library entry is.'));
  const win = { prompt: (m, d) => Promise.resolve('Harbour Lamp') };
  const askText = new Function('window', body + '\nreturn askText;')(win);
  const r1 = await askText('Rename?', 'x');
  win.prompt = (m, d) => 'plain ' + d;
  const r2 = await askText('Rename?', 'x');
  win.prompt = () => Promise.resolve(null);
  const r3 = await askText('Rename?', 'x');
  ok(r1 === 'Harbour Lamp' && r2 === 'plain x' && r3 === null, 'run for real: a Promise resolves to its string, a plain prompt passes through, cancel is null', JSON.stringify([r1, r2, r3]));
}

/* ── 2. the candles ── */
ok(/const CX_CANDLES_PER_RANGE = \{ '1H': 60, '6H': 72, '24H': 96, '7D': 84, '30D': 120, 'ALL': 120 \};/.test(SRC), 'sixty to a hundred and twenty buckets per range');
ok(/else if \(last != null\) out\.push\(\{ i, t0: t0 \+ i \* w, t1: t0 \+ \(i \+ 1\) \* w, o: last, h: last, l: last, c: last, n: 0 \}\);/.test(SRC), 'a quiet bucket is a doji at the last close');
ok(/const plotW = w - PAD_R, slots = Math\.max\(candles\.length, 24\), slot = plotW \/ slots;\n\s*const bw = Math\.max\(2, Math\.min\(9, slot \* 0\.66\)\);\n\s*const x0 = plotW - candles\.length \* slot;/.test(SRC), 'one slot per bucket, at most 9 units wide, right-aligned against the price axis');
ok(/<g class="cx-last">/.test(SRC) && /text-anchor="end">' \+ tf\(lastC\.t1\)/.test(SRC), 'the last price is tagged on the axis and the bottom carries times');
{
  const body = SRC.slice(SRC.indexOf('const CX_CANDLES_PER_RANGE'), SRC.indexOf('function _cxFmt(n) {'));
  const g = { CXHist: { series: {} }, _cxEnsureHistory: () => ({ history: {} }), CX_RANGE_SECONDS: { '1H': 3600 }, getMarketPrice: () => ({ current: 110 }), _cxFmt: (n) => n.toFixed(2), _cxChartSVG: () => '', window: {}, document: { addEventListener() {} }, Date, Math, Array, Number, String };
  const api = new Function('g', 'with (g) { ' + body + ' return { _cxCandles, _cxCandleSVG }; }')(g);
  const t = 1e12;
  const sparse = [{ px: 10, at: t }, { px: 12, at: t + 1000 }, { px: 9, at: t + 8000 }, { px: 9.5, at: t + 9000 }];
  const c = api._cxCandles(sparse, 10);
  ok(c.length === 10 && c[0].n === 1 && c[1].n === 1 && c[2].n === 0 && c[2].o === 12 && c[2].c === 12 && c[8].n === 1 && c[8].c === 9 && c[9].n === 1, 'run for real: 4 ticks over 10 buckets → 10 candles, the six quiet ones flat at the last close', JSON.stringify(c.map((x) => x.n + ':' + x.c)));
  const svg = api._cxCandleSVG(c);
  const bodyWidths = (s) => (s.match(/<g class="cx-candle[^"]*" data-cxc="\d+"><rect class="hit"[^>]*\/><line[^>]*\/><rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/g) || []).map((m) => +/width="([\d.]+)"$/.exec(m)[1]);
  const widths = bodyWidths(svg);
  ok(widths.length === 10 && widths.every((wd) => Math.abs(wd - widths[0]) < 1e-6) && widths[0] <= 9, 'ten candles of one narrow width (≤ 9 units) whatever the tape holds', JSON.stringify(widths.slice(0, 3)));
  ok((svg.match(/cx-candle up quiet|cx-candle down quiet/g) || []).length === 6, 'the six quiet candles are marked', (svg.match(/quiet/g) || []).length);
  ok((svg.match(/<text x="\d+" y="[\d.]+">[\d.]+<\/text>/g) || []).length >= 5 && /cx-last/.test(svg), 'five price rungs on the right and the last-price tag');
  const w3 = bodyWidths(api._cxCandleSVG(c.slice(0, 3)));
  ok(w3.length === 3 && w3[0] <= 9 && Math.abs(w3[0] - widths[0]) < 1e-6, 'three candles are exactly as narrow as ten — the slot count floors at 24, so a thin tape never makes fat candles');
}

/* ── 3. the two edited modules still PARSE as ES modules (a line comment once swallowed
   the rest of a one-line handler — node --check did not see it, the browser did) ── */
{
  const { minify } = await import('terser');
  for (const f of ['public/src/mapforge/mapforge.editor.js', 'public/src/widgets/widgets.editor.js']) {
    let err = null; try { await minify(readFileSync('./' + f, 'utf8'), { compress: false, mangle: false, module: true }); } catch (e) { err = (e && e.message) || String(e); }
    ok(!err, f + ' parses as an ES module', err);
  }
}

/* the knobs */
const v = (SRC.match(/window\.BUILD_VERSION = '([^']+)'/) || [])[1];
ok(parseInt((v || '').replace('v121v', ''), 10) >= 119, 'BUILD_VERSION is v121v119 or later', v);
ok(readFileSync('./public/version.txt', 'utf8').trim() === v, 'version.txt equals BUILD_VERSION');
ok(new RegExp("CACHE_VERSION = 'mythic-" + v + "-").test(readFileSync('./public/sw.js', 'utf8')), 'sw.js carries the build');
/* "At least", not "exactly": a later mapforge change (mf20, bug-mu1pbwb4) must
   move the buster forward, and pinning mf19 turned that correct bump red. */
const _mf = +((SRC.match(/src\/mapforge\/index\.js\?v=mf(\d+)/) || [])[1] || 0);
const _aw = +((SRC.match(/src\/widgets\/index\.js\?v=aw(\d+)/) || [])[1] || 0);
ok(_mf >= 19 && _aw >= 6, 'the mapforge and widgets busters moved (mf' + _mf + ', aw' + _aw + ')');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASS');
process.exit(fails ? 1 : 0);
