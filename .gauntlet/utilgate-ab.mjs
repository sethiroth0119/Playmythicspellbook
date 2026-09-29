/* == 👁 THE UTILITY-OVERLAY GATE A/B =========================================
   Proves, PHOTOGRAPHICALLY, that power lines and water mains are now things a
   player GOES AND LOOKS AT rather than permanent decoration — and reports the
   do-nothing CONTROL beside every figure, because a pixel count without one is
   not a verdict.

   🔴 THE INSTRUMENT, AND WHY IT IS BUILT THIS WAY (.gauntlet/README item 6).
   animate() is the only thing that renders and rAF fires at about 0.56 Hz here,
   so a change-then-read in the same task reads THE FRAME BEFORE THE CHANGE —
   for any layer, always — and reports a confident, wrong 0.00%. That verdict
   cost two overlays a "cannot be photographed" ruling. So this driver:
     · calls renderer.render(scene, camera) ITSELF, and
     · drawImage()s the canvas IN THE SAME TASK as that render, because
       preserveDrawingBuffer is off and the buffer is gone by the next task.
   The control (two shoots with nothing changed between them) must come out at
   exactly 0. If it does not, the instrument is dead and every number beside it
   means nothing. It is printed on every row.

   WHAT IS MEASURED / ASSERTED
     1  the build shop contains ZERO carriageways, including in the automatic
        "Other" orphan bucket that BUILD_ORDER feeds;
     2  the build bar carries exactly ONE road tab;
     3  power lines: hidden with no tool armed and the layer off, drawn when the
        line tool is armed — against a control of 0;
     4  the Grid Connector is visible in the zero-armed frame AND is not
        parented to the gated group;
     5  water mains: the shipped gate still holds, same shape, same control;
     6  a mid-drag stand-down (the player picks a building) restores
        controls.enabled to its saved value AND puts the layer away;
     7  an existing save still loads with its roads AND their classes intact,
        every class still placeable, /src/roads still mounting before loadState.

   Usage: node .gauntlet/utilgate-ab.mjs [outdir]
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || '.gauntlet/shots/utilgate');
fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.resolve(process.cwd(), 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8800 + (process.pid % 90);
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
/* ☀ Pin the clock to early afternoon — node-city's sky is real wall time 1:1,
   so an unpinned run photographs a lit-lamp night frame half the time. Copied
   from .gauntlet/roadclass-ab.mjs for the same reason the crop is derived
   rather than typed: the instrument must not depend on when it was run. */
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
await page.waitForFunction(() => window.__nc && window.__nc.three && window.__nc.three().renderer, null,
  { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(9000);

const boot = await page.evaluate(() => ({
  nc: !!window.__nc,
  power: !!window.MythicPower, water: !!window.MythicWater,
  roads: !!window.MythicRoadClasses, netdrag: !!window.MythicNetDrag,
  linesReady: !!(window.MythicPower && window.MythicPower.lines.ready()),
}));
console.log('boot:', JSON.stringify(boot));
if (!boot.nc) { console.log(logs.slice(-30).join('\n')); throw new Error('node-city did not boot'); }

const FAIL = [];
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra != null ? '   ' + extra : ''));
  if (!cond) FAIL.push(label);
};

