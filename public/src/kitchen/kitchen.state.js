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

  /* Reset by openShift(). `turned` counts walk-ins turned away at a full board
     (they also count in `lost`); `qsum`/`qunits` are the quality mix the day's
     GRADE is computed from — see gradeFor(). */
  today:  { served: 0, lost: 0, burnt: 0, turned: 0, earned: 0, tips: 0, xp: 0, qsum: 0, qunits: 0, raw: 0, perfect: 0 },
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
  const base = f ? _num(f(K.shift.tMs), 1) : 1;
  /* 🔴 DEMAND SCALES WITH THE KITCHEN, AND IT IS APPLIED HERE ON PURPOSE.
     `K.shift.rush` is the ONE number both spawners read — this file's
     counterIntervalMs() and drivethru.js's laneIntervalMs() — so scaling it here
     is the only place the lane and the counter cannot end up disagreeing about
     how busy the restaurant is. See ECON.DEMAND_* for why a level-1 hot dog
     stand must not draw a level-12 crowd (it made the tutorial a 3.3× wall). */
  const g = DF('demandScale');
  const scale = g ? _num(g(K.level), 1) : 1;
  return _clamp(base * scale, 0.05, 10);
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
  K.today = { served: 0, lost: 0, burnt: 0, turned: 0, earned: 0, tips: 0, xp: 0, qsum: 0, qunits: 0, raw: 0, perfect: 0 };
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
  K.today = { served: 0, lost: 0, burnt: 0, turned: 0, earned: 0, tips: 0, xp: 0, qsum: 0, qunits: 0, raw: 0, perfect: 0 };
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
  /* 🔴 REFUSING THE SAVED `level` AND THEN TRUSTING THE SAVED `xp` CLOSED
        NOTHING. The comment below is right about why a saved level cannot be
        trusted — and the previous version stopped there, took `xp` verbatim and
        derived the level from it, so a save carrying `xp: "999999999"` hydrated
        straight to level 40 with the whole menu and every supply line open. The
        door was locked and the window next to it was open.
        This is NOT a security boundary — the save is local and a determined
        player owns their own machine — but a guard that only half-works is worse
        than no guard, because the comment above it claims the job is done.
        Clamping to the top of the ladder costs one line and makes the claim true. */
  const xpMax = xpForLevel(EC('MAX_LEVEL', 40));
  K.xp = _clamp(Math.max(0, _int(s.xp)), 0, xpMax);
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

  /* ⚠ AND THE SAME HOLE EXISTED IN THE UPGRADE LIST. Filtering on
     `typeof === 'string'` let ANY id survive forever, so a hand-edited save
     naming an upgrade granted its effect (every helper in kitchen.data.js reads
     the owned list by id and never asks whether the id is real). Resolving each
     id against DATA.upgrade() drops both hand-edits and, usefully, ids from a
     future build the player has rolled back from — which would otherwise sit in
     the save granting a slot count this version cannot draw.
     Duplicates go too: `_sumEffect` adds a slot per OCCURRENCE, so a save with
     the same id twice bought a lane it never paid for. */
  const upSeen = Object.create(null);
  K.upgrades = (Array.isArray(s.upgrades) ? s.upgrades : []).filter((u) => {
    if (typeof u !== 'string' || upSeen[u]) return false;
    const f = DF('upgrade');
    if (f && !f(u)) return false;
    upSeen[u] = 1;
    return true;
  });

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

/** Every unit in the pantry, across every bin. THE number ECON.PANTRY_CAP caps
    (see buySupply) — the cap is deliberately on the room in the back, not on the
    size of any one shelf, because a walk-in cooler does not care what is in it. */
