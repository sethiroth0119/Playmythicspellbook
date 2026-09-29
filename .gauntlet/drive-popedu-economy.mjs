/* ══════════════════════════════════════════════════════════════════════════
   👥🎓 DRIVE-POPEDU-ECONOMY — does a bigger, better-schooled city actually
   earn and spend more?

   The ask: "the more population a player has for their city and the more
   educated they are, the more money the civilization makes and the more they
   spend Cinder."

   ⚠ MEASURE BEFORE WIRING. The chain for this already exists on paper:
       schooling → archetypes.wealthWeights (lifted by education rung)
                 → pipeline.byWealth / arrivalTierMix
                 → E.setArrivalTierMix  (demographics/index.js:144)
                 → households placeArrivals → S.pop[low|mid|high]
                 → TIER_WEIGHT / TIER_LUX in demand()
                 → what the city spends.
   So the honest first question is not "how do I build this" but "how much of
   it already moves". This session already burned a whole cycle building a fix
   for a defect that an instrument artefact had invented, so: sweep the two
   inputs, read the two outputs, and let the numbers say what is missing.

   🔴 AND THE KNOWN LIMIT, STATED UP FRONT SO THE RESULT IS READ RIGHT:
   arrivalTierMix only places ARRIVALS. Nothing re-tiers a resident who is
   already here. So a city that builds schools AFTER it has grown should show
   far less education response than one that schooled first — and if that shows
   up in the sweep it is a finding, not noise.

   Run:  node .gauntlet/drive-popedu-economy.mjs
   ══════════════════════════════════════════════════════════════════════════ */
import path from 'path';
import { pathToFileURL } from 'url';

if (!global.window) {
  global.window = { MythicCityBridge: { addCinders: async () => true }, MythicResourceChain: null };
  const chain = await import('../public/src/resources/chain.js');
  global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
}
const u = (p) => pathToFileURL(path.resolve(process.cwd(), p)).href;

const E = (await import(u('public/src/economy/index.js'))).default;
const { ECON } = await import(u('public/src/economy/tuning.js'));
const HH = await import(u('public/src/economy/households.js'));
const ARCH = await import(u('public/src/demographics/archetypes.js'));
const DAY = ECON.clock.dayMin;

/* The six rungs, worst to best. Read from the shipped ladder rather than typed,
   so a retune of the ladder cannot leave this driver asserting about rungs that
   no longer exist. */
const RUNGS = ARCH.eduOrder ? ARCH.eduOrder() : null;
if (!Array.isArray(RUNGS) || RUNGS.length < 2) {
  console.log('could not read the education ladder — eduOrder() gave ' + JSON.stringify(RUNGS));
  process.exit(1);
}
console.log('education ladder: ' + RUNGS.join(' → '));

/* ── the wealth mix a rung implies, straight from the shipped weights ─────── */
function mixFor(rung) {
  /* wealthWeights(archId, edu) is per-archetype; average over the archetypes the
     module actually ships so this is the city's mix, not one family's. */
  const ids = ARCH.archetypeIds ? ARCH.archetypeIds() : null;
  const acc = { low: 0, mid: 0, high: 0 };
  let n = 0;
  for (const id of (ids || [null])) {
    let w = null;
    try { w = ARCH.wealthWeights(id, rung); } catch (e) { continue; }
    if (!w) continue;
    acc.low += w.low || 0; acc.mid += w.mid || 0; acc.high += w.high || 0; n++;
  }
  if (!n) return null;
  const s = acc.low + acc.mid + acc.high;
  return s > 0 ? { low: acc.low / s, mid: acc.mid / s, high: acc.high / s } : null;
}

/* ── one city, one (pop, rung), N days; report what it earned and spent ───── */
let seq = 0;
function run(pop, rung, days = 220) {
  const mix = mixFor(rung);
  const node = 'pe-' + (seq++);
  /* Feed the economy the SAME seam demographics uses, so this measures the
     shipped path and not a private one. */
  E.setArrivalTierMix(mix ? () => mix : null);
  E.mount({ nodeId: node, population: 0 });
  E.setArrivalTierMix(mix ? () => mix : null);
  E.mount({ nodeId: node, population: pop });

  /* 🔴 THE JOBS SCALE WITH THE PEOPLE — AND THE FIRST DRAFT DID NOT DO THIS.
     Holding a fixed 7 buildings while sweeping population 120 → 1500 measured
     OVERCROWDING, not growth: 1500 residents sharing five workplaces are
     unemployed, earn nothing, save nothing and therefore spend nothing, so
     income read 253k → 394k → 348k → 167k and the sweep "proved" that
     population makes a city poorer. That is a correct simulation of a slum and
     a useless answer to the question asked, which is about a city that GROWS —
     a player who doubles their population also builds the shops and works that
     employ them. One workplace set per ~60 residents keeps the labour market
     roughly clearing so the sweep isolates the variable it names. */
  const sets = Math.max(1, Math.round(pop / 60));
  const RING = [['rawWater', 'utility'], ['freshWater', 'utility'], ['electricity', 'utility'],
                ['wheat', 'farm'], ['preparedMeals', 'retail']];
  const list = [];
  for (let s = 0; s < sets; s++) {
    RING.forEach((r, i) => list.push({ key: 't' + s + '_' + i, out: r[0], ind: r[1], lvl: 2 }));
  }
  const host = { powerFactor: 1, waterFactor: 1,
                 logisticsCounts: { warehouse: 2 + sets, depot: 1 + sets },
                 hasBank: true, infrastructure: 0.8 };
  E.syncBuildings(list);

  /* ⚠ READ THE FLOWS, NOT HH.lastTax. S.lastTax is written in exactly three
     places and every one of them RESETS it to 0 — nothing ever adds to it, and
     nothing in the repo reads it. The sales tax is real and is collected into
     S.treasury through S.flow.tax (sim.js), so a driver reading lastTax reports
     a permanent zero and would have been read as "nobody pays tax". */
  const flow0 = (E.snapshot().flow) || {};
  const tax0 = flow0.tax || 0, shop0 = flow0.shopping || 0;
  let income = 0, spend = 0;
  for (let d = 0; d < days; d++) {
    E.tick(DAY, host);
    const s = HH.state();
    income += s.lastIncome || 0;
    spend += s.lastSpend || 0;
  }
  const s = HH.state();
  const sn = E.snapshot();
  const flow = sn.flow || {};
  return { pop, rung, income, spend, mix, sets,
           tax: (flow.tax || 0) - tax0,
           shopping: (flow.shopping || 0) - shop0,
           employed: (typeof HH.unemployment === 'function') ? +(1 - HH.unemployment()).toFixed(2) : null,
           tiers: { low: s.pop.low, mid: s.pop.mid, high: s.pop.high },
           savings: (s.savings.low || 0) + (s.savings.mid || 0) + (s.savings.high || 0) };
}

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) fails++;
  console.log((cond ? '  OK   ' : '  FAIL ') + name + (detail == null ? '' : '   ' + detail));
};
const n = (x) => Math.round(x).toLocaleString('en-US');