/* ══ 1 · THE BUILD SHOP HAS NO ROADS IN IT ════════════════════════════════ */
console.log('\n── 1 · the build shop ──');
const shop = await page.evaluate(() => {
  const btn = document.getElementById('openshop');
  if (btn) btn.click();                       // the shipped open path; it rebuilds the body
  const cards = [...document.querySelectorAll('#shopbody [data-build]')].map(b => b.getAttribute('data-build'));
  const secs = [...document.querySelectorAll('#shopbody .shopsec')].map(s => ({
    name: (s.querySelector('h3') || {}).textContent || '',
    items: [...s.querySelectorAll('[data-build]')].map(b => b.getAttribute('data-build')),
  }));
  const isRoad = (t) => { try { return !!(window.MythicRoads && window.MythicRoads.isType(t)); } catch (e) { return t === 'road'; } };
  const meters = document.querySelectorAll('#shopbody .roadmeter').length;
  return { n: cards.length, roads: cards.filter(isRoad), secs: secs.map(s => s.name.trim()),
           other: (secs.find(s => /Other/.test(s.name)) || { items: [] }).items, meters,
           types: (window.MythicRoads ? window.MythicRoads.types() : ['road']) };
});
console.log('  carriageway types:', JSON.stringify(shop.types));
console.log('  shop sections:', JSON.stringify(shop.secs));
ok(shop.n > 40, 'the shop rendered its palette', shop.n + ' cards');
ok(shop.roads.length === 0, 'ZERO carriageway cards anywhere in the shop', JSON.stringify(shop.roads));
ok(shop.other.length === 0 || !shop.other.some(t => shop.types.includes(t)),
   'the automatic "Other" orphan bucket contains no carriageway', JSON.stringify(shop.other));
ok(shop.meters === 0, 'the shop no longer injects the road meter (it moved to the roads tab)', shop.meters);
await page.evaluate(() => { const v = document.getElementById('shopveil'); if (v) v.classList.remove('on'); });

/* ══ 2 · ONE ROAD TAB ═════════════════════════════════════════════════════ */
console.log('\n── 2 · the build bar ──');
const bar = await page.evaluate(() => {
  const names = [...document.querySelectorAll('#buildbar button')].map(b => b.id || b.className);
  return { ndg: !!document.getElementById('ndg-open'), nrc: !!document.getElementById('nrc-open'),
           claim: window.__ncRoadTab || null, ids: names.filter(Boolean),
           nrcLabel: (document.getElementById('nrc-open') || {}).textContent || '',
           fullMeter: !!(document.querySelector('#nrc-fullmeter .roadmeter')) };
});
console.log('  bar buttons:', JSON.stringify(bar.ids));
ok(bar.nrc && !bar.ndg, 'exactly ONE road tab on the bar (#nrc-open, no #ndg-open)',
   'claim=' + bar.claim + ' nrc=' + bar.nrc + ' ndg=' + bar.ndg);
ok(/Roads/.test(bar.nrcLabel), 'the surviving tab is labelled "Roads"', JSON.stringify(bar.nrcLabel));
// open it once so the panel renders and the re-homed meter can be read
const meter = await page.evaluate(() => {
  const b = document.getElementById('nrc-open'); if (b) b.click();
  const el = document.querySelector('#nrc-fullmeter .roadmeter');
  const txt = el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  const b2 = document.getElementById('nrc-open'); if (b2) b2.click();     // put it away again
  return txt;
});
ok(/Road network/.test(meter) && /per Supply Depot/.test(meter),
   'roadMeterHtml() re-homed into the roads tab, breakdown intact', JSON.stringify(meter.slice(0, 90)));

/* ══ THE TEST BED ═════════════════════════════════════════════════════════
   A power run and a water main, both laid through the SHIPPED code paths
   (MythicPower.lines.lay charges payCost; MythicWater.pipes.add is the seam the
   pipe tool itself writes through). Nothing is written behind a gate. */
