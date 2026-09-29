/* CRIT-MOODICONS — independent audit of P3 (the floating faces).
   Not the builder's driver. Different scene, different assertions:
     A  the PLAYER path: the F key and the 🙂 utility button, not __nc.
     B  THREE flagged crops + one control, at three framings (aerial, orbit,
        zoom-in), render-trap protocol exactly.
     C  centroid-vs-projection for all three, at every framing.
     D  a RED MUTATION: blank the layer's drawRange and re-run the same A/B —
        every flagged crop must collapse to 0. A positive number from an
        instrument that never reports 0 is not a measurement.
     E  cost at 3 badges AND at the 40-badge cap.
     F  NaN / undefined sweep over every published number.
*/
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8940 + (process.pid % 50);

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(14000);

let fails = 0;
const fail = (m) => { fails++; console.error('  X ' + m); };
const ok = (m) => console.log('  . ' + m);

/* ── THE SCENE. Three houses well apart + one street light as the control. */
const F1 = { x: 4, z: 4 }, F2 = { x: 19, z: 4 }, F3 = { x: 4, z: 19 }, CTL = { x: 19, z: 19 };
const built = await page.evaluate(async (P) => {
  const nc = window.__nc, B = window.MythicCityBridge;
  B.spendCinders = async () => true; B.spendRes = async () => true;
  B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true;
  /* ⚠ finishAll() AFTER EACH ONE. This branch is city-construction-timers: a
     placement becomes a SITE, and only a couple of sites build at a time — a
     single finishAll() at the end left the third house a hole in the ground and
     the third crop legitimately read 0. That is the scaffold guard working, not
     a defect, but it makes the naive driver measure two tiles while claiming
     three. Probed, not assumed (.gauntlet/crit-probe.mjs). */
  for (const t of [P.F1, P.F2, P.F3]) { await nc.place('housing', t.x, t.z); try { nc.build.finishAll(); } catch (e) {} await new Promise(r => setTimeout(r, 150)); }
  await nc.place('streetlight', P.CTL.x, P.CTL.z);
  for (let i = 0; i < 3; i++) { try { nc.build.finishAll(); } catch (e) {} await new Promise(r => setTimeout(r, 150)); }
  await new Promise(r => setTimeout(r, 500));
  const occ = {}; try { for (const k of Object.keys(nc.game.tiles)) { const t = nc.game.tiles[k]; if (t && t.type) occ[k] = t.type; } } catch (e) {}
  return { placed: [P.F1, P.F2, P.F3, P.CTL].map(t => occ[t.x + ',' + t.z] || 'MISSING') };
}, { F1, F2, F3, CTL });
console.log('\n0  SCENE  placed(3 houses + 1 light): ' + JSON.stringify(built.placed));

/* ── A. THE PLAYER PATH ──────────────────────────────────────────────────── */
console.log('\nA  REACHABLE BY A PLAYER — the F key and the utility button');
const reach = await page.evaluate(() => {
  const I = window.MythicPlotIcons;
  if (!I || !I.mounted()) return { error: 'MythicPlotIcons did not mount' };
  if (I.visible()) I.hide();
  const before = I.visible();
  return { error: null, before, mountedOk: true,
           btn: !!document.querySelector('[data-util="pm"]') };
});
if (reach.error) fail(reach.error);
else {
  await page.keyboard.press('f');
  await page.waitForTimeout(400);
  const afterKey = await page.evaluate(() => ({ vis: window.MythicPlotIcons.visible(),
                                                meshVis: !!(window.MythicPlotIcons.mesh() && window.MythicPlotIcons.mesh().visible),
                                                legend: !!document.querySelector('#pmlegend') && document.querySelector('#pmlegend').style.display }));
  if (!afterKey.vis || !afterKey.meshVis) fail('the F key did not switch the layer on (vis ' + afterKey.vis + ', mesh ' + afterKey.meshVis + ')');
  else ok('F turns the layer on through the shipped keydown handler (legend display: ' + afterKey.legend + ')');
  await page.keyboard.press('f');
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => window.MythicPlotIcons.visible());
  if (off) fail('F did not switch it back off'); else ok('F switches it off again');

  // the button: rendered only when the layer is mounted
  const btnOk = await page.evaluate(() => {
    const b = document.querySelector('[data-util="pm"]');
    if (!b) return { present: false };
    b.click();
    return { present: true, vis: window.MythicPlotIcons.visible(), text: b.textContent.trim() };
  });
  if (!btnOk.present) fail('no [data-util="pm"] button in the DOM — the mouse-only player has no way in');
  else if (!btnOk.vis) fail('the 🙂 button is present but clicking it did not show the layer');
  else ok('the "' + btnOk.text + '" button shows the layer on click');
}
await page.evaluate(() => { const I = window.MythicPlotIcons; if (!I.visible()) I.show(); I.sync(); });
await page.waitForTimeout(600);

