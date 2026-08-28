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

   ⚠ AND THERE IS ALREADY A THIRD COPY: THE SERVER'S, WHICH IS THE ONE THAT
   BINDS. sql/038 computes reach as `3 + depot_level` inside transport_quote()
   and bays as `least(2 * depot_level, max_bays)` inside transport_dispatch(),
   as plpgsql literals — a migration cannot import an ES module. Everything here
   is therefore a PREVIEW of a decision the server makes again. Where the two
   could disagree, this file is written to agree with the server (see bays()),
   because being contradicted at the moment of dispatch is the failure mode that
   costs a player a haul.

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

   ⚠ NO REFUSAL IS SILENT. depotReady() never returns a bare false. Every
   `ok:false` carries a `why` the UI is required to print AND a `fix` naming the
   concrete thing to go and do — production.state.js's rule, in its own words:
   "An invisible halt reads as a bug." A greyed-out Quote button with no
   sentence next to it is the least debuggable thing a player can be shown.

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
   call `_cityProdStorage()` (index.html:39414) is the shape every accessor here
   copies: type-check the method, use the value, return the neutral on throw.
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

/* ── The four questions ─────────────────────────────────────────────────── */

/* Every Freight Depot the player has standing, in PLACEMENT order — which is
   s.placed's own order, append-only in build(), and therefore stable between
   renders. This function only READS that array.

   THE ROW SHAPE CARRIES THE SAME NUMBERS TWICE, DELIBERATELY. The pinned
   contract for this feature is nested (`effect: {bays, fleetCap, radius}`), and
   routes.js's resolveDepot() — the thing that actually decides reach — reads
   `nodeId`, `radius` and `bays` FLAT and knows nothing about `.effect`. Handing
   back only the nested shape would mean `inReach(bestDepot(), …)` and
   `quote({ depot: bestDepot() })` resolve to `present: false`, and routes.js
   would then refuse the haul with "no depot" — a refusal naming the wrong cause
   is worse than a crash, because it sends the player to build a second yard
   they already own. Both views are built from ONE effectOf() call, so they
   cannot drift apart. */
export function depots() {
  try {
    const MP = cityProd();
    if (!MP) return [];
    let rows = null;
    try { rows = MP.placed(); } catch (e) { rows = null; }
    if (!Array.isArray(rows)) return [];
    const def = depotDef();
    if (!def) return [];
    const nodeId = originNodeId();
    const out = [];
    for (const r of rows) {
      // A malformed row is skipped, never repaired and never written back.
      if (!r || typeof r !== 'object') continue;
      if (r.defId !== DEPOT_DEF_ID) continue;
      const level = levelOf(r, def);
      const e = effectOf(def, level);
      out.push({
        id: String((r && r.id) || ''),
        level,
        nodeId,
        effect: e,
        // Flat mirror for routes.js. Same numbers, one source.
        bays: e.bays, fleetCap: e.fleetCap, radius: e.radius,
      });
    }
    return out;
  } catch (e) { return []; }
}

/* The yard a carrier is judged by: the highest level standing. Ties break on
   PLACEMENT ORDER (first wins) rather than on anything derived, so the answer
   cannot flip between two identical depots from one render to the next and
   move the origin of every quote with it. null when there is none — callers
   test the object, and routes.js turns a null depot into reach 0 rather than
   into reach everywhere ("absence is never generosity here"). */
