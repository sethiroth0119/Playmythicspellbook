/* ══════════════════════════════════════════════════════════════════════════
   🙂 DRIVE-MOODICONS — the driven evidence for the plot-mood GLYPH LAYER.

   Boots public/node-city/index.html in real Chromium, serves public/ over
   loopback and fulfils the page's pinned three@0.171.0 import map out of
   .gauntlet/three171 (the box cannot reach a CDN). Then builds ONE deterministic
   scene — a road run, a house ON it and a house nowhere near it — and makes the
   six claims this layer may be judged on:

     1  ONE OBJECT, NOT TWO, AND IT SAYS WHERE ITS VERDICT CAME FROM.
        /src/plotmood/index.js owns the verdict and ships its own THREE.Points
        painter; /src/plotmood/overlay.js takes that painter over through the
        module's own setPainter() seam. The check is that the Points cloud was
        never created — a duplicate layer is harmless at runtime and wrong
        forever after.
     2  IT COSTS ONE DRAW CALL. renderer.info.render.calls and the scene's mesh
        count, layer OFF vs ON, read TOGETHER and BEFORE any capture — the
        interleaving that once reported a layer making the scene cheaper.
     3  THE PIXELS MOVE WHERE THEY SHOULD AND NOWHERE ELSE. The crop above the
        FLAGGED house moves a double-digit % of itself; the crop above the
        UNFLAGGED house moves EXACTLY 0. That control is the piece — without it
        "the frame changed" is not evidence that anything landed on a building.
     4  IT IS IN WORLD SPACE, PROVED NUMERICALLY. The changed pixels' centroid
        lands within a few px of the tile's anchor projected through the LIVE
        camera — and does so AGAIN after the camera is orbited, with the badge
        and the tile having moved on screen by the SAME vector. A HUD overlay
        passes the first half, fails the second, and photographs identically in
        a single still.
     5  IT REACTS TO PLACEMENT, IN THE SAME SESSION. Lay a road beside the
        complaining house through the SHIPPED __nc.place() → tryPlace() path and
        the "no road access" badge is gone on the next read. No reload.
     6  EVERY BADGE IS THE VERDICT MODULE'S, NOT THE RENDERER'S. Each drawn
        badge is compared against MythicPlotMood.moodAt(x, z) — the same record
        the dossier card reads — and every legend row is checked to be printing
        that module's OWN label and fix rather than a copy.

   🔴 THE RENDER-TRAP PROTOCOL (CLAUDE.md, .gauntlet/README.md item 6) IS
      FOLLOWED EXACTLY. `renderer.render()` is called between the two reads and
      `drawImage` happens in the SAME task: preserveDrawingBuffer is off, so by
      the next task the buffer is gone and the read returns the PREVIOUS frame —
      which is how an A/B that flips `.visible` and reads later produces a
      confident, wrong zero. Every shoot below is render → drawImage →
      getImageData with nothing between them, and the do-nothing control (B vs
      Ctl) is printed beside every figure so a run that drifted announces itself
      instead of being quoted.

   Run:  node .gauntlet/drive-moodicons.mjs [--shots]
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const THREE_DIR = path.resolve(process.cwd(), '.gauntlet/three171');
const OUT = process.argv.includes('--shots') ? path.resolve(process.cwd(), '.gauntlet/shots/moodicons') : null;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webp': 'image/webp' };
const PORT = 8760 + (process.pid % 80);

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
    /* FULFIL, never redirect: Playwright refuses to override an https request
       with an http URL, and the page's import map is pinned to the CDN. */
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
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 220)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 220)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(14000);

let fails = 0;
const fail = (m) => { fails++; console.error('  ✗ ' + m); };
const ok = (m) => console.log('  ✓ ' + m);

