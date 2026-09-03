/* Drives the Medical Corporation minigame headless: the pharma model, the
   hospital state layer over a fake bridge, the NPC counter, and the walk over
   the hospital floor plan. No DOM, no three.js.
   Run: node _hospital_smoke.mjs */
import * as PH from './public/src/hospital/pharma.js';
import { STATIONS, ROOM, HOT_Z, PLAN } from './public/src/hospital/floor.js';
import { nearest, colliders, inHotZone } from './public/src/biolab/stations.js';
import { makePlayer, makeInput, step } from './public/src/biolab/player.js';
import * as HZ from './public/src/biolab/hazmat.js';
import * as C from './public/src/plague/cures.js';
import * as S from './public/src/plague/strains.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

/* Pinned clock, for the same reason _plague_smoke.mjs pins its own. */
let CLOCK = 1767225600000;
Date.now = () => CLOCK;

/* ── a fake game behind the bridge ────────────────────────────────────────
   The Profile object is what both windows share; the two module instances
   are simulated below by swapping the slot's object out from under the cache. */
const Profile = { plague: null, pharma: null, gems: 5000 };
const ledger = { medicine: 60, water: 40, dna: 24, memoryShards: 3, supplies: 10, cloth: 20 };
const CAP = 999;
let saves = 0;
const ops = [{ id: 'local_med', op_type: 'medical', level: 2, workers: 4, status: 'active' }];
const ECON = { medical: { startup: 450000, ratePerWorkerHr: 1000, salaryPerWorkerHr: 260, maxWorkers: 10 } };
globalThis.window = { MythicPlagueBridge: {
  signedIn: () => false, userId: () => null, displayName: () => 'Tester', client: () => null,
  resources: () => [], getRes: (id) => ledger[id] | 0,
  spendRes: (id, n) => { if ((ledger[id] | 0) < n) return false; ledger[id] -= n; return true; },
  addRes: (id, n) => { ledger[id] = Math.min(CAP, (ledger[id] | 0) + n); return true; },
  refundRes: (id, n) => { ledger[id] = (ledger[id] | 0) + n; return true; },
  gems: () => Profile.gems, spendGems: (n) => { if (Profile.gems < n) return false; Profile.gems -= n; return true; },
  addGems: (n) => { Profile.gems += n; },
  opEcon: (t) => ECON[t] || null, myOps: () => ops, myCorp: () => null,
  plagueState: () => Profile.plague, setPlagueState: (s) => { Profile.plague = s; return true; },
  pharmaState: () => Profile.pharma, setPharmaState: (s) => { Profile.pharma = s; return true; },
  save: () => { saves++; return true; }, toast: () => {}, confirm: async () => true,
} };

const PL = await import('./public/src/plague/state.js');
const HS = await import('./public/src/hospital/state.js');

console.log('\n=== 1. the floor plan walks ===');
const p = makePlayer(); p.x = 0; p.z = -16.2;
const input = makeInput();
const plan = { room: ROOM, colliders: colliders(STATIONS) };
input.keys.w = true;
for (let i = 0; i < 400; i++) step(p, input, 16, 1, plan);
ok(p.z < ROOM.d / 2 && p.z > -ROOM.d / 2, 'the player is still inside the hospital walls');
const desk = STATIONS.find((s) => s.key === 'desk');
ok(p.z < desk.pos[1] - desk.size[1] / 2, 'and was stopped by the front desk (z=' + p.z.toFixed(2) + ')');
const near = nearest(p.x, p.z, 3.2, STATIONS);
ok(near && near.station.key === 'desk', 'nearest() over the hospital table finds the desk');
ok(!inHotZone(p.x, p.z, HOT_Z) && inHotZone(0, 12, HOT_Z), 'the sterile line is the hospital\'s, not the lab\'s');
ok(colliders(STATIONS).every((c) => c.key !== 'scrub'), 'the scrub station is a frame you walk into, not furniture');
ok(PLAN.stations === STATIONS && PLAN.hotZ === HOT_Z, 'PLAN hands the scene the same table and line');

console.log('\n=== 2. the sterile gate is the hazmat gate ===');
const suit = HZ.emptySuit();
const compound = STATIONS.find((s) => s.key === 'compound');
ok(typeof HZ.gate(suit, compound) === 'string', 'the clean room refuses an ungowned player');
ok(HZ.gate(suit, STATIONS.find((s) => s.key === 'vault')) === null, 'the vault does not');

