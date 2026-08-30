/* ════════════════════════════════════════════════════════════════════════════
   💰 THE FOUNDRY — taps, supply contracts, disposal.
   ----------------------------------------------------------------------------
   🔴 THIS FILE IS THE ONLY DOOR BETWEEN THE FOUNDRY AND THE REAL ECONOMY.
   Everything else in /src/foundry moves numbers inside `st.inv`, which is the
   player's private process inventory and touches nothing the rest of the game
   can see. Cinder, Metal and Fuel change hands HERE and nowhere else. Keeping
   that boundary in one file is what makes "what can the Foundry do to my
   account?" a question with a short, checkable answer.

   Three directions:
     IN    — supply contracts. Cinder buys feedstock (waste, crude, coal, flux).
     OUT   — taps. Steel/sheet/aluminium/copper pay Metal; the five fuels pay Fuel.
     COST  — disposal. Slag and hazardous waste occupy the yard and cost Cinder
             to haul. They are the reason a Foundry is not free money.

   ⚠ ECONOMY NUMBERS. CLAUDE.md: "All operation pricing goes through _opEcon().
   Never hardcode economy numbers." There is no _opEcon() path for PRODUCTION yet
   — src/city/production.data.js carries the same caveat and the same literals
   for the same reason. So every number below is routed through `h.econ()`, which
   reads an admin override off the Forge before falling back to the literal. When
   a production econ path lands, econ() is the one place to repoint.
   ════════════════════════════════════════════════════════════════════════════ */

import { matById, matName, TAPS, tapFor } from './recipes.js';
import { stockOf, takeStock, mergeStock, storageCap, storageUsed } from './state.js';

/* 📦 SUPPLY CONTRACTS — Cinder per unit of feedstock.
   Priced so the crush line is a MARGIN, not a fountain: residential waste is
   nearly free and yields badly; industrial waste costs real money and is the
   only stream with a good iron fraction. A player who buys the cheap bales and
   skips the sorter loses money, and that is the intended lesson. */
export const FEED_PRICES = {
  residentialWaste: 4,
  commercialWaste: 7,
  industrialWaste: 15,
  electronicWaste: 24,
  organicWaste: 3,
  crudeOil: 30,
  coal: 11,
  limestone: 8,
};

/* 🔴 CALIBRATED AGAINST THE REAL TRADER PRICES, NOT BY FEEL.
   index.html's TRADER_DEFAULTS price the live ledger: metal 90, fuel 110,
   supplies 80, scrapMetal 50 (see _trMakeLine, ~line 76586). The first pass at
   these numbers (14/26/58/95/11/120/45/32) made a maxed, well-run 24h line
   consume ~535,000 Cinder to produce ~225,000 Cinder of resources — the Foundry
   was a money incinerator that punished you for building it well, and no amount
   of skilful play could dig out, because the loss scaled with throughput.
   These are set so a clean, sorted, high-trim line turns roughly 1 Cinder of
   feedstock into ~2 of resource value, while running dirty for tonnage lands
   near break-even. That gap IS the reward for playing well.
   ⚠ Re-measure against the trader table after ANY change to tap rates, recipe
   yields, or the purity curve — all four multiply together, and eyeballing one
   in isolation is how the first pass went wrong. */

/* Minimum contract size. Buying one unit at a time turns a supply decision into
   a clicking exercise, and it makes the "can I afford to run for an hour?"
   question — which is the interesting one — impossible to feel. */
export const CONTRACT_SIZES = [50, 250, 1000];

/* Fraction of the yard suppliers will never fill — see the deadlock note in
   buyFeed(). 15% of a starting 400-unit yard is 60 units of working room, which
   comfortably clears the largest single batch in RECIPES. */
export const FEED_HEADROOM = 0.15;

