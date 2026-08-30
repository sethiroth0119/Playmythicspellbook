/* ════════════════════════════════════════════════════════════════════════════
   ♻️ THE FOUNDRY — materials + the recipe graph.
   ----------------------------------------------------------------------------
   Trash in, metal out. Crude in, fuel out. This file is the DATA; machines.js
   is the hardware that runs it and state.js is the clock.

   🔴 WHY THIS IS NOT A `RESOURCES` PROMOTION.
   The live ledger in index.html is 14 ids (`RESOURCES`, ~line 39272). `metal`
   and `fuel` are in it; `steel`, `crudeOil`, `gasoline`, `pigIron` and every
   waste id are NOT — they exist only in the src/resources/chain.js CATALOGUE.
   RESOURCES_NEXT.md quotes the r12 notes on what happens if you ship an id that
   is bankable but unmakeable:

     "A resource you can loot, bank, and be capped by — but cannot sell, spend,
      or make. That is not 'wood is missing'; it is worse than missing, because
      the player's pile of it is real and inert."

   Promoting the ~15 ids this feature needs is a 4-site change EACH (RESOURCES →
   cost pricing → a CITY_PRODUCTION producer → terroir). So the Foundry does what
   Black River Extraction (`OSIM_*`, index.html ~198702) already does and holds
   its intermediates in its OWN inventory, with a small number of TAPS that pay
   out into the real ledger. Nothing here is ever written to Profile.salvage
   except through taps.js. Zero promotions, zero inert piles.

   ⚠ ID DISCIPLINE. Where chain.js already names a material, THAT id is used, so
   the day someone does promote `steel` the Foundry is already speaking the same
   language. Materials chain.js does NOT have carry `local: true` — they are
   Foundry-internal process streams (shredded waste, heavy ends, biogas) that
   have no business in a 258-entry catalogue of tradeables. Do not "tidy" these
   into chain.js: NEW_IDS is the promotion queue and these are not candidates.

   🎚 PURITY IS A PROPERTY OF A PILE, NOT A MATERIAL. Every inventory stack is
   { qty, purity }. Crushing fast gives you more scrap at a worse grade, and the
   furnace yield curve reads that grade. That trade — throughput vs. quality —
   is the entire game; see YIELD_AT_PURITY below.
   ════════════════════════════════════════════════════════════════════════════ */

/* 📚 MATERIALS. `chain` is the src/resources/chain.js id this mirrors (so the
   icon/colour/name can be looked up there and never drift); `local: true` marks
   a process stream that exists only inside the Foundry. `tap` names the LIVE
   ledger resource this material can be cashed out as — see TAPS. */
