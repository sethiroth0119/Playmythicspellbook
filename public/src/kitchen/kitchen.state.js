/* ═══════════════════════════════════════════════════════════════════════════
   🍔 kitchen.state.js — GAME TRUTH. The whole simulation, and nothing else.
   ═══════════════════════════════════════════════════════════════════════════

   WHAT THIS FILE IS
   The only file allowed to decide what is true in Mythic Kitchen. Render reads
   this and calls the actions below; it never writes a field. index.js owns the
   RAF loop and calls tick(dt, now) — this file owns what tick DOES.

   🔴 THE THREE HARD RULES THIS FILE LIVES UNDER
   1. NO DOM. No `document`, no `window`, no `requestAnimationFrame`, no
      `setTimeout`. This module must run to completion under plain node with no
      browser at all — that is the test (see `simulate()` at the bottom), and it
      is the entire reason `now` is a parameter on every single entry point.
   2. NO `Date.now()` INSIDE `tick()` OR ANYTHING IT CALLS. The clock arrives as
      an argument. A sim that reads the wall clock cannot be fast-forwarded, and
      a sim that cannot be fast-forwarded cannot be tested — you would have to
      sit through a real twelve-hour service to find out that the dinner rush
      bankrupts the pantry.
   3. NEVER THROW ACROSS AN ACTION BOUNDARY. Every player-facing action returns
      `{ok, code, why}`. `code` is a stable machine string, `why` is the sentence
      that goes to `toast()`. A thrown error inside a RAF loop kills the loop and
      freezes the whole kitchen mid-rush with no way back except a page reload.

   🔴 THE GLOBALS TRAP (CLAUDE.md, three times paid for)
   `Profile`, `Cloud`, `App`, `getRes`, `addRes`, `spendResources`, `showToast`,
   `saveProfile` are top-level `const`/`function` declarations in index.html.
   They are LEXICAL globals. They are NOT on `window`. `window.Profile` is
   `undefined`. This module reaches the game ONLY through `bridge()` and there is
   no second path. If you need something new from the legacy app, it is ADDED TO
   THE BRIDGE — never read around it.

   ⚠ WHY NAMESPACE IMPORTS (`import * as DATA`) AND NOT NAMED ONES
   Six people are writing this feature at the same time. A named import of an
   export that does not exist yet is a LINK-TIME SyntaxError in ESM — it does not
   fail softly, it takes the whole module graph down, and on a 223k-line app that
   means the tile never appears and nobody can tell you why. A namespace import
   binds whatever is there, and every call below is guarded by a `typeof` check.
   The cost is a little noise; the benefit is that a half-finished sibling module
   degrades instead of detonating.

   ⚠ WHY EVERY EXPORT IS A `function` DECLARATION AND NOT `const fn = () => {}`
   `drivethru.js` and `convoy.js` may legitimately import from this file while
   this file imports from them (they mutate `K`, we call them). ESM handles that
   cycle correctly for hoisted function declarations and NOT for `const` arrows,
   which are still in the temporal dead zone when the cycle is being linked.
   Rejected alternative: an event-only seam with no imports at all — it moved the
   coupling into stringly-typed event names, which is worse, not better.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as DATA from './kitchen.data.js';
import * as DriveThru from './drivethru.js';
import * as Convoy from './convoy.js';
import * as BRIDGE from './kitchen.bridge.js';

/* The seam, resolved through the namespace for the reason argued above, with
   `{}` as the floor. That is not laziness: EVERY bridge call in this file is
   written `b.foo ? b.foo() : <zero>`, because §7 says a bridge reader may be
   absent and a mutator may return false. An empty object therefore behaves
   exactly like NULL_BRIDGE without this file keeping a second, drifting copy of
   the seam's shape — kitchen.bridge.js owns that shape and should stay the only
   place it is written down. */
const BRIDGE_FLOOR = {};
function bridge() {
  try {
    if (typeof BRIDGE.bridge === 'function') return BRIDGE.bridge() || BRIDGE_FLOOR;
    return BRIDGE.NULL_BRIDGE || BRIDGE_FLOOR;
  } catch (e) { return BRIDGE_FLOOR; }
}

/* ───────────────────────────────────────────────────────────────────────────
   THE 14 LIVE RESOURCE IDS.
   ───────────────────────────────────────────────────────────────────────────
   These — and only these — are real, spendable, tradeable, stash-cap-counted
   game resources (index.html line 39272, RESOURCE_IDS at 39357). They are the
   ONLY legal input to the pantry (§8.1).

   🔴 This list is a last-ditch fallback. The truth is `bridge().resources()`,
   which reads the live RESOURCES table; we prefer that whenever it answers.
   The literal list exists so that `buySupply()` can still validate a cost dict
   under NULL_BRIDGE, where `resources()` returns `[]` — without it, a headless
   run would treat every cost key as unknown and refuse every purchase, and the
   degradation ladder's rung 1 ("no bridge at all") would be untestable.
   These are IDS, not economy numbers, so they do not belong in ECON. */
const LIVE_RESOURCE_IDS = [
  'food', 'ammo', 'water', 'medicine', 'energyDrink', 'supplies', 'metal',
  'fuel', 'corruptedEssence', 'memoryShards', 'dna', 'wood', 'stone', 'cloth',
];

const DAY_NAMES_FALLBACK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ───────────────────────────────────────────────────────────────────────────
   ECON ACCESS.
   ───────────────────────────────────────────────────────────────────────────
   CLAUDE.md: "All operation pricing goes through _opEcon(). Never hardcode
   economy numbers." Kitchen has no `_opEcon()`, so `ECON` in kitchen.data.js is
   it, and `EC()` is the only way this file reads it.

   🔴 THE SECOND ARGUMENT IS NOT A TUNING VALUE. It is a NaN guard. If you want
   to change how the game plays, change kitchen.data.js — editing a fallback here
   changes nothing on a correctly-built data file and will silently diverge from
   the number the designer is actually looking at.

   WHY the guard exists at all: a missing or misspelled ECON key yields
   `undefined`, `undefined` poisons arithmetic into `NaN`, and a `NaN` `doneAt`
   makes a station slot compare false against every threshold forever — the pizza
   is neither cooking nor done nor burnt, the slot is un-pullable, and there is
   nothing on screen to tell you why. That failure is invisible and unbounded;
   one defaulted constant is neither. */
