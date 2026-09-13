/* ════════════════════════════════════════════════════════════════════════════
   🛏 REST ECONOMY — every number, in one place.
   ----------------------------------------------------------------------------
   The `_opEcon()` pattern from CLAUDE.md: no cost, duration or recovery figure
   is written anywhere else in /src/rest. Tune the game here.

   🔴 THE POINT OF THIS FEATURE IS THAT REST COSTS SOMETHING.
   Before it, the Rest Tent was free: click, get a dream, walk away. Supplies
   and food were produced by the camp and consumed by nothing the player felt.
   A long rest is now the sink that gives those two numbers a meaning, which is
   the BG3 loop — "can I afford to rest?" is only a question if the answer can
   be no.

   So the costs below are deliberately NOT trivial. A long rest should be a
   visible dent. If playtesting says players never hesitate, the costs are too
   low and the feature has quietly reverted to the free button it replaced.

   ⚠ SHORT REST IS FREE OF RESOURCES ON PURPOSE. Its cost is the CHARGES — a
   small pool that refills only on a long rest. That is what stops "short rest
   spam" from replacing the long rest without needing a second currency, and it
   is why the charge count, not the price, is the lever to tune first.
   ════════════════════════════════════════════════════════════════════════════ */

export const REST = {
  /* ── SHORT REST ────────────────────────────────────────────────────────
     Cheap, quick, limited. Tops a squad up between fights without resetting
     the day. Costs a CHARGE, not resources. */
  short: {
    id: 'short',
    name: 'Short Rest',
    icon: '🔥',
    blurb: 'A breather by the fire. Recovers a slice of stamina and clears light fatigue.',
    charges: 2,                  // per long-rest cycle — THE lever. See above.
    durationH: 1,                // in-world hours
    energyPct: 0.35,             // fraction of each hero's battle max restored
    fatigueClear: 0.50,          // fraction of fatigue removed
    stressClear: 0.25,
    healPct: 0.25,               // fraction of missing HP restored
    cost: {},                    // free — the charge IS the cost
    bondGain: 0,
    supportScene: false,
  },

  /* ── LONG REST ─────────────────────────────────────────────────────────
     The real one. Full recovery, refills short-rest charges, rolls a dream,
     and is the moment a support conversation can happen (see /src/supports).
     Costs food + supplies scaled by how many heroes are actually resting. */
  long: {
    id: 'long',
    name: 'Long Rest',
    icon: '🛏',
    blurb: 'Bed down for the night. Full recovery, and the camp talks.',
    charges: 0,
    durationH: 8,
    energyPct: 1.0,
    fatigueClear: 1.0,
    stressClear: 1.0,
    healPct: 1.0,
    /* Base cost, then `perHero` on top for each hero resting. A lone scout
       resting is cheap; bedding down a full roster is an expedition's worth
       of food, which is exactly the tension we want. */
    cost:    { food: 12, supplies: 8 },
    perHero: { food: 3,  supplies: 2 },
    bondGain: 2,                 // everyone who rested grows a little closer
    supportScene: true,          // the hook /src/supports listens for
    refillsShortCharges: true,
    rollsDream: true,
  },
};

/* Facility discounts. The camp the player built should make resting cheaper —
   that is the whole reason to build a kitchen. Reads the SAME facility levels
   the camp panel shows, through the bridge; never a second source of truth.

   Returns a multiplier applied to the whole cost. Floored so that a fully
   upgraded camp still pays something: free rest is the bug this feature exists
   to fix, and it must not sneak back in through upgrades. */
export const DISCOUNT_FLOOR = 0.40;

export function costMultiplier(facilities) {
  let m = 1;
  const f = facilities || {};
  if ((f.kitchen | 0) > 0)  m -= 0.08 * Math.min(4, f.kitchen | 0);   // food prep
  if ((f.barracks | 0) > 0) m -= 0.04 * Math.min(4, f.barracks | 0);  // beds, not floors
  return Math.max(DISCOUNT_FLOOR, m);
}

/* What a rest actually costs, given the mode and who is resting. */
export function priceOf(mode, heroCount, facilities) {
  const spec = REST[mode] || REST.short;
  const n = Math.max(0, heroCount | 0);
  const out = {};
  for (const k of Object.keys(spec.cost || {})) out[k] = spec.cost[k];
  for (const k of Object.keys(spec.perHero || {})) out[k] = (out[k] | 0) + spec.perHero[k] * n;
  const m = costMultiplier(facilities);
  for (const k of Object.keys(out)) out[k] = Math.max(1, Math.ceil(out[k] * m));
  return out;
}