export const MATERIALS = [
  // ── Feedstock the player buys or hauls in ────────────────────────────────
  { id: 'residentialWaste', name: 'Residential Waste', icon: '🗑️', color: '#8a8578', chain: 'residentialWaste', feed: true },
  { id: 'commercialWaste',  name: 'Commercial Waste',  icon: '🗑️', color: '#8a8578', chain: 'commercialWaste',  feed: true },
  { id: 'industrialWaste',  name: 'Industrial Waste',  icon: '🗑️', color: '#9a9078', chain: 'industrialWaste',  feed: true },
  { id: 'electronicWaste',  name: 'Electronic Waste',  icon: '📟',  color: '#7fb8ff', chain: 'electronicWaste',  feed: true },
  { id: 'organicWaste',     name: 'Organic Waste',     icon: '🍂',  color: '#86e08a', chain: 'organicWaste',     feed: true },
  { id: 'hazardousWaste',   name: 'Hazardous Waste',   icon: '☢️',  color: '#d4c85a', chain: 'hazardousWaste' },
  { id: 'crudeOil',         name: 'Crude Oil',         icon: '🛢️', color: '#6a5a4a', chain: 'crudeOil',         feed: true },
  { id: 'coal',             name: 'Coal',              icon: '🪨',  color: '#4a4a52', chain: 'coal',             feed: true },
  { id: 'limestone',        name: 'Limestone',         icon: '🧱',  color: '#c8c0a8', chain: 'limestone',        feed: true },

  // ── Crush-line process streams (Foundry-local) ───────────────────────────
  { id: 'shreddedWaste',    name: 'Shredded Waste',    icon: '🌀',  color: '#8a8578', local: true },
  { id: 'ferrousStream',    name: 'Ferrous Stream',    icon: '🧲',  color: '#9fb4d8', local: true },
  { id: 'nonFerrousStream', name: 'Non-Ferrous Stream',icon: '🔶',  color: '#d8a86a', local: true },
  { id: 'plasticStream',    name: 'Plastic Stream',    icon: '🧴',  color: '#7fd6ff', local: true },
  { id: 'glassCullet',      name: 'Glass Cullet',      icon: '🔷',  color: '#9ad8ff', local: true },
  { id: 'slag',             name: 'Slag',              icon: '🌑',  color: '#5a5560', local: true },

  // ── Metals ───────────────────────────────────────────────────────────────
  { id: 'scrapMetal',    name: 'Scrap Metal',     icon: '🔩', color: '#9fb4c6', chain: null, salvage: 'scrapMetal' },
  { id: 'pigIron',       name: 'Pig Iron',        icon: '⛓️', color: '#9fb4d8', chain: 'pigIron' },
  { id: 'steel',         name: 'Steel',           icon: '🏗️', color: '#c2725a', chain: 'steel',        tap: 'metal', tapRate: 1.0 },
  { id: 'sheetMetal',    name: 'Sheet Metal',     icon: '📐', color: '#9fb4d8', chain: 'sheetMetal',   tap: 'metal', tapRate: 1.6 },
  { id: 'recycledMetal', name: 'Recycled Metal',  icon: '♻️', color: '#86e08a', chain: 'recycledMetal',tap: 'metal', tapRate: 0.7 },
  { id: 'aluminum',      name: 'Aluminum',        icon: '⛓️', color: '#c4ccd8', chain: 'aluminum',     tap: 'metal', tapRate: 1.2 },
  { id: 'copper',        name: 'Copper',          icon: '🟠', color: '#d08a5a', chain: 'copper',       tap: 'metal', tapRate: 1.4 },

  // ── Recycling side-streams (they pay, which is what makes sorting worth it)
  /* 🔴 THESE THREE TAP TO `supplies`, NOT `metal`, AND THAT IS THE WHOLE POINT
     OF SORTING. The crush line only wants the ferrous fraction; without a buyer
     for the other three quarters, plastics and cullet just pile up until the
     sorter jams on BUFFER_FULL — an 8h sim run did exactly that, leaving 98
     units of plastic stream with nowhere on earth to go. Paying them out as
     Supplies (a live ledger id) turns the reject streams into the reason the
     Magnetic Sorter is worth its power draw, instead of a tax on running it. */
  { id: 'recycledPlastic',     name: 'Recycled Plastic',     icon: '♻️', color: '#7fd6ff', chain: 'recycledPlastic',     tap: 'supplies', tapRate: 0.9 },
  { id: 'recycledGlass',       name: 'Recycled Glass',       icon: '♻️', color: '#9ad8ff', chain: 'recycledGlass',       tap: 'supplies', tapRate: 0.7 },
  { id: 'recycledElectronics', name: 'Recycled Electronics', icon: '♻️', color: '#c0a8ff', chain: 'recycledElectronics', tap: 'supplies', tapRate: 2.2 },

  // ── Refinery streams ─────────────────────────────────────────────────────
  { id: 'heavyEnds',      name: 'Heavy Ends',      icon: '🫗', color: '#5a4a3a', local: true },
  { id: 'biogas',         name: 'Biogas',          icon: '💨', color: '#86e08a', local: true },
  { id: 'petrochemicals', name: 'Petrochemicals',  icon: '⚗️', color: '#9ad17a', chain: 'petrochemicals' },

  // ── Fuels. Every one taps to the live `fuel` id, at its own rate — that
  //    rate IS the reason to build the longer chain. ────────────────────────
  { id: 'gasoline',       name: 'Gasoline',        icon: '⛽', color: '#ffcf6b', chain: 'gasoline',       tap: 'fuel', tapRate: 1.0 },
  { id: 'diesel',         name: 'Diesel',          icon: '🛻', color: '#e0a860', chain: 'diesel',         tap: 'fuel', tapRate: 1.2 },
  { id: 'aviationFuel',   name: 'Aviation Fuel',   icon: '✈️', color: '#8fd4ff', chain: 'aviationFuel',   tap: 'fuel', tapRate: 2.4 },
  /* Taps LOW on purpose. Industrial Fuel is a boiler blend, not a product — its
     value is that the Powerhouse burns it 1:1 (see burnEff in machines.js) while
     gasoline burns at 2.1. Priced as a premium tap it was strictly better to
     sell than to burn, which made the Blender pointless. */
  { id: 'industrialFuel', name: 'Industrial Fuel', icon: '🏭', color: '#d8a05a', chain: 'industrialFuel', tap: 'fuel', tapRate: 0.8 },
  { id: 'naturalGasFuel', name: 'Natural Gas Fuel',icon: '🔥', color: '#ffb86b', chain: 'naturalGasFuel', tap: 'fuel', tapRate: 1.1 },
];

