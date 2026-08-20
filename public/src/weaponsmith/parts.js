/* ═══════════════════════════════════════════════════════════════════════════
   🔩 PARTS — the collectible layer.

   🔴 PARTS STACK, AND CONDITION LIVES IN THE ID. (design doc §6d)
   Profile.itemInventory is a quantity map, so anything with per-instance state
   fights it. Rather than fight it, a part's condition is a TIER baked into its
   id — wsp_bar_long_pristine / _worn / _shot are three different items, each
   an ordinary stackable entry. Consequences, all of them good:
     · parts need no minting, no uid, and no server row
     · they place on the vault grid and trade on the existing market for free
     · the cleaning station is a pure id swap, not a mutation
   Only FINISHED WEAPONS mint (mint.js). That halves the mint surface and was
   the deciding reason for this design.

   ⚠ So: never add per-part mutable state here. The moment a part needs to
     remember something about itself, it stops being stackable and this whole
     layer has to become instance-based. If that ever seems necessary, express
     it as another tier instead.
   ═══════════════════════════════════════════════════════════════════════════ */

import { bridge, ready, getRes, spendRes } from './ws.bridge.js';
import { wsLog, wsSave, ensureWeaponSmith } from './state.js';

/* Condition tiers, worst → best. Order matters: cleaning walks this array, and
   `qualityCap` is the ceiling a build using this part can reach (§3 — a shot
   part cannot produce a perfect weapon however well you assemble it). */
export const TIERS = [
  { id: 'shot',     name: 'Shot Out', qualityCap: 0.75, mult: 0.70 },
  { id: 'worn',     name: 'Worn',     qualityCap: 0.90, mult: 0.85 },
  { id: 'pristine', name: 'Pristine', qualityCap: 1.00, mult: 1.00 },
];
export const TIER_IDS = TIERS.map((t) => t.id);
export const tierOf = (id) => TIERS.find((t) => t.id === id) || TIERS[0];

/* Part SLOTS on a gun. The assembly bench (phase 5) owns the dependency graph
   between them; this file only says what exists and what each one contributes. */
export const SLOTS = [
  { id: 'receiver',  name: 'Receiver',      icon: '🔩', w: 3, h: 2 },
  { id: 'barrel',    name: 'Barrel',        icon: '➖', w: 3, h: 1 },
  { id: 'bolt',      name: 'Bolt / Action', icon: '⚙️', w: 1, h: 1 },
  { id: 'trigger',   name: 'Trigger Group', icon: '🎯', w: 1, h: 1 },
  { id: 'stock',     name: 'Stock',         icon: '🪵', w: 2, h: 2 },
  { id: 'handguard', name: 'Handguard',     icon: '🛡', w: 2, h: 1 },
  { id: 'magazine',  name: 'Magazine',      icon: '📦', w: 1, h: 2 },
  { id: 'optic',     name: 'Optic',         icon: '🔭', w: 2, h: 1 },
  { id: 'muzzle',    name: 'Muzzle Device', icon: '💨', w: 1, h: 1 },
  { id: 'grip',      name: 'Grip',          icon: '✊', w: 1, h: 1 },
];
export const slotOf = (id) => SLOTS.find((x) => x.id === id) || null;

/* ── The catalogue ────────────────────────────────────────────────────────
   Each entry is a part VARIANT. Its three condition tiers are generated from
   it, so a variant is authored once and can never have its tiers drift apart.

   `alloc` is the variant's contribution to the build's stat ALLOCATION — the
   weights that decide WHERE the blueprint's point budget lands (§3). It is
   emphatically NOT a stat bonus: parts redistribute the pool, they never
   enlarge it. A long barrel buys range out of the ATK share; a light stock
   buys SPD out of it. That is the whole player expression.

   `mount` is the fitment tag the bench checks (§6a). A mismatch is refused
   with a named reason, which is how part variety becomes knowledge instead of
   noise. */
