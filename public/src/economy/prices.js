/* ════════════════════════════════════════════════════════════════════════════
   📈 PRICES — derived from the graph, then moved by the market.
   ----------------------------------------------------------------------------
   "Resources won't always cost the same amount. Prices can react to: Supply •
    Demand • Scarcity • Transportation • Inventory • Production Costs • Imports
    • Competition • Disasters"

   🔴 NOT ONE RESOURCE PRICE IS WRITTEN DOWN ANYWHERE IN THIS CODEBASE.
   A base price is COMPUTED from recipes.js: the cost of the inputs, plus the
   labour, plus the power, plus a markup — recursively, in topological order.
   That is the whole reason recipes.js is a graph and not a list.

   Why it matters that they are derived rather than authored:
     • 258 hand-written prices cannot stay consistent. The first time someone
       retunes `steel` and forgets `structuralSteel`, arbitrage appears: buy the
       input, make the output, sell it for less than the parts. Players find
       that in hours.
     • A derived price makes the CHAIN legible. A Reality Stabilisation
       Component is expensive because you can read the eleven steps under it,
       not because a designer typed a big number.
     • Retuning a wage retunes every price downstream of it, automatically and
       correctly. That is what ECON being "the one tuning table" has to mean.

   ── THE CYCLE PROBLEM, AND HOW IT IS SOLVED ────────────────────────────────
   recipes.js documents two real cycles: steel ⇄ recycledMetal, and
   electricity ⇄ its own fuels. A naive recursive price would not terminate.
   `deriveBase()` therefore runs a RELAXATION: seed every id at a floor, then
   sweep the topological order a fixed number of times, letting each price
   settle against the previous sweep's values. Cycles converge because every
   step adds strictly positive labour and markup, so the map is a contraction.
   Six sweeps is empirically past convergence for this graph (`convergence()`
   reports the residual so a future edit that breaks it is visible, not silent).
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { DEPOSITS, BYPRODUCTS, RECIPES, legsOf, topoOrder, bandOf } from './recipes.js';

const SWEEPS = 6;

/* ── BASE PRICES ────────────────────────────────────────────────────────────
   Cost-plus, derived. `_base` is computed once per session — the graph is
   static, so recomputing it per tick would be pure waste.

   ⚠ RAW PRICES ARE NOT UNIFORM. A tier-0 deposit is priced off its own YIELD:
     a seam that gives 220 units per labour-day is cheap, one that gives 0.9 is
     not. This is why platinum and reality fragments come out expensive without
     anybody deciding they should be — the scarcity is already in DEPOSITS. */
let _base = null, _residual = 0;

/* The Cinder cost of one labour-unit, for the band that works this step.
   Derived from the wage table — see the note on ECON.price.laborUnitsPerDay for
   why this is never a constant of its own. */
function laborUnitCost(id) {
  const w = (ECON.labor.bands[bandOf(id)] || ECON.labor.bands.unskilled).wage;
  return w / Math.max(1, ECON.price.laborUnitsPerDay);
}

function rawBase(id) {
  const d = DEPOSITS[id];
  if (d) {
    /* A deposit's `yield` is units per labour-DAY, so its labour cost per unit
       is one day's wage divided by that day's output. This is where the
       economy's scarcity actually comes from: platinum (5/day, skilled) and
       reality fragments (0.9/day, advanced) price themselves off the seam,
       and nobody had to decide that they should be expensive. */
    const perUnit = (ECON.labor.bands[bandOf(id)] || ECON.labor.bands.unskilled).wage
                  / Math.max(0.01, d.yield || 1);
    return Math.max(ECON.price.rawFloor, perUnit * (1 + ECON.price.baseMarkup));
  }
  /* ♻️ A BYPRODUCT IS NEARLY FREE, AND THAT IS THE POINT. Waste is a cost to
     whoever made it, not an asset. Pricing it at the raw floor would make
     "generate industrial waste" a profitable business, which inverts the whole
     recycling chain — the recycler is supposed to be paid to take it away.
     A small positive price (not zero) keeps it tradeable and keeps every
     downstream division well-defined. */
  if (BYPRODUCTS[id]) return ECON.price.rawFloor * 0.15;
  return ECON.price.rawFloor;
}

