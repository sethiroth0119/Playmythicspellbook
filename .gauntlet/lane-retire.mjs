/* == 🪦 THE LANE RETIREMENT GATE =============================================
   The critic's finding, driven rather than grepped: `roadlane` was deleted from
   both build registries by a round whose justifying comment said it had been
   "re-homed" to the Roads tab. It had not — the palette lays type 'road' with
   nine CLASSES on it and physically cannot write 'roadlane' — so the Lane
   became unbuildable by any path while the research tree still rendered a live
   "Lane · building" unlock row for it.

   This driver asserts the retirement is now REAL, DELIBERATE and COMPLETE, and
   that retiring the OFFER did not retire the TILE. Those are the two halves and
   they pull in opposite directions, which is why both are measured here:

     A  THE OFFER IS GONE, EVERYWHERE.  No shop card (including the automatic
        "Other" orphan bucket), no research-tree unlock row, no DOM affordance
        anywhere in the document, and MythicRoads.buildable() does not list it.
     B  THE TILE STILL WORKS, COMPLETELY.  A save containing a Lane loads; the
        Lane is still a carriageway by the host's own predicate; it still
        counts against the road maintenance cap; it still auto-tiles; it still
        prices off its own BUILDINGS row; and the Roads palette can still drag
        a class straight over it — which is the promise the inspector desc now
        makes to a player who owns one.
     C  ROAD ITSELF IS UNTOUCHED.  Still gated by tra_basic, still laid by the
        palette, still the type every class rides on. Retiring the Lane must not
        have cost the Road its gate — 'absent ⇒ open' means an over-eager edit
        here would silently UNLOCK roads rather than break them, which is the
        failure that looks like nothing at all.

   🔴 WHY A DRIVER AND NOT A GREP. Every claim above is about what the RUNNING
      app offers a player. The previous round's grep said "roadlane appears in
      neither registry" and was true; the defect was in a THIRD surface no grep
      was pointed at. So this reads the rendered DOM of the shop and of the
      progression node, and calls the host's own published predicates.

   Usage: node .gauntlet/lane-retire.mjs
   ========================================================================== */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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
         '--ignore-gpu-blocklist', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', m => logs.push(('[' + m.type() + '] ' + m.text()).slice(0, 300)));
page.on('pageerror', e => logs.push('[pageerror] ' + String(e.message).slice(0, 300)));

/* 💰 FUND THE MOCK LEDGER. Section B pays for a real class conversion through
   the shipped payCost → MythicCityBridge.spendCinders path, and a fresh
   standalone city starts with 400 🔥 — one street. Seeding the mock ledger is
   the only way to exercise the REAL charging path rather than stubbing it out;
   an unfunded run refuses with "Cannot afford" and would have been read as the
   conversion being broken. */
await page.addInitScript(() => {
  try {
    localStorage.setItem('mythic_city_mockledger_v1', JSON.stringify({
      cinders: 5000000,
      res: { food: 900, water: 900, metal: 900, fuel: 900, supplies: 900, medicine: 900,
             ammo: 900, corruptedEssence: 90, memoryShards: 90, wood: 900, stone: 900, cloth: 900 },
    }));
  } catch (e) {}
});