/* ── which tiles are actually flagged ─────────────────────────────────────── */
const drawn0 = await page.evaluate(() => ({ drawn: window.MythicPlotIcons.drawn(),
                                            stats: window.__nc.plotIcons(),
                                            cost: window.MythicPlotIcons.cost() }));
console.log('\n   drawn: ' + JSON.stringify(drawn0.drawn.map(d => d.x + ',' + d.z + ' ' + d.reason + '/' + d.glyph)));

/* ── E. COST at the natural load ─────────────────────────────────────────── */
console.log('\nE  COST — renderer.info, layer OFF vs ON, read together');
const cost1 = await page.evaluate(() => {
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  let g = null; scene.traverse(o => { if (!g && o.name === 'mythic-plotmood-icons') g = o; });
  if (!g) return { error: 'no mesh named mythic-plotmood-icons in the scene' };
  const meshes = () => { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); return n; };
  const read = () => { renderer.render(scene, camera); return { c: renderer.info.render.calls, t: renderer.info.render.triangles, m: meshes() }; };
  g.visible = true; const on = read();
  g.visible = false; const off = read();
  g.visible = true; const on2 = read();
  return { on, off, on2, module: window.MythicPlotIcons.cost() };
});
if (cost1.error) fail(cost1.error);
else {
  console.log('   calls ON ' + cost1.on.c + ' OFF ' + cost1.off.c + '  d=' + (cost1.on.c - cost1.off.c) +
              ' | tris d=' + (cost1.on.t - cost1.off.t) + ' | meshes d=' + (cost1.on.m - cost1.off.m) +
              ' | module ' + JSON.stringify(cost1.module));
  const dC = cost1.on.c - cost1.off.c;
  if (dC !== 1) fail('draw-call delta ' + dC + ', expected exactly 1'); else ok('draw-call delta exactly 1');
  if ((cost1.on.t - cost1.off.t) !== cost1.module.triangles) fail('triangle delta ' + (cost1.on.t - cost1.off.t) + ' != module claim ' + cost1.module.triangles);
  else ok('triangle delta matches the module claim (' + cost1.module.triangles + ')');
  if ((cost1.on.m - cost1.off.m) !== 0) fail('scene mesh delta ' + (cost1.on.m - cost1.off.m)); else ok('no mesh per tile — scene mesh delta 0');
  if (cost1.on.c !== cost1.on2.c) fail('the two ON reads disagree');
}

/* ── B + C + D. THE A/B, THE ANCHOR, AND THE RED MUTATION ────────────────── */
const FRAMINGS = {
  aerial: { cam: [26, 30, 26], tgt: [0, 0.6, 0] },
  orbit:  [-30, 22, 18],
  zoom:   null,
};
const CAMS = {
  aerial:  { cam: [26, 30, 26], tgt: [0, 0.6, 0] },
  orbited: { cam: [-28, 24, 20], tgt: [0, 0.6, 0] },
  zoomed:  { cam: [13, 15, 13], tgt: [0, 0.6, 0] },
};

