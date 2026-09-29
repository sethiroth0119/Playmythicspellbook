/* ═══════════════════════════════════════════════════════════════════════════
   📜 SUPPLY CHAIN · proposal.js — the owner's two gameplay asks as ONE SWITCH
   that is OFF, in the exact shape the game already knows how to merge.

   The owner's goal asks for two things the shipped game does not do:
     D1  "make sure that all of the businesses needs what can be found in the
          loot system in the battle system"
     D2  "Make sure (all) of the resources 100+ resources that we have in the
          game has a use."
   recipes.js and coverage.js already say WHICH resource each business should
   need and make, tagged `live:false`. This file turns those rows into an
   OVERLAY: `{ [opId]: { inputs:{resId:rate}, yields:{resId:rate} } }` — the
   shape `getOpsEconOverrides()` returns and `_opEcon()` deep-merges in
   public/index.html. Publishing that object through the existing admin
   Ops-Econ override is what would make the needs real. Nothing here does that.

   🔴 NOTHING IN THIS FILE RUNS THE OVERLAY. Its one import is GENERATED DATA
   (flux.snapshot.js, the measured drop rates — round 3, see below); it reads no
   window, touches no bridge, writes nowhere. Every export is a pure function
   of its arguments. The ONLY intended caller at runtime is an admin-only "copy
   overlay JSON" action in the modal / shell; `grep -rn "proposal.js"` over
   public/ is the proof of default-OFF and the audit piece pins it.

   WHY RATES ARE RELATIVE AND NEVER TYPED. CLAUDE.md: "All operation pricing
   goes through _opEcon(). Never hardcode economy numbers." A new input WANTS
   `SC.proposal.tiers[tier] x reference`, where `reference` is a rate the LIVE
   row already states (SC.proposal.reference — the op's own largest yield, else
   the median input rate live operations already pay). A retune of the real
   table moves the proposal with it. startup / wages / ratePerWorkerHr are never
   read and never emitted. `maxWorkers` IS read (round 2) — only to turn a
   per-worker rate into "units per hour for the whole business" so it can be
   compared with what the world can deliver; it is never emitted either.

   🔴 ROUND 2 — WHAT THE WANT IS CAPPED BY (the critic's finding, and it was right).
   Round 1 accepted an input as "battle loot" when `catalog.handLoot` was true.
   handLoot only says where the id sits in the SALVAGE_RES source block. It says
   nothing about whether a player can FIND the thing: 90 of the 176 inputs round
   1 required had, as their only source, the uniform one-in-hundreds exotic roll
   or a trader shelf that never refills (decisions/loot.md finding 2) — the very
   sources round 1 withheld 170 other needs for — and one of them asked for
   about 11,900 common bodies per 12 hours. Under a worst-ratio throttle that is
   an outage with a recipe attached. So now:
     1. SOURCING IS loot.js's ANSWER, NOT A CATALOGUE FLAG. `data.loot.sourcesFor`
        is asked for each id; the best `via` decides the supply kind. Accepted by
        default: 'always' / 'drops' / 'staples' (a ruin, a unit type, a camp
        mission — something a player can AIM at), or a business that makes it.
        'buy' = kind `traderShelf`, 'exotic' / 'all' = kind `lotteryOnly`: both
        are WITHHELD unless the caller opts in. No loot data injected = no loot
        input is emitted at all (we refuse to guess).
     2. EVERY LOOT INPUT IS SIZED AGAINST DROP FLUX. `flux.perHaul[id]` = expected
        units of that id from one salvage haul (one body or one ruin). It is
        MEASURED, never typed: tools/supplychain/gen-flux.mjs slices _rollUnitSalvage and
        _rollStructureSalvage out of index.html and rolls them (loot.js refuses
        to hold drop rates, for the reason this file refuses to hold prices).
        A business may ask, across ALL its loot inputs together, for at most
        `lootGate.haulsPerWindow` hauls' worth per `lootGate.windowHours`. No flux
        = no loot input emitted ('no-drop-measurement').
        ROUND 3: the measurement SHIPS. Round 2 left it in a temp directory, so the
        module as shipped emitted 29 business-made inputs and ZERO battle-loot
        needs — the opposite of the owner's ask. tools/supplychain/gen-flux.mjs
        now writes flux.snapshot.js (the catalog.snapshot.js pattern; `--check`
        fails when the loot tables or the roll code move) and it is the DEFAULT
        here. `opts.flux` still overrides it; `opts.flux === null` is the explicit
        "pretend nothing was measured" the gate uses to pin the refusal.
        A stale snapshot is the new risk: `fluxCheck()` compares the snapshot's
        table signature with the LIVE loot tables the bridge hands over, and
        adminCopyPayload refuses on a mismatch — and, since ROUND 4, also when no
        tables are handed over at all (it was fail-open; see the function).
     3. BUSINESS-MADE GOODS ARE SIZED AGAINST WHAT THE MAKERS MAKE. New demand for
        an id is capped at `lootGate.madeShare` of (makers' hourly output minus
        what live ops already consume), split between the new consumers. Round 1
        had Salvage wanting 81 Research Data per 12h against a proposed ~3.
     4. A min() of "relative want" and "physical cap" is still not a typed rate:
        the want moves with the table, the cap moves with the measured drops.

   WHAT THE REAL GAME DOES WITH AN OVERLAY (read from index.html, by symbol —
   line numbers drift in a shared tree):
     · `_opEcon(t)`  Object.assign({}, base, o), then inputs and yields are each
       merged one level deep, so adding `inputs.cloth` cannot delete `inputs.food`.
       An override for an op id that is NOT in OPS_ECON returns null — so the
       fashion / airport rows from newOpRows() are INERT as overrides, and so is
       the bookkeeping key OVERLAY_MARKER. A new business needs code; it cannot
       be pasted into existence.
     · `_opComputed(o)`  supply = the WORST held/needed ratio across ALL inputs.
       Held is `getRes(id)`, which reads Profile.salvage[id] for ANY id — the
       resource ledger and the salvage ledger are the same object
       (`_ensureResources` aliases Profile.salvage). So a battle-loot id that is
       not in RESOURCES *can* be drawn by an op.
       ⚠ The OPS_ECON comment says an unknown input "never draws anything".
         That is half the story: it never draws, AND it reads as held = 0, so
         the worst ratio is 0 and the whole business produces NOTHING while
         wages are still owed. An id typo in an overlay is an outage. That is
         why every id is checked against the catalogue here and why
         validateOverlay() exists.
     · `_opSettle`  pays yields through `addSalvage`, which silently drops any
       id not in SALVAGE_RES. Hence "SALVAGE_RES only" for both maps.
     · `cxYieldMul(e.yields)` and `MythicTerroir.opMul(e.yields)` price an op's
       CINDER revenue off its yield mix (client side; sql/151's server collect
       pins the market multiplier to 1). A new yield therefore MOVES the client
       Cinder figure of that op — the harness measures by how much, and round 1's
       by-products were up to 29% of Oil's price mix, which is not "slightly".
       And giving a yield to a service op whose table row says `yields: {}`
       ("earns Cinder, not resources" — bank, dojo, restaurant, transport…)
       would switch market + terroir pricing ON for it. So: service-op yields
       are WITHHELD unless the caller asks (opts.serviceYields) and yields as a
       whole are the LAST stage.
     · The admin Ops-Econ editor (`openOpsEconEditor`) iterates OPS_ECON ids and
       edits numbers + yields only. It has NO inputs field and NO paste box, so
       an overlay cannot be switched on from it today: D1 needs one small import
       box (owner decision, listed in decisions/proposal.md). It never strips
       keys it does not know, so inputs and OVERLAY_MARKER survive its SAVE.
       Its RESET wipes everything, the overlay included.

   REJECTED DESIGNS
     · Absolute per-resource rates in tuning.js — goes stale on the first
       rebalance and is an economy number by another name.
     · Emitting every coverage row. 359 proposed input/upkeep rows over 25 ops
       is ~14 new inputs per business under a WORST-ratio throttle: one missing
       long-tail item zeroes the op. SC.proposal.maxInputsPerOp caps it; what
       does not fit is returned in `withheld` with the reason, never dropped
       silently.
     · Roles craft / build / trade as feedstock. Those are recipes, upgrades and
       resale desks inside a business's minigame. They stay withheld
       ('needs-minigame-wiring') — EXCEPT that a business which would otherwise
       end with no aimable battle-loot need borrows up to `lootGate.promoteMax`
       of them (role 'promoted'), because the owner's word was ALL businesses.
       Round 1 left the Card Shop with nothing while Dojo / Bank / Research
       consumed the same relic ids; that was inconsistent, not principled.
     · `catalog.handLoot` as the "is it lootable" test — see ROUND 2 above.
     · Sizing a loot input as a fraction of the op's own yield alone (round 1):
       38 Fire Salts per 12 hours for one mine is not feedable by any player base.
     · removeFromOverrides matching on RATE (round 1): after any retune the
       rebuilt overlay's rates differ and it removed 0 of 187 lines; and it
       deleted an admin's own line whenever the rates happened to be equal. The
       applied lines are now RECORDED inside the payload (OVERLAY_MARKER) and
       removal goes by that record.
     · Importing recipes.js / coverage.js / loot.js here. `data` is injected
       (contract: pure files take siblings as parameters), so a critic can feed
       a mutant — the harness's negative control does exactly that.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The ONLY two keys an overlay row may carry. Anything else (startup, wages…)
   would reprice a business, and "No price is rebalanced" is the run's promise. */
/* GENERATED measurement, not a sibling's judgement: safe to import (CONTRACT: pure files stay
   Node-importable, and this one is plain data). A missing/empty snapshot exports null. */
import { FLUX as SHIPPED_FLUX } from './flux.snapshot.js';

export const OVERLAY_KEYS = Object.freeze(['inputs', 'yields']);

/* Fields a NEW op row needs that are the owner's to set. Listed so newOpRows()
   can ship them as explicit nulls instead of leaving them out: a missing key
   reads as "forgot", a null reads as "yours to decide". Names only, no values. */
export const OWNER_PRICED_FIELDS = Object.freeze(['startup', 'azaStartup', 'ratePerWorkerHr', 'salaryPerWorkerHr', 'maxWorkers']);

/* The six places a new operation must be added, from OWNER_DECISIONS D4. Kept
   as data so the modal and decisions/proposal.md print the same checklist. */
export const NEW_OP_CHECKLIST = Object.freeze([
  'OPS_ECON row (public/index.html) — the economy row; prices are the owner\'s',
  'OP_LABELS (public/index.html) — the display name',
  'OPERATIONS card (public/index.html) — the Just Business tile players found it from',
  'OP_BP (public/index.html) — the blueprint / building footprint',
  'OP_ECO_MAP (public/node-city/index.html) — what the simulated city firm makes',
  'corp_op_econ row (sql/151) — without it the server collect raises "no server tuning for operation type"',
]);

/* Which coverage role lands in which tier. PDF-lane cargo (recipes.buys) is
   the owner's own drawing, so it outranks everything: core. */
