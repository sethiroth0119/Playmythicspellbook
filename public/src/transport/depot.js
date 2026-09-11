/* ════════════════════════════════════════════════════════════════════════════
   🚛 THE FREIGHT DEPOT, READ FROM THE TRANSPORT SIDE.
   ----------------------------------------------------------------------------
   Spec: docs/transport-company-design.md §2b. One building's worth of answers,
   and nothing else: WHERE a carrier's routes start (origin), HOW FAR it may
   quote (reach), HOW MANY hauls it may run at once (bays), and HOW MANY rigs
   the yard can park (fleet cap).

   🔴 WHY THIS FILE HAS TO EXIST — the catalog entry alone is INERT.
   /src/city reads exactly four keys off a def's `effect(lv)`: cityBudget()
   takes `power`, `workers`, `storage` and `population`, and drops everything
   else on the floor. `bays`, `fleetCap` and `radius` are none of those, so the
   city never looks at them. This is not a theory about the code — powerplant's
   authored `radius: 4` has been dead in exactly this way since the catalog
   shipped. So the transport side reads the placed rows and calls the def's own
   effect() ITSELF. Placing the building does nothing until something on this
   side asks; this file is that something.

   🔴 production.data.js IS THE AUTHORITY FOR THE LEVEL TABLE. `effect: lv =>
   ({ bays: 2*lv, fleetCap: 4*lv, radius: 3+lv })` is the single definition of
   those three numbers, and every one of them below comes out of a CALL to it.
   There is no table in this file, no `2 * level`, and there must never be one:
   index.js states the cost of the alternative in its own words — "a second copy
   of that table is how a UI ends up promising four bays while dispatch enforces
   two". If the catalog cannot be read, this file returns ZERO. It never
   substitutes a remembered number, because a remembered number is indis-
   tinguishable from a real one on screen and is wrong precisely when the
   catalog has changed.

   ⚠ AND THERE IS A SECOND COPY: THE SERVER'S, WHICH IS THE ONE THAT BINDS.
   A migration cannot import an ES module, so sql/038 states the same ladder
   again in SQL — but it states it ONCE, in transport_caps() (a `language sql`
   security-definer function): reach `3 + depot_level`, bays `least(2 *
   depot_level, max_bays)`, fleet_cap `least(4 * depot_level, max_fleet_rigs)`.
   ⚠ AN EARLIER VERSION OF THIS PARAGRAPH SAID transport_quote() AND
   transport_dispatch() EACH COMPUTED THEIR OWN, AS PLPGSQL LITERALS. That was
   the migration's FIRST DRAFT, and it is a rejected design recorded in
   transport_caps()'s own header — those expressions "were written out at four
   separate call sites in the first draft", and "Four copies of a formula is
   four authorities". The claim is corrected here rather than left to send the
   next editor to two call sites that no longer decide anything.

   🔴 THIS FILE IS A PREVIEW OF THE SERVER'S ANSWER AND CANNOT BE MORE THAN
   THAT, BECAUSE THE SERVER'S FORMULA TAKES AN INPUT NOTHING HERE PROVIDES.
   transport_caps() reads `transport_companies.depot_level` — a column, declared
   `int not null default 1 check (depot_level between 1 and 3)`. Nothing on the
   server reads production.data.js. Two consequences follow, and both were
   checked against the shipped code rather than reasoned about:

     SHAPE. The server's formula is per-CARRIER, off ONE depot_level. It has no
     concept of "two yards" and cannot acquire one by being called twice. bays()
     and radius() below copy that shape (the best yard, never a sum).
     fleetCap() deliberately does NOT — its pinned contract is the sum — and the
     divergence that creates is REACHABLE, measured, and reported rather than
     hidden. The whole argument is on fleetCap().

     VALUE. Nothing in this build ever WRITES depot_level. The only client path
     that could is setTariff() in contracts.js, and it calls transport_set_sheet
     with `p_depot_level: null`; that function then computes `v_lvl :=
     greatest(1, least(3, coalesce(p_depot_level, v_co.depot_level)))`, so a
     null keeps whatever is already stored — and nothing stores anything else.
     Every carrier alive is therefore depot_level 1 on the server no matter what
     the yard says here, and an upgraded yard's extra bays and reach are a
     client-side belief until a level-send path ships. Not this file's bug to fix
     (depot.js never talks to Supabase) but very much its job to SAY, rather
     than let a player meet it as a refused haul. depotReady()'s `drift` field
     is where it lands on screen.

   ⚠ SO "THIS FILE AGREES WITH THE SERVER" IS A CLAIM NO EXPORT HERE CAN MAKE.
   An earlier version of this header made it anyway — "Where the two could
   disagree this file is written to agree with the server (see bays() and
   fleetCap())" — while fleetCap()'s own body conceded four hundred lines lower
   down that it does the opposite. A header that contradicts the function it
   cites is worse than no header: it is read first and it is read as verified.
   Each export now states which half of the server's answer it copies, the
   formula's SHAPE or its VALUE, and not one of them copies both.

   📎 HOW THIS FILE CITES OTHER FILES, AND WHY IT STOPPED USING BARE COLONS.
   Citations here are `identifier (file)`: the identifier IS the claim, so grep
   it and you land on the thing. A line number appears only where the target has
   no name to grep, and is marked as a hint. rigs.data.js wrote this rule up
   first, in its own blood — "eighteen sites as exact colons… every one was
   wrong by 247-281 lines by the time the file was saved" — and this file has
   since paid for it twice more:
     · It cited sql/038 as `:628`, `:813`, `:1088`, `:1309`. The migration grew
       ~800 lines while this feature was being built and all four are now wrong.
       Worse than wrong: `:813` was cited as the line that enforces the fleet
       cap, and by then that clause had been DELETED. See fleetCap().
     · It is cited BY colon from two sibling files, and growing from 182 lines
       to what you are reading invalidated both:
         index.js  — "depot.js:296 documents a live double-count trap".
                     True; that trap is in fleetCap()'s header, below.
         routes.js — "depot.js:272-273 expects both inReach(bestDepot(), …) and
                     quote({ depot: bestDepot() }) to work".
                     True, and both do — driven against that module, with the
                     numbers, in depots()'s header below. That header also used
                     to state WHY in terms of those two calls, and was wrong
                     about it; the correction is there too.
       Both sentences are right about this file and wrong about where to look.
       Neither file is editable from here, so the redirect lives on this side;
       the fix on theirs is to name fleetCap() and depots() instead of a line.

   🔴 THIS FILE ONLY READS THE PLACED ARRAY. Nothing here removes, reorders,
   rewrites or persists a placed row — the same guarantee chainRank() in
   production.state.js makes in the same words, and for the same reason: "This
   project deleted paid-for buildings four rounds running."
   ⚠ PERMANENCE, and it is the reason `freightdepot` may never be renamed:
   ensureState() filters s.placed down to rows whose defId still resolves
   through cityProdDef() and WRITES THE FILTERED ARRAY BACK. The moment the
   catalog entry is missing — renamed, deleted, or just absent from a stale
   bundle a service worker served against a fresh save — every placed depot is
   erased permanently, after the player paid for it. DEPOT_DEF_ID below and the
   `id` in production.data.js are one value in two places; they change together
   or not at all, and the honest answer is not at all.

   🔴 TOTAL, AND NEUTRAL WHEN IT KNOWS NOTHING. Every export returns a typed
   value — 0, null, [], or {ok:false, why, fix} — from BOTH its no-data path and
   its catch. No bridge, no city module, no placed rows, a placed row that is a
   string, a def whose effect() throws: all of them are DESIGNED states, not
   error paths. This module is imported on every page load of a 215k-line app; a
   throw here over a freight yard would take the game down, and a game is a
   product while a depot panel is a feature.

   ⚠ NO REFUSAL IS SILENT, AND NONE OF THEM MAY NAME THE WRONG CAUSE.
   depotReady() never returns a bare false: every `ok:false` carries a `why` the
   UI is required to print AND a `fix` naming the concrete thing to go and do —
   production.state.js's rule, in its own words: "An invisible halt reads as a
   bug." A greyed-out Quote button with no sentence next to it is the least
   debuggable thing a player can be shown. The harder half is that a refusal
   naming the WRONG cause is worse still, because it gets obeyed: half of
   depotReady()'s eight checks exist for no other purpose than keeping "go and
   build a Freight Depot" off the screen of a player who already owns one. Read
   its check-order note before adding a ninth or reordering an existing one.

   ⚠ NOTHING HERE TALKS TO SUPABASE. No table read, no RPC, no await, no clock.
   Contracts, fleets and money are index.js's and sql/038's business; this file
   answers questions about a building and is synchronous and pure with respect
   to everything except the two modules it imports.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Nothing in this file touches the legacy
   file's top-level `const` bindings. They are global LEXICAL bindings and NOT
   properties of the global object, so an ES module genuinely cannot see them
   and the obvious `window.…` read is `undefined` however global they look. This
   has cost the project real time twice. The city module is reached the one way
   that works — module → window, via `bridge().cityProd()`, which hands back
   `window.MythicCityProduction` or null — and index.html's own legacy→module
   call `_cityProdStorage()` (index.html, ~39414 — a scrolling hint, per the
   citation rule above) is the shape every accessor here copies: type-check the
   method, use the value, return the neutral on throw.
   ════════════════════════════════════════════════════════════════════════════ */