/* ── THE SCENE, AND HOW THE CONTROL WAS CHOSEN ──────────────────────────────
   A road run at z=17 with a house on it, a house at (10,2) with no road and no
   light, and a lone STREET LIGHT at (10,10) eight tiles from either.

   🔴 THE CONTROL IS THE STREET LIGHT, AND THAT CHOICE IS THE INTERESTING PART.
      The obvious control is "a second house that is doing fine", and on a real
      city that is what it would be. It cannot be built here: index.js scores
      every city NEED per tile (`need:food`, `need:health`, …) and a two-house
      city is short of all of them, so every judged tile is legitimately flagged
      and there is no content house to point at. Two ways out were tried and
      both were rejected —
        · writing game.cov.pct to 1 — it works for one synchronous task and the
          host's own economyTick recomputes it back between two page.evaluate
          calls, so the scene silently changes underneath the measurement;
        · building the six services and a Power Station — the Power Station's
          place path blocks this driver (a confirm the headless page never
          answers), and it would be testing the economy, not the layer.
      A street light is a REAL BUILDING with a REAL MESH that index.js's
      `judged()` filter never scores — verified in the run below, which reports
      `judged 2` with the light standing. So it can never carry a badge, and the
      claim it supports is exactly the one that matters: the layer draws over the
      tile it is talking about AND NOWHERE ELSE. If a single pixel moves above
      the lamp, this layer is painting the sky.
   ⚠ Its crop is 8 tiles from the flagged one and the overlap is asserted, not
     assumed — the first cut of this driver put them 5 tiles apart and the two
     crops overlapped, which would have made the control meaningless while still
     printing a number. */
const FLAG = { x: 10, z: 2 }, CTL = { x: 10, z: 10 };
const built = await page.evaluate(async ([F, C]) => {
  const nc = window.__nc, B = window.MythicCityBridge;
  B.spendCinders = async () => true; B.spendRes = async () => true;
  B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true;
  for (let x = 7; x <= 13; x++) await nc.place('road', x, 17);
  await nc.place('housing', 10, 16);        // a lived-in block, for the frame
  await nc.place('streetlight', C.x, C.z);  // THE CONTROL — a building, never judged
  await nc.place('housing', F.x, F.z);      // THE SUBJECT — no road, no light
  try { nc.build.finishAll(); } catch (e) {}
  await nc.step(2, 4);
  try { window.MythicPlotMood.invalidate('driver'); } catch (e) {}
  return { tiles: Object.keys(nc.game.tiles).length,
           cov: Object.fromEntries(Object.entries(nc.game.cov.pct).map(([k, v]) => [k, +v.toFixed(2)])) };
}, [FLAG, CTL]);

console.log('\n🙂 PLOT MOOD GLYPHS — driven evidence');
console.log('   scene: ' + built.tiles + ' tiles · subject house at ' + FLAG.x + ',' + FLAG.z +
            ' (no road, no light) · CONTROL street light at ' + CTL.x + ',' + CTL.z);
console.log('   coverage the verdict is judged against: ' + JSON.stringify(built.cov) + '\n');

/* ── 1. ONE OBJECT, AND THE VERDICT SOURCE ────────────────────────────────── */
console.log('1  ONE OBJECT IN THE SCENE, AND THE VERDICT IT IS DRAWN FROM');
const one = await page.evaluate(([F, C]) => {
  const nc = window.__nc, { scene } = nc.three();
  nc.plotIconLayer(true);
  const ic = nc.plotIcons();
  const names = [];
  scene.traverse(o => { if (o.name === 'mythic-plotmood-icons' || o.name === 'mythic-plot-mood') names.push(o.name); });
  return { mounted: !!(window.MythicPlotIcons && window.MythicPlotIcons.mounted()),
           visible: window.MythicPlotIcons.visible(),
           source: ic.source, icons: ic.icons, withheld: ic.withheld,
           drawn: ic.drawn, legend: ic.legend, sceneObjects: names,
           verdictReport: window.MythicPlotMood ? window.MythicPlotMood.report() : null,
           verdictVerify: window.MythicPlotMood ? window.MythicPlotMood.verify() : null };
}, [FLAG, CTL]);
console.log('   verdict from : ' + one.source);
console.log('   scene objects: ' + JSON.stringify(one.sceneObjects));
console.log('   drawn        : ' + JSON.stringify(one.drawn));
console.log('   verdict says : judged ' + (one.verdictReport || {}).judged +
            ' · byReason ' + JSON.stringify((one.verdictReport || {}).byReason));