const bed = await page.evaluate(async () => {
  const nc = window.__nc, G = 24;
  try { await window.MythicCityBridge.addCinders(4000000); } catch (e) {}
  const free = (x, z) => !nc.game.tiles[x + ',' + z];
  // a clear row, 8 wide, somewhere in the middle of the plate
  let rz = -1, rx = -1;
  outer: for (let z = 4; z < G - 5; z++) for (let x = 3; x < G - 11; x++) {
    let good = true;
    for (let d = 0; d < 8; d++) if (!free(x + d, z) || !free(x + d, z + 1)) { good = false; break; }
    if (good) { rx = x; rz = z; break outer; }
  }
  if (rx < 0) return { ok: false, why: 'no clear 8x2 strip' };
  const P = window.MythicPower.lines;
  const before = P.count();
  const r = await P.lay(rx, rz, rx + 7, rz);
  const pipes = window.__nc.waterPipe(rx, rz + 1, rx + 7, rz + 1);
  return { ok: P.count() > before, rx, rz, laid: P.count() - before, pipes,
           payload: r && { ok: r.ok, n: r.n, cinder: r.cinder, why: r.why },
           mains: window.MythicWater.pipes ? window.MythicWater.pipes.count() : -1 };
});
console.log('\nbed:', JSON.stringify(bed));
if (!bed.ok) { console.log(logs.slice(-25).join('\n')); throw new Error('could not lay the power run: ' + (bed.why || '')); }

