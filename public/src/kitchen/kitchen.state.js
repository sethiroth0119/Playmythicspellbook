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
   🔴 REGENERATED THIS ROUND, MECHANICALLY, AND THE PREVIOUS VERSION OF THIS
      LIST WAS WRONG IN BOTH DIRECTIONS — it named four keys that had since
      landed in ECON (LAST_CALL_MS, SHIFT_GRACE_MS, TICKET_HARD_GRACE_MS,
      LIKE_BIAS) and it was missing the ones this file had newly invented. A
      handover note that has drifted is worse than none, because it reads as
      verified. Regenerate it the way it was regenerated:

        node -e "import fs from 'node:fs';
          const D=await import('./public/src/kitchen/kitchen.data.js');
          const s=fs.readFileSync('./public/src/kitchen/kitchen.state.js','utf8');
          const k=new Set(); for(const m of s.matchAll(/EC[b]?\(\s*'([A-Z0-9_]+)'/g)) k.add(m[1]);
          console.log([...k].filter(x=>!(x in D.ECON)).sort().join(' '))" --input-type=module

      Against ECON's 153 keys, that returns exactly these ten:

     COUNTER_ENABLED       true  debug toggle to silence walk-ins. Not tuning;
                                 the only one here that can honestly stay.
     DRY_CHECK_MS           500  🆕 throttle on the latched "are the doors shut"
                                 read. dryCheck() prices a restock basket per
                                 menu row and every price is a getRes() across
                                 the bridge, so it must not run 60×/second. See
                                 dryNow(). Busted early by any `rev` change.
     RELIEF_AUTO_MS        3000  🆕 how long the kitchen must have been provably
                                 stalled before the free relief parcel lands by
                                 itself. See reliefWatch(). Firing on the
                                 instant would drop a pallet into the ordinary
                                 gap between plating one burger and the next.
     GRADE_MIN_SHIFT_MS  300000  🆕 shortest shift that earns a LETTER at all.
                                 Below it gradeFor() returns '—' and the report
                                 shows the two axes alone. Measured: identical
                                 play scored two S grades on a 120,000ms shift
                                 and none on a full 780,000ms day, because CRAFT
                                 starts near 1.000 and the SERVICE ceiling has
                                 not had time to bind (r8/early.mjs).
     GRADE_CAP_DUTY        0.70  fraction of capacityModel()'s theoretical rack
                                 a real pair of thumbs sustains. The model says
                                 itself that it "ignores the player's hands
                                 entirely"; this is that correction, measured
                                 against a zero-reaction bot's real throughput
                                 (17.9 dishes/hour against a modelled 26.9).
     GRADE_MIN_C           0.58  the four letter cuts on gradeParts().score.
     GRADE_MIN_B           0.70  Swept off the measured distribution — see the
     GRADE_MIN_A           0.79  block in gradeFor() for what each one is
     GRADE_MIN_S           0.92  pinned to and when to re-sweep them.
     POP_SOFT_MARGIN         40  how close to POP_MIN/POP_MAX the meter starts
                                 damping movement toward that rail. See
                                 bumpPop() — 0 restores the hard clamp and both
                                 of the dead zones that came with it.

   🔴 EVERY GUARD ABOVE IS THE **LIVE, MEASURED** NUMBER, NOT A ZERO. Read that
   twice. POP_REVERT_BELOW spent a whole round as dead data because its guard
   was 0 and its branch could therefore never be taken; the same trick applied
   to the GRADE_* family would ship a report card that grades on nothing. If
   kitchen.data.js defines them, data wins; if it never does, the game still
   plays exactly as measured. They want moving to ECON all the same — they are
   tuning, and tuning belongs where the designer is looking. gradeFor()'s own
   comment claims "the cuts are ECON keys"; that claim becomes true the moment
   the five GRADE_* rows land, and not before.

   ✅ PANTRY_BIN_PCT / PANTRY_BIN_MIN were asked for by this file and LANDED in
   kitchen.data.js the same round — `binCapFor()` reads both, and the fallbacks
   beside them are NaN guards, not tuning. Left named here because the next
   reader will want to know which side of the seam asked for them.

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
    /* 🔴 THE UNFINISHED SHIFT. null, or the record of a shift the player walked
       out of: { day, tMs, owed, today }. See closeShift/openShift — this is the
       whole of the anti-rewind, and `owed` is a COUNT of abandoned customers,
       never a popularity number, because a number in a save file is an economy
       constant that has escaped kitchen.data.js. */
    bail: null,
  },

  level: 1,
  xp: 0,                 // TOTAL lifetime xp. Level is DERIVED: levelForXp(xp).
  popularity: 50,        // 0..100. The emoji face + meter. Drives spawn rate and tips.

  pantry: {},            // ingredientId → integer units. NOT the 14-id live ledger.
  upgrades: [],          // owned UPGRADES ids. SAVED. Feeds every DATA.*(…, owned)
                         // helper — slot counts, cook speed, pass size, tips.

  /* 🪂 THE RELIEF RECEIPT. `shift.day` of the last free drop, 0 for never.
     SAVED, and it HAS to be: the free parcel is once per in-game DAY, and a day
     survives a panel close. Keyed on `shift.day` rather than on a shift counter
     for the reason kitchen.data.js spells out — `closeShift(now,{forfeit:true})`
     deliberately does not roll the day, so a per-shift counter would reset every
     time the player shut and re-opened the panel, which is two taps. */
  reliefDay: 0,

  stations: {},          // stationId → { slots: [slot|null, …] }
  hand: null,            // { recipeId, quality, mult } lifted off a station, or null
  pass: [],              // plated and waiting: [{id, recipeId, quality, mult, madeAt}]

  tickets: [],
  lane: [],

  convoys: [],
  inbound: [],

  /* Reset by openShift() — freshToday() is the ONE definition of its shape, so
     a new tally cannot be added to three of the four places that build it.
     `turned` counts walk-ins turned away at a full board (they also count in
     `lost`); `qsum`/`qunits` are the quality mix the day's GRADE is computed
     from — see gradeFor().

     🔴 THREE DIFFERENT KINDS OF WASTE, AND THEY USED TO BE ONE NUMBER.
     `burnt`   — a station slot crossed burnAt, or a plate rotted through on the
                 pass. NEGLECT. Costs popularity, and it is the ONLY one of the
                 three that gradeFor() reads.
     `spoiled` — the pass half of `burnt`, broken out so the settlement report
                 can say which kind of neglect it was. It is counted in BOTH.
     `binned`  — the player deliberately binned a plate off the pass. TRIAGE,
                 not failure, and it must never be scored as failure: breaking
                 the pass deadlock is mandatory play (a bot that never bins
                 finishes grade D — c2_bin.mjs), and the shipped build charged
                 the same `today.burnt` for it, so correct play was booked as
                 incompetence and pushed a grade-4 day down to an A. The
                 ingredients and the slot time are already the price; the grade
                 is not allowed to charge for it a second time. */
  // ⚠ `freshToday()` is a hoisted function DECLARATION, so it is initialised
  //   before this literal is evaluated. That is the whole reason it is not a
  //   `const` arrow (same argument as the exports — see the header).
  today:  freshToday(),
  totals: { served: 0, lost: 0, burnt: 0, spoiled: 0, binned: 0, earned: 0, days: 0 },

  /* 🔴 THE STARTING-STOCK RECEIPT. See hydrate(): ECON.START_PANTRY is granted
     exactly ONCE per save and this flag is how "once" is enforced across every
     future hydrate. SAVED — it has to be, or every panel open re-grants. */
  startGranted: false,

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
  /* 🔴 THE DOORS ARE SHUT. `dryCheck().dry` — nothing on the menu can be cooked
     AND no basket of crates the player can actually pay for would change that.
     DERIVED, never saved.

     ⚠ THIS ANNOTATION USED TO SAY "drivethru.js reads this to stop the lane",
       AND drivethru.js:4173 HAS SAID IN WRITING SINCE ROUND 4 THAT IT DOES NOT.
       A comment in this file asserting a behaviour in somebody else's is exactly
       the class of error that cost this feature 33 lost cars and ~28 popularity
       a day on a kitchen the game had already proved could not cook. So this
       comment now describes only what THIS file guarantees, which is:
         • `_dry` is refreshed once per frame in tick(), BEFORE DriveThru.tick()
           runs, so the lane reads this frame's truth and not last frame's;
         • `State.isDry()` is the accessor, and it is the one drivethru.js should
           gate `scheduleArrivals()` on (its handover O3). Whether it does is
           drivethru.js's call and drivethru.js's line to write. */
  _dry: false,
  _stalled: false,       // nothing cookable RIGHT NOW, regardless of the wallet.
                         // The relief gate (kitchen.data.js is explicit that it
                         // is `cookable.length === 0` and NOT `dry`).
  _stallSince: 0,        // `now` the current stall started; 0 while cooking is
                         // possible. reliefWatch() reads it.
  _dryAt: -Infinity,     // throttle stamp for the latched dry read (dryNow).
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

/**
 * The shape of `today`, in ONE place.
 *
 * ⚠ WHY THIS IS A FUNCTION AND NOT A COPIED LITERAL. The object was written out
 * by hand in four places (the state literal, init, openShift, reset). Adding
 * `binned` and `spoiled` to three of the four would have left one path handing
 * gradeFor() an `undefined` tally — which `_int()` reads as 0, so the day would
 * simply have graded itself wrong with nothing on screen to say so. A shape
 * that must match in four places is a shape that wants a constructor.
 */