const ROLE_TIER = Object.freeze({ lane: 'core', input: 'support', upkeep: 'trace' });
const TIER_ORDER = Object.freeze(['core', 'support', 'trace']);
const NOT_FEEDSTOCK = Object.freeze({ craft: 1, build: 1, trade: 1 });

/* ── tolerant readers over the injected `data` ─────────────────────────────
   Callers assemble `data` from module namespaces, from bare tables, or (in a
   critic's mutant run) from hand-made objects. Every reader accepts all three
   and never throws: a pure file that explodes on a half-built `data` takes the
   modal down with it. */
const isObj = (v) => v && typeof v === 'object';

function recipesOf(data) {
  const r = data && data.recipes;
  if (!isObj(r)) return {};
  return isObj(r.RECIPES) ? r.RECIPES : r;
}

function needsReader(data) {
  const c = data && data.coverage;
  if (c && typeof c.needsOf === 'function') return (id) => c.needsOf(id) || [];
  const uses = c && (c.USES || c);
  if (!isObj(uses)) return () => [];
  return (id) => {
    const out = [];
    for (const resId of Object.keys(uses)) {
      const rows = Array.isArray(uses[resId]) ? uses[resId] : [];
      for (const u of rows) if (u && u.by === id && u.role !== 'sim') out.push({ id: resId, role: u.role, live: !!u.live, why: u.why });
    }
    return out;
  };
}

function catalogReader(data) {
  const c = data && data.catalog;
  if (c && typeof c.byId === 'function') return (id) => c.byId(id) || null;
  const rows = Array.isArray(c) ? c : (c && Array.isArray(c.CATALOG) ? c.CATALOG : null);
  if (!rows) return () => null;
  const m = new Map(rows.map((r) => [r.id, r]));
  return (id) => m.get(id) || null;
}

/* Phantoms are collected from whoever declares them; none is typed here, so a
   fifth phantom found later only has to be added where the evidence lives. */
function phantomSet(data) {
  const s = new Set();
  const add = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach((x) => s.add(typeof x === 'string' ? x : x && x.id));
    else if (isObj(v)) Object.keys(v).forEach((k) => s.add(k));
  };
  if (data) {
    add(data.recipes && data.recipes.PHANTOMS);
    add(data.coverage && data.coverage.PHANTOMS);
    add(data.loot && data.loot.PHANTOM_IDS);
    add(data.catalog && data.catalog.PHANTOMS);
  }
  s.delete(undefined); s.delete(null);
  return s;
}

/* liveOpEcon may be the bridge's opEcon(id) function, a plain {opId: row} map,
   or the whole fixture (which keeps the map under .opsEcon). */
function econReader(liveOpEcon, data) {
  /* the contract's two-argument buildOpsEconOverlay(data, SC): the rows ride on data */
  if (liveOpEcon == null && data) liveOpEcon = data.opEcon || data.fixture || null;
  if (typeof liveOpEcon === 'function') return (id) => { try { return liveOpEcon(id) || null; } catch (e) { return null; } };
  const m = isObj(liveOpEcon) ? (isObj(liveOpEcon.opsEcon) ? liveOpEcon.opsEcon : liveOpEcon) : {};
  return (id) => (isObj(m[id]) ? m[id] : null);
}

/* Which op ids to consider. The businesses list is the truth when present (it
   knows which tiles are `planned`); otherwise whatever the econ map carries. */
function opIdsOf(data, liveOpEcon, econ) {
  const out = [];
  const B = data && data.businesses && (data.businesses.BUSINESSES || data.businesses);
  if (Array.isArray(B)) {
    for (const b of B) { const id = b && (b.opId || b.id); if (id && b.status !== 'planned' && econ(id)) out.push(id); }
    if (out.length) return out;
  }
  if (typeof liveOpEcon !== 'function' && isObj(liveOpEcon)) {
    const m = isObj(liveOpEcon.opsEcon) ? liveOpEcon.opsEcon : liveOpEcon;
    return Object.keys(m).filter((k) => econ(k));
  }
  return Object.keys(recipesOf(data)).filter((k) => econ(k));
}

const positive = (map) => (isObj(map) ? Object.keys(map).map((k) => +map[k]).filter((n) => isFinite(n) && n > 0) : []);

function median(nums) {
  if (!nums.length) return 0;
  const a = nums.slice().sort((x, y) => x - y); const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/* The reference resolvers SC.proposal.reference may name, tried in its order.
   All of them read rates the live table already states. */
function referenceFor(row, allRows, order) {
  const R = {
    ownMaxYield: () => Math.max(0, ...positive(row && row.yields)),
    ownMaxInput: () => Math.max(0, ...positive(row && row.inputs)),
    medianLiveInput: () => median([].concat(...allRows.map((r) => positive(r && r.inputs)))),
    medianLiveYield: () => median([].concat(...allRows.map((r) => positive(r && r.yields)))),
  };
  for (const name of order) {
    const v = R[name] ? R[name]() : 0;
    if (isFinite(v) && v > 0) return { value: v, from: name };
  }
  return { value: 0, from: null };
}

function roundTo(n, decimals) {
  const d = Math.max(0, decimals | 0); const p = Math.pow(10, d);
  return Math.round(n * p) / p;
}
/* A CAPPED rate is floored, never rounded: rounding 0.0075 up to 0.01 would
   quietly ask for a third more than the cap that was just computed. */
function floorTo(n, decimals) {
  const d = Math.max(0, decimals | 0); const p = Math.pow(10, d);
  return Math.floor(n * p + 1e-9) / p;
}

/* ── the loot gate's knobs ─────────────────────────────────────────────────
   They live in tuning.js as `SC.proposal.lootGate` and NOWHERE else (CLAUDE.md:
   never hardcode an economy number; CONTRACT rule 2). Rounds 2-4 kept a fallback
   copy here "until the seam piece adopts it" — three rounds later the ceiling that
   sets every appetite was still a literal in this file. REJECTED now: any default.
   A missing or malformed block means this file proposes NOTHING and says why
   (stats.refused), the copy action returns null, and proposal-gate.mjs fails.
   What each knob means is documented beside the numbers, in tuning.js.
   Only the NAMES and types are written here, so a typo'd knob is caught instead
   of silently reading as undefined -> NaN -> "no cap".                          */
export const LOOT_GATE_SHAPE = Object.freeze({
  accept: 'list', haulsPerWindow: 'positive', windowHours: 'positive', madeShare: 'share', decimals: 'count',
  minLootNeedsPerOp: 'count', promoteMax: 'count', maxMinigameInputsPerOp: 'count', minigameUnits: 'positive',
  allowUnmeasuredMakers: 'flag',
});
/* 📏 THE SIZING KNOBS — the same rule as the loot gate, one level up.
   These four decide HOW BIG a proposed rate is: which live rate it is measured
   against (`reference`), the fraction each tier takes of it (`tiers`), how many
   new inputs one operation may be given (`maxInputsPerOp`) and the rounding
   (`decimals`). They are knob VALUES, so by CONTRACT rule 2 they live in
   tuning.js and nowhere else.
   Round 5 fixed that for `lootGate` but left `reference` and `decimals` with
   typed fallbacks here (`: ['ownMaxYield','medianLiveInput']`, `: 2`) — the two
   numbers that scale EVERY emitted rate sat in this file, and because the gate's
   literal scan only walks LOOT_GATE_SHAPE it could not see them, so the README
   sentence "the gate fails if a value is typed into proposal.js" was wider than
   what was enforced. REJECTED: keeping "harmless" defaults. A default that is
   never exercised is invisible drift from the settings file the day tuning.js
   changes; a default that IS exercised means the shipped proposal was sized by a
   number the owner never saw.
   `tiers` / `maxInputsPerOp` took `{}` fallbacks, which typed no value but made a
   missing block emit an empty overlay with no explanation. Now all four refuse
   loudly through the same path as the gate.
   ⚠ tools/supplychain/proposal-gate.mjs (lead-owned) scans only LOOT_GATE_SHAPE
   for typed literals; it should iterate SIZING_SHAPE too. Until it does, this
   file simply contains no literal for either shape to find. */
export const SIZING_SHAPE = Object.freeze({
  reference: 'list', tiers: 'shareMap', maxInputsPerOp: 'countMap', decimals: 'count',
});
const SHAPE_OK = Object.freeze({
  list: (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'),
  positive: (v) => typeof v === 'number' && isFinite(v) && v > 0,
  share: (v) => typeof v === 'number' && v > 0 && v <= 1,
  count: (v) => typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v,
  flag: (v) => typeof v === 'boolean',
  /* A map keyed by tier. Every KEY must be a tier this file emits and every VALUE
     must be valid, and at least one must be there. Checking the values alone is not
     enough: `{core:0.3, suport:0.12, trace:0.04}` is all-valid values and silently
     drops the support tier — the first run of this check passed that mutant, which
     is the whole failure mode these shapes exist to catch. */
  shareMap: (v) => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => TIER_ORDER.includes(k) && SHAPE_OK.share(v[k])),
  countMap: (v) => isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => TIER_ORDER.includes(k) && SHAPE_OK.count(v[k])),
});

/** -> [] when the four SC.proposal sizing knobs are present and well-typed, else one sentence each. */
export function sizingProblems(SC) {
  const p = SC && SC.proposal;
  if (!isObj(p)) return ['The proposal settings (SC.proposal in tuning.js) are missing, so no rate can be sized.'];
  const out = [];
  for (const k of Object.keys(SIZING_SHAPE)) if (!SHAPE_OK[SIZING_SHAPE[k]](p[k])) out.push('Sizing setting "' + k + '" is missing or not a valid ' + SIZING_SHAPE[k] + '.');
  return out;
}

/** -> [] when SC.proposal.lootGate is complete and well-typed, else one plain sentence per problem. */
export function lootGateProblems(SC) {
  const g = SC && SC.proposal && SC.proposal.lootGate;
  if (!isObj(g)) return ['The loot-appetite settings (SC.proposal.lootGate in tuning.js) are missing, so nothing can be sized.'];
  const out = [];
  for (const k of Object.keys(LOOT_GATE_SHAPE)) if (!SHAPE_OK[LOOT_GATE_SHAPE[k]](g[k])) out.push('Loot-appetite setting "' + k + '" is missing or not a valid ' + LOOT_GATE_SHAPE[k] + '.');
  return out;
}

function lootGateOf(SC) {
  if (lootGateProblems(SC).length) return null;
  const g = SC.proposal.lootGate; const out = {};
  for (const k of Object.keys(LOOT_GATE_SHAPE)) out[k] = Array.isArray(g[k]) ? g[k].slice() : g[k];
  return out;
}

/* Measured drop flux, injected. Shape:
     { perHaul:{resId:units},          THEMED drops only — what one haul gives of an id a player can
                                       aim for (staple rolls, ruin tables), the any-item roll EXCLUDED
       perHaulLottery:{resId:units},   what the any-item roll alone gives of an id (one in hundreds)
       measuredFrom, … }
   Two maps because they answer different questions: an id that is aimable through a source the
   harness cannot roll (a roguelite haul, a territory node) must fall to the FLOOR of the themed
   map, not to its own lottery trickle — round 2's first run made that mistake and the floor came
   out at 0.003.
   Looked for in opts.flux, data.flux, data.loot.FLUX, then a fixture's lootFlux. */
