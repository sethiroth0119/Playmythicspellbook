/* ════════════════════════════════════════════════════════════════════════════
   🏙 DISTRICTS — zone specialisation. Registers window.MythicDistricts.
   ----------------------------------------------------------------------------
   LAYER 1 is land use and it already shipped: /src/zoning's eleven zone ids.
   LAYER 2 is this — a specialisation applied ON TOP of a land-use zone, never
   instead of one. A tile with no specialisation behaves EXACTLY as it did
   before this module existed, and that is not a hope, it is the shape of the
   only two seams this module has:

     · `mixFor(x, z, zoneId, baseBag)` returns `baseBag` UNCHANGED for an
       unspecialised tile, an unknown spec id, or a stale pairing;
     · `levelFor(x, z, zoneId)` returns 0, which /src/zoning reads as "use the
       zone's own target".

   So a 404 on /src/districts, a save with no slice, or a player who never
   opens the row all land in the same place: today's game.

   ── THE FOUR THINGS THIS DOES, AND WHERE EACH IS ENFORCED ──────────────────
   1. IT CHANGES WHAT DEVELOPS. /src/zoning's `typeFor()` is the single point in
      the game where "what goes on this plot" is decided. It now asks this
      module for the bag before it asks /src/landvalue to filter it. One call,
      inside machinery that is already tested.
   2. IT IS GATED ON THE RESEARCH TREE. `MythicProgress.specUnlocked(id)`, asked
      at CALL time, never baked in — the tree unlocks during a session.
      🔴 ABSENT ⇒ EVERYTHING AVAILABLE. A 404 on /src/progression costs the
         player the research screen and never a district. Every read here is
         wrapped and every one of them fails OPEN, which is the same direction
         /src/progression's own header states and is not negotiable.
      🔴 THE GATE HAS FIVE DOORS AND THE FIFTH IS THE SAVE. `arm()`, `onZone()`
         and `_set()` all refuse a locked id — and for one round that was read
         as "a locked specialisation can never be on the map". It was wrong:
         `store.load()` writes the map straight off disk, so three strings in a
         hand-edited save file installed three locked districts, `mixFor()`
         honoured them in full (a real tenant swap on a real tile), and
         /src/progression's `adopt()` then read them out of `stats().per` as
         PROOF the player owned the nodes — 15 nodes and 40 ⬡ of a 74 ⬡ tree
         for free. The gate is therefore asked at every READ as well as at
         every write: `unlocked(id)` is the last thing `mixFor`, `levelFor`,
         `markAt` and `refusal` check, and `stats().per` reports only what
         those seams will act on.
      ⚠ A LOCKED ID IS HELD, NOT DROPPED, AND THE DIFFERENCE IS DELIBERATE.
         The obvious fix was to strip it in `afterLoad()`'s reconcile. Rejected:
         a locked id is not the same case as an unknown one (store.js's header
         argues that one), and the player it hurts is the honest one. A spec can
         become locked under a district that was legitimately painted — a node
         re-costed, renamed or moved between rounds — and /src/progression's own
         header is absolute that "nothing here ever removes a zone from the map,
         downgrades a building, or refuses a tile that is already standing". So
         the tile KEEPS its district, it is INERT until the node opens, it comes
         back the moment it does (nothing is cached, so no migration and no
         reload), and the plot meanwhile develops exactly as the plain zone
         would. What it can never do is act, be drawn, or count as evidence.
         `refusal()` says which node is holding it and `verify()` counts them,
         because a rule nobody can see is a rule nobody enforces.
   3. IT IS TIED TO LAND VALUE — WITH NO NEW THRESHOLD ANYWHERE. The spec's bag
      goes through /src/landvalue's `filterMix()` exactly as a zone's bag does,
      so Luxury Retail on marginal land is refused because the band admits a
      food truck and a petrol station and the mix holds neither. The FLOOR the
      panel prints is DERIVED from the live band ladder (`floorOf()` below),
      recomputed on every draw, so it moves when the tree unlocks a building
      and it cannot drift from the model. See specs.js.
   4. IT NAMES THE CARD SEAM AND DOES NOT CROSS IT. `cardSeam()` REPORTS the
      city's mythic districts and the Ouroboros tiles standing in them. It
      touches no bridge, no Profile, no Corp, no Forge — those are top-level
      `const` in the main app and invisible from an ES module (CLAUDE.md), which
      is exactly why the DECISION belongs over there and only the MEASUREMENT
      belongs here. Same rule, same shape and the same reason as
      `MythicEconomy.cardOutput()`.

   🔴 IT MOVES NO MONEY. There is no addCinders, no spendCinders, no addRes and
      no payCost in this module. It changes WHICH building /src/zoning asks the
      host to place; the host's own `placeZoned` → `tryPlace` → `payCost` path
      is untouched and still charges the shipped price. Nothing here is inside
      ECONOMY.md's closed loop and sim.js's audit has nothing new to see.

   🔴 THE GLOBALS TRAP (CLAUDE.md). `game`, `BUILDINGS` and `key` are top-level
      `const` in node-city's module script and invisible here. `mount(ctx)` IS
      the hand-over. The only host write is `saveSoon`.
   ════════════════════════════════════════════════════════════════════════════ */

