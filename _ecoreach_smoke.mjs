/* 🏭 TWENTY-SIX BUSINESSES COULD NEVER PRODUCE A SINGLE UNIT.

   Reported: "Several values are always at zero in the living economy,
   regardless whether you have the people or resources which would fill those —
   Workers, Structural Steel, Lumber Supply, Metal Components Supply."

   The Living Economy is NOT the city tile layer. Firms hold their own inventory
   (sim.js S.INV) and availability is have/want against it, so a resource the
   tiles produce in quantity is still 0% here unless a FIRM makes it. Walking
   the recipe graph from what a player can actually found — every `out` of
   ECO_BUILDING_MAP and OP_ECO_MAP, with deposits as the free tier — 26 of the
   123 foundable outputs were arithmetically unreachable. Not throttled, not
   slow: no sequence of buildings, in any order, with any amount of money,
   produces the first unit.

   TWO OF THE ROOTS WERE REQUIREMENTS NOTHING COULD EVER SATISFY, and they are
   what this suite pins:

     1. 🔗 steel[blast] wanted `metalAlloys`, and EVERY metalAlloys leg wants
        `steel`. A closed loop with no entry. The alternate arc leg is not an
        escape: it runs on recycledMetal, which is made from industrialWaste,
        and BYPRODUCTS is declared, priced, and NEVER EMITTED by the sim — so
        the whole recycling industry is inert and the arc route is dead too.
        Twelve firms hung off that one 0.04, including every id the report
        names by way of metalComponents ← sheetMetal ← steel.

     2. 🪵 woodPanels wanted raw `wood` on top of `lumber`, and no building
        yields `wood` as a firm output — the Lumber Camp yields timber, the
        Sawmill turns that into lumber. Three more firms behind an id nothing
        could produce.

   THE INVARIANT: a business a player can found must be able to produce. A firm
   that cannot is worse than a missing one, because the player builds it, staffs
   it, pays it and watches it sit at 0% with no way to find out why.

   ⚠ WHAT THIS SUITE DOES NOT CLAIM. Eleven outputs are still unreachable and
     they are listed below as a KNOWN set rather than hidden — every one of them
     is blocked on a missing PRODUCER (nothing in the game makes flour, meat,
     cookingOil, animalFeed, cleaningChemicals, structuralSteel, woodPulp,
     recycledPaper, computers, advancedSensors, diagnosticEquipment, or any
     waste at all), which is a content decision and not a recipe defect. The
     count is asserted so it can only go DOWN.

   Run: node _ecoreach_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
import { DEPOSITS, BYPRODUCTS, RECIPES, legsOf, producible } from './public/src/economy/recipes.js';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const PAT = readFileSync('./public/src/city/patronage.js', 'utf8');

function litOf(name, open) {
  const i = NC.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = NC.indexOf(open, i); k < NC.length; k++) {
    if (NC[k] === open) d++;
    else if (NC[k] === close) { d--; if (!d) return NC.slice(NC.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const ECO = vm.runInNewContext('(' + litOf('ECO_BUILDING_MAP', '{') + ')');
const OP = vm.runInNewContext('(' + litOf('OP_ECO_MAP', '{') + ')');
const BUILDINGS = (() => {
  const ctx = { STOCK_CAP_PER_WAREHOUSE: 400 };
  vm.createContext(ctx);
  for (let i = 0; i < 80; i++) {
    try { return vm.runInContext('(' + litOf('BUILDINGS', '{') + ')', ctx); }
    catch (e) { const m = /(\w+) is not defined/.exec(e.message); if (!m) throw e; ctx[m[1]] = 0; }
  }
  throw new Error('BUILDINGS would not evaluate');
})();

/* Everything a player can found, and what they can reach from it. Deposits are
   the free tier: an extractor consumes nothing (sim.js skips DEPOSITS in
   availabilityMap for exactly that reason). */
