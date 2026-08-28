/* ════════════════════════════════════════════════════════════════════════════
   🚛 TRANSPORTATION COMPANIES — module entry point. Registers window.MythicTransport.
   ----------------------------------------------------------------------------
   Spec: docs/transport-company-design.md. New features live OUTSIDE index.html
   (CLAUDE.md), so the rig catalog, the route maths, the Supabase access, the UI
   and this launcher are all here and NONE of it is added to index.html. The
   legacy file gets five small additive hunks and a bridge block, nothing else.

   🔴 THE GLOBALS TRAP — a LANGUAGE MECHANIC, not a style preference. `Profile`,
   `Cloud`, `App`, `Corp`, `Forge` are top-level `const` in index.html: global
   LEXICAL bindings, which are NOT properties of the global object. `window.Profile`
   is undefined however global `const Profile` looks, and an ES module has no
   access to another script's lexical scope. This has already cost real time
   twice (FoundationReserve and Profile, both in the Node City bridge). So this
   module reads NOTHING by itself — index.html hands over
   `window.MythicTransportBridge`, and if the bridge is missing the module
   registers, opens to a "not set up yet" panel, stays inert, and says so ONCE.
   If something new is needed from the legacy app, add it to the bridge in BOTH
   places (transport.bridge.js's NULL_BRIDGE and the index.html block). Never
   reach around.

   🔴 TWO ID DOMAINS, AND CONFUSING THEM IS A BUG THIS FILE HAS ALREADY SHIPPED.
   A rig has two identities and they are NOT interchangeable:
     • the VEHICLE id — 'v…', minted by index.html's `_ppNewId('v')` on the
       Prince Portfolios lot (~80549). It is what `b.lot()` rows carry, what
       `setRigField()` takes, what the renderer stamps into `data-mt-id`, and
       what `registerRig()` stores in `transport_rigs.vehicle_id`.
     • the RIG ROW id — the uuid PRIMARY KEY of `transport_rigs`. It is what
       every server RPC means by `p_rig_id`: sql/038 ~2397 declares
       `transport_repair(p_rig_id uuid)` and looks it up as `transport_rigs.id`,
       and `transport_dispatch` claims the run off `r.id = p_rig_id` at ~2064.
   An earlier revision of this file sent the VEHICLE id to `repair()`, which
   forwards it as `p_rig_id`. That does not fail loudly — it comes back as
   `no_such_rig` for a rig sitting right there on screen, which reads as a
   broken button rather than as a type error. `rigRowId()` below is the ONLY
   crossing between the two domains, and every RPC argument goes through it.

   ⚠ Everything here is wrapped so a failure inside freight can never take the
   game down. Transport is a feature; the game is the product. Nothing throws at
   import time, there is no top-level await, and the only top-level statement
   with a side effect is the guarded registration at the bottom.

   ⚠ THE CINDER RULE, because this module is one click from a spend: no money
   moves in this file. Founding the charter is bought in Just Business through
   `_opFound`/`_opEcon`; freight is debited inside `transport_dispatch()`. This
   file confirms, calls, reads the return value, and prints the refusal. A
   client that both quotes and charges is a client that can be argued with.
   ════════════════════════════════════════════════════════════════════════════ */

import {
  PP_RIGS, PP_RIGS_BY_ID, RIG_RARITIES, rollRig, rigById, rarityIndex,
  effectiveRuns, fleetSlotBonus, runsPerDayBonus, auditRigs,
} from './rigs.data.js';
import {
  PHASE, MERIDIAN, MERIDIAN_TARIFF_MULT, MERIDIAN_TIME_MULT,
  hops, inReach, tariffCap, quote, meridianQuote,
} from './routes.js';
import {
  MISSING_RE, OFFLINE, myCompany, listCarriers, listMyRigs, listContracts,
  createCompany, setTariff, registerRig, dispatch, settle, repair,
} from './contracts.js';
import { DEPOT_DEF_ID, depots, bestDepot, depotEffect, fleetCap, bays, depotReady } from './depot.js';
import { TRANSPORT_CSS, renderTransport } from './depot.render.js';
import { bridge, bridgeReady, esc, fmtNum } from './transport.bridge.js';

/* 📌 PINNED, AND IT LIVES IN TWO FILES. This id is the ONLY thing joining the
   element open() creates to the stylesheet that makes it a full-screen overlay:
   depot.render.js keys `#mythic-transport-ov{position:fixed;inset:0;…}` to this
   exact literal (depot.render.js:268, and its comment at :247 names this line
   from the other side). CSS cannot import a constant, so the two copies are
   held in agreement by these two comments and nothing else. Rename it here and
   the panel renders as an unstyled block in the page flow — content visible,
   nothing dismissable — which reads as "the depot screen is broken" rather than
   as a missing rule. If it ever has to change, change BOTH in one edit. */
const OV = 'mythic-transport-ov';
const CSS_ID = 'mt-css';

/* Panel state. Deliberately NOT a cache of anything the server owns: these rows
   are the last thing the tables said, they are redrawn from a refresh, and no
   decision in this file is made from them alone — price, reach, run budget and
   the day key are all re-checked inside transport_dispatch(). The client's copy
   is instant feedback, never enforcement. Same call v120g0 made when world chat
   moved to the chat_send() RPC. */
const S = {
  tab: 'depot',              // 'depot' | 'fleet' | 'exchange'
  loading: false,
  missing: false,            // the tables are not installed — a DIFFERENT sentence
  offline: false,            // no Cloud — also a different sentence
  error: '',
  company: null,
  rigs: [],
  carriers: [],
  contracts: [],
  quote: null,
  /* The last thing typed into the exchange form. depot.render.js:645 records
     the defect this closes IN ITS OWN COMMENT and asks for exactly this key:
     paint() replaces the overlay's innerHTML, which destroys the five <input>
     elements and everything in them, so the second "Get a quote" press read a
     blank form and was refused with "Pick where the cargo is and where it is
     going" over a form the player could see was filled in. Echoing the last
     selection back on the view restores it after every repaint.
     Kept HERE and not in the renderer on purpose — the renderer is pure, and a
     module variable inside it would give two places an opinion about what the
     form says. */
  form: { from: '', to: '', resId: '', units: 0, carrierId: '' },
};

let busy = false;            // re-entrancy guard around async actions
let _warned = false;         // the bridge-absent warning fires exactly once
let _lastThrow = '';         // last cross-module throw, for debug() only
let _refreshToken = 0;       // stale-response guard, see refresh()
let _tick = 0;               // ETA repaint interval id, cleared by close()
let _starterSeeded = false;  // in-session starter-rig guard
let _starterPending = false; // seeding was refused; retry on the next good read
/* The starter-rig REFUSAL has been spoken once this session. seedStarter()'s
   return is a player-facing refusal, not merely a `seeded` flag — refresh()
   used to read `if (r && r.seeded)` and drop `why`/`fix` on the floor, so the
   four sentences seedStarter writes ('spent', 'full', 'nobridge', generic)
   were reachable from nowhere: the player was told to "free a slot and reopen
   the Freight Depot" (index.html's founding toast) and the reopened depot said
   nothing at all. Latched because refresh() runs on an every-action cadence and
   an un-latched toast would be the same silence in the opposite key. Cleared
   when a seed actually lands, so a later refusal can still be heard. */
let _starterToldWhy = false;

/* ── the seam ───────────────────────────────────────────────────────────────
   Re-derived on EVERY call rather than captured once, so a bridge that mounts
   after this module loads still works — index.html's script order is not
   something a feature directory should have an opinion about. Never returns
   null: bridge() substitutes NULL_BRIDGE, so every path below is total and
   "no bridge" is a state the UI draws rather than an error it hits. */
function B() {
  const b = bridge();
  if (b._null && !_warned) {
    _warned = true;
    try {
      console.warn('[transport] window.MythicTransportBridge is absent — freight is inert. index.html must hand the module its capabilities (the globals trap; see transport.bridge.js).');
    } catch (e) {}
  }
  return b;
}

/* ── total call helpers ─────────────────────────────────────────────────────
   Six files in this feature call each other. Their NAMES are a pinned contract;
   their exact arities are not, and a mismatch between two files must degrade to
   a printable refusal rather than to an overlay that will not open. So every
   cross-module call goes through one of these two and returns a typed neutral
   on a throw, a missing export, or an undefined result. */
function call(fn, fallback) {
  try {
    if (typeof fn !== 'function') return fallback;
    const v = fn.apply(null, Array.prototype.slice.call(arguments, 2));
    return (v === undefined || v === null) ? fallback : v;
  } catch (e) { _lastThrow = String((e && e.message) || e); return fallback; }
}
async function acall(fn, fallback) {
  try {
    if (typeof fn !== 'function') return fallback;
    const v = await fn.apply(null, Array.prototype.slice.call(arguments, 2));
    return (v === undefined || v === null) ? fallback : v;
  } catch (e) { _lastThrow = String((e && e.message) || e); return fallback; }
}

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d || 0); };
const okOf = (r) => r === true || Array.isArray(r) || !!(r && r.ok === true);
const rowsOf = (r) => Array.isArray(r) ? r : (Array.isArray(r && r.rows) ? r.rows : []);

/* A carrier's tariff is JSONB, not a number. contracts.js:830 writes it as
   `{ base, escort_pct, illicit_pct }` because transport_quote reads the rate as
   `(tariff->>'base')::numeric`, and setTariff() normalises a bare number INTO
   that shape for exactly that reason. So `Number(row.tariff)` is NaN on every
   real row — which would print every player's rate as 0 on the board AND, worse,
   drop every rate out of medianTariff() (routes.js:294 skips non-finite values),
   collapsing the exchange ceiling to the floor tariff and making Meridian the
   cheapest carrier in the game. One reader, both shapes. */
function tariffOf(row) {
  try {
    if (!row) return 0;
    const t = row.tariff;
    if (t && typeof t === 'object') return num(t.base);
    return num(t);
  } catch (e) { return 0; }
}

/* "Missing table" and "offline" are NOT errors, they are designed states, and
   they are three different sentences to the player: run the SQL / you are
   offline / here is what actually broke. A generic "something went wrong" hides
   the only one of the three they can act on.

   ⚠ MISSING_RE is re-built stateless before use. A shared RegExp carrying the
   /g or /y flag keeps `lastIndex` between `.test()` calls, so the SAME error
   string tests true, then false, then true — which would make the "run sql/038"
   banner appear on every other refresh and look like a flapping backend. */
function isMissing(err) {
  try {
    if (!err) return false;
    const s = String(err);
    if (MISSING_RE instanceof RegExp) {
      return new RegExp(MISSING_RE.source, MISSING_RE.flags.replace(/[gy]/g, '')).test(s);
    }
    return /does not exist|schema cache|could not find the table/i.test(s);
  } catch (e) { return false; }
}

