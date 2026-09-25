/* 🛤 A ZONE ON A ROAD CAN BE CLEARED, AND IS NOT COUNTED AS A PLOT.
   Run: node _zoneroad_smoke.mjs
   Tracker bug-mu2q24h4: "if you accidentally zone on a road, you can't use the
   right click to un-zone, however those zoned tiles show up on the Develop
   button (even though nothing can happen)."
   Two causes, both in src/zoning/index.js:
     1. setZone refused ANY write to a road tile before looking at the id, so a
        CLEAR was refused along with a paint.
     2. A road drawn over zoned land left the zone under it; plan() found a tile
        there and counted it as an occupied plot.
   Measured by mounting the module in Node before the fix: clearing the zone on
   a road returned false and left it, and plan() counted 1 occupied plot.
   This suite mounts the REAL module (it needs a `window`; the panel is skipped
   without a document, which the module already treats as non-fatal). */
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { resolve } from 'path';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const FILE = resolve('./public/src/zoning/index.js');
const SRC = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

globalThis.window = globalThis.window || {};
const _warn = console.warn; console.warn = () => {};          // "panel not mounted (non-fatal)" is expected here
const Z = await import(pathToFileURL(FILE).href);
const fresh = (tiles, zones) => {
  const G = { tiles, zones };
  let saves = 0;
  const api = Z.mount({ game: G, GRID: 8, saveSoon: () => { saves++; } });
  return { G, api, saves: () => saves };
};

console.log('\n=== 1. a road may be un-zoned, never zoned ===');
{
  const W = fresh({ '2,2': { type: 'road', lvl: 1 } }, { '2,2': 'r_low' });
  ok(W.api.setZone(2, 2, null) === true && !('2,2' in W.G.zones), 'right-click clear on a zoned road removes the zone');
  ok(W.api.setZone(2, 2, 'r_low') === false && !('2,2' in W.G.zones), 'painting a road is still refused');
  const V = fresh({}, { '5,5': 'r_low' });
  ok(V.api.setZone(5, 5, null) === true && !('5,5' in V.G.zones), 'clearing ordinary land is unchanged');
  ok(V.api.setZone(5, 5, 'r_low') === true && V.G.zones['5,5'] === 'r_low', 'painting ordinary land is unchanged');
}

console.log('\n=== 2. a zone under a road is not a plot ===');
{
  const W = fresh({ '2,2': { type: 'road', lvl: 1 }, '3,3': { type: 'house', lvl: 1 } }, { '2,2': 'r_low', '4,4': 'r_low' });
  const p = W.api.plan();
  ok(p.skip.occupied === 0, 'the Develop plan does not count the road as an occupied plot', JSON.stringify(p.skip));
  ok(!('2,2' in W.G.zones) && W.G.zones['4,4'] === 'r_low', 'the stale zone under the road is removed; real zones are kept', JSON.stringify(W.G.zones));
  ok(W.saves() > 0, 'and the cleanup is saved');
  const V = fresh({ '3,3': { type: 'house', lvl: 1 } }, { '4,4': 'r_low' });
  const before = JSON.stringify(V.G.zones);
  V.api.plan();
  ok(JSON.stringify(V.G.zones) === before && V.saves() === 0, 'a city with no zone under a road is left exactly as it was, and not re-saved');
}

console.log('\n=== 3. the rule is where it has to be ===');
{
  ok(/if \(id != null && isRoad\(x, z\)\) return false;/.test(SRC), 'setZone refuses only the PAINT on a road');
  ok(!/\n    if \(isRoad\(x, z\)\) return false;\n    if \(id != null && !ZONE_BY_ID\[id\]\) return false;/.test(SRC),
    'the unconditional refusal — which blocked the clear — is gone');
  const sync = SRC.slice(SRC.indexOf('function sync() {'), SRC.indexOf('function sync() {') + 120);
  ok(/pruneRoadZones\(\);/.test(sync), 'every redraw drops zones under roads, so saves written before this are cleaned up too');
  const plan = SRC.slice(SRC.indexOf('function plan(only) {'), SRC.indexOf('function plan(only) {') + 300);
  ok(/pruneRoadZones\(\);/.test(plan), 'and so does every Develop plan, before it counts anything');
}

console.log('\n=== 4. NEGATIVE CONTROL — the unconditional refusal, restored ===');
{
  /* The rule text restored in memory, run against the same question the first
     check asks. It must refuse the clear, or §1 is not testing this. */
  const oldSetZone = (isRoad, id) => { if (isRoad) return false; return true; };
  const newSetZone = (isRoad, id) => { if (id != null && isRoad) return false; return true; };
  ok(oldSetZone(true, null) === false && newSetZone(true, null) === true,
    'the old guard refuses a clear on a road; the new one allows it — the difference §1 measures');
}

console.warn = _warn;
console.log(fails ? `\n❌ ${fails} FAILED\n` : '\n✅ zones and roads agree\n');
process.exit(fails ? 1 : 0);   // the module keeps a polling timer alive