if (!one.mounted || !one.visible) fail('the glyph layer did not mount / did not switch on'); else ok('mounted and visible');
if (one.source !== 'MythicPlotMood') fail('the layer is not reading the verdict module (source=' + one.source + ')');
else ok('verdict source is MythicPlotMood — the layer invents nothing');
if (one.sceneObjects.length !== 1 || one.sceneObjects[0] !== 'mythic-plotmood-icons')
  fail('expected exactly one layer object named mythic-plotmood-icons, got ' + JSON.stringify(one.sceneObjects));
else ok('exactly one layer object in the scene (the Points painter was taken over, not left running)');
if (one.verdictVerify && !one.verdictVerify.ok) fail('the verdict module self-check failed: ' + JSON.stringify(one.verdictVerify.problems));
else ok('verdict module self-check passes');
const flagged = one.drawn.find(d => d.x === FLAG.x && d.z === FLAG.z);
if (!flagged) fail('the house with no road is NOT flagged — there is no subject to photograph');
else ok('flagged tile ' + FLAG.x + ',' + FLAG.z + ' → "' + flagged.reason + '"');
if (one.drawn.some(d => d.x === CTL.x && d.z === CTL.z)) fail('the CONTROL building is flagged — it cannot be a control');
else ok('control building at ' + CTL.x + ',' + CTL.z + ' carries no badge (the verdict never judges it)');

/* ── 6. EVERY BADGE IS THE VERDICT MODULE'S ───────────────────────────────── */
console.log('\n6  EVERY BADGE IS THE VERDICT MODULE\'S, NOT THE RENDERER\'S');
{
  const back = await page.evaluate(() => {
    const M = window.MythicPlotMood, I = window.MythicPlotIcons;
    const rows = I.drawn().map(d => {
      const v = M.moodAt(d.x, d.z);
      return { at: d.x + ',' + d.z, badge: d.reason, verdict: v ? v.reason : null,
               face: v ? v.face : null, badgeMood: d.mood,
               score: v ? v.score : null, fix: v ? v.fix : null };
    });
    /* The legend must print the MODULE's words. Compared string-for-string
       against MythicPlotMood.REASONS rather than against a list in the driver,
       so a copy kept in the renderer fails here. */
    const L = I.legend();
    const legendDrift = L.filter(r => {
      const src = M.REASONS[r.id];
      return !src || src.label !== r.label || src.fix !== r.fix;
    }).map(r => r.id + (M.REASONS[r.id] ? ' (wording)' : ' (no such reason in REASONS)'));
    /* 🔴 THE `need:` PATH, AND IT IS CHECKED BECAUSE IT ONCE FAILED SILENTLY.
       index.js returns `need:health` while its REASONS table is keyed on
       `health`. A renderer that does not strip the prefix draws the fallback
       glyph and prints the raw id — and photographs exactly like a working
       layer. Every DRAWN badge must therefore resolve to a legend row carrying
       the module's own words. */
    const unresolved = I.drawn().map(d => {
      const base = d.reason.indexOf('need:') === 0 ? d.reason.slice(5) : d.reason;
      const row = L.find(r => r.id === base);
      const src = M.REASONS[base];
      return (!row || !src || row.label !== src.label || row.glyph === 'unknown')
        ? { reason: d.reason, base, row: row || null } : null;
    }).filter(Boolean);
    return { rows, legendDrift, unresolved, legendRows: L.length };
  });
  for (const r of back.rows)
    console.log('   ' + r.at + '  badge "' + r.badge + '" (' + r.badgeMood + ')  ← verdict "' +
                r.verdict + '" face=' + r.face + ' score=' + r.score);
  const mismatch = back.rows.filter(r => r.badge !== r.verdict);
  if (mismatch.length) fail('a badge disagrees with the verdict it claims to draw: ' + JSON.stringify(mismatch));
  else ok('every badge names the verdict module\'s own reason id');
  const moodMap = { ok: 'good', meh: 'warn', bad: 'bad' };
  const badMood = back.rows.filter(r => moodMap[r.face] !== r.badgeMood);
  if (badMood.length) fail('a face does not match the verdict\'s own face: ' + JSON.stringify(badMood));
  else ok('every face matches the verdict\'s own face field');
  const noFix = back.rows.filter(r => r.face !== 'ok' && !r.fix);
  if (noFix.length) fail('a frown offers no remedy: ' + JSON.stringify(noFix));
  else ok('every frown carries a remedy — the frown is actionable');
  const nanRow = back.rows.filter(r => r.score == null || !isFinite(r.score));
  if (nanRow.length) fail('a badge has no finite score behind it: ' + JSON.stringify(nanRow));
  else ok('no badge cites undefined / NaN');
  if (back.legendDrift.length) fail('legend rows have drifted from MythicPlotMood.REASONS: ' + JSON.stringify(back.legendDrift));
  else ok('all ' + back.legendRows + ' legend rows print the verdict module\'s own label and fix');
  if (back.unresolved.length) fail('a drawn badge does not resolve to a named legend row (the need: prefix?): ' + JSON.stringify(back.unresolved));
  else ok('every drawn badge resolves to a named glyph and the module\'s own sentence');
}