function EC(key, fallback) {
  try {
    const v = DATA.ECON ? DATA.ECON[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  } catch (e) { return fallback; }
}

function ECb(key, fallback) {
  try {
    const v = DATA.ECON ? DATA.ECON[key] : undefined;
    return (typeof v === 'boolean') ? v : fallback;
  } catch (e) { return fallback; }
}

/* ───────────────────────────────────────────────────────────────────────────
   📋 ECON KEYS THIS FILE READS THAT kitchen.data.js DOES NOT DEFINE YET
   ───────────────────────────────────────────────────────────────────────────
   45 of the ECON keys below come straight out of kitchen.data.js. These five do
   not exist there yet, so `EC()` is falling back to the guard value shown. They
   are all concepts this file introduced, so they want ADDING TO ECON rather than
   living here — this list is the handover note, not an excuse:

     LAST_CALL_MS         45000   grace after the closing bell before any ticket
                                  still on the board is written off. Ending the
                                  instant the clock strikes bins food the player
                                  is ten seconds from serving, which reads as
                                  theft rather than as a deadline.
     SHIFT_GRACE_MS        4000   quiet beat after openShift() before the first
                                  walk-in. Being mid-order before the panel has
                                  finished painting is a bad first second.
     TICKET_HARD_GRACE_MS 20000   how long past dueAt state.js waits for
                                  drivethru.js to reap its own car before doing
                                  it anyway. A cooperation deadline (see tick()).
     LIKE_BIAS              0.7   chance a walk-in orders from CUSTOMERS.likes
                                  rather than the whole menu.
     COUNTER_ENABLED       true   debug toggle to silence walk-ins.

   Nothing else in this file invents a number. If you add one, add it to ECON.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 BIND TO THE DATA FILE'S HELPERS, DO NOT RE-DERIVE THEM.
 * kitchen.data.js exports `rushAt`, `spawnIntervalMs`, `qualityMul`,
 * `orderScore`, `cookMsFor`, `passCap`, `patienceMul`… — real functions that
 * already fold in UPGRADES and the day curve. An earlier draft of this file
 * computed its own gaussian rush curve and its own build score from the
 * contract's minimum ECON key list, and every one of those was a second,
 * silently diverging copy of a number the designer thought they owned. Where a
 * helper exists, this file calls it; `DF()` is how, and the fallback branch is
 * only there so a half-written data file degrades instead of throwing.
 */
function DF(name) {
  try { const f = DATA[name]; return (typeof f === 'function') ? f : null; }
  catch (e) { return null; }
}

/* Data lookups, every one of them tolerant of a sibling file that is still
   being written. `recipe('nope')` is null, never an exception. */
function recipeOf(id) {
  try { if (typeof DATA.recipe === 'function') return DATA.recipe(id) || null; } catch (e) {}
  try { return (DATA.RECIPES || []).find((r) => r && r.id === id) || null; } catch (e) { return null; }
}
function stationOf(id) {
  try { if (typeof DATA.station === 'function') return DATA.station(id) || null; } catch (e) {}
  try { return (DATA.STATIONS || []).find((s) => s && s.id === id) || null; } catch (e) { return null; }
}
function ingredientOf(id) {
  try { if (typeof DATA.ingredient === 'function') return DATA.ingredient(id) || null; } catch (e) {}
  try { return (DATA.INGREDIENTS || []).find((i) => i && i.id === id) || null; } catch (e) { return null; }
}
function levelForXp(xp) {
  try { if (typeof DATA.levelForXp === 'function') return Math.max(1, _int(DATA.levelForXp(xp))); } catch (e) {}
  return 1;
}
function xpForLevel(lv) {
  try { if (typeof DATA.xpForLevel === 'function') return Math.max(0, _int(DATA.xpForLevel(lv))); } catch (e) {}
  return 0;
}
function menuForLevel(lv) {
  try {
    if (typeof DATA.menuForLevel === 'function') {
      const m = DATA.menuForLevel(lv);
      if (Array.isArray(m)) return m;
    }
  } catch (e) {}
  try { return (DATA.RECIPES || []).filter((r) => r && _int(r.minLevel || 1) <= lv); } catch (e) { return []; }
}
/* ⚠ `day` is 1-BASED and day 1 is Monday — DATA.dayName() owns that offset.
   An earlier draft indexed `DAY_NAMES[day % 7]` against a Sunday-first array,
   which put every weekday label one day out for the whole life of a save. */
function dayNameFor(day) {
  const f = DF('dayName');
  if (f) { const n = f(day); if (n) return String(n); }
  const d = (Array.isArray(DATA.DAY_NAMES) && DATA.DAY_NAMES.length) ? DATA.DAY_NAMES : DAY_NAMES_FALLBACK;
  return d[(Math.max(1, _int(day)) - 1) % d.length];
}

/* ── tiny numeric helpers. Shared with nobody; they are two lines each and an
      import for them would be a dependency for no reason. ─────────────────── */
function _int(n) { const v = Math.floor(Number(n)); return isFinite(v) ? v : 0; }
function _num(n, d) { const v = Number(n); return isFinite(v) ? v : (d || 0); }
function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — THE STATE OBJECT
   ═══════════════════════════════════════════════════════════════════════════ */

export const Kitchen = {
  v: 1,                  // save-format version. Bump → write a migration in hydrate().
  rev: 0,                // 🔴 monotonic. ANY structural mutation ++ it. Render repaints
                         //    structure only when rev changes; timers update every frame.
  open: false,           // panel visible. The RAF loop runs ONLY while true.
  now: 0,                // ms epoch of the last tick. This file reads THIS, never Date.now().

  shift: {
    day: 1,              // 1-based, persists forever. Weekday = DAY_NAMES[day % 7].
    tMs: 0,              // ms elapsed inside the current in-game day
    running: false,      // service open → customers spawn
    rush: 1,             // demand multiplier from the day curve, recomputed each tick
  },

  level: 1,
  xp: 0,                 // TOTAL lifetime xp. Level is DERIVED: levelForXp(xp).
  popularity: 50,        // 0..100. The emoji face + meter. Drives spawn rate and tips.

  pantry: {},            // ingredientId → integer units. NOT the 14-id live ledger.
  upgrades: [],          // owned UPGRADES ids. SAVED. Feeds every DATA.*(…, owned)
                         // helper — slot counts, cook speed, pass size, tips.

  stations: {},          // stationId → { slots: [slot|null, …] }
  hand: null,            // { recipeId, quality, mult } lifted off a station, or null
  pass: [],              // plated and waiting: [{id, recipeId, quality, mult, madeAt}]

  tickets: [],
  lane: [],

  convoys: [],
  inbound: [],

  today:  { served: 0, lost: 0, burnt: 0, earned: 0, tips: 0, xp: 0 },
  totals: { served: 0, lost: 0, burnt: 0, earned: 0, days: 0 },

  missing: false,
  offline: false,
  error: null,

  // ── DERIVED. NEVER SAVED. ────────────────────────────────────────────────
  _fx: [],               // transient float-ups for the renderer to consume+clear
  _events: [],           // this frame's event drain buffer
  _lastSave: -Infinity,  // debounce stamp, in `now` ms. See save().
  _seq: 0,               // id counter for tickets / pass dishes
  _seed: 1,              // deterministic RNG cursor (see rng())
  _nextCounter: 0,       // `now` at which the next walk-in ticket is due
  _lowSeen: {},          // pantry:low latch — one warning per ingredient per shift
  _report: null,         // last day-end settlement report (shift:close payload)
  _init: false,
};

const K = Kitchen;       // local alias; every internal function uses this one.

/* ═══════════════════════════════════════════════════════════════════════════
   RNG — deterministic on purpose.
   ═══════════════════════════════════════════════════════════════════════════
   mulberry32. `Math.random()` would work fine in the game and be useless in a
   test: "the dinner rush bankrupted me" is not a bug report you can act on if
   the rush is different every run. `seed(n)` makes a whole shift reproducible,
   which is what lets `simulate()` be a regression test instead of an anecdote.
   The seed is DERIVED — it is never saved, so it cannot be save-scummed. */
function rng() {
  K._seed = (K._seed + 0x6D2B79F5) | 0;
  let t = K._seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rint(lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
function rpick(arr) { return (arr && arr.length) ? arr[Math.floor(rng() * arr.length)] : null; }

/** Reseed the sim. Headless tests call this; the game never needs to. */
export function seed(n) { K._seed = _int(n) || 1; return K._seed; }

/* ═══════════════════════════════════════════════════════════════════════════
   §6 — EVENTS
   ═══════════════════════════════════════════════════════════════════════════
   Two delivery paths on purpose:
     • `tick()` RETURNS the frame's events, so a headless test reads them with no
       subscription and no teardown;
     • subscribers fire too, so render can react to something that happened
       inside an action it did not call (a car leaving mid-frame, say).
   Closed set — adding a name here without adding it to CONTRACT.md §6 is how
   render ends up listening for an event that will never arrive:
     shift:open shift:close day:roll cook:start cook:done cook:burnt ticket:new
     ticket:ready ticket:served ticket:lost car:arrive car:order car:served
     car:leave pantry:low pantry:buy level:up pop:change pay convoy:launch
     convoy:arrive convoy:claim error                                         */
const _subs = new Map();   // name → Set<fn>   ('*' receives everything)

export function on(name, fn) {
  if (typeof fn !== 'function') return () => {};
  const key = String(name || '*');
  if (!_subs.has(key)) _subs.set(key, new Set());
  _subs.get(key).add(fn);
  return function off() { const s = _subs.get(key); if (s) s.delete(fn); };
}

export function emit(name, payload) {
  const ev = Object.assign({ name: String(name), t: K.now }, payload || {});
  // ⚠ The drain buffer is emptied by tick(). Actions can also emit while no
  //   tick is running (buySupply from a shut panel, a save failure during
  //   close), so it needs a ceiling or a long session with the kitchen closed
  //   slowly accumulates events nobody will ever read.
  if (K._events.length > 256) K._events.shift();
  K._events.push(ev);
  // ⚠ A throwing subscriber must not take the sim with it. Render is the main
  //    subscriber and render touches the DOM, which fails in ways the sim has
  //    no business caring about.
  fire(_subs.get(ev.name), ev);
  fire(_subs.get('*'), ev);
  return ev;
}
function fire(set, ev) {
  if (!set) return;
  for (const fn of Array.from(set)) {
    try { fn(ev); } catch (e) { /* a broken listener is not a broken kitchen */ }
  }
}

/** Float-up / spark hints for the renderer. Render consumes and CLEARS this. */
function fx(kind, text, extra) {
  if (K._fx.length > 40) K._fx.shift();   // an unread buffer must not grow forever
  K._fx.push(Object.assign({ kind, text, t: K.now }, extra || {}));
}

/* Result helpers. `{ok,code,why}` everywhere, never a throw, never a bare null.
   codes: OK NO_PANTRY NO_SLOT LOCKED CLOSED NOT_READY BAD_ARG CAP */
function ok(extra) { return Object.assign({ ok: true, code: 'OK', why: '' }, extra || {}); }
function no(code, why, extra) { return Object.assign({ ok: false, code, why }, extra || {}); }

/* ═══════════════════════════════════════════════════════════════════════════
   §4 — THE SHIFT CLOCK
   ═══════════════════════════════════════════════════════════════════════════
   `DAY_MS` is how much REAL time one in-game day takes. The in-game hour is a
   pure function of `shift.tMs`, so there is no second clock to drift.

   🔴 THE SHIFT IS THE UNIT OF PERSISTENCE. `tMs` advances only while the panel
   is open and service is running. Rejected, twice, for good reasons:
     • run the clock on wall-time → your tickets expire while you sleep and you
       wake up at zero popularity having done nothing wrong;
     • freeze the clock but keep the tickets → the drive-thru becomes turn-based
       with a free pause button, and the timing skill the whole game is built on
       evaporates.
   So the shift ends when the panel closes, open tickets are FORFEIT (no
   popularity penalty — you did not fail them, the day ended), and convoys are
   the single exception that advances on wall-clock because a multi-hour freight
   promise is not a reflex test. */
function hourOf() {
  const f = DF('hourAt');
  if (f) return _num(f(K.shift.tMs), EC('OPEN_HOUR', 10));
  // Fallback only. NOTE the mapping: the in-game day spans OPEN_HOUR..CLOSE_HOUR
  // across the WHOLE of DAY_MS — tMs 0 is the opening bell, not midnight. An
  // earlier draft started the clock at (OPEN_HOUR/24)*DAY_MS and compared
  // against CLOSE_HOUR, which quietly made the shift a third of its intended
  // length. The data file's hourAt() is the definition; this is a shadow of it.
  const o = EC('OPEN_HOUR', 10), c = EC('CLOSE_HOUR', 22);
  return o + dayPctOf() * (c - o);
}

function dayPctOf() {
  const f = DF('dayPct');
  if (f) return _clamp(_num(f(K.shift.tMs), 0), 0, 1);
  return _clamp(K.shift.tMs / Math.max(1, EC('DAY_MS', 720000)), 0, 1);
}

/** Public read for render/HUD: the clock chip and the weekday. */
export function shiftClock() {
  return {
    day: K.shift.day,
    dayName: dayNameFor(K.shift.day),
    hour: hourOf(),
    pct: dayPctOf(),
    tMs: K.shift.tMs,
    dayMs: EC('DAY_MS', 720000),
    running: !!K.shift.running,
    closing: K.shift.running && dayPctOf() >= 1,
    rush: K.shift.rush,
    openHour: EC('OPEN_HOUR', 10),
    closeHour: EC('CLOSE_HOUR', 22),
  };
}

/* The demand curve and the arrival rate both live in kitchen.data.js —
   RUSH_CURVE is a twelve-entry table it interpolates, and spawnIntervalMs folds
   popularity in. Popularity is the game's only long-term feedback loop: a bad
   shift genuinely thins tomorrow's queue, which makes recovery easier and
   earning slower. That is the whole design, and it is tuned THERE, not here. */
function rushNow() {
  const f = DF('rushAt');
  return f ? _clamp(_num(f(K.shift.tMs), 1), 0.1, 10) : 1;
}

/** ms between WALK-IN arrivals. The lane's share is drivethru.js's business;
    COUNTER_SHARE says what fraction of all custom comes to the counter, so the
    counter's interval is the whole-house interval divided by that share. */
function counterIntervalMs() {
  const f = DF('spawnIntervalMs');
  const whole = f ? _num(f(K.popularity, K.shift.rush), EC('SPAWN_BASE_MS', 9000))
                  : EC('SPAWN_BASE_MS', 9000);
  const share = _clamp(EC('COUNTER_SHARE', 0.35), 0.05, 1);
  return Math.max(EC('SPAWN_MIN_MS', 1400), whole / share);
}

/* ═══════════════════════════════════════════════════════════════════════════
   INIT / RESET
   ═══════════════════════════════════════════════════════════════════════════ */

/** Build (or rebuild) the station rack from STATIONS. Slot arrays are sized by
    the data file, so unlocking a sixth griddle slot is a data edit. */
function buildStations() {
  const out = {};
  const list = Array.isArray(DATA.STATIONS) ? DATA.STATIONS : [];
  const slotsFor = DF('slotsFor');
  for (const s of list) {
    if (!s || !s.id) continue;
    // 🔴 Slot COUNT is an upgrade effect, so it must come from slotsFor() and
    //    not from STATIONS[].slots — reading the raw field would silently
    //    un-buy every capacity upgrade the player owns on the next panel open.
    const n = Math.max(1, _int(slotsFor ? slotsFor(s.id, K.upgrades) : (s.slots || 1)));
    out[s.id] = { slots: new Array(n).fill(null) };
  }
  K.stations = out;
}

/** Everything that does NOT survive a shift. One place, so a new ephemeral
    field cannot be forgotten by half the call sites that should clear it. */
function clearService() {
  K.tickets = [];
  K.pass = [];
  K.hand = null;
  buildStations();
  try { if (typeof DriveThru.clearLane === 'function') DriveThru.clearLane(K); } catch (e) {}
  K.lane = [];
  K._fx = [];
  K._lowSeen = {};
}

/**
 * Hydrate from the bridge, catch convoys up on wall-clock, and hand back the
 * state object. Safe to call more than once — `open()` calls it every time the
 * panel opens and must not wipe a running kitchen's progression.
 */
export function init() {
  const b = bridge();
  let saved = null;
  try { saved = b.kitchenState ? b.kitchenState() : null; } catch (e) { saved = null; }
  hydrate(saved);

  clearService();
  K.shift.running = false;
  K.shift.tMs = 0;
  K.shift.rush = 1;
  K.today = { served: 0, lost: 0, burnt: 0, earned: 0, tips: 0, xp: 0 };
  K.error = null;
  K._events = [];
  K._report = null;

  // Convoys are the one thing that moved while you were away (§4).
  // catchUp() is idempotent by contract; calling it here AND in open() is
  // deliberate belt-and-braces, not a bug.
  try {
    if (typeof Convoy.catchUp === 'function') {
      const evs = Convoy.catchUp(K, K.now || 0);
      if (Array.isArray(evs)) for (const e of evs) if (e && e.name) K._events.push(e);
    }
  } catch (e) { /* a convoy module mid-write must not stop you cooking */ }

  K._init = true;
  K.rev++;
  return K;
}

/** Wipe to a brand new kitchen. Admin / console only — this destroys the
    pantry and the level, so render must gate it behind a confirm(). */
export function reset() {
  K.v = 1;
  K.rev++;
  K.shift = { day: 1, tMs: 0, running: false, rush: 1 };
  K.level = 1;
  K.xp = 0;
  K.popularity = 50;
  K.pantry = {};
  K.upgrades = [];
  // A reset kitchen is a NEW kitchen, so it gets the same starting stock a new
  // save does — otherwise "reset" hands you a kitchen you cannot cook in.
  const _start = (DATA.ECON && DATA.ECON.START_PANTRY) || null;
  if (_start) for (const id of Object.keys(_start)) if (_int(_start[id]) > 0) K.pantry[id] = _int(_start[id]);
  K.convoys = [];
  K.inbound = [];
  K.today = { served: 0, lost: 0, burnt: 0, earned: 0, tips: 0, xp: 0 };
  K.totals = { served: 0, lost: 0, burnt: 0, earned: 0, days: 0 };
  K.missing = false; K.offline = false; K.error = null;
  K._seq = 0; K._seed = 1; K._nextCounter = 0; K._report = null;
  clearService();
  save(true);
  return K;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5 — PERSISTENCE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The SAVED subset, exactly: v, shift.day, level, xp, popularity, pantry,
 * convoys, totals. Nothing else. Everything omitted is either derived from
 * `now` or is service state that the shift rule (§4) deliberately discards.
 *
 * 🔴 A station slot's 'cooking'|'done'|'burnt' is NEVER saved and never even
 * stored: it is derived from `now` vs `doneAt`/`burnAt`. A stored state string
 * is a stale lie the moment the clock moves past it.
 */
export function snapshot() {
  return {
    v: K.v,
    day: _int(K.shift.day) || 1,
    level: _int(K.level) || 1,
    xp: Math.max(0, _int(K.xp)),
    popularity: _clamp(_num(K.popularity, 50), 0, 100),
    pantry: Object.assign({}, K.pantry),
    upgrades: (K.upgrades || []).slice(),
    convoys: (K.convoys || []).map((c) => Object.assign({}, c)),
    totals: Object.assign({}, K.totals),
  };
}

/**
 * Absent-tolerant by construction. No save → a fresh kitchen, never a throw.
 * Unknown `v` → keep whatever parses, default the rest, stamp the current `v`.
 *
 * ⚠ UNKNOWN PANTRY IDS ARE KEPT, NOT DROPPED. If kitchen.data.js renames an
 * ingredient, deleting the old key would quietly destroy stock the player paid
 * real resources for. An invisible key costs a few bytes; destroyed property
 * costs trust. (Same reasoning as the `refundRes` rule in §7.)
 */
export function hydrate(saved) {
  const s = (saved && typeof saved === 'object') ? saved : {};

  K.shift.day = Math.max(1, _int(s.day || (s.shift && s.shift.day) || 1));
  K.xp = Math.max(0, _int(s.xp));
  // Level is DERIVED from total XP and then written to the field for render.
  // Trusting a saved `level` would let an edited save unlock the whole menu.
  K.level = Math.max(1, levelForXp(K.xp));
  const pop = (s.popularity != null) ? s.popularity : s.pop;
  K.popularity = _clamp(_num(pop, 50), 0, 100);

  const pantry = {};
  const rawPantry = (s.pantry && typeof s.pantry === 'object') ? s.pantry : {};
  for (const id of Object.keys(rawPantry)) {
    const n = _int(rawPantry[id]);
    if (n > 0) pantry[id] = n;          // negatives and NaN are dropped, stock is not
  }
  // 🔴 A BRAND NEW KITCHEN STARTS STOCKED. ECON.START_PANTRY exists because the
  //    first thing a new player does is open the panel and press a station — and
  //    if the pantry is empty, the only thing the game can say is "no". A cooking
  //    game whose first interaction is a refusal has already lost the player.
  //    The test is `saved` being absent, NOT the pantry being empty: an empty
  //    pantry mid-game is a real, earned failure state and must not be topped up.
  if (!saved || typeof saved !== 'object') {
    const start = (DATA.ECON && DATA.ECON.START_PANTRY) || null;
    if (start && typeof start === 'object') {
      for (const id of Object.keys(start)) {
        const n = _int(start[id]);
        if (n > 0) pantry[id] = n;
      }
    }
  }
  K.pantry = pantry;

  K.upgrades = Array.isArray(s.upgrades)
    ? s.upgrades.filter((u) => typeof u === 'string')
    : [];

  K.convoys = Array.isArray(s.convoys)
    ? s.convoys.filter((c) => c && typeof c === 'object').map((c) => Object.assign({}, c))
    : [];

  const t = (s.totals && typeof s.totals === 'object') ? s.totals : {};
  K.totals = {
    served: Math.max(0, _int(t.served)),
    lost: Math.max(0, _int(t.lost)),
    burnt: Math.max(0, _int(t.burnt)),
    earned: Math.max(0, _int(t.earned)),
    days: Math.max(0, _int(t.days)),
  };

  K.v = 1;                                // migrations for v2 go HERE, above this line
  K.rev++;
  return K;
}

/**
 * Debounced write-through. Never called per tick — `tick()` asks once per
 * SAVE_DEBOUNCE_MS and the actions that matter force it.
 *
 * 🔴 `setKitchenState`/`save` returning FALSE is a real failure and is surfaced,
 * not swallowed. A silent save failure is how a player loses an hour of a shift
 * and blames the game for something it could have told them about immediately.
 */
export function save(force) {
  const b = bridge();
  // 🔴 THE DEBOUNCE STAMP IS `K.now`, NEVER A WALL CLOCK. An earlier draft fell
  //    back to Date.now() when K.now was 0, which quietly put a real clock read
  //    on the tick path any time a caller passed `now = 0` — exactly what a
  //    headless test does. `_lastSave` starts at -Infinity instead, so the first
  //    debounced save always fires and no clock is ever consulted here.
  if (!force && (K.now - K._lastSave) < EC('SAVE_DEBOUNCE_MS', 5000)) return true;
  K._lastSave = K.now;
  try {
    const cur = (b.kitchenState ? b.kitchenState() : null) || {};
    const merged = Object.assign(cur, snapshot());
    const a = b.setKitchenState ? b.setKitchenState(merged) : false;
    if (a === false) { K.error = 'save-failed'; emit('error', { code: 'SAVE', why: 'Could not write the kitchen save.' }); return false; }
    const c = b.save ? b.save() : false;
    if (c === false) { K.error = 'save-failed'; emit('error', { code: 'SAVE', why: 'Could not write your profile.' }); return false; }
    K.error = null;
    return true;
  } catch (e) {
    K.error = 'save-failed';
    emit('error', { code: 'SAVE', why: 'Could not write the kitchen save.' });
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PANTRY
   ═══════════════════════════════════════════════════════════════════════════
   🔴 PANTRY INGREDIENTS ARE NOT PROMOTED INTO THE 14-ID `RESOURCES` LEDGER.
   They live here, are not tradeable, not lootable, not stash-capped.
   WHY: /src/resources/chain.js documents exactly what an id that is holdable but
   has no producer, no cost renderer and no market entry does to a player — it is
   "worse than missing, because the player's pile of it is real and inert."
   Fifteen new ids would be fifteen more of that fault. The pantry is a private
   workshop stock; the live ledger is the economy. They meet in exactly one
   place, `buySupply()`, and nowhere else.
   ═══════════════════════════════════════════════════════════════════════════ */

export function pantryHas(needs) {
  if (!needs || typeof needs !== 'object') return true;
  for (const id of Object.keys(needs)) {
    if (_int(K.pantry[id]) < _int(needs[id])) return false;
  }
  return true;
}

/** All-or-nothing pantry deduction. Trivially atomic because the pantry is one
    plain object we own outright — check everything, then subtract. */
function pantryTake(needs, mult) {
  const m = Math.max(1, _int(mult || 1));
  if (!needs || typeof needs !== 'object') return true;
  for (const id of Object.keys(needs)) {
    if (_int(K.pantry[id]) < _int(needs[id]) * m) return false;
  }
  for (const id of Object.keys(needs)) {
    K.pantry[id] = _int(K.pantry[id]) - _int(needs[id]) * m;
    if (K.pantry[id] <= 0) delete K.pantry[id];
  }
  return true;
}

function pantryPut(id, n) {
  const v = _int(n);
  if (!id || v <= 0) return;
  K.pantry[id] = _int(K.pantry[id]) + v;
}

/** The list of ids that are legal keys in a SUPPLY_RECIPES cost dict. */
function liveIds() {
  try {
    const rows = bridge().resources ? bridge().resources() : null;
    if (Array.isArray(rows) && rows.length) {
      const ids = rows.map((r) => (r && (r.id || r.key))).filter(Boolean);
      if (ids.length) return ids;
    }
  } catch (e) {}
  return LIVE_RESOURCE_IDS;
}

/**
 * 💳 SPEND A COST DICT — the single implementation of "take real property".
 *
 * `cost` may contain ONLY the 14 live resource ids plus the key `cinder`.
 * Anything else is a data bug and REFUSES THE WHOLE PURCHASE rather than
 * silently skipping the leg — a skipped leg is a free ingredient, and free
 * ingredients are how an economy quietly dies.
 *
 * 🔴 settle.js discipline, and it is not optional:
 *   1. preflight EVERY leg. A purchase that cannot complete costs nothing.
 *   2. take, remembering exactly what was taken.
 *   3. any leg returns false → unwind in reverse with refundRes / addGems.
 *
 * 🔴 THE UNWIND USES `refundRes`, NOT `addRes`. `addRes()` enforces the stash
 * cap and returns WITHOUT ADDING when the vault is full — correct for loot,
 * catastrophic for a refund. That exact confusion destroyed 215 units of a real
 * player's resources. Undoing a deduction this call stack just made →
 * refundRes. Creating units → addRes, and then re-read.
 *
 * Shared by buySupply() and buyUpgrade() so there is exactly one place this can
 * be got wrong, instead of two places that must be kept identical by hand.
 */
function spendCost(cost, mult) {
  const n = Math.max(1, _int(mult || 1));
  const legal = liveIds();
  for (const key of Object.keys(cost || {})) {
    if (key === 'cinder') continue;
    if (legal.indexOf(key) === -1) {
      return no('BAD_ARG', 'That is priced in something the ledger does not have.');
    }
  }

  const b = bridge();
  const takenRes = [];
  let takenCinder = 0;

  // ── 1. PREFLIGHT ────────────────────────────────────────────────────────
  for (const key of Object.keys(cost || {})) {
    const want = _int(cost[key]) * n;
    if (want <= 0) continue;
    let have = 0;
    try { have = (key === 'cinder') ? _int(b.gems ? b.gems() : 0) : _int(b.getRes ? b.getRes(key) : 0); } catch (e) { have = 0; }
    if (have < want) {
      const label = (key === 'cinder') ? 'Cinder' : (metaName(key) || key);
      return no('NO_PANTRY', `Not enough ${label} — you need ${want.toLocaleString()} and have ${have.toLocaleString()}.`);
    }
  }

  // ── 2. TAKE ─────────────────────────────────────────────────────────────
  let failed = null;
  for (const key of Object.keys(cost || {})) {
    const want = _int(cost[key]) * n;
    if (want <= 0) continue;
    let took = false;
    try {
      took = (key === 'cinder')
        ? (b.spendGems ? b.spendGems(want) === true : false)
        : (b.spendRes ? b.spendRes(key, want) === true : false);
    } catch (e) { took = false; }
    if (!took) { failed = key; break; }
    if (key === 'cinder') takenCinder += want; else takenRes.push([key, want]);
  }

  // ── 3. UNWIND, IN REVERSE ───────────────────────────────────────────────
  if (failed) {
    for (let i = takenRes.length - 1; i >= 0; i--) {
      try { if (b.refundRes) b.refundRes(takenRes[i][0], takenRes[i][1]); } catch (e) {}
    }
    if (takenCinder > 0) { try { if (b.addGems) b.addGems(takenCinder); } catch (e) {} }
    return no('NO_PANTRY', 'That could not be paid for. Nothing was taken.');
  }
  return ok({ spent: cost });
}

/**
 * §8.1 — the ONLY door between the live 14-id ledger and the pantry.
 *
 * The money side is spendCost() above; this function owns the ORDER of
 * operations, which is the part that matters: the pantry is not touched until
 * every leg of the payment has succeeded. Step 4 is unreachable from a partial
 * spend by construction, not by care.
 *
 * @returns {{ok:boolean, code:string, why:string, spent?:object}}
 */
export function buySupply(supplyId, batches) {
  const maxB = Math.max(1, _int(EC('SUPPLY_MAX_BATCHES', 20)));
  const n = _clamp(_int(batches || 1), 1, maxB);
  const find = DF('supply');
  const list = Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : [];
  const sup = (find ? find(supplyId) : null) || list.find((s) => s && s.id === supplyId) || null;
  if (!sup) return no('BAD_ARG', 'That supply order does not exist.');
  const out = sup.out || {};
  if (!out.ing || _int(out.qty) <= 0) return no('BAD_ARG', 'That supply order is malformed.');
  if (_int(sup.minLevel || 1) > K.level) {
    return no('LOCKED', `That supply order unlocks at level ${_int(sup.minLevel)}.`);
  }

  // 🔴 THE PANTRY IS CAPPED (ECON.PANTRY_CAP, plus upgrades) AND THE CHECK GOES
  //    HERE, IN THE PREFLIGHT — never as a clamp after payment. Clamping would
  //    charge full price for units that never landed, which is the same class of
  //    bug as the addRes() stash-cap trap in §7: the money leaves, the goods do
  //    not, and nothing on screen says so.
  const capFn = DF('pantryCap');
  const pcap = Math.max(1, _int(capFn ? capFn(K.upgrades) : EC('PANTRY_CAP', 600)));
  const after = _int(K.pantry[out.ing]) + _int(out.qty) * n;
  if (after > pcap) {
    const room = Math.max(0, pcap - _int(K.pantry[out.ing]));
    return no('CAP', `Your pantry only has room for ${room.toLocaleString()} more ${metaName(out.ing) || out.ing}.`);
  }

  const paid = spendCost(sup.cost || {}, n);
  if (!paid.ok) return paid;

  // ── 4. ONLY NOW does the pantry change ──────────────────────────────────
  const gained = _int(out.qty) * n;
  pantryPut(out.ing, gained);
  delete K._lowSeen[out.ing];             // re-arm the low warning for this id
  K.rev++;
  emit('pantry:buy', { supplyId, ing: out.ing, qty: gained, batches: n, cost: sup.cost || {} });
  fx('buy', `+${gained} ${metaName(out.ing) || out.ing}`);
  save(true);
  return ok({ spent: sup.cost || {}, gained, ing: out.ing });
}

function metaName(id) {
  const ing = ingredientOf(id);
  if (ing && ing.name) return ing.name;
  try { const m = bridge().meta ? bridge().meta(id) : null; if (m && m.name) return m.name; } catch (e) {}
  return null;
}

/** Which ingredients are running out. Render draws the red bins from this. */
export function pantryLowList() {
  const lowAt = EC('PANTRY_LOW', 4);
  const out = [];
  for (const r of menuForLevel(K.level)) {
    for (const id of Object.keys((r && r.needs) || {})) {
      if (_int(K.pantry[id]) < lowAt && out.indexOf(id) === -1) out.push(id);
    }
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §8.2 — STATIONS, COOKING, AND RUINING IT
   ═══════════════════════════════════════════════════════════════════════════
   slot = { recipeId, startedAt, doneAt, burnAt, steps[], nDone, nBurn }

   🔴 THE PHASE IS DERIVED, ALWAYS. There is no `slot.state` and there must never
   be one. `nDone`/`nBurn` are EMISSION LATCHES, not state: they exist only so
   that crossing `doneAt` fires `cook:done` once instead of sixty times a second.
   Deriving the phase and latching the edge are different jobs; conflating them
   is exactly how a stored state string goes stale.

   The done window is what makes timing a skill instead of a wait. Do not widen
   it to be kind — a pizza you cannot ruin is a pizza nobody looks at.
   ═══════════════════════════════════════════════════════════════════════════ */

/** 'empty' | 'cooking' | 'done' | 'burnt'  — pure, derived, no side effects. */
export function slotPhase(slot, now) {
  if (!slot) return 'empty';
  const t = _num(now, K.now);
  if (t >= _num(slot.burnAt, Infinity)) return 'burnt';
  if (t >= _num(slot.doneAt, Infinity)) return 'done';
  return 'cooking';
}

/** 0..1 progress toward `doneAt`, for the render bar. */
export function cookPct(slot, now) {
  if (!slot) return 0;
  const t = _num(now, K.now);
  const span = _num(slot.doneAt) - _num(slot.startedAt);
  if (span <= 0) return 1;
  return _clamp((t - _num(slot.startedAt)) / span, 0, 1);
}

/** 0..1 through the DONE window — how close this is to burning. Render paints
    this bar a different colour; it is the single most useful thing on screen. */
export function burnPct(slot, now) {
  if (!slot) return 0;
  const t = _num(now, K.now);
  const span = _num(slot.burnAt) - _num(slot.doneAt);
  if (span <= 0) return 0;
  return _clamp((t - _num(slot.doneAt)) / span, 0, 1);
}

/** The §8.2 table, in one place. Returns a quality STRING; `qMult()` prices it. */
export function qualityOf(slot, now) {
  const phase = slotPhase(slot, now);
  if (phase === 'burnt') return 'burnt';
  if (phase === 'cooking') return 'raw';
  const t = _num(now, K.now);
  const since = t - _num(slot.doneAt);
  // The perfect window is a PER-RECIPE number (r.perfectMs), not a global
  // fraction — a soda's 40s window and a burger's 8s window cannot share one
  // constant and both feel right. PERFECT_FRACTION is the fallback definition.
  const r = recipeOf(slot.recipeId);
  let perfect = _num(r && r.perfectMs, 0);
  if (perfect <= 0) perfect = (_num(slot.burnAt) - _num(slot.doneAt)) * EC('PERFECT_FRACTION', 1 / 3);
  if (perfect > 0 && since <= perfect) return 'perfect';
  return 'good';
}

export function qMult(quality) {
  const f = DF('qualityMul');
  if (f) return _num(f(quality), EC('Q_GOOD', 1));
  if (quality === 'perfect') return EC('Q_PERFECT', 1.25);
  if (quality === 'good') return EC('Q_GOOD', 1.0);
  if (quality === 'raw') return EC('Q_RAW', 0.5);
  if (quality === 'burnt') return EC('Q_BURNT', 0);   // burnt pays NOTHING.
  return EC('Q_GOOD', 1);
}

/** Can the player cook this at all right now? Used by render to grey out tiles. */
export function canCook(recipeId) {
  const r = recipeOf(recipeId);
  if (!r) return no('BAD_ARG', 'No such dish.');
  if (_int(r.minLevel || 1) > K.level) return no('LOCKED', `${r.name || 'That dish'} unlocks at level ${_int(r.minLevel)}.`);
  if (!pantryHas(r.needs)) return no('NO_PANTRY', `You are out of ingredients for ${r.name || 'that'}.`);
  return ok();
}

/**
 * Put a dish on a station slot. Spends `recipe.needs` from the pantry,
 * all-or-nothing, and writes the three timestamps everything else derives from.
 */
export function startCook(stationId, slotIndex, recipeId, now) {
  const t = _num(now, K.now);
  if (!K.shift.running) return no('CLOSED', 'The kitchen is closed — start a shift first.');

  const st = K.stations[stationId];
  const stDef = stationOf(stationId);
  if (!st || !stDef) return no('BAD_ARG', 'No such station.');

  const i = _int(slotIndex);
  if (i < 0 || i >= st.slots.length) return no('BAD_ARG', 'No such slot.');
  if (st.slots[i]) return no('NO_SLOT', 'That slot is already in use.');

  const r = recipeOf(recipeId);
  if (!r) return no('BAD_ARG', 'No such dish.');
  if (r.station && r.station !== stationId) {
    return no('BAD_ARG', `${r.name || 'That'} is made on the ${(stationOf(r.station) || {}).name || r.station}.`);
  }
  if (_int(r.minLevel || 1) > K.level) return no('LOCKED', `${r.name || 'That dish'} unlocks at level ${_int(r.minLevel)}.`);

  if (!pantryTake(r.needs, 1)) {
    return no('NO_PANTRY', `Out of ingredients for ${r.name || 'that dish'} — restock from Supplies.`);
  }

  // 🔴 cookMsFor(), not r.cookMs — speed upgrades live in the multiplier and
  //    reading the raw field un-buys them. The DONE WINDOW deliberately does not
  //    shrink with speed (see doneWindowMsFor's comment in kitchen.data.js): a
  //    faster cook must not also be a harder cook or every upgrade is a trap.
  const cookFn = DF('cookMsFor'), winFn = DF('doneWindowMsFor');
  const cookMs = Math.max(0, _int(cookFn ? cookFn(r.id, K.upgrades) : r.cookMs));
  const doneWindow = Math.max(1, _int((winFn ? winFn(r.id) : 0) || r.doneWindowMs || r.burnMs));
  st.slots[i] = {
    recipeId: r.id,
    startedAt: t,
    doneAt: t + cookMs,
    burnAt: t + cookMs + doneWindow,
    steps: [],          // assembly order, see addStep()
    nDone: false,       // ── emission latches, NOT state ──
    nBurn: false,
  };
  K.rev++;
  emit('cook:start', { stationId, slot: i, recipeId: r.id });
  return ok({ stationId, slot: i });
}

/**
 * Lift a slot into `hand`. The quality is decided HERE, at the moment you pull
 * it — not when it finished. That is what makes standing over a griddle mean
 * something.
 *
 * A burnt pull still occupies your hand and must be binned with `dropHand()`:
 * the cost of burning is the ingredients, the slot time, AND the two taps.
 */
export function pullSlot(stationId, slotIndex, now) {
  const t = _num(now, K.now);
  if (K.hand) return no('NO_SLOT', 'Your hands are full — plate or bin what you are holding.');
  const st = K.stations[stationId];
  if (!st) return no('BAD_ARG', 'No such station.');
  const i = _int(slotIndex);
  if (i < 0 || i >= st.slots.length) return no('BAD_ARG', 'No such slot.');
  const slot = st.slots[i];
  if (!slot) return no('NO_SLOT', 'That slot is empty.');

  const quality = qualityOf(slot, t);
  const build = scoreBuild(slot);
  st.slots[i] = null;
  K.hand = {
    recipeId: slot.recipeId,
    quality,
    mult: qMult(quality) * (quality === 'burnt' ? 1 : build.mult),
    build: build.score,
    madeAt: t,
  };
  K.rev++;
  return ok({ quality, build: build.score });
}

/** Bin whatever is in hand. The ingredients are gone; that is the lesson. */
export function dropHand() {
  if (!K.hand) return false;
  const was = K.hand;
  K.hand = null;
  K.rev++;
  fx('bin', 'binned', { recipeId: was.recipeId });
  return true;
}

/**
 * Hand → pass. The pass is the row of finished dishes on the counter that
 * REF-A shows; tickets fill themselves from it (see fillTickets).
 *
 * ⚠ A BURNT DISH CANNOT BE PLATED. It pays nothing by the §8.2 table, so
 * plating it would only ever be a mistake with no upside — and a customer
 * silently handed a black pizza for zero Cinder reads as a bug, not a penalty.
 * You already paid the popularity for burning it; bin it and move on.
 */
export function plateHand(now) {
  const t = _num(now, K.now);
  if (!K.hand) return no('NOT_READY', 'You are not holding anything.');
  if (K.hand.quality === 'burnt') return no('NOT_READY', 'That is burnt — bin it.');
  const capFn = DF('passCap');
  const cap = Math.max(1, _int(capFn ? capFn(K.upgrades) : EC('PASS_CAP', 6)));
  if (K.pass.length >= cap) return no('CAP', 'The pass is full — serve something first.');
  const dish = {
    id: 'd' + (++K._seq),
    recipeId: K.hand.recipeId,
    quality: K.hand.quality,
    mult: _num(K.hand.mult, 1),
    madeAt: t,
  };
  K.pass.push(dish);
  K.hand = null;
  K.rev++;
  return ok({ dish });
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSEMBLY — the ordered-steps mini-game
   ═══════════════════════════════════════════════════════════════════════════
   ⚠ `addStep` IS NOT IN CONTRACT.md's EXPORT LIST. It is deliberately ADDITIVE
   and deliberately OPTIONAL, and this note is the "say so" the contract asks
   for — it wants adding to §1 before the next pass.

   WHY it is safe to add anyway: a slot with zero steps scores `BUILD_DEFAULT`
   (1.0), so a renderer that never calls `addStep` gets exactly the game the
   contract describes, priced exactly as §8.2 prices it. A renderer that DOES
   call it gets a build-order skill layered on top. Nothing downstream has to
   know this exists.

   WHY the steps do not re-charge the pantry: `startCook` already spent
   `recipe.needs` in full. Charging again for laying the same bun down would
   double-bill the player for one burger. The EXCEPTION is an ingredient that is
   not in the recipe at all — you genuinely took a pickle out of the bin and put
   it on, so that one unit is charged, and it counts against you.
   ═══════════════════════════════════════════════════════════════════════════ */

/* The canonical build order comes from `recipe.steps` — an ORDERED list of
   {ing, qty, verb, layer} that kitchen.data.js derives `needs` from, so the two
   can never disagree. An earlier draft inferred the order from `needs` key
   order; that worked, but it made a display detail (object key order) load
   bearing, and `steps` is the thing the designer actually authored. */
function canonicalSteps(recipeId) {
  const r = recipeOf(recipeId);
  const out = [];
  if (!r) return out;
  if (Array.isArray(r.steps) && r.steps.length) {
    for (const st of r.steps) {
      const n = Math.max(1, _int(st && st.qty));
      for (let i = 0; i < n; i++) out.push(st.ing);
    }
    return out;
  }
  for (const id of Object.keys(r.needs || {})) {
    const n = Math.max(1, _int(r.needs[id]));
    for (let i = 0; i < n; i++) out.push(id);
  }
  return out;
}

export function addStep(stationId, slotIndex, ingredientId, now) {
  const st = K.stations[stationId];
  if (!st) return no('BAD_ARG', 'No such station.');
  const i = _int(slotIndex);
  const slot = st.slots[i];
  if (!slot) return no('NO_SLOT', 'Nothing on that slot to build on.');
  if (slotPhase(slot, _num(now, K.now)) === 'burnt') return no('NOT_READY', 'That one is already ruined.');

  const canon = canonicalSteps(slot.recipeId);
  // ⚠ ONLY things the recipe actually calls for may be laid on, and each only as
  //    many times as it calls for. An earlier draft let you add anything and
  //    charged a pantry unit for the surplus — which turned the build bonus into
  //    a build PENALTY, and kitchen.data.js is explicit that it must never be
  //    one: "Sauce before cheese must never be the difference between a sale and
  //    a bin." Refusing the tap costs the player nothing and teaches the recipe.
  const already = slot.steps.filter((x) => x === ingredientId).length;
  const allowed = canon.filter((x) => x === ingredientId).length;
  if (allowed === 0) return no('BAD_ARG', `${metaName(ingredientId) || 'That'} does not go on this.`);
  if (already >= allowed) return no('CAP', `That already has all the ${metaName(ingredientId) || 'of those'} it needs.`);

  slot.steps.push(ingredientId);
  K.rev++;
  return ok({ steps: slot.steps.length, want: canon.length });
}

/**
 * The build-order bonus. DATA.orderScore() owns the scoring; ECON.Q_ORDER_BONUS
 * owns how much it is worth.
 *
 * 🔴 IT IS A BONUS AND NEVER A PENALTY. A slot nobody assembled scores exactly
 * 1.0 — a renderer that just presses COOK loses nothing at all, which is what
 * makes this layer safe to add without the render builder having to know it
 * exists. `score` is -1 for "not assembled" so the UI can tell "not attempted"
 * from "attempted badly".
 */
export function scoreBuild(slot) {
  const steps = (slot && Array.isArray(slot.steps)) ? slot.steps : [];
  if (!steps.length) return { score: -1, mult: 1 };
  const f = DF('orderScore');
  const raw = f ? _clamp(_num(f(slot.recipeId, steps), 1), 0, 1) : 1;
  return { score: Math.round(raw * 100), mult: 1 + EC('Q_ORDER_BONUS', 0.1) * raw };
}

/* ═══════════════════════════════════════════════════════════════════════════
   TICKETS — the order board
   ═══════════════════════════════════════════════════════════════════════════
   ticket = { id, source:'counter'|'drive', carId, custId, name,
              items:[{recipeId, qty, filled, qsum, xn}],
              placedAt, dueAt, state:'open'|'ready'|'served'|'lost',
              paid, tip }
   `qsum` is the SUM of the quality multipliers of the units filled so far and
   `xn` counts the units that earn XP (raw ones do not, per §8.2). Storing the
   sums instead of an average means a two-pizza order that got one perfect and
   one raw prices exactly right without the render layer knowing any of this.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build and file a ticket. Exported because `drivethru.js` needs to create the
 * ticket it links a car to, and two implementations of "what an order looks
 * like" is how the board ends up with two different due-time formulas.
 */
export function newTicket(k, opts) {
  const o = opts || {};
  const t = _num(o.now, K.now);
  const items = (o.items || []).map((it) => ({
    recipeId: it.recipeId,
    qty: Math.max(1, _int(it.qty || 1)),
    filled: 0,
    qsum: 0,
    xn: 0,      // units that earn XP at all (raw ones do not)
    pn: 0,      // units that were PERFECT — they earn XP_PERFECT_MULT
  })).filter((it) => recipeOf(it.recipeId));
  if (!items.length) return null;

  const ticket = {
    id: 'k' + (++K._seq),
    source: o.source === 'drive' ? 'drive' : 'counter',
    carId: o.carId || null,
    custId: o.custId || null,
    name: o.name || '',
    icon: o.icon || '',
    line: o.line || '',      // the customer's one-liner, for the ticket header
    items,
    placedAt: t,
    dueAt: t + dueSpanFor(items, o.patienceMul),
    state: 'open',
    paid: 0,
    tip: 0,
  };
  K.tickets.push(ticket);
  K.rev++;
  emit('ticket:new', { ticketId: ticket.id, source: ticket.source, items: items.map((i) => i.recipeId) });
  return ticket;
}

/**
 * How long a customer will wait: TICKET_BASE_MS plus TICKET_ITEM_MS per item,
 * scaled by the customer's own patience and by any patience upgrades.
 *
 * 🔴 IT SCALES WITH THE ORDER, NOT A FLAT TIMER. Rejected design: one fixed
 * promise for every ticket. It looks fair and is not — a five-item family order
 * on a two-slot oven is physically unservable inside a flat window, so the board
 * becomes a random popularity drain and the player correctly concludes the game
 * is cheating. A big order buys the time a big order needs.
 */
function dueSpanFor(items, custMul) {
  let units = 0;
  for (const it of items) units += it.qty;
  const base = EC('TICKET_BASE_MS', 45000);
  const per = EC('TICKET_ITEM_MS', 20000);
  const upFn = DF('patienceMul');
  const upMul = _num(upFn ? upFn(K.upgrades) : 1, 1);
  return Math.max(EC('PATIENCE_MIN_MS', 20000), (base + per * units) * _num(custMul, 1) * upMul);
}

/** 0..1 of the promise burnt through. Render's countdown bar. */
export function ticketPct(ticket, now) {
  if (!ticket) return 0;
  const t = _num(now, K.now);
  const span = _num(ticket.dueAt) - _num(ticket.placedAt);
  if (span <= 0) return 1;
  return _clamp((t - _num(ticket.placedAt)) / span, 0, 1);
}

/* Walk-in customers. The drive-thru lane is drivethru.js's; the ORDER BOARD is
   this file's, and REF-B's "Customer Orders / Table No. 1" is what it draws. */
function spawnCounter(now) {
  const cap = _int(EC('TICKET_CAP', 8));
  const openTickets = K.tickets.filter((x) => x.state === 'open' || x.state === 'ready').length;
  if (openTickets >= cap) return null;

  const menu = menuForLevel(K.level);
  if (!menu.length) return null;
  const cust = rpick(Array.isArray(DATA.CUSTOMERS) ? DATA.CUSTOMERS : []) || null;
  const spec = (cust && cust.order) || {};
  const lo = Math.max(1, _int(spec.min || 1));
  const hi = _clamp(Math.max(lo, _int(spec.max || 2)), lo, _int(EC('ORDER_MAX_ITEMS', 5)));
  const count = rint(lo, hi);

  // `likes` biases WHAT they order toward their menu categories. It is a bias,
  // not a filter: a Kid on a BMX mostly wants fries, but a kitchen that only
  // ever sees the orders it expects has no reason to keep the whole menu hot.
  const likes = (cust && Array.isArray(cust.likes)) ? cust.likes : [];
  const liked = likes.length ? menu.filter((r) => likes.indexOf(r.cat) !== -1) : [];
  const items = [];
  for (let i = 0; i < count; i++) {
    const pool = (liked.length && rng() < EC('LIKE_BIAS', 0.7)) ? liked : menu;
    const r = rpick(pool);
    if (!r) continue;
    const found = items.find((x) => x.recipeId === r.id);
    if (found) found.qty++; else items.push({ recipeId: r.id, qty: 1 });
  }

  // The customer's own patience, expressed relative to the board's base promise.
  const ref = EC('TICKET_BASE_MS', 45000);
  const custMul = _num(cust && cust.patienceMs, 0) > 0 ? _num(cust.patienceMs, ref) / ref : 1;

  return newTicket(K, {
    now,
    source: 'counter',
    custId: cust ? cust.id : null,
    name: cust ? cust.name : 'Walk-in',
    icon: cust ? cust.icon : '',
    line: cust ? cust.line : '',
    items,
    patienceMul: custMul,
  });
}

/**
 * Match finished dishes on the pass to the tickets that want them.
 *
 * ⚠ REJECTED: making the player drag each dish onto a ticket by hand. At 360px
 * that is a fiddly drag-and-drop nightmare on a touch screen, and the fun in
 * this genre lives in the cooking and the clock, not in the clerical work.
 * Dishes go to the ticket with the NEAREST due time — which is the choice a
 * competent cook would make anyway — and oldest dish first, because food does
 * not improve on the pass.
 */
/**
 * The heat lamp. A dish left on the pass past PASS_FRESH_MS is worth
 * PASS_STALE_MULT of itself.
 *
 * ⚠ REVERSED A REJECTION. An earlier draft of this file dismissed pass decay as
 * "too much complexity". kitchen.data.js ships PASS_FRESH_MS/PASS_STALE_MULT, and
 * it is right: without it, cooking a hundred burgers during the quiet hour and
 * coasting through the dinner rush is strictly optimal, which deletes the rush —
 * the one part of the day the whole design is built around.
 */
function stalenessMul(dish, now) {
  const f = DF('passFreshMs');
  const fresh = _num(f ? f(K.upgrades) : EC('PASS_FRESH_MS', 75000), 75000);
  if (fresh <= 0) return 1;
  const age = _num(now, K.now) - _num(dish.madeAt, 0);
  return age > fresh ? EC('PASS_STALE_MULT', 0.6) : 1;
}

function fillTickets(now) {
  if (!K.pass.length) return;
  const open = K.tickets.filter((x) => x.state === 'open').sort((a, b) => a.dueAt - b.dueAt);
  for (const ticket of open) {
    for (const item of ticket.items) {
      while (item.filled < item.qty) {
        const idx = K.pass.findIndex((d) => d.recipeId === item.recipeId);
        if (idx === -1) break;
        const dish = K.pass.splice(idx, 1)[0];
        item.filled++;
        item.qsum += _num(dish.mult, 1) * stalenessMul(dish, now);
        if (dish.quality !== 'raw') item.xn++;
        if (dish.quality === 'perfect') item.pn++;
        K.rev++;
      }
    }
    if (ticket.items.every((it) => it.filled >= it.qty)) {
      ticket.state = 'ready';
      K.rev++;
      emit('ticket:ready', { ticketId: ticket.id, source: ticket.source, carId: ticket.carId });
    }
    if (!K.pass.length) break;
  }
}

/**
 * §8.3 — what a meal pays.
 *   payout = Σ(basePrice × qualityMult) × popMult × rushMult
 *   popMult = POP_PAY_FLOOR + (popularity/100) × POP_PAY_SPAN
 * Money is Cinder = Profile.gems, reached ONLY via bridge().addGems. There is no
 * second currency and no "restaurant cash" — a parallel wallet nobody can spend
 * anywhere else in the game would be a scoreboard pretending to be an economy.
 */
export function serveTicket(ticketId, now) {
  const t = _num(now, K.now);
  const ticket = K.tickets.find((x) => x.id === ticketId);
  if (!ticket) return no('BAD_ARG', 'That order is gone.');
  if (ticket.state === 'served') return no('NOT_READY', 'Already served.');
  if (ticket.state === 'lost') return no('NOT_READY', 'They already walked out.');
  if (ticket.state !== 'ready') return no('NOT_READY', 'That order is not complete yet.');

  let gross = 0, xp = 0, units = 0, qsum = 0, perfects = 0;
  for (const it of ticket.items) {
    const r = recipeOf(it.recipeId);
    if (!r) continue;
    gross += _num(r.basePrice, 0) * it.qsum;
    // Raw units earn NO xp (§8.2); perfect ones earn XP_PERFECT_MULT. The
    // multiplier is applied per UNIT, not per ticket, so one perfect pizza in a
    // sloppy order of four is still worth chasing.
    const plain = Math.max(0, it.xn - it.pn);
    xp += _int(r.xp) * plain + Math.round(_int(r.xp) * it.pn * EC('XP_PERFECT_MULT', 1.5));
    units += it.filled;
    qsum += it.qsum;
    perfects += it.pn;
  }
  const popFn = DF('popPayMul'), rushFn = DF('rushPayMul');
  const popMult = popFn ? _num(popFn(K.popularity), 1)
                        : EC('POP_PAY_FLOOR', 0.8) + (K.popularity / 100) * EC('POP_PAY_SPAN', 0.4);
  // 🔴 rushPayMul() COMPRESSES the rush into RUSH_PAY_MIN..MAX. Multiplying the
  //    payout by the raw rush (up to 2.4×) instead would make the dinner rush
  //    pay more than twice what the same food pays at 3pm — the player would
  //    rationally ignore two thirds of the day, and the quiet hours are where
  //    restocking and convoy loading are supposed to happen.
  const rushMult = rushFn ? _num(rushFn(K.shift.rush), 1) : 1;
  const payout = Math.max(0, Math.round(gross * popMult * rushMult));

  const onTime = t <= _num(ticket.dueAt, t);
  if (onTime && units > 0) xp += _int(EC('XP_TICKET_BONUS', 12));

  const avgQ = units > 0 ? (qsum / units) : 0;
  const tip = tipFor(ticket, avgQ, t, payout);

  // Pay. addGems is a bridge mutator and returns a boolean; a false here means
  // the payout did not land, which the player must be told about — the food has
  // already left the pass and cannot be un-served.
  let paid = true;
  try { paid = bridge().addGems ? bridge().addGems(payout + tip) !== false : false; } catch (e) { paid = false; }
  if (!paid) emit('error', { code: 'PAY', why: 'The till did not take that payment.' });

  ticket.state = 'served';
  ticket.paid = payout;
  ticket.tip = tip;
  K.today.served++; K.today.earned += payout; K.today.tips += tip; K.today.xp += xp;
  K.totals.served++; K.totals.earned += payout;

  // Popularity: POP_SERVE for the sale, POP_PERFECT_BONUS on top for the units
  // that were actually perfect, and upgrades multiply the gain.
  const gainFn = DF('popGainMul');
  const perfectShare = units > 0 ? (perfects / units) : 0;
  const popGain = (EC('POP_SERVE', 0.6) + EC('POP_PERFECT_BONUS', 0.4) * perfectShare)
                * _num(gainFn ? gainFn(K.upgrades) : 1, 1);
  bumpPop(popGain, 'served');
  addXp(xp);

  emit('pay', { ticketId: ticket.id, paid: payout, tip });
  emit('ticket:served', { ticketId: ticket.id, source: ticket.source, carId: ticket.carId, paid: payout, tip, xp, quality: avgQ, onTime });
  fx('pay', `+${(payout + tip).toLocaleString()}`, { ticketId: ticket.id });

  if (ticket.source === 'drive' && ticket.carId) {
    releaseCar(ticket.carId, 'served', t);
    emit('car:served', { carId: ticket.carId, ticketId: ticket.id, paid: payout, tip });
  }

  // Served tickets leave the board immediately. Rejected: a two-second "SERVED"
  // afterglow row — it pushes live tickets off a 360px screen at exactly the
  // moment the player most needs to see them. Render does the afterglow itself
  // off the event, where it costs no board space.
  K.tickets = K.tickets.filter((x) => x.id !== ticket.id);
  K.rev++;
  return ok({ paid: payout, tip, xp, quality: avgQ });
}

/**
 * The tip.
 *
 * ⚠ CONTRACT AMBIGUITY, HANDLED DEFENSIVELY. §1 types `DriveThru.tipFor` as
 * "→ integer Cinder"; §8.3 writes `tip = payout × tipFor(...)`, which needs a
 * fraction. Both readings are in the same document. Rather than pick one and be
 * wrong for whoever wrote drivethru.js, we accept both: a value strictly between
 * 0 and 1 is read as a fraction of the payout, anything ≥1 as absolute Cinder.
 * This wants resolving in CONTRACT.md; until it is, neither builder can break
 * the other.
 */
function tipFor(ticket, avgQ, now, payout) {
  if (ticket.source === 'drive' && ticket.carId && typeof DriveThru.tipFor === 'function') {
    try {
      const car = K.lane.find((c) => c && c.carId === ticket.carId);
      const v = _num(DriveThru.tipFor(K, car || { carId: ticket.carId }, avgQ, now), 0);
      if (v > 0 && v < 1) return Math.round(payout * v);
      return Math.max(0, Math.round(v));
    } catch (e) { /* fall through to the local model */ }
  }
  // The local model, built from the ECON weights rather than a formula of this
  // file's own invention: how much of the promise was left (patience), how good
  // the food was (quality), and how well-liked the place is (popularity), summed
  // by TIP_*_W and scaled to at most TIP_MAX_PCT of the bill. tipBias is the
  // customer's own generosity; a Corp Suit tips 1.8× what a Raider does.
  const span = Math.max(1, _num(ticket.dueAt) - _num(ticket.placedAt));
  const patience = _clamp((_num(ticket.dueAt) - now) / span, 0, 1);
  const quality = _clamp(avgQ / Math.max(0.01, EC('Q_PERFECT', 1.25)), 0, 1);
  const pop = _clamp(K.popularity / 100, 0, 1);
  const blend = patience * EC('TIP_PATIENCE_W', 0.45)
              + quality  * EC('TIP_QUALITY_W', 0.35)
              + pop      * EC('TIP_POP_W', 0.2);
  const cust = customerOf(ticket.custId);
  const upFn = DF('tipMul');
  const pct = EC('TIP_MAX_PCT', 0.35) * _clamp(blend, 0, 1)
            * _num(cust && cust.tipBias, 1) * _num(upFn ? upFn(K.upgrades) : 1, 1);
  const tip = Math.round(payout * pct);
  // TIP_MIN exists so that a served ticket always drops at least one coin — a
  // zero tip reads as a bug rather than as a bad tip, and the float-up animation
  // has nothing to show.
  return tip > 0 ? tip : (payout > 0 ? _int(EC('TIP_MIN', 1)) : 0);
}

function customerOf(id) {
  if (!id) return null;
  const f = DF('customer');
  if (f) { try { return f(id) || null; } catch (e) {} }
  try { return (DATA.CUSTOMERS || []).find((c) => c && c.id === id) || null; } catch (e) { return null; }
}

/**
 * A ticket ran out of time.
 *
 * IDEMPOTENT ON PURPOSE: drivethru.js may also decide a car has had enough. Both
 * paths land here, only an 'open'/'ready' ticket transitions, so a double call
 * costs the player one penalty, not two. Two popularity hits for one walk-out is
 * exactly the sort of bug that is invisible in review and infuriating in play.
 */
function loseTicket(ticket, why, now) {
  if (!ticket || (ticket.state !== 'open' && ticket.state !== 'ready')) return false;
  ticket.state = 'lost';

  // Anything already plated onto this ticket is in the bin with it.
  K.today.lost++;
  K.totals.lost++;
  bumpPop(EC('POP_LOST', -3.5), 'lost');
  emit('ticket:lost', { ticketId: ticket.id, source: ticket.source, carId: ticket.carId, why: why || 'timeout' });
  fx('lost', 'walked out', { ticketId: ticket.id });
  if (ticket.source === 'drive' && ticket.carId) releaseCar(ticket.carId, 'lost', now);
  K.tickets = K.tickets.filter((x) => x.id !== ticket.id);
  K.rev++;
  return true;
}

/** Mark a lane car as done with, whichever module owns the pixels. */
function releaseCar(carId, reason, now) {
  const car = K.lane.find((c) => c && c.carId === carId);
  if (!car) return;
  if (car.state === 'gone') return;
  car.state = 'gone';
  car.leftAt = _num(now, K.now);
  car.reason = reason;
  K.rev++;
  emit('car:leave', { carId, reason });
}

/* ═══════════════════════════════════════════════════════════════════════════
   POPULARITY, XP, LEVELS
   ═══════════════════════════════════════════════════════════════════════════ */

function bumpPop(delta, why) {
  const before = K.popularity;
  K.popularity = _clamp(_num(K.popularity, 50) + _num(delta, 0), 0, 100);
  if (Math.abs(K.popularity - before) > 0.001) {
    emit('pop:change', { from: before, to: K.popularity, delta: K.popularity - before, why: why || '' });
  }
}

function addXp(n) {
  const gain = Math.max(0, _int(n));
  if (!gain) return;
  const before = K.level;
  K.xp += gain;
  const now = Math.max(1, levelForXp(K.xp));
  if (now > before) {
    K.level = now;
    K.rev++;
    const unlocked = menuForLevel(now).filter((r) => _int(r.minLevel || 1) > before).map((r) => r.id);
    emit('level:up', { from: before, to: now, unlocked });
    fx('level', `LEVEL ${now}`);
    save(true);
  }
}

/** Render's XP bar: where we are between this level and the next. */
export function xpProgress() {
  const f = DF('xpProgress');
  if (f) { try { const r = f(K.xp); if (r && typeof r === 'object') return r; } catch (e) {} }
  const cur = xpForLevel(K.level);
  const next = xpForLevel(K.level + 1);
  const span = Math.max(1, next - cur);
  return { level: K.level, xp: K.xp, into: Math.max(0, K.xp - cur), span, pct: _clamp((K.xp - cur) / span, 0, 1), next };
}

/* ═══════════════════════════════════════════════════════════════════════════
   UPGRADES — the shop behind the level ladder
   ═══════════════════════════════════════════════════════════════════════════
   ⚠ NOT IN CONTRACT.md's EXPORT LIST, and this is the "say so" the contract
   asks for. kitchen.data.js ships a full `UPGRADES` table whose effects are
   already folded into slotsFor / cookMsFor / passCap / pantryCap / patienceMul /
   tipMul / popGainMul / laneCap / convoyCapacity — every one of which this file
   or a sibling already calls with an `owned` list. Something has to own buying
   them, and the owned list has to be SAVED, so it lands here with progression
   rather than being invented separately in render.

   The purchase itself is `buySupply`'s discipline verbatim: preflight every leg,
   take, unwind in reverse with refundRes/addGems on any failure. A shop that can
   half-charge you is worse than no shop.
   ═══════════════════════════════════════════════════════════════════════════ */
export function ownsUpgrade(id) { return (K.upgrades || []).indexOf(id) !== -1; }

export function buyUpgrade(upgradeId) {
  const find = DF('upgrade');
  const list = Array.isArray(DATA.UPGRADES) ? DATA.UPGRADES : [];
  const up = (find ? find(upgradeId) : null) || list.find((u) => u && u.id === upgradeId) || null;
  if (!up) return no('BAD_ARG', 'No such upgrade.');
  if (ownsUpgrade(up.id)) return no('BAD_ARG', 'You already own that.');
  if (_int(up.minLevel || 1) > K.level) return no('LOCKED', `${up.name || 'That'} unlocks at level ${_int(up.minLevel)}.`);
  if (up.requires && !ownsUpgrade(up.requires)) {
    const pre = (find ? find(up.requires) : null) || null;
    return no('LOCKED', `You need ${(pre && pre.name) || 'the previous upgrade'} first.`);
  }

  const res = spendCost(up.cost || {}, 1);
  if (!res.ok) return res;

  K.upgrades.push(up.id);
  // Slot counts change with capacity upgrades, so the rack is rebuilt — and it
  // is rebuilt PRESERVING what is cooking, because buying a third griddle lane
  // mid-rush must not bin the two patties already on it.
  regrowStations();
  K.rev++;
  emit('level:up', { from: K.level, to: K.level, unlocked: [up.id], upgrade: up.id });
  fx('buy', up.name || 'upgraded');
  save(true);
  return ok({ upgrade: up.id });
}

/** Resize the rack to the current upgrade set WITHOUT dropping live slots. */
function regrowStations() {
  const slotsFor = DF('slotsFor');
  for (const s of (Array.isArray(DATA.STATIONS) ? DATA.STATIONS : [])) {
    if (!s || !s.id) continue;
    const want = Math.max(1, _int(slotsFor ? slotsFor(s.id, K.upgrades) : (s.slots || 1)));
    const st = K.stations[s.id] || (K.stations[s.id] = { slots: [] });
    while (st.slots.length < want) st.slots.push(null);
    // Shrinking (never happens today — no upgrade removes a slot) would drop
    // whatever is on the tail, so it only ever trims EMPTY tail slots.
    while (st.slots.length > want && st.slots[st.slots.length - 1] === null) st.slots.pop();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OPEN / CLOSE THE SHIFT
   ═══════════════════════════════════════════════════════════════════════════ */

export function openShift(now) {
  if (K.shift.running) return false;
  const t = _num(now, K.now);
  K.now = t;
  clearService();
  // tMs 0 IS the opening bell — DATA.hourAt() maps 0..DAY_MS onto
  // OPEN_HOUR..CLOSE_HOUR, so there is no offset to apply here.
  K.shift.tMs = 0;
  K.shift.running = true;
  K.shift.rush = rushNow();
  K.today = { served: 0, lost: 0, burnt: 0, earned: 0, tips: 0, xp: 0 };
  K._report = null;
  K._nextCounter = t + EC('SHIFT_GRACE_MS', 4000);
  K.rev++;
  emit('shift:open', { day: K.shift.day, dayName: dayNameFor(K.shift.day) });
  return true;
}

/**
 * End the shift.
 *
 * TWO DIFFERENT ENDINGS, and the difference matters:
 *  • `{forfeit:true}` — the player closed the panel. Open tickets are dropped
 *    with NO popularity penalty and the day does NOT advance. They did not fail
 *    those customers; the session ended. Punishing this would train players to
 *    leave the tab open forever, which is worse for everyone including us.
 *  • no opts — the closing bell rang. Anyone still waiting walked out and it
 *    counts, the day advances, and a settlement report is emitted. THAT is the
 *    incentive to clear your board before close.
 */
export function closeShift(now, opts) {
  const t = _num(now, K.now);
  const o = opts || {};
  if (!K.shift.running && !o.force) {
    clearService();
    return false;
  }

  const openTickets = K.tickets.filter((x) => x.state === 'open' || x.state === 'ready');
  if (o.forfeit) {
    for (const x of openTickets) {
      x.state = 'lost';
      if (x.carId) releaseCar(x.carId, 'forfeit', t);
    }
    K.tickets = [];
  } else {
    for (const x of openTickets) loseTicket(x, 'closing', t);
  }

  const report = {
    day: K.shift.day,
    dayName: dayNameFor(K.shift.day),
    served: K.today.served,
    lost: K.today.lost,
    burnt: K.today.burnt,
    earned: K.today.earned,
    tips: K.today.tips,
    xp: K.today.xp,
    popularity: K.popularity,
    forfeit: !!o.forfeit,
    grade: gradeFor(K.today),
  };

  K.shift.running = false;
  clearService();

  if (!o.forfeit) {
    // A clean day (nobody walked out, somebody was served) is worth a nudge on
    // top of the per-ticket movement. It is the only reward for the LAST ticket
    // of the day, which otherwise pays the same as the first.
    // 🔴 POPULARITY DECAYS EVERY DAY. Without it a player who once had a great
    //    week coasts on it forever and the meter stops being a live signal. With
    //    it, staying famous is a thing you keep doing rather than a thing you
    //    did. A clean day (nobody walked out, somebody was served) more than
    //    cancels the decay, which is the point.
    bumpPop(EC('POP_DECAY_PER_DAY', -1.5), 'day-decay');
    if (report.lost === 0 && report.served > 0) bumpPop(-EC('POP_DECAY_PER_DAY', -1.5) * 2, 'clean-day');
    K.totals.days++;
    K.shift.day++;
    K.shift.tMs = 0;
    emit('day:roll', { day: K.shift.day, report });
  }

  K._report = report;
  K.rev++;
  emit('shift:close', { report, forfeit: !!o.forfeit });
  save(true);
  return true;
}

function gradeFor(today) {
  const total = today.served + today.lost;
  if (!total) return '—';
  const r = today.served / total;
  if (r >= 0.98 && today.burnt === 0) return 'S';
  if (r >= 0.9) return 'A';
  if (r >= 0.75) return 'B';
  if (r >= 0.55) return 'C';
  return 'D';
}

/** The last settlement report, for the end-of-day panel. */
export function lastReport() { return K._report; }

/** The dishes this kitchen may currently cook. */
export function menu() { return menuForLevel(K.level); }

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — ⏱ THE TICK. THE ONLY ADVANCE.
   ═══════════════════════════════════════════════════════════════════════════
   index.js owns the one RAF loop and calls this. Nothing in /src/kitchen may
   call requestAnimationFrame / setInterval / a simulation setTimeout.

   The order below is not arbitrary:
     1. clock          — everything downstream reads `now` and `rush`
     2. stations       — a pizza must be able to burn before the ticket it was
                         for expires, or you get "lost" without ever seeing why
     3. drive-thru     — cars arrive and lose patience
     4. counter spawn  — new walk-in tickets
     5. fill + expiry  — the pass feeds the board, then the board times out
     6. convoys        — independent of everything above
     7. save + drain
   ═══════════════════════════════════════════════════════════════════════════ */
export function tick(dt, now) {
  const t = _num(now, K.now);
  // Defensive clamp. index.js clamps too; this is belt AND braces because a
  // backgrounded tab hands you a 40-second dt, which would expire every ticket
  // on the board in one frame and floor popularity for something the player did
  // not do. Two clamps is cheap. One missing clamp is a ruined save.
  let step = _clamp(_num(dt, 16), 0, EC('MAX_DT_MS', 250));
  K.now = t;

  // 1. CLOCK
  if (K.shift.running) {
    // ⚠ A NON-FINITE tMs IS SILENT AND TOTAL. Every downstream test is a
    //    comparison (`tMs >= DAY_MS`), and every comparison against NaN is
    //    false — so the closing bell simply never rings, the day never rolls,
    //    and the shift runs forever with no error anywhere. Found by a harness
    //    that assigned `DAY_MS + undefined`. One guard, once per frame.
    if (!isFinite(K.shift.tMs)) K.shift.tMs = 0;
    K.shift.tMs += step;
    K.shift.rush = rushNow();
  }

  // 2. STATIONS
  tickStations(t);

  // 3. DRIVE-THRU (owns the lane; we only merge its events)
  if (K.shift.running && typeof DriveThru.tick === 'function') {
    try {
      const evs = DriveThru.tick(K, step, t);
      if (Array.isArray(evs)) for (const e of evs) if (e && e.name) K._events.push(e);
    } catch (e) { /* the lane failing must not stop the ovens */ }
  }

  // 4. WALK-INS
  if (K.shift.running && dayPctOf() < 1 && ECb('COUNTER_ENABLED', true)) {
    if (!K._nextCounter) K._nextCounter = t + counterIntervalMs();
    if (t >= K._nextCounter) {
      // Jitter, so arrivals do not arrive on a metronome. SPAWN_JITTER is the
      // fraction either side of the interval.
      const j = EC('SPAWN_JITTER', 0.25);
      K._nextCounter = t + counterIntervalMs() * (1 - j + rng() * 2 * j);
      spawnCounter(t);
    }
  }

  // 5. PASS → BOARD, THEN EXPIRY
  fillTickets(t);
  for (const ticket of Array.from(K.tickets)) {
    if ((ticket.state === 'open' || ticket.state === 'ready') && t > _num(ticket.dueAt, Infinity)) {
      // A drive ticket whose car is still in the lane belongs to drivethru.js's
      // patience model; we only reap it once that module has let the car go, so
      // the two systems cannot disagree about when a customer gave up.
      //
      // ⚠ …WITH A HARD BACKSTOP. Deferring to another module is right up until
      // that module has a bug, and then the deferral becomes an immortal ticket
      // that sits on the board forever and blocks the closing bell (which waits
      // for a clear board). Past dueAt + TICKET_HARD_GRACE_MS we reap it
      // ourselves regardless of what the lane thinks. Cooperation with a
      // deadline is the only kind worth having across a module boundary.
      const car = ticket.carId ? K.lane.find((c) => c && c.carId === ticket.carId) : null;
      const overdue = t - _num(ticket.dueAt, t);
      if (car && car.state !== 'gone' && typeof DriveThru.tick === 'function'
          && overdue < EC('TICKET_HARD_GRACE_MS', 20000)) continue;
      loseTicket(ticket, 'timeout', t);
    }
  }

  // Pantry warning, latched so a low bin does not scream every frame.
  if (K.shift.running) {
    for (const id of pantryLowList()) {
      if (!K._lowSeen[id]) {
        K._lowSeen[id] = true;
        emit('pantry:low', { ing: id, have: _int(K.pantry[id]) });
      }
    }
  }

  // Closing bell. Spawning already stopped at CLOSE_HOUR; the shift itself ends
  // once the board is clear, or when the last-call grace runs out — whichever
  // comes first. Ending the instant the clock strikes would bin food the player
  // is thirty seconds from serving, which reads as theft.
  if (K.shift.running && K.shift.tMs >= EC('DAY_MS', 720000)) {
    const busy = K.tickets.some((x) => x.state === 'open' || x.state === 'ready')
      || K.lane.some((c) => c && c.state !== 'gone');
    const past = K.shift.tMs - EC('DAY_MS', 720000);
    if (!busy || past >= EC('LAST_CALL_MS', 45000)) closeShift(t);
  }

  // 6. CONVOYS — the one system that also advances while the panel is shut.
  if (typeof Convoy.tick === 'function') {
    try {
      const evs = Convoy.tick(K, step, t);
      if (Array.isArray(evs)) for (const e of evs) if (e && e.name) K._events.push(e);
    } catch (e) {}
  }

  // 7. SAVE (debounced — never every tick) + DRAIN
  save(false);
  const drained = K._events;
  K._events = [];
  return drained;
}

/** Station timers. Emission latches turn a continuous condition into an edge. */
function tickStations(t) {
  for (const stationId of Object.keys(K.stations)) {
    const st = K.stations[stationId];
    if (!st || !st.slots) continue;
    for (let i = 0; i < st.slots.length; i++) {
      const slot = st.slots[i];
      if (!slot) continue;
      const phase = slotPhase(slot, t);
      if (!slot.nDone && (phase === 'done' || phase === 'burnt')) {
        slot.nDone = true;
        K.rev++;
        emit('cook:done', { stationId, slot: i, recipeId: slot.recipeId, burnAt: slot.burnAt });
      }
      if (!slot.nBurn && phase === 'burnt') {
        slot.nBurn = true;
        K.rev++;
        K.today.burnt++;
        K.totals.burnt++;
        bumpPop(EC('POP_BURN', -1.5), 'burnt');
        emit('cook:burnt', { stationId, slot: i, recipeId: slot.recipeId });
        fx('burn', 'burnt!', { stationId, slot: i });
      }
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §11 — THE HEADLESS HARNESS
   ═══════════════════════════════════════════════════════════════════════════
   Required, not optional. This is how a whole in-game day gets played without a
   browser, and it is the reason every rule at the top of this file exists: no
   DOM, no wall clock, `now` as a parameter, deterministic RNG.

   It also POLICES the invariants the contract names — popularity inside 0..100,
   no negative pantry, no throw — and reports violations instead of asserting,
   so one broken frame produces a diagnosis rather than a stack trace.
   ═══════════════════════════════════════════════════════════════════════════ */

const SIM_EPOCH = 1700000000000;   // an arbitrary fixed epoch; the sim only ever
                                   // uses differences, so the value is cosmetic.

/**
 * @param {number} seconds  wall-seconds of simulated time
 * @param {Array|Function} actions
 *        Either a list of `{at:<seconds>, do:'startCook'|…, args:[…]}` or a
 *        function `(api, K, tSec, now) => void` invoked every step.
 * @param {object} opts  { step, seed, autoOpen, auto, quiet }
 *        `auto:true` runs a naive bot — cook whatever a ticket wants, pull it
 *        the moment it is done, plate, serve — which is enough to prove the loop
 *        closes end-to-end without anyone writing a script.
 */
export function simulate(seconds, actions, opts) {
  const o = opts || {};
  const stepMs = Math.max(1, _int(o.step || 100));
  const total = Math.max(0, Math.round(_num(seconds, 0) * 1000));
  let t = SIM_EPOCH;

  if (o.seed != null) seed(o.seed);
  init();
  K.now = t;
  if (o.autoOpen !== false) openShift(t);

  const api = {
    startCook, pullSlot, dropHand, plateHand, serveTicket, buySupply,
    addStep, buyUpgrade, openShift, closeShift, pantryHas, K,
  };
  const queue = Array.isArray(actions)
    ? actions.slice().sort((a, b) => _num(a.at, 0) - _num(b.at, 0))
    : [];
  const each = (typeof actions === 'function') ? actions : null;

  const report = {
    ticks: 0, events: [], counts: {}, violations: [], errors: [],
    days: 0, served: 0, lost: 0, burnt: 0, earned: 0, tips: 0,
  };
  let qi = 0;

  for (let elapsed = 0; elapsed < total; elapsed += stepMs) {
    t += stepMs;
    const tSec = elapsed / 1000;

    // scheduled actions
    while (qi < queue.length && _num(queue[qi].at, 0) <= tSec) {
      const a = queue[qi++];
      try {
        if (typeof a.fn === 'function') a.fn(api, K, t);
        else if (a.do && typeof api[a.do] === 'function') api[a.do].apply(null, (a.args || []).concat([t]));
      } catch (e) { report.errors.push(String((e && e.message) || e)); }
    }
    if (each) { try { each(api, K, tSec, t); } catch (e) { report.errors.push(String((e && e.message) || e)); } }
    if (o.auto) { try { autopilot(t); } catch (e) { report.errors.push(String((e && e.message) || e)); } }

    let evs = [];
    try { evs = tick(stepMs, t) || []; }
    catch (e) { report.errors.push('tick: ' + String((e && e.message) || e)); break; }
    report.ticks++;

    for (const ev of evs) {
      report.counts[ev.name] = (report.counts[ev.name] || 0) + 1;
      if (!o.quiet) report.events.push(ev);
      if (ev.name === 'day:roll') report.days++;
    }

    // ── INVARIANTS (§11) ──────────────────────────────────────────────────
    if (!(K.popularity >= 0 && K.popularity <= 100)) {
      report.violations.push(`popularity out of range at ${tSec.toFixed(1)}s: ${K.popularity}`);
      K.popularity = _clamp(_num(K.popularity, 50), 0, 100);
    }
    for (const id of Object.keys(K.pantry)) {
      if (K.pantry[id] < 0) {
        report.violations.push(`pantry ${id} negative at ${tSec.toFixed(1)}s: ${K.pantry[id]}`);
        K.pantry[id] = 0;
      }
    }
    if (K._fx.length > 64) report.violations.push('fx buffer leaked past 64 entries');
  }

  report.served = K.today.served; report.lost = K.today.lost;
  report.burnt = K.today.burnt; report.earned = K.today.earned; report.tips = K.today.tips;
  report.pantry = Object.assign({}, K.pantry);
  report.popularity = K.popularity;
  report.level = K.level;
  report.xp = K.xp;
  report.ok = report.violations.length === 0 && report.errors.length === 0;
  return report;
}

/**
 * The naive bot `simulate({auto:true})` drives. It is deliberately DUMB — it
 * cooks the first thing a ticket wants that it can afford and pulls the instant
 * a slot is done. If a dumb bot can keep the board moving, the loop closes; if a
 * dumb bot cannot, the loop is not a game yet, it is a punishment.
 */
function autopilot(now) {
  // pull anything that is ready (or ruined), plate it, bin what is burnt
  if (!K.hand) {
    outer: for (const sid of Object.keys(K.stations)) {
      const st = K.stations[sid];
      for (let i = 0; i < st.slots.length; i++) {
        const ph = slotPhase(st.slots[i], now);
        if (ph === 'done' || ph === 'burnt') { pullSlot(sid, i, now); break outer; }
      }
    }
  }
  if (K.hand) {
    if (K.hand.quality === 'burnt') dropHand();
    else plateHand(now);
  }

  // serve anything ready
  const ready = K.tickets.find((x) => x.state === 'ready');
  if (ready) serveTicket(ready.id, now);

  // start whatever the board is short of
  const wanted = [];
  for (const ticket of K.tickets) {
    if (ticket.state !== 'open') continue;
    for (const it of ticket.items) {
      const onPass = K.pass.filter((d) => d.recipeId === it.recipeId).length;
      const cooking = countCooking(it.recipeId);
      if (it.filled + onPass + cooking < it.qty) wanted.push(it.recipeId);
    }
  }
  for (const recipeId of wanted) {
    const r = recipeOf(recipeId);
    if (!r) continue;
    const st = K.stations[r.station];
    if (!st) continue;
    const free = st.slots.findIndex((s) => !s);
    if (free === -1) continue;
    const res = startCook(r.station, free, recipeId, now);
    if (res.ok) break;                    // one per step: a human has two hands
  }
}

function countCooking(recipeId) {
  let n = 0;
  for (const sid of Object.keys(K.stations)) {
    for (const slot of K.stations[sid].slots) if (slot && slot.recipeId === recipeId) n++;
  }
  return n;
}
