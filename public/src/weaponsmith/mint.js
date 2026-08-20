/* ═══════════════════════════════════════════════════════════════════════════
   🔧 MINT — turn a finished build into a real item.

   The whole reason the Weapon Smith needs no change to the vault, the loadout
   or the battle stat reader: a minted weapon IS an item with an id, so
   getItemById() resolves it (index.html resolves Profile.craftedItems FIRST)
   and everything downstream already works. See docs/weaponsmith-design.md §2.

   🔴 THE BUDGET RULE IS THE BALANCE DESIGN, NOT A TUNING KNOB (§3).
       finalStats = distribute( budget × qualityFactor , allocation )
   A perfect build TIES the shop weapon its blueprint is benchmarked against
   and can never beat it. That is what makes crafting a sidegrade rather than a
   power tier, and it is what lets Aza-bought blueprints exist without being
   pay-to-win: Aza buys WHICH SHAPES you can build, never how strong they are.

   ⚠ The clamp here is DEFENCE IN DEPTH, not the authority. Crafted weapons are
     sellable, so from phase 6 the real computation happens in ws_mint() on the
     server and the client posts what it DID, never what it got. This path
     stays because the app must work offline / before the tables exist
     (CLAUDE.md) — and anything it mints is flagged `local` and is NOT
     tradeable, precisely because nothing verified it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ensureWeaponSmith, wsLog, wsSave } from './state.js';
import { bridge, ready } from './ws.bridge.js';
import { BLUEPRINTS, blueprint } from './blueprints.js';

export const QUALITY_MIN = 0.60;   // a barely-working build still functions
export const QUALITY_MAX = 1.00;   // 🔴 a perfect build TIES the shop weapon. Never above.

/* Blueprints live in blueprints.js — the phase-3 seed table that used to sit
   here is gone, replaced by the real catalogue. SEED_BLUEPRINTS stays exported
   as an alias so nothing that imported it breaks.

   ⚠ `budget` covers the numeric `stats` map ONLY. range and crit are
     properties of the weapon CLASS: pw_combatRifle is "+8 ATK, range 2" — the
     8 points are the ATK, and range 2 comes with being a carbine. Folding
     range into the budget would either make short weapons strictly better or
     require pricing a tile of range in ATK, and neither matches how the
     existing shop weapons are built. */
export const SEED_BLUEPRINTS = BLUEPRINTS;

/* Distribute `points` across weighted `allocation` so the total NEVER exceeds
   the pool. Naive rounding is the trap: three stats at x.5 each round up and
   the build quietly comes out over budget, which is exactly the failure the
   whole §3 rule exists to prevent. So: floor everything, then hand out the
   remainder one point at a time to the largest fractional parts. */
export function distribute(points, allocation) {
  const out = {};
  const keys = Object.keys(allocation || {}).filter((k) => allocation[k] > 0);
  if (!keys.length || points <= 0) return out;

  const wSum = keys.reduce((a, k) => a + allocation[k], 0);
  if (wSum <= 0) return out;

  const exact = {}, frac = [];
  let spent = 0;
  for (const k of keys) {
    const e = (points * allocation[k]) / wSum;
    exact[k] = e;
    const f = Math.floor(e);
    out[k] = f;
    spent += f;
    frac.push([k, e - f]);
  }
  frac.sort((a, b) => b[1] - a[1]);
  let left = Math.floor(points) - spent;
  for (let i = 0; i < frac.length && left > 0; i++) { out[frac[i][0]] += 1; left--; }

  for (const k of keys) if (!out[k]) delete out[k];
  return out;
}

/* The one place a quality number is turned into a point total. Clamped at both
   ends so no caller can hand in 1.4 and mint a weapon over budget. */
export function budgetPoints(budget, qualityFactor) {
  const b = Math.max(0, Number(budget) || 0);
  const q = Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Number(qualityFactor) || 0));
  return Math.floor(b * q);
}

/* Build the item def. Pure — no writes, no bridge — so the budget rule is
   testable on its own, which is the only way a guarantee like this stays true. */
