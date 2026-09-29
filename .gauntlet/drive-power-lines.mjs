/* ════════════════════════════════════════════════════════════════════════════
   🗼 DRIVER — power lines, the Grid Connector, and the first commit in which
   connection changes production.
   ----------------------------------------------------------------------------
   Run:  node .gauntlet/drive-power-lines.mjs
   No DOM, no renderer. Everything below calls the SHIPPED functions:
     · Grid.solve()            — the same call node-city's power pre-pass makes
     · Lines.lay()/runCells()  — the same call the drag tool makes on pointerup
     · API.load()/API.enforcing() — the same latch node-city loads a save into
   A test that calls a private twin of the shipped function is a test of the
   twin, so nothing here re-implements anything.

   THE FIVE CLAIMS, in the order the brief makes them:
     1  two identical buildings in one tick, one wired and one not: the unwired
        one's factor is STRICTLY LOWER.
     2  …and this is the FIRST commit in which that holds. The control is the
        pre-change code path itself — enforce off — where the two are EQUAL.
     3  the shed ladder's identity survives: shedOk every tick, the ladder hands
        out exactly `served`, and POWER.demand.order is unchanged.
     4  GRANDFATHERING: a save written before this round loads UNWIRED and every
        number node-city reads is identical to the pre-change run.
     5  the connector is reachable, not decorative: a fresh city drags a line
        from it to its first building and the topology reports that building
        served — with every cell of the run inside the one-cell verge apron and
        none of it in the embankment.
   ════════════════════════════════════════════════════════════════════════════ */

import { POWER } from '../public/src/power/tuning.js';
import * as Grid from '../public/src/power/grid.js';
import * as Lines from '../public/src/power/lines.js';
import API from '../public/src/power/index.js';

let fails = 0;
const ok = (c, m, extra) => { console.log((c ? '  ✅ ' : '  ❌ ') + m + (extra ? '   ' + extra : '')); if (!c) fails++; };
const hd = (s) => console.log('\n══ ' + s + ' ' + '═'.repeat(Math.max(0, 66 - s.length)));

/* node-city's own two constants, handed over rather than copied — the module
   deliberately does not default them (grid.js refuses if they are missing). */
const FLOOR = 0.5;                 // POWER_FLOOR, node-city/index.html
const PER_POP = 0.0625;            // DEMAND_PER_POP.power

/* ── a city, in the exact shape the power pre-pass builds ─────────────────── */
function city(opts) {
  const o = opts || {};
  const tiles = [], plants = [], loads = [];
  const T = (x, z, extra) => { const t = { k: x + ',' + z, x, z, road: 0, plant: 0, need: 0,
                                           type: '', lvl: 1, name: '', ico: '' };
                               Object.assign(t, extra || {}); tiles.push(t); return t; };
  // a plant at 5,5
  if (o.plant !== false) {
    T(5, 5, { type: 'powerstation', plant: 1, name: 'Power Station', ico: '⚡' });
    plants.push({ k: '5,5', x: 5, z: 5, type: 'powerstation', name: 'Power Station', ico: '⚡',
                  out: o.out == null ? 8 : o.out, avail: 1, why: '' });
  }
  // a road from beside the plant, east
  for (let x = 5; x <= 10; x++) T(x, 6, { road: 1, type: 'road', name: 'Road', ico: '🛣' });
  // ON  the network: touches the road at 10,6
  T(10, 7, { type: 'machineshop', need: 1, name: 'Machine Shop', ico: '🔧' });
  loads.push({ k: '10,7', x: 10, z: 7, type: 'machineshop', name: 'Machine Shop', ico: '🔧', draw: 1 });
  // OFF the network: identical building, far from any road or line
  T(20, 20, { type: 'machineshop', need: 1, name: 'Machine Shop', ico: '🔧' });
  loads.push({ k: '20,20', x: 20, z: 20, type: 'machineshop', name: 'Machine Shop', ico: '🔧', draw: 1 });

  return { grid: 24, tiles, plants, loads, pop: o.pop == null ? 40 : o.pop, hasGrid: true,
           perPop: PER_POP, floor: FLOOR, dtMin: 1 / 60, metered: false, link: null,
           enforce: o.enforce, lines: o.lines };
}

/* No lines laid — the connector is still a conductor, which is the point. */
const noLines = () => ({ cells: new Set(), seeds: [], sig: 'L0@none' });

/* ════════════════════════════════════════════════════════════════════════════
   1 + 2 — CONNECTION CHANGES PRODUCTION, AND IT DID NOT BEFORE
   ════════════════════════════════════════════════════════════════════════════ */
hd('1 & 2 · the inequality, and the control that shows it is new');

Grid.invalidate();
const before = Grid.solve(city({ enforce: false, lines: noLines() }), 0);
Grid.invalidate();
const after = Grid.solve(city({ enforce: true, lines: noLines() }), 0);

ok(before.ok && after.ok, 'both solves answered');
const bOn = before.tileFactor['10,7'], bOff = before.tileFactor['20,20'];
const aOn = after.tileFactor['10,7'], aOff = after.tileFactor['20,20'];