function fluxOf(data, o, liveOpEcon) {
  /* An explicit null is a caller saying "behave as if nothing was measured" (the gate pins the
     refusal with it). Absent = use what ships. */
  if (o && 'flux' in o && o.flux === null) return null;
  const c = [o && o.flux, data && data.flux, data && data.loot && data.loot.FLUX, isObj(liveOpEcon) && liveOpEcon.lootFlux, SHIPPED_FLUX];
  for (const f of c) if (isObj(f) && isObj(f.perHaul)) return f;
  return null;
}

/* Is the measurement still about THIS game? The generator's sha covers the roll code, but the
   browser cannot hash index.html; what it CAN do is compare the loot TABLES the bridge hands
   over (structureSalvage(), lootResIds()) with the ones that were rolled. Order-sensitive on
   purpose: the ruin tables are drawn by index. A plain string hash — this is a staleness
   tripwire, not a security boundary. */
export function tableSignature(structureSalvage, lootResIds) {
  const s = JSON.stringify([isObj(structureSalvage) ? Object.keys(structureSalvage).sort().map((k) => [k, (structureSalvage[k] || {}).core || [], (structureSalvage[k] || {}).flavour || []]) : null,
    Array.isArray(lootResIds) ? lootResIds : null]);
  let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'tbl1-' + h.toString(16) + '-' + s.length;
}

/** -> {ok, why}. `tables` = {structureSalvage, lootResIds} from the bridge. No tables = cannot tell = not ok. */
export function fluxCheck(flux, tables) {
  const f = flux === undefined ? SHIPPED_FLUX : flux;
  if (!isObj(f) || !isObj(f.perHaul)) return { ok: false, why: 'no drop-rate measurement ships (run tools/supplychain/gen-flux.mjs)' };
  if (!isObj(tables) || !isObj(tables.structureSalvage) || !Array.isArray(tables.lootResIds)) return { ok: false, why: 'the live loot tables were not supplied, so the measurement cannot be checked against them' };
  if (!f.tableSignature) return { ok: false, why: 'the measurement carries no table signature' };
  const live = tableSignature(tables.structureSalvage, tables.lootResIds);
  return live === f.tableSignature ? { ok: true, why: '' } : { ok: false, why: 'the loot tables changed since the drop rates were measured (' + f.tableSignature + ' measured, ' + live + ' live); re-run tools/supplychain/gen-flux.mjs' };
}
export const shippedFlux = () => SHIPPED_FLUX;

const LOOT_KIND = Object.freeze({ always: 'aimedLoot', drops: 'aimedLoot', staples: 'stapleLoot', buy: 'traderShelf', exotic: 'lotteryOnly', all: 'lotteryOnly' });
const KIND_RANK = Object.freeze({ madeLive: 0, stapleLoot: 0, aimedLoot: 1, madeInMinigame: 2, madeByOverlay: 2, traderShelf: 3, lotteryOnly: 4, unclassified: 5, noSource: 6 });

/* One place that answers "who can put this id in a player's stash, and how
   dependable is that?" — shared by explainOverlay and validateOverlay so a
   hand-edited overlay is judged by the same rule as a generated one.
     madeLive        another business's OPS_ECON row yields it passively today
     aimedLoot       loot.js: a themed drop (a ruin kind, a unit type, a mode)
     stapleLoot      loot.js: the camp staple pool
     madeInMinigame  made today, but only by PLAYING a business screen (farm,
                     refinery…) — a passive owner produces none
     madeByOverlay   only this overlay's own new yields would make it
     traderShelf     best source is a shop shelf (never refills today)
     lotteryOnly     best source is the uniform any-item roll
     unclassified    no loot data was injected, so we will not guess
     noSource        nothing anywhere                                         */
function makeSourcing(data, econ, opIds, o, accept) {
  /* 'buy' is always the shelf; any other via the gate does not ACCEPT is treated as the lottery. */
  const kindOfVia = (via) => (via === 'buy' ? 'traderShelf' : (Array.isArray(accept) ? accept.includes(via) : !!LOOT_KIND[via] && LOOT_KIND[via] !== 'lotteryOnly') ? (via === 'staples' ? 'stapleLoot' : 'aimedLoot') : 'lotteryOnly');
  const recipes = recipesOf(data);
  const L = data && data.loot;
  const sourcesFor = L && typeof L.sourcesFor === 'function' ? L.sourcesFor : null;
  const lootOpts = Object.assign({ catalog: data && data.catalog }, isObj(o && o.lootOpts) ? o.lootOpts : {});
  const cache = new Map();
  const lootBest = (id) => {
    if (cache.has(id)) return cache.get(id);
    let v = null;
    if (sourcesFor) {
      let rows = []; try { rows = sourcesFor(id, lootOpts) || []; } catch (e) { rows = []; }
      const first = rows.find((r) => r && r.via && !r.notLootable && !r.unverified && LOOT_KIND[r.via]);
      /* labels = EVERY place a player can aim for it, in loot.js's order (best first). The best row alone
         under-reported ids that sit in more than one ruin table (cloth: house and school). */
      const labels = first ? [...new Set(rows.filter((r) => r && r.via && !r.notLootable && !r.unverified && LOOT_KIND[r.via] === LOOT_KIND[first.via] && r.label).map((r) => r.label))] : [];
      v = first ? { via: first.via, source: first.id || null, label: first.label || null, labels } : { via: null, source: null, label: null, labels: [] };
    }
    cache.set(id, v); return v;
  };
  const liveMakers = (id, selfOp) => opIds.filter((b) => b !== selfOp && positive({ x: ((econ(b) || {}).yields || {})[id] }).length);
  const minigameMakers = (id, selfOp) => {
    const out = [];
    for (const b of Object.keys(recipes)) {
      if (b === selfOp) continue;
      const makes = (recipes[b] && recipes[b].makes) || [];
      // cityFirm output stays inside the closed city sim (CLAUDE.md: never addRes a
      // chain resource), so it never reaches a player stash and does not count.
      if (makes.some((m) => m && m.id === id && m.live && m.via !== 'cityFirm') && !liveMakers(id, null).includes(b)) out.push(b);
    }
    return out;
  };
  return function supplyOf(id, selfOp, overlayMakers) {
    const made = liveMakers(id, selfOp);
    const lb = lootBest(id);
    const lootKind = lb ? (lb.via ? kindOfVia(lb.via) : null) : 'unclassified';
    const mini = minigameMakers(id, selfOp);
    const ov = overlayMakers && overlayMakers[id] ? overlayMakers[id].filter((b) => b !== selfOp) : [];
    const base = { by: [], loot: lb && lb.via ? lb : null, madeLiveBy: made, minigameBy: mini, overlayBy: ov };
    const aimable = lootKind === 'aimedLoot' || lootKind === 'stapleLoot';
    if (made.length) return Object.assign(base, { kind: 'madeLive', by: made, alsoLoot: aimable });
    if (aimable) return Object.assign(base, { kind: lootKind });
    if (mini.length) return Object.assign(base, { kind: 'madeInMinigame', by: mini });
    if (ov.length) return Object.assign(base, { kind: 'madeByOverlay', by: ov });
    if (lootKind) return Object.assign(base, { kind: lootKind });
    return Object.assign(base, { kind: 'noSource' });
  };
}

const UNDEPENDABLE = Object.freeze({
  traderShelf: ['trader-shelf-only', 'its best source is a trader shelf, and shelves do not refill today (decisions/loot.md)'],
  lotteryOnly: ['lottery-only', 'only the uniform any-item salvage roll drops it; as an input it would zero the business'],
  unclassified: ['no-loot-data', 'no loot table was injected, so where it drops is unknown — refusing to guess'],
  noSource: ['no-source', 'nothing drops it and no business makes it'],
});

/**
 * The whole answer, with its reasoning. buildOpsEconOverlay() is `.overlay` of this.
 *
 * opts (all optional — they NARROW or WIDEN the overlay; stagedOverlays() uses the first four):
 *   tiers:list of names  which tiers to emit                (default: all in SC)
 *   yields:boolean       emit proposed products              (default: true)
 *   serviceYields:bool   also give yields to `yields:{}` ops  (default: false — see header)
 *   ledgerOnly:boolean   inputs limited to ids in RESOURCES   (default: false)
 *   ops:[opId]           limit to these ops (a pilot)         (default: all)
 *   flux:{perHaul}       MEASURED drop flux; without it no loot input is emitted
 *   allowTraderShelf / allowLottery   opt in to the two undependable kinds (default false;
 *                        a lottery id is still sized by its measured flux, so it almost
 *                        always comes out 'source-too-thin' anyway — which is the truth)
 *   lootOpts:{…}         passed through to loot.sourcesFor (live staple / ruin / trader lists)
 *   salvageIds:[id]      live SALVAGE_RES ids from the bridge; beats the snapshot
 *
 * returns { overlay, rows:[{op,kind,id,tier,rate,want,cap,cappedBy,haulsPerWindow,supply,role,why}],
 *           withheld:[{op,kind,id,reason,detail}], stats:{…, perOp, madeBalance} }
 */