import { SPECS, SPEC_BY_ID, FAMILIES, specsFor, compile, validate } from './specs.js';
import { makeStore } from './store.js';
import { mountUI, renderInto } from './ui.js';

const W = () => (typeof window !== 'undefined' ? window : {});
const LV = () => { try { return W().MythicLandValue || null; } catch (e) { return null; } };
const PROG = () => { try { return W().MythicProgress || null; } catch (e) { return null; } };
const ZON = () => { try { return W().MythicZoning || null; } catch (e) { return null; } };

let mounted = false;
let store = null;
let BAGS = {};
let BUILDINGS = {};
let _ctx = {};
let _armed = null;                 // the spec on the brush, or null for "general"
let _lockedWrites = 0;             // defence-in-depth counter, reported by verify()

const keyOf = (x, z) => (_ctx.key ? _ctx.key(x, z) : (x + ',' + z));
const nameOf = (t) => (BUILDINGS[t] && BUILDINGS[t].name) || t;

/* Which /src/zoning family a zone id belongs to. Asked LIVE rather than
   mirrored, because a mirrored catalogue is how two modules come to disagree
   about the same zone. Absent zoning ⇒ null ⇒ nothing is ever paired, which is
   the safe direction. */
function catOfZone(id) {
  try {
    const Z = ZON();
    const d = Z && Z.ZONE_BY_ID && Z.ZONE_BY_ID[id];
    return d ? d.cat : null;
  } catch (e) { return null; }
}
function zoneAtKey(k) {
  try {
    const g = _ctx.game || {};
    return (g.zones && g.zones[k]) || null;
  } catch (e) { return null; }
}

/* ── PROGRESSION, ASKED AT CALL TIME AND FAILING OPEN ────────────────────── */
function unlocked(id) {
  const P = PROG();
  if (!P || typeof P.specUnlocked !== 'function') return true;
  try { return !!P.specUnlocked(id); } catch (e) { return true; }
}
function blockedBy(id) {
  const P = PROG();
  if (!P || typeof P.specBlockedBy !== 'function') return null;
  try { return P.specBlockedBy(id) || null; } catch (e) { return null; }
}

/* ══ THE BAND LADDER, ASKED — NEVER RESTATED ═══════════════════════════════
   `MythicLandValue.bands()` returns each rung WITH the tenant set it admits,
   already filtered by the research tree. So the lowest band that will take a
   specialisation is a QUESTION, not a constant, and the answer moves when the
   player researches something. Absent module ⇒ null ⇒ the panel says "the land
   value model is not loaded" instead of inventing a floor. */
function ladder() {
  const L = LV();
  if (!L || typeof L.bands !== 'function' || !L.ready()) return null;
  try {
    const b = L.bands();
    return (Array.isArray(b) && b.length) ? b : null;
  } catch (e) { return null; }
}
/* Every band a spec can develop something in, lowest first. */
function reachOf(specId) {
  const rows = ladder();
  if (!rows) return null;
  const bag = BAGS[specId] || [];
  const out = [];
  for (const b of rows) {
    const all = (b.tenants && b.tenants.all) || [];
    if (bag.some((t) => all.indexOf(t) >= 0)) out.push(b);
  }
  return out;
}
function floorOf(specId) {
  const r = reachOf(specId);
  return (r && r.length) ? r[0] : null;
}

/* ══ DOES THIS SPECIALISATION CHANGE ANYTHING ON THIS ZONE? ════════════════
   🔴 THE PLACEBO CHIP, AND THE RULE THAT RETIRES THE WHOLE CLASS OF THEM.
      `o_low.mix` is [['reslab',1]] and 🔬 Technology's mix is [['reslab',1]].
      There is no band at which those two filter to different bags, so on an
      Office park the chip is a placebo: the panel offered it beside two chips
      that do change something, its own description recommended it for exactly
      that zone, and two adjacent plots — one specialised, one not — developed
      the identical building at the identical level. 🏭 Manufacturing on
      Manufacturing and 📦 Logistics on Warehousing are the same shape, milder:
      they differ on ONE band of five and are identical on the other four.

      The rule is therefore not "delete o_tech" — it is real on Office towers,
      and a spec deleted for one bad pairing takes its good ones with it. The
      rule is that A CHIP MAY NOT BE OFFERED AS CHANGING SOMETHING ON A ZONE
      AND BAND WHERE ITS FILTERED BAG EQUALS THE ZONE'S. That covers o_tech,
      both industrial cases, and whatever is added next week, because it is
      computed from the live zone table and the live band ladder rather than
      listed.

   ── WHAT COUNTS AS A DIFFERENCE, AND WHAT DOES NOT ──────────────────────
     · A DIFFERENT MULTISET of admitted tenants counts. So does an empty one
       against a non-empty one: 💎 Luxury refusing marginal land while the zone
       would have built a food truck is a real, visible difference.
     · A PERMUTATION DOES NOT. `i_manu` on `i_mfg` at modest land is the same
       three ids in a different order; the tenant hash then labels 288 of 576
       tiles differently for a district of identical composition. A different
       name over the same street is not a difference and must not be sold as
       one — counting it would have let this whole class through.
     · A HIGHER LEVEL TARGET DOES. `targetLvl()` in /src/zoning takes
       Math.max(zone, spec), so only a spec target ABOVE the zone's changes the
       street; equal or lower is invisible and is not counted here.

   ⚠ MEASURED AGAINST THE `known` TENANT SET (admitted + research-locked), NOT
     against what the tree has opened today. Using the live set would mark half
     the catalogue inert on a fresh city — where almost every tenant is locked
     and every filtered bag is empty — and un-mark it later, so the panel's mark
     would flap with research and mean nothing. Inertness is a property of the
     CATALOGUE (this mix against that mix), so it is measured against the
     catalogue. Whether the land will take any of it TODAY is a different
     question and `reach`/`floor` above already answer it.

   ABSENT ⇒ NO CLAIM. No /src/zoning, no /src/landvalue, or a zone id this
   build has never heard of ⇒ null, and null is rendered as an ordinary chip.
   A mark that cannot be computed is never guessed at. */
