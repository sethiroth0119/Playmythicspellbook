/* ══════════════════════════════════════════════════════════════════════════
   🚚 TRANSPORT COMPANY — fleet, contracts, and the no-teleport rule

   The load-bearing check is CONSERVATION. A logistics layer's characteristic
   failure is not "it looked wrong" — it is quietly duplicating or eating
   freight, which shows up as a healthy-looking economy with more goods in it
   than anyone produced. So every scenario below re-counts the cargo.

   Run:  node tools/transport-tests/run.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import F from '../../public/src/transport/fleet.js';

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? '  OK   ' : '  FAIL ') + n + (d == null ? '' : '   ' + d)); };
const co = (over) => Object.assign({
  name: 'Ethos Freight', trucks: [], drivers: 99, fuel: 100000, cinder: 0,
  rating: 4.0, inTransit: [], delivered: 0,
}, over || {});
const fleetOf = (spec) => {
  const out = []; let i = 0;
  for (const k in spec) for (let n = 0; n < spec[k]; n++) out.push(F.newTruck('t' + (++i), k));
  return out;
};
const contract = (over) => Object.assign({
  id: 'c1', from: 'Ethos Steel', to: 'Camp Heights', cargoClass: 'bulk',
  units: 25000, miles: 142, pay: 18500, roadQuality: 1,
  manifest: { steel: 25000 },
}, over || {});

console.log('\n\u{1F69A} TRANSPORT COMPANY\n');

/* ── 1. A company with no trucks cannot work ────────────────────────────── */
ok('a company with no trucks cannot take a contract',
   !F.planContract(co(), contract(), 0).ok, F.planContract(co(), contract(), 0).reason);

/* ── 2. Capacity combinations — the brief's own example ─────────────────── */
const big = contract({ units: 60000 });
const heavy = co({ trucks: fleetOf({ heavyHauler: 2 }) });
const freights = co({ trucks: fleetOf({ freight: 4 }) });
const pHeavy = F.planContract(heavy, big, 0), pFreight = F.planContract(freights, big, 0);
ok('60,000 units moves on 2 heavy haulers', pHeavy.ok && pHeavy.trucks.length === 2,
   (pHeavy.trucks || []).length + ' trucks / ' + pHeavy.capacity + ' cap');
ok('…or on 4 freight trucks', pFreight.ok && pFreight.trucks.length === 4,
   (pFreight.trucks || []).length + ' trucks / ' + pFreight.capacity + ' cap');
ok('\u{1F3AF} three freight trucks are NOT enough for 60,000',
   !F.planContract(co({ trucks: fleetOf({ freight: 3 }) }), big, 0).ok,
   F.planContract(co({ trucks: fleetOf({ freight: 3 }) }), big, 0).reason);
ok('it takes only as many trucks as it needs',
   F.planContract(co({ trucks: fleetOf({ heavyHauler: 6 }) }), big, 0).trucks.length === 2);

/* ── 3. Specialisation — §8, and the reason to own more than one truck ──── */
const tankersOnly = co({ trucks: fleetOf({ tanker: 10 }) });
ok('\u{1F3AF} 200,000 units of TANKER capacity cannot move one ingot of steel',
   !F.planContract(tankersOnly, contract({ units: 100, cargoClass: 'bulk' }), 0).ok,
   F.planContract(tankersOnly, contract({ units: 100, cargoClass: 'bulk' }), 0).reason);
ok('…but moves fuel happily',
   F.planContract(tankersOnly, contract({ cargoClass: 'liquid', units: 20000 }), 0).ok);
ok('medicine needs a reefer, not a flatbed',
   !F.planContract(co({ trucks: fleetOf({ freight: 5 }) }), contract({ cargoClass: 'perishable', units: 8000 }), 0).ok &&
    F.planContract(co({ trucks: fleetOf({ reefer: 1 }) }), contract({ cargoClass: 'perishable', units: 8000 }), 0).ok);
ok('anomalous cargo needs containment',
   !F.planContract(co({ trucks: fleetOf({ armored: 9 }) }), contract({ cargoClass: 'anomalous', units: 3000 }), 0).ok &&
    F.planContract(co({ trucks: fleetOf({ containment: 1 }) }), contract({ cargoClass: 'anomalous', units: 3000 }), 0).ok);
ok('every cargo class has at least one truck that can carry it',
   F.CARGO_IDS.every(c => F.TRUCK_IDS.some(t => F.canCarry(t, c))),
   F.CARGO_IDS.filter(c => !F.TRUCK_IDS.some(t => F.canCarry(t, c))).join(', ') || 'all covered');

/* ── 4. Drivers cap the fleet — §12 ─────────────────────────────────────── */
const tenTrucks = co({ trucks: fleetOf({ freight: 10 }), drivers: 6 });
ok('\u{1F3AF} 10 trucks with 6 drivers gives 6 usable trucks',
   F.availableTrucks(tenTrucks, 'bulk', 0).length === 6,
   F.availableTrucks(tenTrucks, 'bulk', 0).length + ' usable');
ok('…so a job needing all ten is refused',
   !F.planContract(tenTrucks, contract({ units: 150000 }), 0).ok);
ok('hiring the other four unlocks it',
   F.planContract(co({ trucks: fleetOf({ freight: 10 }), drivers: 10 }), contract({ units: 150000 }), 0).ok);

