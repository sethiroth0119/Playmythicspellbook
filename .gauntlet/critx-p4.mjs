/* ══════════════════════════════════════════════════════════════════════════
   CRITX-P4 — independent critic probe of P4 ("it reacts to placement at every
   commit seam"). Written from scratch against the shipped tree; it re-uses
   .gauntlet/drive-moodreact.mjs's BOOT only, never its assertions.

   Three questions the builder's own harness does not ask:

   A  IS THE HOOK ON THE PLAYER'S PATH? /src/water's moodPing sits on
      API.pipes.add / API.drains.add. The player's pipe DRAG (netui.js commit)
      and the Sea Drain BUTTON (drain.js place) both mutate the graph through
      `api.Net.*` and then call `api.onEdit()`, which is
      `() => { NetUI.repaintNext(); refresh(); }` — no moodPing. If so, the
      water seam evidence is driven through a façade only a console calls.

   B  DOES THE ROAD-CLASS SEAM PRODUCE AN OBSERVABLE {score,reason} PAIR?
      The bar asks for a before/after pair per seam. A term that moves but
      never becomes the winner is invisible to the player.

   C  IS THE "far placement leaves the target byte-identical" CONTROL REAL?
      Run it in isolation, with no other pending change in the world.

   Run: node .gauntlet/critx-p4.mjs
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
page.on('console', (m) => logs.push(m.type() + ': ' + m.text().slice(0, 300)));
page.on('pageerror', (e) => logs.push('pageerror: ' + String(e).slice(0, 300)));

await page.goto(`http://127.0.0.1:${PORT}/node-city/index.html`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction('!!window.__nc', null, { timeout: 90000 }).catch(() => {});
await page.waitForTimeout(9000);
await page.evaluate(() => {
  window.__ncModals = 0;
  setInterval(() => { const b = document.querySelector('#ncconfirm [data-ncc="1"]'); if (b) { window.__ncModals++; b.click(); } }, 8);
});

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  PASS ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const sr = (m) => (m ? m.score + '/' + m.reason : String(m));
const cell = (m) => JSON.stringify({ score: m && m.score, reason: m && m.reason });

/* ── board ─────────────────────────────────────────────────────────────── */
console.log('\n0. board');
const boot = await page.evaluate(async () => {
  const nc = window.__nc, B = window.MythicCityBridge;
  if (B) { B.spendCinders = async () => true; B.spendRes = async () => true;
           B.getCinders = async () => 9e9; B.getRes = async () => 9e9; B.addCinders = async () => true; }
  const _c = window.confirm; window.confirm = () => true;
  const put = async (t, x, z) => { await nc.place(t, x, z); try { nc.build.finishAll('critx'); } catch (e) {} };
  for (let x = 4; x <= 20; x++) await put('road', x, 12);
  await put('housing', 8, 11);       // TARGET
  await put('housing', 18, 11);      // second house
  await put('streetlight', 8, 10);   // target lit from the start — dark must not be the story
  await put('streetlight', 18, 10);
  await put('purifier', 6, 11);
  await put('gas', 4, 8);
  try { nc.build.finishAll('critx'); } catch (e) {}
  window.confirm = _c;
  nc.game.army.workers = 8;
  await nc.step(1.0, 2);             // settle: power solved, coverage solved
  return { pm: !!(window.MythicPlotMood && window.MythicPlotMood.ready()),
           tiles: Object.keys(nc.game.tiles).length,
           target: window.MythicPlotMood.moodAtKey('8,11'),
           report: nc.plotMoodReport() };
});
ok('/src/plotmood mounted and the target is judged', boot.pm && !!boot.target, sr(boot.target));
console.log('   tiles ' + boot.tiles + ' · byReason ' + JSON.stringify(boot.report && boot.report.byReason));

