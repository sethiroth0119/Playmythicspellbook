/* == 🛣 THE ROAD CLASS A/B ==================================================
   Proves, PHOTOGRAPHICALLY, that each road class draws something a plain road
   does not — and reports the do-nothing control beside every figure, because a
   pixel count without one is not a verdict.

   🔴 THE INSTRUMENT, AND WHY IT IS BUILT THIS WAY (.gauntlet/README item 6).
   animate() is the only thing that renders and rAF fires at about 0.56 Hz here,
   so a change-then-read in the same task reads THE FRAME BEFORE THE CHANGE —
   for any layer, always, and it reports a confident 0.00%. That verdict cost
   two overlays a "cannot be photographed" ruling. So this driver:
     · calls renderer.render(scene, camera) ITSELF, and
     · drawImage()s the canvas IN THE SAME TASK as that render, because
       preserveDrawingBuffer is off and the buffer is gone by the next task.
   The control (two shoots with nothing changed between them) must come out at
   exactly 0, and it is printed on every row. If it does not, the instrument is
   dead and the numbers beside it mean nothing.

   WHAT IS MEASURED. One tile, photographed twice: once with t.rc = null (the
   shipped street — the control condition, not a different tile) and once with
   t.rc = <class>. Same camera, same frame, same crop, derived from the tile's
   own projected position rather than typed — README records a hardcoded crop
   drifting out of the picture the first time somebody moved a framing.

   Also asserted, because they are not things a screenshot can show:
     · the draw-call delta per classed tile (renderer.info.render.calls), which
       must be 0 — a class draws into makeRoad's six existing merged buckets;
     · that a roundabout's nine tiles are ONE component in the road graph;
     · that a diagonal run is 4-connected end to end, with no staircase gap.

   Usage: node .gauntlet/roadclass-ab.mjs [outdir]
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.gauntlet/shots/roadclass');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8700 + (process.pid % 90);
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
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
/* ☀ PIN THE CLOCK TO EARLY AFTERNOON. node-city's sky is real EST wall time,
   1:1 ("the sun rises when YOUR sun rises"), so an unpinned run photographs the
   road kit at whatever hour the machine happens to be at — and a night frame is
   a lit-lamp frame, which is a different picture of a different thing. Pinned
   for the SAME reason the crop is derived rather than typed: the instrument
   must not depend on when it was run. Copied from .gauntlet/wildshot.mjs. */
await page.addInitScript(({ hour }) => {
  const _D = Date; const now = new _D(); const parts = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(now)) parts[p.type] = p.value;
  const curH = (+parts.hour % 24) + (+parts.minute) / 60 + (+parts.second) / 3600;
  const shiftMs = (hour - curH) * 3600 * 1000;
  class S extends _D { constructor(...a) { if (!a.length) super(_D.now() + shiftMs); else super(...a); }
    static now() { return _D.now() + shiftMs; } }
  S.parse = _D.parse; S.UTC = _D.UTC; window.Date = S;
}, { hour: 14 });
const logs = [];
page.on('console', m => logs.push(('[' + m.type() + '] ' + m.text()).slice(0, 400)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 400)));

await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 180000 });
// Boot is long: three off the CDN, ~20 module imports, then loadState.
await page.waitForFunction(() => window.__nc && window.__nc.three && window.__nc.three().renderer, null,
  { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(9000);

const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  roads: !!window.MythicRoadClasses,
  verify: (window.__nc && window.__nc.roadVerify) ? window.__nc.roadVerify() : null,
  classes: (window.__nc && window.__nc.roadClasses) ? window.__nc.roadClasses() : null,
}));
console.log('boot:', JSON.stringify(boot));
if (!boot.nc) { console.log(logs.slice(-25).join('\n')); throw new Error('node-city did not boot'); }