import { bridge, bridgeReady } from './transport.bridge.js';
/* ⚙ THE GARAGE PERK'S TABLE IS rigs.data.js's, AND IT IS ASKED FOR, NOT COPIED.
   fleetSlotBonus() is where the ratified mapping lives (tier 1 → +1 slot, tier
   2 → +1 run/day, tier 3 → both, best-one-applies, never summed). It also
   already handles the junk-input case this file needs — see fleetCap(). A local
   `tier === 1 ? 1 : 0` here would be a second statement of what a real-money
   SKU delivers, which is the one kind of number nobody should be able to change
   in two places. */
import { fleetSlotBonus } from './rigs.data.js';

/* 🔒 ONE VALUE, TWO FILES. Must equal production.data.js's `id: 'freightdepot'`
   exactly and forever — see the permanence note in the header. Exported so no
   caller has to spell it, and so a rename would be one grep rather than a
   silent mismatch that presents as "the player has no depot". */
export const DEPOT_DEF_ID = 'freightdepot';

/* The neutral effect. Returned as a FRESH OBJECT every time, never a shared
   frozen constant: callers in this feature mutate what they are handed —
   index.js's depotBlock() adds the Garage slot bonus straight onto the block it
   holds — and a shared object would accumulate that across renders until the
   yard reported a fleet cap that grew every repaint. */
function emptyEffect() { return { bays: 0, fleetCap: 0, radius: 0 }; }

/* Non-negative integer or 0. `| 0` alone is not enough: it turns 1e10 into
   1410065408 and NaN into 0 silently, and a level read out of a save file is
   exactly the kind of number that can be neither. */
function int(n) {
  const v = Math.floor(Number(n));
  return (Number.isFinite(v) && v > 0) ? v : 0;
}

/* 🏭 The city module, or null. Guarded twice on purpose: `cityProd` may be
   absent from a partially-built bridge (the bridge's own standing warning is
   that a capability added on one side only works for a signed-in player on a
   live build and throws for everyone else), and the value it returns may be
   anything at all — a half-registered module, or an object from a build where
   `placed` was renamed. Duck-typing the ONE method every caller here needs is
   the same test index.html's _cityProdStorage() makes before it trusts the
   module for the storage cap. */
function cityProd() {
  try {
    const b = bridge();
    const mp = (b && typeof b.cityProd === 'function') ? b.cityProd() : null;
    return (mp && typeof mp.placed === 'function') ? mp : null;
  } catch (e) { return null; }
}

