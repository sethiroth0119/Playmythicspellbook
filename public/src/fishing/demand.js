/* ============================================================================
   🐟 FISHING DEMAND — where the catch is NEEDED, as pure maths.
   ============================================================================
   Woods Fishing (the live 3D trip + the fleet), the Fishing Company op and the
   city's Fishing Wharf / Kelp Beds / Deepwater Pier all PRODUCE the four fish
   ledger resources (freshFish, shellfish, seafood, seaweed). This file is the
   other half: everything that CONSUMES them, expressed so the Cold Storage
   panel can print "your city burns 30 fresh fish a cycle; the stash covers 4"
   from one expression that the spend path also uses.

     • RECIPES    — Cold Storage processing (fish → food / medicine). The
                    fallback sink for a player with no Cannery: worse yield
                    than the building, instant, no inputs but the fish.
     • CONTRACTS  — NPC buy orders. Deterministic per (window, seed) so the
                    board is the same for the whole window and cannot be
                    re-rolled by reloading; paid at a premium over the live
                    exchange price, which is what makes fishing a business
                    rather than a loot drop.
     • DEMAND     — the per-cycle / per-hour fish burn of the player's placed
                    city buildings and staffed operations, and the matching
                    production, so the panel can show a real balance.

   🔴 NO ECONOMY NUMBER LIVES AT A RENDER SITE. Same rule as _opEcon() and
      terroir.js and lots.js: premiums, recipe ratios, contract sizes and the
      window length live HERE, once.

   PURE. Reads no globals, imports nothing. `demandFor()` takes the placed
   rows and op list as arguments; index.html hands them over through the
   bridge (the globals trap — Profile/App/Forge are top-level `const` and
   invisible to a module).
   ============================================================================ */

export const FISH_IDS = ['freshFish', 'shellfish', 'seafood', 'seaweed'];

/* ── Cold Storage recipes ────────────────────────────────────────────────────
   `inputs` and `outputs` are per batch. Ratios sit BELOW the buildings on
   purpose (Cannery: 30 fish → 70 food; here 5 → 7) so the Cannery is worth
   building, while a player with only a boat is never stuck holding fish they
   cannot eat. `demand` is what one batch does to the exchange: the inputs are
   consumed (price up), the outputs are produced (price down). */
export const RECIPES = [
  { id: 'salt',   name: 'Gut & Salt',    icon: '🥫', blurb: 'Fresh fish into camp food. The Cannery does this better; the bench does it now.',
    inputs: { freshFish: 5 },              outputs: { food: 7 } },
  { id: 'shuck',  name: 'Shuck & Boil',  icon: '🍲', blurb: 'Shellfish into food and a little packing material.',
    inputs: { shellfish: 4 },              outputs: { food: 5, supplies: 1 } },
  { id: 'render', name: 'Render Oil',    icon: '💊', blurb: 'Prime seafood and kelp into fish-oil salve. The Fish Oil Works scales this.',
    inputs: { seafood: 3, seaweed: 6 },    outputs: { medicine: 4 } },
  { id: 'dry',    name: 'Dry Kelp',      icon: '🌿', blurb: 'Seaweed dried on the rail. Thin rations, but rations.',
    inputs: { seaweed: 6 },                outputs: { food: 3 } },
];
export function recipeById(id) { return RECIPES.find((r) => r.id === id) || null; }

/** How many whole batches of `recipe` a stash can fund. */
export function batchesAffordable(recipe, getRes) {
  if (!recipe) return 0;
  let n = Infinity;
  for (const k in recipe.inputs) {
    const per = recipe.inputs[k] | 0; if (per <= 0) continue;
    const have = Math.max(0, (getRes(k) | 0));
    n = Math.min(n, Math.floor(have / per));
  }
  return isFinite(n) ? n : 0;
}

/* ── Contracts ───────────────────────────────────────────────────────────────
   A contract is { id, buyer, res, units, premium, xp, blurb }. The board holds
   CONTRACT_COUNT of them per window; `windowKey` changes every WINDOW_MS, and
   fulfilment is recorded against (windowKey, id) so each can be filled once.

   Buyers are the world's own institutions — the same corp names the news
   ticker uses — so the orders read as the economy asking, not a vending
   machine. Each buyer has a resource it wants and a premium band. */