function classify(r) {
  try {
    if (!r || typeof r !== 'object' || r.ok === true) return;
    if (r.missing === true || isMissing(r.error)) { S.missing = true; return; }
    if (r.offline === true || (OFFLINE && r.offline === OFFLINE.offline && r.ok === false && !r.error)) { S.offline = true; return; }
    if (r.error && !S.error) S.error = String(r.why || r.error);
  } catch (e) {}
}

/* One reason string for a refusal, in the order the player can act on it:
   what happened, then what to do about it. contracts.js writes both halves for
   every code it knows; anything it does not know still gets a sentence rather
   than an empty toast, because "" is the failure mode this whole file is
   arranged against. */
function reasonOf(r) {
  try {
    if (!r || typeof r !== 'object') return 'The freight service refused without a reason.';
    const why = r.why ? String(r.why) : '';
    const fix = r.fix ? String(r.fix) : '';
    if (why && fix) return why + ' ' + fix;
    if (why) return why;
    if (r.error) return String(r.error);
    return 'The freight service refused without a reason.';
  } catch (e) { return 'The freight service refused without a reason.'; }
}

/* ── the two id domains ─────────────────────────────────────────────────────
   THE ONLY CROSSING, and everything that talks to the server goes through it.
   `listMyRigs()` selects `id` AND `vehicle_id` (contracts.js:685) precisely so
   this lookup is possible without a second round trip.

   The `r.id === vehicleId` arm is not paranoia: if a future renderer ever
   stamps a rig row id into `data-mt-id` instead of a vehicle id, this keeps
   working rather than silently addressing nothing. It cannot collide — a lot
   vehicle id is `_ppNewId('v')`, which is not a uuid.

   An UNKNOWN id returns '' rather than falling back to the argument. Falling
   back is how the original bug looked correct in review: it "works" until the
   value reaches `p_rig_id uuid`, and then it is a `no_such_rig` on a rig the
   player is looking at. '' is refused HERE, with a sentence. */
function rigRowId(vehicleId) {
  try {
    if (!vehicleId) return '';
    const v = String(vehicleId);
    const row = S.rigs.find((r) => r && (
      String(r.vehicle_id || r.vehicleId || '') === v || String(r.id || '') === v));
    return (row && row.id) ? String(row.id) : '';
  } catch (e) { return ''; }
}

/* ── the paid Garage rail ───────────────────────────────────────────────────
   🔴 RATIFIED, NOT UP FOR REVISITING. Garage rigs are bought with REAL MONEY
   and are the player's OWN operative cap and OWN freight. PP fleet rigs bought
   with Cinder haul OTHER players' cargo and never raise the owner's personal
   cap. Garage ownership pays out instead as a FLEET-WIDE perk, so shipping this
   feature makes the paid tier MORE valuable rather than less.
   Resolved in ONE place because three call sites need the tier — the view, the
   registration fields and the fleet list — and three readings of `garageRig()`
   is three chances for them to disagree about what the player paid for. */
function garageInfo(b) {
  const g = call(b.garageRig, { owned: false, name: 'Hand-hauled', tier: 0 });
  const tier = num(g && g.tier);
  return {
    owned: !!(g && g.owned),
    name: String((g && g.name) || 'Hand-hauled'),
    tier,
    slotBonus: num(call(fleetSlotBonus, 0, tier)),
    runBonus: num(call(runsPerDayBonus, 0, tier)),
    // Not on the pinned view shape; carried for routes.js, which prices a haul
    // off the rig's load/speed/risk. See quoteRequest().
    load: num(g && g.load, 1),
    speed: num(g && g.speed, 1),
    risk: num(g && g.risk, 0),
  };
}

/* ── what a registration has to carry ───────────────────────────────────────
   🔴 runs_cap IS THE CALLER'S TO SUPPLY, AND THIS FILE IS THAT CALLER.
   contracts.js ~1111 says so in as many words and refuses to derive it: "the fix
   is for the caller to pass it, not for this file to grow a rarity table."
   sql/038 ~603 declares `runs_cap int not null default 3`, so a registration
   that omits it books a MYTHIC rig — 10 runs a day, ~3.4M Cinder on the auction
   floor — at three runs a day, forever, because nothing on the server ever
   recomputes the column. The player would be paid a third of what they bought.

   rigs.data.js's `effectiveRuns()` IS the ladder (3/4/5/6/8/10 by rarity ×
   PP_COND_MULT, floored, minimum 1, plus the Garage perk). It is asked, never
   copied — a second ladder here is the drift that gives one rig two truths, and
   the auction minigame already runs a second incompatible rarity list.

   ⚠ AND IT IS A SNAPSHOT, WHICH IS A PROPERTY OF THE COLUMN AND NOT A BUG HERE.
   `transport_repair` moves `condition` up a rung and does NOT touch `runs_cap`
   (sql/038 ~2456 — the UPDATE sets repairs_used, repair_day and condition only).
   So a rig repaired from Wrecked to Clean keeps the cap it was registered with.
   Closing that needs a server-side recompute or a `transport_set_runs_cap` RPC,
   both of which are a migration; until then fleetBlock() shows the SERVER'S
   number, not the ladder's, so the panel never promises a run the exchange will
   refuse. Direction of failure chosen deliberately, and it matches sql/038 ~598:
   "if the two ever disagree the carrier gets FEWER runs than the UI promised."

   ⚠ The Garage perk IS folded in, via the tier. rigs.data.js:392 is explicit
   that the perk is added after the condition floor because "a real-money perk
   that silently stops working is a refund conversation, not a balance one" —
   and a runs_cap written without it is exactly that: the server clamps to
   `least(runs_cap, max_runs_per_rig)` and the paid bonus run never lands. */
function registrationFields(b, vehicleId, garage) {
  const veh = call(b.lot, []).find((v) => v && (v.vehicleId === vehicleId || v.id === vehicleId)) || null;
  if (!veh) return null;
  const def = call(rigById, null, veh.rigId);
  return {
    vehicle: veh,
    // rarity and condition come off the lot vehicle because index.html's
    // `_transportGrantStarterRig()` (~80483) parks it carrying both, and the
    // auction floor parks its winnings the same way. transport_rigs CHECKs both
    // columns, so a junk value is refused by Postgres rather than stored.
    rarity: veh.rarity || (def && def.rarity) || null,
    condition: veh.condition || null,
    runsCap: num(call(effectiveRuns, 0, def && def.id, veh.condition, garage.tier)),
    name: veh.name || (def && def.name) || 'Unnamed rig',
  };
}

/* ── view assembly ──────────────────────────────────────────────────────────
   renderTransport(view) is PURE — it returns a string and attaches nothing.
   This function owns the whole translation from bridge + rows to the pinned
   view shape, which is why the renderer never has to know a bridge exists. */

// Resources are read TOLERANTLY: index.html's two existing bridges disagree
// about this key (MythicTradeBridge ships `resources: () => …`, MythicCityBridge
// ships the bare array), so assuming either form breaks against the other.
function resDefs(b) {
  try { return (typeof b.resources === 'function') ? (b.resources() || []) : (b.resources || []); }
  catch (e) { return []; }
}

function cargoText(b, cargo) {
  try {
    if (!cargo || typeof cargo !== 'object') return '—';
    const defs = resDefs(b);
    const nameOf = (id) => { const d = defs.find((x) => x && x.id === id); return (d && d.name) || id; };
    const parts = Object.keys(cargo).map((k) => fmtNum(cargo[k]) + ' ' + nameOf(k));
    return parts.length ? parts.join(', ') : '—';
  } catch (e) { return '—'; }
}

function etaText(arriveAt) {
  try {
    const t = new Date(arriveAt).getTime();
    if (!Number.isFinite(t)) return '—';
    const ms = t - Date.now();
    if (ms <= 0) return 'arrived';
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
  } catch (e) { return '—'; }
}

function progressOf(row) {
  try {
    const a = new Date(row.depart_at || row.departAt).getTime();
    const z = new Date(row.arrive_at || row.arriveAt).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) return 0;
    return Math.max(0, Math.min(1, (Date.now() - a) / (z - a)));
  } catch (e) { return 0; }
}

/* depot.js is the SINGLE AUTHORITY for what the Freight Depot gives — bays,
   fleet capacity and reach all come from its level table. This function
   normalises the answer and fills a gap from depot.js's own helpers; it never
   re-derives a number from the level, because a second copy of that table is
   how a UI ends up promising four bays while dispatch enforces two.

   🔴 THE ARGUMENT LISTS ARE EMPTY ON PURPOSE, AND THAT IS A CHANGE.
   `depotReady()`, `bays()` and `fleetCap(garageTier)` read the bridge
   themselves; none of them wants one passed. An earlier revision called
   `fleetCap(b)` — the BRIDGE as the tier — and got the right answer only
   because `Number(bridge)` is NaN, which depot.js:296 documents as a live
   double-count trap: the Garage slot is added ONCE, below, and `fleetCap(0)`
   is the call that keeps that true. Passing 0 makes the intent explicit instead
   of leaving the correct behaviour resting on a coincidence.
   ⚠ IF YOU EVER CHANGE THIS TO fleetCap(garage.tier), DELETE THE
     `depot.fleetCap + garage.slotBonus` LINE IN buildView() IN THE SAME EDIT,
     or a $99 rig starts granting two fleet slots.

   🔴 NO `nodeId` ON THIS BLOCK ANY MORE, AND IT MUST NOT COME BACK. It used to
   ride along here, off the pinned view shape, with a comment saying it was
   "carried for quoteRequest(), which needs an origin for the reach test" — and
   that carrying was the bug. quoteRequest() forwarded this — the SHIPPER's yard
   — as the request's top-level `depot:`, which resolveInput() ranks ABOVE the
   carrier's own yard, so a rival's reach was measured against the shipper's
   radius (the full account is on `carrier.depot` in quoteRequest, ~931). The
   parameter was deleted there, which left this key with no reader anywhere:
   depot.render.js reads `v.depot` and never its nodeId. It is deleted rather
   than left in place for the same reason the parameter was — an unused value
   still in scope is what a future edit re-wires "helpfully", and re-wiring THIS
   one re-opens a quote the server refuses as `out_of_reach`. Anything that
   genuinely needs the player's own yard origin should call depotReady() and
   read `nodeId` off it, which is where this was copied from. */
function depotBlock(b, ready) {
  if (!ready) {
    return {
      ok: false, level: 0, bays: 0, fleetCap: 0, radius: 0,
      why: 'Freight is not wired up on this build — the transport bridge is missing.',
      fix: 'Reload the game. If it persists, index.html is missing its MythicTransportBridge block.',
    };
  }
  const d = call(depotReady, null);
  if (d && typeof d === 'object' && typeof d.ok === 'boolean') {
    return {
      ok: !!d.ok,
      why: d.why ? String(d.why) : '',
      fix: d.fix ? String(d.fix) : '',
      level: num(d.level),
      bays: ('bays' in d) ? num(d.bays) : num(call(bays, 0)),
      fleetCap: ('fleetCap' in d) ? num(d.fleetCap) : num(call(fleetCap, 0, 0)),
      radius: num(d.radius),
    };
  }
  return {
    ok: false, level: 0, bays: num(call(bays, 0)), fleetCap: num(call(fleetCap, 0, 0)), radius: 0,
    why: 'No Freight Depot in reach.',
    fix: 'Build a Freight Depot in one of your cities — without one the charter is paperwork.',
  };
}

