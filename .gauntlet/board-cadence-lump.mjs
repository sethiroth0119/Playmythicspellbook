/* ══════════════════════════════════════════════════════════════════════════
   ⚖ BOARD-CADENCE-LUMP — does POST_CADENCE reduce the COST, or only choose
   how big the lump is?

   The finding this tests, from board-warm-curve.mjs: over 240 frames on one
   page load, unflushed cost 40471 ms with 21 spikes of ~1.9 s and a p50 of
   2.7 ms; flushed-every-frame cost 40192 ms with ZERO spikes and a p50 of
   171.8 ms. 0.7% apart. So postMap's getImageData is not doing work — it is a
   pipeline sync COLLECTING the rasterisation the previous frames deferred, and
   the size of the lump is the number of frames it collected, i.e. exactly
   POST_CADENCE.

   If that model is right, then changing the cadence should:
       · leave the TOTAL essentially unchanged, and
       · scale the WORST FRAME roughly linearly — cadence 12 gives a lump of
         ~12 frames, cadence 4 a lump of ~4, cadence 1 no lump at all.

   That matters because vista.js's wave 7 raised POST_CADENCE 4 → 12 on the
   strength of "frames over 16.7 ms": 5/60 at cadence 12 vs 15/60 at cadence 4.
   Both numbers are true. But counting frames over budget scores a rare huge
   hitch better than several small ones, and if the total is fixed then the
   only thing the cadence buys is which of those two the player gets.

   ⚠ THE PICTURE IS THE OTHER HALF AND THIS FILE DOES NOT MEASURE IT. A lower
     cadence recomputes the tone map more often, which is why wave 3 chose 4
     and wave 7 chose 12; vista.js says explicitly that the cost of a stale map
     is a PICTURE question. Nothing here is a recommendation to change the
     constant — it is the cost half of that trade, stated honestly.

   ⚠ Blocks are UNFLUSHED, because the lump only exists in the unflushed
     regime, and they run inside the cold window (see board-warm-curve.mjs) —
     the arms are interleaved and repeated so drift does not decide the answer.
   ⚠ SwiftShader rig. Relative only.

   Run:  node .gauntlet/board-cadence-lump.mjs [framesPerBlock=60]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const NB = Number(process.argv[2] || 60);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 9200 + (process.pid % 60);
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

const r = await page.evaluate(async (NB) => {
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const out = { blocks: [] };
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }
  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  const block = (cad) => {
    w.__vistaOff = Object.assign({}, w.__vistaOff, { cadence: cad });
    const ts = [];
    for (let i = 0; i < NB; i++) {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 100); }
      ts.push(performance.now() - a);
    }
    const s = ts.slice().sort((x, y) => x - y);
    return { cad, total: +ts.reduce((x, y) => x + y, 0).toFixed(0),
             mean: +(ts.reduce((x, y) => x + y, 0) / NB).toFixed(1),
             p50: +s[NB >> 1].toFixed(1), max: +s[NB - 1].toFixed(1),
             over100: ts.filter(x => x > 100).length, over16: ts.filter(x => x > 16.7).length };
  };

  for (let i = 0; i < 40; i++) { t += 16.7; try { w.frame(t); ran++; } catch (e) {} }
  /* interleaved and repeated: 12, 4, 1, 1, 4, 12 — a palindrome, so any linear
     drift over the run cancels between the two halves */
  for (const cad of [12, 4, 1, 1, 4, 12]) out.blocks.push(block(cad));

  w.__vistaOff = Object.assign({}, w.__vistaOff, { cadence: undefined });
  w.requestAnimationFrame = _raf;
  out.framesRan = ran;
  out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  return out;
}, NB);

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }
console.log('\n\u{2696} CADENCE vs LUMP — ' + NB + ' unflushed frames per block, palindrome order 12,4,1,1,4,12');
console.log('   frames ' + r.framesRan + ' · frameErr ' + r.frameErr + ' · SwiftShader, relative only\n');
console.log('   ' + 'cadence'.padStart(8) + 'total ms'.padStart(11) + 'mean'.padStart(9) + 'p50'.padStart(8) +
            'MAX'.padStart(10) + '  >100ms  >16.7ms');
for (const b of r.blocks)
  console.log('   ' + String(b.cad).padStart(8) + String(b.total).padStart(11) + String(b.mean).padStart(9) +
              String(b.p50).padStart(8) + String(b.max).padStart(10) + String(b.over100).padStart(8) +
              String(b.over16).padStart(9));

const agg = {};
for (const b of r.blocks) { (agg[b.cad] = agg[b.cad] || []).push(b); }
console.log('\n   averaged over the two blocks at each cadence:');
for (const c of Object.keys(agg).sort((a, b) => a - b)) {
  const g = agg[c];
  const tot = g.reduce((a, b) => a + b.total, 0) / g.length;
  const mx = g.reduce((a, b) => a + b.max, 0) / g.length;
  console.log('   cadence ' + String(c).padEnd(4) + ' total ' + tot.toFixed(0).padStart(7) + 'ms   worst frame ' +
              mx.toFixed(0).padStart(6) + 'ms');
}
console.log('\n   the model predicts: total flat across cadences, worst frame ∝ cadence.');
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