/* ══ 1. POPULATION ═══════════════════════════════════════════════════════ */
console.log('\n1. POPULATION — same schooling, more people');
const POPS = [120, 300, 700, 1500];
const byPop = POPS.map((p) => run(p, RUNGS[Math.floor(RUNGS.length / 2)]));
console.log('   pop      income         spend          sales tax     tiers(l/m/h)');
for (const r of byPop) {
  console.log('   ' + String(r.pop).padEnd(8) + n(r.income).padStart(12) + n(r.spend).padStart(15) +
              n(r.tax).padStart(14) + '  emp ' + r.employed + '  ' + r.tiers.low + '/' + r.tiers.mid + '/' + r.tiers.high);
}
ok('income rises with population, every step',
   byPop.every((r, i) => i === 0 || r.income > byPop[i - 1].income),
   byPop.map((r) => n(r.income)).join(' → '));
ok('spend rises with population, every step',
   byPop.every((r, i) => i === 0 || r.spend > byPop[i - 1].spend),
   byPop.map((r) => n(r.spend)).join(' → '));
ok('the city tax take rises with population',
   byPop[byPop.length - 1].tax > byPop[0].tax,
   n(byPop[0].tax) + ' → ' + n(byPop[byPop.length - 1].tax));

/* ══ 2. EDUCATION ════════════════════════════════════════════════════════ */
console.log('\n2. EDUCATION — same population, better schooling');
const POP = 700;
const byEdu = RUNGS.map((r) => run(POP, r));
console.log('   rung            mix(l/m/h)           income         spend          sales tax');
for (const r of byEdu) {
  const m = r.mix ? [r.mix.low, r.mix.mid, r.mix.high].map((x) => x.toFixed(2)).join('/') : '—';
  console.log('   ' + String(r.rung).padEnd(16) + m.padEnd(20) + n(r.income).padStart(12) +
              n(r.spend).padStart(15) + n(r.tax).padStart(14));
}
const worst = byEdu[0], best = byEdu[byEdu.length - 1];
ok('the education ladder produces DIFFERENT wealth mixes at all',
   byEdu.some((r) => r.mix) && JSON.stringify(worst.mix) !== JSON.stringify(best.mix),
   JSON.stringify(worst.mix) + '  vs  ' + JSON.stringify(best.mix));
ok('a fully-schooled city SPENDS more than an unschooled one of the same size',
   best.spend > worst.spend,
   n(worst.spend) + ' (' + worst.rung + ') → ' + n(best.spend) + ' (' + best.rung + ')  = ' +
   (worst.spend > 0 ? (best.spend / worst.spend).toFixed(2) + '×' : 'n/a'));
ok('...and EARNS more', best.income > worst.income,
   n(worst.income) + ' → ' + n(best.income) + '  = ' +
   (worst.income > 0 ? (best.income / worst.income).toFixed(2) + '×' : 'n/a'));
ok('...and pays more sales tax to the city', best.tax > worst.tax,
   n(worst.tax) + ' → ' + n(best.tax));
/* Monotonic is the strong claim; report it either way rather than only asserting
   the endpoints, because a ladder that only pays at the top rung is a ladder
   nobody climbs. */
const mono = byEdu.every((r, i) => i === 0 || r.spend >= byEdu[i - 1].spend);
ok('every rung is worth climbing (spend never goes DOWN a rung)', mono,
   byEdu.map((r) => n(r.spend)).join(' → '));

console.log('\nthe closed loop is untouched by any of this');
const sn = E.snapshot();
const audit = sn.lastAudit || sn.audit || null;
ok('the Cinder audit still balances', !!(audit && audit.ok),
   audit ? 'err=' + Number(audit.err || 0).toExponential(2) : 'no audit record');

console.log(fails ? '\n' + fails + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