function rigDefFor(row, veh) {
  /* rigs.data.js is the authority for runs/day. Resolve by rig id first; fall
     back to the first catalog entry of the same rarity, because a row written
     before the rig id was recorded would otherwise render 0 runs — which looks
     exactly like a rig that has used all of them, and "my truck vanished" is a
     worse bug report than a slightly wrong name. */
  const id = (veh && (veh.rigId || veh.id)) || row.rig_id || row.rigId;
  const byId = id ? call(rigById, null, id) : null;
  if (byId) return byId;
  const rar = row.rarity || (veh && veh.rarity);
  return (Array.isArray(PP_RIGS) ? PP_RIGS.find((r) => r && r.rarity === rar) : null) || null;
}

function fleetBlock(b, garage) {
  const rar = call(b.rarities, []);
  const lot = call(b.lot, []);
  const metaOf = (id) => rar.find((r) => r && r.id === id) || null;
  const vehOf = (vid) => lot.find((v) => v && (v.vehicleId === vid || v.id === vid)) || null;

  return S.rigs.map((row) => {
    /* Rigs are addressed by VEHICLE id in the VIEW — it is what setRigField()
       takes, what the lot lookup needs, and what the renderer stamps into
       data-mt-id. It is NOT what the server means by a rig id; onClick() maps
       it back through rigRowId() before any RPC sees it. See the header. */
    const vid = row.vehicle_id || row.vehicleId || '';
    const veh = vehOf(vid);
    const def = rigDefFor(row, veh);
    const rarity = row.rarity || (def && def.rarity) || (veh && veh.rarity) || 'common';
    const meta = metaOf(rarity);
    const condition = row.condition || (veh && veh.condition) || '';

    /* Effective runs = floor(rarityRuns × condition multiplier), minimum 1,
       PLUS the Garage perk — and all of that is computed by rigs.data.js against
       the bridge's condition table, never here.

       🔴 THE GARAGE PERK IS ADDED EXACTLY ONCE, AND IT USED TO BE ADDED TWICE.
       `effectiveRuns()` ends `return worn + runsPerDayBonus(garageTier)`
       (rigs.data.js:408), so passing the tier IS the perk. An earlier revision
       passed the tier AND added `garage.runBonus` on top, which showed a tier-3
       owner double the bonus they paid for and then had the exchange refuse
       every run past the real cap. One authority, one addition, one number. */
    const ladder = num(call(effectiveRuns, 0, (def && def.id) || null, condition, garage.tier));

    /* 🔴 WHAT IS SHOWN IS WHAT THE SERVER WILL HONOUR, not what the rig is
       worth. `transport_dispatch` claims a run under
       `runs_used < least(runs_cap, max_runs_per_rig)` (sql/038 ~2068), so the
       stored column binds — and it is a SNAPSHOT that `transport_repair` does
       not update when it raises a rig's condition. Printing the ladder figure
       would promise runs the exchange refuses, which is the "shown one number,
       billed another" failure this repo has already paid for. A row with no
       usable cap (legacy, or a read that failed) falls back to the ladder
       rather than to 0 — a rig stuck at zero runs is indistinguishable from a
       bug to the player who just bought it. */
    const stored = Math.floor(num(row.runs_cap !== undefined ? row.runs_cap : row.runsCap));
    const runs = (Number.isFinite(stored) && stored > 0) ? Math.min(ladder, stored) : ladder;

    /* runsUsed is shown EXACTLY as the server sent it and is never zeroed here
       on a day-key mismatch. The client's todayKey() is index.html's unanchored
       local-clock one (~71039) — moving the OS clock mints a fresh day — and
       zeroing on it would show a carrier runs that transport_dispatch() will
       refuse. The DB clock owns the reset. */
    const used = num(row.runs_used || row.runsUsed);
    return {
      vehicleId: vid,
      name: (veh && veh.name) || (def && def.name) || 'Unnamed rig',
      rarity,
      rarityName: (meta && meta.name) || rarity,
      rarityColor: (meta && meta.color) || '#cfd6e4',
      condition,
      runs,
      runsUsed: used,
      runsLeft: Math.max(0, runs - used),
      assignedTo: row.assigned_to || row.assignedTo || null,
      status: row.status || 'idle',
    };
  });
}

/* 🏷 THE UNREGISTERED HALF OF THE YARD — haul-class vehicles sitting on the
   Prince Portfolios lot that are not yet fleet rigs.

   depot.render.js:601 labels its `lotBlock` a DEAD HOOK and names this as the
   missing half: without it the panel handles a `register` action it never draws
   a button for. Supplying the list here is the whole fix; the renderer needs no
   change. The shape is the one it asks for verbatim —
   {vehicleId, name, rarityName, rarityColor, condition}.

   Only `haul` vehicles are offered. The lot also holds cars, and a "register"
   button under a hatchback is a click that can only end in a refusal. */
function lotBlock(b) {
  const rar = call(b.rarities, []);
  const metaOf = (id) => rar.find((r) => r && r.id === id) || null;
  const registered = new Set(S.rigs.map((r) => String((r && (r.vehicle_id || r.vehicleId)) || '')));
  return call(b.lot, [])
    .filter((v) => v && v.haul && !registered.has(String(v.vehicleId || v.id || '')))
    .map((v) => {
      const def = call(rigById, null, v.rigId);
      const rarity = v.rarity || (def && def.rarity) || 'common';
      const meta = metaOf(rarity);
      return {
        vehicleId: String(v.vehicleId || v.id || ''),
        name: v.name || (def && def.name) || 'Unnamed rig',
        rarity,
        rarityName: (meta && meta.name) || rarity,
        rarityColor: (meta && meta.color) || '#cfd6e4',
        condition: v.condition || '',
      };
    });
}

/* 🚚 MERIDIAN HAULAGE — the NPC carrier. RATIFIED AND NOT A BALANCE KNOB: it is
   a PRICE CEILING, never a bypass. A sole player carrier can charge just under
   Meridian's rate and get rich; what they cannot do is set an infinite price or
   refuse to serve someone they are at war with and end that player's game
   through no action of their own.

   It is appended even when listCarriers() came back missing, offline or empty —
   which is the entire point. If the rate board fails to load and the NPC
   disappeared with it, a player holding freight has no carrier at all, which is
   exactly the lockout the NPC exists to prevent.

   Its tariff IS the cap, by construction, and both come from routes.js's
   tariffCap() so there is one number and not two. A second copy is how you get
   a rate board where the NPC undercuts the ceiling it defines. */
function carrierBlock() {
  const list = S.carriers.map((c) => ({
    id: c.id,
    name: c.name || 'Unnamed carrier',
    tariff: tariffOf(c),        // JSONB → number; see tariffOf()
    /* 🔴 THE SAME "unknown is not zero" CALL AS freeBays BELOW, and these two
       columns were shipped without it — the rate board therefore advertised
       every newly founded player carrier as "0%" reliable and "0 pairs" served,
       beside the NPC row printing 100% and "every pair". That is the strongest
       possible argument for taking the Meridian quote at 2.5×, made about a
       carrier the server has said nothing about.
       It is `num` that defeats the renderer's three-way discipline, one file
       upstream: depot.render.js's N() and pctText() both answer '—' for null,
       but `num` is `Number(v)` with a finite test, and `Number(null)` is 0 —
       not NaN — so a null reliability arrived there as a real zero and never
       reached the '—' arm. The null has to be preserved HERE.
       • `reliability` is NULL on every carrier until a haul settles: sql/038's
         insert policy pins it null on purpose (a founder who could pick their
         own opening reliability would start at 100% and never earn it) and
         transport_settle is its only writer.
       • `coverage` HAS NO COLUMN in transport_companies at all — listCarriers()
         selects id, owner_id, name, home_node_id, depot_level, tariff,
         reliability, status, created_at — so `c.coverage` is undefined and null
         is the only honest value until such a column exists. `coverageCount` is
         accepted alongside it so the day one is published under either name
         this line already carries it. */
    reliability: (c.reliability === null || c.reliability === undefined) ? null : num(c.reliability),
    coverage: (c.coverage === undefined && c.coverageCount === undefined)
      ? null : num(c.coverage !== undefined ? c.coverage : c.coverageCount),
    /* Unknown is NOT zero. `0 free bays` reads as "full" and would quietly
       route the shipper to Meridian at 2.5× over a column the rate board simply
       did not send. null renders as '—'; the real check is server-side anyway. */
    freeBays: (c.free_bays === undefined && c.freeBays === undefined)
      ? null : num(c.free_bays !== undefined ? c.free_bays : c.freeBays),
    meridian: false,
  }));
  const cap = num(call(tariffCap, 0, list.map((c) => c.tariff).filter((n) => n > 0)));
  const M = MERIDIAN || {};
  list.push({
    id: M.id || 'meridian',
    name: M.name || 'Meridian Haulage',
    tariff: cap > 0 ? cap : null,   // null renders as '—' rather than as "free"
    reliability: num(M.reliability, 100),
    coverage: num(M.coverage, 0),
    freeBays: null,                 // always available; bays are a player limit
    meridian: true,
  });
  return list;
}

function buildView() {
  const b = B();
  const ready = !b._null;
  const garage = garageInfo(b);

  const depot = depotBlock(b, ready);
  // The building's contribution comes from depot.js; the paid Garage slot is
  // added here, ONCE. depotBlock() calls fleetCap(0) so this is the only place
  // the perk lands — see the warning there before changing either line.
  depot.fleetCap = depot.fleetCap + garage.slotBonus;

  // Pricing goes through _opEcon() and nowhere else (CLAUDE.md). A null answer
  // renders as an unknown startup cost, never as a guessed one — a hardcoded
  // fallback here would be a second price the shop could advertise.
  const econ = call(b.opEcon, null, 'transport');
  const charter = {
    owned: !!call(b.ownsCharter, false),
    workers: num(call(b.charterWorkers, 0)),
    label: String(call(b.opLabel, 'transport', 'transport')),
    startup: econ && Number.isFinite(Number(econ.startup)) ? Number(econ.startup) : null,
  };

  return {
    ready,
    offline: S.offline,
    missing: S.missing,
    error: S.error,
    tab: S.tab,
    charter,
    depot,
    /* The PINNED FIVE and only those. garageInfo() also carries the rig's
       load / speed / risk, which routes.js prices a haul off — they belong to
       quoteRequest(), not to the renderer, and a view key nothing draws is a
       key someone later mistakes for a contract. */
    garage: { owned: garage.owned, name: garage.name, tier: garage.tier, slotBonus: garage.slotBonus, runBonus: garage.runBonus },
    fleet: fleetBlock(b, garage),
    lot: lotBlock(b),
    carriers: carrierBlock(),
    contracts: S.contracts.map((c) => ({
      id: c.id,
      fromName: c.from_name || c.fromName || c.from_node || '—',
      toName: c.to_name || c.toName || c.to_node || '—',
      cargoText: cargoText(b, c.cargo),
      price: num(c.price),
      etaText: etaText(c.arrive_at || c.arriveAt),
      progress: progressOf(c),
      status: c.status || 'in_transit',
      risk: num(c.risk_pct !== undefined ? c.risk_pct : c.risk),
    })),
    quote: S.quote,
    // The echo depot.render.js asks for, so the five exchange inputs survive a
    // repaint. Copied, not handed over — the renderer is pure and must not be
    // able to write module state by mutating what it was given.
    form: { from: S.form.from, to: S.form.to, resId: S.form.resId, units: S.form.units, carrierId: S.form.carrierId },
    cinder: num(call(b.gems, 0)),
  };
}

