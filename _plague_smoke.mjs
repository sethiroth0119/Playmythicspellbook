/* Drives the plague domain layer headless. No DOM, no bridge, no three.js. */
import * as S from '/home/user/Playmythicspellbook/public/src/plague/strains.js';
import * as C from '/home/user/Playmythicspellbook/public/src/plague/cures.js';
import * as O from '/home/user/Playmythicspellbook/public/src/plague/outbreak.js';
import * as L from '/home/user/Playmythicspellbook/public/src/plague/logistics.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

// ── a fake city: 30 named citizens across 5 workplaces, bad health coverage
const roster = [];
for (let i = 0; i < 30; i++) roster.push({ id: 'c' + i, name: 'Cit' + i, job: 't' + (i % 5), mood: 60 });
const moods = {};
const host = {
  citizens: () => roster,
  vitals: () => ({ health: 30, food: 70, water: 55 }),
  coverage: () => ({ health: 0.25, water: 0.55, food: 0.7 }),
  pop: () => 800, popCap: () => 900,
  nudge: (id, d) => { moods[id] = (moods[id] || 0) + d; return true; },
  cityId: () => 'testcity',
};

console.log('\n=== 1. determinism ===');
const a = S.makeStrain('seed-x', { pressure: 0.5 });
const b = S.makeStrain('seed-x', { pressure: 0.5 });
ok(JSON.stringify(a) === JSON.stringify(b.constructor === Object ? Object.assign({}, b, { bornAt: a.bornAt }) : b),
   'same seed -> identical strain (bornAt aside)');
ok(S.makeStrain('seed-y', {}).id !== a.id, 'different seed -> different strain');

console.log('\n=== 2. pressure responds to the city ===');
const dirty = O.pressureOf(host);
const clean = O.pressureOf(Object.assign({}, host, {
  coverage: () => ({ health: 1, water: 1, food: 1 }), vitals: () => ({ health: 100 }), pop: () => 100, popCap: () => 900 }));
console.log('  dirty=' + dirty + '  clean=' + clean);
ok(dirty > 0.4, 'a neglected city has real outbreak pressure');
ok(clean <= 0.05, 'a well-run city can reach zero pressure (building correctly pays)');

console.log('\n=== 3. outbreak spreads, then everyone recovers ===');
const st = O.emptyState();
const strain = S.makeStrain('wild-1', { pressure: dirty });
strain.contagion = 0.9; strain.severity = 4;
O.introduce(host, st, strain, 2, 'test');
ok(O.caseCount(st, strain.id) === 2, 'two index cases seeded');
let peak = 2;
for (let i = 0; i < 40; i++) { O.tick(host, st, 30 * 60000); peak = Math.max(peak, O.caseCount(st, strain.id)); }
console.log('  peak cases=' + peak + ' of ' + roster.length + '; now=' + O.caseCount(st));
ok(peak > 2, 'it spread');
ok(peak <= Math.ceil(roster.length * O.TUNING.CEILING_SHARE) + 1, 'it never took the whole city');
ok(roster.length === 30, 'nobody was deleted from the roster');
ok(Object.keys(moods).length > 0, 'mood was nudged through the sanctioned seam');

console.log('\n=== 4. a GOOD cure clears the strain ===');
const good = C.suggestMix(strain, 30);
good.water = (good.water | 0) + 14;      // buffer for stability
good.supplies = (good.supplies | 0) + 8;
const fg = C.formulate(strain, good, { sequenced: true, centrifuge: 0.9, synthesis: 0.9, assayed: true, exposure: 0, sealed: true });
console.log('  eff=' + fg.efficacy + ' pur=' + fg.purity + ' stab=' + fg.stability + ' risk=' + fg.risk + ' -> ' + fg.grade.label);
ok(fg.stability >= 60, 'a buffered, well-run batch is stable');
ok(fg.risk < 0.25, 'and low risk');
ok(fg.grade.key === 'viable' || fg.grade.key === 'broad', 'graded as a real cure');

