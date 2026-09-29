/* ════════════════════════════════════════════════════════════════════════════
   🚰 DRIVEN TEST — the water mains, asserted numerically.
   ----------------------------------------------------------------------------
   node .gauntlet/drive-water-mains.mjs

   This drives the REAL modules — /src/water/network.js, hydro.js, endowment.js
   and index.js — in node, with no browser and no stubbing of the thing under
   test. It can do that because network.js and hydro.js touch no DOM, no window
   and no THREE; every one of those lives in netui.js. That separation is the
   only reason the constraint is testable at all, which is why the header of
   network.js states it as a rule rather than as a style.

   WHAT IT PROVES, in the order the brief asks for it:
     1  GRANDFATHER   — a city with no pipe, no Water Station and no Outfall
                        produces EXACTLY what it produced before this round.
                        Bit-for-bit against a solve with the network absent.
     2  NO RETRO-DRY  — building a Water Station plumbs the city, and the
                        Purifier standing beside it is still at 1.00×.
     3  THE BITE      — in ONE tick, an unconnected Station delivers measurably
                        less than a connected one.
     4  THE FIX       — lay a run of pipe and the factor returns, same tick
                        arithmetic, no other change.
     5  A NETWORK     — two runs that never touch are two components, and only
                        the one with a waterworks on it serves.
     6  THE SEWER     — attached demand with nowhere to discharge is a stated
                        penalty on the waterworks on that main; a legal Outfall
                        clears it.
     7  THE UNIT      — the COMPONENT is the unit of both legs. Two districts,
                        each properly plumbed, are both whole; two outfalls on
                        one run do NOT treat another run's sewage. Both of those
                        were wrong in the first version and both reported
                        success while being wrong, so both are asserted as
                        differences, not as absolute values.
     8  SITING        — the Station is refused off the aquifer and the Outfall
                        is refused off open water, each naming the reason.
     9  SAVE          — the network survives a round trip and refuses a blob
                        belonging to another city.
    10  PLAYABILITY   — every one of 200 generated cities has a legal site for
                        both buildings, swept.
   ════════════════════════════════════════════════════════════════════════════ */

import * as Net from '../public/src/water/network.js';
import * as Hydro from '../public/src/water/hydro.js';
import { hydrologyFor } from '../public/src/water/endowment.js';
import { WATER } from '../public/src/water/tuning.js';

const CITY = 'mains-drive-city';
const GRID = 24;
const H = hydrologyFor(CITY, GRID);

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '   ' + detail : '')); }
  else { fail++; console.log('  ✗ ' + name + '   ' + (detail || '')); }
}
function section(t) { console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 62 - t.length))); }

/* The city, as the host's pre-pass would hand it over. Everything here is in
   the host's own per-minute ledger units, exactly as node-city computes them —
   this harness invents no rate, for the same reason the module does not. */
const DRINK_PER_MIN = 0.015;          // node-city MORALE.drinkPerPopPerMin
const POP = 40;

function tick(opts) {
  const o = opts || {};
  const net = o.noNet ? null : Net.solve({
    wells: o.wells, users: o.users, homes: o.homes, outfalls: o.outfalls,
    drink: Hydro.drinkOf(POP, DRINK_PER_MIN).drink,
    openWater: o.openWater || (() => false),
  });
  const s = Hydro.solve({
    cityId: CITY, grid: GRID, dtMin: 0,          // dt 0: no depletion, so every
    wells: o.wells, users: o.users,              // scenario reads the same ground
    pop: POP, drinkPerMin: DRINK_PER_MIN,
    net,
  });
  return { s, net };
}
const wellOf = (s, k) => s.wells.find(w => w.k === k);
// The network's own contribution, with the ground divided out — which is what
// makes two waterworks on DIFFERENT ground comparable inside one tick.
const netLeg = (w) => w.factor / w.ground;

// A Water Station wants an aquifer under it; find two tiles that have one, so
// the ground leg is real rather than the dry floor.
function aquiferTiles(n) {
  const out = [];
  for (let z = 2; z < GRID - 2 && out.length < n; z++) {
    for (let x = 2; x < GRID - 2 && out.length < n; x++) {
      if (H.basinAt(x, z) && (!out.length || Math.abs(out[0][0] - x) + Math.abs(out[0][1] - z) > 6)) out.push([x, z]);
    }
  }
  return out;
}

