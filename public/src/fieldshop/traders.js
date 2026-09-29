/* ══════════════════════════════════════════════════════════════════════════
   🏪 EQUIPMENT & FIELD SHOP — the trader pricing core

   PURE. No DOM, no Profile, no Forge, no globals. Every input is passed in and
   every output is a number or a plain object. That is deliberate: this file
   decides what Cinder changes hands, and the one thing this codebase has
   learned the hard way (the Cinder Forge, the Prince Portfolios buyer queue)
   is that a payout path you cannot drive in a test is a payout path nobody
   checks. `tools/fieldshop-tests/run.mjs` drives every function here directly.

   ── THE LOOP THE BRIEF ASKS FOR ────────────────────────────────────────────
   Crash Exchange price → trader stock → demand → offer → player sells →
   stock up, cost basis re-averaged → +15% markup → another player buys →
   stock down → demand up. That is implemented literally below.

   ── 🔴 THE BRIEF AS WRITTEN PRINTS CINDER, AND THIS IS WHERE IT IS CLOSED ──
   Two rules were specified independently:
       sell price = cost basis × 1.15
       buy offer  = market × demand multiplier
   Nothing tied them together. A trader that stocked up while OVERSTOCKED has
   a cost basis near 0.80 × market, so it lists at 0.92 × market. Players buy
   it down past 50 units, demand flips to HIGH, and the same trader now offers
   1.25 × market for the very item it is selling at 0.92. Buy, sell back,
   repeat — an unbounded Cinder faucet, reachable by ordinary play rather than
   by any exploit.

   `sellQuote()` therefore prices off max(costBasis, buyOffer), never the cost
   basis alone. The spread is then ALWAYS at least the markup, so a same-trader
   round trip loses 1 − 1/1.15 ≈ 13% every single time, at every stock level.
   `auditRoundTrip()` proves it and the test sweeps the whole grid.

   ⚠ CROSS-TRADER ARBITRAGE IS LEFT PROFITABLE ON PURPOSE. Buying cheap from an
     overstocked trader and hauling it to one that is short is the brief's own
     "players become actual traders" goal. It is self-correcting: buying drains
     the cheap trader (raising its price) and selling floods the dear one
     (lowering its offer). What must never be profitable is the trade that
     requires no travel, no time and no risk — the same trader, same instant.

   ⚠ EVERY TRADER HAS A CINDER FLOAT, WHICH THE BRIEF DOES NOT MENTION. An NPC
     that buys player loot with Cinder it does not have is a faucet with a
     friendly face — the exact shape of the buyer queue that had to be deleted
     from Prince Portfolios. A trader here pays out of a float that its own
     sales replenish, so a shop can be drained of money and has to earn it back.
   ══════════════════════════════════════════════════════════════════════════ */

/* ── Tunables. One table, the _opEcon() pattern — no economy number is
      written down anywhere else in this feature. ─────────────────────────── */
export const SHOP = {
  markup: 0.15,              // the brief's 15% gross margin
  stock: { lowMax: 50, normalMax: 100 },
  demand: {
    /* LOW (≤50): scales from +25% at empty to +0% at the threshold. The
       brief's worked example — 32 units → about 1.10× — falls out of this
       (1 + 0.25 × (1 − 32/50) = 1.09), rather than being pinned by a lookup
       table that would only be right for the numbers in the example. */
    lowPremiumMax: 0.25,
    /* OVER (>100): −20% by 145 units, matching the brief's third example, then
       onward at the same slope to a floor. The floor exists so a trader who
       has been dumped on still makes a token offer instead of insulting the
       player with 1 Cinder — refusing outright is `affinity`'s job, not the
       stock curve's. */
    overRefSpan: 45, overRefDrop: 0.20, overFloor: 0.35,
  },
  /* How much a trader cares about a category it does not specialise in. A
     Salvage Trader will still take a medical device off your hands, but at a
     price that sends you looking for the Medic instead — which is the point
     of having more than one shop. `refuse` means the row is not offered. */
  affinity: { primary: 1.00, secondary: 0.82, fringe: 0.55, refuse: 0 },
  floatFloor: 0,             // a trader may not go into Cinder debt
};

/* ── 🏷 THE CATEGORY VOCABULARY ────────────────────────────────────────────
   These are the ONLY strings a trader may specialise in, and the host's
   `categoryOf()` may return nothing else. Both sides are asserted by
   tools/fieldshop-tests/run.mjs.

   🔴 WHY THIS LIST EXISTS AT ALL. The first draft of this file specialised
   traders in 'medicine', 'healing', 'protective', 'damaged'… none of which the
   game can produce. index.html's `_csCategoryOf()` emits exactly five ids
   (consumable / combat / utility / field / grenade), so every trader would
   have refused almost everything — and the test did not catch it, because the
   test invented the same fictional taxonomy the module did. A vocabulary that
   only the feature believes in is the same defect as a shop with no supplier.

   'combat' is deliberately SUBDIVIDED by the host resolver into weapon /
   weaponPart / armor, because a Weapons Trader and an Armor Trader cannot be
   told apart otherwise — that split is the whole reason both exist. */
