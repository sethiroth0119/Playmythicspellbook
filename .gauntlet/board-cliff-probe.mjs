/* ══════════════════════════════════════════════════════════════════════════
   🧗 BOARD-CLIFF-PROBE — is the cheap side of the cliff a PROPERTY OF THE
   CANVAS, or did the board's own work get cheaper?

   board-warm-curve.mjs found that the board costs ~170 ms/frame to rasterise
   for its first few hundred frames and ~16 ms after — a step, not a decay —
   and that the ~2 s outlier lives entirely on the expensive side. Nothing in
   the board's JS changes at that moment: the same passes run, the same 28
   dressing items draw, the terrain does not re-bake (__bbDebug.terrain()
   reports the same bakeMs throughout).

   The obvious suspect is Chromium's own canvas behaviour. A 2D canvas that is
   read back repeatedly gets its acceleration withdrawn — the readback
   heuristic behind `willReadFrequently` — and on a SwiftShader rig the
   software path is dramatically FASTER than the "accelerated" one, because
   the acceleration is itself software. grade() reads the main canvas back
   once every POST_CADENCE frames, which is exactly the pattern that trips it.

   THE TEST, and it is falsifiable in both directions:
     draw an IDENTICAL synthetic workload on
       (A) the board's own canvas, and
       (B) a canvas created fresh at that moment, same size,
     once BEFORE the cliff and once AFTER it.

     · If the cliff is per-canvas — a mode switch on the board's canvas — then
       after it A is fast while a freshly created B is still slow.
     · If the whole process merely warmed up (JIT, code caches, the rasteriser
       generally), A and B are fast together after the cliff.
     · If neither moves, the cliff is in the board's own JS and this probe
       says nothing — go back to ablation.

   ⚠ THE RIG IS SwiftShader (software GL). This probe is ABOUT the rig; its
     conclusion is a statement about the measuring instrument, not about what
     a player's machine does.

   Run:  node .gauntlet/board-cliff-probe.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 9000 + (process.pid % 60);
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

const r = await page.evaluate(async () => {
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const doc = fr ? fr.contentDocument : document;
  const out = {};
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }
  const cv = doc.querySelector('canvas');
  const g2 = cv.getContext('2d');
  out.canvas = cv.width + 'x' + cv.height;
  const W = cv.width, H = cv.height;

  /* the synthetic workload: plain filled paths, no shadowBlur and no ctx.filter,
     because dressing.js uses neither (grepped: 0 hits for each) and the point
     is to imitate what the board actually asks the rasteriser for — a few
     hundred small opaque/alpha polygons. */
  const workload = (c) => {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 400; i++) {
      c.beginPath();
      const x = (i * 37) % W, y = (i * 53) % H, rr = 6 + (i % 11);
      c.moveTo(x, y);
      for (let k = 1; k < 9; k++) c.lineTo(x + rr * Math.cos(k), y + rr * Math.sin(k * 1.7));
      c.closePath();
      c.globalAlpha = 0.35 + (i % 5) * 0.12;
      c.fillStyle = i % 3 ? '#7a6b58' : '#3a4450';
      c.fill();
    }
    c.restore();
  };
  /* ── THE CLIP WORKLOAD ─────────────────────────────────────────────────
     Added after the first version of this probe came back flat: plain fills
     cost 1.2 ms on every canvas on both sides of the cliff, so whatever the
     cliff is, it is not "filling paths got faster".
     What separates the one dressing kind that DOES move (rock, 2.74 ms each
     cold → 0.48 ms warm) from the two that do not (scrub, tree) is
     paintStone's `g.save(); g.clip()` — a NON-RECTANGULAR clip taken from the
     stone silhouette, then drawn through, ~36 times a frame (12 rocks, up to
     3 parts each). A non-rectangular clip is the one canvas op that can force
     a rasteriser to allocate and compose a mask layer, and on a GPU-backed
     surface that is a render-target switch. So this is the workload that has
     to be timed, and the earlier one was measuring the wrong thing. */
  const clipWork = (c) => {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i < 36; i++) {
      const x = (i * 37) % W, y = (i * 53) % H, rr = 10 + (i % 9);
      c.beginPath();
      c.moveTo(x, y);
      for (let k = 1; k < 11; k++) c.lineTo(x + rr * Math.cos(k * 0.6), y + rr * Math.sin(k * 0.9));
      c.closePath();
      c.fillStyle = '#7a6b58'; c.fill();
      c.save(); c.clip();
      for (let b = 0; b < 5; b++) {
        c.beginPath(); c.moveTo(x - rr, y + b * 3); c.quadraticCurveTo(x, y + b * 3 - 2, x + rr, y + b * 3);
        c.lineWidth = 1.2; c.strokeStyle = 'rgba(220,210,190,0.2)'; c.stroke();
      }
      c.restore();
    }
    c.restore();
  };
  /* ── THE BLIT WORKLOAD — the other way a canvas can be slow: if the source
     and destination surfaces live in different memories, every drawImage is an
     upload or a download rather than a copy. */
  const src = doc.createElement('canvas');
  src.width = Math.max(8, W >> 1); src.height = Math.max(8, H >> 1);
  { const s = src.getContext('2d'); s.fillStyle = '#456'; s.fillRect(0, 0, src.width, src.height); }
  const blitWork = (c) => {
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 0.5;
    for (let i = 0; i < 20; i++) c.drawImage(src, 0, 0, W, H);
    c.restore();
  };

  const timeWork = (work, ctx, n) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      const a = performance.now();
      work(ctx);
      try { ctx.getImageData(0, 0, 1, 1); } catch (e) {}   /* force rasterisation */
      ts.push(performance.now() - a);
    }
    ts.sort((x, y) => x - y);
    return +ts[ts.length >> 1].toFixed(2);
  };
  const timeOn = (canvas, ctx, n) => timeWork(workload, ctx, n);
  const freshCanvas = () => {
    const c = doc.createElement('canvas');
    c.width = W; c.height = H;
    doc.body.appendChild(c);
    return { c, g: c.getContext('2d') };
  };

  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;
  let t = performance.now();
  const drive = (n, flush) => {
    for (let i = 0; i < n; i++) {
      t += 16.7;
      try { w.frame(t); } catch (e) {}
      if (flush) { try { g2.getImageData(0, 0, 1, 1); } catch (e) {} }
    }
  };
  const frameCost = (n) => {
    const ts = [];
    for (let i = 0; i < n; i++) {
      t += 16.7;
      const a = performance.now();
      try { w.frame(t); } catch (e) {}
      try { g2.getImageData(0, 0, 1, 1); } catch (e) {}
      ts.push(performance.now() - a);
    }
    ts.sort((x, y) => x - y);
    return +ts[ts.length >> 1].toFixed(2);
  };

  drive(40, false);                       /* past LOADQ, still cold */
  out.coldFrame = frameCost(20);
  const b1 = freshCanvas();
  out.coldBoardCanvas = timeOn(cv, g2, 12);
  out.coldFreshCanvas = timeOn(b1.c, b1.g, 12);
  out.coldClipBoard = timeWork(clipWork, g2, 12);
  out.coldClipFresh = timeWork(clipWork, b1.g, 12);
  out.coldBlitBoard = timeWork(blitWork, g2, 12);
  out.coldBlitFresh = timeWork(blitWork, b1.g, 12);

  drive(900, true);                       /* over the cliff */
  out.warmFrame = frameCost(20);
  const b2 = freshCanvas();
  out.warmBoardCanvas = timeOn(cv, g2, 12);
  out.warmFreshCanvas = timeOn(b2.c, b2.g, 12);
  /* and the canvas created BEFORE the cliff, re-timed now: if the switch is
     per-canvas and driven by readbacks, b1 has had 12 readbacks of its own and
     may have switched too. */
  out.warmFirstFreshAgain = timeOn(b1.c, b1.g, 12);
  out.warmClipBoard = timeWork(clipWork, g2, 12);
  out.warmClipFresh = timeWork(clipWork, b2.g, 12);
  out.warmBlitBoard = timeWork(blitWork, g2, 12);
  out.warmBlitFresh = timeWork(blitWork, b2.g, 12);

  w.requestAnimationFrame = _raf;
  return out;
});

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }
const p = (n, v) => console.log('   ' + n.padEnd(34) + String(v).padStart(9) + ' ms (median)');
console.log('\n\u{1F9D7} CLIFF PROBE — board canvas ' + r.canvas + ' · SwiftShader (software GL)\n');
console.log('   BEFORE the cliff');
p('board frame', r.coldFrame);
p('synthetic on the BOARD canvas', r.coldBoardCanvas);
p('synthetic on a FRESH canvas', r.coldFreshCanvas);
console.log('\n   AFTER ~900 flushed frames');
p('board frame', r.warmFrame);
p('synthetic on the BOARD canvas', r.warmBoardCanvas);
p('synthetic on a FRESH canvas', r.warmFreshCanvas);
p('synthetic on the FIRST fresh canvas', r.warmFirstFreshAgain);
console.log('\n   CLIP workload — 36 non-rectangular clips, the paintStone shape');
p('  cold  board canvas', r.coldClipBoard);
p('  cold  fresh canvas', r.coldClipFresh);
p('  warm  board canvas', r.warmClipBoard);
p('  warm  fresh canvas', r.warmClipFresh);
console.log('\n   BLIT workload — 20 scaled drawImage from a second canvas');
p('  cold  board canvas', r.coldBlitBoard);
p('  cold  fresh canvas', r.coldBlitFresh);
p('  warm  board canvas', r.warmBlitBoard);
p('  warm  fresh canvas', r.warmBlitFresh);
console.log('\n   reading: if the board canvas got fast while a canvas created AFTERWARDS is');
console.log('   still slow, the cliff is a per-canvas mode switch in the browser, not the board.');
console.log('\n   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