function pantryTotal() {
  let n = 0;
  for (const id of Object.keys(K.pantry)) n += _int(K.pantry[id]);
  return n;
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

  /* 🔴 THE PANTRY IS CAPPED (ECON.PANTRY_CAP, plus upgrades) AND THE CHECK GOES
        HERE, IN THE PREFLIGHT — never as a clamp after payment. Clamping would
        charge full price for units that never landed, which is the same class of
        bug as the addRes() stash-cap trap in §7: the money leaves, the goods do
        not, and nothing on screen says so.

     🔴 THE CAP IS A TOTAL ACROSS THE WHOLE PANTRY, AND IT USED NOT TO BE.
        kitchen.data.js has always documented PANTRY_CAP as "TOTAL units across
        all ingredients"; this check compared ONE BIN against it. Measured: a bot
        buying every supply line to refusal banked 13,044 units across 25 bins,
        21.7× the documented cap, each bin stopping neatly at 600. Since a day
        burns roughly 30 units of any one ingredient, 600-per-bin was twenty
        shifts of stock — restocking stopped being a mid-shift decision after the
        first visit, and up_walkin + up_walkin2 (198,000 Cinder between them,
        "Buy the week, not the hour") sold headroom that was never scarce.
        The comment was right and the code was wrong, which is the dangerous way
        round: it read as verified. Summing is the fix, and the refusal message
        names the TOTAL so the player can see which number bound. */
  const capFn = DF('pantryCap');
  const pcap = Math.max(1, _int(capFn ? capFn(K.upgrades) : EC('PANTRY_CAP', 900)));
  const total = pantryTotal();
  const after = total + _int(out.qty) * n;
  if (after > pcap) {
    const room = Math.max(0, pcap - total);
    return no('CAP', `Pantry full — ${total.toLocaleString()} of ${pcap.toLocaleString()} units stored, room for ${room.toLocaleString()} more. Cook some of it down or buy a bigger cooler.`);
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

  /* 🔴 A BURN PULLED OFF THE SURFACE STILL COUNTS AS A BURN, AND IT USED NOT TO.
     `tickStations()` latches the burn when the slot CROSSES burnAt. But every
     bot — and every fast player — pulls the slot in the same frame it goes
     black, and `pullSlot` runs before `tick()` does. The slot was set to null,
     the latch never fired, and the ruined dish cost the player nothing at all:
     no POP_BURN, no `today.burnt`, no `cook:burnt` event, no toast.
     Measured, this is why a reaction-lag sweep from 0 to 20 SECONDS reported
     `burnt=0` at every single step while the food was demonstrably being binned.
     The burn is a fact about the DISH, not about which code path noticed it, so
     it is charged here too — once, guarded by the same latch, so a slot that
     already burned on the clock is not charged twice. */
  if (quality === 'burnt' && !slot.nBurn) {
    slot.nBurn = true;
    K.today.burnt++;
    K.totals.burnt++;
    bumpPop(EC('POP_BURN', -1.2), 'burnt');
    emit('cook:burnt', { stationId, slot: i, recipeId: slot.recipeId, pulled: true });
    fx('burn', 'burnt!', { stationId, slot: i });
  }

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
 * REF-A shows. Plating does NOT serve anybody: the plate sits under the lamp,
 * lights up the pips on every ticket that wants one, and only leaves when the
 * player hands an order over (see THE PASS block below, and serveTicket).
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
  const cap = Math.max(1, _int(capFn ? capFn(K.upgrades) : EC('PASS_CAP', 8)));
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
    filled: 0,  // ⚠ PROVISIONAL until the ticket is served: it is "how much of
                //   this line the pass can cover right now", rewritten every
                //   tick by refreshReady(). takeDishes() freezes it at serve.
    qsum: 0,
    xn: 0,      // units that earn XP at all (raw ones do not)
    pn: 0,      // units that were PERFECT — they earn XP_PERFECT_MULT
    rn: 0,      // units that were RAW — they COST popularity (ECON.POP_RAW)
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
/**
 * 🔴 THE SILENT OVERFLOW VALVE, AND WHY IT WAS THE WORST BUG IN THE FEATURE.
 *
 * This used to be `if (openTickets >= cap) return null;` — and that one line
 * inverted the entire feedback loop the game is built on. A walk-in who arrived
 * while the board was full was discarded with no event, no popularity cost and
 * no lost sale, while `_nextCounter` had already been rolled forward, so the
 * arrival was consumed as well. Measured on a level-12 stock kitchen at expert
 * play, the board sat pinned at the cap for 13.7% of the day: every one of those
 * frames was a customer THE GAME DECIDED NOT TO SEND. The punishment for
 * drowning was fewer customers. Falling behind made the shift EASIER.
 *
 * Overload must express as PRESSURE, never as demand suppression. So a walk-in
 * who cannot fit is a TURN-AWAY: they came in, looked at a board you have not
 * cleared, and left. It costs ECON.POP_TURNAWAY reputation, it counts in
 * `today.lost` so it reaches gradeFor() and the settlement report, and it emits
 * a `ticket:lost` the renderer already knows how to toast.
 *
 * ⚠ IT IS A `ticket:lost`, NOT A NEW EVENT NAME. CONTRACT §6 fixes a closed set
 *   of event names and this file does not get to widen it unilaterally; a lost
 *   sale is exactly what this is, and `why:'turned-away'` carries the detail for
 *   anyone who wants to draw it differently. `ticketId` is null because there
 *   never was a ticket — render's toast path takes the name, not the id.
 *
 * ⚠ IT IS NOT `waveCar`'s POP_WAVE EITHER. Waving someone off is a DECISION the
 *   player made; this is a consequence they let happen. Different sizes,
 *   different lessons, different constants.
 */
function turnAway(now, why) {
  K.today.lost++;
  K.totals.lost++;
  K.today.turned = _int(K.today.turned) + 1;
  bumpPop(EC('POP_TURNAWAY', -1.0), 'turned-away');
  K.rev++;
  emit('ticket:lost', { ticketId: null, source: 'counter', carId: null, why: why || 'turned-away', turnedAway: true });
  fx('lost', 'no room', {});
  return null;
}

function spawnCounter(now) {
  const cap = _int(EC('TICKET_CAP', 12));
  const openTickets = K.tickets.filter((x) => x.state === 'open' || x.state === 'ready').length;
  if (openTickets >= cap) return turnAway(now, 'board-full');

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

/* ═══════════════════════════════════════════════════════════════════════════
   🍽 THE PASS — plating and serving are TWO decisions
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE PASS USED TO BE A PIPE AND IT HAD TO STOP BEING ONE.
   The first build ran `fillTickets()` inside `tick()`: the instant a dish was
   plated it was moved into the nearest-due ticket and the pass was empty again.
   Measured over a full day — max pass depth 2 of 6, MEAN PLATE AGE 0.0 SECONDS,
   and zero of 276 plate-frames past the freshness line. PASS_FRESH_MS,
   PASS_STALE_MULT and the entire 34,000-Cinder `up_heatlamp` (passAdd:4,
   freshMul:1.6) were constants describing a mechanic that could not occur.
   REF-A's defining image — a row of finished pizzas SITTING on the pass while
   the cook works the next order — had no mechanical existence at all.

   THE FIX, and note what it deliberately does NOT do:
     • `refreshReady()` runs every tick and only LOOKS. It assigns the plates on
       the pass to the tickets that want them, nearest due date first, writes
       `item.filled` so the ticket's pips light up as food lands, and flips a
       fully-covered ticket to 'ready'. Nothing moves.
     • `takeDishes()` runs inside `serveTicket()` and COMMITS: that is the tap
       where the food leaves the pass, and it is where staleness is priced,
       because staleness is a property of the moment you hand it over.
   So a plate genuinely sits under the lamp, and cooking ahead into the 16:00
   lull is a real strategy with a real decay attached to it.

   ⚠ STILL REJECTED: making the player drag each dish onto a ticket by hand. At
   360px that is a fiddly drag-and-drop nightmare on a touch screen, and the fun
   in this genre lives in the cooking and the clock, not in the clerical work.
   The player decides WHEN an order goes out, not which physical burger is in it.

   ⚠ NEAREST DUE DATE HAS FIRST CLAIM, even on a ticket it does not complete.
   The alternative — give each dish to whichever ticket it finishes — reads as
   clever and plays as chaos: the board's order stops matching the board's
   countdown and the player can no longer predict what pressing SERVE will do.
   Oldest dish first within that, because food does not improve on the pass. */

/**
 * The heat lamp. A dish left on the pass past PASS_FRESH_MS is worth
 * PASS_STALE_MULT of itself.
 *
 * ⚠ REVERSED A REJECTION. An earlier draft of this file dismissed pass decay as
 * "too much complexity". kitchen.data.js ships PASS_FRESH_MS/PASS_STALE_MULT, and
 * it is right: without it, cooking a hundred burgers during the quiet hour and
 * coasting through the dinner rush is strictly optimal, which deletes the rush —
 * the one part of the day the whole design is built around. (It was also, until
 * the pass stopped being a pipe, completely unreachable code.)
 */
function stalenessMul(dish, now) {
  const f = DF('passFreshMs');
  const fresh = _num(f ? f(K.upgrades) : EC('PASS_FRESH_MS', 45000), 45000);
  if (fresh <= 0) return 1;
  const age = _num(now, K.now) - _num(dish.madeAt, 0);
  return age > fresh ? EC('PASS_STALE_MULT', 0.6) : 1;
}

/** How stale, 0..1, for the renderer's plate timer. 1 = past the line. */
export function passStalePct(dish, now) {
  const f = DF('passFreshMs');
  const fresh = _num(f ? f(K.upgrades) : EC('PASS_FRESH_MS', 45000), 45000);
  if (fresh <= 0) return 0;
  return _clamp((_num(now, K.now) - _num(dish && dish.madeAt, 0)) / fresh, 0, 1);
}

/**
 * 🔴 SPOILAGE — the pass's own escape valve, and it is load-bearing.
 * Runs every tick, before refreshReady().
 *
 * A ticket that times out leaves its plates behind (see loseTicket), and nothing
 * else on the board may want them. With a hard PASS_CAP those orphans are
 * permanent: measured, the pass filled with eight of them, sat at cap for 77% of
 * the day, and because a full pass makes `plateHand` refuse, the player's HAND
 * jammed too and every slot on the rack burned down behind it. A dead board with
 * no player action that can clear it is a soft lock, not a difficulty spike.
 *
 * There IS a player action now (`binPass`), but the game must not depend on the
 * player knowing to use it, and food two minutes under a lamp is bin food in any
 * real kitchen anyway. So it bins itself.
 *
 * ⚠ NO POPULARITY COST. Nobody was served a spoiled plate — it never left the
 *   pass. The ingredients and the slot time are the price, and they are real.
 *   It counts in `today.burnt` because waste should still cost you the S grade.
 */
function spoilPass(now) {
  if (!K.pass.length) return;
  const f = DF('passSpoilMs');
  const life = _num(f ? f(K.upgrades) : EC('PASS_SPOIL_MS', 100000), 100000);
  if (!(life > 0)) return;
  for (let i = K.pass.length - 1; i >= 0; i--) {
    const d = K.pass[i];
    if (!d || (_num(now, K.now) - _num(d.madeAt, now)) < life) continue;
    K.pass.splice(i, 1);
    K.today.burnt++;
    K.totals.burnt++;
    K.rev++;
    emit('cook:burnt', { stationId: null, slot: -1, recipeId: d.recipeId, spoiled: true });
    fx('burn', 'binned — cold', { recipeId: d.recipeId });
  }
}

/**
 * Bin one plate off the pass by hand. Not in CONTRACT §1's export list, and
 * this is the "say so" the contract asks for — it wants adding to §1 and it
 * wants a tap target on the plate in kitchen.render.js.
 *
 * WHY IT EXISTS EVEN THOUGH spoilPass() ALREADY UNJAMS THE PASS: waiting two
 * minutes for a wrong dish to rot while the dinner rush runs is a punishment
 * with no decision in it. Binning it is the decision — you paid for it, you
 * choose whether the space is worth more than the food.
 */
export function binPass(dishId) {
  const i = K.pass.findIndex((d) => d && d.id === dishId);
  if (i === -1) return no('BAD_ARG', 'That plate is not on the pass.');
  const d = K.pass.splice(i, 1)[0];
  K.today.burnt++;
  K.totals.burnt++;
  K.rev++;
  emit('cook:burnt', { stationId: null, slot: -1, recipeId: d.recipeId, spoiled: true, binned: true });
  fx('bin', 'binned', { recipeId: d.recipeId });
  return ok({ recipeId: d.recipeId });
}

/**
 * LOOK, DO NOT TOUCH. Runs every tick.
 * Writes `item.filled` (how much of that line the pass can currently cover) and
 * flips tickets between 'open' and 'ready'. It moves nothing and it charges
 * nothing — `takeDishes()` does both, at the moment the player serves.
 *
 * 🔴 A TICKET CAN GO BACK TO 'open'. If a nearer-due order takes the last
 * burger, a ticket that was 'ready' a frame ago is not any more, and the SERVE
 * button has to disappear rather than sit there promising something the pass
 * cannot deliver. The transition is two-way on purpose.
 */
function refreshReady(now) {
  const board = K.tickets
    .filter((x) => x.state === 'open' || x.state === 'ready')
    .sort((a, b) => _num(a.dueAt) - _num(b.dueAt));
  if (!board.length) return;
  const used = Object.create(null);          // pass dish id → provisionally spoken for

  for (const ticket of board) {
    let complete = true;
    for (const item of ticket.items) {
      const need = Math.max(0, _int(item.qty));
      let got = 0;
      for (let i = 0; i < K.pass.length && got < need; i++) {
        const d = K.pass[i];
        if (!d || used[d.id] || d.recipeId !== item.recipeId) continue;
        used[d.id] = 1;
        got++;
      }
      if (got !== _int(item.filled)) { item.filled = got; K.rev++; }
      if (got < need) complete = false;
    }
    const want = complete ? 'ready' : 'open';
    if (ticket.state !== want) {
      ticket.state = want;
      K.rev++;
      if (want === 'ready') {
        emit('ticket:ready', { ticketId: ticket.id, source: ticket.source, carId: ticket.carId });
      }
    }
  }
}

/**
 * COMMIT. Takes this ticket's dishes off the pass and prices them.
 * → the array of dishes taken, or null if the pass cannot cover it (in which
 *   case NOTHING is taken — the two-phase shape below is the whole point).
 *
 * `qsum` is the SUM of quality multipliers of the units handed over, and
 * staleness is applied HERE rather than at plating time because a plate's age is
 * a property of the instant it reaches the customer, not of when it was made.
 */
function takeDishes(ticket, now) {
  const plan = [];
  const spoken = Object.create(null);
  for (const item of ticket.items) {
    const need = Math.max(0, _int(item.qty));
    const mine = [];
    for (let i = 0; i < K.pass.length && mine.length < need; i++) {
      const d = K.pass[i];
      if (!d || spoken[d.id] || d.recipeId !== item.recipeId) continue;
      spoken[d.id] = 1;
      mine.push(d);
    }
    if (mine.length < need) return null;     // ← refuse before touching anything
    plan.push([item, mine]);
  }

  const taken = [];
  for (const [item, mine] of plan) {
    item.filled = 0; item.qsum = 0; item.xn = 0; item.pn = 0; item.rn = 0;
    for (const d of mine) {
      const idx = K.pass.indexOf(d);
      if (idx !== -1) K.pass.splice(idx, 1);
      item.filled++;
      item.qsum += _num(d.mult, 1) * stalenessMul(d, now);
      if (d.quality === 'raw') item.rn++; else item.xn++;
      if (d.quality === 'perfect') item.pn++;
      taken.push(d);
    }
  }
  K.rev++;
  return taken;
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

  /* 🔴 THE FOOD LEAVES THE PASS HERE AND NOWHERE ELSE. `refreshReady()` only
     looked; this is the commit, and it can still fail — a nearer-due order
     served a frame ago may have taken the last burger out from under this one.
     takeDishes() refuses without touching the pass in that case, and the ticket
     drops back to 'open' so the SERVE button stops promising what is not there. */
  const taken = takeDishes(ticket, t);
  if (!taken) {
    if (ticket.state === 'ready') { ticket.state = 'open'; K.rev++; }
    return no('NOT_READY', 'The pass no longer has everything that order needs.');
  }

  let gross = 0, xp = 0, units = 0, qsum = 0, perfects = 0, raws = 0, popScore = 0;
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
    raws += _int(it.rn);

    /* 🔴 REPUTATION IS SIGNED, PER UNIT, AND WEIGHTED BY `recipe.pop`.
       Both halves of that fix a measured failure.
       SIGNED: a bot that served 195 consecutive RAW dishes — half price, no xp,
       visibly undercooked — finished the day at popularity 100.0 with an S grade
       and a profit, because the old gain was a flat POP_SERVE per ticket with no
       downside at all. Serving slop was the fastest route to a perfect rating.
       WEIGHTED: every recipe has carried a `pop` weight (1.0 for a hot dog, 1.4
       for a Supreme) and kitchen.data.js has always documented POP_SERVE as
       "× recipe.pop" — and nothing in the feature read it. A Fountain Soda and a
       Supreme moved the reputation meter by exactly the same amount, so the
       expensive tier had no word-of-mouth reason to exist. One multiply. */
    const perUnit = EC('POP_SERVE', 0.6);
    const good = Math.max(0, it.xn - it.pn);
    popScore += _num(r.pop, 1) * (
        good * perUnit
      + it.pn * (perUnit + EC('POP_PERFECT_BONUS', 0.4))
      + _int(it.rn) * EC('POP_RAW', -0.8)
    );
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
  if (onTime && units > 0) xp += _int(EC('XP_TICKET_BONUS', 6));

  const avgQ = units > 0 ? (qsum / units) : 0;
  const tip = tipFor(ticket, avgQ, t, payout);

  // Day tallies the GRADE reads. `qsum`/`qunits` are the quality mix; without
  // them gradeFor() can only see whether food arrived, which is how a raw-spam
  // bot used to finish on an S. See gradeFor().
  K.today.qsum = _num(K.today.qsum, 0) + qsum;
  K.today.qunits = _int(K.today.qunits) + units;
  K.today.raw = _int(K.today.raw) + raws;
  K.today.perfect = _int(K.today.perfect) + perfects;

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

  /* Popularity: the MEAN of the per-unit scores summed above, times the
     upgrade multiplier.
     ⚠ MEAN, NOT SUM, and that is a design decision rather than an arithmetic
     one. Summing would make a five-dish Vault Family order move reputation five
     times as far as a hot dog, which turns word-of-mouth into a function of
     order SIZE rather than of how well you cooked. A ticket is one reputation
     event; what was in it decides which way it goes and how far.
     🔴 popGainMul() only multiplies a GAIN. Applying a 1.35× signage bonus to a
     negative score would make the Roadside Sign punish you harder for slop,
     which is a trap dressed as an upgrade — you would be strictly worse off for
     having bought it. Penalties are never scaled by a purchase. */
  const gainFn = DF('popGainMul');
  const popRaw = units > 0 ? (popScore / units) : 0;
  const popGain = popRaw > 0 ? popRaw * _num(gainFn ? gainFn(K.upgrades) : 1, 1) : popRaw;
  bumpPop(popGain, 'served');
  addXp(xp);

  emit('pay', { ticketId: ticket.id, paid: payout, tip });
  emit('ticket:served', { ticketId: ticket.id, source: ticket.source, carId: ticket.carId, paid: payout, tip, xp, quality: avgQ, raw: raws, perfect: perfects, pop: popGain, onTime });
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

  /* ⚠ THE FOOD SURVIVES THE CUSTOMER, and that is deliberate. Since the pass
     stopped being a pipe (see THE PASS), a ticket never holds physical dishes —
     `item.filled` was only ever a claim on plates that are still sitting under
     the lamp. So a walk-out costs the sale, the reputation and the clock, and
     leaves you holding food that is now ageing toward PASS_STALE_MULT with
     nobody to sell it to. That is a better punishment than binning it, because
     it is one the player can still partly recover from. */
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
  K.today = { served: 0, lost: 0, burnt: 0, turned: 0, earned: 0, tips: 0, xp: 0, qsum: 0, qunits: 0, raw: 0, perfect: 0 };
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
    turned: _int(K.today.turned),
    raw: _int(K.today.raw),
    perfect: _int(K.today.perfect),
    // Mean quality multiplier of everything handed over, on the ECON.Q_* scale.
    quality: _int(K.today.qunits) > 0 ? Math.round((K.today.qsum / K.today.qunits) * 100) / 100 : 0,
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

/**
 * The day's grade.
 *
 * 🔴 IT USED TO READ ONLY served/(served+lost) AND `burnt === 0`, WHICH MEANT
 * QUALITY DID NOT EXIST. A bot that served 195 consecutive RAW dishes finished
 * on an S: every ticket went out complete and on time, nothing burned, and the
 * grade had no way to notice that every plate was half-cooked. "Did food arrive"
 * is a delivery metric, not a cooking one, and this is a cooking game.
 *
 * So the grade is now two axes and the WORSE one wins:
 *   SERVICE  — the share of custom you actually served. Turn-aways count in
 *              `lost`, so drowning shows up here even though no ticket existed.
 *   KITCHEN  — the mean quality multiplier of everything handed over, on the
 *              same scale as ECON.Q_* (raw 0.5, good 1.0, perfect 1.25).
 * Taking the worse of the two is what makes both real: a perfect service record
 * built out of raw food cannot buy an A, and neither can flawless cooking for
 * the six customers you did not turn away.
 *
 * An S additionally requires a clean sheet — nothing burnt — because S is the
 * "you did not put a foot wrong" grade and a bin full of charcoal is a foot
 * wrong even if the customer never saw it.
 */
function gradeFor(today) {
  const total = _int(today.served) + _int(today.lost);
  if (!total) return '—';
  const service = _int(today.served) / total;
  const units = _int(today.qunits);
  // No units served → no kitchen evidence either way, so service alone decides.
  const meanQ = units > 0 ? (_num(today.qsum, 0) / units) : EC('Q_GOOD', 1);

  const SCALE = ['D', 'C', 'B', 'A', 'S'];
  let svc = 0;
  if (service >= 0.98) svc = 4;
  else if (service >= 0.90) svc = 3;
  else if (service >= 0.75) svc = 2;
  else if (service >= 0.55) svc = 1;

  const good = EC('Q_GOOD', 1), raw = EC('Q_RAW', 0.5);
  let kit = 0;
  if (meanQ >= good + (EC('Q_PERFECT', 1.25) - good) * 0.5) kit = 4;   // ≥ half-perfect
  else if (meanQ >= good * 0.98) kit = 3;                              // essentially all good
  else if (meanQ >= good - (good - raw) * 0.35) kit = 2;               // a sloppy minority
  else if (meanQ >= good - (good - raw) * 0.70) kit = 1;
  const grade = Math.min(svc, kit);

  if (grade === 4 && _int(today.burnt) > 0) return SCALE[3];
  return SCALE[grade];
}

/** The last settlement report, for the end-of-day panel. */
export function lastReport() { return K._report; }

/** The dishes this kitchen may currently cook. */
export function menu() { return menuForLevel(K.level); }

/* ═══════════════════════════════════════════════════════════════════════════
   ⏱⏱ THE GAP FRAME — dropped time, dropped by EVERY clock
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE CLAMP ON ITS OWN PROTECTED NOTHING, AND THE COMMENT ABOVE IT SAID IT
      DID, WHICH IS THE WORST VERSION OF THIS BUG.

   ECON.MAX_DT_MS caps how much simulation one frame may advance. But only
   `shift.tMs` was ever advanced from that clamped step. Every DEADLINE in the
   kitchen — `doneAt`, `burnAt`, `dueAt`, `madeAt`, the lane's `balkAt` and
   `expiresAt`, `_nextCounter` — is an ABSOLUTE stamp compared against `now`, and
   `now` is the wall clock, which had jumped the whole forty seconds. Measured on
   one 300,000ms frame after a five-minute background stall: two slots burnt,
   four tickets lost, 16.4 popularity gone — while the HUD clock sat frozen at
   15:00 because `tMs` had moved 250ms. The player came back to precisely the
   dead restaurant the clamp was written to prevent, and the shift clock lied
   about it afterwards.

   THE HONEST RULE, and it is one sentence: **DROPPED TIME IS DROPPED FOR
   EVERYTHING.** If the sim only advanced 250ms of a 40,000ms frame, then 39,750ms
   did not happen, and nothing in the kitchen may have aged by it. The alternative
   rules were both considered and both are worse:
     • "let it all run" — the browser decides how much of your shift you lose by
       how aggressively it throttles a background tab. Unwinnable and unfair, and
       it is the behaviour we are fixing.
     • "freeze the wall clock instead" — i.e. keep a private sim clock and convert
       `now` at every entry point. Cleaner on paper; in practice `slotPhase(slot,
       now)` and friends are called by the RENDERER with `Date.now()` and by
       drivethru.js with the value we hand it, so the conversion would have to be
       applied exactly once per call path and never twice. A double-converted
       clock is silent and unbounded. Shifting the stamps is arithmetically the
       same offset applied in a place that cannot be applied twice.

   🔴 CONVOYS ARE THE ONE THING THAT MUST *NOT* BE SKEWED. CONTRACT §4: they are
      a multi-hour freight promise and they advance on wall-clock while the panel
      is shut, by design. Skewing `arrivesAt` would mean a truck arrives later
      because you backgrounded the tab, which is the opposite of the promise.
      They are absent from the list below on purpose — do not "fix" that.

   ⚠ K.lane BELONGS TO drivethru.js. This reaches into it because state.js owns
     `tick()` and therefore owns the clock, and a lane whose deadlines disagreed
     with the board's would resolve the same customer twice. The alternative —
     a `DriveThru.skew(K, ms)` entry point — is the better shape and wants adding
     to CONTRACT §1; until it is there, the fields touched below are exactly the
     absolute stamps drivethru.js writes, and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */
function skewClocks(ms, now) {
  const d = _num(ms, 0);
  if (!(d > 0)) return;

  // Stations: the three stamps every phase is derived from.
  for (const sid of Object.keys(K.stations || {})) {
    const st = K.stations[sid];
    if (!st || !st.slots) continue;
    for (const slot of st.slots) {
      if (!slot) continue;
      slot.startedAt = _num(slot.startedAt, now) + d;
      slot.doneAt = _num(slot.doneAt, now) + d;
      slot.burnAt = _num(slot.burnAt, now) + d;
    }
  }
  if (K.hand) K.hand.madeAt = _num(K.hand.madeAt, now) + d;

  // The pass ages on the same clock, or a stall would turn every plate stale.
  for (const dish of (K.pass || [])) if (dish) dish.madeAt = _num(dish.madeAt, now) + d;

  // The board.
  for (const tk of (K.tickets || [])) {
    if (!tk) continue;
    tk.placedAt = _num(tk.placedAt, now) + d;
    tk.dueAt = _num(tk.dueAt, now) + d;
  }

  // The lane (see the ⚠ above). Zero means "not set yet" for several of these,
  // so a zero is left alone rather than pushed into the future.
  for (const car of (K.lane || [])) {
    if (!car) continue;
    for (const key of ['arrivedAt', 'orderedAt', 'expiresAt', 'balkAt', 'sayUntil', 'nagAt', 'leftAt']) {
      const v = _num(car[key], 0);
      if (v > 0) car[key] = v + d;
    }
  }
  if (K._lane && _num(K._lane.nextAt, 0) > 0) K._lane.nextAt = _num(K._lane.nextAt, 0) + d;

  // Our own schedulers.
  if (_num(K._nextCounter, 0) > 0) K._nextCounter = _num(K._nextCounter, 0) + d;
  if (isFinite(K._lastSave)) K._lastSave = _num(K._lastSave, now) + d;

  // NOT K.convoys. See the 🔴 above.
}

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
  const raw = _clamp(_num(dt, 16), 0, EC('GAP_MAX_MS', 86400000));
  const step = Math.min(raw, EC('MAX_DT_MS', 250));
  // 🔴 THE OTHER HALF OF THE CLAMP. See skewClocks().
  if (raw > step) skewClocks(raw - step, t);
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

  // 5. PASS ↔ BOARD (look only — serveTicket does the moving), THEN EXPIRY
  spoilPass(t);
  refreshReady(t);
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
        bumpPop(EC('POP_BURN', -1.2), 'burnt');
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
 * @param {object} opts  { step, seed, autoOpen, auto, quiet, gap }
 *        `auto:true` runs a naive bot — cook whatever a ticket wants, pull it
 *        the moment it is done, plate, serve — which is enough to prove the loop
 *        closes end-to-end without anyone writing a script.
 *        `gap:{at,ms}` injects ONE oversized frame at `at` seconds, which is the
 *        regression for the background-stall bug: see report.gap.
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
    gap: null,
  };
  let qi = 0;
  /* 🔴 THE BACKGROUND-STALL REGRESSION, and it is a regression because it
     shipped once. `gap:{at,ms}` hands tick() one oversized frame — exactly what
     a backgrounded tab does when it comes back. Dropped time must be dropped by
     EVERY clock (see skewClocks), so that frame must produce NO cook:burnt and
     NO ticket:lost. Before the fix, one 300,000ms frame burnt 2 slots, lost 4
     tickets and cost 16.4 popularity while the HUD clock stayed frozen. */
  const gap = (o.gap && _num(o.gap.ms, 0) > 0) ? { at: _num(o.gap.at, 0), ms: _num(o.gap.ms, 0), done: false } : null;

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
    let gapFrame = false;
    if (gap && !gap.done && tSec >= gap.at) {
      report.gap = { popBefore: K.popularity };
      gap.done = true;
      gapFrame = true;
      t += gap.ms;                       // the wall clock jumped; the sim must not
    }
    try { evs = tick(gapFrame ? (stepMs + gap.ms) : stepMs, t) || []; }
    catch (e) { report.errors.push('tick: ' + String((e && e.message) || e)); break; }
    report.ticks++;
    if (gapFrame) {
      const popBefore = report.gap ? report.gap.popBefore : K.popularity;
      const c = {};
      for (const ev of evs) c[ev.name] = (c[ev.name] || 0) + 1;
      report.gap = {
        ms: gap.ms,
        events: c,
        burnt: c['cook:burnt'] || 0,
        lost: c['ticket:lost'] || 0,
        popAfter: K.popularity,
        popBefore,
        ok: !c['cook:burnt'] && !c['ticket:lost'],
      };
    }

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
  /* 🔴 SERVE BEFORE PLATING, and this ordering is load-bearing now that the pass
     holds stock instead of passing it through. With the pass at PASS_CAP a
     plate has nowhere to go, `plateHand` refuses, the bot's hand stays full, it
     can never pull again and every slot on the rack burns. That death spiral is
     a REAL failure state a real player can walk into — but a bot that walks into
     it every single day measures the bot, not the kitchen. Clearing the pass
     first is what a cook does; it is not a cheat. */
  const readyFirst = K.tickets.find((x) => x.state === 'ready');
  if (readyFirst) serveTicket(readyFirst.id, now);

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

  // serve anything else that became ready while we were plating
  const ready = K.tickets.find((x) => x.state === 'ready');
  if (ready) serveTicket(ready.id, now);

  /* Start whatever the board is short of.
     ⚠ `it.filled` ALREADY COUNTS THE PASS. Since plating stopped auto-filling,
     `filled` is written every tick by refreshReady() and means "how many of this
     line the plates on the pass can currently cover" — so the old formula
     `qty − filled − onPass − cooking` subtracted the same plate twice and the
     bot under-cooked every multi-unit order into a deadlock: the ticket never
     completed, its plates sat on the pass forever, the pass filled with orphans
     and the rack jammed. Anyone else computing "still to cook" wants exactly
     `qty − filled − cooking` and nothing else. */
  const wanted = [];
  for (const ticket of K.tickets) {
    if (ticket.state !== 'open') continue;
    for (const it of ticket.items) {
      const cooking = countCooking(it.recipeId);
      if (it.filled + cooking < it.qty) wanted.push(it.recipeId);
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
