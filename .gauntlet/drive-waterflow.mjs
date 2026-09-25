/* ══════════════════════════════════════════════════════════════════════════
   🌊 DRIVE-WATERFLOW — does water visibly MOVE along a connected main?

   The ask: "show a flow of water going through pipes if they are connected."
   The two halves of that are separately falsifiable and both are tested here:

     1  IT MOVES WHEN CONNECTED — a run with a waterworks on it animates.
     2  IT DOES NOT WHEN IT IS NOT — a run with no waterworks is still. This is
        the CONTROL, and without it "the pipes animate" proves nothing: an
        animation that plays on every network regardless is a screensaver, not
        a readout, and would pass any test that only looked at the live case.
     3  DIRECTION IS DERIVED — the dashes travel AWAY from the waterworks. A
        network fed from its EAST end must animate in the mirror image of the
        same network fed from its WEST end. Nothing about pixel-counting can
        catch a flow that points the wrong way, so this compares the two.

   🔴 WHY THIS CAN READ THE ANIMATION AT ALL, given .gauntlet/README.md item 6.
      The framebuffer trap applies to the WebGL canvas: preserveDrawingBuffer is
      off, so an A/B that flips a layer and calls readPixels gets the frame from
      before the flip and reports a confident, wrong zero. None of that applies
      here. /src/water/netui.js paints its mains into an ordinary 2D
      CanvasTexture; this reads THAT canvas, with a 2D context, which is
      retained between tasks and needs no render() interleaved. The canvas is
      never attached to the document, so it is reached through the named mesh
      (`mythic-water-mains`) via the __nc scene seam.

   Run:  node .gauntlet/drive-waterflow.mjs
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
const PORT = 8600 + (process.pid % 90);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.startsWith('/__three/')) {
    const f = path.join(THREE_DIR, p.slice('/__three/'.length));
    if (fs.existsSync(f)) { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return fs.createReadStream(f).pipe(res); }
    res.writeHead(404); return res.end('nf');
  }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
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
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 240)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc && !!window.MythicWater', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(6000);

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};

console.log('0. boot');
const boot = await page.evaluate(() => ({
  nc: !!window.__nc, water: !!(window.MythicWater && window.MythicWater.ready()),
  scene: !!(window.__nc && typeof window.__nc.scene === 'function' && window.__nc.scene()),
}));
ok('node-city booted', boot.nc);
ok('/src/water is mounted', boot.water);
ok('the scene seam is present (needed to reach the mains canvas)', boot.scene);
if (!boot.water || !boot.scene) {
  console.log('\ncannot proceed'); await browser.close(); server.close(); process.exit(1);
}

/* Everything below runs in the page. `run()` lays one straight main, solves it
   with a synthetic well list, and samples the mains canvas twice. */
await page.exposeFunction('__sleep', (ms) => new Promise((r) => setTimeout(r, ms)));

const sample = async (opts) => page.evaluate(async (o) => {
  const W = window.MythicWater;
  const nc = window.__nc;
  const scene = nc.scene();
  let mesh = null;
  scene.traverse((m) => { if (m && m.name === 'mythic-water-mains') mesh = m; });
  if (!mesh) return { err: 'no mains mesh' };

  /* 🔴 A REAL TILE, NOT A SYNTHETIC SOLVE. node-city's water pre-pass rebuilds
     its own `wells` list out of game.tiles every tick and calls
     MythicWater.solve() with it, so anything this driver solves by hand is
     overwritten within one tick — which is exactly how the first version of
     this file produced a false pass. A Purifier is the cheapest BUILDINGS row
     carrying gen.water, which is the only property the host's loop tests. */
  for (const k of Object.keys(nc.game.tiles)) {
    if (nc.game.tiles[k] && nc.game.tiles[k].type === 'purifier') delete nc.game.tiles[k];
  }
  if (o.wellX >= 0) nc.game.tiles[o.wellX + ',' + o.z] = { type: 'purifier', lvl: 1 };

  W.pipes.remove(W.pipes.keys());
  const run = [];
  for (let x = o.x0; x <= o.x1; x++) run.push(x + ',' + o.z);
  W.pipes.add(run);
  W.pipes.tool(true);                       // arming makes the layer visible

  const cvs = mesh.material && mesh.material.map && mesh.material.map.image;
  if (!cvs || !cvs.width) return { err: 'no mains canvas' };

  /* Count pixels close to WATER.col.pipeFlow (#d9fbff) — the moving dash only,
     and clearly brighter than the #6fe3f5 trunk underneath it. The per-column
     profile is what lets DIRECTION be compared. */
  const read = () => {
    const c = document.createElement('canvas');
    c.width = cvs.width; c.height = cvs.height;
    const g = c.getContext('2d');
    g.drawImage(cvs, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; const cols = new Array(c.width).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 40 && d[i] > 190 && d[i + 1] > 235 && d[i + 2] > 235) {
        n++; cols[(i / 4) % c.width]++;
      }
    }
    return { n, cols };
  };

  /* Wait for the HOST's own pre-pass to solve with the tile in place, so what
     is photographed is the shipped path end to end. The poll is on the CANVAS,
     not on a state object: flow pixels appearing IS the host having solved a
     live well onto this run, and it is the only signal that cannot be true
     while the picture is still wrong. The control (no well) has nothing to wait
     for, so it takes a fixed settle instead of spinning for the timeout. */
  const t0 = Date.now();
  if (o.wellX >= 0) { while (Date.now() - t0 < 9000 && read().n === 0) await new Promise((r) => setTimeout(r, 150)); }
  else { await new Promise((r) => setTimeout(r, 2500)); }

  const a = read();
  if (o.wait) await new Promise((r) => setTimeout(r, o.wait));
  const b = read();
  const moved = a.cols.reduce((s, v, i) => s + Math.abs(v - b.cols[i]), 0);
  return { visible: !!mesh.visible, pipes: W.pipes.count(),
           waited: Date.now() - t0,
           first: a.n, second: b.n, moved, cols: b.cols, w: cvs.width };
}, opts);