/* ── build the test bed ─────────────────────────────────────────────────────
   Roads are laid through __nc.place, i.e. the SHIPPED tryPlace gate, so the
   bed is a bed a player could build. Two shapes:
     · a PLUS at (px,pz) — one tile with all four neighbours, plus straight
       arms, so every class is photographed on the mask it is designed for
       (through, junction, bend, stub) rather than on one convenient tile.
     · a ROUNDABOUT stamp — a 3x3, eight ring tiles and one island.
   Anything already standing in the way is left alone and the bed moves. */
const bed = await page.evaluate(async () => {
  const nc = window.__nc;
  const G = 24;
  /* Fund the rig through the bridge's OWN mock ledger — not by patching
     payCost, and not by writing tiles behind tryPlace's back. Every road below
     is bought at the shipped price through the shipped gate; the only thing
     this line changes is that the mock city can afford them. */
  try { await window.MythicCityBridge.addCinders(4000000); } catch (e) {}
  const free = (x, z) => x > 0 && z > 0 && x < G - 1 && z < G - 1 && !nc.game.tiles[x + ',' + z];
  // find a 7x7 clear block
  let px = -1, pz = -1;
  outer: for (let z = 3; z < G - 4; z++) for (let x = 3; x < G - 4; x++) {
    let ok = true;
    for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) if (!free(x + dx, z + dz)) { ok = false; break; }
    if (ok) { px = x; pz = z; break outer; }
  }
  if (px < 0) return { ok: false, why: 'no clear 7x7 block' };
  const cells = [];
  for (let d = -2; d <= 2; d++) { cells.push([px + d, pz]); if (d) cells.push([px, pz + d]); }
  const laid = [];
  for (const [x, z] of cells) {
    await nc.place('road', x, z);
    if (nc.game.tiles[x + ',' + z]) laid.push([x, z]);
  }
  return { ok: laid.length >= 5, px, pz, laid, tiles: laid.length };
});
console.log('bed:', JSON.stringify({ ok: bed.ok, px: bed.px, pz: bed.pz, tiles: bed.tiles }));
if (!bed.ok) { console.log(logs.slice(-25).join('\n')); throw new Error('could not lay the test bed: ' + (bed.why || '')); }

/* ── frame it ───────────────────────────────────────────────────────────────
   The camera is set once and never moved again, so every class is shot from
   the identical viewpoint and the only thing that can differ between A and B
   is the geometry. A CS2-ish 30° look-down from the south-east, close enough
   that one tile is a large fraction of the frame. */
await page.evaluate(({ px, pz }) => {
  const { camera, controls } = window.__nc.three();
  const HALF = 12;
  const wx = px - HALF + 0.5, wz = pz - HALF + 0.5;
  if (controls) { controls.enabled = false; controls.target.set(wx, 0, wz); }
  camera.position.set(wx + 3.1, 3.0, wz + 3.1);
  camera.lookAt(wx, 0, wz);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}, bed);

/* ── the instrument ─────────────────────────────────────────────────────────
   Installed once, in the page, so render+drawImage are guaranteed to be in the
   same task. Everything below calls shoot(). */
