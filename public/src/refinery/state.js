/* ═══════════════════════════════════════════════════════════════════════════
   🛢 HIDN PETRO — persistent state + the bridge seam
   ---------------------------------------------------------------------------
   ⚠ THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Cloud`, `App`, `Corp` are
   top-level `const` in index.html. They are lexical bindings, NOT properties
   of `window`, so nothing in this file can see them and nothing in this file
   may try. index.html hands us window.MythicRefineryBridge and that object is
   the ENTIRE surface between this feature and the legacy app.

   Without the bridge this module still loads, still runs, and plays against a
   local mock wallet — the same degradation rule the Supabase paths follow. A
   missing bridge must never be an exception in a player's face.
   ═════════════════════════════════════════════════════════════════════════ */

import { EQUIPMENT, equipCost, LAB_TIERS, safetyLetter } from './data.js';

let _warned = false;
export function bridge() {
  const b = (typeof window !== 'undefined' && window.MythicRefineryBridge) || null;
  if (!b && !_warned) {
    _warned = true;
    try { console.warn('[refinery] no MythicRefineryBridge — running in standalone mock mode.'); } catch (e) {}
  }
  return b;
}

/* ── Wallet. Cinder is Profile.gems and is ONLY ever moved through the game's
      spendGems/addGems. We never touch a balance directly — see CLAUDE.md.
      The mock wallet exists so the module is playable and testable with no
      game attached; it is deliberately not persisted anywhere. */
let _mockCinder = 250000;
export function cinder() {
  const b = bridge(); if (b && b.gems) { try { return b.gems() | 0; } catch (e) {} }
  return _mockCinder | 0;
}
export function spend(n, why) {
  n = Math.max(0, Math.round(n || 0));
  if (n === 0) return true;
  const b = bridge();
  if (b && b.spendGems) { try { return !!b.spendGems(n, why); } catch (e) { return false; } }
  if (_mockCinder < n) return false;
  _mockCinder -= n; return true;
}
export function earn(n, why) {
  n = Math.max(0, Math.round(n || 0));
  if (n === 0) return;
  const b = bridge();
  if (b && b.addGems) { try { b.addGems(n, why); return; } catch (e) {} }
  _mockCinder += n;
}
export function toast(msg, ms) {
  const b = bridge();
  if (b && b.toast) { try { b.toast(msg, ms); return; } catch (e) {} }
  try { console.info('[refinery]', msg); } catch (e) {}
}
export function confirmAsync(msg) {
  const b = bridge();
  if (b && b.confirm) { try { return Promise.resolve(b.confirm(msg)); } catch (e) {} }
  return Promise.resolve(true);
}

/* ═══ THE SAVE ═══════════════════════════════════════════════════════════
   Lives on Profile.refinery, handed over by the bridge. Every field is
   defaulted here and nowhere else, so a save written by an older build
   hydrates into a complete object instead of throwing on the first read.
   That is the same absent-tolerant shape the city bridge uses. */
const FALLBACK = {};
export function S() {
  const b = bridge();
  let s = null;
  if (b && b.state) { try { s = b.state(); } catch (e) { s = null; } }
  if (!s || typeof s !== 'object') s = FALLBACK;
  return ensure(s);
}

