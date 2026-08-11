/* ════════════════════════════════════════════════════════════════════════════
   🗺 TERROIR — the ground decides what your city is good at.
   ----------------------------------------------------------------------------
   THE PROBLEM THIS EXISTS FOR: a player could produce all eleven resources by
   themselves, so the multiplayer economy was decorative. Nothing about the
   board ever made you want to talk to another human.

   THE ANSWER: the ground your camp stands on is good at a FEW chains and bad at
   the rest, and "bad" is a CEILING YOU CANNOT OUT-BUILD rather than a tax you
   can brute-force with more buildings.

   🔴 THIS FILE IS THE ONE TUNING TABLE (the `_opEcon()` pattern — CLAUDE.md:
      "All operation pricing goes through _opEcon(). Never hardcode economy
      numbers"). Every terroir number in the game is `TERROIR_ECON` below.
      Callers ask; they never carry a copy. Render code NEVER holds a number —
      that is why the panel HTML is generated in here too.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `Profile`, `Forge`, `Cloud`, `App` are
      top-level `const` in index.html — global LEXICAL bindings, NOT properties
      of `window`. This module therefore reads NOTHING by itself: index.html
      hands it a seed through `window.MythicCityBridge.terroirSeed()`. With no
      bridge the module reports UNSURVEYED ground (all COMMON), which is the
      neutral, no-regression state.

   ── WHAT TERROIR TOUCHES, AND WHAT IT MUST NEVER TOUCH ──────────────────────
   TOUCHES (production only):
     • `_opComputed()` in index.html — the yield of a corp/personal operation.
     • `pending()` in production.state.js — the yield of a CITY_PRODUCTION
       building, including the stacking rule below.
   NEVER TOUCHES (this is the anti-hard-block guarantee — see §SOLO):
     • loot, raids, node collection (`tw_collectNode`), the Foundation Reserve,
       the Ops Vault, the Resource Exchange, gifts, or ANY spend path.
     A resource you cannot make well, you can still loot, still collect from
     your node, and still buy. Terroir slows a solo player down. It never stops
     one, and it can never take anything away.

   ── §CEILING — why it cannot be out-built ───────────────────────────────────
   Two numbers per tier, not one:
     • `yieldMul` — flat multiplier on that resource's output.
     • `sat`      — the k-th BUILDING producing the same resource runs at
                    sat^(k-1). Output of a stacked chain is therefore a
                    geometric series and converges:
                        ceiling = yieldMul / (1 - sat)   × one base building
   On BARREN ground that ceiling is 0.167× a single base building. Ten Gene
   Vaults on barren rock make less than ONE Gene Vault on common ground, and no
   amount of Cinder changes that. THAT is the structural gap: a number on the
   player's own board that more construction provably cannot move.

   Operations do not need the saturation rule — they are one-per-type
   (`_opCreateLocal`), so `maxWorkers` is already the ceiling and `yieldMul`
   alone makes it structural.

   ── §SOLO — nobody is ever locked out ───────────────────────────────────────
   BARREN is 0.15×, not 0. Everything stays reachable alone; the shortfall is a
   TIME cost and the panel prints it in days. "Wait for another human" is a quit
   button, so it is not in this design anywhere.
   ════════════════════════════════════════════════════════════════════════════ */

/* The eleven. Kept as a local constant rather than read from the bridge so the
   module is testable with no host at all; `resourceIds()` prefers the host's
   list when one is mounted, so a future twelfth resource needs no edit here. */
const FALLBACK_IDS = [
  'food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies',
  'metal', 'fuel', 'corruptedEssence', 'memoryShards', 'dna',
  // 🪵 r12 — the construction raws. Kept in sync with index.html's RESOURCES;
  // resourceIds() prefers the live bridge list, so this is only the no-host
  // fallback, but a STALE fallback is worse than none: it would hand
  // profileFor() 11 ids against a 14-slot bag and degrade to all-COMMON.
  'wood', 'stone', 'cloth',
];