/* ── 2. COST — ALL READS TOGETHER, BEFORE ANY CAPTURE ─────────────────────── */
console.log('\n2  COST (all three reads taken together, before any capture)');
const cost = await page.evaluate(() => {
  const nc = window.__nc, { renderer, scene, camera } = nc.three();
  let g = null; scene.traverse(o => { if (!g && o.name === 'mythic-plotmood-icons') g = o; });
  if (!g) return { error: 'no scene object named mythic-plotmood-icons' };
  const meshes = () => { let n = 0; scene.traverse(o => { if (o.isMesh) n++; }); return n; };
  const read = () => { renderer.render(scene, camera);
    return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, meshes: meshes() }; };
  g.visible = true;  const on1 = read();
  g.visible = false; const off = read();
  g.visible = true;  const on2 = read();
  return { on1, off, on2, dCalls: on1.calls - off.calls, dTris: on1.tris - off.tris,
           dMeshes: on1.meshes - off.meshes,
           stable: on1.calls === on2.calls && on1.tris === on2.tris,
           module: nc.plotIconCost() };
});
if (cost.error) fail(cost.error);
else {
  console.log('   draw calls   ON ' + cost.on1.calls + '  OFF ' + cost.off.calls + '  Δ ' + cost.dCalls);
  console.log('   triangles    ON ' + cost.on1.tris + '  OFF ' + cost.off.tris + '  Δ ' + cost.dTris);
  console.log('   scene meshes ON ' + cost.on1.meshes + '  OFF ' + cost.off.meshes + '  Δ ' + cost.dMeshes);
  console.log('   module says  : ' + JSON.stringify(cost.module));
  if (!cost.stable) fail('the two ON reads disagree — something is stepping between renders');
  if (cost.dCalls > 2) fail('draw-call delta ' + cost.dCalls + ' > 2'); else ok('draw-call delta ' + cost.dCalls + ' (bar: ≤ 2)');
  if (cost.dMeshes > 2) fail('scene mesh delta ' + cost.dMeshes + ' > 2'); else ok('scene mesh delta ' + cost.dMeshes + ' (bar: ≤ 2)');
  /* 🔴 AND THE DELTA MUST EQUAL WHAT THE MODULE SAYS IT COSTS. The bar of "≤ 2"
     passes happily while the layer is drawn TWICE — which is what was happening:
     8 triangles billed for a 4-triangle layer, because a material that is both
     transparent and DoubleSide takes three's two-pass path unless
     forceSinglePass is set. A cost that is merely under a ceiling is not a cost
     that has been measured; this compares the renderer's own number against the
     module's claim, so the two cannot drift again. */
  if (cost.dCalls !== 1) fail('the layer bills ' + cost.dCalls + ' draw calls for ONE mesh — it is being drawn more than once');
  else ok('exactly ONE draw call for the whole layer, as the header claims');
  if (cost.dTris !== cost.module.triangles)
    fail('renderer billed ' + cost.dTris + ' triangles but the module claims ' + cost.module.triangles);
  else ok('renderer bills exactly the ' + cost.dTris + ' triangles the module claims');
}

/* ── 3 + 4. THE A/B AND THE ANCHOR, PER FRAMING ───────────────────────────── */
/* Two framings of the SAME scene. The second is an ORBIT of the first: a
   world-space badge moves with its tile, a HUD does not move at all. */