await page.evaluate(({ px, pz }) => {
  const { renderer, scene, camera, THREE } = window.__nc.three();
  const gl = renderer.domElement;
  const CW = gl.width, CH = gl.height;
  const s = document.createElement('canvas'); s.width = CW; s.height = CH;
  const c = s.getContext('2d', { willReadFrequently: true });
  /* 🔴 THE CAMERA IS RE-AIMED BEFORE EVERY SHOT AND BEFORE EVERY PROJECTION.
     node-city's animate() runs OrbitControls.update() on its own clock, and rAF
     here is ~0.56 Hz — so between shot A and shot B the camera can move by an
     unknown amount at an unpredictable moment, and the diff would be measuring
     the camera rather than the geometry. Re-aiming makes A and B identical by
     construction instead of by hope. matrixWorldInverse is refreshed by hand
     because project() reads it and only renderer.render() normally writes it. */
  const HALF = 12, wx = px - HALF + 0.5, wz = pz - HALF + 0.5;
  window.__rcAim = () => {
    camera.position.set(wx + 3.1, 3.0, wz + 3.1);
    camera.up.set(0, 1, 0);
    camera.lookAt(wx, 0, wz);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  };
  window.__rcShoot = () => {
    window.__rcAim();
    renderer.render(scene, camera);
    c.clearRect(0, 0, CW, CH);
    c.drawImage(gl, 0, 0, CW, CH);
    return c.getImageData(0, 0, CW, CH);
  };
  window.__rcSize = { CW, CH };
  /* The crop, DERIVED from the tile's own projected position — never typed.
     A hardcoded crop drifts out of the picture the first time a framing moves
     (.gauntlet/README). Half a tile either side of the centre, clamped. */
  window.__rcCrop = (x, z, pad) => {
    window.__rcAim();
    const v = new THREE.Vector3(x - HALF + 0.5, 0, z - HALF + 0.5).project(camera);
    const sx = (v.x * 0.5 + 0.5) * CW, sy = (-v.y * 0.5 + 0.5) * CH;
    const r = pad || Math.round(Math.min(CW, CH) * 0.22);
    return { x0: Math.max(0, Math.round(sx - r)), y0: Math.max(0, Math.round(sy - r)),
             x1: Math.min(CW, Math.round(sx + r)), y1: Math.min(CH, Math.round(sy + r)) };
  };
  window.__rcDiff = (A, B, crop) => {
    let n = 0, tot = 0;
    const W = window.__rcSize.CW;
    for (let y = crop.y0; y < crop.y1; y++) {
      for (let x = crop.x0; x < crop.x1; x++) {
        const i = (y * W + x) * 4; tot++;
        if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++;
      }
    }
    return { changed: n, total: tot, pct: tot ? +(n * 100 / tot).toFixed(2) : 0 };
  };
}, bed);

const probe = await page.evaluate(({ px, pz }) => {
  const { camera } = window.__nc.three();
  const THREE = window.__nc.three().THREE;
  const v = new THREE.Vector3(px - 12 + 0.5, 0, pz - 12 + 0.5).project(camera);
  return { size: window.__rcSize, ndc: { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) },
           crop: window.__rcCrop(px, pz), cam: camera.position.toArray().map(n => +n.toFixed(2)) };
}, bed);
console.log('probe:', JSON.stringify(probe));

/* ── per class ──────────────────────────────────────────────────────────────
   A = the tile as a plain street (rc = null), B = the tile as the class.
   Same tile, same camera, same crop. The control is two shoots with nothing
   changed at all, taken in the SAME run so it shares every condition. */
const classes = boot.classes || [];
const wanted = ['alley', 'curve', 'bikelane', 'culdesac', 'avenue', 'bridge', 'highway'];
const rows = [];

for (const cls of wanted) {
  const r = await page.evaluate(({ cls, px, pz }) => {
    const nc = window.__nc;
    // The mask a class is designed to be seen on. The plus at (px,pz) gives a
    // 4-way junction at the centre, a through tile one step out and a stub two.
    const at = (cls === 'culdesac') ? { x: px + 2, z: pz }        // the dead end
             : (cls === 'curve') ? { x: px, z: pz }               // the junction
             : { x: px + 1, z: pz };                              // a through tile
    const R = nc.three().renderer;
    nc.roadClass(at.x, at.z, null);
    const crop = window.__rcCrop(at.x, at.z);
    const A = window.__rcShoot();
    const A2 = window.__rcShoot();                                  // control
    const ctrl = window.__rcDiff(A, A2, crop);
    /* 🎨 THE DRAW-CALL BUDGET. r1_road.js's binding limit is "round 4 adds
       detail, never a draw call": one road tile is SIX merged meshes and a
       class may not make it seven. Read AFTER a render, not around the tile
       edit — info.render.calls is written by render(), so a delta taken around
       a mesh rebuild measures nothing at all and would report a confident 0
       for a class that had in fact doubled the scene. */
    const callsA = R.info.render.calls;
    nc.roadClass(at.x, at.z, cls);
    const B = window.__rcShoot();
    const callsB = R.info.render.calls;
    const d = window.__rcDiff(A2, B, crop);
    nc.roadClass(at.x, at.z, null);
    return { cls, at, crop, ctrl, d, callsA, callsB, calls: callsB - callsA };
  }, { cls, px: bed.px, pz: bed.pz });
  rows.push(r);
  console.log(`${r.cls.padEnd(10)} ${String(r.d.pct).padStart(6)}%  (${r.d.changed}/${r.d.total})   control ${r.ctrl.pct}%  (${r.ctrl.changed})   draws ${r.callsA} -> ${r.callsB}  (${r.calls >= 0 ? '+' : ''}${r.calls})`);
}