export function explainOverlay(data, SC, liveOpEcon, opts) {
  const o = opts || {};
  const P = (SC && SC.proposal) || {};
  const G = lootGateOf(SC);
  /* No settings = no proposal. Returning an EMPTY overlay (rather than throwing) keeps every
     caller total; stats.refused is what a view or the gate reads to say why.
     Two refusals, checked gate-first so the existing 'no-lootGate' reason (which the gate
     and the memo both pin by name) keeps its meaning when both blocks are missing. */
  const refuse = (reason, problems) => ({ overlay: {}, rows: [], withheld: [], stats: { refused: reason, problems, ops: 0, opsTouched: 0, newInputs: 0, newYields: 0,
    distinctResources: 0, aimableLootInputs: 0, madeInputs: 0, minigameInputs: 0, withheld: 0, lootGate: null, perOp: {}, madeBalance: [], enabledByDefault: !!P.enabledByDefault } });
  if (!G) return refuse('no-lootGate', lootGateProblems(SC));
  const sizing = sizingProblems(SC);
  if (sizing.length) return refuse('no-sizing', sizing);
  /* Read straight off SC — every one of these was shape-checked above, so there is
     nothing left to defend against and no reason to type a second copy of it here. */
  const tiers = P.tiers;
  const caps = P.maxInputsPerOp;
  const order = P.reference;
  const decimals = P.decimals;
  const wantTiers = new Set(Array.isArray(o.tiers) ? o.tiers : TIER_ORDER);
  const allow = { traderShelf: !!o.allowTraderShelf, lotteryOnly: !!(o.allowLottery || o.allowRareRoll) };

  const econ = econReader(liveOpEcon, data);
  const recipes = recipesOf(data);
  const needsOf = needsReader(data);
  const cat = catalogReader(data);
  const phantoms = phantomSet(data);
  const salvage = Array.isArray(o.salvageIds) && o.salvageIds.length ? new Set(o.salvageIds.map((x) => (typeof x === 'string' ? x : x && x.id))) : null;
  const inSalvage = (id) => (salvage ? salvage.has(id) : !!(cat(id) && cat(id).inLoot));

  const allOps = opIdsOf(data, liveOpEcon, econ);
  const ops = Array.isArray(o.ops) ? allOps.filter((id) => o.ops.includes(id)) : allOps;
  const allRows = allOps.map(econ).filter(Boolean);
  const supplyOf = makeSourcing(data, econ, allOps, o, G.accept);
  const workers = (op) => Math.max(1, +((econ(op) || {}).maxWorkers) || 1);

  /* Flux. `floor` = the thinnest MEASURED aimable drop: what an aimable id that
     the harness could not roll (a roguelite haul, a territory node, a fishing
     trip, a minigame product) is assumed to deliver. Deliberately pessimistic. */
  const flux = fluxOf(data, o, liveOpEcon);
  const perHaul = flux ? flux.perHaul : null;
  const perLottery = flux && isObj(flux.perHaulLottery) ? flux.perHaulLottery : {};
  let fluxFloor = 0;
  if (perHaul) for (const id of Object.keys(perHaul)) { const v = +perHaul[id]; if (v > 0 && (!fluxFloor || v < fluxFloor)) fluxFloor = v; }
  /* Read here (not beside pass 3) because pass 2 refuses a farm / refinery good whose maker has no readable rate table. */
  const miniRate = (id) => { const r = flux && isObj(flux.minigame) && isObj(flux.minigame.perUnitHour) ? flux.minigame.perUnitHour[id] : null; return r && +r.perUnitHour > 0 ? r : null; };
  /* A minigame product or a shelf item is not a body drop: whatever tiny number the
     any-item roll gives it says nothing about how fast a player can make or buy it,
     so those kinds always take the floor. */
  const haulUnits = (id, kind) => {
    if (!perHaul) return { v: 0, from: null };
    if (kind === 'lotteryOnly') { const l = +perLottery[id]; return { v: l > 0 ? l : 0, from: 'lottery' }; }
    const v = (kind === 'madeInMinigame' || kind === 'traderShelf') ? 0 : +perHaul[id];
    return v > 0 ? { v, from: 'measured' } : { v: fluxFloor, from: 'floor' };
  };

  const overlay = {}; const rows = []; const withheld = [];
  const hold = (op, kind, id, reason, detail) => withheld.push({ op, kind, id, reason, detail: detail || '' });

  /* The shared gate. Returns a reason string, or '' when the id may be emitted.
     Order matters: the first reason is the one the owner reads. */
  const gate = (id) => {
    if (phantoms.has(id)) return 'phantom-id';
    if (!cat(id) && !salvage) return 'not-in-catalogue';
    if (!inSalvage(id)) return 'not-in-SALVAGE_RES';
    return '';
  };

  /* ── pass 1: yields, so pass 2 knows what the overlay itself would make ── */
  const yieldPlan = {};       // op -> [{id, why}]
  const overlayMakers = {};   // resId -> [op]
  for (const op of ops) {
    const row = econ(op); const rec = recipes[op] || {};
    const liveY = isObj(row.yields) ? row.yields : {};
    const isService = !positive(liveY).length;
    for (const m of (rec.makes || [])) {
      /* `promotes: 'cityFirm'` is a LIVE row the owner's map also wants a PLAYER
         to be able to dig or grow (recipes.js cityPromote(): the six ores, the
         crops). The city sim really makes it, so the row is live and badges
         LIVE — but it never reaches a stash, so the overlay must still pay it
         out, or the lanes that carry it have no player-facing supplier and the
         Gene Lab gets required inputs nobody can make. Skipping those four ids
         cost the overlay 4 yields, 8 inputs and 4 distinct resources. */
      if (!m || (m.live && m.promotes !== 'cityFirm')) continue;
      const g = gate(m.id); if (g) { hold(op, 'yield', m.id, g); continue; }
      if (m.id in liveY) { hold(op, 'yield', m.id, 'already-yielded', 'the game\'s own rate stands'); continue; }
      /* A tile that BUYS an id down a PDF lane and also lists it as a product is a
         reseller (the Gas Station retails the Oil Company's diesel). Paying it out as
         a yield would mint the good from nothing; the honest overlay is the INPUT:
         the station uses the drums up and its Cinder rate is the sale. */
      if ((rec.buys || []).some((l) => l && (l.ids || []).includes(m.id))) { hold(op, 'yield', m.id, 'resale-not-production', 'bought down a map lane and sold on; it stays an input'); continue; }
      // A vehicle ITEM standing in for a resource id (recipes.md 14): paying it
      // out as a stackable resource would invent a second kind of car.
      const lanesOut = [];
      for (const b of Object.keys(recipes)) for (const l of ((recipes[b] && recipes[b].buys) || [])) if (l && l.from === op && l.cargoIsItem && (l.ids || []).includes(m.id)) lanesOut.push(b);
      if (lanesOut.length) { hold(op, 'yield', m.id, 'cargo-is-an-item', 'vehicles are items, not a stackable resource'); continue; }
      if (isService && !o.serviceYields) {
        hold(op, 'yield', m.id, 'service-op-has-no-yields', 'its table row says yields:{} on purpose — a yield would switch market and terroir pricing on for its Cinder income');
        continue;
      }
      (yieldPlan[op] || (yieldPlan[op] = [])).push({ id: m.id, why: m.why || '' });
      (overlayMakers[m.id] || (overlayMakers[m.id] = [])).push(op);
    }
  }
  const refOf = {}; for (const op of ops) refOf[op] = referenceFor(econ(op), allRows, order);
  const yieldRate = (op) => roundTo((tiers.support || 0) * refOf[op].value, decimals);

  /* ── pass 2: per op, WHICH inputs get a slot. Identical in every stage (a stage
        only filters what is EMITTED), so stages nest and the per-op / per-id
        divisors used for sizing in pass 3 never move between stages. ── */
  const alloc = {};           // op -> [{id, role, why, tier, supply, row}]
  for (const op of ops) {
    const row = econ(op); const rec = recipes[op] || {};
    const liveIn = isObj(row.inputs) ? row.inputs : {};
    const liveY = isObj(row.yields) ? row.yields : {};

    /* candidates: PDF-lane cargo first, then coverage input, then upkeep */
    const cand = []; const seen = new Set();
    const push = (id, role, why) => { if (!id || seen.has(id)) return; seen.add(id); cand.push({ id, role, why: why || '' }); };
    for (const lane of (rec.buys || [])) {
      if (!lane) continue;
      const liveIds = new Set(lane.liveIds || []);
      for (const id of (lane.ids || [])) if (!liveIds.has(id)) push(id, 'lane', lane.why);
    }
    const needs = needsOf(op).filter((n) => n && !n.live);
    for (const role of ['input', 'upkeep']) for (const n of needs) if (n.role === role) push(n.id, role, n.why);

    /* Returns the supply when the id may be an input of `op`, else holds it. */
    const admit = (c) => {
      const g = gate(c.id); if (g) { hold(op, 'input', c.id, g); return null; }
      if (c.id in liveIn) { hold(op, 'input', c.id, 'already-consumed', 'the game\'s own rate stands (neverTouchExisting)'); return null; }
      if (c.id in liveY || (yieldPlan[op] || []).some((y) => y.id === c.id)) { hold(op, 'input', c.id, 'op-makes-this-itself', 'consuming your own product is a loop, not a need'); return null; }
      const supply = supplyOf(c.id, op, overlayMakers);
      const bad = UNDEPENDABLE[supply.kind];
      if (bad && !allow[supply.kind]) { hold(op, 'input', c.id, bad[0], bad[1]); return null; }
      const lootSized = supply.kind !== 'madeLive' && supply.kind !== 'madeByOverlay';
      if (lootSized && !perHaul) { hold(op, 'input', c.id, 'no-drop-measurement', 'no measured drop flux was supplied, so a feedable rate cannot be worked out'); return null; }
      /* Too thin even if it were this business's ONLY loot input: do not let it take a slot. */
      if (lootSized && !(floorTo((G.haulsPerWindow / G.windowHours) * haulUnits(c.id, supply.kind).v / workers(op), G.decimals) > 0)) {
        hold(op, 'input', c.id, 'source-too-thin', 'the drop is too rare to feed a business of this size at any rate above zero'); return null;
      }
      return supply;
    };

    const eligible = [];
    for (const c of cand) { const s = admit(c); if (s) eligible.push(Object.assign({}, c, { supply: s, row: cat(c.id) })); }

    /* "ALL businesses need battle loot": borrow from the minigame roles when short. */
    const isLoot = (e) => e.supply.kind === 'aimedLoot' || e.supply.kind === 'stapleLoot' || (e.supply.kind === 'madeLive' && e.supply.alsoLoot);
    let short = Math.max(0, (G.minLootNeedsPerOp | 0) - eligible.filter(isLoot).length);
    const borrowable = needs.filter((n) => NOT_FEEDSTOCK[n.role] && !seen.has(n.id));
    if (short > 0) {
      const ranked = borrowable.map((n) => ({ n, s: supplyOf(n.id, op, overlayMakers) }))
        .filter((x) => x.s.kind === 'aimedLoot' || x.s.kind === 'stapleLoot')
        .sort((a, b) => (haulUnits(b.n.id).v - haulUnits(a.n.id).v));
      let taken = 0;
      for (const x of ranked) {
        if (taken >= Math.min(short, G.promoteMax | 0)) break;
        const c = { id: x.n.id, role: 'promoted', why: x.n.why || '' };
        seen.add(c.id);
        const s = admit(c); if (!s) continue;
        eligible.push(Object.assign({}, c, { supply: s, row: cat(c.id), wasRole: x.n.role })); taken++;
      }
    }
    for (const n of borrowable) if (!seen.has(n.id)) { seen.add(n.id); hold(op, 'input', n.id, 'needs-minigame-wiring', 'role ' + n.role + ' is a recipe / upgrade / resale desk, not a per-worker-hour feedstock'); }

    /* The owner's sentence is "all businesses need battle loot", and stage 2 is where we say it
       becomes true. A business whose only aimable loot sits in the upkeep role would not get it
       until stage 3, so its best upkeep loot row is lifted into the input role. */
    if (!eligible.some((e) => isLoot(e) && e.role !== 'upkeep')) {
      const up = eligible.filter((e) => isLoot(e) && e.role === 'upkeep').sort((a, b) => haulUnits(b.id, b.supply.kind).v - haulUnits(a.id, a.supply.kind).v)[0];
      if (up) { up.wasRole = 'upkeep'; up.role = 'input'; up.lifted = true; }
    }
    /* …and when no LANE cargo is aimable loot, the best input-role loot row goes first too. */
    if (!eligible.some((e) => isLoot(e) && (e.role === 'lane' || e.lifted || e.role === 'promoted'))) {
      const first = eligible.filter((e) => isLoot(e) && e.role === 'input').sort((a, b) => haulUnits(b.id, b.supply.kind).v - haulUnits(a.id, a.supply.kind).v)[0];
      if (first) first.lifted = true;
    }

    /* Inside a role, the most dependable and most visible ids come first. Stable
       otherwise, so the overlay is identical on every run (a critic diffs it). */
    const rank = (e) => (e.lifted ? -10 : 0) + (KIND_RANK[e.supply.kind] || 0) * 2 + (e.row && e.row.inLedger ? 0 : 1);
    const used = { core: 0, support: 0, trace: 0 }; let usedMini = 0;
    const mine = alloc[op] = [];
    /* The one guaranteed battle-loot need (lifted or promoted) claims its support slot BEFORE lane
       overflow can cascade into that tier — otherwise the Car Factory's third lane cargo took it. */
    const passes = [(x) => x.lifted || x.role === 'promoted', (x) => x.role === 'lane', (x) => x.role === 'input' && !x.lifted, (x) => x.role === 'upkeep'];
    for (const pick of passes) {
      for (const e of eligible.filter(pick).sort((a, b) => rank(a) - rank(b))) {
        const role = e.role;
        /* Overflow cascades DOWN a tier (a third lane cargo becomes support),
           never up: a cap exists to bound how hard the throttle can bite. */
        if (e.supply.kind === 'madeInMinigame' && !G.allowUnmeasuredMakers && !miniRate(e.id)) { hold(op, 'input', e.id, 'maker-not-measured', 'lootGate.allowUnmeasuredMakers'); continue; }
        if (e.supply.kind === 'madeInMinigame' && usedMini >= (G.maxMinigameInputsPerOp | 0)) { hold(op, 'input', e.id, 'over-the-minigame-cap', 'lootGate.maxMinigameInputsPerOp'); continue; }
        let ti = TIER_ORDER.indexOf(ROLE_TIER[role] || 'support'); let tier = null;
        for (; ti < TIER_ORDER.length; ti++) {
          const t = TIER_ORDER[ti];
          if (typeof tiers[t] === 'number' && used[t] < (caps[t] | 0)) { tier = t; break; }
        }
        if (!tier) { hold(op, 'input', e.id, 'over-the-per-op-cap', 'SC.proposal.maxInputsPerOp'); continue; }
        used[tier]++; if (e.supply.kind === 'madeInMinigame') usedMini++;
        mine.push(Object.assign({}, e, { tier }));
      }
    }
  }

  /* ── pass 3: size. Divisors come from the allocation, never from the stage. ── */
  const lootSizedKind = (k) => k !== 'madeLive' && k !== 'madeByOverlay';
  const nLoot = {}; const nMade = {}; const nMini = {};
  for (const op of ops) for (const e of alloc[op]) {
    if (lootSizedKind(e.supply.kind) || e.supply.alsoLoot) nLoot[op] = (nLoot[op] || 0) + 1;
    if (!lootSizedKind(e.supply.kind)) nMade[e.id] = (nMade[e.id] || 0) + 1;
    if (e.supply.kind === 'madeInMinigame') nMini[e.id] = (nMini[e.id] || 0) + 1;
  }
  /* hourly supply of a business-made id, and what live rows already draw from it */
  const madeSupply = (id, kind) => {
    let s = 0;
    for (const b of allOps) { const y = +(((econ(b) || {}).yields || {})[id]); if (y > 0) s += y * workers(b); }
    if (kind === 'madeByOverlay') for (const b of (overlayMakers[id] || [])) s += yieldRate(b) * workers(b);
    return s;
  };
  const liveDemand = (id) => { let d = 0; for (const b of allOps) { const v = +(((econ(b) || {}).inputs || {})[id]); if (v > 0) d += v * workers(b); } return d; };
  const madeBalance = {}; const r_made = {};

  for (const op of ops) {
    const ref = refOf[op]; const W = workers(op);
    const out = { inputs: {}, yields: {} };
    for (const e of alloc[op]) {
      if (!wantTiers.has(e.tier)) { hold(op, 'input', e.id, 'stage-excludes-tier', e.tier); continue; }
      if (o.ledgerOnly && !(e.row && e.row.inLedger)) { hold(op, 'input', e.id, 'stage-ledger-only'); continue; }
      const want = tiers[e.tier] * ref.value;
      if (!(want > 0)) { hold(op, 'input', e.id, 'rate-rounds-to-zero', 'no reference rate on the live row'); continue; }
      let cap = 0; const parts = {};
      if (lootSizedKind(e.supply.kind) || e.supply.alsoLoot) {
        const h = haulUnits(e.id, e.supply.kind);
        parts.lootPerWorkerHr = (G.haulsPerWindow / G.windowHours) / Math.max(1, nLoot[op] || 1) * h.v / W;
        parts.fluxFrom = h.from; parts.unitsPerHaul = h.v;
        cap += parts.lootPerWorkerHr;
        /* ROUND 3. A farm good was sized ONLY by the thinnest ruin drop — a number that has
           nothing to do with farming (critic). Where the farm's own rate table was read
           (flux.minigame), all new buyers of the good together may lean on madeShare of
           `minigameUnits` animals' output, and the smaller of the two caps wins. Goods with no
           readable table (the Cracking Yard's diesel / naphtha) keep the floor and say so. */
        const mr = e.supply.kind === 'madeInMinigame' ? miniRate(e.id) : null;
        if (mr) {
          parts.minigamePerWorkerHr = G.madeShare * G.minigameUnits * mr.perUnitHour / Math.max(1, nMini[e.id] || 1) / W;
          parts.makerUnit = mr.unit; parts.makerUnitPerHour = mr.perUnitHour;
          if (parts.minigamePerWorkerHr < cap) { cap = parts.minigamePerWorkerHr; parts.minigameBinds = true; }
        } else if (e.supply.kind === 'madeInMinigame') parts.makerUnmeasured = true;
      }
      if (!lootSizedKind(e.supply.kind)) {
        const supply = madeSupply(e.id, e.supply.kind); const drawn = liveDemand(e.id);
        const spare = Math.max(0, supply - drawn);
        parts.madePerWorkerHr = G.madeShare * spare / Math.max(1, nMade[e.id] || 1) / W;
        cap += parts.madePerWorkerHr;
        if (!madeBalance[e.id]) (madeBalance[e.id] = { id: e.id, supplyPerHr: supply, liveDemandPerHr: drawn, sparePerHr: spare, newDemandPerHr: 0, consumers: [] });
      }
      const capped = cap < want;
      const rate = capped ? floorTo(cap, G.decimals) : roundTo(want, decimals);
      if (!(rate > 0)) { hold(op, 'input', e.id, 'source-too-thin', capped ? 'what the world can deliver, split across this business\'s needs, rounds to nothing' : ''); continue; }
      out.inputs[e.id] = rate;
      const perWindow = rate * W * G.windowHours;
      /* "hauls" only means something for a thing that drops; a farm product or a shelf item is not salvaged */
      const dropsKind = e.supply.kind === 'aimedLoot' || e.supply.kind === 'stapleLoot' || e.supply.kind === 'lotteryOnly';
      const hauls = parts.unitsPerHaul > 0 && dropsKind ? perWindow / parts.unitsPerHaul : 0;
      /* only the share of the rate that leans on the MAKERS counts against them; the rest is loot */
      const madeLean = parts.madePerWorkerHr != null && cap > 0 ? Math.min(rate, rate * parts.madePerWorkerHr / cap) : 0;
      if (madeBalance[e.id] && !lootSizedKind(e.supply.kind)) { madeBalance[e.id].newDemandPerHr += madeLean * W; madeBalance[e.id].consumers.push(op); r_made[op + '|' + e.id] = madeLean; }
      rows.push({ op, kind: 'input', id: e.id, tier: e.tier, rate, want: roundTo(want, G.decimals), cap: roundTo(cap, G.decimals + 1),
        /* how many of the maker's units (animals) this need keeps busy; null = nobody measured the maker */
        makerUnit: parts.makerUnit || null, makerUnitsNeeded: parts.makerUnitPerHour ? roundTo(rate * W / parts.makerUnitPerHour, 2) : null, makerUnmeasured: !!parts.makerUnmeasured,
        cappedBy: capped ? (parts.minigameBinds ? 'maker-unit-output' : parts.madePerWorkerHr == null ? 'drop-flux' : parts.lootPerWorkerHr == null ? 'makers-output' : 'makers-and-drops') : null,
        fluxFrom: parts.fluxFrom || null, unitsPerWindow: roundTo(perWindow, 1), haulsPerWindow: roundTo(hauls, 1),
        reference: ref.value, referenceFrom: ref.from, supply: e.supply, role: e.role, wasRole: e.wasRole || null, why: e.why });
    }

    /* ── yields: a proposed product is a BY-PRODUCT beside the op's real one,
          so it takes the support tier of the op's own scale, never core. ── */
    for (const y of (yieldPlan[op] || [])) {
      /* Planned in every stage (pass 1) so input sourcing and tier slots never differ
         between stages; a stage only decides whether the yield is EMITTED. */
      if (o.yields === false) { hold(op, 'yield', y.id, 'stage-excludes-yields'); continue; }
      const rate = yieldRate(op);
      if (!(rate > 0)) { hold(op, 'yield', y.id, 'rate-rounds-to-zero'); continue; }
      out.yields[y.id] = rate;
      rows.push({ op, kind: 'yield', id: y.id, tier: 'support', rate, reference: ref.value, referenceFrom: ref.from, supply: null, role: 'make', why: y.why });
    }

    if (!Object.keys(out.inputs).length) delete out.inputs;
    if (!Object.keys(out.yields).length) delete out.yields;
    if (Object.keys(out).length) overlay[op] = out;
  }

  /* An input whose ONLY source was another op's overlay yield must not survive
     a stage that dropped that yield — the business would be starved by design. */
  for (const op of Object.keys(overlay)) {
    const ins = overlay[op].inputs || {};
    for (const id of Object.keys(ins)) {
      const r = rows.find((x) => x.op === op && x.kind === 'input' && x.id === id);
      if (!r || r.supply.kind !== 'madeByOverlay') continue;
      const stillMade = r.supply.by.some((b) => overlay[b] && overlay[b].yields && id in overlay[b].yields);
      if (stillMade) continue;
      if (madeBalance[id]) { madeBalance[id].newDemandPerHr -= (r_made[op + '|' + id] || 0) * workers(op); madeBalance[id].consumers = madeBalance[id].consumers.filter((c) => c !== op); }
      delete ins[id]; rows.splice(rows.indexOf(r), 1);
      hold(op, 'input', id, 'its-maker-is-not-in-this-overlay');
    }
    if (overlay[op].inputs && !Object.keys(overlay[op].inputs).length) delete overlay[op].inputs;
    if (!Object.keys(overlay[op]).length) delete overlay[op];
  }

  /* ── the split the owner needs to see, per business ── */
  const perBattle = flux && isObj(flux.perBattleRuins) ? flux.perBattleRuins : null;
  const ruinsPerBattle = flux && +flux.ruinsPerBattle > 0 ? +flux.ruinsPerBattle : 0;
  const battles = (mine) => {
    let together = 0, ruinHauls = 0, bodies = 0, other = 0;
    for (const r of mine) {
      if (!(r.haulsPerWindow > 0)) continue;
      const fromRuin = flux && isObj(flux.from) && flux.from[r.id] === 'ruin';
      /* sized at the floor = aimable through something nobody could roll (a roguelite haul, a
         territory node, a fishing trip): neither a ruin nor a body, so it is its own column */
      if (r.fluxFrom === 'floor') other += r.haulsPerWindow;
      else if (fromRuin && perBattle && perBattle[r.id] > 0) { together = Math.max(together, r.unitsPerWindow / perBattle[r.id]); ruinHauls += r.haulsPerWindow; }
      else bodies += r.haulsPerWindow;
    }
    const queued = ruinsPerBattle ? roundTo(ruinHauls / ruinsPerBattle, 1) : null;
    return { together: perBattle ? Math.min(roundTo(together, 1), queued == null ? Infinity : queued) : null, queued, bodies: roundTo(bodies, 1), other: roundTo(other, 1) };
  };
  /* ROUND 4. The memo's headline said appetites are "stated in battles" while every line of the
     business-by-business list still read "about 35.7 salvage hauls" — a unit no player has ever
     seen. Each loot-sized row now carries its effort in the unit a player plays in:
       ruin    battles fully looted (a battle seats one ruin of each kind, flux.ruinsPerBattle)
       body    enemy bodies looted
       other   trips through something the script cannot roll (roguelite / territory / fishing),
               sized at the floor — a stand-in and said to be one
     Lines of ONE business overlap (the same battle feeds several ruin needs), so these do not add
     up; the per-business total is stats.perOp[op].battlesPerWindow. */
  for (const r of rows) {
    if (r.kind !== 'input' || !(r.haulsPerWindow > 0)) continue;
    const fromRuin = flux && isObj(flux.from) && flux.from[r.id] === 'ruin';
    if (r.fluxFrom === 'floor') r.effort = { unit: 'other', n: r.haulsPerWindow };
    else if (fromRuin && perBattle && perBattle[r.id] > 0) r.effort = { unit: 'battles', n: roundTo(r.unitsPerWindow / perBattle[r.id], 1) };
    else r.effort = { unit: 'bodies', n: r.haulsPerWindow };
  }
  const inputRows = rows.filter((r) => r.kind === 'input');
  const isAim = (r) => r.supply && (r.supply.kind === 'aimedLoot' || r.supply.kind === 'stapleLoot' || (r.supply.kind === 'madeLive' && r.supply.alsoLoot));
  const perOp = {};
  for (const op of ops) {
    const mine = inputRows.filter((r) => r.op === op);
    const held = withheld.filter((w) => w.op === op && w.kind === 'input');
    perOp[op] = {
      newInputs: mine.length,
      aimableLoot: mine.filter(isAim).length,
      madeByBusiness: mine.filter((r) => r.supply.kind === 'madeLive' || r.supply.kind === 'madeByOverlay').length,
      madeInMinigame: mine.filter((r) => r.supply.kind === 'madeInMinigame').length,
      traderShelfKept: mine.filter((r) => r.supply.kind === 'traderShelf').length,
      lotteryKept: mine.filter((r) => r.supply.kind === 'lotteryOnly').length,
      traderShelfWithheld: held.filter((w) => w.reason === 'trader-shelf-only').length,
      lotteryWithheld: held.filter((w) => w.reason === 'lottery-only').length,
      tooThinWithheld: held.filter((w) => w.reason === 'source-too-thin').length,
      promoted: mine.filter((r) => r.role === 'promoted').map((r) => r.id),
      haulsPerWindow: roundTo(mine.reduce((s, r) => s + (r.haulsPerWindow || 0), 0), 1),
      /* IN BATTLES (round 3). A haul is an abstract unit; the owner thinks in battles. A battle
         seats one ruin of every kind, so ruin needs are fed TOGETHER: the battles a business
         needs is set by its hungriest ruin item, not by the sum. `battlesIfQueued` is the
         pessimistic reading (every haul a separate trip). Bodies are counted apart because
         nothing in the game fixes how many bodies a battle leaves. */
      battlesPerWindow: battles(mine).together,
      battlesIfQueued: battles(mine).queued,
      bodiesPerWindow: battles(mine).bodies,
      otherTripsPerWindow: battles(mine).other,
      minigameUnmeasured: mine.filter((r) => r.makerUnmeasured).map((r) => r.id),
    };
  }
  const balance = Object.keys(madeBalance).map((id) => { const m = madeBalance[id]; m.newDemandPerHr = roundTo(m.newDemandPerHr, 3); return m; }).filter((m) => m.consumers.length);
  const stats = {
    ops: ops.length,
    opsTouched: Object.keys(overlay).length,
    opsWithNewInputs: new Set(inputRows.map((r) => r.op)).size,
    opsWithAimableLoot: Object.keys(perOp).filter((op) => perOp[op].aimableLoot > 0).length,
    opsWithoutAimableLoot: Object.keys(perOp).filter((op) => !perOp[op].aimableLoot),
    newInputs: inputRows.length,
    newYields: rows.length - inputRows.length,
    distinctResources: new Set(rows.map((r) => r.id)).size,
    aimableLootInputs: inputRows.filter(isAim).length,
    madeInputs: inputRows.filter((r) => r.supply.kind === 'madeLive' || r.supply.kind === 'madeByOverlay').length,
    minigameInputs: inputRows.filter((r) => r.supply.kind === 'madeInMinigame').length,
    traderShelfInputs: inputRows.filter((r) => r.supply.kind === 'traderShelf').length,
    lotteryInputs: inputRows.filter((r) => r.supply.kind === 'lotteryOnly').length,
    cappedByFlux: inputRows.filter((r) => r.cappedBy === 'drop-flux').length,
    cappedByMakers: inputRows.filter((r) => r.cappedBy === 'makers-output' || r.cappedBy === 'makers-and-drops').length,
    withheld: withheld.length,
    fluxSupplied: !!perHaul, fluxShipped: !!perHaul && flux === SHIPPED_FLUX, fluxFloor, ruinsPerBattle,
    battlesBudgetIfQueued: ruinsPerBattle ? roundTo(G.haulsPerWindow / ruinsPerBattle, 1) : null, lootDataSupplied: !!(data && data.loot && typeof data.loot.sourcesFor === 'function'),
    lootGate: G,
    perOp, madeBalance: balance,
    enabledByDefault: !!P.enabledByDefault,
  };
  return { overlay, rows, withheld, stats };
}

