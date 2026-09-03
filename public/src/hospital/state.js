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
import * as LG from '../plague/logistics.js';
import * as PH from './pharma.js';
import * as PT from './patients.js';
import * as BD from './beds.js';

/* Corp operations have uuid ids; personal ones ('local_…', 'company_…') do
   not, and a payout addressed to a personal op is unclaimable (see
   settleWaybill in /src/plague/state.js). Listing is refused for those. */
const IS_UUID = /^[0-9a-fA-F-]{36}$/;

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
    stats: { made: 0, spoiled: 0, sold: 0, earned: 0, runs: 0, wholesaleUnits: 0, wholesaleCinder: 0, treated: 0, turnedAway: 0, fees: 0, bandagesMade: 0 },
    seen: {},                       // shipmentId -> 1, so sweep() is idempotent
    lots: [],                       // lots I listed (escrowed off the shelf)
    orders: [],                     // lots I bought, on the road or landed
    beds: [],                       // placed beds: { slot, itemId, name, url, at }
    patients: [],                   // in the building: waiting, in a bed, treating
    recent: [],                     // discharged and walked-out, capped
    bandages: 0,                    // dressings on the supply shelf
    ptAcc: 0, ptLast: 0, ptSeq: 0,  // the walk-in accumulator
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
      if (Array.isArray(raw.lots)) b.lots = raw.lots.filter((x) => x && x.id).slice(-60);
      if (Array.isArray(raw.orders)) b.orders = raw.orders.filter((x) => x && x.id).slice(-60);
      if (Array.isArray(raw.beds)) b.beds = raw.beds.filter((x) => x && BD.slotAt(x.slot)).slice(0, BD.SLOTS.length);
      if (Array.isArray(raw.patients)) b.patients = raw.patients.filter((x) => x && x.id).slice(-40);
      if (Array.isArray(raw.recent)) b.recent = raw.recent.filter((x) => x && x.id).slice(-40);
      b.bandages = Math.max(0, raw.bandages | 0);
      b.ptAcc = +raw.ptAcc || 0; b.ptLast = +raw.ptLast || 0; b.ptSeq = raw.ptSeq | 0;
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

/* ══ WHOLESALE — the Loading Dock ══════════════════════════════════════════
   Shelf stock sold to ANOTHER player's hospital, hauled by a player-owned
   Transportation Company. The lot row lives in Supabase (sql/039); the units
   live on each player's shelf. Every call here is guarded and the whole dock
   degrades to "the board is offline" — listing refuses rather than escrowing
   units into a row that never existed.

   🔴 ESCROW FIRST, PUBLISH SECOND, UN-ESCROW ON FAILURE. The units leave the
   shelf the moment the seller lists, so the city counter cannot sell them out
   from under a buyer; if the insert fails they come straight back. */

export function myMedicalOp() {
  try { return (bridge().myOps() || []).find((o) => o && o.op_type === 'medical' && (o.status || 'active') === 'active') || null; } catch (e) { return null; }
}
export function online() { const B = bridge(); try { return !!(B.signedIn() && B.client()); } catch (e) { return false; } }

export function lots() { return blob().lots.slice().reverse(); }
export function orders() { return blob().orders.slice().reverse(); }
export function lotById(id) { for (const l of blob().lots) if (l && l.id === id) return l; return null; }