export const CONTRACT_WINDOW_MS = 8 * 3600000;   // a board lasts 8h
export const CONTRACT_COUNT = 4;                  // orders per board
export const CONTRACT_BUYERS = [
  { id: 'murrey',   name: 'Murrey Dock Cannery',     wants: 'freshFish', units: [30, 90],  premium: [1.25, 1.45], xp: 20, blurb: 'Tins by the pallet. Pays on delivery, no questions about the smell.' },
  { id: 'ethos',    name: 'Bank of Ethos galley',    wants: 'shellfish', units: [12, 30],  premium: [1.35, 1.6],  xp: 25, blurb: 'The tellers eat well. Shellfish for the boardroom lunch.' },
  { id: 'ironheart',name: 'Ironheart Mining mess',   wants: 'freshFish', units: [40, 120], premium: [1.2, 1.4],   xp: 20, blurb: 'Two hundred miners, three meals. Volume over finesse.' },
  { id: 'apoth',    name: 'Apothecary Guild',        wants: 'seafood',   units: [6, 18],   premium: [1.5, 1.9],   xp: 40, blurb: 'Fish-oil salve for the infirmaries. Prime cut only.' },
  { id: 'research', name: 'Research Facility',       wants: 'seafood',   units: [4, 12],   premium: [1.6, 2.0],   xp: 45, blurb: 'Deepwater tissue samples. They do not say what for.' },
  { id: 'petra',    name: 'Petra Oil rig kitchen',   wants: 'shellfish', units: [10, 26],  premium: [1.3, 1.5],   xp: 25, blurb: 'Rig crews on a 3-week rotation. Anything that is not tinned.' },
  { id: 'salvage',  name: 'Salvage Union',           wants: 'seaweed',   units: [20, 60],  premium: [1.4, 1.8],   xp: 15, blurb: 'Kelp for rope-making and the compost pits.' },
  { id: 'northbld', name: 'North Build Co. canteen', wants: 'freshFish', units: [25, 70],  premium: [1.25, 1.4],  xp: 20, blurb: 'Site canteens across the sector. Weekly standing order.' },
  { id: 'oilworks', name: 'Fish Oil Works co-op',    wants: 'seaweed',   units: [30, 80],  premium: [1.3, 1.6],   xp: 15, blurb: 'The renderers burn through kelp faster than the beds grow it.' },
];

/* Deterministic PRNG — the same one terroir.js uses, so a board cannot be
   re-rolled by reloading the page. */
function hash32(str) {
  let h = 0x811c9dc5; const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h >>> 0;
}
function xorshift(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return function () { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

export function windowKey(now) { return Math.floor((now || Date.now()) / CONTRACT_WINDOW_MS); }
export function windowEndsAt(now) { return (windowKey(now) + 1) * CONTRACT_WINDOW_MS; }

/** The board for one window. `seed` is the player id (or '' offline) so two
    players see different boards; `priceOf(res)` is the live exchange price
    and is only used to print the payout — the payout is RE-PRICED at
    fulfilment time from the live price, so a stale render cannot overpay. */
export function contractsFor(seed, now, priceOf) {
  const wk = windowKey(now);
  const rnd = xorshift(hash32('fishing:contracts:v1:' + wk + ':' + (seed || '')));
  const pool = CONTRACT_BUYERS.slice();
  const out = [];
  for (let i = 0; i < CONTRACT_COUNT && pool.length; i++) {
    const b = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const units = Math.round(b.units[0] + (b.units[1] - b.units[0]) * rnd());
    const premium = +(b.premium[0] + (b.premium[1] - b.premium[0]) * rnd()).toFixed(2);
    out.push({
      id: wk + ':' + b.id, key: wk, buyerId: b.id, buyer: b.name, res: b.wants, units, premium, xp: b.xp, blurb: b.blurb,
      payout: payoutFor(units, premium, priceOf ? priceOf(b.wants) : 0),
    });
  }
  return out;
}
/** Cinder for delivering `units` at `premium` over unit price `price`. Floors
    at 1 Cinder/unit so a crashed market never makes a contract worthless. */
export function payoutFor(units, premium, price) {
  const p = Math.max(1, Number(price) || 0);
  return Math.max(units | 0, Math.round((units | 0) * p * (Number(premium) || 1)));
}

/* ── Demand / supply balance ─────────────────────────────────────────────────
   placed: [{ defId, level, def: { yields, inputs } }]  (city buildings, per cycle)
   ops:    [{ type, workers, yields, inputs }]           (operations, per worker-hour)
   Returns, per fish id: { burnCycle, burnHour, makeCycle, makeHour, buildings[], ops[] }.
   A caller with no city module passes [] and gets zeros — never undefined. */
export function demandFor(placed, ops) {
  const out = {};
  FISH_IDS.forEach((id) => { out[id] = { burnCycle: 0, burnHour: 0, makeCycle: 0, makeHour: 0, buildings: [], ops: [] }; });
  (Array.isArray(placed) ? placed : []).forEach((p) => {
    const def = p && p.def; if (!def) return; const lvl = Math.max(1, p.level | 0);
    FISH_IDS.forEach((id) => {
      const inN = ((def.inputs || {})[id] | 0) * lvl, outN = ((def.yields || {})[id] | 0) * lvl;
      if (inN > 0) { out[id].burnCycle += inN; out[id].buildings.push({ name: def.name || p.defId, n: -inN }); }
      if (outN > 0) { out[id].makeCycle += outN; out[id].buildings.push({ name: def.name || p.defId, n: outN }); }
    });
  });
  (Array.isArray(ops) ? ops : []).forEach((o) => {
    if (!o) return; const w = Math.max(0, o.workers | 0);
    FISH_IDS.forEach((id) => {
      const inN = (Number((o.inputs || {})[id]) || 0) * w, outN = (Number((o.yields || {})[id]) || 0) * w;
      if (inN > 0) { out[id].burnHour += inN; out[id].ops.push({ name: o.label || o.type, n: -inN }); }
      if (outN > 0) { out[id].makeHour += outN; out[id].ops.push({ name: o.label || o.type, n: outN }); }
    });
  });
  FISH_IDS.forEach((id) => { const d = out[id]; d.burnHour = +d.burnHour.toFixed(2); d.makeHour = +d.makeHour.toFixed(2); });
  return out;
}

/** "Stash covers N cycles" — Infinity when nothing burns it. */
export function coverageCycles(have, burnCycle) {
  const b = Number(burnCycle) || 0; if (b <= 0) return Infinity;
  return Math.floor(Math.max(0, have | 0) / b);
}