await page.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__nc && window.__nc.three && window.__nc.three().renderer, null,
  { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(9000);

const FAIL = [];
const ok = (cond, label, extra) => {
  console.log((cond ? '  ✅ ' : '  ❌ ') + label + (extra != null ? '   ' + extra : ''));
  if (!cond) FAIL.push(label);
};

const boot = await page.evaluate(() => ({ nc: !!window.__nc, roads: !!window.MythicRoadClasses,
  prog: !!window.MythicProgress, mr: !!window.MythicRoads }));
console.log('boot:', JSON.stringify(boot));
if (!boot.nc) { console.log(logs.slice(-30).join('\n')); throw new Error('node-city did not boot'); }

/* ══ 0 · THE TWO QUESTIONS, AND THEIR TWO DIFFERENT ANSWERS ═══════════════ */
console.log('\n── 0 · the resolver publishes two lists ──');
const lists = await page.evaluate(() => ({
  types: window.MythicRoads.types(),
  buildable: typeof window.MythicRoads.buildable === 'function' ? window.MythicRoads.buildable() : null,
  isTypeLane: window.MythicRoads.isType('roadlane'),
  isTypeRoad: window.MythicRoads.isType('road'),
  classOfLane: window.MythicRoads.classOf('roadlane'),
}));
console.log('  types()    :', JSON.stringify(lists.types));
console.log('  buildable():', JSON.stringify(lists.buildable));
ok(Array.isArray(lists.buildable), 'the host publishes buildable()');
ok(lists.types.includes('roadlane'), 'types() STILL lists roadlane — a save answer never shrinks');
ok(lists.buildable && !lists.buildable.includes('roadlane'), 'buildable() does NOT list roadlane');
ok(lists.buildable && lists.buildable.includes('road'), 'buildable() still lists road — the fallback is not empty');
ok(lists.isTypeLane === true, 'isRoadType("roadlane") is still TRUE (the tile is still a carriageway)');
ok(!!(lists.classOfLane && lists.classOfLane.retired), 'the retirement is a flag on the ROAD_CLASSES row',
   JSON.stringify(lists.classOfLane));

/* ══ A · THE OFFER IS GONE, ON EVERY SURFACE ══════════════════════════════ */
console.log('\n── A · every surface that could offer a Lane ──');
const shop = await page.evaluate(() => {
  const btn = document.getElementById('openshop'); if (btn) btn.click();
  const cards = [...document.querySelectorAll('#shopbody [data-build]')].map(b => b.getAttribute('data-build'));
  const secs = [...document.querySelectorAll('#shopbody .shopsec')].map(s => (s.querySelector('h3') || {}).textContent || '');
  const isRoad = (t) => { try { return !!(window.MythicRoads && window.MythicRoads.isType(t)); } catch (e) { return t === 'road'; } };
  return { n: cards.length, roads: cards.filter(isRoad), lane: cards.filter(t => t === 'roadlane'),
           secs: secs.map(s => s.trim()), other: secs.filter(s => /Other/i.test(s)) };
});
console.log('  shop sections:', JSON.stringify(shop.secs));
ok(shop.n > 40, 'the shop rendered', shop.n + ' cards');
ok(shop.roads.length === 0, 'ZERO carriageway cards in the shop', JSON.stringify(shop.roads));
ok(shop.other.length === 0, 'no automatic "Other" orphan section rendered at all', JSON.stringify(shop.other));
await page.evaluate(() => { const v = document.getElementById('shopveil'); if (v) v.classList.remove('on'); });

/* THE SURFACE THE LAST ROUND MISSED. Open the real progression panel, find the
   real node, and read the unlock rows it RENDERS — not the array it holds. */
const prog = await page.evaluate(async () => {
  const P = window.MythicProgress; if (!P) return { none: true };
  const node = P.nodeById ? P.nodeById('tra_basic') : null;
  /* Drive the SHIPPED panel: openPanel() then select(), the same two calls the
     ⬡ chip and a node click make. Then read the rows it actually rendered. */
  P.openPanel(); await new Promise(r => setTimeout(r, 350));
  P.select('tra_basic'); await new Promise(r => setTimeout(r, 350));
  const root = document.getElementById('ncprog');
  const card = root ? root.querySelector('.pgnode[data-id="tra_basic"]') : null;
  const rows = root ? [...root.querySelectorAll('.pgul')].map(e => (e.textContent || '').replace(/\s+/g, ' ').trim()) : [];
  /* ⚠ getClientRects(), NOT offsetParent. #ncprog is position:fixed, and a
     fixed element's offsetParent is null whether it is open or closed — the
     first draft of this line asserted "the panel opened" against a property
     that can never be true for this panel, and reported a red ❌ on a panel
     that was in fact open and correctly rendered. Measure the box. */
  const box = card ? card.getBoundingClientRect() : null;
  return {
    buildings: node ? node.buildings.slice() : null,
    rows, cardFound: !!card,
    open: !!(box && box.width > 0 && box.height > 0),
    unlockedLane: P.buildingUnlocked ? P.buildingUnlocked('roadlane') : null,
    unlockedRoad: P.buildingUnlocked ? P.buildingUnlocked('road') : null,
    blockedRoad: P.buildingBlockedBy ? !!P.buildingBlockedBy('road') : null,
    blockedLane: P.buildingBlockedBy ? !!P.buildingBlockedBy('roadlane') : null,
  };
});
console.log('  tra_basic.buildings:', JSON.stringify(prog.buildings));
console.log('  rendered unlock rows:', JSON.stringify(prog.rows));
/* 🔴 THE INSTRUMENT CHECK. The previous draft of this probe read an element id
   that does not exist, got '' and PASSED the "no Lane row" assertion vacuously
   — the same confident-wrong-zero the pixel A/Bs guard against, in text form.
   So the panel must be proven OPEN and the row list proven NON-EMPTY before the
   absence of "Lane" in it means anything. */
ok(prog.open && prog.cardFound, 'the progression panel really opened and tra_basic is on it');
ok(prog.rows.length >= 2, 'the Unlocks section rendered rows (so an absence below is a reading, not a blank)',
   prog.rows.length + ' rows');
ok(prog.buildings && !prog.buildings.includes('roadlane'), 'tra_basic no longer unlocks roadlane');
ok(prog.buildings && prog.buildings.includes('road'), 'tra_basic STILL unlocks road (the gate survived the edit)');
ok(!prog.rows.some(r => /^Lane\b/.test(r)), 'no rendered "Lane · building" unlock row', JSON.stringify(prog.rows));
ok(prog.rows.some(r => /^Road\b/.test(r)), '…and the Road row is still there, proving the list is the real one');
ok(prog.blockedRoad === false, 'road is unlocked in this city (tra_basic is the free trunk node)');
console.log('  buildingUnlocked(roadlane) =', prog.unlockedLane, ' (ungated: nothing can lay one, so nothing is gated)');
await page.evaluate(() => { try { window.MythicProgress.closePanel(); } catch (e) {} });

/* The whole-document sweep the critic ran, repeated: no affordance anywhere. */
const domHits = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('*')) {
    for (const a of el.attributes || []) {
      if (String(a.value).includes('roadlane')) hits.push(el.tagName + '[' + a.name + '=' + a.value + ']');
    }
  }
  return hits.slice(0, 20);
});
ok(domHits.length === 0, 'no element in the whole document carries a roadlane affordance', JSON.stringify(domHits));

