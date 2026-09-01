/* Drives the plague domain layer headless. No DOM, no bridge, no three.js. */
import * as S from './public/src/plague/strains.js';
import * as C from './public/src/plague/cures.js';
import * as O from './public/src/plague/outbreak.js';
import * as L from './public/src/plague/logistics.js';
/* hazmat.js is pure — no DOM, no three.js — so the suit is testable here, and
   after a shipped clock bug made it unobtainable it very much needs to be. */
import * as HZ from './public/src/biolab/hazmat.js';
import { stationByKey } from './public/src/biolab/stations.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

/* ── a controllable clock ──────────────────────────────────────────────────
   🔴 outbreak.js drives every STAGE off absolute Date.now() timestamps, on
   purpose: it is what makes a doubled tick (the live loop overlapping a
   catch-up) advance nobody twice. The consequence for a test is that passing
   a big `dtMs` moves nothing — an index case sits in incubation forever,
   incubating people do not transmit, and the outbreak looks inert when it is
   only frozen. Advance THIS instead of trusting dtMs alone.

   🔴 IT IS PINNED TO A FIXED EPOCH, NOT TO Date.now(). The spread roll seeds
   off `Math.floor(now / 60000)`, so starting the clock at the real current
   time makes every outcome depend on what time of day the suite is run — this
   file genuinely passed in the morning and failed in the afternoon before it
   was pinned. A test whose result moves with the wall clock is worse than no
   test: it trains you to re-run until it goes green. */
const REAL_NOW = Date.now;
let CLOCK = 1767225600000;          // 2026-01-01T00:00:00Z — arbitrary, but FIXED
Date.now = () => CLOCK;
const advance = (ms) => { CLOCK += ms; };

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
// Move the clock AND pass the matching dt — the two together are what a real
// half-hour of play looks like to the model.
for (let i = 0; i < 40; i++) {
  advance(30 * 60000);
  O.tick(host, st, 30 * 60000);
  peak = Math.max(peak, O.caseCount(st, strain.id));
}
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

console.log('\n=== 11. the hazmat suit can actually be put on ===');
/* 🔴 REGRESSION. This shipped broken: startDon() stamped Date.now() while the
   run loop fed tick() performance.now(), so `now - startedAt` was about minus
   1.7 trillion and no seal could ever latch. The HUD read the wall clock, so
   the first bar filled to 100% and froze — the suit was unobtainable and the
   symptom read as a stuck progress bar. Drive it on the wall clock, the way
   the fixed loop does. */
{
  const suit = HZ.emptySuit();
  let t = Date.now();
  const at = { atAirlock: true, inHot: false };
  HZ.startDon(suit, t);
  ok(!!suit.donning, 'pressing E at the airlock starts a seal');
  ok(suit.donning.startedAt === t, 'and stamps it with the clock it was handed');

  // Advance in 100ms beats, exactly as the frame loop does.
  let guard = 0;
  while (!suit.sealed && guard++ < 400) {
    t += 100;
    HZ.tick(suit, 100, Object.assign({ now: t }, at));
  }
  const total = SEAL_MS();
  ok(suit.sealed, 'ONE press seals all four in sequence (took ' + (guard * 100) + 'ms)');
  ok(guard * 100 >= total, 'and it took at least the full ' + total + 'ms of donning time');
  ok(HZ.sealCount(suit) === HZ.SEALS.length, 'all four seals are set');

  // The gate is the whole point of the suit.
  const bench = stationByKey('synthesis');
  ok(bench && bench.hot, 'the synthesis bench is a hot-zone station');
  ok(HZ.gate(suit, bench) === null, 'a sealed suit opens the hot bench');
  ok(typeof HZ.gate(HZ.emptySuit(), bench) === 'string', 'no suit is refused, with a reason');
  ok(HZ.gate(suit, stationByKey('sequencer')) === null, 'cold stations never need the suit');

  // Walking away mid-seal interrupts, but never un-does a finished seal.
  const s2 = HZ.emptySuit();
  let t2 = Date.now();
  HZ.startDon(s2, t2);
  t2 += 3000; HZ.tick(s2, 3000, { now: t2, atAirlock: true, inHot: false });
  const done = HZ.sealCount(s2);
  ok(done >= 1, 'first seal landed after 3s');
  t2 += 5000; HZ.tick(s2, 5000, { now: t2, atAirlock: false, inHot: false });
  ok(!s2.donning, 'walking away interrupts the seal in progress');
  ok(HZ.sealCount(s2) === done, 'but the seals already finished are kept');
  ok(!s2.autoDon, 'and the sequence does not resume by itself');
}