/* ════════════════════════════════════════════════════════════════════════════
   🎛 TERROIR_ECON — THE ONE TUNING TABLE. Nothing else in the game may hold a
   terroir number. Retune HERE and every surface follows.
   ════════════════════════════════════════════════════════════════════════════ */
export const TERROIR_ECON = {
  /* Tier definitions. `ceiling` is DERIVED (yieldMul / (1 - sat)) and is
     computed at read time by tierCeiling() — it is not stored, so it cannot
     drift from the two numbers it comes from. */
  tiers: {
    RICH:   { key: 'RICH',   label: 'Rich',   yieldMul: 1.60, sat: 0.80, icon: '★', color: '#9ad17a',
              blurb: 'The seam runs deep here. Stack this chain — it is the only ground that rewards it.' },
    COMMON: { key: 'COMMON', label: 'Common', yieldMul: 1.00, sat: 0.55, icon: '·', color: '#cfd6e4',
              blurb: 'Ordinary ground. Workable, never remarkable.' },
    SCARCE: { key: 'SCARCE', label: 'Scarce', yieldMul: 0.45, sat: 0.30, icon: '▽', color: '#e0a060',
              blurb: 'Thin. A second plant here buys you almost nothing — buy it instead.' },
    BARREN: { key: 'BARREN', label: 'Barren', yieldMul: 0.15, sat: 0.10, icon: '✖', color: '#e0556a',
              blurb: 'Dead ground. No number of buildings fixes this. Someone else has to make it.' },
  },

  /* 📊 THE SHAPE OF EVERY PLAYER'S GROUND. Fixed counts, so two players are
     always comparable and the gap is a known size rather than a dice roll:
     5 of the 11 resources are SCARCE-or-worse and 2 of those are BARREN.
     ⚠ MUST SUM TO THE NUMBER OF RESOURCES. `profileFor()` asserts it and falls
       back to all-COMMON rather than producing a short profile — an undefined
       tier would read as a multiplier of NaN and silently zero a payout. */
  /* 🔢 RE-DERIVED FOR 14 (r12: +wood +stone +cloth). Was { 2, 4, 3, 2 } = 11.
     The reasoning, so the next person adding a resource can repeat it:
       • BARREN STAYS AT EXACTLY 2. This is the count of chains you provably
         cannot out-build, and it is an ABSOLUTE, not a ratio — "two things
         another player has to make for me" is the amount of dependency the
         feature was tuned against. Scaling it with the ledger would mean every
         new resource made everyone lonelier, which is a tax on adding content.
       • RICH GOES 2 → 3. It has to, or a player's SELLABLE surplus is diluted
         (2/11 = 18% of the ledger → 2/14 = 14%) at the same moment their NEEDS
         grow by three. Trade leverage must scale with the ledger even though
         the hard gap does not.
       • The other two go to COMMON and SCARCE (4→5, 3→4), which lands
         scarce-or-worse at 6/14 = 42.9% against the old 5/11 = 45.5% — the
         design's pressure preserved to within three points.
     ⚠ MUST SUM TO resourceIds().length. profileFor() checks and falls back to
       all-COMMON; that fallback is SILENT except for a console.warn, so a wrong
       number here disables terroir without breaking anything visibly. */
  slots: { RICH: 3, COMMON: 5, SCARCE: 4, BARREN: 2 },

  /* 🌱 The node's own resource seam is forced RICH. The war map already tells
     the player "this node produces METAL"; terroir makes that claim mean
     something for the whole city rather than only for the collect button. */
  seamIsRich: true,

  /* 🔤 The war map's yield keys are its own vocabulary (_TW_RES_KEYS: FOOD,
     FUEL, MED, METAL, CRYSTAL, RELIC, ETHER, WOOD, BIO, ELEC) and only four of
     them have an entry in index.html's `_TW_RES_ID_MAP`. That map is NOT
     extended — `_twUpgradeCost` prices node upgrades off it and widening it
     would silently change what shared node upgrades cost. This alias table is
     terroir's own, it is read-only, and it exists so all ten node flavours can
     name a seam instead of only four.
     ⚠ A key that resolves to something outside the resource list is dropped
       (no seam), never forced — an unknown id would take a RICH slot away from
       a real resource. */
  seamAliases: {
    FOOD: 'food', FUEL: 'fuel', MED: 'medicine', MEDICINE: 'medicine',
    METAL: 'metal', CRYSTAL: 'memoryShards', RELIC: 'memoryShards',
    /* 🪵 WOOD USED TO ALIAS TO 'supplies' — a deliberate approximation, because
       the war map has a WOOD yield key and the ledger had no wood to point it
       at. It does now. A node whose seam is WOOD makes the player RICH IN WOOD,
       which is what the map has been claiming all along.
       ⚠ This is a behaviour change for existing players on a WOOD node: their
         forced-RICH slot moves from supplies to wood. Nothing is deleted and
         nothing placed is touched — supplies simply re-enters the shuffle. */
    ETHER: 'corruptedEssence', WOOD: 'wood', BIO: 'dna', ELEC: 'energyDrink',
    WATER: 'water', AMMO: 'ammo', SUPPLIES: 'supplies',
    STONE: 'stone', ROCK: 'stone', CLOTH: 'cloth', FIBER: 'cloth', FIBRE: 'cloth',
  },

  /* Ground with no camp node registered (offline, signed out, brand-new, or a
     save from before this existed) is UNSURVEYED: every resource COMMON.
     ⚠ COMMON.yieldMul is exactly 1.00, so an unsurveyed player's OPERATIONS
       behave byte-identically to before this feature existed. That identity is
       deliberate and load-bearing — it is what makes this safe to ship. */
  unsurveyedTier: 'COMMON',

  /* 💰 THE GROUND BITES THE RESOURCE HARD AND THE CINDER SOFTLY.
     Driven, not guessed: with no floor, a 12-worker mine on BARREN metal made
     58,320 Cinder gross against 95,040 in salaries over the 36 h cap, so
     `net = max(0, gross - salary)` paid the owner exactly 0 — a business they
     had already spent 400,000 Cinder founding, reduced to worthless by a
     feature landing under them. That is not a thing this codebase does.
     So: the RESOURCE keeps the full penalty (0.15x — that is the structural gap
     interdependence is built on, and it is the thing another player must
     supply), while REVENUE is floored. Fiction and mechanics agree: a mine on
     dead ground still sells scrap and services; what it cannot do is supply the
     world with metal.
     ⚠ Must stay ≤ COMMON.yieldMul (1.00) or the floor would RAISE income on
       ordinary ground and quietly inflate every business in the game. */
  opGrossFloor: 0.55,

  /* Cosmetic only: how many sellers to name in the "who has it" line. */
  sellersShown: 3,
};

