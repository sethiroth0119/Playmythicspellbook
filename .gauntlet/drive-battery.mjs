/* ══════════════════════════════════════════════════════════════════════════
   🔋 DRIVE-BATTERY — the buffer that lets a solar city run after dark.

   THE REPORT, third time: "the solar farm says it is not putting out any power
   even though it clearly has lines above it." The lines were right every time.
   The farm was dark — solar is zero between 18:00 and 06:00 on the real clock —
   and the tooltip's advice ("add storage") named something that could not be
   built: capacity rode on plant COUNT and no building granted any.

   So storage became buildable. What that has to mean, and what is pinned here:

     1. A BATTERY ADDS REAL CAPACITY. CONTROL: the same city with no battery has
        only the plants' own small buffer.
     2. A CHARGED BATTERY COVERS A DEFICIT the plants cannot meet — this is the
        whole feature: the dark solar city keeps its lights on.
        CONTROL: the identical deficit with an EMPTY battery is not covered, so
        what is measured is the charge and not the building's mere presence.
     3. IT MUST BE WIRED, exactly like a plant. A battery the cable never
        reached adds nothing. CONTROL: the same battery, reachable, counts.
     4. IT IS NOT A GENERATOR. Capacity is not capacity-plus-output: a city
        whose only power building is a battery generates zero.

   Node-only: grid.js is a pure ES module over plain objects.

   Run:  node .gauntlet/drive-battery.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import * as Grid from '../public/src/power/grid.js';
import { POWER } from '../public/src/power/tuning.js';

const bad = [];
const ok = (name, cond, detail) => { if (!cond) bad.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); };
const K = (x, z) => x + ',' + z;

/* A 6x6 city. Roads run along z=0 and conduct, and the Grid Connector sits on
   the verge at (0,-1) — off the plate, exactly where lines.js puts it — so a
   battery BESIDE the road row is reachable and one in the far corner is not.
   `wired:false` moves the banks to that corner and changes nothing else. */
function city(o) {
  const tiles = [];
  for (let x = 0; x < 5; x++) tiles.push({ k: K(x, 0), x, z: 0, road: true });
  const loads = [{ k: K(3, 1), x: 3, z: 1, draw: o.draw, cls: 'households' }];
  tiles.push({ k: K(3, 1), x: 3, z: 1, type: 'house', lvl: 1 });
  const plants = [{ k: K(0, 1), x: 0, z: 1, type: 'powerstation', name: 'Plant', ico: '⚡', out: o.gen }];
  tiles.push({ k: K(0, 1), x: 0, z: 1, type: 'powerstation', lvl: 1 });
  const stores = [];
  for (let i = 0; i < (o.batts || 0); i++) {
    const p2 = o.wired === false ? { x: 5, z: 5 - i } : { x: 1 + i, z: 1 };
    stores.push({ k: K(p2.x, p2.z), x: p2.x, z: p2.z, type: 'battery', name: 'Grid Battery', ico: '🔋' });
    tiles.push({ k: K(p2.x, p2.z), x: p2.x, z: p2.z, type: 'battery', lvl: 1 });
  }
  return {
    grid: 6, tiles, loads, plants, stores,
    pop: 100, hasGrid: true, perPop: 0, floor: 0.25, dtMin: 1,
    enforce: o.enforce !== false,
    lines: { cells: new Set([K(0,-1),K(0,0),K(1,0),K(2,0),K(3,0),K(4,0)]), seeds: [{ k: K(0, -1), x: 0, z: -1, kind: 'connector' }],
             sig: 's' + (o.batts || 0) + (o.wired === false ? 'u' : 'w') },
  };
}
const solve = (o, charge) => Grid.solve(city(o), charge);

// ── 1 · capacity ──────────────────────────────────────────────────────────
const noBatt = solve({ gen: 10, draw: 4, batts: 0 }, 0);
const oneBatt = solve({ gen: 10, draw: 4, batts: 1 }, 0);
ok('a battery adds capacity', oneBatt.store.cap > noBatt.store.cap, { with: oneBatt.store.cap, without: noBatt.store.cap });
ok('…by exactly its rated bank', oneBatt.store.cap - noBatt.store.cap === POWER.storage.perBatteryUnitMin,
   { delta: oneBatt.store.cap - noBatt.store.cap, rated: POWER.storage.perBatteryUnitMin });
ok('CONTROL: no battery, no extra capacity', noBatt.store.cap === 1 * POWER.storage.perPlantUnitMin, noBatt.store.cap);

// ── 2 · it carries a deficit ──────────────────────────────────────────────
/* The dark solar city: the plant makes 1, the city wants 9. */
const carried = solve({ gen: 1, draw: 9, batts: 2 }, 500);
const empty   = solve({ gen: 1, draw: 9, batts: 2 }, 0);
ok('a charged battery discharges into a deficit', carried.store.out > 0, carried.store);
ok('…and the city is better served for it', carried.factor > empty.factor, { charged: carried.factor, empty: empty.factor });
ok('CONTROL: an EMPTY battery covers nothing', empty.store.out === 0, empty.store);