export const MAT_BY_ID = MATERIALS.reduce((m, x) => { m[x.id] = x; return m; }, {});
export const matById = (id) => MAT_BY_ID[id] || null;
export const matName = (id) => (MAT_BY_ID[id] || {}).name || id;
export const matIcon = (id) => (MAT_BY_ID[id] || {}).icon || '📦';

/* 💰 TAPS — the ONLY sanctioned door from Foundry inventory into the live
   ledger. A tap pays `floor(qty * tapRate * purityFactor)` of a real resource.
   Kept as a derived list rather than a second hand-written table so a material
   and its tap can never disagree (the RES_META hand-mirror in node-city is the
   cautionary tale — RESOURCES_NEXT.md §3). */
export const TAPS = MATERIALS.filter(m => m.tap).map(m => ({ from: m.id, to: m.tap, rate: m.tapRate }));
export const tapFor = (id) => TAPS.find(t => t.from === id) || null;

/* 🎚 THE PURITY CURVE — the one number that makes sorting worth the machines.
   Below FLOOR a pile is contaminated enough that the furnace rejects most of it;
   above CLEAN there is nothing left to gain, so over-sorting is wasted uptime
   rather than an infinite ramp. Deliberately NOT linear: the steep middle is
   where a player feels a sorter upgrade land.

   ⚠ Returns a MULTIPLIER on recipe output, never on input consumed. Charging
   full input and paying partial output is what makes dirty feedstock hurt.

   🔴 IT IS APPLIED ONLY TO RECIPES MARKED `gradeSensitive` — THE METALLURGY.
   Applying it at every stage looked reasonable and was catastrophic: yield
   multiplied down the chain, so six stages at a plausible 0.5 each came out at
   0.5⁶ ≈ 1.5%. A measured sim run produced ONE sheet metal at trim 0 against 126
   at trim 0.5 — the low-tonnage setting was not "worse", it was non-functional,
   which collapses a two-ended dial into a single correct answer.
   Physically it was wrong too: shredding and sorting do not destroy mass because
   the feed is dirty, they just pass the dirt along. Contamination costs you in
   the FURNACE, as slag. So mechanical stages move grade and keep mass; only the
   smelter, the converter and the mill pay for grade. */
export const PURITY_FLOOR = 0.25;
/* Worst-case yield was 0.15. Even confined to the three metallurgical stages
   that is 0.15³ ≈ 0.003 — a player running dirty got literally nothing rather
   than something bad, and "nothing" is not a trade-off. 0.35³ ≈ 0.04 still
   hurts badly enough to be the wrong choice, without being a wall. */
export const PURITY_WORST = 0.35;
export const PURITY_CLEAN = 0.92;
export function yieldAtPurity(purity) {
  const p = Math.max(0, Math.min(1, Number(purity) || 0));
  if (p <= PURITY_FLOOR) return PURITY_WORST;
  if (p >= PURITY_CLEAN) return 1.0;
  const t = (p - PURITY_FLOOR) / (PURITY_CLEAN - PURITY_FLOOR);
  return PURITY_WORST + (1 - PURITY_WORST) * (t * t * (3 - 2 * t)); // smoothstep
}

/* 🧪 RECIPES.
     in      — { matId: units } consumed per batch. ALL must be present or the
               machine halts (see HALT.STARVED). Never partially consumed.
     out     — { matId: units } produced per batch, BEFORE the purity multiplier.
     purity  — what grade the OUTPUT lands at. `inherit` carries the weighted
               input grade through (a sorter cannot clean what it does not
               separate); a number sets it outright; `+0.12` style deltas are
               expressed as { inherit: true, bonus: 0.12 }.
     secs    — seconds per batch at machine level 1, before speed modifiers.
     note    — shown in the UI. Say what the machine is FOR, not what it does.

   🔴 JOINT PRODUCTS ARE THE POINT, NOT A COMPLICATION. `distill` emits gasoline
   AND diesel AND heavyEnds from one batch — you cannot dial crude straight into
   the fuel you happen to want. That is what stops the refinery being a single
   linear tube with a rate slider, and it is why the Cracker (which turns the
   heavyEnds nobody asked for into the aviationFuel everybody wants) is the most
   valuable upgrade in the building. */