/* 🏙 IS THE CITY MODULE LIVE, OR MERELY REGISTERED? — true / false / null,
   and the whole reason this helper exists is that those are three different
   answers and depotReady() used to collapse them into one.

   🔴 REGISTERED IS NOT LIVE, AND THE GAP IS AN ENTIRE CITY. /src/city/index.js
   registers window.MythicCityProduction at import, unconditionally — the api
   object exists the moment the script runs. What it CANNOT do by itself is
   read a save: every accessor on it calls host(), host() calls makeHost(), and
   makeHost() returns null when `window.MythicCityBridge` is absent (the
   globals trap again — the module is not allowed to reach for `const Profile`,
   so index.html must hand it a bridge). In that state `placed()` returns [],
   `budget()` returns null, `build()` returns {ok:false,'no bridge'} — and a
   city holding six buildings is indistinguishable, row for row, from an empty
   one. Every symptom of "you own nothing" and none of the cause.

   🔴 THE DISCRIMINATOR WAS PUBLISHED AND THIS FILE WAS NOT ASKING FOR IT.
   `ready: () => !!makeHost()` has been on the api since the module shipped
   (the `ready:` entry on /src/city/index.js's api object). Without it
   depotReady() ran straight into its "no depot"
   branch and told a player who owns a yard to go and build one — see the
   check-order note on depotReady(), where the cost of that sentence is written
   up. A throw from ready() counts as NOT live, deliberately: ready() is
   `!!makeHost()` and makeHost() is what every read on that module calls first,
   so anything that throws here throws there too.

   The `budget()` fallback is for a bundle that predates ready(). It is the
   same signal by another route — `budget: () => { const h = host(); return h ?
   cityBudget(h) : null; }`, the `budget:` entry on that same api object, so a
   null is exactly a null host — and it is why the unknown arm below is very
   nearly unreachable.
   ⚠ UNKNOWN RETURNS null AND THE CALLER PROCEEDS. Refusing on "I could not
   tell" would trade one wrong sentence for a different wrong sentence, and
   this one would fire for every player on a build where both probes are gone.
   The honest ranking is: refuse when we KNOW the city is blind, otherwise
   report what the rows say. */
function cityLive(MP) {
  if (!MP) return false;
  if (typeof MP.ready === 'function') {
    try { return MP.ready() === true; } catch (e) { return false; }
  }
  if (typeof MP.budget === 'function') {
    try { return MP.budget() !== null; } catch (e) { return null; }
  }
  return null;
}

/* The catalog def, by either of the two routes the city module publishes.
   cityProdDef() is the intended one; the CITY_PRODUCTION scan is the fallback,
   because that api object belongs to /src/city/index.js and is free to change
   shape without asking this feature. If BOTH are gone the answer is null and
   every caller degrades to zero — an unreadable catalog must present as "no
   depot", never as invented numbers. */
function depotDef() {
  try {
    const MP = cityProd();
    if (!MP) return null;
    if (typeof MP.cityProdDef === 'function') {
      const d = MP.cityProdDef(DEPOT_DEF_ID);
      if (d && typeof d === 'object') return d;
    }
    const list = MP.CITY_PRODUCTION;
    if (Array.isArray(list)) {
      for (const d of list) if (d && d.id === DEPOT_DEF_ID) return d;
    }
    return null;
  } catch (e) { return null; }
}

/* 📍 ORIGIN IS THE NODE, NOT THE TILE — and that is a fact about /src/city, not
   a preference. build() writes x/y/z/rotation_y/scale straight out of its `at`
   argument with no occupancy test, `footprint {w,h}` is authored on every entry
   and read by nothing, and the panel's bind() always calls build(id, {}) — so
   every building a player owns is currently standing at 0,0,0. Placement
   coordinates are decoration today; the map position of a yard is the node its
   city stands in, which is a real position because sql/033 gives every node its
   own city.

   ⚠ THERE IS ONE CITY, SO EVERY DEPOT SHARES ONE ORIGIN, and the design doc's
   "more depots is the natural sink for a growing company" does NOT fall out of
   today's data model: the city module holds a single placed array and the
   bridge exposes a single camp node, so a second yard buys parking and city
   draw — not reach. That is written down rather than quietly implemented as if
   it were already true. Each row from depots() carries its own `nodeId`, so
   when a city-per-node does ship, this resolver is the only thing that
   changes and every consumer keeps working. */
function originNodeId() {
  try {
    const b = bridge();
    const id = (b && typeof b.campNodeId === 'function') ? b.campNodeId() : null;
    return (id === null || id === undefined) ? '' : String(id);
  } catch (e) { return ''; }
}

/* A placed row's level, clamped to what the building actually offers.
   Two reasons, and neither is defensive decoration. (1) The level arrives from
   a save blob, and this project has shipped silent save bugs three times — an
   uncapped `level: 99` would report reach 102 and 198 bays and the panel would
   cheerfully quote routes across the planet. (2) sql/038 bounds the level it
   stores with `greatest(1, least(3, …))`, so anything above maxLevel is a claim
   the server will flatten anyway; clamping here means the two agree BEFORE the
   player is shown a number rather than after they are refused. */
function levelOf(row, def) {
  const raw = int(row && row.level) || 1;
  const max = int(def && def.maxLevel) || raw;
  return Math.min(raw, max);
}

/* One call to the catalog's own effect(), normalised. Everything this file
   reports about a level goes through here, so there is exactly one place that
   could ever be wrong about it. */
function effectOf(def, level) {
  try {
    if (!def || typeof def.effect !== 'function' || level <= 0) return emptyEffect();
    const e = def.effect(level) || {};
    return { bays: int(e.bays), fleetCap: int(e.fleetCap), radius: int(e.radius) };
  } catch (e) { return emptyEffect(); }
}

/* 📥 THE ONE READ OF s.placed, AND IT REPORTS WHETHER THE READ WORKED.
   Returns { ok, rows }. `ok:false` means the read FAILED — MP.placed() threw,
   or handed back something that is not an array — which is a DIFFERENT FACT
   from `ok:true` with an empty array, which means the player owns nothing.

   🔴 COLLAPSING THOSE TWO IS THE BUG THIS FILE KEEPS FINDING IN ITSELF.
   depots() collapses them on purpose, because a caller asking "which yards?"
   has the same answer either way. depotReady() must not, because "the read
   failed" printed as "you have no depot" is the same wrong sentence the
   city-inert branch exists to prevent, arriving by a second route: driving the
   harness for this file, an MP whose placed() threw produced code 'no-depot'
   and "Build a Freight Depot in your city" for a save that had one. It is the
   same distinction contracts.js's rpcFail() draws on the Supabase side, where
   a `missing: true` refusal says "run sql/038" and an empty result says "no
   contracts": one asks the operator for something, the other asks the player,
   and printing either at the other is how a screen loses a person's trust.

   ⚠ IT IS ALSO THE ONLY placed() CALL PER ANSWER. depotReady() used to reach
   the array three times (depots(), bestDepot() → depots(), fleetCap() →
   depots()). That is not just triple work: placed() runs ensureState(), which
   REWRITES s.placed and calls host.setState() every time, and three reads are
   three snapshots that a save changing underneath could make disagree inside
   one answer. One read, one snapshot, one story. */