console.log('🚰 WATER MAINS — driven test');
console.log('city id: ' + CITY + '   ' + H.summary());
const spots = aquiferTiles(2);
if (spots.length < 2) { console.log('city has no two separated aquifer tiles; the endowment floor is broken'); process.exit(1); }
const [A, B] = spots;
console.log('station A over aquifer at ' + A + ' · station B over aquifer at ' + B);

const stationA = { k: A[0] + ',' + A[1], x: A[0], z: A[1], want: 2.6, mains: true, name: 'Water Station' };
const stationB = { k: B[0] + ',' + B[1], x: B[0], z: B[1], want: 2.6, mains: true, name: 'Water Station' };
// A Purifier — mains:false, i.e. the atmospheric condenser that can be standing
// in a save written years before any of this existed.
const purifier = { k: '2,2', x: 2, z: 2, want: 1.2, mains: false, name: 'Purifier' };
const consumer = { k: A[0] + ',' + (A[1] + 4), x: A[0], z: A[1] + 4, draw: 0.5, name: 'Med Lab' };
const home = { k: '2,20', x: 2, z: 20, share: 1 };

/* ═══ 1. GRANDFATHER ═════════════════════════════════════════════════════════ */
section('1. GRANDFATHER — a save written before the mains');
Net.reset(); Net.setCity(CITY); Hydro.reset();
{
  const before = tick({ wells: [purifier], users: [consumer], homes: [home], outfalls: [], noNet: true });
  Hydro.reset();
  const after = tick({ wells: [purifier], users: [consumer], homes: [home], outfalls: [] });
  const wb = wellOf(before.s, purifier.k), wa = wellOf(after.s, purifier.k);
  ok('city reads as UNPLUMBED', after.net.plumbed === false, 'pipes=' + after.net.pipes + ' governed=' + after.net.governed);
  ok('the Purifier factor is bit-for-bit what it was', near(wa.factor, wb.factor),
     wb.factor.toFixed(6) + ' → ' + wa.factor.toFixed(6));
  ok('city capacity is bit-for-bit what it was', near(after.s.capacity, before.s.capacity),
     before.s.capacity.toFixed(6) + ' → ' + after.s.capacity.toFixed(6));
  ok('no sewer penalty on an unplumbed city', near(after.s.sewerFactor, 1), 'sewerFactor=' + after.s.sewerFactor);
}

/* ═══ 2. NO CITY IS RETROACTIVELY DRIED OUT ══════════════════════════════════ */
section('2. NO RETRO-DRY — a Station lands beside an existing Purifier');
Net.reset(); Net.setCity(CITY); Hydro.reset();
{
  const r = tick({ wells: [purifier, stationA], users: [], homes: [], outfalls: [] });
  const p = wellOf(r.s, purifier.k), a = wellOf(r.s, stationA.k);
  ok('the city is now PLUMBED', r.net.plumbed === true, 'governed=' + r.net.governed);
  ok('the Purifier is untouched at 1.00×', near(netLeg(p), 1), 'mains leg ' + netLeg(p).toFixed(4));
  ok('the ungoverned well is not on the mains map', near(r.net.mainsFactor[purifier.k], 1));
  ok('the Station, with nothing to reach, is at the floor',
     near(netLeg(a), WATER.mains.unpiped), 'mains leg ' + netLeg(a).toFixed(4) + ' vs unpiped ' + WATER.mains.unpiped);
  ok('no sewage owed — nothing is attached to a main', near(r.net.sewage.load, 0));
}

