/* ═══════════════════════════════════════════════════════════════════════════
   🗺 SUPPLY CHAIN — the module side of the seam.

   🔴 THE GLOBALS TRAP (CLAUDE.md). Profile, OPS_ECON, RESOURCES, SALVAGE_RES and
   _opEcon are top-level `const` / function declarations in index.html's classic
   script — global LEXICAL bindings, NOT properties of window — so an ES module
   cannot see them, at all, ever. Everything this feature needs is handed over
   explicitly by index.html on `window.SupplyChainBridge`, and this file is the
   ONLY place in the folder that touches `window`. Need something new from the
   legacy app? ADD IT TO THE BRIDGE in index.html (and to BRIDGE_MEMBERS below).
   Never reach for a bare global and never assume `window.Foo` exists because
   `const Foo` does.

   EVERY ACCESSOR IS TOTAL. Bridge absent, half-built, or every member throwing →
   a harmless, correctly TYPED default, never a throw and never `undefined`
   where a caller expects an array. This module is loaded from a plain
   <script type="module"> on every page load; an uncaught error here is a
   console error for every player, including the ones who never open the map.
   "Correctly typed" matters as much as "does not throw": a bridge that answers
   `resources: () => 'oops'` must still come back as [], so the views can
   iterate resources() without guarding.

   ⚠ THAT GUARANTEE STOPS AT THE EDGE OF AN OP ROW. `opEcon(id)` is either null
   or a plain object — but its CONTENTS are OPS_ECON's, passed through verbatim
   on purpose (this file must never invent an economy shape). In the real table
   9 of the 25 ops have no `inputs` key at all (mining, oil, agri, salvage, gas,
   cardshop, warehouse, dojo, bank) and `smuggling` has no `yields` key — counted
   from the fixture, which is byte-identical to OPS_ECON — so
   `opEcon(id).yields` is legitimately `undefined` and
   `Object.keys(opEcon(id).inputs)` legitimately throws. Guard both —
   `isObj(row.yields)`, `isObj(row.inputs)` — the way modal.js, plan.js and
   proposal.js already do. An earlier version of this comment claimed the rows
   were guaranteed to carry both keys; they are not, and normalising them here
   would erase the difference between "produces nothing" and "the table does
   not say", which the LIVE/PLANNED tagging depends on.

   THIS FEATURE IS READ-ONLY. There is deliberately no spendGems / addGems /
   addRes / rpc here. The map explains the economy; it must not be able to move
   it. If a later round wants a "buy this business" button it goes through
   openBusiness(), which hands the player to the screen that already owns the
   purchase, its confirm dialog and its server check.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The one import this file makes: SC.bridge holds the seam's own two knobs
   (see tuning.js). tuning.js is pure data with no window and no DOM, so
   importing it here costs nothing and keeps the "every knob lives in
   tuning.js" rule true of the seam as well as of the views. */
import { SC } from './tuning.js';

/* The members index.html's bridge block must provide. It is DATA so the
   integration piece, the audit smoke and fake-bridge.js can all check
   themselves against one list instead of three hand-kept copies. `confirm` is
   the bridge-side name for confirmAsync — it wraps gcConfirm, same as
   CarFactoryBridge.confirm. */
export const BRIDGE_MEMBERS = Object.freeze([
  'opEcon', 'opLabel', 'ownsOp', 'resources', 'salvageRes', 'lootResIds',
  'structureSalvage', 'held', 'gems', 'isAdmin', 'signedIn', 'toast', 'confirm',
  'openBusiness', 'transportPhase',
]);

// Read lazily on every call — a captured reference goes stale across a hot
// reload, and capturing at import would turn a load-order regression into a
// silent failure at import instead of a loud one at use. The try covers a
// window whose property is a throwing getter (a test bridge does exactly that).
export function bridge() {
  try { return (typeof window !== 'undefined' && window.SupplyChainBridge) || null; }
  catch (e) { return null; }
}

// "Ready" means the one member nothing can be drawn honestly without. A map
// with no opEcon would have to either invent startup costs or show blanks that
// look like "free" — so the shell shows its offline notice instead.
export function ready() {
  try { const b = bridge(); return !!(b && typeof b.opEcon === 'function'); }
  catch (e) { return false; }
}

/* "Healthy" = the bridge not only exists, it ANSWERS. ready() is a cheap
   typeof and is true for a bridge whose every member throws, rejects or
   returns garbage — a shell gating on ready() alone would then draw a map of
   blanks instead of its offline notice. healthy() asks the real question
   through the same total accessor the views use: does at least one of these
   operations come back as a row? The ids are the CALLER's (the shell passes
   the graph's live op ids) so this file keeps no list of businesses; with
   none given it probes Transport, the one op every lane on the map rides. */