function placedRows(MP) {
  try {
    if (!MP || typeof MP.placed !== 'function') return { ok: false, rows: [] };
    const rows = MP.placed();
    return Array.isArray(rows) ? { ok: true, rows } : { ok: false, rows: [] };
  } catch (e) { return { ok: false, rows: [] }; }
}

/* The mapping, over an array somebody else has already read. Pure: no bridge
   access except the origin lookup, no writes, and a malformed row is SKIPPED —
   never repaired, never written back. See depots() for the row shape. */
function toDepots(rows, def) {
  if (!Array.isArray(rows) || !def) return [];
  const nodeId = originNodeId();
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    if (r.defId !== DEPOT_DEF_ID) continue;
    const level = levelOf(r, def);
    const e = effectOf(def, level);
    out.push({
      id: String(r.id || ''),
      level,
      nodeId,
      effect: e,
      /* Flat mirror for routes.js — same numbers, ONE effectOf() call, so the
         two views cannot disagree. `level` above is part of the same mirror.
         What it buys is measured in depots()'s header, and it is not what an
         earlier revision claimed: it keeps THIS catalog's radius the one
         resolveDepot() uses, rather than the `3 + level` that resolver falls
         back to computing for itself. */
      bays: e.bays, fleetCap: e.fleetCap, radius: e.radius,
    });
  }
  return out;
}

/* The tie rule, in ONE place because bestDepot() and depotReady() must never
   disagree about which yard the player is being told about. Highest level
   wins; ties break on PLACEMENT ORDER (first wins) rather than on anything
   derived, so the answer cannot flip between two identical depots from one
   render to the next and move the origin of every quote with it. */
function pickBest(list) {
  let best = null;
  for (const d of list) if (!best || d.level > best.level) best = d;
  return best || null;
}

/* The buildings' parking, summed. Shared by fleetCap() and depotReady() so the
   panel's headline number and the refusal's number come out of one loop — see
   the authority note on fleetCap() for what this sum does and does not mean. */
function sumFleetCap(list) {
  let n = 0;
  for (const d of list) n += int(d && d.fleetCap);
  return n;
}

/* ── The four questions ─────────────────────────────────────────────────── */

/* Every Freight Depot the player has standing, in PLACEMENT order — which is
   s.placed's own order, append-only in build(), and therefore stable between
   renders. This function only READS that array.

   THE ROW SHAPE CARRIES THE SAME NUMBERS TWICE, DELIBERATELY — but NOT for the
   reason this comment used to give. The pinned contract for this feature is
   nested (`effect: {bays, fleetCap, radius}`), while routes.js's resolveDepot()
   — the thing that actually decides reach — reads `nodeId`, `radius`, `level`
   and `bays` FLAT and knows nothing about `.effect`.

   🔴 CORRECTED CLAIM: A NESTED-ONLY ROW IS NOT REFUSED AS "no depot".
   This paragraph used to say that handing back only the nested shape would make
   `inReach(bestDepot(), …)` and `quote({ depot: bestDepot() })` resolve to
   `present: false` and be refused with "no depot". False, and false in this
   file's own favourite way — a claim about a neighbouring module that was
   reasoned about instead of run. `present` is decided by `nodeId` ALONE
   (resolveDepot()'s opening guard is the only branch that returns
   `present: false`), every row here carries one, and a row with no explicit
   radius falls through to that resolver's own documented step 2, `3 + level`
   — which every row here also carries. MEASURED against the
   real routes.js, a level-2 yard at node A on a four-node map:

       row handed to inReach()        A→B (1 hop)   A→FAR (3 hops)   quote()
       flat + nested (what ships)        true            true          ok
       nested only                       true            true          ok

   Identical, both routes, both entry points. So the mirror is not what keeps a
   haul from being refused, and it is the same failure the two 🔴 blocks inside
   fleetCap() correct, arriving through a third door. What it actually buys is
   narrower, and both halves were driven rather than argued:

     1. THE LADDER STAYS THIS CATALOG'S. resolveDepot() takes reach from an
        explicit `radius` when the caller supplies one — its step 1, which names
        depot.js's depotEffect() as the reason it trusts the number — and
        otherwise RE-DERIVES `3 + level` itself. Today the two agree, because
        production.data.js authors `radius: 3 + lv`; agreeing by coincidence with
        a formula restated in another file is exactly the second authority this
        file's header spends its length forbidding. Retune the catalog and the
        coincidence ends. Measured, with a level-2 row whose catalog radius is 1
        over a 3-hop route: `inReach()` is FALSE from the flat row and TRUE from
        the nested-only one — routes.js quietly granting a haul the catalog
        refuses, with no error anywhere to notice. The mirror is what makes
        step 1 fire, so effect() decides reach at that boundary and step 2 never
        runs.
     2. `bays` SURVIVES THE RESOLVE. resolveDepot() reads `d.bays` flat, so a
        nested-only row resolves to `bays: 0`. Nothing inside routes.js consumes
        that field today — it is carried for the caller and to keep the resolve
        idempotent — but index.js builds its quote input as
        `{ nodeId, radius, bays }` off flat keys too, and a concurrency check is
        the one place a silent 0 refuses.
   ⚠ AND ONE CASE THE MIRROR DOES NOT COVER, WHICH IS WHY `level` IS ON THE ROW
   AS WELL: a depot object carrying NEITHER a radius NOR a level resolves to
   reach 0 and is refused everywhere with "reaches 0 hops" (same harness).
   toDepots() cannot emit one — levelOf() floors at 1 — but bestDepot() is
   re-published on the bridge (index.js's `yard:` block) and any caller that maps
   or serialises a row is one dropped key away from it.
   Both views are built from ONE effectOf() call, so they cannot drift apart. */
export function depots() {
  try {
    const MP = cityProd();
    if (!MP) return [];
    /* The `.ok` flag is DELIBERATELY DROPPED here and only here: this export
       answers "which yards are standing", and [] is the honest answer whether
       the array was empty or unreadable. depotReady() is where the difference
       has to survive, and it reads placedRows() itself for exactly that. */
    return toDepots(placedRows(MP).rows, depotDef());
  } catch (e) { return []; }
}

/* The yard a carrier is judged by: the highest level standing, chosen by
   pickBest() above so that depotReady() cannot pick a different one. null when
   there is none — callers test the object, and routes.js turns a null depot
   into reach 0 rather than into reach everywhere ("absence is never generosity
   here"). */