function freshToday() {
  return {
    served: 0, lost: 0, burnt: 0, spoiled: 0, binned: 0, turned: 0,
    earned: 0, tips: 0, xp: 0, qsum: 0, qunits: 0, raw: 0, perfect: 0,
    /* ⏱ MILLISECONDS THE KITCHEN WAS ACTUALLY OPEN TODAY, advanced in tick()
       off the same clamped step as `shift.tMs`. It exists because gradeParts()
       needs "how long were you trading" and `shift.tMs` is not that number: a
       resumed shift fast-forwards tMs to where the player walked out, and the
       day roll resets it to 0 before `simulate()` grades. A tally that only
       ever counts time that really elapsed cannot lie in either direction, and
       it rides `today` so mergeToday()/hydrate() carry it for free. */
    ms: 0,

    /* 🔴 WHAT THE KITCHEN ATE OUT OF THE LIVE 14-ID LEDGER TODAY, AND WHAT IT
       PUT BACK. The one screen that summarises a day showed served / walked /
       burnt / Cinder / tips / XP and said NOTHING about live resources — i.e.
       nothing about the feature the player actually asked for ("uses the food
       and food type resources … from the other parts of the game"). A day of
       real play burns roughly 450 food and the report card printed a Cinder
       number and stopped. REF-B puts exactly this on its end-of-day screen.

       `resSpent` is `{liveResId: units}` and is accumulated in the ONE place
       resources leave — `spendCost()`, which both buySupply() and buyUpgrade()
       go through, so a third spender cannot forget to book it.
       `resGained` is the other direction: relief parcels and convoy claims.
       `cinderSpent` is what the restocking cost, so the report can print the
       whole cost of trading and not just the takings.

       ⚠ THREE OBJECTS INSIDE A TALLY THAT mergeToday() FOLDS NUMERICALLY — see
       mergeToday(), which now has to know the difference. That is the price of
       putting a dict in `today`; the alternative was a fourth parallel tally
       object nobody would reset. */
    resSpent: {}, resGained: {}, cinderSpent: 0,
  };
}

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
  K._dry = false;
  K._stalled = false;
  K._stallSince = 0;
  K._dryAt = -Infinity;
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
  K.today = freshToday();
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
  K.shift = { day: 1, tMs: 0, running: false, rush: 1, bail: null };
  K.level = 1;
  K.xp = 0;
  K.popularity = 50;
  K.pantry = {};
  K.upgrades = [];
  K.startGranted = false;
  K.convoys = [];
  K.inbound = [];
  K.today = freshToday();
  K.totals = { served: 0, lost: 0, burnt: 0, spoiled: 0, binned: 0, earned: 0, days: 0, foodSpent: 0 };
  K.reliefDay = 0;
  K.missing = false; K.offline = false; K.error = null;
  K._seq = 0; K._seed = 1; K._nextCounter = 0; K._report = null;
  K._stallSince = 0; K._dryAt = -Infinity; K._stalled = false;
  clearService();
  /* A reset kitchen is a NEW kitchen, so it gets the same starting stock a new
     save does — otherwise "reset" hands you a kitchen you cannot cook in.
     ⚠ IT GOES THROUGH hydrate(), NOT THROUGH A SECOND COPY OF THE GRANT. The
     previous version inlined the START_PANTRY loop here, which meant the grant
     existed in two places obeying two different sets of rules — and when the
     rules gained the pantry cap and the per-bin ceiling, only one copy got
     them. One door, and reset() walks through it like everybody else. */
  hydrate(null);
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
    /* 🔴 THE UNFINISHED SHIFT — the one addition to §5's saved subset, and it is
       deliberately NOT `shift.tMs`. §5 forbids saving the live shift clock and
       is right to: a frozen clock restored days later is a lie. This is a
       different thing — the record of a shift the player walked OUT of, valid
       only for the day it names (hydrate() drops it otherwise), and it exists
       because without it the anti-rewind above is defeated by pressing F5.
       ⚠ WANTS ADDING TO CONTRACT §5. It is additive: an old save has no `bail`
       key, hydrate() reads that as null, and the game behaves exactly as it
       does today. */
    bail: K.shift.bail ? {
      day: _int(K.shift.bail.day),
      tMs: Math.max(0, _num(K.shift.bail.tMs, 0)),
      owed: Math.max(0, _int(K.shift.bail.owed)),
      today: Object.assign({}, K.shift.bail.today),
    } : null,
    // 🔴 THE STARTING-STOCK RECEIPT. Without this in the save, hydrate() has no
    //    way to tell "never played" from "played, spent everything" once the
    //    player's xp is still 0, and the grant becomes a faucet. See hydrate().
    startGranted: !!K.startGranted,
    /* 🪂 THE RELIEF RECEIPT — the day the last free drop landed. Saved for the
       same reason `startGranted` is: without it the once-a-day parcel re-arms
       on every panel open and the only free faucet in the feature becomes an
       unbounded one. See buyRelief(). Additive — an old save has no key,
       hydrate() reads 0, and the first drop of the day is still owed. */
    reliefDay: Math.max(0, _int(K.reliefDay)),
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

  /* The unfinished shift (see snapshot()). Tolerant, clamped, and thrown away
     unless it names the day we are actually on — a bail record from an older
     day is a shift that has already been closed by the bell, and resuming into
     it would restore an hour the player has already played.
     ⚠ `owed` IS CLAMPED. A hand-edited save can only ever hurt its own owner
     here, but an unbounded count would run the popularity charge to −Infinity
     on the next open, and an unbounded number reaching arithmetic is how the
     NaN `tMs` bug (see tick()) went unnoticed for a round. */
  const rb = (s.bail && typeof s.bail === 'object') ? s.bail : null;
  K.shift.bail = (rb && _int(rb.day) === K.shift.day && _num(rb.tMs, 0) > 0) ? {
    day: K.shift.day,
    tMs: _clamp(_num(rb.tMs, 0), 0, EC('DAY_MS', 720000) + EC('LAST_CALL_MS', 45000)),
    owed: _clamp(_int(rb.owed), 0, Math.max(1, _int(EC('TICKET_CAP', 12))) * 4),
    today: mergeToday(rb.today),
  } : null;
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

  /* ⚠ AND THE SAME HOLE EXISTED IN THE UPGRADE LIST. Filtering on
     `typeof === 'string'` let ANY id survive forever, so a hand-edited save
     naming an upgrade granted its effect (every helper in kitchen.data.js reads
     the owned list by id and never asks whether the id is real). Resolving each
     id against DATA.upgrade() drops both hand-edits and, usefully, ids from a
     future build the player has rolled back from — which would otherwise sit in
     the save granting a slot count this version cannot draw.
     Duplicates go too: `_sumEffect` adds a slot per OCCURRENCE, so a save with
     the same id twice bought a lane it never paid for.

     ⚠ THIS MOVED ABOVE THE PANTRY, AND THE ORDER IS NOW LOAD-BEARING. The
     pantry clamp below sizes itself with `DATA.pantryCap(K.upgrades)`, and
     up_walkin/up_walkin2 add to that cap. Clamping the pantry against the base
     cap while the player owns two cooler upgrades would silently destroy the
     stock those 198,000 Cinder bought, on every single panel open. */
  const upSeen = Object.create(null);
  K.upgrades = (Array.isArray(s.upgrades) ? s.upgrades : []).filter((u) => {
    if (typeof u !== 'string' || upSeen[u]) return false;
    const f = DF('upgrade');
    if (f && !f(u)) return false;
    upSeen[u] = 1;
    return true;
  });

  const t0 = (s.totals && typeof s.totals === 'object') ? s.totals : {};

  /* ═══════════════════════════════════════════════════════════════════════
     🔴 THE STARTING GRANT — THE WORST BUG THIS FEATURE SHIPPED.
     ═══════════════════════════════════════════════════════════════════════
     ECON.START_PANTRY exists because the first thing a new player does is open
     the panel and press a station, and if the pantry is empty the only thing
     the game can say is "no". A cooking game whose first interaction is a
     refusal has already lost the player. The six lines that said exactly that
     sat directly above a test that COULD NOT FIRE:

         if (!saved || typeof saved !== 'object') { …grant… }

     because `bridge().kitchenState()` AUTO-CREATES `Profile.kitchen = {}` and
     hands back a truthy object for a player who has never played. So the branch
     was unreachable for every human being who has ever opened this panel:
     `Profile.gems 0`, `Profile.salvage {}`, `Kitchen.pantry {}` — tap the
     flat-top, "Out of ingredients"; tap Supplies, "Not enough Food — you need 5
     and have 0". A dead end with no exit, on screen one.
     The headless rung missed it for the same reason from the other side:
     NULL_BRIDGE.kitchenState() also returns `{}`, so the test reproduced the
     bug rather than failing on it.

     🔴 SO THE TEST IS NO LONGER "IS THERE A SAVE". Two rules, and they are
        different questions:
       1. HAS THIS SAVE EVER BEEN GRANTED? `startGranted` is a receipt written
          into the save the first time the grant lands. It is the only thing
          that makes the grant exactly-once across an unbounded number of future
          hydrates, and it is why this cannot regress into a top-up faucet.
       2. HAS THIS KITCHEN EVER BEEN PLAYED? For the saves that predate the
          receipt, evidence of play is xp, a day past 1, or any lifetime total.
          A kitchen with none of those has not started; a kitchen with any of
          them has, and an empty pantry mid-game is a real, earned failure state
          that must NOT be topped up.
     Every path lands on one of those two: no save, `{}`, `[]`, a string, a
     zeroed save, a corrupt save, and the headless rung. That is the whole point
     — "unmissable" is the requirement, so the test is about the CONTENT of the
     save and never about its presence. */
  const everPlayed = !!s.startGranted
    || _int(s.xp) > 0
    || _int(s.day || (s.shift && s.shift.day)) > 1
    || _int(t0.days) > 0 || _int(t0.served) > 0 || _int(t0.earned) > 0;

  const pantry = {};
  const rawPantry = (s.pantry && typeof s.pantry === 'object') ? s.pantry : {};

  /* 🔴 AND THE PANTRY IS CLAMPED ON THE WAY IN — THE HOLE FOUR LINES BELOW THE
        ONE THAT WAS FIXED. `xp` was clamped and unknown upgrade ids were
        dropped, and then this loop took any positive integer verbatim: a save
        carrying `pantry:{roll:99999}` hydrated to 99,999 units against the cap
        of 1,300 in force at the time (measured, c2_lock.mjs). The
        self-congratulating comment about closing exactly this shape of hole was
        sitting immediately underneath it.
        Two ceilings, because buySupply() enforces two: the TOTAL across every
        bin, and the share any ONE bin may hold. Admitting stock that no
        purchase could ever have created is the same bug either way. */
  const capFn0 = DF('pantryCap');
  const pcap0 = Math.max(1, _int(capFn0 ? capFn0(K.upgrades) : EC('PANTRY_CAP', 900)));
  const bcap0 = binCapFor(pcap0);
  let running = 0;
  for (const id of Object.keys(rawPantry)) {
    let n = _int(rawPantry[id]);
    if (n <= 0) continue;               // negatives and NaN are dropped, stock is not
    n = Math.min(n, bcap0);
    n = Math.min(n, Math.max(0, pcap0 - running));
    if (n <= 0) continue;
    pantry[id] = n;
    running += n;
  }

  if (!everPlayed) {
    const start = (DATA.ECON && DATA.ECON.START_PANTRY) || null;
    if (start && typeof start === 'object') {
      for (const id of Object.keys(start)) {
        const n = _int(start[id]);
        if (n <= 0) continue;
        // The grant obeys the same two ceilings as a purchase. A START_PANTRY
        // larger than the cooler would otherwise hydrate to a pantry that
        // `buySupply` considers over-full on the player's very first tap.
        const room = Math.min(bcap0 - _int(pantry[id]), pcap0 - running);
        const give = Math.min(n, Math.max(0, room));
        if (give <= 0) continue;
        pantry[id] = _int(pantry[id]) + give;
        running += give;
      }
    }
  }
  K.pantry = pantry;
  // The receipt is written whether or not the grant had anything to give, so a
  // START_PANTRY that is empty (or a data file mid-rewrite) cannot leave the
  // save permanently "fresh" and re-granting on every open once it is filled in.
  K.startGranted = true;

  K.convoys = Array.isArray(s.convoys)
    ? s.convoys.filter((c) => c && typeof c === 'object').map((c) => Object.assign({}, c))
    : [];

  K.totals = {
    served: Math.max(0, _int(t0.served)),
    lost: Math.max(0, _int(t0.lost)),
    burnt: Math.max(0, _int(t0.burnt)),
    spoiled: Math.max(0, _int(t0.spoiled)),
    binned: Math.max(0, _int(t0.binned)),
    earned: Math.max(0, _int(t0.earned)),
    days: Math.max(0, _int(t0.days)),
    /* 🥫 LIFETIME LIVE `food` OUT OF THE STASH. One number, not a dict, and
       `food` specifically: it is the id 39 of the 41 supply lines want, it is
       the one the ALL TIME strip has room for on a 360px screen, and it is the
       answer to "what has this kitchen actually cost me". Additive — an absent
       key reads 0 and an old save simply starts counting from today. */
    foodSpent: Math.max(0, _int(t0.foodSpent)),
  };

  /* 🪂 The relief receipt. Clamped to the day we are actually on: a save that
     claims the drop was taken on day 900 would otherwise lock the only free
     door for 899 in-game days. A receipt from the FUTURE is not a receipt. */
  K.reliefDay = _clamp(_int(s.reliefDay), 0, Math.max(0, _int(K.shift.day)));

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

/** The doors-shut answer is stale. Called wherever stock or the wallet moves —
    see dryNow()'s note on why `rev` is not the key. */
function dryDirty() { K._dryAt = -Infinity; }

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

/**
 * 🔴 THE PER-BIN CEILING — THE HALF OF THE PANTRY CAP THAT PREVENTS THE BRICK.
 *
 * Making PANTRY_CAP a true TOTAL was correct and it created an unrecoverable
 * soft-lock on its way in. Measured (c2_lock.mjs): buy ONE line to refusal and
 * the cooler reads 894 of 900 with 862 of it sitting in a single bin — after
 * which every other supply line refuses forever. The toast said "cook some of
 * it down", which is not executable advice, because cooking a hot dog needs
 * sausage as well as roll and sausage can no longer be bought. A player who
 * over-buys one bin bricks the kitchen permanently.
 *
 * There are now TWO answers and the feature needs both:
 *   • RECOVERY — `dumpSupply()` below, so a save already in the hole can climb
 *     out. That is the exit.
 *   • PREVENTION — this ceiling, so ordinary play cannot walk into the hole in
 *     the first place. An exit nobody knows about is not a fix; a wall you
 *     cannot walk through does not need one.
 * A bin may hold at most PANTRY_BIN_PCT of the whole cooler, and never less than
 * one batch of the largest supply order — a ceiling that refuses a single
 * purchase outright would be a worse bug than the one it closes.
 */
function binCapFor(pcap) {
  const pct = _clamp(EC('PANTRY_BIN_PCT', 0.15), 0.02, 1);
  // ⚠ THE FLOOR IS THREE-WAY, and every arm of it closes a way to ship a
  //   ceiling that refuses a purchase nobody could route around:
  //     PANTRY_BIN_MIN — the designer's floor, so a small cooler still holds a
  //       usable amount of any one thing;
  //     the largest single batch — a ceiling below one batch would refuse a bin
  //       the player has never bought from, which reads as a broken shop;
  //     the share itself, which is the actual rule.
  let biggest = 1;
  try {
    for (const sup of (Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : [])) {
      const q = _int(sup && sup.out && sup.out.qty);
      if (q > biggest) biggest = q;
    }
  } catch (e) {}
  return Math.max(
    _int(EC('PANTRY_BIN_MIN', 60)),
    biggest,
    Math.floor(Math.max(1, _int(pcap)) * pct),
  );
}

/**
 * What the cooler looks like right now. Render draws the "844 of 900" line and
 * the per-bin bars from this; it is a READ and mutates nothing.
 */
export function pantryRoom() {
  const capFn = DF('pantryCap');
  const cap = Math.max(1, _int(capFn ? capFn(K.upgrades) : EC('PANTRY_CAP', 900)));
  const total = pantryTotal();
  return {
    total,
    cap,
    room: Math.max(0, cap - total),
    binCap: binCapFor(cap),
    full: total >= cap,
  };
}

/**
 * 🗑 DUMP STOCK OUT OF ONE BIN. No refund, ever.
 *
 * ⚠ NOT IN CONTRACT §1's EXPORT LIST — this is the "say so" the contract asks
 * for, and it wants adding to §1 alongside `binPass` and `addStep`.
 *
 * WHY NO REFUND, AND WHY NO POPULARITY COST EITHER. The sunk purchase IS the
 * punishment — the player already paid live resources and Cinder for these
 * units and is now throwing them away. Charging reputation on top would make
 * the only exit from a soft-lock cost more than the soft-lock, which is how you
 * end up with players who correctly refuse to use the recovery you built them.
 * Refunding, on the other hand, would turn the cooler into a free warehouse:
 * buy the whole market at a good price, dump it back when you want the space.
 *
 * ⚠ IT EMITS `pantry:buy` WITH A NEGATIVE `qty`, NOT A NEW EVENT NAME.
 *   CONTRACT §6 fixes a closed set of event names and this file does not get to
 *   widen it unilaterally — the same call `binPass` made when it reused
 *   `cook:burnt` with `binned:true`. `dumped:true` carries the detail for a
 *   renderer that wants to draw it differently, and the sign carries it for one
 *   that does not.
 */