/**
 * CONTRACT EXPORT. -> {[opId]:{inputs?,yields?}} and nothing else, so the result
 * can be handed to the admin override as-is.
 *   liveOpEcon  the bridge's opEcon function, a {opId:row} map, or the Node fixture.
 *               May be omitted (the contract's two-argument form) when the caller
 *               put it on `data.opEcon` / `data.fixture`.
 *   opts        see explainOverlay. 🔴 Without `opts.flux` (or data.flux) NO battle-loot
 *               input is emitted — only business-made ones. That is deliberate.
 */
export function buildOpsEconOverlay(data, SC, liveOpEcon, opts) {
  return explainOverlay(data, SC, liveOpEcon, opts).overlay;
}

/**
 * A rollout the owner can stop at any step. Each stage CONTAINS the one before
 * it at the SAME rates (slots and sizing divisors are fixed before any stage
 * filter is applied), so moving on never removes or resizes an input players
 * have already stocked for.
 */
export function stagedOverlays(data, SC, liveOpEcon, opts) {
  const base = opts || {};
  /* The tier list of each stage is DERIVED as a growing prefix of TIER_ORDER rather
     than typed out per stage. Two reasons: the "each stage contains the one before
     it" promise in this docblock is then structurally true instead of something a
     reader has to verify by eye, and adding a fourth tier one day needs no edit here.
     It also keeps the staging free of typed tier arrays, which a literal scan for
     knob values cannot tell apart from `SC.proposal.tiers` (same name, different
     meaning: here it SELECTS tiers, in tuning it SIZES them). */
  const S = [
    { n: 1, title: 'Map lanes only, from the stash players already see',
      plain: 'Only the cargo you drew on the PDF, and only resources that already sit in the normal stash. The gentlest possible start.',
      opts: { ledgerOnly: true } },
    { n: 2, title: 'Map lanes + main battle-loot needs',
      plain: 'Adds each business\'s main battle-loot needs — only loot a player can go and aim for. This is where "every business needs loot" becomes true.',
      opts: {} },
    { n: 3, title: 'The long tail',
      plain: 'Adds small upkeep items so more resources are used up by something.',
      opts: {} },
    { n: 4, title: 'New products',
      plain: 'Businesses start making the new goods (stone, diesel, concrete…). Last, because a new product changes the mix the market prices that business on, so its Cinder income on the player\'s screen can move (the measured range is in the decision memo).',
      opts: {} },
  ];
  return S.map((s) => {
    /* stage n opens tiers 1..n, and stops widening once every tier is in — stage 4
       differs from stage 3 only by switching the proposed products on. */
    const tiers = TIER_ORDER.slice(0, Math.min(s.n, TIER_ORDER.length));
    const ex = explainOverlay(data, SC, liveOpEcon, Object.assign({}, base, { tiers, yields: s.n === 4 }, s.opts));
    return { n: s.n, title: s.title, plain: s.plain, overlay: ex.overlay, stats: ex.stats };
  });
}