function zoneList() {
  try { const Z = ZON(); return (Z && Array.isArray(Z.ZONES)) ? Z.ZONES : null; } catch (e) { return null; }
}
function zoneDefOf(id) {
  try { const Z = ZON(); return (Z && Z.ZONE_BY_ID && Z.ZONE_BY_ID[id]) || null; } catch (e) { return null; }
}
/* The zone's own bag, compiled exactly as /src/zoning compiles it: weights
   expanded, ids missing from the live BUILDINGS table dropped. Re-derived here
   rather than asked for because /src/zoning keeps MIX private — and it is the
   same four lines, against the same table, so the two cannot disagree. */
function zoneBag(zd) {
  const bag = [];
  for (const [t, w] of ((zd && zd.mix) || [])) {
    if (!BUILDINGS[t]) continue;
    for (let i = 0; i < (w | 0); i++) bag.push(t);
  }
  return bag;
}
const msOf = (a) => {
  const m = Object.create(null);
  for (const t of a) m[t] = (m[t] || 0) + 1;
  return Object.keys(m).sort().map((k) => k + '×' + m[k]).join(' ');
};
/* Each rung with everything it would EVER admit — see the ⚠ above. */
function knownLadder() {
  const rows = ladder();
  if (!rows) return null;
  return rows.map((b) => {
    const t = b.tenants || {};
    const all = (t.all || []).concat(t.locked || []);
    return { id: b.id, ico: b.ico, name: b.name, set: all };
  });
}
/* The bands on which this spec would develop something OTHER than what the
   plain zone develops. null ⇒ unanswerable (see ABSENT ⇒ NO CLAIM). */
function differsOn(specId, zoneId) {
  const s = SPEC_BY_ID[specId];
  const zd = zoneDefOf(zoneId);
  const rows = knownLadder();
  if (!s || !zd || !rows) return null;
  if (s.cat !== zd.cat) return null;                     // not a pairing at all
  const bag = BAGS[specId] || [];
  if (!bag.length) return null;                          // already offered as unavailable
  if ((s.lvl | 0) > (zd.lvl | 0)) return rows.slice();   // taller everywhere it builds
  const base = zoneBag(zd);
  const out = [];
  for (const b of rows) {
    const zb = base.filter((t) => b.set.indexOf(t) >= 0);
    const sb = bag.filter((t) => b.set.indexOf(t) >= 0);
    if (!zb.length && !sb.length) continue;              // neither develops here — nothing to tell apart
    if (msOf(zb) !== msOf(sb)) out.push({ id: b.id, ico: b.ico, name: b.name });
  }
  return out;
}
/* true ⇒ a placebo on this zone: same tenants, same height, every band. */
function inertOn(specId, zoneId) {
  const d = differsOn(specId, zoneId);
  return d ? d.length === 0 : false;
}
/* The zones in the spec's own family where it IS a real district — the other
   half of the sentence a marked chip has to be able to say. */
function realZonesFor(specId) {
  const s = SPEC_BY_ID[specId], zs = zoneList();
  if (!s || !zs) return null;
  const out = [];
  for (const zd of zs) {
    if (zd.cat !== s.cat) continue;
    const d = differsOn(specId, zd.id);
    if (d && d.length) out.push({ id: zd.id, ico: zd.ico, name: zd.name, short: zd.short });
  }
  return out;
}

/* ══ THE ZONING SEAMS ══════════════════════════════════════════════════════ */

/* THE ONE THAT MATTERS. Returns the bag /src/zoning picks a tenant out of.
   Every early return hands back `base` — the zone's own mix — because the
   contract of this whole module is that an unspecialised tile is untouched. */
function mixFor(x, z, zoneId, base) {
  if (!mounted) return base;
  const k = keyOf(x, z);
  const id = store.get(k);
  if (!id) return base;                                  // unspecialised
  const s = SPEC_BY_ID[id];
  if (!s) return base;                                   // id from a newer build
  if (s.cat !== catOfZone(zoneId)) return base;          // stale pairing
  /* 🔒 THE FIFTH DOOR (see the header). The write seams refuse a locked id, so
     one in the store arrived through `store.load()` — a hand-edited save, a
     sync from a build whose tree differed, or a node that has been re-costed
     under a district the player painted honestly. Held, never acted on: this
     hands back the zone's own mix, which is exactly what an unspecialised tile
     gets, so the plot behaves as it would if the district were not there. */
  if (!unlocked(id)) return base;
  const bag = BAGS[id];
  /* ⚠ AN EMPTY BAG IS RETURNED AS EMPTY, NOT PAPERED OVER WITH `base`.
     A specialisation whose whole mix was dropped at compile time can only reach
     a tile through a save (the chip is offered as unavailable and cannot be
     armed). Falling back to the zone's mix would silently un-specialise a
     district the player painted; returning [] leaves the plot vacant and
     `refusal()` below says why, in this module's own words. */
  return bag || base;
}