console.log('\n=== 3. a delivered cure becomes a line ===');
const strain = S.makeStrain('hosp-1', { pressure: 0.5 });
const good = C.formulate(strain, C.suggestMix(strain, 30), { sequenced: true, centrifuge: 0.9, synthesis: 0.9, assayed: true, exposure: 0, sealed: true });
console.log('  bench grade: ' + good.grade.label + ', ' + good.doses + ' doses');
const batch = { id: 'bch_1', strainId: strain.id, strainName: strain.name, strainIsolate: strain.isolate, f: Object.assign({}, good, { grade: good.grade.key }) };
const ship = { id: 'shp_1', status: 'administered', strainId: strain.id, batchId: batch.id, labId: 'local_med', carrierName: 'Haul Co', shipperName: 'Alice',
  treated: 6, administeredAt: CLOCK, result: { dosesDelivered: 20, arrivedGrade: good.grade.key, arrivedStability: good.stability, arrivedPurity: good.purity, arrivedEfficacy: good.efficacy } };
const line = PH.lineFrom(ship, batch, strain);
ok(!!line && line.samples === 20 - 6 + 4, 'samples = leftover doses + a fifth of the crate (' + (line && line.samples) + ')');
ok(line.grade === good.grade.key && line.family === strain.family, 'the line carries the ARRIVED grade and the family');
ok(PH.lineFrom(Object.assign({}, ship, { result: Object.assign({}, ship.result, { arrivedGrade: 'iatrogenic' }) }), batch, strain) === null, 'an iatrogenic crate leaves nothing');
ok(PH.lineFrom(Object.assign({}, ship, { status: 'refused' }), batch, strain) === null, 'a refused crate leaves nothing');
ok(PH.lineFrom(ship, batch, strain).samples >= 2, 'never fewer than two samples');

console.log('\n=== 4. product gates ===');
const inert = Object.assign({}, line, { grade: 'inert', stability: 10 });
ok(PH.canMake('salve', inert).ok, 'salve can be made from an inert line');
ok(!PH.canMake('vaccine', inert).ok && /INERT/.test(PH.canMake('vaccine', inert).why), 'vaccine cannot, and says why');
const viable = Object.assign({}, line, { grade: 'viable', stability: 70, family: 'respiratory' });
ok(PH.canMake('vaccine', viable).ok, 'a stable viable line makes vaccine');
ok(!PH.canMake('vaccine', Object.assign({}, viable, { stability: 40 })).ok, 'an unstable one does not');
ok(!PH.canMake('tonic', viable).ok && PH.canMake('tonic', Object.assign({}, viable, { family: 'neural' })).ok, 'tonic needs a neural line');
ok(PH.maxUnits('antiviral', viable) === viable.samples * 6, 'yield is samples × perSample');
ok(PH.runCost('serum', 8).samples === 2 && PH.runCost('serum', 8).res.dna === 8, 'a run costs samples and per-unit inputs');
for (const pid of PH.PRODUCT_IDS) for (const id of Object.keys(PH.PRODUCTS[pid].inputs))
  ok(['food','ammo','water','medicine','energyDrink','supplies','metal','fuel','corruptedEssence','memoryShards','dna','wood','stone','cloth'].includes(id), pid + ' input ' + id + ' is a live resource id');