/* ── Derived reads. Never inline these numbers anywhere else. ─────────────── */
export function tierDef(key) {
  return TERROIR_ECON.tiers[key] || TERROIR_ECON.tiers[TERROIR_ECON.unsurveyedTier];
}
/* The whole point of the design, in one line: the most a chain can EVER make on
   this ground, as a multiple of one base building, however many you build. */
export function tierCeiling(key) {
  const t = tierDef(key);
  const s = Math.min(0.999, Math.max(0, t.sat));
  return t.yieldMul / (1 - s);
}

/* ── Deterministic PRNG ─────────────────────────────────────────────────────
   🔴 Math.random() IS BANNED IN THIS FILE. A re-rolling terroir would mean the
   player's ground changed under them between two page loads — the same class of
   bug `.cityloop/_r9/determinism.js` caught in the housing archetypes, where
   every house re-rolled on every load. Same node id ⇒ same ground, forever, for
   everyone looking at it. */
function hash32(str) {
  let h = 0x811c9dc5;                       // FNV-1a
  const s = String(str == null ? '' : str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}
function xorshift(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  return function next() {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
  };
}

/* ── The host seam ──────────────────────────────────────────────────────────
   Everything about "which ground am I standing on" arrives here and nowhere
   else, so the module has exactly one dependency on the game. */
function bridge() {
  try { return (typeof window !== 'undefined') ? (window.MythicCityBridge || null) : null; } catch (e) { return null; }
}
export function resourceIds() {
  try {
    const list = (bridge() || {}).resources;
    if (Array.isArray(list) && list.length) {
      const ids = list.map(r => r && r.id).filter(Boolean);
      if (ids.length) return ids;
    }
  } catch (e) {}
  return FALLBACK_IDS.slice();
}
function resMeta(id) {
  try {
    const list = (bridge() || {}).resources || [];
    const r = list.find(x => x && x.id === id);
    if (r) return { id, name: r.name || id, icon: r.icon || '📦', color: r.color || '#cfd6e4' };
  } catch (e) {}
  return { id, name: id, icon: '📦', color: '#cfd6e4' };
}
/* 🔤 Node yield key ("METAL", "Bio", "food") → one of the eleven, or null.
   Exported so the war map / trading surfaces can label any node's seam without
   re-deriving the mapping. */
export function seamIdFor(seamKey) {
  if (!seamKey) return null;
  const ids = resourceIds();
  const raw = String(seamKey).trim();
  if (ids.indexOf(raw) >= 0) return raw;                     // already an id
  const up = raw.toUpperCase();
  const aliased = TERROIR_ECON.seamAliases[up] || null;
  if (aliased && ids.indexOf(aliased) >= 0) return aliased;
  const lower = raw.charAt(0).toLowerCase() + raw.slice(1);
  return (ids.indexOf(lower) >= 0) ? lower : null;
}

/* { nodeId, nodeName, seamKey } from the host → resolved seed, or null for
   UNSURVEYED. Absent-tolerant by construction: a bridge without terroirSeed()
   is an older index.html, and that must degrade to neutral ground, not throw. */
function seedInfo() {
  const B = bridge();
  try {
    if (B && typeof B.terroirSeed === 'function') {
      const s = B.terroirSeed();
      if (s && s.nodeId) {
        return {
          nodeId: String(s.nodeId),
          nodeName: String(s.nodeName || s.nodeId),
          seamResId: seamIdFor(s.seamKey || s.seamResId),
        };
      }
    }
  } catch (e) {}
  return null;
}

/* ── Profile construction ───────────────────────────────────────────────────
   Pure: (nodeId, seamResId, ids) → { resId: tierKey }. Exported so a harness
   can drive it with no host and no browser. */
export function profileFor(nodeId, seamResId, ids) {
  ids = (Array.isArray(ids) && ids.length) ? ids.slice() : resourceIds();
  const out = {};
  const neutral = () => { ids.forEach(id => { out[id] = TERROIR_ECON.unsurveyedTier; }); return out; };
  if (!nodeId) return neutral();

  // Build the slot bag and check it against the resource count. A short or long
  // bag is a tuning mistake; it must degrade to neutral, never to `undefined`.
  const bag = [];
  Object.keys(TERROIR_ECON.slots).forEach(k => {
    for (let i = 0; i < (TERROIR_ECON.slots[k] | 0); i++) bag.push(k);
  });
  if (bag.length !== ids.length) {
    try { console.warn('[terroir] slots sum to ' + bag.length + ' but there are ' + ids.length + ' resources — falling back to unsurveyed ground.'); } catch (e) {}
    return neutral();
  }

  const rnd = xorshift(hash32('terroir:v1:' + nodeId));
  const pool = ids.slice();

  // The node's own seam takes a RICH slot first, if it has one and the tuning
  // says seams are rich. Removed from both bags so it cannot be dealt twice.
  if (TERROIR_ECON.seamIsRich && seamResId && pool.indexOf(seamResId) >= 0) {
    const bi = bag.indexOf('RICH');
    if (bi >= 0) {
      out[seamResId] = 'RICH';
      bag.splice(bi, 1);
      pool.splice(pool.indexOf(seamResId), 1);
    }
  }

  // Fisher–Yates over the remaining slots, driven by the seeded PRNG.
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  pool.forEach((id, i) => { out[id] = bag[i] || TERROIR_ECON.unsurveyedTier; });
  return out;
}

/* ── The live read ──────────────────────────────────────────────────────────
   Cached per node id. Cheap either way, but this is called from the accrual
   maths of every operation on every render, so it must not re-shuffle 11
   entries each time. */
let _cache = { key: null, val: null };
export function terroir() {
  const s = seedInfo();
  const key = s ? s.nodeId + '|' + (s.seamResId || '') : '';
  if (_cache.key === key && _cache.val) return _cache.val;
  const ids = resourceIds();
  const tiers = profileFor(s && s.nodeId, s && s.seamResId, ids);
  const val = {
    surveyed: !!s,
    nodeId: s ? s.nodeId : null,
    nodeName: s ? s.nodeName : null,
    seamResId: s ? s.seamResId : null,
    ids,
    tiers,
    byTier: (() => {
      const m = {};
      Object.keys(TERROIR_ECON.tiers).forEach(k => { m[k] = []; });
      ids.forEach(id => { (m[tiers[id]] = m[tiers[id]] || []).push(id); });
      return m;
    })(),
  };
  _cache = { key, val };
  return val;
}
/* Drop the cache — call after the player registers their camp to a new node. */
export function invalidate() { _cache = { key: null, val: null }; }

export function tierOf(resId) { return terroir().tiers[resId] || TERROIR_ECON.unsurveyedTier; }

/* 🔢 THE MULTIPLIER EVERY PRODUCTION PATH ASKS FOR.
   Always a finite number ≥ 0 — a NaN here would multiply a payout to nothing
   and look exactly like the "collected 0" bug class this project has shipped
   before. Unknown resource ⇒ 1 (unchanged), never 0. */
export function yieldMul(resId) {
  const m = tierDef(tierOf(resId)).yieldMul;
  return (typeof m === 'number' && isFinite(m) && m >= 0) ? m : 1;
}

/* 🏭 STACKING — the k-th building producing `resId` (k is 1-based).
   This is the half operations do not need and city buildings do. */
export function stackMul(resId, rank) {
  const t = tierDef(tierOf(resId));
  const k = Math.max(1, rank | 0);
  const v = Math.pow(Math.min(0.999, Math.max(0, t.sat)), k - 1);
  return (isFinite(v) && v >= 0) ? v : 1;
}

/* 🎛 OPERATIONS — one factor for a whole business, weighted by its yield mix.
   An op with no `yields` (bank, dojo, card shop, warehouse, smuggling) returns
   EXACTLY 1: those are licences and services, not extraction, and terroir must
   not touch a bank's interest. */
export function opMul(yields) {
  try {
    if (!yields || typeof yields !== 'object') return 1;
    let wsum = 0, acc = 0;
    Object.keys(yields).forEach(rid => {
      const w = Number(yields[rid]) || 0;
      if (w <= 0) return;
      wsum += w; acc += w * yieldMul(rid);
    });
    if (wsum <= 0) return 1;
    const v = acc / wsum;
    return (isFinite(v) && v >= 0) ? v : 1;
  } catch (e) { return 1; }
}

/* 💰 The CINDER side of an operation — the same weighted factor, floored (see
   TERROIR_ECON.opGrossFloor for the measurement that made this necessary).
   Exactly 1 for an op with no yields and for unsurveyed ground, because
   max(0.55, 1) is 1 and the floor is below COMMON by construction. */
export function opGrossMul(yields) {
  const m = opMul(yields);
  const floor = Number(TERROIR_ECON.opGrossFloor);
  const v = Math.max((isFinite(floor) && floor >= 0) ? floor : 0, m);
  return (isFinite(v) && v >= 0) ? v : 1;
}

/* 📈 The claim the design rests on, as a callable number rather than a promise:
   the most this chain can EVER produce here, as a multiple of one base
   building, at infinite construction. */
export function chainCeiling(resId) { return tierCeiling(tierOf(resId)); }

/* 🕰 "How long alone?" — the honest answer the panel is required to print, so
   a shortfall reads as a wait rather than a wall.
   perCycleBase  — what ONE base building makes per cycle
   cyclesPerDay  — the existing 6h idle contract ⇒ 4
   Returns days, or Infinity if the ground truly makes none (it never does —
   BARREN is 0.15, not 0 — but the guard keeps a retune from printing NaN). */
export function soloDays(resId, need, perCycleBase, cyclesPerDay) {
  const rate = chainCeiling(resId) * (Number(perCycleBase) || 0) * (Number(cyclesPerDay) || 4);
  if (!(rate > 0)) return Infinity;
  return (Number(need) || 0) / rate;
}

/* ════════════════════════════════════════════════════════════════════════════
   🖼 SURFACE — "what you lack, and who has it."
   The HTML lives HERE, next to the table, because a need nobody can perceive
   produces no trade AND because render code must never hold an economy number
   (CLAUDE.md). index.html calls marketStripHtml() and interpolates the string;
   it computes nothing.
   ════════════════════════════════════════════════════════════════════════════ */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const ORDER = ['RICH', 'COMMON', 'SCARCE', 'BARREN'];

function chip(resId) {
  const t = tierDef(tierOf(resId));
  const m = resMeta(resId);
  const ceil = tierCeiling(tierOf(resId));
  return `<span title="${esc(m.name)} — ${esc(t.label)} ground. Output ×${t.yieldMul.toFixed(2)}; every extra plant here runs at ${Math.round(t.sat * 100)}% of the last, so this chain can never exceed ${ceil.toFixed(2)}× one plant, however many you build."
     style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.18rem 0.5rem;border-radius:999px;
            border:1px solid ${t.color}55;background:${t.color}14;color:${t.color};font-size:0.78rem;white-space:nowrap">
     <span>${m.icon}</span><strong>${esc(m.name)}</strong>
     <span style="opacity:0.8">${t.icon} ×${t.yieldMul.toFixed(2)}</span>
   </span>`;
}

/* listings — the OPEN rows from `resource_listings` (ResMarket.open). Passed in
   rather than fetched: this module has no Supabase client and must not grow
   one. Sellers are named from the row the exchange already loaded, so "who has
   it" costs zero extra queries. */
function whoHasIt(resId, listings) {
  const rows = (Array.isArray(listings) ? listings : []).filter(l => l && l.resource === resId);
  if (!rows.length) return '<span class="ink-dim">nobody is selling it right now — post a WANTED price and someone will</span>';
  const names = [];
  const seen = {};
  for (const r of rows) {
    const n = (r.seller_name || 'a survivor') + '';
    if (seen[n]) continue;
    seen[n] = 1; names.push(n);
    if (names.length >= TERROIR_ECON.sellersShown) break;
  }
  const qty = rows.reduce((s, r) => s + (r.qty | 0), 0);
  const more = rows.length > names.length ? ` +${rows.length - names.length} more` : '';
  return `<strong style="color:#9ad17a">${qty}</strong> on the exchange from ${esc(names.join(', '))}${more}`;
}

export function marketStripHtml(opts) {
  opts = opts || {};
  const T = terroir();
  const listings = opts.listings || [];

  const groups = ORDER.map(k => {
    const ids = (T.byTier[k] || []);
    if (!ids.length) return '';
    const t = tierDef(k);
    return `<div style="display:flex;flex-wrap:wrap;gap:0.35rem;align-items:center;margin-bottom:0.35rem">
        <span style="min-width:5.2rem;color:${t.color};font-size:0.76rem;letter-spacing:0.06em">${t.icon} ${esc(t.label.toUpperCase())}</span>
        ${ids.map(chip).join('')}
      </div>`;
  }).join('');

  // The deficit list: everything SCARCE or worse, worst first, each with the
  // ceiling it can never pass and the people currently selling it.
  const lack = []
    .concat(T.byTier.BARREN || [], T.byTier.SCARCE || [])
    .map(id => {
      const t = tierDef(tierOf(id));
      const m = resMeta(id);
      return `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:baseline;padding:0.3rem 0;border-bottom:1px solid rgba(212,175,55,0.10)">
          <span style="min-width:11rem;color:${t.color}">${m.icon} <strong>${esc(m.name)}</strong>
            <span class="small-text" style="opacity:0.75">— ${esc(t.label)}, hard ceiling ${tierCeiling(tierOf(id)).toFixed(2)}× one plant</span></span>
          <span class="small-text" style="flex:1">${whoHasIt(id, listings)}</span>
        </div>`;
    }).join('');

  const seam = (T.byTier.RICH || []).map(id => resMeta(id)).map(m => `${m.icon} ${esc(m.name)}`).join(' · ');

  const head = T.surveyed
    ? `<span style="color:#d4af37">🗺 YOUR GROUND</span> <span class="small-text ink-dim">— ${esc(T.nodeName)}</span>`
    : `<span style="color:#d4af37">🗺 YOUR GROUND</span> <span class="small-text ink-dim">— unsurveyed</span>`;

  const foot = T.surveyed
    ? `<div class="small-text ink-dim" style="margin-top:0.5rem;line-height:1.5">
         <strong style="color:#9ad17a">Your seam:</strong> ${seam || '—'}. Stacking a rich chain is the only place extra plants pay
         (${tierCeiling('RICH').toFixed(2)}× the ceiling of one plant, against ${tierCeiling('COMMON').toFixed(2)}× on common ground) —
         so a specialist out-produces a generalist by <strong>${(tierCeiling('RICH') / tierCeiling('COMMON')).toFixed(1)}×</strong> on their own resource.
         <br>Barren ground is <strong>${tierDef('BARREN').yieldMul.toFixed(2)}×</strong> and no number of buildings raises it —
         but it is never zero: you can always make what you lack yourself, just slowly. Buying it is the fast path, not the only one.
       </div>`
    : `<div class="small-text ink-dim" style="margin-top:0.5rem;line-height:1.5">
         Register your camp to a node on the War Map and the ground under it decides which chains you are rich in.
         Until then every chain is ordinary — workable, never remarkable.
       </div>`;

  return `
    <div style="background:rgba(212,175,55,0.05);border:1px solid rgba(212,175,55,0.22);border-radius:8px;padding:0.75rem 0.95rem;margin-bottom:1rem">
      <div style="font-family:'Cinzel',serif;font-size:0.95rem;margin-bottom:0.5rem">${head}</div>
      ${groups}
      ${lack ? `<div style="margin-top:0.55rem;padding-top:0.45rem;border-top:1px solid rgba(212,175,55,0.18)">
          <div class="small-text" style="color:#e0879a;margin-bottom:0.25rem">WHAT YOU CANNOT MAKE — AND WHO HAS IT</div>
          ${lack}
        </div>` : ''}
      ${foot}
    </div>`;
}

/* ── Registration ──────────────────────────────────────────────────────────
   Wrapped: a failure inside terroir must never take the game down. Terroir is a
   feature; the game is the product. */
const api = {
  TERROIR_ECON, tierDef, tierCeiling, seamIdFor,
  profileFor, terroir, invalidate, resourceIds,
  tierOf, yieldMul, stackMul, opMul, opGrossMul, chainCeiling, soloDays,
  marketStripHtml,
  /* Any node's ground, for surfaces that show SOMEONE ELSE's seam (the war map,
     the trading screen). Pure — no host state involved, which is what lets one
     player reason about another's shortfall without a new table. */
  forNode: (nodeId, seamKey) => profileFor(nodeId, seamIdFor(seamKey), resourceIds()),
};
try { if (typeof window !== 'undefined') window.MythicTerroir = api; } catch (e) {}

export default api;
