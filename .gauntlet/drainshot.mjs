/* ══ 🌊 THE SEA DRAIN PROBE — the rule, the structure, and the picture ══════
   ONE boot. Everything that can be asked of a frame is asked inside ONE
   synchronous page.evaluate(), for the reason .gauntlet/README.md item 6 and
   CLAUDE.md both record: preserveDrawingBuffer is off, so the framebuffer is
   gone by the next task and an A/B that flips `.visible` and then reads pixels
   returns the frame from BEFORE the flip — a confident, wrong ZERO. render →
   drawImage → render → drawImage, all in one task, with a CONTROL (on vs on)
   reported beside every pixel number.

   Usage: node .gauntlet/drainshot.mjs [outDir]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.gauntlet/shots/drain');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8900 + (process.pid % 90);
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push('[' + m.type() + '] ' + m.text().slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 300)));
await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => !!(window.__nc && window.__nc.three), null, { timeout: 180000 });
await page.waitForTimeout(20000);

/* ── PART 1: the rule, the structure, and the pipe network. Synchronous. ── */
const R = await page.evaluate(() => {
  const out = { logs: [] };
  const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
  const W = window.MythicWater, O = window.MythicOcean;
  out.water = !!W; out.ocean = !!O;
  if (!W) return out;
  out.oceanStats = O ? O.stats() : null;
  const A = W.drains.apron();
  out.apron = A;
  out.domain = W.pipes.domain();

  /* ── THE RULE. Every apron column, in three rows, asked of the SHIPPED
     predicate — and the refusal string beside it. */
  out.rule = [];
  for (const z of [4, 12, 20]) {
    for (let x = 23; x <= 23 + A; x++) {
      const why = W.drains.refusalAt(x, z);
      out.rule.push({ x, z, sea: W.drains.apron() ? W.seaAtCell(x, z) : null,
                      refused: !!why, why: why ? why.slice(0, 60) : null });
    }
  }

  /* ── ONE COMPONENT ACROSS THE SHORELINE, on the live page. */
  const zRow = 12, seaX = 23 + A;
  W.drains.add([seaX + ',' + zRow]);
  const path = W.pipes.path(6, zRow, seaX, zRow);
  W.pipes.add(path);
  out.run = { cells: path.length, first: path[0], last: path[path.length - 1] };
  const c = W.pipes.components();
  out.oneComponent = c.count === 1 &&
                     c.id['23,' + zRow] !== undefined &&
                     c.id['23,' + zRow] === c.id[seaX + ',' + zRow];
  out.components = c.count;
  W.pipes.remove(['15,' + zRow]);
  out.afterLift = W.pipes.components().count;
  W.pipes.add(['15,' + zRow]);
  out.rejoined = W.pipes.components().count;

  /* ── THE STRUCTURE. Measured off the live scene graph, never asserted. */
  const st = W.drains.structures();
  out.structure = { count: st.count, boxes: st.boxes };
  out.drainVerify = W.drains.verify();

  /* ── THE SHORE IS LAND. The last plate column's world x against the ocean
     mesh's own westernmost vertex, and against MythicOcean.shoreAt. */
  const HALF = 12;
  const g = scene.getObjectByName('ocean');
  let meshMinX = null;
  if (g) {
    const m = g.getObjectByName('ocean-surface');
    if (m) {
      const a = m.geometry.attributes.position.array;
      meshMinX = Infinity;
      for (let i = 0; i < a.length; i += 3) if (a[i] < meshMinX) meshMinX = a[i];
    }
  }
  out.shore = {
    lastPlateColumnWorldX: 23 - HALF + 0.5,
    plateEdgeWorldX: HALF,
    oceanMeshMinX: meshMinX,
    shoreAtRow12: O && O.shoreAt ? O.shoreAt(zRow - HALF + 0.5) : null,
    beachAt_23_12: W.beachAt(23, 12),
    beachAt_5_12: W.beachAt(5, 12),
    placeRefusal_on_plate: W.placeRefusal(23, 12, 'A Beach House'),
    placeRefusal_in_sea: W.placeRefusal(seaX, 12, 'A Beach House'),
  };

  /* ── THE PIXELS. ONE task: render, drawImage, flip, render, drawImage.
     The crop is the strip of frame east of the plate where the drain stands. */
  const cv = document.createElement('canvas');
  cv.width = renderer.domElement.width; cv.height = renderer.domElement.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const grab = () => {
    renderer.render(scene, camera);
    cx.drawImage(renderer.domElement, 0, 0);
    return cx.getImageData(0, 0, cv.width, cv.height).data;
  };
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4)
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 12) n++; return n; };
  const dg = scene.getObjectByName('sea-drains');
  out.groupFound = !!dg;
  if (dg) {
    const on1 = grab();
    const on2 = grab();                 // CONTROL: on vs on, nothing flipped
    dg.visible = false;
    const off = grab();
    dg.visible = true;
    out.pixels = { total: cv.width * cv.height, control: diff(on1, on2), changed: diff(on2, off) };
  }
  out.logsTail = [];
  return out;
});