console.log('\n=== 5. compounding: the dial, the gown, the spoilage ===');
const d = PH.dial('vaccine', viable, 'seed');
ok(d.width < PH.dial('salve', viable, 'seed').width, 'vaccine has the narrower band');
ok(PH.dial('vaccine', Object.assign({}, viable, { stability: 20 }), 'seed').width < d.width, 'an unstable line narrows it further');
ok(PH.titrate(d, d.target) === 1 && PH.titrate(d, d.target + d.width * 2) === 0, 'titrate() is 1 on target and 0 off the band');
const clean = PH.compound('antiviral', viable, 30, { titration: 0.95, exposure: 0, sealed: true });
const sloppy = PH.compound('antiviral', viable, 30, { titration: 0.2, exposure: 0, sealed: true });
const dirty = PH.compound('antiviral', viable, 30, { titration: 0.95, exposure: 0.2, sealed: false });
const ruined = PH.compound('antiviral', viable, 30, { titration: 0.95, exposure: 0.5, sealed: false });
ok(clean.made === 30 && clean.quality > sloppy.quality && sloppy.made < 30, 'the dial sets yield and quality');
ok(dirty.contaminated && dirty.quality < clean.quality && !dirty.spoiled, 'ungowned work is on the product');
ok(ruined.spoiled && ruined.made === 0, 'heavy exposure destroys the run');
ok(PH.unitPrice('vaccine', 1, ECON.medical) > PH.unitPrice('vaccine', 0, ECON.medical), 'quality sets the price');
ok(PH.unitPrice('vaccine', 0.8, ECON.medical) > PH.unitPrice('salve', 0.8, ECON.medical), 'vaccine outprices salve');
ok(PH.unitPrice('vaccine', 0.8, null) === 0, 'no econ row → price 0, never a hardcoded figure');
ok(Math.abs(PH.unitPrice('vaccine', 0.8, { ratePerWorkerHr: 2000 }) / PH.unitPrice('vaccine', 0.8, ECON.medical) - 2) < 0.02, 'price scales with the op\'s rate');

console.log('\n=== 6. the NPC counter ===');
const ctx0 = { pop: 300, dispensaries: [], cases: 0, staffing: 1 };
ok(PH.customersPerMin(ctx0) === 0, 'no clinic, no sales');
const ctx1 = { pop: 300, dispensaries: [{ type: 'clinic', lvl: 1 }], cases: 0, staffing: 1 };
const ctx2 = { pop: 300, dispensaries: [{ type: 'clinic', lvl: 1 }, { type: 'medlab', lvl: 1 }], cases: 0, staffing: 1 };
const ctxO = Object.assign({}, ctx1, { cases: 12, family: 'respiratory' });
console.log('  customers/min: one clinic ' + PH.customersPerMin(ctx1).toFixed(2) + ', +medlab ' + PH.customersPerMin(ctx2).toFixed(2) + ', outbreak ' + PH.customersPerMin(ctxO).toFixed(2));
ok(PH.customersPerMin(ctx1) > 1 && PH.customersPerMin(ctx1) < 3, 'one clinic at pop 300 is a modest counter');
ok(PH.customersPerMin(ctx2) > PH.customersPerMin(ctx1) && PH.customersPerMin(ctx2) < 2 * PH.customersPerMin(ctx1), 'a second dispensary adds, with diminishing returns');
ok(PH.customersPerMin(ctxO) > 2 * PH.customersPerMin(ctx1), 'an outbreak sends people to the counter');
const stock = {};
PH.addToShelf(stock, 'antiviral', 20, 0.8, viable);
PH.addToShelf(stock, 'salve', 20, 0.5, viable);
PH.addToShelf(stock, 'antiviral', 20, 0.4, viable);
ok(stock.antiviral.units === 40 && Math.abs(stock.antiviral.quality - 0.6) < 0.001, 'the shelf averages quality by units');
let seed = 7; const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const acc = { customers: 0 };
let sold = 0, cinder = 0;
for (let i = 0; i < 20; i++) { const r = PH.sellTick(stock, 1, ctxO, ECON.medical, acc, rng); sold += r.units; cinder += r.cinder; }
console.log('  20 city minutes in an outbreak: sold ' + sold + ' for ' + cinder + ' cinder; left ' + PH.shelfUnits(stock));
ok(sold > 0 && cinder > 0 && PH.shelfUnits(stock) === 60 - sold, 'units leave the shelf and Cinder is earned');
let anti = 0, salve = 0;
for (let i = 0; i < 400; i++) { const pick = PH.pickSale({ antiviral: { units: 1, quality: 0.6, family: 'respiratory' }, salve: { units: 1, quality: 0.6 } }, ctxO, rng()); if (pick === 'antiviral') anti++; else salve++; }
ok(anti > salve, 'in a respiratory outbreak the matching antiviral outsells salve (' + anti + ' vs ' + salve + ')');
const bare = PH.sellTick({}, 50, ctxO, ECON.medical, { customers: 0 }, rng);
ok(bare.units === 0 && bare.acc.customers < 1, 'a bare shelf does not bank a queue');

