/* ══════════════════════════════════════════════════════════════════════════
   🚛 DRIVE-OPS-TRANSPORT — does the Transport Depot OPERATION behave like the
   Supply Depot it is a twin of: truck traffic out of it, and freight capacity
   under it?

   THE BUG CLASS THIS PINS is the one node-city has now named by number seven
   times: a bare tile-type comparison that matches the STANDING tile and
   silently misses its `op_` twin. `op_transport` is the fifth building to join
   TRUCK_STOPS' blind spot (see the list's header at node-city:6587) and the
   second to join ecoLogisticsCounts'. Both are fixed by TABLE ROWS —
   WEATHER_TWIN_OPS.transport and ECO_LOGISTICS_OPS.transport — and a table row
   is exactly the kind of fix a later refactor deletes without noticing, because
   nothing in the file stops compiling when it goes. This driver is what stops
   it: it drives the SHIPPED functions through the __nc agent seam, in a real
   page, and goes red the moment either row is dropped.

   WHAT IT PROVES, in this order:
     1. the twin resolves — twinTileType('op_transport') === 'depot' and
        isTruckStop('op_transport') is true.
        🔴 THE CONTROL: an op with no freight twin (op_bank) is still false, so
        (1) is evidence about this row and not about a predicate that says yes
        to anything beginning `op_`.
     2. freight capacity — a city whose ONLY logistics building is one
        op_transport tile reports ecoLogisticsCounts().depot > 0, and the same
        city with the tile removed reports 0.
     3. truck sources — desiredAgentCounts() counts op_transport tiles as truck
        sources (four of them ask for four trucks, against a floor of one), so
        `truckSrc > 0` from ops alone.
     4. the spawn — manageAgents()/agentTick() actually put trucks on the road,
        and every one of them starts on a road tile ADJACENT TO AN OP_TRANSPORT
        TILE. That last clause is what separates "trucks exist" from "trucks
        come from the depot": agentEndpoints('truck') falls back to the whole
        road network when it finds fewer than two stops, so a driver that only
        counted trucks would pass with the twin row deleted.

   ⚠ THE CITY IS REPLACED, NOT ADDED TO. game.tiles and game.anchors are swapped
     for a hand-built grid (and restored after) because clause 2 says "only an
     op_transport tile" and clause 4 says "from an op_transport tile" — an
     anchor-adjacent road is a truck endpoint too (roadsAdjacentToAnchors), so a
     boot city's anchors would make clause 4 unfalsifiable.
   ⚠ wx.type is pinned to 'clear'. desiredAgentCounts() HALVES the truck count in
     severe weather, so a driver that let the live weather stand would fail
     roughly one run in five for a reason that is not the thing under test.

   Run:  node .gauntlet/drive-ops-transport.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };
const P = 8560 + (process.pid % 40);
const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'Content-Type': M[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(r);
});
await new Promise(r => srv.listen(P, '127.0.0.1', r));

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const pg = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs = []; pg.on('pageerror', e => errs.push(String(e).slice(0, 180)));
await pg.route('**/*', (r) => {
  const u = r.request().url();
  if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue();
  return r.abort();
});
await pg.goto('http://127.0.0.1:' + P + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
await pg.waitForFunction('!!(window.__nc && window.__nc.game)', null, { timeout: 180000 }).catch(() => {});
await pg.waitForTimeout(9000);

const out = await pg.evaluate(() => {
  const nc = window.__nc || {};
  const o = {};
  o.reachable = !!(nc.game && nc.truckStop && nc.twinTile && nc.counts && nc.manageAgents && nc.agentTick && nc.eco);
  if (!o.reachable) { o.why = 'the __nc agent/eco seams are not exposed'; return o; }

  const B = nc.BUILDINGS || null;
  o.opBuildingExists = !!(B && B.op_transport);

  /* ── 1 · the twin, and the control ─────────────────────────────────────── */
  o.twin          = nc.twinTile('op_transport');
  o.isTruckStop   = nc.truckStop('op_transport');
  o.standingDepot = nc.truckStop('depot');          // the twin it inherits from
  o.ctrlOpBank    = nc.truckStop('op_bank');        // CONTROL: an op with no freight twin
  o.ctrlHousing   = nc.truckStop('housing');        // CONTROL: a standing tile that is not one

  /* ── the hand-built city ───────────────────────────────────────────────── */
  const g = nc.game;
  const keptTiles = g.tiles, keptAnchors = g.anchors;
  const wx = nc.eco.wx, keptWx = wx && wx.type;
  if (wx) wx.type = 'clear';
  const tiles = {};
  g.tiles = tiles; g.anchors = [];
  const put = (x, z, type, lvl) => { tiles[x + ',' + z] = { type, lvl: lvl || 1, rot: 0, born: 0, spent: 0, earn: 0 }; };
  // A straight carriageway, and four op_transport tiles hanging off its east side.
  for (let z = 10; z <= 22; z++) put(10, z, 'road');
  const OPK = ['11,11', '11,14', '11,17', '11,20'];
  for (const k of OPK) { const p = k.split(',').map(Number); put(p[0], p[1], 'op_transport'); }

  try {
    /* ── 2 · freight capacity ────────────────────────────────────────────── */
    o.depotWithOps = nc.eco.host().logisticsCounts.depot;
    for (const k of OPK) delete tiles[k];
    o.depotWithout = nc.eco.host().logisticsCounts.depot;   // CONTROL
    for (const k of OPK) { const p = k.split(',').map(Number); put(p[0], p[1], 'op_transport'); }

    /* ── 3 · truck sources ───────────────────────────────────────────────── */
    o.trucksWithOps = nc.counts().truck;
    for (const k of OPK) delete tiles[k];
    o.trucksWithout = nc.counts().truck;                    // CONTROL: the ambient floor
    for (const k of OPK) { const p = k.split(',').map(Number); put(p[0], p[1], 'op_transport'); }

    /* ── 4 · the spawn ───────────────────────────────────────────────────── */
    // Endpoints first: `from` must be the roads beside the op tiles, nothing else.
    const ep = nc.endpoints('truck');
    const wantRoads = new Set(['10,11', '10,14', '10,17', '10,20']);
    o.endpointCount = ep.from.length;
    o.endpointsAreDepotRoads = ep.from.length === wantRoads.size && ep.from.every(k => wantRoads.has(k));

    for (const a of nc.agents().slice()) nc.despawnAgent(a);   // start from an empty road
    nc.manageAgents();
    for (let i = 0; i < 20; i++) nc.agentTick(0.05);
    const trucks = nc.agents().filter(a => a.kind === 'truck');
    o.trucksOnRoad = trucks.length;
    // Every truck's path must START on a road beside an op_transport tile — that
    // is what "spawns FROM an op_transport tile" means, and it is the clause the
    // whole-network fallback would quietly fail.
    o.trucksFromDepot = trucks.filter(a => a.path && wantRoads.has(a.path[0])).length;
    o.trucksMoved = trucks.filter(a => a.i > 0 || a.t > 0).length;
  } finally {
    g.tiles = keptTiles; g.anchors = keptAnchors;
    if (wx && keptWx) wx.type = keptWx;
    try { nc.manageAgents(); } catch (e) {}
  }
  return o;
});

const bad = [];
const need = (k, ok) => { if (!ok) bad.push(k); };
if (!out.reachable) bad.push(out.why || 'not reachable');
else {
  need('BUILDINGS carries an op_transport row', out.opBuildingExists === true);
  need('twinTileType(op_transport) === depot', out.twin === 'depot');
  need('isTruckStop(op_transport) is true', out.isTruckStop === true);
  need('…and its standing twin still is', out.standingDepot === true);
  need('CONTROL: an op with no freight twin is false', out.ctrlOpBank === false);
  need('CONTROL: a non-freight standing tile is false', out.ctrlHousing === false);
  need('a sited depot adds freight capacity', out.depotWithOps > 0);
  need('…one unit per op tile', out.depotWithOps === 4);
  need('CONTROL: no op tiles → no depot capacity', out.depotWithout === 0);
  need('op_transport counts as a truck source', out.trucksWithOps === 4);
  need('CONTROL: without them only the ambient floor', out.trucksWithout === 1);
  need('truck endpoints are the depot roads only', out.endpointsAreDepotRoads === true);
  need('agentTick put trucks on the road', out.trucksOnRoad > 0);
  need('…and every one started at an op_transport tile', out.trucksOnRoad > 0 && out.trucksFromDepot === out.trucksOnRoad);
  need('…and they are actually driving', out.trucksMoved > 0);
  need('no page errors', errs.length === 0);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 5) }, null, 2));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ')
                       : '\n✅ PASS — op_transport is the depot’s twin: it is a truck stop, it carries freight capacity, and the trucks on the road came out of it.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