export function ensure(s) {
  if (typeof s.owned !== 'boolean') s.owned = false;

  /* Equipment. The starting yard is exactly what the brief calls for: one
     crude tank, one column, two product tanks, one loading bay, one truck.
     Everything else is bought. `cdu:1` is free because a refinery with no
     column is not a refinery — it is a car park. */
  if (!s.equip || typeof s.equip !== 'object') s.equip = {};
  const startEquip = { crudeTank: 1, storeTank: 2, blendTank: 1, bay: 1, truck: 1, cdu: 1,
                       cracker: 0, reformer: 0, treater: 0, alky: 0, lab: 0, pumps: 0, automation: 0 };
  for (const k in startEquip) if (typeof s.equip[k] !== 'number') s.equip[k] = startEquip[k];

  // Equipment condition, 0–100. Wear is per-unit-type: you can run the column
  // into the ground without it touching your trucks.
  if (!s.cond || typeof s.cond !== 'object') s.cond = {};
  for (const k in EQUIPMENT) if (typeof s.cond[k] !== 'number') s.cond[k] = 100;

  // Crude on hand: array of shipments so grade/assay survives storage. Two
  // parcels of different crude are genuinely different things and blending
  // them in the tank would throw away the whole assay stage.
  if (!Array.isArray(s.crude)) s.crude = [];
  // Component + stream inventory, litres.
  if (!s.stock || typeof s.stock !== 'object') s.stock = {};
  // Finished, tested batches waiting on a tank or a truck.
  if (!Array.isArray(s.batches)) s.batches = [];
  // Contracts the player has accepted.
  if (!Array.isArray(s.contracts)) s.contracts = [];
  // Contracts on offer (regenerated on open; persisted so a refresh does not
  // reroll a good offer the player was saving for).
  if (!Array.isArray(s.offers)) s.offers = [];
  // Trucks in flight: { id, contractId, litres, km, leftAt, etaMs, dest }
  if (!Array.isArray(s.convoy)) s.convoy = [];

  /* Reputation. Starts at the middle of every axis — a new refiner is neither
     trusted nor suspected. wholesale is DERIVED (see repWholesale) so it can
     never drift out of agreement with the four axes that feed it. */
  if (!s.rep || typeof s.rep !== 'object') s.rep = {};
  if (typeof s.rep.quality !== 'number')    s.rep.quality = 62;
  if (typeof s.rep.delivery !== 'number')   s.rep.delivery = 78;
  if (typeof s.rep.safety !== 'number')     s.rep.safety = 74;
  if (typeof s.rep.completion !== 'number') s.rep.completion = 70;

  // Session P&L. Reset when a session is opened; kept on the save so a
  // mid-session reload does not wipe the statement the player is reading.
  if (!s.pnl || typeof s.pnl !== 'object') s.pnl = freshPnl();
  for (const k in freshPnl()) if (typeof s.pnl[k] !== 'number') s.pnl[k] = 0;

  if (typeof s.marketIndex !== 'number') s.marketIndex = 1;
  if (typeof s.suppliedRecent !== 'number') s.suppliedRecent = 0;  // litres poured into the market
  if (typeof s.lifetimeL !== 'number') s.lifetimeL = 0;
  if (typeof s.lifetimeRevenue !== 'number') s.lifetimeRevenue = 0;
  if (typeof s.batchSeq !== 'number') s.batchSeq = 471;            // first batch a player sees is #472
  if (typeof s.offersRolledAt !== 'number') s.offersRolledAt = 0;
  if (!Array.isArray(s.log)) s.log = [];
  return s;
}

export function freshPnl() {
  return { revenue: 0, crude: 0, power: 0, labour: 0, additives: 0, transport: 0,
           maintenance: 0, penalties: 0, scrapped: 0, disposal: 0 };
}
export function pnlNet(p) {
  return (p.revenue | 0) - ((p.crude | 0) + (p.power | 0) + (p.labour | 0) + (p.additives | 0)
    + (p.transport | 0) + (p.maintenance | 0) + (p.penalties | 0) + (p.scrapped | 0) + (p.disposal | 0));
}
export const PNL_ROWS = [
  ['revenue',     'Contract revenue', '+'],
  ['crude',       'Crude purchases',  '-'],
  ['power',       'Electricity',      '-'],
  ['labour',      'Crew wages',       '-'],
  ['additives',   'Additives & spot buys', '-'],
  ['transport',   'Haulage',          '-'],
  ['maintenance', 'Maintenance',      '-'],
  ['penalties',   'Late penalties',   '-'],
  ['scrapped',    'Failed batches',   '-'],
  ['disposal',    'Slop disposal',    '-'],
];
export function charge(key, n) {
  const s = S(); const v = Math.max(0, Math.round(n || 0));
  if (v <= 0) return;
  s.pnl[key] = (s.pnl[key] | 0) + v;
}

export function save() {
  const b = bridge();
  if (b && b.save) { try { return !!b.save(); } catch (e) { return false; } }
  return true;
}
export function log(level, msg) {
  const s = S();
  s.log.unshift({ ts: Date.now(), level: level || 'info', msg: String(msg || '') });
  if (s.log.length > 80) s.log.length = 80;
}