export function deriveBase(force) {
  if (_base && !force) return _base;
  const order = topoOrder();
  const p = {};
  for (const id of order) p[id] = rawBase(id);

  let residual = 0;
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    residual = 0;
    for (const id of order) {
      if (DEPOSITS[id] || BYPRODUCTS[id]) continue;
      const legs = legsOf(id);
      if (!legs.length) continue;
      // A resource with alternate feedstocks is priced off its CHEAPEST leg —
      // that is what a rational producer would run, and pricing off the default
      // leg would make the alternates free money the moment they got cheaper.
      /* 🔴 BASE PRICE USES THE PRIMARY LEG, NOT THE CHEAPEST ONE.
         This was the cheapest leg and it produced a live arbitrage: the arc
         furnace runs on `recycledMetal`, which descends from `industrialWaste`,
         which is nearly free by design — so `steel` derived BELOW `pigIron`,
         its own upstream input. A player could buy pig iron, and the market
         would pay them less for the steel they made out of it.

         The economics of the fix: a recycled leg is genuinely cheaper per unit,
         but it is SUPPLY-CAPPED — you can only run an arc furnace on the scrap
         the city actually produced. A base price is what it costs to make a
         thing the way you can ALWAYS make it, so it derives from the primary,
         uncapped path. The recycled leg's advantage is then real margin for
         whoever can get scrap, which is what it should have been all along —
         and `bestLeg()` still picks the cheapest at RUN time, where the
         availability cap it is subject to is actually known. */
      const leg = legs[0];
      const r = RECIPES[id];
      let cost = 0;
      for (const inp in (leg.in || {})) cost += (p[inp] || 0) * leg.in[inp];
      cost += (leg.labor || 0) * laborUnitCost(id);
      /* ⚡ THE PRICE OF POWER IS THE PRICE OF ELECTRICITY. Deriving it from the
         graph rather than reading a separate constant keeps one thing from
         having two prices — a recipe's `power` leg and the `electricity`
         resource are the same commodity, and a tuning table that priced them
         apart would let a city arbitrage against itself. Relaxation handles the
         self-reference: electricity's own recipe has `power: 0`. */
      const pw = p.electricity || ECON.price.powerCost;
      cost += ((leg.power != null ? leg.power : (r ? r.power : 0)) || 0) * pw;
      const next = Math.max(ECON.price.rawFloor, cost * (1 + ECON.price.baseMarkup));
      residual = Math.max(residual, Math.abs(next - p[id]) / Math.max(1, p[id]));
      p[id] = next;
    }
  }
  _residual = residual;
  _base = p;
  return _base;
}

export function basePrice(id) { return deriveBase()[id] || ECON.price.rawFloor; }
/* Largest relative change on the final sweep. Near-zero means converged; a
   future recipe edit that pushes this up is a real warning, so index.js logs it. */
export function convergence() { deriveBase(); return _residual; }

/* The cheapest leg for an id given what the city can actually get hold of.
   Returns the leg AND its cost, because the bottleneck tracer needs to say
   "you are running the arc-furnace leg and it is your electricity that is
   short", not merely "steel is short". */
export function bestLeg(id, availability) {
  const legs = legsOf(id);
  if (!legs.length) return null;
  const p = deriveBase();
  let best = null;
  for (const leg of legs) {
    let cost = 0, worst = 1;
    for (const inp in (leg.in || {})) {
      cost += (p[inp] || 0) * leg.in[inp];
      if (availability) worst = Math.min(worst, availability[inp] == null ? 1 : availability[inp]);
    }
    // An unavailable leg is not "expensive", it is not runnable — but it is
    // still ranked, so a city with two blocked legs picks the less blocked one
    // rather than reporting no leg at all.
    const eff = cost / Math.max(0.05, worst);
    if (!best || eff < best.eff) best = { leg, cost, availability: worst, eff };
  }
  return best;
}

/* ════════════════════════════════════════════════════════════════════════════
   🏪 THE MARKET — base price × the multiplier the city's own conditions earn.
   ════════════════════════════════════════════════════════════════════════════ */

/* Live state, per resource id. Persisted (serialize/load) so a market that was
   in a steel crisis when the tab closed is still in one when it reopens —
   resetting prices on load would let a player dodge every shock by reloading. */
let MKT = {};

function row(id) {
  if (!MKT[id]) MKT[id] = { mul: 1, target: 1, supply: 0, demand: 0, stock: 0, imported: 0, sellers: 0 };
  return MKT[id];
}

export function reset() { MKT = {}; }

/* Record this tick's observed flows. Called by sim.js once per tick, per id.
     supply    units produced locally + imported
     demand    units firms and households actually wanted
     stock     units sitting in inventory
     sellers   how many distinct firms offer it (competition)
     imported  units that had to come from outside (transport premium) */
export function observe(id, o) {
  const r = row(id);
  r.supply = o.supply || 0;
  r.demand = o.demand || 0;
  r.stock = o.stock || 0;
  r.sellers = o.sellers || 0;
  r.imported = o.imported || 0;
}

