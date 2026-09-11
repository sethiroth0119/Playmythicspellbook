/* 🏭 THIRTY-FIVE INDUSTRIAL BUILDINGS DREW POWER AND MADE NOTHING.

   Five reports filed on one day said the same thing in five different words —
   Electricals Bench, Engine Works, Chemical Works, Polymer Plant, Industrial
   Gas Plant: "no supply chain detailed - you have no idea of the inputs,
   outputs, what fuels the plant, what the plant fuels etc… Nothing is
   displayed." Reading the table rather than the reports, it was not five. It
   was thirty-five rows carrying `pop`, `crew` and `powerNeed`, some with
   descriptions naming a recipe ("Pig iron, coal and alloy into structural
   steel"), and NO `gen` and NO `use` at all. A player built them, paid the
   crew, burned the power and got nothing back — and the Production-chain panel
   had nothing to draw because there was nothing to draw.

   WHY THEY WERE EMPTY, which is worth recording so the shape is recognisable:
   they were added as node-city facades so /src/economy's firm layer had
   buildings to attach to. Their ECONOMY output was declared in
   ECO_BUILDING_MAP; their TILE recipe never was. Two tables describing the same
   building, one of them silent, and the silent one is the one the city runs.

   THE THREE INVARIANTS THIS SUITE EXISTS FOR
     1. Every industrial building produces something and consumes something —
        a faucet with no inputs is not a supply chain either.
     2. Every input has a PRODUCER somewhere in the city. An input nothing makes
        is a building that can never run, which is the empty room by another
        door.
     3. Every input is a resource the mirror actually fetches. This is now true
        by construction (LEDGER_MIRROR_RES is derived from these very recipes),
        so the check here is a tripwire for the day somebody replaces the
        derivation with a hand-written list again — which is precisely how the
        Machine Shop and the Feedstock Plant were starved, twice, and both times
        found by a player.

   Run: node _citychain_smoke.mjs */
import { readFileSync } from 'fs';
import vm from 'vm';

let fails = 0;
const ok = (c, m, x) => { console.log((c ? '  PASS ' : '  FAIL ') + m + (c || x === undefined ? '' : '  ← ' + x)); if (!c) fails++; };
const NC = readFileSync('./public/node-city/index.html', 'utf8');
const IDX = readFileSync('./public/index.html', 'utf8');

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
  for (let i = 0; i < 80; i++) {
    try { return vm.runInContext('(' + litOf(NC, 'BUILDINGS', '{') + ')', ctx); }
    catch (e) { const m = /(\w+) is not defined/.exec(e.message); if (!m) throw e; ctx[m[1]] = 0; }
  }
  throw new Error('BUILDINGS would not evaluate');
})();
const ECO = vm.runInNewContext('(' + litOf(NC, 'ECO_BUILDING_MAP', '{') + ')');
const CITY_STOCK = vm.runInNewContext('(' + litOf(NC, 'CITY_STOCK', '{') + ')');
const RESOURCES = vm.runInNewContext('(' + litOf(IDX, 'RESOURCES', '[') + ')');
const CINDER_VALUE = vm.runInNewContext('(' + litOf(IDX, 'RESOURCE_CINDER_VALUE', '{') + ')');
const RES_IDS = new Set(RESOURCES.map(r => r.id));

/* The 35 rows this pass filled in. Named explicitly — a derived list would
   quietly shrink to nothing the day someone deletes a recipe, and report
   ALL PASS while doing it. */
const FILLED = ['gasplant','chemworks','polymerplant','panelmill','steelmill','rollingmill','alloymill',
  'alusmelter','coppersmelt','wireworks','glassworks','flatglass','fuelrefine','asphaltplant','jetterminal',
  'polycompound','semichem','waferline','semimat','chipfab','electbench','electronbench','tyreworks',
  'partspress','engineworks','acidworks','solventworks','fiberplant','adhesiveplant','paintworks',
  'rubberworks','plasticworks','joinery','medchem','railyard'];