/* ══ B · THE TILE STILL WORKS ═════════════════════════════════════════════ */
/* 🪦 MINT THE LEGACY CITY THE ONLY WAY THAT IS STILL HONEST. No path in the
   game lays a Lane any more — that is the whole feature — so a driver cannot
   click one into existence. It writes the tiles the way loadState does (into
   game.tiles, then refreshRoadArea to auto-tile them), then puts the city
   through the SHIPPED serialize → saveNow → reload → loadState round trip. That
   is the exact state a returning player's save is in, and it is the round trip
   that would strand them if the type had been deleted rather than retired.
   Three Lanes beside three Avenue-class Roads, so the auto-tiler has a junction
   to resolve and the maintenance cap has both types to count. */
console.log('\n── B · the Lane already standing ──');
const seeded = await page.evaluate(() => {
  const nc = window.__nc; const g = nc.game;
  for (let i = 0; i < 3; i++) { g.tiles['6,' + (5 + i)] = { type: 'roadlane', lvl: 1 }; }
  for (let i = 0; i < 3; i++) { g.tiles['7,' + (5 + i)] = { type: 'road', lvl: 1 }; }
  /* __nc.roadClass() is the shipped harness seam: it writes t.rc and then calls
     the host's own refreshRoadArea, i.e. the same two steps in the same order
     as /src/roads' applyRun conversion. Using it here means the auto-tiler runs
     on the Lanes through the real path rather than a driver-local imitation. */
  for (let i = 0; i < 3; i++) { nc.roadClass(6, 5 + i, null); nc.roadClass(7, 5 + i, 'avenue'); }
  nc.saveNow();
  const ser = nc.serialize();
  const blob = typeof ser === 'string' ? ser : JSON.stringify(ser);
  return { lanesInSave: (blob.match(/roadlane/g) || []).length, bytes: blob.length };
});
console.log('  serialize() carries the type through:', seeded.lanesInSave, 'roadlane occurrences');
ok(seeded.lanesInSave >= 3, 'serialize() writes the retired type verbatim (a save is never stranded)',
   seeded.lanesInSave);