/* ══ THE INSTRUMENT ═══════════════════════════════════════════════════════ */
await page.evaluate(({ rx, rz }) => {
  const { renderer, scene, camera, THREE } = window.__nc.three();
  const gl = renderer.domElement;
  const CW = gl.width, CH = gl.height;
  const s = document.createElement('canvas'); s.width = CW; s.height = CH;
  const c = s.getContext('2d', { willReadFrequently: true });
  const HALF = 12;
  /* 🔴 RE-AIMED BEFORE EVERY SHOT. animate() runs OrbitControls.update() on its
     own clock at ~0.56 Hz, so between shot A and shot B the camera can move by
     an unknown amount at an unpredictable moment and the diff would be
     measuring the camera. Re-aiming makes A and B identical by construction
     rather than by hope. matrixWorldInverse is refreshed by hand because
     project() reads it and only renderer.render() normally writes it. */
  /* 🎥 THE OFFSET IS PURELY IN +Z, not on the diagonal, and that is a
     MEASUREMENT decision rather than a taste one. The test run is laid along
     +x; from a 45° corner the row projects as a DIAGONAL, so the axis-aligned
     bounding box of its cells is a big square that is mostly grass and a real
     change reports at 2%. Square on from the south the same row projects
     horizontally and its bounding box IS the cable corridor. */
  window.__ugAim = (tx, tz, oy, od) => {
    const wx = tx - HALF + 0.5, wz = tz - HALF + 0.5;
    camera.position.set(wx, (oy || 3.2), wz + (od || 3.4));
    camera.up.set(0, 1, 0);
    camera.lookAt(wx, 0.25, wz);
    camera.updateMatrixWorld(true);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
  };
  window.__ugShoot = (tx, tz, oy, od) => {
    window.__ugAim(tx, tz, oy, od);
    renderer.render(scene, camera);            // ⚠ SAME TASK as the drawImage below
    c.clearRect(0, 0, CW, CH);
    c.drawImage(gl, 0, 0, CW, CH);
    return c.getImageData(0, 0, CW, CH);
  };
  window.__ugSize = { CW, CH };
  /* The crop, DERIVED from the RUN'S OWN projected extent — never typed, and
     never a big square around a thin thing. A hardcoded crop drifts out of the
     picture the first time a framing moves; a crop far larger than the subject
     divides a real change by a mostly-empty denominator and reports a
     single-digit percentage for a layer that is plainly there. This takes the
     bounding box of the cells themselves at ground level and at pole height,
     pads it, and clamps. `pad` is in pixels. */
  window.__ugRunCrop = (cells, tx, tz, oy, od, pad, hs) => {
    window.__ugAim(tx, tz, oy, od);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [cx, cz] of cells) for (const h of (hs || [0, 0.8])) {
      const v = new THREE.Vector3(cx - HALF + 0.5, h, cz - HALF + 0.5).project(camera);
      const sx = (v.x * 0.5 + 0.5) * CW, sy = (-v.y * 0.5 + 0.5) * CH;
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    const p = pad == null ? 14 : pad;
    return { x0: Math.max(0, Math.round(x0 - p)), y0: Math.max(0, Math.round(y0 - p)),
             x1: Math.min(CW, Math.round(x1 + p)), y1: Math.min(CH, Math.round(y1 + p)) };
  };
  window.__ugDiff = (A, B, crop) => {
    let n = 0, tot = 0; const W = window.__ugSize.CW;
    for (let y = crop.y0; y < crop.y1; y++) for (let x = crop.x0; x < crop.x1; x++) {
      const i = (y * W + x) * 4; tot++;
      if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++;
    }
    return { changed: n, total: tot, pct: tot ? +(n * 100 / tot).toFixed(2) : 0 };
  };
  /* 🔴 LAYER FLIPS GO THROUGH THE PANEL'S OWN CHECKBOX, not through a direct
     write to the exported `layers` object. Writing the object sets the flag and
     never calls onLayers(), so nothing pushes it down to the module that owns
     the surface — a driver that did that would be testing a variable it had
     just assigned. This clicks the row a player clicks and returns whether the
     push actually landed. */
  window.__ugLayer = (mod, id, on) => {
    const api = mod === 'power' ? window.MythicPower : window.MythicWater;
    api.openPanel();
    const cb = document.querySelector('input[data-layer="' + id + '"]');
    if (!cb) return { ok: false, why: 'no checkbox for ' + id };
    if (cb.checked !== !!on) { cb.checked = !!on; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    api.closePanel();
    return { ok: api.layers[id] === !!on, flag: api.layers[id] };
  };
}, bed);

/* ══ 3 · POWER LINES: HIDDEN, THEN DRAWN ══════════════════════════════════ */
console.log('\n── 3 · power lines follow the tool ──');
const pwr = await page.evaluate(({ rx, rz }) => {
  const P = window.MythicPower;
  const vis = () => !!(window.__nc.three().scene.getObjectByName('mythic-power-lines') || {}).visible;
  const cells = []; for (let d = 0; d < 8; d++) cells.push([rx + d, rz]);
  /* Far enough back that the WHOLE run is on screen. It has to be: __ugRunCrop
     takes the bounding box of the projected cells, and a cell behind the near
     plane projects to nonsense that clamps the box to the whole frame — which
     is how a real 20% change first reported as 1.9% against a denominator of
     680,000 mostly-empty pixels. */
  const tx = rx + 3.5, tz = rz, OY = 5.0, OD = 6.0;
  // baseline condition: no tool armed, layer OFF (its shipped default)
  P.lines.arm(false);
  const lOff = window.__ugLayer('power', 'wires', false);
  /* TWO CROPS, BOTH REPORTED, because one of them alone would be arguable.
       wide  the whole run and the ground under it — an honest "is there a
             visible change in this part of the map" denominator, and a
             deliberately unflattering one: a transmission line is a THIN thing
             and most of a tile strip is grass either way.
       tight the cable CORRIDOR — the band from mid-pole to the wire, which is
             where the subject actually is. This is the number the bar's
             "double-digit percent" is asserted on, and the wide one is printed
             beside it so the denominator is never hidden. */
  const cropWide  = window.__ugRunCrop(cells, tx, tz, OY, OD, 14, [0, 0.8]);
  const cropTight = window.__ugRunCrop(cells, tx, tz, OY, OD, 5, [0.42, 0.72]);
  const A = window.__ugShoot(tx, tz, OY, OD);
  const A2 = window.__ugShoot(tx, tz, OY, OD);           // ← THE CONTROL
  const control = window.__ugDiff(A, A2, cropTight);
  const controlWide = window.__ugDiff(A, A2, cropWide);
  const hiddenState = { visible: vis() };
  P.lines.arm(true);                                     // the only thing that changes
  const B = window.__ugShoot(tx, tz, OY, OD);
  const armedDelta = window.__ugDiff(A, B, cropTight);
  const armedWide = window.__ugDiff(A, B, cropWide);
  const armedState = { visible: vis() };
  // and switching the LAYER on with no tool armed must also draw it
  P.lines.arm(false);
  const lOn = window.__ugLayer('power', 'wires', true);
  const C2 = window.__ugShoot(tx, tz, OY, OD);
  const layerDelta = window.__ugDiff(A, C2, cropTight);
  const layerState = { visible: vis() };
  const lBack = window.__ugLayer('power', 'wires', false);
  const D = window.__ugShoot(tx, tz, OY, OD);
  const backDelta = window.__ugDiff(A, D, cropTight);
  return { cropWide, cropTight, control, controlWide, armedDelta, armedWide, layerDelta, backDelta,
           hiddenState, armedState, layerState,
           lOff, lOn, lBack, cells: P.lines.count(), verify: P.lines.verify() };
}, bed);
const dim = (c) => (c.x1 - c.x0) + '×' + (c.y1 - c.y0);
console.log('  crops — wide ' + dim(pwr.cropWide) + ' / cable corridor ' + dim(pwr.cropTight) + ',  cells laid:', pwr.cells);
console.log('  layer pushes:', JSON.stringify([pwr.lOff, pwr.lOn, pwr.lBack]));
ok(pwr.control.pct === 0 && pwr.controlWide.pct === 0, 'CONTROL — two shoots, nothing changed',
   'corridor ' + pwr.control.pct + '% · wide ' + pwr.controlWide.pct + '%  (both must be 0)');
ok(pwr.hiddenState.visible === false, 'no tool armed + layer off ⇒ the cable group is hidden');
ok(pwr.armedState.visible === true, 'line tool armed ⇒ the cable group is drawn');
ok(pwr.armedDelta.pct >= 10, 'ARMED vs baseline moves double-digit percent of the cable corridor',
   pwr.armedDelta.pct + '%  vs control ' + pwr.control.pct + '%   (whole-run crop: ' +
   pwr.armedWide.pct + '% vs control ' + pwr.controlWide.pct + '%)');
ok(pwr.layerDelta.pct >= 10, 'LAYER on (no tool) also draws it', pwr.layerDelta.pct + '%  vs control ' + pwr.control.pct + '%');
ok(pwr.backDelta.pct === pwr.control.pct, 'putting both away returns to the baseline frame exactly',
   pwr.backDelta.pct + '%  vs control ' + pwr.control.pct + '%');
ok(pwr.verify && pwr.verify.ok, 'lines.verify() clean', JSON.stringify(pwr.verify && pwr.verify.violations));

/* ══ 4 · THE GRID CONNECTOR IS NEVER GATED ════════════════════════════════ */
console.log('\n── 4 · the Grid Connector ──');
const conn = await page.evaluate(() => {
  const { scene } = window.__nc.three();
  const gated = scene.getObjectByName('mythic-power-lines');
  const gc = scene.getObjectByName('mythic-power-connector');
  window.MythicPower.lines.arm(false);
  window.__ugLayer('power', 'wires', false);
  return { present: !!gc, visible: !!(gc && gc.visible),
           parentIsScene: !!(gc && gc.parent === scene),
           parentIsGated: !!(gc && gated && gc.parent === gated),
           gatedVisible: !!(gated && gated.visible),
           children: gc ? gc.children.length : 0,
           v: window.MythicPower.lines.verify() };
});
ok(conn.present, 'the connector has its own group in the scene', conn.children + ' children');
ok(conn.parentIsScene && !conn.parentIsGated, 'it is parented to the SCENE, not to the gated cable group');
ok(conn.visible && !conn.gatedVisible, 'in the zero-armed frame the connector is visible and the cable is not',
   'connector=' + conn.visible + ' cable=' + conn.gatedVisible);
ok(conn.v && conn.v.ok, 'verify() asserts the parentage invariant and passes', JSON.stringify(conn.v && conn.v.gate));

/* ══ 5 · WATER MAINS: THE SHIPPED GATE STILL HOLDS ════════════════════════ */
console.log('\n── 5 · water mains (the shipped gate, unchanged) ──');
const wat = await page.evaluate(({ rx, rz }) => {
  const W = window.MythicWater;
  const vis = () => !!(window.__nc.three().scene.getObjectByName('mythic-water-mains') || {}).visible;
  const cells = []; for (let d = 0; d < 8; d++) cells.push([rx + d, rz + 1]);
  const tx = rx + 3.5, tz = rz + 1, OY = 5.0, OD = 6.0;
  W.pipes.tool(false);
  const lOff = window.__ugLayer('water', 'pipes', false);
  const crop = window.__ugRunCrop(cells, tx, tz, OY, OD);
  const A = window.__ugShoot(tx, tz, OY, OD);
  const A2 = window.__ugShoot(tx, tz, OY, OD);           // ← THE CONTROL
  const control = window.__ugDiff(A, A2, crop);
  const off = { visible: vis() };
  W.pipes.tool(true);
  const B = window.__ugShoot(tx, tz, OY, OD);
  const armedDelta = window.__ugDiff(A, B, crop);
  const on = { visible: vis() };
  W.pipes.tool(false);
  const C2 = window.__ugShoot(tx, tz, OY, OD);
  const backDelta = window.__ugDiff(A, C2, crop);
  return { crop, control, armedDelta, backDelta, off, on, count: W.pipes.count(), lOff };
}, bed);
console.log('  crop:', JSON.stringify(wat.crop), ' pipes:', wat.count);
ok(wat.control.pct === 0, 'CONTROL — two shoots, nothing changed', wat.control.pct + '%  (must be 0)');
ok(wat.off.visible === false, 'no tool armed + layer off ⇒ the mains overlay is hidden');
ok(wat.on.visible === true, 'pipe tool armed ⇒ the mains overlay is drawn');
ok(wat.armedDelta.pct >= 5, 'ARMED vs baseline moves the crop', wat.armedDelta.pct + '%  vs control ' + wat.control.pct + '%');
ok(wat.backDelta.pct === wat.control.pct, 'putting it away returns to the baseline frame exactly',
   wat.backDelta.pct + '%  vs control ' + wat.control.pct + '%');

/* ══ 6 · MID-DRAG STAND-DOWN ══════════════════════════════════════════════
   The player arms the line tool, starts a drag, and then picks a building off
   the shop. rig.js's bindMode must stand the tool down; the tool must give the
   camera back AND put the layer away, and it must say so. */
console.log('\n── 6 · a mid-drag stand-down gives back the camera AND the layer ──');
const stand = await page.evaluate(async ({ rx, rz }) => {
  const P = window.MythicPower;
  const { renderer, camera, scene, THREE, controls } = window.__nc.three();
  const canvas = renderer.domElement;
  const gated = scene.getObjectByName('mythic-power-lines');
  window.__ugLayer('power', 'wires', false);
  /* The SAVED value the tool must give back — set to something recognisable
     first, so "restored" cannot be confused with "happened to be true". */
  if (controls) controls.enabled = true;
  const ctrlSaved = controls ? controls.enabled : null;
  P.lines.arm(true);
  // project a cell centre to client coords and dispatch a REAL pointerdown
  window.__ugAim(rx + 1, rz);
  const v = new THREE.Vector3(rx + 1 - 12 + 0.5, 0, rz - 12 + 0.5).project(camera);
  const r = canvas.getBoundingClientRect();
  const cx = r.left + (v.x * 0.5 + 0.5) * r.width;
  const cy = r.top + (-v.y * 0.5 + 0.5) * r.height;
  const ev = (t, b) => canvas.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true,
    clientX: cx, clientY: cy, button: b || 0, buttons: 1, pointerId: 1, pointerType: 'mouse' }));
  ev('pointerdown', 0);
  const midDrag = { armed: P.lines.armed(), visible: !!(gated && gated.visible),
                    ctrl: controls ? controls.enabled : null };
  // now the player picks a building — the shipped path, not a synthetic call
  const shopBtn = document.getElementById('openshop'); if (shopBtn) shopBtn.click();
  const card = document.querySelector('#shopbody [data-build]');
  const picked = card ? card.getAttribute('data-build') : null;
  if (card) card.click();
  await new Promise(res => setTimeout(res, 60));
  const after = { armed: P.lines.armed(), visible: !!(gated && gated.visible),
                  ctrl: controls ? controls.enabled : null };
  const toasts = [...document.querySelectorAll('#toasts .toast')].map(t => t.textContent);
  return { midDrag, after, picked, ctrlSaved, toasts: toasts.slice(-3) };
}, bed);
console.log('  picked off the shop:', stand.picked);
console.log('  toasts:', JSON.stringify(stand.toasts));
ok(stand.midDrag.armed && stand.midDrag.visible, 'mid-drag: the tool is armed and the cable is drawn',
   JSON.stringify(stand.midDrag));