const foundable = new Set();
for (const k in ECO) (ECO[k].out || []).forEach(o => foundable.add(o));
for (const k in OP) (OP[k].out || []).forEach(o => foundable.add(o));
function reachable() {
  const r = new Set();
  for (const o of foundable) if (DEPOSITS[o]) r.add(o);
  let moved = true, rounds = 0;
  while (moved && rounds < 80) {
    moved = false; rounds++;
    for (const o of foundable) {
      if (r.has(o)) continue;
      for (const leg of legsOf(o)) {
        if (Object.keys(leg.in || {}).every(i => r.has(i))) { r.add(o); moved = true; break; }
      }
    }
  }
  return r;
}
const REACH = reachable();
const DEAD = [...foundable].filter(o => !REACH.has(o)).sort();

/* ── 1. THE TWO RECIPE DEFECTS ARE GONE ──────────────────────────────────── */
{
  const steelLegs = legsOf('steel');
  const blast = steelLegs.find(l => (l.tag || 'default') === 'blast') || steelLegs[0];
  ok(!('metalAlloys' in (blast.in || {})),
    'steel no longer requires metalAlloys — every metalAlloys leg requires steel, so that 0.04 was a closed loop with no entry',
    JSON.stringify(blast.in));
  ok(Object.keys(legsOf('metalAlloys')).length > 0 && legsOf('metalAlloys').every(l => 'steel' in (l.in || {})),
    'and metalAlloys still requires steel — the loop was broken on the side that made sense, not by loosening both');
  ok(!('wood' in (RECIPES.woodPanels.in || {})),
    'woodPanels no longer requires raw wood on top of lumber — no building yields wood as a firm output',
    JSON.stringify(RECIPES.woodPanels.in));
  ok((RECIPES.woodPanels.in || {}).lumber > 0, 'it still takes lumber, and more of it', JSON.stringify(RECIPES.woodPanels.in));
  ok((RECIPES.woodPanels.in || {}).adhesives > 0, 'and still takes glue — the Adhesive Plant is still its supplier');
}

/* ── 2. THE FIRMS THE REPORT NAMED CAN NOW RUN ───────────────────────────── */
{
  for (const id of ['steel', 'sheetMetal', 'metalComponents', 'metalAlloys', 'lumber', 'woodPanels'])
    ok(REACH.has(id), 'reachable: ' + id + ' — named in the report as permanently 0%');
  /* The whole ferrous tree that hung off the cycle. */
  for (const id of ['electricalComponents', 'vehicleParts', 'machineParts', 'engines', 'cars',
                    'appliances', 'householdGoods', 'sportingGoods', 'furnitureComponents', 'furniture'])
    ok(REACH.has(id), 'reachable: ' + id);
}

/* ── 3. THE COUNT, WHICH MAY ONLY GO DOWN ────────────────────────────────── */
{
  /* 🔴 A KNOWN SET, NOT A HIDDEN ONE. Each of these is blocked on a missing
     PRODUCER — a content decision — rather than on a recipe that asks for the
     impossible. Naming them means a NEW unreachable output fails this suite
     instead of joining a silent pile. */
  const KNOWN = ['bread', 'cannedFood', 'cardboard', 'constructionComponents', 'livestock',
    'maintenanceParts', 'medicalSupplies', 'recycledGlass', 'recycledMetal', 'recycledPlastic',
    'researchEquipment'];
  const surprise = DEAD.filter(d => KNOWN.indexOf(d) < 0);
  ok(surprise.length === 0, 'no unreachable output beyond the documented set', surprise.join(', '));
  ok(DEAD.length <= KNOWN.length,
    'the unreachable count may only go down — it was 26 of ' + foundable.size + ' before the two recipe fixes',
    String(DEAD.length));
  ok(REACH.size >= 112, 'reachable outputs', REACH.size + ' of ' + foundable.size);
}