export function dumpSupply(ingId, n) {
  const have = _int(K.pantry[ingId]);
  if (!ingId || have <= 0) return no('BAD_ARG', 'There is nothing in that bin.');
  const want = _int(n);
  // `n` omitted (or <= 0) means "empty the bin" — that is the recovery case and
  // it should not require the caller to know how much is in there.
  const drop = (want > 0) ? Math.min(want, have) : have;
  K.pantry[ingId] = have - drop;
  if (K.pantry[ingId] <= 0) delete K.pantry[ingId];
  delete K._lowSeen[ingId];               // re-arm the low warning for this id
  dryDirty();                             // stock moved — see dryNow()
  K.rev++;
  emit('pantry:buy', { supplyId: null, ing: ingId, qty: -drop, batches: 0, cost: {}, dumped: true });
  fx('bin', `-${drop} ${metaName(ingId) || ingId}`);
  save(true);
  return ok({ ing: ingId, dumped: drop, left: _int(K.pantry[ingId]) });
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
/**
 * READ-ONLY AFFORDABILITY. → [] when every leg can be paid, otherwise the legs
 * that cannot, `[{key, want, have}]`.
 *
 * ⚠ EXTRACTED FROM spendCost's PREFLIGHT RATHER THAN COPIED BESIDE IT. The dry
 * check below needs to ask "can this player buy their way out" for 25 supply
 * lines without touching anything, and a second implementation of "can they
 * afford it" is a second implementation that will drift from the one that takes
 * the money. This is the same function the purchase preflights with.
 */
function costShortfall(cost, mult) {
  const n = Math.max(1, _int(mult || 1));
  const b = bridge();
  const out = [];
  for (const key of Object.keys(cost || {})) {
    const want = _int(cost[key]) * n;
    if (want <= 0) continue;
    let have = 0;
    try { have = (key === 'cinder') ? _int(b.gems ? b.gems() : 0) : _int(b.getRes ? b.getRes(key) : 0); } catch (e) { have = 0; }
    if (have < want) out.push({ key, want, have });
  }
  return out;
}

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
  const short = costShortfall(cost, n);
  if (short.length) {
    const sh = short[0];
    const label = (sh.key === 'cinder') ? 'Cinder' : (metaName(sh.key) || sh.key);
    return no('NO_PANTRY', `Not enough ${label} — you need ${sh.want.toLocaleString()} and have ${sh.have.toLocaleString()}.`);
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

  /* 🥫 BOOK IT ON THE DAY, HERE, WHERE THE RESOURCES ACTUALLY LEAVE.
     The day report never mentioned the live ledger — see freshToday(). This is
     the single narrowest point every live-resource spend in the feature passes
     through (buySupply and buyUpgrade both call it), so booking it anywhere
     else would be a second tally to keep in step by hand. Written only after
     the unwind below has been ruled out, so a refunded purchase never appears
     on the receipt. */

  // ── 3. UNWIND, IN REVERSE ───────────────────────────────────────────────
  if (failed) {
    for (let i = takenRes.length - 1; i >= 0; i--) {
      try { if (b.refundRes) b.refundRes(takenRes[i][0], takenRes[i][1]); } catch (e) {}
    }
    if (takenCinder > 0) { try { if (b.addGems) b.addGems(takenCinder); } catch (e) {} }
    return no('NO_PANTRY', 'That could not be paid for. Nothing was taken.');
  }
  bookSpend(takenRes, takenCinder);
  return ok({ spent: cost });
}

/** The day's ledger line. Pure bookkeeping; called only on a settled spend. */
function bookSpend(takenRes, takenCinder) {
  if (!K.today.resSpent || typeof K.today.resSpent !== 'object') K.today.resSpent = {};
  for (const pair of takenRes) {
    const id = pair[0], n = _int(pair[1]);
    if (!id || n <= 0) continue;
    K.today.resSpent[id] = _int(K.today.resSpent[id]) + n;
    if (id === 'food') K.totals.foodSpent = _int(K.totals.foodSpent) + n;
  }
  if (_int(takenCinder) > 0) K.today.cinderSpent = _int(K.today.cinderSpent) + _int(takenCinder);
}

/**
 * "🥫 452 Food · 💧 118 Water · 🧬 34 DNA — out of your stash". → '' when the
 * ledger did not move, so a caller can drop the whole row.
 *
 * Icons come from `bridge().meta(id)`, which is `_meta()` in the legacy app —
 * the same source the Supplies sheet and the prep-counter strip draw from, so
 * the receipt cannot label `dna` with a different glyph than the crate that
 * spent it. Biggest first: on a 360px screen the tail is what gets clipped, so
 * the tail must be the part that matters least.
 */
function resLineFor(today) {
  const spent = (today && today.resSpent) || {};
  const ids = Object.keys(spent).filter((id) => _int(spent[id]) > 0)
    .sort((a, c) => _int(spent[c]) - _int(spent[a]));
  if (!ids.length) return '';
  const parts = ids.map((id) => {
    let icon = '';
    try { const m = bridge().meta ? bridge().meta(id) : null; if (m && m.icon) icon = m.icon + ' '; } catch (e) {}
    return `${icon}${_int(spent[id]).toLocaleString()} ${metaName(id) || id}`;
  });
  return `${parts.join(' · ')} — out of your stash`;
}

/** The other direction — a relief parcel or a convoy landing. Same discipline:
    only ever called once the units have been re-read out of the live ledger. */
function bookGain(id, n) {
  if (!K.today.resGained || typeof K.today.resGained !== 'object') K.today.resGained = {};
  if (!id || _int(n) <= 0) return;
  K.today.resGained[id] = _int(K.today.resGained[id]) + _int(n);
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
    return no('CAP', `Pantry full — ${total.toLocaleString()} of ${pcap.toLocaleString()} units stored, room for ${room.toLocaleString()} more. Dump a bin you are not using, or buy a bigger cooler.`);
  }

  /* 🔴 AND THE SECOND CEILING: NO ONE BIN MAY EAT THE WHOLE COOLER.
        The total cap on its own is a brick. c2_lock.mjs: buy one line to
        refusal → 894 of 900 units with 862 of them in a single bin, and every
        other line then refuses permanently, including the one that would let
        you cook the first bin down. `dumpSupply()` is the exit; this is the
        wall, and the wall is the part that matters, because a player should
        never have to discover a recovery action to keep playing.
        See binCapFor() for why the ceiling can never refuse a first batch. */
  const bcap = binCapFor(pcap);
  const inBin = _int(K.pantry[out.ing]);
  if (inBin + _int(out.qty) * n > bcap) {
    const roomB = Math.max(0, bcap - inBin);
    const label = metaName(out.ing) || out.ing;
    return no('CAP', roomB > 0
      ? `That shelf is nearly full — ${inBin.toLocaleString()} of ${bcap.toLocaleString()} ${label}, room for ${roomB.toLocaleString()} more. One ingredient cannot fill the whole cooler.`
      : `That shelf is full — ${inBin.toLocaleString()} of ${bcap.toLocaleString()} ${label}. Cook some of it down before you order more.`);
  }

  const paid = spendCost(sup.cost || {}, n);
  if (!paid.ok) return paid;

  // ── 4. ONLY NOW does the pantry change ──────────────────────────────────
  const gained = _int(out.qty) * n;
  pantryPut(out.ing, gained);
  delete K._lowSeen[out.ing];             // re-arm the low warning for this id
  dryDirty();                             // stock moved — see dryNow()
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

/**
 * 🔴 THE ASSERTION THAT WAS MISSING. Pure, mutates nothing, safe at runtime.
 *
 * The first-run blocker (see hydrate()) survived a whole round because every
 * test asked "does hydrate throw" and none asked the only question that
 * matters: CAN A BRAND NEW PLAYER COOK SOMETHING. This answers it from the data
 * alone — what ECON.START_PANTRY holds against what the level-1 menu needs —
 * so a harness can assert on it and a retune of either table trips the wire.
 *
 * → { ok, stock, cookable:[recipeId], missing:[{recipeId,ing,need,have}] }
 * `ok` is false the moment a level-1 kitchen cannot cook a single thing. It is
 * NOT a claim that every level-1 dish is coverable — the 14-id ledger is
 * supposed to gate the expensive ones — only that the first tap is not a "no".
 */
export function startPantryCovers() {
  const stock = {};
  try {
    const st = (DATA.ECON && DATA.ECON.START_PANTRY) || {};
    for (const id of Object.keys(st)) if (_int(st[id]) > 0) stock[id] = _int(st[id]);
  } catch (e) {}
  const cookable = [], missing = [];
  for (const r of menuForLevel(1)) {
    if (!r || !r.needs) continue;
    let can = true;
    for (const id of Object.keys(r.needs)) {
      const need = _int(r.needs[id]), have = _int(stock[id]);
      if (have < need) { can = false; missing.push({ recipeId: r.id, ing: id, need, have }); }
    }
    if (can) cookable.push(r.id);
  }
  return { ok: cookable.length > 0, stock, cookable, missing };
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

/**
 * 🔴 CAN THIS PLAYER MAKE ANY MOVE AT ALL? Pure. Mutates nothing.
 *
 * THE FAILURE IT WATCHES FOR, MEASURED: a brand-new account has an empty
 * salvage ledger, and every supply line costs a live resource — so once the
 * starting grant runs out there is no restock path at ANY price. c3_dry.mjs,
 * gems 0 and every live resource 0: the pantry went dry 238 seconds into a
 * 720-second shift and the remaining eight minutes were pure attrition —
 * `served` frozen at 14, `lost` climbing past 27, popularity 53 → 20, grade D.
 * The player did nothing wrong and could do nothing at all, and the game kept
 * sending customers so it could keep charging them for it.
 *
 * A kitchen with no ingredients and no way to buy any is CLOSED, not failing.
 * Nothing in this file could tell the difference — grep for a guard returned
 * only the comments about the bug it was meant to prevent.
 *
 * → { dry, stalled, cookable:[recipeId], reachable:[recipeId],
 *     affordable:[supplyId], need:[liveResId], ing }
 *
 * 🔴 TWO DIFFERENT QUESTIONS, AND ONE FLAG WAS BEING ASKED BOTH OF THEM.
 *
 *   `stalled` — NOTHING ON THE MENU CAN BE COOKED RIGHT NOW. A statement about
 *     the pantry alone. This is the gate kitchen.data.js's RELIEF block names in
 *     writing ("`cookable.length === 0`") and it is the honest trigger for the
 *     escape hatch, because a wallet full of Cinder does not put a bun on a
 *     griddle.
 *
 *   `dry` — THE DOORS ARE SHUT. Stalled, AND no purchase the player can
 *     actually pay for would change that. This is the one the lane and the
 *     walk-ins gate on, because it is the one that means "sending this kitchen
 *     another customer can only ever cost you".
 *
 * 🔴 AND `dry` USED TO MEAN NEITHER OF THOSE, WHICH IS THE BUG. It was
 *    `affordable.length === 0` — is there ANY unlocked crate on the sheet the
 *    player can pay for — and one cheap affordable crate therefore kept the
 *    shift open forever while the kitchen served nothing. Measured, ten days,
 *    a resourced account: from day 5 the player holds 79,579 Cinder, 654 water
 *    and 1 food; `sal_ice` (9 Cinder, 3 water) is affordable forever, so `dry`
 *    read FALSE while the kitchen served 0 and lost 87, 98, 89, 87, 97 and 90
 *    tickets on six consecutive days. Water buys ice. **Ice is not a dish.**
 *    kitchen.data.js:505-513 predicted this precise false negative and the
 *    mitigation it specified was never built.
 *
 *    So the question is no longer "can you buy SOMETHING". It is "can you buy
 *    your way to a DISH": `reachable` walks each recipe on the menu, prices the
 *    cheapest basket of unlocked crates that would cover its shortfall, and
 *    asks whether that WHOLE basket is payable in one go. Ice keeps nothing
 *    open any more, because no basket containing only ice finishes a recipe.
 *
 * ⚠ THE BASKET SEARCH IS GREEDY PER INGREDIENT, NOT AN OPTIMISER, and it is
 *   deliberately allowed to be wrong in exactly one direction. It picks, for
 *   each short ingredient independently, the cheapest unlocked line that covers
 *   the gap — so a combination it did not consider could occasionally be
 *   payable when this says it is not. That error opens the relief door and
 *   shuts the lane for at most one throttle window (see dryNow), both of which
 *   the next purchase undoes. The opposite error — declaring a dead kitchen
 *   OPEN — is the one that costs a player thirty-nine customers a day for eight
 *   days, so the pessimistic direction is the correct place to be wrong.
 */
export function dryCheck() {
  const cookable = [];
  for (const r of menuForLevel(K.level)) if (r && pantryHas(r.needs)) cookable.push(r.id);
  // The common case, and it exits before touching the bridge at all.
  if (cookable.length) {
    return { dry: false, stalled: false, cookable, reachable: cookable.slice(), affordable: [], need: [], ing: null };
  }

  const affordable = [], need = [];
  for (const sup of (Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : [])) {
    if (!sup || !sup.out || !sup.out.ing) continue;
    if (_int(sup.minLevel || 1) > K.level) continue;
    const short = costShortfall(sup.cost || {}, 1);
    if (!short.length) { affordable.push(sup.id); continue; }
    for (const sh of short) if (sh.key !== 'cinder' && need.indexOf(sh.key) === -1) need.push(sh.key);
  }
  const reachable = reachableRecipes();
  // The ingredient to NAME. `pantry:low` is the event this rides on (§6 is a
  // closed set) and render's toast reads `e.ing`, so it has to be a real
  // ingredient id or the player is told they are low on "null".
  let ing = null;
  for (const r of menuForLevel(K.level)) {
    for (const id of Object.keys((r && r.needs) || {})) {
      if (_int(K.pantry[id]) < _int(r.needs[id])) { ing = id; break; }
    }
    if (ing) break;
  }
  return { dry: reachable.length === 0, stalled: true, cookable, reachable, affordable, need, ing };
}

/**
 * Which dishes the player could put on a griddle if they went shopping first.
 * → [recipeId]. Pure; the only thing it touches is `getRes`/`gems` through
 *   costShortfall(), which is the same preflight the purchase itself uses.
 *
 * The pantry cap is deliberately NOT checked here. A cooler too full to accept
 * the crate is a state `dumpSupply()` fixes in one tap, so it is not a closed
 * door and must not be reported as one.
 */
function reachableRecipes() {
  const supplies = Array.isArray(DATA.SUPPLY_RECIPES) ? DATA.SUPPLY_RECIPES : [];
  const out = [];
  for (const r of menuForLevel(K.level)) {
    if (!r || !r.needs) continue;
    const basket = {};
    let routed = true, anything = false;
    for (const id of Object.keys(r.needs)) {
      const gap = _int(r.needs[id]) - _int(K.pantry[id]);
      if (gap <= 0) continue;
      anything = true;
      /* The cheapest unlocked line that covers this gap, preferring one the
         player can already pay for on its own — ranking on Cinder alone would
         happily pick a line priced in a resource they have none of while a
         dearer line they CAN pay for sits beside it, which is the shape of
         wrongness that made the old flag useless. */
      let best = null, bestKey = Infinity;
      for (const sup of supplies) {
        if (!sup || !sup.out || sup.out.ing !== id) continue;
        if (_int(sup.minLevel || 1) > K.level) continue;
        const per = _int(sup.out.qty);
        if (per <= 0) continue;
        const batches = Math.max(1, Math.ceil(gap / per));
        const solo = costShortfall(sup.cost || {}, batches).length === 0 ? 0 : 1;
        // sort key: affordable-on-its-own first, then Cinder.
        const key = solo * 1e9 + _int((sup.cost || {}).cinder) * batches;
        if (key < bestKey) { bestKey = key; best = { sup, batches }; }
      }
      if (!best) { routed = false; break; }
      const c = best.sup.cost || {};
      for (const k of Object.keys(c)) basket[k] = _int(basket[k]) + _int(c[k]) * best.batches;
    }
    if (!routed || !anything) continue;
    if (costShortfall(basket, 1).length) continue;
    out.push(r.id);
  }
  return out;
}

/**
 * The latched, per-frame version. → true while the doors should be shut.
 *
 * ⚠ IT DOES NOT CLOSE THE SHIFT ITSELF. Ending the day out from under a player
 * who still has four plates on the pass and two orders up would bin food they
 * are ten seconds from selling. It stops NEW custom arriving — no ticket, so no
 * POP_TURNAWAY and no POP_LOST for a customer who was never served — and leaves
 * the decision to close to the player, which is where a decision belongs.
 */
function dryNow(t) {
  /* ⏱ THROTTLED, BECAUSE THE ANSWER GOT EXPENSIVE. `reachableRecipes()` prices
     a basket per menu row and every price is a `getRes()` across the bridge
     into an 11.6 MB app; at 19 recipes that is ~80 bridge reads a frame for a
     question whose answer cannot change between two frames unless the player
     bought something — and buying bumps `rev`, which busts this cache. */
  /* ⚠ THROTTLED ON TIME, INVALIDATED ON THE PANTRY — NOT ON `rev`. The obvious
     cache key is `rev`, and it is wrong: `rev` bumps on every cook, plate,
     ticket and lane movement, so a rev-gated cache never hits during play and
     the throttle would do nothing at all. What actually changes this answer is
     the pantry and the wallet, so `dryDirty()` is called from the three places
     that move stock. (The cheap half of dryCheck — "is anything cookable" —
     exits before touching the bridge at all, so the expensive path only runs in
     the state where the throttle matters.) */
  const now = _num(t, K.now);
  if (now - _num(K._dryAt, -Infinity) < EC('DRY_CHECK_MS', 500)) return !!K._dry;
  K._dryAt = now;

  const d = dryCheck();
  /* THE STALL CLOCK. reliefWatch() needs "how long has there been nothing to
     cook", not "is there nothing to cook" — a drop that lands the instant the
     last bun is used would fire during the ordinary gap between plating a
     burger and starting the next one. */
  if (d.stalled) { if (!K._stallSince) K._stallSince = now; }
  else K._stallSince = 0;
  if (d.stalled !== !!K._stalled) { K._stalled = d.stalled; K.rev++; }

  if (d.dry !== !!K._dry) {
    K._dry = d.dry;
    K.rev++;
    /* 🔴 `dry` AND `need` RIDE THE EVENT SO THE TOAST CAN SAY THE TRUE THING.
       The single moment the game could say "you are out of live food and no
       crate on the sheet can be bought" it said "⚠ Low on Dog Roll", because
       kitchen.render.js's toastLine drops both keys. They are in the payload;
       the branch is render's to write (see stillOpen). */
    if (d.dry && d.ing) emit('pantry:low', { ing: d.ing, have: _int(K.pantry[d.ing]), dry: true, stalled: true, need: d.need });
  }
  return d.dry;
}

/**
 * 🚗 THE LANE'S ACCESSOR. → true while the doors are shut.
 *
 * 🔴 THIS IS THE ENTRY POINT drivethru.js's HANDOVER O3 ASKED FOR, AND IT IS THE
 * WHOLE OF THIS FILE'S HALF OF THAT CONVERSATION. `Kitchen._dry` is refreshed in
 * tick() BEFORE `DriveThru.tick()` is called (it used to be refreshed after, so
 * a reader would have got last frame's answer), and this reads that latch — no
 * recomputation, no bridge traffic, safe to call every frame from inside the
 * lane's own spawn test.
 *
 * What it is FOR: `scheduleArrivals()` gating on it, and rolling `b.nextAt`
 * forward the same way tick() rolls `_nextCounter`, so that re-stocking does not
 * release a backlog of cars who "queued" while the kitchen was shut. Measured
 * without it, one full level-1 day on a provably dry kitchen: counter tickets 0,
 * LANE tickets 33, served 0, lost 33, popularity 50 → 21.5 — a drain with no
 * counter-play, for customers the game had already proved it could not feed.
 *
 * ⚠ IT IS NOT A CLAIM THAT THE LANE READS IT. drivethru.js owns that line and
 *   this file is not allowed to write it. See the `_dry` comment in §2.
 *
 * 🔴 AND IT IS NOT A DEAD EXPORT WAITING ON A STRANGER, WHICH IS THE OTHER HALF
 *   OF THE SAME LESSON. tick()'s own walk-in gate reads THIS accessor and not
 *   the raw field, so the counter door and the lane door are gated by one
 *   function with one answer — the shape the last five rounds kept getting
 *   wrong was two readers of one truth quietly disagreeing. It also means the
 *   accessor is exercised every frame of every shift, so it cannot rot while it
 *   waits for drivethru.js to take it up.
 *
 * There is deliberately NO `isStalled()` beside this. `dryCheck().stalled` is
 * already exported, already in CONTRACT §1, and already the thing the Supplies
 * sheet and the OPEN THE DOORS button want; a second latched wrapper for it
 * would have been an export with nothing calling it, which is the exact defect
 * kitchen.selftest.js exists to catch — and did catch, on this function's first
 * draft.
 */
export function isDry() { return !!K._dry; }

/* ═══════════════════════════════════════════════════════════════════════════
   🪂 §8.1b — THE RELIEF DROP. THE CONSUMER kitchen.data.js HAS BEEN WAITING FOR.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 WHAT SHIPPED WITHOUT THIS FUNCTION, MEASURED, NOT ASSERTED.
   `DATA.RELIEF` is three rows and 130 lines of design argument and it had ZERO
   consumers: `grep -rn "RELIEF" public/src/kitchen/*.js` returned hits only
   inside kitchen.data.js, `typeof State.buyRelief` was `undefined`, and the
   word "relief" appeared in this file and in kitchen.render.js exactly zero
   times. kitchen.data.js:578 said so out loud — "🔴 UNTIL THAT EXISTS THIS RUNG
   IS INERT DATA" — and was ignored for a round.

   The consequence on a brand-new offline account (r5p/run10.mjs, unmodified):
       day 1: served 38 · lost 41
       day 2: served  4 · lost 47 · pantry 0
       day 3-10: served 0 · lost 36-41 EVERY DAY
       WALLET minted 7,827 · burned 0 · LEDGER out {}
   Eighteen minutes of play, then the feature is permanently over, with 7,827
   Cinder in the wallet and all 41 crates refusing because every one of them
   needs live `food`. Burned ZERO — there was nothing to spend it on.

   🔴 AND THE FUNCTION ALONE IS NOT THE FIX, WHICH IS THE LESSON OF FIVE ROUNDS.
   An exported action nobody calls is the same bug one level up — round 1
   shipped two player verbs with no callers, round 3 shipped a verdict the till
   ignored, round 5 shipped this table with no reader. So the FREE parcel has a
   consumer INSIDE THIS FILE: `reliefWatch()` runs on the tick path and lands it
   automatically once the kitchen has been provably stalled for RELIEF_AUTO_MS.
   It cannot be dropped by another builder, it needs no button, and it works in
   a headless test, which is how it gets proved.

   ⚠ THE AUTO-LAND IS ONLY EVER THE FREE ROW, AND THAT IS NOT AN OVERSIGHT.
     Spending 1,200 of the player's Cinder without asking would be theft, and a
     purchase is a decision. `buyRelief()` is the door for the paid pallets and
     it wants a button (see stillOpen). The free row is not a decision — it is
     what turns up when your yard is empty — so the game simply gives it to you
     and says so.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The rows, resolved through the data module's own lookup where it exists. */
function reliefRows() {
  try { return Array.isArray(DATA.RELIEF) ? DATA.RELIEF : []; } catch (e) { return []; }
}
function reliefRow(id) {
  const f = DF('relief');
  try { if (f) { const r = f(id); if (r) return r; } } catch (e) {}
  return reliefRows().find((r) => r && r.id === id) || null;
}
/** The free, once-a-day parcel — whichever row the data file marks `free`. */
function freeRelief() {
  return reliefRows().find((r) => r && r.free && _int(r.minLevel || 1) <= K.level) || null;
}

/**
 * 🪂 CINDER (or nothing) IN, LIVE 14-ID LEDGER RESOURCES OUT.
 *
 * The signature kitchen.data.js:562 specifies, implemented against the six
 * numbered steps it writes out at :564-578.
 *
 * 🔴 IT DOES NOT TOUCH THE PANTRY AND MUST NOT. `buySupply()` cannot serve this
 * rung: that function's whole job is `pantryPut(out.ing, …)`, and this one has
 * to call `bridge().addRes(id, n)` — a different door, a different cap, a
 * different failure mode. Putting the parcel's contents straight into the
 * pantry would ALSO make the kitchen a closed second economy, which is the
 * premise failure this whole ladder was rebuilt to avoid: the parcel lands in
 * the ledger the city builder, the market and crafting can all see, and the
 * kitchen then spends it through the same crates as everybody else.
 *
 * 🔴 addRes() IS CAPPED AND RETURNS WITHOUT ADDING WHEN THE STASH IS FULL
 * (CONTRACT §7 — the confusion that destroyed 215 units of a real player's
 * resources). So every leg is RE-READ with `getRes()` and a short landing is
 * `{ok:false, code:'CAP'}` with everything put back — never a silent clamp.
 *
 * @returns {{ok:boolean, code:string, why:string, granted?:object}}
 */
export function buyRelief(reliefId, batches) {
  const row = reliefRow(reliefId);
  if (!row) return no('BAD_ARG', 'There is no such drop.');
  const out = row.out || {};
  if (!Object.keys(out).length) return no('BAD_ARG', 'That drop is empty.');
  if (_int(row.minLevel || 1) > K.level) {
    return no('LOCKED', `That drop unlocks at level ${_int(row.minLevel)}.`);
  }

  /* A `perDay` row is one parcel, full stop — batching it would defeat the
     whole point of the gate in a single tap. */
  const maxB = Math.max(1, _int(EC('SUPPLY_MAX_BATCHES', 20)));
  const n = row.perDay ? 1 : _clamp(_int(batches || 1), 1, maxB);

  // 🔴 `cookable.length === 0`, NOT `.dry` — kitchen.data.js:529 is explicit
  //    about the difference and about why. A player who can still cook does not
  //    need rescuing, and a working kitchen that could collect this would be
  //    farming it.
  if (row.whenDry && dryCheck().cookable.length > 0) {
    return no('CLOSED', 'The drop only comes when there is nothing left to cook.');
  }

  if (row.perDay && _int(K.reliefDay) === _int(K.shift.day)) {
    return no('CAP', "Today's drop has already been. The flight comes once a day.");
  }

  /* The cost dict may hold `cinder` and nothing else — the parcels are the ONE
     Cinder-only door in the feature and a live-resource leg here would mean a
     stranded player is asked for the very thing they have run out of. Refuse
     the row rather than silently skipping the leg (spendCost's rule). */
  const cost = row.cost || {};
  for (const k of Object.keys(cost)) {
    if (k !== 'cinder' && _int(cost[k]) !== 0) {
      return no('BAD_ARG', 'That drop is priced in something a stranded kitchen would not have.');
    }
  }

  const b = bridge();
  const price = Math.max(0, _int(cost.cinder) * n);
  if (price > 0) {
    let have = 0;
    try { have = _int(b.gems ? b.gems() : 0); } catch (e) { have = 0; }
    if (have < price) {
      return no('NO_PANTRY', `Not enough Cinder — you need ${price.toLocaleString()} and have ${have.toLocaleString()}.`);
    }
    let paid = false;
    try { paid = b.spendGems ? b.spendGems(price) === true : false; } catch (e) { paid = false; }
    if (!paid) return no('NO_PANTRY', 'That could not be paid for. Nothing was taken.');
  }

  // ── LAND IT, LEG BY LEG, RE-READING EVERY ONE ───────────────────────────
  const granted = {};
  const landed = [];
  let short = null;
  for (const id of Object.keys(out)) {
    const want = _int(out[id]) * n;
    if (want <= 0) continue;
    let before = 0;
    try { before = _int(b.getRes ? b.getRes(id) : 0); } catch (e) { before = 0; }
    let called = false;
    try { called = b.addRes ? b.addRes(id, want) !== false : false; } catch (e) { called = false; }
    let after = before;
    try { after = _int(b.getRes ? b.getRes(id) : before); } catch (e) { after = before; }
    const got = Math.max(0, after - before);
    if (got > 0) landed.push([id, got]);
    if (!called || got < want) { short = { id, want, got }; break; }
    granted[id] = got;
  }

  if (short) {
    /* 🔴 UNWIND, AND THE INVERSE OF `addRes` IS `spendRes`. This is undoing an
       ADDITION this call stack just made, so the cap rule in §7 points the
       other way round from spendCost's: there, the undo of a deduction must be
       uncapped (`refundRes`); here, the undo of an addition is an ordinary
       deduction. Getting these two backwards is how the 215 units went. */
    for (let i = landed.length - 1; i >= 0; i--) {
      try { if (b.spendRes) b.spendRes(landed[i][0], landed[i][1]); } catch (e) {}
    }
    if (price > 0) { try { if (b.addGems) b.addGems(price); } catch (e) {} }
    const label = metaName(short.id) || short.id;
    return no('CAP', `Your stash is full — the ${label} would not fit. Nothing was taken, and nothing was charged.`);
  }

  if (row.perDay) K.reliefDay = _int(K.shift.day);
  dryDirty();                             // the LEDGER moved — see dryNow()
  for (const id of Object.keys(granted)) bookGain(id, granted[id]);
  if (price > 0) K.today.cinderSpent = _int(K.today.cinderSpent) + price;
  K.rev++;

  const line = Object.keys(granted)
    .map((id) => `+${granted[id]} ${metaName(id) || id}`)
    .join(' · ');
  /* CONTRACT §6 is a CLOSED event set and this file does not get to widen it
     unilaterally, so the drop rides `pantry:buy` with `relief:true` — the same
     move `dumpSupply()` made with a negative qty and `binPass()` made with
     `cook:burnt`. `ing` stays null because there is no PANTRY ingredient here;
     `granted` is the live-ledger payload. */
  emit('pantry:buy', {
    supplyId: row.id, relief: true, free: !!row.free, ing: null, qty: 0,
    batches: n, cost: { cinder: price }, granted, line,
  });
  /* 🔴 THE PIXEL, AND IT NEEDS NOBODY'S COOPERATION. `Kitchen._fx` is drained
     and drawn by kitchen.render.js:2435 for ANY `kind`, so this float-up lands
     on screen with no change to any other file. That is deliberate: the last
     five rounds all died on a value whose only consumer was somebody else's
     unwritten line. A toast would be better and it is asked for in stillOpen;
     this is the half that cannot fail to arrive. */
  fx('relief', `${row.icon || '🪂'} ${line}`);
  save(true);
  return ok({ granted, spent: { cinder: price }, line, reliefId: row.id });
}

/**
 * What the Supplies sheet should draw at the top of the ladder. READ ONLY.
 *
 * → { stalled, takenToday, day, rows:[{…row, available, why, cinder}] }
 *   `available` is whether the button should be live; `why` is the refusal
 *   sentence to put under a dead one. Render must not re-derive either — the
 *   gates are `buyRelief`'s and there is to be exactly one copy of them.
 */
export function reliefOffer() {
  const d = dryCheck();
  const taken = _int(K.reliefDay) === _int(K.shift.day);
  const rows = reliefRows().map((r) => {
    let available = true, why = '';
    if (_int(r.minLevel || 1) > K.level) { available = false; why = `Unlocks at level ${_int(r.minLevel)}.`; }
    else if (r.whenDry && d.cookable.length > 0) { available = false; why = 'Only when there is nothing left to cook.'; }
    else if (r.perDay && taken) { available = false; why = "Today's drop has already been."; }
    else {
      const price = _int((r.cost || {}).cinder);
      let have = 0;
      try { have = _int(bridge().gems ? bridge().gems() : 0); } catch (e) { have = 0; }
      if (price > have) { available = false; why = `Needs ◈${price.toLocaleString()}; you have ◈${have.toLocaleString()}.`; }
    }
    return Object.assign({}, r, { available, why, cinder: _int((r.cost || {}).cinder) });
  });
  return { stalled: d.stalled, dry: d.dry, takenToday: taken, day: _int(K.shift.day), rows };
}

/**
 * ⏱ THE CONSUMER. Called once a frame from tick().
 *
 * A stranded kitchen gets its free parcel WITHOUT having to find a button,
 * because "the player never discovered the recovery" and "the recovery was
 * never built" look identical from inside the game, and this feature has now
 * shipped the second one five rounds running.
 *
 * The stall has to have LASTED. Firing the instant the last bun is used would
 * drop a parcel into the ordinary gap between plating one burger and starting
 * the next, which is not stranded, it is cooking.
 */
function reliefWatch(t) {
  /* The three CHEAP gates first, off latched fields, because this runs on the
     tick path sixty times a second and the fourth gate is not cheap. */
  if (_int(K.reliefDay) === _int(K.shift.day)) return;      // already been today
  if (!K._stalled || !K._stallSince) return;                // there is food to cook
  const wait = Math.max(0, EC('RELIEF_AUTO_MS', 3000));
  if (t - _num(K._stallSince, t) < wait) return;

  /* 🔴 AND THEN THE SAME QUESTION THE BUTTON ASKS, THROUGH THE SAME FUNCTION.
     An earlier draft re-derived the free row's gates here off `freeRelief()`,
     which meant the automatic drop and the Supplies-sheet card could disagree
     about whether a drop was owed — two readers of one truth, which is the
     defect this whole round is about. `reliefOffer()` is the one answer; it is
     what render draws and it is what this consumes. */
  const offer = reliefOffer();
  const row = offer.rows.find((x) => x && x.free && x.available);
  if (!row) return;
  const r = buyRelief(row.id, 1);
  /* Whatever happened — landed, or refused because the stash is full — restart
     the stall clock so this cannot retry sixty times a second. A CAP refusal is
     a real state (a full stash and an empty pantry) and it will clear itself
     when the player spends something. */
  K._stallSince = t;
  /* ⚠ ONLY `BAD_ARG` IS WORTH A TOAST, AND THE OTHERS ARE DELIBERATELY SILENT.
     `CAP` is a real, self-clearing state (a full stash and an empty pantry).
     `CLOSED` is a RACE and not a failure: `_stalled` is the throttled read and
     buyRelief re-checks live, so a player who started cooking in the last half
     second would be told "the drop only comes when there is nothing left to
     cook" at the exact moment they were cooking — a toast that is wrong is
     worse than a toast that is absent. `BAD_ARG` means the RELIEF table itself
     is malformed, which is a developer's problem and must not be swallowed. */
  if (!r.ok && r.code === 'BAD_ARG') emit('error', { code: r.code, why: r.why });
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
  dryDirty();           // the pantry just paid for this — see dryNow()
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
    // 🔴 SEAM 1 — see THE BUILD RECORD below. `slot.steps` used to die here.
    built: Array.isArray(slot.steps) ? slot.steps.slice() : [],
    assembled: Array.isArray(slot.steps) && slot.steps.length > 0,
    madeAt: t,
  };
  K.rev++;
  return ok({ quality, build: build.score });
}

/** Bin whatever is in hand. The ingredients are gone; that is the lesson.
    ⚠ A BURNT DISH IS NOT DOUBLE-COUNTED HERE. `pullSlot` already booked the
      burn (and charged POP_BURN) at the moment it came off the surface, so
      binning it afterwards is bookkeeping, not a second failure. Anything else
      in the hand is a deliberate discard and books as `binned` — triage, on the
      same terms as binPass(), and for the same reason. */
export function dropHand() {
  if (!K.hand) return false;
  const was = K.hand;
  K.hand = null;
  if (was.quality !== 'burnt') {
    K.today.binned = _int(K.today.binned) + 1;
    K.totals.binned = _int(K.totals.binned) + 1;
  }
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
export function plateHand(now, forTicketId) {
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
    // 🔴 SEAM 1 — see THE BUILD RECORD below.
    built: Array.isArray(K.hand.built) ? K.hand.built.slice() : [],
    assembled: !!K.hand.assembled,
    madeAt: t,
  };
  K.pass.push(dish);
  K.hand = null;
  K.rev++;
  /* 📌 PLATE STRAIGHT TO AN ORDER. The second argument is optional and the
     whole feature degrades to nothing without it — a renderer that never passes
     it gets exactly the game the contract describes. With it, "tap the ticket
     you are cooking for, then plate" is one gesture, which is the cheapest
     possible answer to "not that burger, THAT burger" on a phone.
     ⚠ A REFUSED PIN NEVER FAILS THE PLATING. The food is already on the pass by
     the time we get here and pushing it back into the hand to punish a bad pin
     would be a data-loss bug dressed up as strictness. The reason comes back in
     `why` for a renderer that wants to say it; the plate is on the pass either
     way. */
  let pin = null, pinWhy = '';
  if (forTicketId) {
    const r = assignDish(dish.id, forTicketId);
    if (r.ok) pin = forTicketId; else pinWhy = r.why || '';
  }
  return ok({ dish, assigned: pin, why: pinWhy });
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
    // SEAM 1. Both names, one array, from the first frame — so drivethru.js's
    // buildsOf() never has to distinguish "no evidence yet" from "no field".
    builds: [],
    built: [],
  })).map((it) => { it.built = it.builds; return it; })
    .filter((it) => recipeOf(it.recipeId));
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

   ⚠ STILL REJECTED: making the player drag each dish onto a ticket by hand,
   as the ONLY way to feed a ticket. At 360px that is a fiddly drag-and-drop
   nightmare on a touch screen, and the fun in this genre lives in the cooking
   and the clock, not in the clerical work.

   🔴 BUT "the player decides WHEN an order goes out, not WHICH physical burger
   is in it" WAS TOO STRONG, AND IT COST A ROUND. If the game will not let the
   player choose the burger, then the game must choose it WELL — and it did not:
   it took the first array match, which handed the careful no-lettuce burger to
   the customer who never asked for one and then charged the player for breaking
   a promise they had kept (measured: 68% of kept promises booked as broken).
   So the rule now has two halves, and both are in WHO GETS WHICH PLATE below:
   the automatic choice reads what the ticket actually asked for, and when it
   still picks wrong, ONE OPTIONAL TAP overrides it (`assignDish`). Optional is
   what keeps the rejection above intact — no plain order ever needs a pin.

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
 *   It counts in `today.burnt` — and therefore against the S grade — because a
 *   plate you let rot under the lamp is neglect, the same lesson as a slot you
 *   let burn down, and the grade's clean sheet should notice both. `spoiled`
 *   is the same event counted separately so the settlement report can tell the
 *   player WHICH kind of waste it was. It is NOT `binned`: binning is a decision
 *   (see binPass), letting it rot is the absence of one.
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
    K.today.spoiled = _int(K.today.spoiled) + 1;
    K.totals.spoiled = _int(K.totals.spoiled) + 1;
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
 *
 * 🔴 IT IS SCORED AS TRIAGE, NOT AS WASTE, AND IT USED NOT TO BE.
 * This incremented `today.burnt` — the same tally as a slot burned down through
 * neglect — and `gradeFor()` pushes any grade-4 day down to an A the moment
 * `burnt` is non-zero. So the game charged the player for playing correctly:
 * measured, a bot that NEVER bins deadlocks the pass and finishes served=35
 * lost=64 grade D (c2_bin.mjs), while the bot that bins its way out finishes
 * far ahead and was then marked down for the bins. Breaking the deadlock is
 * mandatory play; mandatory play cannot be booked as incompetence.
 * The ingredients, the slot time and the lost sale are already the price, and
 * `today.binned` keeps it visible in the settlement report as a cost line —
 * which is where a cost belongs. It is simply not a grade input.
 */