/* ── data ───────────────────────────────────────────────────────────────────
   Every leg is wrapped independently so one missing table does not blank the
   other three panels: the rate board still draws when your own company row
   failed to load, and vice versa. */
async function refresh() {
  const b = B();
  if (b._null) { S.loading = false; return false; }
  const token = ++_refreshToken;
  S.loading = true; S.missing = false; S.offline = false; S.error = '';
  paint();

  const [co, rigs, cars, cons] = await Promise.all([
    acall(myCompany, { ok: false }),
    acall(listMyRigs, { ok: false }),
    acall(listCarriers, { ok: false }),
    acall(listContracts, { ok: false }),
  ]);

  /* A slow first refresh landing after a fast second one would resurrect rows
     the player has already seen replaced — the classic double-click-refresh
     bug. Only the newest request is allowed to commit. */
  if (token !== _refreshToken) return false;

  [co, rigs, cars, cons].forEach(classify);
  S.company = okOf(co) ? (co.row || co.company || (co.ok ? co.data : null) || null) : null;
  S.rigs = okOf(rigs) ? rowsOf(rigs) : [];
  S.carriers = okOf(cars) ? rowsOf(cars) : [];
  S.contracts = okOf(cons) ? rowsOf(cons) : [];
  S.loading = false;

  /* ── the starter rig's reopen path ────────────────────────────────────────
     TWO triggers, and the second one is the one that survives closing the game.
       1. `_starterPending` — an attempt refused earlier IN THIS SESSION (the
          fleet was unreadable, or the lot was full) retries now that the fleet
          IS readable.
       2. a charter + an EMPTY fleet — the durable trigger.

     🔴 WHY (2) HAD TO BE ADDED. `_starterPending` is a module-level `let`
     (see ~114) with no persistence anywhere, so it dies with the page. Until
     this line, (1) was the ONLY reopen trigger, which meant: found the charter
     with a full Prince Portfolios lot → get the 'full' refusal → close the game
     → free a slot → reopen the Freight Depot → `_starterPending` is false on
     the fresh module load → nothing seeds → rigless forever. index.html's
     founding toast (~80352) promises precisely that flow ("free a slot and
     reopen the Freight Depot to claim it"), so the promise was still false
     across a restart even after grantStarterRig() made it true in-session.
     🔴 REJECTED: persisting `_starterPending` (localStorage or a Profile flag
     on THIS side). A retry flag owned by the module would be a second opinion
     about a gift the module does not issue, and it would go stale exactly the
     way `p.owned` did. The record of the gift belongs where the mint happens.

     🔥 AND THIS TRIGGER IS NOT ITSELF A BOUND — READ THIS BEFORE LOOSENING IT.
     "Empty fleet + charter" is a fine reason to ASK, and it is a terrible thing
     to hang idempotency on. An empty fleet is an ORDINARY, LONG-LIVED state
     here: `transport_companies` is not created at founding, it is created by
     the explicit "register your carrier on the exchange" action (~1177), so
     between founding and that click registerRig() answers `no_company`
     (contracts.js ~1151) while listMyRigs() answers ok with zero rows. This
     line therefore fires on EVERY depot open in that window. The first version
     of this fix leaned on the minter's "the lot already holds a haul-class
     truck" test to bound it, and that test only holds while the truck is still
     PARKED — so the real loop was: open depot → free rig minted at ~43k → the
     RPC refuses to record it → scrap the rig for ~4,300 🔥 (index.html's
     ppScrapVehicle pays 10% of `price` through addGems, and nothing on that
     path guards `v.haul`) → reopen → a NEW rig. Four opens, four mints.
     What makes the ask safe is index.html's `p.starterRigIssued`: a durable
     record of the MINT, written when the row is parked, answering 'spent'
     forever after. `grantStarterRig()` is therefore safe to call as often as
     this line likes, which is the only reason this line is allowed to be this
     eager. If that flag is ever removed, this trigger must become a
     once-per-session ask IN THE SAME EDIT.
     ⚠ Note what is NOT relied on any more, and how close that already got.
     An earlier draft rested this on "transport_rigs is append-only from this
     client, so an empty fleet means never issued" — true of contracts.js today
     (insert ~1155, update ~889, no delete) and ALREADY overtaken on the server:
     sql/038 ships `transport_retire_rig` (~2647), which no client path calls
     yet. It sets `status = 'retired'` rather than deleting, so the row survives
     and listMyRigs() still counts it — but a future listMyRigs() that filtered
     retired rigs out would make the fleet read empty for a carrier that plainly
     had one. That would have re-opened the gift; it does not now, because the
     fleet was never the bound.
     Costs a `.length` on every other refresh and nothing else: seedStarter()
     does not call refresh(), so this cannot loop. */
  const wantStarter = _starterPending || (!S.rigs.length && !!call(b.ownsCharter, false));
  if (wantStarter && okOf(rigs)) {
    /* 🔴 seedStarter()'s RETURN IS A REFUSAL SENTENCE, NOT A FLAG, and reading
       only `r.seeded` here silently discarded it. That was the regression this
       arm was added to fix arriving in a new shape: index.html's founding toast
       promises "free a slot and reopen the Freight Depot to claim it", the
       reopen ran the seed, the seed refused with 'full' — and the panel printed
       nothing, so the player was sent round the loop index.html's own comment
       says the dedicated 'spent' sentence exists to prevent. Said ONCE per
       session (`_starterToldWhy`) because this block runs on every refresh. */
    const r = await seedStarter(S.rigs);
    if (r && r.seeded) {
      _starterToldWhy = false;
      const again = await acall(listMyRigs, { ok: false });
      if (token === _refreshToken && okOf(again)) S.rigs = rowsOf(again);
    } else if (r && r.ok === false && r.why && !_starterToldWhy) {
      _starterToldWhy = true;
      try { b.toast('🚛 ' + reasonOf(r), 6200); } catch (e) {}
    }
  }
  paint();
  return true;
}

/* ── the free starter rig ───────────────────────────────────────────────────
   🔴 IDEMPOTENT, AND NOT THEORETICALLY. index.html's `_opAfterFound` is
   reachable from THREE call sites (79968, 82273, 82388) and the analogous cars
   unlock guards itself with `if (!_pp.owned)` (~80217). Founding twice must not
   mint two free rigs. Two guards, because they fail differently:
     1. `_starterSeeded` — in-session, set BEFORE the first await, so two calls
        in the same tick cannot both read an empty fleet and both seed.
     2. the fleet itself — durable, survives a reload, works across devices.

   🔴 AND WHEN THE FLEET CANNOT BE READ, WE DO NOT SEED. Refusing costs the
   player one more click once they are online; seeding blind mints a duplicate
   free rig the moment the tables come back, and a duplicate asset is a support
   conversation, not a bug fix. `_starterPending` makes refresh() retry it in
   this session — and because that flag is only a `let`, refresh() ALSO calls
   here on any read where the fleet comes back empty and the player holds a
   charter, which is the trigger that survives closing the game. See the block
   at the end of refresh(). */
