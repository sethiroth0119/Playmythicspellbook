/* 🐄⚗ THE FEEDSTOCK PLANT DID NOTHING, AND THE FARM DID NOT EXIST (v121v80).

   Reported: "I have a feedstock plant. It has no inputs or outputs or any other
   details for a supply chain. At the moment it is just drawing power… there's
   no further clues what this building needs to work, what should come before it
   etc." And: "Create a farm building that is preparing for a farm business
   where players will be able to take care of animals and slaughter them.
   Prepare for that, remember that is coming."

   THE FEEDSTOCK PLANT was one of three rows on the same rung that declared
   `pop`, `crew`, `powerNeed` and a description naming a recipe — and no `gen`
   and no `use` at all. ECO_BUILDING_MAP had said what each one makes since the
   day it was added; that half was simply never connected to the tile economy,
   so the Production-chain card had nothing to draw and the building had nothing
   to do but bill the player for power. They now feed each other:

       💧 water ─▶ [Process Water Plant] ─▶ industrialWater ─┐
       ⛽ fuel  ─▶ [Refinery]            ─▶ petrochemicals ──┴─▶ [Feedstock Plant] ─▶ chemicalFeedstock

   THE LIVESTOCK FARM is deliberately the first half of something. It works
   today — feed and water in, livestock and food out — and it promotes
   `livestock` into a real resource, so the coming slaughter business only has
   to declare `use: { livestock: … }` and the supply-chain panel will already
   say where it comes from.

   ⚠ ONE PROMOTION, NOT TWO, AND IT IS MEASURED. The ongoing yield wanted to be
     `eggs`. Promoting eggs ALONGSIDE livestock takes the ledger from 142 ids to
     144, and at 144 the economy gauntlet's round0t goes red on the FOUNDRY —
     dealt ground, over-charged 552🔥 against a bound of 4🔥. Measured in both
     directions: 143 ids is green, 144 is not, and removing them again clears
     it. So the defect is in the CHARGE PATH and is older than this building;
     the ledger composition is only what exposes it. `food` is the honest
     stand-in until that is fixed, and eggs is a one-line swap afterwards.

   Run: node _cityfarm_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';
let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IDX = readFileSync('./public/index.html', 'utf8');
const CHAIN = readFileSync('./public/src/resources/chain.js', 'utf8');
const PROD = readFileSync('./public/src/city/production.data.js', 'utf8');

function litOf(src, name, open) {
  const i = src.indexOf('const ' + name + ' = ' + open);
  if (i < 0) throw new Error('cannot find ' + name);
  const close = open === '[' ? ']' : '}';
  let d = 0;
  for (let k = src.indexOf(open, i); k < src.length; k++) {
    if (src[k] === open) d++;
    else if (src[k] === close) { d--; if (!d) return src.slice(src.indexOf(open, i), k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const BUILDINGS = (() => {
  const ctx = { STOCK_CAP_PER_WAREHOUSE: 400 };
  vm.createContext(ctx);
  for (let i = 0; i < 40; i++) {
    try { return vm.runInContext('(' + litOf(NC, 'BUILDINGS', '{') + ')', ctx); }
    catch (e) { const m = /(\w+) is not defined/.exec(String(e && e.message)); if (!m) throw e; ctx[m[1]] = 0; }
  }
  throw new Error('BUILDINGS would not evaluate');
})();
const ECO = vm.runInContext('(' + litOf(NC, 'ECO_BUILDING_MAP', '{') + ')', vm.createContext({}));

/* ── 1. THE FEEDSTOCK CHAIN IS A CHAIN ───────────────────────────────────── */
{
  for (const [k, label] of [['procwater', 'Process Water Plant'], ['refinery', 'Refinery'], ['feedplant', 'Feedstock Plant']]) {
    const d = BUILDINGS[k];
    ok(d && d.gen && Object.keys(d.gen).length > 0, label + ' declares an output', JSON.stringify(d && d.gen));
    ok(d && d.use && Object.keys(d.use).length > 0, label + ' declares an input — it is a step, not a faucet', JSON.stringify(d && d.use));
  }
  const fp = BUILDINGS.feedplant;
  ok(fp.use.petrochemicals > 0 && fp.use.industrialWater > 0,
    'the Feedstock Plant eats exactly what its description always said it eats', JSON.stringify(fp.use));
  ok(fp.gen.chemicalFeedstock > 0, 'and makes chemical feedstock', JSON.stringify(fp.gen));
  /* THE POINT OF THE WHOLE FIX: "what should come before it" is now answerable
     from the data, which is what the Production-chain card reads. */
  const makersOf = (res) => Object.keys(BUILDINGS).filter(b => BUILDINGS[b].gen && BUILDINGS[b].gen[res] > 0);
  ok(makersOf('petrochemicals').indexOf('refinery') >= 0, 'and the Refinery is a real answer to "where do petrochemicals come from"', makersOf('petrochemicals').join(', '));
  ok(makersOf('industrialWater').indexOf('procwater') >= 0, 'as is the Process Water Plant for industrial water', makersOf('industrialWater').join(', '));
  ok(makersOf('chemicalFeedstock').length > 0, 'and the feedstock itself now has a producer at all', makersOf('chemicalFeedstock').join(', '));
}

