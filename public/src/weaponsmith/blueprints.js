/* ═══════════════════════════════════════════════════════════════════════════
   📐 BLUEPRINTS — what can be built, and in what order.

   A blueprint carries three things, and they do three different jobs:

   1. `budget` — the POINT POOL (§3). Benchmarked to an existing shop weapon so
      a perfect build TIES it and can never beat it. This is the balance rule
      and it is not a tuning knob; see mint.js.
   2. `steps`  — the DEPENDENCY GRAPH (§6a). You cannot seat the handguard
      before the barrel, or close the bolt before the barrel is headspaced.
      Wrong order refuses the part WITH THE REASON, which is how a player
      learns the weapon rather than memorising a sequence.
   3. `accepts` — FITMENT. Each station names the mounts it will take. A
      mismatch is refused by name too. This is what turns part variety into
      knowledge instead of noise.

   ⚠ `budget` covers the numeric stats ONLY. range and crit belong to the
     weapon CLASS — pw_combatRifle is "+8 ATK, range 2", where the 8 points are
     the ATK and range 2 comes with being a carbine. See mint.js.
   ═══════════════════════════════════════════════════════════════════════════ */

/* One station on the board. `requires` is the set of stations that must
   already be seated. `accepts` is the set of mount tags this station will
   take; a part whose mount is not listed is refused. */
const step = (slot, requires, accepts, opts) => Object.assign({
  slot: slot,
  requires: requires || [],
  accepts: accepts || ['std'],
  // Torque difficulty for this fastening. Higher = a narrower green window.
  torque: 1,
  optional: false,
}, opts || {});

/* The standard gun assembly order. Shared by every gun blueprint because the
   order a rifle goes together in is a property of rifles, not of one model —
   a second copy per blueprint would drift the first time one was edited.

   ⚠ THE OPTIC IS THE INTERESTING ONE. A 'rail' optic needs somewhere to
     mount, so it depends on the HANDGUARD — and a polymer handguard has no
     rail. That is a cross-part fitment rule rather than a simple ordering
     rule, and it is the single best teacher on the board: the player learns
     that buying a scope means also buying a rail handguard. */
const GUN_STEPS = [
  step('receiver',  [],                        ['std'],          { torque: 1 }),
  step('barrel',    ['receiver'],              ['std', 'hvy'],   { torque: 2 }),
  step('bolt',      ['receiver', 'barrel'],    ['std'],          { torque: 3 }),
  step('trigger',   ['receiver'],              ['std'],          { torque: 2 }),
  step('stock',     ['receiver'],              ['std'],          { torque: 1 }),
  step('handguard', ['barrel'],                ['std', 'rail'],  { torque: 1 }),
  step('grip',      ['receiver'],              ['std'],          { torque: 1 }),
  step('magazine',  ['receiver', 'trigger'],   ['std'],          { torque: 1 }),
  step('muzzle',    ['barrel'],                ['std'],          { torque: 2, optional: true }),
  step('optic',     ['handguard'],             ['std', 'rail'],  { torque: 2, optional: true }),
];