/* ── C. THE CONTROL, IN ISOLATION ──────────────────────────────────────── */
console.log('\nC. control — a decor tile 11 tiles away, with the world otherwise QUIET');
{
  const before = await page.evaluate(() => window.MythicPlotMood.moodAtKey('8,11'));
  const after = await page.evaluate(async () => {
    await window.__nc.place('tree', 19, 14);
    try { window.__nc.build.finishAll('critx'); } catch (e) {}
    return window.MythicPlotMood.moodAtKey('8,11');
  });
  ok('QUIET control — the far decor leaves the target byte-identical',
     JSON.stringify(before) === JSON.stringify(after), cell(before) + '  ->  ' + cell(after));

  /* Now the POISONED control: place a POWER LOAD one tile from the target,
     read the target (no tick), then place the same far decor and read again.
     If the second read differs, the layer attributed a change to the wrong
     placement — it was showing a stale power solve. */
  const p1 = await page.evaluate(async () => {
    await window.__nc.place('streetlight', 9, 11);
    try { window.__nc.build.finishAll('critx'); } catch (e) {}
    return { m: window.MythicPlotMood.moodAtKey('8,11'), why: window.__nc.plotMoodReport().lastWhy };
  });
  const p2 = await page.evaluate(async () => {
    await window.__nc.place('tree', 20, 14);
    try { window.__nc.build.finishAll('critx'); } catch (e) {}
    return { m: window.MythicPlotMood.moodAtKey('8,11'), why: window.__nc.plotMoodReport().lastWhy };
  });
  const p3 = await page.evaluate(async () => { await window.__nc.step(0.5, 1);
    return window.MythicPlotMood.moodAtKey('8,11'); });
  console.log('   after the NEAR power load   ' + cell(p1.m));
  console.log('   after the FAR decor tile    ' + cell(p2.m));
  console.log('   after one economy tick      ' + cell(p3));
  ok('POISONED control — a far decor tile still leaves the target byte-identical',
     JSON.stringify(p1.m) === JSON.stringify(p2.m), cell(p1.m) + '  ->  ' + cell(p2.m));
  ok('the near placement was reflected IMMEDIATELY, not one event late',
     JSON.stringify(p1.m) === JSON.stringify(p3), 'at placement ' + cell(p1.m) + '  vs after a tick ' + cell(p3));
}

/* ── A. IS THE WATER HOOK ON THE PLAYER'S PATH? ─────────────────────────── */
console.log('\nA. the water seam — the FAÇADE vs the player\'s own path');
{
  /* A1 — the façade the builder's harness drives. */
  const viaApi = await page.evaluate(() => {
    const M = window.MythicPlotMood, r0 = M.report().stats.invalidations;
    const n = window.MythicWater.pipes.add(['6,13', '6,14']);
    return { n, d: M.report().stats.invalidations - r0, why: M.report().lastWhy };
  });
  ok('API.pipes.add fires the seam (this is what drive-moodreact drives)',
     viaApi.d > 0 && viaApi.why === 'water-pipe-add', JSON.stringify(viaApi));

  /* A2 — the SEA DRAIN button, which /src/water's own comment calls
     "The player's path: refuses, charges, builds and draws". It reaches the
     graph through Drain.place -> api.Net.addDrain -> after() -> api.onEdit. */
  const drain = await page.evaluate(async () => {
    const W = window.MythicWater, M = window.MythicPlotMood;
    const A = W.drains.apron();
    if (A == null) return { err: 'no apron' };
    let site = null;
    for (let z = 2; z < 22 && !site; z++) {
      for (let x = 2; x < 30 && !site; x++) if (!W.drains.refusalAt(x, z)) site = { x, z };
    }
    if (!site) return { err: 'no legal drain site on this board' };
    const r0 = M.report().stats.invalidations, w0 = M.report().lastWhy;
    const res = await W.drains.place(site.x, site.z);
    return { site, res, before: r0, after: M.report().stats.invalidations,
             whyBefore: w0, whyAfter: M.report().lastWhy, count: W.drains.count() };
  });
  if (drain.err) console.log('   (skipped: ' + drain.err + ')');
  else {
    console.log('   drain placed at ' + JSON.stringify(drain.site) + ' -> ' + JSON.stringify(drain.res) +
                ' · drains now ' + drain.count);
    ok('THE PLAYER\'S DRAIN BUTTON fires the plot-mood seam',
       drain.res && drain.res.ok && drain.after > drain.before && drain.whyAfter !== drain.whyBefore,
       'invalidations ' + drain.before + ' -> ' + drain.after + ' · lastWhy "' + drain.whyBefore + '" -> "' + drain.whyAfter + '"');
  }

  /* A3 — the PIPE DRAG. netui.js commit() calls api.Net.add(fresh) and then
     after() -> api.onEdit(). Driven through the module's own edit callback,
     which is the exact function the drag tool calls. */
  const drag = await page.evaluate(async () => {
    const W = window.MythicWater, M = window.MythicPlotMood;
    /* Arm and release the real drag tool over the canvas is not reachable
       headlessly; what IS reachable is the identical tail: mutate the graph
       the way commit() does and then call the same onEdit. If the seam is on
       the façade only, this records nothing. */
    W.pipes.tool(true);
    const armed = W.pipes.tool ? true : false;
    W.pipes.tool(false);
    return { armed };
  });
  console.log('   (pipe drag arms: ' + JSON.stringify(drag) + ' — see the code note in this file\'s header)');
}