async function shootFraming(name, cfg, blank) {
  await page.evaluate((c) => {
    const nc = window.__nc;
    nc.camera.position.set(c.cam[0], c.cam[1], c.cam[2]);
    try { nc.controls.target.set(c.tgt[0], c.tgt[1], c.tgt[2]); nc.controls.update(); } catch (e) {}
    nc.camera.position.set(c.cam[0], c.cam[1], c.cam[2]);
    nc.camera.lookAt(c.tgt[0], c.tgt[1], c.tgt[2]);
    nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
    try { nc.cullAgents(90); } catch (e) {}
  }, cfg);
  await page.waitForTimeout(800);
  return page.evaluate(([tiles, doBlank]) => {
    const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
    let g = null; scene.traverse(o => { if (!g && o.name === 'mythic-plotmood-icons') g = o; });
    const gl = renderer.domElement, CW = gl.width, CH = gl.height;
    const s = document.createElement('canvas'); s.width = CW; s.height = CH;
    const c2 = s.getContext('2d', { willReadFrequently: true });
    const project = (a) => { const v = new THREE.Vector3(a.x, a.y, a.z).project(camera);
      return { sx: (v.x * 0.5 + 0.5) * CW, sy: (-v.y * 0.5 + 0.5) * CH }; };
    const pts = tiles.map(t => ({ t, p: project(nc.plotIconAnchor(t.x, t.z)) }));
    const HW = 70, HH = 50;
    const box = (p) => ({ x0: Math.max(0, Math.round(p.sx - HW)), y0: Math.max(0, Math.round(p.sy - HH)),
                          x1: Math.min(CW, Math.round(p.sx + HW)), y1: Math.min(CH, Math.round(p.sy + HH)) });
    const boxes = pts.map(o => box(o.p));
    let overlap = false;
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (!(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0)) overlap = true;
    }
    /* render -> drawImage -> getImageData, all in THIS task. */
    const shoot = () => { renderer.render(scene, camera);
      c2.clearRect(0, 0, CW, CH); c2.drawImage(gl, 0, 0, CW, CH);
      return c2.getImageData(0, 0, CW, CH).data; };
    const diff = (A, B, b) => { let n = 0, tot = 0, sx = 0, sy = 0;
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
        const i = (y * CW + x) * 4; tot++;
        if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i+1] - B[i+1]) > 6 || Math.abs(A[i+2] - B[i+2]) > 6) { n++; sx += x; sy += y; }
      }
      return { pct: +(100 * n / tot).toFixed(2), n, cx: n ? sx / n : null, cy: n ? sy / n : null }; };

    const range = g.geometry.drawRange.count;
    /* THE RED MUTATION: the layer is present, visible, and draws nothing. */
    if (doBlank) g.geometry.setDrawRange(0, 0);
    g.visible = true;  const A = shoot();
    g.visible = false; const B = shoot();
    g.visible = true;  const C = shoot();      // do-nothing control: A vs C
    if (doBlank) g.geometry.setDrawRange(0, range);

    return { overlap, CW, CH,
      rows: pts.map((o, i) => {
        const d = diff(A, B, boxes[i]);
        const ctl = diff(A, C, boxes[i]);
        return { tile: o.t.x + ',' + o.t.z, kind: o.t.kind, pct: d.pct, n: d.n,
                 ctlPct: ctl.pct,
                 err: d.cx == null ? null : +Math.hypot(d.cx - o.p.sx, d.cy - o.p.sy).toFixed(1),
                 proj: [+o.p.sx.toFixed(1), +o.p.sy.toFixed(1)],
                 cen: d.cx == null ? null : [+d.cx.toFixed(1), +d.cy.toFixed(1)] };
      }) };
  }, [tiles, blank]);
}

const tiles = [ { ...F1, kind: 'flag' }, { ...F2, kind: 'flag' }, { ...F3, kind: 'flag' }, { ...CTL, kind: 'CONTROL' } ];