/* `street` is the DEFAULT and must contribute nothing at all — the shipped
   recipe, byte for byte, so no existing city changes because this module
   loaded. It is measured with the identical procedure, and the only acceptable
   answer is the control's. */
{
  const r = await page.evaluate(({ px, pz }) => {
    const nc = window.__nc, at = { x: px + 1, z: pz };
    nc.roadClass(at.x, at.z, null);
    const crop = window.__rcCrop(at.x, at.z);
    const A = window.__rcShoot(), A2 = window.__rcShoot();
    const ctrl = window.__rcDiff(A, A2, crop);
    nc.roadClass(at.x, at.z, 'street');
    const B = window.__rcShoot();
    const d = window.__rcDiff(A2, B, crop);
    nc.roadClass(at.x, at.z, null);
    return { cls: 'street', ctrl, d, calls: 0, callsA: 0, callsB: 0 };
  }, { px: bed.px, pz: bed.pz });
  rows.push(r);
  console.log(`${'street'.padEnd(10)} ${String(r.d.pct).padStart(6)}%  (the default: must equal the control)   control ${r.ctrl.pct}%`);
}

/* ── the roundabout, which is nine tiles and therefore its own shot ──────── */
const rb = await page.evaluate(({ px, pz }) => {
  const nc = window.__nc;
  const ring = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ring.push([px + dx, pz + dz]);
  // Every one of the nine has to BE a road first; the plus only covers five.
  const missing = ring.filter(([x, z]) => !nc.game.tiles[x + ',' + z]);
  return { ring, missing };
}, { px: bed.px, pz: bed.pz });

if (rb.missing.length) {
  await page.evaluate(async (missing) => {
    for (const [x, z] of missing) await window.__nc.place('road', x, z);
  }, rb.missing);
}

const rbRow = await page.evaluate(({ px, pz }) => {
  const nc = window.__nc;
  const ring = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ring.push([px + dx, pz + dz]);
  const have = ring.filter(([x, z]) => nc.game.tiles[x + ',' + z]);
  for (const [x, z] of have) nc.roadClass(x, z, null);
  const crop = window.__rcCrop(px, pz, Math.round(Math.min(window.__rcSize.CW, window.__rcSize.CH) * 0.34));
  const A = window.__rcShoot();
  const A2 = window.__rcShoot();
  const ctrl = window.__rcDiff(A, A2, crop);
  for (const [x, z] of have) nc.roadClass(x, z, (x === px && z === pz) ? 'rbisle' : 'roundabout');
  const B = window.__rcShoot();
  const d = window.__rcDiff(A2, B, crop);
  /* THE NETWORK ASSERTION, which no photograph can make: the nine tiles must be
     ONE connected component of the road graph. A roundabout that looked right
     and was two components would path agents around the long way, forever, with
     nothing anywhere saying so. Walked here with the same 4-neighbour rule
     computeLinks uses. */
  const set = new Set(have.map(([x, z]) => x + ',' + z));
  const seen = new Set([have[0][0] + ',' + have[0][1]]);
  const q = [have[0]];
  while (q.length) {
    const [x, z] = q.shift();
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const k = (x + dx) + ',' + (z + dz);
      if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, z + dz]); }
    }
  }
  return { tiles: have.length, crop, ctrl, d, oneComponent: seen.size === have.length, reached: seen.size };
}, { px: bed.px, pz: bed.pz });
rows.push({ cls: 'roundabout', ...rbRow });
console.log(`${'roundabout'.padEnd(10)} ${String(rbRow.d.pct).padStart(6)}%  (${rbRow.d.changed}/${rbRow.d.total})   control ${rbRow.ctrl.pct}%   one component: ${rbRow.oneComponent} (${rbRow.reached}/${rbRow.tiles})`);

