/* ═══════════════════════════════════════════════════════════════════════════
   Ⓐ THE BLUEPRINT STORE — the Vendor Market's Weapon Smith tab.

   🔴 THIS TAB SPENDS REAL MONEY. Aza is bought with cash (Profile.sovereigns,
      through Stripe), so everything here is held to a higher bar than the rest
      of the feature:

      · The purchase is ONE call into index.html (buyBlueprintAza) which owns
        the charge AND the refund. This module cannot charge without the unwind.
      · Ownership lands in ws_blueprints_owned, a SERVER row verified against
        the sov_charge receipt. Never a local flag — the Oil Sim keeps its
        Aza-bought licences in local state, and for a real-money purchase that
        means a device change destroys what the player paid for.
      · The button disables on click. A double-click must not be able to buy
        the same blueprint twice.

   ⚠ NOT PAY-TO-WIN, and the copy says so rather than leaving it implied.
     Because of the §3 budget rule a bought blueprint produces a weapon that
     cannot exceed the shop weapon it is benchmarked against. Aza buys WHICH
     SHAPES you can build, never how strong they are — and every frame here is
     also reachable through loot and reputation.
   ═══════════════════════════════════════════════════════════════════════════ */

import { aza, buyBlueprintAza, toast, ready, signedIn } from './ws.bridge.js';
import { BLUEPRINTS } from './blueprints.js';
import { ownsBlueprint, syncState } from './server.js';
import { schematicId } from './schematics.js';

/* Aza prices. Benchmarked against the Oil Sim's licences (8 / 18 / 25 Aza,
   index.html OSIM_BLUEPRINTS), which are the only in-app reference point for
   what an unlock is worth. A weapon frame is a bigger unlock than a tier
   upgrade, so tier 2 sits at the top of that band and tier 3 above it.
   ⚠ THE SERVER HAS ITS OWN COPY (ws_blueprints.aza_price) and the server's is
     the one that decides. These exist so the tab can render a price before the
     catalogue loads; if they ever disagree the purchase fails as `underpaid`,
     which is the correct outcome — it refuses rather than undercharging. */
export const AZA_PRICE = { 2: 12, 3: 22 };
export const priceOf = (bp) => AZA_PRICE[bp && bp.tier] || null;

export function forSale() {
  const out = [];
  for (const id in BLUEPRINTS) {
    const bp = BLUEPRINTS[id];
    const p = priceOf(bp);
    if (p) out.push({ id: id, bp: bp, price: p, owned: ownsBlueprint(id) });
  }
  return out.sort((a, b) => a.price - b.price);
}

/* Buy one. Returns a {ok, reason} the caller can show verbatim — a real-money
   failure needs to say what happened, not just fail. */
export async function buy(blueprintId) {
  if (!ready()) return { ok: false, reason: 'Store unavailable.' };
  const bp = BLUEPRINTS[blueprintId];
  if (!bp) return { ok: false, reason: 'Unknown blueprint.' };
  const price = priceOf(bp);
  if (!price) return { ok: false, reason: 'That frame is not sold for Aza.' };

  if (!signedIn()) {
    return { ok: false, reason: 'Sign in first — an Aza purchase is recorded to your account, not this device.' };
  }
  if (ownsBlueprint(blueprintId)) {
    return { ok: false, reason: 'You already own the ' + bp.name + ' blueprint.' };
  }
  if (aza() < price) {
    return { ok: false, reason: 'Not enough Aza — the ' + bp.name + ' costs ' + price + '.' };
  }

  const r = await buyBlueprintAza(blueprintId, price, bp.name);
  if (!r || r.ok !== true) {
    const why = {
      offline:       'No connection — nothing was charged.',
      insufficient:  'Not enough Aza.',
      charge_failed: 'The charge did not go through. Your Aza is untouched.',
      grant_failed:  'Charged, but the blueprint could not be recorded — your Aza has been refunded.',
      not_for_sale:  'That frame is not sold for Aza.',
      underpaid:     'The price has changed. Nothing was granted and your Aza has been refunded.',
      stale_receipt: 'That purchase took too long to confirm. Your Aza has been refunded.',
    }[(r && r.error) || ''] || 'The purchase did not complete. If Aza left your balance it has been refunded.';
    return { ok: false, reason: why, refunded: !!(r && r.refunded) };
  }

  // Refill the mirror so the bench unlocks the frame without a reload.
  try { await syncState(); } catch (e) {}
  try { toast('Ⓐ ' + bp.name + ' blueprint acquired — build it at the bench.', 5600); } catch (e) {}
  return { ok: true, name: bp.name, schematic: schematicId(blueprintId) };
}
