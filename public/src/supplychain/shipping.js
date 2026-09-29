/* ════════════════════════════════════════════════════════════════════════════
   🚚 SUPPLY CHAIN · shipping.js — the owner's shipping rule as ONE pure function.

   The owner's goal, verbatim: "Make it where every busienss has to use the
   transport company to ship to other players business that needs them follow
   the map I made in the pdf."

   This file answers exactly one question for the rest of the feature: "how
   does cargo get from tile A to tile B?" The answer is always the same four
   legs — pickup(A) -> haul(transport) -> depot(B) -> deliver(B) — and there is
   deliberately NO code path here that can return a direct A -> B lane for
   cargo. graph.js draws what route() returns, so a direct lane can only appear
   on the map if this file is changed. That is the structural guarantee behind
   the bar "0 direct lanes".

   🔴 WHAT THIS FILE IS NOT. It does not move a single resource, charge a single
   Cinder or gate a single click. It DESCRIBES a rule, and says honestly whether
   the shipped game enforces it (`enforcedToday`). Today that is true for two
   lanes only (LIVE_LANES below); everything else is the owner's goal, tagged
   `proposed`. Claiming otherwise in the UI is a FAIL under the lead contract
   (hard rule 3), so every route carries its own `tag` and `cite`.

   WHY THE PHASE IS IMPORTED, NOT RETYPED. `public/src/transport/routes.js` owns
   the gating ladder. Its WHY comment (routes.js, "THE GATING LADDER") reads:
       "PHASE 1 SHIPS, AND ONLY PHASE 1. Hiring a carrier is a BONUS: bigger
        loads, lower risk, faster. A player who hires nobody is not penalised
        by one line in this file"
     Phase 2 — soft gate: unhired freight runs "Hand-hauled" (smaller load, more
               risk, slower; "Painful, never fatal"). SHIPS AT: >=3 active carriers.
     Phase 3 — hard gate: long-haul (2+ hops) requires a carrier; "LOCAL 1-HOP
               STAYS HAND-HAULABLE FOREVER, so no one can be cut off entirely".
               SHIPS AT: >=5 carriers covering >=80% of live node pairs.
     and: "the player's own squad leaving on a scout/raid/deep-run is NOT cargo
           and is never gated by freight."
   A copy of that number here would go stale the day somebody promotes the
   ladder, and this map would then keep telling players "carrier is optional"
   while the game refused their freight (or the reverse, which is worse). So the
   ceiling is the live export. routes.js has no imports and no side effects, and
   transport/index.js imports it under the same bare URL, so in the browser this
   is the SAME module instance — not a second copy.
   Rejected: reading the phase only from ctx. A caller bug (or a fake bridge in
   a harness) could then claim Phase 3 and the map would say "enforced". ctx may
   LOWER the phase it reports (an old server), never raise it past routes.js.

   WHY "NO LEGS" IS KEYED ON THE CARGO, NEVER ON THE TILE. Round 1 of this file
   kept a list of seven "service tiles" (Bank, Warehouse, Dojo, Card Shop, Bus,
   Rail Road, Airport) and returned `legs: []` for anything touching them. Read
   against the real siblings that was false three times over: recipes.js has the
   Card Shop making boosterPacks (and the Marketplace icon IS drawn beside it on
   p7), the Dojo making sportingGoods, the Warehouse making packagingMaterial +
   cardboard — so "every business ships through Transport" had a hole, the hover
   copy said "nothing physical leaves the building" about a tile with a product,
   and the no-truck report promised a lane that route() could never produce.
   The split is now per LANE:
     · a tile's SERVICE (a loan, rented storage, training, a bus seat) moves no
       goods -> `legs: []` with the reason, so a view can say WHY there is no
       lane instead of showing a gap;
     · any GOODS entering or leaving a tile that handles goods -> the same four
       legs as everybody else. There is no exemption list for goods.
   Which tiles handle goods is DERIVED from injected sibling data; the local
   table is only the fallback for a caller that injects nothing, and audit()
   reports when the two disagree.

   🔴 ROUND 3 — THE SAME HOLE, INBOUND. Round 2 derived "handles goods" from
   recipes.js makes + buys only, and so still refused every lane INTO Bank, Bus,
   Rail Road and Airport with the copy "makes and buys no goods". For Bus and
   Rail that sentence was false about the SHIPPED game: OPS_ECON has
   bus.inputs.fuel and rail.inputs.fuel + rail.inputs.metal, recipes.js records
   them as live `upkeep` rows with madeBy, and coverage.js gives 69 resources a
   use at those four tiles — 16 of them used NOWHERE else (aviationFuel,
   goldBars, buses, turbines …). With no lane, graph.js could only drop those
   edges or draw them direct; either breaks the owner's two asks at once
   ("every business has to use the transport company", "every resource has a
   use"). So:
     · evidence of goods = recipes makes / buys / UPKEEP, or any coverage USES
       row `by` that tile (role 'sim' excluded — coverage.js: a sim row is
       never a need);
     · a NAMED resource (or cure) between two known tiles ALWAYS gets the four
       legs. There is no tile a crate cannot be trucked to. "Does this tile
       handle goods" now only decides the UNNAMED case (`cargo: true`, or no
       cargo at all = the tile's service) and which tiles allLanes() walks.
       Rejected: keeping a refusal for "no evidence" on a named resource — a
       caller that forgot to inject coverage would get legs [] and the only
       thing a view can do with legs [] between two businesses is draw the
       lane direct, which is the one picture this file exists to prevent;
     · the SERVICE of those tiles (a loan, a bus seat) is still legs [].
   A City-transit company carries passengers, not business cargo — that stays
   true and is what SERVICES says. Fuel for its own fleet arriving on somebody
   else's truck is a different lane.

   Pure: no DOM, no window, no bridge. Node can import() it.
   ════════════════════════════════════════════════════════════════════════════ */

import { PHASE as ROUTES_PHASE } from '../transport/routes.js';

/* The one hub every cargo lane passes through. A constant, not a parameter:
   the owner's map has exactly one Transport tile (p6, p7, p8, top centre). */
export const CARRIER = 'transport';
/* Where goods for a buyer with no delivery address go (see route() step 6). */
export const DEFAULT_CHANNEL = 'ch:market';

export const RULE = Object.freeze({
  id: 'ship-via-transport',
  text: 'Every business-to-business shipment is picked up, hauled by a Transport company, unloaded at the destination truck depot, then delivered. No business ships directly to another.',
  goalQuote: 'Make it where every busienss has to use the transport company to ship to other players business that needs them follow the map I made in the pdf.',
  pdfCite: 'PDF p5 legend: orange semi truck = "Transport: Best to make money" (needs the Transport company); Transport hub drawn top-centre on p6, p7, p8 with Gas Station + Car Dealer as its own suppliers.',
  tag: 'proposed',
  liveCite: 'public/src/transport/routes.js "THE GATING LADDER": export const PHASE = 1 — a carrier is a bonus, never required, except the two LIVE_LANES.',
  decision: 'D3',
});

/* 🚦 The ladder as DATA, so a view can print "what would mandatory take" without
   re-reading routes.js. The thresholds are quoted as TEXT on purpose — routes.js
   itself keeps them in prose "so that no import of this module can apply them
   by accident", and the same reasoning applies one hop downstream. */
export const PHASE_LADDER = Object.freeze([
  Object.freeze({ phase: 1, name: 'Carrier is a bonus', carrierRequired: 'never', shipsAt: 'shipped', effect: 'Hiring a carrier gives bigger loads, lower risk, faster trips. Hiring nobody costs nothing.' }),
  Object.freeze({ phase: 2, name: 'Soft gate', carrierRequired: 'no — unhired freight runs Hand-hauled (smaller, riskier, slower)', shipsAt: 'three or more active carriers', effect: 'Painful, never fatal.' }),
  Object.freeze({ phase: 3, name: 'Hard gate', carrierRequired: 'long-haul (two or more hops) only; a local one-hop stays hand-haulable forever', shipsAt: 'five or more carriers covering most live node pairs', effect: 'No one can be cut off entirely.' }),
]);

/* ── FALLBACK tile table ─────────────────────────────────────────────────────
   Used ONLY when the caller injects no businesses.js rows (ctx.businesses).
   Ids are the contract's canonical node ids; the values mirror businesses.js
   `kind` collapsed to the one distinction this file cares about:
     'cargo'   <- kind 'producer' | 'hub'        (its business IS goods)
     'service' <- kind 'service' | 'cityTransit' (its business is a service)
   `fashion` and `airport` are the two planned tiles (no op in the game yet).
   ⚠ Dojo and Card Shop are 'cargo' — businesses.js has them kind:'producer',
   goalSaysTransport:true. Listing them as services was the round-1 bug. */
