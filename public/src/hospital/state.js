/* ══════════════════════════════════════════════════════════════════════════
   💾 HOSPITAL STATE — the ONE place in /src/hospital that spends, credits,
   saves or reads the game. Everything else here is pure or presentation.
   ──────────────────────────────────────────────────────────────────────────
   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Corp`, `_opEcon` and the
   resource helpers are top-level `const` in index.html and NOT on window.
   This file reads NOTHING by itself. It rides the SAME bridge the plague
   modules use — window.MythicPlagueBridge — which index.html extends with two
   more accessors for this feature: `pharmaState()` / `setPharmaState()`, one
   Profile slot. If the hospital ever needs something new, ADD IT TO THE
   BRIDGE; never reach for a bare global.

   🔴 LEDGERS ARE APPEND-ONLY. `lines` are records of cures the ward received;
   a spent line is marked, not spliced. `sales` is a log the city appends to,
   capped by age. Stock on the shelf is the ONE mutable counter here, and it is
   mutable because it is inventory (units on a shelf), not money — Cinder is
   credited through addGems and never held in this blob.

   🔴 SPEND → RECORD → REFUND-ON-FAILURE, the order craftBatch() uses, for the
   reason it gives: this codebase has already charged a player for a thing
   that never persisted. Every resource drawn for a run is tracked so a failed
   record puts every unit back through refundRes (UNCAPPED — an undo must not
   be eaten by the stash cap).

   ⚠ TWO WINDOWS SHARE THIS SLOT. The hospital lives in the game window and
   the pharmacy counter ticks inside the node-city iframe; both are same-origin
   and both hand the SAME Profile object their blob. So `blob()` refuses a
   cached copy the moment the slot holds a different object than the one it
   cached — the other window persisted — and re-reads. Every write is a
   synchronous read-modify-write on one thread, so this is enough.
   ══════════════════════════════════════════════════════════════════════════ */

import * as PL from '../plague/state.js';
import * as OB from '../plague/outbreak.js';
import * as PH from './pharma.js';

export const V = 1;

export function bridge() { return PL.bridge(); }
export function ready() {
  const B = bridge();
  return !B._null && typeof B.pharmaState === 'function';
}

function emptyBlob() {
  return {
    v: V,
    lines: [],                      // cure lines in the vault (append-only)
    stock: {},                      // pid -> { units, quality, family, lineName }
    sales: [],                      // the city's counter log (append-only, capped)
    runs: [],                       // compounding runs (append-only, capped)
    stats: { made: 0, spoiled: 0, sold: 0, earned: 0, runs: 0 },
    seen: {},                       // shipmentId -> 1, so sweep() is idempotent
  };
}

let CACHE = null;
let CACHE_RAW = null;

export function blob() {
  const B = bridge();
  let raw = null;
  try { raw = typeof B.pharmaState === 'function' ? B.pharmaState() : null; } catch (e) { raw = null; }
  // Fresh while the slot still holds what we last wrote or read. See the
  // header — the city iframe writes the same slot.
  if (CACHE && raw === CACHE_RAW) return CACHE;
  const b = emptyBlob();
  if (raw && typeof raw === 'object') {
    try {
      if (Array.isArray(raw.lines)) b.lines = raw.lines.filter((x) => x && x.id).slice(-80);
      if (raw.stock && typeof raw.stock === 'object') {
        for (const pid of PH.PRODUCT_IDS) {
          const s = raw.stock[pid];
          if (s && (s.units | 0) > 0) b.stock[pid] = { units: s.units | 0, quality: +s.quality || 0, family: s.family || null, lineName: s.lineName || null };
        }
      }
      if (Array.isArray(raw.sales)) b.sales = raw.sales.filter((x) => x && x.at).slice(-200);
      if (Array.isArray(raw.runs)) b.runs = raw.runs.filter((x) => x && x.id).slice(-60);
      if (raw.stats && typeof raw.stats === 'object') b.stats = Object.assign(b.stats, raw.stats);
      if (raw.seen && typeof raw.seen === 'object') b.seen = Object.assign({}, raw.seen);
    } catch (e) {}
  }
  CACHE = b;
  CACHE_RAW = raw;
  return b;
}

export function persist() {
  const B = bridge();
  try {
    const b = blob();
    if (B.setPharmaState(b) === false) return false;
    CACHE_RAW = b;               // the slot now holds our object
    return B.save() !== false;
  } catch (e) { return false; }
}

export function resetCache() { CACHE = null; CACHE_RAW = null; }

