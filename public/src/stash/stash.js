/* ══════════════════════════════════════════════════════════════════════════
   🔒 SECRET STASH — protected carry, the rules

   PURE. No DOM, no Profile, no globals. Capacity, tiers and eligibility are
   decided here and nowhere else, so they can be driven directly by
   tools/stash-tests/run.mjs and mirrored exactly in SQL.

   ── WHAT THIS CHANGES ABOUT DEATH ─────────────────────────────────────────
   _fieldBagLossOnDefeat() in index.html carries this comment:

       "FULL TARKOV RULE (user-decided): fall in battle and EVERYTHING in the
        carry bag is gone — pre-battle carry included, NO SECURED POUCH"

   The Secret Stash is that secured pouch, so this is a deliberate reversal of
   an earlier decision, requested in the brief. It is bounded on purpose: the
   stash starts LOCKED, costs money, tops out at 30 slots against a field bag
   of 36–80, and protects nothing the player did not deliberately put in it
   before dying. Death stays expensive; it stops being arbitrary.

   ⚠ THE PROTECTION IS STRUCTURAL, NOT A FLAG. The stash is a SEPARATE STORE
     (Profile.secretStash) from the carry bag (Profile.fieldBag).
     _fieldBagLossOnDefeat() iterates the bag and only the bag, so it cannot
     reach the stash even by accident — there is no `protected: true` field for
     a bug to mis-read, and no branch that could forget to check one. A test
     that only asserted "the flag was respected" would be testing the wrong
     thing; .gauntlet/drive-stash-death.mjs runs the real defeat handler.
   ══════════════════════════════════════════════════════════════════════════ */

/* One table, and it is THE table — index.html's STASH_TIERS is the same five
   rows and must stay that way. Two tier tables that disagree is the drift this
   codebase keeps writing headers about: the shopfront would sell 7 slots and
   the rules engine would grant 5, and every test would pass.

   🔄 RETUNED: 5/10/20/35/50 slots for Cinder → 7/12/18/24/30 for Ⓐ Aza, sold at
   the base's Vendor Market rather than from inside the field panel. The ladder
   is flatter on purpose — the old one doubled twice and the last two tiers were
   the only ones that mattered; this one is worth climbing at every step.
   ⚠ THE AZA PRICES ARE REBASED, NOT CONVERTED. Aza is orders of magnitude
     scarcer than Cinder (real-money bundles are 7–150 coins), so carrying
     320,000 across would have made the top stash permanently unbuyable.
     Anchored on the rate the game itself publishes — aza_config.cinder_per_aza
     is 5,000 — which puts the old ladder at ~2/6/15/32/64 coins.
   🔴 THE CEILING WENT DOWN, 50 → 30, AND THAT IS A TAKE-BACK unless the host
      handles it. index.html's _stashCap() floors the capacity at what is
      ALREADY STORED, so a grandfathered Tier 5 keeps every slot it is using and
      simply cannot add more until it drains under 30. `cinder` is kept on each
      row so a save or a log written under the old prices still reads. */
export const STASH_TIERS = [
  { tier: 1, slots: 7,  aza: 3,  cinder: 12000,  label: 'Lining Pocket' },
  { tier: 2, slots: 12, aza: 8,  cinder: 30000,  label: 'False Bottom' },
  { tier: 3, slots: 18, aza: 18, cinder: 75000,  label: 'Lead Case' },
  { tier: 4, slots: 24, aza: 34, cinder: 160000, label: 'Warded Locker' },
  { tier: 5, slots: 30, aza: 60, cinder: 320000, label: 'Anomalous Fold' },
];
export const MAX_TIER = STASH_TIERS.length;

/* Mission items that must stay at risk. Empty by default: an item is
   protectable unless the game says otherwise, because the alternative is a
   silent "why can't I store this" with no message. Callers add ids here (or
   pass `blocked`) when a mode needs the pressure. */
export const NEVER_STASHABLE = new Set();

export function slotsForTier(tier) {
  const t = Math.max(0, Math.min(MAX_TIER, tier | 0));
  return t <= 0 ? 0 : STASH_TIERS[t - 1].slots;
}
export function tierDef(tier) {
  const t = Math.max(1, Math.min(MAX_TIER, tier | 0));
  return STASH_TIERS[t - 1];
}
export function isLocked(tier) { return (tier | 0) <= 0; }
export function isMaxed(tier) { return (tier | 0) >= MAX_TIER; }

/** The tier a player may buy next — 1 when locked, null at the cap. */
export function nextTier(tier) {
  const t = tier | 0;
  if (t >= MAX_TIER) return null;
  return STASH_TIERS[t];              // t is 0-based index of the NEXT tier
}

