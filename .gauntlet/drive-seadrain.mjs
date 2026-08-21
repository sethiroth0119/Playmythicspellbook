/* 🌊 DRIVEN CHECK — the sewer round: intake, station, and a drain in the sea.
   node .gauntlet/drive-seadrain.mjs
   network.js is deliberately node-importable (no DOM, no window, no THREE), so
   every structural claim this round makes is checkable here rather than in a
   photograph. Silence is NOT a pass: this one prints, because it is a driver and
   not a self-check. */
import * as Net from '../public/src/water/network.js';
import { WATER } from '../public/src/water/tuning.js';

const G = 24, A = WATER.sewer.drain.apron;
let fails = 0;
const ok = (name, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra != null ? '   ' + extra : ''));
};
const K = (x, z) => x + ',' + z;
/* THE SEA PREDICATE, STUBBED THE WAY MythicOcean ANSWERS IT. Measured in the
   real module: the waterline is world 13.753…14.349, cell x=26 is world 14.50,
   cells 24 and 25 are 12.50 and 13.50. So "x >= 24 + 2" is exactly what
   MythicOcean.isSea returns for the apron, in every city and every row. */
const sea = (x) => x >= G + A - 1;

function run(x0, z, x1) { const out = []; for (let x = x0; x <= x1; x++) out.push(K(x, z)); return out; }

function district(z, wellX) {
  return {
    well: { k: K(wellX, z), x: wellX, z, want: 2.6, mains: true },
    home: { k: K(wellX, z + 1), x: wellX, z: z + 1, share: 0.5 },
  };
}

function solveWith(dA, dB, drink) {
  return Net.solve({
    wells: [dA.well, dB.well],
    users: [],
    homes: [dA.home, dB.home],
    outfalls: [],
    drink,
    openWater: () => false,          // no river, no lake, no map edge in this city
    sea: (x) => sea(x),
  });
}

console.log('\n🌊 SEWER ROUND — network.js driven check\n');

Net.reset();
Net.setDomain(A);
Net.setCity('city-alpha');

// ── 1. THE DOMAIN AND THE TRUNCATION ────────────────────────────────────────
{
  const d = Net.domain(G);
  ok('domain runs ' + A + ' columns east of the plate', d.x1 === G - 1 + A, JSON.stringify(d));
  ok('domain does NOT grow in z', d.z1 === G - 1);
  const p = Net.pathBetween(0, 5, 999, 5, G);
  ok('pathBetween clamps x to the apron, not the plate', p[p.length - 1] === K(G - 1 + A, 5), p[p.length - 1]);
  /* The longest L the domain allows is 27 + 23 = 50 cells, which is past the
     48-cell cap — so the cap is reachable and the truncation is testable. It
     happens INSIDE pathBetween, which is the whole reason the number on the
     strip is the number the player is charged. */
  const long = Net.pathBetween(0, 0, G - 1 + A, G - 1, G);
  ok('SHOWN = BILLED: a run past the cap is truncated INSIDE pathBetween',
     long.length === WATER.mains.maxRun, long.length + ' cells, cap ' + WATER.mains.maxRun);
}

// ── 2. ONE COMPONENT ACROSS THE SHORELINE ───────────────────────────────────
const A_ = district(5, 5), B_ = district(15, 5);
Net.add(run(5, 5, G - 1 + A));      // district A: station → out to the water
Net.add(run(5, 15, G - 1 + A));     // district B: the same, ten rows south
Net.addDrain([K(G - 1 + A, 5), K(G - 1 + A, 15)]);

{
  const c = Net.components();
  ok('two districts are TWO components', c.count === 2, 'count=' + c.count);
  ok('the last plate cell and the first apron cell are ONE component',
     c.id[K(G - 1, 5)] === c.id[K(G, 5)] && c.id[K(G, 5)] !== undefined,
     'plate=' + c.id[K(G - 1, 5)] + ' apron=' + c.id[K(G, 5)]);
  ok('the drain cell is on the same component as the station',
     c.id[K(G - 1 + A, 5)] === c.id[K(5, 5)]);
}

const before = solveWith(A_, B_, 4.0);
const compOf = (s, x, z) => s.comp.id[K(x, z)];
const rowOf = (s, x, z) => s.sewage.byComp[compOf(s, x, z)];

{
  ok('the city is plumbed', before.plumbed);
  ok('both drains are LIVE (in the sea AND on a main)', before.drainsLive === 2,
     before.drainsLive + ' of ' + before.drains);
  ok('a drain in the sea carries the tuned nameplate',
     rowOf(before, 5, 5).nameplate === WATER.sewer.drain.cap, rowOf(before, 5, 5).nameplate);
  ok('nothing is backing up anywhere', before.backup === 0, before.backup);
}

// ── 3. LIFT ONE PIPE — the per-component regression this solve exists to stop ─
/* 🔴 EVERY FIELD EXCEPT `i`. `i` is the row's index in a list that is re-derived
   from a flood fill every solve, so cutting district A renumbers district B's
   row without changing one thing about district B. Asserting on `i` would be
   asserting that a flood fill visits cells in a particular order, which is not a
   promise this file makes and not what the player experiences. Every number that
   IS the player's experience is compared. */