/**
 * Rows for the two businesses on the owner's map that do not exist. Every
 * owner-priced field is an explicit null, and so is every rate: a business with
 * no live row has no scale of its own to be relative TO, and inventing one
 * would be inventing a price. `tier` says how big we would make it once the
 * owner has set the row. These rows are INERT as overrides (see header).
 */
export function newOpRows(data) {
  const recipes = recipesOf(data);
  const needsOf = needsReader(data);
  const cat = catalogReader(data);
  const phantoms = phantomSet(data);
  const B = data && data.businesses && (data.businesses.BUSINESSES || data.businesses);
  const planned = Array.isArray(B) && B.some((b) => b && b.status === 'planned')
    ? B.filter((b) => b && b.status === 'planned').map((b) => ({ id: b.id, label: b.label || b.pdfLabel || b.id }))
    : Object.keys(recipes).filter((k) => recipes[k] && recipes[k].planned).map((k) => ({ id: k, label: k }));
  /* With a catalogue, only ids a stash can hold; without one (a bare mutant run) only the phantom check applies. */
  const hasCat = !!(data && data.catalog);
  const ok = (id) => !phantoms.has(id) && (!hasCat || !!(cat(id) && cat(id).inLoot));
  const out = {};
  for (const p of planned) {
    const rec = recipes[p.id] || {};
    const row = {}; for (const f of OWNER_PRICED_FIELDS) row[f] = null;
    row.yields = {}; row.inputs = {};
    const tiers = { yields: {}, inputs: {} }; const notes = [];
    for (const m of (rec.makes || [])) if (m && ok(m.id)) { row.yields[m.id] = null; tiers.yields[m.id] = 'core'; }
    for (const n of needsOf(p.id)) {
      if (!n || n.live || !ok(n.id) || n.id in row.yields) continue;
      if (NOT_FEEDSTOCK[n.role]) { notes.push(n.id + ': ' + n.role + ' (minigame, not a feedstock)'); continue; }
      row.inputs[n.id] = null; tiers.inputs[n.id] = ROLE_TIER[n.role] || 'trace';
    }
    out[p.id] = {
      id: p.id, label: p.label, status: 'planned', row, tiers, minigameNeeds: notes,
      service: rec.service || null, why: rec.planned || '',
      checklist: NEW_OP_CHECKLIST.slice(),
      ownerMustSet: OWNER_PRICED_FIELDS.slice(),
    };
  }
  return out;
}