// ── 3 · it has to be on the line ──────────────────────────────────────────
const wired   = solve({ gen: 1, draw: 9, batts: 2, wired: true  }, 500);
const strand  = solve({ gen: 1, draw: 9, batts: 2, wired: false }, 500);
ok('an UNWIRED battery adds no capacity', strand.store.cap === noBatt.store.cap, { stranded: strand.store.cap, none: noBatt.store.cap });
ok('CONTROL: the same battery, wired, does', wired.store.cap > strand.store.cap, { wired: wired.store.cap, stranded: strand.store.cap });
ok('the unwired bank is reported as unlinked', (strand.byStore || []).every(b => b.linked === false), strand.byStore);
ok('CONTROL: the wired bank is reported as linked', (wired.byStore || []).every(b => b.linked === true), wired.byStore);

// ── 4 · it generates nothing ──────────────────────────────────────────────
const onlyBatt = Grid.solve((() => { const c = city({ gen: 0, draw: 5, batts: 2 }); c.plants = []; return c; })(), 0);
ok('a battery is not a generator', onlyBatt.capacity === 0, { capacity: onlyBatt.capacity });

console.log(JSON.stringify({
  capNone: noBatt.store.cap, capOne: oneBatt.store.cap,
  carried: { out: +carried.store.out.toFixed(3), factor: +carried.factor.toFixed(3) },
  empty: { out: empty.store.out, factor: +empty.factor.toFixed(3) },
  strandedCap: strand.store.cap, wiredCap: wired.store.cap,
  batteriesCounted: wired.store.batteries, onlyBattCapacity: onlyBatt.capacity,
}, null, 2));
/* ── 5 · IT HAS TO EXIST IN THE CITY, NOT ONLY IN THE SOLVER ──────────────
   A BUILDINGS row with no mesh recipe and no alias renders as an EMPTY GROUP —
   an invisible building the player pays for and cannot see. node-city's own
   comment at :4219 names that as the trap for exactly this kind of addition,
   so the page is booted and asked rather than assumed. */
{
  const { chromium } = await import('playwright');
  const http = (await import('node:http')).default;
  const fsx = (await import('node:fs')).default;
  const path = (await import('node:path')).default;
  const ROOT = path.resolve(process.cwd(), 'public');
  const MT = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.txt':'text/plain','.wav':'audio/wav','.mp3':'audio/mpeg' };
  const PORT = 8810 + (process.pid % 40);
  const srv = http.createServer((q, r) => {
    let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fsx.existsSync(f) || fsx.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
    r.writeHead(200, { 'Content-Type': MT[path.extname(f)] || 'application/octet-stream' });
    fsx.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));
  const br = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const pg = await br.newPage({ viewport: { width: 1100, height: 800 } });
  await pg.route('**/*', (r) => { const u = r.request().url();
    if (u.includes('127.0.0.1') || u.includes('localhost') || u.includes('cdn.jsdelivr.net')) return r.continue(); return r.abort(); });
  await pg.goto('http://127.0.0.1:' + PORT + '/node-city/index.html', { waitUntil: 'load', timeout: 120000 });
  await pg.waitForFunction('!!(window.__nc && window.__nc.game && window.MythicPower)', null, { timeout: 180000 }).catch(() => {});
  await pg.waitForTimeout(9000);
  const page = await pg.evaluate(async () => {
    const nc = window.__nc, o = {};
    const def = (nc.BUILDINGS || {}).battery;
    o.defined = !!def;
    o.isNotAPlant = !!(def && !def.gen);
    o.declaresStore = !!(def && def.pwStore);
    o.inPowerSection = !!(nc.BUILD_SECTIONS || []).find(x => x && x.id === 'pwr' && (x.items || []).includes('battery'));
    nc.game.tiles['7,7'] = { type: 'battery', lvl: 1 };
    try { nc.step(); } catch (e) { o.stepError = String(e).slice(0, 160); }
    await new Promise(r => setTimeout(r, 500));
    /* ASK THE MESH FACTORY, do not read the injected tile: a tile written
       straight into game.tiles never went through the placement path, so it has
       no .mesh and would report "invisible" for every building in the game. */
    const box = (t2) => { try { const b = nc.meshBox(t2, 1); return b ? { meshes: b.meshes, empty: !!b.empty } : null; } catch (e) { return null; } };
    o.mesh = box('battery');
    o.meshAlias = box('depot');   // the recipe it borrows — the control
    try { const d = document.createElement('div'); d.innerHTML = String(nc.tipOf('7,7') || '');
          o.tip = (d.textContent || '').replace(/[ \t\r\n]+/g, ' ').trim().slice(0, 220); } catch (e) {}
    return o;
  });
  await br.close(); srv.close();
  ok('the Grid Battery is a real building', page.defined, page);
  ok('...that is NOT a generator', page.isNotAPlant, page);
  ok('...declares itself as storage', page.declaresStore, page);
  ok('...and is in the Power shop', page.inPowerSection, page);
  ok('it renders something (not an invisible building)',
     !!(page.mesh && page.mesh.meshes > 0 && page.mesh.empty === false), page.mesh);
  ok('CONTROL: it draws the same recipe its alias names',
     !!(page.meshAlias && page.mesh && page.mesh.meshes === page.meshAlias.meshes), { got: page.mesh, alias: page.meshAlias });
  ok('its tooltip reports the bank', /charged/i.test(page.tip || ''), page.tip);
  ok('the city tick did not throw', !page.stepError, page.stepError);
  console.log('PAGE: ' + JSON.stringify(page, null, 2));
}

console.log(bad.length ? '\n❌ FAIL:\n  · ' + bad.join('\n  · ')
                       : '\n✅ PASS — a wired, charged battery carries the city through the dark; an empty or stranded one does not, and it never pretends to generate.');
process.exit(bad.length ? 1 : 0);