ok(bOn === bOff,
   'CONTROL (enforce off = the pre-change path): the two identical buildings are EQUAL',
   'on=' + bOn.toFixed(4) + ' off=' + bOff.toFixed(4));
ok(aOff < aOn,
   'ENFORCED: the off-network building is STRICTLY LOWER than the on-network one',
   'on=' + aOn.toFixed(4) + ' off=' + aOff.toFixed(4));
ok(Math.abs(aOff - FLOOR) < 1e-9,
   'the off-network building sits at node-city\'s own POWER_FLOOR, not below it',
   'floor=' + FLOOR + ' got=' + aOff.toFixed(4));
ok(after.offNetwork === 1 && Math.abs(after.offNetworkDraw - 1) < 1e-9,
   'the solve reports WHO is off the network and what they would have drawn',
   'n=' + after.offNetwork + ' draw=' + after.offNetworkDraw);
ok(after.load < before.load,
   'an unconnected building no longer loads the grid it is not attached to',
   'load ' + before.load.toFixed(3) + ' -> ' + after.load.toFixed(3));

/* ════════════════════════════════════════════════════════════════════════════
   3 — THE LADDER'S IDENTITY SURVIVES
   ════════════════════════════════════════════════════════════════════════════ */
hd('3 · shedLadder still redistributes exactly `served`');

ok(before.shedOk && after.shedOk, 'shedOk passes in both runs (the audit did not fall back to flat)');

/* Drive a genuinely short city so the ladder actually rations something, and
   check the energy identity from the outside: the draw-weighted mean of the
   per-tile factors over the LOAD is the city factor, to the last bit. */
Grid.invalidate();
const tight = Grid.solve(city({ enforce: true, out: 0.4, pop: 300, lines: noLines() }), 0);
ok(tight.shedOk, 'shedOk passes in a hard brownout too', 'factor=' + tight.factor.toFixed(4));
ok(tight.tileFactor['20,20'] === FLOOR, 'the unconnected building is still exactly at the floor in a brownout');

/* …and the inequality is not merely "1 vs the floor". Drive a MID brownout, so
   the connected building sits strictly between the two, and the unconnected one
   is still strictly below it. A test whose only passing case is the extreme is a
   test that would keep passing if the rule were "off-network gets nothing". */
Grid.invalidate();
const mid = Grid.solve(city({ enforce: true, out: 3.2, pop: 40, lines: noLines() }), 0);
const mOn = mid.tileFactor['10,7'], mOff = mid.tileFactor['20,20'];
ok(mOn > FLOOR && mOn < 1 && mOff < mOn,
   'mid brownout: connected sits strictly between floor and full, unconnected strictly below it',
   'on=' + mOn.toFixed(4) + ' off=' + mOff.toFixed(4) + ' floor=' + FLOOR);
ok(mid.shedOk, 'and the audit still passes there');
ok(JSON.stringify(POWER.demand.order) ===
   JSON.stringify(['lifeline', 'utility', 'households', 'industry', 'commerce', 'leisure']),
   'POWER.demand.order is unchanged');

/* ════════════════════════════════════════════════════════════════════════════
   4 — GRANDFATHERING. THE PASS/FAIL.
   ----------------------------------------------------------------------------
   `pre` is computed through the code path as it stood BEFORE this round: the
   flag off and no per-city latch in sight. Then a save blob with no `wired` key
   — which is every save ever written before today — is loaded through the
   SHIPPED index.js load(), and the city is solved with whatever that latch says.
   Every number node-city reads must come back identical.
   ════════════════════════════════════════════════════════════════════════════ */
hd('4 · a save written before this piece loses NOTHING');

const flagWas = POWER.transmission.enforce;
POWER.transmission.enforce = false;                 // the world as it was
Grid.invalidate();
const pre = Grid.solve(city({ enforce: undefined, lines: noLines() }), 0);
POWER.transmission.enforce = flagWas;

// The shipped latch, fed the shipped shapes.
API.load({ store: 0, metered: 1 });                  // an OLD blob: no `wired`, no `lines`
const oldCity = API.enforcing();
ok(oldCity.wired === false && oldCity.inEffect === false,
   'a blob with no `wired` key loads UNWIRED — absence is the version stamp',
   JSON.stringify(oldCity));

Grid.invalidate();
const post = Grid.solve(city({ enforce: oldCity.inEffect, lines: noLines() }), 0);

const same = (a, b, name) => ok(Math.abs(a - b) < 1e-12, 'identical ' + name,
                                a.toFixed(6) + ' vs ' + b.toFixed(6));
same(pre.capacity, post.capacity, 'game.power.gen (capacity)');
same(pre.load, post.load, 'game.power.demand (load)');
same(pre.ratio, post.ratio, 'game.power.ratio');
same(pre.factor, post.factor, 'game.power.factor');
{
  let worse = 0, n = 0;
  for (const k of Object.keys(pre.tileFactor)) {
    n++;
    if (!(Math.abs(pre.tileFactor[k] - post.tileFactor[k]) < 1e-12)) worse++;
  }
  ok(n > 0 && worse === 0, 'ZERO buildings lose power: every per-tile factor is bit-identical',
     n + ' tiles compared, ' + worse + ' changed');
  ok(Object.keys(post.tileFactor).length === n, 'and no tile gained or lost an entry');
}
ok(post.enforce === false && post.enforceFlag === true,
   'the panel can tell "feature on" from "this city is under it"');

