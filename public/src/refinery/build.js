/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — construction: what a unit costs and how it gets built
   ---------------------------------------------------------------------------
   ⚠ WHY THESE PARTICULAR RESOURCES, AND NOT THE OTHER 245.
   The game's resource ledger has 395 entries but only FOURTEEN are live —
   obtainable, spendable, priceable. The other 245 sit in
   /src/resources/chain.js as a CATALOGUE with no producer, and
   RESOURCES_NEXT.md is emphatic about what happens if you spend them anyway:

     "A resource you can loot, bank, and be capped by — but cannot sell,
      spend, make, or see. That is not 'wood is missing'; it is worse than
      missing, because the player's pile of it is real and inert."

   A Cracking Unit priced in `industrialPump` would therefore be a unit no
   player could ever build. So every cost below is drawn from the live
   fourteen, plus the refinery's OWN output — the heavy oil and naphtha the
   yard already makes, which is both obtainable and thematically exact: a
   refinery lines its own tanks and pads with its own residue.

   If the industrial ids are ever promoted WITH producers (the documented
   five-site process), the `res` maps here are the only thing that changes.
   ═════════════════════════════════════════════════════════════════════════ */

import { EQUIPMENT, equipCost, COMPONENTS, STREAMS } from './data.js';
import * as St from './state.js';

/* The live-ledger ids this feature spends, and what each one stands for on a
   refinery site. Named here so the cost cards can explain themselves. */
export const MATERIALS = {
  metal:            { name: 'Metal',             icon: '⛓️', use: 'structural steel, shells, piping' },
  stone:            { name: 'Stone',             icon: '🪨', use: 'foundations, bunds, hardstanding' },
  supplies:         { name: 'Supplies',          icon: '📦', use: 'valves, fittings, instrumentation' },
  wood:             { name: 'Wood',              icon: '🪵', use: 'formwork and scaffold' },
  cloth:            { name: 'Cloth',             icon: '🧵', use: 'filter media and lagging' },
  fuel:             { name: 'Fuel',              icon: '⛽', use: 'commissioning and plant burn' },
  corruptedEssence: { name: 'Corrupted Essence', icon: '🟣', use: 'catalyst beds' },
  memoryShards:     { name: 'Memory Shards',     icon: '🧠', use: 'control logic and analysis' },
};

/* Streams the yard makes itself. Spent straight out of the tank farm. */
export const SELF_SUPPLIED = { heavy: 'Heavy Oil', naphtha: 'Naphtha', slop: 'Slop' };

/* ── THE BILL OF MATERIALS ────────────────────────────────────────────────
   cinder — labour and contractors. Kept, but roughly half what it was before
            materials existed, so the total burden is comparable and the
            decision is now "have I got the steel" rather than only "have I
            got the money".
   res    — live-ledger resources, per unit built.
   yard   — the refinery's own streams, in litres.
   Costs scale with how many you already own, through the same growth curve
   the Cinder price uses, so the tenth tank is not the price of the first. */
export const BOM = {
  crudeTank:  { res: { metal: 34, stone: 18, supplies: 8 },                          yard: { heavy: 1200 } },
  storeTank:  { res: { metal: 28, stone: 12, supplies: 6 },                          yard: { heavy: 900 } },
  blendTank:  { res: { metal: 46, stone: 16, supplies: 20, cloth: 10 },              yard: { naphtha: 400 } },
  bay:        { res: { metal: 30, stone: 26, wood: 14, supplies: 9 },                yard: { heavy: 2200 } },
  truck:      { res: { metal: 52, supplies: 20, cloth: 6 },                          yard: { fuel: 0 }, fuelRes: 45 },
  cdu:        { res: { metal: 120, stone: 60, supplies: 40 },                        yard: { heavy: 3000 } },
  cracker:    { res: { metal: 180, stone: 80, supplies: 55, corruptedEssence: 24 },  yard: { heavy: 4000 } },
  reformer:   { res: { metal: 210, stone: 70, supplies: 65, corruptedEssence: 30 },  yard: { naphtha: 1500 } },
  treater:    { res: { metal: 165, stone: 60, supplies: 50, corruptedEssence: 18 },  yard: { heavy: 2500 } },
  alky:       { res: { metal: 260, stone: 90, supplies: 80, corruptedEssence: 45, memoryShards: 12 }, yard: { naphtha: 2200 } },
  lab:        { res: { metal: 60, stone: 30, supplies: 40, memoryShards: 16 },       yard: {} },
  pumps:      { res: { metal: 70, supplies: 34, cloth: 8 },                          yard: {} },
  automation: { res: { metal: 40, supplies: 55, memoryShards: 34 },                  yard: {} },
};

/* Materials scale more gently than Cinder does (1.42 vs the equipment table's
   1.7–2.4). Steel is steel; it is the contractors who get expensive. */
const RES_GROWTH = 1.42;

export function costFor(id) {
  const bom = BOM[id];
  const owned = St.count(id);
  const k = Math.pow(RES_GROWTH, Math.max(0, owned));
  const res = {}, yard = {};
  if (bom) {
    for (const r in bom.res) res[r] = Math.ceil(bom.res[r] * k);
    if (bom.fuelRes) res.fuel = Math.ceil(bom.fuelRes * k);
    for (const y in bom.yard) if (bom.yard[y] > 0) yard[y] = Math.ceil(bom.yard[y] * k);
  }
  // Cinder halves now that materials carry their share of the price.
  return { cinder: Math.round(equipCost(id, owned) * 0.55), res, yard };
}

/* What the player is short of, itemised — so the card can say "you need 12
   more Metal" rather than a flat refusal. */
