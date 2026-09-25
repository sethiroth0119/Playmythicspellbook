/* ══════════════════════════════════════════════════════════════════════════
   🧪 BOARD-RASTER-AB — is the 2-second outlier REAL WORK, or RASTER DEBT?

   attribute-board-spike.mjs pins the outlier exactly: every 12th frame,
   99.8% of it inside BBX.vista.grade, and inside that the postMap readback.
   POST_CADENCE is 12 in vista.js, and the spike indices are 1, 11, 23, 35 …
   395 — one per cadence period, no exceptions.

   THAT IS NOT YET AN ATTRIBUTION OF COST, and vista.js says so at length in
   its own header: `drawImage(main) + getImageData` is a PIPELINE SYNC. It
   cannot return until every canvas op queued since the last sync has actually
   rasterised. So the bracket around it charges that ONE frame for work the
   other eleven frames deferred. On a rig that never composites — this pane
   runs at ~0.56 Hz, and a synchronous driver never composites at all — the
   eleven frames before a sync do NO rasterisation whatsoever, and the twelfth
   pays for all of them.

   Which means the two questions this file answers are:

     Q1. Under a PER-FRAME FLUSH — every frame forced to rasterise itself, so
         no debt can accumulate — does the spike survive? If it does not, the
         2 s is debt collection and the fix is not in grade().
     Q2. Under that same per-frame flush, what does the cadence actually BUY?
         Total wall over a fixed frame count, cadence 12 vs 1 vs never, plus
         an arm with grade() stubbed out entirely.

   ⚠ ARM `never/noflush` IS THE CONTROL FOR THE INSTRUMENT ITSELF. With no
     sync and no recompute NOTHING in the run is ever rasterised, so it reports
     a spectacular number for a board that drew nothing. Any arm whose total
     approaches it is measuring display-list construction, not drawing. This is
     the trap measure-board.mjs sits in.

   ⚠ THE RIG IS SwiftShader. Rasterisation here is CPU work at software speed;
     a player's GPU pays a different and much smaller bill. Only BEFORE/AFTER
     within one arm-set of this driver is a valid comparison.

   Run:  node .gauntlet/board-raster-ab.mjs [framesPerArm]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const N = Number(process.argv[2] || 150);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8500 + (process.pid % 60);
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

/* ⚠ ARM ORDER IS A CONFOUND AND IS THEREFORE A FLAG. The first run of this
   driver put arms 3/4/5 next to each other and all three came out ~36 s while
   arms 1/2/6 came out ~20 s — a split that tracks POSITION IN THE RUN as well
   as it tracks the treatment. `node .gauntlet/board-raster-ab.mjs 120 reverse`
   runs the same arms back to front; a treatment effect survives that and a
   run-order artefact does not. Do not report a delta that has only been seen
   in one order. */
const REVERSE = process.argv.includes('reverse');
const ARMS0 = [
  { id: 'base        cadence 12, NO flush', cadence: 12,    flush: false, nograde: false },
  { id: 'flushed     cadence 12, flush/frm', cadence: 12,   flush: true,  nograde: false },
  { id: 'flushed     cadence  1, flush/frm', cadence: 1,    flush: true,  nograde: false },
  { id: 'flushed     cadence  ∞, flush/frm', cadence: 1e9,  flush: true,  nograde: false },
  { id: 'flushed     grade STUBBED, flush ', cadence: 1e9,  flush: true,  nograde: true },
  { id: 'CONTROL     cadence  ∞, NO flush ', cadence: 1e9,  flush: false, nograde: false },
];

const ARMS = REVERSE ? ARMS0.slice().reverse() : ARMS0;

const results = [];
for (const arm of ARMS) {
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

  const r = await page.evaluate(async ({ N, arm }) => {
    const fr = document.querySelector('iframe');
    const w = fr ? fr.contentWindow : window;
    const doc = fr ? fr.contentDocument : document;
    const out = {};
    if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }

    /* the FLUSH is driver-side on purpose: __vistaOff.flush lives inside
       grade(), and one arm stubs grade() out entirely. A flush that can be
       removed by the arm under test is not a control. 1x1 getImageData on the
       MAIN canvas is a pipeline sync — it cannot return until this frame's
       display list has rasterised. */
    const cv = doc.querySelector('canvas');
    const g2 = cv ? cv.getContext('2d') : null;
    out.canvas = cv ? (cv.width + 'x' + cv.height) : null;
    const flush = () => { try { g2.getImageData(0, 0, 1, 1); } catch (e) { out.flushErr = String(e).slice(0, 80); } };

    w.__vistaOff = Object.assign({}, w.__vistaOff, { cadence: arm.cadence });
    if (arm.nograde && w.BBX && w.BBX.vista) w.BBX.vista.grade = function () {};

    /* 🔴 silence frame()'s self-rearming rAF so only counted calls run */
    const _raf = w.requestAnimationFrame;
    w.requestAnimationFrame = () => 0;

    let t = performance.now(), ran = 0;
    const ts = [];
    const call = (record) => {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
      if (arm.flush) flush();
      if (record) ts.push(performance.now() - a);
    };
    /* warm past LOADQ (retires at step 21) and past the first recompute */
    for (let i = 0; i < 90; i++) call(false);
    for (let i = 0; i < N; i++) call(true);

    w.requestAnimationFrame = _raf;
    out.framesRan = ran;
    out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
    out.ts = ts;
    out.vista = (() => { try { const d = w.__vistaDebug(); return { cadence: d.post.cadence,
      reads: d.post.reads, calls: d.post.calls, msP50: d.post.msP50 }; } catch (e) { return null; } })();
    return out;
  }, { N, arm });

  if (r.err) { console.log('ARM ' + arm.id + ' FAILED: ' + r.err); await page.close(); continue; }
  const s = r.ts.slice().sort((a, b) => a - b);
  const q = (p) => +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2);
  results.push({ arm, canvas: r.canvas, framesRan: r.framesRan, frameErr: r.frameErr,
    vista: r.vista, errs: errs.length, drawErr: r.drawErr,
    total: +r.ts.reduce((a, b) => a + b, 0).toFixed(1),
    p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +s[s.length - 1].toFixed(2),
    over40: r.ts.filter(x => x > 40).length, over500: r.ts.filter(x => x > 500).length });
  await page.close();
}

console.log('\n\u{1F9EA} BOARD RASTER A/B — ' + N + ' timed frames per arm, host ' + BOX.width + 'x' + BOX.height);
console.log('   SwiftShader (software GL). Relative comparison only — NOT what a player GPU pays.\n');
console.log('   ' + 'ARM'.padEnd(36) + 'total ms'.padStart(10) + 'p50'.padStart(9) + 'p90'.padStart(9) +
            'p99'.padStart(10) + 'max'.padStart(10) + '  >40ms  >500ms   reads/calls');
for (const x of results) {
  console.log('   ' + x.arm.id.padEnd(36) + String(x.total).padStart(10) + String(x.p50).padStart(9) +
              String(x.p90).padStart(9) + String(x.p99).padStart(10) + String(x.max).padStart(10) +
              String(x.over40).padStart(7) + String(x.over500).padStart(8) + '   ' +
              (x.vista ? x.vista.reads + '/' + x.vista.calls : '—') +
              (x.frameErr ? '  ⚠frameErr' : '') + (x.drawErr ? '  ⚠' + x.drawErr : ''));
}
console.log('\n   canvas: ' + (results[0] && results[0].canvas) + '   page errors per arm: ' +
            results.map(x => x.errs).join(','));
await browser.close();
server.close();
