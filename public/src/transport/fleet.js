/* ══════════════════════════════════════════════════════════════════════════
   🚚 TRANSPORT COMPANY — fleets, contracts and the no-teleport rule

   PURE. No DOM, no Profile, no globals. Capacity matching, specialisation,
   fuel, drivers and the in-transit ledger are decided here so they can be
   driven directly by tools/transport-tests/run.mjs.

   ── THE RULE EVERYTHING ELSE SERVES (the brief's §20) ─────────────────────
   Cargo must never be subtracted from one place and added to another in the
   same instant. `dispatch()` takes the goods OUT of the origin and puts them
   in a MANIFEST held by the truck; `arrive()` is the only thing that can put
   them anywhere else. Between those two calls the cargo exists in exactly one
   place — on the road — and `totalCargo()` proves it, because a conservation
   check is the only way to know a logistics system is not quietly duplicating
   or eating freight.

   ⚠ CAPACITY IS PER CARGO CLASS, NOT ONE NUMBER. A company with 200,000 units
     of tanker capacity cannot move a single ingot of steel. Collapsing the
     fleet to a single "total capacity" figure is the obvious simplification
     and it deletes the entire reason to own more than one kind of truck —
     which is §8 of the brief.

   ⚠ A TRUCK ON THE ROAD IS NOT AVAILABLE. Every quote runs against trucks that
     are idle AND have a driver, never against the fleet on paper. "12 trucks,
     5 available" is the number that decides whether a contract can be taken.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Cargo classes. What a load IS decides what may carry it. ───────────── */
export const CARGO = {
  general:   { id: 'general',   name: 'General Freight' },
  bulk:      { id: 'bulk',      name: 'Bulk / Industrial' },
  liquid:    { id: 'liquid',    name: 'Liquid / Fuel' },
  perishable:{ id: 'perishable',name: 'Perishable / Medical' },
  valuable:  { id: 'valuable',  name: 'High Value' },
  anomalous: { id: 'anomalous', name: 'Anomalous / Restricted' },
};
export const CARGO_IDS = Object.keys(CARGO);

/* ── The fleet Prince Portfolio sells. `carries` is the whole point: a truck
      that can take anything would make every other truck pointless. ─────── */
export const TRUCK_TYPES = {
  lightCargo: { id: 'lightCargo', name: 'Light Cargo Truck', ico: '🚐',
    cap: 5000,  mph: 52, fuelPerMile: 0.28, price: 45000,  upkeep: { mechanicalParts: 1 },
    carries: ['general'] },
  boxTruck:   { id: 'boxTruck',   name: 'Box Truck', ico: '🚚',
    cap: 9000,  mph: 48, fuelPerMile: 0.40, price: 78000,  upkeep: { mechanicalParts: 2 },
    carries: ['general', 'valuable'] },
  freight:    { id: 'freight',    name: 'Heavy Freight Truck', ico: '🚛',
    cap: 15000, mph: 44, fuelPerMile: 0.62, price: 150000, upkeep: { mechanicalParts: 2, steel: 2 },
    carries: ['general', 'bulk'] },
  heavyHauler:{ id: 'heavyHauler',name: 'Heavy Hauler', ico: '🛻',
    cap: 30000, mph: 38, fuelPerMile: 1.05, price: 320000, upkeep: { mechanicalParts: 3, steel: 4 },
    carries: ['bulk', 'general'] },
  tanker:     { id: 'tanker',     name: 'Tanker Truck', ico: '🛢️',
    cap: 20000, mph: 42, fuelPerMile: 0.78, price: 240000, upkeep: { mechanicalParts: 3, rubber: 2 },
    carries: ['liquid'] },
  reefer:     { id: 'reefer',     name: 'Refrigerated Truck', ico: '❄️',
    cap: 12000, mph: 45, fuelPerMile: 0.70, price: 210000, upkeep: { mechanicalParts: 2, electronicComponents: 1 },
    carries: ['perishable', 'general'] },
  armored:    { id: 'armored',    name: 'Armored Truck', ico: '🛡️',
    cap: 6000,  mph: 46, fuelPerMile: 0.58, price: 265000, upkeep: { steel: 3, electronicComponents: 2 },
    carries: ['valuable', 'general'] },
  containment:{ id: 'containment',name: 'Anomalous Containment Transport', ico: '☢️',
    cap: 4000,  mph: 34, fuelPerMile: 0.95, price: 480000, upkeep: { steel: 4, electronicComponents: 3 },
    carries: ['anomalous'] },
};
export const TRUCK_IDS = Object.keys(TRUCK_TYPES);