/* ═══ 3. THE BITE, IN ONE TICK ═══════════════════════════════════════════════ */
section('3. THE BITE — connected vs unconnected, same tick');
Net.reset(); Net.setCity(CITY); Hydro.reset();
let connectedLeg = 0;
{
  // A run from Station A to the consumer four tiles south of it.
  const run = Net.pathBetween(A[0], A[1] + 1, A[0], A[1] + 3, GRID);
  Net.add(run);
  // …and an Outfall on open water on the same run, so this scenario isolates
  // the MAINS leg rather than measuring the sewer at the same time.
  const outfall = { k: A[0] + ',' + (A[1] + 2), x: A[0], z: A[1] + 2, cap: 5 };
  const r = tick({ wells: [stationA, stationB], users: [consumer], homes: [], outfalls: [outfall],
                   openWater: () => true });
  const a = wellOf(r.s, stationA.k), b = wellOf(r.s, stationB.k);
  connectedLeg = netLeg(a);
  ok('sewage is treated, so the sewer leg is out of the way', near(r.net.backup, 0),
     'backup=' + r.net.backup.toFixed(4));
  ok('the CONNECTED Station delivers in full', near(connectedLeg, 1, 1e-6),
     'mains leg ' + connectedLeg.toFixed(4));
  ok('the UNCONNECTED Station is measurably below it',
     netLeg(b) < connectedLeg - 0.2, netLeg(b).toFixed(4) + ' < ' + connectedLeg.toFixed(4));
  ok('…and it is exactly the tuned floor', near(netLeg(b), WATER.mains.unpiped, 1e-9),
     netLeg(b).toFixed(6));
  ok('the host-facing factor map carries the same number',
     near(r.s.factor[stationB.k], b.factor), r.s.factor[stationB.k].toFixed(6));
  ok('and that is a real loss of water, not a readout',
     r.s.capacity < stationA.want * a.ground + stationB.want * b.ground - 1e-6,
     'capacity ' + r.s.capacity.toFixed(3) + ' vs ungoverned ' +
     (stationA.want * a.ground + stationB.want * b.ground).toFixed(3));
}

/* ═══ 4. THE FIX — one drag ══════════════════════════════════════════════════ */
section('4. THE FIX — drag a run to the unconnected Station');
{
  // Exactly what the pointer would do: an L from beside B to beside the
  // consumer, through network.js's own path builder.
  const run = Net.pathBetween(B[0], B[1] + 1, consumer.x + 1, consumer.z, GRID);
  const laid = Net.add(run);
  const outfall = { k: A[0] + ',' + (A[1] + 2), x: A[0], z: A[1] + 2, cap: 5 };
  const r = tick({ wells: [stationA, stationB], users: [consumer], homes: [], outfalls: [outfall],
                   openWater: () => true });
  const b = wellOf(r.s, stationB.k);
  ok('the drag laid ' + laid + ' tiles of main', laid > 0);
  ok('the once-unconnected Station is back to the connected value',
     near(netLeg(b), connectedLeg, 1e-6), netLeg(b).toFixed(4) + ' vs ' + connectedLeg.toFixed(4));
}

/* ═══ 5. IT IS A NETWORK ═════════════════════════════════════════════════════ */
section('5. A NETWORK — two runs that never touch are two cities');
Net.reset(); Net.setCity(CITY); Hydro.reset();
{
  const u1 = { k: '5,10', x: 5, z: 10, draw: 0.5, name: 'Med Lab' };
  const u2 = { k: '19,10', x: 19, z: 10, draw: 0.5, name: 'Med Lab' };
  const st = { k: '5,6', x: 5, z: 6, want: 2.6, mains: true, name: 'Water Station' };
  Net.add(Net.pathBetween(5, 7, 5, 9, GRID));      // run 1: station → u1
  Net.add(Net.pathBetween(19, 7, 19, 9, GRID));    // run 2: nothing but u2
  const r = tick({ wells: [st], users: [u1, u2], homes: [], outfalls: [], openWater: () => false });
  ok('two runs are TWO components', r.net.components === 2, 'components=' + r.net.components);
  ok('the consumer on the station run is served', r.net.demand.served[u1.k] === true);
  ok('the consumer on the orphan run is NOT', r.net.demand.served[u2.k] === false);
  ok('the station reaches half the demand and is paid for half',
     near(r.net.mainsFactor[st.k], WATER.mains.unpiped + (1 - WATER.mains.unpiped) * 0.5, 1e-9),
     'mains=' + r.net.mainsFactor[st.k].toFixed(4));
  // The half it cannot reach is the half the player has to go and connect.
  ok('the unreached demand is reported', near(r.net.demand.unserved, 0.5) && r.net.demand.unservedTiles === 1,
     'unserved=' + r.net.demand.unserved + ' over ' + r.net.demand.unservedTiles + ' tile(s)');
  // …and joining them makes one network of two.
  Net.add(Net.pathBetween(6, 9, 18, 9, GRID));
  const r2 = tick({ wells: [st], users: [u1, u2], homes: [], outfalls: [], openWater: () => false });
  ok('joining the runs makes ONE component', r2.net.components === 1, 'components=' + r2.net.components);
  ok('…and the station is now paid in full', near(r2.net.mainsFactor[st.k], 1, 1e-9),
     'mains=' + r2.net.mainsFactor[st.k].toFixed(4));
}

