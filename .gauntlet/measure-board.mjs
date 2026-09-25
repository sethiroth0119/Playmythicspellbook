/* ══════════════════════════════════════════════════════════════════════════
   📏 MEASURE-BOARD — the three numbers behind "zoom out, shrink the props,
   make it smooth", before changing any of them.

   Asked for: the board framed like the wide shot (whole field visible, not a
   close crop), the trucks and houses sized to sit ON a tile instead of
   straddling several, and a smoother frame.

   ⚠ TUNE AGAINST NUMBERS, NOT BY EYE. The fit block in battle-board/index.html
     already records what happens otherwise: the 14x12 board came out 649x279px
     in the real 802x688 rect — 81% of the host's width but 41% of its height —
     and the previous framing was "fixed" by eye three times before someone
     measured it. So this reports:
       1. FRAMING   — the board's on-screen bbox as a share of the host box,
                      and how many of the 12 rows actually land inside it.
       2. FOOTPRINT — each prop's drawn half-width in px against the hex
                      inradius at the same depth. A value over 1.0 means the
                      prop is wider than the tile it stands on.
       3. FRAME     — ms/frame over a real render loop, plus draw calls and
                      triangles, so "smooth" is a number and not a vibe.

   🔴 OBEYS THE RENDER TRAP (CLAUDE.md / .gauntlet README item 6): the stage is
     driven by calling the renderer directly, never by waiting on rAF, because
     the pane composites at ~0.56 Hz and a rAF-batched render does nothing
     inside a synchronous driver.

   Run:  node .gauntlet/measure-board.mjs
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
const PORT = 8300 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* The REAL in-game rect the fit block quotes, so these numbers are comparable
   to the ones already written down there. */
const BOX = { width: 900, height: 760 };
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: BOX });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
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

/* 🔴 THE GLOBALS TRAP, INSIDE THE BOARD TOO. MAP / VIEW / CAM_FIT / STRUCT_DEF
   / TRUCK_WR are top-level `const` in battle-board/index.html — lexical
   bindings, NOT properties of window — so page.evaluate cannot see any of them,
   while `function` declarations (project, gw, tileR, ringPx, hexW,
   boardExtent, frame) ARE on window and can be called. The first draft of this
   driver asked for the consts, got "stage globals not reachable", and would
   have been read as "the stage did not load".
   So: geometry comes from the FUNCTIONS, and the size constants are read out of
   the source in Node and passed in. */