export const CATEGORIES = [
  'weapon', 'weaponPart', 'armor', 'armorPart',
  'medical', 'consumable', 'field', 'utility', 'grenade', 'relic', 'scrap', 'tool',
];

/* ── The traders. `primary` is what they specialise in, `secondary` what they
      will take at a discount; anything else is refused outright. ─────────── */
export const TRADERS = {
  field: {
    id: 'field', name: 'Field Supply Trader', ico: '🎒',
    primary: ['field', 'consumable', 'utility'],
    secondary: ['medical', 'tool', 'grenade'],
  },
  weapons: {
    id: 'weapons', name: 'Weapons Trader', ico: '🔫',
    primary: ['weapon', 'weaponPart', 'grenade'],
    secondary: ['armor', 'tool', 'scrap'],
  },
  armor: {
    id: 'armor', name: 'Armor Trader', ico: '🛡️',
    primary: ['armor', 'armorPart'],
    secondary: ['weaponPart', 'utility', 'field', 'scrap'],
  },
  medical: {
    id: 'medical', name: 'Medical Trader', ico: '⚕️',
    primary: ['medical'],
    secondary: ['consumable', 'field', 'utility'],
  },
  salvage: {
    id: 'salvage', name: 'Salvage Trader', ico: '🔩',
    /* Relics are PRIMARY here, and the vocabulary guard in the test is why:
       they are the most valuable things a player can find and no trader paid
       top rate for one, so hauling a relic anywhere was pointless. The brief's
       own wording for this trader — 'salvaged items' — is the honest home for
       recovered artifacts. */
    primary: ['scrap', 'weaponPart', 'armorPart', 'tool', 'relic'],
    secondary: ['weapon', 'armor', 'utility'],
  },
  general: {
    id: 'general', name: 'General Equipment Trader', ico: '🏪',
    /* No primary at all, on purpose: the generalist is never the best price
       for anything. It is the shop you use when the right specialist is not in
       this settlement, and that trade-off is the reason to travel. It does,
       however, take EVERYTHING — so nothing a player owns is ever unsellable. */
    primary: [],
    secondary: CATEGORIES.slice(),
  },
};

export const TRADER_IDS = Object.keys(TRADERS);

/* Coerce anything to a finite, non-negative number.
   ⚠ `Number(x) || 0` IS NOT ENOUGH and the test caught it: Infinity is truthy,
     so it survived that idiom and came straight back out of buyQuote() as an
     infinite offer. A price arrives here from a save file, a cloud row and an
     admin field, so "the caller will pass a sane number" is not a thing that
     can be relied on. */
function num(v) {
  const n = Number(v);
  return isFinite(n) && n > 0 ? n : 0;
}

/* 🔴 FLOOR/CEIL WITH AN EPSILON, BECAUSE THE SERVER USES EXACT DECIMALS.
   The same pricing runs twice: here in binary floating point, and in Postgres
   in `numeric`, which is exact. `1000 × 1.0 × 0.82` is 819.9999999999999 in a
   double and exactly 820 as a numeric — so a bare Math.floor() short-changed
   the player by a Cinder on some points while the server paid the round
   figure. Measured over the 16,842-point grid the cross-check sweeps: 210
   Cinder of drift on the bid alone, on prices the player can SEE.

   Nudging by 1e-9 before rounding recovers the values that sit a
   billionth under an integer without changing any value that is genuinely
   below it — the smallest real gap in this pricing is 1, twelve orders of
   magnitude away. .gauntlet/drive-fieldshop-sql.mjs is what keeps the two
   implementations honest; they are equal on every point of that grid now, and
   a divergence in either direction turns it red. */
const EPS = 1e-9;
const floorX = v => Math.floor(v + EPS);
const ceilX  = v => Math.ceil(v - EPS);

/** What this trader thinks of this category: 1.00 / 0.82 / 0 (refuses). */
export function affinityOf(traderId, category) {
  const t = TRADERS[traderId];
  if (!t || !category) return SHOP.affinity.refuse;
  if (t.primary.indexOf(category) >= 0) return SHOP.affinity.primary;
  if (t.secondary.indexOf(category) >= 0) return SHOP.affinity.secondary;
  return SHOP.affinity.refuse;
}

export function accepts(traderId, category) {
  return affinityOf(traderId, category) > 0;
}

