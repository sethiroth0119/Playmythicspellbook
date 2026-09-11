/* ══════════════════════════════════════════════════════════════════════════
   🚗 VEHICLES — do NPCs actually buy the cars the city builds?

   THE FINDING THIS GUARDS. `cars`, `electricVehicles` and `buses` each have a
   full recipe and a five-industry chain behind them, and node-city ships a
   "Car Dealership" operation that assembles them — but grep the graph and
   those ids appear ONLY as definitions. Nothing consumed them and no basket
   category bought them, so the dealership was a firm that produced into a
   market with no buyer on either side: healthy books, zero revenue, for ever.

   WHAT CHANGED. A `vehicles` household category and a `carDealer` RETAIL
   industry. demand.js routes household spending to retail/service only, so
   the old `autoPlant` (manufacturing) wiring could never receive a resident's
   money no matter how many cars it built.

   ⚠ THE CONTROL IS THE OLD WIRING, NOT A DISABLED FEATURE. The same city is
     run twice, identical seed and population, with the dealership's industry
     as the ONLY variable. If the control also earns, this test is not
     measuring the change.

   Run:  node tools/economy-tests/vehicles.mjs
   ══════════════════════════════════════════════════════════════════════════ */
const P = '../../public/src/economy/';
global.window = { MythicCityBridge: { addCinders: async () => {} }, MythicResourceChain: null };
const chain = await import('../../public/src/resources/chain.js');
global.window.MythicResourceChain = { ALL: chain.RESOURCE_CHAIN };
const Sim = await import(P + 'sim.js');
const HH = await import(P + 'households.js');
const Firms = await import(P + 'firms.js');
const Recipes = await import(P + 'recipes.js');

let fails = [];
const chk = (name, cond, extra) => {
  if (!cond) { fails.push(name); console.log('❌ ' + name + (extra ? ' :: ' + extra : '')); }
  else console.log('✅ ' + name + (extra ? ' :: ' + extra : ''));
};
const host = { powerFactor: 1, waterFactor: 1, logisticsCounts: { warehouse: 3 }, hasBank: false, infrastructure: 0.7 };

console.log('\n🚗 VEHICLE DEMAND\n');

// ── 1. The category and the industry exist and are shaped correctly ────────
const basket = HH.BASKET || [];
const veh = basket.find(b => b.key === 'vehicles');
chk('a `vehicles` category exists in the household basket', !!veh);
// RESOURCE_CHAIN is an ARRAY of 258 records, not a map keyed by id.
const CHAIN_IDS = new Set((chain.RESOURCE_CHAIN || []).map(r => r && r.id));
chk('it buys real chain ids', !!veh && veh.res.every(r => CHAIN_IDS.has(r)),
  veh ? veh.res.join(', ') : '');
chk('it routes to the carDealer industry', !!veh && veh.ind === 'carDealer', veh ? veh.ind : '');
const IND = Recipes.INDUSTRIES || {};
chk('carDealer is a RETAIL industry (household money only reaches retail/service)',
  !!IND.carDealer && IND.carDealer.kind === 'retail', IND.carDealer ? IND.carDealer.kind : 'missing');

// ── 2. The basket still totals 1.00 — the share was taken, not added ───────
const total = basket.reduce((s, b) => s + (b.share || 0), 0);
chk('the basket still totals 1.00 (share redirected, not invented)',
  Math.abs(total - 1) < 1e-9, total.toFixed(4));

// ── 3. Residents actually want to spend on it ─────────────────────────────
Sim.reset('veh-demand'); HH.setPopulation(300); Sim.bootstrap();
for (let i = 0; i < 40; i++) Sim.advance(20, host);
const d = HH.demand(1);
chk('residents put real Cinder behind vehicles each step', (d.vehicles || 0) > 0,
  (d.vehicles || 0).toFixed(2) + ' 🔥/step');

/* ── 4. THE STRUCTURAL CONTROL ─────────────────────────────────────────────
   There is no "feature off" build to A/B against, so the control is the OLD
   WIRING'S OWN SHAPE, asserted directly: with cars in no basket category and
   the dealership on a `manufacturing` industry, there was no path from a
   resident's wallet to a car — not a small effect, an absent one.

   ⚠ AN EARLIER VERSION OF THIS TEST COMPARED FIRM CASH between a retail and a
     manufacturing dealership and reported both losing 7,632 🔥. That number
     measured nothing: the test city has no ground endowment, so every
     extraction firm upstream is dry and the dealership cannot assemble a
     single car in EITHER arm. A comparison where neither side can produce is
     not a comparison. What is actually verifiable here is the demand route,
     and that is what is asserted. */
const others = basket.filter(b => b.key !== 'vehicles' && (b.res || []).some(r => r === 'cars' || r === 'electricVehicles'));
chk('no OTHER basket category buys a car — so this route is the only one',
  others.length === 0, others.map(o => o.key).join(', ') || 'none');
chk('autoPlant (the old industry) is manufacturing, which household money never reaches',
  IND.autoPlant && IND.autoPlant.kind === 'manufacturing', IND.autoPlant ? IND.autoPlant.kind : 'missing');
chk('…and carDealer is retail, which it does', IND.carDealer.kind === 'retail');

// ── 5. Real, measured NPC demand, and a clean audit ───────────────────────
Sim.reset('veh-run'); HH.setPopulation(300); Sim.bootstrap();
let vehWant = 0, audits = 0, bad = 0;
for (let i = 0; i < 120; i++) {
  vehWant += (HH.demand(1).vehicles || 0);
  Sim.advance(20, host);
  const a = Sim.state().lastAudit;
  if (a) { audits++; if (!a.ok) bad++; }
}
console.log('');
chk('🎯 residents put REAL Cinder behind vehicles over 120 steps',
  vehWant > 100, vehWant.toFixed(0) + ' 🔥 of NPC vehicle demand');
chk('🎯 the audit stayed clean for every one of those days (nothing minted)',
  bad === 0 && audits > 0, bad + ' bad of ' + audits);

/* ⚠ WHAT THIS TEST DOES **NOT** SHOW. It does not show a dealership EARNING.
   Demand is wired and measured here, and the supply side is now structurally
   complete — all 48 ids in the car chain have a producer building, where 19
   had none. But structurally complete is not the same as running:

     • ONE NODE IN ~500 carries all 14 ground deposits the chain needs, which
       is the specialization design working as intended, not a defect.
     • Driven synthetically — 48 firms founded in topological order, 12 days
       apart, on a node with all 14 deposits — the Engine Works still died and
       `bottleneck.trace('cars')` named it: "engines → Nobody makes it". Half a
       mature city's firms idle for want of a downstream customer (ECONOMY.md
       says so plainly), and a 48-rung chain feels that hardest at the bottom.

   So: the buildings exist, the demand exists, and the last mile — a chain that
   sustains itself long enough to put a car on a lot — is NOT demonstrated. Do
   not read a green run here as "cars sell". */
console.log('');
console.log('   ⚠ demand is measured and supply is now structurally complete (48/48 ids');
console.log('     have a producer), but a car has NOT been observed reaching a customer.');
console.log('     See the note at the foot of this file.');

console.log('');
if (fails.length) { console.log('❌ ' + fails.length + ' CHECK(S) FAILED'); process.exit(1); }
console.log('✅ VEHICLES: all checks green');