/* ── 2. AND ITS INPUTS CAN ACTUALLY BE HELD ──────────────────────────────── */
{
  const stock = Object.keys(vm.runInContext('(' + litOf(NC, 'CITY_STOCK', '{') + ')', vm.createContext({})));
  const hudRes = vm.runInContext('(' + litOf(NC, 'HUD_RES', '[') + ')', vm.createContext({}));
  const extra = /HUD_RES\.concat\((\[[^\]]*\])\)/.exec(NC);
  const mirrored = hudRes.concat(JSON.parse(extra[1].replace(/'/g, '"')));
  const usable = new Set(stock.concat(mirrored));
  for (const r of ['petrochemicals', 'industrialWater'])
    ok(usable.has(r), r + ' is mirrored — an unmirrored input reads 0 for ever and the building silently never runs');
  for (const r of ['petrochemicals', 'industrialWater'])
    ok(NC.indexOf('id="r-' + r + '"') > 0 && NC.indexOf('id="d-' + r + '"') > 0,
      r + ' has its HUD elements — updateHUD writes to them unguarded and would throw on a missing one');
  /* chemicalFeedstock is NOT mirrored on purpose: nothing consumes it yet. */
  ok(!usable.has('chemicalFeedstock'),
    'chemical feedstock is NOT mirrored — nothing eats it yet, so it banks to the vault like the Sugar Mill\'s sugar');
}

/* ── 3. THE LIVESTOCK FARM ───────────────────────────────────────────────── */
{
  const f = BUILDINGS.stockfarm;
  ok(!!f, 'the Livestock Farm exists');
  ok(f && f.gen && f.gen.livestock > 0, 'it raises livestock — the handle the coming slaughter business will pull', JSON.stringify(f && f.gen));
  /* ⚠ food, NOT eggs, and the reason is measured — see the note on the row.
     Promoting a SECOND id alongside livestock takes the ledger to 144 and the
     economy gauntlet's round0t goes red on the foundry's dealt-ground charge.
     One promotion is green; two is not. */
  ok(f && f.gen && f.gen.food > 0, 'and the herd feeds the city between slaughters, so caring for it earns over time', String(f && f.gen && f.gen.food));
  ok(!(f && f.gen && f.gen.eggs), 'eggs is deliberately NOT promoted yet — a second new ledger id trips round0t');
  ok(f && f.use && f.use.food > 0 && f.use.water > 0, 'the animals eat and drink — it is not a faucet', JSON.stringify(f && f.use));
  ok(f && f.crew > 0, 'somebody has to work it');
  ok(f && f.outdoor === true, 'and it is outdoors, so weather bites the herd like it bites a Farm');
  ok(!(f && f.gen && f.gen.cinder), 'it does not mint Cinder — it makes animals, which are sold on');
  /* Buildable, or it may as well not exist. */
  ok(/'farm', 'hydrofarm', 'stockfarm'/.test(NC), 'it is in the Production tab of the build menu, beside the other farms');
  ok(/'streetlight','farm','hydrofarm','stockfarm'/.test(NC), 'and in BUILD_ORDER');
  ok(BUILDINGS.stockfarm.mesh === 'farm', 'it reuses a mesh that exists — a missing case renders an invisible building');
}

/* ── 4. THE PROMOTION IS DERIVED, NOT HAND-WRITTEN ───────────────────────── */
{
  ok(ECO.stockfarm && Array.isArray(ECO.stockfarm.out), 'the farm is in ECO_BUILDING_MAP, which is what promotes its ids');
  ok(ECO.stockfarm.out.indexOf('livestock') >= 0 && ECO.stockfarm.out.length === 1,
    'declaring exactly ONE promoted output — a second takes the ledger to 144 and round0t goes red on the foundry',
    JSON.stringify(ECO.stockfarm && ECO.stockfarm.out));
  const promoted = vm.runInContext('(' + litOf(PROD, 'PROMOTED_CHAIN_IDS', '[') + ')', vm.createContext({}));
  for (const id of ['livestock'])
    ok(promoted.indexOf(id) >= 0, id + ' is in PROMOTED_CHAIN_IDS — the gate re-derives this from the map and fails on any drift');
  /* Alphabetical, because that is the order the derivation emits. */
  /* ⚠ PLAIN .sort(), NOT localeCompare. The derivation emits code-unit order,
     which puts 'aluminumOre' before 'anomalousEnergy' where a locale collator
     does not — asserting the wrong comparator fails on ids nobody touched. */
  const sorted = promoted.slice().sort();
  ok(promoted.join(',') === sorted.join(','), 'and the array is still in the derivation\'s own order');

  const res = vm.runInContext('(' + litOf(IDX, 'RESOURCES', '[') + ')', vm.createContext({}));
  const byId = {}; res.forEach(r => byId[r.id] = r);
  for (const id of ['livestock']) ok(!!byId[id], id + ' is a real RESOURCES row — the player can hold it');
  /* The camp and the city must print the same glyph — the gate asserts this too. */
  for (const id of ['livestock']) {
    const m = new RegExp("\\{ id: '" + id + "',\\s+name: '([^']+)',\\s+icon: '([^']+)',\\s+color: '([^']+)'").exec(CHAIN);
    ok(!!m, id + ' is in chain.js');
    if (m && byId[id]) {
      ok(byId[id].name === m[1] && byId[id].icon === m[2] && byId[id].color === m[3],
        id + ' matches chain.js name/icon/colour verbatim',
        JSON.stringify([byId[id].name, byId[id].icon, byId[id].color]) + ' vs ' + JSON.stringify([m[1], m[2], m[3]]));
    }
  }
  ok(byId.livestock && byId.livestock.icon === '🐄', 'and livestock got its own glyph rather than the generic crop one', byId.livestock && byId.livestock.icon);
}

/* ── 5. PRICED, OR THE FARM IS A CINDER FAUCET ───────────────────────────── */
{
  const val = vm.runInContext('(' + litOf(IDX, 'RESOURCE_CINDER_VALUE', '{') + ')', vm.createContext({}));
  for (const id of ['livestock'])
    ok(val[id] === 2, id + ' is priced EXPLICITLY at the tier-1 parity, floor(78/28) = 2 — unpriced it falls through the crash guard at 3, above its own inputs, and the gate calls that a faucet',
      String(val[id]));
  ok(/return RESOURCE_CINDER_VALUE\[id\] \|\| 3;/.test(IDX), 'the `|| 3` is still only a crash guard');
  /* The line the heredoc ate once. Cheap insurance that the tier survived. */
  for (const id of ['beverages', 'bread', 'cannedFood', 'cardStock', 'boosterPacks'])
    ok(val[id] === 2, 'the rest of the tier-1 shelf is intact (' + id + ')', String(val[id]));
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