/** 'high' | 'normal' | 'over' — the three bands the brief names. */
export function demandTier(stock) {
  const n = Math.max(0, stock | 0);
  if (n <= SHOP.stock.lowMax) return 'high';
  if (n <= SHOP.stock.normalMax) return 'normal';
  return 'over';
}

export const DEMAND_LABEL = {
  high:   'LOW STOCK — HIGH DEMAND',
  normal: 'NORMAL DEMAND',
  over:   'OVERSTOCKED — LOW DEMAND',
};

/** The stock curve. Continuous, so there is no cliff to farm at a boundary. */
export function demandMultiplier(stock) {
  const n = Math.max(0, stock | 0);
  const D = SHOP.demand, S = SHOP.stock;
  if (n <= S.lowMax) {
    return 1 + D.lowPremiumMax * (1 - n / S.lowMax);
  }
  if (n <= S.normalMax) return 1;
  const over = (n - S.normalMax) / D.overRefSpan;
  return Math.max(D.overFloor, 1 - D.overRefDrop * over);
}

/**
 * What the trader offers the player, per unit.
 * `marketPx` is the Crash Exchange reference. Returns 0 when refused.
 */
export function buyQuote(marketPx, stock, traderId, category) {
  const px = num(marketPx);
  const aff = affinityOf(traderId, category);
  if (aff <= 0 || px <= 0) return 0;
  return Math.max(1, floorX(px * demandMultiplier(stock) * aff));
}

/**
 * What a player pays the trader, per unit.
 *
 * 🔴 max(costBasis, buyQuote) — NOT costBasis alone. See the header: pricing
 * off the cost basis by itself lets a trader list an item below what it is
 * simultaneously paying for it, which is a Cinder faucet reachable by normal
 * play. Taking the larger of the two makes the spread at least the markup at
 * every stock level, so the instant round trip is always a loss.
 */
export function sellQuote(costBasis, marketPx, stock, traderId, category) {
  const basis = num(costBasis);
  const bid = buyQuote(marketPx, stock, traderId, category);
  const floor = Math.max(basis, bid);
  if (floor <= 0) return 0;
  return Math.max(1, ceilX(floor * (1 + SHOP.markup)));
}

/**
 * Weighted-average acquisition cost after a purchase from a player.
 * Returns a NEW lot; never mutates the argument.
 */
export function acquire(lot, qty, unitPaid) {
  const n = Math.max(0, qty | 0);
  const have = Math.max(0, (lot && lot.stock) | 0);
  const basis = num(lot && lot.costBasis);
  if (n <= 0) return { stock: have, costBasis: basis };
  const total = basis * have + num(unitPaid) * n;
  const stock = have + n;
  return { stock, costBasis: stock > 0 ? total / stock : 0 };
}

/**
 * Sale to a player. Stock falls; the cost basis of what REMAINS is unchanged,
 * which is what a weighted average means — selling does not re-price the
 * inventory you still hold.
 */
export function release(lot, qty) {
  const n = Math.max(0, qty | 0);
  const have = Math.max(0, (lot && lot.stock) | 0);
  const took = Math.min(n, have);
  return { stock: have - took, costBasis: num(lot && lot.costBasis), sold: took };
}

/**
 * 🔍 THE LOOP CHECK the brief asks to run "against every price update".
 * Buy one unit at the ask, immediately sell it back to the SAME trader at the
 * bid it now shows (stock is one higher after the purchase leaves the shelf —
 * no, one LOWER; the unit is in the player's hands, so the trader's stock is
 * `stock - 1` when it quotes the buy-back). Profit > 0 is a defect.
 */
export function auditRoundTrip(costBasis, marketPx, stock, traderId, category) {
  const ask = sellQuote(costBasis, marketPx, stock, traderId, category);
  if (ask <= 0) return { ask: 0, bid: 0, profit: 0, profitable: false, refused: true };
  const afterStock = Math.max(0, (stock | 0) - 1);
  const bid = buyQuote(marketPx, afterStock, traderId, category);
  const profit = bid - ask;
  return { ask, bid, profit, profitable: profit > 0, refused: false };
}

/** The trader's float after paying a player. Refuses what it cannot afford. */
export function affordableQty(floatCinder, unitOffer, wantQty) {
  const f = num(floatCinder);
  const u = Math.max(1, unitOffer | 0);
  return Math.max(0, Math.min(wantQty | 0, Math.floor(f / u)));
}

export default {
  SHOP, TRADERS, TRADER_IDS, CATEGORIES, DEMAND_LABEL,
  affinityOf, accepts, demandTier, demandMultiplier,
  buyQuote, sellQuote, acquire, release, auditRoundTrip, affordableQty,
};