async function seedStarter(knownRows) {
  const b = B();
  if (b._null) return { ok: false, why: 'Freight is not wired up on this build.' };
  if (_starterSeeded) return { ok: true, seeded: false, why: 'Starter rig already issued.' };
  _starterSeeded = true;

  let rows = Array.isArray(knownRows) ? knownRows : null;
  if (!rows) {
    const r = await acall(listMyRigs, { ok: false });
    if (!okOf(r)) {
      _starterSeeded = false; _starterPending = true;
      return { ok: false, why: reasonOf(r), fix: 'Open the Freight Depot once you are online — the starter rig is issued then.' };
    }
    rows = rowsOf(r);
  }
  if (rows.length) { _starterPending = false; return { ok: true, seeded: false, why: 'Fleet already holds ' + rows.length + ' rig(s).' }; }

  /* The vehicle itself is minted by INDEX.HTML, which owns the Prince
     Portfolios lot. This module still has no lot writer — the bridge exposes
     lot(), lotCap(), setRigField() and, since the retry fix below,
     grantStarterRig(): a NAMED, charter-gated, idempotent request for the one
     specific gift, not a general "create a vehicle" verb. The distinction is
     the whole safety property. A generic writer would be a rig minter reachable
     from a feature module; grantStarterRig() cannot mint a second rig (a
     parked haul truck answers 'already', and index.html's durable
     `p.starterRigIssued` answers 'spent' for every call after the one that
     actually parked one — the second of those is the load-bearing half, because
     the first evaporates the moment the player scraps the truck), cannot
     choose WHICH rig (index.html picks the lowest Common deterministically,
     never rollRig(), so a founding gift cannot jackpot a 3.4M Mythic), and
     cannot run for someone with no charter (the bridge checks
     _transportOwnsCharter() first).
     What happens here is still the recording half: find the haul-class truck
     and register it to the fleet. */
  const haulOnLot = () => call(b.lot, []).find((v) => v && v.haul) || null;
  let veh = haulOnLot();
  let grant = '';
  if (!veh) {
    /* 🔴 ASK INDEX.HTML TO MINT IT — AND UNTIL THIS LINE EXISTED, BOTH SIDES
       PROMISED A RETRY THAT NO CODE PERFORMED. `_transportGrantStarterRig()`
       had exactly ONE call site, inside `if (opId === 'transport')` in
       _opAfterFound, so it ran at FOUNDING and never again. Meanwhile
       index.html's founding toast said "free a slot and reopen the Freight
       Depot to claim it" and the refusal below said "reopen the Freight Depot
       once it lands" — and nothing on any reopen path could make it land. A
       player whose lot was full at charter time was permanently rigless and
       `_starterPending` retried forever against a lot that would never gain a
       truck. The fix is the bridge, not a lot writer here: index.html is still
       the ONLY minter (`grantStarterRig` wraps its existing helper and refuses
       anyone without a charter) and this module still cannot conjure a vehicle.

       🔥 AND THE FIRST VERSION OF THIS LINE SHIPPED A CINDER FAUCET, which is
       worth more than the fix it replaced. It leaned on the minter's "the lot
       already holds a haul-class truck" test for idempotency — but this call
       runs on EVERY depot open with an empty fleet, and an empty fleet is an
       ordinary state for as long as the player has not registered on the
       exchange (see refresh()). So: open depot → rig minted → registerRig
       refuses `no_company` → scrap it for ~4,300 🔥 → reopen → mint again, with
       no lap limit. index.html now records the mint durably
       (`p.starterRigIssued`) and answers 'spent' afterwards, which is what
       makes calling from here safe at this frequency. */
    grant = String(call(b.grantStarterRig, 'nobridge'));
    if (grant === 'ok' || grant === 'already') veh = haulOnLot();
  }
  if (!veh) {
    /* 'spent' IS TERMINAL FOR THE MINT AND MUST NOT ARM `_starterPending` —
       that flag exists to retry something that could still succeed, and this is
       the one code here that no amount of reopening can change, because what is
       refusing is a durable record rather than a transient lot state. Telling
       the player "it will try again" would be the same false promise the retry
       wiring was added to stop.
       ⚠ `_starterSeeded` IS RELEASED THOUGH, which looks contradictory and is
       not. It gates the whole function, including its RECORDING half, and that
       half still has work to do: a player who buys a haul rig on the Prince
       Portfolios floor should have it registered to the fleet free on the next
       refresh, in this session, without a reload. Releasing it is safe now in a
       way it would not have been before this round — re-entry can no longer
       mint anything, because index.html's `p.starterRigIssued` is what answers,
       and it answers 'spent' however many times it is asked. The cost is one
       cheap synchronous bridge call per refresh, and only while the fleet is
       empty. */
    if (grant === 'spent') {
      _starterSeeded = false;
      _starterPending = false;
      return {
        ok: false,
        why: 'Your charter’s free starter rig was already issued, and it is no longer on your Prince Portfolios lot.',
        fix: 'The charter does not issue a second. Buy a haul-class rig on the Prince Portfolios floor and reopen the Freight Depot — it is registered to your fleet at no charge.',
      };
    }
    _starterSeeded = false; _starterPending = true;
    /* THE CODE THE MINTER RETURNED IS THE REASON, not a second guess at it.
       _transportGrantStarterRig answers 'ok' | 'already' | 'spent' | 'full' |
       'nocatalog' | 'nomodule' | 'error', and the bridge adds 'nocharter' —
       it returns a code and not a boolean precisely so the sentence can name
       what happened, and re-deriving "is the lot full?" from lot()/lotCap()
       here would be a second opinion that can disagree with the code that
       actually tried to park it. 'full' is the only one the player can act on,
       so it is the only one with its own sentence. */
    if (grant === 'full') {
      return {
        ok: false,
        why: 'Your Prince Portfolios lot is full, so the starter rig has nowhere to park.',
        fix: 'Sell, scrap or strip a vehicle to free a slot, then reopen the Freight Depot — the rig is issued then.',
      };
    }
    /* 'nocharter' IS NOT A RETRY, AND IT REACHED THE PLAYER AS ONE. The mint's
       gate is `_transportOps().length` (index.html's grantStarterRig key), so
       this code means "no Transportation Company was ever founded". Before this
       arm existed it fell to the generic sentence below and read "No haul-class
       rig in your lot to register yet (nocharter). Reopen the Freight Depot and
       it will try to issue the rig onto your lot again." — a promise reopening
       can never keep, which is the same class of sentence the retry wiring was
       added to delete. It is admin-only in practice: refresh()'s trigger needs
       ownsCharter(), which answers true for admins (see the gate note at
       index.html's grantStarterRig), while the mint deliberately does not. The
       flags above are left as they are on purpose — founding in this session
       calls seedStarter() again through onCharterFounded(), and _starterPending
       simply lets a refresh get there first. */
    if (grant === 'nocharter') {
      return {
        ok: false,
        why: 'You have not founded a Transportation Company, so there is no charter for a starter rig to come with.',
        fix: 'Found the Transportation Company in Just Business — the rig is issued with the charter.',
      };
    }
    /* 'nobridge' is call()'s neutral for a bridge with no grantStarterRig at
       all, which in the wild means a service worker serving THIS module beside
       an older index.html. Reopening cannot fix that; a hard reload can, and
       saying "reopen" at it would loop the player forever. */
    if (grant === 'nobridge' || grant === 'nomodule') {
      return {
        ok: false,
        why: 'This build cannot issue the starter rig — the depot screen and the game are out of step.',
        fix: 'Hard-reload the game to fetch the current bundle, then open the Freight Depot again. Your charter is safe.',
      };
    }
    return {
      ok: false,
      why: 'No haul-class rig in your lot to register yet' + (grant ? ' (' + grant + ')' : '') + '.',
      fix: 'Reopen the Freight Depot and it will try to issue the rig onto your lot again.',
    };
  }
  const vid = veh.vehicleId || veh.id;
  /* 🔴 rarity, condition AND runsCap ARE SENT. Omitting them is not a cosmetic
     gap: contracts.js ~1111 refuses to derive runs_cap and hands that job here,
     and sql/038 ~603 defaults the column to 3. The starter rig is a Common
     ('Clean', ladder 3) so this one happens to agree with the default today —
     which is exactly why it would have gone unnoticed until the first player
     registered something better. Both call sites now go through the same
     helper so they cannot drift apart again. */
  const f = registrationFields(b, vid, garageInfo(b));
  const reg = await acall(registerRig, { ok: false }, vid, {
    free: true, starter: true,
    rarity: f && f.rarity, condition: f && f.condition, runsCap: f && f.runsCap,
  });
  if (!okOf(reg)) {
    _starterSeeded = false; _starterPending = true;
    return { ok: false, why: reasonOf(reg) };
  }
  _starterPending = false;
  try { b.toast('🚛 ' + ((veh.name || 'Your first rig') + ' registered to the fleet.'), 4200); } catch (e) {}
  return { ok: true, seeded: true, vehicleId: vid };
}

/* ── chrome ─────────────────────────────────────────────────────────────────
   Inject the stylesheet once, lazily — a module that appends a <style> on
   import costs every page load something for a panel most sessions never open.
   Guarded by the element id rather than by a flag so a hot reload or a second
   copy of the module cannot stack two <style> blocks. */
function ensureCss() {
  try {
    if (typeof document === 'undefined') return false;
    if (document.getElementById(CSS_ID)) return true;
    const el = document.createElement('style');
    el.id = CSS_ID;
    el.textContent = (typeof TRANSPORT_CSS === 'string') ? TRANSPORT_CSS : '';
    document.head.appendChild(el);
    return true;
  } catch (e) { return false; }
}

/* A renderer that throws must never leave a full-screen black overlay with no
   way out — the player's only escape would be reloading the game, and they
   would report it as "the game froze". Inline styles on purpose: if the render
   module failed, its stylesheet is the last thing to trust. */
function fallbackHtml(why) {
  return '<div style="margin:auto;max-width:520px;padding:22px;border:1px solid #a4763a;border-radius:12px;'
    + 'background:#120d1c;color:#e8dcc0;font-family:Georgia,serif">'
    + '<h2 style="margin:0 0 8px;color:#f6dc95">🚛 Freight Depot</h2>'
    + '<p style="margin:0 0 10px">The depot screen could not be drawn. Nothing was charged and no contract was changed.</p>'
    + '<p style="margin:0 0 14px;opacity:.75;font-size:.85rem">' + esc(why) + '</p>'
    + '<button data-mt="close" style="padding:7px 14px;border-radius:8px;border:1px solid #a4763a;'
    + 'background:transparent;color:#e2c37a;cursor:pointer">Close</button></div>';
}

export function paint() {
  try {
    const ov = document.getElementById(OV);
    if (!ov) return false;
    let html;
    try { html = renderTransport(buildView()); }
    catch (e) { _lastThrow = String((e && e.message) || e); html = fallbackHtml(_lastThrow); }
    if (typeof html !== 'string' || !html) html = fallbackHtml('the renderer returned nothing');
    ov.innerHTML = html;
    return true;
  } catch (e) { return false; }
}

/* ── events ─────────────────────────────────────────────────────────────────
   ONE delegated listener on the overlay root. paint() replaces innerHTML, so a
   listener attached to a button would be thrown away by the first repaint and
   the panel would go dead after one refresh — this is the community.render.js
   pattern and it exists for that exact failure. */
function fieldVal(elId) {
  try { const el = document.getElementById(elId); return (el && el.value != null) ? String(el.value) : ''; }
  catch (e) { return ''; }
}
function attr(el, name, fallback) {
  try { const v = el.getAttribute(name); return (v === null || v === '') ? fallback : v; } catch (e) { return fallback; }
}

/* The exchange's current selection, read in priority order: the clicked element
   (the renderer stamps a rate-board row's endpoints on its own buttons), then
   the live form fields, then S.form.

   THE THIRD FALLBACK IS THE FIX FOR A REAL DEFECT, and depot.render.js:645
   describes it from the other side. paint() destroys the inputs, so after any
   action the fields read '' — and without the last fallback a second "Get a
   quote" on a visibly-filled form was refused for being empty. Remembering the
   selection here and echoing it back on the view closes it at both ends. */
function selection(el) {
  const f = S.form;
  const pick = (a, b, c) => (a || b || c || '');
  const units = num(fieldVal('mt-cargo-n'));
  return {
    carrierId: pick(attr(el, 'data-mt-id', ''), fieldVal('mt-carrier'), f.carrierId),
    from: pick(attr(el, 'data-mt-from', ''), fieldVal('mt-from'), f.from),
    to: pick(attr(el, 'data-mt-to', ''), fieldVal('mt-to'), f.to),
    resId: pick(fieldVal('mt-cargo-id'), f.resId, ''),
    units: units > 0 ? units : num(f.units),
  };
}

/* ── the quote request ──────────────────────────────────────────────────────
   routes.js's quote() needs far more than the four form fields: without
   `nodes` it cannot measure hops (and answers 'no-route' for every haul on the
   map), without a `carrier` object it has no tariff or depot to quote from
   (and answers 'no-carrier'), and without `carriers` its median — and therefore
   the exchange ceiling — collapses to the floor tariff. An earlier revision
   sent only {carrierId, from, to, cargo} and so could never return a price at
   all. Everything routes.js can be handed, it is handed; nothing is invented.

   THE RIG MULTIPLIERS ARE THE HAND-HAULED BASELINE FOR ANOTHER PLAYER'S
   CARRIER, deliberately. Their fleet is not readable from this client
   (transport_rigs' RLS narrows the select to fleets you own), so the load,
   speed and risk of the truck that will actually haul it are unknown here. The
   baseline under-promises — a better rig only ever makes the real haul faster
   and safer — and sql/038's transport_dispatch re-derives all three from the
   rig it actually claims. Guessing upward would print an ETA the exchange then
   misses, which is the one direction that reads as the game lying. */