const FRAMINGS = {
  aerial:  { cam: [16, 18, 16], tgt: [-1.5, 0.6, -5.5] },
  orbited: { cam: [-17, 14, 13], tgt: [-1.5, 0.6, -5.5] },
};
const ab = {};
for (const name of Object.keys(FRAMINGS)) {
  const f = FRAMINGS[name];
  await page.evaluate(([cam, tgt]) => {
    const nc = window.__nc;
    nc.camera.position.set(cam[0], cam[1], cam[2]);
    nc.controls.target.set(tgt[0], tgt[1], tgt[2]); nc.controls.update();
    nc.camera.position.set(cam[0], cam[1], cam[2]); nc.camera.lookAt(tgt[0], tgt[1], tgt[2]);
    nc.camera.updateMatrixWorld(); nc.camera.updateProjectionMatrix();
    try { nc.cullAgents(90); } catch (e) {}
  }, [f.cam, f.tgt]);
  await page.waitForTimeout(900);          // let anything lazy settle BEFORE the A/B

  ab[name] = await page.evaluate(([F, C]) => {
    const nc = window.__nc, { renderer, scene, camera, THREE } = nc.three();
    let g = null; scene.traverse(o => { if (!g && o.name === 'mythic-plotmood-icons') g = o; });
    const gl = renderer.domElement, CW = gl.width, CH = gl.height;
    const s = document.createElement('canvas'); s.width = CW; s.height = CH;
    const cx2 = s.getContext('2d', { willReadFrequently: true });

    /* THE PROJECTION OF THE ANCHOR through the LIVE camera. Taken from the
       module's own anchorAt(), not from a copy of its arithmetic. */
    const project = (a) => {
      const v = new THREE.Vector3(a.x, a.y, a.z).project(camera);
      return { sx: (v.x * 0.5 + 0.5) * CW, sy: (-v.y * 0.5 + 0.5) * CH };
    };
    const pF = project(nc.plotIconAnchor(F.x, F.z));
    const pC = project(nc.plotIconAnchor(C.x, C.z));

    /* The crop is deliberately TIGHT — 150×104 px centred on the anchor —
       because a generous one dilutes the signal with sky and lets a perfectly
       good badge read as a small percentage. Both crops are the SAME size at
       the SAME offset from their own anchor, so the flagged figure and the
       control figure are directly comparable. */
    const HW = 75, HH = 52;
    const box = (p) => ({ x0: Math.max(0, Math.round(p.sx - HW)), y0: Math.max(0, Math.round(p.sy - HH)),
                          x1: Math.min(CW, Math.round(p.sx + HW)), y1: Math.min(CH, Math.round(p.sy + HH)) });
    const bF = box(pF), bC = box(pC);
    const overlap = !(bF.x1 <= bC.x0 || bC.x1 <= bF.x0 || bF.y1 <= bC.y0 || bC.y1 <= bF.y0);

    /* ⚠ render() then drawImage IN THE SAME TASK. preserveDrawingBuffer is off,
       so by the next task the buffer is gone and this returns the PREVIOUS
       frame — a dead instrument that reports a confident 0.00 %. */
    const shoot = () => { renderer.render(scene, camera);
      cx2.clearRect(0, 0, CW, CH); cx2.drawImage(gl, 0, 0, CW, CH);
      return cx2.getImageData(0, 0, CW, CH).data; };

    const diff = (A, B, b) => {
      let n = 0, tot = 0, sx = 0, sy = 0;
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) {
        const i = (y * CW + x) * 4; tot++;
        if (Math.abs(A[i] - B[i]) > 6 || Math.abs(A[i + 1] - B[i + 1]) > 6 || Math.abs(A[i + 2] - B[i + 2]) > 6) { n++; sx += x; sy += y; }
      }
      return { pct: +(100 * n / Math.max(1, tot)).toFixed(2), n, cx: n ? sx / n : null, cy: n ? sy / n : null };
    };

    g.visible = true;  const A = shoot();
    g.visible = false; const B = shoot();
    const Ctl = shoot();                    // the do-nothing control: B vs Ctl MUST be 0
    g.visible = true;

    const dF = diff(A, B, bF), dC = diff(A, B, bC);
    const nF = diff(B, Ctl, bF), nC = diff(B, Ctl, bC);
    return { canvas: [CW, CH], overlap,
      anchorFlagPx: [+pF.sx.toFixed(1), +pF.sy.toFixed(1)],
      anchorCtlPx: [+pC.sx.toFixed(1), +pC.sy.toFixed(1)],
      flagged: dF, control: dC, nullFlag: nF, nullCtl: nC,
      centroidErrPx: dF.cx == null ? null : +Math.hypot(dF.cx - pF.sx, dF.cy - pF.sy).toFixed(1),
      centroidPx: dF.cx == null ? null : [+dF.cx.toFixed(1), +dF.cy.toFixed(1)],
      cropPx: [(bF.x1 - bF.x0), (bF.y1 - bF.y0)] };
  }, [FLAG, CTL]);

  if (OUT) {
    fs.mkdirSync(OUT, { recursive: true });
    for (const [tag, vis] of [['on', true], ['off', false]]) {
      await page.evaluate((v) => { const { renderer, scene, camera } = window.__nc.three();
        scene.traverse(o => { if (o.name === 'mythic-plotmood-icons') o.visible = v; });
        renderer.render(scene, camera); }, vis);
      await page.screenshot({ path: path.join(OUT, 'moodicons-' + name + '-' + tag + '.png') });
    }
    await page.evaluate(() => { const { scene } = window.__nc.three();
      scene.traverse(o => { if (o.name === 'mythic-plotmood-icons') o.visible = true; }); });
  }
}