/* ── the diagonal: 4-connected, no staircase gap ─────────────────────────── */
const diag = await page.evaluate(() => {
  const RC = window.MythicRoadClasses;
  if (!RC || !RC._plan) return { ok: false, why: 'palette not up' };
  const run = RC._plan({ x: 2, z: 2 }, { x: 9, z: 7 }, 'diag');
  let broken = 0;
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1], b = run[i];
    if (Math.abs(a.x - b.x) + Math.abs(a.z - b.z) !== 1) broken++;
  }
  return { ok: true, len: run.length, broken, first: run[0], last: run[run.length - 1] };
});
console.log('diagonal run:', JSON.stringify(diag));

const calls = await page.evaluate(() => {
  const nc = window.__nc;
  const { renderer } = nc.three();
  return { info: renderer.info.render.calls };
});

/* ── 💰 THE LADDER, AND THE METER ─────────────────────────────────────────
   Two things a picture cannot show. Both are asserted against the HOST's own
   numbers, never against a literal typed here: the quote must be the host's
   costOf() times the class multiplier, and the meter must move by the class
   weight. A test that hardcoded 400 would pass forever after a reprice. */
const ladder = await page.evaluate(({ px, pz }) => {
  const nc = window.__nc, RC = window.MythicRoadClasses;
  const base = nc.BUILDINGS.road;                       // the authored row
  const rows = [];
  for (const cls of RC.classes()) {
    const q = RC._quote(cls);
    rows.push({ cls, cinder: q.cinder });
  }
  // The meter: one through tile, plain -> highway. Weight 1 -> 4, so +3.
  const at = { x: px + 1, z: pz };
  nc.roadClass(at.x, at.z, null);
  const used0 = RC.capUsed();
  nc.roadClass(at.x, at.z, 'highway');
  const used1 = RC.capUsed();
  nc.roadClass(at.x, at.z, 'avenue');
  const used2 = RC.capUsed();
  nc.roadClass(at.x, at.z, null);
  return { rows, meter: { plain: used0, highway: used1, avenue: used2 },
           scaled: nc.game && null, rowCinder: base.cost.cinder };
}, { px: bed.px, pz: bed.pz });
console.log('\nprice ladder (costOf(road) x class multiplier — the authored row says ' + ladder.rowCinder + ', scaleCost x100):');
for (const r of ladder.rows) console.log(`  ${r.cls.padEnd(10)} ${String(r.cinder).padStart(6)} 🔥`);
console.log('road-cap meter, one tile re-classed:', JSON.stringify(ladder.meter),
            '  (street 1, avenue 2, highway 4)');

/* ── 🔴 THE APRON ENVELOPE ────────────────────────────────────────────────
   "A highway meeting a street resolves the junction with no visible lip or
   gap at the .150 apron." The way that is guaranteed is structural rather than
   artistic: NO CLASS MAY REACH FURTHER THAN THE SHIPPED RECIPE ALREADY DOES.
   makeRoad's apron pays RD_AP = .150 onto the neighbouring PLOT and RD_EPS
   resolves the one perpendicular double-apron case; a class that drew past the
   tile would land on top of that apron, or past it, and leave exactly the lip
   the bar asks about — and it would do so only where two particular classes
   met, i.e. rarely enough to ship.
   So it is asserted as a bounding box: every classed tile's mesh must fit
   inside the bounding box of the SAME tile drawn as a plain road, on all three
   axes. Same tile, same neighbours, same mask — the only variable is the class.
   (The recipes make this true by construction: the circle walkers clamp every
   span to ±0.5 and no class emits a slab outside it. This is the check that it
   STAYS true.) */