/* ═══ GAME RESOURCES ═════════════════════════════════════════════════════
   The camp salvage ledger — the fourteen live resources — reached through the
   bridge, never touched directly. Construction spends these; see build.js for
   why the other 245 catalogued ids are deliberately not spendable here.
   Absent bridge = zero of everything, which makes every build unaffordable
   rather than free. That is the correct failure direction. */
export function getRes(id) {
  const b = bridge();
  if (b && b.getRes) { try { return b.getRes(id) | 0; } catch (e) { return 0; } }
  return _mockRes[id] || 0;
}
export function spendRes(id, n) {
  n = Math.max(0, Math.round(n || 0));
  if (n === 0) return true;
  const b = bridge();
  if (b && b.spendRes) { try { return !!b.spendRes(id, n); } catch (e) { return false; } }
  if ((_mockRes[id] || 0) < n) return false;
  _mockRes[id] -= n; return true;
}
/* ⚠ REFUND, NOT ADD. addRes enforces the stash cap and returns without adding
   when the vault is full, which silently destroys an unwind — the city bridge
   records the same lesson. A refund returns units the player held moments ago
   and must not be capped away. */
export function refundRes(id, n) {
  n = Math.max(0, Math.round(n || 0));
  if (n === 0) return;
  const b = bridge();
  if (b && b.refundRes) { try { b.refundRes(id, n); return; } catch (e) {} }
  _mockRes[id] = (_mockRes[id] || 0) + n;
}
/* Stand-in stores, so the module is playable and testable with no game
   attached. Generous on purpose — the mock exists to exercise the build flow,
   not to be balanced against. */
const _mockRes = { metal: 900, stone: 600, supplies: 500, wood: 300, cloth: 200,
                   fuel: 400, corruptedEssence: 180, memoryShards: 120 };

/* ═══ MODEL URLS ═════════════════════════════════════════════════════════
   Admin-authored, cloud-synced through Forge — see models.js. */
export function modelUrls() {
  const b = bridge();
  if (b && b.modelUrls) { try { return b.modelUrls() || {}; } catch (e) { return {}; } }
  return _mockModels;
}
export function setModelUrl(slot, url) {
  const b = bridge();
  if (b && b.setModelUrl) { try { return !!b.setModelUrl(slot, url); } catch (e) { return false; } }
  if (url) _mockModels[slot] = url; else delete _mockModels[slot];
  return true;
}
const _mockModels = {};
export function isAdmin() {
  const b = bridge();
  try { return !!(b && b.isAdmin && b.isAdmin()); } catch (e) { return false; }
}

/* ═══ CAPACITY ═══════════════════════════════════════════════════════════
   Capacity is the reason equipment is physical rather than cosmetic: a
   shipment you cannot store is a shipment you cannot accept. */
export const CRUDE_TANK_L = 30000;
export const STORE_TANK_L = 24000;
export const BLEND_TANK_L = 16000;
export const TRUCK_L = 9000;

export function crudeCap(s)  { return (s.equip.crudeTank | 0) * CRUDE_TANK_L; }
export function crudeHeld(s) { return s.crude.reduce((a, c) => a + (c.litres || 0), 0); }
export function storeCap(s)  { return (s.equip.storeTank | 0) * STORE_TANK_L; }
export function storeHeld(s) {
  let v = 0; for (const k in s.stock) v += Math.max(0, s.stock[k] || 0);
  for (const b of s.batches) v += Math.max(0, b.litres || 0);
  return v;
}

export function stock(id) { const s = S(); return Math.max(0, s.stock[id] || 0); }
export function addStock(id, litres) {
  const s = S();
  s.stock[id] = Math.max(0, (s.stock[id] || 0) + litres);
  if (s.stock[id] < 0.5) delete s.stock[id];
}
export function takeStock(id, litres) {
  const s = S();
  const have = Math.max(0, s.stock[id] || 0);
  if (have + 1e-6 < litres) return false;
  addStock(id, -litres);
  return true;
}