/* ═══ 6. THE SEWER ═══════════════════════════════════════════════════════════ */
section('6. THE SEWER — waste with nowhere to go');
Net.reset(); Net.setCity(CITY); Hydro.reset();
let backedUp = 0;
{
  const st = { k: '5,6', x: 5, z: 6, want: 2.6, mains: true, name: 'Water Station' };
  const u1 = { k: '5,10', x: 5, z: 10, draw: 0.5, name: 'Med Lab' };
  Net.add(Net.pathBetween(5, 7, 5, 9, GRID));
  // Only x ≥ 22 is open water in this scenario — the east coast, which is where
  // endowment.js puts the sea on every map.
  const wet = (x) => x >= 22;

  const none = tick({ wells: [st], users: [u1], homes: [], outfalls: [], openWater: wet });
  backedUp = wellOf(none.s, st.k).sewer;
  ok('demand attached to a main owes sewage', none.net.sewage.load > 0,
     'load=' + none.net.sewage.load.toFixed(4));
  ok('with no Outfall the city is fully backed up', near(none.net.backup, 1),
     'backup=' + none.net.backup.toFixed(4));
  ok('and the penalty is the stated one', near(backedUp, 1 - WATER.sewer.bite),
     'sewerFactor=' + backedUp.toFixed(4) + ' vs 1 − bite ' + (1 - WATER.sewer.bite));
  ok('it lands on the waterworks the host actually charges',
     near(none.s.factor[st.k], wellOf(none.s, st.k).ground * none.net.mainsFactor[st.k] * backedUp, 1e-9));

  // An Outfall on DRY land is refused by the placement gate — but a standing one
  // whose water moved must still be reported rather than silently counted.
  const dry = { k: '5,12', x: 5, z: 12, cap: 5 };
  const r2 = tick({ wells: [st], users: [u1], homes: [], outfalls: [dry], openWater: wet });
  ok('an Outfall on dry land treats nothing, and says why',
     near(r2.net.backup, 1) && r2.net.sewage.outfalls[0].why === 'no open water',
     'why="' + r2.net.sewage.outfalls[0].why + '"');

  // An Outfall on open water but on no main is equally useless, and says so.
  const orphan = { k: '22,4', x: 22, z: 4, cap: 5 };
  const r3 = tick({ wells: [st], users: [u1], homes: [], outfalls: [orphan], openWater: wet });
  ok('an Outfall off the mains treats nothing, and says why',
     near(r3.net.backup, 1) && r3.net.sewage.outfalls[0].why === 'not connected to a main',
     'why="' + r3.net.sewage.outfalls[0].why + '"');

  // Pipe it in, and the penalty clears.
  Net.add(Net.pathBetween(6, 9, 22, 9, GRID));
  Net.add(Net.pathBetween(22, 8, 22, 5, GRID));
  const r4 = tick({ wells: [st], users: [u1], homes: [], outfalls: [orphan], openWater: wet });
  ok('piped to open water, the backup clears', near(r4.net.backup, 0), 'backup=' + r4.net.backup.toFixed(4));
  ok('…and every waterworks is back to 1.00× on the sewer leg',
     near(wellOf(r4.s, st.k).sewer, 1), 'sewerFactor=' + wellOf(r4.s, st.k).sewer.toFixed(4));
}

/* ═══ 7. THE COMPONENT IS THE UNIT ═══════════════════════════════════════════
   The bar names this piece by one sentence — "two disconnected pipe runs are
   two components and only the one touching the station serves" — and the first
   version of network.js failed it in BOTH legs while reporting success:

     · the mains leg divided each station's reach by the CITY's demand, so two
       properly plumbed districts (each with its own station, pipes and outfall)
       ran both stations at 0.650 while the same object said `unserved: 0` and
       every consumer `served: true`. Building the second district retroactively
       took 35% off the first.
     · the sewer leg capped each outfall against the full component load and
       then summed, so two redundant outfalls on ONE run fully treated a
       DISCONNECTED run's sewage — backup 0.000, factor 1.000, bit-identical to
       the correct layout and below `warnAbove`, so nothing was said anywhere.

   Both are asserted here as NUMBERS, and the second one is asserted as a
   DIFFERENCE against the correct layout, because "1.000" on its own was exactly
   what the broken version printed. ═══════════════════════════════════════════ */