/* ── 5. Fuel gates dispatch — §10 ───────────────────────────────────────── */
const dry = co({ trucks: fleetOf({ freight: 3 }), fuel: 0 });
const d0 = F.canDispatch(dry, contract({ units: 40000 }), 0);
ok('\u{1F3AF} no fuel, no dispatch', !d0.ok && d0.reason === 'no_fuel', d0.reason + ' (needs ' + d0.fuel + ')');
const wet = co({ trucks: fleetOf({ freight: 3 }), fuel: 500 });
ok('with fuel it rolls', F.canDispatch(wet, contract({ units: 40000 }), 0).ok);
/* Asserted with a tolerance of one unit, not as an exact double: the bill is
   ceil()'d, so 142 miles rounds up and 284 rounds up once instead of twice.
   The first version of this demanded exact doubling and failed on that
   rounding — a test that is stricter than the thing it measures. */
const f142 = F.fuelForPlan({ trucks: fleetOf({ freight: 3 }) }, 142);
const f284 = F.fuelForPlan({ trucks: fleetOf({ freight: 3 }) }, 284);
ok('fuel scales with distance', Math.abs(f284 - 2 * f142) <= 1, f142 + ' → ' + f284 + ' 🛢');

/* ── 6. 🔴 NO TELEPORT + CONSERVATION ───────────────────────────────────── */
let c = co({ trucks: fleetOf({ heavyHauler: 2 }), fuel: 100000 });
const job = contract({ units: 60000, manifest: { steel: 60000 } });
const before = F.totalCargo(c);
const d = F.dispatch(c, job, 0);
ok('dispatch succeeded', d.ok === true, d.reason || '');
c = d.company;
ok('\u{1F3AF} the cargo is ON THE ROAD, not at the destination',
   F.totalCargo(c) === 60000 && (c.inTransit || []).length === 1,
   F.totalCargo(c) + ' units in transit');
ok('\u{1F3AF} arriving EARLY is refused — the miles have to be driven',
   !F.arrive(c, 'c1', 1000).ok, F.arrive(c, 'c1', 1000).reason);
ok('the trucks are busy while it moves', F.availableTrucks(c, 'bulk', 1000).length === 0);
const eta = d.shipment.dueAt;
const a = F.arrive(c, 'c1', eta);
ok('it arrives once the time has passed', a.ok === true, a.reason || '');
ok('\u{1F3AF} the destination receives EXACTLY what left — nothing created or lost',
   a.delivered && a.delivered.manifest.steel === 60000 && F.totalCargo(a.company) === 0,
   'delivered ' + (a.delivered ? a.delivered.manifest.steel : '?') +
   ' · still in transit ' + F.totalCargo(a.company));
ok('the company was paid on delivery, not on dispatch',
   (a.company.cinder | 0) === 18500 && (d.company.cinder | 0) === 0,
   'dispatch ' + (d.company.cinder | 0) + ' → arrive ' + (a.company.cinder | 0));
ok('the trucks are free again', F.availableTrucks(a.company, 'bulk', eta).length === 2);
ok('and they are more worn than when they left',
   a.company.trucks.every(t => t.condition < 1), a.company.trucks.map(t => t.condition.toFixed(3)).join(' / '));

/* ── 7. Wear degrades but never deletes — §11 ───────────────────────────── */
let worn = co({ trucks: [Object.assign(F.newTruck('w1', 'freight'), { condition: 0.05 })] });
ok('\u{1F3AF} a wrecked truck is UNAVAILABLE, not gone',
   F.availableTrucks(worn, 'bulk', 0).length === 0 && worn.trucks.length === 1);
worn = F.repair(worn, 'w1', 0.9);
ok('…and repairing brings it back', F.availableTrucks(worn, 'bulk', 0).length === 1,
   'condition ' + worn.trucks[0].condition.toFixed(2));
ok('a half-worn truck still carries at least half its rating',
   F.truckCapacity(Object.assign(F.newTruck('x', 'freight'), { condition: 0.5 })) >= 15000 * 0.5);

/* ── 8. ETA and ratings ─────────────────────────────────────────────────── */
const slowPlan = { trucks: fleetOf({ heavyHauler: 1 }) };
const fastPlan = { trucks: fleetOf({ lightCargo: 1 }) };
ok('a heavy hauler is slower over the same road',
   F.etaMinutes(slowPlan, 142, 1) > F.etaMinutes(fastPlan, 142, 1),
   F.etaMinutes(slowPlan, 142, 1) + ' min vs ' + F.etaMinutes(fastPlan, 142, 1) + ' min');
ok('bad roads slow everything down — infrastructure matters (§18)',
   F.etaMinutes(slowPlan, 142, 0.5) > F.etaMinutes(slowPlan, 142, 1));
ok('an on-time delivery raises the rating', a.company.rating > 4.0, String(a.company.rating));
ok('the rating is clamped to 1..5',
   F.clampRating(99) === 5 && F.clampRating(-4) === 1 && F.clampRating(NaN) === F.FLEET.ratingStart);

/* ── 9. Hostile input ───────────────────────────────────────────────────── */
let bad = null;
for (const v of [NaN, Infinity, -1, null, undefined, '5', {}]) {
  try {
    const r1 = F.planContract(co({ trucks: fleetOf({ freight: 2 }) }), contract({ units: v, miles: v }), v);
    const r2 = F.etaMinutes({ trucks: fleetOf({ freight: 1 }) }, v, v);
    const r3 = F.fuelForPlan({ trucks: fleetOf({ freight: 1 }) }, v);
    if (typeof r1.ok !== 'boolean' || !isFinite(r2) || !isFinite(r3)) { bad = String(v); break; }
  } catch (e) { bad = String(v) + ' THREW ' + e.message; break; }
}
ok('hostile units/miles never throw or yield NaN', bad === null, bad || 'clean');

console.log('');
if (fails) { console.log('❌ ' + fails + ' CHECK(S) FAILED'); process.exit(1); }
console.log('✅ TRANSPORT: all checks green');