const money = (r) => JSON.stringify({ size: r.size, demand: r.demand, wells: r.wells, load: r.load,
                                      nameplate: r.nameplate, treated: r.treated,
                                      backup: r.backup, sewer: r.sewer });
const snapB = money(rowOf(before, 5, 15));
Net.remove([K(15, 5)]);             // cut district A's main in half
const after = solveWith(A_, B_, 4.0);

{
  const c = Net.components();
  ok('lifting one pipe makes district A TWO components', c.count === 3, 'count=' + c.count);
  const stationSide = rowOf(after, 5, 5);
  ok('the station side of the cut now has NO sewer nameplate', stationSide.nameplate === 0, stationSide.nameplate);
  ok('…and it is backing up', stationSide.backup > 0, stationSide.backup.toFixed(3));
  /* The severed drain is STILL live — it is in the sea and it is on a main. It
     is simply on a main with no demand on it now, which is exactly what the
     station side's nameplate of 0 says from the other end. `live` means "wet and
     connected", the same as it has always meant for a Sewer Outfall, and calling
     a correctly built drain dead because the player cut a pipe ten tiles away
     would be the overlay telling them they built it wrong. */
  ok('the severed drain is still wet and connected — the CUT is what moved',
     after.drainsLive === 2 && rowOf(after, G - 1 + A, 5).nameplate === WATER.sewer.drain.cap,
     after.drainsLive + ' live, drain-side nameplate ' + rowOf(after, G - 1 + A, 5).nameplate);
  /* 🔴 THE WHOLE POINT. The first version of network.js divided by CITY totals
     and a correctly plumbed second district lost 35% for the crime of existing.
     District B was not touched; every number on its row must be identical. */
  ok('🔴 district B is UNCHANGED, number for number', money(rowOf(after, 5, 15)) === snapB,
     money(rowOf(after, 5, 15)));
  ok('…including its waterworks factor',
     after.sewerAt[B_.well.k] === before.sewerAt[B_.well.k],
     after.sewerAt[B_.well.k] + ' vs ' + before.sewerAt[B_.well.k]);
}

// ── 4. A DRAIN THAT IS NOT IN THE SEA IS NOT LIVE, AND SAYS WHY ─────────────
{
  Net.addDrain([K(G, 20)]);         // first apron column: measured to be dry land
  Net.add(run(5, 20, G));
  const s = Net.solve({ wells: [], users: [], homes: [], outfalls: [], drink: 0,
                        openWater: () => false, sea: (x) => sea(x) });
  const row = s.sewage.outfalls.find(o => o.k === K(G, 20));
  ok('a drain on the dry apron is not live', row && !row.live);
  ok('…and the row names the reason', row && row.why === 'not in the sea', row && row.why);
  Net.removeDrain([K(G, 20)]);
  Net.remove(run(5, 20, G));
}

// ── 5. SAVE INTEGRITY ───────────────────────────────────────────────────────
{
  const blob = Net.save();
  ok('the blob carries the city id', blob.cityId === 'city-alpha', blob.cityId);
  ok('the blob carries the drains under `d`', typeof blob.d === 'string' && blob.d.length > 0, blob.d);
  const pipes = Net.count(), drains = Net.drainCount();

  Net.load(blob, G);
  ok('round trip restores every pipe', Net.count() === pipes, Net.count() + '/' + pipes);
  ok('round trip restores every drain', Net.drainCount() === drains, Net.drainCount() + '/' + drains);

  Net.load({ v: 1, cityId: 'city-beta', p: '1,1 1,2', d: '26,3' }, G);
  ok('🔴 a blob from ANOTHER city is REFUSED, not merged', Net.count() === 0 && Net.drainCount() === 0,
     Net.count() + ' pipes, ' + Net.drainCount() + ' drains');

  Net.load(blob, G);
  ok('…and the right blob still loads afterwards', Net.count() === pipes && Net.drainCount() === drains);

  // grandfathering: a pre-round blob has no `d` at all
  Net.load({ v: 1, cityId: 'city-alpha', p: '3,3 3,4' }, G);
  ok('a save written BEFORE this round loads as no drains, no version number',
     Net.count() === 2 && Net.drainCount() === 0);
  const idle = Net.idle();
  ok('…and an untouched city is the identity', idle.plumbed === false && idle.sewerFactor === 1);

  // out-of-domain cells are dropped, never clamped
  Net.load({ v: 1, cityId: 'city-alpha', p: '3,3', d: '99,3 26,3' }, G);
  ok('an out-of-domain drain is DROPPED, not clamped onto a legal cell',
     Net.drainCount() === 1 && Net.hasDrain(K(26, 3)), Net.drainKeys().join(' '));
}

// ── 6. NO SECOND COASTLINE ──────────────────────────────────────────────────
{
  /* network.js must never work out where the water is. It is handed `sea` and it
     asks it; if the caller hands over nothing, no drain is ever live — the safe
     direction. */
  Net.reset(); Net.setDomain(A); Net.setCity('c');
  Net.add(run(5, 5, G - 1 + A));
  Net.addDrain([K(G - 1 + A, 5)]);
  const s = Net.solve({ wells: [], users: [], homes: [], outfalls: [], drink: 0, openWater: () => false });
  ok('with no `sea` predicate handed over, no drain is live', s.drainsLive === 0);
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILED' : '✅ ALL CHECKS PASSED') + '\n');
process.exit(fails ? 1 : 0);