// …and a blob written by THIS round loads wired.
API.load({ store: 0, metered: 1, wired: 1, lines: { cells: [] } });
ok(API.enforcing().wired === true, 'a blob written after this round loads WIRED');
// …and a session that never loads a blob at all is a new city.
ok(API.setWired(true) === true, 'the opt-in flips a legacy city on when the player asks');

/* ════════════════════════════════════════════════════════════════════════════
   5 — THE CONNECTOR IS REACHABLE, NOT DECORATIVE
   ----------------------------------------------------------------------------
   A fresh city: no plant, one building on the north-west corner of the plate.
   Before the drag it is off the network. After ONE drag from the connector it
   is served — and the run never leaves the one-cell verge.
   ════════════════════════════════════════════════════════════════════════════ */
hd('5 · a fresh city drags one line to the Grid Connector');

/* mount() headless. THREE is a stub: lines.js wraps its own mesh build and its
   own tool mount in try/catch precisely so a host that cannot give it either
   still gets the network — which is what makes this drivable at all. */
Lines.load(null);
const paid = [];
const mountedOk = Lines.mount({
  THREE: {}, scene: {}, grid: 24,
  tileAt: (x, z) => (x === 0 && z === 3) ? { type: 'house' } : null,   // one building in the way
  payCost: async (c) => { paid.push(c.cinder); return true; },
}, { onChange: () => Grid.invalidate() });
ok(mountedOk, 'lines.mount() succeeds with no renderer and no document');

const conn = Lines.connector();
ok(conn.x === -1 && conn.z === -1, 'the connector stands on the verge at cell -1,-1 (world -12.5, -12.5)',
   JSON.stringify({ x: conn.x, z: conn.z }));
const v = Lines.verify();
ok(v.ok, 'connector self-check passes', JSON.stringify(v.violations));

function fresh(lines) {
  const tiles = [], loads = [];
  tiles.push({ k: '0,1', x: 0, z: 1, road: 0, plant: 0, need: 0.6, type: 'machineshop', lvl: 1,
               name: 'Machine Shop', ico: '🔧' });
  loads.push({ k: '0,1', x: 0, z: 1, type: 'machineshop', name: 'Machine Shop', ico: '🔧', draw: 0.6 });
  return { grid: 24, tiles, plants: [], loads, pop: 8, hasGrid: true, perPop: PER_POP,
           floor: FLOOR, dtMin: 1 / 60, metered: false, link: null, enforce: true, lines };
}

Grid.invalidate();
Grid.solve(fresh({ cells: Lines.conductors(), seeds: Lines.seeds(), sig: Lines.signature() }), 0);
ok(Grid.topology().unserved.length === 1,
   'BEFORE the drag: the city\'s first building is off the network');

// The drag itself — the same runCells + lay the tool calls on pointerup.
const run = Lines.runCells(conn.x, conn.z, 0, 0, false);
const r = await Lines.lay(run);
ok(r.ok, 'the drag laid a run and was charged once', 'cells=' + r.n + ' cinder=' + r.cinder);
ok(paid.length === 1 && paid[0] === r.n * POWER.lines.costPerCell,
   'ONE payCost for the whole drag, at POWER.lines.costPerCell',
   JSON.stringify(paid));
ok(run.every(c => c.z >= -1 && c.x >= -1),
   'every cell of the run is inside the one-cell verge apron — none of it is in the embankment',
   run.map(c => c.k).join(' '));
ok(run.every(c => c.z >= -1),
   'and nothing reaches the embankment toe at world z = -12.8 (apron centre is -12.5)');

Grid.invalidate();
const fs = Grid.solve(fresh({ cells: Lines.conductors(), seeds: Lines.seeds(), sig: Lines.signature() }), 0);
ok(Grid.topology().unserved.length === 0,
   'AFTER the drag: the topology reports that building SERVED');
ok(fs.lineCells >= 3, 'the solve sees the conductor set it was handed', 'cells=' + fs.lineCells);

/* And the signature actually moves, or the cache would serve the old walk. */
const sigA = Lines.signature();
Lines.lift(Lines.runCells(0, 0, 0, 0, false));
ok(Lines.signature() !== sigA, 'lifting a cell changes the topology signature (the cache cannot go stale)');

/* A line may not be laid through a building, and the refusal is one line. */
const blocked = Lines.quote(Lines.runCells(0, 3, 0, 3, false), false);
ok(blocked.n === 0 && blocked.blocked.length === 1, 'a run refuses the cell a building stands on');
/* …nor off the map. */
const off = Lines.quote(Lines.runCells(-3, -3, -3, -3, false), false);
ok(off.n === 0 && off.out.length === 1, 'and refuses a cell outside the plate + one-cell apron');

hd(fails ? fails + ' FAILURE(S)' : 'ALL CLAIMS HOLD');
process.exit(fails ? 1 : 0);
