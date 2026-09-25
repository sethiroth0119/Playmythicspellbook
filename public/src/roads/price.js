/* ══════════════════════════════════════════════════════════════════════════
   💰 THE ROAD CLASS PRICE PATH — and it contains no numbers.

   Read that literally: grep this file for a digit and the only ones you will
   find are in this comment. Every quantity comes from one of exactly two
   places, and neither of them is here:

     · the PRICE           — ctx.costOf('road'), node-city's own quote, which is
                             BUILDINGS.road.cost put through scaleCost() and
                             BUILD_CINDER_MULT. /src/streets records what
                             reading the raw table instead does: it "quotes 100x
                             low and looks correct".
     · the MULTIPLIER      — tuning.js, behind rd(), the ECON/_opEcon pattern.

   So a retune of the road price moves all nine classes together, a retune of
   the ladder moves none of the base prices, and there is no third place where
   a road can be priced. CLAUDE.md: "All operation pricing goes through
   _opEcon(). Never hardcode economy numbers."

   ⚠ WHY THE MULTIPLIER LANDS ON EVERY RESOURCE, NOT JUST CINDER.
     costOf() returns a dict. A road happens to cost Cinder only today; the
     moment someone adds `metal: 2` to the road row, a multiplier that only
     touched `cinder` would give away the metal on a highway for free and the
     bug would be invisible in the menu. Multiplying the dict is the shape that
     cannot go wrong when the row changes.

   ⚠ Math.ceil, NOT Math.round. A class that is a multiple of the street price
     must never come out CHEAPER than the arithmetic says because of a rounding
     rule; the player is charged what the tooltip promised or less is not a
     property this codebase can audit, and /src/economy's closed loop is easier
     to reason about when every rounding in the game rounds the same way (the
     upgrade curve in costOf() already uses Math.ceil).

   🐞 …AND THAT IS EXACTLY WHY THE PRODUCT IS SNAPPED FIRST. MEASURED: the
     avenue is 2.20x a 400🔥 road and 400 * 2.20 evaluates to
     880.0000000000001, so a bare Math.ceil quoted the player 881. Not wrong by
     much — wrong in the way nobody can explain, on a number a player CAN check
     by multiplying, and different for every multiplier depending on which way
     its binary expansion happened to fall. Snapping to 1e-6 before the ceil
     removes the artefact and changes nothing real: no multiplier in the ladder
     has more than two decimal places, so a genuine fraction is always far
     larger than the snap. Ceil still applies to everything that is actually
     fractional.
   ══════════════════════════════════════════════════════════════════════════ */

import { costMultOf, DEFAULT } from './classes.js';

/* Scale a cost dict by a class multiplier. The ONE arithmetic in the feature. */
export function scaleByClass(cost, mult) {
  const out = {};
  if (!cost || typeof cost !== 'object') return out;
  const m = Number(mult);
  if (!isFinite(m) || m <= 0) return { ...cost };
  for (const k in cost) {
    const v = Number(cost[k]);
    if (!isFinite(v) || v <= 0) continue;
    // Snap away float noise, THEN ceil. See the header's 880.0000000000001.
    out[k] = Math.ceil(Number((v * m).toFixed(6)));
  }
  return out;
}

/* ⭐ THE QUOTE. `baseCost` is whatever node-city says a road costs RIGHT NOW —
   it is asked at every call, never cached, because the host reprices roads
   through costOf() and a cached quote is how a menu ends up promising one
   number and payCost charging another. */
export function quote(baseCost, cls) {
  return scaleByClass(baseCost, costMultOf(cls || DEFAULT));
}

/* What a conversion costs: re-laying an existing road as a different class is
   charged the FULL new-class price, not a difference.
   ⚠ NOT A DIFFERENCE, AND THAT IS DELIBERATE. A difference would be negative
     downgrading a highway to an alley, and a negative charge is a CREDIT —
     which would mint Cinder outside /src/economy's audited faucet, the one
     thing ECONOMY.md forbids outright. Charging the full price also happens to
     be the honest read: you are not paying the gap between two road surfaces,
     you are digging one up and laying another. */
export function convertQuote(baseCost, cls) {
  return quote(baseCost, cls);
}

/* A human label for a cost dict, for the palette chip. Cinder first because it
   is the only resource a road costs today and the only one worth leading with.
   Format only — it invents no value and rounds nothing. */
export function label(cost) {
  const parts = [];
  if (cost && cost.cinder) parts.push(Math.round(cost.cinder).toLocaleString() + ' 🔥');
  for (const k in (cost || {})) {
    if (k === 'cinder') continue;
    parts.push(Math.round(cost[k]).toLocaleString() + ' ' + k);
  }
  return parts.join(' · ');
}

export default { scaleByClass, quote, convertQuote, label };