/* The level target, or 0 for "the zone's own". Same early-return discipline. */
function levelFor(x, z, zoneId) {
  if (!mounted) return 0;
  const id = store.get(keyOf(x, z));
  const s = id && SPEC_BY_ID[id];
  if (!s || s.cat !== catOfZone(zoneId)) return 0;
  if (!unlocked(id)) return 0;      // 🔒 held — the zone's own target, see mixFor
  return s.lvl | 0;
}

/* THE WRITE SEAM. /src/zoning calls this from setZone() after it has written
   the zone, and it owns the whole question of what happens to a specialisation
   when the land under it changes use.
     spec === undefined  the caller said nothing → KEEP what is there if it is
                         still in the right family, drop it otherwise.
     spec === null       explicitly general → clear.
     spec === '<id>'     set it, if it is real, in the right family and open.
   Returns true when the store changed, so setZone can report a paint that
   changed only the specialisation as a real change. */
function onZone(x, z, zoneId, spec) {
  if (!mounted) return false;
  const k = keyOf(x, z);
  if (!zoneId) return store.clear(k);                    // de-zoned ⇒ nothing to specialise
  const cat = catOfZone(zoneId);
  if (spec === undefined) {
    const cur = store.get(k);
    const s = cur && SPEC_BY_ID[cur];
    if (cur && s && s.cat !== cat) return store.clear(k); // re-zoned into another family
    return false;
  }
  if (!spec) return store.clear(k);
  const s = SPEC_BY_ID[spec];
  if (!s || s.cat !== cat) return false;
  /* Defence in depth. The UI cannot arm a locked spec (arm() refuses and names
     the node), so reaching here means a driver or a future caller passed one
     directly. Dropped rather than written, counted rather than silent. */
  if (!unlocked(spec)) { _lockedWrites++; return false; }
  if (!(BAGS[spec] || []).length) return false;
  return store.set(k, spec);
}

/* The refusal a specialised plot that will develop nothing has to be able to
   say. /src/zoning asks this BEFORE /src/landvalue's generic sentence, because
   "nothing this zone builds wants a plot here" is true but unhelpful when the
   real answer is "a card shop needs Established land and this is Modest". */
function refusal(x, z) {
  if (!mounted) return null;
  const k = keyOf(x, z);
  const id = store.get(k);
  const s = id && SPEC_BY_ID[id];
  if (!s) return null;
  /* ⚠ THE SAME FAMILY TEST THE OTHER FOUR SEAMS MAKE, AND IT WAS MISSING HERE.
     For one round this was the only seam that did not ask whether the tile's
     zone still matches the spec's family, so a spec carried in on a save onto a
     tile with no zone at all — or one re-zoned into another family — produced a
     plot where `markAt` drew nothing, `mixFor` returned the base bag, and this
     function nevertheless announced a district. A refusal that names a district
     the rest of the module does not believe in is a second opinion about the
     same tile, which is the failure /src/landvalue's header names. The zone is
     read live off the map rather than passed in, because /src/zoning calls this
     with coordinates only. No zone ⇒ catOfZone(null) ⇒ null ⇒ no claim. */
  if (s.cat !== catOfZone(zoneAtKey(k))) return null;
  /* 🔒 HELD BY THE TREE. Said in full, because the alternative is a district
     that silently develops as a plain zone and a player with no way to find out
     why. This is the sentence that makes the hold visible. */
  if (!unlocked(s.id)) {
    const b = blockedBy(s.id);
    return '🔒 ' + s.ico + ' ' + s.name.toUpperCase() + ' — this block carries the district, but it is ' +
      'not researched' + (b ? ': ' + b.name + ' opens it, for ' + (b.cost | 0) + ' ⬡ in Progression (K)' : '') +
      '. Until then the land develops exactly as its zone would, and nothing has been erased.';
  }
  const L = LV();
  let band = null;
  try { if (L && L.ready()) band = L.bandAt(x, z); } catch (e) {}
  const fl = floorOf(s.id);
  const bag = BAGS[s.id] || [];
  if (!bag.length) {
    return s.ico + ' ' + s.name.toUpperCase() + ' — nothing this specialisation builds exists in this ' +
      'build of the city, so it can never develop. Re-zone the block, or set it back to General.';
  }
  if (!fl) {
    return s.ico + ' ' + s.name.toUpperCase() + ' — no land in this city will take any of ' +
      bag.filter((v, i, a) => a.indexOf(v) === i).map(nameOf).join(', ') +
      ' yet. Research may still be holding them, or the land is not valuable enough anywhere.';
  }
  return s.ico + ' ' + s.name.toUpperCase() + ' on ' + (band ? band.name.toUpperCase() + ' land' : 'this land') +
    ' — it needs ' + fl.ico + ' ' + fl.name + ' or better before ' +
    bag.filter((v, i, a) => a.indexOf(v) === i).map(nameOf).join(' / ') +
    ' will take a plot. Raise the land value, or set this block back to General.';
}