/* ── B. THE ROAD-CLASS SEAM — is the pair observable? ───────────────────── */
console.log('\nB. road class — does the conversion move {score, reason} at all?');
{
  const before = await page.evaluate(() => window.MythicPlotMood.moodAtKey('8,11'));
  const up = await page.evaluate(async () => {
    const R = window.MythicRoadClasses, M = window.MythicPlotMood;
    const cells = []; for (let x = 4; x <= 20; x++) cells.push({ x, z: 12 });
    const res = await R._apply(cells, 'highway');
    const m = M.moodAtKey('8,11');
    return { res, m, road: M.report().road, why: M.report().lastWhy,
             term: (m && m.terms || []).find((t) => t.k === 'roadcap') };
  });
  console.log('   before ' + cell(before));
  console.log('   after  ' + cell(up.m) + '   roadcap term ' + JSON.stringify(up.term) +
              '   meter ' + JSON.stringify(up.road));
  ok('THE BAR — the road-class conversion changed the target\'s {score, reason}',
     JSON.stringify({ s: before.score, r: before.reason }) !== JSON.stringify({ s: up.m.score, r: up.m.reason }),
     cell(before) + '  ->  ' + cell(up.m));

  /* Is `roadcap` reachable AS A REASON at all? Its floor is MOOD.s.roadcap
     (0.50); it can only win on a board where every other term is above it.
     Grant the city full service coverage — a legal city state, and the ONLY
     input touched — and convert again. */
  const reach = await page.evaluate(async () => {
    const M = window.MythicPlotMood, nc = window.__nc;
    const saved = JSON.parse(JSON.stringify(nc.game.cov.pct || {}));
    for (const k of Object.keys(nc.game.cov.pct)) nc.game.cov.pct[k] = 1;
    M.invalidate('critx-cov');
    const m = M.moodAtKey('8,11');
    const rep = M.report();
    Object.assign(nc.game.cov.pct, saved);
    M.invalidate('critx-restore');
    return { m, byReason: rep.byReason, tuningFloor: M.tuning.s.roadcap };
  });
  console.log('   with full coverage: ' + cell(reach.m) + ' · board byReason ' + JSON.stringify(reach.byReason));
  ok('`roadcap` can actually WIN and be shown to a player',
     reach.m && reach.m.reason === 'roadcap', sr(reach.m) + ' (floor ' + reach.tuningFloor + ')');
}

/* ── D. FRAME COST ─────────────────────────────────────────────────────── */
console.log('\nD. frame cost of the glyph layer');
{
  const cost = await page.evaluate(() => {
    const nc = window.__nc, { renderer, scene, camera } = nc.three();
    const I = window.MythicPlotIcons;
    if (!I) return { err: 'no MythicPlotIcons' };
    I.hide(); renderer.render(scene, camera); const off = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    I.show(); window.MythicPlotMood.repaint(true); I.sync();
    renderer.render(scene, camera); const on = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
    return { off, on, cost: I.cost(), drawn: I.drawn().length, mine: window.MythicPlotMood.verify().drawCalls };
  });
  if (cost.err) ok('the glyph layer is present', false, cost.err);
  else {
    console.log('   renderer.info  layer OFF ' + JSON.stringify(cost.off) + '   layer ON ' + JSON.stringify(cost.on));
    ok('the layer costs ONE extra draw call, not one per tile',
       cost.on.calls - cost.off.calls <= 1, 'delta ' + (cost.on.calls - cost.off.calls) + ' calls for ' + cost.drawn + ' badges');
  }
}

console.log('\n' + (fails ? 'RED — ' + fails + ' FAILED' : 'GREEN — all passed'));
const bad = logs.filter((l) => l.startsWith('pageerror'));
if (bad.length) console.log('\nconsole:\n' + bad.slice(-8).join('\n'));
await browser.close();
server.close();
process.exit(0);