export function bestDepot() {
  try {
    const list = depots();
    let best = null;
    for (const d of list) if (!best || d.level > best.level) best = d;
    return best || null;
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

   ⚠ WHY THIS SUMS WHILE bays() TAKES THE BEST, because the asymmetry is
   deliberate and sql/038 decides it. The server derives BAYS from a single
   `depot_level` integer and REFUSES a dispatch against it, so a summed bay
   count would show a free bay that dispatch rejects. It derives fleet_cap from
   the same integer but only ever REPORTS it — nothing in the migration checks a
   fleet size when a rig is registered — so parking is a client-side allowance,
   and a second yard genuinely being more parking is both harmless and the
   right fiction.
   ⚠ IF 038 EVER ENFORCES fleet_cap, THIS BECOMES bestDepot() TOO. One line,
   flagged here so that change is a decision and not an archaeology exercise.

   ⚠ TIER IN, PERK OUT — and a non-tier is tier 0, never a throw. `garageTier`
   is an integer 0-3 resolved by the caller on the Garage's own rail; this file
   never reads a SKU, never sums owned rigs (the best one applies — rigs do not
   stack), and never registers a paid Garage rig as a fleet rig. Junk is
   absorbed by rigs.data.js's own resolver, which is load-bearing here rather
   than incidental: index.js calls this as `call(fleetCap, 0, b)` — it passes
   the BRIDGE as the first argument — and Number(bridge) is NaN, so that path
   scores tier 0 and gets the buildings' number alone.
   🔴 WHICH IS EXACTLY WHAT index.js WANTS, AND IS A DOUBLE-COUNT WAITING TO
   HAPPEN. depotBlock() adds `garage.slotBonus` onto the result itself. So the
   perk is applied once today only because that call resolves to tier 0. Anyone
   "fixing" that call site to `fleetCap(tier)` MUST delete the `depot.fleetCap =
   depot.fleetCap + garage.slotBonus` line in the same edit, or a $99 rig starts
   granting two slots. */
export function fleetCap(garageTier) {
  try {
    let n = 0;
    for (const d of depots()) n += int(d && d.fleetCap);
    /* ⚠ WITH NO YARD AT ALL THIS IS THE PERK ALONE — 1, not 0 — and that is
       deliberate. Zeroing a slot somebody paid real money for because they have
       not built a shed yet is deleting a purchase from the display, which is
       the one thing rigs.data.js is most emphatic about ("Silently deleting a
       thing somebody paid for is the worst outcome available here"). Nothing is
       gated on this number: depotReady() is what refuses a carrier with no
       depot, and it refuses regardless of parking. */
    return n + int(fleetSlotBonus(garageTier));
  } catch (e) { return 0; }
}

/* 🅿 SIMULTANEOUS IN-TRANSIT CONTRACTS — the BEST yard's bays, not a sum, and
   not the fleet's size. Concurrency is what makes freight a building instead of
   a shopping list: buying rigs alone does not scale a carrier, they have to
   build. The best-not-sum rule is the server's, restated above in fleetCap():
   transport_dispatch() counts busy contracts against `least(2 * depot_level,
   max_bays)` off ONE level and answers 'no_free_bay'. This number must be the
   one the player is refused by, or the panel is advertising a haul that cannot
   be dispatched. 0 with no depot, which is the correct refusal, not a lockout
   bug. */
export function bays() {
  try {
    const b = bestDepot();
    return b ? int(b.bays) : 0;
  } catch (e) { return 0; }
}

/* 📏 REACH IN HOPS from the yard's node. Same rule and the same reason as
   bays(): transport_quote() computes `3 + depot_level` off one level, so the
   answer is the best yard's radius. 0 means "its own node only" and NEVER
   "unlimited" — routes.js is explicit that defaulting an absent depot to
   reaching everything "would delete the feature and look like a null-check". */
export function radius() {
  try {
    const b = bestDepot();
    return b ? int(b.radius) : 0;
  } catch (e) { return 0; }
}

/* ════════════════════════════════════════════════════════════════════════════
   🛑 CAN THIS PLAYER RUN FREIGHT? — one answer, and never a bare false.
   ----------------------------------------------------------------------------
   Shape: { ok, why, fix, code, level, bays, fleetCap, radius, nodeId, count }.
   `why` is a sentence the UI is required to print and `fix` names the concrete
   thing to go and do, because "no free bay" tells a carrier nothing while "no
   free bay — upgrade the depot" tells them where to go (index.js's own words
   about this feature's refusals). `code` is a stable machine-readable tag so a
   caller can branch without matching on prose.

   THE ORDER OF THE CHECKS IS ITS OWN DECISION, and it is haltState()'s
   reasoning: each check is a PRECONDITION for the next one to mean anything.
     1. bridge  — nothing below can be read without it.
     2. city    — a missing city module is indistinguishable from an empty city
                  at the row level, and telling a player to go and build a depot
                  they may already own is the most expensive wrong sentence this
                  screen can print.
     3. a yard  — the actual, ordinary "you have not built it yet".
     4. readable— a standing yard whose effect() will not read gives 0 bays and
                  0 reach, and "open with 0 bays" is a lie the player cannot
                  act on. Checked before origin because it is a fault in the
                  build, not a thing the player did.
     5. origin  — a yard with no node is a yard no route can start from, and
                  every quote will be refused downstream. Reporting `ok: true`
                  here would hand the player a working panel whose every button
                  fails for a reason nothing on screen states, which is the
                  invisible refusal this file exists not to ship.
   4 and 5 report the depot's REAL numbers alongside the refusal, instead of
   flattening to zeros and presenting as "no depot" — a player must never be
   told to buy a second yard because the first one could not be read.

   fleetCap here is the BUILDINGS' number only — this function takes no tier
   argument and so can never include the Garage perk, which is precisely why
   index.js can add the slot bonus to it unconditionally.
   ════════════════════════════════════════════════════════════════════════════ */
export function depotReady() {
  const base = { level: 0, bays: 0, fleetCap: 0, radius: 0, nodeId: '', count: 0 };
  try {
    if (!bridgeReady()) {
      return Object.assign({}, base, {
        ok: false, code: 'no-bridge',
        why: 'Freight is not wired up on this build — this screen was never handed its transport bridge.',
        fix: 'Reload the game. If it persists, index.html is missing its MythicTransportBridge block.',
      });
    }
    if (!cityProd() || !depotDef()) {
      return Object.assign({}, base, {
        ok: false, code: 'no-city',
        why: 'Your city has not loaded, so the yard cannot be read. Nothing is lost — this screen simply cannot see it yet.',
        fix: 'Reload the game; /src/city is what publishes your buildings to freight.',
      });
    }
    const list = depots();
    if (!list.length) {
      return Object.assign({}, base, {
        ok: false, code: 'no-depot',
        why: 'No Freight Depot is standing in your city — without a yard the charter is paperwork.',
        fix: 'Build a Freight Depot in your city. It needs a Power Plant first.',
      });
    }
    const best = bestDepot() || list[0];
    const found = {
      level: int(best.level),
      bays: int(best.bays),
      fleetCap: fleetCap(0),
      radius: int(best.radius),
      nodeId: String(best.nodeId || ''),
      count: list.length,
    };
    /* 🔴 A YARD WHOSE NUMBERS WILL NOT READ IS NOT AN OPEN YARD. Measured while
       driving this file: with a def whose effect() throws, every accessor
       correctly degraded to 0 and depotReady() cheerfully answered "◉ YARD OPEN
       — 0 bays, reach 0 hops" — an ok:true that every downstream call would
       then refuse, which is exactly the invisible refusal this function exists
       to make impossible. A real def cannot produce this: level is clamped to
       at least 1 and effect(1) is 2 bays / reach 4, so all-zero means the
       catalog could not be read, not that the building is small. */
    if (found.bays <= 0 && found.radius <= 0) {
      return Object.assign({}, base, found, {
        ok: false, code: 'unreadable',
        why: 'Your depot is standing, but this build cannot read what it gives — every quote would be refused.',
        fix: 'Reload the game. If it persists the city catalog is out of date; do NOT rebuild the depot, it is still there.',
      });
    }
    if (!found.nodeId) {
      return Object.assign({}, base, found, {
        ok: false, code: 'no-origin',
        why: 'Your depot has no map position, so no route can start from it — every quote will be refused.',
        fix: 'Travel to a node to plant your camp; the yard hauls from wherever your city stands.',
      });
    }
    return Object.assign({}, found, {
      ok: true, code: 'ready',
      why: '◉ YARD OPEN — ' + found.bays + ' bay' + (found.bays === 1 ? '' : 's') +
           ', ' + found.fleetCap + ' fleet slot' + (found.fleetCap === 1 ? '' : 's') +
           ', reach ' + found.radius + ' hop' + (found.radius === 1 ? '' : 's') + '.',
      fix: '',
    });
  } catch (e) {
    /* The catch answers in the SAME shape as every other path. A thrown error
       must not become an undefined the panel renders as a blank yard: the
       player is told the screen failed and told what to do, which is the same
       contract the successful refusals above keep. */
    return Object.assign({}, base, {
      ok: false, code: 'error',
      why: 'The depot could not be read on this build. Nothing was charged and no contract was changed.',
      fix: 'Reload the game. If it persists, the city module failed to load — check the console.',
    });
  }
}
