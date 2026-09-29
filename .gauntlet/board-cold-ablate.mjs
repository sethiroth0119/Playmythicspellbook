/* ══════════════════════════════════════════════════════════════════════════
   🧊 BOARD-COLD-ABLATE — what costs the 170 ms, INSIDE the expensive window.

   board-warm-curve.mjs found the shape and it is a CLIFF, not a cost:

       A unflushed  mean 168.6 ms/frame · p50 2.7 · MAX 2100 · 21 spikes, one
                    every 12 frames (POST_CADENCE), no decay over 240 frames
       B flushed    mean 167.5 ms/frame · p50 171.8 · MAX 188 · 0 spikes
       C unflushed  mean  15.3 ms/frame · MAX 22.8 · 0 spikes
       D flushed    mean  17.0 ms/frame · MAX 28.5 · 0 spikes

   A and B cost THE SAME TOTAL (40471 vs 40192 ms, 0.7% apart) — which is the
   proof that the ~2 s outlier is deferred rasterisation collected at
   postMap's getImageData, not work grade() creates. Then somewhere late in B
   the per-frame cost falls ~10x and never comes back.

   So the outlier is a SYMPTOM of a board that costs ~170 ms/frame to
   rasterise for its first few hundred frames and ~16 ms after. The question
   worth answering is what those first few hundred frames are paying for, and
   the earlier ablation driver could not see it: it warmed up first, so every
   arm was measured on the cheap side of the cliff and every delta landed
   inside the control spread.

   This one stays COLD. Warm-up is unflushed (so nothing rasterises and the
   cliff is not spent), blocks are short, and control blocks bracket every arm
   so drift over a block pair cancels. Every frame ends in a 1x1 getImageData
   on the MAIN canvas — a pipeline sync — so each frame pays its own bill.

   ⚠ Budget: the cheap side starts around frame ~450, so the whole table has to
     fit in front of it. Keep framesPerBlock small; the driver prints how many
     frames it spent and warns if the run outlived the cliff.

   ⚠ THE RIG IS SwiftShader (software GL). Absolute ms are CPU rasterisation at
     software speed and are NOT a player frame budget. Ratios within one run.

   Run:  node .gauntlet/board-cold-ablate.mjs [framesPerBlock=10]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const NB = Number(process.argv[2] || 10);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 60);
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
  const doc = fr ? fr.contentDocument : document;
  const out = { blocks: [], notes: [] };
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }
  const cv = doc.querySelector('canvas');
  const g2 = cv ? cv.getContext('2d') : null;
  out.canvas = cv ? (cv.width + 'x' + cv.height) : null;
  const flush = () => { try { g2.getImageData(0, 0, 1, 1); } catch (e) {} };

  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  const runBlock = (n) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
      flush();
      ts.push(performance.now() - a);
    }
    return +(ts.reduce((x, y) => x + y, 0) / n).toFixed(2);
  };

  /* ⚠ warm UNFLUSHED — past LOADQ (retires at step 21) only. A flushed warm-up
     would spend the very window this driver exists to measure. */
  for (let i = 0; i < 40; i++) { t += 16.7; try { w.frame(t); ran++; } catch (e) {} }

  const BBX = w.BBX || {};
  const noop = () => {};
  const nilArr = () => [];
  const ARMS = [
    ['vista.draw (sky+land)', () => { const o = BBX.vista.draw; BBX.vista.draw = noop; return () => BBX.vista.draw = o; }],
    ['vista.grade',        () => { const o = BBX.vista.grade; BBX.vista.grade = noop; return () => BBX.vista.grade = o; }],
    ['drawBoard (ground)', () => { const o = w.drawBoard; w.drawBoard = noop; return () => w.drawBoard = o; }],
    ['tilefx surf+states', () => { const a = BBX.tilefx.drawSurfaces, b = BBX.tilefx.drawStatesOver;
                             BBX.tilefx.drawSurfaces = noop; BBX.tilefx.drawStatesOver = noop;
                             return () => { BBX.tilefx.drawSurfaces = a; BBX.tilefx.drawStatesOver = b; }; }],
    ['dressing.items',     () => { const o = BBX.dressing.items; BBX.dressing.items = nilArr; return () => BBX.dressing.items = o; }],
    ['drawRain',           () => { const o = w.drawRain; w.drawRain = noop; return () => w.drawRain = o; }],
    ['drawParticles+Effects', () => { const a = w.drawParticles, b = w.drawEffects; w.drawParticles = noop; w.drawEffects = noop;
                             return () => { w.drawParticles = a; w.drawEffects = b; }; }],
    ['drawPylon x4',       () => { const o = w.drawPylon; w.drawPylon = noop; return () => w.drawPylon = o; }],
    ['drawUnit',           () => { const o = w.drawUnit; w.drawUnit = noop; return () => w.drawUnit = o; }],
    ['drawStruct+Truck',   () => { const a = w.drawStruct, b = w.drawTruck; w.drawStruct = noop; w.drawTruck = noop;
                             return () => { w.drawStruct = a; w.drawTruck = b; }; }],
    ['drawNameplates',     () => { const o = w.drawNameplates; w.drawNameplates = noop; return () => w.drawNameplates = o; }],
    ['drawGuides',         () => { const o = w.drawGuides; w.drawGuides = noop; return () => w.drawGuides = o; }],
  ];

  out.blocks.push({ id: 'CONTROL', mean: runBlock(NB), at: ran });
  for (const [id, apply] of ARMS) {
    let restore = null;
    try { restore = apply(); } catch (e) { out.notes.push(id + ' not stubbable'); continue; }
    out.blocks.push({ id, mean: runBlock(NB), at: ran });
    try { restore(); } catch (e) {}
    out.blocks.push({ id: 'CONTROL', mean: runBlock(NB), at: ran });
  }

  w.requestAnimationFrame = _raf;
  out.framesRan = ran;
  out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  return out;
}, NB);

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }

