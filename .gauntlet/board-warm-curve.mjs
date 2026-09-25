/* ══════════════════════════════════════════════════════════════════════════
   📉 BOARD-WARM-CURVE — does the ~2 s outlier DECAY, and what makes it decay?

   Where this comes from:
     · attribute-board-spike.mjs pinned the outlier — every 12th frame,
       99.8% of it inside BBX.vista.grade, i.e. inside postMap's getImageData,
       on exactly the POST_CADENCE = 12 period. Over 400 unflushed frames it
       did NOT decay: 1921 ms at frame 1 and 1999 ms at frame 371.
     · board-raster-ablate.mjs then ran ~1100 frames each ending in a forced
       flush, and its per-frame cost fell 182 → 17 ms across the run — after
       which an UNFLUSHED tail of 120 frames had NO spike at all (max 25.8 ms).

   Those two cannot both be a steady-state cost. So this file runs the two
   regimes ALTERNATELY ON ONE PAGE LOAD and prints the curve, in buckets, so
   the shape is visible rather than summarised into a median that cannot see
   an outlier or a mean that cannot see a trend:

       A  unflushed   ← the regime the board actually ships in on this rig
       B  flushed     ← every frame forced to rasterise itself
       C  unflushed   ← does the spike come back after B has warmed it?
       D  flushed

   If C is quiet, the spike is a COLD-RASTERISER effect and no source change in
   grade() can be credited with removing it. If C spikes again, the flush is
   merely masking it and the cadence really is the lever.

   ⚠ THE RIG IS SwiftShader (software GL). Everything here is CPU rasterisation
     at software speed. A 2 s frame on this box is NOT a 2 s frame on a player
     GPU, and no absolute number below may be reported as a player experience.

   Run:  node .gauntlet/board-warm-curve.mjs [framesPerPhase]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const NP = Number(process.argv[2] || 240);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 60);
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

const r = await page.evaluate(async (NP) => {
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const doc = fr ? fr.contentDocument : document;
  const out = { phases: [] };
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }
  const cv = doc.querySelector('canvas');
  const g2 = cv ? cv.getContext('2d') : null;
  out.canvas = cv ? (cv.width + 'x' + cv.height) : null;
  const flush = () => { try { g2.getImageData(0, 0, 1, 1); } catch (e) {} };

  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  const phase = (id, n, doFlush) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
      if (doFlush) flush();
      ts.push(+(performance.now() - a).toFixed(1));
    }
    out.phases.push({ id, flush: doFlush, ts });
  };

  /* warm ONLY past LOADQ (retires at step 21) — deliberately UNflushed, so
     phase A starts from the same cold rasteriser the real cold load has */
  for (let i = 0; i < 60; i++) { t += 16.7; try { w.frame(t); ran++; } catch (e) {} }

  phase('A unflushed', NP, false);
  phase('B flushed',   NP, true);
  phase('C unflushed', NP, false);
  phase('D flushed',   NP, true);

  w.requestAnimationFrame = _raf;
  out.framesRan = ran;
  out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  out.terrain = (() => { try { return w.__bbDebug.terrain().bakeMs; } catch (e) { return null; } })();
  out.vista = (() => { try { const d = w.__vistaDebug(); return { cadence: d.post.cadence, reads: d.post.reads, calls: d.post.calls }; } catch (e) { return null; } })();
  return out;
}, NP);

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }

console.log('\n\u{1F4C9} BOARD WARM CURVE — ' + NP + ' frames per phase, one page load');
console.log('   host ' + BOX.width + 'x' + BOX.height + ' · stage canvas ' + r.canvas +
            ' · frames run ' + r.framesRan + ' · frameErr ' + r.frameErr + ' · terrain bakeMs ' + r.terrain);
console.log('   SwiftShader (software GL) — relative only.\n');

const BK = Math.max(10, Math.round(NP / 8));
for (const p of r.phases) {
  const ts = p.ts;
  const s = ts.slice().sort((a, b) => a - b);
  const sum = ts.reduce((a, b) => a + b, 0);
  const spikes = ts.map((v, i) => v > 300 ? { i, v } : null).filter(Boolean);
  console.log('   ' + p.id.padEnd(14) + 'total ' + sum.toFixed(0).padStart(7) + 'ms   mean ' +
              (sum / ts.length).toFixed(1).padStart(7) + '   p50 ' + s[ts.length >> 1].toFixed(1).padStart(7) +
              '   MAX ' + s[ts.length - 1].toFixed(1).padStart(8) + '   frames>300ms ' + spikes.length);
  const buckets = [];
  for (let i = 0; i < ts.length; i += BK) {
    const c = ts.slice(i, i + BK);
    buckets.push((c.reduce((a, b) => a + b, 0) / c.length).toFixed(0));
  }
  console.log('        bucket means (' + BK + ' frames each): ' + buckets.join(' → '));
  if (spikes.length) console.log('        spikes at frame ' + spikes.slice(0, 10).map(x => x.i + ':' + x.v.toFixed(0) + 'ms').join(', ') +
                                 (spikes.length > 10 ? ' …' : ''));
}
console.log('\n   vista post: ' + JSON.stringify(r.vista));
fs.writeFileSync(path.resolve(process.cwd(), '.gauntlet/_warm-curve.json'), JSON.stringify(r.phases));
console.log('   raw -> .gauntlet/_warm-curve.json');
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