export function shortfall(id) {
  const c = costFor(id);
  const miss = [];
  if (St.cinder() < c.cinder) miss.push({ kind: 'cinder', id: 'cinder', name: 'Cinder', icon: '🔥', need: c.cinder, have: St.cinder() });
  for (const r in c.res) {
    const have = St.getRes(r);
    if (have < c.res[r]) miss.push({ kind: 'res', id: r, name: MATERIALS[r] ? MATERIALS[r].name : r, icon: MATERIALS[r] ? MATERIALS[r].icon : '•', need: c.res[r], have });
  }
  for (const y in c.yard) {
    const have = Math.floor(St.stock(y));
    if (have < c.yard[y]) miss.push({ kind: 'yard', id: y, name: (STREAMS[y] || COMPONENTS[y] || { name: y }).name, icon: (STREAMS[y] || COMPONENTS[y] || {}).ico || '•', need: c.yard[y], have, litres: true });
  }
  return miss;
}
export function canBuild(id) {
  const e = EQUIPMENT[id];
  if (!e || St.count(id) >= e.max) return false;
  return shortfall(id).length === 0;
}

/* ── COMMISSIONING ════════════════════════════════════════════════════════
   ⚠ ORDER MATTERS AND SO DOES THE UNWIND. Three separate ledgers move here —
   the game's resources, the yard's own tanks, and Cinder — and any of them can
   refuse. Everything taken before a refusal is put BACK, or a player pays for
   a unit they never receive. Resources are refunded through the bridge's
   refundRes, not addRes: addRes enforces the stash cap and silently drops the
   overflow, which would turn a safe unwind into theft. */
export function commission(id) {
  const e = EQUIPMENT[id];
  if (!e) return false;
  if (St.count(id) >= e.max) { St.toast('That is already at maximum.', 2600); return false; }

  const miss = shortfall(id);
  if (miss.length) {
    const first = miss[0];
    St.toast('Short ' + (first.need - first.have).toLocaleString() + ' ' + first.icon + ' ' + first.name + ' for the ' + e.name + '.', 4400);
    return false;
  }

  const c = costFor(id);
  const takenRes = [], takenYard = [];
  const unwind = () => {
    for (const [r, n] of takenRes) St.refundRes(r, n);
    for (const [y, n] of takenYard) St.addStock(y, n);
  };

  for (const r in c.res) {
    if (!St.spendRes(r, c.res[r])) { unwind(); St.toast('Could not draw ' + (MATERIALS[r] ? MATERIALS[r].name : r) + ' from the stores.', 4000); return false; }
    takenRes.push([r, c.res[r]]);
  }
  for (const y in c.yard) {
    if (!St.takeStock(y, c.yard[y])) { unwind(); St.toast('Not enough ' + y + ' in the tank farm.', 4000); return false; }
    takenYard.push([y, c.yard[y]]);
  }
  if (!St.spend(c.cinder, 'Refinery: build ' + e.name)) {
    unwind();
    St.toast('Labour for the ' + e.name + ' costs ' + c.cinder.toLocaleString() + ' 🔥.', 4000);
    return false;
  }

  const s = St.S();
  s.equip[id] = St.count(id) + 1;
  if (typeof s.cond[id] !== 'number' || s.cond[id] < 100) s.cond[id] = 100;
  St.charge('maintenance', 0);   // construction is capital, not a session cost
  St.log('good', '🏗 Commissioned ' + e.name + ' #' + s.equip[id] + '.');
  St.save();
  return true;
}

/* ── BUILD PLOTS ══════════════════════════════════════════════════════════
   A plot is the ground the NEXT unit of a type will actually stand on, so the
   player walks to where the thing will be rather than opening a menu from
   anywhere. The positions mirror the scene's placement maths exactly — if the
   two ever disagree, a player builds a tank and it appears somewhere else.
   Keep them in step: scene.js reads this function for both. */
export function plotPosition(id, index) {
  switch (id) {
    case 'crudeTank': return { x: -25 + (index % 2) * 9,  z: -16 + Math.floor(index / 2) * 10 };
    case 'cdu':       return { x: -6 + index * 8,          z: -4 };
    case 'cracker':   return { x: 14 + index * 7,          z: -12 };
    case 'reformer':  return { x: 22 + index * 7,          z: -14 };
    case 'treater':   return { x: 14 + index * 7,          z: -1 };
    case 'alky':      return { x: 23 + index * 7,          z: -2 };
    case 'blendTank': return { x: -24 + index * 8,         z: 8 };
    case 'storeTank': return { x: 6 + (index % 5) * 7,     z: 10 + Math.floor(index / 5) * 8 };
    case 'bay':       return { x: -21 + index * 13,        z: 25 };
    case 'truck':     return { x: -26 + index * 6,         z: 32 };
    case 'lab':       return { x: 28, z: 20 };
    case 'automation':return { x: 28, z: 27 };
    case 'pumps':     return { x: -14 + index * 3.4,       z: 2.5 };
    default:          return { x: 0, z: 0 };
  }
}

/* Every plot that could be built on right now: one per type that is under its
   maximum. The player sees a marked-out pad wherever expansion is possible. */
export function openPlots() {
  const s = St.S();
  const out = [];
  for (const id in BOM) {
    const e = EQUIPMENT[id];
    const owned = St.count(id);
    if (!e || owned >= e.max) continue;
    const p = plotPosition(id, owned);
    out.push({
      id, index: owned, x: p.x, z: p.z,
      label: e.name, ico: e.ico, next: owned + 1, max: e.max,
      ready: canBuild(id),
    });
  }
  return out;
}