export const BLUEPRINTS = {
  /* Tier 1 — benchmarked to pw_combatRifle (+8 ATK, range 2). */
  ws_bp_carbine: {
    id: 'ws_bp_carbine', name: 'Field Carbine', icon: '🔫', tier: 1,
    slotType: 'primeWeapon', budget: 8, weapon: { range: 2 },
    blurb: 'The standard-issue frame. Forgiving to build and honest to shoot.',
    steps: GUN_STEPS,
  },
  /* Tier 2 — benchmarked to pw_riotShotgun (+14 ATK, +8% crit, range 1). */
  ws_bp_breacher: {
    id: 'ws_bp_breacher', name: 'Breacher', icon: '💥', tier: 2,
    slotType: 'primeWeapon', budget: 14, weapon: { range: 1, crit: 8 },
    blurb: 'Short, loud and unkind. Everything it has, it spends up close.',
    steps: GUN_STEPS,
  },
  /* Tier 2 — benchmarked to pw_pulseLance (6 ATK + 4 MAG, range 2) = 10. */
  ws_bp_lance: {
    id: 'ws_bp_lance', name: 'Pulse Lance', icon: '⚡', tier: 2,
    slotType: 'primeWeapon', budget: 10, weapon: { range: 2 },
    blurb: 'An energy frame. The receiver runs hot and the tolerances are mean.',
    steps: GUN_STEPS,
  },
  /* Tier 3 — benchmarked to pw_voidCannon (6 ATK + 8 MAG, range 3) = 14. */
  ws_bp_marksman: {
    id: 'ws_bp_marksman', name: 'Marksman Rifle', icon: '🎯', tier: 3,
    slotType: 'primeWeapon', budget: 14, weapon: { range: 3 },
    blurb: 'Reach, at the cost of everything that makes a weapon quick.',
    steps: GUN_STEPS,
  },
  /* Secondary — benchmarked to sw_combatKnife / sw_autopistol (+4). */
  ws_bp_sidearm: {
    id: 'ws_bp_sidearm', name: 'Sidearm', icon: '🔪', tier: 1,
    slotType: 'secondaryWeapon', budget: 4, weapon: { range: 1 },
    blurb: 'A backup. Fewer stations, less to get wrong.',
    steps: GUN_STEPS.filter((s) => ['receiver', 'barrel', 'bolt', 'trigger', 'grip'].indexOf(s.slot) >= 0),
  },
};

export const blueprint  = (id) => BLUEPRINTS[id] || null;
export const blueprintIds = () => Object.keys(BLUEPRINTS);
export const stepFor = (bp, slot) => (bp && bp.steps || []).find((s) => s.slot === slot) || null;

/* Stations that must be filled for the build to be finishable. Optional ones
   (muzzle, optic) can be left empty — an unfinished-looking gun that still
   shoots is a real choice, not an incomplete build. */
export const requiredSlots = (bp) => (bp && bp.steps || []).filter((s) => !s.optional).map((s) => s.slot);

/* Can `slot` be seated right now, given what is already on the bench?
   Returns { ok } or { ok:false, reason } — the reason is the product, not a
   detail. A refusal that just says "no" teaches nothing. */
export function canSeat(bp, slot, seated) {
  const st = stepFor(bp, slot);
  if (!st) return { ok: false, reason: 'This frame has no ' + slot + ' station.' };
  if (seated && seated[slot]) return { ok: false, reason: 'The ' + slot + ' is already seated. Pull it first.' };
  const missing = st.requires.filter((r) => !(seated && seated[r]));
  if (missing.length) {
    return { ok: false, reason: 'Seat the ' + missing.join(' and the ') + ' first — the ' + slot + ' fastens to it.' };
  }
  return { ok: true };
}

/* Fitment. Split from canSeat deliberately: "wrong order" and "wrong part"
   are different mistakes and deserve different sentences. */
export function checkFit(bp, slot, part, seated) {
  const st = stepFor(bp, slot);
  if (!st) return { ok: false, reason: 'This frame has no ' + slot + ' station.' };
  if (!part || !part.part) return { ok: false, reason: 'That is not a weapon part.' };
  if (part.part.slot !== slot) {
    return { ok: false, reason: 'A ' + part.name + ' is a ' + part.part.slot + ', not a ' + slot + '.' };
  }
  if (st.accepts.indexOf(part.part.mount) < 0) {
    return { ok: false, reason: 'This frame will not take a ' + part.part.mount.toUpperCase() +
                                ' mount at the ' + slot + ' — it accepts ' + st.accepts.join(' or ').toUpperCase() + '.' };
  }
  /* 🔴 The cross-part rule. A rail optic needs a rail to sit on, and the
     handguard is what provides it. Checked against what is actually seated
     rather than against the blueprint, because it depends on the player's own
     earlier choice — which is exactly what makes it worth learning. */
  if (slot === 'optic' && part.part.mount === 'rail') {
    const hg = seated && seated.handguard;
    if (!hg || hg.part.mount !== 'rail') {
      return { ok: false, reason: 'A rail optic needs a rail to clamp to. Fit a rail handguard first.' };
    }
  }
  return { ok: true };
}