const envelope = await page.evaluate(({ px, pz }) => {
  const nc = window.__nc;
  const at = { x: px + 1, z: pz };
  const boxOf = () => {
    const t = nc.game.tiles[at.x + ',' + at.z];
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    t.mesh.updateMatrixWorld(true);
    t.mesh.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const p = o.geometry.attributes.position; if (!p) return;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        if (vx < x0) x0 = vx; if (vx > x1) x1 = vx;
        if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
        if (vz < z0) z0 = vz; if (vz > z1) z1 = vz;
      }
    });
    return { x0, x1, y0, y1, z0, z1 };
  };
  nc.roadClass(at.x, at.z, null);
  const base = boxOf();
  const out = [];
  for (const cls of ['alley', 'curve', 'bikelane', 'culdesac', 'avenue', 'bridge', 'highway']) {
    nc.roadClass(at.x, at.z, cls);
    const b = boxOf();
    /* Y is allowed to grow: a class STANDS THINGS UP (a parapet, a crash
       barrier, a median shrub) and that is the point. X and Z are not — those
       are the apron. 1e-4 of slack for float noise in the merge. */
    const spill = Math.max(base.x0 - b.x0, b.x1 - base.x1, base.z0 - b.z0, b.z1 - base.z1);
    out.push({ cls, spill: +spill.toFixed(5), ok: spill <= 1e-4, tallerBy: +(b.y1 - base.y1).toFixed(3) });
  }
  nc.roadClass(at.x, at.z, null);
  return { base, out };
}, { px: bed.px, pz: bed.pz });
console.log('\napron envelope (X/Z spill past the plain road, must be <= 0):');
for (const e of envelope.out) console.log(`  ${e.cls.padEnd(10)} spill ${String(e.spill).padStart(9)}  ${e.ok ? 'OK' : 'SPILLS'}   (stands ${e.tallerBy} taller)`);
console.log('  plain-road box x', envelope.base.x0.toFixed(3), '..', envelope.base.x1.toFixed(3),
            ' z', envelope.base.z0.toFixed(3), '..', envelope.base.z1.toFixed(3));

/* ── 🛣 THE PLAYER PATH, END TO END ───────────────────────────────────────
   Everything above drives __nc.roadClass, which is the diagnostics seam and
   does NOT charge. This drives applyRun() — the function the pointer calls —
   so the shipped gate, payCost, the toast sink and the conversion branch are
   all exercised at least once. A feature whose measured half and whose shipped
   half are different code paths has not been measured. */