export const VARIANTS = [
  // slot        key        name                  mount        alloc                      cost to craft
  ['receiver',  'mil',     'Milspec Receiver',   'std',   { atk: 2, def: 1 },        { metal: 6, weaponParts: 3 }],
  ['receiver',  'light',   'Alloy Receiver',     'std',   { atk: 1, spd: 2 },        { metal: 4, weaponParts: 4 }],
  ['barrel',    'long',    'Long Barrel',        'std',   { atk: 3 },                { metal: 5, weaponParts: 2 }],
  ['barrel',    'short',   'Short Barrel',       'std',   { atk: 1, spd: 2 },        { metal: 3, weaponParts: 2 }],
  ['barrel',    'heavy',   'Heavy Barrel',       'hvy',   { atk: 4, spd: -1 },       { metal: 8, weaponParts: 3 }],
  ['bolt',      'std',     'Standard Bolt',      'std',   { atk: 1 },                { metal: 2, weaponParts: 2 }],
  ['bolt',      'match',   'Match Bolt',         'std',   { atk: 2, crit: 1 },       { metal: 3, weaponParts: 4 }],
  ['trigger',   'std',     'Standard Trigger',   'std',   { atk: 1 },                { weaponParts: 3 }],
  ['trigger',   'match',   'Match Trigger',      'std',   { crit: 3 },               { weaponParts: 5, memoryShards: 1 }],
  ['stock',     'wood',    'Timber Stock',       'std',   { atk: 1, def: 1 },        { wood: 6, weaponParts: 1 }],
  ['stock',     'folding', 'Folding Stock',      'std',   { spd: 3 },                { metal: 3, cloth: 2 }],
  ['handguard', 'poly',    'Polymer Handguard',  'std',   { spd: 1 },                { metal: 2, cloth: 3 }],
  ['handguard', 'rail',    'Rail Handguard',     'rail',  { atk: 1, crit: 1 },       { metal: 4, weaponParts: 2 }],
  ['magazine',  'std',     'Standard Magazine',  'std',   { atk: 1 },                { metal: 2, weaponParts: 1 }],
  ['magazine',  'ext',     'Extended Magazine',  'std',   { atk: 2, spd: -1 },       { metal: 4, weaponParts: 2 }],
  ['optic',     'iron',    'Iron Sights',        'std',   { atk: 1 },                { metal: 1 }],
  ['optic',     'scope',   'Ranged Scope',       'rail',  { atk: 1, crit: 2 },       { metal: 3, memoryShards: 2 }],
  ['muzzle',    'brake',   'Muzzle Brake',       'std',   { atk: 1, spd: 1 },        { metal: 3, weaponParts: 1 }],
  ['muzzle',    'suppr',   'Suppressor',         'std',   { spd: 2 },                { metal: 4, cloth: 2 }],
  ['grip',      'std',     'Standard Grip',      'std',   { atk: 1 },                { wood: 2, cloth: 1 }],
  ['grip',      'angled',  'Angled Grip',        'std',   { spd: 1, crit: 1 },       { metal: 2, cloth: 2 }],
];

export const partId = (slot, key, tier) => 'wsp_' + slot + '_' + key + '_' + tier;

/* Build the flat id → def map. Called once at module load; the result is
   handed to index.html so getItemById() can resolve a part like any other
   item. Parts are a STATIC catalogue, so this never touches the player's save
   — only the COUNTS in itemInventory are per-player. */
export function buildCatalog() {
  const out = {};
  for (const [slot, key, name, mount, alloc, cost] of VARIANTS) {
    const sl = slotOf(slot);
    for (const t of TIERS) {
      const id = partId(slot, key, t.id);
      out[id] = {
        id: id,
        name: (t.id === 'pristine' ? '' : t.name + ' ') + name,
        icon: (sl && sl.icon) || '🔩',
        slotType: 'weaponPart',
        // 🔩 Vault footprint. Parts differ in size on the grid so a receiver
        // costs real space and a trigger does not — the grid IS the carrying
        // constraint, same as every other item in the vault.
        w: (sl && sl.w) || 1,
        h: (sl && sl.h) || 1,
        desc: _describe(slot, name, mount, alloc, t),
        // 🔩 Bench data. Not stats — see the `alloc` note above.
        part: { slot: slot, key: key, mount: mount, tier: t.id, alloc: Object.assign({}, alloc), craftCost: Object.assign({}, cost) },
        // Cinder value scales with condition so a shot part is worth selling
        // on rather than hoarding.
        value: Math.max(20, Math.round(_baseValue(cost) * t.mult)),
      };
    }
  }
  return out;
}

function _baseValue(cost) {
  let v = 0;
  for (const k in cost) v += (cost[k] | 0) * 18;
  return v;
}

function _describe(slot, name, mount, alloc, t) {
  const sl = slotOf(slot);
  const bits = Object.keys(alloc).map((k) => (alloc[k] > 0 ? '+' : '') + alloc[k] + ' ' + k.toUpperCase());
  return (sl ? sl.name : slot) + ' · ' + mount.toUpperCase() + ' mount · ' + t.name +
         ' (build quality up to ' + Math.round(t.qualityCap * 100) + '%). Shapes the build: ' + bits.join(', ') + '.';
}

export const CATALOG = buildCatalog();
export const partDef = (id) => CATALOG[id] || null;
export const isPart  = (id) => !!CATALOG[id];

/* ── 🧽 CLEANING STATION ──────────────────────────────────────────────────
   Promote one part one tier: shot → worn → pristine. A PURE ID SWAP — take one
   of the lower id, give one of the higher. Nothing mutates, which is exactly
   what keeps parts stackable.

   Costs gunOil (+ cloth), which is what gives the Oil Company's new gunOil
   line something to be consumed by. */
export const CLEAN_COST = { shot: { gunOil: 2, cloth: 1 }, worn: { gunOil: 1 } };

export function nextTier(tierId) {
  const i = TIER_IDS.indexOf(tierId);
  return (i >= 0 && i < TIER_IDS.length - 1) ? TIER_IDS[i + 1] : null;
}