export const FLEET = {
  /* Maintenance falls with distance, not with time — a truck parked in a yard
     does not wear out. At 0 a truck is UNAVAILABLE, never destroyed: the brief
     is explicit that vehicles must not disappear, and a fleet that can
     evaporate is a fleet nobody dares to buy. */
  wearPerMile: 0.045,
  minConditionToRun: 0.15,
  /* Condition drags on what a worn truck can actually do. Capacity is NOT
     reduced below half — a half-empty trailer is a maintenance problem, an
     unusable one is a deleted asset. */
  condCapFloor: 0.5,
  ratingStart: 4.0, ratingMin: 1, ratingMax: 5,
  onTimeGain: 0.04, lateLoss: 0.12, failLoss: 0.35,
};

/* Finite, non-negative, or zero.
   ⚠ THE `Number(x) || 0` IDIOM IS NOT ENOUGH, and the test caught it a second
     time this session: Infinity is TRUTHY, so it sails straight through and
     comes back out of fuelForPlan() as an infinite fuel bill. Miles and unit
     counts arrive from contracts, save files and admin fields — "the caller
     will pass a sane number" is not something this file may assume. */
function num(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; }

export function truckDef(typeId) { return TRUCK_TYPES[typeId] || null; }
export function canCarry(typeId, cargoClass) {
  const t = TRUCK_TYPES[typeId];
  return !!(t && t.carries.indexOf(cargoClass) >= 0);
}

/* A truck record: { id, type, condition (0..1), busyUntil, assigned } */
export function newTruck(id, typeId) {
  return { id, type: typeId, condition: 1, busyUntil: 0 };
}

/** Effective capacity of one truck, after wear. */
export function truckCapacity(truck) {
  const d = truckDef(truck && truck.type); if (!d) return 0;
  const c = Math.max(0, Math.min(1, Number(truck.condition)));
  if (c < FLEET.minConditionToRun) return 0;
  return Math.floor(d.cap * Math.max(FLEET.condCapFloor, c));
}

/** Trucks that are idle, crewed and healthy enough to roll. */
export function availableTrucks(company, cargoClass, now) {
  const t = now || 0;
  const idle = (company.trucks || []).filter(tr =>
    (tr.busyUntil | 0) <= t &&
    Math.max(0, Math.min(1, Number(tr.condition))) >= FLEET.minConditionToRun &&
    (!cargoClass || canCarry(tr.type, cargoClass)));
  /* 🔴 DRIVERS CAP THE FLEET, NOT THE OTHER WAY ROUND. "10 trucks but only 6
     drivers → maximum 6 active" is §12, and it is applied HERE so every path —
     quoting, planning, dispatching — sees the same number. Applying it only at
     dispatch would let a company accept work it can never crew. */
  const busy = (company.trucks || []).filter(tr => (tr.busyUntil | 0) > t).length;
  const freeDrivers = Math.max(0, (company.drivers | 0) - busy);
  return idle.slice(0, freeDrivers);
}

export function fleetCapacity(company, cargoClass, now) {
  return availableTrucks(company, cargoClass, now).reduce((n, tr) => n + truckCapacity(tr), 0);
}

/**
 * Which trucks would carry this load? Biggest-first, which is what a dispatcher
 * does and what makes "2 heavy haulers OR 4 freight trucks" fall out naturally.
 * Returns { ok, trucks, capacity, reason }.
 */
export function planContract(company, contract, now) {
  const cls = (contract && contract.cargoClass) || 'general';
  const need = Math.floor(num(contract && contract.units));
  if (need <= 0) return { ok: false, reason: 'bad_contract', trucks: [], capacity: 0 };
  const pool = availableTrucks(company, cls, now)
    .slice().sort((a, b) => truckCapacity(b) - truckCapacity(a));
  if (!pool.length) {
    /* Told apart on purpose: "no truck of yours can legally carry this" is a
       different problem from "they are all out", and sends the player to a
       different screen. */
    const anyType = (company.trucks || []).some(tr => canCarry(tr.type, cls));
    return { ok: false, reason: anyType ? 'none_available' : 'no_suitable_truck', trucks: [], capacity: 0 };
  }
  const picked = []; let cap = 0;
  for (const tr of pool) { if (cap >= need) break; picked.push(tr); cap += truckCapacity(tr); }
  if (cap < need) return { ok: false, reason: 'insufficient_capacity', trucks: picked, capacity: cap, need };
  return { ok: true, trucks: picked, capacity: cap, need };
}

export function fuelForPlan(plan, miles) {
  const m = num(miles);
  return Math.ceil((plan.trucks || []).reduce((n, tr) => {
    const d = truckDef(tr.type); return n + (d ? d.fuelPerMile * m : 0);
  }, 0));
}

/** Slowest truck sets the convoy's pace, and wear slows it further. */
export function etaMinutes(plan, miles, roadQuality) {
  const m = num(miles);
  if (!plan.trucks || !plan.trucks.length || m <= 0) return 0;
  const road = Math.max(0.35, Math.min(1.25, num(roadQuality) || 1));
  let slowest = Infinity;
  for (const tr of plan.trucks) {
    const d = truckDef(tr.type); if (!d) continue;
    const cond = Math.max(FLEET.minConditionToRun, Math.max(0, Math.min(1, Number(tr.condition))));
    slowest = Math.min(slowest, d.mph * road * (0.55 + 0.45 * cond));
  }
  if (!isFinite(slowest) || slowest <= 0) return 0;
  return Math.max(1, Math.round((m / slowest) * 60));
}