/* The bookkeeping key mergeIntoOverrides() leaves inside the override map: the
   list of lines THIS overlay added. It is not an op id, so `_opEcon` returns
   null for it and the admin editor (which walks OPS_ECON ids) never sees it;
   it survives SAVE and publish because nothing strips unknown keys. It exists
   so "switch it back off" works after a retune — see REJECTED DESIGNS. */
export const OVERLAY_MARKER = '__supplyChainOverlay';

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Merge an overlay INTO whatever the admin has already overridden.
 * 🔴 getOpsEconOverrides() returns the LOCAL map if it has any key, else the
 * PUBLISHED one — never both. Pasting a bare overlay over an existing override
 * map would therefore DELETE every retune the owner has made. This keeps them:
 * existing fields win, and an id the admin already set keeps the admin's rate
 * AND stays the admin's (it is not recorded, so removal will not touch it).
 */
export function mergeIntoOverrides(existing, overlay) {
  const out = {};
  const ex = isObj(existing) ? existing : {};
  for (const k of Object.keys(ex)) out[k] = isObj(ex[k]) ? clone(ex[k]) : ex[k];
  const prev = isObj(out[OVERLAY_MARKER]) && isObj(out[OVERLAY_MARKER].lines) ? out[OVERLAY_MARKER].lines : {};
  const lines = clone(prev);
  for (const op of Object.keys(overlay || {})) {
    if (op === OVERLAY_MARKER) continue;
    const cur = isObj(out[op]) ? out[op] : (out[op] = {});
    for (const key of OVERLAY_KEYS) {
      const add = overlay[op] && overlay[op][key];
      if (!isObj(add) || !Object.keys(add).length) continue;
      const had = isObj(cur[key]) ? cur[key] : {};
      const mineBefore = new Set(((prev[op] || {})[key]) || []);
      const next = Object.assign({}, had);
      for (const id of Object.keys(add)) {
        if (id in had && !mineBefore.has(id)) continue;          // the admin's own line: theirs, untouched, unrecorded
        next[id] = add[id];
        const rec = (lines[op] || (lines[op] = {}));
        if (!(rec[key] || (rec[key] = [])).includes(id)) rec[key].push(id);
      }
      cur[key] = next;
    }
    if (!Object.keys(cur).length) delete out[op];
  }
  if (Object.keys(lines).length) out[OVERLAY_MARKER] = { v: 1, what: 'Supply Chain proposal overlay — lines added by it, so they can be removed again', lines };
  return out;
}

/**
 * "Switch it back off": removes exactly the lines a previous mergeIntoOverrides()
 * RECORDED, whatever their rate is now (the table may have been retuned, or the
 * admin may have edited one of our lines — it is still ours). Admin-owned lines
 * were never recorded, so they stay even when their rate equals ours.
 *   No record in `existing` (someone pasted a bare overlay by hand)? Then, and only
 *   then, fall back to the ids of the `overlay` argument — by id, never by rate.
 */
export function removeFromOverrides(existing, overlay) {
  const out = {};
  const ex = isObj(existing) ? existing : {};
  for (const k of Object.keys(ex)) out[k] = isObj(ex[k]) ? clone(ex[k]) : ex[k];
  let lines = isObj(out[OVERLAY_MARKER]) && isObj(out[OVERLAY_MARKER].lines) ? out[OVERLAY_MARKER].lines : null;
  if (!lines) {
    lines = {};
    for (const op of Object.keys(overlay || {})) for (const key of OVERLAY_KEYS) {
      const add = overlay[op] && overlay[op][key];
      if (isObj(add)) (lines[op] || (lines[op] = {}))[key] = Object.keys(add);
    }
  }
  delete out[OVERLAY_MARKER];
  for (const op of Object.keys(lines)) {
    if (!isObj(out[op])) continue;
    for (const key of OVERLAY_KEYS) {
      const ids = lines[op][key]; const cur = out[op][key];
      if (!Array.isArray(ids) || !isObj(cur)) continue;
      for (const id of ids) delete cur[id];
      if (!Object.keys(cur).length) delete out[op][key];
    }
    if (!Object.keys(out[op]).length) delete out[op];
  }
  return out;
}

/**
 * Independent re-check of ANY overlay (ours, a stage, or one an admin edited by
 * hand) against the live rows. -> { ok, errors:[string] }. The audit piece and
 * the admin copy action should both refuse an overlay that fails this.
 * With `data.loot` injected it also refuses any input whose best source is a
 * trader shelf or the any-item lottery (unless opts.allowTraderShelf /
 * opts.allowLottery) — the check that would have caught round 1.
 */
export function validateOverlay(overlay, data, liveOpEcon, opts) {
  const errors = [];
  const econ = econReader(liveOpEcon, data);
  const cat = catalogReader(data);
  const phantoms = phantomSet(data);
  const o = opts || {};
  const salvage = Array.isArray(o.salvageIds) && o.salvageIds.length ? new Set(o.salvageIds.map((x) => (typeof x === 'string' ? x : x && x.id))) : null;
  if (!isObj(overlay)) return { ok: false, errors: ['overlay is not an object'] };
  const hasLoot = !!(data && data.loot && typeof data.loot.sourcesFor === 'function');
  const allOps = opIdsOf(data, liveOpEcon, econ);
  /* Without opts.SC the sourcing check still runs: a null accept list makes makeSourcing fall back to
     loot.js's own via -> kind table (a category list, not a number), which is the stricter reading. */
  const gate = lootGateOf(o.SC || null);
  const supplyOf = hasLoot ? makeSourcing(data, econ, allOps, o, gate ? gate.accept : null) : null;
  const makers = {};
  for (const op of Object.keys(overlay)) if (op !== OVERLAY_MARKER && isObj(overlay[op]) && isObj(overlay[op].yields)) for (const id of Object.keys(overlay[op].yields)) (makers[id] || (makers[id] = [])).push(op);
  const allow = { traderShelf: !!o.allowTraderShelf, lotteryOnly: !!(o.allowLottery || o.allowRareRoll) };
  for (const op of Object.keys(overlay)) {
    if (op === OVERLAY_MARKER) continue;                         // bookkeeping, inert in the game
    const live = econ(op);
    if (!live) { errors.push(op + ': not a live operation — _opEcon returns null for it, the row would be ignored'); continue; }
    const row = overlay[op];
    if (!isObj(row)) { errors.push(op + ': row is not an object'); continue; }
    for (const k of Object.keys(row)) if (!OVERLAY_KEYS.includes(k)) errors.push(op + '.' + k + ': only inputs / yields may be overlaid (this key would reprice the business)');
    for (const key of OVERLAY_KEYS) {
      const m = row[key]; if (m == null) continue;
      if (!isObj(m)) { errors.push(op + '.' + key + ': not a map'); continue; }
      for (const id of Object.keys(m)) {
        const v = m[id];
        if (typeof v !== 'number' || !isFinite(v) || v <= 0) errors.push(op + '.' + key + '.' + id + ': rate must be a positive number');
        if (phantoms.has(id)) errors.push(op + '.' + key + '.' + id + ': phantom id (no catalogue row)');
        const inSalv = salvage ? salvage.has(id) : !!(cat(id) && cat(id).inLoot);
        if (!inSalv) errors.push(op + '.' + key + '.' + id + ': not in SALVAGE_RES — ' + (key === 'inputs' ? 'reads as held 0 and ZEROES the business' : 'addSalvage would silently drop the payout'));
        if (isObj(live[key]) && id in live[key]) errors.push(op + '.' + key + '.' + id + ': the game already sets this rate; the overlay must not touch it');
        if (key === 'inputs' && supplyOf) {
          const s = supplyOf(id, op, makers); const bad = UNDEPENDABLE[s.kind];
          if (bad && !allow[s.kind]) errors.push(op + '.inputs.' + id + ': ' + bad[0] + ' — ' + bad[1]);
        }
      }
    }
    const ins = isObj(row.inputs) ? row.inputs : {}; const ys = Object.assign({}, live.yields || {}, row.yields || {});
    for (const id of Object.keys(ins)) if (id in ys) errors.push(op + ': consumes and yields ' + id);
  }
  return { ok: errors.length === 0, errors };
}

/* ── plain language ───────────────────────────────────────────────────────── */