ok(stand.midDrag.ctrl === false, 'mid-drag: the tool is holding the camera (controls.enabled === false)',
   'saved was ' + stand.ctrlSaved);
ok(!stand.after.armed, 'picking a building stands the line tool down', JSON.stringify(stand.after));
ok(!stand.after.visible, 'and the cable goes away with it — the player sees the layer go');
ok(stand.after.ctrl === stand.ctrlSaved,
   'controls.enabled is back at its SAVED value — the camera survives the session',
   'saved=' + stand.ctrlSaved + ' after=' + stand.after.ctrl);
ok(stand.toasts.some(t => /Power lines put away/.test(t)), 'the stand-down is NOT silent — it names itself',
   JSON.stringify(stand.toasts.filter(t => /Power/.test(t))));

/* ── the pictures ───────────────────────────────────────────────────────── */
const shots = await page.evaluate(async ({ rx, rz }) => {
  const P = window.MythicPower;
  const out = {};
  const grab = () => window.__nc.three().renderer.domElement.toDataURL('image/png');
  P.lines.arm(false); window.__ugLayer('power', 'wires', false);
  window.__ugShoot(rx + 3.5, rz, 5.0, 6.0); out.off = grab();
  P.lines.arm(true);
  window.__ugShoot(rx + 3.5, rz, 5.0, 6.0); out.armed = grab();
  P.lines.arm(false);
  return out;
}, bed);
for (const [k, v] of Object.entries(shots)) {
  fs.writeFileSync(path.join(OUT, 'lines-' + k + '.png'), Buffer.from(v.split(',')[1], 'base64'));
}
console.log('\nshots →', OUT);