/* The overlay's per-tile mark. Linear, not sRGB — /src/zoning's overlay hands
   vertex colours straight to three and a literal written in sRGB comes out
   pale (that module's own DORM_RIM note records the same trap).
   TWO COLOURS AND NO MORE, DELIBERATELY: gold for a 🃏 mythic district, bone
   for any other specialisation. The map says "this block is specialised, and
   whether it is a card district"; it does not claim you can read one of six
   specs off a corner pip, because you cannot. */
const MARK_MYTHIC = { r: 0.658, g: 0.428, b: 0.038 };   // = #d4af37 in linear
const MARK_PLAIN  = { r: 0.815, g: 0.745, b: 0.604 };   // = #e9e0cc in linear
function markAt(k, zoneId) {
  if (!mounted) return null;
  const id = store.get(k);
  const s = id && SPEC_BY_ID[id];
  if (!s || s.cat !== catOfZone(zoneId)) return null;
  /* 🔒 A HELD DISTRICT IS NOT DRAWN. The pip's whole claim is "this block is
     specialised and behaves differently"; a held one behaves exactly like its
     zone, so drawing it would be the map making a promise the develop pass does
     not keep. It reappears the moment the node opens — the store still has it. */
  if (!unlocked(id)) return null;
  return s.mythic ? MARK_MYTHIC : MARK_PLAIN;
}

/* ══ THE BRUSH ═════════════════════════════════════════════════════════════
   The specialisation is a property of the ZONE BRUSH, not a separate tool —
   that is the whole legibility answer (see ui.js). Arming is where the
   progression refusal happens, once per click, naming the node. */
function arm(id) {
  if (!id) { _armed = null; return true; }
  const s = SPEC_BY_ID[id];
  if (!s) return false;
  if (!(BAGS[id] || []).length) {
    toast('🏙 ' + s.name + ' has nothing to build in this city — see the panel for why.', 'bad');
    return false;
  }
  if (!unlocked(id)) {
    const b = blockedBy(id);
    toast('🔒 ' + s.ico + ' ' + s.name + ' is not unlocked yet' +
      (b ? ' — ' + b.name + ' opens it, for ' + (b.cost | 0) + ' ⬡ in Progression (K).' : '.'), 'bad');
    return false;
  }
  _armed = id;
  return true;
}
function armedFor(cat) {
  const s = _armed && SPEC_BY_ID[_armed];
  return (s && s.cat === cat) ? s.id : null;
}
function toast(msg, kind) { try { _ctx.toast && _ctx.toast(msg, kind); } catch (e) {} }

/* ══ THE PANEL'S PAYLOAD ═══════════════════════════════════════════════════
   Everything the row prints is built HERE, live, and every claim carries the
   thing it was derived from. ui.js computes nothing. */
function available(cat, zoneId) {
  const rows = [];
  for (const s of specsFor(cat)) {
    const bag = BAGS[s.id] || [];
    const uniq = bag.filter((v, i, a) => a.indexOf(v) === i);
    const reach = reachOf(s.id);
    /* 🔬 THE PLACEBO MARK. `zoneId` is what the brush actually has on it, so
       this is answered for the pairing the player is about to paint and not
       for the family in general — the same spec is a placebo on one zone of a
       family and a real district on the next. null everywhere the question
       cannot be answered (no zone on the brush, no /src/zoning, no ladder), and
       ui.js renders null as an ordinary chip: no claim, no mark. */
    const diff = zoneId ? differsOn(s.id, zoneId) : null;
    const held = store.count((v, k) => v === s.id && !unlocked(v));
    rows.push({
      id: s.id, ico: s.ico, short: s.short, name: s.name, desc: s.desc,
      mythic: !!s.mythic, lvl: s.lvl | 0,
      empty: !bag.length,
      locked: !unlocked(s.id),
      node: blockedBy(s.id),
      tenants: uniq.map(nameOf),
      /* null ⇒ unanswerable. [] ⇒ answerable and the answer is "it changes
         nothing on this zone, at any land value". Otherwise: the bands on
         which it does change what develops. `realOn` is the other half of the
         sentence — the zones in this family where it IS a district. */
      differs: diff ? diff.slice() : null,
      inert: false, /* TEMPORARY REGRESSION — pre-fix behaviour, reverted below */
      /* How many rungs there are to differ ON, so the panel can say "only on
         Established land" rather than making the player count. */
      bandsTotal: (() => { const r = knownLadder(); return r ? r.length : null; })(),
      realOn: (diff && !diff.length) ? realZonesFor(s.id) : null,
      /* Tiles carrying this spec that the tree is HOLDING (see the header).
         Printed rather than hidden: a player whose save arrived with a locked
         district has to be able to see that the tiles are still theirs. */
      heldTiles: held,
      /* null ⇒ /src/landvalue is not loaded and NO floor is claimed. An empty
         array ⇒ it IS loaded and says no band in this city takes any of it. */
      reach: reach ? reach.map((b) => ({ id: b.id, ico: b.ico, name: b.name })) : null,
      floor: (() => { const f = reach && reach[0]; return f ? { id: f.id, ico: f.ico, name: f.name } : null; })(),
      tiles: store.count((v) => v === s.id),
    });
  }
  return rows;
}