export function binPass(dishId) {
  const i = K.pass.findIndex((d) => d && d.id === dishId);
  if (i === -1) return no('BAD_ARG', 'That plate is not on the pass.');
  const d = K.pass.splice(i, 1)[0];
  K.today.binned = _int(K.today.binned) + 1;
  K.totals.binned = _int(K.totals.binned) + 1;
  K.rev++;
  emit('cook:burnt', { stationId: null, slot: -1, recipeId: d.recipeId, spoiled: false, binned: true });
  fx('bin', 'binned', { recipeId: d.recipeId });
  return ok({ recipeId: d.recipeId });
}

/* ═══════════════════════════════════════════════════════════════════════════
   🧾 SEAM 1 — THE BUILD RECORD. What actually went onto the food.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 WHY THIS EXISTS: THE CUSTOMER'S PROMISE WAS WORTH ZERO CINDER.
   drivethru.js attaches modifiers to a drive-thru order — "no greens", "extra
   cheese", "well done" — and `judgeMod()` returns 'honoured' | 'broken' |
   'unproven' against the EVIDENCE of what the cook laid on the dish. That check
   is honest and it was reading a field nobody wrote. Measured over 12 seeded
   days at level 20, 94 promises judged: {honoured:0, broken:2, unproven:92}.
   Not one modifier was ever honoured, so the ✓ payoff branch was unreachable
   code and — worse — a controlled A/B on one seed had obeying "no greens" pay
   144 Cinder against 150 for ignoring it. The game paid you to ignore your
   customers, which is the exact opposite of the mechanic.

   The evidence never existed because `addStep()` wrote `slot.steps`, `pullSlot`
   dropped it, and `plateHand` never looked. Three assignments and a copy on
   commit close it. The chain, end to end, is:

       addStep()      → slot.steps = [ingId, …]       in LAY ORDER
       pullSlot()     → hand.built = slot.steps.slice()
       plateHand()    → dish.built = hand.built.slice()   (the dish on the pass)
       refreshReady() → item.builds = [ built | null, … ]  PROVISIONAL, per unit
       takeDishes()   → item.builds frozen from the units actually handed over

   🔴 `null` MEANS "NO EVIDENCE", AND AN EMPTY ARRAY DOES NOT.
   This is the one subtle thing in the whole seam and getting it backwards
   inverts the mechanic. `startCook()` already spent the FULL `recipe.needs` out
   of the pantry, so a dish nobody assembled contains everything the recipe calls
   for — the assembly mini-game is optional and a renderer may not even surface
   it. If an un-assembled dish reported `built: []`, drivethru's `countIn()`
   would count zero onions and score every "no onions" as HONOURED, handing out
   the payoff for a promise the player never made. So an un-assembled unit
   reports `null`: judgeMod reads it as 'unproven', worth nothing, and the
   player who never touches assembly is exactly where they are today — neutral.
   The player who DOES assemble gets a real promise with real money on it, in
   both directions.

   ⚠ TWO FIELD NAMES ON THE TICKET LINE, ON PURPOSE AND POINTING AT ONE ARRAY.
   `item.builds` is what drivethru.js's `buildsOf()` already reads; `item.built`
   is the name the round's cross-file brief settled on. They are the SAME array
   object, never two copies, so they cannot drift into disagreeing. This wants
   collapsing to one name in CONTRACT §2 the moment both sides can be edited in
   the same commit — but shipping a seam that only works if two builders guessed
   the same noun is how the last round produced 92 'unproven' verdicts.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One unit's evidence, or `null` when that unit carried none. See above.
 *
 * ⚠ IT RETURNS THE DISH'S OWN ARRAY, NOT A COPY, and that is deliberate on the
 * PROVISIONAL path only. `refreshReady()` runs every frame for every line on
 * the board, so slicing here would allocate ~100 throwaway arrays a frame for a
 * record nobody has committed to yet. A plated dish is immutable — nothing
 * writes `dish.built` after plateHand — so sharing the reference is safe.
 * `takeDishes()` slices at the moment of commit, because THAT record has to
 * outlive the dish it came from.
 */
