// ═══════════════════════════════════════════════════════════════════════════
// 🧭 WAREHOUSE REACHABILITY GATE
//
// Floods the yard on a 0.2 m grid from the truck door using the page's OWN
// blocked() predicate, at every bay count a warehouse tier can sell
// (2 / 4 / 8 / 14 / 22 / 32), and asserts that every bay, both terminals and
// the dock door are actually walkable to.
//
// WHY THIS EXISTS AS A COMMITTED GATE RATHER THAN A ONE-OFF SCRIPT:
// the bay layout is load-bearing geometry with an invisible failure mode. Bays
// are laid out in rows derived from the unit count, so a spacing or row-wrap
// change can wall one off — and nothing about that is visible until a player
// has paid up to 1,500,000 Cinder to reach Tier 5 and finds Bay 27 behind a
// collider. Reading the layout code cannot tell you; only walking it can. It
// was run by hand once, which is worth nothing the next time someone edits
// BW / BD / the row pitch / the shed walls.
//
// Run:   node _wh_reach_check.mjs
// Exit:  0 = every tier walkable · 1 = a bay is unreachable · 2 = cannot run
//
// Needs three.js r128 (the same build the page loads from the CDN) because the
// page will not boot without it, and headless Chromium has no network here:
//     npm i three@0.128.0 --no-save
// or point WH_THREE at a copy:
//     WH_THREE=/path/to/three.min.js node _wh_reach_check.mjs
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PAGE = join(ROOT, 'public', 'warehouse', 'index.html');

// ── locate three.js ────────────────────────────────────────────────────────
const CANDIDATES = [
  process.env.WH_THREE,
  join(ROOT, 'node_modules', 'three', 'build', 'three.min.js'),
  join(ROOT, 'node_modules', 'three', 'build', 'three.js'),
].filter(Boolean);
const threePath = CANDIDATES.find(p => { try { return existsSync(p); } catch (e) { return false; } });
if (!threePath) {
  console.error('✖ cannot run: three.js r128 not found.\n'
    + '  Install it:  npm i three@0.128.0 --no-save\n'
    + '  or point at a copy:  WH_THREE=/path/to/three.min.js node _wh_reach_check.mjs');
  process.exit(2);
}

// ── locate playwright (global install in this environment) ─────────────────
let chromium;
for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
  try { ({ chromium } = await import(spec)); break; } catch (e) { /* try the next */ }
}
if (!chromium) {
  console.error('✖ cannot run: playwright not found.  npm i playwright --no-save');
  process.exit(2);
}

const three = readFileSync(threePath, 'utf8');
const R = [];
const ok = (label, cond, detail = '') => {
  const line = `${cond ? 'PASS' : 'FAIL'} — ${label}  ${detail}`;
  R.push({ cond, line });
  console.log(line);
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 } });
// The page loads three from the CDN; serve the local copy instead.
await ctx.route('**/three.min.js', r =>
  r.fulfill({ status: 200, contentType: 'application/javascript', body: three }));
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));

try {
  await page.goto(pathToFileURL(PAGE).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.App && window.App.ready === true, { timeout: 30000 });
} catch (e) {
  console.error('✖ cannot run: the warehouse page did not boot — ' + (e.message || e));
  await browser.close();
  process.exit(2);
}

// Every bay count a tier can sell. Keep in step with wh_config()'s `tiers`.
const TIERS = [2, 4, 8, 14, 22, 32];