/** 'gunOil' -> 'Gun oil': the best a phantom id can be shown as, since no catalogue row names it. */
function spokenId(id) {
  const words = String(id).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SUPPLY_WORDS = Object.freeze({
  madeLive: 'made today by',
  stapleLoot: 'common loot from any battle or camp mission',
  aimedLoot: 'battle loot you can aim for',
  madeInMinigame: 'made today only by playing the business screen of',
  madeByOverlay: 'would be made by',
  traderShelf: 'only bought from a trader shelf that does not refill',
  lotteryOnly: 'lottery-only: the rare any-item salvage roll',
  unclassified: 'source unknown',
  noSource: 'no source',
});

const REASON_WORDS = Object.freeze({
  'phantom-id': 'is not a real resource in the game',
  'not-in-catalogue': 'is not in the resource catalogue',
  'not-in-SALVAGE_RES': 'cannot be held in a player stash, so a business could never be fed it',
  'already-consumed': 'is already consumed today (left exactly as it is)',
  'already-yielded': 'is already produced today (left exactly as it is)',
  'op-makes-this-itself': 'is something this business makes itself',
  'needs-minigame-wiring': 'is a recipe, upgrade or resale item — needs work inside the business screen, not a switch',
  'lottery-only': 'only drops from the rare any-item salvage roll, which nobody can aim for; requiring it would stall the business',
  'trader-shelf-only': 'can only be bought from a trader whose shelf does not refill; once it is empty the business would stall',
  'source-too-thin': 'drops too rarely to feed a business of this size',
  'no-drop-measurement': 'was left out because no drop-rate measurement was supplied',
  'no-loot-data': 'was left out because no loot table was supplied',
  'no-source': 'has no source at all today',
  'maker-not-measured': 'is only made inside another business screen whose hourly output nobody has measured yet, so any amount we asked for would be a guess',
  'over-the-minigame-cap': 'only exists if somebody plays the screen of another business, and this business already has its limit of those',
  'over-the-per-op-cap': 'did not fit under the per-business limit (kept low on purpose)',
  'service-op-has-no-yields': 'would turn a service business into a goods producer and change how its Cinder income is priced',
  'cargo-is-an-item': 'is a vehicle item, not a stackable resource',
  'resale-not-production': 'is bought in and sold on, not made here; it is kept as something the business uses up instead',
  'rate-rounds-to-zero': 'has no live rate to scale from',
  'its-maker-is-not-in-this-overlay': 'has no maker at this stage',
  'stage-excludes-tier': 'comes in a later stage',
  'stage-excludes-yields': 'comes in the last stage',
  'stage-ledger-only': 'comes in a later stage',
});

/**
 * diffAgainst(fixture, source, SC, opts) -> { lines:[string], perOp:[{op,label,consume,make,split}],
 *                                             untouched:[label], withheldLines:[string], text }
 *   fixture  tools/supplychain/fixture.opsecon.json (or {opsEcon,opLabels}) — "what the game does today"
 *   source   `data` (the overlay is built against the fixture), OR a ready explainOverlay() result,
 *            OR a bare overlay object. The contract's one-argument form works when the caller
 *            put `data`, `SC` and `flux` on the fixture object itself ({…fixture, data, SC, lootFlux}).
 *   opts     as explainOverlay (flux!), plus opts.data for resource names when `source` is not data.
 * Written for a non-programmer: business names, resource names, no ids unless a name is missing.
 */
export function diffAgainst(fixture, source, SC, opts) {
  const fx = isObj(fixture) ? fixture : {};
  if (source == null && isObj(fx.data)) source = fx.data;
  if (SC == null && isObj(fx.SC)) SC = fx.SC;
  const econ = econReader(fx);
  const labels = isObj(fx.opLabels) ? fx.opLabels : {};
  const isData = isObj(source) && (source.recipes || source.coverage);
  const ex = isData ? explainOverlay(source, SC, fx, opts)
    : (isObj(source) && isObj(source.overlay) ? source : { overlay: isObj(source) ? source : {}, rows: [], withheld: [] });
  const cat = catalogReader(isData ? source : (opts && opts.data) || null);
  const B = isData && source.businesses && (source.businesses.BUSINESSES || source.businesses);
  const bizLabel = (op) => labels[op] || ((Array.isArray(B) ? B.find((b) => b && b.id === op) : null) || {}).label || op;
  const phantoms = isData ? phantomSet(source) : phantomSet((opts && opts.data) || null);
  /* An id with no catalogue row is a PHANTOM (the game names it, nothing defines it). The owner
     should read that fact, not a code name — round 4's memo leaked "gunOil" into the unchanged line. */
  const resName = (id) => { const r = cat(id); if (r && r.name) return r.name; return phantoms.has(id) ? spokenId(id) + ' (a name the game uses but never defines — a phantom, see decisions/coverage.md)' : id; };
  const G = lootGateOf(SC);
  if (!G) {
    const problems = lootGateProblems(SC);
    return { lines: ['Nothing is proposed: ' + problems.join(' ')], perOp: [], untouched: [], withheldLines: [], stats: ex.stats || null, text: 'Nothing is proposed: ' + problems.join(' ') };
  }

  const lines = []; const perOp = [];
  const allOps = (isObj(fx.opsEcon) ? Object.keys(fx.opsEcon) : Object.keys(ex.overlay)).filter((op) => op !== OVERLAY_MARKER);
  for (const op of allOps) {
    const ov = ex.overlay[op]; if (!ov) continue;
    const live = econ(op) || {};
    const cap = +live.maxWorkers > 0 ? +live.maxWorkers : 0;   // read for a plain "per window, fully staffed" figure only; never emitted
    const describe = (key) => Object.keys(ov[key] || {}).map((id) => {
      const rate = ov[key][id];
      const r = ex.rows.find((x) => x.op === op && x.id === id && x.kind === (key === 'inputs' ? 'input' : 'yield'));
      const s = r && r.supply;
      let src = '';
      if (s) {
        src = SUPPLY_WORDS[s.kind] + (s.by && s.by.length ? ' ' + s.by.map(bizLabel).join(' / ') : '');
        if (s.loot && s.loot.label && (s.kind === 'aimedLoot' || s.kind === 'stapleLoot' || s.alsoLoot)) src += (s.kind === 'madeLive' ? ', and also loot: ' : ': ') + ((s.loot.labels && s.loot.labels.length) ? s.loot.labels.join(' or ') : s.loot.label);
      }
      return { id, name: resName(id), rate, perWindowFullStaff: cap ? roundTo(rate * cap * G.windowHours, 1) : null, source: src, kind: s ? s.kind : null,
        tier: r ? r.tier : null, hauls: r ? r.haulsPerWindow : 0, effort: (r && r.effort) || null, cappedBy: r ? r.cappedBy : null, promoted: !!(r && r.role === 'promoted') };
    });
    const effortWords = (e) => (e.unit === 'battles' ? 'about ' + e.n + (e.n === 1 ? ' battle' : ' battles') + ' fully looted'
      : e.unit === 'bodies' ? 'about ' + e.n + ' enemy bodies looted'
        : 'about ' + e.n + ' trips in a mode nobody has measured (roguelite, territory or fishing) — a stand-in figure');
    const consume = describe('inputs'); const make = describe('yields');
    const fmt = (x) => x.name + ' (' + (x.perWindowFullStaff != null ? x.perWindowFullStaff + ' per ' + G.windowHours + ' hours fully staffed' : x.rate + ' per worker-hour')
      + (x.effort ? ', ' + effortWords(x.effort) : (x.hauls ? ', about ' + x.hauls + ' single lootings' : '')) + (x.source ? '; ' + x.source : '') + (x.promoted ? '; borrowed from its craft list so this business has a battle-loot need' : '') + ')';
    const label = bizLabel(op);
    if (consume.length) lines.push(label + ' would newly consume: ' + consume.map(fmt).join(', ') + '.');
    if (make.length) lines.push(label + ' would newly produce: ' + make.map(fmt).join(', ') + '.');
    const keptIn = Object.keys(live.inputs || {}); const keptY = Object.keys(live.yields || {});
    if (keptIn.length || keptY.length) lines.push('  (unchanged: ' + [keptIn.length ? 'still consumes ' + keptIn.map(resName).join(', ') : '', keptY.length ? 'still produces ' + keptY.map(resName).join(', ') : ''].filter(Boolean).join('; ') + ')');
    perOp.push({ op, label, consume, make, split: ex.stats && ex.stats.perOp ? ex.stats.perOp[op] || null : null });
  }
  const untouched = allOps.filter((op) => !ex.overlay[op]).map(bizLabel);
  if (untouched.length) lines.push('No change for: ' + untouched.join(', ') + '.');

  const withheldLines = [];
  const byOp = {};
  for (const w of ex.withheld) (byOp[w.op] || (byOp[w.op] = [])).push(w);
  for (const op of Object.keys(byOp)) {
    const groups = {};
    for (const w of byOp[op]) (groups[w.reason] || (groups[w.reason] = [])).push(resName(w.id));
    for (const reason of Object.keys(groups)) withheldLines.push(bizLabel(op) + ' — left out: ' + groups[reason].join(', ') + ' — ' + (REASON_WORDS[reason] || reason) + '.');
  }
  return { lines, perOp, untouched, withheldLines, stats: ex.stats || null, text: lines.join('\n') };
}

/**
 * What the admin-only "copy overlay JSON" button should put on the clipboard:
 * the overlay folded into the overrides that already exist (with the removal
 * record, OVERLAY_MARKER), refused outright if it does not validate.
 * `existingOverrides` must be supplied by the caller (the bridge), because this
 * file never reads the game. `opts.lootTables` = {structureSalvage, lootResIds} from the
 * bridge is REQUIRED: without it the shipped drop-rate measurement cannot be checked
 * against the live game and the answer is null (fail closed). Returns null on refusal.
 * ⚠ There is nowhere to PASTE this today — see the header (the editor has no
 * import box). Until the owner approves one, this is a preview, not a switch.
 */
export function adminCopyPayload(data, SC, liveOpEcon, existingOverrides, opts) {
  /* Round 3: the drop rates ship, so they can go STALE — appetites sized from yesterday's loot
     tables are exactly the outage round 1 shipped.
     ROUND 4: FAIL CLOSED. Round 3 only ran the check when the caller remembered to pass
     opts.lootTables; called the short way it handed back the full payload unchecked, while the
     memo told the owner the copy "refuses to run on a stale measurement". The button that will
     call this does not exist yet, so the default IS what its author gets. Now: no tables, or
     tables that do not match the measurement = null, and adminCopyReport says why.
     opts.unchecked === true skips the check and is for TESTS ONLY (a harness with no bridge);
     the gate fails if any file under public/ passes it. */
  const o = opts || {};
  if (lootGateProblems(SC).length) return null;                 // no settings, nothing to copy (never an empty override)
  /* ROUND 6: the sizing knobs take the SAME road as the loot gate. Without this line a broken
     sizing block still reached the end and, on opts.unchecked (the tests-only hatch), handed
     back a 2-byte "{}" instead of null — fail-closed by accident on the real admin paths only,
     which is not the symmetry this file claims. Refuse here, explicitly. */
  if (sizingProblems(SC).length) return null;
  if (o.unchecked !== true && !fluxCheck(fluxOf(data, o, liveOpEcon), o.lootTables).ok) return null;
  const overlay = buildOpsEconOverlay(data, SC, liveOpEcon, opts);
  const v = validateOverlay(overlay, data, liveOpEcon, Object.assign({ SC }, o));
  if (!v.ok) return null;
  return JSON.stringify(mergeIntoOverrides(existingOverrides, overlay), null, 2);
}

/** Why adminCopyPayload would refuse, in words the button can toast. -> {ok, problems:[…]} */
export function adminCopyReport(data, SC, liveOpEcon, opts) {
  const problems = lootGateProblems(SC).slice();
  problems.push(...sizingProblems(SC));   // round 6: the toast names a broken sizing setting too
  const fc = fluxCheck(fluxOf(data, opts || {}, liveOpEcon), opts && opts.lootTables);
  if (!fc.ok) problems.push(fc.why);
  const v = validateOverlay(buildOpsEconOverlay(data, SC, liveOpEcon, opts), data, liveOpEcon, Object.assign({ SC }, opts || {}));
  if (!v.ok) problems.push(...v.errors);
  return { ok: !problems.length, problems };
}

/** The matching "off" payload: the same map with every recorded overlay line taken out again. */
export function adminRemovePayload(existingOverrides, overlay) {
  return JSON.stringify(removeFromOverrides(existingOverrides, overlay), null, 2);
}

export default { OVERLAY_KEYS, OVERLAY_MARKER, LOOT_GATE_SHAPE, lootGateProblems, SIZING_SHAPE, sizingProblems, OWNER_PRICED_FIELDS, NEW_OP_CHECKLIST, explainOverlay, buildOpsEconOverlay, stagedOverlays, newOpRows, mergeIntoOverrides, removeFromOverrides, validateOverlay, diffAgainst, adminCopyPayload, adminCopyReport, adminRemovePayload, tableSignature, fluxCheck, shippedFlux };