/* ══ THE VAULT ═════════════════════════════════════════════════════════════
   sweep() turns every administered crate the ward has not yet booked into a
   cure line. Idempotent by shipment id, so it is safe to call from the
   hospital door, the ward's commit, and the game's settle poll (which is how
   a crate opened by STAFF still reaches the vault). It reads the plague ledger
   and never writes it — /src/hospital is a consumer of /src/plague. */
export function sweep() {
  if (!ready()) return { ok: false, added: 0 };
  const b = blob();
  let added = 0;
  try {
    const st = PL.outbreakState();
    for (const ship of PL.shipments()) {
      if (!ship || ship.status !== 'administered' || b.seen[ship.id]) continue;
      b.seen[ship.id] = 1;
      const line = PH.lineFrom(ship, PL.batchById(ship.batchId), OB.strainById(st, ship.strainId));
      if (!line) continue;
      // Only crates that landed at a lab THIS player owns are theirs to keep.
      if (!ownsOp(ship.labId)) continue;
      b.lines.push(line);
      if (b.lines.length > 80) b.lines.splice(0, b.lines.length - 80);
      added++;
    }
  } catch (e) {}
  if (added) persist();
  return { ok: true, added };
}

function ownsOp(id) {
  try {
    for (const o of (bridge().myOps() || [])) if (o && String(o.id) === String(id)) return true;
  } catch (e) {}
  // No operation rows at all (signed out, fresh profile): the only labs a
  // crate can have gone to are the player's own, so keep it.
  try { return !(bridge().myOps() || []).length; } catch (e) { return true; }
}

export function lines() { return blob().lines.slice().reverse(); }
export function openLines() { return blob().lines.filter((l) => l && l.status === 'open' && (l.samples | 0) > 0).reverse(); }
export function lineById(id) { for (const l of blob().lines) if (l && l.id === id) return l; return null; }

export function discardLine(id) {
  const l = lineById(id);
  if (!l || l.status !== 'open') return false;
  l.status = 'discarded';
  l.discardedAt = Date.now();
  persist();
  return true;
}

/* ══ COMPOUNDING ═══════════════════════════════════════════════════════════
   The one function that turns lab work into shelf stock, and the only place
   in the hospital that spends resources. */
export function compoundRun(lineId, productId, units, craft) {
  const B = bridge();
  if (!ready()) return { ok: false, why: 'no-bridge', error: 'The lab is not connected to the game.' };
  const b = blob();
  const line = lineById(lineId);
  const p = PH.PRODUCTS[productId];
  if (!line || !p) return { ok: false, why: 'bad', error: 'No such line or product.' };
  const can = PH.canMake(p, line);
  if (!can.ok) return { ok: false, why: 'gate', error: can.why };
  const n = Math.max(0, Math.min(units | 0, PH.maxUnits(p, line)));
  if (!n) return { ok: false, why: 'empty', error: 'Set a run size first.' };
  const cost = PH.runCost(p, n);

  const short = {};
  for (const id of Object.keys(cost.res)) {
    const have = B.getRes(id) | 0;
    if (have < cost.res[id]) short[id] = cost.res[id] - have;
  }
  if (Object.keys(short).length) return { ok: false, why: 'short', shortfall: short, error: 'Not enough inputs.' };

  const spent = [];
  try {
    for (const id of Object.keys(cost.res)) {
      if (!B.spendRes(id, cost.res[id])) throw new Error('spend failed: ' + id);
      spent.push([id, cost.res[id]]);
    }
  } catch (e) {
    for (const [id, k] of spent) { try { B.refundRes(id, k); } catch (e2) {} }
    return { ok: false, why: 'spend', error: 'The input draw failed — nothing was taken.' };
  }

  const r = PH.compound(p, line, n, craft);
  const at = Date.now();
  const run = {
    id: 'run_' + at.toString(36) + String(b.runs.length),
    at, lineId: line.id, productId: p.id, asked: n, made: r.made, quality: r.quality,
    spoiled: !!r.spoiled, contaminated: !!r.contaminated, samples: cost.samples, res: cost.res,
  };
  const beforeSamples = line.samples;
  try {
    line.samples = Math.max(0, (line.samples | 0) - cost.samples);
    if (line.samples <= 0) line.status = 'spent';
    if (r.made > 0) PH.addToShelf(b.stock, p.id, r.made, r.quality, line);
    b.runs.push(run);
    if (b.runs.length > 60) b.runs.splice(0, b.runs.length - 60);
    b.stats.runs = (b.stats.runs | 0) + 1;
    b.stats.made = (b.stats.made | 0) + r.made;
    if (r.spoiled) b.stats.spoiled = (b.stats.spoiled | 0) + 1;
    if (!persist()) throw new Error('persist failed');
  } catch (e) {
    // 🔴 The refund path this ordering exists for.
    try {
      line.samples = beforeSamples; if (line.samples > 0) line.status = 'open';
      const i = b.runs.indexOf(run); if (i >= 0) b.runs.splice(i, 1);
      if (r.made > 0 && b.stock[p.id]) { b.stock[p.id].units = Math.max(0, b.stock[p.id].units - r.made); if (!b.stock[p.id].units) delete b.stock[p.id]; }
    } catch (e2) {}
    for (const [id, k] of spent) { try { B.refundRes(id, k); } catch (e2) {} }
    return { ok: false, why: 'persist', error: 'The run would not record — your inputs were returned.' };
  }
  return { ok: true, run, result: r, line, product: p };
}