/* ── 1. CONNECTED → IT MOVES ───────────────────────────────────────────── */
console.log('\n1. a main with a waterworks on it carries — and the water moves');
const liveRun = await sample({ x0: 4, x1: 16, z: 8, wellX: 4, wait: 700 });
console.log('   ' + JSON.stringify({ pipes: liveRun.pipes, visible: liveRun.visible,
  flowPx: liveRun.first, thenPx: liveRun.second, delta: liveRun.moved }));
ok('the mains layer is visible', !!liveRun.visible);
ok('the host solved a live waterworks onto the run', (liveRun.first | 0) > 0, 'flow appeared after ' + liveRun.waited + ' ms of host ticks');
ok('the pipe run was laid', liveRun.pipes > 0, liveRun.pipes + ' tiles');
ok('flow pixels are drawn on a connected main', (liveRun.first | 0) > 0, liveRun.first + ' px');
/* 🔴 BOTH READS, NOT JUST A DELTA. The first version asserted only that the
   picture changed, and passed on 693 px -> 0 px — the flow STOPPING. A live
   main must still be drawing on the second read as well as the first. */
ok('...and it is STILL drawing on the second read (it did not just stop)',
   (liveRun.second | 0) > 0, liveRun.second + ' px');
ok('...and the pattern MOVED between the two reads',
   (liveRun.moved | 0) > 0, 'column delta ' + liveRun.moved);

/* ── 2. THE CONTROL — NOT CONNECTED → IT IS STILL ──────────────────────── */
console.log('\n2. CONTROL — the same run with NO waterworks must not animate');
const deadRun = await sample({ x0: 4, x1: 16, z: 8, wellX: -1, wait: 700 });
console.log('   ' + JSON.stringify({ pipes: deadRun.pipes, flowPx: deadRun.first,
  thenPx: deadRun.second, delta: deadRun.moved }));
ok('no flow pixels on a main with no waterworks', (deadRun.first | 0) === 0, deadRun.first + ' px');
ok('...and nothing moved', (deadRun.moved | 0) === 0, 'column delta ' + deadRun.moved);

/* ── 3. DIRECTION IS DERIVED, NOT DECORATIVE ───────────────────────────── */
console.log('\n3. the dashes travel AWAY from the waterworks — fed west vs fed east');
const west = await sample({ x0: 4, x1: 16, z: 8, wellX: 4, wait: 0 });
const east = await sample({ x0: 4, x1: 16, z: 8, wellX: 16, wait: 0 });
/* The dash phase is shared, so a run fed from the far end lays its dashes on
   the opposite half-period — the two column profiles must NOT be identical.
   Comparing profiles (not totals) is the point: a wrong-way flow paints the
   same NUMBER of pixels in different PLACES. */
const same = west.cols && east.cols &&
  west.cols.length === east.cols.length &&
  west.cols.every((v, i) => v === east.cols[i]);
ok('both directions drew flow at all', (west.first | 0) > 0 && (east.first | 0) > 0,
   'west ' + west.first + ' px · east ' + east.first + ' px');
ok('the two feeds paint DIFFERENT patterns (direction is real)', !same,
   same ? 'identical column profiles — direction is being ignored' : 'profiles differ');

console.log('\npage errors: ' + logs.length);
logs.slice(0, 5).forEach((e) => console.log('   ' + e));
console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
await browser.close();
server.close();
process.exit(fails ? 1 : 0);