console.log('\n3  PIXEL A/B — layer ON vs OFF, render() between the reads, drawImage in the same task');
for (const name of Object.keys(ab)) {
  const r = ab[name];
  console.log('   [' + name + '] crop ' + r.cropPx[0] + '×' + r.cropPx[1] + ' px' + (r.overlap ? '  ⚠ CROPS OVERLAP' : ''));
  console.log('      above the FLAGGED house : ' + r.flagged.pct + ' %   (' + r.flagged.n + ' px)');
  console.log('      above the CONTROL house : ' + r.control.pct + ' %   (' + r.control.n + ' px)   ← must be exactly 0');
  console.log('      do-nothing control      : ' + r.nullFlag.pct + ' % / ' + r.nullCtl.pct + ' %  ← must both be 0');
  if (r.overlap) fail('[' + name + '] the two crops overlap — the control is not independent');
  if (r.flagged.pct < 10) fail('[' + name + '] the flagged crop moved ' + r.flagged.pct + ' % (bar: double digits)');
  else ok('[' + name + '] flagged crop moved ' + r.flagged.pct + ' %');
  if (r.control.pct !== 0) fail('[' + name + '] THE CONTROL CROP MOVED ' + r.control.pct + ' % — it must be exactly 0');
  else ok('[' + name + '] control crop moved exactly 0');
  if (r.nullFlag.pct !== 0 || r.nullCtl.pct !== 0)
    fail('[' + name + '] the do-nothing control is not zero — something stepped between two synchronous renders (README §6). The figures above are NOT a measurement until that is found.');
}

console.log('\n4  WORLD-SPACE ANCHORING, PROVED NUMERICALLY');
for (const name of Object.keys(ab)) {
  const r = ab[name];
  console.log('   [' + name + '] tile anchor projected → ' + JSON.stringify(r.anchorFlagPx) +
              '   badge centroid → ' + JSON.stringify(r.centroidPx) + '   error ' + r.centroidErrPx + ' px');
  if (r.centroidErrPx == null) fail('[' + name + '] no changed pixels to take a centroid from');
  else if (r.centroidErrPx > 12) fail('[' + name + '] centroid is ' + r.centroidErrPx + ' px off the projected anchor');
  else ok('[' + name + '] centroid within ' + r.centroidErrPx + ' px of the projected tile anchor');
}
{
  const a = ab.aerial, b = ab.orbited;
  const anchorMoved = Math.hypot(b.anchorFlagPx[0] - a.anchorFlagPx[0], b.anchorFlagPx[1] - a.anchorFlagPx[1]);
  const badgeMoved = (a.centroidPx && b.centroidPx)
    ? Math.hypot(b.centroidPx[0] - a.centroidPx[0], b.centroidPx[1] - a.centroidPx[1]) : null;
  console.log('   under the orbit: the TILE moved ' + anchorMoved.toFixed(1) +
              ' px on screen, the BADGE moved ' + (badgeMoved == null ? '?' : badgeMoved.toFixed(1)) + ' px');
  if (anchorMoved < 60) fail('the orbit barely moved the tile — this framing pair cannot separate world space from a HUD');
  else if (badgeMoved == null) fail('no badge centroid in one of the framings');
  else if (Math.abs(badgeMoved - anchorMoved) > 14)
    fail('the badge and its tile moved by different amounts (' + badgeMoved.toFixed(1) + ' vs ' + anchorMoved.toFixed(1) + ' px)');
  else ok('the badge tracked its tile through the orbit (Δ ' + Math.abs(badgeMoved - anchorMoved).toFixed(1) + ' px) — a HUD would have moved 0');
}