export function bestDepot() {
  try {
    return pickBest(depots());
  } catch (e) { return null; }
}

/* What a depot of this level gives — from the catalog, never from memory.
   Exported so a UI can price an UPGRADE ("level 2 would buy you 4 bays") off
   the same expression the live yard is read with, instead of a hand-written
   preview that ages the first time the table is retuned. */
export function depotEffect(level) {
  try {
    const def = depotDef();
    if (!def) return emptyEffect();
    const max = int(def.maxLevel);
    let lv = int(level);
    if (max > 0 && lv > max) lv = max;
    return effectOf(def, lv);
  } catch (e) { return emptyEffect(); }
}

/* 🚛 HOW MANY RIGS THE COMPANY MAY PARK — the buildings' contribution SUMMED
   across every yard, plus the paid Garage slot.

   🔴 CORRECTED CLAIM #1: THE SERVER DOES ENFORCE A FLEET CAP.
   An earlier version of this comment justified the sum by saying the server
   "only ever REPORTS" fleet_cap and that "nothing in the migration checks a
   fleet size when a rig is registered". False. The enforcement is
   transport_fleet_cap_guard(), a BEFORE INSERT … FOR EACH ROW trigger on
   transport_rigs (created as `transport_rigs_cap`, sql/038 §2b): it reads
   `fleet_cap` out of transport_caps(), counts the carrier's live rigs, and
   raises `fleet_cap` — hint "Retire a rig, or raise the depot level for more
   slots" — when the count has reached it.

   🔴 CORRECTED CLAIM #2, WHICH IS THIS COMMENT GETTING THE SAME FILE WRONG A
   SECOND TIME, AND THAT IS THE REASON BOTH CORRECTIONS ARE STILL HERE.
   The fix above named the wrong mechanism: it said the cap lives in the INSERT
   policy trg_ins, as `(transport_caps(company_id)->>'fleet_slots_left')::int >
   0`. That clause is the migration's SECOND draft and it has been deleted.
   sql/038 keeps its corpse under a heading that says so — "THE FLEET CAP IS NOT
   HERE, AND THIS IS THE LINE IT WAS WRONG ON TWICE" — because a `stable` helper
   called from a WITH CHECK reads the snapshot the statement began with and
   cannot see the rows that statement is inserting. Measured there, against that
   draft: "one `insert … select from generate_series(1,60)` put 60
   Mythic/Pristine rigs into a depot-level-1 charter whose cap is 4. All 60
   accepted, with the clause right there on the line."
   Both of this comment's errors came from reading the migration's HEADER
   instead of its code. Read the trigger.

   🔴 AND THE SUM IS A CLIENT-SIDE BELIEF THE SERVER DOES NOT SHARE. The server
   caps parking off ONE `depot_level` — `least(4 * depot_level, max_fleet_rigs)`
   — so two yards cannot buy a bigger fleet out of Postgres, whatever this
   returns.
   ⚠ THE PREVIOUS REVISION RULED THAT DIVERGENCE "UNREACHABLE TODAY", on the
   grounds that /src/city holds one placed array for one city, "so every yard is
   the same yard's node and a second one is parking in the same yard". That
   argument is about NODES. The divergence is about a NUMBER, and nothing in it
   stops a second ROW. Nothing does: renderBlueprints() emits a
   `data-cprod-build` button for EVERY entry in CITY_PRODUCTION with no
   already-built test, bind() wires each button to build(), and build() checks
   prereqs, checks affordability, and then pushes. There is no uniqueness test
   anywhere on that path. Two Freight Depots is two clicks and a second bill.
   MEASURED, driving this module against the real catalog with a stubbed
   placed() (the last column is read off transport_caps() and the depot_level
   default — computed from the SQL, not run against a database):

       placed rows      fleetCap(0)   depotReady().fleetCap   server honours
       one L1                4                 4                    4
       two L1                8                 8                    4
       two L2               16                16                    4
       three L3             36                36                    4

   The consequence is not cosmetic. A player who reads "8 fleet slots" off this
   panel and buys a fifth rig on the paid-parts floor watches the registration
   refused by transport_rigs_cap with `fleet_cap`. Shown one number, billed by
   another — this repo's named worst bug class, arriving through a panel this
   file feeds.

   ⚠ THE SUM STAYS, AND THAT IS A DECISION WITH ITS COST WRITTEN DOWN. It is
   this feature's pinned contract: index.js and depot.render.js are built
   against "sum of depot fleetCaps + the Garage perk slot bonus", and quietly
   returning bestDepot().fleetCap here instead would be the silent inversion of
   a settled interface — worse than a disagreement that is stated out loud. So
   it is STATED: depotReady() carries `fleetCapBinding` (the server's shape —
   one yard, not a sum) and a `drift` code, and puts the difference into the
   `why` and `fix` that depot.render.js already prints for the ok state. That is
   the entire fix available from inside this file. The real fix is to send
   depot_level, or to teach the server about multiple yards, and neither is
   depot.js's to make.
   ⚠ REJECTED: returning min(sum, bestDepot().fleetCap) so the number is
   "safe". It would put fleetCap() into conflict with its own documented
   contract, it would hide from the player that the second yard bought them
   nothing, and it would STILL be optimistic — max_fleet_rigs is a
   transport_config ceiling no client may read at all (sql/038 revokes select on
   that table from anon and authenticated, which is why transport_caps() has to
   be a definer function), so it can clamp lower than any expression here. A
   number that has been quietly clamped is indistinguishable on screen from a
   number that is right, which is the property this whole feature keeps losing.
   ⚠ NOTHING IS GATED ON THIS NUMBER either way. depotReady() is what refuses a
   carrier, and it refuses regardless of parking.

   ⚠ TIER IN, PERK OUT — and a non-tier is tier 0, never a throw. `garageTier`
   is an integer 0-3 resolved by the caller on the Garage's own rail; this file
   never reads a Garage SKU, never sums owned rigs (the best one applies — rigs
   do not stack), and never registers a paid Garage rig as a fleet rig. Junk is
   absorbed by rigs.data.js's own resolver rather than re-guarded here.
   🔴 THE PERK IS ADDED ONCE, AND WHICH SIDE ADDS IT IS LOAD-BEARING.
   index.js calls `call(fleetCap, 0, 0)` — tier 0, explicitly — and then adds
   `garage.slotBonus` onto the block itself, in buildView(). An earlier revision
   there passed the BRIDGE as the tier and got the right answer only because
   `Number(bridge)` is NaN, which depotBlock()'s own header in index.js now
   writes up as a live double-count trap. Anyone changing that call site to
   `fleetCap(garage.tier)` MUST delete the `depot.fleetCap + garage.slotBonus`
   line in the same edit, or a $99 rig starts granting two slots. */