/* ══ 🛢 THE YARD → THE CAMP STORES ══════════════════════════════════════════
   The thirteen cuts are real game resources now (RESOURCES in index.html), so
   the yard needs a door they come OUT of — otherwise they are ids a player can
   bank and loot but never make, which is the exact inert-resource case that
   list's own rules forbid.

   🔴 ONE MAPPING TABLE, HERE, AND NOWHERE ELSE. The yard's internal keys are
      short because they only ever had to be unique inside one mini-game
      (`kero`, `heavy`, `catgas`, `hydro`, `slopcut`); the global resource
      namespace holds 137 ids and cannot take words that vague. Every id that
      could be kept identical WAS kept identical, so this table is as small as
      it can be and a reader can see at a glance which five differ. */
export const STASH_IDS = {
  // distillation streams
  naphtha: 'naphtha',
  kero: 'kerosene',
  diesel: 'diesel',
  gasoil: 'gasOil',
  heavy: 'heavyOil',
  slop: 'slop',
  // blend components
  reformate: 'reformate',
  alkylate: 'alkylate',
  catgas: 'catGasoline',
  butane: 'butane',
  ethanol: 'ethanol',
  hydro: 'hydrotreatedCut',
  slopcut: 'reprocessedSlop',
};

/* How many litres make one unit of the stashed resource.
   ⚠ THE YARD THINKS IN LITRES AND THE CAMP THINKS IN UNITS, and conflating the
     two would let a player draw 30,000 "Diesel" out of one tank and drown the
     resource economy. 200 L to the unit is a drum, which is both a sane number
     to carry and roughly what the rack pays for one — see RACK below. */
export const LITRES_PER_UNIT = 200;

export function stashIdFor(yardId) { return STASH_IDS[yardId] || null; }

/* Draw a stream or component out of the yard's tanks and into the player's
   camp stores as real resource units.
   🔴 TAKE FIRST, THEN CREDIT, AND PUT IT BACK IF THE CREDIT REFUSES. The stash
      has a ceiling (addRes enforces it and can silently drop the overflow), so
      crediting first would let a full vault eat the litres. */
export function drawToStash(yardId, units) {
  /* ⚠ THIS MODULE'S GUARD IS A NULL BRIDGE, not a ready() — ready() is the
     plague module's convention and does not exist here. Copying the shape
     across threw a ReferenceError on the first real call. */
  const B = bridge();
  if (!B || typeof B.addRes !== 'function') {
    return { ok: false, error: 'The yard is not connected to your stores.' };
  }
  const rid = stashIdFor(yardId);
  if (!rid) return { ok: false, error: 'That is not something the yard can drum up.' };
  const n = Math.max(1, Math.floor(+units || 0));
  const litres = n * LITRES_PER_UNIT;
  if (stock(yardId) + 1e-6 < litres) {
    return { ok: false, error: 'Not enough in the tanks — ' + litres.toLocaleString() + ' L needed for ' + n + '.' };
  }
  if (!takeStock(yardId, litres)) return { ok: false, error: 'The tank would not release it.' };
  let credited = false;
  /* ⚠ (id, n), NOT a map — this bridge's convention differs from the plague
     bridge's, and the wrong shape here would credit nothing while reporting
     success. Checked against MythicRefineryBridge in index.html. */
  try { credited = B.addRes(rid, n) === true; } catch (e) { credited = false; }
  if (!credited) {
    addStock(yardId, litres);                       // straight back in the tank
    return { ok: false, error: 'Your stores would not take it — the litres are still in the tank.' };
  }
  save();   // ⚠ save(), not persist() — again, this module's own convention
  return { ok: true, resource: rid, units: n, litres };
}

/* ═══ EQUIPMENT ══════════════════════════════════════════════════════════ */
export function owns(id) { const s = S(); return (s.equip[id] | 0) > 0; }
/* 🛢 TANKERS ON THE PRINCE PORTFOLIOS LOT. The Cracking Yard's fleet is bought,
   not built — at the Truck Yard's Oil & Fuel tab or from another player on the
   P2P market — so this is where the yard learns how many trucks it has. */