/* ── 5. IT REACTS TO PLACEMENT ────────────────────────────────────────────── */
console.log('\n5  IT REACTS TO PLACEMENT, IN THE SAME SESSION');
const react = await page.evaluate(async ([F]) => {
  const nc = window.__nc, I = window.MythicPlotIcons;
  const before = I.drawn().filter(d => d.x === F.x && d.z === F.z).map(d => d.reason);
  /* The SHIPPED path: placeType + tryPlace, which is what the toolbar does. The
     invalidate + re-sync hooks ride inside tryPlace, so nothing test-only is
     being driven here. */
  await nc.place('road', F.x, F.z + 1);
  const after = I.drawn().filter(d => d.x === F.x && d.z === F.z).map(d => d.reason);
  return { before, after, all: I.drawn() };
}, [FLAG]);
console.log('   before the road : ' + JSON.stringify(react.before));
console.log('   after  the road : ' + JSON.stringify(react.after));
if (!react.before.includes('road')) fail('the house was not complaining about a road to begin with');
else if (react.after.includes('road')) fail('the "no road access" badge survived a road being laid beside it');
else ok('laying a road cleared the badge in the same frame as the placement');

/* ── 7. THE ATLAS TELLS THE TRUTH AT FULL LOAD ────────────────────────────────
   🔴 THIS CHECK EXISTS BECAUSE THE LAYER FAILED IT. The atlas was 4×4 = 16
      cells, sized by counting the reason CATALOGUE rather than what a city
      presents at once, and cells were keyed on `mood|reasonId`. A city short of
      all eight NEEDS while some plot is also off the mains is 13 ids at ONE
      mood, and anything mixed in severity ran past 16 at once. Past the cap the
      lookup was undefined and an `|| 0` sent the quad to cell 0: the badge over
      the unpowered block drew whatever symbol cell 0 happened to hold, with a
      correct-looking legend beside it. Nothing above catches that — the two
      houses in this scene need two cells — so the layer is loaded here to the
      density a real city reaches, and the geometry is read back rather than
      believed: every quad's UV is decoded to a cell index and compared against
      the cell the module says holds THAT badge's own symbol.
   ⚠ Driven through the SHIPPED painter seam (`MythicPlotIcons.paint`), which is
     the exact function index.js calls, with records shaped like index.js's own.
     The real verdict is put back afterwards. */