console.log('\n=== 5. RECKLESS cure -> iatrogenic -> a NEW virus ===');
const bad = { corruptedEssence: 26, energyDrink: 10 };
const fb = C.formulate(strain, bad, { sequenced: false, centrifuge: 0.1, synthesis: 0.3, assayed: false, exposure: 0.4, sealed: false });
console.log('  eff=' + fb.efficacy + ' pur=' + fb.purity + ' stab=' + fb.stability + ' risk=' + fb.risk + ' -> ' + fb.grade.label);
ok(fb.grade.key === 'iatrogenic', 'graded IATROGENIC');
ok(fb.risk > 0.7, 'high mutation risk');
const adm = C.administer(strain, fb, { seed: 'test-bad', roll: 0.01 });
ok(!!adm.mutant, 'administering it SPAWNED A NEW STRAIN');
if (adm.mutant) {
  console.log('  mutant: ' + S.describe(adm.mutant) + '  parent=' + adm.mutant.parentId);
  ok(adm.mutant.origin === 'iatrogenic', 'the new strain is marked iatrogenic');
  ok(adm.mutant.parentId === strain.id, 'and traceable to the strain the player was treating');
  ok(adm.mutant.severity >= strain.severity, 'and is at least as bad as its parent');
  O.introduce(host, st, adm.mutant, 3, 'from a bad batch');
  ok(O.caseCount(st, adm.mutant.id) === 3, 'the mutant is loose in the city');
}

console.log('\n=== 6. the hazmat suit actually matters ===');
const suited = C.formulate(strain, good, { sequenced: true, centrifuge: 0.8, synthesis: 0.8, assayed: true, exposure: 0, sealed: true });
const unsuited = C.formulate(strain, good, { sequenced: true, centrifuge: 0.8, synthesis: 0.8, assayed: true, exposure: 0.35, sealed: false });
console.log('  suited   pur=' + suited.purity + ' stab=' + suited.stability + ' -> ' + suited.grade.label);
console.log('  unsuited pur=' + unsuited.purity + ' stab=' + unsuited.stability + ' -> ' + unsuited.grade.label + ' (contaminated=' + unsuited.contaminated + ')');
ok(unsuited.purity < suited.purity, 'working unsuited costs purity');
ok(unsuited.stability < suited.stability, 'and stability');
ok(unsuited.contaminated && !suited.contaminated, 'and contaminates the batch');
ok(unsuited.risk > suited.risk, 'and raises the mutation risk of what you ship');

console.log('\n=== 7. the carrier changes what arrives ===');
const econ = { ratePerWorkerHr: 700, salaryPerWorkerHr: 190, maxWorkers: 12 };
const cheap = { id: 'op1', op_type: 'transport', level: 1, workers: 0, status: 'active', corp_id: 'x' };
const goodCo = { id: 'op2', op_type: 'transport', level: 4, workers: 12, status: 'active', corp_id: 'y' };
const qc = L.quote(cheap, { econ, doses: fg.doses, stability: fg.stability });
const qg = L.quote(goodCo, { econ, doses: fg.doses, stability: fg.stability, coldPack: true });
console.log('  cheap: fee=' + qc.fee + ' integrity=' + qc.integrity);
console.log('  good : fee=' + qg.fee + ' integrity=' + qg.integrity);
ok(qg.integrity > qc.integrity, 'a staffed, invested carrier holds the cold chain better');
ok(qg.fee > qc.fee, 'and costs more');

const shipCheap = L.newShipment({ batchId: 'b1', carrierId: 'op1', labId: 'op9', fee: qc.fee, integrity: qc.integrity, doses: fg.doses, etaMs: qc.etaMs, labShare: qc.labShare });
const shipGood = L.newShipment({ batchId: 'b1', carrierId: 'op2', labId: 'op9', fee: qg.fee, integrity: qg.integrity, doses: fg.doses, etaMs: qg.etaMs, labShare: qg.labShare });
const arrC = L.arrive(shipCheap, fg);
const arrG = L.arrive(shipGood, fg);
console.log('  cheap arrival: stab ' + fg.stability + ' -> ' + arrC.arrived.stability + ' (' + arrC.arrived.grade.label + ')  broke=' + arrC.coldChainBroken);
console.log('  good  arrival: stab ' + fg.stability + ' -> ' + arrG.arrived.stability + ' (' + arrG.arrived.grade.label + ')');
ok(arrG.arrived.stability > arrC.arrived.stability, 'the good carrier delivers a better batch');
ok(arrG.lost < arrC.lost, 'and loses less in transit');