/**
 * Everything that must be true before wheels turn.
 * Returns { ok, reason, plan, fuel, eta }.
 */
export function canDispatch(company, contract, now) {
  const plan = planContract(company, contract, now);
  if (!plan.ok) return { ok: false, reason: plan.reason, plan };
  const fuel = fuelForPlan(plan, contract.miles);
  if ((company.fuel | 0) < fuel) return { ok: false, reason: 'no_fuel', plan, fuel, have: company.fuel | 0 };
  return { ok: true, plan, fuel, eta: etaMinutes(plan, contract.miles, contract.roadQuality) };
}

/**
 * 🔴 THE NO-TELEPORT STEP. Cargo leaves the origin HERE and exists only on the
 * shipment until arrive() runs. Nothing is added to a destination in this call
 * — that is the whole point of the brief's §20, and the conservation test is
 * what keeps it true.
 */
export function dispatch(company, contract, now) {
  const chk = canDispatch(company, contract, now);
  if (!chk.ok) return { ok: false, reason: chk.reason, company, shipment: null, ...chk };
  const t = now || 0;
  const etaMs = chk.eta * 60000;
  const ids = new Set(chk.plan.trucks.map(x => x.id));
  const trucks = (company.trucks || []).map(tr => ids.has(tr.id)
    ? { ...tr, busyUntil: t + etaMs }
    : tr);
  const shipment = {
    id: contract.id, from: contract.from, to: contract.to,
    cargoClass: contract.cargoClass || 'general',
    manifest: { ...(contract.manifest || {}) },   // the goods, held in transit
    units: contract.units | 0, miles: contract.miles | 0,
    pay: contract.pay | 0, truckIds: [...ids],
    departedAt: t, dueAt: t + etaMs, etaMin: chk.eta,
  };
  return {
    ok: true,
    company: { ...company, trucks, fuel: (company.fuel | 0) - chk.fuel,
               inTransit: [...(company.inTransit || []), shipment] },
    shipment, fuel: chk.fuel, eta: chk.eta,
  };
}

/**
 * Completion. Wear is applied, the rating moves, the cargo is RELEASED to the
 * caller — which is the only moment a destination may receive anything.
 */
export function arrive(company, shipmentId, now) {
  const t = now || 0;
  const ship = (company.inTransit || []).find(s => s.id === shipmentId);
  if (!ship) return { ok: false, reason: 'no_such_shipment', company, delivered: null };
  if (t < ship.dueAt) return { ok: false, reason: 'still_moving', company, delivered: null, dueAt: ship.dueAt };
  const wear = ship.miles * FLEET.wearPerMile / 100;
  const ids = new Set(ship.truckIds);
  const trucks = (company.trucks || []).map(tr => ids.has(tr.id)
    ? { ...tr, busyUntil: 0, condition: Math.max(0, Math.min(1, Number(tr.condition)) - wear) }
    : tr);
  const onTime = t <= ship.dueAt + 60000;
  const rating = clampRating((company.rating == null ? FLEET.ratingStart : company.rating) +
                             (onTime ? FLEET.onTimeGain : -FLEET.lateLoss));
  return {
    ok: true,
    company: { ...company, trucks, rating,
               cinder: (company.cinder | 0) + (ship.pay | 0),
               inTransit: (company.inTransit || []).filter(s => s.id !== shipmentId),
               delivered: (company.delivered | 0) + 1 },
    delivered: { to: ship.to, manifest: { ...ship.manifest }, pay: ship.pay | 0 },
  };
}

export function clampRating(r) {
  const v = Number(r); if (!isFinite(v)) return FLEET.ratingStart;
  return Math.max(FLEET.ratingMin, Math.min(FLEET.ratingMax, Math.round(v * 100) / 100));
}

/** Every unit of freight the company is responsible for, wherever it is. */
export function totalCargo(company) {
  let n = 0;
  for (const s of (company.inTransit || [])) {
    for (const k in (s.manifest || {})) n += s.manifest[k] | 0;
  }
  return n;
}

export function repair(company, truckId, amount) {
  const trucks = (company.trucks || []).map(tr => tr.id === truckId
    ? { ...tr, condition: Math.max(0, Math.min(1, Number(tr.condition) + (Number(amount) || 0))) }
    : tr);
  return { ...company, trucks };
}

export default {
  CARGO, CARGO_IDS, TRUCK_TYPES, TRUCK_IDS, FLEET,
  truckDef, canCarry, newTruck, truckCapacity, availableTrucks, fleetCapacity,
  planContract, fuelForPlan, etaMinutes, canDispatch, dispatch, arrive,
  clampRating, totalCargo, repair,
};
