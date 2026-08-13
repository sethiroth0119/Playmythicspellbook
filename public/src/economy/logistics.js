/* ════════════════════════════════════════════════════════════════════════════
   🚚 LOGISTICS — "Buying something doesn't mean it magically appears."
   ----------------------------------------------------------------------------
   Producer → Warehouse → Export Terminal → Freight Network → Import Terminal
            → Warehouse → Buyer

   Every unit that moves consumes FREIGHT CAPACITY and costs Cinder to move.
   A city with the money but not the trucks does not get its goods — which is
   what makes a warehouse a real decision rather than a storage stat.

   ── WHY CONGESTION AND NOT A HARD CAP ──────────────────────────────────────
   Over-capacity QUEUES rather than fails. A hard cliff at 101% would mean one
   unit of overshoot deletes a delivery, which reads as a bug every time it
   happens and gives the player no gradient to steer by. Congestion instead
   raises the delivered cost smoothly and cuts the throughput fraction, so the
   panel can say "freight 78%" and the player can feel the difference between
   slightly short and hopelessly short.
   ════════════════════════════════════════════════════════════════════════════ */

import { ECON } from './tuning.js';
import { priceOf } from './prices.js';

const S = {
  capacity: 0,        // units per economic day the city can move
  booked: 0,          // units booked this day
  lastRatio: 1,       // throughput fraction actually delivered
  lastCostPerUnit: 0,
  buildings: {},      // kind → count, for the panel
};

export function state() { return S; }
export function reset() { S.capacity = 0; S.booked = 0; S.lastRatio = 1; S.lastCostPerUnit = 0; S.buildings = {}; }

/* Recompute capacity from the city's logistics buildings.
   `counts` is {warehouse: 3, terminal: 1, ...} — supplied by the host, because
   this module must not know what a node-city tile looks like. */
export function setCapacity(counts) {
  S.buildings = counts || {};
  let cap = 0;
  for (const k in S.buildings) {
    const per = ECON.logistics.capacity[k];
    if (per) cap += per * Math.max(0, S.buildings[k] | 0);
  }
  /* 🛟 A FLOOR, SO A NEW CITY CAN TRADE AT ALL. With zero logistics buildings a
     city would have zero capacity and could not import the very materials it
     needs to build a warehouse — a deadlock the player cannot see or escape.
     One depot's worth of hand-carried freight is always available. */
  S.capacity = Math.max(ECON.logistics.capacity.depot, cap);
  return S.capacity;
}

export function beginDay() { S.booked = 0; }

/* Book `units` of freight over `hops`. Returns the fraction actually carried.
   Congestion is computed on the WHOLE day's booking, so the order in which
   firms book does not change what they get — a first-come-first-served freight
   network would make the answer depend on object iteration order, which is not
   a thing a player can reason about or a bug anyone could reproduce. */
export function book(units, hops) {
  const u = Math.max(0, units || 0);
  S.booked += u * Math.max(1, hops || 1);
  return u;
}

/* Resolve the day: how much of what was booked actually moved, and at what
   unit cost. Called once per economic day by sim.js after all booking. */
export function resolve() {
  const load = S.booked / Math.max(1, S.capacity);
  if (load <= 1) {
    S.lastRatio = 1;
    S.congestionMul = 1;
  } else {
    // Throughput degrades as 1/load; cost rises with congestionK.
    S.lastRatio = 1 / load;
    S.congestionMul = Math.min(ECON.logistics.maxCongestionMul,
                               1 + ECON.logistics.congestionK * (load - 1));
  }
  return S.lastRatio;
}

export function throughput() { return S.lastRatio; }
export function load() { return S.booked / Math.max(1, S.capacity); }

/* Cinder cost of moving one unit over `hops`, at current fuel prices and
   congestion. ⚠ Fuel is billed at the LIVE diesel price, which is why a fuel
   shock raises the delivered price of everything in the city. That coupling is
   deliberate: it is the mechanism behind "Transportation" appearing in the
   announcement's list of things that move prices. */
export function costPerUnit(hops) {
  const h = Math.max(1, hops || 1);
  const fuel = ECON.logistics.fuelPerUnitHop * h * priceOf('diesel');
  const base = ECON.logistics.costPerUnitHop * h;
  const c = (base + fuel) * (S.congestionMul || 1);
  S.lastCostPerUnit = c;
  return c;
}

/* The delivered-price multiplier for imported goods — what prices.js applies
   as `importPremium`. Expressed as a multiple of the goods' own value so a
   cheap bulk good is hit harder by freight than a dense valuable one, which is
   why nobody ships gravel across the map. */
export function importPremium(resId) {
  const v = Math.max(0.01, priceOf(resId));
  return 1 + costPerUnit(ECON.logistics.tradeHops) / v;
}

export function localPremium(resId) {
  const v = Math.max(0.01, priceOf(resId));
  return 1 + costPerUnit(ECON.logistics.localHops) / v;
}

/* What the panel prints. */
export function report() {
  return {
    capacity: S.capacity, booked: S.booked, load: load(),
    throughput: S.lastRatio, congestion: S.congestionMul || 1,
    buildings: { ...S.buildings },
    costLocal: costPerUnit(ECON.logistics.localHops),
    costTrade: costPerUnit(ECON.logistics.tradeHops),
  };
}

export default { setCapacity, book, resolve, throughput, costPerUnit, importPremium, report };