await page.reload({ waitUntil: 'load', timeout: 180000 });
await page.waitForFunction(() => window.__nc && window.__nc.three && window.__nc.three().renderer, null,
  { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(9000);
console.log('  (real page reload done — everything below is a freshly loaded city)');

const tile = await page.evaluate(() => {
  const nc = window.__nc || {};
  const g = nc.game || null;
  const laneKeys = g ? Object.keys(g.tiles).filter(k => g.tiles[k].type === 'roadlane') : [];
  const R = window.MythicRoadClasses;
  let capUsed = null, laneWeight = null, laneVerts = null, laneMeshes = null;
  try { capUsed = R && R.capUsed ? R.capUsed() : null; } catch (e) {}
  try { laneWeight = R && R.capWeight ? R.capWeight(g.tiles[laneKeys[0]]) : null; } catch (e) {}
  /* 🧱 DOES THE LOADED LANE ACTUALLY RENDER? The invisible-building trap is
     that buildMesh has no default arm, so a type with no case is a real tile
     with an empty Group on it. Roads dodge that by bypassing buildMesh
     entirely — refreshRoad() builds the tile through buildRoadMesh and hangs
     the result on `t.mesh` — which also means __nc.meshBox() is the WRONG probe
     here (it drives buildMesh and would report `empty:true` for a perfectly
     visible road). So read the mesh the auto-tiler actually hung on the tile. */
  try {
    const t = g.tiles[laneKeys[0]];
    if (t && t.mesh) {
      let v = 0, m = 0;
      t.mesh.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { m++; v += o.geometry.attributes.position.count; } });
      laneVerts = v; laneMeshes = m;
    }
  } catch (e) {}
  return { laneKeys, capUsed, laneWeight, laneVerts, laneMeshes,
           priced: (() => { try { return nc.costOf ? nc.costOf('roadlane') : null; } catch (e) { return null; } })() };
});
console.log('  lane tiles loaded:', JSON.stringify(tile.laneKeys), ' weighted cap used:', tile.capUsed);
ok(tile.laneKeys.length === 3, 'the seeded save loaded its three Lane tiles', tile.laneKeys.length);
ok(tile.laneWeight === 1, 'a Lane still weighs 1 against the road maintenance cap', tile.laneWeight);
ok(tile.capUsed >= 9, 'the cap counts BOTH types (3 Lanes ×1 + 3 Avenues ×2 = 9)', tile.capUsed);
ok(tile.laneVerts > 0, 'the Lane auto-tiled into real geometry (NOT an empty Group)',
   tile.laneMeshes + ' meshes / ' + tile.laneVerts + ' verts');

/* THE PROMISE THE INSPECTOR DESC MAKES: drag a class straight over a Lane. */
const conv = await page.evaluate(async () => {
  const R = window.MythicRoadClasses; const nc = window.__nc || {};
  if (!R || !R._apply) return { none: true };
  const g = nc.game;
  const cells = [{ x: 6, z: 5 }, { x: 6, z: 6 }, { x: 6, z: 7 }];
  const before = cells.map(c => { const t = g.tiles[c.x + ',' + c.z]; return t ? t.type + '/' + (t.rc || '-') : 'empty'; });
  const r = await R._apply(cells, 'highway');
  const after = cells.map(c => { const t = g.tiles[c.x + ',' + c.z]; return t ? t.type + '/' + (t.rc || '-') : 'empty'; });
  return { before, after, r };
});
console.log('  before:', JSON.stringify(conv.before));
console.log('  after :', JSON.stringify(conv.after));
ok(conv.after && conv.after.every(s => s.startsWith('roadlane/')),
   'the Lane keeps its TYPE through a class conversion (no type mutation on an occupied tile)');
ok(conv.after && conv.after.every(s => s.endsWith('/highway')),
   '…and takes the new CLASS — a player who owns a Lane is not stranded', JSON.stringify(conv.r));

/* ══ C · ROAD ITSELF, AND THE PALETTE, ARE UNTOUCHED ══════════════════════ */
console.log('\n── C · road is unharmed ──');
const road = await page.evaluate(async () => {
  const R = window.MythicRoadClasses; const nc = window.__nc || {};
  const g = nc.game;
  const cells = [{ x: 12, z: 12 }, { x: 13, z: 12 }, { x: 14, z: 12 }];
  for (const c of cells) delete g.tiles[c.x + ',' + c.z];
  const r = await R._apply(cells, 'alley');
  const laid = cells.map(c => { const t = g.tiles[c.x + ',' + c.z]; return t ? t.type + '/' + (t.rc || '-') : 'empty'; });
  return { laid, r, classes: R.classes().map(c => c.id || c) };
});
console.log('  laid on empty ground:', JSON.stringify(road.laid));
ok(road.laid.every(s => s === 'road/alley'), 'the palette still lays road on empty ground, with its class');
ok(road.classes.length === 9, 'all nine classes are still in the palette', road.classes.length);
ok(road.classes.includes('alley'), 'the `alley` that supersedes the Lane is one of them');

console.log('\n' + (FAIL.length ? '❌ FAIL (' + FAIL.length + '): ' + FAIL.join(' | ') : '✅ LANE RETIREMENT GATE PASSED'));
const errs = logs.filter(l => /pageerror|\[error\]/.test(l));
if (errs.length) console.log('page errors:\n' + errs.slice(0, 10).join('\n'));
await browser.close(); server.close();
process.exit(FAIL.length ? 1 : 0);