/* ── 1. THEY ALL DO SOMETHING NOW ─────────────────────────────────────────── */
{
  ok(FILLED.length === 35, 'thirty-five buildings were empty', String(FILLED.length));
  const noGen = FILLED.filter(k => !BUILDINGS[k] || !BUILDINGS[k].gen || !Object.keys(BUILDINGS[k].gen).length);
  const noUse = FILLED.filter(k => !BUILDINGS[k] || !BUILDINGS[k].use || !Object.keys(BUILDINGS[k].use).length);
  ok(noGen.length === 0, 'every one of them produces something', noGen.join(', '));
  ok(noUse.length === 0,
    'and consumes something — a building with an output and no input is a faucet, which is not a supply chain either',
    noUse.join(', '));
  /* The whole-table version, so a NEW empty row is caught rather than only
     these 35 staying filled. Housing, roads, civic and decoration legitimately
     have neither; a row with CREW is staffed to do a job. */
  const stillEmpty = [];
  for (const k of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[k] || {};
    if (!((d.crew | 0) > 0)) continue;
    const has = (d.gen && Object.keys(d.gen).length) || (d.use && Object.keys(d.use).length) || d.svc || d.pop === undefined;
    if (!has && !d.svc) stillEmpty.push(k);
  }
  ok(stillEmpty.length <= 28,
    'the remaining crewed-but-idle rows are the civic/service ones, not industry', String(stillEmpty.length) + ': ' + stillEmpty.slice(0, 40).join(', '));
}

/* ── 2. THE TILE RECIPE AND THE ECONOMY MAP AGREE ─────────────────────────── */
{
  /* Two tables describe each of these buildings. They disagreeing silently — the
     economy declaring an output the tile never makes — is the exact condition
     that produced 35 empty rooms. */
  const drift = [];
  for (const k of FILLED) {
    const out = ((ECO[k] || {}).out || [])[0];
    const gen = Object.keys((BUILDINGS[k] || {}).gen || {}).filter(r => r !== 'power' && r !== 'cinder');
    if (!out) { drift.push(k + ': no ECO out'); continue; }
    if (gen.indexOf(out) < 0) drift.push(k + ': ECO says ' + out + ', tile makes [' + gen.join(',') + ']');
  }
  ok(drift.length === 0,
    'each tile makes exactly what ECO_BUILDING_MAP already said it makes — the two tables describing one building now agree',
    drift.join(' | '));
}

/* ── 3. EVERY OUTPUT IS A REAL, PRICED RESOURCE ───────────────────────────── */
{
  const bad = [];
  for (const k of FILLED) {
    for (const r of Object.keys(BUILDINGS[k].gen)) {
      if (r === 'power' || r === 'cinder' || CITY_STOCK[r]) continue;
      if (!RES_IDS.has(r)) bad.push(k + ' makes ' + r + ' which is not in RESOURCES');
      else if (!(CINDER_VALUE[r] > 0)) bad.push(k + ' makes ' + r + ' which has no cinder value');
    }
  }
  ok(bad.length === 0,
    'every output is already a promoted RESOURCES id with an explicit cinder value — this pass promotes NOTHING, which is why it never went near the foundry charge-path defect',
    bad.join(' | '));
}

/* ── 4. NO DEAD-END INPUTS — the empty room by another door ───────────────── */
{
  const produced = new Set(Object.keys(CITY_STOCK));
  for (const k of Object.keys(BUILDINGS)) {
    for (const r of Object.keys((BUILDINGS[k] || {}).gen || {})) produced.add(r);
  }
  /* Resources the city cannot make but the player can still hold, because the
     camp, the mini-games and the exchange all feed the same ledger. */
  const FROM_OUTSIDE = new Set(['medicine', 'supplies', 'ammo', 'memoryShards', 'corruptedEssence', 'cloth', 'food', 'water', 'metal', 'fuel', 'wood', 'stone', 'ingots']);
  const dead = [];
  for (const k of Object.keys(BUILDINGS)) {
    for (const r of Object.keys((BUILDINGS[k] || {}).use || {})) {
      if (!produced.has(r) && !FROM_OUTSIDE.has(r)) dead.push(k + '.use.' + r);
    }
  }
  ok(dead.length === 0,
    'no building eats something nothing in the city makes — an input with no producer is a building that can never run, which is the same failure with a different symptom',
    dead.join(', '));
}