/* ══ 🃏 THE CARD SEAM ══════════════════════════════════════════════════════
   ◄◄ THE HAND-OVER POINT FOR THE NEXT ROUND ◄◄
   ----------------------------------------------------------------------------
   WHAT THIS IS: a read-only REPORT of the city's mythic districts and the
   Ouroboros tiles standing inside them, in plain numbers and plain strings.

   WHAT IT DELIBERATELY IS NOT, AND WHY IT MUST STAY THAT WAY:
     ✗ It does not import, call or look for `MythicBridge`, `MythicCityBridge`,
       `Profile`, `Corp` or `Forge`. Those are top-level `const` in the main
       app and are invisible to an ES module (CLAUDE.md's globals trap, which
       has already cost this project real time twice).
     ✗ It pays nobody. `MythicEconomy.cardOutput()`'s header states the rule and
       it applies verbatim here: a figure produced inside the city that credits
       a player is a second, unaudited faucet — the shape of the retired Cinder
       Forge. What the Foundation Reserve, a season metric or a leaderboard does
       with these numbers is a decision for the host's side of the bridge, next
       to `window.cityCardOutput` where `FoundationReserve` and `Profile`
       actually live.

   HOW THE NEXT ROUND WIRES IT, in one line each and in this order:
     1. node-city: `B.pushDistrictReport = async (r) => …` beside
        `B.pushCardOutput` (:2098), pushed on the SAME economic-day edge from
        `ecoDailyClose()` so the volume and the districts that made it are one
        report about one day.
     2. main app: `window.cityCardDistricts = function (r) { … }` beside
        `window.cityCardOutput` (public/index.html :208251), and BOUND whatever
        it does there — that function is where the caps and the ceiling live.
   ══════════════════════════════════════════════════════════════════════════ */
function cardSeam() {
  if (!mounted) return { ok: false, why: 'districts not mounted' };
  const g = _ctx.game || {};
  const tiles = g.tiles || {};
  const out = { ok: true, districts: {}, chain: {}, note: 'read-only measurement; nothing here crosses the bridge or pays anybody' };
  for (const s of SPECS) {
    if (!s.mythic) continue;
    /* 🔒 HELD TILES ARE NOT A DISTRICT AND ARE NOT COUNTED HERE. This report is
       the hand-over to whatever the host decides to do with a card district,
       and a tile whose specialisation the tree has not opened develops as its
       plain zone — counting it would let a save file inflate a figure the next
       round is going to pay against. Same rule as `stats().per`, one reason. */
    const keys = store.keysOf(s.id).filter((k) => unlocked(store.get(k)));
    let built = 0, level = 0;
    for (const k of keys) { const t = tiles[k]; if (t && t.type) { built++; level += (t.lvl | 0) || 1; } }
    out.districts[s.id] = { name: s.name, tiles: keys.length, built, levels: level };
  }
  /* The Ouroboros tiles, counted wherever they stand — INSIDE a mythic
     district and outside it, kept apart. A city that prints cards from three
     scattered print works is a different city from one with a card district,
     and folding the two together would hide exactly the thing this layer
     exists to create. The stage names are ECO_BUILDING_MAP's, not this
     module's: papermill → cardStock, printworks → printedCards, shop →
     boosterPacks, depot → packagingMaterial. */
  const STAGE = { papermill: 'cardStock', printworks: 'printedCards', shop: 'boosterPacks', depot: 'packagingMaterial' };
  for (const t in STAGE) out.chain[STAGE[t]] = { tile: t, total: 0, inDistrict: 0 };
  for (const k in tiles) {
    const t = tiles[k]; if (!t || !STAGE[t.type]) continue;
    const row = out.chain[STAGE[t.type]];
    row.total++;
    const sid = store.get(k);
    if (sid && SPEC_BY_ID[sid] && SPEC_BY_ID[sid].mythic && unlocked(sid)) row.inDistrict++;
  }
  return out;
}

/* ══ DIAGNOSTICS ═══════════════════════════════════════════════════════════ */
function stats() {
  /* 🔴 `per` IS THE CENSUS OF DISTRICTS THIS MODULE WILL ACT ON, AND THAT IS A
     LOAD-BEARING DEFINITION RATHER THAN A DETAIL OF PRESENTATION.
     /src/progression's `adopt()` reads this key and grants the node behind any
     specialisation it finds — its comment says a spec on the map "can only have
     come from an unlocked node", which was false for one round because the SAVE
     path writes the store without asking the tree (see the header). Three
     strings in a hand-edited save bought 15 nodes and 40 ⬡ of a 74 ⬡ tree.
     Filtering here is what makes that sentence true, in the one place both
     readers already look. A held district is reported separately as `heldPer`,
     which nothing outside diagnostics reads and which no consumer may treat as
     evidence of anything except that a save carried it in. */
  const per = {}, heldPer = {};
  const M = store.all();
  for (const k in M) {
    const id = M[k];
    const into = unlocked(id) ? per : heldPer;
    into[id] = (into[id] || 0) + 1;
  }
  let held = 0;
  for (const id in heldPer) held += heldPer[id];
  const g = _ctx.game || {}, tiles = g.tiles || {};
  let built = 0;
  for (const k in M) if (tiles[k]) built++;
  return { specialised: store.size(), built, per, heldPer, held, armed: _armed,
           shelved: store.shelved(), lockedWrites: _lockedWrites };
}