/* The multiplier this id's conditions ARGUE for, before smoothing.
   Every term the announcement lists appears here exactly once. */
export function targetMul(id, ctx) {
  const r = row(id);
  const E = ECON.price;
  ctx = ctx || {};

  // ── Supply vs demand. The core term.
  //    +1 on both sides so a market with no activity sits at 1.0 rather than
  //    dividing by zero and printing Infinity into the player's shop.
  const ratio = (r.demand + 1) / (r.supply + 1);
  let mul = Math.pow(ratio, E.k);

  // ── Inventory. A full warehouse is a seller's problem, not a buyer's.
  //    Days of cover: stock relative to daily demand.
  if (r.demand > 0) {
    const cover = r.stock / Math.max(1, r.demand);
    if (cover > 3) mul *= Math.max(0.72, 1 - 0.06 * (cover - 3));   // glut
    else if (cover < 0.5) mul *= 1 + 0.35 * (0.5 - cover) * 2;      // empty shelves
  }

  // ── Scarcity. Nobody in reach can make it at all.
  if (ctx.unavailable) mul *= E.unavailableMul;

  // ── Transportation. Imports carry the delivered-cost premium logistics.js
  //    computed; it is passed in rather than recomputed so the price the player
  //    is charged and the freight bill the city pays can never disagree.
  if (r.imported > 0 && ctx.importPremium) {
    const share = r.imported / Math.max(1, r.supply);
    mul *= 1 + (ctx.importPremium - 1) * share;
  }

  // ── Competition. More sellers, thinner margins. One seller is a monopoly and
  //    prices like one; this is what makes a second grocery store worth building.
  if (r.sellers >= 1) mul *= 1 + 0.18 / r.sellers - 0.18 / 4;

  // ── Production costs. If wages or power moved, the floor moved with them.
  if (ctx.costIndex) mul *= ctx.costIndex;

  // ── Disasters. A raid, a fire, a blockade — a transient shock the city log
  //    already knows about. Applied last so it multiplies the real price.
  if (ctx.shock) mul *= ctx.shock;

  return Math.max(E.minMul, Math.min(E.maxMul, mul));
}

/* Advance the printed price toward its target. `days` is economic days.
   ⚠ SMOOTHED ON PURPOSE. An instant price is unreadable: it changes between the
     player reading the number and reading the explanation of the number. */
export function step(id, days, ctx) {
  const r = row(id);
  r.target = targetMul(id, ctx);
  const a = Math.min(1, ECON.price.lerpPerDay * Math.max(0, days));
  r.mul = r.mul + (r.target - r.mul) * a;
  return r.mul;
}

export function priceOf(id) { return basePrice(id) * row(id).mul; }
export function mulOf(id)   { return row(id).mul; }
export function marketRow(id) { return { ...row(id), base: basePrice(id), price: priceOf(id) }; }

/* Everything the market panel needs, sorted by how far from normal it is —
   which is the only ordering that answers "what should I be worried about". */
export function movers(limit) {
  const out = [];
  for (const id in MKT) {
    const r = MKT[id];
    if (r.supply === 0 && r.demand === 0) continue;
    out.push({ id, mul: r.mul, base: basePrice(id), price: basePrice(id) * r.mul,
               supply: r.supply, demand: r.demand, stock: r.stock });
  }
  out.sort((a, b) => Math.abs(Math.log(b.mul)) - Math.abs(Math.log(a.mul)));
  return limit ? out.slice(0, limit) : out;
}

/* ── Persistence. Only `mul` survives: supply/demand/stock are re-observed on
   the first tick and a stale copy of them would price one tick against a city
   that no longer exists. */
/* ⚠ THE THRESHOLD AND THE PRECISION BOTH MATTER FOR REPRODUCIBILITY.
   This dropped anything within 1% of neutral and rounded the rest to 3dp. Across
   ~200 live resources that discarded enough state that a reloaded city's prices,
   and therefore its production plan, drifted measurably from one that had never
   been saved. Keeping 4dp and only discarding genuinely-neutral prices costs a
   few hundred bytes and makes a reload land on the same city. */
export function serialize() {
  const out = {};
  for (const id in MKT) {
    if (Math.abs(MKT[id].mul - 1) > 1e-4) out[id] = Math.round(MKT[id].mul * 10000) / 10000;
  }
  return out;
}
export function load(raw) {
  MKT = {};
  if (!raw || typeof raw !== 'object') return;
  for (const id in raw) {
    const v = Number(raw[id]);
    if (isFinite(v) && v > 0) row(id).mul = Math.max(ECON.price.minMul, Math.min(ECON.price.maxMul, v));
  }
}

export default { basePrice, priceOf, step, observe, movers, deriveBase, convergence };