/* ── 4. THE RECYCLING INDUSTRY IS INERT, AND THAT IS WHY THE ARC LEG IS DEAD ─ */
{
  /* Recorded rather than fixed: BYPRODUCTS is a whole declared subsystem the
     sim never emits. It is the reason steel's alternate leg could not rescue
     the cycle, and it is the single change that would unblock three of the
     eleven remaining. Named here so the next person meets the fact instead of
     rediscovering it. */
  const SIM = readFileSync('./public/src/economy/sim.js', 'utf8');
  ok(!/BYPRODUCTS/.test(SIM),
    'sim.js still never emits a byproduct — waste is declared and priced but never produced, so the recycling firms have no input. Recorded, not fixed: this is the next unblock, worth three firms');
  ok(Object.keys(BYPRODUCTS).length > 0 && producible('industrialWaste'),
    'industrialWaste counts as producible, which is why a player can found a recycler that can never run');
  const arc = legsOf('steel').find(l => (l.tag || '') === 'arc');
  ok(!!arc && 'recycledMetal' in (arc.in || {}),
    'steel keeps its arc leg — it becomes live the day byproducts are emitted, and nothing here has to change for that');
}

/* ── 5. NO PATRON NEED POINTS AT A BUILDING THAT DOES NOT EXIST ──────────── */
{
  const NEEDS = vm.runInNewContext('(' + /export const NEEDS = (\[[\s\S]*?\n\]);/.exec(PAT)[1] + ')');
  const bad = [];
  for (const n of NEEDS) for (const t of n.types) if (!BUILDINGS[t]) bad.push(n.id + ' → ' + t);
  ok(bad.length === 0,
    'every venue type a resident can want is a building they can actually build — a need pointing at nothing is permanently harder to meet and reads as a pass from the need\'s own side',
    bad.join(', '));
  /* ⚠ 2, NOT 3. 'fitness' has only ever had [gym, arena] — that predates this
     round and is untouched by it, so a >= 3 bar here would be this suite
     inventing a defect. What matters is that removing the two phantom types did
     not leave a need with one venue, and that the two edited needs kept a real
     choice. */
  const tooThin = NEEDS.filter(n => n.types.length < 2).map(n => n.id);
  ok(tooThin.length === 0, 'no need is down to a single venue type', tooThin.join(', '));
  ok(NEEDS.find(n => n.id === 'fun').types.length === 3 && NEEDS.find(n => n.id === 'goods').types.length === 4,
    'and the two needs the phantom types were removed from still offer a real choice');
}

/* ── 6. THE 60× CINDER LIE ───────────────────────────────────────────────── */
{
  /* Reported: a Gas Station whose tooltip said 0.72/min and whose inspect panel
     said 0.01/min. def.gen.cinder is per-minute NOMINAL and the tick banks it
     at /CINDER_PERIOD_DIV; genOf() applies that and bldProfile's header already
     forbade reading def.gen[r] directly. Two panels did it anyway. */
  ok(/const cinderRate = \(perMin\) => \(perMin \|\| 0\) \/ CINDER_PERIOD_DIV;/.test(NC), 'cinder is still banked hourly');
  const tip = /if \(def\.gen\) h \+= 'Output: '[\s\S]{0,400}?resIco\(r\) \+ '\/min'/.exec(NC);
  ok(!!tip, 'found the hover tooltip output line');
  ok(/genOf\(def, r\)/.test(tip[0]), 'the hover tooltip goes through genOf — this line IS the reported 0.72', tip[0].slice(0, 160));
  ok(!/\(v \* b\.mult \* Math\.pow\(RATE_MULT/.test(NC), 'and no longer multiplies the raw per-minute value');
  const staff = /At full staffing it would make[\s\S]{0,260}/.exec(NC);
  ok(!!staff && /genOf\(def, r\)/.test(NC.slice(staff.index - 200, staff.index + 260)),
    'the staffing hint goes through genOf too — it sat in the SAME panel as the "Produces" row that already did');
  ok(!/insRate\(def\.gen\[r\] \* full \* of\)/.test(NC), 'and no longer reads def.gen[r] directly');
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