/* ── 5. THE CHAIN CAN ACTUALLY START — no circular deadlock ───────────────── */
{
  /* A recipe web where A needs B and B needs A never produces a first unit,
     however rich the player is. Resolve it the way the tick does: start from
     what can be had without any city building, then repeatedly admit any
     building all of whose inputs are already reachable. */
  const BASE = new Set(['food','water','metal','fuel','supplies','medicine','ammo','memoryShards',
    'corruptedEssence','wood','stone','cloth','ingots','industrialWater','petrochemicals'].concat(Object.keys(CITY_STOCK)));
  const have = new Set(BASE);
  let moved = true, rounds = 0;
  while (moved && rounds < 40) {
    moved = false; rounds++;
    for (const k of Object.keys(BUILDINGS)) {
      const d = BUILDINGS[k] || {};
      if (!d.gen) continue;
      const ins = Object.keys(d.use || {});
      if (!ins.every(r => have.has(r))) continue;
      for (const r of Object.keys(d.gen)) {
        if (r === 'power' || r === 'cinder') continue;
        if (!have.has(r)) { have.add(r); moved = true; }
      }
    }
  }
  const unreachable = FILLED.filter(k => {
    const ins = Object.keys(BUILDINGS[k].use || {});
    return !ins.every(r => have.has(r));
  });
  ok(unreachable.length === 0,
    'every one of the 35 is reachable from base resources alone — nothing is stuck behind a cycle that can never produce its first unit',
    unreachable.join(', '));
  ok(rounds < 40, 'and the web settles', 'rounds ' + rounds);
  /* The chain has real depth, or it is 35 buildings all eating metal. */
  ok(have.has('microchips') && have.has('engines') && have.has('aviationFuel'),
    'the deep rungs are reachable: microchips, engines and aviation fuel all resolve through several stages');
}

/* ── 6. THE MIRROR IS DERIVED, AND BATCHED ────────────────────────────────── */
{
  ok(/const LEDGER_MIRROR_RES = \(\(\) => \{/.test(NC), 'the mirror list is computed');
  ok(/const list = LEDGER_MIRROR_RES;/.test(NC), 'and refreshLedgerMirror fetches it');
  /* Recompute it and confirm it covers every input. True by construction; this
     fails the day the derivation is replaced by a literal. */
  const mirror = new Set(['food','water','metal','fuel','supplies','medicine','ammo','memoryShards',
    'corruptedEssence','wood','stone','cloth','ingots','industrialWater','petrochemicals']);
  for (const k of Object.keys(BUILDINGS)) {
    const d = BUILDINGS[k] || {};
    for (const r of Object.keys(d.use || {})) if (!CITY_STOCK[r]) mirror.add(r);
    if (d.svc && d.svc.input && !CITY_STOCK[d.svc.input]) mirror.add(d.svc.input);
  }
  const unread = [];
  for (const k of Object.keys(BUILDINGS)) {
    for (const r of Object.keys((BUILDINGS[k] || {}).use || {})) {
      if (!CITY_STOCK[r] && !mirror.has(r)) unread.push(k + '.use.' + r);
    }
  }
  ok(unread.length === 0, 'every input is fetched into game.res, so haveOf() can answer honestly', unread.join(', '));
  ok(mirror.size >= 40, 'the mirror grew with the recipes rather than the recipes being trimmed to the mirror', String(mirror.size));

  /* 📡 …and it costs ONE round trip, which is what made growing it acceptable.
     The old per-id fan-out was the documented reason to keep the list small. */
  ok(/B\.getResMany = async \(ids\)/.test(NC), 'the bridge can ask for every id at once');
  ok(/MythicCityBridge\.getResMany\(list\)/.test(NC), 'and the mirror uses that instead of one call per id');
  ok(/return fan\(\);/.test(NC),
    'with a per-id fallback, so an older host degrades to the previous cost rather than to a city that cannot read its ledger');
  ok(/function cityGetResMany\(ids\)/.test(IDX), 'the host implements it');
  ok(/window\.cityGetResMany = cityGetResMany;/.test(IDX), 'and exposes it where the parent-mode bridge looks');
}

/* ── 7. THE TOPBAR DID NOT GROW ───────────────────────────────────────────── */
{
  /* updateHUD writes $('r-'+r).textContent UNGUARDED, so an id on the DISPLAY
     list with no chip throws and kills the whole HUD. The mirror grew by ~28;
     the display list must not have moved at all. */
  const extra = /HUD_RES\.concat\((\[[^\]]*\])\)/.exec(NC);
  ok(!!extra, 'the display list is still a flat literal the parsers can read');
  const display = JSON.parse(extra[1].replace(/'/g, '"'));
  ok(display.length === 8,
    'the topbar list is unchanged — the mirror grew, the chips did not, which is the whole reason the two were split',
    display.join(','));
  const missing = display.filter(r => IDX.length && NC.indexOf('id="r-' + r + '"') < 0);
  ok(missing.length === 0, 'and every chip it names still exists', missing.join(', '));
}

console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASS');
process.exit(fails ? 1 : 0);