export function stock() { return blob().stock; }
export function shelfUnits() { return PH.shelfUnits(blob().stock); }
export function runs() { return blob().runs.slice().reverse(); }
export function stats() { return Object.assign({}, blob().stats); }
export function econ() { try { return bridge().opEcon('medical') || null; } catch (e) { return null; } }
export function priceOf(pid) {
  const s = blob().stock[pid];
  return PH.unitPrice(pid, s ? s.quality : 0.5, econ());
}

/* Pull a product off the shelf and destroy it. A recall, not a sale. */
export function recall(pid, units) {
  const b = blob();
  const s = b.stock[pid];
  if (!s) return false;
  const n = Math.max(0, Math.min(units | 0, s.units | 0));
  s.units -= n;
  if (s.units <= 0) delete b.stock[pid];
  persist();
  return n;
}

/* ══ THE COUNTER ═══════════════════════════════════════════════════════════
   Called by the city adapter every economy tick. Sells from the shelf, credits
   Cinder through the bridge (never a balance in this blob), logs one row per
   tick that sold anything. `ctx` is pharma.customersPerMin's shape. */
let ACC = { customers: 0 };
let LAST_LOG = null;

export function counterTick(dtMin, ctx, rng) {
  if (!ready()) return null;
  const b = blob();
  if (!PH.shelfUnits(b.stock)) { ACC.customers = 0; return null; }
  const e = econ();
  const r = PH.sellTick(b.stock, dtMin, ctx, e, ACC, rng);
  if (!r.units) return r;
  for (const pid of Object.keys(b.stock)) if ((b.stock[pid].units | 0) <= 0) delete b.stock[pid];
  b.stats.sold = (b.stats.sold | 0) + r.units;
  b.stats.earned = (b.stats.earned | 0) + r.cinder;
  /* One row per MINUTE of city time rather than per tick, or a busy counter
     writes a row a second and the log is a scroll of ones. */
  const now = Date.now();
  if (LAST_LOG && now - LAST_LOG.at < 60000 && LAST_LOG.cityId === (ctx && ctx.cityId)) {
    for (const pid of Object.keys(r.sold)) LAST_LOG.sold[pid] = (LAST_LOG.sold[pid] | 0) + r.sold[pid];
    LAST_LOG.units += r.units; LAST_LOG.cinder += r.cinder;
  } else {
    LAST_LOG = { at: now, cityId: (ctx && ctx.cityId) || 'city', sold: Object.assign({}, r.sold), units: r.units, cinder: r.cinder };
    b.sales.push(LAST_LOG);
    if (b.sales.length > 200) b.sales.splice(0, b.sales.length - 200);
  }
  try { if (r.cinder > 0) bridge().addGems(r.cinder); } catch (e) {}
  // Persist is throttled by the caller (the city saves on its own cadence);
  // the in-memory blob is already the truth for both windows.
  return r;
}

export function sales() { return blob().sales.slice().reverse(); }

/* Earnings over the last `hours` of wall time, for the front desk. */
export function earnedSince(ms) {
  const cut = Date.now() - Math.max(0, ms | 0);
  let cinder = 0, units = 0;
  for (const s of blob().sales) if (s && s.at >= cut) { cinder += s.cinder | 0; units += s.units | 0; }
  return { cinder, units };
}

/* Does this player hold the licences the building's doors open onto? */
export function ownsType(type) {
  try { return (bridge().myOps() || []).some((o) => o && o.op_type === type && (o.status || 'active') === 'active'); } catch (e) { return false; }
}