export function composeDef(id, blueprint, allocation, qualityFactor, parts) {
  const bp = blueprint || {};
  const q = Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, Number(qualityFactor) || 0));
  const pts = budgetPoints(bp.budget, q);
  const stats = distribute(pts, allocation);

  /* 🔴 THE ASSERTION THAT MAKES §3 REAL. Everything above is arithmetic that a
     later edit could get wrong; this is the invariant. If the distribution
     ever exceeds the blueprint's pool the def is refused outright rather than
     minted slightly too strong — a weapon that fails to mint is a bug report,
     a weapon that is 1 point over budget is a balance leak nobody notices. */
  const total = Object.keys(stats).reduce((a, k) => a + (stats[k] | 0), 0);
  if (total > Math.floor(Math.max(0, Number(bp.budget) || 0))) return null;

  return {
    id: id,
    name: bp.name || 'Crafted Weapon',
    icon: bp.icon || '🔫',
    slotType: bp.slotType || 'primeWeapon',
    desc: _describe(stats, bp),
    stats: stats,
    // range / crit ride with the weapon class, not the point pool — see the
    // SEED_BLUEPRINTS note.
    weapon: Object.assign({}, bp.weapon || {}),
    // 🔧 Provenance. `quality` is what the player earned; `blueprintId` and
    // `parts` are what they used. Kept on the def so the bench can show how a
    // weapon was made, and so phase 6 can re-verify a local mint server-side.
    crafted: {
      blueprintId: bp.id || null,
      quality: Math.round(q * 100),
      parts: Array.isArray(parts) ? parts.slice(0) : [],
      at: Date.now(),
    },
    /* ⚠ UNVERIFIED AND THEREFORE UNTRADEABLE. Nothing checked this build, so
       it must never reach the market — a client-computed stat block on a
       sellable item is a forged stat block. Phase 6 mints through ws_mint()
       and clears this flag; the market must refuse anything still carrying it. */
    local: true,
  };
}

function _describe(stats, bp) {
  const bits = Object.keys(stats).map((k) => '+' + stats[k] + ' ' + k.toUpperCase());
  const w = bp.weapon || {};
  if (w.range) bits.push('range ' + w.range);
  if (w.crit)  bits.push('+' + w.crit + '% crit');
  return bits.join(', ') + '. Built at your own bench.';
}

/* Generate a stable, collision-free id. Sequence comes off the smith's own
   lifetime counter rather than a random suffix: two weapons minted in the same
   millisecond must not share an id, and a random tail would make that a
   one-in-a-few-thousand silent overwrite of a player's weapon. */
function _nextId(blueprintId) {
  const s = ensureWeaponSmith();
  const n = (s.built | 0) + 1;
  const slug = String(blueprintId || 'wpn').replace(/^ws_bp_/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return 'wsc_' + (slug || 'wpn') + '_' + n;
}

/* Mint locally: write the def into the player's item book AND a count into the
   ordinary inventory. Both, always — the vault prunes any placement whose
   itemId the inventory does not hold, and the loadout resolves the def through
   getItemById. Either half alone is an invisible weapon. */
export function mintLocal(blueprintId, allocation, qualityFactor, parts) {
  if (!ready()) return null;
  const bp = blueprint(blueprintId);
  if (!bp) return null;

  const s = ensureWeaponSmith();
  const id = _nextId(bp.id);
  const def = composeDef(id, bp, allocation, qualityFactor, parts);
  if (!def) return null;                       // over budget — refused, see composeDef

  const b = bridge();
  try {
    const book = b.craftedBook();
    if (!book) return null;
    book[id] = def;
    if (!b.grantCrafted(id)) { delete book[id]; return null; }
  } catch (e) { return null; }

  s.built = (s.built | 0) + 1;
  wsLog('build', 'Minted ' + def.name + ' (' + def.crafted.quality + '% quality).');
  wsSave();
  return def;
}


/* The bench's finishing call. Identical to mintLocal today — it exists as its
   own name because phase 6 splits them: a bench build goes through ws_mint()
   on the server (verified, tradeable) while mintLocal stays the offline path
   (unverified, flagged `local`, never tradeable). Naming the two call sites
   now means that split is a change to ONE function rather than a hunt through
   callers. */
export function mintFromBench(blueprintId, allocation, qualityFactor, parts) {
  return mintLocal(blueprintId, allocation, qualityFactor, parts);
}