console.log('\n=== 12. exposure only accrues when it should ===');
{
  const bare = HZ.emptySuit();
  let t = Date.now();
  for (let i = 0; i < 20; i++) { t += 1000; HZ.tick(bare, 1000, { now: t, atAirlock: false, inHot: true }); }
  console.log('  20s in the hot zone unsuited -> exposure ' + bare.exposure);
  ok(bare.exposure > 0.12, 'working the hot zone unsuited passes the contamination threshold');

  const sealed = HZ.emptySuit();
  sealed.sealed = true; for (const s of HZ.SEALS) sealed.seals[s.key] = true;
  let t3 = Date.now();
  for (let i = 0; i < 20; i++) { t3 += 1000; HZ.tick(sealed, 1000, { now: t3, atAirlock: false, inHot: true }); }
  console.log('  20s in the hot zone SEALED   -> exposure ' + sealed.exposure);
  ok(sealed.exposure < 0.12, 'a sealed suit stays under it');
  ok(sealed.exposure > 0, 'but is a filter, not immunity');

  const clean = HZ.emptySuit();
  let t4 = Date.now();
  for (let i = 0; i < 20; i++) { t4 += 1000; HZ.tick(clean, 1000, { now: t4, atAirlock: false, inHot: false }); }
  ok(clean.exposure === 0, 'the clean half of the room costs nothing');

  // And the payoff: exposure has to reach the batch, or the suit is a costume.
  const strainX = S.makeStrain('suit-check', { pressure: 0.4 });
  const mix = { medicine: 12, water: 8, cloth: 6 };
  const good = C.formulate(strainX, mix, { sequenced: true, centrifuge: 0.8, synthesis: 0.8, assayed: true, exposure: 0, sealed: true });
  const dirty = C.formulate(strainX, mix, { sequenced: true, centrifuge: 0.8, synthesis: 0.8, assayed: true, exposure: bare.exposure, sealed: false });
  ok(dirty.contaminated && !good.contaminated, 'the exposure the suit prevents lands on the BATCH');
  ok(dirty.risk > good.risk, 'and raises what you are about to ship');
}

function SEAL_MS() { let n = 0; for (const s of HZ.SEALS) n += s.ms; return n; }

console.log('\n=== 13. the retune actually bites ===');
/* 🔴 THE REGRESSION THAT MATTERS FOR TUNING. The first pass landed near R₀ 1.1:
   an outbreak infected about one extra person and burned out before a player
   finished a session, so the cure had nothing urgent to be about. These bounds
   are two-sided ON PURPOSE — an outbreak that is too weak is boring, and one
   that always takes the whole city removes the decision. Both are failures. */
{
  const fresh = () => {
    const r = [];
    for (let i = 0; i < 40; i++) r.push({ id: 'q' + i, name: 'Q' + i, job: 'w' + (i % 8), mood: 65 });
    return r;
  };
  const run = (contagion) => {
    const roll = fresh();
    const h = Object.assign({}, host, { citizens: () => roll });
    const s2 = O.emptyState();
    const v = S.makeStrain('bite:' + contagion, { pressure: 0.5 });
    v.contagion = contagion; v.severity = 3;
    O.introduce(h, s2, v, O.TUNING.SEED_INFECTIONS, 'test');
    let peak = O.caseCount(s2, v.id), everSick = new Set(O.infectedIds(s2, v.id));
    for (let i = 0; i < 60; i++) {
      advance(5 * 60000);
      O.tick(h, s2, 5 * 60000);
      for (const k of O.infectedIds(s2, v.id)) everSick.add(k);
      peak = Math.max(peak, O.caseCount(s2, v.id));
    }
    return { peak, total: everSick.size, roster: roll.length };
  };

  const mild = run(0.35);
  const nasty = run(0.80);
  console.log('  contagion 0.35 -> peak ' + mild.peak + ', ' + mild.total + '/' + mild.roster + ' infected over the run');
  console.log('  contagion 0.80 -> peak ' + nasty.peak + ', ' + nasty.total + '/' + nasty.roster + ' infected over the run');

  ok(mild.total > O.TUNING.SEED_INFECTIONS * 2,
     'a moderate strain grows well past its index cases (R0 comfortably > 1)');
  ok(nasty.total > mild.total, 'a virulent strain does more damage than a moderate one');
  const cap = Math.ceil(nasty.roster * O.TUNING.CEILING_SHARE) + 1;
  ok(nasty.peak <= cap, 'and still never exceeds the ceiling (' + nasty.peak + ' <= ' + cap + ')');
  /* 🔴 A VIRULENT STRAIN LEFT UNCURED FOR FIVE HOURS *SHOULD* REACH EVERYONE.
     That is the threat the cure exists to answer, and capping it would make
     ignoring an outbreak a viable strategy. The invariant worth defending is
     the one above — CONCURRENT cases stay under the ceiling, so the city
     always keeps some workforce and the labour drag stays bounded — plus this
     one: a MODERATE strain must not sweep the city on its own, or the player's
     clinics and water never mattered in the first place. */
  ok(mild.total < mild.roster, 'a moderate strain does NOT reach everyone — infrastructure still matters');
  ok(nasty.peak < nasty.roster, 'even a virulent one never has the whole city down at once');

  // The economic bite. A quarter of the roster symptomatic must cost real output.
  const roll = fresh();
  const h = Object.assign({}, host, { citizens: () => roll });
  const s3 = O.emptyState();
  const v = S.makeStrain('drag-test', { pressure: 0.5 });
  v.contagion = 0.8; v.severity = 4;
  O.introduce(h, s3, v, 12, 'test');
  advance(O.TUNING.INCUBATE_MS + 60000);
  O.tick(h, s3, O.TUNING.INCUBATE_MS + 60000);
  const rep = O.report(h, s3);
  console.log('  ' + rep.cases + '/' + rep.roster + ' ill -> healthDrag ' + rep.healthDrag +
              ' (cap ' + O.TUNING.WORKFORCE_DRAG_MAX + ')');
  ok(rep.healthDrag > 0, 'sick citizens produce a real drag on the city health vital');
  ok(rep.healthDrag <= O.TUNING.WORKFORCE_DRAG_MAX, 'and it is bounded — an outbreak can never zero a city');
  ok(O.report(h, O.emptyState()).healthDrag === 0, 'a healthy city pays nothing');
}

console.log('\n' + (fails ? '❌ ' + fails + ' FAILURES' : '✅ ALL CHECKS PASSED'));
process.exit(fails ? 1 : 0);