const TILE_KIND_FALLBACK = Object.freeze({
  transport: 'cargo', mining: 'cargo', oil: 'cargo', gas: 'cargo', cars: 'cargo', construction: 'cargo',
  trashcrusher: 'cargo', weaponsmith: 'cargo', restaurant: 'cargo', agri: 'cargo', feed: 'cargo',
  dojo: 'cargo', cardshop: 'cargo', fishing: 'cargo', cannery: 'cargo', genelab: 'cargo', medical: 'cargo',
  fashion: 'cargo', research: 'cargo', carfactory: 'cargo', smuggling: 'cargo', salvage: 'cargo',
  bank: 'service', warehouse: 'service', bus: 'service', rail: 'service', airport: 'service',
});
/* Service-kind tiles that ALSO have goods at the gate. Fallback for "nothing
   injected"; with recipes / coverage injected the answer is derived (see
   goodsEvidence). Warehouse makes packagingMaterial + cardboard; Bus and Rail
   burn fuel (and metal) LIVE; Bank and Airport have uses in coverage.js only
   (goldBars, aviationFuel …), so whoever draws those lanes tags them proposed.
   Round 2 listed only the Warehouse — the inbound hole. */
const SERVICE_TILE_GOODS_FALLBACK = Object.freeze(['warehouse', 'bus', 'rail', 'bank', 'airport']);

export const CARGO_TILES = Object.freeze(Object.keys(TILE_KIND_FALLBACK).filter((id) => TILE_KIND_FALLBACK[id] === 'cargo'));

/* What each tile's SERVICE is — the thing that rides no truck. Keyed by tile,
   but it describes the service LANE, not the tile: Dojo and Card Shop are here
   because they sell a service AS WELL AS goods, and a caller asks for the
   service lane explicitly with `service: true`. */
export const SERVICES = Object.freeze({
  bank:      'Credit — loans and funding move Cinder, not cargo. What the vault and the branch consume (bullion, vault hardware) arrives as freight.',
  warehouse: 'Rented storage space. The goods inside stay the depositor’s and ride the lane that brought them.',
  dojo:      'Training for battlers. The lesson rides no truck; the gear the Dojo makes does.',
  cardshop:  'A storefront licence — cards sold to a battler over the counter. Stock shipped to another business or to the Marketplace is freight.',
  bus:       'City transit — carries passengers and hired camp labour for the city, not business cargo (PDF p9). The fuel its fleet burns is delivered by Transport like anyone else’s.',
  rail:      'City transit — carries passengers and hired camp labour for the city, not business cargo (PDF p9). The fuel and metal it burns are delivered by Transport like anyone else’s.',
  airport:   'City transit (planned tile) — carries passengers and hired camp labour for the city, not business cargo (PDF p9). Its supplies (aviation fuel, parts) would arrive by Transport.',
});
/* Kept under the round-1 name so a sibling written against it does not break.
   It now means exactly "tiles whose KIND is service in the fallback table". */
export const SERVICE_TILES = Object.freeze(Object.fromEntries(
  Object.keys(TILE_KIND_FALLBACK).filter((id) => TILE_KIND_FALLBACK[id] === 'service').map((id) => [id, SERVICES[id]])));

/* Transport's own suppliers, as drawn: Gas Station (730,258) and Car Dealer
   (732,338) sit LEFT of the big semi on p6/p7/p8. Cargo on these lanes is still
   hauled — by the very company that is buying it. Flagged `selfHaul` so a view
   can say "Transport collects this itself" instead of implying it hires a rival. */
export const TRANSPORT_SUPPLIERS = Object.freeze(['gas', 'cars']);

/* ── map-vs-goal honesty ─────────────────────────────────────────────────────
   Transcribed from sc/brief/pdfmap.md section 5 ("Truck drawn (16)") and 6-B.
   This is the FALLBACK; when the caller injects businesses.js rows their
   `icons.transport` wins, because that file is the map's single source of
   truth and this list must never silently disagree with it (see audit()). */
const PDF_TRUCK_DRAWN = Object.freeze([
  'mining', 'oil', 'gas', 'construction', 'trashcrusher', 'restaurant', 'agri', 'feed',
  'fishing', 'cannery', 'genelab', 'medical', 'fashion', 'research', 'smuggling', 'salvage',
]);
export const PDF_TRUCK_NOT_DRAWN = Object.freeze(['cars', 'weaponsmith', 'dojo', 'cardshop', 'carfactory']);
export const NOT_DRAWN_LABEL = 'per written goal, not drawn';

/* ── the two lanes the shipped game really forces through a carrier ──────────
   Data, not closures, so the audit piece can print them. Both are
   Medical -> Medical (one player's lab / pharmacy to another player's
   hospital). NEITHER carries a catalogue resource — hence `cargoKind`:
     'pharma' = compounded shelf products (pharma_lots.product is a
                public/src/hospital/pharma.js PRODUCTS id: salve, antiviral,
                serum, tonic, vaccine — none of them is in the catalogue);
     'cure'   = cure doses, which live on Profile.plague.
   🔴 ROUND 4 — THE LANE WAS KEYED TO THE WRONG CARGO. Rounds 1-3 keyed the
   pharma lane on the catalogue id `medicine`. Raw Medicine is only an INPUT to
   those products (pharma.js `inputs: { medicine: 1 }`); it is an ordinary
   RESOURCES id that resMarketPost lists on the instant-settle market with no
   carrier at all. So the map said "the game already refuses this" about a
   lane the game does not police, and could not say it about the one it does.
   A catalogue resId — medicine included — is now ALWAYS tag 'proposed'. Only
   an explicit cargoKind reaches a live lane. */
/* Transcribed names, for labels only. pharma.js is the truth; the ids are
   deliberately NOT imported (that module pulls the hospital's state) and
   nothing here branches on them. */
export const PHARMA_PRODUCTS = Object.freeze(['salve', 'antiviral', 'serum', 'tonic', 'vaccine']);
export const LIVE_LANES = Object.freeze([
  Object.freeze({
    id: 'pharma-wholesale', from: 'medical', to: 'medical', resId: null, cargoKind: 'pharma',
    label: 'Hospital pharma wholesale — compounded pharma products (Field Salve … Vaccine Dose), not raw Medicine',
    /* short = the name used INSIDE a sentence; label is the standalone badge. */
    short: 'Hospital pharma wholesale (compounded products, not raw Medicine)',
    products: 'public/src/hospital/pharma.js PRODUCTS — salve, antiviral, serum, tonic, vaccine. Not catalogue ids; raw medicine is their input and lists on the instant resource market with no carrier.',
    cite: 'sql/096_pharma_wholesale.sql — pharma_lots.product is a compounded pharma product (pharma.js PRODUCTS), not raw Medicine; the trigger refuses a sale with no carrier_op_id ("a sale needs a buyer, a destination, a carrier and an arrival"); client public/src/hospital/state.js, UI hud.js "Pick a lot and a carrier."',
    depotChecked: false,
  }),
  Object.freeze({
    id: 'cure-waybill', from: 'medical', to: 'medical', resId: null, cargoKind: 'cure',
    label: 'Plague cure waybill',
    cite: 'sql/095_plague_cures_logistics.sql — cure_shipments.carrier_op_id is NOT NULL; carrier market = view plague_carriers. Falls back to the shipper’s OWN transport op when nobody is online, which is still a carrier.',
    depotChecked: false,
  }),
]);

/* ⚠ `enforcedToday: true` here is a statement about the RULE (the server switch is
   on), scoped by `appliesTo`. It is NOT a statement about any one lane: nobody
   is made to book a freight haul today, so a route's depot LEG carries
   `enforcedToday: false` and the separate `enforcedWhenHauled`. Round 2 put
   `enforcedToday: true` on the leg of ~3,000 proposed routes; a view that
   badges legs would have printed "enforced today" on lanes the game does not
   route at all. */
export const DEPOT_RULE = Object.freeze({
  id: 'depot-at-destination',
  enforcedToday: true,
  appliesTo: 'freight-table-hauls-only',
  text: 'A haul can only end at a node with a FINISHED Transport Depot; otherwise the server refuses it (no_depot_at_destination). The depot owner earns an unloading fee per load.',
  cite: 'sql/075_node_depot_index.sql (transport_config.require_depot_at_destination, default true — a switch, not a constant) + sql/076 (a city truckdepot tile or a transport op both count).',
  scope: 'Freight Depot contracts and Haulage Board requests (transport_contracts / haul_requests). The two medical waybill tables (sql/095, sql/096) do not run this gate.',
});

/* ── small total helpers ───────────────────────────────────────────────────── */
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const str = (v) => (typeof v === 'string' ? v : '');
const isSystem = (id) => str(id).startsWith('sys:');
const isChannel = (id) => str(id).startsWith('ch:');
/* Injected siblings arrive either as the module namespace or as the bare value. */
const bizRows = (b) => (Array.isArray(b) ? b : (b && Array.isArray(b.BUSINESSES) ? b.BUSINESSES : null));
const recipeMap = (r) => (r && typeof r === 'object' ? (r.RECIPES && typeof r.RECIPES === 'object' ? r.RECIPES : r) : null);
/* coverage.js arrives as the module namespace ({ USES, needsOf }) or as the bare USES map. */
const usesMap = (cv) => (cv && typeof cv === 'object' ? (cv.USES && typeof cv.USES === 'object' ? cv.USES : (typeof cv.needsOf === 'function' ? null : cv)) : null);
/* USES is keyed by resource; this file asks by TILE, 27 x 27 x many times. One
   pass per injected map, remembered against the map object itself (a WeakMap,
   so a caller's throwaway coverage never leaks). 'sim' rows are skipped —
   coverage.js: "'sim' rows are never needs". */