/* ⚠ NO `depot` PARAMETER, AND THAT IS THE FIX, NOT AN OMISSION. This function
   used to take the SHIPPER's depotBlock() and forward it as the request's
   top-level `depot:`, which resolveInput() ranks ABOVE the carrier's own yard —
   see the two blocks inside. Deleting the parameter rather than ignoring it is
   deliberate: an unused argument still in scope is the thing a future edit
   re-wires "helpfully", and this one measured a rival's reach against the
   shipper's radius. There is now nothing in here to re-wire. */
function quoteRequest(b, sel, garage, npc) {
  const rows = Array.isArray(S.carriers) ? S.carriers : [];
  const row = npc ? null : (rows.find((c) => c && String(c.id) === String(sel.carrierId)) || null);
  const mine = !!(S.company && row && String(S.company.id) === String(row.id));

  const carrier = row ? {
    id: row.id,
    name: row.name || 'Unnamed carrier',
    tariff: tariffOf(row),
    /* The carrier's OWN yard decides reach, not the shipper's. `home_node_id`
       plus `depot_level` is everything listCarriers() publishes about it, and
       depotEffect() turns the level into the same bays/radius the owner sees —
       one table, read twice, rather than a second reach rule on the board.

       🔴 AND THIS BLOCK WAS DEAD FOR A YEAR OF READING BECAUSE OF THE LINE
       BELOW. `resolveInput()` resolves the depot as
       `i.depot || (carrier && (carrier.depot || carrier))` (routes.js:956) —
       a top-level `depot:` on the request OUTRANKS this one. This function used
       to send BOTH: this carrier block AND `depot: depotBlock(...)`, which is
       the SHIPPER's yard — both former callers passed `depotBlock(b, !b._null)`,
       and today only buildView() still builds one, for the Depot TAB.
       So on every path where the shipper owned a Freight Depot, quote()'s two
       reach tests (routes.js:1217) measured the RIVAL's haul against the
       SHIPPER's radius, and this comment described code that never ran.
       Measured: a rival with a reach-1 yard at N-A and a shipper with a reach-6
       yard at N-A quoted N-A→N-C (5 hops) at {ok:true, price:500}; the server
       then refused it `out_of_reach`, because transport_quote reads
       `v_reach := (transport_caps(v_co.id)->>'reach')::int` off the CARRIER's
       company row (sql/038 ~1785, inside transport_quote). And in the opposite
       direction a shipper with a small yard was refused a haul a large carrier
       could legally take. routes.js's
       precedence is not wrong — a caller holding a FRESHER copy of the SAME
       yard should win — it was being handed a different party's yard.

       ⚠ AND `home_node_id` IS WRITE-ONCE, which is what makes an empty one here
       permanent rather than merely wrong. transport_companies revokes UPDATE
       and DELETE from anon and authenticated, and transport_set_sheet takes
       p_company_id / p_tariff / p_status / p_depot_level / p_blacklist and no
       home node — so nothing in this build can correct the column after the
       insert. resolveDepot() decides `present` from nodeId ALONE, so a carrier
       founded with an empty one answers 'no-depot' to every quote it will ever
       be asked for, forever, leaving its owner with Meridian at the 2.5×
       ceiling. The founding path therefore refuses to write a row with no
       origin (see the 'found' action) instead of relying on a fallback here. */
    depot: Object.assign(
      { nodeId: row.home_node_id || row.homeNodeId || '' },
      call(depotEffect, { bays: 0, radius: 0 }, num(row.depot_level !== undefined ? row.depot_level : row.depotLevel))),
  } : null;

  return {
    // Meridian takes NO carrier id. contracts.js sends `p_carrier_id: carrierId
    // || null` and the NPC is the null case in sql/038 — sending the sentinel
    // string 'meridian' into a uuid column is a 22P02 the player cannot read.
    carrierId: npc ? '' : (row ? row.id : sel.carrierId),
    carrierName: npc ? ((MERIDIAN && MERIDIAN.name) || 'Meridian Haulage') : (row ? row.name : ''),
    carrier,
    carriers: rows.map(tariffOf).filter((n) => n > 0),
    from: sel.from,
    to: sel.to,
    cargo: sel.resId ? { [sel.resId]: sel.units } : {},
    nodes: call(b.twNodes, []),
    // Only the player's own haul is priced on a rig this client can see.
    rigCargo: mine ? garage.load : 1,
    rigSpeed: mine ? garage.speed : 1,
    rigRisk: mine ? garage.risk : 0,
    /* 🔴 THE QUOTE'S DEPOT IS THE CARRIER'S, ALWAYS — see the block on
       `carrier.depot` above for what sending the shipper's yard here cost.
       Because `i.depot` outranks `carrier.depot` inside resolveInput(), the
       only safe values for this key are the carrier's own yard or nothing:
       anything else silently replaces the party whose reach is being measured.

       ⚠ AND IT IS THE CARRIER ROW'S YARD EVEN FOR A SELF-HAUL, which is NOT an
       oversight and is the one place this looks like a downgrade. depotBlock()
       reads the player's CITY buildings, which can stand at level 3 (reach 6);
       the server's reach is `3 + transport_companies.depot_level`, and
       depot.js:57-62 records that NOTHING IN THIS BUILD EVER WRITES
       depot_level (setTariff sends `p_depot_level: null` and
       transport_set_sheet coalesces it to the existing value), so every carrier
       alive is level 1 / reach 4 on the server no matter what their city shows.
       Quoting a self-haul off the city yard would therefore promise the player
       hauls their OWN dispatch is about to refuse — the "shown one number,
       refused by another" failure. The row is what the server rules on, so the
       row is what is quoted, for rivals and for yourself alike.
       ⚠ This is the SAME divergence the Depot tab already reports rather than
       hides: depotReady() sets `drift: 'level'` and states both numbers in its
       banner precisely because the panel's reach is bigger than the one
       dispatch honours. So a self-haul quoted at reach 4 beside a tile reading
       6 is not a new inconsistency — it is that documented one arriving where
       the player can act on it instead of several clicks later.

       Meridian (npc → carrier === null) legitimately has no depot: the NPC is a
       price CEILING that must always be able to carry, and meridianQuote() has
       no reach test at all. `null` here resolves to `{present:false}` and its
       path never asks. */
    depot: carrier ? carrier.depot : null,
  };
}

/* WHICH RIG HAULS IT. `transport_dispatch` refuses a null p_rig_id for a player
   carrier (sql/038 ~2040, `no_rig_chosen`) and claims the run under
   `r.id = p_rig_id and r.company_id = p_carrier_id` (~2064) — so it must be a
   RIG ROW uuid inside THAT carrier's fleet.

   SELF-HAUL is the case this client can serve: the player's own yard is
   readable, so the best idle rig is picked here by row id. Booking ANOTHER
   player's rig is not — their fleet is not selectable under RLS and the
   exchange has no rig picker to pick it with — so that dispatch is refused HERE
   with a sentence instead of being fired at the RPC to come back as
   `no_rig_chosen`, which reads as the exchange being broken rather than as a
   feature that does not exist yet.

   🔴 THE REAL FIX IS SERVER-SIDE AND IS NOT SMUGGLED IN HERE. Either
   transport_dispatch chooses the rig itself (it already takes the row lock that
   would make that choice safe) or a "free rigs" view is published for the
   board. Both are a migration. Meridian needs no rig at all, which is why the
   NPC path works today and is what the refusal points at — the same reason
   Meridian exists: no shipper is ever left with nowhere to send their freight.

   🔴 IT TAKES THE CARRIER THE QUOTE IS FOR, AND IT USED TO TAKE NOTHING.
   The previous version filtered on `S.company.id` — the player's OWN charter —
   with no reference to the carrier the quote was actually for, and NOTHING on
   the quote path restricts the selection to your own company: carrierBlock()
   lists every open carrier and the rate board's Quote button stamps that
   carrier's id. So a player who owns a fleet and quoted a RIVAL sent their own
   rig row as `p_rig_id` alongside the rival's `p_carrier_id`.
   transport_dispatch claims the run under `r.id = p_rig_id and r.company_id =
   p_carrier_id` (sql/038 ~2064) and diagnoses the miss as `rig_not_in_fleet`
   (~2078) — AFTER the confirm dialog. The guard in the dispatch branch only
   fires on an EMPTY rigId, which is precisely the case where the mismatch
   cannot arise, so it never covered this. Filtering by the quoted carrier makes
   the answer '' for anyone but yourself (their rigs are not selectable under
   trg_sel anyway), which is what lets that guard print the sentence its own
   comment promises, BEFORE the fare is agreed to instead of after.

   Ranked by runs remaining as the SERVER last reported them. The day key is
   NOT re-derived from the device clock to zero a used-up rig: index.html's
   getTodayKey() is unanchored local time, so it would hand the exchange a rig
   it is about to refuse. The pick is a hint; the WHERE clause is the ruling. */
function ownRigRowId(carrierId) {
  try {
    const mine = S.company && S.company.id;
    if (!mine) return '';
    /* Belt AND braces: the rig must sit in the fleet the RPC will check
       (`carrierId`) and that fleet must be the player's own (`mine`). Either
       test alone is one rename away from sending someone else's rig row. */
    if (!carrierId || String(carrierId) !== String(mine)) return '';
    const candidates = S.rigs
      .filter((r) => r && String(r.company_id) === String(carrierId)
        && (r.status === 'idle' || !r.status) && !r.assigned_to)
      .map((r) => ({ id: r.id, left: num(r.runs_cap) - num(r.runs_used) }))
      .sort((x, y) => y.left - x.left);
    return (candidates[0] && candidates[0].id) ? String(candidates[0].id) : '';
  } catch (e) { return ''; }
}

