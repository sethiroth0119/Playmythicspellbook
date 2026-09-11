/* ══════════════════════════════════════════════════════════════════════════
   🏪 EQUIPMENT & FIELD SHOP — the host bridge

   Registers `window.MythicFieldShop`. The pricing lives in ./traders.js and is
   pure; everything host-shaped (where the lots are stored, what an item's
   category is, what the Crash Exchange says) is resolved HERE, through values
   index.html hands over — never by reaching for a global.

   🔴 THE GLOBALS TRAP. `Profile`, `Forge` and `getMarketPrice` are top-level
   `const` in index.html and are NOT on window. This module therefore takes a
   host object (`MythicFieldShop.attach({...})`) and holds it. Do not add a
   bare global read here; CLAUDE.md records what that has already cost twice.

   ⚠ TWO INVENTORIES, AND ONLY ONE SERVES ANY GIVEN CALL. sql/059 gives every
     (settlement, trader, item) one SHARED row that the server owns — that is
     what makes "an NPC resells your goods to another player" and
     per-settlement stock true, and the server decides the price and the
     quantity from cx_prices so a client can never name its own. The local
     inventory below is the FALLBACK: offline play, a missing table, a failed
     RPC. The two must never both run for one sale, or a double credit is the
     result — see the sell handler in index.html, which takes the shared answer
     OR the local one and never adds them. `shared` reports which one actually
     served the last call, measured from the outcome rather than from config.
   ══════════════════════════════════════════════════════════════════════════ */
import T from './traders.js';

let HOST = null;

/* Per-trader state: a Cinder float and one lot per item.
   The float is what stops a trader being an infinite Cinder faucet — see the
   header of traders.js. It is seeded once and thereafter only moves by trade. */
function blankTrader(id) {
  return { id, float: 250000, lots: {} };
}

function store() {
  if (!HOST || typeof HOST.getStore !== 'function') return null;
  const s = HOST.getStore();
  if (!s || typeof s !== 'object') return null;
  if (!s.traders || typeof s.traders !== 'object') s.traders = {};
  for (const id of T.TRADER_IDS) {
    if (!s.traders[id] || typeof s.traders[id] !== 'object') s.traders[id] = blankTrader(id);
    const t = s.traders[id];
    if (typeof t.float !== 'number' || !isFinite(t.float)) t.float = blankTrader(id).float;
    if (!t.lots || typeof t.lots !== 'object') t.lots = {};
  }
  return s;
}

function lotOf(traderId, itemId) {
  const s = store(); if (!s) return { stock: 0, costBasis: 0 };
  const t = s.traders[traderId]; if (!t) return { stock: 0, costBasis: 0 };
  const l = t.lots[itemId];
  return { stock: Math.max(0, (l && l.stock) | 0), costBasis: Math.max(0, (l && +l.costBasis) || 0) };
}

function marketPx(itemId) {
  try { return (HOST && HOST.marketPrice) ? (HOST.marketPrice(itemId) || 0) : 0; }
  catch (e) { return 0; }
}
function categoryOf(itemId) {
  try { return (HOST && HOST.categoryOf) ? (HOST.categoryOf(itemId) || '') : ''; }
  catch (e) { return ''; }
}

/** Everything the sell screen needs for one item at one trader. */
function quote(traderId, itemId) {
  const px = marketPx(itemId);
  const cat = categoryOf(itemId);
  const lot = lotOf(traderId, itemId);
  const bid = T.buyQuote(px, lot.stock, traderId, cat);
  const ask = T.sellQuote(lot.costBasis, px, lot.stock, traderId, cat);
  const tier = T.demandTier(lot.stock);
  return {
    traderId, itemId, category: cat, marketPx: px,
    stock: lot.stock, costBasis: lot.costBasis,
    tier, demandLabel: T.DEMAND_LABEL[tier],
    bid, ask, accepted: T.accepts(traderId, cat),
    markupPct: Math.round(T.SHOP.markup * 100),
  };
}

/**
 * Player sells to the trader. Returns {ok, qty, unit, total, reason}.
 * ⚠ THE TRADER'S FLOAT IS CHECKED BEFORE ANYTHING MOVES. A shop that pays out
 *   of an empty till is the faucet this whole design exists to avoid.
 */