console.log('\n=== 7. the state layer: sweep, spend, refund, persist ===');
ok(HS.ready(), 'the hospital sees the bridge');
// Put a delivered-and-administered crate in the plague ledger the way state.js would.
const pb = PL.blob();
pb.batches.push(batch);
pb.shipments.push(ship);
PL.persist();
let r = HS.sweep();
ok(r.added === 1 && HS.openLines().length === 1, 'sweep() books the administered crate as a line');
ok(HS.sweep().added === 0 && HS.lines().length === 1, 'and is idempotent');
const foreign = Object.assign({}, ship, { id: 'shp_2', labId: 'someone-elses-lab' });
PL.blob().shipments.push(foreign); PL.persist();
ok(HS.sweep().added === 0, 'a crate that landed at another player\'s lab is not this vault\'s');
const L = HS.openLines()[0];
const before = Object.assign({}, ledger);
const savesBefore = saves;
const L0 = L.samples;                 // L is the live object; its samples move
r = HS.compoundRun(L.id, 'serum', 8, { titration: 0.9, exposure: 0, sealed: true });
ok(r.ok && r.result.made > 0, 'a serum run compounds (' + r.result.made + ' made, quality ' + r.result.quality + ')');
ok(ledger.medicine === before.medicine - 16 && ledger.dna === before.dna - 8, 'inputs left the ledger');
ok(HS.lineById(L.id).samples === L0 - 2 && saves > savesBefore, 'samples came off the line and it saved');
ok(HS.stock().serum.units === r.result.made, 'and the product is on the shelf');
r = HS.compoundRun(L.id, 'serum', 40, { titration: 0.9, exposure: 0, sealed: true });
ok(!r.ok && r.why === 'short' && ledger.dna === before.dna - 8, 'a run you cannot afford takes nothing');
r = HS.compoundRun(L.id, 'tonic', 4, { titration: 0.9 });
ok(!r.ok && r.why === 'gate', 'the family gate holds in the state layer too');
// Persist failure must refund.
const B = globalThis.window.MythicPlagueBridge;
const realSet = B.setPharmaState; B.setPharmaState = () => false;
const dnaBefore = ledger.dna, sampBefore = HS.lineById(L.id).samples, shelfBefore = HS.stock().serum.units;
r = HS.compoundRun(L.id, 'serum', 4, { titration: 0.9, exposure: 0, sealed: true });
B.setPharmaState = realSet;
ok(!r.ok && r.why === 'persist' && ledger.dna === dnaBefore && HS.lineById(L.id).samples === sampBefore && HS.stock().serum.units === shelfBefore,
   'a failed record refunds inputs, samples and shelf');
r = HS.compoundRun(L.id, 'antiviral', 10, { titration: 0.9, exposure: 0.6, sealed: false });
ok(r.ok && r.result.spoiled && !(HS.stock().antiviral) && HS.stats().spoiled === 1, 'a spoiled run costs the inputs and shelves nothing');

console.log('\n=== 8. the counter credits Cinder through the bridge ===');
const gemsBefore = Profile.gems;
const rr = HS.counterTick(30, { pop: 300, dispensaries: [{ type: 'clinic', lvl: 2 }], cases: 5, family: null, cityId: 'nc:test' }, rng);
ok(rr && rr.units > 0 && Profile.gems === gemsBefore + rr.cinder, 'sold ' + rr.units + ' units, +' + rr.cinder + ' Cinder landed in the wallet');
ok(HS.sales().length === 1 && HS.sales()[0].units === rr.units, 'one log row per minute, aggregated');
ok(HS.earnedSince(3600000).cinder === rr.cinder, 'the desk can read it back');

console.log('\n=== 9. two windows, one slot ===');
// Simulate the city iframe having persisted its own copy of the blob.
const other = JSON.parse(JSON.stringify(Profile.pharma));
other.stats.sold = 999;
Profile.pharma = other;
ok(HS.stats().sold === 999, 'a slot the other window rewrote is re-read, not served from cache');
HS.persist();
ok(Profile.pharma !== other && HS.stats().sold === 999, 'and our persist takes the slot back with the merged truth');
const otherP = JSON.parse(JSON.stringify(Profile.plague));
otherP.shipments.push({ id: 'shp_city', status: 'in_transit' });
Profile.plague = otherP;
ok(PL.shipments().some((s) => s.id === 'shp_city'), 'plague state has the same staleness check');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);