export const RECIPES = [
  // ══ CRUSH LINE ══════════════════════════════════════════════════════════
  {
    id: 'shredResidential', machine: 'shredder', name: 'Shred · Residential',
    in: { residentialWaste: 10 }, out: { shreddedWaste: 9 }, purity: 0.42, secs: 20,
    note: 'Household bales. Cheap and filthy — lots of plastic, little iron.',
  },
  {
    id: 'shredCommercial', machine: 'shredder', name: 'Shred · Commercial',
    in: { commercialWaste: 10 }, out: { shreddedWaste: 9 }, purity: 0.55, secs: 22,
    note: 'Retail and office waste. More cardboard and cans, fewer surprises.',
  },
  {
    id: 'shredIndustrial', machine: 'shredder', name: 'Shred · Industrial',
    in: { industrialWaste: 10 }, out: { shreddedWaste: 10, hazardousWaste: 1 }, purity: 0.7, secs: 26,
    note: 'Factory offcuts — the best iron fraction, and the only stream that hands you hazardous.',
  },
  {
    id: 'sortBasic', machine: 'sorter', name: 'Magnetic Sort',
    in: { shreddedWaste: 10 },
    out: { ferrousStream: 4, nonFerrousStream: 1, plasticStream: 3, glassCullet: 1 },
    purity: { inherit: true, bonus: 0.18 }, secs: 18,
    note: 'Splits the shred four ways and lifts the grade of everything it touches.',
  },
  {
    id: 'crushFerrous', machine: 'baler', name: 'Crush · Ferrous Bale',
    in: { ferrousStream: 8 }, out: { scrapMetal: 6 }, purity: { inherit: true }, secs: 24,
    note: 'The crusher itself. Ferrous stream in, dense scrap bales out.',
  },
  {
    id: 'crushFast', machine: 'baler', name: 'Crush · Fast Cycle',
    in: { ferrousStream: 8 }, out: { scrapMetal: 9 }, purity: { inherit: true, bonus: -0.2 }, secs: 14,
    note: 'Half the dwell time, half again the tonnage — and it bales the dirt in with it.',
  },
  {
    id: 'smeltPigIron', machine: 'furnace', name: 'Smelt · Pig Iron',
    in: { scrapMetal: 10, coal: 4 }, out: { pigIron: 7, slag: 2 }, purity: { inherit: true, bonus: 0.08 }, secs: 40, gradeSensitive: true,
    note: 'Scrap and coke. The grade you baled at is the grade you pour at.',
  },
  {
    id: 'makeSteel', machine: 'converter', name: 'Convert · Steel',
    in: { pigIron: 8, limestone: 3 }, out: { steel: 6, slag: 2 }, purity: { inherit: true, bonus: 0.06 }, secs: 46, gradeSensitive: true,
    note: 'Oxygen blow with a limestone flux. Steel is the first thing here worth real Metal.',
  },
  {
    id: 'rollSheet', machine: 'mill', name: 'Roll · Sheet Metal',
    in: { steel: 6 }, out: { sheetMetal: 5 }, purity: { inherit: true }, secs: 34, gradeSensitive: true,
    note: 'The best Metal-per-unit in the building — but only clean steel rolls without tearing.',
  },
  {
    id: 'remeltNonFerrous', machine: 'furnace', name: 'Smelt · Non-Ferrous',
    in: { nonFerrousStream: 8, coal: 2 }, out: { aluminum: 3, copper: 2, slag: 1 }, purity: { inherit: true, bonus: 0.05 }, secs: 38, gradeSensitive: true,
    note: 'Aluminium and copper out of the reject stream. Low volume, high rate.',
  },
  {
    id: 'baleRecycled', machine: 'recycler', name: 'Press · Mixed Recyclate',
    in: { nonFerrousStream: 4, plasticStream: 6, glassCullet: 3 },
    out: { recycledMetal: 3, recycledPlastic: 4, recycledGlass: 2 }, purity: { inherit: true }, secs: 20,
    note: 'Everything the furnace will not take, baled for the recyclate buyers.',
  },
  {
    id: 'stripEwaste', machine: 'ewaste', name: 'Strip · E-Waste',
    in: { electronicWaste: 8 }, out: { recycledElectronics: 4, copper: 2, nonFerrousStream: 2 },
    purity: 0.78, secs: 44,
    note: 'Boards are the densest copper in the yard. Slow, fiddly, worth it.',
  },

  // ══ REFINERY LINE — three genuinely different routes to fuel ════════════
  {
    id: 'distill', machine: 'still', name: 'Distil · Atmospheric Cut',
    in: { crudeOil: 12 }, out: { gasoline: 4, diesel: 4, heavyEnds: 3 }, purity: 0.8, secs: 36,
    note: 'One crude, three cuts, all at once. You do not get to pick — that is what the Cracker is for.',
  },
  {
    id: 'distillHeavy', machine: 'still', name: 'Distil · Heavy Cut',
    in: { crudeOil: 12 }, out: { gasoline: 2, diesel: 6, heavyEnds: 4 }, purity: 0.8, secs: 38,
    note: 'Run the column cold. Diesel taps better than gasoline, and heavy ends feed the Cracker.',
  },
  {
    id: 'crackHeavy', machine: 'cracker', name: 'Crack · Heavy Ends',
    in: { heavyEnds: 8 }, out: { gasoline: 4, petrochemicals: 3 }, purity: 0.84, secs: 42,
    note: 'Turns the fraction nobody wanted back into the one everybody does.',
  },
  {
    id: 'makeAvgas', machine: 'cracker', name: 'Reform · Aviation Fuel',
    in: { petrochemicals: 6, hydrogenPlaceholder: 0 }, out: { aviationFuel: 4 }, purity: 0.9, secs: 54,
    note: 'The deepest fuel chain in the yard, and by a distance the best rate.',
  },
  {
    id: 'digestOrganic', machine: 'digester', name: 'Digest · Organic Waste',
    in: { organicWaste: 12 }, out: { biogas: 7 }, purity: 0.6, secs: 40,
    note: 'Rot, captured. The route that makes your own trash worth burning.',
  },
  {
    id: 'upgradeBiogas', machine: 'digester', name: 'Upgrade · Pipeline Gas',
    in: { biogas: 8 }, out: { naturalGasFuel: 5 }, purity: { inherit: true, bonus: 0.2 }, secs: 34,
    note: 'Scrub the CO2 out and it burns like the real thing.',
  },
  {
    id: 'blendIndustrial', machine: 'blender', name: 'Blend · Industrial Fuel',
    in: { diesel: 4, biogas: 4, petrochemicals: 2 }, out: { industrialFuel: 7 }, purity: 0.82, secs: 30,
    note: 'Three streams into the fuel your own machines burn. This is the loop closing.',
  },
];