/* 🗑 DISPOSAL. Slag and hazardous waste have no tap and no recipe: they are
   PURE LIABILITY, and deliberately so. They count against the yard ceiling, so
   left alone they will eventually halt the whole line with STORAGE_FULL. This
   is the one place the Foundry takes Cinder back off a player for nothing but
   the privilege of continuing, which is what stops a fully-built yard from
   being an unattended money printer.

   ⚠ Do NOT "fix" this by giving slag a recipe that pays. The dead end is the
   pressure. If it should ever become an input (slag → aggregate is the obvious
   one), it must cost more to process than to haul, or the liability evaporates. */
export const DISPOSAL_IDS = ['slag', 'hazardousWaste'];
export const DISPOSAL_PRICES = { slag: 6, hazardousWaste: 40 };

/* Admin-overridable read. Falls back to the literal when no override is set and
   when the bridge is an older build without econ() at all. */
function econ(h, key, fallback) {
  try {
    const v = h && h.econ ? h.econ(key) : undefined;
    if (typeof v === 'number' && isFinite(v) && v >= 0) return v;
  } catch (e) {}
  return fallback;
}

export const feedPrice = (h, id) => econ(h, 'feed.' + id, FEED_PRICES[id] || 0);
export const disposalPrice = (h, id) => econ(h, 'disposal.' + id, DISPOSAL_PRICES[id] || 0);
export const tapRate = (h, id) => {
  const t = tapFor(id);
  return t ? econ(h, 'tap.' + id, t.rate) : 0;
};

/* ── IN: supply contracts ────────────────────────────────────────────────── */

export function contractCost(h, id, qty) {
  return Math.ceil(feedPrice(h, id) * Math.max(0, qty | 0));
}

export function buyFeed(st, h, id, qty) {
  const mat = matById(id);
  if (!mat || !FEED_PRICES[id]) return { ok: false, why: 'That is not a feedstock the suppliers carry.' };
  qty = Math.max(0, qty | 0);
  if (!qty) return { ok: false, why: 'Pick a contract size.' };

  /* 🔴 CHECK THE YARD BEFORE TAKING THE MONEY. Buying 1,000 units into a yard
     with room for 200 would charge full price and silently drop 800 — the same
     shape as the addRes stash-cap clamp that /src/trading treats as a failed
     leg rather than a smaller delivery. Refuse instead. */
  /* 🔴 SUPPLIERS MAY NOT FILL THE YARD TO THE BRIM. A line needs working room:
     shredding 10 units of waste yields 10 shred plus 1 hazardous, so a yard at
     exactly 100% cannot start even though it is about to get smaller. Selling a
     player feedstock right up to the ceiling therefore SOLD THEM A DEADLOCK —
     every machine reading "Yard is full" with no legal move available. Feedstock
     is capped at FEED_HEADROOM below the ceiling so the first batch always fits;
     production itself may still fill the remainder, which is a real bottleneck
     the player can act on rather than one they were sold. */
  const room = Math.floor(storageCap(st) * (1 - FEED_HEADROOM)) - storageUsed(st);
  if (qty > room) return { ok: false, why: 'Not enough yard space — the suppliers can drop ' + Math.max(0, Math.floor(room)) + ' more units. Build or upgrade the Scrap Yard.' };

  const cost = contractCost(h, id, qty);
  if (!h.spendGems(cost)) return { ok: false, why: 'Not enough Cinder — that contract costs ' + cost.toLocaleString() + '.' };

  /* Feedstock arrives at a grade set by the stream, not at 0 or 1. This is the
     head of the purity chain: buy dirty, and no amount of sorting fully recovers
     it (yieldAtPurity is a curve, not a gate). */
  const grade = FEED_GRADE[id] === undefined ? 0.5 : FEED_GRADE[id];
  mergeStock(st, id, qty, grade);
  if (!h.save()) { h.addGems(cost); takeStock(st, id, qty); return { ok: false, why: 'Could not save — the contract was refunded.' }; }
  return { ok: true, qty, cost };
}

/* Incoming grade per stream. Residential bales are genuinely filthy; crude and
   minerals arrive clean because they are not mixed waste at all. */