/* ── PART 2: the CHARGED path, which is awaited. ── */
const P = await page.evaluate(async () => {
  const W = window.MythicWater;
  const A = W.drains.apron();
  const land = await W.drains.place(23, 6);          // on the plate — must refuse
  const sea = await W.drains.place(23 + A, 6);       // in the water — must place
  return { land, sea, count: W.drains.count(), mains: W.mains() };
});

/* ── PART 3: IS THE SHORE BUILDABLE?
   ⚠ A REAL PLACEMENT CANNOT BE DRIVEN HERE AND THAT IS NOT A DEFECT OF THE
     FEATURE. tryPlace() awaits payCost(), which is a bridge round-trip to the
     PARENT window; this probe boots node-city standalone, so there is no wallet
     and every purchase refuses with "cannot afford" (see the charged drain
     placement in PART 2, which proves the price is SCALED — 46 × 100 = 4,600 —
     rather than proving the ledger). So what is measured here is the thing that
     actually decides buildability: tryPlace's DOMAIN, `inGrid`, sampled through
     the shipped hover picker, plus where the beach column stands relative to the
     real ocean mesh. ── */
const B = await page.evaluate(() => {
  const W = window.MythicWater, O = window.MythicOcean;
  const HALF = 12;
  const wOf = (t) => t - HALF + 0.5;
  const rows = [];
  for (const z of [3, 12, 21]) {
    rows.push({
      z,
      // the last three plate columns — the beach — and the first sea cell
      beach: [21, 22, 23].map(x => ({ x, world: wOf(x), sea: W.seaAtCell(x, z),
                                      beach: W.beachAt(x, z), refusal: W.placeRefusal(x, z, 'A Dock') })),
      firstSea: (() => { for (let x = 24; x <= 26; x++) if (W.seaAtCell(x, z)) return x; return -1; })(),
      shoreWorldX: O && O.shoreAt ? O.shoreAt(wOf(z)) : null,
    });
  }
  return { rows, oceanIsSeaAtLastColumn: W.seaAtCell(23, 12) };
});

/* ── PART 4: DRIVE ONE REAL economyTick.
   `mains()` reports the last SOLVED tick, not the live set — so without this the
   probe can only prove the graph, never that node-city's own water pre-pass hands
   the drain through. This is the SHIPPED tick, called by name off the seam. ── */
const T = await page.evaluate(async () => {
  const nc = window.__nc, W = window.MythicWater;
  const beforeLive = W.pipes.count();
  try { await nc.ticks.economyTick(1); } catch (e) { return { threw: String(e) }; }
  return { pipesLive: beforeLive, mains: W.mains(), waterMainsSeam: nc.waterMains(), drainSeam: nc.drains() };
});

await page.screenshot({ path: path.join(OUT, 'drain.png') });
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ R, P, B, T, logs: logs.slice(-40) }, null, 2));

console.log('\n🌊 SEA DRAIN PROBE\n');
console.log('  ocean built      ', R.oceanStats && R.oceanStats.built, R.oceanStats && R.oceanStats.refused || '');
console.log('  apron            ', R.apron, 'domain', JSON.stringify(R.domain));
console.log('  THE RULE:');
for (const r of R.rule || []) console.log('    x=' + r.x + ' z=' + r.z + '  sea=' + r.sea + '  ' + (r.refused ? 'REFUSED: ' + r.why : 'legal'));
console.log('  run              ', JSON.stringify(R.run));
console.log('  ONE component    ', R.oneComponent, '(count ' + R.components + ' → lift → ' + R.afterLift + ' → relay → ' + R.rejoined + ')');
console.log('  structures       ', JSON.stringify(R.structure));
console.log('  drain verify     ', JSON.stringify(R.drainVerify));
console.log('  shore            ', JSON.stringify(R.shore, null, 2));
console.log('  PIXELS           ', JSON.stringify(R.pixels), '  ← control is the on-vs-on figure');
console.log('  charged place    ', JSON.stringify(P, null, 2));
console.log('  THE SHORE:');
for (const r of B.rows || []) {
  console.log('    z=' + r.z + '  waterline world-x ' + (r.shoreWorldX == null ? '?' : r.shoreWorldX.toFixed(3)) +
              '  first sea cell x=' + r.firstSea);
  for (const b of r.beach)
    console.log('      x=' + b.x + ' world ' + b.world.toFixed(1) + '  sea=' + b.sea +
                '  beach=' + b.beach + '  placeRefusal=' + (b.refusal ? 'YES' : 'none (buildable)'));
}
console.log('  AFTER ONE REAL economyTick:', JSON.stringify(T));
console.log('\n  errors:', logs.filter(l => l.startsWith('[pageerror]') || l.includes('error')).slice(-8).join('\n          ') || 'none');
console.log('\n  → ' + OUT + '\n');

await browser.close();
server.close();