console.log('\n\u{1F9CA} BOARD COLD ABLATION — ' + NB + ' frames per block, per-frame flush, one cold page load');
console.log('   stage canvas ' + r.canvas + ' · frames spent ' + r.framesRan +
            ' · frameErr ' + r.frameErr);
console.log('   SwiftShader (software GL) — within-run ratios only.\n');

const ctrls = r.blocks.filter(b => b.id === 'CONTROL');
const cm = ctrls.map(b => b.mean);
const cMean = cm.reduce((a, b) => a + b, 0) / cm.length;
console.log('   CONTROL blocks in order: ' + cm.map(x => x.toFixed(0)).join(' → '));
console.log('   control mean ' + cMean.toFixed(1) + 'ms/frame · spread ' +
            Math.min(...cm).toFixed(1) + '–' + Math.max(...cm).toFixed(1) + 'ms');
if (cm[cm.length - 1] < cMean / 3) console.log('   ⚠ THE RUN OUTLIVED THE CLIFF — later arms were measured warm. Shorten framesPerBlock.');

console.log('\n   ' + 'ABLATED PASS'.padEnd(24) + 'ms/frame'.padStart(10) + '   vs the controls either side');
const rows = [];
for (let i = 0; i < r.blocks.length; i++) {
  const b = r.blocks[i];
  if (b.id === 'CONTROL') continue;
  const near = [r.blocks[i - 1], r.blocks[i + 1]].filter(x => x && x.id === 'CONTROL').map(x => x.mean);
  const base = near.reduce((a, c) => a + c, 0) / near.length;
  rows.push({ id: b.id, mean: b.mean, base, save: base - b.mean, pct: 100 * (base - b.mean) / base });
}
rows.sort((a, b) => b.save - a.save);
for (const x of rows)
  console.log('   ' + x.id.padEnd(24) + x.mean.toFixed(1).padStart(10) + '   base ' + x.base.toFixed(1).padStart(7) +
              '  →  ' + (x.save >= 0 ? '+' : '') + x.save.toFixed(1).padStart(7) + 'ms  (' + x.pct.toFixed(1) + '%)');
if (r.notes.length) console.log('\n   notes: ' + r.notes.join(' | '));
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