/* The self-check, reported ONLY when it fails — a check that logs on success is
   one everyone learns to scroll past. RUN AT BOOT, one line after
   `MythicLandValue.verify()` in node-city, in the same idiom: it prints nothing
   on a healthy city and names the defect on a broken one.
   It asks the four questions that can make a specialisation silently decorative:
     · has a spec lost its whole bag?
     · is any id in a shipped mix admitted by NO band at all? (then it can never
       develop anywhere, at any land value, and the chip is a lie)
     · 🔬 CAN A CHIP THIS PANEL OFFERS BUILD ANYTHING *DIFFERENT* FROM THE ZONE
       IT SITS ON? For one round this file asked only "can it build anything",
       which 🔬 Technology on 🧠 Office park passes and is a placebo at: same
       single id, same height, every band. The check below asks `available()` —
       the function the panel actually draws from, not a re-derivation of it —
       for every (spec, zone) pairing in the catalogue, and fails if a row comes
       back claiming to change something it cannot. It is the check that would
       have caught that defect on the day it shipped.
     · are any specialisations on the map HELD by the tree? A locked id cannot
       be written by arm(), onZone() or _set(), so one in the store arrived
       through a save. It is not erased (see the header) and it is inert, but it
       is never silent: it is counted here.
   ⚠ The band answer is progression-filtered, so a build where the player has
     researched nothing reports the locked ids as unreachable. That is why this
     runs on demand and its finding is worded as "no band admits it TODAY". */
function verify() {
  if (!mounted) return { ok: false, why: 'not mounted' };
  const problems = [], held = [];
  const rows = ladder();
  /* 🔴 TWO SETS, NOT ONE, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT.
     `admitted` is what a band will take RIGHT NOW; `known` also counts what it
     would take if the research tree opened it (/src/landvalue publishes that as
     `tenants.locked` precisely so "nothing is developing" always has an answer).
     A spec that no band would EVER take is a defect in this file — a chip that
     can never build anything, which is the failure this project has already
     paid for twice. A spec that is only held back by research is a normal
     mid-game state and must not be reported as a defect, or the one real
     finding would sit in a list of false ones and nobody would read it. It is
     reported separately, as `researchHeld`. */
  const admitted = new Set(), known = new Set();
  if (rows) for (const b of rows) {
    for (const t of ((b.tenants && b.tenants.all) || [])) { admitted.add(t); known.add(t); }
    for (const t of ((b.tenants && b.tenants.locked) || [])) known.add(t);
  }
  for (const s of SPECS) {
    const bag = BAGS[s.id] || [];
    if (!bag.length) { problems.push(s.id + ': empty mix — offered as unavailable'); continue; }
    if (!rows) continue;
    const uniq = bag.filter((v, i, a) => a.indexOf(v) === i);
    if (!uniq.some((t) => known.has(t)))
      problems.push(s.id + ': no band admits any of ' + uniq.join(', ') + ' at any land value, researched or not');
    else if (!uniq.some((t) => admitted.has(t)))
      held.push(s.id + ': develops nothing until the tree opens one of ' + uniq.join(', '));
  }
  /* 🔬 THE PLACEBO CHECK, ASKED OF THE PANEL'S OWN PAYLOAD. `available(cat, id)`
     is what ui.js renders; `differsOn()` is what decides the mark. Cross-checked
     rather than re-derived, so this fails if the offer path ever stops carrying
     the mark — which is the only way the placebo can come back. */
  const placebo = [];
  const zs = zoneList();
  if (zs) for (const zd of zs) {
    if (!FAMILIES[zd.cat]) continue;
    for (const r of available(zd.cat, zd.id)) {
      if (r.empty) continue;                      // already reported above, as an empty mix
      const d = differsOn(r.id, zd.id);
      if (!d) continue;                           // unanswerable — no claim either way
      if (d.length) continue;                     // it changes something somewhere
      const marked = r.inert === true;
      placebo.push(r.id + ' on ' + zd.id + ': same tenants and same height as the zone at every band' +
        (marked ? ' — offered, and marked as changing nothing' : ' — OFFERED AS AN ORDINARY CHIP'));
      if (!marked) problems.push(r.id + ' on ' + zd.id + ': offered as a chip that changes what develops, and it does not — ' +
        'the zone builds the same tenants at the same height at every band');
    }
  }
  /* 🔒 Districts on the map the tree has not opened. Counted live off the store
     rather than accumulated in a counter, so researching the node makes the
     finding disappear by itself — the same reason every other answer in this
     module is asked rather than mirrored. */
  const st = stats();
  const heldIds = Object.keys(st.heldPer || {});
  if (heldIds.length) problems.push(st.held + ' specialisation(s) on the map are LOCKED and are being held inert (' +
    heldIds.map((k) => k + '×' + st.heldPer[k]).join(', ') + ') — the write seams refuse a locked id, so these arrived in a save ' +
    'or their node has been re-costed. Nothing is erased and nothing is being acted on.');
  if (_lockedWrites) problems.push(_lockedWrites + ' locked specialisation write(s) were refused at the store — a caller is bypassing arm()');
  return { ok: !problems.length, problems, researchHeld: held, placebo,
           heldOnMap: heldIds.map((k) => k + '×' + st.heldPer[k]), ladder: !!rows, stats: st };
}