function buildEvidence(dish) {
  if (!dish || !dish.assembled) return null;
  const b = dish.built;
  return (Array.isArray(b) && b.length) ? b : null;
}

/**
 * Point both names at ONE array, so the two readers cannot disagree.
 * → true when the record actually CHANGED, which the caller turns into a
 *   `rev++`: drivethru's `modVerdict()` chips are painted off `rev`, and a
 *   verdict that flips from 'honoured' to 'broken' because a nearer-due ticket
 *   took the good burger has to redraw or the chip is lying to the player.
 */
function setBuilds(item, arr) {
  const cur = item.builds;
  let same = Array.isArray(cur) && cur.length === arr.length;
  if (same) for (let i = 0; i < arr.length; i++) if (cur[i] !== arr[i]) { same = false; break; }
  if (same) return false;
  item.builds = arr;
  item.built = arr;
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   🎯 WHO GETS WHICH PLATE — ONE matcher, used by the look AND by the commit
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE BUG THIS EXISTS TO KILL: THE GAME TOLD YOU YOU BROKE A PROMISE YOU KEPT.

   `refreshReady()` and `takeDishes()` each took "the first dish on the pass
   whose recipeId matches". Nothing preferred the plate that kept the promise,
   nothing even looked at the modifier — so an invisible array index decided the
   verdict. Two cars, both ordering a Classic Burger, one of them saying "no
   greens". Cook BOTH correctly, one plain and one without lettuce, plate them,
   and which car gets which is decided by which one you happened to plate first.
   Measured, identical player actions, only the PLATING ORDER reversed
   (dt3/two.mjs vs dt3/two2.mjs): 111 paid / 0 tip / promise BROKEN against
   107 paid / 64 tip / HONOURED. At scale — twelve seeded days at level 20 with
   a bot that obeyed every hold modifier exactly — committed hold verdicts came
   out honoured 44 / broken 95: 68% of promises the player KEPT were charged as
   broken, leaving a perfect player 33 popularity WORSE OFF than one who never
   assembled anything at all.

   Being punished for something you did right, by a rule that appears nowhere on
   screen and that no control can influence, is the single worst thing a cooking
   game can do to a player. It was decided by array index.

   ── THE RULES, IN ORDER, AND THE ORDER IS THE WHOLE DESIGN ────────────────
     1. A PIN WINS.        `dish.forTicket` is the player saying out loud "this
                           one is for them" (assignDish / plateHand(now, id)).
                           Nothing outranks an instruction.
     2. THEN FIT.          Amongst equals, the plate that KEEPS this line's
                           promise beats the plate that breaks it.
                           `DriveThru.fitScore(item, dish)` scores exactly that:
                           +1 per honoured modifier, −1 per broken one, and 0
                           for every plate on a line that carries no modifiers.
     3. THEN CONTENTION.   A line that does not care which burger it gets takes
                           the one nobody else is asking for BY NAME. This is
                           the half a sort alone cannot do, and it is not
                           theoretical: in dt3/two.mjs the PLAIN car is nearer
                           due, so it picks first — without this rule it takes
                           the careful no-lettuce burger and hands the lettuce
                           one to the car that asked for no greens. One step of
                           lookahead. It is the difference between the fix
                           working in both plating orders and in only one.
     4. THEN OLDEST FIRST. Food does not improve under the lamp.

   🔴 IT IS A NO-OP ON A PLAIN BOARD, BY CONSTRUCTION. With no modifier and no
   pin anywhere on the board the whole thing short-circuits to the FIFO walk it
   has always been — same plates, same order, and not one extra fitScore() call
   on the tick path. Unmodded play is unchanged, which is the only reason a
   matcher is allowed to run sixty times a second.

   ⚠ GREEDY, NOT OPTIMAL, AND DELIBERATELY SO. The provably correct answer is a
   min-cost bipartite matching over (plates × lines) re-solved every frame.
   Rejected twice over: it is cubic on the tick path for a board of 12 against a
   pass of 24, and — much worse — its answers are unpredictable to a human.
   "Nearest due date picks first, every time" is a rule a player can hold in
   their head and steer with. "The solver rebalanced" is not a rule, it is a
   shrug, and this whole section exists because the player could not see why
   they were being judged.

   ⚠ AND THE MATCHER IS NOT THE ONLY ANSWER — SEE `assignDish()` BELOW. Note
   what that does and does not reverse of THE PASS's "STILL REJECTED: making the
   player drag each dish onto a ticket by hand". What was rejected, and still
   is, is drag-and-drop as the ONLY way to feed a ticket: at 360px that is
   clerical work with a fiddly hit target, and it would make every plain order
   into paperwork. A pin is optional, costs one tap, and exists for the case the
   automatic choice gets wrong — so that the player's answer to "not that one,
   THAT one" is a tap, and not an argument with an array index they cannot see.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Guarded fitScore. A line with no modifiers scores every plate 0, so the sort
 * below is a no-op for it — that fast exit is why this is affordable per frame.
 * A sibling module mid-rewrite returns a tie rather than throwing (rule 3).
 */
function fitOf(item, dish) {
  const mods = (item && Array.isArray(item.mods)) ? item.mods : null;
  if (!mods || !mods.length || !dish) return 0;
  try {
    if (typeof DriveThru.fitScore === 'function') return _num(DriveThru.fitScore(item, dish), 0);
  } catch (e) { /* a tie beats a throw inside a sort */ }
  return 0;
}

/**
 * The pin, resolved. → the ticket id this plate is spoken for by, or null.
 *
 * 🔴 A PIN WHOSE TICKET HAS GONE IS CLEARED HERE, AND THAT IS LOAD-BEARING. A
 * plate reserved for a customer who has been served, has walked out, or was
 * dropped at a forfeit is a plate NOBODY can ever be handed — a soft-lock built
 * out of a helpful feature, and exactly the shape of bug `spoilPass()` had to be
 * written to escape. The reservation dies with the order it named.
 */
function livePin(dish, boardIds) {
  const pin = dish && dish.forTicket;
  if (!pin) return null;
  if (boardIds[pin]) return pin;
  dish.forTicket = null;
  K.rev++;
  return null;
}

/** How badly does SOMEBODY ELSE want this exact plate? Rule 3, one step deep. */
function contentionOf(dish, item, wanters) {
  let worst = 0;
  for (const w of wanters) {
    if (w === item || w.recipeId !== dish.recipeId) continue;
    const f = fitOf(w, dish);
    if (f > worst) worst = f;
  }
  return worst;
}

/**
 * Rules 1→4, as one comparator. Lexicographic on purpose: there are no weights
 * to tune, so nobody can "balance" the promise against the queue.
 *
 * 🔴 THE FOUR "MATCHER MISSES" WERE MEASURED AND THEY ARE NOT MATCHER MISSES.
 * Round 4 left this at "4 of 152 committed hold verdicts read broken with a
 * promise-keeping plate physically on the pass", and the obvious reading — rule
 * 3's one-step contention lookahead handing the clean plate to a nearer-due line
 * — is wrong. Twelve seeded days at level 20, every break classified at the
 * instant of the commit:
 *     REACHABLE (clean plates >= the LINE'S QTY, and it broke anyway) :  0
 *     SHORT     (some clean, fewer than the line needed — unkeepable)  :  4
 *     STARVED   (no clean plate of that recipe existed at all)         : 84
 * All four "misses" are qty-TWO lines with exactly ONE clean plate on the pass:
 * a shake ×2 hold-milk against one clean shake, a chickenSandwich ×2 hold-pickle
 * against one clean, and an icedCoffee ×2 hold-ice-and-milk against one clean
 * (counted twice, once per mod). The matcher took the clean plate and one dirty
 * one, which is the best assignment that exists — a second unit cannot be kept
 * out of a plate nobody cooked. The earlier count asked "was a clean plate
 * available?" when the question is "were there `qty` of them?".
 *
 * ⚠ SO NOTHING CHANGED HERE, DELIBERATELY. The same run also checked the one
 * shape that WOULD justify a rewrite — a line spending the last clean plate on a
 * promise it cannot keep anyway while a rival line could have been kept whole —
 * and found it 0 times out of 88. A two-pass 2-opt over the board was written,
 * measured against that number, and dropped: it is a change with a real
 * regression surface across 148 currently-correct verdicts bought with nothing.
 *
 * 🔴 RE-MEASURED AGAIN THIS ROUND, WITH THE LINE'S `qty` PRINTED THIS TIME —
 * because "2 of 155 still read broken with a keeping plate on the pass" keeps
 * being carried forward as if it were an open matcher bug, and it is not.
 * r6/mis.mjs, twelve seeded days, every break classified at the instant of the
 * commit: honoured 52, broken 103, of which a clean plate existed for exactly
 * TWO, and both are:
 *     1 clean plate vs qty 2 of chickenSandwich, mod no_pickle,  filled 2
 *     1 clean plate vs qty 2 of pizzaPepperoni,  mod no_sauce,   filled 2
 * The matcher took the clean plate AND one dirty one, which is the best
 * assignment that physically exists — a second unit cannot be kept out of a
 * plate nobody cooked. Changing the comparator cannot reach either case.
 *
 * The residual is a DRIVE-THRU one and it is not in this file: `judgeMod()` is
 * all-or-nothing per line, so keeping one of two units reads exactly like
 * keeping neither. Everything a per-UNIT verdict needs is already on the seam —
 * `item.builds` is one build record PER UNIT in hand-over order (see SEAM 1 in
 * takeDishes) and `fitScore(item, dish)` already scores a single plate — so the
 * fix is a loop in drivethru.js and nothing here. Named, with the numbers, so
 * the next reader stops re-opening the matcher.
 */
function cmpCand(a, b) {
  if (a.pin !== b.pin) return b.pin - a.pin;      // 1. the player said so
  if (a.fit !== b.fit) return b.fit - a.fit;      // 2. keep the promise
  if (a.cont !== b.cont) return a.cont - b.cont;  // 3. leave the contested plate
  return a.i - b.i;                               // 4. oldest first
}

/**
 * THE ASSIGNMENT. Decides who WOULD get what and moves nothing.
 *
 * 🔴 BOTH CALLERS USE THIS ONE FUNCTION, AND THAT IS THE POINT. The verdict
 * drawn on the ticket chip came from `refreshReady()`'s assignment and the money
 * came from `takeDishes()`'s, and the two used DIFFERENT rules: refreshReady
 * walked the whole board with a `used` map, takeDishes looked at one ticket in
 * isolation. So the chip could promise a kept promise and the till could pay a
 * broken one on the same transaction. One matcher, one answer, both readers.
 *
 * → { board:[ticket…], byTicket:{ id: {ticket, lines:[{item,dishes[]}], complete} } }
 */
function planPass(now) {
  const board = K.tickets
    .filter((x) => x.state === 'open' || x.state === 'ready')
    .sort((a, b) => _num(a.dueAt) - _num(b.dueAt));
  const plan = { board, byTicket: Object.create(null) };
  if (!board.length) return plan;

  const boardIds = Object.create(null);
  const wanters = [];                      // every line carrying a promise
  for (const tk of board) {
    boardIds[tk.id] = 1;
    for (const it of tk.items) if (it && it.mods && it.mods.length) wanters.push(it);
  }
  /* Resolve every pin ONCE, here, rather than lazily inside the candidate loop.
     A pin on a plate that no ticket on the board even orders would otherwise
     never be reached and would keep the expensive path armed forever. */
  let pinned = false;
  for (const d of K.pass) if (d && livePin(d, boardIds)) pinned = true;
  // 🔴 THE FAST EXIT. Nothing on this board cares which physical plate it gets,
  //    so neither does the matcher: plain FIFO, no scoring, no sort, no cost.
  const fancy = wanters.length > 0 || pinned;

  const used = Object.create(null);         // pass dish id → spoken for
  for (const ticket of board) {
    const lines = [];
    let complete = true;
    for (const item of ticket.items) {
      const need = Math.max(0, _int(item.qty));
      const cands = [];
      for (let i = 0; i < K.pass.length; i++) {
        const d = K.pass[i];
        if (!d || used[d.id] || d.recipeId !== item.recipeId) continue;
        let pin = 0;
        if (pinned && d.forTicket) {
          if (d.forTicket !== ticket.id) continue;      // spoken for, by name
          pin = 1;
        }
        cands.push({ d, i, pin, fit: 0, cont: 0 });
        if (!fancy && cands.length >= need) break;      // the old FIFO, exactly
      }
      if (fancy && cands.length > 1) {
        for (const c of cands) {
          c.fit = fitOf(item, c.d);
          c.cont = contentionOf(c.d, item, wanters);
        }
        cands.sort(cmpCand);
      }
      const mine = [];
      for (let k = 0; k < cands.length && mine.length < need; k++) {
        used[cands[k].d.id] = 1;
        mine.push(cands[k].d);
      }
      if (mine.length < need) complete = false;
      lines.push({ item, dishes: mine });
    }
    plan.byTicket[ticket.id] = { ticket, lines, complete };
  }
  return plan;
}

/**
 * 📌 PIN ONE PLATE TO ONE ORDER — the player's override of rules 2–4.
 *
 * ⚠ NOT IN CONTRACT §1's EXPORT LIST. This is the "say so" the contract asks
 * for: it wants adding to §1 beside `binPass`, `addStep` and `dumpSupply`.
 *
 * `assignDish(dishId, null)` un-pins. Pinning is idempotent and always
 * reversible, because the one thing a steering control must never do is trap
 * the player in a choice they made by mis-tapping a 360px screen.
 *
 * 🔴 IT REFUSES A PIN THE ORDER CANNOT USE, rather than accepting it and
 * quietly doing nothing: a pin on a dish that customer did not order, or a
 * fourth burger pinned to a two-burger line, would sit on the pass looking like
 * an instruction while the matcher ignored it. A control that lies about
 * whether it took effect is worse than no control.
 */
export function assignDish(dishId, ticketId) {
  const dish = K.pass.find((d) => d && d.id === dishId);
  if (!dish) return no('BAD_ARG', 'That plate is not on the pass.');

  if (!ticketId) {
    if (!dish.forTicket) return ok({ dishId, ticketId: null });
    dish.forTicket = null;
    K.rev++;
    return ok({ dishId, ticketId: null });
  }

  const ticket = K.tickets.find((x) => x.id === ticketId && (x.state === 'open' || x.state === 'ready'));
  if (!ticket) return no('BAD_ARG', 'That order is gone.');
  const line = ticket.items.find((it) => it && it.recipeId === dish.recipeId);
  if (!line) {
    const r = recipeOf(dish.recipeId);
    return no('BAD_ARG', `${(ticket.name || 'They')} did not order ${(r && r.name) || 'that'}.`);
  }
  let already = 0;
  for (const d of K.pass) {
    if (d && d !== dish && d.forTicket === ticketId && d.recipeId === dish.recipeId) already++;
  }
  const want = Math.max(1, _int(line.qty));
  if (already >= want) {
    return no('CAP', `That order only wants ${want}. Un-pin one first.`);
  }
  dish.forTicket = ticketId;
  K.rev++;
  return ok({ dishId, ticketId });
}

/** Which order a plate is pinned to, or null. Read-only, for the renderer. */
export function assignmentOf(dishId) {
  const dish = K.pass.find((d) => d && d.id === dishId);
  return (dish && dish.forTicket) || null;
}

/**
 * LOOK, DO NOT TOUCH. Runs every tick.
 * Writes `item.filled` (how much of that line the pass can currently cover),
 * `item.pn` and the provisional build record, and flips tickets between 'open'
 * and 'ready'. It moves nothing and it charges nothing — `takeDishes()` does
 * both, at the moment the player serves.
 *
 * 🔴 A TICKET CAN GO BACK TO 'open'. If a nearer-due order takes the last
 * burger, a ticket that was 'ready' a frame ago is not any more, and the SERVE
 * button has to disappear rather than sit there promising something the pass
 * cannot deliver. The transition is two-way on purpose.
 *
 * 🔴 IT ALSO WRITES THE PROVISIONAL BUILD RECORD (see SEAM 1 below), and it has
 * to happen HERE rather than only at serve time: drivethru.js calls
 * `judgeTicket()` BEFORE `State.serveTicket()` — it has to, because serving
 * removes the ticket from the board and takes the mods with it — and
 * `modVerdict()` is drawn on the ticket chips every single frame. A verdict the
 * player only learns after the fact is a mechanic they will never learn at all.
 */
function refreshReady(now) {
  const plan = planPass(now);
  for (const ticket of plan.board) {
    const p = plan.byTicket[ticket.id];
    if (!p) continue;
    for (const line of p.lines) {
      const item = line.item;
      const builds = [];
      let pn = 0;
      for (const d of line.dishes) {
        builds.push(buildEvidence(d));
        if (d.quality === 'perfect') pn++;
      }
      if (setBuilds(item, builds)) K.rev++;
      if (line.dishes.length !== _int(item.filled)) { item.filled = line.dishes.length; K.rev++; }
      /* 🔴 THE PROVISIONAL `pn`, AND IT IS NOT BOOKKEEPING. drivethru's
         `judgeMod()` answers "well done" with `item.pn >= item.filled`, and `pn`
         used to be written ONLY by takeDishes() — so for the entire life of a
         ticket it was 0 and every `well_done` promise read 'broken'. Measured
         (dt3/wd.mjs) on ONE perfect burger against "well done": the chip said ✗,
         the reward toast said "✗ well done", popularity was docked 0.5 — and the
         till, judging AFTER the commit wrote pn, paid the honoured tip of 56 on
         the same transaction. Over twelve seeded days the shown verdict and the
         paid verdict disagreed on 14 drive tickets, every one of them this.
         The chip, the toast, the popularity and the Cinder now read one number. */
      if (pn !== _int(item.pn)) { item.pn = pn; K.rev++; }
    }
    const want = p.complete ? 'ready' : 'open';
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
 * → the array of dishes taken, or null if the assignment cannot cover it (in
 *   which case NOTHING is taken — the two-phase shape below is the whole point).
 *
 * `qsum` is the SUM of quality multipliers of the units handed over, and
 * staleness is applied HERE rather than at plating time because a plate's age is
 * a property of the instant it reaches the customer, not of when it was made.
 *
 * 🔴 IT ASKS `planPass()` — THE SAME QUESTION THE CHIP ASKED. It used to walk
 * the pass itself, taking the first recipe match with no `used` map at all, so a
 * ticket could physically be handed a plate that `refreshReady()` had already
 * shown as belonging to somebody else. See the block at the top of this section.
 */
function takeDishes(ticket, now) {
  const plan = planPass(now);
  const p = plan.byTicket[ticket.id];
  if (!p || !p.complete) return null;      // ← refuse before touching anything

  const taken = [];
  for (const line of p.lines) {
    const item = line.item;
    item.filled = 0; item.qsum = 0; item.xn = 0; item.pn = 0; item.rn = 0;
    /* 🔴 SEAM 1, THE COMMIT HALF. `refreshReady()` wrote a PROVISIONAL record
       every tick against whatever the pass happened to be holding; these are
       the units that physically went out of the window, in hand-over order, and
       this is the record the till is judged on. Rebuilt rather than trimmed,
       because the provisional list can contain plates a nearer-due ticket took
       between the last look and this commit. */
    const builds = [];
    for (const d of line.dishes) {
      const idx = K.pass.indexOf(d);
      if (idx !== -1) K.pass.splice(idx, 1);
      item.filled++;
      item.qsum += _num(d.mult, 1) * stalenessMul(d, now);
      if (d.quality === 'raw') item.rn++; else item.xn++;
      if (d.quality === 'perfect') item.pn++;
      const ev = buildEvidence(d);
      builds.push(ev ? ev.slice() : null);   // ← COMMIT: copy, the dish is leaving
      taken.push(d);
    }
    setBuilds(item, builds);
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
 * 💷 WHAT THIS ORDER WOULD PAY, RIGHT NOW. Pure read. → null when it cannot be
 * answered honestly (no such ticket, already gone, or the pass cannot cover it).
 *
 * 🔴 THIS IS A CONSUMER THAT WAS ALREADY WRITTEN AND WAITING. `ticketWorth()`
 * in kitchen.render.js:1014-1015 has been calling `State.quoteTicket(t.id, nowMs())`
 * behind a `typeof … === 'function'` guard, and this file never exported it — so
 * the SERVE button has been falling back to a plain "Serve" with no figure on
 * it. Same failure shape as the relief drop, running the other way round: there
 * the data existed with no consumer, here the consumer existed with no data.
 * Both are "somebody shipped half a seam".
 *
 * 🔴 IT IS THE TILL'S OWN ARITHMETIC, NOT A SECOND COPY OF IT. Every term below
 * is the same term `serveTicket()` uses, in the same order, off the same
 * `planPass()` assignment — including staleness, which is a property of the
 * instant the plate reaches the customer and therefore moves between frames.
 * A price beside a button is read as a price; the previous attempt at this drew
 * a per-line chip that was out by a factor of two. Print the till's number or
 * print no number.
 */
export function quoteTicket(ticketId, now) {
  const t = _num(now, K.now);
  const ticket = K.tickets.find((x) => x && x.id === ticketId);
  if (!ticket) return null;
  if (ticket.state === 'served' || ticket.state === 'lost') return null;
  const p = planPass(t).byTicket[ticket.id];
  if (!p) return null;

  let gross = 0, xp = 0, units = 0, qsum = 0;
  for (const line of p.lines) {
    const r = recipeOf(line.item.recipeId);
    if (!r) continue;
    let lq = 0, pn = 0, xn = 0;
    for (const d of line.dishes) {
      lq += _num(d.mult, 1) * stalenessMul(d, t);
      units++;
      if (d.quality !== 'raw') xn++;
      if (d.quality === 'perfect') pn++;
    }
    gross += _num(r.basePrice, 0) * lq;
    qsum += lq;
    xp += _int(r.xp) * Math.max(0, xn - pn) + Math.round(_int(r.xp) * pn * EC('XP_PERFECT_MULT', 1.5));
  }

  const popFn = DF('popPayMul'), rushFn = DF('rushPayMul');
  const popMult = popFn ? _num(popFn(K.popularity), 1)
                        : EC('POP_PAY_FLOOR', 0.8) + (K.popularity / 100) * EC('POP_PAY_SPAN', 0.4);
  const rushMult = rushFn ? _num(rushFn(K.shift.rush), 1) : 1;
  const paid = Math.max(0, Math.round(gross * popMult * rushMult));
  const onTime = t <= _num(ticket.dueAt, t);
  if (onTime && units > 0) xp += _int(EC('XP_TICKET_BONUS', 6));
  const avgQ = units > 0 ? (qsum / units) : 0;
  const tip = tipFor(ticket, avgQ, t, paid);
  return { paid, tip, total: paid + tip, xp, units, quality: avgQ, onTime, complete: !!p.complete };
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

/**
 * Move the popularity meter.
 *
 * 🔴 IT USED TO BE A BARE ADD-AND-CLAMP AND THAT IS WHY THE METER HAS TWO DEAD
 * ZONES. `_clamp(pop + delta, 0, 100)` is fine for one shift out of a fresh
 * save — the round-3 measurement that said "the meter resolves skill" was
 * exactly that, one fresh day — and it falls apart the moment state carries
 * over, which is the state a real player is ALWAYS in. Ten consecutive days per
 * skill tier, two seeds each, level 12 + heatlamp:
 *     GOD ended 93.8 / 89.7, EXPERT 93.5 / 90.6, GOOD 92.0 / 90.1
 * — three tiers six points apart on day one, within two points of each other by
 * day ten, because everybody who is even roughly competent walks into the 100
 * rail and stops. At the other end SLOPPY read 24.4, 11.6, then 0, 0, 0, 0, 0,
 * 0, 0, 0 — eight days pinned at exactly zero. kitchen.data.js:1366 already
 * records that failure in its own words ("a meter pinned at ZERO does not move
 * either, and it has stopped being feedback"); it was fixed for the OLD flat
 * quality distribution and the sharper PERFECT_MS re-created it.
 *
 * A hard clamp is a wall. What a reputation meter wants is a HORIZON: movement
 * toward a rail gets harder the closer you already are, and movement away from
 * it does not. So a delta is damped by how much ROOM is left in the direction it
 * is pushing, and only inside the last POP_SOFT_MARGIN of that room:
 *
 *     room = delta > 0 ? (MAX - pop) : (pop - MIN)
 *     if (room < margin) delta *= room / margin
 *
 * Three things fall out of that, and they are the whole reason for the shape:
 *  1. Neither rail is ever reached, so the meter never stops being feedback. A
 *     tier settles where its gains and its losses balance —
 *     `pop* = MAX − margin × (losses ÷ gains)` at the top — which is a
 *     DIFFERENT number for every skill level instead of the same 100.
 *  2. The middle of the range is untouched. Outside the margin the multiplier
 *     is exactly 1, so the day-one dynamics the previous round measured and
 *     tuned (POP_SERVE, POP_PERFECT_BONUS, POP_LOST) are unchanged, and this is
 *     not a second, quietly-diverging copy of the popularity economy.
 *  3. It is symmetric, so the fix at the top is the same code as the fix at the
 *     bottom. Damping only the top would have left the zero-pin exactly where
 *     it was.
 *
 * ⚠ REJECTED: damping EVERY delta by (100 − pop)/100 (a full logistic). It has
 * the same fixed-point property and it halves the meter's responsiveness at
 * popularity 50, which is where a new player lives — the first shift would move
 * half as far and the one place the meter demonstrably worked would get worse.
 * The knee buys the rails without spending the middle.
 *
 * ⚠ REJECTED: a hard floor ("popularity never drops below 5"). That is a lie
 * with a number on it: the meter would still be pinned, just at 5, and the
 * player still could not tell a bad day from a slightly better one.
 *
 * MEASURED, ten consecutive days per tier, six seeds each, level 12 + heatlamp,
 * day-10 mean popularity. Before / after (margin 40):
 *     GOD     93.8, 89.7  →  69.0        AVERAGE     —      →  28.0
 *     EXPERT  93.5, 90.6  →  65.8        SLOPPY  0,0,0,0…   →  16.5, min 13.6
 *     GOOD    92.0, 90.1  →  62.4
 * The top three were two points apart and are now 6.6, in the right order; the
 * bottom was eight consecutive days of exactly 0.0 and is now strictly positive
 * on every seed of every tier. The margin was swept, not chosen: 25 keeps more
 * of day one's swing (day-1 GOD−SLOPPY 48.2 vs 40.6) and gives back most of the
 * day-10 separation (3.8 between GOD and GOOD), 55 flattens day one to a
 * 29.7-point range for one more point of separation. 40 is where both are still
 * worth reading.
 *
 * ⚠ AND IT IS A FIX TO THE SHAPE, NOT TO THE POPULARITY ECONOMY, WHICH STILL
 * OWES SOMETHING. 6.6 points across GOD/EXPERT/GOOD is not the 8 the critique
 * asked for, and no value of this margin buys it: the three tiers cook within
 * 1% of each other, so what separates them has to come from weighting the
 * PERFECT share harder — POP_SERVE 0.10 against POP_PERFECT_BONUS 0.36 and
 * POP_LOST −1.0. Those are kitchen.data.js's numbers and re-deriving them
 * against the measured per-tier perfect share is that file's job, not this
 * one's. This function stops the meter hitting a wall; it cannot invent a
 * difference the economy never paid out.
 *
 * ⚠ POP_SOFT_MARGIN DEFAULTS LIVE, NOT OFF. `EC()`'s second argument is a NaN
 * guard everywhere else in this file, and this is the one place that needs
 * saying out loud: a guard of 0 would disable the knee, and shipping a fix that
 * only works if a sibling file remembers to add a key is how POP_REVERT_BELOW
 * spent a whole round as dead data. If kitchen.data.js sets it, data wins.
 */
function bumpPop(delta, why) {
  const lo = EC('POP_MIN', 0);
  const hi = EC('POP_MAX', 100);
  const before = _clamp(_num(K.popularity, EC('POP_START', 50)), lo, hi);
  let d = _num(delta, 0);
  const margin = EC('POP_SOFT_MARGIN', 40);
  if (d !== 0 && margin > 0) {
    const room = Math.max(0, d > 0 ? (hi - before) : (before - lo));
    if (room < margin) d *= room / margin;
  }
  K.popularity = _clamp(before + d, lo, hi);
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

  /* 🔴 RESUME, DO NOT REWIND. See closeShift() for the whole argument. A shift
     the player walked out of is picked back up where they left it — same hour,
     same tallies — and the customers they abandoned are billed HERE, at the
     moment it becomes clear they did not leave, they dodged. */
  const bail = (K.shift.bail && _int(K.shift.bail.day) === _int(K.shift.day)) ? K.shift.bail : null;
  K.shift.bail = null;
  // tMs 0 IS the opening bell — DATA.hourAt() maps 0..DAY_MS onto
  // OPEN_HOUR..CLOSE_HOUR, so there is no offset to apply here.
  K.shift.tMs = bail
    ? _clamp(_num(bail.tMs, 0), 0, EC('DAY_MS', 720000) + EC('LAST_CALL_MS', 45000))
    : 0;
  K.shift.running = true;
  K.shift.rush = rushNow();
  K.today = bail ? mergeToday(bail.today) : freshToday();
  K._report = null;
  K._nextCounter = t + EC('SHIFT_GRACE_MS', 4000);
  K.rev++;
  emit('shift:open', {
    day: K.shift.day, dayName: dayNameFor(K.shift.day),
    resumed: !!bail, tMs: K.shift.tMs, owed: bail ? _int(bail.owed) : 0,
  });

  /* THE DEFERRED BILL. One event carrying a count rather than N events: ten
     toasts in a row for one decision is noise, and CONTRACT §6's `ticket:lost`
     already takes a null ticketId (see turnAway) for a sale that never got a
     ticket of its own. The popularity is priced from ECON here, at the moment
     it is charged, and never stored. */
  if (bail) {
    const n = Math.max(0, _int(bail.owed));
    if (n > 0) {
      K.today.lost += n;
      K.totals.lost += n;
      // The same guard value loseTicket() uses, so a missing ECON key cannot
      // make walking out cost a different amount than staying and losing them.
      bumpPop(EC('POP_LOST', -3.5) * n, 'abandoned');
      emit('ticket:lost', { ticketId: null, source: 'counter', carId: null, why: 'abandoned', count: n });
      fx('lost', `${n} walked out`);
    }
  }
  return true;
}

/** A saved/kept `today` folded onto the canonical shape, numbers only. A tally
    that arrived from a save cannot be trusted to have the right keys — or to
    hold numbers at all — and `freshToday()` is the only definition of shape. */
function mergeToday(src) {
  const out = freshToday();
  if (src && typeof src === 'object') {
    for (const k of Object.keys(out)) {
      /* ⚠ THE RESOURCE TALLIES ARE DICTS, NOT NUMBERS. `_num({food:12}, 0)` is
         0, so folding them the numeric way would silently wipe a resumed
         shift's ledger line — the exact "computed and never consumed" shape
         this round exists to delete, one level down. */
      if (out[k] && typeof out[k] === 'object') {
        const d = src[k];
        if (d && typeof d === 'object') {
          for (const id of Object.keys(d)) {
            const n = _int(d[id]);
            if (n > 0) out[k][id] = n;
          }
        }
        continue;
      }
      const v = _num(src[k], 0);
      out[k] = (isFinite(v) && v > 0) ? v : 0;
    }
  }
  return out;
}

/**
 * End the shift.
 *
 * TWO DIFFERENT ENDINGS, and the difference matters:
 *  • `{forfeit:true}` — the player closed the panel. Open tickets are dropped
 *    with NO popularity penalty CHARGED NOW, and the day does NOT advance. If
 *    they never come back, that is the end of it: leaving is free, because
 *    punishing an interruption trains players to leave the tab open forever.
 *  • no opts — the closing bell rang. Anyone still waiting walked out and it
 *    counts, the day advances, and a settlement report is emitted. THAT is the
 *    incentive to clear your board before close.
 *
 * 🔴 THE FORFEIT WAS A REWIND BUTTON, AND THAT IS THE BUG THIS FIXES.
 * Dropping the board cost nothing and `openShift()` then set `tMs = 0` — which
 * DATA.hourAt() maps to 10:00, the quietest of the twelve hours (rush 0.73
 * against 2.66 at 19:00). index.js wires exactly this to the X in the corner of
 * the overlay, so the panel's close button was "restart the day at the easiest
 * hour, keep everything you earned, lose nothing". Measured (c3_bail.mjs, a
 * weak player on 2.5s reactions, two full days of wall time, five seeds):
 * sitting the bad shift out finished at popularity 28.8/18.1/31.3/28.1/32.8;
 * tapping the X whenever the board reached 10 of 12 finished at
 * 61.8/56.8/59.1/53.5/61.5 — roughly DOUBLE, on five seeds of five, with the
 * day counter still stuck on 1 so no decay, no grade and no lost-ticket history
 * was ever recorded. The one meter the HUD grades you on could be held near 60
 * forever without ever running a rush.
 *
 * 🔴 SO THE COST IS DEFERRED, NOT WAIVED, AND THE DIFFERENCE IS WHETHER YOU
 *    CAME BACK. `shift.bail` records the hour you walked out at, the tallies so
 *    far, and HOW MANY customers you left standing. Never come back → nothing is
 *    ever charged, exactly as §4 wants. Re-open the same day → it is a
 *    RESUMPTION: the clock picks up where it stopped, the tallies continue, and
 *    the abandoned customers are billed at ECON.POP_LOST apiece, which is what
 *    they would have cost had you stayed. You did not leave; you dodged.
 *    Rejected alternative: charging at the moment of forfeit. It reads simpler
 *    and it taxes exactly the case §4 wrote three paragraphs to protect — the
 *    person whose phone rang.
 *
 * ⚠ ONE HOLE, NAMED HONESTLY: `shift.bail` rides in the save (snapshot()), so it
 *   survives a panel close and a page reload alike. What it cannot survive is a
 *   save that never lands (signed out, storage refused). That degrades to
 *   today's behaviour — free — and it costs a full reload of an 11.6 MB app per
 *   dodge, which is a worse trade than simply playing the rush.
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
    // The unfinished shift, so that coming back is a resumption and not a
    // fresh, easier morning. `owed` is a COUNT — priced in openShift().
    K.shift.bail = {
      day: _int(K.shift.day),
      tMs: Math.max(0, _num(K.shift.tMs, 0)),
      owed: openTickets.length,
      today: Object.assign({}, K.today),
    };
  } else {
    for (const x of openTickets) loseTicket(x, 'closing', t);
  }

  // ONE evaluation of the axes, read three times below (letter, service, craft)
  // — the grade must not be able to disagree with the numbers printed under it.
  const parts = gradeParts(K.today);
  const report = {
    day: K.shift.day,
    dayName: dayNameFor(K.shift.day),
    served: K.today.served,
    lost: K.today.lost,
    burnt: K.today.burnt,
    // The two halves of `burnt`, plus the cost line that is deliberately NOT a
    // grade input. See binPass() and gradeFor().
    spoiled: _int(K.today.spoiled),
    binned: _int(K.today.binned),
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
    /* 🔴 THE TWO NUMBERS THE LETTER IS MADE OF, SHIPPED ALONGSIDE IT. Round 3
       computed modCinder/modPop and never rendered them; the letter has spent
       four rounds asserting a verdict with no working. A player who reads
       "grade B" learns nothing they can act on — "you served 83% of what the
       rack could physically turn out, and what you cooked averaged 91% of
       perfect" tells them WHICH of the two to fix tonight. Both 0..1, rounded
       to whole percent so render never has to think about it. */
    service: Math.round(parts.service * 100),
    craft: Math.round(parts.kitchen * 100),

    /* 🥫 THE LOOP, ON THE RECEIPT. The one screen that summarises a day showed
       SERVED · WALKED · BURNT · CINDER · TIPS · XP and said nothing whatsoever
       about the live 14-id ledger — which is the feature the player asked for
       in the first place ("uses the food and food type resources … that they
       get from the other parts of the game"). On a resourced account a single
       day burns roughly 450 food and the player was shown a Cinder number and
       nothing else. The premise is legible on the Supplies sheet and on the
       prep-counter strip and then vanishes at exactly the point a player forms
       their model of what this business costs to run. REF-B puts it here.

       `resSpent` / `resGained` are `{liveResId: units}`, `cinderSpent` is what
       the restocking cost, and `foodSpent` is the lifetime total for the ALL
       TIME strip. All four are read straight off the tallies; none of them is
       re-derived, so the receipt cannot disagree with the ledger. */
    resSpent: Object.assign({}, K.today.resSpent || {}),
    resGained: Object.assign({}, K.today.resGained || {}),
    cinderSpent: _int(K.today.cinderSpent),
    foodSpent: _int((K.today.resSpent || {}).food),
    /* 🔴 AND THE SENTENCE, PRE-BUILT, BECAUSE THE HALF OF THIS THAT LIVES IN
       kitchen.render.js IS SOMEBODY ELSE'S LINE TO WRITE. Handing the screen a
       dict means the screen decides the wording, the order, the units and the
       icons — four chances to disagree with the Supplies sheet, which already
       has a house style for this. `resLine` is empty when nothing moved, so the
       row can be `${rep.resLine ? …row… : ''}` exactly like the waste line
       above it. It is a DISPLAY string and it is deliberately the only one this
       file produces beyond the `{why}` sentences the actions already return. */
    resLine: resLineFor(K.today),
    /* Net Cinder, because "earned 4,120" beside "spent 3,980" is the sentence,
       and a player should not have to do that subtraction on a phone. */
    net: _int(K.today.earned) + _int(K.today.tips) - _int(K.today.cinderSpent),
    lifetime: {
      served: _int(K.totals.served), days: _int(K.totals.days),
      earned: _int(K.totals.earned), foodSpent: _int(K.totals.foodSpent),
    },
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
    /* 🔴 MEAN REVERSION — kitchen.data.js names THIS function as the consumer of
       POP_REVERT_BELOW / POP_REVERT_PER_DAY and it was reading neither, so a bad
       week compounded into a dead account: decay applies at every day roll, and
       at popularity 4 a decay is the difference between climbing out and not.
       Below the threshold the town's memory fades and reputation drifts back UP
       toward it, INSTEAD of decaying — not a floor and not a gift, because the
       drift is strictly smaller than one good day's service, so climbing out is
       still something the player does. Above the threshold nothing changes and a
       famous kitchen decays normally.
       ⚠ BOTH KEYS DEFAULT TO ZERO. If the data file drops them the branch can
       never be taken and the behaviour is exactly what it was — the fallbacks in
       EC() are NaN guards, never tuning (see EC's header). */
    const revertBelow = EC('POP_REVERT_BELOW', 0);
    const revertPer = EC('POP_REVERT_PER_DAY', 0);
    if (revertPer > 0 && K.popularity < revertBelow) {
      bumpPop(Math.min(revertPer, revertBelow - K.popularity), 'day-revert');
    } else {
      bumpPop(EC('POP_DECAY_PER_DAY', -1.5), 'day-decay');
    }
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
 * The day's grade — the two axes it is made of, before the letter.
 *
 * 🔴 ROUND 1: IT READ ONLY served/(served+lost) AND `burnt === 0`, SO QUALITY
 * DID NOT EXIST. A bot that served 195 consecutive RAW dishes finished on an S.
 * "Did food arrive" is a delivery metric, not a cooking one.
 *
 * 🔴 ROUND 4: THE FIX FOR THAT WAS `Math.min(service, kitchen)` AND IT THREW THE
 * WHOLE SKILL SIGNAL AWAY. Measured, 6 skill tiers × 12 seeds at level 12: the
 * KITCHEN tier read 4/4/4/3/2/2 — monotone across tiers, zero seed noise inside
 * a tier, a flawless reading. The SERVICE tier read 2 for EVERY tier from a
 * 50-action-per-second machine (0.827) down to a distracted human (0.770),
 * because the band 0.75..0.90 was wider than the entire human range. `min()`
 * takes the constant, so 60 of 72 shifts graded B. The report card could not see
 * the thing the rest of the game had just learned to measure.
 *
 * 🔴 AND THE TERM THAT SURVIVED REWARDED FAILURE, WHICH IS WORSE THAN NOISE.
 * Popularity drives the arrival rate (kitchen.data.js `spawnIntervalMs`: pop 0 →
 * 8,000ms, pop 100 → 4,000ms — exactly double the custom), so the reward for
 * playing well was more customers than the rack can hold, a smaller SHARE
 * served, and a lower letter. Same frame-perfect bot, same 8 seeds, popularity
 * pinned: pin 25 → svc 0.855, grades BBBABABB; pin 95 → svc 0.774, grades
 * CBBBBBBB, on identical mean quality (1.186 vs 1.187) and 71% more Cinder. An A
 * at level 12 was reachable only by being unpopular. A grade that falls as you
 * succeed is not a grade, it is a tax on winning.
 *
 * ── SO THE TWO AXES ARE NOW THESE, AND NEITHER CAN VETO THE OTHER ──
 *
 * SERVICE — the share of the custom you could PHYSICALLY have served that you
 *   did serve. Not the share that walked in. `capacityModel()` in
 *   kitchen.data.js already computes the rack's ceiling per in-game hour, so the
 *   denominator is `min(demand, ceiling)`:
 *     • quiet shop (demand under the ceiling) → "did you serve everyone who
 *       came", which is the old question and the right one when nobody is
 *       queueing;
 *     • slammed (demand over the ceiling) → "did you push the rack to its
 *       limit", which is the only fair question when the door will not stop
 *       opening. Popularity can now only ADD to the numerator, never to the
 *       denominator, so getting more famous can no longer lower the letter.
 *   Measured after the change, same bot, popularity pinned 10→95: service
 *   0.854 / 0.890 / 0.915 / 0.958 / 0.990. It was 0.854 / 0.865 / 0.832 / 0.808
 *   / 0.776. The axis stopped running backwards.
 *
 *   ⚠ GRADE_CAP_DUTY IS NOT A FUDGE, IT IS THE MISSING HALF OF THE MODEL.
 *   `capacityModel()` says so itself: it "ignores the player's hands entirely,
 *   which is why peakRatio wants to be comfortably ABOVE 1". Its raw number is
 *   every slot cooking 100% of the time with nobody plating, serving or buying —
 *   26.9 dishes/hour at level 12, against 17.9 for a bot with a zero-millisecond
 *   reaction and fifty actions a second. Grading against the un-derated rack
 *   made the ceiling unreachable by 50% and the denominator never bound, which
 *   is the same bug in a new hat. 0.70 is the duty cycle two thumbs sustain;
 *   it is the ONE number here that is fitted, and it is fitted to the measured
 *   ceiling, not to a feel. It lives in ECON like every other price.
 *
 * KITCHEN — the mean quality multiplier of everything you COOKED, on the
 *   ECON.Q_* scale (raw 0.5, good 1.0, perfect 1.25), normalised onto 0..1.
 *
 *   🔴 "COOKED", NOT "SERVED", AND THAT ONE WORD IS THE THIRD BUG THIS FUNCTION
 *   HAS HAD. Burnt food never reaches a customer, so it never reached `qsum`,
 *   so BURNING WAS INVISIBLE TO BOTH AXES. Measured: a bot that burns 33.5
 *   dishes a shift scored kitchen 0.578 and one that burns 7.5 scored 0.599 —
 *   twenty-six extra ruined dishes were worth two points. Burnt units now count
 *   as quality ZERO in the denominator, because that is what they are worth, and
 *   the same two bots separate 0.313 / 0.545.
 *
 *   ⚠ IT COUNTS `burnt` AND DELIBERATELY NOT `binned`, and that distinction is
 *   load-bearing. Burning a slot and letting a plate rot are NEGLECT — you
 *   stopped paying attention and food died; `spoilPass()` books both into
 *   `burnt` for exactly this reason. Binning a plate is a DECISION, and at the
 *   shipped pass size it is one the player is forced to make constantly: a bot
 *   that never bins jams the pass and finishes on a D (c2_bin.mjs), and an
 *   earlier draft then denied it the S for digging itself out. A grade that
 *   punishes the only working play measures willingness to lose, not skill.
 *   `binned` stays in the report as a cost line, where a cost belongs.
 *
 * ── AND THE LETTER IS A BLEND, NOT A MINIMUM ──
 * `(service + kitchen) / 2`. Equal weights on purpose: this is a cooking game
 * with a queue, so half the mark is what you cooked and half is how much of it
 * got out. The blend is what stops either axis vetoing the other — a flawless
 * cook who is drowning and a sloppy one who is not now read differently, where
 * `min()` collapsed both onto the same letter. The cuts are ECON keys, swept
 * against the measured distribution rather than typed as round numbers, and
 * re-derived whenever ECON.PERFECT_MS or the capacity model moves.
 *
 * An S additionally requires a clean sheet — nothing burnt — because S is the
 * "you did not put a foot wrong" grade and a bin full of charcoal is a foot
 * wrong even if the customer never saw it.
 *
 * → { service, kitchen, score } — all 0..1. The letter is `gradeFor()`.
 */
function gradeParts(today) {
  const served = _int(today.served);
  const dishes = _int(today.qunits);
  const burnt = _int(today.burnt);
  const total = served + _int(today.lost);

  /* ── SERVICE ────────────────────────────────────────────────────────────
     Everything here is in DISHES, not tickets, because the capacity model is
     in dishes and mixing the two units is how the old service term ended up
     comparing a ticket count against a plate count without anybody noticing.
     `perTicket` is measured from the day rather than assumed, so a day of
     two-item orders is not graded against a one-item ceiling. */
  const perTicket = served > 0 ? (dishes / served) : 0;
  const demand = total * (perTicket > 1 ? perTicket : 1);

  /* The reachable ceiling. Guarded like every other data call in this file: a
     half-written data file, or one whose capacityModel has been renamed, gives
     `ceiling = 0` and the denominator falls back to raw demand — i.e. exactly
     the old share-of-custom metric. Degrading to the previous behaviour is the
     right floor here; degrading to "everyone gets an S" is not, which is why
     the fallback is `demand` and never `dishes`. */
  let ceiling = 0;
  const capacityModel = DF('capacityModel');
  if (capacityModel) {
    try {
      const model = capacityModel(K.level, K.upgrades, K.popularity);
      const perHour = _num(model && model.capacityPerHour, 0);
      const hourMs = Math.max(1, EC('HOUR_MS', 60000));
      /* ⚠ `today.ms` AND NOT `shift.tMs`. tMs is where the CLOCK is, which a
         resumed shift fast-forwards to the bail point (openShift) and a day
         roll resets to zero (closeShift) — so grading a resumed day against it
         charges the player for hours the kitchen was shut, and `simulate()`,
         which grades after the roll, would read zero hours and lose the
         ceiling entirely. `today.ms` is time the kitchen was actually OPEN and
         it rides the same tally the rest of the grade reads. */
      const hours = Math.max(0, _num(today.ms, 0)) / hourMs;
      ceiling = perHour * EC('GRADE_CAP_DUTY', 0.7) * hours;
    } catch (e) { ceiling = 0; }
  }
  const denom = ceiling > 0 ? Math.min(demand, Math.max(dishes, ceiling)) : demand;
  const service = denom > 0 ? _clamp(dishes / denom, 0, 1) : 0;

  /* ── KITCHEN ──────────────────────────────────────────────────────────── */
  const rawQ = EC('Q_RAW', 0.5);
  const span = EC('Q_PERFECT', 1.25) - rawQ;
  const cooked = dishes + burnt;
  const meanQ = cooked > 0 ? (_num(today.qsum, 0) / cooked) : EC('Q_GOOD', 1);
  const kitchen = span > 0 ? _clamp((meanQ - rawQ) / span, 0, 1) : 0;

  return { service, kitchen, score: (service + kitchen) / 2 };
}

/** The letter. `'—'` before anybody has walked through the door. */
function gradeFor(today) {
  if (_int(today.served) + _int(today.lost) <= 0) return '—';

  /* 🔴 A LETTER IS A CLAIM ABOUT THE PLAYER, AND IT WAS NOT COMPARABLE ACROSS
     SHIFT LENGTHS — SHORT SHIFTS GRADED HIGHER. Same bot, 8 seeds, level 12,
     varying ONLY how long the shift ran before the bell (r8/early.mjs):
         120,000ms → service 0.705 craft 0.995 score 0.850   AABSAAAS
         300,000ms → 0.798 / 0.914 / 0.851                   AAAAABAA
         780,000ms → 0.882 / 0.864 / 0.873                   AAAAAAAA
     Two S grades on a two-minute shift and none on a full day, from identical
     play: CRAFT starts near 1.000 because nothing has had time to spoil yet and
     the SERVICE ceiling has not had time to bind. The title screen prints
     "Last shift B" as a persistent claim (kitchen.render.js:1635), so a
     twenty-minute mobile session was systematically earning a better one than a
     full day.

     Two fixes were possible and this is the cheaper AND the more honest of
     them: below a minimum traded fraction of a day, say so. Flooring the
     denominator instead would grade a two-minute shift against a full day's
     ceiling and hand a competent player a D for closing early, which is a
     punishment for a thing that is not a mistake. The two axes are still in the
     report and still worth reading; it is only the LETTER — the summary claim —
     that needs a real sample behind it. */
  const graded = EC('GRADE_MIN_SHIFT_MS', 300000);
  if (graded > 0 && _num(today.ms, 0) > 0 && _num(today.ms, 0) < graded) return '—';

  const SCALE = ['D', 'C', 'B', 'A', 'S'];
  const score = gradeParts(today).score;
  let grade = 0;
  /* 🔴 THE CUTS ARE SWEPT, NOT TYPED. Round 4's were round numbers
     (0.98/0.90/0.75/0.55) fitted to nothing, and the top three of them sat
     above the entire human range. These four came off the measured score
     distribution of six skill tiers × 12 seeds AT THE GAME'S OWN OUTPUT — not a
     model of it — plus a maxed kitchen and a day-one kitchen for the ends:
         0.58  DISTRACT tops out at 0.555, SLOPPY bottoms at 0.615
         0.70  SLOPPY tops out at 0.690, AVERAGE straddles it
         0.79  AVERAGE tops out at 0.785, GOD bottoms at 0.795
         0.92  a level-20 all-owned clean sheet scores 0.94..0.99
     Re-sweep them (scratch r7/realcuts.mjs) after ANY move to ECON.PERFECT_MS,
     the Q_* scale, GRADE_CAP_DUTY or capacityModel — all four shift the
     distribution these sit in, and a cut that has stopped matching its
     distribution is exactly the bug this function had. */
  if (score >= EC('GRADE_MIN_S', 0.92)) grade = 4;
  else if (score >= EC('GRADE_MIN_A', 0.79)) grade = 3;
  else if (score >= EC('GRADE_MIN_B', 0.70)) grade = 2;
  else if (score >= EC('GRADE_MIN_C', 0.58)) grade = 1;
  /* 🔴 THE CLEAN-SHEET RIDER CHARGES FOR NEGLECT, NOT FOR STRUCTURE — AND IT
     USED TO CHARGE FOR BOTH, WHICH PUT THE TOP LETTER OUT OF REACH FOR THE
     FIRST 27 LEVELS NO MATTER HOW WELL THE PLAYER COOKED.
     `today.burnt` is two different failures added together (see freshToday):
     a SLOT that crossed burnAt, and a PLATE that rotted on the pass. Split
     across 6 skill tiers × 12 seeds at level 12 (r8/gradeSpoil.mjs), the
     frame-perfect zero-lag fifty-actions-a-second bot books **0.0 slot burns
     and 5.1 spoiled plates**, and clean sheets are **0 of 72 shifts across
     every tier**. Five of those shifts scored above GRADE_MIN_S and every one
     was demoted here. Add `up_warmrail` — minLevel **27** — and spoilage halves
     and S appears immediately (r8/gradeWR.mjs: AAAAAAASAASA).
     So the rider was reading whether the player owns a level-27 upgrade, which
     is not a foot put wrong; it is a shop.

     And it is the same error this file has already fixed once, for `binPass`:
     "mandatory play cannot be booked as incompetence". `spoilPass()` is the
     AUTOMATIC version of that unjam — the game bins the plate on the player's
     behalf, precisely because it "must not depend on the player knowing to use
     it" — so charging the S for it charges the player for something the game
     did. Slot burns stay: leaving a pizza on a griddle IS a foot wrong.
     `spoiled` keeps its cost line on the report card, which is where a cost
     belongs. */
  const neglect = _int(today.burnt) - _int(today.spoiled);
  if (grade === 4 && neglect > 0) return SCALE[3];
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
    // Same clamped step, same guard, different question — see freshToday().
    if (!isFinite(K.today.ms)) K.today.ms = 0;
    K.today.ms += step;
    K.shift.rush = rushNow();
  }

  // 2. STATIONS
  tickStations(t);

  /* 2b. 🔴 ARE THE DOORS SHUT? — AND THE ANSWER IS TAKEN *BEFORE* THE LANE RUNS.
     It used to be taken at step 4, after DriveThru.tick(), so anything reading
     `K._dry` from inside the lane got LAST frame's answer. One frame is not much
     on its own; it is a lot when the flag's whole job is to stop a spawn.
     Refreshed whether or not the shift is running, so that `isStalled()` is true
     the moment the panel opens on an empty pantry — which is when the relief
     drop needs to land and when the OPEN THE DOORS button needs to know. */
  dryNow(t);
  // …and every door reads the ONE accessor. See isDry().
  const dry = isDry();

  /* 2c. 🪂 THE ESCAPE HATCH, CONSUMED. See reliefWatch(). This is the line that
     was missing: kitchen.data.js has shipped the parcel since round 4 and
     nothing anywhere called for it. */
  reliefWatch(t);

  // 3. DRIVE-THRU (owns the lane; we only merge its events)
  if (K.shift.running && typeof DriveThru.tick === 'function') {
    try {
      const evs = DriveThru.tick(K, step, t);
      if (Array.isArray(evs)) for (const e of evs) if (e && e.name) K._events.push(e);
    } catch (e) { /* the lane failing must not stop the ovens */ }
  }

  // 4. WALK-INS
  /* 🔴 …UNLESS THE KITCHEN IS DRY. See dryCheck() — and note that `dry` now
     means "no purchase you can pay for would produce a dish", not "no crate on
     the sheet is affordable at any price". The interval is rolled forward while
     the doors are shut so that stock arriving does not release a backlog of
     customers who "queued" during a period when nothing was open. */
  if (dry) K._nextCounter = t + counterIntervalMs();
  if (!dry && K.shift.running && dayPctOf() < 1 && ECb('COUNTER_ENABLED', true)) {
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
  /* 🔴 `fresh:true` IS THE FIRST-RUN REGRESSION AND IT IS NOT OPTIONAL.
     The blocker that shipped — a brand-new player opening to an empty pantry
     with no legal move — was invisible to every headless test because the two
     things that hand a save back (`Profile.kitchen` in index.html and
     `NULL_BRIDGE._mem` in kitchen.bridge.js) BOTH auto-create `{}`, so the test
     rig reproduced the bug instead of failing on it. Hydrating the literal `{}`
     is therefore the exact shape a new account has, and `report.firstRun` says
     whether that account can cook. */
  if (o.fresh) hydrate({});
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
  report.pantryRoom = pantryRoom();
  report.binned = _int(K.today.binned);
  report.spoiled = _int(K.today.spoiled);
  report.grade = gradeFor(K.today);
  /* 🥫 THE LEDGER LINE, IN THE HARNESS TOO. The premise of the whole feature is
     that live resources move; a headless report that cannot see them cannot
     regress "LEDGER out {}" — which is exactly how a round shipped 188 dishes
     with the ledger never moving once. */
  report.resSpent = Object.assign({}, K.today.resSpent || {});
  report.resGained = Object.assign({}, K.today.resGained || {});
  report.cinderSpent = _int(K.today.cinderSpent);
  report.reliefDay = _int(K.reliefDay);
  report.dry = dryCheck();
  if (o.fresh) {
    const cov = startPantryCovers();
    report.firstRun = {
      granted: pantryTotal() > 0 || report.served > 0,
      startPantryOk: cov.ok,
      cookableAtLevel1: cov.cookable,
      missing: cov.missing,
    };
    if (!cov.ok) report.violations.push('START_PANTRY cannot cook anything on the level-1 menu');
  }
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