/* ══ 7 · AN EXISTING SAVE STILL LOADS WITH ITS ROADS ══════════════════════
   The half of "roads out of BUILD" that a DOM check cannot reach. Roads are
   tile types written verbatim into every save and their CLASS rides in t.rc, so
   the registry edit must not have touched the load path — and /src/roads must
   still mount BEFORE loadState, because the class hook lives inside makeRoad
   and mounting after means a city of highways loads as a city of streets and
   never says so. Laid through the palette's own apply(), saved through
   saveNow(), then the page is RELOADED for real. */
console.log('\n── 7 · save → reload → the roads are still there, still classed ──');
const laid = await page.evaluate(async () => {
  const RC = window.MythicRoadClasses, nc = window.__nc, G = 24;
  try { await window.MythicCityBridge.addCinders(9000000); } catch (e) {}
  const free = (x, z) => !nc.game.tiles[x + ',' + z];
  let bx = -1, bz = -1;
  outer: for (let z = 10; z < G - 3; z++) for (let x = 3; x < G - 7; x++) {
    let good = true; for (let d = 0; d < 5; d++) if (!free(x + d, z)) { good = false; break; }
    if (good) { bx = x; bz = z; break outer; }
  }
  if (bx < 0) return { ok: false, why: 'no clear strip' };
  const cells = []; for (let d = 0; d < 5; d++) cells.push({ x: bx + d, z: bz });
  const r = await RC._apply(cells, 'highway');
  const got = cells.map(c => { const t = nc.game.tiles[c.x + ',' + c.z]; return t ? (t.type + '/' + (t.rc || '-')) : 'none'; });
  try { window.__nc.saveNow ? window.__nc.saveNow() : null; } catch (e) {}
  return { ok: true, bx, bz, r, got, key: null };
});
console.log('  laid:', JSON.stringify(laid.got), laid.r ? JSON.stringify(laid.r) : '');
ok(laid.ok && laid.got.every(g => /^road\//.test(g)), 'a classed run was laid from the roads tab', JSON.stringify(laid.got));
// saveNow is not on __nc; force the shipped flush the way the tab closing does
await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForTimeout(2500);
await page.reload({ waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__nc && window.__nc.three && window.__nc.three().renderer, null,
  { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(9000);
const reloaded = await page.evaluate(({ bx, bz }) => {
  const nc = window.__nc;
  const got = []; for (let d = 0; d < 5; d++) { const t = nc.game.tiles[(bx + d) + ',' + bz]; got.push(t ? (t.type + '/' + (t.rc || '-')) : 'none'); }
  const RC = window.MythicRoadClasses;
  return {
    got,
    roads: !!RC, classes: RC ? RC._ui() !== undefined : false,
    tab: !!document.getElementById('nrc-open'), dup: !!document.getElementById('ndg-open'),
    claim: window.__ncRoadTab || null,
    // every class must still be offered by the palette
    chips: [...document.querySelectorAll('#nrc-panel [data-cls]')].map(b => b.dataset.cls),
    capUsed: RC && RC.capUsed ? RC.capUsed() : null,
  };
}, laid);
console.log('  after reload:', JSON.stringify(reloaded.got));
console.log('  palette classes:', JSON.stringify(reloaded.chips));
ok(reloaded.got.every(g => g === 'road/highway'),
   'the save came back with its roads AND their class intact', JSON.stringify(reloaded.got));
ok(reloaded.tab && !reloaded.dup, 'one road tab after a reload too', 'claim=' + reloaded.claim);
ok(reloaded.chips.length >= 9, 'every road class is still placeable from the roads tab', reloaded.chips.length + ' classes');
ok(reloaded.capUsed >= 5 * 4, 'the weighted road cap counted the highways (weight 4 each)', reloaded.capUsed);

/* Mount order, asserted against the file rather than assumed — the class hook
   lives inside makeRoad, so /src/roads mounting AFTER loadState loads a city of
   highways as a city of streets and says nothing. */
const srcOrder = fs.readFileSync(path.join(ROOT, 'node-city', 'index.html'), 'utf8');
const iRoads = srcOrder.indexOf("src/roads/index.js");
const iLoad = srcOrder.indexOf('await loadState(');
ok(iRoads > 0 && iLoad > 0 && iRoads < iLoad, '/src/roads still mounts BEFORE loadState',
   'roads@' + iRoads + ' loadState@' + iLoad);

const errs = logs.filter(l => /pageerror|\[error\]/.test(l));
if (errs.length) console.log('\nconsole errors:\n' + errs.slice(-10).join('\n'));

await browser.close();
server.close();
console.log('\n' + (FAIL.length ? '❌ ' + FAIL.length + ' FAILED:\n  · ' + FAIL.join('\n  · ')
                                : '✅ UTILITY-OVERLAY GATE PASSED — every figure reported beside its control.'));
process.exit(FAIL.length ? 1 : 0);