export function healthy(opIds) {
  try {
    if (!ready()) return false;
    const list = (Array.isArray(opIds) && opIds.length) ? opIds : ['transport'];
    for (let i = 0; i < list.length; i++) if (opEcon(list[i])) return true;
    return false;
  } catch (e) { return false; }
}

let _warned = false;
export function warnMissing(where) {
  if (_warned) return;
  _warned = true;
  try { console.warn('[supplychain] window.SupplyChainBridge is missing — live economy figures are unavailable; the map shows structure only.', where || ''); } catch (e) {}
}

/* Defuse a thenable. Round 1 was total against a member that THROWS and not
   against one that REJECTS: an `async` member (or a sync one that returns the
   promise of an async legacy screen opener — the likeliest shape for
   openBusiness) handed a rejected promise to a synchronous accessor, which
   returned its default and dropped the promise. Nothing caught it, so it
   surfaced as "Uncaught (in promise)" for every player and, in a Node smoke,
   as a non-zero exit (126 of them in the critic's matrix). The no-op handler
   marks the rejection handled without changing what anyone awaiting the
   ORIGINAL promise sees. Reading `.then` is itself inside a try: on a hostile
   object it can be a throwing getter. */
const thenable = (r) => {
  try {
    if (r === null || (typeof r !== 'object' && typeof r !== 'function')) return false;
    const t = r.then;
    if (typeof t !== 'function') return false;
    try { t.call(r, null, () => {}); } catch (e) {}
    return true;
  } catch (e) { return true; }   // a thing whose .then throws is not data either
};

// The raw choke point. `b[name]` is inside the try because a member may be a
// getter that throws, not just a function that throws. Any thenable that
// comes back is defused here, once, for every accessor.
const invoke = (name, dflt, a) => {
  try {
    const b = bridge();
    const f = b && b[name];
    if (typeof f !== 'function') return dflt;
    const r = f.apply(b, a);
    thenable(r);
    return r;
  } catch (e) { return dflt; }
};
/* What the SYNCHRONOUS accessors use: a thenable is not an answer, it is the
   default. (Without this, `ownsOp` on an async member would compare a Promise
   to `true` and quietly say no — right by luck. Here it is right by rule, and
   `plain()` never gets to JSON-walk a promise.) Every bridge member except
   `confirm` must therefore be synchronous — README "The bridge contract". */
const call = (name, dflt, ...a) => {
  const r = invoke(name, dflt, a);
  return (r !== dflt && thenable(r)) ? dflt : r;
};

/* Deep, plain COPY. `_opEcon()` returns the LIVE table row when there is no
   admin override ("several callers have always received the live row" — its own
   comment), and RESOURCES rows are the live catalogue. A view that sorted
   `yields` in place or tagged a row with a layout field would be editing the
   game's economy from a read-only screen. JSON is the right tool: these are
   plain data by construction, and anything that is not (a function, a cycle, a
   throwing getter) collapses to the default instead of leaking through. */
const plain = (v, dflt) => {
  try {
    if (v === null || typeof v !== 'object') return dflt;
    const c = JSON.parse(JSON.stringify(v));
    return (c && typeof c === 'object') ? c : dflt;
  } catch (e) { return dflt; }
};
// Every id goes over the seam as a string; a Symbol or a hostile toString must
// not be the thing that breaks totality.
const sid = (v) => { try { return v == null ? '' : String(v); } catch (e) { return ''; } };
const str = (v, dflt) => ((typeof v === 'string' && v) ? v : dflt);
const num = (v) => { try { const n = +v; return (Number.isFinite(n) && n > 0) ? n : 0; } catch (e) { return 0; } };

// Catalogue rows: keep only real rows with a usable id, so a caller can build a
// Map by id without checking each one.
const rows = (v) => {
  const a = plain(v, null);
  return Array.isArray(a) ? a.filter((r) => r && typeof r === 'object' && typeof r.id === 'string' && r.id) : [];
};
const ids = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s) : []);

/* 💰 The ONLY source of an economy number in this feature. null = "the game
   has no such operation" (fashion, airport) or "no bridge" — callers must show
   that as unknown/planned, never as zero. Goes through _opEcon on the other
   side, so a published admin override is what the player sees here too. */
export const opEcon = (id) => {
  const r = plain(call('opEcon', null, sid(id)), null);
  return (r && !Array.isArray(r)) ? r : null;
};
// Falls back to the id so a label can always be printed; OP_LABELS owns the
// real names and this folder must not keep a second copy of them.
export const opLabel = (id) => str(call('opLabel', '', sid(id)), sid(id));
// A DERIVED fact over the player's operation rows (_ownsOp). Personalises the
// plan ("you already own a supplier"); never gates what the map shows.
export const ownsOp = (id) => call('ownsOp', false, sid(id)) === true;