export function fleetCap(garageTier) {
  try {
    const n = sumFleetCap(depots());
    /* ⚠ WITH NO YARD AT ALL THIS IS THE PERK ALONE, NOT 0, and that is
       deliberate. Zeroing a slot somebody paid real money for because they have
       not built a shed yet is deleting a purchase from the display, which is the
       one thing rigs.data.js is most emphatic about ("Silently deleting a thing
       somebody paid for is the worst outcome available here"). Whether the perk
       is worth a slot at a given tier is fleetSlotBonus()'s answer and is asked
       for here rather than remembered. */
    return n + int(fleetSlotBonus(garageTier));
  } catch (e) { return 0; }
}

/* 🅿 SIMULTANEOUS IN-TRANSIT CONTRACTS — the BEST yard's bays, not a sum, and
   not the fleet's size. Concurrency is what makes freight a building instead of
   a shopping list: buying rigs alone does not scale a carrier, they have to
   build. The best-not-sum rule is the server's: transport_dispatch() asks
   transport_caps() for `bays` — `least(2 * depot_level, max_bays)`, off ONE
   depot_level — counts the carrier's in_transit contracts against it and
   answers 'no_free_bay'. This number must be the one the player is refused by,
   or the panel is advertising a haul that cannot be dispatched.
   ⚠ IT COPIES THE SERVER'S SHAPE, NOT ITS VALUE, and the difference is the
   header's second consequence. Best-yard-not-sum is the server's rule and this
   matches it exactly; the LEVEL it applies that rule to is the city's, while
   the server applies it to a depot_level column nothing writes. An upgraded
   yard therefore reports its real bays here and dispatches level 1's there —
   the two figures are whatever the catalog's effect() gives for those levels,
   and are not restated in this comment for the reason the header gives.
   depotReady() reports that gap as drift rather than letting it surface as a
   mystery 'no_free_bay' several clicks away.
   0 with no depot, which is the correct refusal, not a lockout bug. */
export function bays() {
  try {
    const b = bestDepot();
    return b ? int(b.bays) : 0;
  } catch (e) { return 0; }
}

/* 📏 REACH IN HOPS from the yard's node. Same rule and the same reason as
   bays(): transport_quote() takes `reach` from transport_caps() — `3 +
   depot_level`, off one depot_level — and refuses 'out_of_reach' when the hop
   count exceeds it, so the answer is the best yard's radius, and the same
   shape-not-value caveat applies word for word.
   0 means "its own node only" and NEVER "unlimited" — routes.js is explicit
   that defaulting an absent depot to reaching everything "would delete the
   feature and look like a null-check". */
export function radius() {
  try {
    const b = bestDepot();
    return b ? int(b.radius) : 0;
  } catch (e) { return 0; }
}