export const FEED_GRADE = {
  residentialWaste: 0.34,
  commercialWaste: 0.48,
  industrialWaste: 0.66,
  electronicWaste: 0.72,
  organicWaste: 0.55,
  crudeOil: 0.82,
  coal: 0.78,
  limestone: 0.8,
};

/* ── OUT: taps ───────────────────────────────────────────────────────────── */

/* What `qty` units of `id` would pay, at the pile's current grade.
   🔴 PURITY IS PRICED HERE TOO, and it must be: if a tap paid flat, a player
   could run the whole line at trim 0 (max tonnage, minimum grade) and cash out
   the same amount, which would make the sorter — and therefore the entire
   quality half of the design — decorative. */
export function tapPreview(st, h, id, qty) {
  const t = tapFor(id);
  if (!t) return null;
  const s = stockOf(st, id);
  /* 🔴 FLOOR THE PILE, NOT JUST THE REQUEST. Stacks hold fractional quantities
     (the Powerhouse burns 0.25 units a minute, and output fractions are banked
     rather than floored), so `min(qty, request)` happily offered the player
     "81.25 units" to sell. Units are the thing the UI counts and the player
     reasons about: only whole ones are for sale. */
  const n = Math.floor(Math.min(s.qty, Math.max(0, qty | 0)));
  const grade = 0.55 + 0.45 * s.purity; // a filthy pile still sells, just badly
  return { to: t.to, units: n, pays: Math.floor(n * tapRate(h, id) * grade), purity: s.purity };
}

export function cashOut(st, h, id, qty) {
  const t = tapFor(id);
  if (!t) return { ok: false, why: matName(id) + ' has no buyer — it is a process stream, not a product.' };
  const s = stockOf(st, id);
  qty = Math.floor(Math.min(s.qty, Math.max(0, qty | 0)));
  if (qty <= 0) return { ok: false, why: 'Nothing to sell.' };

  const prev = tapPreview(st, h, id, qty);
  if (!prev || prev.pays <= 0) return { ok: false, why: 'That grade is too low to be worth anything. Sort it first.' };

  takeStock(st, id, qty);
  /* addRes respects the stash cap and can deliver LESS than asked. The trading
     bridge treats a clamp as a failed leg; here the units are already out of the
     Foundry, so a clamp must put them BACK rather than vanish. */
  const landed = h.addRes(t.to, prev.pays);
  if (landed === false) {
    mergeStock(st, id, qty, s.purity);
    return { ok: false, why: 'Your ' + t.to + ' stores are full — sell or spend some first.' };
  }
  if (!h.save()) { mergeStock(st, id, qty, s.purity); return { ok: false, why: 'Could not save — nothing was sold.' }; }
  return { ok: true, units: qty, paid: prev.pays, to: t.to };
}

/* ── COST: disposal ──────────────────────────────────────────────────────── */

export function haulCost(h, st, id) {
  return Math.ceil(disposalPrice(h, id) * stockOf(st, id).qty);
}

export function haul(st, h, id) {
  if (DISPOSAL_IDS.indexOf(id) < 0) return { ok: false, why: 'That is not waste — sell it instead.' };
  const s = stockOf(st, id);
  if (s.qty < 1) return { ok: false, why: 'Nothing to haul.' };
  const cost = haulCost(h, st, id);
  if (!h.spendGems(cost)) return { ok: false, why: 'Not enough Cinder — the haul costs ' + cost.toLocaleString() + '.' };
  takeStock(st, id, s.qty);
  if (!h.save()) { h.addGems(cost); mergeStock(st, id, s.qty, s.purity); return { ok: false, why: 'Could not save — nothing was hauled.' }; }
  return { ok: true, units: Math.floor(s.qty), cost };
}

export default {
  FEED_PRICES, FEED_GRADE, CONTRACT_SIZES, FEED_HEADROOM, DISPOSAL_IDS, DISPOSAL_PRICES,
  feedPrice, disposalPrice, tapRate, contractCost, buyFeed,
  tapPreview, cashOut, haulCost, haul,
};
