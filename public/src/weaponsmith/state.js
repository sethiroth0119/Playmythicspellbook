/* ═══════════════════════════════════════════════════════════════════════════
   🔧 WEAPON SMITH — the persisted shape, and the ONE definition of it.

   index.html hands over the raw `Profile.weaponSmith` object through the
   bridge and says nothing about what is inside it. That is on purpose: the
   legacy file seeding a blob it does not own is exactly how two definitions of
   the same save drift apart (and why phase 1's _opAfterFound branch only sets
   a licence flag rather than building this). Everything about the shape lives
   here.

   Modelled on ensureFuelCommand() / ensureBlackRiver(): one idempotent
   defaulting pass, field by field, safe to call on every entry point. Never a
   wholesale overwrite — a new field must be able to land on an old save
   without touching the fields around it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { rawState, save, owns } from './ws.bridge.js';

/* 🔴 REPUTATION AND CONTRACTS BELOW ARE A CACHE, NOT THE RECORD.
   docs/weaponsmith-design.md §6.6: rep gates content (blueprint tiers,
   contract slots), so a local save is trivially forged and can never be
   authoritative. `ws_shop` on the server is the record; these fields exist so
   the bench can draw a number before the round-trip returns, and they are
   overwritten by whatever the server reports.

   The same rule covers `blueprints` — an Aza-bought blueprint is a REAL-MONEY
   entitlement and lives in `ws_blueprints_owned`. Do NOT let this mirror
   become the thing that decides what a player may build. */
const DEFAULTS = {
  owned: false,
  // 🛠 The in-progress build. null when the bench is clear. Shape is owned by
  // the assembly bench (phase 5) — held here only so a half-built weapon
  // survives a reload, which is the whole reason it is persisted at all.
  bench: null,
  /* ⚔️ The in-progress BLADE. Separate from `bench` because the two are
     different games and a smith may only have one thing in hand — startForge
     refuses if either is set. Persisted for the same reason as `bench`: the
     billet is already spent. */
  forge: null,
  // 🏅 Server mirror — see the warning above. Never written except from a
  // server response.
  rep: 0,
  repQuality: 0,
  repSpeed: 0,
  repSpec: 0,
  repSyncedAt: 0,
  // 📋 Order board mirror. Same rule.
  contracts: [],
  contractsSyncedAt: 0,
  // Server-decided: how many contracts this smith may hold at once. Mirror.
  slots: 1,
  // Frames earned through reputation but not yet claimed. Mirror.
  claimable: [],
  // 🔖 Blueprint-ownership mirror (ids only). Same rule — the server decides.
  blueprints: [],
  blueprintsSyncedAt: 0,
  // 📜 Local activity log, in the _fcLog / _wfLog shape. Purely cosmetic.
  log: [],
  // 📈 Lifetime counters for the shop's own KPI panel. Local, cosmetic, and
  // deliberately not something anything gates on.
  built: 0,
  delivered: 0,
  stripped: 0,
  forged: 0,
  ruined: 0,
};

/* ⚠ NOTE ON WHAT IS *NOT* HERE.
   Parts are NOT stored on this blob. They are ordinary stackable items in
   Profile.itemInventory with their condition tier baked into the id
   (bar_long_pristine / _worn / _shot) — see the design doc §6d. Keeping a
   second parts ledger here would be a duplicate source of truth for something
   the vault already owns, and the two would drift the first time a part was
   traded on the market.

   Finished weapons are likewise NOT here — they mint into Profile.craftedItems
   (phase 3), because they have to be resolvable by getItemById() from the
   loadout and the vault, which never look at this blob. */

export function ensureWeaponSmith() {
  const s = rawState();
  if (!s || typeof s !== 'object') return Object.assign({}, DEFAULTS);   // no bridge → inert copy

  for (const k in DEFAULTS) {
    const d = DEFAULTS[k];
    if (Array.isArray(d)) { if (!Array.isArray(s[k])) s[k] = d.slice(0); continue; }
    if (d === null)       { if (s[k] === undefined)   s[k] = null;       continue; }
    if (typeof s[k] !== typeof d) s[k] = d;
  }

  /* The licence is the cloud-backed Operations.list answer, not this flag — so
     re-assert it on every pass. A player who founded the op on another device
     arrives here with owned:false and must not be told they have no bench. */
  if (!s.owned && owns()) s.owned = true;

  return s;
}

/* 📜 Local log, same shape and cap as _fcLog. Cosmetic only — nothing reads it
   back for a decision. */
export function wsLog(level, msg) {
  const s = ensureWeaponSmith();
  if (!Array.isArray(s.log)) s.log = [];
  s.log.unshift({ ts: Date.now(), level: level || 'info', msg: String(msg || '') });
  if (s.log.length > 80) s.log.length = 80;
}

/* Persist. Thin on purpose — the bridge owns how a profile is saved, and the
   module must never learn a second way to do it. */
export function wsSave() { save(); }

/* Is the bench available to this player? The licence check lives in index.html
   (_wsOwnsLicense) so there is one recognisable way to ask; this is only the
   module-side spelling of it. */
export function wsUnlocked() { return owns(); }
