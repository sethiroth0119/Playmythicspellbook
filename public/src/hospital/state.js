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
    stats: { made: 0, spoiled: 0, sold: 0, earned: 0, runs: 0, wholesaleUnits: 0, wholesaleCinder: 0 },
    seen: {},                       // shipmentId -> 1, so sweep() is idempotent
    lots: [],                       // lots I listed (escrowed off the shelf)
    orders: [],                     // lots I bought, on the road or landed
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

/* Does this player hold the licences the building's doors open onto? */
export function ownsType(type) {
  try { return (bridge().myOps() || []).some((o) => o && o.op_type === type && (o.status || 'active') === 'active'); } catch (e) { return false; }
}
