/* ============================================================================
   📦 LOT MATHS — the single definition of what "100 wood × 10 lots" means.
   ============================================================================
   THE ASK (verbatim): "when listing up resources on the player market make it
   where players can list lots of 100 — for example 100 wood 10 lots which will
   give the buyer 1000 instead of 100 — and the player has to list up wood 10
   times for 100 pieces of wood."

   So a listing carries TWO numbers, not one:
     lotSize  — units of the resource in ONE lot          (100 wood)
     lots     — how many of those lots are on offer       (× 10)
     units    — lotSize × lots                            (= 1,000 wood)

   🔴 EVERY NUMBER A PLAYER SEES AT THE POINT OF PURCHASE MUST BE THE `units`
      NUMBER, OR MUST NAME ITSELF. "100 wood" and "1,000 wood" differ by a
      factor of ten and a market that lets those two be confused is a market
      that steals. `unitsLabel()` below is the ONLY sanctioned way to write a
      quantity into the exchange UI: it always prints the total AND the lot
      breakdown, never one without the other.

   🔴 NO ECONOMY NUMBER LIVES AT A RENDER SITE. Same rule as _opEcon() and
      terroir.js: the caps and the label grammar live here, once.

   Pure module. Reads no globals, imports nothing. Safe to unit-drive.
   ============================================================================ */

/* Bounds. `lotSize` reuses the exchange's historical per-listing ceiling
   (RES_MARKET_QTY_MAX = 9999) because a legacy single-lot listing IS a lot of
   size `qty`; that keeps old rows inside the new grammar without a rewrite.
   The REAL limit on a listing is escrow — a seller cannot list what they do
   not hold, and the stash cap bounds what they can hold — so these exist only
   to keep a fat-fingered 1e9 out of an integer column. */
export const LOT_SIZE_MAX  = 9999;
export const LOT_COUNT_MAX = 999;
export const LOT_UNITS_MAX = 999999;

/* Quick-pick lot sizes offered in the UI. 100 is first because it is the size
   the ask names. 1 stays available so the exchange keeps doing everything it
   did before lots existed. */
export const LOT_SIZE_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

export function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!isFinite(n)) return lo;
  return n < lo ? lo : (n > hi ? hi : n);
}

/** Total units in `lots` lots of `lotSize`. THE definition. */
export function totalUnits(lotSize, lots) {
  const a = Math.max(0, Math.floor(Number(lotSize) || 0));
  const b = Math.max(0, Math.floor(Number(lots) || 0));
  return a * b;
}

/* Validate a proposed listing shape. Returns { ok, why, lotSize, lots, units }.
   Never throws — callers render `why` straight to the player. */
export function validateLots(lotSize, lots) {
  const a = Math.floor(Number(lotSize));
  const b = Math.floor(Number(lots));
  if (!isFinite(a) || a < 1) return { ok: false, why: 'Lot size must be at least 1.' };
  if (!isFinite(b) || b < 1) return { ok: false, why: 'You must list at least 1 lot.' };
  if (a > LOT_SIZE_MAX)  return { ok: false, why: `Lot size can be at most ${LOT_SIZE_MAX}.` };
  if (b > LOT_COUNT_MAX) return { ok: false, why: `You can list at most ${LOT_COUNT_MAX} lots at once.` };
  const u = a * b;
  if (u > LOT_UNITS_MAX) return { ok: false, why: `That is ${u.toLocaleString()} units — the ceiling is ${LOT_UNITS_MAX.toLocaleString()}.` };
  return { ok: true, why: '', lotSize: a, lots: b, units: u };
}

/* 🧭 READ A ROW — the compatibility seam.
   A row written before lots existed has no lot_size/lots_total/lots_left. It
   is exactly ONE lot of `qty`. Reading it through here means no call site ever
   has to branch on "is this an old row", and no old row can be mistaken for a
   1,000-unit listing because a column came back null.
   `qty` on a lot row is the ORIGINAL total (lotSize × lotsTotal) and is
   deliberately immutable — `lotsLeft` is the only moving part, so a stale
   reader can never inflate a partially-filled listing back to full. */
export function readLots(row) {
  row = row || {};
  const hasLots = row.lot_size != null && row.lots_total != null;
  const qty = Math.max(0, Math.floor(Number(row.qty) || 0));
  if (!hasLots) {
    return { lotSize: qty, lotsTotal: 1, lotsLeft: 1, unitsLeft: qty, unitsTotal: qty, legacy: true };
  }
  const lotSize   = Math.max(0, Math.floor(Number(row.lot_size) || 0));
  const lotsTotal = Math.max(0, Math.floor(Number(row.lots_total) || 0));
  const lotsLeft  = Math.max(0, Math.min(lotsTotal, Math.floor(Number(row.lots_left) || 0)));
  return {
    lotSize, lotsTotal, lotsLeft,
    unitsLeft:  lotSize * lotsLeft,
    unitsTotal: lotSize * lotsTotal,
    legacy: false,
  };
}

/* 🔴 THE ANTI-DECEPTION LABEL.
   Always leads with the TOTAL. The lot breakdown is a suffix, never a
   substitute. A single lot of 1 prints just the number, because "1 × 1 lot" is
   noise — but anything that could be confused prints both halves. */
export function unitsLabel(lotSize, lots, name) {
  const a = Math.max(0, Math.floor(Number(lotSize) || 0));
  const b = Math.max(0, Math.floor(Number(lots) || 0));
  const u = a * b;
  const nm = name ? (' ' + name) : '';
  if (b <= 1) return `${u.toLocaleString()}${nm}`;
  return `${u.toLocaleString()}${nm} (${a.toLocaleString()} × ${b} lots)`;
}

/* Price grammar. `price` on a row is PER LOT — a legacy single-lot row is
   therefore already correct with no migration of the value. */
export function priceForLots(pricePerLot, lots) {
  const p = Math.max(0, Math.floor(Number(pricePerLot) || 0));
  const b = Math.max(0, Math.floor(Number(lots) || 0));
  return p * b;
}

/* How many lots can this buyer actually take? The smaller of what is left,
   what they can pay for, and what fits in their stash. Returns 0 when the
   answer is none — callers must NOT round that up to 1. */
export function affordableLots({ lotsLeft, pricePerLot, purse, lotSize, stashFree, wantPerLot, wantHave }) {
  let n = Math.max(0, Math.floor(Number(lotsLeft) || 0));
  const p = Math.max(0, Math.floor(Number(pricePerLot) || 0));
  if (p > 0) n = Math.min(n, Math.floor(Math.max(0, Number(purse) || 0) / p));
  const w = Math.max(0, Math.floor(Number(wantPerLot) || 0));
  if (w > 0) n = Math.min(n, Math.floor(Math.max(0, Number(wantHave) || 0) / w));
  const ls = Math.max(1, Math.floor(Number(lotSize) || 1));
  if (stashFree != null) {
    // Trading goods AWAY frees space before the incoming goods land, so the
    // headroom for a swap is bigger than the raw free space. settle() does the
    // real arithmetic; this is the UI's honest upper bound.
    const perLotNet = ls - w;
    if (perLotNet > 0) n = Math.min(n, Math.floor(Math.max(0, Number(stashFree) || 0) / perLotNet));
  }
  return Math.max(0, n);
}

export default { LOT_SIZE_MAX, LOT_COUNT_MAX, LOT_UNITS_MAX, LOT_SIZE_PRESETS, totalUnits, validateLots, readLots, unitsLabel, priceForLots, affordableLots, clampInt };
