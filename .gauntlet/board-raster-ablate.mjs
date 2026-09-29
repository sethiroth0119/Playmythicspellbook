/* ══════════════════════════════════════════════════════════════════════════
   🔬 BOARD-RASTER-ABLATE — what the board actually costs, ONE PAGE LOAD, and
   which pass owns it.

   ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
   Two earlier instruments each told half a lie:

   · measure-board.mjs reports median ~4 ms / p90 ~6 ms. That is the time to
     BUILD a display list. Canvas2D on this rig defers rasterisation until
     something forces it, and a synchronous driver never composites, so 4 ms is
     what the board costs to DESCRIBE, not to DRAW. vista.js's header has said
     so since wave 6 ("gradeP50 reported 0.40 ms in the same session in which a
     per-frame-flushed ablation put grade() at 19.1 ms — 48x out").

   · board-raster-ab.mjs runs each arm on its own page load, and this box drifts
     hard enough between loads that the SAME arm came out 19.9 s in one order
     and 40.8 s in the reverse order. Cross-load totals here are noise.

   So: ONE page load, ONE warm-up, and every arm measured as a block that is
   BRACKETED BY CONTROL BLOCKS of the identical shape. Each arm is scored
   against the mean of the control blocks either side of it, which cancels any
   drift that is linear over the length of a block pair. The control is also
   repeated many times, so its own spread is reported and any delta smaller
   than that spread is explicitly NOT a finding.

   ── THE FLUSH IS THE WHOLE POINT ────────────────────────────────────────────
   Every frame ends with a 1x1 getImageData on the MAIN canvas. That is a
   pipeline sync: it cannot return until this frame's display list has actually
   rasterised. With it, each frame pays its own bill and an ablation means
   something. Without it, the bill is deferred and lands in a lump on whichever
   later frame happens to sync — which is exactly the ~2 s outlier this whole
   investigation started from.
   The flush is driver-side, not `__vistaOff.flush`, because one arm stubs
   grade() out entirely and the flush must survive that.

   ⚠ THE RIG IS SwiftShader (software GL). Rasterisation is CPU work at
     software speed and these absolute ms are NOT what a player's GPU pays.
     Only the WITHIN-RUN ratios (arm vs its own control) carry over, and even
     they carry over only as "which pass is heavy", never as a frame budget.

   Run:  node .gauntlet/board-raster-ablate.mjs [framesPerBlock]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const NB = Number(process.argv[2] || 40);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8600 + (process.pid % 60);
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
  out.dpr = w.devicePixelRatio;
  const flush = () => { try { g2.getImageData(0, 0, 1, 1); } catch (e) { out.flushErr = String(e).slice(0, 80); } };

  /* 🔴 silence the self-rearming rAF for the whole measured session */
  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  const runBlock = (n, doFlush) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
      if (doFlush) flush();
      ts.push(performance.now() - a);
    }
    const s = ts.slice().sort((x, y) => x - y);
    return { n, mean: +(ts.reduce((x, y) => x + y, 0) / n).toFixed(2),
             p50: +s[n >> 1].toFixed(2), max: +s[n - 1].toFixed(2),
             over500: ts.filter(x => x > 500).length, ts };
  };

  /* ── warm past LOADQ (retires at step 21) and past the first bakes ── */
  runBlock(90, true);

  /* ── ablation table. Each entry stubs something and is restored after. ──
     BBX.* are plain properties. The bare names are top-level `function`
     declarations, i.e. properties of the iframe's global object, and frame()
     resolves them through it — so replacing window.<name> really does redirect
     the call. (MAP / VIEW / CAM_FIT / STRUCT_DEF / TRUCK_WR are `const` and
     are deliberately never touched here — THE GLOBALS TRAP.) */
  const BBX = w.BBX || {};
  const noop = () => {};
  const nilArr = () => [];
  const ARMS = [
    ['vista.grade',        () => { const o = BBX.vista.grade; BBX.vista.grade = noop; return () => BBX.vista.grade = o; }],
    ['vista.draw',         () => { const o = BBX.vista.draw; BBX.vista.draw = noop; return () => BBX.vista.draw = o; }],
    ['tilefx.surfaces+states', () => { const a = BBX.tilefx.drawSurfaces, b = BBX.tilefx.drawStatesOver;
                             BBX.tilefx.drawSurfaces = noop; BBX.tilefx.drawStatesOver = noop;
                             return () => { BBX.tilefx.drawSurfaces = a; BBX.tilefx.drawStatesOver = b; }; }],
    ['dressing.items',     () => { const o = BBX.dressing.items; BBX.dressing.items = nilArr; return () => BBX.dressing.items = o; }],
    ['drawBoard (ground)', () => { const o = w.drawBoard; w.drawBoard = noop; return () => w.drawBoard = o; }],
    ['drawPylon x4',       () => { const o = w.drawPylon; w.drawPylon = noop; return () => w.drawPylon = o; }],
    ['drawUnit',           () => { const o = w.drawUnit; w.drawUnit = noop; return () => w.drawUnit = o; }],
    ['drawStruct+drawTruck', () => { const a = w.drawStruct, b = w.drawTruck; w.drawStruct = noop; w.drawTruck = noop;
                             return () => { w.drawStruct = a; w.drawTruck = b; }; }],
    ['drawParticles+Effects', () => { const a = w.drawParticles, b = w.drawEffects; w.drawParticles = noop; w.drawEffects = noop;
                             return () => { w.drawParticles = a; w.drawEffects = b; }; }],
    ['drawRain',           () => { const o = w.drawRain; w.drawRain = noop; return () => w.drawRain = o; }],
    ['drawNameplates',     () => { const o = w.drawNameplates; w.drawNameplates = noop; return () => w.drawNameplates = o; }],
    ['clipBehindTerrain',  () => { const o = w.clipBehindTerrain; w.clipBehindTerrain = () => false; return () => w.clipBehindTerrain = o; }],
    ['drawGuides',         () => { const o = w.drawGuides; w.drawGuides = noop; return () => w.drawGuides = o; }],
  ].filter(a => a);

  /* control, arm, control, arm, … — every arm sits between two controls */
  out.blocks.push({ id: 'CONTROL', ...runBlock(NB, true) });
  for (const [id, apply] of ARMS) {
    let restore = null;
    try { restore = apply(); } catch (e) { out.notes.push(id + ' could not be stubbed: ' + String(e).slice(0, 60)); continue; }
    out.blocks.push({ id, ...runBlock(NB, true) });
    try { restore(); } catch (e) {}
    out.blocks.push({ id: 'CONTROL', ...runBlock(NB, true) });
  }

  /* ── and the unflushed control, LAST, so the debt it accumulates cannot
     contaminate anything above it. This is the regime the 2 s outlier lives
     in and it is here to show the spike is still there. ── */
  out.unflushed = runBlock(NB * 3, false);
  out.unflushed.ts = out.unflushed.ts.map(x => +x.toFixed(1));

  w.requestAnimationFrame = _raf;
  out.framesRan = ran;
  out.frameErr = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  out.vista = (() => { try { const d = w.__vistaDebug(); return { cadence: d.post.cadence, reads: d.post.reads, calls: d.post.calls }; } catch (e) { return null; } })();
  for (const b of out.blocks) delete b.ts;
  return out;
}, NB);

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }

console.log('\n\u{1F52C} BOARD RASTER ABLATION — one page load, ' + NB + ' frames per block, per-frame flush');
console.log('   host ' + BOX.width + 'x' + BOX.height + ' · stage canvas ' + r.canvas + ' · dpr ' + r.dpr +
            ' · frames run ' + r.framesRan + ' · frameErr ' + r.frameErr);
console.log('   SwiftShader (software GL) — WITHIN-RUN ratios only. These ms are not a player frame budget.\n');

const ctrls = r.blocks.filter(b => b.id === 'CONTROL').map(b => b.mean);
const cMean = ctrls.reduce((a, b) => a + b, 0) / ctrls.length;
const cMin = Math.min(...ctrls), cMax = Math.max(...ctrls);
console.log('   CONTROL blocks: n=' + ctrls.length + '  mean ' + cMean.toFixed(1) + 'ms/frame  ' +
            'spread ' + cMin.toFixed(1) + '–' + cMax.toFixed(1) + 'ms  (±' +
            (100 * (cMax - cMin) / 2 / cMean).toFixed(1) + '%)');
console.log('   ⚠ any arm whose delta is inside that spread is NOT a finding.\n');

console.log('   ' + 'ABLATED PASS'.padEnd(26) + 'ms/frame'.padStart(10) + '   vs adjacent controls');
const rows = [];
for (let i = 0; i < r.blocks.length; i++) {
  const b = r.blocks[i];
  if (b.id === 'CONTROL') continue;
  const near = [r.blocks[i - 1], r.blocks[i + 1]].filter(x => x && x.id === 'CONTROL').map(x => x.mean);
  const base = near.reduce((a, c) => a + c, 0) / near.length;
  rows.push({ id: b.id, mean: b.mean, base, save: base - b.mean, pct: 100 * (base - b.mean) / base });
}
rows.sort((a, b) => b.save - a.save);
for (const x of rows) {
  const sig = Math.abs(x.save) > (cMax - cMin) ? '' : '   (inside control spread — not a finding)';
  console.log('   ' + x.id.padEnd(26) + x.mean.toFixed(1).padStart(10) + '   base ' + x.base.toFixed(1) +
              '  →  saves ' + (x.save >= 0 ? '+' : '') + x.save.toFixed(1) + 'ms/frame  (' +
              x.pct.toFixed(1) + '%)' + sig);
}

console.log('\n   ── UNFLUSHED TAIL (the regime the 2 s outlier lives in), ' + r.unflushed.n + ' frames');
const u = r.unflushed;
console.log('      mean ' + u.mean + 'ms/frame · p50 ' + u.p50 + 'ms · MAX ' + u.max + 'ms · frames >500ms: ' + u.over500);
console.log('      spikes at: ' + u.ts.map((v, i) => v > 500 ? i : -1).filter(i => i >= 0).join(', '));
console.log('      ⚠ mean(unflushed) ' + u.mean + ' vs mean(CONTROL, flushed) ' + cMean.toFixed(1) +
            '  — if these agree, the spike is DEFERRED RASTERISATION, not extra work.');
console.log('      ⚠ MAX/12 = ' + (u.max / 12).toFixed(1) + 'ms — the per-frame cost the sync collected ' +
            '(POST_CADENCE is 12).');
console.log('\n   vista post: ' + JSON.stringify(r.vista));
if (r.notes.length) console.log('   notes: ' + r.notes.join(' | '));
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