const USERS_CACHE = new WeakMap();
function tilesWithUses(U) {
  let set = USERS_CACHE.get(U);
  if (set) return set;
  set = new Set();
  for (const resId of Object.keys(U)) {
    const rows = U[resId];
    if (!Array.isArray(rows)) continue;
    for (const u of rows) if (u && typeof u.by === 'string' && u.role !== 'sim') set.add(u.by);
  }
  USERS_CACHE.set(U, set);
  return set;
}
const bizRow = (id, businesses) => { const rows = bizRows(businesses); return rows ? rows.find((b) => b && b.id === id) || null : null; };
const KIND_MAP = Object.freeze({ producer: 'cargo', hub: 'cargo', service: 'service', cityTransit: 'service' });

/* 'cargo' | 'service' | null (not a tile). businesses.js wins over the fallback. */
/* ROUND 4 — every EXPORT is total. The exported name is a guard; the code in
   this file calls the throwing twin (…U) on purpose, so that route()'s own
   guard still turns an unreadable ctx into reasonCode 'bad-input' instead of
   quietly routing on the fallback table. An unreadable ctx here degrades to
   the fallback table — "the bridge was odd" must not read as "not a tile". */
export function tileKind(id, ctx) {
  try { return tileKindU(id, ctx); } catch (_) { return tileKindU(id, undefined); }
}
function tileKindU(id, ctx) {
  const k = str(id);
  const row = bizRow(k, ctx && ctx.businesses);
  if (row && has(KIND_MAP, str(row.kind))) return KIND_MAP[row.kind];
  if (row) return 'cargo';           // an unknown future kind still ships — never silently lane-less
  return has(TILE_KIND_FALLBACK, k) ? TILE_KIND_FALLBACK[k] : null;
}
/* Does this tile ever have GOODS at its gate? Every cargo-kind tile does. A
   service-kind tile does when ANY injected sibling says so: recipes.js makes /
   buys / upkeep (upkeep = what the op really burns today), or a coverage.js
   USES row naming it. Returns the evidence so a view can say which.
   With neither sibling injected the fallback list answers. */
export function goodsEvidence(id, ctx) {
  try { return goodsEvidenceUnguarded(id, ctx); } catch (_) { return { goods: false, basis: 'bad-input' }; }
}
function goodsEvidenceUnguarded(id, ctx) {
  const k = str(id);
  const kind = tileKindU(k, ctx);
  if (kind === 'cargo') return { goods: true, basis: 'kind' };
  if (kind !== 'service') return { goods: false, basis: 'not-a-tile' };
  const R = recipeMap(ctx && ctx.recipes);
  const cv = ctx && ctx.coverage;
  const U = usesMap(cv);
  const viaFn = !U && cv && typeof cv.needsOf === 'function';
  if (R) {
    const rec = R[k];
    for (const f of ['makes', 'buys', 'upkeep']) if (rec && Array.isArray(rec[f]) && rec[f].length > 0) return { goods: true, basis: 'recipes.' + f };
  }
  if (U && tilesWithUses(U).has(k)) return { goods: true, basis: 'coverage.USES' };
  if (viaFn) {
    try { const n = cv.needsOf(k); if (Array.isArray(n) && n.length > 0) return { goods: true, basis: 'coverage.needsOf' }; } catch (_) { /* total */ }
  }
  /* "No goods" is only a FINDING when both siblings were asked. Round 3 said it
     with recipes alone, and Bank + Airport (whose goods live in coverage.js
     only) silently dropped out of allLanes() — 729 lanes became 625 for any
     consumer that forgot to inject coverage. */
  if (R && (U || viaFn)) return { goods: false, basis: 'no-goods-in-injected-data' };
  return { goods: SERVICE_TILE_GOODS_FALLBACK.includes(k), basis: R ? 'fallback-no-coverage' : ((U || viaFn) ? 'fallback-no-recipes' : 'fallback') };
}
export function handlesGoods(id, ctx) { return goodsEvidence(id, ctx).goods; }
export function isCargoTile(id, ctx) { return tileKind(id, ctx) === 'cargo'; }
export function isServiceTile(id, ctx) { return tileKind(id, ctx) === 'service'; }
/* Every tile that can stand at either end of a goods lane. */
export function shipperTiles(ctx) {
  try { return shipperTilesUnguarded(ctx); } catch (_) { return shipperTilesUnguarded(undefined); }
}
function shipperTilesUnguarded(ctx) {
  const rows = bizRows(ctx && ctx.businesses);
  const ids = rows ? rows.filter((b) => b && b.id).map((b) => b.id) : Object.keys(TILE_KIND_FALLBACK);
  return ids.filter((id) => handlesGoods(id, ctx));
}

/* The phase a route may REPORT. ctx can lower it, never raise it past routes.js.
   A non-integer / missing ctx value degrades to the routes.js export, because
   "the bridge was not ready" must not read as "nothing exists". */
export function effectivePhase(ctx) {
  try { return effectivePhaseU(ctx); } catch (_) { return effectivePhaseU(undefined); }
}
function effectivePhaseU(ctx) {
  const first = PHASE_LADDER[0].phase;
  const ceiling = Number.isInteger(ROUTES_PHASE) && ROUTES_PHASE >= first ? ROUTES_PHASE : first;
  const asked = ctx && Number.isInteger(ctx.transportPhase) ? ctx.transportPhase : ceiling;
  return Math.max(first, Math.min(asked, ceiling));
}

/* Matches on cargoKind ONLY — never on a resId (see the round-4 note above
   LIVE_LANES). And never when a Marketplace channel is involved: both waybill
   tables are a direct hospital-to-hospital sale, the Marketplace is a different
   code path that settles instantly. Without this one result said both "the
   game already refuses this" and "settles instantly, no carrier". */
const LIVE_KINDS = Object.freeze(['pharma', 'cure']);
function liveLaneFor(from, to, cargoKind, viaChannel) {
  if (viaChannel || !LIVE_KINDS.includes(cargoKind)) return null;
  for (const l of LIVE_LANES) if (l.from === from && l.to === to && l.cargoKind === cargoKind) return l;
  return null;
}

/* 🔗 SEAM: the ctx fields that say whether the server is really there.
   sc.bridge.js has no offline() accessor, but it has ready() and signedIn(),
   and "bridge missing OR not signed in" is exactly the session in which no
   sql/095-096 trigger runs. The shell / graph piece spreads this into the ctx
   it builds once: { ...sessionCtx(bridge), catalog, businesses, … }.
   ⚠ A caller that passes NO ctx is treated as online — that is a statement
   about the live game (Node audits, the data pieces), and it is why the shell
   MUST call this; recorded in sc/decisions/shipping.md. Total: a bridge whose
   accessors throw reads as offline, the safe direction (never over-claim). */
export function sessionCtx(bridge) {
  try {
    const b = bridge && typeof bridge === 'object' ? bridge : null;
    const ready = !!b && (typeof b.ready === 'function' ? b.ready() === true : true);
    const signedIn = !!b && typeof b.signedIn === 'function' && b.signedIn() === true;
    return { offline: !(ready && signedIn), signedIn };
  } catch (_) { return { offline: true, signedIn: false }; }
}

/* Is a server-side rule actually being applied IN THIS SESSION?
   CLAUDE.md: the app must work offline / before tables exist, on mock data. In
   that session the sql/095-096 triggers and the sql/075 switch are simply not
   there, and a map saying "the game already refuses this" would be describing
   a server the player is not talking to. So ctx may switch a rule OFF:
     ctx.offline === true              -> nothing server-side is enforced
     ctx.signedIn === false            -> same: a signed-out / mock session is
                                          not talking to the triggers
     ctx.serverRules === false         -> same
     ctx.serverRules[ruleId] === false -> that one rule is off (e.g. the owner
                                          flipped transport_config.require_depot_at_destination)
   There is deliberately no way to switch a rule ON from ctx — the same
   "lower, never raise" reasoning as effectivePhase(). */
function ruleOn(ruleId, ctx) {
  if (!ctx) return true;
  if (ctx.offline === true || ctx.signedIn === false || ctx.serverRules === false) return false;
  if (ctx.serverRules && typeof ctx.serverRules === 'object' && ctx.serverRules[ruleId] === false) return false;
  return true;
}

/* One reasonCode ('squad-not-cargo' — siblings key on it), three wordings.
   Round 3 told a player their CITY's output was "carried home by your own
   squad", which is battle language on a city tile. The rule is the same for
   all three: what a player's own systems yield lands in that player's own
   stock with no freight involved — never gate _convoyCanSend. */