// A fragile batch on a bad carrier should be able to break entirely.
const fragile = C.formulate(strain, { corruptedEssence: 8, dna: 12, water: 6 },
  { sequenced: true, centrifuge: 0.6, synthesis: 0.7, assayed: true, exposure: 0, sealed: true });
console.log('  fragile at dispatch: stab=' + fragile.stability + ' -> ' + fragile.grade.label);
const arrF = L.arrive(L.newShipment({ batchId: 'b2', carrierId: 'op1', labId: 'op9', fee: 1, integrity: 0.30, doses: fragile.doses, etaMs: 1, labShare: 0.18 }), fragile);
console.log('  fragile on a bad carrier: stab -> ' + arrF.arrived.stability + ' (' + arrF.arrived.grade.label + ') broke=' + arrF.coldChainBroken);
ok(arrF.arrived.stability < fragile.stability, 'a fragile batch degrades on a bad carrier');

console.log('\n=== 8. resistance punishes shipping half-cures ===');
const weakStrain = S.makeStrain('res-test', { pressure: 0.3 });
const halfMix = { medicine: 10, water: 10 };
const fh = C.formulate(weakStrain, halfMix, { sequenced: true, centrifuge: 0.6, synthesis: 0.6, assayed: true, exposure: 0, sealed: true });
console.log('  half-cure grade=' + fh.grade.label + ' eff=' + fh.efficacy);
if (fh.grade.key === 'palliative') {
  const r1 = C.administer(weakStrain, fh, { seed: 'p1', roll: 0.99 });
  ok(r1.resistanceGain > 0, 'a palliative dose teaches the strain to resist');
  const before = C.formulate(weakStrain, halfMix, { sequenced: true, centrifuge: 0.6, synthesis: 0.6, assayed: true }).efficacy;
  weakStrain.resistance = 0.4;
  const after = C.formulate(weakStrain, halfMix, { sequenced: true, centrifuge: 0.6, synthesis: 0.6, assayed: true }).efficacy;
  console.log('  efficacy ' + before + ' -> ' + after + ' at 40% resistance');
  ok(after < before, 'and the same formulation works worse afterwards');
} else {
  console.log('  (mix graded ' + fh.grade.key + ', resistance path checked directly)');
  weakStrain.resistance = 0.5;
  ok(C.formulate(weakStrain, halfMix, { sequenced: true }).efficacy <
     C.formulate(Object.assign({}, weakStrain, { resistance: 0 }), halfMix, { sequenced: true }).efficacy,
     'resistance reduces efficacy');
}

console.log('\n=== 9. sequencing matters ===');
const blind = C.formulate(strain, good, { sequenced: false, centrifuge: 0.9, synthesis: 0.9, assayed: true, exposure: 0, sealed: true });
console.log('  sequenced=' + fg.efficacy + '  blind=' + blind.efficacy);
ok(blind.efficacy < fg.efficacy, 'formulating blind is worse');
ok(blind.efficacy <= 0.72, 'and is capped below broad-spectrum');

console.log('\n=== 10. a cured strain retires and everyone recovers ===');
const cases = O.caseCount(st, strain.id);
O.retire(st, strain.id, Date.now());
O.tick(host, st, 1000);
console.log('  cases before retire=' + cases + '  after=' + O.caseCount(st, strain.id));
ok(O.caseCount(st, strain.id) === 0, 'clearing the strain clears every carrier');
ok(roster.length === 30, 'and still nobody was deleted');

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);