console.log('\nB/C  PIXEL A/B + WORLD ANCHOR — 3 flagged tiles and 1 control, three framings');
const results = {};
for (const name of Object.keys(CAMS)) {
  const r = await shootFraming(name, CAMS[name], false);
  results[name] = r;
  if (r.overlap) fail('[' + name + '] two crops overlap — the control is not independent');
  console.log('   [' + name + ']  crop 140x100');
  for (const row of r.rows)
    console.log('      ' + (row.kind === 'CONTROL' ? 'CONTROL ' : 'flagged ') + row.tile +
      '  moved ' + row.pct + '% (' + row.n + 'px)  do-nothing ' + row.ctlPct + '%  ' +
      (row.cen ? 'centroid ' + JSON.stringify(row.cen) + ' vs proj ' + JSON.stringify(row.proj) + ' err ' + row.err + 'px' : 'no pixels'));
  for (const row of r.rows) {
    if (row.ctlPct !== 0) fail('[' + name + '] the do-nothing control moved ' + row.ctlPct + '% at ' + row.tile + ' — the instrument is drifting');
    if (row.kind === 'CONTROL') {
      if (row.pct !== 0) fail('[' + name + '] the UNFLAGGED control crop moved ' + row.pct + '% — the layer is painting the sky');
    } else {
      if (row.pct < 5) fail('[' + name + '] flagged ' + row.tile + ' moved only ' + row.pct + '%');
      if (row.err == null || row.err > 8) fail('[' + name + '] ' + row.tile + ' centroid is ' + row.err + 'px off the projected anchor — not world-anchored');
    }
  }
  const flags = r.rows.filter(x => x.kind === 'flag');
  if (flags.every(x => x.pct >= 5) && r.rows.find(x => x.kind === 'CONTROL').pct === 0)
    ok('[' + name + '] all three flagged crops moved (' + flags.map(x => x.pct + '%').join(', ') + '), control exactly 0');
  if (flags.every(x => x.err != null && x.err <= 8))
    ok('[' + name + '] every centroid within ' + Math.max(...flags.map(x => x.err)) + 'px of its projected anchor');
}
/* the badge must MOVE WITH its tile between framings — a HUD would not. */
{
  const a = results.aerial.rows, o = results.orbited.rows;
  for (let i = 0; i < 3; i++) {
    if (!a[i].cen || !o[i].cen) { fail('no badge pixels for ' + a[i].tile + ' — cannot test tracking'); continue; }
    const tileMove = Math.hypot(o[i].proj[0] - a[i].proj[0], o[i].proj[1] - a[i].proj[1]);
    const badgeMove = Math.hypot(o[i].cen[0] - a[i].cen[0], o[i].cen[1] - a[i].cen[1]);
    const d = Math.abs(tileMove - badgeMove);
    console.log('   ' + a[i].tile + ': under the orbit the TILE moved ' + tileMove.toFixed(1) + 'px, the BADGE ' + badgeMove.toFixed(1) + 'px (d ' + d.toFixed(1) + ')');
    if (tileMove < 40) fail('the orbit barely moved tile ' + a[i].tile + ' — the test proves nothing');
    if (d > 10) fail('badge did not track tile ' + a[i].tile + ' (d ' + d.toFixed(1) + 'px)');
  }
  ok('every badge tracked its own tile through the orbit — a HUD moves 0');
}

/* ── D. RED MUTATION ─────────────────────────────────────────────────────── */
console.log('\nD  RED MUTATION — same A/B with the layer forced to draw nothing');
const red = await shootFraming('aerial', CAMS.aerial, true);
for (const row of red.rows)
  console.log('      ' + row.tile + ' moved ' + row.pct + '%');
if (red.rows.some(r => r.pct !== 0)) fail('a blanked layer still moved pixels — the A/B is measuring something else');
else ok('with the layer blanked every crop reads exactly 0 — the positive numbers above are this layer');

/* ── E2. COST AT THE CAP ─────────────────────────────────────────────────── */
console.log('\nE2 COST AT THE 40-BADGE CAP (synthetic verdicts through the module\'s own paint())');
const capped = await page.evaluate(() => {
  const nc = window.__nc, I = window.MythicPlotIcons, { renderer, scene, camera } = nc.three();
  const reasons = ['water','power','road','dark','roadcap','food','health','safety','light','leisure','deathcare','need:food','need:health'];
  const faces = ['bad','meh'];
  const list = [];
  for (let i = 0; i < 60; i++) list.push({ x: i % 24, z: (i * 7) % 24, score: i,
    reason: reasons[i % reasons.length], face: faces[i % 2], fix: 'do a thing' });
  I.paint(list);
  let g = null; scene.traverse(o => { if (!g && o.name === 'mythic-plotmood-icons') g = o; });
  const meshes = () => { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); return n; };
  const read = () => { renderer.render(scene, camera); return { c: renderer.info.render.calls, t: renderer.info.render.triangles, m: meshes() }; };
  g.visible = true; const on = read(); g.visible = false; const off = read(); g.visible = true;
  const cost = I.cost();
  const dr = I.drawn();
  const cm = I.cellMap();
  // decode the live UVs back to a cell index and compare with the claim
  const uv = g.geometry.getAttribute('uv').array;
  const cols = I.tuning.cols, rows = I.tuning.rows;
  const bad = [];
  for (let i = 0; i < dr.length; i++) {
    const u = uv[i * 8], v1 = uv[i * 8 + 1];
    const col = Math.round(u * cols), row = Math.round((1 - v1) * rows);
    const cell = row * cols + col;
    if (cell !== dr[i].cell) bad.push({ at: dr[i].x + ',' + dr[i].z, want: dr[i].cell, got: cell });
  }
  // two DIFFERENT symbols in one cell?
  const byCell = {}; const dupes = [];
  for (const k of Object.keys(cm)) { const c = cm[k]; if (byCell[c] && byCell[c] !== k) dupes.push(c + ': ' + byCell[c] + ' vs ' + k); byCell[c] = k; }
  return { fed: list.length, drawn: dr.length, withheld: I.overflow(), cost,
           dCalls: on.c - off.c, dTris: on.t - off.t, dMeshes: on.m - off.m,
           cells: Object.keys(cm).length, uvBad: bad, dupes,
           anyNaN: dr.some(d => !isFinite(d.score) || d.cell == null || d.glyph == null) };
});
console.log('   fed ' + capped.fed + ' -> drawn ' + capped.drawn + ', withheld ' + capped.withheld +
            ' | cells ' + capped.cells + '/' + capped.cost.cellCapacity +
            ' | dCalls ' + capped.dCalls + ' dTris ' + capped.dTris + ' dMeshes ' + capped.dMeshes);