function sellToTrader(traderId, itemId, wantQty) {
  const s = store(); if (!s) return { ok: false, reason: 'no_store' };
  const q = quote(traderId, itemId);
  if (!q.accepted) return { ok: false, reason: 'refused' };
  if (q.bid <= 0) return { ok: false, reason: 'no_price' };
  const t = s.traders[traderId];
  const qty = T.affordableQty(t.float, q.bid, wantQty);
  if (qty <= 0) return { ok: false, reason: 'trader_broke', bid: q.bid, float: t.float };
  const total = qty * q.bid;
  const next = T.acquire(lotOf(traderId, itemId), qty, q.bid);
  t.lots[itemId] = { stock: next.stock, costBasis: next.costBasis };
  t.float = Math.max(T.SHOP.floatFloor, t.float - total);
  return { ok: true, qty, unit: q.bid, total, stock: next.stock, costBasis: next.costBasis };
}

/** Player buys from the trader. The float grows by exactly what is paid. */
function buyFromTrader(traderId, itemId, wantQty) {
  const s = store(); if (!s) return { ok: false, reason: 'no_store' };
  const q = quote(traderId, itemId);
  if (q.ask <= 0) return { ok: false, reason: 'no_price' };
  const t = s.traders[traderId];
  const have = lotOf(traderId, itemId);
  const qty = Math.max(0, Math.min(wantQty | 0, have.stock));
  if (qty <= 0) return { ok: false, reason: 'out_of_stock' };
  const total = qty * q.ask;
  const next = T.release(have, qty);
  t.lots[itemId] = { stock: next.stock, costBasis: next.costBasis };
  t.float += total;
  return { ok: true, qty, unit: q.ask, total, stock: next.stock };
}

/** The brief's "check every price update" — run over live stock, on demand. */
function auditAll(itemIds) {
  const bad = [];
  let checked = 0;
  for (const traderId of T.TRADER_IDS) {
    for (const itemId of (itemIds || [])) {
      const cat = categoryOf(itemId);
      if (!T.accepts(traderId, cat)) continue;
      const lot = lotOf(traderId, itemId);
      const r = T.auditRoundTrip(lot.costBasis, marketPx(itemId), lot.stock, traderId, cat);
      checked++;
      if (r.profitable) bad.push({ traderId, itemId, ...r });
    }
  }
  return { checked, offenders: bad, clean: bad.length === 0 };
}

/* ══════════════════════════════════════════════════════════════════════════
   ☁ THE SHARED SHELF (sql/059)

   One row per (settlement, trader, item) that every player reads and only the
   server writes. This is what makes "an NPC resells YOUR goods to ANOTHER
   player" true, and what makes per-settlement stock mean anything.

   ⚠ GUARDED, LIKE EVERY OTHER CLOUD PATH HERE. No sign-in, no tables, a failed
     RPC — any of those and the shop falls back to the LOCAL inventory rather
     than breaking. That is the `Corp.*` pattern and CLAUDE.md's first
     non-negotiable.
   ⚠ THE SERVER'S ANSWER WINS. fs_sell/fs_buy return the qty and the total THEY
     decided, computed from cx_prices and the shared stock. The client never
     sends a price and never assumes its own quote was honoured — a stale
     screen is normal in a shared shop, because someone else may have traded a
     second before you.
   ══════════════════════════════════════════════════════════════════════════ */
let CLOUD = null;                 // set by attachCloud(); null ⇒ local mode

function cloudReady() {
  try { return !!(CLOUD && CLOUD.rpc && CLOUD.ready()); } catch (e) { return false; }
}

/* ⚠ `shared` REFLECTS WHAT ACTUALLY HAPPENED, not what is configured.
   Setting it from "a Supabase client exists" told an offline player their
   trades were on the shared shelf when every RPC was failing and the local
   inventory was quietly serving them. The flag now moves on the OUTCOME of the
   last call, so the panel's footer can never overstate it. */
async function rpc(fn, args) {
  if (!cloudReady()) { API.shared = false; return null; }
  try {
    const r = await CLOUD.rpc(fn, args);
    const d = (r && r.data) || null;
    API.shared = !!d;
    return d;
  } catch (e) { API.shared = false; return null; }
}

/** Where the player is standing. Falls back to a single global shop. */
function settlement() {
  try { return (HOST && HOST.settlementId && HOST.settlementId()) || 'world'; }
  catch (e) { return 'world'; }
}

async function quoteShared(traderId, itemId) {
  const j = await rpc('fs_quote', { p_settlement: settlement(), p_trader: traderId, p_item: itemId });
  if (!j || !j.ok) return null;
  const tier = T.demandTier(j.stock | 0);
  return {
    traderId, itemId, category: j.category, marketPx: +j.marketPx || 0,
    stock: j.stock | 0, costBasis: +j.costBasis || 0,
    tier, demandLabel: T.DEMAND_LABEL[tier],
    bid: j.bid | 0, ask: j.ask | 0, accepted: !!j.accepted,
    markupPct: Math.round(T.SHOP.markup * 100), shared: true, float: j.float | 0,
  };
}