export async function listLot(pid, units, askPerUnit) {
  const B = bridge();
  if (!ready()) return { ok: false, error: 'The dock is not connected to the game.' };
  if (!online()) return { ok: false, error: 'The wholesale board needs you signed in.' };
  const op = myMedicalOp();
  if (!op) return { ok: false, error: 'No Medical Corporation licence to sell from.' };
  if (!IS_UUID.test(String(op.id))) return { ok: false, error: 'Wholesale needs a CORP-funded Medical Corporation — a personally-funded one cannot be paid through the ledger.' };
  const b = blob();
  const s = b.stock[pid];
  const n = Math.max(0, Math.min(units | 0, s ? s.units | 0 : 0));
  if (!PH.PRODUCTS[pid] || !n) return { ok: false, error: 'Nothing of that on the shelf.' };
  const ask = Math.max(0, Math.round(+askPerUnit || 0));
  if (!ask) return { ok: false, error: 'Set an asking price.' };

  // escrow
  const quality = +s.quality || 0;
  s.units -= n; if (s.units <= 0) delete b.stock[pid];
  const lot = { id: 'lot_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), productId: pid, units: n, quality, ask, status: 'listed', at: Date.now(), opId: String(op.id) };
  b.lots.push(lot); if (b.lots.length > 60) b.lots.splice(0, b.lots.length - 60);
  persist();

  try {
    const r = await B.client().from('pharma_lots').insert({
      id: lot.id, seller_id: B.userId(), seller_name: B.displayName(), seller_op_id: lot.opId,
      product: pid, units: n, quality, ask, status: 'listed',
    });
    if (r && r.error) throw new Error(r.error.message || 'insert failed');
  } catch (e) {
    // un-escrow: the offer never existed
    PH.addToShelf(blob().stock, pid, n, quality, null);
    const i = blob().lots.indexOf(lot); if (i >= 0) blob().lots.splice(i, 1);
    persist();
    return { ok: false, error: 'The board would not take the listing (' + String((e && e.message) || e).slice(0, 80) + ') — your units are back on the shelf.' };
  }
  return { ok: true, lot };
}

export async function withdrawLot(id) {
  const B = bridge();
  const lot = lotById(id);
  if (!lot || lot.status !== 'listed') return { ok: false, error: 'That lot is not listed.' };
  if (!online()) return { ok: false, error: 'Withdrawing needs you signed in.' };
  try {
    const r = await B.client().from('pharma_lots').update({ status: 'withdrawn' }).eq('id', id).eq('status', 'listed').select('id');
    if (r && r.error) throw new Error(r.error.message);
    if (!r || !Array.isArray(r.data) || !r.data.length) {
      // Already sold under us — reconcile instead of un-escrowing sold goods.
      await pollWholesale();
      return { ok: false, error: 'That lot was already bought. It is on its way to the buyer.' };
    }
  } catch (e) { return { ok: false, error: 'Withdraw failed: ' + String((e && e.message) || e).slice(0, 80) }; }
  lot.status = 'withdrawn'; lot.withdrawnAt = Date.now();
  PH.addToShelf(blob().stock, lot.productId, lot.units, lot.quality, null);
  persist();
  return { ok: true, lot };
}

/* Other players' listed lots. Empty when offline or the table is absent. */
export async function fetchBoard() {
  const B = bridge();
  if (!online()) return { ok: false, online: false, rows: [] };
  try {
    const uid = B.userId();
    const r = await B.client().from('pharma_lots')
      .select('id, seller_id, seller_name, seller_op_id, product, units, quality, ask, created_at')
      .eq('status', 'listed').order('created_at', { ascending: false }).limit(60);
    if (r && r.error) throw new Error(r.error.message);
    return { ok: true, online: true, rows: (r.data || []).filter((x) => x && x.seller_id !== uid && PH.PRODUCTS[x.product]) };
  } catch (e) { return { ok: false, online: true, rows: [], error: String((e && e.message) || e) }; }
}

/* The haul quote for a lot: the carrier's own econ row, units as "doses",
   quality as the stability the cold chain works against. */
export function quoteLot(row, carrier, coldPack) {
  return LG.quote(carrier, { econ: bridge().opEcon('transport') || {}, doses: row.units | 0, distance: carrier && carrier.mine ? 1 : 2, stability: Math.round((+row.quality || 0) * 100), coldPack: !!coldPack });
}

export async function buyLot(row, carrier, coldPack) {
  const B = bridge();
  if (!ready()) return { ok: false, error: 'The dock is not connected to the game.' };
  if (!online()) return { ok: false, error: 'Buying needs you signed in.' };
  const op = myMedicalOp();
  if (!op) return { ok: false, error: 'No Medical Corporation to deliver to.' };
  if (!row || !carrier || !carrier.id) return { ok: false, error: 'Pick a lot and a carrier.' };
  if (row.seller_id === B.userId()) return { ok: false, error: 'That is your own lot.' };
  const q = quoteLot(row, carrier, coldPack);
  const goods = Math.round((row.units | 0) * Math.max(0, +row.ask || 0));
  const total = goods + q.fee;
  if (total > (B.gems() | 0)) return { ok: false, error: 'Not enough Cinder (' + total.toLocaleString() + ' 🔥 needed: ' + goods.toLocaleString() + ' goods + ' + q.fee.toLocaleString() + ' haul).' };
  if (!B.spendGems(total)) return { ok: false, error: 'The payment did not go through.' };

  const arrivesAt = Date.now() + q.etaMs;
  try {
    const r = await B.client().from('pharma_lots').update({
      status: 'sold', buyer_id: B.userId(), buyer_name: B.displayName(), buyer_op_id: String(op.id),
      carrier_op_id: String(carrier.id), carrier_corp_id: carrier.corpId || null, carrier_name: carrier.name,
      fee: q.fee, integrity: q.integrity, arrives_at: new Date(arrivesAt).toISOString(), sold_at: new Date().toISOString(),
    }).eq('id', row.id).eq('status', 'listed').select('id');
    if (r && r.error) throw new Error(r.error.message);
    if (!r || !Array.isArray(r.data) || !r.data.length) throw new Error('gone');
  } catch (e) {
    try { B.addGems(total); } catch (e2) {}
    return { ok: false, error: String((e && e.message) || e) === 'gone' ? 'Somebody bought that lot first. Your Cinder was returned.' : 'The purchase failed — your Cinder was returned.' };
  }

  /* 🔴 A PLAYER NEVER PAYS THEMSELVES for the haul (settleWaybill's rule):
     a self-owned carrier gets no payout row — the fee was their own crew's
     wages. The seller is always somebody else here (checked above). */
  const mineIds = {}; try { for (const o of (B.myOps() || [])) if (o && o.id != null) mineIds[String(o.id)] = 1; } catch (e) {}
  const order = { id: row.id, productId: row.product, units: row.units | 0, quality: +row.quality || 0, ask: +row.ask || 0, goods, fee: q.fee,
    sellerName: row.seller_name || 'Survivor', sellerOpId: row.seller_op_id, carrierId: String(carrier.id), carrierCorpId: carrier.corpId || null, carrierName: carrier.name,
    selfCarrier: !!mineIds[String(carrier.id)], integrity: q.integrity, arrivesAt, at: Date.now(), status: 'in_transit' };
  const b = blob();
  b.orders.push(order); if (b.orders.length > 60) b.orders.splice(0, b.orders.length - 60);
  persist();
  // The seller is paid for the goods NOW — the sale is done; the haul is the buyer's risk.
  try {
    await B.client().from('cure_payouts').insert([{ shipment_id: row.id, op_id: String(row.seller_op_id), corp_id: null, role: 'wholesale', amount: goods, rating_delta: 0, payer_id: B.userId(), payer_name: B.displayName() }]);
  } catch (e) {}
  return { ok: true, order, quote: q };
}

/* The sweep the settle poll and the dock both run: land my orders that are
   due, and notice my lots that sold. Idempotent. */
export async function pollWholesale() {
  const B = bridge();
  if (!ready()) return { ok: false, landed: 0, sold: 0 };
  const b = blob();
  let landed = 0, sold = 0;
  const now = Date.now();
  for (const o of b.orders) {
    if (!o || o.status !== 'in_transit' || (o.arrivesAt || 0) > now) continue;
    const a = PH.wholesaleArrive({ id: o.id, units: o.units, quality: o.quality }, o.integrity, o.id);
    o.status = 'received'; o.receivedAt = now; o.unitsArrived = a.units; o.qualityArrived = a.quality; o.note = a.note;
    if (a.units > 0) PH.addToShelf(b.stock, o.productId, a.units, a.quality, { strainName: 'wholesale from ' + o.sellerName });
    b.stats.wholesaleUnits = (b.stats.wholesaleUnits | 0) + a.units;
    landed++;
    try { B.toast('🚚 ' + a.units + ' × ' + PH.PRODUCTS[o.productId].name + ' landed from ' + o.sellerName + '. ' + a.note, 6000); } catch (e) {}
    if (online()) {
      try { await B.client().from('pharma_lots').update({ status: 'received', received_at: new Date(now).toISOString() }).eq('id', o.id); } catch (e) {}
      if (!o.selfCarrier) {
        try {
          await B.client().from('cure_payouts').insert([{ shipment_id: o.id, op_id: o.carrierId, corp_id: o.carrierCorpId, role: 'carrier', amount: o.fee, rating_delta: a.integrity > 0.8 ? 1 : a.integrity > 0.6 ? 0 : -1, payer_id: B.userId(), payer_name: B.displayName() }]);
        } catch (e) {}
      }
    }
  }
  if (online()) {
    const listed = b.lots.filter((l) => l && l.status === 'listed');
    if (listed.length) {
      try {
        const r = await B.client().from('pharma_lots').select('id, status, buyer_name, sold_at').in('id', listed.map((l) => l.id)).in('status', ['sold', 'received']);
        for (const row of ((r && r.data) || [])) {
          const l = lotById(row.id); if (!l || l.status !== 'listed') continue;
          l.status = 'sold'; l.buyerName = row.buyer_name || 'Survivor'; l.soldAt = row.sold_at ? Date.parse(row.sold_at) : now;
          b.stats.wholesaleCinder = (b.stats.wholesaleCinder | 0) + l.units * l.ask;
          sold++;
          try { B.toast('💰 ' + l.buyerName + ' bought your ' + l.units + ' × ' + PH.PRODUCTS[l.productId].name + ' — ' + (l.units * l.ask).toLocaleString() + ' 🔥 is in the ledger to claim.', 6000); } catch (e) {}
        }
      } catch (e) {}
    }
  }
  if (landed || sold) persist();
  return { ok: true, landed, sold };
}

/* ══ BEDS — bought through the decoration market, placed in the bay ═══════
   The catalogue, the inventory and the spend are the GAME's (furniture_catalog,
   Profile.furnitureOwned, _csBuyFurniture), reached through three bridge
   accessors. This file only decides which owned bed stands in which slot. */

export async function bedCatalogue() {
  const B = bridge();
  let rows = [];
  try { if (typeof B.furnitureCatalog === 'function') rows = (await B.furnitureCatalog()) || []; } catch (e) { rows = []; }
  const out = BD.bedRows(rows).map((r) => ({ id: String(r.id).replace(/^fc_/, ''), name: r.name || 'Bed', ico: r.ico || '🛏', url: r.url || '', price: r.price | 0, currency: r.currency || 'cinder', blurb: r.details || '', builtin: false }));
  return [Object.assign({ price: BD.cotPrice(econ()), currency: 'cinder', url: '' }, BD.COT)].concat(out);
}
export function ownedBeds() {
  const B = bridge();
  let owned = {};
  try { if (typeof B.furnitureOwned === 'function') owned = B.furnitureOwned() || {}; } catch (e) { owned = {}; }
  return owned;
}
function adjustOwned(id, delta) {
  const B = bridge();
  try { return typeof B.adjustOwned === 'function' ? !!B.adjustOwned(id, delta) : false; } catch (e) { return false; }
}

export function buyBed(item) {
  const B = bridge();
  if (!ready()) return { ok: false, error: 'The market is not connected to the game.' };
  if (!item) return { ok: false, error: 'Pick a bed.' };
  if (item.id === 'cot') {
    const price = BD.cotPrice(econ());
    if (!price) return { ok: false, error: 'The cot has no price without the operation\'s econ row.' };
    if (price > (B.gems() | 0)) return { ok: false, error: 'A ward cot is ' + price.toLocaleString() + ' 🔥 — not enough Cinder.' };
    if (!B.spendGems(price)) return { ok: false, error: 'The payment did not go through.' };
    if (!adjustOwned('cot', 1)) { try { B.addGems(price); } catch (e) {} return { ok: false, error: 'The cot would not record — your Cinder was returned.' }; }
    return { ok: true, item, price };
  }
  // A catalogue bed goes through the game's own furniture purchase, which
  // taxes the spend and records it in Profile.furnitureOwned like any other.
  let ok = false;
  try { ok = typeof B.buyFurniture === 'function' ? !!B.buyFurniture(item) : false; } catch (e) { ok = false; }
  return ok ? { ok: true, item, price: item.price | 0 } : { ok: false, error: 'The purchase did not go through.' };
}

export function beds() { return blob().beds.slice(); }
export function placeBed(item, slot) {
  const b = blob();
  const s = BD.slotAt(slot);
  if (!item || !s) return { ok: false, error: 'No such slot.' };
  if (BD.bedAt(b.beds, s.index)) return { ok: false, error: 'That slot already has a bed.' };
  if ((ownedBeds()[item.id] | 0) <= 0) return { ok: false, error: 'You do not own one of those. Buy it first.' };
  if (!adjustOwned(item.id, -1)) return { ok: false, error: 'The inventory would not release it.' };
  const bed = { slot: s.index, itemId: item.id, name: item.name || 'Bed', url: item.url || '', at: Date.now() };
  b.beds.push(bed);
  if (!persist()) { const i = b.beds.indexOf(bed); if (i >= 0) b.beds.splice(i, 1); adjustOwned(item.id, 1); return { ok: false, error: 'The bed would not record — it is back in your inventory.' }; }
  return { ok: true, bed };
}
export function pickUpBed(slot) {
  const b = blob();
  const bed = BD.bedAt(b.beds, slot);
  if (!bed) return { ok: false, error: 'No bed there.' };
  if (b.patients.some((p) => p && (p.status === 'inbed' || p.status === 'treating') && (p.bedSlot | 0) === (slot | 0))) return { ok: false, error: 'Somebody is in that bed.' };
  const i = b.beds.indexOf(bed); b.beds.splice(i, 1);
  if (!adjustOwned(bed.itemId, 1)) { b.beds.splice(i, 0, bed); return { ok: false, error: 'The inventory would not take it back.' }; }
  persist();
  return { ok: true, bed };
}

/* ══ BANDAGES ══════════════════════════════════════════════════════════════ */
export function bandages() { return blob().bandages | 0; }
export function craftBandages(batches) {
  const B = bridge();
  if (!ready()) return { ok: false, error: 'The bench is not connected to the game.' };
  const cost = PT.bandageCost(batches);
  if (!cost.batches) return { ok: false, error: 'Set a batch count.' };
  const short = {};
  for (const id of Object.keys(cost.res)) if ((B.getRes(id) | 0) < cost.res[id]) short[id] = cost.res[id] - (B.getRes(id) | 0);
  if (Object.keys(short).length) return { ok: false, why: 'short', shortfall: short, error: 'Not enough cloth and water.' };
  const spent = [];
  try { for (const id of Object.keys(cost.res)) { if (!B.spendRes(id, cost.res[id])) throw new Error(id); spent.push([id, cost.res[id]]); } }
  catch (e) { for (const [id, n] of spent) { try { B.refundRes(id, n); } catch (e2) {} } return { ok: false, error: 'The draw failed — nothing was taken.' }; }
  const b = blob();
  b.bandages = (b.bandages | 0) + cost.made;
  b.stats.bandagesMade = (b.stats.bandagesMade | 0) + cost.made;
  if (!persist()) { b.bandages -= cost.made; for (const [id, n] of spent) { try { B.refundRes(id, n); } catch (e2) {} } return { ok: false, error: 'The batch would not record — your cloth and water were returned.' }; }
  return { ok: true, made: cost.made, bandages: b.bandages };
}

/* ══ PATIENTS ══════════════════════════════════════════════════════════════
   patientsTick() is the walk-in clock: it runs every second the building is
   open and once, capped, on the way in, so a night away fills the lobby
   rather than the street. Everything is timestamp-driven so a doubled tick
   advances nobody twice. */
export function patients() { return blob().patients.filter((p) => p && p.status !== 'left' && p.status !== 'done'); }
export function recentPatients() { return blob().recent.slice().reverse(); }
export function waiting() { return patients().filter((p) => p.status === 'waiting'); }
export function inBeds() { return patients().filter((p) => p.status === 'inbed' || p.status === 'treating'); }

export function patientsTick(ctx) {
  if (!ready()) return { events: [] };
  const b = blob();
  const c = ctx || {};
  const now = +c.now || Date.now();
  const events = [];
  let changed = false;

  // ── arrivals
  const last = b.ptLast || now;
  const elapsedMin = Math.max(0, Math.min(36 * 60, (now - last) / 60000));
  b.ptLast = now;
  const catchUp = elapsedMin > 5;
  b.ptAcc = (+b.ptAcc || 0) + PT.arrivalsPerMin(c) * elapsedMin;
  const cap = PT.lobbyCap(b.beds.length);
  let made = 0;
  while (b.ptAcc >= 1) {
    b.ptAcc -= 1;
    if (patients().length >= cap) { b.ptAcc = Math.min(b.ptAcc, 0.99); break; }
    if (catchUp && made >= PT.TUNING.OFFLINE_ARRIVALS_MAX) { b.ptAcc = 0; break; }
    b.ptSeq = (b.ptSeq | 0) + 1;
    const cases = Math.max(0, c.cases | 0);
    const sickShare = cases > 0 ? Math.min(0.85, 0.25 + cases * 0.04) : 0.1;
    const p = PT.makePatient(String(b.ptSeq) + ':' + now, { now, models: Math.max(1, c.models | 0), sickShare, roster: c.roster || [], strain: c.strain || null });
    b.patients.push(p);
    events.push({ kind: 'arrive', patient: p });
    made++; changed = true;
  }

  // ── patience, and treatments completing
  for (const p of b.patients) {
    if (!p) continue;
    if (p.status === 'waiting' && PT.patienceLeft(p, now) <= 0) {
      p.status = 'left'; p.leftAt = now;
      b.stats.turnedAway = (b.stats.turnedAway | 0) + 1;
      events.push({ kind: 'left', patient: p }); changed = true;
    } else if (p.status === 'treating' && (p.doneAt || 0) <= now) {
      p.status = 'done'; p.dischargedAt = now;
      const fee = p.fee | 0;
      if (fee > 0) { try { bridge().addGems(fee); } catch (e) {} }
      b.stats.treated = (b.stats.treated | 0) + 1;
      b.stats.fees = (b.stats.fees | 0) + fee;
      events.push({ kind: 'done', patient: p, fee }); changed = true;
    }
  }
  // Walked-out and discharged patients move to the recent log (the scene
  // still animates them to the door off `recent` for a moment).
  const gone = b.patients.filter((p) => p && (p.status === 'left' || p.status === 'done'));
  if (gone.length) {
    b.patients = b.patients.filter((p) => p && p.status !== 'left' && p.status !== 'done');
    for (const p of gone) b.recent.push(p);
    if (b.recent.length > 40) b.recent.splice(0, b.recent.length - 40);
  }
  if (changed || elapsedMin > 0.5) persist();
  return { events, arrived: made };
}

export function admit(patientId, slot) {
  const b = blob();
  const p = b.patients.find((x) => x && x.id === patientId);
  if (!p || p.status !== 'waiting') return { ok: false, error: 'That patient is not waiting.' };
  if (!BD.bedAt(b.beds, slot)) return { ok: false, error: 'There is no bed in that slot.' };
  if (b.patients.some((q) => q && q !== p && (q.status === 'inbed' || q.status === 'treating') && (q.bedSlot | 0) === (slot | 0))) return { ok: false, error: 'That bed is taken.' };
  p.bedSlot = slot | 0; p.status = 'inbed'; p.admittedAt = Date.now();
  persist();
  return { ok: true, patient: p };
}

/* Treat a patient in a bed. Wounds take bandages; sickness takes one shelf
   unit of a relief product (the family match first), or two raw Medicine.
   The fee is fixed HERE, from the econ row and the quality of what went in,
   and paid when the treatment completes. */
export function treat(patientId) {
  const B = bridge();
  const b = blob();
  const p = b.patients.find((x) => x && x.id === patientId);
  if (!p || p.status !== 'inbed') return { ok: false, error: 'That patient is not in a bed.' };
  const need = PT.needsOf(p);
  let quality = 0.5, used = '';
  if (need.kind === 'bandages') {
    if ((b.bandages | 0) < need.bandages) return { ok: false, error: 'Needs ' + need.bandages + ' bandage' + (need.bandages === 1 ? '' : 's') + '; the shelf has ' + (b.bandages | 0) + '. Roll more at the Supply Bench.' };
    b.bandages -= need.bandages; quality = 0.6; used = need.bandages + ' bandage' + (need.bandages === 1 ? '' : 's');
  } else {
    const pid = PT.reliefProduct(p, b.stock);
    if (pid) {
      const s = b.stock[pid];
      quality = +s.quality || 0.5; s.units -= 1; if (s.units <= 0) delete b.stock[pid];
      used = '1 × ' + PH.PRODUCTS[pid].name;
    } else if ((B.getRes('medicine') | 0) >= need.medicine) {
      if (!B.spendRes('medicine', need.medicine)) return { ok: false, error: 'The medicine draw failed.' };
      quality = 0.4; used = need.medicine + ' raw Medicine';
    } else {
      return { ok: false, error: 'Nothing to treat a sickness with — compound antivirals, serum or vaccine, or hold ' + need.medicine + ' Medicine.' };
    }
  }
  const now = Date.now();
  p.status = 'treating'; p.treatedAt = now; p.doneAt = now + PT.treatmentMs(p, quality);
  p.quality = quality; p.fee = PT.feeOf(p, econ(), quality); p.used = used;
  persist();
  return { ok: true, patient: p, used, ms: p.doneAt - now };
}

export function sendAway(patientId) {
  const b = blob();
  const p = b.patients.find((x) => x && x.id === patientId);
  if (!p || p.status === 'treating') return { ok: false, error: 'Not while they are being treated.' };
  p.status = 'left'; p.leftAt = Date.now();
  b.stats.turnedAway = (b.stats.turnedAway | 0) + 1;
  b.patients = b.patients.filter((x) => x !== p); b.recent.push(p);
  persist();
  return { ok: true };
}

/* Does this player hold the licences the building's doors open onto? */
export function ownsType(type) {
  try { return (bridge().myOps() || []).some((o) => o && o.op_type === type && (o.status || 'active') === 'active'); } catch (e) { return false; }
}