const SRC = fs.readFileSync(path.join(ROOT, 'battle-board/index.html'), 'utf8');
const numOf = (re) => { const m = SRC.match(re); return m ? Number(m[1]) : null; };
const DEFS = {};
{
  const seg = SRC.slice(SRC.indexOf('const STRUCT_DEF = {'), SRC.indexOf('};', SRC.indexOf('const STRUCT_DEF = {')));
  for (const m of seg.matchAll(/(\w+):\s*\{\s*h:\s*([0-9.]+),\s*wr:\s*([0-9.]+)/g)) {
    DEFS[m[1]] = { h: Number(m[2]), wr: Number(m[3]) };
  }
  DEFS.truck = { h: numOf(/const TRUCK_H\s*=\s*([0-9.]+)/), wr: numOf(/const TRUCK_WR\s*=\s*([0-9.]+)/) };
  /* ⚠ APPLY PROP_SCALE, or this driver grades the AUTHORED table instead of the
     one the board actually draws. STRUCT_DEF is scaled in place at load and
     TRUCK_H/TRUCK_WR are declared as `literal * PROP_SCALE`, so a regex that
     stops at the literal reports the pre-shrink numbers — it would have shown
     the props still oversized after the fix and sent the next person chasing a
     change that had already landed. */
  const scale = numOf(/const PROP_SCALE\s*=\s*([0-9.]+)/);
  if (!(scale > 0)) throw new Error('PROP_SCALE not found — the driver cannot grade what the board draws');
  for (const k in DEFS) { if (DEFS[k] && DEFS[k].wr) { DEFS[k].wr *= scale; DEFS[k].h *= scale; } }
  DEFS._scale = scale;
}

const r = await page.evaluate(async (DEFS) => {
  /* The stage lives in the harness's child frame. */
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const out = { inFrame: !!fr };
  const has = (n) => { try { return typeof w[n] === 'function'; } catch (e) { return false; } };
  out.seen = ['project', 'gw', 'tileR', 'tileElev', 'ringPx', 'hexW', 'boardExtent', 'frame'].filter(has);
  if (!has('project') || !has('boardExtent')) { out.err = 'stage FUNCTIONS not reachable'; return out; }

  const cv = (fr ? fr.contentDocument : document).querySelector('canvas');
  const rect = cv ? cv.getBoundingClientRect() : null;
  const VIEW = { box: { w: rect ? rect.width : w.innerWidth, h: rect ? rect.height : w.innerHeight } };
  /* Board size from the shipped extent helper rather than a remembered literal. */
  const ext = w.boardExtent();
  out.extent = { x: +ext.x.toFixed(2), z: +ext.z.toFixed(2) };
  /* Probe outward for the real column/row count: gw is a pure transform, so
     find the range whose tiles actually carry elevation data. */
  let cols = 0, rows = 0;
  for (let i = 0; i < 40; i++) { try { if (typeof w.tileElev(i, 0) === 'number') cols = i + 1; else break; } catch (e) { break; } }
  for (let j = 0; j < 40; j++) { try { if (typeof w.tileElev(0, j) === 'number') rows = j + 1; else break; } catch (e) { break; } }
  const MAP = { cols: cols || 14, rows: rows || 12 };
  out.map = MAP;
  out.box = { w: Math.round(VIEW.box.w), h: Math.round(VIEW.box.h) };

  /* ── 1. FRAMING: bbox of every tile CENTRE, and how many rows are inside ── */
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  let rowsInside = 0;
  for (let z = 0; z < MAP.rows; z++) {
    let anyInside = false;
    for (let x = 0; x < MAP.cols; x++) {
      const wp = w.gw(x, z, w.tileElev(x, z));
      const p = w.project({ x: wp.x, y: wp.y, z: wp.z });
      if (!p) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      if (p.x >= 0 && p.x <= VIEW.box.w && p.y >= 0 && p.y <= VIEW.box.h) anyInside = true;
    }
    if (anyInside) rowsInside++;
  }
  out.bbox = { w: Math.round(x1 - x0), h: Math.round(y1 - y0), x0: Math.round(x0), y0: Math.round(y0) };
  out.shareW = +((x1 - x0) / VIEW.box.w).toFixed(3);
  out.shareH = +((y1 - y0) / VIEW.box.h).toFixed(3);
  out.rowsInside = rowsInside;
  out.rowsTotal = MAP.rows;

  /* ── 2. FOOTPRINT: prop half-width vs the hex inradius, same tile ───────── */
  const mid = { x: Math.floor(MAP.cols / 2), z: Math.floor(MAP.rows / 2) };
  const wp = w.gw(mid.x, mid.z, w.tileElev(mid.x, mid.z));
  const foot = w.project({ x: wp.x, y: wp.y, z: wp.z });
  const tileHalfPx = w.ringPx ? w.ringPx(foot, w.tileR()) : null;
  out.tileR = +w.tileR().toFixed(3);
  out.tileHalfPx = tileHalfPx ? Math.round(tileHalfPx) : null;
  out.props = {};
  if (tileHalfPx) {
    for (const k of Object.keys(DEFS)) {
      const d = DEFS[k];
      if (!d || !(d.wr > 0)) continue;
      const halfPx = w.ringPx(foot, w.tileR() * d.wr);
      out.props[k] = { wr: d.wr, h: d.h, halfPx: Math.round(halfPx),
                       tilesWide: +(halfPx / tileHalfPx).toFixed(2) };
    }
  }

  /* ── 3. FRAME: drive frame(t) DIRECTLY with a monotonically rising t, and
     COUNT the calls that landed. Never wait on rAF — the pane composites at
     ~0.56 Hz, so a rAF-gated measurement reads the throttle, not the board.
     Counting is not optional: a static scene that never repaints produces the
     same timings as a fast one. */
  out.rendererName = has('frame') ? 'frame' : null;
  if (has('frame')) {
    let t = performance.now();
    let ran = 0;
    const call = () => { t += 16.7; try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 90); } };
    /* 🔴 WARM PAST THE LOAD SCHEDULE. frame() advances LOADQ for 21 steps and the
       vista bake alone is ~106ms; a 10-frame warm-up leaves those bakes INSIDE
       the measured window and reports cold-load cost as gameplay stutter. */
    for (let i = 0; i < 90; i++) call();
    const N = 60, ts = [];
    for (let i = 0; i < N; i++) {
      const a = performance.now();
      call();
      ts.push(performance.now() - a);
    }
    out.framesRan = ran;
    out.frameErrLatched = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
    ts.sort((a, b) => a - b);
    out.frame = { n: N, min: +ts[0].toFixed(2), median: +ts[N >> 1].toFixed(2),
                  p90: +ts[Math.floor(N * 0.9)].toFixed(2), max: +ts[N - 1].toFixed(2) };
    out.frame.fpsAtMedian = Math.round(1000 / Math.max(0.01, out.frame.median));
  }
  return out;
}, DEFS);