console.log('\n7  THE ATLAS AT FULL LOAD — every quad points at its OWN symbol');
const atlas = await page.evaluate(() => {
  const I = window.MythicPlotIcons, M = window.MythicPlotMood;
  const ids = ['water', 'power', 'road', 'dark', 'roadcap', 'ok', 'meh', 'wibble',
    'need:food', 'need:water', 'need:power', 'need:safety',
    'need:light', 'need:health', 'need:leisure', 'need:deathcare'];
  const list = [];
  let i = 0;
  for (const id of ids) for (const face of ['bad', 'meh']) {
    const x = (i % 12) * 2, z = Math.floor(i / 12) * 2 + 1; i++;
    list.push({ k: x + ',' + z, x, z, reason: id, face, score: face === 'bad' ? 0.1 : 0.5,
                label: id, fix: 'x' });
  }
  I.paint(list);

  const drawn = I.drawn(), map = I.cellMap(), cost = I.cost();
  const g = I.mesh().geometry, uv = g.attributes.uv.array;
  const T = I.tuning;
  /* UV → cell index, the inverse of rebuild()'s own mapping. Canvas rows run
     top-down and UV rows bottom-up; getting this backwards here would make a
     correct layer look broken, so it is the same arithmetic read backwards. */
  const cellFromUV = (n) => {
    const cx = uv[n * 8], v1 = uv[n * 8 + 1];
    const col = Math.round(cx * T.cols), row = Math.round((1 - v1) * T.rows);
    return row * T.cols + col;
  };
  const rows = drawn.map((d, n) => ({
    at: d.x + ',' + d.z, reason: d.reason, mood: d.mood, glyph: d.glyph,
    cellSaid: d.cell, cellUV: cellFromUV(n),
    cellExpected: map[d.mood + '|' + d.glyph],
  }));
  /* What the OLD key would have demanded, printed so the regression is a number
     rather than a story: distinct mood|reasonId pairs vs distinct mood|shape. */
  const byId = {}, byShape = {};
  for (const d of drawn) { byId[d.mood + '|' + d.reason] = 1; byShape[d.mood + '|' + d.glyph] = 1; }

  /* Two badges may share a cell ONLY if they draw the same picture. */
  const owner = {}, collide = [];
  for (const r of rows) {
    const sig = r.mood + '|' + r.glyph;
    if (owner[r.cellUV] && owner[r.cellUV] !== sig) collide.push(r.cellUV + ': ' + owner[r.cellUV] + ' vs ' + sig);
    owner[r.cellUV] = sig;
  }
  const restore = () => { try { M.repaint(true); } catch (e) {} };
  const out = { rows, collide, cost, withheld: I.overflow(),
                keysById: Object.keys(byId).length, keysByShape: Object.keys(byShape).length,
                fed: list.length, drawnN: drawn.length };
  restore();
  return out;
});
console.log('   fed ' + atlas.fed + ' verdicts → ' + atlas.drawnN + ' badges drawn, ' + atlas.withheld + ' withheld');
console.log('   distinct symbols needed: ' + atlas.keysByShape + ' cells  (the old mood|reasonId key would have wanted ' +
            atlas.keysById + ')  ·  sheet holds ' + atlas.cost.cellCapacity);
console.log('   module reports cells: ' + atlas.cost.cells + ' · meshes ' + atlas.cost.meshes +
            ' · textures ' + atlas.cost.textures);
const noCell = atlas.rows.filter(r => r.cellSaid == null || r.cellExpected == null);
const wrongCell = atlas.rows.filter(r => r.cellUV !== r.cellExpected);
if (atlas.keysByShape <= 16)
  fail('this load did not exceed the old 16-cell sheet (' + atlas.keysByShape + ') — the check proves nothing');
else ok('loaded to ' + atlas.keysByShape + ' distinct symbols — past the 16 the old sheet held');
if (atlas.cost.cells > atlas.cost.cellCapacity) fail('the atlas is over its own capacity');
else ok('all ' + atlas.cost.cells + ' cells fit the sheet (capacity ' + atlas.cost.cellCapacity + ')');
if (noCell.length) fail('a drawn badge has no atlas cell: ' + JSON.stringify(noCell.slice(0, 4)));
else ok('every drawn badge owns a cell — none fell through to cell 0');
if (wrongCell.length) fail('a quad points at the wrong cell (the UV read back from the geometry disagrees): ' +
  JSON.stringify(wrongCell.slice(0, 4)));
else ok('all ' + atlas.rows.length + ' quads decode to the cell holding their own symbol');
if (atlas.collide.length) fail('two DIFFERENT symbols share one cell: ' + JSON.stringify(atlas.collide.slice(0, 4)));
else ok('no two different symbols share a cell');
if (atlas.cost.meshes !== 1 || atlas.cost.textures !== 1)
  fail('the full-load layer is no longer one mesh and one texture');
else ok('still ONE mesh and ONE texture at ' + atlas.drawnN + ' badges');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL CHECKS PASSED'));
const noisy = logs.filter(l => /pageerror|PlotMood/.test(l));
if (noisy.length) console.log('logs: ' + JSON.stringify(noisy.slice(-6), null, 1));
await browser.close(); server.close();
process.exit(fails ? 1 : 0);
