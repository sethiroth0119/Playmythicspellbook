/* ══════════════════════════════════════════════════════════════════════════
   🪨 BOARD-DRESSING-ATTRIB — which set-dressing item owns the cold frame.

   The chain so far:
     1. attribute-board-spike.mjs — the ~2 s outlier is every 12th frame,
        99.8% inside BBX.vista.grade, i.e. inside postMap's getImageData, on
        exactly POST_CADENCE = 12.
     2. board-warm-curve.mjs — but unflushed and flushed cost THE SAME TOTAL
        (40471 vs 40192 ms over 240 frames). So the sync is not doing work, it
        is COLLECTING work: eleven frames of deferred rasterisation land on the
        twelfth. The outlier is a symptom, and grade() is the wrong suspect.
     3. board-cold-ablate.mjs — the work being collected is set dressing.
        Stubbing BBX.dressing.items to [] takes the frame from 178 ms to
        46 ms — 74% — while every other pass is in the noise.

   This file goes one level down, per ITEM and per KIND. It cannot do that by
   bracketing alone: a performance.now() around one item's draw on a deferred
   rasteriser times display-list construction, which is the 48x error vista.js
   documents. So every item draw is bracketed AND followed by a 1x1
   getImageData on the main canvas — a pipeline sync. Bracketing EVERY item
   this way is honest in a way that bracketing ONE is not: with a flush before
   the first item (dressing.items() is called immediately before the spine
   dispatches the draws, so wrapping it is the right seam), each bracket can
   only contain the work queued inside it.

   ⚠ The flushes themselves make the run slower than a real frame. Read the
     SHARE of the dressing total, not the absolute ms.
   ⚠ THE RIG IS SwiftShader (software GL) — CPU rasterisation. Not a player
     frame budget under any circumstances.

   Run:  node .gauntlet/board-dressing-attrib.mjs [frames=120]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2] || 120);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8900 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const BOX = { width: 900, height: 760 };
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: BOX });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
await page.route('**/*', (route) => {
  const u = route.request().url();
  if (u.includes('cdn.jsdelivr.net') && u.includes('three@')) {
    const rel = new URL(u).pathname.replace(/^\/npm\/three@[^/]+\//, '');
    const f = path.join(THREE_DIR, rel);
    return fs.existsSync(f)
      ? route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(f) })
      : route.fulfill({ status: 404, body: 'no vendored three at ' + rel });
  }
  if (u.includes('127.0.0.1') || u.includes('localhost')) return route.continue();
  return route.abort();
});
await page.goto(`http://127.0.0.1:${PORT}/battle-board/_harness.html?scene=gamemap`,
                { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(9000);

const r = await page.evaluate(async (N) => {
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const doc = fr ? fr.contentDocument : document;
  const out = { notes: [] };
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }
  const cv = doc.querySelector('canvas');
  const g2 = cv.getContext('2d');
  out.canvas = cv.width + 'x' + cv.height;
  const flush = () => { try { g2.getImageData(0, 0, 1, 1); } catch (e) {} };

  const D = w.BBX && w.BBX.dressing;
  if (!D || typeof D.items !== 'function') { out.err = 'BBX.dressing.items absent'; return out; }

  /* per-kind accumulators, plus a per-frame series so the CLIFF is visible */
  let byKind = {}, byKindN = {};
  const series = [];      /* [frameMs, dressMs] per frame */
  let dressMs = 0, wrapOn = false;

  const _items = D.items;
  const seen = new WeakSet();
  D.items = function (api) {
    const list = _items.call(this, api) || [];
    if (!wrapOn) return list;
    /* flush BEFORE the first item so the queue built by drawBoard / tilefx /
       the actors above it cannot be charged to item #1 */
    flush();
    for (const it of list) {
      if (!it || typeof it.draw !== 'function' || seen.has(it)) continue;
      seen.add(it);
      const kind = it.kind || '?';
      const od = it.draw;
      it.draw = function (a) {
        const t0 = performance.now();
        try { return od.call(this, a); } finally {
          flush();
          const d = performance.now() - t0;
          byKind[kind] = (byKind[kind] || 0) + d;
          byKindN[kind] = (byKindN[kind] || 0) + 1;
          dressMs += d;
        }
      };
    }
    return list;
  };

  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  /* warm UNFLUSHED past LOADQ only — the cold window is what is being measured */
  for (let i = 0; i < 40; i++) { t += 16.7; try { w.frame(t); ran++; } catch (e) {} }

  /* count the field before timing it */
  try {
    const api = w.buildApi ? w.buildApi(0.016) : null;
    const list = api ? _items.call(D, api) : [];
    const c = {}; for (const it of list) c[it && it.kind || '?'] = (c[it && it.kind || '?'] || 0) + 1;
    out.field = { total: list.length, byKind: c };
  } catch (e) { out.notes.push('field count failed: ' + String(e).slice(0, 60)); }

  wrapOn = true;
  for (let i = 0; i < N; i++) {
    t += 16.7;
    dressMs = 0;
    const a = performance.now();
    try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
    flush();
    series.push([+(performance.now() - a).toFixed(1), +dressMs.toFixed(1)]);
  }
  /* ⚠ SNAPSHOT, DO NOT ALIAS. `out.byKind = byKind` stores a REFERENCE, and
     the item wrappers below keep adding into that same object for the whole
     700-frame warm-up that follows — so the first version of this driver
     reported 96 rock draws per frame against a field of 12 rocks, i.e. exactly
     (100 cold + 700 warm)/100. The counts were the tell; the ms were wrong in
     the same proportion and did not look wrong. */
  out.byKind = Object.assign({}, byKind); out.byKindN = Object.assign({}, byKindN);
  out.series = series;

  /* ── and again AFTER the cliff, to see whether the same kind still leads ── */
  wrapOn = false;
  for (let i = 0; i < 700; i++) { t += 16.7; try { w.frame(t); ran++; } catch (e) {} flush(); }
  byKind = {}; byKindN = {}; wrapOn = true;
  const series2 = [];
  for (let i = 0; i < N; i++) {
    t += 16.7;
    dressMs = 0;
    const a = performance.now();
    try { w.frame(t); ran++; } catch (e) {}
    flush();
    series2.push([+(performance.now() - a).toFixed(1), +dressMs.toFixed(1)]);
  }
  out.warmByKind = Object.assign({}, byKind);
  out.warmByKindN = Object.assign({}, byKindN); out.series2 = series2;

  w.requestAnimationFrame = _raf;
  D.items = _items;
  out.framesRan = ran;
  out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  return out;
}, N);

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }

console.log('\n\u{1FAA8} DRESSING ATTRIBUTION — ' + N + ' frames cold, then ' + N + ' warm, one page load');
console.log('   stage canvas ' + r.canvas + ' · frames ' + r.framesRan + ' · frameErr ' + r.frameErr);
console.log('   every item draw is bracketed AND flushed — read shares, not absolutes. SwiftShader.\n');
console.log('   field: ' + JSON.stringify(r.field));

const report = (label, series, byKind, byKindN) => {
  const fr = series.reduce((a, b) => a + b[0], 0), dr = series.reduce((a, b) => a + b[1], 0);
  console.log('\n   ── ' + label);
  console.log('      frame mean ' + (fr / series.length).toFixed(1) + 'ms · dressing mean ' +
              (dr / series.length).toFixed(1) + 'ms  = ' + (100 * dr / fr).toFixed(1) + '% of the frame');
  const rows = Object.entries(byKind).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of rows)
    console.log('      ' + k.padEnd(10) + (v / series.length).toFixed(2).padStart(9) + ' ms/frame   ' +
                String(Math.round(byKindN[k] / series.length)).padStart(4) + ' draws/frame   ' +
                (100 * v / dr).toFixed(1).padStart(5) + '% of dressing');
  const BK = Math.max(5, Math.round(series.length / 8));
  const b = [];
  for (let i = 0; i < series.length; i += BK) {
    const c = series.slice(i, i + BK);
    b.push((c.reduce((a, x) => a + x[0], 0) / c.length).toFixed(0));
  }
  console.log('      frame ms by bucket of ' + BK + ': ' + b.join(' → '));
};
report('COLD (first ' + N + ' timed frames)', r.series, r.byKind, r.byKindN);
report('WARM (after 700 more flushed frames)', r.series2, r.warmByKind, r.warmByKindN);

if (r.notes.length) console.log('\n   notes: ' + r.notes.join(' | '));
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
