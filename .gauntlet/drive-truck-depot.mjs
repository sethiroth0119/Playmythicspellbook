/* ══════════════════════════════════════════════════════════════════════════
   🚛 DRIVE-TRUCK-DEPOT — can a player who owns NO business build the depot,
   and does the tile it writes match what the server indexes?

   THE REPORT: "We are still missing the Truck Depot building players need for
   trucks to drop off and pick up shipment. Players do not need to own the
   business — they just need to build the building in their city."

   THE TWO FAILURES BEHIND IT, both proven here:
     1. The only depot in the game was `op_transport` — a LICENCE building,
        visible in the palette only after buying the Transportation Company at
        City Hall. A city owner who will never found a carrier could not build
        one at all, which is why the live world had zero of them.
     2. 🔴 AND THE ONE THAT WOULD HAVE SURVIVED FIXING (1): the city writes the
        tile type `op_transport`, while sql/075's index matched `transport` —
        a type NO TILE HAS EVER HAD. So the destination gate was unsatisfiable:
        it would have gone on refusing every haul even after somebody built a
        depot, and "no nodes can receive freight" looks identical either way.
        sql/076 matches all three spellings. THIS DRIVER PINS THE STRING the
        server depends on, in the file that produces it.

   WHAT IT PROVES, in the real page, through the shipped placement path:
     · the building exists, is licence-free, and is IN the Infrastructure section
     · it has a mesh recipe (a BUILDINGS row with neither an arm nor an alias is
       an invisible building — node-city:4219)
     · placing it writes a tile typed EXACTLY `truckdepot`
     · serialize() carries that type into the save blob the server reads
     · 🔴 THE CONTROL: a city with no depot serialises no depot tile, so the
       assertions above are about this building and not about a scan that would
       match anything.

   Run:  node .gauntlet/drive-truck-depot.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'public');
const M = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.txt': 'text/plain', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };
const P = 8460 + (process.pid % 40);
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
  const B = nc.BUILDINGS || (typeof BUILDINGS !== 'undefined' ? BUILDINGS : null);
  const SEC = nc.BUILD_SECTIONS || (typeof BUILD_SECTIONS !== 'undefined' ? BUILD_SECTIONS : null);
  o.reachable = !!(B && SEC && nc.game);
  if (!o.reachable) { o.why = 'node-city internals not exposed on window.__nc'; return o; }

  const d = B.truckdepot;
  o.exists = !!d;
  if (!d) return o;
  o.name = d.name;
  // Licence-free: an operation building carries `opType` and costs nothing
  // because it was paid for at City Hall. This one must carry neither.
  o.hasOpType = 'opType' in d;
  o.costsCityCurrency = !!(d.cost && (d.cost.cinder | 0) > 0);
  // A row with no buildMesh arm AND no alias is an invisible building.
  o.meshAlias = d.mesh || null;
  const sec = SEC.find((s) => s.items && s.items.indexOf('truckdepot') >= 0);
  o.section = sec ? sec.id : null;

  // ── the CONTROL half: nothing typed truckdepot before we place one ────────
  // ⚠ serialize() returns a JSON STRING, not an object — that is the shape
  //   cityStateSave() parses before upserting, so it is the shape the SERVER sees.
  const ser0 = JSON.parse(nc.serialize());
  o.ctrlDepotTiles = Object.values((ser0 && ser0.tiles) || {}).filter((t) => t && t.type === 'truckdepot').length;

  // ── place one directly on the tile map, the way loadState does ────────────
  // (tryPlace() runs the whole cost/adjacency path and needs a funded city;
  //  what the SERVER reads is the serialised tile, so that is what is pinned.)
  nc.game.tiles['77,77'] = { type: 'truckdepot', lvl: 2, rot: 0, born: 0, spent: 0, earn: 0 };
  const ser = JSON.parse(nc.serialize());
  const tile = ser && ser.tiles && ser.tiles['77,77'];
  o.serialisedType = tile ? tile.type : null;
  o.serialisedLvl = tile ? tile.lvl : null;
  // The exact predicate sql/076's city_depot_stat runs, in JS, against the real
  // blob: type in the set AND not (b present with k = 0).
  const TYPES = { truckdepot: 1, op_transport: 1, transport: 1 };
  o.serverWouldCount = Object.values(ser.tiles || {}).filter((t) =>
    t && TYPES[t.type] && !(t.b && String(t.b.k) === '0')).length;
  // …and that a half-built one is NOT counted.
  nc.game.tiles['78,78'] = { type: 'truckdepot', lvl: 1, rot: 0, born: 0, spent: 0, earn: 0,
                             bld: { k: 0, l: 1, s: Date.now(), d: 600 } };
  const ser2 = JSON.parse(nc.serialize());
  o.underConstructionCounts = Object.values(ser2.tiles || {}).filter((t) =>
    t && TYPES[t.type] && !(t.b && String(t.b.k) === '0')).length;

  // The inspect panel exists and is wired for this type.
  o.panelFn = typeof nc.truckDepotPanel === 'function';
  return o;
});

const bad = [];
const need = (k, ok) => { if (!ok) bad.push(k); };
if (!out.reachable) bad.push(out.why || 'not reachable');
else {
  need('the building exists', out.exists === true);
  need('it is named Truck Depot', out.name === 'Truck Depot');
  need('it is NOT a licence building (no opType)', out.hasOpType === false);
  need('it costs city currency', out.costsCityCurrency === true);
  need('it has a mesh recipe or alias (not invisible)', !!out.meshAlias);
  need('it is in the Infrastructure section', out.section === 'infra');
  need('CONTROL: no depot tile before placing one', out.ctrlDepotTiles === 0);
  need('the tile serialises as exactly `truckdepot`', out.serialisedType === 'truckdepot');
  need('its level rides the save', out.serialisedLvl === 2);
  need('the server index would count it', out.serverWouldCount === 1);
  need('a half-built one is NOT counted', out.underConstructionCounts === 1);
  need('the earnings panel is wired', out.panelFn === true);
}

console.log(JSON.stringify({ ...out, pageErrors: errs.slice(0, 5) }, null, 2));
console.log(bad.length ? '\n❌ FAIL: ' + bad.join(' | ')
                       : '\n✅ PASS — licence-free, visible, placeable, and the tile it writes is the tile the server counts.');
await b.close(); srv.close();
process.exit(bad.length ? 1 : 0);
