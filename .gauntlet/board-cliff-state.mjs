/* ══════════════════════════════════════════════════════════════════════════
   🔦 BOARD-CLIFF-STATE — what is DIFFERENT about the board on the two sides
   of the cliff.

   Established by the drivers beside this one:
     · the ~2 s outlier is every 12th frame, inside vista.grade's postMap
       readback (POST_CADENCE = 12) — but flushed and unflushed runs cost the
       SAME TOTAL, so the readback COLLECTS deferred rasterisation, it does not
       create work.  (attribute-board-spike.mjs, board-warm-curve.mjs)
     · the frame costs ~170 ms for a few hundred frames and ~16 ms after, as a
       step.  (board-warm-curve.mjs)
     · it is not the rasteriser warming up: 400 alpha polygons cost 1.2 ms on
       the board's canvas AND on a canvas created fresh, on both sides of the
       cliff.  (board-cliff-probe.mjs)
     · the whole difference is set dressing, and inside dressing it is ONE
       kind: rock goes 2.74 ms per rock cold to 0.48 ms warm, 12 rocks either
       way, while scrub (4.73 → 4.51) and tree (0.44 → 0.45) do not move at
       all.  (board-dressing-attrib.mjs)

   Twelve rocks drawn by the same function with the same geometry cannot cost
   5.6x different unless something they READ has changed. This dumps the state
   they read — canvas size, projection, camera fit, light, reveal — on both
   sides, and diffs it.

   ⚠ THE GLOBALS TRAP: VIEW / CAM_FIT / MAP are `const` and unreachable. Every
     field below comes from a `function` (project, gw, tileElev, boardExtent,
     buildApi) or from window.__bbDebug — the documented seams.
   ⚠ SwiftShader rig. The ms are relative only.

   Run:  node .gauntlet/board-cliff-state.mjs
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
const PORT = 9100 + (process.pid % 60);
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

  const snap = () => {
    const s = {};
    s.canvas = cv.width + 'x' + cv.height;
    s.cssBox = (() => { const b = cv.getBoundingClientRect(); return Math.round(b.width) + 'x' + Math.round(b.height); })();
    s.transform = (getComputedStyle(cv).transform || '').slice(0, 40);
    s.dpr = w.devicePixelRatio;
    try { const p0 = w.__bbDebug.tileScreen(0, 0), p1 = w.__bbDebug.tileScreen(13, 11);
          s.tile00 = p0 && { x: Math.round(p0.x), y: Math.round(p0.y) };
          s.tile1311 = p1 && { x: Math.round(p1.x), y: Math.round(p1.y) }; } catch (e) { s.projErr = 1; }
    try { const e = w.boardExtent(); s.extent = { x: +e.x.toFixed(2), z: +e.z.toFixed(2) }; } catch (e) {}
    try { s.terrainBake = w.__bbDebug.terrain().bakeMs; } catch (e) {}
    try { s.load = w.__bbDebug.load(); } catch (e) {}
    try { const rv = w.__bbDebug.reveal(); s.reveal = { run: rv.run, playState: rv.playState }; } catch (e) {}
    try {
      const api = w.buildApi(0.016);
      s.T = +(api.T || 0).toFixed(2);
      s.LIGHT = api.LIGHT ? { key: api.LIGHT.key, ambient: api.LIGHT.ambient, elev: api.LIGHT.elev && +api.LIGHT.elev.toFixed(3),
                              az: api.LIGHT.az && +api.LIGHT.az.toFixed(3), haze: api.LIGHT.haze } : null;
      s.lightVector = api.lightVector ? (function(){ const v = api.lightVector();
        return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; })() : null;
      s.tod = api.timeOfDay;
      /* the anchor a rock actually draws through, for the first rock */
      const items = (w.BBX.dressing.items(api) || []).filter(i => i && i.kind === 'rock');
      s.rocks = items.length;
      if (items.length) {
        const it = items[0];
        const wp = w.gw(it.gx, it.gz, it.y || 0);
        const p = w.project(wp);
        s.rock0 = { gx: +it.gx.toFixed(2), gz: +it.gz.toFixed(2),
                    screen: p && { x: Math.round(p.x), y: Math.round(p.y) },
                    bodyW: it.body && +(+it.body.w).toFixed(3),
                    parts: it.body && it.body.parts ? it.body.parts.length : 0,
                    pts: it.body && it.body.pts ? it.body.pts.length : 0 };
      }
    } catch (e) { s.apiErr = String(e).slice(0, 90); }
    return s;
  };

  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;
  let t = performance.now();
  const cost = (n) => {
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
  const drive = (n) => { for (let i = 0; i < n; i++) { t += 16.7; try { w.frame(t); } catch (e) {}
                         try { g2.getImageData(0, 0, 1, 1); } catch (e) {} } };

  for (let i = 0; i < 40; i++) { t += 16.7; try { w.frame(t); } catch (e) {} }
  out.coldCost = cost(20);
  out.cold = snap();
  drive(900);
  out.warmCost = cost(20);
  out.warm = snap();
  w.requestAnimationFrame = _raf;
  return out;
});

if (r.err) { console.log('ERR ' + r.err); await browser.close(); server.close(); process.exit(1); }
console.log('\n\u{1F526} CLIFF STATE DIFF — SwiftShader rig\n');
console.log('   frame median: COLD ' + r.coldCost + 'ms   →   WARM ' + r.warmCost + 'ms\n');
const keys = [...new Set([...Object.keys(r.cold), ...Object.keys(r.warm)])];
let diffs = 0;
for (const k of keys) {
  const a = JSON.stringify(r.cold[k]), b = JSON.stringify(r.warm[k]);
  const same = a === b;
  if (!same) diffs++;
  console.log('   ' + (same ? '   ' : ' ≠ ') + k.padEnd(14) + (same ? a : a + '\n' + ' '.repeat(21) + '→ ' + b));
}
console.log('\n   fields that changed across the cliff: ' + diffs);
console.log('   page errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('      ' + e));
await browser.close();
server.close();