/* ═════════════════════════════════════════════════════════════════════════════
   🛑 CAN THIS PLAYER RUN FREIGHT? — one answer, and never a bare false.
   ----------------------------------------------------------------------------
   Shape: { ok, why, fix, code, level, bays, fleetCap, fleetCapBinding, radius,
   nodeId, count, drift }.
   `why` is a sentence the UI is required to print and `fix` names the concrete
   thing to go and do, because "no free bay" tells a carrier nothing while "no
   free bay — upgrade the depot" tells them where to go (index.js's own words
   about this feature's refusals). `code` is a stable machine-readable tag so a
   caller can branch without matching on prose.

   🔴 `ok: true` IS NOT `nothing to say`, AND THAT IS THE NEWEST THING HERE.
   The header's two divergences — the server's formula does not sum yards, and
   nothing writes depot_level — do not stop a carrier working. They make this
   panel's numbers bigger than the ones dispatch will honour, which is worse
   than a refusal, because a refusal at least happens where the player is
   looking. So `drift` is a code ('' when there is none, otherwise 'yards',
   'level', or 'yards+level'), `fleetCapBinding` is the server's SHAPE applied
   to the best yard, and on the ok path `why` states both numbers and `fix`
   carries the sentence for once without a refusal attached.
   ⚠ `fix` IS NON-EMPTY ON AN ok:true ANSWER ONLY IN THAT CASE. depot.render.js
   prints banner('ok', why, fix) — it already has somewhere to put it — so this
   reaches the screen with no change on their side.
   ⚠ AND THE "Fleet cap" TILE WILL STILL READ THE SUM, disagreeing with the
   banner beneath it. That is not an oversight, it is the lesser of the two
   available bugs: the tile reads `fleetCap`, and making THAT field the binding
   number would put depotReady() and the fleetCap() export into disagreement
   over one name — while index.js falls back to `fleetCap(0, 0)` whenever
   depotReady() does not answer, so the same player would see two different
   fleet caps depending on which path ran. A loud correction under a generous
   tile is legible. Two silently different tiles are not.

   🔴 THE ORDER OF THE CHECKS IS THE DESIGN, AND ONE OF THEM WAS MISSING.
   haltState()'s reasoning, which this function borrows: each check is a
   PRECONDITION for the next one to mean anything — and a check that is skipped
   does not produce silence. It produces the NEXT check's sentence, aimed at the
   wrong player.

     1. bridge   — nothing below can be read without it.
     2. module   — window.MythicCityProduction is absent or does not duck-type:
                   there is no city module to ask.
     3. inert    — 🔴 THE ONE THAT WAS MISSING, AND IT PRINTED THE MOST
                   EXPENSIVE WRONG SENTENCE THIS SCREEN HAS. The module can be
                   REGISTERED and still blind: /src/city/index.js publishes its
                   api at import unconditionally, but every read on that api
                   goes through makeHost(), which returns null when index.html
                   has not published window.MythicCityBridge. Then `placed()`
                   returns [] and a city holding a depot is byte-for-byte a city
                   holding none. Checks 1 and 2 both PASS in that state — the
                   transport bridge is fine, the module object is there, and
                   cityProdDef() resolves off a static import that never needed
                   a host — so before this branch existed the state fell through
                   to check 5 and printed "No Freight Depot is standing in your
                   city … Build a Freight Depot in your city", AT A PLAYER WHOSE
                   SAVE ALREADY HELD ONE. That sentence sends somebody to pay a
                   second time — buildingCostAt(def, 1), whatever the dial makes
                   of the authored row; the figure is deliberately not repeated
                   here, for the same reason the level table is not — to work
                   around a missing <script> tag. And they cannot even obey it,
                   because build() on an inert module returns {ok:false,'no
                   bridge'} with no depot and no explanation. A refusal that
                   names the wrong cause is worse than a crash: a crash gets
                   reported, this gets obeyed. cityLive() above is the test, and
                   the discriminator it uses — `ready: () => !!makeHost()` on
                   /src/city/index.js's api — was published from the day the city
                   module shipped and simply was not being asked for.
     4. catalog  — the city is LIVE but `freightdepot` does not resolve in it.
                   ⚠ CHECKED AFTER 3 AND NOT BEFORE, AND THE ORDER IS ABOUT DATA
                   LOSS RATHER THAN TIDINESS. ensureState() filters s.placed to
                   rows whose defId still resolves and WRITES THE FILTERED ARRAY
                   BACK, so state 4 is erasing the player's yards from the save
                   while we ask — "deleted paid-for buildings four rounds
                   running", live, now. State 3 cannot do that: pruning needs a
                   host and an inert module has none, so nothing is written at
                   all. One state is recoverable by reloading and the other
                   needs the current bundle before anything else touches the
                   save; printing the urgent sentence at the harmless state
                   would train players to ignore it.
     5. the read — MP.placed() threw, or returned something that is not an
                   array. THE THIRD ROUTE TO THE SAME WRONG SENTENCE, found by
                   driving the harness for this file after fixing the second:
                   depots() swallows a throw and returns [], so a live, bridged
                   city whose placed() blows up on a corrupt save produced
                   'no-depot' and "Build a Freight Depot in your city". Every
                   answer here now comes from placedRows(), which reports the
                   read as well as its result, so an unreadable array can never
                   again be reported as an empty one.
     6. a yard   — the actual, ordinary "you have not built it yet". It is only
                   reachable once 2 through 5 have ruled out every way of seeing
                   no rows that is not the player's own doing, which is the
                   entire reason those four exist.
     7. readable — a standing yard whose effect() will not read gives 0 bays and
                   0 reach, and "open with 0 bays" is a lie the player cannot
                   act on. Checked before origin because it is a fault in the
                   build, not a thing the player did.
     8. origin   — a yard with no node is a yard no route can start from, and
                   every quote will be refused downstream. Reporting `ok: true`
                   here would hand the player a working panel whose every button
                   fails for a reason nothing on screen states, which is the
                   invisible refusal this file exists not to ship.
   7 and 8 report the depot's REAL numbers alongside the refusal instead of
   flattening to zeros and presenting as "no depot" — the same rule as 3, 4 and
   5, and for the same reason: a player must never be told to buy a second yard
   because the first one could not be read. Four of these eight checks exist
   only to keep that one sentence off the screen when it is not true, which is
   the honest measure of how easy it is to print.

   fleetCap here is the BUILDINGS' number only — this function takes no tier
   argument and so can never include the Garage perk, which is precisely why
   index.js can add the slot bonus to it unconditionally.
   ═════════════════════════════════════════════════════════════════════════════ */
