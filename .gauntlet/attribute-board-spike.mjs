/* ══════════════════════════════════════════════════════════════════════════
   🔎 ATTRIBUTE-BOARD-SPIKE — WHERE DO THE TWO SECONDS GO?

   The board's median frame is ~4ms and its p90 is ~6ms (measure-board.mjs,
   after PROP_SCALE + the wider fit). ONE frame in a run still costs ~1.9-2.3
   SECONDS. It is NOT the terrain bake: __bbDebug.terrain() reports the same
   bakeMs on the 2ms frames and the 2000ms one, i.e. no re-bake happened.

   This driver attributes that frame. It does it WITHOUT EDITING THE BOARD:

     • perfPush IS a top-level `function` declaration, so it is a property of
       the iframe's global object and can be WRAPPED from outside. That hands
       us the shipped _t0/_t1/_t2/_t3/_t4/_t5 marks PER FRAME instead of the
       medians __bbPerf() returns — and a median is exactly the statistic that
       cannot see a one-in-three-hundred outlier.
     • the five stage hooks (vista.draw, tilefx.drawSurfaces,
       tilefx.drawStatesOver, dressing.items, vista.grade) hang off
       window.BBX, which IS a plain property, so they wrap the same way.
     • the other painters are `function` declarations too (drawBoard,
       drawParticles, drawEffects, drawRain, drawGuides, drawNameplates,
       buildOccluders, syncDressing, update, …) and frame() resolves each of
       them THROUGH the global object, so replacing window.<name> really does
       change what frame() calls.

   🔴 THE GLOBALS TRAP applies here and is the reason none of the above asks
     for MAP / VIEW / CAM_FIT / STRUCT_DEF / TRUCK_WR. Those are top-level
     `const` — lexical bindings, not properties of window — and a probe that
     asks for one gets undefined, which reads as "the stage did not load".

   🔴 THE RENDER TRAP: frame() is driven DIRECTLY with a monotonically rising
     t and the calls that landed are COUNTED. requestAnimationFrame is
     no-opped for the measured window, deliberately: frame() re-arms rAF on
     its own tail, and the pane's ~0.56 Hz compositor would otherwise fire a
     handful of UNTIMED frames in the middle of the run and smear the outlier
     across whichever direct call they landed on.

   ⚠ THE RIG IS SwiftShader (software GL). Absolute ms here are NOT what a
     player's GPU pays. Only BEFORE/AFTER on this same instrument is valid.

   Run:  node .gauntlet/attribute-board-spike.mjs [frames]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const FRAMES = Number(process.argv[2] || 400);
const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8400 + (process.pid % 60);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* same host rect measure-board.mjs uses, so the two are comparable */
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

const r = await page.evaluate(async (FRAMES) => {
  const fr = document.querySelector('iframe');
  const w = fr ? fr.contentWindow : window;
  const out = { inFrame: !!fr, wrapped: [], missing: [] };
  if (typeof w.frame !== 'function') { out.err = 'w.frame not reachable'; return out; }

  /* ── per-frame scratch: every wrapper adds into CUR, frame() closes it ── */
  let CUR = {};
  const recs = [];
  const bump = (k, ms) => { CUR[k] = (CUR[k] || 0) + ms; CUR[k + '#'] = (CUR[k + '#'] || 0) + 1; };

  const wrapGlobal = (name) => {
    const f = w[name];
    if (typeof f !== 'function') { out.missing.push(name); return; }
    w[name] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally { bump(name, performance.now() - t); }
    };
    out.wrapped.push(name);
  };
  const wrapHook = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function') { out.missing.push(label); return; }
    const f = obj[name];
    obj[name] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally { bump(label, performance.now() - t); }
    };
    out.wrapped.push(label);
  };

  /* the shipped phase marks, per frame instead of as a median */
  const _pp = w.perfPush;
  if (typeof _pp === 'function') {
    w.perfPush = function (rec) { Object.assign(CUR, { _sky: rec.sky, _board: rec.board,
      _bake: rec.bake, _blit: rec.blit, _fx: rec.fx, _actors: rec.actors,
      _atmos: rec.atmos, _total: rec.total }); return _pp.call(this, rec); };
    out.wrapped.push('perfPush');
  } else out.missing.push('perfPush');

  /* the painters frame() calls by bare name — resolved through the global
     object, so replacing the property really does redirect the call */
  ['update', 'syncBackdropPlates', 'drawSky', 'drawShards', 'drawBoard', 'drawSurfaceFx',
   'drawPaintOverSurfaces', 'drawFacedownCards', 'drawTeleGround', 'drawEffects',
   'buildOccluders', 'syncDressing', 'drawTeleArc', 'drawNameplates', 'drawParticles',
   'drawRain', 'drawGuides', 'drawProp', 'drawEvent', 'drawPylon', 'drawTomb',
   'drawStruct', 'drawTruck', 'drawUnit', 'clipBehindTerrain', 'buildApi',
   'terrainLayer', 'unitScreenBox', 'post', 'camDepth', 'actorBox'].forEach(wrapGlobal);

  const BBX = w.BBX || {};
  wrapHook(BBX.vista, 'draw', 'HOOK.vista.draw');
  wrapHook(BBX.vista, 'grade', 'HOOK.vista.grade');
  wrapHook(BBX.tilefx, 'drawSurfaces', 'HOOK.tilefx.surfaces');
  wrapHook(BBX.tilefx, 'drawStatesOver', 'HOOK.tilefx.states');
  wrapHook(BBX.dressing, 'items', 'HOOK.dressing.items');
  out.bbx = Object.keys(BBX);

  /* 🔴 silence the self-rearming rAF for the measured window — see header */
  const _raf = w.requestAnimationFrame;
  w.requestAnimationFrame = () => 0;

  let t = performance.now(), ran = 0;
  const call = () => {
    CUR = {};
    t += 16.7;
    const a = performance.now();
    try { w.frame(t); ran++; } catch (e) { out.drawErr = String(e).slice(0, 120); }
    CUR.WALL = performance.now() - a;
    recs.push(CUR);
  };

  /* warm past the load schedule (LOADQ retires at step 21; the vista bake is
     ~106ms and the grade ~56ms and both belong to cold load, not gameplay) */
  for (let i = 0; i < 90; i++) call();
  recs.length = 0;

  for (let i = 0; i < FRAMES; i++) call();

  w.requestAnimationFrame = _raf;
  out.framesRan = ran;
  out.frameErrLatched = (() => { try { return !!w.frameErr; } catch (e) { return null; } })();
  out.terrain = (() => { try { return w.__bbDebug.terrain(); } catch (e) { return null; } })();
  out.load = (() => { try { return w.__bbDebug.load(); } catch (e) { return null; } })();
  out.recs = recs;
  return out;
}, FRAMES);