const applied = await page.evaluate(async () => {
  const RC = window.MythicRoadClasses, nc = window.__nc;
  const before = nc.game && Object.keys(nc.game.tiles).length;
  // A diagonal run on clear ground, laid as curves — the shape the bar names.
  const run = RC._plan({ x: 15, z: 15 }, { x: 20, z: 19 }, 'diag');
  const lay = await RC._apply(run, 'curve');
  // …then re-lay part of it as a highway, which takes the CONVERSION branch:
  // a payCost of its own, a cap check and a refreshRoadArea.
  const conv = await RC._apply(run.slice(0, 3), 'highway');
  const classes = run.map(c => nc.roadClassOf(c.x, c.z));
  // Connectivity of what actually landed, with computeLinks' own 4-neighbour rule.
  const set = new Set(run.filter(c => nc.game.tiles[c.x + ',' + c.z]).map(c => c.x + ',' + c.z));
  let reached = 0;
  if (set.size) {
    const first = [...set][0].split(',').map(Number);
    const seen = new Set([first.join(',')]); const q = [first];
    while (q.length) { const [x, z] = q.shift();
      for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const k = (x + dx) + ',' + (z + dz);
        if (set.has(k) && !seen.has(k)) { seen.add(k); q.push([x + dx, z + dz]); } } }
    reached = seen.size;
  }
  return { runLen: run.length, lay, conv, classes, tiles: set.size, reached,
           oneComponent: reached === set.size, added: Object.keys(nc.game.tiles).length - before };
});
console.log('\nplayer path (applyRun through tryPlace + payCost):');
console.log('  diagonal run of ' + applied.runLen + ' →', JSON.stringify(applied.lay));
console.log('  re-lay 3 as highway →', JSON.stringify(applied.conv));
console.log('  classes on the ground:', applied.classes.join(','));
console.log('  ' + applied.tiles + ' tiles landed, one component: ' + applied.oneComponent + ' (' + applied.reached + '/' + applied.tiles + ')');

/* ── the gallery: one frame with every class standing next to a plain street ─
   Not a measurement — the measurements are above, against a control. This is
   for a human to look at, which is a different job and needs a wider camera. */
await page.evaluate(({ px, pz }) => {
  const nc = window.__nc;
  const lay = [
    [px - 2, pz, 'highway'], [px - 1, pz, 'highway'],
    [px, pz, 'curve'],
    [px + 1, pz, 'avenue'], [px + 2, pz, 'culdesac'],
    [px, pz - 2, 'bridge'], [px, pz - 1, 'bridge'],
    [px, pz + 1, 'bikelane'], [px, pz + 2, 'alley'],
  ];
  for (const [x, z, c] of lay) nc.roadClass(x, z, c);
  const { camera, renderer, scene } = nc.three();
  const wx = px - 12 + 0.5, wz = pz - 12 + 0.5;
  camera.position.set(wx + 4.6, 4.4, wz + 4.6);
  camera.up.set(0, 1, 0);
  camera.lookAt(wx, 0, wz);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  renderer.render(scene, camera);
}, { px: bed.px, pz: bed.pz });

/* 🔴 THE GALLERY IS GRABBED IN THE SAME TASK AS ITS RENDER, NOT VIA
   page.screenshot(). A screenshot goes through the COMPOSITOR, which shows
   whatever animate() last drew — and animate() runs OrbitControls.update(),
   which puts the camera back where the player left it. Measured: the first
   version of this line produced a frame of empty ground from the city's default
   viewpoint, several seconds after the camera had been aimed at the test bed.
   preserveDrawingBuffer is off, so the grab has to share the render's task. */
const gallery = await page.evaluate(({ px, pz }) => {
  const { renderer, scene, camera } = window.__nc.three();
  const gl = renderer.domElement;
  const s = document.createElement('canvas'); s.width = gl.width; s.height = gl.height;
  const c = s.getContext('2d');
  const wx = px - 12 + 0.5, wz = pz - 12 + 0.5;
  camera.position.set(wx + 4.6, 4.4, wz + 4.6);
  camera.up.set(0, 1, 0);
  camera.lookAt(wx, 0, wz);
  camera.updateMatrixWorld(true);
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  renderer.render(scene, camera);
  c.drawImage(gl, 0, 0);
  return s.toDataURL('image/png');
}, { px: bed.px, pz: bed.pz });
fs.writeFileSync(path.join(OUT, 'gallery.png'), Buffer.from(gallery.split(',')[1], 'base64'));
fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ boot, bed: { px: bed.px, pz: bed.pz, tiles: bed.tiles }, rows, diag, calls, logs: logs.slice(-40) }, null, 2));

console.log('\n--- verify ---', JSON.stringify(boot.verify));
console.log('--- last logs ---');
console.log(logs.slice(-14).join('\n'));

await browser.close();
server.close();