async function onClick(ev) {
  let el = null;
  try { el = (ev && ev.target && ev.target.closest) ? ev.target.closest('[data-mt]') : null; } catch (e) { el = null; }
  if (!el) return;
  const act = attr(el, 'data-mt', '');
  const id = attr(el, 'data-mt-id', '');

  /* close and tab are handled BEFORE the busy gate, deliberately. If an async
     action ever fails to settle, `busy` stays true — and a busy flag that also
     swallows the close button turns one hung request into an overlay the player
     cannot dismiss. Closing is never dangerous; it is the escape hatch. */
  if (act === 'close') { close(); return; }
  if (act === 'tab') {
    // Whitelisted: an unknown tab would render an empty panel with nothing
    // saying why, which is indistinguishable from a broken feature.
    const t = attr(el, 'data-mt-tab', 'depot');
    S.tab = (t === 'fleet' || t === 'exchange') ? t : 'depot';
    paint(); return;
  }
  if (busy) return;

  const b = B();
  busy = true;
  try {
    if (act === 'refresh') { await refresh(); return; }

    if (act === 'found') {
      /* The CHARTER is bought in Just Business through _opFound/_opEcon. This
         button only creates the carrier's row on the rate board, and it must
         never spend Cinder: charging here would bill the player twice for one
         charter, and the price would then live in two places. */
      if (!call(b.ownsCharter, false)) {
        b.toast('🚛 Found the Transportation Company in Just Business first — this only opens the yard.', 5200);
        return;
      }
      /* S.company is deliberately NOT in the view — the shape is a pinned
         contract with depot.render.js and a fourth ownership flag in it is a
         fourth thing that can disagree with the other three. It earns its keep
         here: refusing a second registration locally is a clearer answer than
         a unique-index violation echoed out of Postgres. */
      if (S.company) { b.toast('🚛 You already run a carrier on the exchange.'); return; }
      const name = fieldVal('mt-name').trim();
      if (!name) { b.toast('Your carrier needs a name shippers can find you by.'); return; }
      /* 🔴 THE CHARTER'S ORIGIN IS THE CAMP NODE, AND IT IS WRITE-ONCE.
         This used to send `{ name }` alone, leaving createCompany() to fall
         back to `campNodeId()` — `Profile.campNodeId`, which is null for every
         player who has never registered a camp on a Territory Wars node. A null
         `home_node_id` is now FATAL rather than harmless: quoteRequest() builds
         the quote's only depot from the carrier row and resolveDepot() decides
         `present` by nodeId alone, so a carrier founded with no origin answers
         'no-depot' to every quote — including its OWN OWNER's.
         🔴 AND THERE IS NO WAY BACK. transport_companies has no UPDATE policy
         (UPDATE/DELETE are revoked) and transport_set_sheet takes tariff,
         status, depot_level and blacklist and NO home node — the column is
         write-once at insert. So the wrong value here is permanent, and the
         player's only carrier is Meridian at the 2.5× ceiling forever. That is
         why this refuses to write the row rather than writing a hopeful one.

         ⚠ CORRECTION, RECORDED RATHER THAN QUIETLY SWEPT UP. The first version
         of this fix read the origin out of `depotReady().nodeId` and this
         comment claimed the yard's node was a DIFFERENT and better node than
         the camp's — "it is where the reach is granted from, while campNodeId
         is wherever the city stands". That is FALSE in this build, and the
         claim mattered because it justified a fallback chain and an error
         message. depot.js's toDepots() stamps `nodeId = originNodeId()` on
         EVERY depot row, and originNodeId() is literally `bridge().campNodeId()`
         — see depot.js's own header note "THERE IS ONE CITY, SO EVERY DEPOT
         SHARES ONE ORIGIN". Measured: with campNodeId 'N-CAMP' and a level-2
         depot placed, depotReady() answers `nodeId:'N-CAMP'`; with campNodeId
         null and the SAME depot placed it answers `{ok:false, code:'no-origin',
         nodeId:''}`. So there was only ever one value, read two ways.
         Two consequences, both applied here:
           1. The depot read is gone. `(yard && yard.nodeId) || campNodeId()`
              had a dead second operand whenever the yard resolved, and when the
              yard REFUSED for a reason unrelated to the origin (no city loaded,
              rows unreadable) it needlessly blocked a founding the camp node
              could have supplied. campNodeId() is the single source; that is
              also exactly what createCompany() falls back to, so the two sides
              cannot disagree.
           2. The refusal no longer borrows depot.js's sentence. It used to
              print `reasonOf(yard)`, which for a player with no depot reads
              "Build a Freight Depot in your city. It needs a Power Plant
              first." — a building's worth of Cinder that changes NOTHING here,
              after which the same click refuses again with 'no-origin'. The
              blocker is the camp, so the sentence names the camp. Founding a
              carrier does not require a yard at all; quoting from it does. */
      const home = String(call(b.campNodeId, '') || '').trim();
      if (!home) {
        b.toast('🚛 Your carrier needs a map position to quote from, and nothing in this build can set one after the charter is filed. Plant your camp on a node first, then register.', 6600);
        return;
      }
      if (!(await b.confirm('Register "' + name + '" on the freight exchange?'))) return;
      const r = await acall(createCompany, { ok: false }, { name, homeNodeId: home });
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 5200); return; }
      b.toast('🚛 ' + name + ' is on the exchange.');
      await refresh();
      return;
    }

    if (act === 'tariff') {
      const t = num(fieldVal('mt-tariff'));
      if (t <= 0) { b.toast('A tariff has to be a positive number of Cinder per unit·hop.'); return; }
      const r = await acall(setTariff, { ok: false }, t);
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 5200); return; }
      // Say what actually landed rather than what was asked for: the server
      // clamps to the Meridian ceiling, and a UI that echoes the request would
      // show a rate the exchange will not quote.
      b.toast('🚛 Tariff set to ' + fmtNum(num(r.tariff, t)) + ' 🔥 per unit·hop.');
      await refresh();
      return;
    }

    if (act === 'register') {
      if (!id) { b.toast('That rig has no vehicle id — reopen the depot.'); return; }
      /* 🔴 THE SAME THREE FIELDS AS THE STARTER RIG, THROUGH THE SAME HELPER.
         `registerRig(id, { free:false })` alone leaves rarity and condition at
         the table defaults and drops runs_cap to 3 — so a Mythic rig bought for
         ~3.4M Cinder on the auction floor would haul three times a day instead
         of ten and nothing would ever correct it, because no server path
         recomputes the column. contracts.js ~1111 names this hole and assigns the
         fix to the caller in as many words. This is that caller. */
      const f = registrationFields(b, id, garageInfo(b));
      if (!f) {
        b.toast('🚛 That vehicle is not on your Prince Portfolios lot any more — reopen the depot.', 5200);
        return;
      }
      const r = await acall(registerRig, { ok: false }, id, {
        free: false, rarity: f.rarity, condition: f.condition, runsCap: f.runsCap,
      });
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 5200); return; }
      /* The run budget is named in the toast because it is the number the
         player is being paid on, and a silent registration is how the old
         default-to-3 bug stayed invisible. A 0 would mean effectiveRuns() did
         not answer — say nothing rather than print a rating no rig can have. */
      b.toast('🚛 ' + f.name + ' registered'
        + (f.runsCap > 0 ? ' — ' + f.runsCap + ' run' + (f.runsCap === 1 ? '' : 's') + ' a day.' : '.'));
      await refresh();
      return;
    }

    if (act === 'quote' || act === 'meridian') {
      const sel = selection(el);
      const npc = (act === 'meridian');
      /* The NPC's board row carries `data-mt-id="meridian"`, which is a
         SENTINEL and not a carrier id — remembering it would make the next
         plain quote look up a carrier that is not on the board and refuse for
         the wrong reason. Everything else about the selection is worth keeping. */
      S.form = Object.assign({}, sel, { carrierId: npc ? '' : sel.carrierId });
      if (!sel.from || !sel.to) { b.toast('Pick where the cargo is and where it is going.'); return; }
      if (!sel.resId) { b.toast('Pick which resource is on the manifest.'); return; }
      if (!(sel.units > 0)) { b.toast('Say how much cargo you are shipping.'); return; }

      /* depotBlock() is NOT read here any more. The shipper's own yard has no
         say in whether a CARRIER can reach a route — see quoteRequest(). It is
         still built for the Depot tab in buildView(), which is where a player's
         own yard is genuinely the subject. */
      const req = quoteRequest(b, sel, garageInfo(b), npc);
      /* The client quote is DISPLAY ONLY. transport_dispatch() re-derives reach,
         price, free bays, the driver, the fuel and the run budget server-side
         and charges what IT computes. Anything else is a price the client can
         be argued into. */
      const q = npc ? call(meridianQuote, null, req) : call(quote, null, req);

      /* routes.js returns ONE SHAPE FOR EVERY OUTCOME — a refusal is that same
         object with ok:false and a printable reason. So a truthiness test is
         not a success test: the previous revision stored every refusal as a
         live quote, which left the Dispatch button reading a null price off a
         "no route" answer. `ok` is the only thing that means yes. */
      if (!q || typeof q !== 'object') {
        S.quote = null;
        b.toast('🚛 The route pricer did not answer. Nothing was charged.', 5200);
        return;
      }
      /* The request is carried ON the quote because contracts.js's dispatch()
         reads `q.from`, `q.to`, `q.cargo` and `q.rigId` straight off the object
         it is handed (contracts.js:946-952) and routes.js's shape() carries
         none of them. Without this the manifest arrives empty and the haul is
         refused as `bad_cargo` on a form the player filled in correctly. */
      S.quote = Object.assign({}, q, {
        from: sel.from,
        to: sel.to,
        cargo: { [sel.resId]: sel.units },
        /* The rig is picked FOR THE CARRIER THIS QUOTE NAMES. `q.carrierId` is
           the id resolveInput() resolved and shape() echoed back, so it is the
           same value contracts.js sends as p_carrier_id; sel.carrierId is the
           fallback for a refusal shape that carried none. See ownRigRowId(). */
        rigId: npc ? '' : ownRigRowId(q.carrierId || sel.carrierId),
        carrierId: npc ? '' : q.carrierId,
        meridian: npc || !!q.meridian,
      });
      if (!q.ok) b.toast('🚛 ' + (q.reason || 'No quote for that route.') + ' ' + (q.fix || ''), 6000);
      return;
    }

    if (act === 'dispatch') {
      const q = S.quote;
      if (!q) { b.toast('Get a quote first.'); return; }
      if (q.ok === false) { b.toast('🚛 ' + (q.reason || 'That haul was refused.') + ' ' + (q.fix || ''), 6000); return; }
      /* A player carrier needs a rig this client can name; Meridian does not.
         Refusing here, with the reason, beats sending a null p_rig_id and
         printing the RPC's `no_rig_chosen` over a screen that never offered a
         rig to choose. See ownRigRowId() for why the gap is server-side. */
      if (!q.meridian && !q.rigId) {
        /* TWO DIFFERENT FACTS REACH THIS BRANCH and they need different
           sentences, because one is "the feature does not exist yet" and the
           other is "your own yard is busy" — printing the first at a player
           whose own rigs are simply all out is how a working screen reads as
           broken. `q.carrierId` is the carrier the quote was priced for. */
        const own = !!(S.company && q.carrierId && String(q.carrierId) === String(S.company.id));
        b.toast(own
          ? '🚛 No rig in your fleet is free to take this haul — every one is out or has used its runs for the day. '
            + 'Wait for one to land, or take the Meridian Haulage quote.'
          : '🚛 This build cannot book another carrier’s rig — their yard is not readable from here. '
            + 'Take the Meridian Haulage quote, or haul it yourself with a rig in your own fleet.', 7000);
        return;
      }
      const price = num(q.price);
      const cap = q.capped ? ' (capped at the Meridian ceiling)' : '';
      if (!(await b.confirm('Ship for ' + fmtNum(price) + ' 🔥' + cap + '? ETA ' + (q.etaText || '—') + '.'))) return;
      const r = await acall(dispatch, { ok: false }, q);
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 6000); return; }
      S.quote = null;                 // a quote is a price at a moment, not a receipt
      b.toast('🚛 Cargo dispatched.');
      // The Cinder counter in the legacy HUD is now wrong until it repaints.
      try { b.render(); } catch (e) {}
      await refresh();
      return;
    }

    if (act === 'settle') {
      // Contract ids are NOT rig ids and need no crossing — `data-mt-id` on a
      // contract row is already transport_contracts.id, which is what the RPC
      // means by p_contract_id.
      if (!id) { b.toast('That contract has no id — refresh the depot.'); return; }
      const r = await acall(settle, { ok: false }, id);
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 5200); return; }
      b.toast('🚛 Contract settled.');
      try { b.render(); } catch (e) {}
      await refresh();
      return;
    }

    if (act === 'repair') {
      if (!id) { b.toast('That rig has no vehicle id — refresh the depot.'); return; }
      /* 🔴 THE ID CROSSING. The button carries the VEHICLE id — depot.render.js
         stamps `data-mt-id` from `view.fleet[].vehicleId` — and repair()
         forwards whatever it is given as `p_rig_id`, which sql/038 ~2397
         declares as a uuid and looks up in `transport_rigs.id`. Sending the
         vehicle id there is a `no_such_rig` on a rig sitting on screen. */
      const rid = rigRowId(id);
      if (!rid) {
        b.toast('🚛 That rig is not in the fleet list this panel loaded. Refresh the depot and try again.', 5200);
        return;
      }
      if (!(await b.confirm('Repair this rig? Parts and fuel come out of the yard.'))) return;
      const r = await acall(repair, { ok: false }, rid);
      if (!okOf(r)) { b.toast('🚛 ' + reasonOf(r), 5200); return; }
      // Say which rung it reached: transport_repair moves condition ONE step up
      // a five-rung ladder, and "repaired" alone reads as "fully fixed".
      b.toast('🔧 Repaired' + (r.condition ? ' to ' + r.condition : '') + '.');
      await refresh();
      return;
    }
  } finally {
    busy = false;
    paint();
  }
}