const SYSTEM_SENDER_REASON = Object.freeze({
  'sys:battle': 'Carried home by your own squad. A squad is not cargo and is never gated by freight (routes.js gating ladder; transport design doc: never gate _convoyCanSend).',
  'sys:camp': 'Brought back by your own camp crew into your own stock. A crew is not cargo and is never gated by freight (transport design doc: never gate _convoyCanSend). Selling it on is a shipment — pick a business or the Marketplace as the sender.',
  'sys:city': 'What your city produces lands in your own stock — nothing leaves your holdings, so there is no shipment yet. Selling it on is a shipment — pick a business or the Marketplace as the sender.',
});

function noCargo(from, to, resId, qty, ctx, reason, reasonCode, extra) {
  return {
    from, to, deliverTo: null, redirected: false, finalBuyer: null,
    resId: resId ?? null, qty: qty ?? null, cargoKind: null,
    legs: [], ships: false, reason, reasonCode, serviceOf: null,
    /* The RULE still holds; this lane simply has nothing for it to apply to.
       Kept `true` so no consumer can read a service lane as "may ship direct". */
    carrierRequired: true,
    phase: effectivePhase(ctx), enforcedToday: false, enforcedBasis: 'no-cargo', tag: 'live',
    liveLane: null, selfHaul: false, channel: null, channelDrawn: null, marketNote: null, cargoClass: null,
    product: null, resKnown: null,
    depotRule: DEPOT_RULE, whatHappensToday: reason,
    cite: RULE.pdfCite, rule: RULE.id,
    ...(extra || {}),
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   route() — TOTAL: never throws, always returns the same shape. The body runs
   inside a guard: a hostile args / ctx (a Proxy whose traps throw, a getter
   that throws) comes back as a no-legs result with reasonCode 'bad-input'
   instead of taking the map down. Round 2 made this claim without the guard
   and a fuzzer broke it with a Proxy.

   args: { from, to, resId, qty, cargoKind?:'resource'|'pharma'|'cure',
           product?:string  — pharma only: which PRODUCTS id, echoed for labels
           cargo?:true      — "some goods, id not decided yet" (allLanes uses it)
           service?:true    — ask for the tile's SERVICE lane explicitly
           channel?:'ch:market'|'ch:carmarket'
           sameOwner?:true  — THIS shipment stays inside one player's holdings }
   ctx : { transportPhase?, catalog?, businesses?, recipes?, coverage?, offline?, serverRules? }
   ⚠ sameOwner is an ARG, never ctx. Round 2 read ctx.sameOwner, and ctx is the
   object graph.js builds ONCE for the whole map — one stray flag there would
   have returned legs [] for every pair and silently erased Transport from the
   picture. ctx.sameOwner is now ignored on purpose (and pinned by the test).

   Decision order, and why it is this order:
     1. unknown ids      -> no legs. A typo must not be drawn as a lane — tile
                            ids always, resource ids whenever a catalogue is
                            injected (reasonCode 'unknown-resource').
     2. same owner       -> no legs. The owner's rule is about shipping to OTHER
                            players' businesses; moving your own stock between
                            your own ops is not a shipment.
     3. systems as sender-> Battle / Camp / City output is carried home by the
                            player's own squad or crew. routes.js and the
                            transport design doc are explicit: "Freight is
                            freight; a squad is not cargo" — never gate
                            _convoyCanSend. A delivery INTO the city or a camp
                            IS freight (that is where the depot stands).
     4. service lanes    -> no legs, with the reason. A lane is a service lane
                            when the caller says so, or when an end is a
                            service-kind tile and NO cargo was named (Bank with
                            no resId = a loan; Warehouse = its storage rental;
                            Bus = a seat). `cargo: true` ("some goods") into a
                            service-kind tile with no goods evidence in the
                            injected data is refused too — but a NAMED resource
                            never is (see the round-3 note in the file header).
     5. everything else  -> the four legs. There is no other branch.
     6. …with one address fix: `sys:battle` and `sys:business` are not places a
        truck can unload (a battler has no depot; "the Business system" is the
        tiles themselves). recipes.js uses them in sellsTo to mean "battlers /
        other businesses buy this". 🔗 CONVENTION FOR graph.js: such goods are
        hauled to a marketplace node and bought there — legs end at
        `deliverTo` (= args.channel or ch:market), `redirected: true`,
        `finalBuyer` keeps what was asked. Draw the edge from -> transport ->
        deliverTo; never from -> sys:battle. Rejected: returning "not a
        receiver" (round 1) — it left 20 sellsTo lanes in recipes.js with no
        route, which graph.js could only show as a gap or draw direct.

   `from === to` is a real lane: it means ANOTHER player's business of the same
   kind. The live pharma lane is exactly that (Medical -> Medical).
   A Marketplace sale to another player's business is the same four legs with
   `channel` set; a listing whose buyer is not known yet is routed to the
   channel node so the graph still has no direct lane to draw.
   ════════════════════════════════════════════════════════════════════════════ */
export function route(args, ctx) {
  try { return routeUnguarded(args, ctx); } catch (_) {
    /* ctx is NOT passed on: reading it is what threw. Phase degrades to routes.js. */
    return noCargo('', '', null, null, null, 'Unreadable route request — nothing is drawn for it.', 'bad-input');
  }
}
function routeUnguarded(args, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const from = str(a.from), to = str(a.to);
  const resId = str(a.resId) || null;
  const qty = Number.isFinite(a.qty) ? a.qty : null;
  const cargoKind = LIVE_KINDS.includes(a.cargoKind) ? a.cargoKind : 'resource';
  const offCatalogue = cargoKind !== 'resource';   // pharma products / cure doses: real cargo, no catalogue id
  const hasCargo = offCatalogue || !!resId || a.cargo === true;

  const known = (id) => tileKindU(id, c) !== null || isSystem(id) || isChannel(id);
  if (!known(from) || !known(to)) {
    return noCargo(from, to, resId, qty, c, `Unknown tile "${!known(from) ? from : to}" — not on the owner's map.`, 'unknown-node');
  }
  /* 1b. A resource id the INJECTED catalogue does not know (a typo, or one of
     catalog.js's PHANTOMS such as gunOil) is not drawn either — the same rule
     as an unknown tile, which round 3 forgot to apply to resources. With no
     catalogue injected nothing can be checked and the id is trusted
     (resKnown: null). An off-catalogue cargoKind ignores resId altogether. */
  const resKnown = cargoKind === 'resource' && resId ? resourceKnown(resId, c.catalog) : null;
  if (resKnown === false) {
    return noCargo(from, to, resId, qty, c, `"${resId}" is not a resource in the game's catalogue — nothing is drawn for it.`, 'unknown-resource', { resKnown: false });
  }
  if (a.sameOwner === true) {
    return noCargo(from, to, resId, qty, c, 'Both ends belong to the same player — moving your own stock is not a shipment to another player’s business.', 'same-owner');
  }
  if (isSystem(from)) {
    return from === 'sys:business'
      ? noCargo(from, to, resId, qty, c, 'The Business system is the tiles themselves — pick a business as the sender.', 'not-a-sender')
      : noCargo(from, to, resId, qty, c, SYSTEM_SENDER_REASON[from] || SYSTEM_SENDER_REASON['sys:battle'], 'squad-not-cargo');
  }
  if (isChannel(from) && isChannel(to)) {
    return noCargo(from, to, resId, qty, c, 'Two marketplaces do not trade with each other.', 'channel-to-channel');
  }

  /* ── 4. service lanes ── */
  const named = offCatalogue || !!resId;
  const endGoods = (id) => named || isChannel(id) || isSystem(id) || handlesGoods(id, c);
  const serviceText = (id) => SERVICES[id] || 'Sells a service — nothing physical changes hands.';
  if (a.service === true) {
    const t = has(SERVICES, from) ? from : to;
    return noCargo(from, to, resId, qty, c, serviceText(t), 'service-lane', { serviceOf: t });
  }
  for (const id of [from, to]) {
    if (!endGoods(id)) {
      return noCargo(from, to, resId, qty, c, `${serviceText(id)} Nothing in the data handed to this map has goods entering or leaving this tile, so there is no lane to draw until a resource is named.`, 'service-tile', { serviceOf: id });
    }
  }
  if (!hasCargo) {
    const t = [from, to].find((id) => tileKindU(id, c) === 'service');
    if (t) return noCargo(from, to, resId, qty, c, `${serviceText(t)} Goods this tile makes or buys are routed when a resource is named.`, 'service-lane', { serviceOf: t });
  }

  /* ── 6. address fix (see header) ── */
  const noAddress = to === 'sys:battle' || to === 'sys:business';
  if (noAddress && isChannel(from)) {
    return noCargo(from, to, resId, qty, c, 'A buyer collects a Marketplace lot into their own stash — that hand-over is the sale, not a second shipment.', 'collected-by-buyer');
  }
  const dest = noAddress ? (isChannel(a.channel) ? a.channel : DEFAULT_CHANNEL) : to;

  /* ── cargo. From here the four legs are unconditional. ── */
  const selfHaul = from === CARRIER || to === CARRIER;
  const channel = isChannel(a.channel) ? a.channel : (isChannel(dest) ? dest : (isChannel(from) ? from : null));
  const lane = liveLaneFor(from, to, cargoKind, !!channel);
  const live = lane && ruleOn(lane.id, c) ? lane : null;
  const phase = effectivePhaseU(c);
  /* Boxed doses and shelf products are crates. */
  const cls = offCatalogue ? 'freight' : cargoClass(resId, c.catalog);
  /* Map honesty for the channel: is that marketplace icon DRAWN beside the
     seller? true / false / null (= no businesses.js injected, unknown). */
  const sellerRow = bizRow(from, c.businesses);
  const iconKey = channel === 'ch:carmarket' ? 'carMarket' : 'market';
  const channelDrawn = channel && sellerRow && sellerRow.icons && typeof sellerRow.icons[iconKey] === 'boolean' ? sellerRow.icons[iconKey] : null;

  /* The depot leg is enforced by sql/075 only for hauls that go through the
     freight tables. The two live medical lanes use their own waybill tables,
     which do NOT run that gate — so on those two routes the depot stop is the
     owner's rule, not today's. Saying "enforced" there would be the exact
     over-claim hard rule 3 forbids. Keyed on `lane`, not `live`: an offline
     session does not move medicine onto the freight tables. */
  const depotLive = (lane ? lane.depotChecked : DEPOT_RULE.enforcedToday) && ruleOn(DEPOT_RULE.id, c);
  /* …and that is "IF this goes as a freight-table haul". Whether the game makes
     it go that way is the route's own enforcedToday — false for every proposed
     lane, and the two live lanes skip the depot gate. So the LEG is never
     "enforced today" in the shipped game; the expression is kept (not a bare
     false) so the day a live lane gains depotChecked it lights up by itself. */
  const depotForced = depotLive && !!live;

  const legs = [
    { kind: 'pickup', node: from, by: CARRIER,
      note: selfHaul ? 'Transport’s own rig makes the pickup.' : 'The carrier loads at the seller’s gate.' },
    { kind: 'haul', node: CARRIER, selfHaul, cargoClass: cls,
      note: selfHaul ? 'Transport hauls for itself — no rival is hired (flagged selfHaul).' : 'A player-owned Transport company drives it.' },
    { kind: 'depot', node: dest, depotAt: dest, enforcedToday: depotForced, enforcedWhenHauled: depotLive, rule: DEPOT_RULE.id, cite: DEPOT_RULE.cite,
      note: depotLive
        ? 'IF you book this as a freight haul, the destination needs a finished Transport Depot — the server refuses a freight contract without one. Nothing makes you book one today.'
        : (lane ? 'This waybill table does not check for a depot today; the depot stop is the owner’s rule.'
          : 'The depot check is a server rule and is not running in this session.') },
    { kind: 'deliver', node: dest,
      note: noAddress ? 'Unloaded at the Marketplace; the battler or business buys it there.'
        : (isChannel(dest) ? 'The buyer is not known until the lot sells; the haul runs when it settles.' : 'Unloaded into the buyer’s stock.') },
  ];

  const marketNote = channel
    ? 'Today the Marketplace settles INSTANTLY into the buyer’s stash (resMarketTake -> _resSettleEntry): no haul, no carrier, no delay. Routing a sale through a haul is owner decision D3.'
    : null;
  const rung = PHASE_LADDER.find((p) => p.phase === phase) || PHASE_LADDER[0];

  return {
    from, to, deliverTo: dest, redirected: noAddress, finalBuyer: noAddress ? to : null,
    resId: offCatalogue ? null : resId, qty, cargoKind,
    product: cargoKind === 'pharma' ? (str(a.product) || null) : null, resKnown,
    legs, ships: true, reason: null, reasonCode: null, serviceOf: null,
    carrierRequired: true,
    phase,
    enforcedToday: !!live,
    enforcedBasis: live ? 'server' : (lane ? 'server-rule-not-running-in-this-session' : 'not-enforced'),
    tag: lane ? 'live' : 'proposed',
    liveLane: lane ? lane.id : null,
    selfHaul, channel, channelDrawn, marketNote,
    cargoClass: cls,
    depotRule: DEPOT_RULE,
    whatHappensToday: live
      ? `${live.short || live.label}: the game already refuses this without a carrier.`
      : (lane
        ? `${lane.short || lane.label}: the live server refuses this without a carrier, but this session is offline / on mock data, so nothing is checking.`
        : (channel
          ? 'Settles instantly with no haul.'
          : `Transport is at Phase ${phase} — "${rung.name}". A carrier is optional today; the lane is drawn through Transport because the owner’s goal asks for it.`)),
    cite: lane ? lane.cite : `${RULE.pdfCite} · today: ${RULE.liveCite}`,
    rule: RULE.id,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   cargoClass() — which KIND of rig carries this resource.

   The four classes are the real ones in public/src/transport/rigs.data.js
   CARGO_CLASSES: freight · oil · feed · livestock. That file's rule is kept:
   "THE DEFAULT IS 'freight'" — an unknown id degrades to the common case, it
   never vanishes and never throws.

   🔴 A TANKER IS AN EXPLICIT LIST OF LIQUIDS AND GASES, NEVER A FAMILY.
   Round 1 said "energy family = tanker, except coal / electricity / nuclear
   fuel". Against the real catalogue the energy family also holds eleven SOLID
   manufactured goods — solarCells, windTurbineParts, generatorParts,
   batteryCells, powerCells, reactorComponents, fusionMaterials, plasmaCells,
   heatCores, hydroCores, energyCubes — and the rule poured every one of them
   into a Ratchet Bowser (32 "oil" ids, 11 of them wrong). The builder's test
   used a stand-in catalogue and never saw it. rigs.data.js defines the class
   as "Crude and product for refineries", so that is the list: what a refinery
   takes in or puts out, plus the gas fuels. Everything else — in the energy
   family or any other — is a crate.
   The cost of the inversion: a NEW liquid fuel added to the catalogue rides
   freight until it is listed here. That is the safe direction (freight is
   rigs.data.js's own default) and audit() names any energy-family id whose
   name looks liquid but is not listed, so it cannot go unnoticed.
   Rejected: a per-id table of all 420. It would be retyped data that drifts
   from the catalogue the day a resource is added.
   Rejected: putting the exotic salvage "fuels" (etherFuel / nightmareFuel,
   family anomalous) in a tanker. They are loot curios handed over by the
   crate, not refinery product.
   ROUND 3 — the chemical family and asphalt. The test is the one above, applied
   with recipes.js open: does the Oil Refinery take it in or put it out?
     · petrochemicals, asphalt — recipes.js has the Oil op making both. Refinery
       product, bulk liquid (hot bitumen rides a tanker): LISTED.
     · industrialGas, chemicalFeedstock, plasticFeedstock — no refinery recipe
       makes or takes them; cylinders, drums and pellets go on a deck. Freight,
       recorded in NOT_TANKER so the tripwire stays quiet ON PURPOSE.
     · rubber, fertilizer — the Oil op makes them, and they are solids. Freight.
     · water, cookingOil, paint, inks — liquid, but a tanker here means the
       Cracking Yard's tanker ("Crude and product for refineries"). Freight.
   audit() now trips on (a) anything the injected recipes say the Oil op makes
   and (b) any energy / chemical / construction id whose name looks liquid,
   unless it is in OIL_IDS or NOT_TANKER. Both lists are the decision record.
   ════════════════════════════════════════════════════════════════════════════ */
export const CARGO_CLASS_IDS = Object.freeze(['freight', 'oil', 'feed', 'livestock']);

/* rigs.data.js: 'oil' = "Crude and product for refineries. Parks in the Cracking Yard." */
export const OIL_IDS = Object.freeze([
  // crude, gas and finished fuels
  'crudeOil', 'naturalGas', 'naturalGasFuel', 'hydrogen', 'fuel', 'gasoline', 'diesel', 'aviationFuel', 'industrialFuel',
  // bulk refinery product outside the energy family (round 3)
  'petrochemicals', 'asphalt',
  // the Cracking Yard cuts
  'naphtha', 'kerosene', 'gasOil', 'heavyOil', 'slop', 'ethanol', 'reformate', 'alkylate', 'butane', 'catGasoline', 'hydrotreatedCut', 'reprocessedSlop',
]);
/* rigs.data.js: 'feed' = "Bulk animal feed and grain, delivered to a farm in tonnes". */
export const FEED_IDS = Object.freeze(['animalFeed', 'corn', 'wheat', 'rice', 'soybeans', 'seeds', 'biomass']);
/* rigs.data.js: 'livestock' = "Live animals, moved by the head". */
export const LIVESTOCK_IDS = Object.freeze(['livestock', 'poultry']);
/* audit()'s tripwire only — it never decides a class. */
const LOOKS_LIQUID = /fuel|oil|gas|diesel|petrol|kerosene|naphtha|hydrogen|ethanol|feedstock|asphalt|bitumen|lubric/i;
const LIQUID_FAMILIES = Object.freeze(['energy', 'chemical', 'construction']);
const REFINERY = 'oil';
/* Looked at, and deliberately NOT tanker cargo. The reason is data so a view
   (or the next critic) can read the decision instead of re-deriving it. */
export const NOT_TANKER = Object.freeze({
  nuclearFuel: 'Fuel rods in a shielded cask, not a liquid.',
  industrialGas: 'Pressurised cylinders on a deck; no refinery recipe makes or takes it.',
  chemicalFeedstock: 'Drummed / bagged feedstock; no refinery recipe makes or takes it.',
  plasticFeedstock: 'Pellets in sacks; no refinery recipe makes or takes it.',
  rubber: 'The Oil op makes it, and it is a solid.',
  fertilizer: 'The Oil op makes it, and it is a bagged solid.',
});

function catalogRows(catalog) {
  if (!catalog) return null;
  try {
    if (typeof catalog.all === 'function') return catalog.all();
    if (Array.isArray(catalog)) return catalog;
    if (Array.isArray(catalog.CATALOG)) return catalog.CATALOG;
    return Object.keys(catalog).map((id) => ({ ...(catalog[id] && typeof catalog[id] === 'object' ? catalog[id] : {}), id }));
  } catch (_) { return null; }
}
/* true / false / null (= no readable catalogue, cannot say). PHANTOMS are
   refused even if a row for one ever appears. */
function resourceKnown(resId, catalog) {
  if (!catalog) return null;
  try {
    if (typeof catalog.isPhantom === 'function' && catalog.isPhantom(resId) === true) return false;
    if (typeof catalog.has === 'function') return catalog.has(resId) === true;
    const rows = catalogRows(catalog);
    return rows ? rows.some((r) => r && r.id === resId) : null;
  } catch (_) { return null; }
}
function familyOf(resId, catalog) {
  if (!catalog) return null;
  try {
    if (typeof catalog.family === 'function') return catalog.family(resId) || null;
    let row = null;
    if (typeof catalog.byId === 'function') row = catalog.byId(resId);
    else if (Array.isArray(catalog)) row = catalog.find((r) => r && r.id === resId);
    else if (Array.isArray(catalog.CATALOG)) row = catalog.CATALOG.find((r) => r && r.id === resId);
    else if (has(catalog, resId)) row = catalog[resId];
    return row ? (row.chainCat || row.cat || row.family || null) : null;
  } catch (_) { return null; }   // total: a broken injected catalogue must not take the map down
}

export function cargoClassDetail(resId, catalog) {
  const id = str(resId);
  if (LIVESTOCK_IDS.includes(id)) return { cargoClass: 'livestock', basis: 'id', why: 'Live animals move by the head in a stock wagon.' };
  if (FEED_IDS.includes(id)) return { cargoClass: 'feed', basis: 'id', why: 'Bulk feed and grain ride a hopper, in tonnes.' };
  if (OIL_IDS.includes(id)) return { cargoClass: 'oil', basis: 'id', why: 'Crude, gas or a refinery product — tanker cargo.' };
  const fam = familyOf(id, catalog);
  return { cargoClass: 'freight', basis: fam ? 'family' : 'default', family: fam, why: 'General freight — the default class in rigs.data.js.' };
}
export function cargoClass(resId, catalog) { return cargoClassDetail(resId, catalog).cargoClass; }

/* ════════════════════════════════════════════════════════════════════════════
   quote() — a RELATIVE cost indicator, derived from the live transport op row.

   🔴 NO PRICE IS WRITTEN HERE (CLAUDE.md: all operation pricing goes through
   _opEcon()). The caller passes opEcon('transport'); every number in the result
   is one of that row's own fields, the route's qty, an injected rig capacity,
   or a ratio / product of those.

   What it means: a Transport crew that is NOT hauling your cargo is earning
   `ratePerWorkerHr` on its default work. So that is the floor a sensible
   carrier asks per worker-hour (opportunity cost), while wages + fuel are what
   the hour costs them. The hospital prices its carrier from the same row.
   ⚠ This is an INDICATOR for the map, never a bill. A real haul is priced by
   the server (transport_quote returns price / eta / risk), and a caller that
   has made that round trip must prefer it — routes.js says the same of itself.

   QUANTITY. Round 1 returned the same indicator for one unit and a thousand,
   silently. There is still no per-unit tariff in OPS_ECON to derive one from,
   and inventing one would be an invented price — so size is expressed the only
   honest way available: LOADS. opts.rigCapacity is how many units of this
   cargo class one rig run carries (the caller reads it off a real rig row —
   rigs.data.js keeps litres / tonnes / head per class; nothing is assumed
   here). loads = ceil(qty / capacity), and the per-load floor is multiplied by
   it. With no capacity injected the result says so in `lines` and sets
   `scalesWithQty: false` instead of pretending.
   opts: { rigCapacity?: number | { freight?, oil?, feed?, livestock? }, rigCapacityUnit?: string }
   ════════════════════════════════════════════════════════════════════════════ */
export function quote(routeResult, opEconTransport, opts) {
  try { return quoteUnguarded(routeResult, opEconTransport, opts); } catch (_) {
    return { ok: false, hauls: 0, reason: 'Unreadable route or Transport economy row.', basis: null, indicator: null, lines: [], selfHaul: false, cargoClass: null, scalesWithQty: false };
  }
}
function quoteUnguarded(routeResult, opEconTransport, opts) {
  const r = routeResult && typeof routeResult === 'object' ? routeResult : {};
  const row = opEconTransport && typeof opEconTransport === 'object' ? opEconTransport : null;
  const o = opts && typeof opts === 'object' ? opts : {};
  const hauls = Array.isArray(r.legs) ? r.legs.filter((l) => l && l.kind === 'haul').length : 0;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const pos = (v) => (Number.isFinite(v) && v > 0 ? v : null);
  const cls = r.cargoClass || null;
  const none = (reason) => ({ ok: false, hauls, reason, basis: null, indicator: null, lines: [], selfHaul: !!r.selfHaul, cargoClass: cls, scalesWithQty: false });

  if (!hauls) return none(r.reason || 'Nothing to haul on this lane.');
  if (!row) return none('Live Transport economy row not available (bridge not ready).');

  const earns = num(row.ratePerWorkerHr);
  const wages = num(row.salaryPerWorkerHr);
  const crew = num(row.maxWorkers);
  const inputs = row.inputs && typeof row.inputs === 'object' ? row.inputs : {};
  const burn = Object.keys(inputs).filter((k) => Number.isFinite(inputs[k])).map((k) => ({ resId: k, perWorkerHr: inputs[k] }));

  /* Self-haul: Transport moving its own fuel / rigs pays wages and fuel but
     charges itself no margin — so its floor is the wage, not the opportunity cost. */
  const floor = r.selfHaul ? wages : earns;
  if (floor === null) return none('Transport row has no worker rate.');

  const qty = pos(r.qty);
  const capRaw = o.rigCapacity && typeof o.rigCapacity === 'object' ? o.rigCapacity[cls] : o.rigCapacity;
  const cap = pos(capRaw);
  const loads = qty !== null && cap !== null ? Math.ceil(qty / cap) : null;
  const unit = str(o.rigCapacityUnit) || 'units';

  const indicator = {
    unit: 'Cinder per carrier worker-hour',
    askFloorPerWorkerHr: floor,
    carrierCostPerWorkerHr: wages,
    /* How many times its wage bill a crew-hour is worth to the carrier — the
       most useful "is haulage dear right now?" number, and it is unitless. */
    askOverWages: wages ? floor / wages : null,
    fullCrewPerHr: crew !== null ? floor * crew : null,
    burnsPerWorkerHr: burn,
    /* Size of THIS shipment. `relativeSize` is unitless: this many times the
       haulage of a one-load shipment on the same lane. */
    qty, rigCapacity: cap, loadsNeeded: loads, relativeSize: loads,
    askFloorAllLoadsPerWorkerHr: loads !== null ? floor * loads : null,
  };
  const lines = [r.selfHaul
    ? 'Transport hauls this itself: it pays crew wages and fuel, no carrier margin.'
    : 'A carrier gives up its normal crew earnings to drive this, so expect to pay at least that per crew-hour.'];
  if (burn.length) lines.push(`Every crew-hour on the road burns ${burn.map((b) => b.resId).join(', ')} — haulage gets dearer when that is scarce.`);
  if (loads !== null) lines.push(`${qty} ${unit} is ${loads} ${cls || 'freight'} rig load${loads > hauls ? 's' : ''} at ${cap} ${unit} a run — about ${loads}x the haulage of a single load.`);
  else if (qty !== null) lines.push('Quantity is not priced here: the game has no per-unit haulage tariff to derive one from, so this indicator is per crew-hour whatever the size. A bigger shipment means more rig loads.');
  else lines.push('No quantity given — the indicator is per crew-hour, for one rig run.');
  if (!r.enforcedToday) lines.push('Indicator only: today a carrier is optional on this lane.');

  return {
    ok: true, hauls, reason: null,
    basis: { source: "opEcon('transport')", ratePerWorkerHr: earns, salaryPerWorkerHr: wages, maxWorkers: crew, inputs: burn, rigCapacity: cap, rigCapacitySource: cap !== null ? 'injected by caller (opts.rigCapacity)' : null },
    indicator, lines, selfHaul: !!r.selfHaul, cargoClass: cls, scalesWithQty: loads !== null,
    preferServer: 'transport_quote (price, eta, risk) wins over this whenever it has been called.',
  };
}

/* Where opts.rigCapacity comes from. rigs.data.js rows carry a real size for
   three of the four classes — `litres` (oil), `tonnes` (feed), `head`
   (livestock) — and NONE for freight, whose rigs only have a relative `cargo`
   multiplier. So a freight shipment honestly cannot be turned into loads, and
   this returns capacity null for it rather than inventing a crate count.
   The rig row is INJECTED (bridge / caller); nothing is imported or assumed.
   🔗 SEAM DEPENDENCY (recorded in sc/decisions/shipping.md): sc.bridge.js has
   no accessor for the player's rig or an offline flag yet. Until it does, the
   views call quote() with no capacity and the result says so in words. */
const RIG_SIZE_FIELD = Object.freeze({ oil: 'litres', feed: 'tonnes', livestock: 'head' });
export function capacityOfRig(rig) {
  try {
    const cls = rig && typeof rig.cargoClass === 'string' && CARGO_CLASS_IDS.includes(rig.cargoClass) ? rig.cargoClass : 'freight';
    const f = RIG_SIZE_FIELD[cls] || null;
    const v = f && Number.isFinite(rig[f]) && rig[f] > 0 ? rig[f] : null;
    return { cargoClass: cls, capacity: v, unit: v !== null ? f : null,
      why: v !== null ? 'Read from the rig row.' : (cls === 'freight' ? 'Freight rigs carry no unit size in rigs.data.js, only a relative cargo multiplier.' : 'This rig row has no size field.') };
  } catch (_) { return { cargoClass: 'freight', capacity: null, unit: null, why: 'Unreadable rig row.' }; }
}

/* ════════════════════════════════════════════════════════════════════════════
   pdfTruckDrawn() — did the OWNER draw a truck beside this tile?

   The written goal says every business ships via Transport; the map draws no
   truck beside five tiles. Both are the owner's word, and they conflict
   (pdfmap brief 6-B, owner decision D6). This function keeps the conflict
   visible instead of quietly picking a side: `drawn` is what the PDF shows,
   `label` is what the UI prints. `shipsCargo` is the separate fact "route()
   will produce a goods lane for this tile" — and it is now TRUE for all five,
   so the label never promises a lane that cannot exist (the round-1
   contradiction on Dojo and Card Shop).
   `ctx` (optional third argument) carries recipes for the service-tile case.
   ════════════════════════════════════════════════════════════════════════════ */
export function pdfTruckDrawn(bizId, businesses, ctx) {
  try { return pdfTruckDrawnUnguarded(bizId, businesses, ctx); } catch (_) {
    return { id: str(bizId), drawn: false, basis: 'unknown', label: 'not a tile on the map', shipsCargo: false, source: 'bad-input', cite: null };
  }
}
function pdfTruckDrawnUnguarded(bizId, businesses, ctx) {
  const id = str(bizId);
  const c = { ...(ctx && typeof ctx === 'object' ? ctx : {}), ...(businesses ? { businesses } : {}) };
  let drawn = PDF_TRUCK_DRAWN.includes(id);
  let source = 'shipping.js transcription of pdfmap brief section 5';
  const row = bizRow(id, c.businesses);
  if (row && row.icons && typeof row.icons.transport === 'boolean') { drawn = row.icons.transport; source = 'businesses.js icons.transport'; }
  const kind = tileKindU(id, c);
  const goods = handlesGoods(id, c);

  if (id === CARRIER) return { id, drawn: false, basis: 'hub', label: 'this is the Transport company', shipsCargo: true, source, cite: RULE.pdfCite };
  if (kind === null) return { id, drawn: false, basis: 'unknown', label: 'not a tile on the map', shipsCargo: false, source, cite: null };
  if (kind === 'service' && !drawn) {
    return { id, drawn: false, basis: 'service', shipsCargo: goods, source,
      label: goods ? 'sells a service — the goods it consumes or makes still ride Transport' : 'sells a service — no goods known for it yet',
      goodsBasis: goodsEvidence(id, c).basis,
      cite: 'PDF p8 (Bank, Warehouse) / p9 (Bus, Rail Road, Airport)' };
  }
  return drawn
    ? { id, drawn: true, basis: 'pdf', label: 'truck drawn on the PDF', shipsCargo: goods, source, cite: 'PDF p6-p8, truck icon beside the tile' }
    : { id, drawn: false, basis: 'goal', label: NOT_DRAWN_LABEL, shipsCargo: goods, source,
      cite: 'Written goal ("every busienss has to use the transport company") vs PDF p6-p8 with no truck beside this tile — owner decision D6.' };
}

/* The cargo tiles that ship goods with no truck drawn. Derived from
   businesses.js when injected (so a corrected map changes the report); the
   transcribed five otherwise. */
export function noTruckReport(businesses, ctx) {
  try { return noTruckReportUnguarded(businesses, ctx); } catch (_) { return noTruckReportUnguarded(null, null); }
}
function noTruckReportUnguarded(businesses, ctx) {
  const c = { ...(ctx && typeof ctx === 'object' ? ctx : {}), ...(businesses ? { businesses } : {}) };
  const rows = bizRows(c.businesses);
  const ids = rows
    ? rows.filter((b) => b && b.id && b.id !== CARRIER && tileKindU(b.id, c) === 'cargo' && !(b.icons && b.icons.transport === true)).map((b) => b.id)
    : PDF_TRUCK_NOT_DRAWN;
  return ids.map((id) => {
    const t = pdfTruckDrawn(id, c.businesses, c);
    return { id, drawn: t.drawn, label: t.label, shipsCargo: t.shipsCargo, note: 'Lane drawn through Transport per the written goal.' };
  });
}

/* Every ordered goods lane, for graph.js and for the audit's "0 direct lanes"
   pin. Includes X -> X (another player's business of the same kind) and every
   goods-handling tile — Dojo, Card Shop and Warehouse included. `cargo: true`
   = "some goods", because resId is not known at this level. */
export function allLanes(ctx) {
  /* Unreadable ctx -> the fallback map's lanes, not a throw and not []: an empty
     lane set would read as "Transport carries nothing". */
  let tiles; let cx = ctx;
  try { tiles = shipperTilesUnguarded(ctx); } catch (_) { cx = undefined; tiles = shipperTilesUnguarded(undefined); }
  return lanesOf(tiles, cx);
}
function lanesOf(tiles, ctx) {
  const out = [];
  for (const from of tiles) for (const to of tiles) out.push(route({ from, to, resId: null, cargo: true }, ctx));
  return out;
}

/* exactly pickup > haul(transport) > depot > deliver — the order pins "one of each" */
const fourLegs = (r) => r.legs.map((l) => l.kind).join('>') === 'pickup>haul>depot>deliver'
  && r.legs.every((l) => l.kind !== 'haul' || l.node === CARRIER);

/* Cross-check against injected sibling data WITHOUT importing it (lead contract:
   wave-1 pieces never import a same-wave sibling). Returns problems as strings
   for graph.js's report; an empty list is a pass.
   data: { businesses?, recipes?, coverage?, catalog?, ctx? }
   WHY IT GREW: round 1's audit returned [] against the real siblings while
   three producing tiles had no lane. It only compared tile LISTS. It now checks
   the thing the owner asked for — every product on every recipes.js lane gets a
   route — so the next sibling change that opens a hole is reported, not shipped. */
export function audit(data) {
  try { return auditUnguarded(data); } catch (e) { return ['shipping: audit could not read the injected data — ' + str(e && e.message)]; }
}
function auditUnguarded(data) {
  const problems = [];
  const d = data && typeof data === 'object' ? data : {};
  const rows = bizRows(d.businesses);
  const R = recipeMap(d.recipes);
  const U = usesMap(d.coverage);
  const ctx = { ...(d.ctx && typeof d.ctx === 'object' ? d.ctx : {}), ...(rows ? { businesses: rows } : {}), ...(R ? { recipes: R } : {}), ...(d.coverage ? { coverage: d.coverage } : {}), ...(d.catalog ? { catalog: d.catalog } : {}) };

  if (rows) {
    for (const b of rows) {
      if (!b || !b.id) continue;
      const fb = has(TILE_KIND_FALLBACK, b.id) ? TILE_KIND_FALLBACK[b.id] : null;
      if (fb === null) problems.push(`shipping: tile "${b.id}" is in businesses.js but missing from shipping.js's fallback table (it still routes, from businesses.js kind)`);
      if (!has(KIND_MAP, str(b.kind))) problems.push(`shipping: tile "${b.id}" has kind "${b.kind}" that shipping.js does not know — treated as cargo`);
      /* (a) a tile this file would call a service while the map says it produces / ships */
      if (fb === 'service' && KIND_MAP[b.kind] === 'cargo') problems.push(`shipping: fallback table calls "${b.id}" a service tile but businesses.js kind is "${b.kind}"`);
      if (fb === 'cargo' && KIND_MAP[b.kind] === 'service') problems.push(`shipping: fallback table calls "${b.id}" a cargo tile but businesses.js kind is "${b.kind}"`);
      if (b.goalSaysTransport === true && !handlesGoods(b.id, ctx)) problems.push(`shipping: "${b.id}" has goalSaysTransport:true but route() gives it no goods lane (kind "${b.kind}", no recipes goods)`);
      if (b.icons && b.icons.market === true && !route({ from: b.id, to: DEFAULT_CHANNEL, cargo: true }, ctx).ships) problems.push(`shipping: "${b.id}" has the Marketplace icon drawn but no lane to ${DEFAULT_CHANNEL}`);
      if (b.icons && typeof b.icons.transport === 'boolean' && fb === 'cargo' && b.id !== CARRIER && b.icons.transport !== PDF_TRUCK_DRAWN.includes(b.id)) {
        problems.push(`shipping: truck-drawn disagreement for "${b.id}" — businesses.js says ${b.icons.transport}, shipping.js fallback says ${PDF_TRUCK_DRAWN.includes(b.id)} (businesses.js wins at runtime)`);
      }
    }
    for (const id of Object.keys(TILE_KIND_FALLBACK)) {
      if (!rows.some((b) => b && b.id === id)) problems.push(`shipping: tile "${id}" is classified here but missing from businesses.js`);
    }
  }

  /* (b) every product on every recipes.js lane must get the four legs */
  if (R) {
    for (const id of Object.keys(R)) {
      const rec = R[id] || {};
      const makes = Array.isArray(rec.makes) ? rec.makes.map((m) => (m && m.id) || m).filter((x) => typeof x === 'string') : [];
      for (const target of Array.isArray(rec.sellsTo) ? rec.sellsTo : []) {
        for (const resId of makes) {
          const r = route({ from: id, to: target, resId }, ctx);
          if (!fourLegs(r)) problems.push(`shipping: recipes lane ${id} -> ${target} (${resId}) has no Transport route — ${r.reasonCode}`);
        }
      }
      for (const buy of Array.isArray(rec.buys) ? rec.buys : []) {
        for (const resId of Array.isArray(buy && buy.ids) ? buy.ids : []) {
          const r = route({ from: buy.from, to: id, resId }, ctx);
          if (!fourLegs(r)) problems.push(`shipping: recipes lane ${buy.from} -> ${id} (${resId}) has no Transport route — ${r.reasonCode}`);
        }
      }
    }
  }

  /* (b2) INBOUND, the round-3 hole: what a tile really burns today (recipes.js
     upkeep) must be deliverable from every business recipes.js says makes it,
     and the tile itself must count as a goods tile. */
  if (R) {
    for (const id of Object.keys(R)) {
      const ups = Array.isArray(R[id] && R[id].upkeep) ? R[id].upkeep : [];
      if (ups.length && !handlesGoods(id, ctx)) problems.push(`shipping: "${id}" has ${ups.length} upkeep input(s) in recipes.js but is not treated as handling goods`);
      for (const u of ups) {
        if (!u || typeof u.id !== 'string') continue;
        for (const maker of [...(Array.isArray(u.madeBy) ? u.madeBy : []), DEFAULT_CHANNEL]) {
          const r = route({ from: maker, to: id, resId: u.id }, ctx);
          if (!fourLegs(r)) problems.push(`shipping: upkeep lane ${maker} -> ${id} (${u.id}) has no Transport route — ${r.reasonCode}`);
        }
      }
    }
  }
  /* (b3) every use coverage.js gives a resource must be REACHABLE: from each
     business recipes.js says makes it, and from the Marketplace (where a
     battler's loot is sold — the only sender for the loot-only resources).
     Uses `by` sys:city / sys:camp are deliveries INTO the city or a camp,
     which are freight. 'sim' rows are not needs and are skipped. */
  if (U) {
    const makers = {};
    if (R) for (const b of Object.keys(R)) for (const m of (Array.isArray(R[b] && R[b].makes) ? R[b].makes : [])) { const mid = (m && m.id) || m; if (typeof mid === 'string') (makers[mid] = makers[mid] || []).push(b); }
    for (const resId of Object.keys(U)) {
      for (const use of Array.isArray(U[resId]) ? U[resId] : []) {
        if (!use || typeof use.by !== 'string' || use.role === 'sim') continue;
        if (tileKindU(use.by, ctx) !== null && !handlesGoods(use.by, ctx)) problems.push(`shipping: coverage gives "${resId}" a use at "${use.by}" but that tile is not treated as handling goods`);
        for (const maker of [...(makers[resId] || []), DEFAULT_CHANNEL]) {
          const r = route({ from: maker, to: use.by, resId }, ctx);
          if (!fourLegs(r)) problems.push(`shipping: coverage lane ${maker} -> ${use.by} (${resId}) has no Transport route — ${r.reasonCode}`);
        }
      }
    }
  }

  /* (c) the class lists must name real resources, and no liquid may hide in freight */
  const cat = catalogRows(d.catalog);
  if (cat) {
    const ids = new Set(cat.map((r) => r && r.id));
    for (const [name, list] of [['OIL_IDS', OIL_IDS], ['FEED_IDS', FEED_IDS], ['LIVESTOCK_IDS', LIVESTOCK_IDS]]) {
      for (const id of list) if (!ids.has(id)) problems.push(`shipping: ${name} lists "${id}" which is not in the catalogue`);
    }
    for (const id of Object.keys(NOT_TANKER)) {
      if (!ids.has(id)) problems.push(`shipping: NOT_TANKER lists "${id}" which is not in the catalogue`);
      if (OIL_IDS.includes(id)) problems.push(`shipping: "${id}" is in both OIL_IDS and NOT_TANKER`);
    }
    for (const r of cat) {
      if (!r || !r.id || has(NOT_TANKER, r.id)) continue;
      const fam = familyOf(r.id, d.catalog);
      if (LIQUID_FAMILIES.includes(fam) && LOOKS_LIQUID.test(r.id) && cargoClass(r.id, d.catalog) !== 'oil') {
        problems.push(`shipping: ${fam}-family "${r.id}" looks like a liquid / gas but is in neither OIL_IDS nor NOT_TANKER — it will ride freight undecided`);
      }
    }
  }
  /* Everything the refinery makes is a decision: tanker, or a written "no". */
  if (R && R[REFINERY] && Array.isArray(R[REFINERY].makes)) {
    for (const m of R[REFINERY].makes) {
      const mid = (m && m.id) || m;
      if (typeof mid === 'string' && !OIL_IDS.includes(mid) && !has(NOT_TANKER, mid)) problems.push(`shipping: the ${REFINERY} op makes "${mid}" but it is in neither OIL_IDS nor NOT_TANKER`);
    }
  }

  for (const lane of allLanes(ctx)) {
    if (!fourLegs(lane)) problems.push(`shipping: lane ${lane.from} -> ${lane.to} is not pickup>haul>depot>deliver through ${CARRIER}`);
  }
  /* The round-4 defect, pinned: no catalogue resource may ever read as enforced,
     every live lane must be reachable by its cargoKind, and a Marketplace
     channel must switch it off. */
  for (const l of LIVE_LANES) {
    if (l.resId !== null || !LIVE_KINDS.includes(l.cargoKind)) problems.push(`shipping: live lane "${l.id}" is keyed on a catalogue resource — only an off-catalogue cargoKind may be enforced today`);
    const on = route({ from: l.from, to: l.to, cargoKind: l.cargoKind }, { ...ctx, offline: false, signedIn: true, serverRules: undefined });
    if (!(on.enforcedToday && fourLegs(on))) problems.push(`shipping: live lane "${l.id}" cannot be asked for`);
    if (route({ from: l.from, to: l.to, cargoKind: l.cargoKind, channel: DEFAULT_CHANNEL }, ctx).enforcedToday) problems.push(`shipping: live lane "${l.id}" reads as enforced through the Marketplace, which settles instantly`);
  }
  if (cat) for (const r of cat) {
    if (r && r.id && route({ from: 'medical', to: 'medical', resId: r.id }, ctx).enforcedToday) problems.push(`shipping: catalogue resource "${r.id}" reads as enforced today`);
  }
  if (effectivePhaseU({ transportPhase: Number.MAX_SAFE_INTEGER }) > ROUTES_PHASE) problems.push('shipping: reported phase exceeds routes.js PHASE');
  return problems;
}

export const SHIPPING_META = Object.freeze({
  routesPhase: ROUTES_PHASE,
  cargoTiles: CARGO_TILES.length,
  serviceTiles: Object.keys(SERVICE_TILES).length,
  goodsTilesFallback: shipperTiles().length,
  liveLanes: LIVE_LANES.map((l) => l.id),
  round: 'r4 — the live pharma lane carries compounded products (cargoKind pharma), never raw medicine; a Marketplace channel is never a live lane; unknown resources are not drawn; every export is total. r3 — inbound goods (upkeep + coverage uses) reach every tile; a named resource always routes; depot leg is enforcedWhenHauled; sameOwner is an arg',
});
