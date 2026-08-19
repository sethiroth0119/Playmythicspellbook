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
  const id = store.get(keyOf(x, z));
  const s = id && SPEC_BY_ID[id];
  if (!s) return null;
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
function available(cat) {
  const rows = [];
  for (const s of specsFor(cat)) {
    const bag = BAGS[s.id] || [];
    const uniq = bag.filter((v, i, a) => a.indexOf(v) === i);
    const reach = reachOf(s.id);
    rows.push({
      id: s.id, ico: s.ico, short: s.short, name: s.name, desc: s.desc,
      mythic: !!s.mythic, lvl: s.lvl | 0,
      empty: !bag.length,
      locked: !unlocked(s.id),
      node: blockedBy(s.id),
      tenants: uniq.map(nameOf),
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
    const keys = store.keysOf(s.id);
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
    if (sid && SPEC_BY_ID[sid] && SPEC_BY_ID[sid].mythic) row.inDistrict++;
  }
  return out;
}

/* ══ DIAGNOSTICS ═══════════════════════════════════════════════════════════ */
function stats() {
  const per = store.per();
  const g = _ctx.game || {}, tiles = g.tiles || {};
  let built = 0;
  for (const k in store.all()) if (tiles[k]) built++;
  return { specialised: store.size(), built, per, armed: _armed,
           shelved: store.shelved(), lockedWrites: _lockedWrites };
}

/* The self-check, reported ONLY when it fails — a check that logs on success is
   one everyone learns to scroll past. It asks the two questions that can make a
   specialisation silently decorative:
     · is any id in a shipped mix admitted by NO band at all? (then it can never
       develop anywhere, at any land value, and the chip is a lie)
     · has a spec lost its whole bag?
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
  if (_lockedWrites) problems.push(_lockedWrites + ' locked specialisation write(s) were refused at the store — a caller is bypassing arm()');
  return { ok: !problems.length, problems, researchHeld: held, ladder: !!rows, stats: stats() };
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

/* ── after loadState: drop specialisations whose land changed use ─────────── */
function afterLoad() {
  if (!mounted) return { dropped: 0 };
  store.shelfRegister(_ctx.saveSoon);
  const dropped = store.reconcile(
    (id) => (SPEC_BY_ID[id] ? SPEC_BY_ID[id].cat : undefined),
    (k) => catOfZone(zoneAtKey(k)));
  if (dropped) {
    try {
      _ctx.logEvent && _ctx.logEvent('city', '🏙 ' + dropped + ' district specialisation' + (dropped === 1 ? '' : 's') +
        ' dropped — the land under ' + (dropped === 1 ? 'it is' : 'them is') + ' no longer zoned for that family.');
    } catch (e) {}
  }
  try { const Z = ZON(); if (Z && Z.sync) Z.sync(); } catch (e) {}
  return { dropped, specialised: store.size() };
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