const server_close = () => { server.close(); };
if (r.err) { console.log('ERR: ' + r.err); await browser.close(); server_close(); process.exit(1); }

const recs = r.recs;
const walls = recs.map(x => x.WALL);
const sorted = walls.slice().sort((a, b) => a - b);
const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(2);

console.log('\n\u{1F50E} BOARD SPIKE ATTRIBUTION — ' + recs.length + ' timed frames, host ' +
            BOX.width + 'x' + BOX.height + '  (SwiftShader: relative numbers only)\n');
console.log('   frames actually run: ' + r.framesRan + ' · frameErr latched: ' + r.frameErrLatched);
console.log('   BBX modules: ' + (r.bbx || []).join(', '));
console.log('   terrain bake (unchanged across the run means NO re-bake): ' + JSON.stringify(r.terrain && { bakeMs: r.terrain.bakeMs, key: String(r.terrain.key).slice(0, 40) }));
console.log('   load schedule: ' + JSON.stringify(r.load && r.load.on));
if (r.missing && r.missing.length) console.log('   NOT wrapped (absent): ' + r.missing.join(', '));
console.log('\n   WALL ms   min ' + q(0) + ' · p50 ' + q(0.5) + ' · p90 ' + q(0.9) +
            ' · p99 ' + q(0.99) + ' · MAX ' + +sorted[sorted.length - 1].toFixed(2));

/* which frames are outliers, by index, so periodicity is visible */
const med = sorted[sorted.length >> 1];
const spikes = recs.map((x, i) => ({ i, ms: x.WALL, r: x }))
                   .filter(x => x.ms > Math.max(40, med * 8))
                   .sort((a, b) => b.ms - a.ms);
console.log('   spike frames (>8x median, >40ms): ' + spikes.length + ' of ' + recs.length +
            (spikes.length ? '  at indices ' + spikes.slice(0, 12).map(s => s.i).join(', ') : ''));

const keysOf = (rec) => Object.keys(rec).filter(k => k !== 'WALL' && !k.endsWith('#') && !k.startsWith('_'));
const show = (rec, label) => {
  console.log('\n   ── ' + label + ' — WALL ' + rec.WALL.toFixed(2) + 'ms');
  const phases = ['_sky', '_board', '_bake', '_blit', '_fx', '_actors', '_atmos', '_total'];
  console.log('      shipped marks: ' + phases.filter(k => rec[k] != null)
      .map(k => k.slice(1) + ' ' + (+rec[k]).toFixed(2)).join(' · '));
  const rows = keysOf(rec).map(k => ({ k, ms: rec[k], n: rec[k + '#'] }))
                          .sort((a, b) => b.ms - a.ms).slice(0, 12);
  for (const row of rows) {
    console.log('      ' + row.k.padEnd(24) + row.ms.toFixed(2).padStart(9) + 'ms  x' + row.n +
                '   (' + (row.ms / rec.WALL * 100).toFixed(1) + '% of frame)');
  }
};

if (spikes.length) show(spikes[0].r, 'WORST FRAME  #' + spikes[0].i);
if (spikes.length > 1) show(spikes[1].r, 'second worst #' + spikes[1].i);

/* the median frame, as the control the spike is read against */
const medIdx = recs.map((x, i) => ({ i, ms: x.WALL })).sort((a, b) => a.ms - b.ms)[recs.length >> 1].i;
show(recs[medIdx], 'MEDIAN FRAME #' + medIdx);

/* totals over the whole run — a pass that is cheap per frame but runs every
   frame can still outweigh one spike */
console.log('\n   ── TOTAL over the run');
const tot = {};
for (const rec of recs) for (const k of keysOf(rec)) tot[k] = (tot[k] || 0) + rec[k];
const wallTot = walls.reduce((a, b) => a + b, 0);
Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) =>
  console.log('      ' + k.padEnd(24) + v.toFixed(1).padStart(10) + 'ms  (' + (v / wallTot * 100).toFixed(1) + '% of all wall)'));
console.log('      ' + 'WALL(all frames)'.padEnd(24) + wallTot.toFixed(1).padStart(10) + 'ms');

fs.writeFileSync(path.resolve(process.cwd(), '.gauntlet/_spike-raw.json'), JSON.stringify(recs));
console.log('\n   raw per-frame records -> .gauntlet/_spike-raw.json');
console.log('\npage errors: ' + errs.length);
errs.slice(0, 3).forEach((e) => console.log('   ' + e));
await browser.close();
server_close();