export function depotReady() {
  const base = { level: 0, bays: 0, fleetCap: 0, fleetCapBinding: 0, radius: 0,
                 nodeId: '', count: 0, drift: '' };
  /* One constructor for every refusal, so a branch cannot forget a field and
     hand the panel an `undefined` to render. `found` is merged over the zeros
     by the two refusals that DO know real numbers (checks 7 and 8). */
  const refuse = (code, why, fix, found) =>
    Object.assign({}, base, found || {}, { ok: false, code, why, fix });
  try {
    if (!bridgeReady()) {
      return refuse('no-bridge',
        'Freight is not wired up on this build — this screen was never handed its transport bridge.',
        'Reload the game. If it persists, index.html is missing its MythicTransportBridge block.');
    }
    const MP = cityProd();
    if (!MP) {
      return refuse('no-city',
        'Your city has not loaded, so the yard cannot be read. Nothing is lost — this screen simply cannot see it yet.',
        'Reload the game; /src/city is what publishes your buildings to freight.');
    }
    /* ⚠ THE WORDING OF THIS ONE IS AS LOAD-BEARING AS THE BRANCH ITSELF. It
       must not contain a sentence a player can act on by building or buying
       anything, because the single thing this state knows is that it cannot see
       what they already own. It names the console line the city module has
       already printed, so whoever is diagnosing it stops guessing. */
    if (cityLive(MP) === false) {
      return refuse('city-inert',
        'Your city module is loaded but was never handed its bridge, so it is reporting an empty city. If you own a Freight Depot it is still in your save — this screen cannot see it.',
        'Reload the game, and do NOT rebuild the depot. The console will already show "[city/production] window.MythicCityBridge is absent — production is inert".');
    }
    /* 🔴 THE ONLY BRANCH HERE THAT IS AN EMERGENCY, hence the only `fix` that
       tells a player to stop touching the game. A live city plus an unresolvable
       `freightdepot` is ensureState() pruning the placed row on every single
       read, and this module cannot stop it: depot.js never writes. */
    const def = depotDef();
    if (!def) {
      return refuse('catalog-missing',
        'This build has no Freight Depot in its building catalog, so your city cannot see one even if you own it — and it drops the row each time it loads.',
        'Hard-reload to fetch the current bundle (a stale service worker is the usual cause). Do not place or upgrade anything until the yard is visible again.');
    }
    /* ONE read, and every number below comes out of it — see placedRows().
       Reading the array three times (once per export) is how the previous
       version worked and it is both three ensureState() rewrites and three
       chances to answer from three different snapshots. */
    const read = placedRows(MP);
    if (!read.ok) {
      return refuse('rows-unreadable',
        'Your city is running but its building list could not be read, so this screen cannot tell whether you own a yard.',
        'Reload the game. Do NOT rebuild the depot — nothing here has changed your save, and a second yard would not fix a read that failed.');
    }
    const list = toDepots(read.rows, def);
    if (!list.length) {
      return refuse('no-depot',
        'No Freight Depot is standing in your city — without a yard the charter is paperwork.',
        'Build a Freight Depot in your city. It needs a Power Plant first.');
    }
    const best = pickBest(list) || list[0];
    const found = {
      level: int(best.level),
      bays: int(best.bays),
      /* The BUILDINGS' number only, which is what `fleetCap(0)` returns — tier 0
         buys no perk — reached through the shared sum so this and the
         export cannot drift. index.js adds the Garage slot to it exactly once
         (in buildView()); see fleetCap(). */
      fleetCap: sumFleetCap(list),
      /* The same yards read through the SERVER'S shape: one depot_level, not a
         sum. Never a second table — it is bestDepot()'s own effect() value, the
         one this module already computed. An UPPER bound, not a promise: the
         server also clamps against max_fleet_rigs, which no client may read.
         Equal to `fleetCap` whenever exactly one yard stands, which is why the
         drift test below is a comparison and not a count. */
      fleetCapBinding: int(best.fleetCap),
      radius: int(best.radius),
      nodeId: String(best.nodeId || ''),
      count: list.length,
    };
    /* 🔴 A YARD WHOSE NUMBERS WILL NOT READ IS NOT AN OPEN YARD. Measured while
       driving this file: with a def whose effect() throws, every accessor
       correctly degraded to 0 and depotReady() cheerfully answered "◉ YARD OPEN
       — 0 bays, reach 0 hops" — an ok:true that every downstream call would
       then refuse, which is exactly the invisible refusal this function exists
       to make impossible. A real def cannot produce this: level is clamped to at
       least 1, and the catalog's effect() at level 1 gives a non-zero bays AND a
       non-zero radius — check that with depotEffect(1) rather than trusting a
       pair of numbers copied into this comment, which is precisely how the level
       table would acquire the second author this file spends its header
       forbidding. So all-zero means the catalog could not be read, not that the
       building is small. */
    if (found.bays <= 0 && found.radius <= 0) {
      return refuse('unreadable',
        'Your depot is standing, but this build cannot read what it gives — every quote would be refused.',
        'Reload the game. If it persists the city catalog is out of date; do NOT rebuild the depot, it is still there.',
        found);
    }
    if (!found.nodeId) {
      return refuse('no-origin',
        'Your depot has no map position, so no route can start from it — every quote will be refused.',
        'Travel to a node to plant your camp; the yard hauls from wherever your city stands.',
        found);
    }
    /* 🔴 THE TWO WAYS AN OPEN YARD IS STILL LYING TO ITS OWNER, detected from
       what is on this side and named in the answer. Both are the header's
       divergences; neither is a fault the player caused or can repair, so
       neither refuses — but a number this panel prints larger than the number
       dispatch honours has to arrive with its correction attached, or the
       player meets it as a `fleet_cap` on a rig they have already paid for.

         'yards' — more than one Freight Depot is standing, so `fleetCap` is a
                   sum and transport_caps() is not. Tested as a COMPARISON of
                   the two numbers rather than `count > 1`, because that is the
                   condition that actually matters: a second yard whose
                   effect() read as 0 adds nothing and is nothing to warn about.
         'level' — the best yard is above level 1. Nothing in this build writes
                   transport_companies.depot_level (setTariff() sends
                   `p_depot_level: null` and transport_set_sheet coalesces that
                   to the stored value), so the server is still at the column
                   default of 1 and every upgrade past L1 is invisible to it.
       ⚠ 'level' IS A CLAIM ABOUT ANOTHER MODULE'S BEHAVIOUR AND IT WILL EXPIRE.
       The day anything calls transport_set_sheet with a real depot level, this
       branch starts warning about a drift that has been fixed — which is its
       own kind of lie. Grep `p_depot_level` across /src/transport before
       trusting it, and delete this arm in the same change that adds the send.
       Written down because the alternative is a warning nobody dares remove. */
    const driftYards = found.fleetCap > found.fleetCapBinding;
    const driftLevel = found.level > 1;
    const drift = driftYards
      ? (driftLevel ? 'yards+level' : 'yards')
      : (driftLevel ? 'level' : '');
    const open = '◉ YARD OPEN — ' + found.bays + ' bay' + (found.bays === 1 ? '' : 's') +
                 ', ' + found.fleetCap + ' fleet slot' + (found.fleetCap === 1 ? '' : 's') +
                 ', reach ' + found.radius + ' hop' + (found.radius === 1 ? '' : 's') + '.';
    if (!drift) return Object.assign({}, found, { ok: true, code: 'ready', why: open, fix: '', drift: '' });
    /* Both halves are stated in the ONE sentence a player reads, in the order
       they will meet them: what stands here, then what the exchange will
       actually honour. `fix` does not invent an action — there is none, the
       yards are real and correctly built — so it says what will be refused and
       explicitly tells them not to rebuild, the same shape as the 'city-inert'
       and 'rows-unreadable' fixes above, for the same reason. */
    const parts = [];
    if (driftYards) {
      parts.push(found.count + ' yards stand here and this panel adds their parking together (' +
                 found.fleetCap + '), but the exchange caps a fleet off ONE yard — ' +
                 found.fleetCapBinding + '.');
    }
    if (driftLevel) {
      // "also" only when the yards sentence went first, or a lone level warning
      // reads as the second half of a paragraph that was never printed.
      parts.push('The exchange has ' + (driftYards ? 'also ' : '') +
                 'never been told this yard is level ' + found.level +
                 '; until something sends it the exchange treats every carrier as level 1, so its bays and reach are lower than the numbers above.');
    }
    return Object.assign({}, found, {
      ok: true, code: 'ready', drift,
      why: open + ' ⚠ ' + parts.join(' '),
      fix: 'Nothing to rebuild — the yards are real and this is a gap on the exchange side, not in your city. Registering a rig past the exchange\'s cap is refused as "fleet_cap", and a haul past its reach as "out_of_reach".',
    });
  } catch (e) {
    /* The catch answers in the SAME shape as every other path. A thrown error
       must not become an undefined the panel renders as a blank yard: the
       player is told the screen failed and told what to do, which is the same
       contract the successful refusals above keep. */
    return refuse('error',
      'The depot could not be read on this build. Nothing was charged and no contract was changed.',
      'Reload the game. If it persists, the city module failed to load — check the console.');
  }
}