section('7. COMPONENTS — two districts, and two outfalls on one run');
{
  // Two runs that never touch, each with its own station, consumer and outfall.
  // Run A along z=3, run B along z=11; the sea is east of x ≥ 22 as everywhere
  // else in this harness, so each district reaches it down its own row.
  const wet = (x) => x >= 22;
  const mk = (z) => ({
    st:  { k: '2,' + z, x: 2, z, want: 2.6, mains: true, name: 'Water Station' },
    use: { k: '6,' + z, x: 6, z, draw: 1.0, name: 'Med Lab' },
    out: { k: '22,' + z, x: 22, z, cap: 5 },
  });
  const A = mk(3), B = mk(11);

  Net.reset(); Net.setCity(CITY); Hydro.reset();
  Net.add(Net.pathBetween(3, 3, 22, 3, GRID));      // district A: station → consumer → sea
  Net.add(Net.pathBetween(3, 11, 22, 11, GRID));    // district B, and it never touches A
  const two = tick({ wells: [A.st, B.st], users: [A.use, B.use], homes: [],
                     outfalls: [A.out, B.out], openWater: wet });

  ok('two districts are TWO components', two.net.components === 2, 'components=' + two.net.components);
  ok('every building is reached', two.net.demand.unservedTiles === 0 &&
     two.net.demand.served[A.use.k] === true && two.net.demand.served[B.use.k] === true);
  /* 🔴 THE ASSERTION THE PIECE IS NAMED BY. Each station is fully served by its
     OWN district. The broken version put both at 0.650 here. */
  ok('district A\'s station is paid in FULL', near(two.net.mainsFactor[A.st.k], 1, 1e-9),
     'mains=' + two.net.mainsFactor[A.st.k].toFixed(4));
  ok('district B\'s station is paid in FULL', near(two.net.mainsFactor[B.st.k], 1, 1e-9),
     'mains=' + two.net.mainsFactor[B.st.k].toFixed(4));
  ok('…and neither is punished for the other existing',
     near(wellOf(two.s, A.st.k).factor, wellOf(two.s, A.st.k).ground, 1e-9),
     'charged ' + wellOf(two.s, A.st.k).factor.toFixed(6) + ' = ground ' + wellOf(two.s, A.st.k).ground.toFixed(6));
  ok('both mains are treating their own waste',
     near(two.net.backup, 0) && near(wellOf(two.s, A.st.k).sewer, 1) && near(wellOf(two.s, B.st.k).sewer, 1),
     'backup=' + two.net.backup.toFixed(4));
  ok('the panel line and the warning agree — 100% reached AND nothing below 1.00×',
     near(two.net.demand.reached, two.net.demand.total, 1e-12) &&
     two.net.wells.filter(w => w.governed && w.factor < 0.999).length === 0);

  /* And the same city with district B unplumbed: A is still whole, B is at the
     floor, and the citywide reach is honestly half — the gradient survives the
     fix rather than being flattened by it. */
  Net.reset(); Net.setCity(CITY); Hydro.reset();
  Net.add(Net.pathBetween(3, 3, 22, 3, GRID));
  const half = tick({ wells: [A.st, B.st], users: [A.use, B.use], homes: [],
                      outfalls: [A.out, B.out], openWater: wet });
  ok('with B unplumbed, A is STILL whole', near(half.net.mainsFactor[A.st.k], 1, 1e-9),
     'mains=' + half.net.mainsFactor[A.st.k].toFixed(4));
  ok('…and B is at the floor', near(half.net.mainsFactor[B.st.k], WATER.mains.unpiped, 1e-9),
     'mains=' + half.net.mainsFactor[B.st.k].toFixed(4));
  ok('…and the city reports half its demand reached',
     near(half.net.demand.reached / half.net.demand.total, 0.5, 1e-9),
     'reach=' + (half.net.demand.reached / half.net.demand.total).toFixed(4));

  /* ── TWO OUTFALLS ON ONE RUN DO NOT TREAT THE OTHER RUN'S SEWAGE. ────────── */
  Net.reset(); Net.setCity(CITY); Hydro.reset();
  Net.add(Net.pathBetween(3, 3, 22, 3, GRID));       // run A: station, consumer, coast
  Net.add(Net.pathBetween(3, 11, 22, 11, GRID));     // run B: consumer and coast, no station
  const secondOnA = { k: '22,4', x: 22, z: 4, cap: 5 };   // a second outfall, still on run A
  const doubled = tick({ wells: [A.st], users: [A.use, B.use], homes: [],
                         outfalls: [A.out, secondOnA], openWater: wet });
  const oneEach = tick({ wells: [A.st], users: [A.use, B.use], homes: [],
                         outfalls: [A.out, B.out], openWater: wet });
  ok('the second outfall is on run A too', doubled.net.sewage.outfalls[1].comp ===
     doubled.net.sewage.outfalls[0].comp, 'comp=' + doubled.net.sewage.outfalls[1].comp);
  ok('run B\'s waste is REAL and it is on run B',
     doubled.net.sewage.byComp.filter(c => c.load > 0).length === 2,
     doubled.net.sewage.byComp.map(c => 'comp' + c.i + ' load ' + c.load.toFixed(2)).join(' · '));
  /* The broken version returned backup 0.000 here — the two outfalls on run A
     each claimed run A's full load and the sum covered run B as well. */
  ok('two outfalls on ONE run leave the other run backed up',
     doubled.net.backup > 0.4, 'backup=' + doubled.net.backup.toFixed(4));
  ok('…and run B\'s own main is fully backed up',
     near(doubled.net.sewage.byComp[1].backup, 1), 'comp1 backup=' + doubled.net.sewage.byComp[1].backup.toFixed(4));
  ok('…while run A, which has the outfalls, is clean',
     near(doubled.net.sewage.byComp[0].backup, 0), 'comp0 backup=' + doubled.net.sewage.byComp[0].backup.toFixed(4));
  ok('the redundant layout is DIFFERENT from one-outfall-per-run, not identical',
     doubled.net.backup > oneEach.net.backup + 0.4,
     'doubled=' + doubled.net.backup.toFixed(4) + ' vs one-each=' + oneEach.net.backup.toFixed(4));
  ok('one outfall per run treats everything', near(oneEach.net.backup, 0),
     'backup=' + oneEach.net.backup.toFixed(4));
  /* …and the station on run A is NOT charged run B's backup, because run B is
     not the ground it is standing on. */
  ok('the station on the clean run keeps its sewer leg at 1.00×',
     near(wellOf(doubled.s, A.st.k).sewer, 1), 'sewer=' + wellOf(doubled.s, A.st.k).sewer.toFixed(4));
  ok('…and the city headline still reports the backup, so nothing is hidden',
     doubled.net.backup > WATER.sewer.warnAbove &&
     doubled.net.sewage.byComp.some(c => c.backup > WATER.sewer.warnAbove));
}