async function sellShared(traderId, itemId, qty) {
  const j = await rpc('fs_sell', { p_settlement: settlement(), p_trader: traderId, p_item: itemId, p_qty: qty | 0 });
  if (!j) return null;
  return j.ok
    ? { ok: true, qty: j.qty | 0, unit: j.unit | 0, total: j.total | 0, stock: j.stock | 0, shared: true }
    : { ok: false, reason: j.error || 'refused', shared: true, bid: j.bid | 0, float: j.float | 0 };
}

/* 🧺 ═══ WHAT THIS TRADER ACTUALLY HAS ON THE SHELF ═══════════════════════
   The missing half of the shared shop. fs_quote answers about ONE item you
   already know the id of, which is everything the SELL side needs and nothing
   the BUY side does — a player browsing a trader has no list to quote against,
   so "an NPC resells your goods to another player" had no screen it could
   happen on.

   🔴 IT IS A SELECT, NOT AN RPC, AND THAT IS DELIBERATE. fieldshop_stock is
      read-only to everyone under RLS (sql/059: no INSERT/UPDATE/DELETE policy
      exists, the SECURITY DEFINER functions are the only writers), so reading
      it directly is exactly as safe as an RPC would be and does not need a
      sixth function to keep in sync with the table it wraps. Writing still
      goes through fs_buy / fs_sell.

   ⚠ EVERY ROW HERE CAME FROM A PLAYER. Nothing seeds fieldshop_stock — the
     only INSERT in the whole migration is inside fs_sell. So this list IS the
     answer to "they only sell what they buy from players": it cannot contain
     anything else, by construction rather than by a filter somebody has to
     remember to apply.

   ⚠ STOCK > 0 ONLY. A row that has been bought out stays at zero rather than
     being deleted (the cost basis is worth keeping), and a shelf showing
     "0 left" for everything a trader ever handled is a worse screen than one
     showing what is there. */
async function shelfShared(traderId, limit) {
  /* ⚠ THROUGH THE SEAM, NOT THE CLIENT. The obvious implementation reaches for
     CLOUD.from('fieldshop_stock') — but the cloud seam this module is handed is
     {ready, rpc} by design (see attachCloud), precisely so the module never
     holds a Supabase client. index.html supplies `shelf`, and a build whose
     host has not been updated simply gets null and falls back to local stock,
     which is the same contract every other cloud path here keeps. */
  if (!cloudReady() || typeof CLOUD.shelf !== 'function') { API.shared = false; return null; }
  try {
    const rows = await CLOUD.shelf(settlement(), traderId || null,
                                   Math.max(1, Math.min(200, limit | 0 || 60)));
    if (!Array.isArray(rows)) { API.shared = false; return null; }
    API.shared = true;
    return rows.map((x) => ({
      itemId: String(x.item_id != null ? x.item_id : x.itemId),
      traderId: String(x.trader_id != null ? x.trader_id : (x.traderId || traderId || '')),
      stock: x.stock | 0,
      costBasis: +(x.cost_basis != null ? x.cost_basis : x.costBasis) || 0,
      at: x.updated_at || x.at || null,
    })).filter((x) => x.itemId && x.stock > 0);
  } catch (e) { API.shared = false; return null; }
}

async function buyShared(traderId, itemId, qty) {
  const j = await rpc('fs_buy', { p_settlement: settlement(), p_trader: traderId, p_item: itemId, p_qty: qty | 0 });
  if (!j) return null;
  return j.ok
    ? { ok: true, qty: j.qty | 0, unit: j.unit | 0, total: j.total | 0, stock: j.stock | 0, shared: true }
    : { ok: false, reason: j.error || 'no_price', shared: true };
}

const API = {
  attach(host) { HOST = host || null; return API; },
  /* The cloud seam, handed over separately so the module never touches the
     Supabase client directly (and so `shared` can flip at runtime when a
     player signs in mid-session). */
  attachCloud(c) { CLOUD = c || null; return API; },
  settlement,
  quoteShared, sellShared, buyShared, shelfShared,
  isShared: cloudReady,
  traders: T.TRADERS, traderIds: T.TRADER_IDS, tuning: T.SHOP,
  quote, sellToTrader, buyFromTrader, auditAll, lotOf,
  demandTier: T.demandTier, demandLabel: T.DEMAND_LABEL,
  /* Honest about what this build is: trader stock is per-player until the
     shared table exists. The UI reads this rather than assuming. */
  shared: false,
  pure: T,
};

try { window.MythicFieldShop = API; } catch (e) {}
export default API;