const n = (x) => (x == null ? '—' : String(x));
console.log('\n\u{1F4CF} BOARD MEASUREMENTS — host box ' + BOX.width + 'x' + BOX.height + '\n');
if (r.err) { console.log('   ' + r.err + '   (globals seen: ' + (r.seen || []).join(', ') + ')'); }
else {
  console.log('   map ' + r.map.cols + 'x' + r.map.rows + ' · stage box ' + JSON.stringify(r.box) +
              ' · renderer ' + n(r.rendererName));
  console.log('\n1. FRAMING (bbox of tile CENTRES)');
  console.log('   bbox ' + r.bbox.w + 'x' + r.bbox.h + 'px  =  ' +
              (r.shareW * 100).toFixed(1) + '% of box width, ' + (r.shareH * 100).toFixed(1) + '% of height');
  console.log('   rows with any tile on screen: ' + r.rowsInside + '/' + r.rowsTotal);
  console.log('\n2. FOOTPRINT (half-width in px vs the hex inradius at the same tile)');
  console.log('   hex inradius on screen: ' + n(r.tileHalfPx) + 'px');
  for (const k of Object.keys(r.props || {})) {
    const p = r.props[k];
    console.log('   ' + k.padEnd(10) + 'wr=' + String(p.wr).padEnd(6) + 'h=' + String(p.h).padEnd(6) +
                p.halfPx + 'px half  =  ' + p.tilesWide + '× the tile' +
                (p.tilesWide > 1 ? '   ← WIDER THAN ITS TILE' : ''));
  }
  console.log('\n3. FRAME COST (renderer called directly, ' + (r.frame ? r.frame.n : 0) + ' calls)');
  if (r.frame) {
    console.log('   frames actually run: ' + r.framesRan + ' · frameErr latched: ' + r.frameErrLatched);
    console.log('   min ' + r.frame.min + 'ms · median ' + r.frame.median + 'ms · p90 ' +
                r.frame.p90 + 'ms · max ' + r.frame.max + 'ms   (~' + r.frame.fpsAtMedian + 'fps at median)');
  } else console.log('   no renderer reachable' + (r.drawErr ? ' — ' + r.drawErr : ''));
}
console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
await browser.close();
server.close();