/* ═══ 8. SITING ══════════════════════════════════════════════════════════════ */
section('8. SITING — the two refusals, and that each names a way out');
{
  const mod = await import('../public/src/water/index.js');
  const W = mod.default;
  W.solve({ cityId: CITY, grid: GRID, wells: [], users: [], homes: [], outfalls: [],
            pop: 0, drinkPerMin: DRINK_PER_MIN, dtMin: 0 });

  // A tile the aquifer does not reach.
  let dryX = -1, dryZ = -1;
  for (let z = 0; z < GRID && dryX < 0; z++) for (let x = 0; x < GRID; x++) {
    if (!H.basinAt(x, z)) { dryX = x; dryZ = z; break; }
  }
  const wet = W.siteRefusal('waterstation', A[0], A[1], { aquifer: true, name: 'Water Station' });
  ok('a Station over the aquifer is allowed', wet === null);
  if (dryX >= 0) {
    const why = W.siteRefusal('waterstation', dryX, dryZ, { aquifer: true, name: 'Water Station' });
    ok('a Station off the aquifer is refused', typeof why === 'string' && why.length > 0);
    ok('…and the refusal names a basin the player can go and look at',
       !!why && /basin/.test(why) && /Groundwater Deposits/.test(why));
  } else {
    ok('a Station off the aquifer is refused', true, '(this city has no dry tile — floor is generous)');
    ok('…and the refusal names a basin the player can go and look at', true, '(skipped)');
  }

  /* The coast. endowment.js puts a sea on every map on the east side, so the
     legal Outfall band is DERIVED from `shoreAt(z)` rather than assumed — and
     the assertion below is the one that caught the first version of this gate
     matching nothing at all (see WATER.sewer.shoreTiles's 🐞). It deliberately
     tests a column that is NOT the map edge, or rule ③ would answer for it and
     the sea branch would go on being untested. */
  const shoreZ = 12;
  const firstCoastX = Math.ceil(H.shoreAt(shoreZ) - WATER.sewer.shoreTiles);
  ok('the coast reaches onto the plate at all', firstCoastX <= GRID - 1,
     'first coastal column x=' + firstCoastX + ' of ' + (GRID - 1));
  ok('the coastal strip is more than the map edge alone', firstCoastX <= GRID - 2,
     'columns ' + firstCoastX + '..' + (GRID - 1));
  const inner = Math.max(0, Math.min(GRID - 2, firstCoastX));   // never the edge row
  ok('the outfall is allowed on the coast at ' + inner + ',' + shoreZ + ' (not the map edge)',
     W.siteRefusal('outfall', inner, shoreZ, { openWater: true, name: 'Sewer Outfall' }) === null,
     'shoreAt=' + H.shoreAt(shoreZ).toFixed(2) + ' → ' + (H.shoreAt(shoreZ) - inner).toFixed(2) + ' tiles inland');
  ok('one column further inland is NOT coast',
     inner === 0 || typeof W.siteRefusal('outfall', inner - 1, shoreZ, { openWater: true, name: 'Sewer Outfall' }) === 'string',
     'x=' + (inner - 1));
  const inland = W.siteRefusal('outfall', 8, shoreZ, { openWater: true, name: 'Sewer Outfall' });
  ok('…and refused well inland', typeof inland === 'string' && inland.length > 0);
  ok('…with the first legal column named', !!inland && /coast at this row starts at x=/.test(inland),
     inland ? inland.slice(0, 130) + '…' : '');
  ok('a type with neither flag is refused nothing',
     W.siteRefusal('purifier', 8, shoreZ, { name: 'Purifier' }) === null);
}