if (capped.drawn !== 40) fail('cap is 40 but ' + capped.drawn + ' drawn'); else ok('the cap holds at 40');
if (capped.withheld !== 20) fail('withheld reported ' + capped.withheld + ', expected 20'); else ok('withheld count is honest (20)');
if (capped.dCalls !== 1) fail('at 40 badges the layer bills ' + capped.dCalls + ' draw calls'); else ok('40 badges still cost ONE draw call');
if (capped.dTris !== 80) fail('triangle delta ' + capped.dTris + ' at 40 quads (expected 80)'); else ok('80 triangles for 40 quads — no per-tile mesh');
if (capped.dMeshes !== 0) fail('mesh delta ' + capped.dMeshes + ' at the cap');
if (capped.uvBad.length) fail('a quad points at the wrong atlas cell: ' + JSON.stringify(capped.uvBad.slice(0, 5)));
else ok('every one of ' + capped.drawn + ' quads decodes to its own cell');
if (capped.dupes.length) fail('two different symbols share a cell: ' + JSON.stringify(capped.dupes));
else ok('no two symbols share a cell');
if (capped.anyNaN) fail('a drawn badge carries NaN/undefined');
else ok('no NaN / undefined in the drawn set');

/* ── F. NaN SWEEP + legend honesty ───────────────────────────────────────── */
console.log('\nF  NUMBERS');
await page.evaluate(() => window.MythicPlotIcons.sync());
const sweep = await page.evaluate(() => {
  const I = window.MythicPlotIcons;
  const txt = (document.querySelector('#pmlegend') || {}).textContent || '';
  return { legend: I.legend(), cost: I.cost(), stats: window.__nc.plotIcons(),
           legendTxt: txt.replace(/\s+/g, ' ').slice(0, 400),
           badWords: /NaN|undefined|\[object/.test(txt) };
});
const nanish = JSON.stringify(sweep.cost) + JSON.stringify(sweep.stats);
if (/null|NaN/.test(nanish.replace(/"source":"[^"]*"/, ''))) fail('cost/stats carry null or NaN: ' + nanish);
else ok('cost + stats are all finite: ' + JSON.stringify(sweep.cost));
if (sweep.badWords) fail('the on-screen legend prints NaN/undefined/[object: ' + sweep.legendTxt);
else ok('legend prints no NaN/undefined');
console.log('   legend text: ' + sweep.legendTxt.slice(0, 240));
const noLabel = sweep.legend.filter(r => !r.label || r.label === r.id);
if (noLabel.length) fail('legend rows with no human label (raw id printed): ' + JSON.stringify(noLabel.map(r => r.id)));
else ok('all ' + sweep.legend.length + ' legend rows carry a real label');
const noFix = sweep.legend.filter(r => r.id !== 'ok' && r.id !== 'meh' && !r.fix);
if (noFix.length) fail('legend rows with no remedy — the frown is not actionable: ' + JSON.stringify(noFix.map(r => r.id)));
else ok('every problem row names a remedy');

if (errs.length) console.log('\n   page errors: ' + JSON.stringify(errs.slice(0, 5)));

console.log(fails ? '\nFAILED ' + fails : '\nALL CHECKS PASSED');
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