/* ⚠ `makeAvgas` lists a zero-unit `hydrogenPlaceholder`. That is a DELIBERATE
   no-op and not a leftover: hydrogen is a chain.js id with no producer here yet,
   and writing the leg now (at qty 0, so it never gates production) keeps the
   recipe honest about what it will need when an Electrolyzer lands, rather than
   silently pretending aviation fuel is a two-input process. normIn() strips any
   leg at qty <= 0 before it reaches the machine, so nothing downstream sees it. */

export const RECIPE_BY_ID = RECIPES.reduce((m, r) => { m[r.id] = r; return m; }, {});
export const recipeById = (id) => RECIPE_BY_ID[id] || null;
export const recipesFor = (machineId) => RECIPES.filter(r => r.machine === machineId);

/* Strip zero/negative legs — see the hydrogenPlaceholder note above. */
export function normIn(recipe) {
  const out = {};
  const src = (recipe && recipe.in) || {};
  for (const k in src) if ((src[k] | 0) > 0) out[k] = src[k] | 0;
  return out;
}
export function normOut(recipe) {
  const out = {};
  const src = (recipe && recipe.out) || {};
  for (const k in src) if ((src[k] | 0) > 0) out[k] = src[k] | 0;
  return out;
}

/* Resolve a recipe's declared purity against the grade of what went in. */
export function resolvePurity(recipe, inputPurity) {
  const p = recipe && recipe.purity;
  if (typeof p === 'number') return Math.max(0, Math.min(1, p));
  if (p && p.inherit) {
    const base = Math.max(0, Math.min(1, Number(inputPurity) || 0));
    return Math.max(0, Math.min(1, base + (Number(p.bonus) || 0)));
  }
  return Math.max(0, Math.min(1, Number(inputPurity) || 0));
}

export default { MATERIALS, MAT_BY_ID, matById, matName, matIcon, TAPS, tapFor, RECIPES, RECIPE_BY_ID, recipeById, recipesFor, normIn, normOut, resolvePurity, yieldAtPurity };