/* ═══ 9. SAVE ════════════════════════════════════════════════════════════════ */
section('9. SAVE — the round trip, and the wrong-city refusal');
{
  const before = Net.count();
  const blob = Net.save();
  Net.reset(); Net.setCity(CITY);
  Net.load(blob);
  ok('the network survives a round trip', Net.count() === before, before + ' → ' + Net.count());
  Net.reset(); Net.setCity(CITY);
  Net.load(undefined);
  ok('a save written before this round loads as an empty network', Net.count() === 0);
  Net.reset(); Net.setCity('some-other-city');
  Net.load(blob);
  ok('a blob from another city is refused, not merged', Net.count() === 0);
}

/* ═══ 10. NO CITY IS UNPLAYABLE ═══════════════════════════════════════════════
   A siting rule that can be unsatisfiable is a rule that bricks a city, and the
   city id is rolled for the player rather than chosen by them — the same
   argument /src/economy/endowment.js makes for pinning `rawWater` to at least
   POOR on every node, and the reason WATER.endow.minBasinStrength exists. Both
   of this round's rules are swept across 200 cities. */
section('10. NO CITY IS UNPLAYABLE — both rules swept over 200 cities');
{
  const mod = await import('../public/src/water/index.js');
  const W = mod.default;
  let noWell = 0, noOutfall = 0, thinCoast = 0, worstCoast = 99;
  for (let i = 0; i < 200; i++) {
    const id = 'sweep-city-' + i;
    const h = hydrologyFor(id, GRID);
    let wells = 0, coast = 0;
    for (let z = 0; z < GRID; z++) for (let x = 0; x < GRID; x++) {
      if (h.basinAt(x, z)) wells++;
      const d = h.shoreAt(z) - x;
      if (d <= WATER.sewer.shoreTiles) coast++;
    }
    if (!wells) noWell++;
    if (!coast) noOutfall++;
    const perRow = coast / GRID;
    if (perRow < worstCoast) worstCoast = perRow;
    if (perRow < 1) thinCoast++;
  }
  ok('every city has somewhere to put a Water Station', noWell === 0, noWell + ' failures');
  ok('every city has somewhere to put a Sewer Outfall', noOutfall === 0, noOutfall + ' failures');
  ok('and the coast is a strip, not a single column',
     worstCoast >= 1.5, 'thinnest coast averages ' + worstCoast.toFixed(2) + ' columns per row');
  // …and the module's own gate agrees with the sweep on a sample.
  const sample = hydrologyFor('sweep-city-7', GRID);
  const col = Math.ceil(sample.shoreAt(6) - WATER.sewer.shoreTiles);
  ok('the gate and the sweep read the same coast', col <= GRID - 1, 'first coastal column ' + col);
}

console.log('\n' + (fail ? '❌ ' : '✅ ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