export function cleanCost(partIdStr) {
  const d = partDef(partIdStr);
  if (!d) return null;
  const up = nextTier(d.part.tier);
  if (!up) return null;                                  // already pristine
  return { cost: Object.assign({}, CLEAN_COST[d.part.tier] || {}), to: partId(d.part.slot, d.part.key, up) };
}

export function cleanPart(partIdStr) {
  if (!ready()) return null;
  const plan = cleanCost(partIdStr);
  if (!plan) return null;
  const b = bridge();
  try {
    if ((b.itemCount(partIdStr) | 0) < 1) return null;
    // Charge FIRST and bail if it fails: spendRes is all-or-nothing, so a
    // failed charge can never leave the player short a part and short the oil.
    if (!spendRes(plan.cost)) return null;
    if (!b.moveItem(partIdStr, -1)) { b.refundRes(plan.cost); return null; }
    if (!b.moveItem(plan.to, +1))   { b.moveItem(partIdStr, +1); b.refundRes(plan.cost); return null; }
  } catch (e) { return null; }
  wsLog('clean', 'Cleaned ' + (partDef(partIdStr) || {}).name + ' → ' + (partDef(plan.to) || {}).name + '.');
  wsSave();
  return plan.to;
}

/* ── 🪛 STRIP A DONOR ─────────────────────────────────────────────────────
   Tearing down junk is the MAIN source of parts, and it is the reference
   game's real economy: donors drop from nodes and battles as scrap, and what
   comes out depends on how bad the donor was.

   `weaponParts` covers the fasteners and small components that are not worth
   modelling as individual items — which is why the smith yields it and why
   the Industrialist selling it is a second, already-existing supply line. */
export const DONORS = {
  wsd_junk:    { id: 'wsd_junk',    name: 'Junk Weapon',     icon: '🗑', picks: 2, tiers: { shot: 0.70, worn: 0.30, pristine: 0.00 }, scrap: { metal: 2, weaponParts: 1 } },
  wsd_service: { id: 'wsd_service', name: 'Service Weapon',  icon: '🔫', picks: 3, tiers: { shot: 0.35, worn: 0.50, pristine: 0.15 }, scrap: { metal: 3, weaponParts: 2 } },
  wsd_cache:   { id: 'wsd_cache',   name: 'Sealed Cache Weapon', icon: '📦', picks: 4, tiers: { shot: 0.10, worn: 0.40, pristine: 0.50 }, scrap: { metal: 4, weaponParts: 3 } },
};

export function donorCatalog() {
  const out = {};
  for (const k in DONORS) {
    const d = DONORS[k];
    out[d.id] = {
      id: d.id, name: d.name, icon: d.icon, slotType: 'weaponPart',
      w: 3, h: 2,
      desc: 'A donor weapon. Strip it at the bench for ' + d.picks + ' parts plus scrap. Condition of what comes out depends on the donor.',
      donor: { picks: d.picks, tiers: Object.assign({}, d.tiers), scrap: Object.assign({}, d.scrap) },
      value: 120,
    };
  }
  return out;
}
export const DONOR_CATALOG = donorCatalog();
export const isDonor = (id) => !!DONOR_CATALOG[id];

/* Roll a tier from a donor's weights. Takes an rng so the whole strip is
   testable — a random source baked in would make the payout unverifiable. */
export function rollTier(weights, rng) {
  const r = (typeof rng === 'function' ? rng() : Math.random());
  let acc = 0;
  for (const t of TIER_IDS) { acc += (weights[t] || 0); if (r < acc) return t; }
  return TIER_IDS[0];
}

export function stripDonor(donorItemId, rng) {
  if (!ready()) return null;
  const d = DONOR_CATALOG[donorItemId];
  if (!d) return null;
  const b = bridge();
  try {
    if ((b.itemCount(donorItemId) | 0) < 1) return null;
    if (!b.moveItem(donorItemId, -1)) return null;
  } catch (e) { return null; }

  const got = [];
  const pool = VARIANTS.slice();
  for (let i = 0; i < d.donor.picks; i++) {
    const pick = pool[Math.floor((typeof rng === 'function' ? rng() : Math.random()) * pool.length)];
    const tier = rollTier(d.donor.tiers, rng);
    const id = partId(pick[0], pick[1], tier);
    try { b.moveItem(id, +1); } catch (e) {}
    got.push(id);
  }
  // Scrap goes through the ordinary resource ledger, cap and all.
  try { for (const r in d.donor.scrap) b.addRes(r, d.donor.scrap[r]); } catch (e) {}

  const s = ensureWeaponSmith();
  s.stripped = (s.stripped | 0) + 1;
  wsLog('strip', 'Stripped ' + d.name + ' → ' + got.length + ' parts.');
  wsSave();
  return { parts: got, scrap: Object.assign({}, d.donor.scrap) };
}

/* Everything index.html needs to resolve a part or a donor by id.
   ⚠ Schematics are added by index.js rather than imported here — schematics.js
     imports blueprints.js, and pulling that chain into parts.js would make the
     part catalogue depend on the blueprint catalogue for no reason. */
export function allItemDefs() { return Object.assign({}, CATALOG, DONOR_CATALOG); }