/* ── open / close ───────────────────────────────────────────────────────────
   open() works with NO bridge on purpose. index.html's founding hook has an
   else-branch that toasts when this module is missing entirely, so once the
   module has registered, open() must show something — the "not set up yet"
   panel — rather than doing nothing silently. A launcher tile that appears to
   do nothing when clicked is indistinguishable from a broken game. */
export function open() {
  try {
    ensureCss();
    let ov = document.getElementById(OV);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = OV;
      // Click-outside closes, matching every other overlay in the game.
      ov.addEventListener('click', (ev) => { if (ev.target === ov) close(); });
      ov.addEventListener('click', onClick);
      document.body.appendChild(ov);
    }
    S.tab = 'depot';
    paint();
    /* In-transit ETAs move on the clock, not on a click. Without this a
       contract sits at the same "2h 14m" until the player interacts, which
       reads as a stuck contract. Interval only exists while the panel does;
       close() clears it. */
    startTicker();
    refresh();
    return true;
  } catch (e) {
    try { console.warn('[transport] open failed:', e); } catch (e2) {}
    return false;
  }
}

function startTicker() {
  try {
    if (_tick) return;
    _tick = setInterval(() => {
      try {
        if (!document.getElementById(OV)) { stopTicker(); return; }
        if (busy) return;              // never repaint out from under an action
        paint();
      } catch (e) { stopTicker(); }
    }, 15000);
  } catch (e) { _tick = 0; }
}
function stopTicker() { try { if (_tick) clearInterval(_tick); } catch (e) {} _tick = 0; }

export function close() {
  try {
    const ov = document.getElementById(OV);
    if (ov) ov.remove();
    stopTicker();
    /* A quote is a price at a moment. Keeping it across a close would offer a
       price on reopen that the server may no longer honour, and the player
       would read the refusal as a bug rather than as a stale number.
       S.form is deliberately KEPT — a route someone typed is not a price, and
       retyping four fields after every close is the friction this echo exists
       to remove. */
    S.quote = null;
    busy = false;
    return true;
  } catch (e) { return false; }
}

/* ── public surface ─────────────────────────────────────────────────────────
   Everything the feature can do is reachable from here, so nothing outside
   /src/transport needs to import from inside it.

   ⚠ FROZEN NAMES — rigCatalog, rollRig, rarityIndex, onCharterFounded and open
   are called BY index.html. Renaming one of them silently breaks a call site in
   a 215k-line file that will not error until a player founds a company. */
const api = {
  version: 'v1',

  // ready() and bridgeReady() answer the same question. Both exist because
  // every other module in /src registers a ready(), and a caller should not
  // have to know which of the two names this one happened to pick.
  ready: () => bridgeReady(),
  bridgeReady,
  open, close, paint,
  refresh: () => refresh(),

  /* Returned BY REFERENCE, not copied: `_ppGenListing()` reads this on every
     listing roll and copying six objects per roll buys nothing. rigs.data.js is
     the authority for the catalog — a caller that needs to change a rig must
     copy first. */
  rigCatalog: () => (Array.isArray(PP_RIGS) ? PP_RIGS : []),
  /* ⚠ The identifiers inside these two closures are the IMPORTS, not the
     properties beside them — an object literal does not create a scope. Written
     out because turning either into a shorthand method would make it recurse. */
  rollRig: () => call(rollRig, null),
  /* 0..5 on the rarity ladder. TOLERANT OF WHAT IT IS HANDED, on purpose and
     with precedent: rigs.data.js's own `rigById()` accepts an id string OR the
     entry, "because neither caller should have to remember which". The bare
     import takes a RARITY id ('mythic'), but the index.html call sites this
     name is frozen for hold a rolled RIG — `_ppGenListing()` has the entry and
     the fleet has a row — and `rarityIndex('haul_cinderline')` silently returns
     0, which is Common. A wrong rarity that never errors is how a Mythic rig
     ends up drawn in grey; resolving a rig to its rarity first costs one lookup
     and removes the whole class. */
  rarityIndex: (id) => {
    const raw = (id && typeof id === 'object') ? (id.rarity || id.id) : id;
    const rig = call(rigById, null, raw);
    return num(call(rarityIndex, 0, (rig && rig.rarity) || raw));
  },

  /* Seeds "the rig every carrier starts with", the way
     `wfBuyBoat('skiff', { free:true })` does for fishing (index.html ~80205).
     Idempotent — see seedStarter(). Always resolves; never throws into the
     founding hook, because a throw there would abort founding a business the
     player has already paid for. */
  onCharterFounded: async (opts) => {
    try {
      const free = !!(opts && opts.free);
      if (!free) {
        // There is deliberately no purchase path here: fleet rigs are bought on
        // the Prince Portfolios floor, and a second place that mints rigs would
        // be a second place they are priced.
        return { ok: false, why: 'onCharterFounded only issues the free starter rig.' };
      }
      const r = await seedStarter(null);
      if (r && r.ok === false && r.why) { try { B().toast('🚛 ' + r.why, 5200); } catch (e) {} }
      return r;
    } catch (e) { return { ok: false, why: String((e && e.message) || e) }; }
  },

  /* Namespaces, so the console and any future caller can reach the pure parts
     without importing from inside the feature. Re-exported, never re-derived:
     MERIDIAN_TARIFF_MULT and MERIDIAN_TIME_MULT are routes.js's authority and
     appear here only so they can be read. */
  rigs: { PP_RIGS, PP_RIGS_BY_ID, RIG_RARITIES, rigById, effectiveRuns, fleetSlotBonus, runsPerDayBonus },
  routes: { PHASE, MERIDIAN, MERIDIAN_TARIFF_MULT, MERIDIAN_TIME_MULT, hops, inReach, tariffCap, quote, meridianQuote },
  freight: { myCompany, listCarriers, listMyRigs, listContracts, createCompany, setTariff, registerRig, dispatch, settle, repair },
  yard: { DEPOT_DEF_ID, depots, bestDepot, depotEffect, fleetCap, bays, depotReady },

  /* A runnable audit beats prose acceptance criteria. Handed the LIVE rarity
     ladder and the LIVE condition multipliers off the bridge, because checking
     rigs.data.js against its own mirrors only catches internal inconsistency —
     the drift that matters is against the game's tables. With no bridge it
     falls back to the mirror and says as much in the result. */
  audit: () => {
    const b = bridge();
    const ids = call(b.rarities, []).map((r) => r && r.id).filter(Boolean);
    const out = call(auditRigs, ['audit unavailable'], ids.length ? ids : RIG_RARITIES, (c) => num(call(b.condMult, 1, c)));
    return { checkedAgainst: ids.length ? 'live bridge tables' : 'rigs.data.js mirrors (no bridge)', result: out };
  },

  // Handy in the console: __mtr.debug()
  debug() {
    const b = bridge();
    return {
      bridgeReady: bridgeReady(),
      signedIn: !!call(b.signedIn, false),
      missing: S.missing,
      offline: S.offline,
      error: S.error || _lastThrow || '',
      rigs: Array.isArray(PP_RIGS) ? PP_RIGS.length : 0,
      phase: PHASE,
      tab: S.tab,
      fleet: S.rigs.length,
      carriers: S.carriers.length,
      contracts: S.contracts.length,
      company: S.company ? (S.company.name || S.company.id || true) : null,
      starter: { seeded: _starterSeeded, pending: _starterPending },
      /* Both id domains, side by side, because the bug that made this feature
         look broken was reading one as the other. `vehicle → row` is what every
         RPC argument is mapped through. */
      rigIds: S.rigs.map((r) => ({ vehicle: (r && (r.vehicle_id || r.vehicleId)) || '', row: (r && r.id) || '' })),
      // Display only — the DB clock inside transport_dispatch() owns the reset.
      dayKey: call(b.todayKey, null),
    };
  },
};

try {
  if (typeof window !== 'undefined') {
    window.MythicTransport = api;
    /* Console shorthand. `__mtr`, not `__mt`: `grep -n "window.__mt\b"` over
       index.html returns 0 today, but `MT_` is already this project's prefix for
       Mythic Token (MT_STAKING_READY_DEFAULT, and docs/MT_STAKING_ACTIVATION.md),
       so `__mt` would read as the token system to the next person at a console.
       Checked before choosing. */
    window.__mtr = api;
    /* Let the legacy launcher tile appear. It listens rather than polls, and the
       tile stays hidden until this fires — so a module that 404s shows no
       broken entry point instead of a button that does nothing. */
    try { window.dispatchEvent(new CustomEvent('mythic:transport-ready')); } catch (e) {}
  }
} catch (e) {
  try { console.warn('[transport] registration failed:', e); } catch (e2) {}
}

export default api;