// 📦 The catalogues. catalog.js lets these live rows override its generated
// snapshot (withLive), so a resource added after the snapshot was cut still
// gets its real name and icon.
export const resources = () => rows(call('resources', null));        // RESOURCES
export const salvageRes = () => rows(call('salvageRes', null));      // SALVAGE_RES
export const lootResIds = () => ids(plain(call('lootResIds', null), null)); // LOOT_RES_IDS
// STRUCTURE_SALVAGE: { kind: { core:[id], flavour:[id] } }. Normalised so both
// arrays always exist.
export const structureSalvage = () => {
  const o = plain(call('structureSalvage', null), null);
  const out = {};
  if (!o || Array.isArray(o)) return out;
  for (const k of Object.keys(o)) {
    const r = o[k];
    if (!r || typeof r !== 'object') continue;
    out[k] = { core: ids(r.core), flavour: ids(r.flavour) };
  }
  return out;
};

// 🎒 What the player is holding — for "you have 3 of the 5 things this business
// needs". A COUNT for display: non-negative, finite, 0 when unknown. The bridge
// side must answer through the alias-folding read (brief/loot.md item 5:
// Profile.salvage is written uncapped and un-folded by three code paths).
export const held = (id) => num(call('held', 0, sid(id)));
export const gems = () => Math.floor(num(call('gems', 0)));
export const isAdmin = () => call('isAdmin', false) === true;
export const signedIn = () => call('signedIn', false) === true;

export const toast = (m, ms) => { call('toast', undefined, sid(m), ms); };
// Accepts either member name: `confirm` is the house bridge-side name, and a
// bridge that mirrors this file's export list would call it confirmAsync.
// No bridge → false: an unanswerable question is a "no", never a silent "yes".
// ⏱ …and the one member that can be total in VALUE and not in TIME: a
// `confirm` that never settles hangs its caller forever (in Node, an unsettled
// top-level await exits 13 silently). Promise.race gives it the documented
// ceiling SC.bridge.confirmTimeoutMs and then answers "no" — same answer as a
// missing bridge, for the same reason. The loser of the race is a timer, not a
// rejection, so nothing is left unhandled; the timer is cleared either way so a
// long-lived page does not accumulate one per dialog.
// `timeoutMs` is an override for TESTS (seam-smoke waits 30 ms, not two
// minutes) and for a caller that knows its dialog is cheap. Views pass nothing.
export const confirmAsync = async (m, timeoutMs) => {
  let timer = null;
  try {
    const b = bridge();
    const name = (b && typeof b.confirm === 'function') ? 'confirm' : 'confirmAsync';
    // invoke, not call: this is the one member whose answer IS a promise.
    const answer = invoke(name, false, [sid(m)]);
    const ms = Number.isFinite(+timeoutMs) ? +timeoutMs : +(SC && SC.bridge && SC.bridge.confirmTimeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return (await answer) === true;
    const capped = new Promise((res) => { timer = setTimeout(() => res(false), ms); });
    return (await Promise.race([Promise.resolve(answer), capped])) === true;
  } catch (e) { return false; }
  finally { try { if (timer !== null) clearTimeout(timer); } catch (e) {} }
};

/* 🚪 Hand the player to the screen that OWNS a business (Just Business, the
   Car Factory, the haul board…). Returns whether the game took the request, so
   the modal can say "open it from Just Business" instead of showing a button
   that does nothing. The routing table lives on the index.html side — this
   folder must not learn the legacy openers' names. */
export const openBusiness = (id) => call('openBusiness', false, sid(id)) === true;

/* 🚛 Transport's gating phase (transport/routes.js PHASE: 1 = a carrier is a
   bonus, 2 = soft gate, 3 = hard gate). 0 = UNKNOWN, and callers must treat it
   as "cannot claim anything is enforced". Defaulting to 1 was rejected: the
   whole point of the live/planned split is that this screen never states a
   rule it did not read from the game.

   ⚠ CLAMPED to 0..3, because this number is PRINTED ("stage 1 of 3"). num()
   only rejects non-positive and non-finite, so a bridge answering 99 — a typo
   in the integration block, a future PHASE constant this folder has not been
   taught about — would have the map calmly stating "stage 99 of 3". A value
   above the range is not information, it is a bridge this file does not
   understand, so it reads as the top of the range it does. */
export const TRANSPORT_PHASE_MAX = 3;
export const transportPhase = () => Math.min(TRANSPORT_PHASE_MAX, Math.floor(num(call('transportPhase', 0))));