/* ══ MOUNT ═════════════════════════════════════════════════════════════════ */
export function mount(ctx) {
  if (mounted) return true;
  _ctx = ctx || {};
  BUILDINGS = _ctx.BUILDINGS || {};

  for (const p of validate()) console.warn('[Districts] catalogue: ' + p);

  /* ⚠ COMPILED AGAINST BUILDINGS ONLY, NOT AGAINST THE BAND LADDER.
     The obvious second check — "drop any id no band admits" — was written and
     then removed: `MythicLandValue.bands()` is filtered by the research tree,
     so compiling against it at BOOT would permanently delete every building the
     player has not researched YET from every mix. The reachability question is
     asked live instead, per draw, in reachOf()/verify(). */
  const c = compile(BUILDINGS, null);
  BAGS = c.bags;

  store = makeStore();
  store.shelfRegister(_ctx.saveSoon);

  try { mountUI(API); } catch (e) { console.warn('[Districts] panel row not mounted (non-fatal):', e); }

  mounted = true;
  try { if (typeof window !== 'undefined') window.MythicDistricts = API; } catch (e) {}
  return true;
}

/* ── after loadState: drop specialisations whose land changed use ───────────
   ⚠ AND *NOT* THE ONES THE TREE HAS NOT OPENED. Dropping a locked id here was
     the obvious fix for the save door and it was rejected on purpose — the
     header carries the argument. What happens instead is that they are counted
     and said out loud, once, in the city log: the player whose save arrived with
     a held district can see that the tiles are still theirs, and the player who
     hand-edited one in can see that it is doing nothing. */
function afterLoad() {
  if (!mounted) return { dropped: 0 };
  store.shelfRegister(_ctx.saveSoon);
  const dropped = store.reconcile(
    (id) => (SPEC_BY_ID[id] ? SPEC_BY_ID[id].cat : undefined),
    (k) => catOfZone(zoneAtKey(k)));
  const held = store.count((id) => !!SPEC_BY_ID[id] && !unlocked(id));
  if (held) {
    try {
      _ctx.logEvent && _ctx.logEvent('city', '🔒 ' + held + ' district specialisation' + (held === 1 ? '' : 's') +
        ' in this save ' + (held === 1 ? 'is' : 'are') + ' not researched yet — ' + (held === 1 ? 'it is' : 'they are') +
        ' held: the land develops as its plain zone until the node opens, and nothing has been erased.');
    } catch (e) {}
  }
  if (dropped) {
    try {
      _ctx.logEvent && _ctx.logEvent('city', '🏙 ' + dropped + ' district specialisation' + (dropped === 1 ? '' : 's') +
        ' dropped — the land under ' + (dropped === 1 ? 'it is' : 'them is') + ' no longer zoned for that family.');
    } catch (e) {}
  }
  try { const Z = ZON(); if (Z && Z.sync) Z.sync(); } catch (e) {}
  return { dropped, held, specialised: store.size() };
}

/* ══ THE PUBLIC API ════════════════════════════════════════════════════════
   Every call is safe before mount, during a sibling module's 404, and on a tile
   that does not exist. Nothing here throws. */
const API = {
  ready: () => mounted,
  mount, afterLoad,

  /* the /src/zoning seams — the only three it calls on the hot path */
  mixFor, levelFor, onZone, refusal, markAt,

  /* the brush */
  arm, armed: () => _armed, armedFor,

  /* THE PANEL SEAM. /src/zoning owns the container and calls this once per
     draw with the zone on the brush; this module owns everything inside it.
     A zone family with no specialisations (residential) empties the container
     and the panel is exactly what it was before this module existed. */
  renderSpecRow: (el, zoneId) => {
    try { return renderInto(el, zoneId, { cat: catOfZone(zoneId) }); }
    catch (e) { console.warn('[Districts] row render (non-fatal):', e); return false; }
  },

  /* reading */
  specAt: (x, z) => (mounted ? store.get(keyOf(x, z)) : null),
  specDef: (id) => SPEC_BY_ID[id] || null,
  available, floorOf, reachOf,
  /* 🔬 The placebo question, exposed so a driver can ask it the way the panel
     asks it. `differsOn(spec, zone)` → the bands on which the pairing changes
     what develops (null ⇒ unanswerable); `inertOn` is the yes/no. */
  differsOn, inertOn, realZonesFor,
  unlocked, blockedBy,
  families: () => FAMILIES,

  /* 🃏 the hand-over point — see cardSeam()'s header before wiring anything */
  cardSeam,

  stats, verify,
  SPECS, SPEC_BY_ID, FAMILIES,
  /* ⚠ TEST SEAM. Writes a specialisation with the family check and the
     progression check intact — a driver still cannot paint a locked district,
     which is the thing worth being unable to do by accident. */
  _set: (x, z, id) => onZone(x, z, zoneAtKey(keyOf(x, z)), id),
};

try {
  if (typeof window !== 'undefined') {
    window.MythicDistricts = API;
    if (typeof window.__ncDistrictsReady === 'function') window.__ncDistrictsReady(API);
  }
} catch (e) {}

export default API;