/**
 * 🔴 SEQUENTIAL ONLY. The brief: "Players cannot purchase Tier 5 without
 * owning the previous tiers." Checked here rather than in the shop UI, because
 * the shop is not the only caller — an admin grant, a reward and the server
 * RPC all route through this.
 */
export function canBuy(currentTier, wantTier) {
  const cur = Math.max(0, currentTier | 0), want = wantTier | 0;
  if (want < 1 || want > MAX_TIER) return { ok: false, reason: 'no_such_tier' };
  if (want <= cur) return { ok: false, reason: 'already_owned' };
  if (want !== cur + 1) return { ok: false, reason: 'out_of_order' };
  return { ok: true, def: tierDef(want) };
}

/**
 * Slots consumed by a stash map {id: qty}.
 * ⚠ ONE STACK = ONE SLOT, matching the field bag's own `_bagSlots`. The brief
 *   asks for exactly this so the stash cannot become unlimited resource
 *   storage: 500 Iron and 1 Iron both cost one slot, but a stack is capped by
 *   the inventory's normal stack limit, which the host supplies.
 */
export function slotsUsed(stash, slotCost) {
  let n = 0;
  for (const k in (stash || {})) {
    const q = (stash[k] | 0);
    if (q > 0) n += (typeof slotCost === 'function' ? (slotCost(k) | 0) || 1 : 1);
  }
  return n;
}

export function freeSlots(stash, tier, slotCost) {
  return Math.max(0, slotsForTier(tier) - slotsUsed(stash, slotCost));
}

export function stashable(id, blocked) {
  if (!id) return false;
  if (NEVER_STASHABLE.has(id)) return false;
  if (blocked && typeof blocked.has === 'function' && blocked.has(id)) return false;
  return true;
}

/**
 * Can `qty` of `id` go in? Returns the amount that actually fits.
 * ⚠ ADDING TO AN EXISTING STACK COSTS NO NEW SLOT. Otherwise a player who
 *   protected 1 Iron could never top it up, which reads as a bug every time.
 */
export function canDeposit(stash, tier, id, qty, slotCost, blocked) {
  const want = Math.max(0, qty | 0);
  if (isLocked(tier)) return { ok: false, reason: 'locked', qty: 0 };
  if (!stashable(id, blocked)) return { ok: false, reason: 'not_stashable', qty: 0 };
  if (want <= 0) return { ok: false, reason: 'bad_qty', qty: 0 };
  const already = ((stash || {})[id] | 0) > 0;
  if (already) return { ok: true, qty: want };            // same stack, same slot
  const free = freeSlots(stash, tier, slotCost);
  const cost = (typeof slotCost === 'function' ? (slotCost(id) | 0) || 1 : 1);
  if (free < cost) return { ok: false, reason: 'full', qty: 0, free };
  return { ok: true, qty: want };
}

/** Pure move: returns NEW {bag, stash} maps. Never mutates its arguments. */
export function moveToStash(bag, stash, tier, id, qty, slotCost, blocked) {
  const b = { ...(bag || {}) }, s = { ...(stash || {}) };
  const have = b[id] | 0;
  const want = Math.min(Math.max(0, qty | 0), have);
  if (want <= 0) return { ok: false, reason: 'not_carried', bag: b, stash: s, qty: 0 };
  const c = canDeposit(s, tier, id, want, slotCost, blocked);
  if (!c.ok) return { ok: false, reason: c.reason, bag: b, stash: s, qty: 0, free: c.free };
  b[id] = have - want; if (!b[id]) delete b[id];
  s[id] = (s[id] | 0) + want;
  return { ok: true, bag: b, stash: s, qty: want };
}

/** Pure move back. The bag's own capacity is the host's business, not ours. */
export function moveToBag(bag, stash, id, qty) {
  const b = { ...(bag || {}) }, s = { ...(stash || {}) };
  const have = s[id] | 0;
  const want = Math.min(Math.max(0, qty | 0), have);
  if (want <= 0) return { ok: false, reason: 'not_stashed', bag: b, stash: s, qty: 0 };
  s[id] = have - want; if (!s[id]) delete s[id];
  b[id] = (b[id] | 0) + want;
  return { ok: true, bag: b, stash: s, qty: want };
}

export default {
  STASH_TIERS, MAX_TIER, NEVER_STASHABLE,
  slotsForTier, tierDef, isLocked, isMaxed, nextTier, canBuy,
  slotsUsed, freeSlots, stashable, canDeposit, moveToStash, moveToBag,
};