for (const n of TIERS) {
  const out = await page.evaluate(async (N) => {
    const st = WH.state(), C = st.config;
    // Rebuild the yard with N bays exactly as the server would hand them over.
    st.units = [];
    for (let i = 1; i <= N; i++) {
      st.units.push({ id: 'u' + i, bay_no: i, renter_id: null, renter_name: null,
        occupied: false, capacity_kg: C.unit_capacity_kg, used_kg: 0, contents: {}, mine: false });
    }
    st.warehouse.units_total = N;
    WH.setState(st); refreshWorld();
    await new Promise(r => setTimeout(r, 60));

    // Flood fill from the truck door using the REAL collision predicate. Not a
    // reimplementation of it — the point is to catch the case where the game's
    // own idea of "solid" walls a bay off.
    const S = 0.2, key = (a, b) => a + ',' + b;
    const start = [Math.round(App.truckDoor.x / S), Math.round(App.truckDoor.z / S)];
    const seen = new Set([key(start[0], start[1])]);
    const q = [start];
    let cells = 0;
    while (q.length) {
      const [cx, cz] = q.pop(); cells++;
      if (cells > 400000) break;                       // safety stop
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        const wx = nx * S, wz = nz * S;
        if (wx < -30 || wx > 30 || wz < App.shedZB - 3 || wz > 26) continue;
        const k = key(nx, nz);
        if (seen.has(k)) continue;
        seen.add(k);
        if (blocked(wx, wz)) continue;
        q.push([nx, nz]);
      }
    }
    // ⚠ "Reachable" means there is a STANDABLE cell within the sensor's radius —
    // not that the sensor's own anchor is standable. The terminals' anchors sit
    // inside their own colliders by design (you walk UP to a terminal, you do
    // not stand in it), so testing the anchor point reported a false failure.
    const standableNear = (x, z, radius) => {
      const rr = Math.ceil(radius / S);
      for (let ox = -rr; ox <= rr; ox++) {
        for (let oz = -rr; oz <= rr; oz++) {
          if (ox * ox + oz * oz > rr * rr) continue;
          const gx = Math.round(x / S) + ox, gz = Math.round(z / S) + oz;
          if (seen.has(key(gx, gz)) && !blocked(gx * S, gz * S)) return true;
        }
      }
      return false;
    };
    const bays = App.sensors.filter(s => s.kind === 'bay');
    const lift = App.sensors.filter(s => s.kind === 'lifter')[0];
    const upg = App.sensors.filter(s => s.kind === 'upgrade')[0];
    // Bays must also be INSIDE the shed — a walkable bay in the car park is
    // still a broken bay.
    const inside = App.bayNodes.every(b => b.node.position.z > App.shedZB + 0.3
      && b.node.position.z < 1.0 && Math.abs(b.node.position.x) < 12.6);
    return {
      cells, bays: App.bayNodes.length, sensors: bays.length, inside, zb: App.shedZB,
      unreachable: bays.filter(s => !standableNear(s.x, s.z, s.r)).map(s => s.unit.bay_no),
      lift: !!lift && standableNear(lift.x, lift.z, lift.r),
      upg: !!upg && standableNear(upg.x, upg.z, upg.r),
      door: standableNear(App.truckDoor.x, App.truckDoor.z, 1.0),
    };
  }, n);

  ok(`tier layout with ${n} bays — EVERY bay is walkable`, out.unreachable.length === 0,
     `${out.bays} bays · ${out.cells} walk cells · unreachable=[${out.unreachable}]`);
  ok(`…with ${n} bays both terminals and the dock door stay reachable`,
     out.lift && out.upg && out.door, `lifter=${out.lift} upgrade=${out.upg} door=${out.door}`);
  ok(`…and every bay sits inside the shed (back wall z=${out.zb.toFixed(1)})`, out.inside);
  ok(`…and every bay has a sensor`, out.sensors === out.bays, `${out.sensors}/${out.bays}`);
}

// Rebuilding the world repeatedly must not pile up stale colliders — that is
// how a bay becomes unreachable only after a few purchases.
const leak = await page.evaluate(async () => {
  const before = App.colliders.length;
  for (let i = 0; i < 20; i++) { refreshWorld(); await new Promise(r => setTimeout(r, 5)); }
  return { before, after: App.colliders.length };
});
ok('refreshWorld does not leak colliders', leak.after === leak.before, JSON.stringify(leak));
ok('no uncaught page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

await browser.close();
const passed = R.filter(r => r.cond).length, failed = R.length - passed;
console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) {
  console.error('\n✖ A WAREHOUSE BAY IS NOT REACHABLE. A tier that sells it is selling nothing.');
  process.exit(1);
}
console.log('✔ every bay at every tier is walkable.');