export function tankers() {
  try {
    const b = bridge();
    const rows = (b && b.tankers) ? b.tankers() : null;
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

/* 🔴 THE TRUCK COUNT IS BOUGHT VEHICLES PLUS WHAT WAS ALREADY BUILT, and the
   second half of that sentence is not optional. Removing the build path must
   not repossess the trucks players commissioned before it was removed: the
   equip counter is still read and simply stops growing. Everything downstream
   — bays, dispatch, the parked trucks in the 3D yard — asks count('truck') and
   needs no idea where a truck came from. */
export function count(id) {
  const s = S();
  const built = s.equip[id] | 0;
  if (id !== 'truck') return built;
  return built + tankers().length;
}
export function nextCost(id) { return equipCost(id, count(id)); }
export function canBuy(id) {
  const e = EQUIPMENT[id]; if (!e) return false;
  return count(id) < e.max && cinder() >= nextCost(id);
}
export function buyEquip(id) {
  const e = EQUIPMENT[id]; if (!e) return false;
  const s = S();
  if (count(id) >= e.max) { toast('That is already at maximum.', 2600); return false; }
  const c = nextCost(id);
  if (!spend(c, 'Refinery: ' + e.name)) { toast('Not enough Cinder — need ' + c.toLocaleString() + ' 🔥.', 3200); return false; }
  s.equip[id] = count(id) + 1;
  if (typeof s.cond[id] !== 'number' || s.cond[id] < 100) s.cond[id] = 100;
  log('good', 'Commissioned ' + e.name + ' #' + s.equip[id] + ' for ' + c.toLocaleString() + ' 🔥.');
  save();
  return true;
}

/* Condition. Wear is applied by the sim; this is the only place it is healed,
   and it costs real Cinder per point so running hot is a loan, not a cheat. */
export function condition(id) { const s = S(); const v = s.cond[id]; return typeof v === 'number' ? v : 100; }
export function wear(id, points) {
  const s = S();
  s.cond[id] = Math.max(0, Math.min(100, condition(id) - Math.max(0, points)));
}
export function repairCost(id) {
  const gap = 100 - condition(id);
  if (gap <= 0) return 0;
  // Scales with how much equipment of that type you own — a bigger yard costs
  // more to keep, which is what stops "buy everything" being free.
  return Math.round(gap * 34 * Math.max(1, count(id)));
}
export function repair(id) {
  const c = repairCost(id);
  if (c <= 0) { toast('Already in full condition.', 2200); return false; }
  if (!spend(c, 'Refinery: maintenance')) { toast('Maintenance needs ' + c.toLocaleString() + ' 🔥.', 3200); return false; }
  charge('maintenance', c);
  const s = S(); s.cond[id] = 100;
  log('info', 'Maintenance on ' + (EQUIPMENT[id] ? EQUIPMENT[id].name : id) + ' — ' + c.toLocaleString() + ' 🔥.');
  save();
  return true;
}
/* The worst-conditioned unit in the yard, which is what the safety index and
   the incident roll should actually key off. One neglected pump train is a
   hazard even if everything else is new. */
export function worstCondition() {
  const s = S();
  let worst = 100;
  for (const k in EQUIPMENT) if ((s.equip[k] | 0) > 0) worst = Math.min(worst, condition(k));
  return worst;
}

/* ═══ REPUTATION ═════════════════════════════════════════════════════════
   Wholesale is derived, never stored, so the headline number and the four
   axes under it can never disagree. Quality and reliability are weighted
   hardest because those are the two a station manager can actually feel. */
export function repWholesale() {
  const s = S(); const r = s.rep;
  return Math.round(
    r.quality * 0.32 + r.delivery * 0.28 + r.completion * 0.24 + r.safety * 0.16
  );
}
export function repStars() { const s = S(); return Math.max(0, Math.min(5, Math.round(s.rep.quality / 20))); }
export function repSafetyLetter() { const s = S(); return safetyLetter(s.rep.safety); }
/* Nudge an axis. EASE is asymmetric on purpose: reputation is slow to earn and
   fast to lose, which is the only way "bad fuel has consequences" can be felt
   rather than read. */
export function nudgeRep(axis, delta) {
  const s = S();
  if (typeof s.rep[axis] !== 'number') return;
  const ease = delta < 0 ? 1.0 : 0.55;
  s.rep[axis] = Math.max(0, Math.min(100, s.rep[axis] + delta * ease));
}

/* ═══ LAB ════════════════════════════════════════════════════════════════ */
export function lab() { return LAB_TIERS[Math.max(0, Math.min(LAB_TIERS.length - 1, count('lab')))]; }
