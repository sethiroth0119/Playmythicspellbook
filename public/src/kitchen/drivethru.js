/* ═══════════════════════════════════════════════════════════════════════════
   🚗 drivethru.js — THE LANE. Cars, customers, patience, tips, set pieces.
   ═══════════════════════════════════════════════════════════════════════════

   WHAT THIS FILE IS
   The drive-thru is the headline feature — "serve NPCs through driveways" is
   the thing that was asked for by name — so this file's job is to make the lane
   feel like a LANE and not like a spawn table with a countdown attached. That
   means five things, and every one of them is mechanically real below:

     1. Cars arrive on a rate driven by popularity, the hour of the day and the
        rush curve, not on a fixed timer.
     2. They queue FIFO, they BLOCK each other, and a car that has been served
        still occupies the window until it has physically pulled away.
     3. They order at the speaker, crawl to the window, and lose patience the
        entire time — including while stuck behind somebody else's mistake.
     4. They are PEOPLE: a name, a vehicle, a mood, a personality that decides
        what they order and how long they will tolerate you, and five pools of
        dialogue (ordering, waiting, ABOUT TO LEAVE, served, leaving) that
        escalate as their patience runs out.
     5. Occasionally somebody memorable turns up: a corp buyer with a bulk
        order, a raider who takes the front of the queue by force, or a regular
        who came back this shift with a grudge or a favour.
     6. What they ASKED FOR is a promise that can be broken. "No onions" is
        checked against what was actually laid on the dish, and breaking it
        costs real money (§MODIFIERS).
     7. What you TURN AWAY is visible. A car that reaches a full lane drives
        past on screen and says so (§BALK) — it is the biggest number in the
        business and it used to happen in silence.

   🔴 THE FIVE HARD RULES THIS FILE LIVES UNDER
   1. NO DOM, NO TIMERS, NO CLOCK. `now` and `dt` arrive as arguments from the
      one RAF loop in index.js (CONTRACT §3). This file never calls
      `requestAnimationFrame`, `setInterval`, `setTimeout` or `Date.now()`.
      A lane that reads the wall clock cannot be fast-forwarded, and a lane that
      cannot be fast-forwarded cannot be replayed — see `arrivalPlan()`.
   2. NEVER THROW. `kitchen.state.js` wraps our tick in a try/catch with the
      comment "the lane failing must not stop the ovens", which is correct and
      is also not an excuse. A throw here silently deletes the drive-thru for
      the rest of the session with nothing on screen to say so. Every entry
      point below returns a value; none of them raise.
   3. WE MAY MUTATE `K` — and almost nothing else may. CONTRACT rule 2 names
      exactly three files: kitchen.state.js, drivethru.js, convoy.js. We own
      `K.lane` outright. We touch `K.tickets` only through the two doors
      state.js opened for us (`newTicket`, and moving a `dueAt` — see §DEADLINE
      below), and `K.popularity` only for the two penalties state.js has no path
      for (a balk and a wave-off).
   4. ONE DEADLINE PER CUSTOMER. See §DEADLINE. This is the subtle one and it
      is the bug this file was most likely to ship.
   5. AN OUTCOME IS BOOKED ONCE, BY THE SWEEP, NOT BY THE VERB. See §SETTLE.
      This is the bug this file DID ship: the ledger was written inside a
      player verb that nothing called, so the lane recorded failures only and
      a whole set piece became unreachable. A customer's outcome is now written
      down by `tick()` whichever door they left through.

   ⚠ WHY NAMESPACE IMPORTS (`import * as State`) AND NOT NAMED ONES
   Same reason kitchen.state.js gives, and it applies doubly here because this
   file is on the far side of an import CYCLE: state.js imports us, we import
   state.js. ESM resolves that correctly for hoisted `function` declarations and
   NOT for `const` arrows, which are still in the temporal dead zone while the
   cycle links. A namespace import binds the module record rather than a
   binding, every call site below is guarded by `typeof`, and — critically —
   NOTHING IN THIS FILE TOUCHES `State.*` AT MODULE EVALUATION TIME. Only inside
   functions, which by then run long after the graph has finished linking.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as DATA from './kitchen.data.js';
import * as State from './kitchen.state.js';

/* ───────────────────────────────────────────────────────────────────────────
   💰 ECON ACCESS — ONE TABLE, AND THIS FILE NO LONGER KEEPS A SECOND COPY.
   ───────────────────────────────────────────────────────────────────────────
   🔴 THE DEFECT THIS SHAPE EXISTS TO KILL. `EC()` used to take a second
   argument — `EC('MOD_TIP_MISS', -0.30)` — described in this very comment as
   "a NaN guard, not a tuning value". It was a tuning value. A key-by-key diff
   of the 83 call sites against kitchen.data.js found 36 keys that existed ONLY
   here, and among the ones that existed in BOTH the two numbers had already
   drifted apart: MOD_TIP_MISS read -0.45 from ECON and -0.30 from this file,
   SPAWN_BASE_MS 8000 against 9000, SPAWN_MIN_MS 2100 against 1400. CLAUDE.md is
   flat about it — "All operation pricing goes through `_opEcon()`. Never
   hardcode economy numbers" — and the CONTRACT restates it: "If you write a
   number in any other kitchen file, you have written a bug." Thirty-six of them
   is a second, invisible economy that a designer retuning the lane cannot find,
   cannot diff and will not know overruled them.

   So `EC(key)` takes ONE argument and reads ECON, full stop. Every one of the
   83 call sites below is now a lookup and nothing else.

   WHY THE GUARD STILL HAS TO EXIST, and what replaced the literals: a missing
   ECON key yields `undefined`, undefined poisons arithmetic into NaN, and a NaN
   `expiresAt` compares false against every threshold forever — the customer
   never runs out of patience, never leaves, holds the front of the lane for the
   rest of the shift and blocks the closing bell. That failure is invisible and
   unbounded. So a gap is caught, but it is caught in ONE place, it is RECORDED
   (`econAudit()`), and the number it falls back to lives in the single
   `ECON_PENDING` table below — which is a handover list with a name on it (C1),
   not 36 anonymous literals scattered through the file. When kitchen.data.js adopts
   a key, its row here is deleted and nothing else changes.
   ─────────────────────────────────────────────────────────────────────────── */

/* 🤝 THE LAST-RESORT GUARD, AND ✅ ALL FOUR ROWS ARE UNREACHABLE.
   These are the keys THIS file introduced this round. kitchen.data.js has since
   adopted every one of them at exactly these values, so `EC()` never reaches
   this object — `econAudit()` returns `{gaps: [], ok: true}` after a full
   simulated day, which is the proof and is re-runnable.

   They stay for one reason only: a data.js regression that drops LANE_SPEAKER_POS
   must degrade to a playable lane rather than to a speaker box at position ZERO,
   which is the window, which is precisely the §GEOGRAPHY bug this round closed.
   A guard whose whole job is never to fire is allowed to exist; a guard that
   quietly runs a DIFFERENT economy from the designer's table is not, and that is
   the difference between this object and the 36 inline literals it replaced.

   ⚠ Do not add a row here to avoid asking, and do not retune one. A row here
   that ECON also defines is dead; a row here that ECON does not define is an
   ask, and it belongs in the HANDOVER at the bottom of this file as well, in
   the OPEN half and with a signature on it. */
const ECON_PENDING = {
  /* 🔊 WHERE THE SPEAKER BOX IS, as a fraction of LANE_LEN measured from the
     WINDOW (pos 0). The lane's picture and its state machine disagreed: render
     draws 🔊 ORDER HERE at the mouth and 🪟 WINDOW at pos 0, while the sim let a
     car enter its `order` phase from any slot it happened to stop in. Measured
     over one instrumented day at level 20, order-phase frames by position:
     {1.00:737, 0.75:334, 0.25:137, 0.50:16, 0.00:24} — twenty-four frames of a
     customer announcing their order while parked at the pickup hatch. 0.92
     rather than 1.00 so the car ordering sits just INSIDE the lane beside the
     sign rather than exactly on the mouth, which leaves the width of one car
     for the next arrival to wait in before it is pushed out onto the road. */
  LANE_SPEAKER_POS: 0.92,
  /* 🚗 §BALK DRIVE-PAST SPACING. Balks are the biggest number in the business
     (86 against 45 arrivals in a measured day) so BURSTS ARE THE NORMAL CASE.
     Five balking in one frame used to be five sprites at identical coordinates:
     measured live at 360px, 5 `.mk-passer` nodes all at x=304, one on top of
     another, reading as a single smeared vehicle. These two numbers are the
     SPACING DATA the renderer needs to fan a burst out into traffic. */
  PASSBY_STAGGER_MS: 320,   // head start between consecutive drive-pasts
  PASSBY_LANES: 3,          // rows of the far-side band to spread them across
  /* 🔁 arrivalPlan()'s assumed hit rate — see the comment there. It is the
     MEASURED live figure, not a guess, and it is a lane number, so it belongs
     in ECON beside SPAWN_BASE_MS. */
  PLAN_SERVE_RATE: 0.35,
};

/* Keys that were read while absent from ECON, in first-seen order. Exported
   through `econAudit()` so the admin debug panel can show a designer that the
   table they are editing is not the table the lane is running on. */
const _econGaps = Object.create(null);

function EC(key) {
  let v;
  try { v = DATA.ECON ? DATA.ECON[key] : undefined; } catch (e) { v = undefined; }
  if (typeof v === 'number' && isFinite(v)) return v;
  _econGaps[key] = true;
  const p = ECON_PENDING[key];
  return (typeof p === 'number' && isFinite(p)) ? p : 0;
}

/**
 * → { gaps:[key,…], pending:[key,…], ok } — which keys this session read that
 * ECON did not answer. `ok` is true when the lane is running entirely off
 * kitchen.data.js, which is the only state this file is allowed to ship in.
 */
export function econAudit() {
  const gaps = Object.keys(_econGaps);
  return { gaps, pending: Object.keys(ECON_PENDING), ok: gaps.length === 0 };
}

function DF(name) {
  try { const f = DATA[name]; return (typeof f === 'function') ? f : null; }
  catch (e) { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   📋 WHAT EACH LANE NUMBER MEANS. THE VALUES LIVE IN kitchen.data.js.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THIS IS A GLOSSARY, NOT A TABLE. Round 2 shipped this block as a list of
   36 keys "kitchen.data.js does not define yet", each with its value written
   out beside it and each backing an `EC('KEY', literal)` fallback in the code.
   All 36 have since landed in ECON — and two of them had ALREADY drifted apart
   from the numbers written here, silently, because ECON wins and nobody diffs a
   comment. So the values are gone from this block on purpose. If you want to
   know what LANE_BALK_MS is, read kitchen.data.js; if you want to know what it
   MEANS and why it is not zero, read here. One number, one home.

   Every key below is read through `EC(key)` and answered by ECON. `econAudit()`
   returns empty when that is true, which is the only state this file ships in.

   ── GEOMETRY & TIMING OF THE LANE ────────────────────────────────────────
     LANE_ROLL_UNITS_S           lane-lengths per second a car rolls forward.
                                 Slow enough to read as a vehicle moving, fast
                                 enough that clearing the window never feels
                                 like the game is stalling you on purpose.
     LANE_ENTRY_POS              where a car appears, past the mouth of the
                                 lane, so it drives ON SCREEN rather than
                                 popping into existence in the queue.
     LANE_SPEAKER_POS            🔴 WHERE THE SPEAKER BOX IS, as a fraction of
                                 LANE_LEN measured from the window. A car may
                                 not roll PAST it until it has ordered, and may
                                 not order until it has reached it. This one
                                 line is what makes the lane's geography and its
                                 state machine agree — see §GEOGRAPHY.
     LANE_ORDER_MS               time at the speaker box actually ordering.
                                 This is the beat that makes the speaker line
                                 readable; at 0 the dialogue flashes past.
     LANE_EXIT_MS                🔴 how long a served car BLOCKS THE WINDOW
                                 before it is reaped. This is not decoration —
                                 it is the entire "cars block each other"
                                 mechanic. At 0 the lane is a list, not a queue.
     LANE_BALK_MS                patience of a car that has arrived but not yet
                                 reached the speaker. Only reachable when the
                                 lane is jammed by an unserved front car.
     LANE_MOOD_TESTY             patience-remaining thresholds the mood face
     LANE_MOOD_ANGRY             steps down at. Render reads `car.mood`.
     LANE_NAG_MS                 gap between a TESTY car's window nags, so a
                                 waiting customer talks instead of shouting.
     LANE_NAG_ANGRY_MS           🔴 and the gap once they are FURIOUS. The nag
                                 ESCALATES: a customer who is about to walk
                                 talks more, not the same amount. A fixed
                                 interval made the last ten seconds of a
                                 doomed order read identically to the first.
     LANE_PASSBY_MS              how long a balked vehicle stays in
                                 `passersBy()` so a renderer can drive it
                                 across the top of the road and off. See §BALK.
     PASSBY_STAGGER_MS           head start between consecutive drive-pasts, so
                                 five balks in one frame read as TRAFFIC and not
                                 as one smeared sprite. See §BALK SPACING.
     PASSBY_LANES                how many rows of the far-side band to spread a
                                 burst across. Render reads `p.lane`.
     PLAN_SERVE_RATE             the hit rate `arrivalPlan()` models when the
                                 caller does not name one. MEASURED off live
                                 play, not assumed — see `arrivalPlan()`.

   ── POPULARITY THIS FILE APPLIES ITSELF ──────────────────────────────────
   (state.js owns POP_SERVE / POP_LOST / POP_BURN. These two have no path
    through state.js because neither produces a lost TICKET.)
     POP_BALK                    a car reached a full lane and drove past. Tiny
                                 on purpose: it is lost custom, not a failure,
                                 and a full lane is usually a compliment.
     POP_JAM                     a car queued, never got to order, gave up.
                                 That one IS your fault.
     POP_JUMP                    everyone behind a queue-jumper sees you allow
                                 it. Charged once, when the raider cuts in.

   ── SET PIECES (§SET PIECES) ─────────────────────────────────────────────
     SPECIAL_CHANCE              chance an arrival is a set piece at all.
     SPECIAL_MIN_LEVEL           below this the lane is plain. A brand-new
                                 player meeting a queue-jumper in their first
                                 sixty seconds learns "this game is unfair",
                                 not "this game has texture".
     BULK_ITEM_MULT              order-size multiplier for a corp bulk buy
     BULK_PATIENCE_MULT          …who is correspondingly willing to wait
     BULK_TIP_MULT               …and pays for the privilege. NOT higher: the
                                 customers who place bulk orders are already the
                                 two most generous rows in CUSTOMERS (tipBias
                                 1.8 / 1.6), so a big multiplier on top of a big
                                 bias is what made this tier flat in the first
                                 place.
     JUMP_PATIENCE_COST_MS       patience each car behind loses to the cut-in
     GRUDGE_PATIENCE_MULT        a regular you failed is a shorter fuse
     GRUDGE_TIP_MULT             …and a worse tipper
     FAVOUR_PATIENCE_MULT        a regular you delighted gives you room
     FAVOUR_TIP_MULT             …and pays it back

   ── MODIFIERS (§MODIFIERS) ───────────────────────────────────────────────
     MOD_CHANCE                  chance an ordered LINE carries a modifier
     MOD_SECOND_CHANCE           chance that line carries a SECOND one, so
                                 "no onions, extra cheese" exists and is rare.
     MOD_MAX_PER_ORDER           hard cap on promises in one spoken order. A
                                 family bucket with six instructions is a wall
                                 of text in a bubble on a 360px screen.
     MOD_PATIENCE_MULT           a fussy order is a fussier customer
     MOD_EXTRA_MIN               how many of an ingredient counts as "extra".
                                 Canon builds lay 1; asking for extra means
                                 laying it twice. 🔴 THIS IS THE CHECK — see
                                 §MODIFIERS. There is no quality bar any more.
     MOD_TIP_HIT                 tip multiplier bonus for an HONOURED promise
     MOD_TIP_MISS                …and the penalty for a BROKEN one
     MOD_TIP_UNPROVEN             …and what an UNPROVABLE one is worth, which
                                 is nothing in either direction. 🔴 Zero, not
                                 a small bonus and not a small penalty: see
                                 §MODIFIERS on why a mod nobody can check must
                                 never be able to move money.

     MOD_PAY_HIT                 🔴 THE SETTLEMENT, as a fraction of the
     MOD_PAY_HIT_MIN                 honoured LINE's price, with a per-honoured-
                                 UNIT Cinder FLOOR under it so the promise is
                                 worth keeping on a 25-Cinder soda as well as on
                                 a 220-Cinder Supreme. A percentage alone is not
                                 enough — kitchen.data.js works the arithmetic
                                 out in full beside the keys.
     MOD_PAY_MISS                …and what a BROKEN promise costs, as a fraction
                                 of the same line. LARGER than MOD_PAY_HIT, on
                                 purpose: a broken promise is not a bonus the
                                 player merely failed to earn.
     MOD_PAY_UNPROVEN            🔴 zero. Always zero. See §MODIFIERS.
     MOD_POP_HIT                 word of mouth, per honoured line…
     MOD_POP_MISS                …and per broken one. Charged by `serveCar()`.
     MOD_XP_HIT                  ⚠ STILL READ BY NOBODY, re-verified round 5.
                                 There is no path from this file to `addXp()`.
                                 See handover item O2.

   ── THE TIP RETURN (§TIP) ────────────────────────────────────────────────
     TIP_GEN_MAX                 runaway guard on the GENEROSITY STACK (tipBias
                                 × tip upgrades × set piece × modifiers, which
                                 is unbounded because modifiers stack). Set high
                                 enough not to touch a normal customer.
     TIP_HARD_PCT                🔴 the DESIGN ceiling, ≈2× TIP_MAX_PCT. Without
                                 it the top tier saturated the safety clamp on
                                 100% of 4,000 samples and quality stopped
                                 mattering entirely — measured, not guessed.
     TIP_FRACTION_MAX            🔴 last-ditch clamp keeping us below state.js's
                                 `v < 1` fraction test. Should never bind; if it
                                 does, TIP_HARD_PCT is wrong.
     TIP_FRACTION_MIN            floor, so a served car always drops a coin
   ─────────────────────────────────────────────────────────────────────────── */

/* ── tiny numeric helpers. Two lines each; an import for them would be a
      dependency for no reason, which is the call kitchen.state.js made too. ── */
function _int(n) { const v = Math.floor(Number(n)); return isFinite(v) ? v : 0; }
function _num(n, d) { const v = Number(n); return isFinite(v) ? v : (d || 0); }
function _clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ═══════════════════════════════════════════════════════════════════════════
   🎲 RNG — deterministic, and deliberately SHARING kitchen.state.js's cursor.
   ═══════════════════════════════════════════════════════════════════════════
   mulberry32, the same generator state.js uses, reading and advancing the same
   `K._seed`. That is on purpose: `State.seed(n)` then reproduces the WHOLE
   shift — walk-ins and lane together — rather than half of it. Tick order is
   fixed (CONTRACT §3 numbers the steps), so interleaving two consumers on one
   cursor is deterministic.

   The critic's replay path does NOT go through here: `arrivalPlan()` below
   takes an explicit seed and builds its own closure, so a rush can be replayed
   without a `K` and without disturbing a live game's cursor.

   ⚠ `_mix` is factored out rather than duplicated into both paths. Two copies
   of a hash is two chances to typo one of them, and a mis-typed hash still
   returns plausible-looking numbers — you would never notice until a "replay"
   diverged from the run it was supposed to reproduce.
   ═══════════════════════════════════════════════════════════════════════════ */
function _mix(s) {
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Advance the SHARED sim cursor on K. Live play uses this one. */
function rnd(K) {
  K._seed = ((_int(K._seed) || 1) + 0x6D2B79F5) | 0;
  return _mix(K._seed);
}

/** A standalone stream from an explicit seed. Replay/tests use this one. */
function mulberry32(seedInt) {
  let s = _int(seedInt) || 1;
  return function next() { s = (s + 0x6D2B79F5) | 0; return _mix(s); };
}

function rint(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }
function rpick(r, arr) { return (arr && arr.length) ? arr[Math.floor(r() * arr.length)] : null; }

/** Weighted pick over `[{weight}]`. Falls back to uniform if no weights. */
function rweight(r, arr, key) {
  if (!arr || !arr.length) return null;
  let total = 0;
  for (const x of arr) total += Math.max(0, _num(x && x[key || 'weight'], 1));
  if (total <= 0) return rpick(r, arr);
  let roll = r() * total;
  for (const x of arr) {
    roll -= Math.max(0, _num(x && x[key || 'weight'], 1));
    if (roll <= 0) return x;
  }
  return arr[arr.length - 1];
}

/* ═══════════════════════════════════════════════════════════════════════════
   🗣 THE VOICE — five pools per person: ordering, waiting, about to walk,
      served, and gone.
   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS TABLE LIVES HERE AND NOT IN kitchen.data.js: the ECON rule is about
   ECONOMY NUMBERS ("a literal economy number in any other kitchen file is a
   bug"). This is content, not tuning, and the lane owns the lane's voice —
   per customer for the ticket header; these are the other FIVE moments, keyed
   by the same CUSTOMERS ids so the two can never drift apart. A customer id
   with no entry here falls through to GENERIC and still talks.

   ⚠ THE VOICE IS THE JOKE AND IT HAS TO LAND. Mythic Spellbook is a
   post-collapse survivor game. These are people buying hot food in a ruined
   city — a gate guard whose relief eats what he does not, a vault family whose
   daughter has never had a hot meal, a courier who counts every second spent
   in the open. Write them as survivors who found a working restaurant, never
   as suburban commuters at a window. A generic "one burger please" line is not
   neutral, it is wrong, and it quietly deletes the setting.

   🔴 FIVE POOLS, NOT FOUR, AND THE WAIT POOL IS SPLIT ON PURPOSE.
   The first draft had one `wait` pool of two lines per personality against a
   nine-second nag interval. Measured over a single 300s shift that produced
   the Mayor's Aide saying "There is a meeting. There is always a meeting."
   EIGHTEEN TIMES. Two things were wrong and both are fixed here:
     • VOLUME. Four lines per waiting mood, twelve personalities, and a
       no-immediate-repeat rule in `pickLine()` — a customer physically cannot
       say the same thing twice in a row, and a full twelve-minute shift does
       not exhaust a single personality's pool.
     • ESCALATION. `testy` is a person noticing the time. `furious` is a person
       about to leave, and it is a DIFFERENT pool reached by mood, not the same
       pool said louder. `advanceCar` picks by `car.mood` and nags faster once
       they are furious (LANE_NAG_ANGRY_MS). The last ten seconds of a doomed
       order must not read like the first ten.

   ⚠ REJECTED: procedurally assembling lines from fragments. It multiplies the
   count and reads like a mail merge; these people are the entire reason the
   lane is not a spawn table, and a customer who sounds generated is a customer
   the player stops reading. Hand-written, or not worth having.
   ═══════════════════════════════════════════════════════════════════════════ */
const VOICE = {
  commuter: {
    speaker: ['Same as yesterday. Assuming yesterday still counts.',
              'Usual. Don’t make it interesting.',
              'Whatever I had on Tuesday. Tuesday was a good day.'],
    testy:   ['The convoy leaves at six whether I’m on it or not.',
              'I do this drive twice a day. This is meant to be the good part.',
              'Eleven minutes and a checkpoint between here and the desk.',
              'Not rushing you. Just noticing the time. Out loud.'],
    furious: ['The convoy’s gone. I can see the dust from here.',
              'I’m going to be searched at the gate on an empty stomach.',
              'Twice a day for two years, and today’s the day you break.',
              'Right. I’m walking. In the dark. Thanks for that.'],
    served:  ['Still warm. That’s a good sign.',
              'See you tomorrow. Probably. Roads permitting.',
              'Only part of the day nobody’s ruined yet.'],
    angry:   ['I’ll eat at the checkpoint. Again.',
              // Was 'Fine. FINE.' — the one line in the file that could have come
              // out of any game at any window. The VOICE header is explicit that
              // a generic line is not neutral, it is wrong. This one spends the
              // eleven minutes their own testy line counts down.
              'Two years of custom, gone in eleven minutes.',
              'Tell tomorrow’s me I’m sorry.'],
  },
  courier: {
    speaker: ['Engine’s running. Talk fast.',
              'One hand on the bars, so make it one bag.',
              'Something I can eat at speed and won’t regret at speed.'],
    testy:   ['Every second here is a second in the open.',
              'Clock’s on the parcel. Not on you. Sadly.',
              'I’ve outrun worse than a queue. Not by much.',
              'There’s a man on the ridge with binoculars and I am very still.'],
    furious: ['I am a stationary target holding a hot bag. Do the maths.',
              'The run bonus is gone. The run bonus was the rent.',
              'Bike’s idled so long it’s drinking more than I am.',
              'Move. Please. Any direction. Just move.'],
    served:  ['You’re on my good list. That list is short.',
              'Eating this at ninety. Worth it.',
              'I’ll tell the depot. The depot listens to me.'],
    angry:   ['Keeping the parcel. Losing the appetite.',
              'You just cost me the run bonus.',
              'Next town has a noodle cart. It’s worse. It’s there.'],
  },
  scav: {
    speaker: ['Whatever’s cheap and whatever’s hot.',
              'Surprise me. Low bar, mind.',
              'Anything that hasn’t got a serial number on it.'],
    testy:   ['I’ve waited out a dust storm. I can wait out you.',
              'Take your time. Nothing out there’s going anywhere.',
              'Found a tin of peaches in ’09. Still think about it.',
              'I’ve stood in worse queues for worse food.'],
    furious: ['Even the peaches turned up faster than this.',
              'I’ve got tins. I’ve always got tins. That’s the sad part.',
              'You’re making me miss the tins, and that’s a crime.',
              'Right. That’s me. Back to the dust.'],
    served:  ['First hot thing I’ve had in a week.',
              'That’s a good day, that is.',
              'I’ll trade you something for this next time. Something good.'],
    angry:   ['Back to the tins, then.',
              'Should’ve known. Should’ve known.',
              'Ah well. Nothing’s for me. Never has been.'],
  },
  trucker: {
    speaker: ['Feed the whole cab. They’ve been rationing since the ridge.',
              'Big one. Six of us and a dog.',
              'However much you think is too much. That, but hot.'],
    testy:   ['Rig’s idling. Fuel isn’t free out here.',
              'Boys in the back are getting ideas.',
              'I need to be past the bridge before it freezes over.',
              'The dog’s started staring at me. That’s the warning sign.'],
    furious: ['They’ve started talking about eating the seats.',
              'Bridge freezes in forty minutes and I am parked at a window.',
              'I hauled water through a firestorm to get here. HERE.',
              'The dog’s given up on you. The dog gives up on nobody.'],
    served:  ['That’ll get us to the next depot.',
              'You’re marked on my map. The good marker.',
              'Six happy people and one happy dog. Rare night.'],
    angry:   ['Rolling. Tell the ridge I tried.',
              'Depot food it is. Cruel.',
              'I’ll be putting a different marker on that map.'],
  },
  medic: {
    speaker: ['Twelve hours in. Something hot, something with sugar.',
              'I stopped tasting things at hour nine. Feed me anyway.',
              'Whatever keeps a person upright. Clinically.'],
    testy:   ['I have people bleeding who wait less than this.',
              'If I fall asleep at this window, tap the glass.',
              'I can hear my own pulse. Never a good sign.',
              'Triage says I’m not urgent. Triage is lying.'],
    furious: ['I have to go back in there and be steady. STEADY.',
              'Somebody’s going to need me in nine minutes and I’m here.',
              'I’ve been awake since the sirens. The FIRST sirens.',
              'You want to know what an exhausted surgeon looks like? Hello.'],
    served:  ['You just bought yourself a free stitch-up.',
              'Best part of my night, and my night has been terrible.',
              'Sugar, salt, heat. That’s medicine, that is.'],
    angry:   ['If you ever come into my ward, I’ll remember this.',
              'Back to the vending machine. Back to the abyss.',
              'Fine. I’ll faint professionally.'],
  },
  suit: {
    speaker: ['I am on a clock and the clock bills by the minute.',
              'Corp account. Itemise it. Quickly.',
              'Something defensible on an expense line. And hot.'],
    testy:   ['This is going in the quarterly.',
              'I could buy this building. I would rather have lunch.',
              'My time costs more than your entire menu. Per minute.',
              'I am billing this wait to somebody. It won’t be me.'],
    furious: ['Your water permit is a document. Documents get lost.',
              'I have sat in this lane longer than most board meetings.',
              'Somebody in an office is going to hear a name today.',
              'I withdraw the account. Verbally. Formally. Now.'],
    served:  ['Acceptable. Keep the change, it isn’t mine.',
              'Noted favourably. Do not read into that.',
              'The account stays open. Don’t celebrate.'],
    angry:   ['Noted. Your permit renewal is in March.',
              'I’ll be recommending the other one.',
              'This conversation is over, and it is minuted.'],
  },
  /* ⚠ THE KID’S ONE DELIBERATE ECHO, so nobody “tidies” it away: the speaker
     line “I saved ALL WEEK for the big one” and the furious line “I saved all
     week. ALL WEEK. For standing here” are a SETUP AND A PAYOFF, and both pools
     are reachable in one visit (speaker at the box, furious once the fuse is
     short) so the callback actually lands. It is the only near-repeat in the
     275 authored lines that is there on purpose — scratchpad r5dt/voice.mjs
     flags similarity across every pool and this is the row to expect.
     The served/angry pair used to echo the same way — “I’m telling EVERYONE at
     the pump” against “I’m telling everyone at the pump. The BAD version” — and
     it was a MISTAKE: `settle()` draws from exactly ONE of those two pools per
     customer, so the setup and the punchline could never both be heard and the
     joke did not exist. The angry line now pays off the SPEAKER line instead
     (“I’ve got the caps, look”), which is a pair a player can actually hear. */
  kid: {
    speaker: ['Fries. Just fries. I’ve got the caps, look.',
              'Can I get the one with the — the crispy — yeah, that.',
              'The big one. I saved ALL WEEK for the big one.'],
    testy:   ['My mum says the old world had these in five minutes.',
              'Is it nearly? Is it nearly?',
              'I’m allowed out till the lights come on. That’s the rule.',
              'I could’ve had a whole noodle by now. A WHOLE one.'],
    furious: ['The lights are ON. The lights are on and I’m still HERE.',
              'I saved all week. ALL WEEK. For standing here.',
              'My mum’s going to say I told you so, and she’ll be RIGHT.',
              'This is the worst thing that has ever happened. Ever.'],
    served:  ['Best day. BEST day.',
              'I’m telling EVERYONE at the pump.',
              'I’m going to eat this so fast. Watch.'],
    angry:   ['Fine. I’ll go to the noodle guy. He’s worse but he’s FAST.',
              'That’s not fair and you know it.',
              'Putting the caps back in the tin. All of them.'],
  },
  raider: {
    speaker: ['Make it fast and nobody’s day gets ruined.',
              'Food. Now. That’s the whole conversation.',
              'I’m being polite. Note the effort. Note the time limit.'],
    testy:   ['You’re testing something you shouldn’t test.',
              'I count to ten. I’m at six.',
              'The crew’s watching me be patient. Embarrassing us both.',
              'I have never queued before. It isn’t going well.'],
    furious: ['I’m at ten. I’ve been at ten a while now.',
              'You know what we do to places that waste our time.',
              'I came here instead of taking it. I CHOSE that.',
              'The crew’s stopped watching. That’s worse.'],
    served:  ['Huh. Good. We’ll skip this block next run.',
              'You get to keep the sign. For now.',
              'Nobody hears about this. Understood?'],
    angry:   ['We’ll be back. Not for food.',
              'Remember this window. I will.',
              'That was your one. You had one.'],
  },
  family: {
    speaker: ['Big order, sorry — first time out of the vault in years.',
              'Whatever you’d feed your own. All of it.',
              'She’s only ever eaten out of a foil pouch. Be gentle.'],
    testy:   ['The little one’s never had a hot meal. Please.',
              'We can wait. We’re very good at waiting.',
              'Thirty years underground, love. This is nothing.',
              'She keeps asking if it’s real. Tell her it’s real.'],
    furious: ['She’s stopped asking. That’s the bit that gets me.',
              'We surfaced for this. We actually surfaced for this.',
              'Curfew’s at dusk and the hatch doesn’t open twice.',
              'I promised her. I don’t get to promise much.'],
    served:  ['She’s crying. Good crying. Thank you.',
              'We’ll be telling people about tonight.',
              'That’s her first. Her actual first. Thank you.'],
    angry:   ['It’s fine. We’ll tell her they were sold out.',
              'Come on, love. Back in the truck.',
              'Don’t look back at him, sweetheart. Eyes forward.'],
  },
  mayor: {
    speaker: ['This is for the office. It’s not for me. It’s for the office.',
              'Council order. Discreetly, if you can.',
              'Nothing on a receipt. Everything on a tray.'],
    testy:   ['The Mayor doesn’t wait. Which means I don’t wait.',
              'There is a meeting. There is always a meeting.',
              'I am the third most important person in this vehicle.',
              'Somebody upstairs is going cold and blaming me.'],
    furious: ['The meeting started. I’m the agenda item that’s missing.',
              'I will be asked where I was, and I’ll have to say HERE.',
              'Do you know how many committees can look at one road?',
              'This is a municipal matter now. I’m sorry, but it is.'],
    served:  ['The council will hear about this favourably.',
              'Your water ration is safe another quarter.',
              'Nothing happened here. But well done.'],
    angry:   ['Your road resurfacing just moved to next year.',
              'I’ll note that the vendor was unable to comply.',
              'The office will eat. Elsewhere. Loudly.'],
  },
  ghoul: {
    speaker: ['Been coming here forty years. Longer than the crater.',
              'The usual. You know the usual. Your grandad knew it.',
              'Same as the day the sky went. Bit of continuity.'],
    testy:   ['Take your time. I’ve got nothing but.',
              'Used to be a bank here. Terrible food.',
              'I’ve outlived four owners of this place. No rush.',
              'There was a queue here in ’72. Same length, better music.'],
    furious: ['Now, I don’t complain. But I am thinking about it.',
              'I’ve less time left than most, and you’re spending it.',
              'Last fella who kept me waiting is in the crater.',
              'Forty years of goodwill, and it’s going. Going.'],
    served:  ['Tastes the same as before. Highest thing I can say.',
              'Good lad. Good lad.',
              'Forty-one years, then. See you at forty-two.'],
    angry:   ['Ah, well. Been a long life of missing lunch.',
              'No matter. No matter at all.',
              'Bank was better. There. I said it.'],
  },
  guard: {
    speaker: ['Two of everything. The gate doesn’t feed us.',
              'Shift order. Don’t skimp, we check.',
              'Four men with rifles. Consider that a note on the order.'],
    testy:   ['My relief’s in ten and he eats what I don’t.',
              'Anything moves in that lane, I’m getting out.',
              'I shouldn’t have my eyes off the road this long. I do, though.',
              'The lads have started rating the queue. You’re losing.'],
    furious: ['My relief’s here. He’s laughing. He’s going to eat MY food.',
              'The gate is unwatched. Because of a burger. Write that down.',
              'I am armed, hungry and off-post. Pick one to fix.',
              'Next time I’m searching everything that leaves here.'],
    served:  ['Your name’s on the friendly list at the north gate.',
              'Straight through next time. No search.',
              'Four men are about to say something nice about you.'],
    angry:   ['Gate’s closing at dusk. Don’t be late tonight.',
              'That’s a shame. That’s a real shame.',
              'You just made the search list. Congratulations.'],
  },
};

/* Fallback voice. A customer id with no VOICE entry still speaks — silence at
   the speaker box reads as a broken game, not as a quiet customer. */
const GENERIC = {
  speaker: ['Whatever’s hot and whatever’s left.', 'Food. Please. Any food.',
            'I’m not fussy. I stopped being fussy years ago.'],
  testy:   ['Still here.', 'Any minute now, yeah?', 'Not a complaint. An observation.'],
  furious: ['I’ve given you longer than I give most things.', 'Right. Right. Okay.',
            'This was meant to be the easy part of today.'],
  served:  ['Appreciated. Genuinely.', 'That’s the day turned around.',
            'Hot food. Still can’t get used to it.'],
  angry:   ['Forget it.', 'Not worth the fuel.', 'Should’ve stayed in.'],
};

/* Set-piece lines. These OVERRIDE the customer's own for the moments that make
   them a set piece, then hand back to the personality for anything unlisted. */
const SPECIAL_VOICE = {
  bulk:   { speaker: ['Corp order. Full box, itemised, and I’ll need it hot.',
                      'Bulk purchase. The whole floor eats or nobody does.'],
            testy:   ['Forty people upstairs are watching the lift for me.',
                      'It’s a big order. I know it’s a big order. I’m still asking.',
                      'I put my name on this requisition. My actual name.',
                      'They’ve started sending someone down to look at me.'],
            furious: ['The floor’s gone quiet. A hungry floor goes quiet.',
                      'This WAS a standing order. Hear the tense.',
                      'Forty people are going to know exactly whose fault this is.',
                      'I am about to go back up there with nothing. NOTHING.'],
            served:  ['Invoice it. And — genuinely — thank you.',
                      'The floor will hear it was you.'],
            angry:   ['Cancel it. The floor eats ration bars and knows why.',
                      'That was a standing order. Was.'] },
  jump:   { speaker: ['The line moved. I moved it.',
                      'Front of the queue. Don’t make it a thing.'],
            testy:   ['I skipped a queue for this. Don’t make me look stupid.',
                      'Everyone behind me is enjoying this. Don’t extend it.',
                      'I made a scene to get here. Justify the scene.',
                      'Four people are staring at the back of my head.'],
            furious: ['I took the front of the line for THIS wait?',
                      'They’re laughing back there. At me. Because of you.',
                      'I could have taken it. I could still take it.',
                      'Cutting the queue was meant to be the clever bit.'],
            served:  ['See? Nobody had to bleed.',
                      'Efficient. I like efficient.'],
            angry:   ['Everyone in this lane saw that.',
                      'You had one job and a very short queue.'] },
  grudge: { speaker: ['You dropped my order an hour ago. Second chance.',
                      'Back again. Prove the last one was a fluke.'],
            testy:   ['This is going exactly like last time. Exactly.',
                      'I gave you a second go. I don’t do thirds.',
                      'I’m watching the same clock run out twice.',
                      'Tell me this is different. Go on. Say it.'],
            furious: ['Same window, same wait. Same ending, is it?',
                      'I defended you to myself on the drive over.',
                      'Twice is a pattern. Twice is who you ARE.',
                      'I came back. That was the mistake, wasn’t it.'],
            served:  ['…Alright. We’re square.',
                      'Forgiven. Not forgotten, but forgiven.'],
            angry:   ['Twice. TWICE. I’m telling the whole block.',
                      'That’s the last time I give anyone a second go.'] },
  favour: { speaker: ['Told three people about this place. Don’t make a liar of me.',
                      'Back for more. That’s the review.'],
            testy:   ['I’ll wait. I’ve told people you’re worth waiting for.',
                      'Busy is good. Busy is a compliment. Mostly.',
                      'I keep telling myself this is a good sign.',
                      'I sent my neighbour here. Yesterday. Confidently.'],
            furious: ['I VOUCHED. Out loud. To people with names.',
                      'Don’t do this to me. I recommended you.',
                      'I’m going to have to walk this back at the depot.',
                      'You were my one good recommendation. My only one.'],
            served:  ['That’s four people I’m telling now.',
                      'Never doubted it.'],
            angry:   ['I VOUCHED for you.',
                      'Well. I look stupid now, don’t I.'] },
};

/**
 * Pick one line.
 *
 * `key` is 'speaker' | 'testy' | 'furious' | 'served' | 'angry'. The two waiting
 * pools fall back to EACH OTHER before they fall back to GENERIC, so a
 * half-written personality still escalates in its own voice rather than
 * dropping into the house style mid-conversation.
 *
 * `avoid` is the line this car said LAST. It is skipped if the pool has
 * anything else in it — the cheapest possible fix for the "said it eighteen
 * times" defect, and it costs one comparison.
 */
function voiceFor(custId, key, special, r, avoid) {
  const sib = key === 'testy' ? 'furious' : (key === 'furious' ? 'testy' : null);
  const at = (tbl) => (tbl && (tbl[key] || (sib ? tbl[sib] : null))) || null;
  const pool = at(special ? SPECIAL_VOICE[special] : null)
            || at(VOICE[custId])
            || at(GENERIC) || [];
  if (!pool.length) return '';
  if (avoid && pool.length > 1) {
    const fresh = pool.filter((s) => s !== avoid);
    return rpick(r, fresh) || '';
  }
  return rpick(r, pool) || '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   🥬 §MODIFIERS — "no onions", "extra chili", and how they are CHECKED.
   ═══════════════════════════════════════════════════════════════════════════
   A modifier is a PROMISE attached to an ordered line. It shows on the ticket,
   it is spoken at the speaker box, it shortens the customer's fuse a little,
   and it is judged at the window against WHAT THE PLAYER ACTUALLY BUILT.

   🔴🔴 THE BUG THIS SECTION EXISTS TO KILL, WRITTEN DOWN SO IT CANNOT COME BACK
   The first version scored a modifier as `avgQuality >= MOD_WANT_Q`, with
   MOD_WANT_Q 1.0 and ECON.Q_GOOD 1.0. Those two numbers being equal meant EVERY
   dish that was not raw or burnt cleared EVERY modifier by construction. It was
   not a weak check, it was not a check at all, and it was worse than nothing:

     measured on burgerClassic, ticket says "no greens" —
       (A) never assembled at all       avgQ 1.0000  CLEARED  tip 0.3449
       (B) canon build WITH the lettuce  avgQ 1.1000  CLEARED  tip 0.3617
       (C) obeyed, lettuce omitted       avgQ 1.0600  CLEARED  tip 0.3564
       (D) five onions, recipe ignored   avgQ 1.0000  CLEARED  tip 0.3485

   All four cleared, and (C) — the one that DID WHAT THE CUSTOMER ASKED — paid
   LESS than (B), which ignored them. The mechanic was not merely decorative; it
   was inverted, and it quietly taught the player that reading the ticket costs
   money. A promise that cannot be broken is not a promise.

   THE SAME FOUR BUILDS, AFTER — same recipe, same ticket, same avgQ per row:
       (A) never assembled at all       UNPROVEN  tip 0.2905
       (B) canon build WITH the lettuce BROKEN    tip 0.2102
       (C) obeyed, lettuce omitted      HONOURED  tip 0.4001
       (D) five onions, recipe ignored  HONOURED  tip 0.3922
   Obeying is now the best-paid row and ignoring the ticket is the worst — a
   1.9× spread between (C) and (B) where there used to be a 1.5% one, pointing
   the wrong way.

   ── SO: A MODIFIER IS NOW A LITERAL, THREE-WAY, PER-LINE CHECK ─────────────
   `judgeMod()` below returns 'honoured' | 'broken' | 'unproven', never a
   quality comparison:

     hold  ('no onions')   HONOURED  iff `ing` appears ZERO times in every unit
                                     that filled this line.
                           BROKEN    if it appears anywhere.
     extra ('extra cheese') HONOURED iff `ing` appears at least MOD_EXTRA_MIN
                                     times in EVERY unit. Canon lays one; extra
                                     means going back to the bin.
                           BROKEN    otherwise — including leaving it out.
     cook  ('well done')    HONOURED iff every unit that filled the line came
                                     off the pass PERFECT (`item.pn === filled`).
                                     🔴 This one is checkable TODAY with no
                                     change to anyone else's file, because
                                     state.js already counts perfect units.
     gift  ('take your time') NEVER SCORED. It asks for nothing, so it pays
                                     nothing either way (see the pool below).

   ── 🔴 SEAM 1 LANDED. THE EVIDENCE NOW EXISTS. ────────────────────────────
   Round 2 shipped this check reading `ticket.items[i].builds`, a field NOBODY
   WROTE. `grep -rn "\.builds"` returned one hit and it was inside the handover
   comment at the bottom of this file asking for it. So every `hold` and every
   `extra` short-circuited to 'unproven' and was worth exactly zero: measured
   over 12 seeded days at level 20, 94 promises judged, {honoured:0, broken:2,
   unproven:92}. The ✓ payoff branch of the renderer's `rewardMoment()` was
   unreachable dead writing — the same bug class as round 1's dead `served`
   lines, one layer up.

   kitchen.state.js now records it, end to end, and the chain is worth knowing
   because every link is load-bearing:

       addStep()      → slot.steps  = [ingId, …]            in LAY ORDER
       pullSlot()     → hand.built  = slot.steps.slice()
       plateHand()    → dish.built  = hand.built.slice()    the plate on the pass
       refreshReady() → item.builds = [built|null, …]       PROVISIONAL, per unit
       takeDishes()   → item.builds frozen to the units actually handed over

   `item.built` and `item.builds` are the SAME ARRAY under two names — the name
   this round's cross-file brief settled on, and the name this file already
   read. `buildsOf()` accepts either and they can never drift because state.js
   points both at one object.

   ── 🔴 `null` MEANS "NO EVIDENCE" AND `[]` DOES NOT ───────────────────────
   The one subtle thing in the seam, and getting it backwards inverts the whole
   mechanic. `startCook()` has ALREADY spent the full `recipe.needs` out of the
   pantry, so a dish nobody assembled physically contains everything the recipe
   calls for. If an un-assembled unit reported `built: []`, `countIn()` would
   count zero onions and score every "no onions" as HONOURED — paying out the
   reward for a promise the player never made, on a mini-game they may not even
   have on screen. So an un-assembled unit reports `null`, `judgeMod()` reads it
   as 'unproven', and it moves nothing:
     • it can never PUNISH a player for obeying a ticket the game cannot read;
     • it can never REWARD a player for ignoring one;
     • it is visibly different on screen (`modVerdict()` returns the same three
       words) so a ticket chip reads "—" rather than a lying ✓.
   A guess that moves money is worse than an honest blank.

   ── WHERE THE EVIDENCE IS READ FROM ───────────────────────────────────────
   `ticket.items[i].built` (=== `.builds`) — one entry per FILLED unit, in
   hand-over order:
       an ARRAY of ingredient ids in the order they were laid, or
       a MAP {ingId: count}, or
       `null` when that unit carried no build record.
   Both shapes are accepted because `slot.steps` is a lay-ordered array today
   and a counted map is the obvious thing somebody optimises it into later. A
   line whose record is missing, empty, or all-null is UNPROVEN — never honoured
   by default, never broken by default.

   ── 🔴 AND IT IS PRICED, NOT JUST SCORED (§SETTLEMENT) ────────────────────
   Judging the promise honestly is half the job. The other half is that it has
   to be worth something, and round 2's version moved only the tip BLEND
   (MOD_TIP_HIT/MISS), which is a fraction of a fraction. kitchen.data.js added
   four MOD_PAY_* keys and two MOD_POP_* keys this round precisely so the verdict
   moves real Cinder and real word-of-mouth; `settleMods()` below is where they
   are read and `tipFor()` is where the Cinder is delivered. See §SETTLEMENT for
   why the delivery pipe is the tip line and what would be better.

   ⚠ A MODIFIER JUDGES THE PROMISE, NOT THE RECIPE, AND THAT IS DELIBERATE.
   A dish built out of five onions and nothing else HONOURS "no greens" — there
   is genuinely no lettuce on it. That is not a hole: whether the player built
   the RECIPE correctly is `orderScore()` / `scoreBuild()`'s job in the other
   two files, and it reaches the same tip through `quality`. Two separate
   questions with two separate answers beats one blurred score that answers
   neither. In the A/B/C/D measurement above, obeying the ticket (C) still
   out-earns ignoring the recipe (D) because D loses the build-order bonus that
   C keeps — 0.4001 against 0.3922 on an otherwise identical check.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Modifier vocabulary.
     kind  hold | extra | cook | gift — decides how `judgeMod()` reads it.
     ing   the ingredient it is about. `null` for the two that are about the
           COOK rather than the build, and it is why `w` exists.
     w     spawn weight. 🔴 MEASURED DEFECT: with a flat pool and an `ing`
           relevance filter, the two ing-less modifiers survived every filter
           and took 64% of all requests — `no_rush` alone was 32%. A drive-thru
           where a third of all orders say "take your time" is a drive-thru with
           no time pressure and no jokes left. They are weighted down to 0.15
           and everything with an ingredient behind it is weighted 1.
     say   spoken as its own SENTENCE at the speaker box. It must therefore
           read as one on its own — see `speakerLine()`, which used to em-dash
           these onto a base that already ended in a full stop and produced
           "Corp account. Itemise it. Quickly. — drown it."
     ban   personalities this modifier never comes out of the mouth of. A raider
           who bullied to the front of the queue does not then ask you to take
           your time; that was a real captured line and it was funny for the
           wrong reason. */
const MODS = [
  { id:'no_onion',    kind:'hold',  w:1,    label:'no onions',      ing:'onion',    say:'No onions. They repeat on me.' },
  { id:'no_pickle',   kind:'hold',  w:1,    label:'no pickle',      ing:'pickle',   say:'Hold the pickle, I’m not an animal.' },
  { id:'no_sauce',    kind:'hold',  w:1,    label:'sauce on side',  ing:'sauce',    say:'Sauce on the side. I’m driving.' },
  { id:'no_lettuce',  kind:'hold',  w:1,    label:'no greens',      ing:'lettuce',  say:'No greens. I get enough green in the water.' },
  { id:'no_tomato',   kind:'hold',  w:1,    label:'no tomato',      ing:'tomato',   say:'No tomato. Long story, bad year.' },
  { id:'no_mayo',     kind:'hold',  w:1,    label:'no mayo',        ing:'mayo',     say:'Nothing white on it. Trust me.' },
  { id:'no_mush',     kind:'hold',  w:1,    label:'no mushroom',    ing:'mushroom', say:'No mushrooms. Not after the ridge.' },
  { id:'no_slaw',     kind:'hold',  w:1,    label:'no slaw',        ing:'slaw',     say:'Keep the slaw. Genuinely, keep it.' },
  { id:'extra_chz',   kind:'extra', w:1,    label:'extra cheese',   ing:'cheese',   say:'Double the cheese. I’ll pay for it.' },
  { id:'extra_chili', kind:'extra', w:1,    label:'extra chili',    ing:'chili',    say:'Extra chili. Serious extra.' },
  { id:'extra_sauce', kind:'extra', w:1,    label:'double sauce',   ing:'sauce',    say:'Drown it. Drown the whole thing.' },
  { id:'extra_bacon', kind:'extra', w:1,    label:'extra bacon',    ing:'bacon',    say:'Twice the bacon. It’s been a week.' },
  { id:'extra_pickle',kind:'extra', w:1,    label:'extra pickle',   ing:'pickle',   say:'Twice the pickle. I know. I know.' },
  { id:'extra_onion', kind:'extra', w:1,    label:'extra onions',   ing:'onion',    say:'Bury it in onions. Nobody’s kissing me.' },
  /* ⚠ NOT “Long story” — `no_tomato` already says “Long story, bad year”, and
     cheese and tomato are both on a Margherita and a Veggie, so one breath read
     “No tomato. Long story, bad year. No cheese. Long story, don’t ask.” Same
     stutter, same detector (r5dt/mods.mjs). */
  { id:'no_cheese',   kind:'hold',  w:1,    label:'no cheese',      ing:'cheese',   say:'No cheese. I gave it up the year the cows did.' },
  { id:'no_mustard',  kind:'hold',  w:1,    label:'no mustard',     ing:'mustard',  say:'No mustard. It gets everywhere.' },
  { id:'extra_must',  kind:'extra', w:1,    label:'extra mustard',  ing:'mustard',  say:'Yellow all over it. All over it.' },
  /* ⚠ NOT “Double the pepperoni” — `extra_chz` already says “Double the cheese”
     and both are in the pool for pizzaPepperoni and pizzaSupreme, so one order
     in the same breath read “Double the cheese. I’ll pay for it. Double the
     pepperoni. Go on.” Two promises are a fussy customer; two promises with the
     same opening two words are a stutter. Checked by r5dt/mods.mjs, which pairs
     every CO-SPEAKABLE modifier per recipe. */
  { id:'extra_pep',   kind:'extra', w:1,    label:'extra pepperoni',ing:'pepperoni',say:'Pepperoni till you can’t see the base.' },
  { id:'extra_oil',   kind:'extra', w:1,    label:'extra crispy',   ing:'oil',      say:'Extra crispy. Leave them in a bit.' },
  /* ⚠ THE DRINKS AND SIDES ROWS EXIST FOR A MEASURED REASON. `rollMods()` filters
     the pool to modifiers about an ingredient THIS dish contains, so a soda or a
     bag of fries used to leave nothing in the pool but the two ing-less rows —
     which is most of why "well done" and "take your time" were 64% of every
     request in the lane. Giving the drinks and sides menus their own vocabulary
     fixes the distribution at the source rather than by re-weighting twice. */
  { id:'no_ice',      kind:'hold',  w:1,    label:'no ice',         ing:'ice',      say:'No ice. I’m paying for drink, not weather.' },
  { id:'extra_ice',   kind:'extra', w:1,    label:'loads of ice',   ing:'ice',      say:'Pack it with ice. It’s forty degrees out there.' },
  { id:'extra_syrup', kind:'extra', w:1,    label:'extra syrup',    ing:'syrup',    say:'Make it sweet. Properly sweet.' },
  { id:'extra_coffee',kind:'extra', w:1,    label:'double shot',    ing:'coffee',   say:'Double shot. I’m driving through the night.' },
  { id:'no_milk',     kind:'hold',  w:1,    label:'black',          ing:'milk',     say:'Black. No milk, none of that.' },
  /* The two that are about the COOK rather than the build, weighted down hard —
     see `w` above. `well_done` is meaningless on a drink, so it is gated to the
     stations where something is actually cooked. */
  { id:'well_done',   kind:'cook',  w:0.15, label:'well done',      ing:null,       say:'Properly done. Not pink, not grey.',
    ban:['kid'], stations:['griddle','fryer','oven'] },
  { id:'no_rush',     kind:'gift',  w:0.15, label:'take your time', ing:null,       say:'And honestly — take your time.',
    ban:['raider','courier','suit','mayor'] },
];

/**
 * Roll the modifiers for ONE ordered line.
 *
 * Per LINE, not per unit: "two burgers, no onions" is one instruction a cook can
 * hold in their head; two burgers with two different modifiers each is a
 * spreadsheet. A second modifier on the same line is rare (MOD_SECOND_CHANCE)
 * and is deduped by id — 4.4% of modded orders used to carry the same modifier
 * twice, which reads as a bug rather than as a fussy customer.
 *
 * `no_rush` stays in the pool because it is the one modifier that BUYS the
 * player time, and finding it in the list is the reason to read the list. It is
 * simply no longer a THIRD of the list.
 */
function rollMods(r, recipeId, custId, special) {
  if (r() >= EC('MOD_CHANCE')) return [];
  const rec = recipeOf(recipeId);
  const needs = (rec && rec.needs) || {};

  /* The pool: a modifier must be ABOUT something in this dish (a "no pickle" on
     a fountain soda is a joke that lands once), must not be banned for this
     personality, and — for `no_rush` — must not be coming out of the mouth of
     somebody who just barged the queue. */
  const extraMin = Math.max(1, _int(EC('MOD_EXTRA_MIN')));
  const pool = MODS.filter((m) => {
    if (m.ing && !(needs[m.ing] > 0)) return false;
    /* 🔴 AN `extra` PROMISE MUST BE PHYSICALLY KEEPABLE, AND IT WAS NOT.
       `State.addStep()` refuses to lay more of an ingredient than the recipe
       calls for — deliberately, so the build bonus can never become a build
       penalty. So "extra mustard" on a hot dog (canon mustard:1) asked for two
       mustards on a dish that will not accept a second one: judged against
       MOD_EXTRA_MIN it is BROKEN the instant it is spoken, and the player is
       charged MOD_PAY_MISS + MOD_POP_MISS for failing to do something the game
       forbids. That is worse than the unproven bug it replaced, because it is
       loud and it is wrong. So an `extra` only enters the pool on a dish whose
       canon carries at least MOD_EXTRA_MIN of it — "double the cheese" on a
       Double (cheese:2) or a Margherita (cheese:2), never on a hot dog.
       ⚠ CONSEQUENCE, ACCEPTED: `extra_must` (mustard is 1 everywhere) and
       `extra_oil` (oil:1) can never spawn today. They stay in MODS rather than
       being deleted because the gate is on the RECIPE, not on the modifier —
       give any dish mustard:2 and the line becomes live with no code change. */
    if (m.kind === 'extra' && m.ing && !(needs[m.ing] >= extraMin)) return false;
    if (m.stations && rec && m.stations.indexOf(rec.station) === -1) return false;
    if (m.ban && custId && m.ban.indexOf(custId) !== -1) return false;
    if (m.id === 'no_rush' && special === 'jump') return false;
    return true;
  });
  if (!pool.length) return [];

  const out = [];
  const first = rweight(r, pool, 'w');
  if (!first) return [];
  out.push(mkMod(first));

  if (r() < EC('MOD_SECOND_CHANCE')) {
    // Deduped by id AND by ingredient: "no sauce, double sauce" is not a fussy
    // customer, it is an unwinnable ticket.
    const rest = pool.filter((m) => m.id !== first.id && !(m.ing && m.ing === first.ing));
    const second = rweight(r, rest, 'w');
    if (second) out.push(mkMod(second));
  }
  return out;
}

function mkMod(m) {
  return {
    id: m.id,
    kind: m.kind,
    label: m.label,
    ing: m.ing || null,
    say: m.say,
    // What this promise is worth either way. Held on the mod so a renderer can
    // show the stakes on the chip without knowing the ECON table.
    tipHit: m.kind === 'gift' ? 0 : EC('MOD_TIP_HIT'),
    tipMiss: m.kind === 'gift' ? 0 : EC('MOD_TIP_MISS'),
    // `no_rush` is the exception that proves the mechanic: it asks for nothing
    // and pays nothing, it just makes the customer patient.
    patienceMult: m.id === 'no_rush' ? EC('MOD_NORUSH_PATIENCE_MULT') : EC('MOD_PATIENCE_MULT'),
  };
}

/* ── EVIDENCE READERS ──────────────────────────────────────────────────────
   `builds` entries may be a lay-ordered array of ingredient ids or a counted
   map. Both collapse to "how many of `ing` were on this unit". */
function countIn(build, ing) {
  if (!build || !ing) return -1;             // -1 = no evidence for this unit
  if (Array.isArray(build)) {
    let n = 0;
    for (const s of build) {
      const id = (s && typeof s === 'object') ? (s.ing || s.id) : s;
      if (id === ing) n++;
    }
    return n;
  }
  if (typeof build === 'object') {
    const v = build[ing];
    return (typeof v === 'number' && isFinite(v)) ? Math.max(0, Math.floor(v)) : 0;
  }
  return -1;
}

/**
 * The per-unit build records for one ticket line, or [] when there are none.
 *
 * ⚠ TWO NAMES, ONE ARRAY. `item.built` is the name this round's cross-file
 * brief settled on; `item.builds` is the name round 2's check already read.
 * kitchen.state.js points BOTH at the same object rather than keeping two
 * copies, so they cannot disagree — but this reader accepts either, because a
 * seam that only works if two builders guessed the same noun is exactly how the
 * last round produced 92 'unproven' verdicts.
 */
function buildsOf(item) {
  if (!item) return [];
  const b = Array.isArray(item.built) ? item.built
          : (Array.isArray(item.builds) ? item.builds : null);
  if (!b || !b.length) return [];
  return b.filter((x) => x !== null && x !== undefined);
}

/**
 * 🔴 THE CHECK. One modifier against one ticket line.
 * → 'honoured' | 'broken' | 'unproven'. Never a quality comparison.
 */
function judgeMod(mod, item) {
  if (!mod) return 'unproven';
  if (mod.kind === 'gift') return 'unproven';        // asks for nothing, scores nothing

  if (mod.kind === 'cook') {
    // state.js already counts PERFECT units per line (`pn`) and filled units
    // (`filled`). "Well done" is exactly that question, so this one needs
    // nothing from anybody.
    const filled = _int(item && item.filled);
    if (!filled) return 'unproven';
    return _int(item && item.pn) >= filled ? 'honoured' : 'broken';
  }

  const builds = buildsOf(item);
  if (!builds.length) return 'unproven';             // no evidence — see above
  const min = Math.max(1, _int(EC('MOD_EXTRA_MIN')));

  let seen = 0;
  let ok = true;
  for (const b of builds) {
    const n = countIn(b, mod.ing);
    if (n < 0) continue;                             // this unit has no record
    seen++;
    if (mod.kind === 'hold') { if (n > 0) ok = false; }
    else if (mod.kind === 'extra') { if (n < min) ok = false; }
  }
  if (!seen) return 'unproven';
  return ok ? 'honoured' : 'broken';
}

/* ═══════════════════════════════════════════════════════════════════════════
   💰 §SETTLEMENT — WHAT A KEPT PROMISE IS ACTUALLY WORTH, IN CINDER.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE FINDING THIS ANSWERS, quoted so it cannot be softened later:
   "The modifier promise is still worth exactly nothing, and obeying it still
    pays LESS than ignoring it." Controlled A/B, burgerClassic, ticket says
    "no greens", identical seed: OBEY 144 Cinder, DEFY 150. A 4% penalty for
    doing what the customer asked, because the only thing a verdict could move
    was the tip BLEND and the build-order bonus punished the omission harder
    than the blend rewarded it.

   So a verdict now settles in THREE currencies, all four ECON keys deep:

     CINDER   MOD_PAY_HIT × the honoured line's price, with MOD_PAY_HIT_MIN as a
              per-honoured-UNIT FLOOR under it, and MOD_PAY_MISS × the broken
              line's price against you. The floor is not decoration:
              kitchen.data.js works out that a percentage alone leaves an
              honoured "extra syrup" on a 25-Cinder soda worth less than the
              syrup, so the floor is set above the priciest pantry unit in the
              game and `assertDataSane()` re-derives that comparison from
              SUPPLY_RECIPES on every load.
     POP      MOD_POP_HIT / MOD_POP_MISS, per line, charged by `serveCar()`.
              Small — one detail of one ticket — but a broken promise is worth
              about a quarter of a lost ticket in word of mouth.
     TIP      MOD_TIP_HIT / MOD_TIP_MISS, unchanged, on the generosity blend.
              It is what makes an honoured promise feel different at every
              price point instead of being a flat coupon.

   🔴 WHY MISS > HIT IN BOTH CURRENCIES. kitchen.data.js sets MOD_PAY_MISS
   -0.25 against MOD_PAY_HIT 0.12 and asserts the relation. A broken promise is
   not a bonus the player merely failed to collect; the customer asked for one
   thing and got another. Symmetric numbers would make ignoring the ticket a
   valid strategy carrying a small tax, which is where round 2 already was.

   ⚠ WHERE THE CINDER IS DELIVERED, AND WHY IT IS NOT WHERE IT BELONGS.
   `State.serveTicket()` is the payer and it makes exactly ONE call to
   `bridge().addGems(payout + tip)`. This file owns no money (CONTRACT §1 —
   "deliberately THIN on the money") and there is no hook between the payout
   being computed and the gems being paid. The one seam state.js DOES open is
   `DriveThru.tipFor()`, which it calls once per served drive ticket, AFTER
   `takeDishes()` has frozen `item.built` and `item.filled` and BEFORE the
   ticket leaves the board. So the settlement rides out on the tip line,
   converted into a fraction of the payout it is being paid beside.

   That is a delivery pipe, not a design: the number is a settlement on the
   BILL and it prints as a tip. It is honest — the Cinder is real, it is priced
   from ECON, and the direction and magnitude are right — but the correct shape
   is a payout hook, and the exact signature is written out as handover item O1.
   Three consequences of the pipe, all real:
     • TIP_FRACTION_MAX (0.95) can bind on a CHEAP dish carrying an honoured
       `extra` — MOD_PAY_HIT_MIN is a per-unit Cinder floor set above the
       priciest pantry unit in the game, and the cheapest thing on the menu is a
       25-Cinder soda — so the floor is delivered in full on everything except
       the very bottom of the menu. Read the two numbers out of ECON and RECIPES
       rather than from here; they have both moved once already.
     • a badly broken promise can take the whole tip to zero and no further,
       because state.js reads a non-positive return as "no tip" and there is no
       way to reach into the payout from here.
     • 🔴 AND THE PROMISE MOVES THE TILL TWICE, ONLY ONE OF WHICH IS ON THE
       CHIP. The settlement is delivered on the tip line AND `gen *= verdict.mul`
       has already multiplied the generosity blend by MOD_TIP_HIT / MOD_TIP_MISS.
       MEASURED, round 5, one Commuter / one burgerClassic / one "no greens",
       everything else held identical and controlled against an ignore run that
       carries no promise at all (scratchpad r5dt/settle.mjs):
           settlement channel alone (MOD_TIP_* zeroed on the mod)
               chip "+28" → the tip moves +27      chip "−17" → the tip moves −18
           both channels, i.e. what ships
               chip "+28" → the till moves +34     chip "−17" → the till moves −32
       So the chip's figure IS delivered, to a Cinder of rounding — and then the
       blend moves it again, unshown. Honouring pays MORE than advertised; a
       break costs about TWICE what the chip warned. Nothing on screen argues
       with itself (there is no counterfactual on the card), so this is an
       understatement of stakes and not a lie — but it is the direction a player
       can least learn from, and it is O1's second half.
       ⚠ THE POPULARITY HALF HAS NO SUCH GAP: the same run charges +0.14 / −0.50
       and the chip and the toast both print +0.1 / −0.5, which is MOD_POP_HIT
       and MOD_POP_MISS exactly. One channel, one number, four surfaces.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What one ticket line's food is worth before multipliers — the base the
 * §SETTLEMENT is a percentage OF. MENU UNITS × basePrice, and NOT `qsum`.
 *
 * 🔴 THE DEFECT THIS CLOSES: THE CHIP QUOTED ONE FIGURE AND THE TOAST CHARGED
 * ANOTHER. This function used to prefer `item.qsum` — the sum of the QUALITY
 * multipliers of the units handed over — "when state.js has committed it", and
 * the comment claimed all three bases were "the same number in the ordinary
 * case". They are not: a perfect unit contributes 1.25 to `qsum` and 1 to a
 * count, a stale one less than 1. So the price base silently changed under the
 * player at the exact instant they pressed SERVE. Measured over 12 seeded days,
 * 468 drive tickets: the pre-serve chip and the reward toast named a DIFFERENT
 * number of Cinder on 106 of them (23%) — chip "−42", toast "−58"; chip "+19",
 * toast "+18" — while agreeing on the verdict word every single time. A price
 * the player is quoted and then not charged is the same defect as a verdict
 * they are shown and not paid on, one layer down.
 *
 * So the settlement is priced in UNITS, which are known from the moment the
 * order is spoken and do not move: `filled` once anything has covered the line,
 * `qty` before that. Chip and toast are then arithmetically the same number.
 *
 * ⚠ AND IT IS ALSO THE RIGHT BASIS ON ITS OWN TERMS. The promise is about what
 * was ON the dish, not about how well it was cooked; quality is already paid
 * for twice, in the payout (`basePrice × qsum`) and in the tip blend. Scaling
 * the promise settlement by it a third time made an honoured "no onions" worth
 * 25% more for being perfect and — worse — made BREAKING one on a perfect
 * burger cost more than breaking it on a mediocre one.
 */
function linePrice(item) {
  const rec = recipeOf(item && item.recipeId);
  if (!rec) return 0;
  const units = _int(item.filled) || Math.max(1, _int(item.qty));
  return Math.max(0, _num(rec.basePrice, 0) * units);
}

/**
 * What state.js will price this line at — `basePrice × qsum`, mirroring
 * `serveTicket()`. Used ONLY as the denominator in `payoutEstimate()`.
 *
 * ⚠ SEPARATE FROM `linePrice()` ON PURPOSE, and the two must not be merged
 * back. `linePrice()` is a PRICE THE PLAYER IS QUOTED and therefore has to be
 * stable across the commit; this is an ESTIMATE OF SOMEBODY ELSE'S ARITHMETIC
 * and therefore has to track it, quality multiplier and all. One function
 * serving both jobs is what quoted "−42" and charged "−58".
 */
function lineGross(item) {
  const rec = recipeOf(item && item.recipeId);
  if (!rec) return 0;
  const units = _num(item.qsum, 0) > 0 ? _num(item.qsum, 0)
              : (_int(item.filled) || Math.max(1, _int(item.qty)));
  return Math.max(0, _num(rec.basePrice, 0) * units);
}

/**
 * Judge every modifier on a ticket, and PRICE the verdict.
 * → { honoured, broken, unproven, cinder, pop,
 *     detail:[{id,label,kind,ing,recipeId,result,cinder,pop}] }
 *
 * `cinder` is the signed §SETTLEMENT in absolute Cinder and `pop` the signed
 * word-of-mouth. Exported through `modVerdict()` so the renderer draws the SAME
 * three words — and the SAME figure — on the chip that the till pays out on: a
 * verdict the player is told about after the fact and cannot see coming is a
 * mechanic they will never learn.
 *
 * ⚠ IT USED TO RETURN A THIRD NUMBER, `mul`, plus a per-row `worth`, and round
 * 6 deleted both with the channel they fed. They were the generosity-blend
 * multiplier: a second, invisible way for the same promise to move the same
 * till, which is why the chip's figure and the money disagreed by up to 88%.
 * Do not re-add either without a reader — `grep -rn "\.mul\b" public/src/kitchen/`
 * returned nothing outside this file even while it was live, which is the
 * shape of every defect this feature has shipped.
 *
 * 🔴 PURE. No mutation, no side effects, safe to call every frame from the
 * ticket chips and again from inside the payout. That purity is what lets the
 * money ride `tipFor()` without a double-settle guard.
 */
function judgeTicket(ticket) {
  const out = { honoured: 0, broken: 0, unproven: 0, cinder: 0, pop: 0, detail: [] };
  if (!ticket || !Array.isArray(ticket.items)) return out;
  const payHit = EC('MOD_PAY_HIT');
  const payFloor = EC('MOD_PAY_HIT_MIN');
  const payMiss = EC('MOD_PAY_MISS');
  const payMeh = EC('MOD_PAY_UNPROVEN');
  const popHit = EC('MOD_POP_HIT');
  const popMiss = EC('MOD_POP_MISS');

  for (const item of ticket.items) {
    const mods = (item && Array.isArray(item.mods)) ? item.mods : [];
    if (!mods.length) continue;
    const price = linePrice(item);
    // Units the promise was actually kept ON. `filled` while a line is being
    // served, `qty` for a live chip on a line nothing has covered yet — the
    // floor is per honoured UNIT, so a two-burger line honoured twice is worth
    // twice the floor.
    const units = Math.max(1, _int(item.filled) || _int(item.qty));

    for (const m of mods) {
      const result = judgeMod(m, item);
      /* 🔴 max(PERCENTAGE, FLOOR × UNITS), not one or the other. The percentage
         is what makes an honoured promise on a Supreme worth more than one on a
         hot dog; the floor is what stops it being worth less than the
         ingredient on the cheapest dishes. kitchen.data.js's comment beside
         MOD_PAY_HIT_MIN does the arithmetic. */
      const cinder = result === 'honoured' ? Math.max(payHit * price, payFloor * units)
                   : result === 'broken'   ? (payMiss * price)
                   : payMeh;
      const pop = result === 'honoured' ? popHit
                : result === 'broken'   ? popMiss
                : 0;
      out.cinder += cinder;
      out.pop += pop;
      out[result === 'honoured' ? 'honoured' : (result === 'broken' ? 'broken' : 'unproven')]++;
      out.detail.push({
        id: m.id, label: m.label, kind: m.kind, ing: m.ing || null,
        recipeId: item.recipeId, result,
        cinder: Math.round(cinder), pop: Math.round(pop * 100) / 100,
      });
    }
  }
  return out;
}

/**
 * 🔴 HOW WELL DOES THIS PLATE FIT THIS ORDER? Higher is better; 0 is neutral.
 *
 * ✅ SHIPPED AND CONSUMED. Three readers, all on the live path:
 *     kitchen.state.js `fitOf()`      — wrapped and guarded, feeding `planPass()`
 *     kitchen.state.js `planPass()`   — the ONE matcher behind both
 *                                       `refreshReady()` and `takeDishes()`
 *     kitchen.render.js `pickerHtml()`— the per-candidate "✓ keeps no greens" /
 *                                       "✗ breaks no greens" on the plate picker
 *
 * ⚠ THIS COMMENT USED TO SAY "NOTHING CALLS THIS YET AND IT IS EXPORTED ON
 * PURPOSE", for a whole round after kitchen.state.js started calling it every
 * tick. That is worse than an out-of-date note: a comment claiming the file's
 * biggest fix is UNSHIPPED is the exact instrument the next builder reads to
 * decide where to spend a round, and it points them at finished work. Re-grep
 * before you believe any "nobody calls this" in this codebase, including this
 * one — `grep -rn "fitScore" public/src/kitchen/`.
 *
 * WHAT THE BUG WAS, in the past tense it belongs in. `takeDishes()` filled a
 * ticket line with the FIRST matching-recipe plate on the pass, so the careful
 * burger built without lettuce for car 3 was handed to car 1, and car 3 got the
 * lettuce burger somebody else's ticket wanted. Both cars were then judged on a
 * plate that was not built for them, and a player who did everything right was
 * told they broke a promise — the one failure mode this mechanic must never
 * have. Six seeded 720s days at level 20 measured 80 honoured against 57 broken,
 * of which 43 were `hold` mods an obeying auto-cook HAD kept.
 *
 * WHAT CLOSED IT, and why it is not an earmark. The pass stays fungible
 * (kitchen.state.js's THE PASS: "plates are stock, not a pipe") — reserving a
 * plate for a ticket would turn the pass into a queue of promises the player
 * cannot re-plan. `planPass()` only decides WHICH of several INTERCHANGEABLE
 * plates goes out, lexicographically: pin > fit > contention > oldest, with a
 * fast exit so a board carrying no modifiers is byte-for-byte the old FIFO.
 * Re-measured over 12 seeded days: 89 broken `hold` verdicts remain and ZERO of
 * them had an available, uncontested, fitting plate the matcher passed over.
 *
 * → +1 for each modifier this plate HONOURS, −1 for each it BREAKS, 0 for each
 *   it cannot prove. A plain line scores 0 for every plate, which is what makes
 *   the fast exit sound.
 */
export function fitScore(item, dish) {
  try {
    const mods = (item && Array.isArray(item.mods)) ? item.mods : [];
    if (!mods.length || !dish) return 0;
    // Judge the ONE plate, by presenting it as a single-unit line. `assembled`
    // is what separates "no evidence" from "empty build" — see §MODIFIERS.
    const probe = {
      recipeId: item.recipeId, qty: 1, filled: 1,
      pn: dish.quality === 'perfect' ? 1 : 0,
      built: [dish && dish.assembled && Array.isArray(dish.built) && dish.built.length ? dish.built : null],
    };
    let n = 0;
    for (const m of mods) {
      const r = judgeMod(m, probe);
      if (r === 'honoured') n++;
      else if (r === 'broken') n--;
    }
    return n;
  } catch (e) {
    return 0;   // rule 2. A tie beats a throw inside somebody else's sort.
  }
}

/**
 * READ-ONLY. The live verdict on a car's order, for the ticket chips.
 * Safe to call every frame; safe before the order is filled (everything reads
 * 'unproven' until there is a dish to judge).
 */
export function modVerdict(K, car, now) {
  try {
    const live = (car && car.ticketId) ? car : findCar(K, car && (car.carId || car.id));
    const ticket = ticketFor(K, live || car);
    return judgeTicket(ticket);
  } catch (e) {
    return { mul: 1, honoured: 0, broken: 0, unproven: 0, cinder: 0, pop: 0, detail: [] };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATA LOOKUPS — every one tolerant of a sibling file mid-rewrite.
   ═══════════════════════════════════════════════════════════════════════════ */
function recipeOf(id) {
  try { if (typeof DATA.recipe === 'function') return DATA.recipe(id) || null; } catch (e) {}
  try { return (DATA.RECIPES || []).find((x) => x && x.id === id) || null; } catch (e) { return null; }
}
function customerOf(id) {
  try { if (typeof DATA.customer === 'function') return DATA.customer(id) || null; } catch (e) {}
  try { return (DATA.CUSTOMERS || []).find((x) => x && x.id === id) || null; } catch (e) { return null; }
}
function menuFor(level) {
  try {
    if (typeof DATA.menuForLevel === 'function') {
      const m = DATA.menuForLevel(level);
      if (Array.isArray(m)) return m;
    }
  } catch (e) {}
  try { return (DATA.RECIPES || []).filter((x) => x && _int(x.minLevel || 1) <= level); } catch (e) { return []; }
}

/** Lane capacity, WITH the up_lane2 upgrade folded in (CONTRACT: "Upgrades from
    kitchen.data.js (a second lane) must be honoured"). Reading ECON.LANE_CAP
    directly here would silently un-buy a 185,000-Cinder upgrade. */
function capOf(K) {
  const f = DF('laneCap');
  const n = f ? _int(f(K.upgrades)) : _int(EC('LANE_CAP'));
  return Math.max(1, n);
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE LANE BOOK — this module's own bookkeeping, hung off K.
   ═══════════════════════════════════════════════════════════════════════════
   Underscore-prefixed, therefore DERIVED AND NEVER SAVED (CONTRACT §5 fixes the
   saved subset to v/day/level/xp/popularity/pantry/convoys/totals — `_lane` is
   not in it and must never be added). Hung off `K` rather than kept in module
   scope so a headless harness can drive two independent `K`s through this file
   without them sharing a spawn timer, which is exactly what `arrivalPlan()`'s
   critics will want to do.

   `mem` is the regulars ledger and is PER SHIFT on purpose. A cross-day grudge
   would have to be saved, and CONTRACT §5's saved subset is closed. "You
   dropped my order an hour ago" is also simply a better line than "last
   Tuesday" — the shift is the unit of everything else here (§4), so it is the
   unit of memory too.
   ═══════════════════════════════════════════════════════════════════════════ */
function book(K) {
  if (!K._lane || typeof K._lane !== 'object') {
    K._lane = {
      nextAt: 0,      // `now` at which the next arrival is due
      seq: 0,         // lane-local id counter
      mem: {},        // custId → { served, lost, waved, lastAt }
      pending: [],    // events raised outside a tick (fallback path only)
      passers: [],    // §BALK — vehicles that drove past a full lane, for render
      stats: { arrived: 0, served: 0, lost: 0, balked: 0, waved: 0, jumped: 0 },
    };
  }
  // A book built by an earlier build of this file may predate a field. Cheap,
  // once per call, and it is the difference between a new view returning [] and
  // the whole lane throwing on the first frame after a hot reload.
  if (!Array.isArray(K._lane.passers)) K._lane.passers = [];
  return K._lane;
}

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT RAISING — exactly once, and preferring state.js's emitter.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE DOUBLE-PUSH TRAP. kitchen.state.js's tick does:
        const evs = DriveThru.tick(K, step, t);
        if (Array.isArray(evs)) for (const e of evs) K._events.push(e);
   so if this file ALSO called `State.emit()` (which pushes to `K._events`
   itself) and then returned the same events, every car event would land in the
   frame TWICE — two "car left" toasts, two float-ups, and a render that draws
   the same arrival animation on top of itself. Found by reading state.js's tick
   before writing a line of this, which is the only reason it is not a bug.

   THE RULE: prefer `State.emit()`, because it also fires SUBSCRIBERS — render
   calls `State.on('car:arrive', …)` and a returned-only event would never reach
   it. When emit succeeds we return NOTHING for that event; it is already in
   `K._events` and therefore already in the array state.js's tick drains and
   hands to `Render.frame(dt, now, events)`. Nothing is lost.

   The push-to-`out` branch is the fallback for a harness driving a FAKE `K`:
   `State.emit()` would post to the real `Kitchen` singleton instead of the fake
   one, so we detect that (`State.Kitchen !== K`) and hand the events back
   through the return value, which is the CONTRACT's documented shape anyway.

   🔴🔴 `name` AND `t` ARE RESERVED PAYLOAD KEYS. NEVER PUT EITHER IN A PAYLOAD.
   Both emitters — state.js's and the one below — build the event as
       Object.assign({ name: String(name), t: K.now }, payload)
   so a payload key called `name` SILENTLY OVERWRITES THE EVENT NAME. The first
   draft of this file shipped `car:arrive` with `{ name: car.name }` in the
   payload, and every arrival was dispatched under the event name
   "Mayor’s Aide" / "Scavver" / "Kid on a BMX". Nothing threw. Nothing logged.
   `on('car:arrive', …)` simply never fired, and the lane looked like it was
   spawning cars that nobody had ordered. Caught only by a harness that counted
   event names. The customer's display name is `custName`; it is spelled that
   way in exactly one place and this is why.
   ═══════════════════════════════════════════════════════════════════════════ */
function raise(K, out, name, payload) {
  const ev = Object.assign({ name: String(name), t: _num(K.now, 0) }, payload || {});
  try {
    if (typeof State.emit === 'function' && State.Kitchen === K) {
      State.emit(name, payload);
      return ev;               // delivered; do NOT also return it to state.js
    }
  } catch (e) { /* fall through to the buffer */ }
  if (Array.isArray(out)) out.push(ev);
  else book(K).pending.push(ev);
  return ev;
}

/** A one-off raise from outside tick(): buffered until the next tick drains it. */
function raiseLater(K, name, payload) { return raise(K, null, name, payload); }

/* ═══════════════════════════════════════════════════════════════════════════
   🛻 §RIDES — WHO IS DRIVING DECIDES WHAT THEY ARE DRIVING.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE CAPTURED DEFECT: "🛻 Kid on a BMX drove past." A boy on a bicycle,
   turning up in a pickup truck, said out loud by the game. In the same run the
   Kid was drawn as 🚙 in one lane and the Corp Suit as 🏍️ in another. The
   vehicle was picked by a straight weighted roll over all of CARS, entirely
   independently of who was sitting in it, so the lane routinely contradicted
   its own character names — and the writing is the strongest thing in this
   module, which makes this the one place the presentation actively fought it.

   A ride list is CHARACTERISATION, not economy, so it lives here beside VOICE
   and MODS rather than in kitchen.data.js — the same call `VOICE` already
   makes. What it is NOT allowed to do is invent vocabulary: every id below is
   an existing `CARS[].id`, so the weights, `seats`, `len` and `patienceMul`
   that make a rig hold up more of the lane than a bike all keep working
   untouched. `cust.vehicles` is read FIRST if kitchen.data.js ever adopts the
   field, so adopting it needs no change here.

   ⚠ CARS HAS NO BICYCLE, AND THE LANE STOPPED SAYING OTHERWISE (§RIDE SKINS).
   Round 3 mapped "Kid on a BMX" to `bike` because it was the smallest chassis
   on the lot; `bike`'s icon is 🏍️, so the lane label read "🏍️ Kid on a BMX" —
   a boy on a bicycle riding a motorbike, in the one pairing that contradicts
   its own customer name on screen. Round 5 closed it WITHOUT a data.js row: see
   RIDE_SKINS below, which repaints the icon and the vehicle NAME and changes no
   number. A `bmx` row in CARS would still be tidier and is still in the
   HANDOVER; it is now a nicety, not a visible defect.

   An empty or unrecognised list falls through to the full roster rather than to
   an empty pool: a personality nobody has thought about yet drives anything,
   which is exactly where this file started and is a fine default.
   ═══════════════════════════════════════════════════════════════════════════ */
const RIDES = {
  commuter: ['hatch', 'suv', 'taxi'],     // the default civilian mix
  courier:  ['bike'],                     // 🛵 in their own icon. They ride.
  scav:     ['pickup', 'hatch', 'bike'],  // whatever still runs
  trucker:  ['rig', 'pickup'],            // "Feed the whole cab."
  medic:    ['van', 'hatch'],             // an ambulance is a van
  /* ⚠ THE SUV IS HERE FOR THE BULK PATH, NOT FOR THE CHARACTER. `rollSpecial()`
     picks `suit` for 60% of corp bulk buys, and a bulk buy needs four seats — so
     with a taxi/hatch-only list EVERY bulk suit fell through to the whole
     ≥4-seat roster and turned up in a TRANSIT BUS. One row with four seats on
     the list keeps the fallback for genuinely impossible pairings only. */
  suit:     ['suv', 'taxi', 'hatch'],     // no limo in CARS; a taxi reads corp
  kid:      ['bike'],                     // …wearing the BMX skin. See RIDE_SKINS.
  raider:   ['pickup', 'bike'],           // technicals and motorbikes
  family:   ['van', 'bus', 'suv'],        // five seats minimum, and they use them
  mayor:    ['taxi', 'suv'],              // driven, not driving
  ghoul:    ['pickup', 'hatch'],          // forty years of the same truck
  guard:    ['patrol', 'suv'],            // 🚓
};

/* ═══════════════════════════════════════════════════════════════════════════
   🚲 §RIDE SKINS — PAINT, NEVER PHYSICS.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE CAPTURED DEFECT, and it survived two rounds because the fix looked
   like somebody else's file: the lane label read "🏍️ Kid on a BMX". §RIDES
   above got the RIGHT ROW — a bike is the smallest, cheapest, one-seat thing in
   CARS and it is exactly what a child turns up on — and then printed the wrong
   PICTURE, because CARS[].icon for `bike` is a motorbike.

   Both available fixes were wrong on their own terms:
     • a `bmx` row in kitchen.data.js is one line and is NOT THIS FILE'S to
       write. It stays in the HANDOVER.
     • inventing a local car object here would fork the vehicle vocabulary —
       §RIDES is explicit that it may not invent one ("every id below is an
       existing `CARS[].id`, so the weights, `seats`, `len` and `patienceMul`
       … all keep working untouched"), and a lane row with an id nothing else
       knows breaks `DATA.car(id)` for every reader downstream.

   So a skin overrides EXACTLY the two presentation fields — `icon` and `name` —
   on a shallow copy, and touches nothing that the sim reads. `id`, `seats`,
   `len`, `weight` and `patienceMul` are still the real `bike` row, so a BMX
   still holds one length of lane, still carries one seat's worth of order and
   still has a bike's short fuse. Nothing about the economy or the queue moves;
   the label stops lying.

   ⚠ APPLIED AFTER THE WEIGHTED PICK, NEVER TO THE POOL. Skinning inside
   `ridePool()` would allocate three objects per spawn for nothing, and — the
   part that matters — `arrivalPlan()` shares this pick path. Copying after
   `rweight()` consumes no extra RNG, so a replay is still byte-for-byte the
   shift it is replaying.

   ⚠ A SKIN IS NOT A LICENCE TO RE-NAME A VEHICLE FOR FLAVOUR. It exists for the
   one case where the customer's own NAME contradicts the picture. Two rows
   would already be one too many; if a third is ever wanted, that is the signal
   that CARS wants the row instead.
   ═══════════════════════════════════════════════════════════════════════════ */
const RIDE_SKINS = {
  // "Kid on a BMX" is a bicycle. The Courier keeps 🏍️ on purpose — their own
  // customer icon is 🛵 and "courier on a motorbike" is not a contradiction.
  kid: { bike: { icon: '🚲', name: 'BMX' } },
};

/** Repaint a picked vehicle for whoever is sitting in it. See §RIDE SKINS. */
function skinRide(carDef, cust) {
  if (!carDef || !cust) return carDef;
  const byCar = RIDE_SKINS[cust.id];
  const skin = byCar && byCar[carDef.id];
  if (!skin) return carDef;
  // A COPY. CARS rows are module-level data shared with every other reader in
  // the app; mutating one here would give every motorbike in the game a bicycle
  // icon for the rest of the page load.
  return Object.assign({}, carDef, { icon: skin.icon, name: skin.name });
}

/** The vehicles this personality plausibly turns up in. See §RIDES. */
function ridePool(cars, cust) {
  if (!cust) return cars;
  const want = (Array.isArray(cust.vehicles) && cust.vehicles.length)
    ? cust.vehicles
    : RIDES[cust.id];
  if (!Array.isArray(want) || !want.length) return cars;
  const pool = cars.filter((c) => c && want.indexOf(c.id) !== -1);
  return pool.length ? pool : cars;
}

/* ═══════════════════════════════════════════════════════════════════════════
   🚙 SPAWN — who turns up, in what, wanting what.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Build the order for one arrival.
 *
 * `likes` biases WHAT they order toward their menu categories — a BIAS, never a
 * filter. kitchen.state.js's walk-in spawner makes the same call for the same
 * reason: a kitchen that only ever sees the orders it expects has no reason to
 * keep the whole menu hot, and a locked or half-unlocked menu must still be
 * servable by everyone who drives up.
 *
 * ⚠ The order is capped THREE ways and all three matter: the customer's own
 * {min,max}, the vehicle's `seats` (a BMX does not buy a family bucket, and the
 * moment it does the lane stops reading as vehicles), and ECON.ORDER_MAX_ITEMS
 * as the hard ceiling nothing gets past.
 */
function buildOrder(r, cust, carDef, level, special) {
  const menu = menuFor(level);
  if (!menu.length) return [];

  const spec = (cust && cust.order) || {};
  let lo = Math.max(1, _int(spec.min || 1));
  let hi = Math.max(lo, _int(spec.max || 2));
  if (special === 'bulk') {
    lo = Math.max(lo, Math.round(lo * EC('BULK_ITEM_MULT')));
    hi = Math.max(lo, Math.round(hi * EC('BULK_ITEM_MULT')));
  }
  const seats = Math.max(1, _int(carDef && carDef.seats) || 2);
  const ceiling = Math.max(1, _int(EC('ORDER_MAX_ITEMS')));
  // A bulk buyer is the one case allowed past ORDER_MAX_ITEMS, because "a corp
  // buyer placing a bulk order" is meaningless if it is the same size as a
  // hauler's. It still cannot exceed twice the ceiling.
  const hardCap = special === 'bulk' ? ceiling * 2 : ceiling;
  hi = _clamp(hi, 1, Math.min(hardCap, special === 'bulk' ? hardCap : seats));
  lo = _clamp(lo, 1, hi);

  const count = rint(r, lo, hi);
  const likes = (cust && Array.isArray(cust.likes)) ? cust.likes : [];
  const liked = likes.length ? menu.filter((x) => likes.indexOf(x.cat) !== -1) : [];
  const bias = EC('LIKE_BIAS');

  const items = [];
  for (let i = 0; i < count; i++) {
    const pool = (liked.length && r() < bias) ? liked : menu;
    const rec = rpick(r, pool);
    if (!rec) continue;
    const found = items.find((x) => x.recipeId === rec.id);
    if (found) found.qty++;
    else items.push({ recipeId: rec.id, qty: 1, mods: [] });
  }
  // Modifiers, rolled per LINE rather than per unit (see §MODIFIERS) and gated
  // on who is asking — a raider who just barged the queue does not then ask you
  // to take your time.
  for (const it of items) {
    it.mods = rollMods(r, it.recipeId, cust && cust.id, special);
  }

  /* 🔴 ONE VOICE PER ORDER. Modifiers are rolled per LINE, which is right — "no
     onions" is a promise about the burgers and not about the milkshake beside
     them — but the whole order is SPOKEN as one breath at the speaker box, and a
     customer who says "Bury it in onions. No onions. No mushrooms." in a single
     sentence reads as a bug, not as a fussy customer. So a second line may not
     contradict or repeat an earlier line's promise about the SAME ingredient.
     Dropped rather than re-rolled: a dropped modifier is simply a plainer
     order, and re-rolling here would spend RNG in a loop that can fail. */
  const spokenFor = Object.create(null);
  let spoken = 0;
  const maxPerOrder = Math.max(1, _int(EC('MOD_MAX_PER_ORDER')));
  for (const it of items) {
    it.mods = (it.mods || []).filter((m) => {
      const key = m.ing || m.id;
      // …and no more than MOD_MAX_PER_ORDER promises in the whole breath. A
      // family bucket that arrives with six instructions is not a character
      // moment, it is a wall of text in a speech bubble on a 360px screen.
      if (spoken >= maxPerOrder || spokenFor[key]) return false;
      spokenFor[key] = true;
      spoken++;
      return true;
    });
  }
  return items;
}

/**
 * Decide whether this arrival is a set piece, and which.
 *
 * §SET PIECES — three of them, all RARE and all mechanically real:
 *   'bulk'   a corp buyer. Order size ×BULK_ITEM_MULT, patience and tip to
 *            match. Uses the existing `suit`/`mayor` CUSTOMERS ids rather than
 *            inventing one — kitchen.data.js owns the customer vocabulary and
 *            a fourteenth customer that only this file knows about would be
 *            invisible to the renderer's icon lookup.
 *   'jump'   a raider who takes the front of the queue. Costs everyone behind
 *            JUMP_PATIENCE_COST_MS and costs the player POP_JUMP for allowing
 *            it. `waveCar()` is the answer, and it is not a free answer.
 *   'grudge' / 'favour'
 *            a REGULAR — someone this shift has already dealt with. If you
 *            served them they come back generous; if you lost or waved them
 *            they come back on a short fuse and worth half the tip.
 *
 * ⚠ GATED BEHIND SPECIAL_MIN_LEVEL. A brand-new player who meets a queue-jumper
 * in their first sixty seconds learns "this game is unfair", not "this game has
 * texture". Set pieces are seasoning on a dish you already know the taste of.
 */
function rollSpecial(K, r, level) {
  if (level < EC('SPECIAL_MIN_LEVEL')) return { special: null, custId: null };
  if (r() >= EC('SPECIAL_CHANCE')) return { special: null, custId: null };

  const mem = book(K).mem;
  const regulars = Object.keys(mem).filter((id) => mem[id] && (mem[id].served + mem[id].lost + mem[id].waved) > 0);

  const roll = r();
  if (regulars.length && roll < 0.45) {
    const id = rpick(r, regulars);
    const m = mem[id] || { served: 0, lost: 0, waved: 0 };
    const wronged = (m.lost + m.waved) > m.served;
    return { special: wronged ? 'grudge' : 'favour', custId: id };
  }
  if (roll < 0.75) {
    // The corp buyer. `suit` and `mayor` are the two CUSTOMERS who plausibly
    // buy for other people; either reads correctly on a big ticket.
    return { special: 'bulk', custId: r() < 0.6 ? 'suit' : 'mayor' };
  }
  return { special: 'jump', custId: 'raider' };
}

/**
 * How long this customer will wait, before it is handed to state.js.
 * Base is CUSTOMERS[].patienceMs, then: the vehicle's own tolerance (a patrol
 * car is not idling, a transit bus does not care), PATIENCE_ITEM_MS per item
 * past the first (a four-item order is a bigger JOB, not a broken promise —
 * punishing size would train players to refuse the most profitable tickets),
 * the modifiers, and the set piece.
 */
function patienceFor(cust, carDef, items, mods, special) {
  let ms = _num(cust && cust.patienceMs, EC('TICKET_BASE_MS'));
  ms *= _num(carDef && carDef.patienceMul, 1);

  let units = 0;
  for (const it of items) units += Math.max(1, _int(it.qty));
  ms += EC('PATIENCE_ITEM_MS') * Math.max(0, units - 1);

  for (const m of mods) ms *= _num(m.patienceMult, 1);

  if (special === 'bulk')   ms *= EC('BULK_PATIENCE_MULT');
  if (special === 'grudge') ms *= EC('GRUDGE_PATIENCE_MULT');
  if (special === 'favour') ms *= EC('FAVOUR_PATIENCE_MULT');

  return Math.max(EC('PATIENCE_MIN_MS'), Math.round(ms));
}

/**
 * 🚗 Put a car in the lane.
 *
 * Returns the car, or NULL when the lane is full and `force` is falsy — that
 * null IS the balk, and it is the pressure valve the whole difficulty curve
 * leans on. LANE_CAP is 4 stock and 7 with up_lane2; at the dinner rush the
 * spawner asks for a car every two seconds and the lane simply cannot hold
 * them, so custom is lost. That is the wall CONTRACT/ECON describes, expressed
 * as a queue rather than as a difficulty number.
 */
/* ═══════════════════════════════════════════════════════════════════════════
   §BALK — 🔴 THE BIGGEST THING THAT HAPPENS TO THE BUSINESS, MADE VISIBLE.
   ═══════════════════════════════════════════════════════════════════════════
   Somebody drove up to a full lane and kept driving. A tiny popularity nick,
   not a punishment: a full lane is usually a compliment, and what was lost is
   the sale, not the reputation. This is the pressure valve the whole difficulty
   curve leans on — see the ECON header's hour-by-hour model.

   🔴 IT USED TO BE COMPLETELY SILENT, AND IT IS THE LARGEST NUMBER IN THE FILE.
   One measured twelve-minute day at level 20 / popularity 90 recorded
   BALKED = 74 against ARRIVED = 64. More than half of all drive-thru demand was
   turned away at the mouth of the lane, and `balk()` bumped popularity and
   returned null: no event, no name, no vehicle, nothing on screen and nothing
   said. The player's single biggest lever — lane capacity, and how fast they
   clear the window — was invisible, so it could not be learned and could not be
   felt. A cost the player cannot see is not difficulty, it is a leak.

   So a balk now produces THREE things:
     1. `car:balk` — a real named event {custId, custName, icon, vehicle,
        vehicleIcon, vehicleName, cap, used}. It goes through the same emitter
        as everything else, so a toast, an fx float and a HUD flash all become
        one-liners in the renderer.
     2. A PASSER-BY — a short-lived record in `passersBy()` carrying `pct`
        0→1 across LANE_PASSBY_MS, so the renderer can drive the vehicle across
        the far end of the road and off the far kerb. The lane physically shows
        you the custom you are losing while you are losing it.
     3. The popularity nick, as before.

   ⚠ IT THEREFORE COSTS AN IDENTITY. The old code took the cheap rejection first
   ("no room for even a bike, so no RNG is spent describing a customer who never
   arrives"), which was a sound optimisation for a balk that drew nothing. A
   balk that DRIVES PAST needs a vehicle and a face, so `spawn()` now picks WHO
   and WHAT before it tests occupancy, and only the expensive part (building the
   order and its modifiers) is skipped. One weighted pick per turned-away car,
   a handful of times a minute, is not a cost worth being silent for.
   ═══════════════════════════════════════════════════════════════════════════ */
function balk(K, b, cust, carDef, now, cap) {
  b.stats.balked++;

  const icon = (carDef && carDef.icon) || '🚗';
  const t = _num(now, K.now);
  /* The drive-past record. Underscore-hung on the book, so it is derived and
     never saved (CONTRACT §5), and PRUNED IN tick() rather than here — a lane
     that only tidies up when the next car balks would leave the last drive-past
     of a rush frozen on the tarmac all evening. */
  /* 🔴 §BALK SPACING — A BURST MUST READ AS TRAFFIC, NOT AS ONE SPRITE.
     Measured live at 360px after force-filling the lane and spawning five more:
     five `.mk-passer` nodes, ALL AT x=304, all at opacity 0.7, one on top of
     another — "🚗 Gate Guard drove past", "🚙 Courier drove past", "🚙 Night
     Medic drove past", "🛻 Kid on a BMX drove past", "🚓 Raider drove past" —
     an illegible pile. And balks are the LARGEST number in the business (86
     against 45 arrivals in a measured day), so a burst is the normal case and
     not the edge case.

     The renderer already staggers the vertical band; what it could not do is
     separate cars that all started at the same instant, because `pct` is a pure
     function of elapsed time and they shared one `at`. So the SPACING DATA is
     ours and it is two fields:
       `delay` — a per-car head start, PASSBY_STAGGER_MS × how many drive-pasts
                 are already in flight, so a burst leaves the kerb in single
                 file instead of abreast. `passersBy()` holds a car at pct 0
                 through its delay and `until` is pushed back to match, so
                 nothing is cut short by being late off the line.
       `lane`  — which row of the band this one belongs in, round-robin over
                 PASSBY_LANES, so even two that DO overlap are not collinear.
     Both are data, not pixels: the renderer decides what a row is worth in px. */
  const inFlight = b.passers.filter((p) => t < _num(p.until, 0)).length;
  const delay = inFlight * EC('PASSBY_STAGGER_MS');
  const lanes = Math.max(1, _int(EC('PASSBY_LANES')));
  b.passers.push({
    id: 'p' + (++b.seq),
    custId: cust ? cust.id : null,
    custName: (cust && cust.name) || 'Someone',
    icon: (cust && cust.icon) || '🧑',
    vehicle: (carDef && carDef.id) || 'hatch',
    vehicleIcon: icon,
    vehicleName: (carDef && carDef.name) || 'Vehicle',
    at: t,
    delay,
    lane: b.seq % lanes,
    until: t + delay + EC('LANE_PASSBY_MS'),
  });
  // Ten is plenty for anything a renderer can legibly draw at once, and it
  // bounds the array against a pathological rush against a cap-1 lane.
  if (b.passers.length > 10) b.passers.splice(0, b.passers.length - 10);

  raiseLater(K, 'car:balk', {
    custId: cust ? cust.id : null,
    custName: (cust && cust.name) || 'Someone',
    icon: (cust && cust.icon) || '🧑',
    vehicle: (carDef && carDef.id) || 'hatch',
    vehicleIcon: icon,
    vehicleName: (carDef && carDef.name) || 'Vehicle',
    cap: _int(cap), used: usedUnits(K),
  });
  bumpPop(K, null, EC('POP_BALK'), 'balk');
  K.rev = _int(K.rev) + 1;
  return null;
}

export function spawn(K, now, force) {
  try {
    if (!K) return null;
    const t = _num(now, K.now);
    K.now = t;
    const b = book(K);
    if (!Array.isArray(K.lane)) K.lane = [];

    const cap = capOf(K);
    const r = () => rnd(K);
    const level = Math.max(1, _int(K.level) || 1);

    // WHO
    const pick = rollSpecial(K, r, level);
    const roster = Array.isArray(DATA.CUSTOMERS) ? DATA.CUSTOMERS : [];
    let cust = pick.custId ? customerOf(pick.custId) : null;
    if (!cust) cust = rpick(r, roster);
    const special = pick.special;

    // WHAT THEY ARRIVE IN. Two filters, in this order: WHO IS DRIVING (§RIDES),
    // then what the OCCASION needs — a bulk buyer needs a vehicle that can
    // plausibly carry the order, otherwise the funniest bug in the feature is a
    // corp suit loading forty boxes onto a BMX.
    const cars = Array.isArray(DATA.CARS) ? DATA.CARS : [];
    let pool = ridePool(cars, cust);
    if (special === 'bulk') {
      const big = pool.filter((c) => _int(c.seats) >= 4);
      // ⚠ FALL BACK TO THE WHOLE ROSTER, NOT TO THE PERSONALITY'S OWN LIST. A
      //    courier's bike cannot carry a corp bulk order, so when the two
      //    filters have no intersection the OCCASION wins — a Kid on a BMX
      //    never places a bulk order anyway (`rollSpecial` only ever picks
      //    `suit` or `mayor` for it), so this is the rare-set-piece path.
      pool = big.length ? big : (cars.filter((c) => _int(c.seats) >= 4) || pool);
    } else if (special === 'jump') {
      const fast = pool.filter((c) => _num(c.patienceMul, 1) <= 0.9);
      if (fast.length) pool = fast;
    }
    // §RIDE SKINS — paint only, after the pick, so the RNG stream is untouched
    // and `balk()` below (which reads `carDef.icon` for the drive-past) gets the
    // same repaint the arrival would have got.
    const carDef = skinRide(rweight(r, pool, 'weight') || rpick(r, cars)
      || { id: 'hatch', icon: '🚗', name: 'Hatchback', seats: 2, patienceMul: 1, len: 1 }, cust);

    /* 🔴 THE ONE OCCUPANCY TEST, AND IT IS HERE BECAUSE IT NEEDS THE VEHICLE.
       A road train needs two lengths of lane and will drive past a gap that a
       hatchback would have taken — so the cap is measured in LENGTH UNITS and
       cannot be tested until we know what turned up. §BALK explains why the old
       cheap pre-test (before anybody was picked) had to go: a balk that draws a
       vehicle crossing the road needs to know which vehicle. */
    if (!force && usedUnits(K) + Math.max(1, _int(carDef.len) || 1) > cap) {
      return balk(K, b, cust, carDef, t, cap);
    }

    // WHAT THEY WANT
    const items = buildOrder(r, cust, carDef, level, special);
    if (!items.length) return null;   // menu empty (level 0 data) — no ghost cars
    const mods = [];
    for (const it of items) for (const m of (it.mods || [])) mods.push(m);

    b.seq++;
    const id = 'L' + b.seq;
    const carId = 'car' + b.seq + '_' + (_int(K._seq) + b.seq);   // globally unique vs state's dish/ticket ids

    const car = {
      id,
      carId,                                    // 🔴 ticket.carId joins on THIS
      custId: cust ? cust.id : null,
      name: (cust && cust.name) || 'Survivor',
      icon: (cust && cust.icon) || '🧑',
      vehicle: carDef.id,
      vehicleIcon: carDef.icon || '🚗',
      vehicleName: carDef.name || 'Vehicle',
      len: Math.max(1, _int(carDef.len) || 1),

      ticketId: null,
      items,                                    // [{recipeId, qty, mods:[…]}]
      mods,                                     // flattened, for the speaker line
      special: special || null,

      arrivedAt: t,
      orderedAt: 0,
      expiresAt: 0,                             // set when the ticket is filed
      patienceMs: 0,                            // ditto — see §DEADLINE
      balkAt: t + EC('LANE_BALK_MS'),    // patience BEFORE ordering

      // Geometry. pos 0 is the WINDOW, LANE_LEN is the mouth of the lane, and a
      // car spawns past that so it drives on screen instead of appearing.
      pos: EC('LANE_ENTRY_POS') * EC('LANE_LEN'),
      slot: 99,                                 // reassigned by compact() below
      target: EC('LANE_ENTRY_POS'),       // slot position, from compact()
      _stop: EC('LANE_ENTRY_POS'),        // where the car AHEAD lets it get to
      station: 'speaker',                       // speaker | queue | window

      state: 'rolling',                         // CONTRACT's four
      phase: 'approach',                        // finer: approach|order|wait|collect|exit
      mood: 'ok',
      say: '',
      sayUntil: 0,
      nagAt: 0,
      leftAt: 0,
      reason: '',

      /* ⚠ CACHED ROWS, AND THIS IS NOT A HACK. `patienceFor()` and
         `speakerLine()` run inside the tick; a table scan of CUSTOMERS and CARS
         per car per frame at the dinner rush is real work for nothing. More
         importantly they must be the SAME rows this arrival was GENERATED
         against — a level-up mid-shift changes `menuForLevel`, and a customer
         whose personality was re-resolved from a changed table halfway through
         their order would silently get a different patience than the one their
         ticket was priced with. Underscore-prefixed = derived, never saved
         (CONTRACT §5; `K.lane` is not in the saved subset at all). */
      _cust: cust || null,
      _carDef: carDef,
      _speaker: voiceFor(cust ? cust.id : null, 'speaker', special, r),
    };

    K.lane.push(car);
    compact(K, t);

    /* §SET PIECE — THE QUEUE JUMP, and it is not cosmetic. The raider is put at
       slot 0 and everyone else is pushed back one, which costs each of them
       real patience off a deadline that is already running. The player pays
       POP_JUMP for letting it happen, and `waveCar()` is the alternative — also
       not free. Two bad options is a decision; one bad option is a cutscene. */
    if (special === 'jump') {
      /* ⚠ AND IF THERE WAS NO QUEUE TO CUT, THEY ARE NOT A QUEUE-JUMPER.
         `jumpQueue()` refuses on an empty lane, or on one holding nothing but
         the car at the window (you cannot barge past somebody mid-transaction —
         see its comment). Leaving `special:'jump'` set anyway would have the
         raider pull up to an EMPTY drive-thru and announce "The line moved. I
         moved it." to nobody, and would charge the player POP_JUMP for a queue
         that did not exist. So the set piece is demoted back to an ordinary
         arrival and the opener is re-rolled in their own voice. */
      if (!jumpQueue(K, car, t)) {
        car.special = null;
        car._speaker = voiceFor(car.custId, 'speaker', null, r);
      }
    }

    b.stats.arrived++;
    K.rev = _int(K.rev) + 1;
    raiseLater(K, 'car:arrive', {
      carId, custId: car.custId, custName: car.name, icon: car.icon,
      vehicle: car.vehicle, special: car.special, slot: car.slot,
    });
    return car;
  } catch (e) {
    return null;   // rule 2: never throw. A missed arrival is survivable.
  }
}

/**
 * The raider cuts in. Everyone already in the lane shuffles back one place and
 * loses JUMP_PATIENCE_COST_MS off whatever deadline they are on — the ticket's
 * `dueAt` for those who have ordered, the balk clock for those who have not.
 *
 * 🔴 IT MOVES `ticket.dueAt`, WHICH IS THE SHARED DEADLINE (§DEADLINE). That is
 * the whole reason it is a real mechanic instead of a caption: the ticket board
 * countdown visibly jumps for three other customers the instant the raider cuts
 * in, and the player can see exactly what it cost them.
 */
function jumpQueue(K, jumper, now) {
  const cost = EC('JUMP_PATIENCE_COST_MS');
  // → boolean: did a cut-in actually happen? spawn() demotes the set piece when
  //   it did not, so nobody announces a queue jump to an empty lane.

  /* 🔴 THEY CUT IN BEHIND THE WINDOW CAR, NOT IN FRONT OF IT.
     The first version put the raider at slot 0 outright and teleported them to
     mid-lane, which meant a raider could materialise IN FRONT OF — and, on
     screen, straight through — a car that was already at the window collecting
     its food. A raider can bully a queue; they cannot drive through a
     stationary vehicle. So the head car keeps the window (they are mid-
     transaction and physically in the way) and the raider takes the place
     immediately behind them, which is still the front of the QUEUE and still
     ahead of everybody who was waiting properly. */
  const others = K.lane.filter((c) => c && c !== jumper);
  if (others.length < 2) return false;   // no queue behind the window car to cut
  others.sort((a, b2) => _num(a.arrivedAt, 0) - _num(b2.arrivedAt, 0));
  const head = others[0];

  for (const c of others) {
    if (c === head || c.state === 'gone') continue;
    if (c.ticketId) {
      const tk = ticketOf(K, c.ticketId);
      if (tk) { tk.dueAt = _num(tk.dueAt, now) - cost; c.expiresAt = tk.dueAt; }
    } else {
      c.balkAt = _num(c.balkAt, now) - cost;
    }
    c.mood = 'furious';
  }

  /* Insert into the FIFO by giving the jumper an arrival time strictly between
     the head car's and the next one's. `compact()` sorts on `arrivedAt` and
     nothing else, so this is the honest way to splice into the order without
     inventing a second sort key that every other call site would have to know
     about. Fractional ms is safe: real arrivals are whole milliseconds seconds
     apart, so there is nothing to collide with. */
  jumper.arrivedAt = _num(head.arrivedAt, now) + 0.5;
  compact(K, now);
  book(K).stats.jumped++;
  bumpPop(K, null, EC('POP_JUMP'), 'queue-jump');
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §DEADLINE — 🔴 ONE CLOCK PER CUSTOMER. THE MOST IMPORTANT COMMENT HERE.
   ═══════════════════════════════════════════════════════════════════════════
   There are two obvious places to store "how long until this customer gives
   up": on the car (this file) and on the ticket (`ticket.dueAt`, state.js).
   Storing it in both is the bug this file was most likely to ship, and it fails
   in a way that is invisible in review and infuriating in play — the countdown
   bar on the ticket board runs out while the car still looks patient, or the
   car drives off with eleven seconds visibly left on its own order.

   So there is ONE number: `ticket.dueAt`. The car's `expiresAt` is a MIRROR of
   it, re-read every frame, never independently advanced.

   Getting state.js to agree required arithmetic rather than a wish.
   `State.newTicket()` computes:
       dueAt = placedAt + max(PATIENCE_MIN_MS,
                              (TICKET_BASE_MS + TICKET_ITEM_MS × units)
                              × opts.patienceMul × patienceMul(upgrades))
   and `opts.patienceMul` is ours to choose. So we compute the patience we want
   from the customer, the vehicle, the order size, the modifiers and the set
   piece, then SOLVE for the multiplier that makes state.js produce exactly that
   number. If the PATIENCE_MIN_MS floor bites, state.js's answer wins and we
   adopt it — the ticket is the record, the car is the picture of the record.

   ⚠ This is also why `patienceFor()` folds in PATIENCE_ITEM_MS itself and then
   divides state.js's per-item term back out. It looks redundant. It is not:
   the customer's own patience has to scale with the order BEFORE the vehicle
   and the modifiers multiply it, and state.js applies its per-item term after
   everything. Doing it in one place would price a five-item family order
   differently depending on which file you asked.
   ═══════════════════════════════════════════════════════════════════════════ */

function ticketOf(K, id) {
  if (!id || !Array.isArray(K.tickets)) return null;
  return K.tickets.find((x) => x && x.id === id) || null;
}

/**
 * The ticket belonging to a car — INCLUDING the `{carId}` STUB.
 *
 * ⚠ WHY THE SECOND LOOKUP EXISTS. `State.serveTicket()` calls our `tipFor()`
 * as `tipFor(K, car || { carId: ticket.carId }, avgQ, now)` — when the car has
 * already been released from the lane it passes a stub with nothing on it but
 * an id, and §MODIFIERS has to read the ticket's per-line mods to score them.
 * Searching `K.tickets` by `carId` recovers it, and it is the only reason the
 * modifier check works on the released-car path at all.
 */
function ticketFor(K, car) {
  if (!K || !car) return null;
  if (car.ticketId) {
    const direct = ticketOf(K, car.ticketId);
    if (direct) return direct;
  }
  const cid = car.carId || car.id;
  if (!cid || !Array.isArray(K.tickets)) return null;
  return K.tickets.find((x) => x && x.carId === cid) || null;
}

/** Solve for the `patienceMul` that makes state.js's dueSpanFor() land on `wantMs`. */
function solvePatienceMul(K, items, wantMs) {
  let units = 0;
  for (const it of items) units += Math.max(1, _int(it.qty));
  const base = EC('TICKET_BASE_MS') + EC('TICKET_ITEM_MS') * units;
  const upFn = DF('patienceMul');
  const up = Math.max(0.01, _num(upFn ? upFn(K.upgrades) : 1, 1));
  const denom = Math.max(1, base * up);
  return Math.max(0.05, wantMs / denom);
}

/**
 * File the car's order with the order board.
 *
 * Goes through `State.newTicket()` — which kitchen.state.js exports with the
 * comment "Exported because drivethru.js needs to create the ticket it links a
 * car to, and two implementations of what an order looks like is how the board
 * ends up with two different due-time formulas." Exactly so. The local branch
 * below is ONLY for a headless harness driving a fake `K`, where calling into
 * the real singleton would file the ticket onto the wrong kitchen.
 */
function fileTicket(K, car, now) {
  const wantMs = patienceFor(car._cust, car._carDef, car.items, car.mods, car.special);
  const mul = solvePatienceMul(K, car.items, wantMs);
  const opts = {
    now,
    source: 'drive',
    carId: car.carId,
    custId: car.custId,
    name: car.name,
    icon: car.icon,
    line: speakerLine(car),
    items: car.items.map((it) => ({ recipeId: it.recipeId, qty: it.qty })),
    patienceMul: mul,
  };

  let ticket = null;
  try {
    if (typeof State.newTicket === 'function' && State.Kitchen === K) {
      ticket = State.newTicket(K, opts);
    }
  } catch (e) { ticket = null; }

  if (!ticket) {
    // Fake-`K` / degraded path. Minimal but SHAPED THE SAME, so everything
    // downstream (render, expiry, serveTicket) behaves identically.
    if (!Array.isArray(K.tickets)) K.tickets = [];
    K._seq = _int(K._seq) + 1;
    ticket = {
      id: 'k' + K._seq, source: 'drive', carId: car.carId, custId: car.custId,
      name: car.name, icon: car.icon, line: opts.line,
      items: opts.items.map((it) => ({ recipeId: it.recipeId, qty: it.qty, filled: 0, qsum: 0, xn: 0, pn: 0 })),
      placedAt: now, dueAt: now + wantMs, state: 'open', paid: 0, tip: 0,
    };
    K.tickets.push(ticket);
    K.rev = _int(K.rev) + 1;
  }

  /* 🔴 MODS RIDE ON THE TICKET, ATTACHED AFTER FILING. `newTicket` rebuilds each
     item as {recipeId, qty, filled, qsum, xn, pn} and drops anything else on the
     way in, so passing mods through `opts.items` would silently lose them. The
     ticket OBJECT is ours to decorate once it exists, and this is the field the
     renderer draws under each line and §MODIFIERS judges at the window.

     🔴 MATCHED BY recipeId, NOT BY INDEX. `newTicket()` FILTERS its items —
     `.filter((it) => recipeOf(it.recipeId))` — so one unknown recipe shifts
     every later line by one and silently hangs "no onions" on somebody else's
     milkshake. Nobody would ever see it in review and the player would conclude
     the tickets are random. Walking the ticket's lines and consuming the first
     unconsumed car line with the same recipeId is index-shift-proof and is the
     same order in the common case. */
  try {
    ticket.mods = car.mods.slice();
    const taken = new Array(car.items.length).fill(false);
    for (const line of ticket.items) {
      for (let i = 0; i < car.items.length; i++) {
        const src = car.items[i];
        if (taken[i] || !src || src.recipeId !== line.recipeId) continue;
        taken[i] = true;
        if (Array.isArray(src.mods) && src.mods.length) line.mods = src.mods.slice();
        break;
      }
    }
    ticket.special = car.special || null;
  } catch (e) { /* a decorated ticket is a nicety; a filed ticket is the point */ }

  return ticket;
}

/* ═══════════════════════════════════════════════════════════════════════════
   POPULARITY — only the two movements state.js has no path for.
   ═══════════════════════════════════════════════════════════════════════════
   state.js owns POP_SERVE (served), POP_LOST (a lost ticket) and POP_BURN. It
   applies POP_LOST inside `loseTicket()`, which is the ONLY place a walked-out
   drive customer may be charged — see `giveUp()` for how we route into it
   rather than double-charging.

   The two movements with no state.js path are the ones that produce no lost
   TICKET at all: a car that balked at a full lane, and a car the player waved
   off. Both are charged here, clamped, and announced with `pop:change` so the
   HUD meter animates the same way it does for everything else.
   ═══════════════════════════════════════════════════════════════════════════ */
function bumpPop(K, out, delta, why) {
  const d = _num(delta, 0);
  if (!d) return;
  const lo = EC('POP_MIN'), hi = EC('POP_MAX');
  const before = _clamp(_num(K.popularity, 50), lo, hi);
  const after = _clamp(before + d, lo, hi);
  if (Math.abs(after - before) < 0.0001) return;
  K.popularity = after;
  raise(K, out, 'pop:change', { from: before, to: after, delta: after - before, why: why || 'lane' });
}

/* ═══════════════════════════════════════════════════════════════════════════
   ⏱ TICK — spawn, advance, expire. Called by kitchen.state.js step 3.
   ═══════════════════════════════════════════════════════════════════════════
   NEVER SCHEDULES ANYTHING. `dt` and `now` arrive from the one RAF loop; this
   function is a pure advance over them, which is what lets `arrivalPlan()` and
   a fake-dt harness replay a whole dinner rush in a few milliseconds.

   Order inside the tick, and it matters:
     1. reap cars that have finished leaving      (frees the window)
     2. compact the queue                          (everyone pulls forward)
     3. advance each car                           (roll, order, wait, give up)
     4. schedule + spawn the next arrival          (after 1–3, so a car that
                                                    just left has already freed
                                                    its slot this frame)
   Doing 4 before 1 would make the lane feel one frame stickier than it is at
   exactly the moment the player is watching it hardest.
   ═══════════════════════════════════════════════════════════════════════════ */
export function tick(K, dt, now) {
  const out = [];
  try {
    if (!K) return out;
    const t = _num(now, _num(K.now, 0));
    const step = _clamp(_num(dt, 16), 0, EC('MAX_DT_MS'));
    if (!Array.isArray(K.lane)) K.lane = [];
    const b = book(K);

    /* 0. SETTLE — §SETTLE. Book any car that finished OUTSIDE one of our verbs
       (the renderer serving through `State.serveTicket()`, or state.js's own
       expiry backstop) before anything else can reap it out from under us. This
       runs first for exactly that reason: step 1 deletes cars, and a car
       deleted before it was booked is a sale the ledger never heard about. */
    settleGone(K, t);

    // 1. REAP. A car in 'exit' still occupies its slot — that IS the blocking.
    const exitMs = EC('LANE_EXIT_MS');
    if (K.lane.length) {
      const keep = K.lane.filter((c) => !(c && c.state === 'gone' && t - _num(c.leftAt, t) >= exitMs));
      if (keep.length !== K.lane.length) { K.lane = keep; K.rev = _int(K.rev) + 1; }
    }

    // 2. COMPACT — FIFO slots, gone-but-not-reaped cars included.
    compact(K, t);

    // 3a. ROLL — one front-to-back pass, so nobody drives through anybody.
    //     …then re-read WHERE everyone ended up (see `stations()`): a car that
    //     moved this frame may have reached the speaker or cleared the window,
    //     and `advanceCar()` below is about to ask.
    roll(K, step);
    stations(K);

    // 3b. ADVANCE — phases, dialogue, patience.
    for (const car of Array.from(K.lane)) {
      if (!car) continue;
      advanceCar(K, car, step, t, out);
    }

    // 3c. PRUNE DRIVE-PASTS (§BALK). Done here rather than in `balk()` so the
    //     last turned-away car of a rush does not sit frozen on the tarmac
    //     until the next one balks.
    if (b.passers.length) {
      const keep = b.passers.filter((p) => t < _num(p.until, 0));
      if (keep.length !== b.passers.length) { b.passers = keep; K.rev = _int(K.rev) + 1; }
    }

    // 4. ARRIVALS
    if (K.shift && K.shift.running) scheduleArrivals(K, t, out);

    /* 5. RE-SETTLE, zero-dt. A spawn (and especially a queue-jump splicing a
       raider into the middle of the order) rewrites the queue AFTER roll() has
       already run for this frame, so for one frame the lane could hold a car
       whose `pos` overlapped its neighbour — and render paints after tick, so
       that one frame is a frame the player can actually see. A zero-step roll
       moves nobody and re-applies the non-overlap clamp, which makes the
       invariant true on EVERY frame render is handed rather than on most. */
    roll(K, 0);
    stations(K);

    // Drain anything the steps above raised through the buffered path (a
    // fake-`K` harness). Done LAST so a car that spawned this frame reports it
    // this frame rather than one frame late.
    if (b.pending.length) { for (const e of b.pending) out.push(e); b.pending.length = 0; }

    return out;
  } catch (e) {
    return out;   // rule 2. The lane going quiet beats the ovens stopping.
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   🗺 §GEOGRAPHY — THE PICTURE AND THE STATE MACHINE NOW AGREE.
   ═══════════════════════════════════════════════════════════════════════════
   The lane runs RIGHT TO LEFT in sim coordinates: `pos` 0 is the WINDOW, `pos`
   LANE_LEN is the MOUTH, and a car spawns past the mouth at LANE_ENTRY_POS so
   it drives on screen. Render draws two fixtures against that — 🔊 ORDER HERE
   at the mouth and 🪟 WINDOW at pos 0 — and the brief's four beats are
   ORDER → PAY → WAIT → COLLECT.

   🔴 ROUND 2 FIXED THE PICTURE AND LEFT THE STATE MACHINE ALONE, so the two
   disagreed in a way the player could read. `station` was a SLOT LOOKUP
   (`i === 0 ? 'window' : last ? 'speaker' : 'queue'`) and the order phase was
   gated on nothing but "have I stopped moving" — so on an empty lane the only
   car in it was slot 0, rolled all the way to the hatch, and ANNOUNCED ITS
   ORDER THERE, while the pinned card printed "At the window" over the top of
   it. Instrumented over one day at level 20, order-phase frames by position:
   {1.00:737, 0.75:334, 0.25:137, 0.50:16, 0.00:24}. Forty-two per cent of all
   ordering happened away from the sign the game had just drawn.

   THREE CHANGES, AND THEY ONLY WORK TOGETHER:
     1. `compact()` clamps the TARGET of any car that has not ordered to
        LANE_SPEAKER_POS. You cannot drive past the speaker before you speak.
     2. `stations()` derives `station` from `pos` instead of from slot index,
        after `roll()`, so the word on the card is the place the car is.
     3. `advanceCar()` gates the order phase on reaching its own `target` — not
        on "came to rest", which was true for a car merely BLOCKED out on the
        road — and on `station === 'speaker'`.
   Measured after, same instrument, five seeds: {speaker: 5160} and nothing
   else, at pos 1.00 exactly.

   ⚠ THE THROUGHPUT COST, MEASURED RATHER THAN ASSUMED. Serialising the speaker
   means one car orders at a time. Over six seeded 720s days at level 20 with an
   assembling auto-cook: 784 arrived, 512 served, 232 lost, 1182 balked — a 65%
   finish rate against the 32% the pre-change lane measured. It did not cost
   throughput; the pull-up beat is short (LANE_ORDER_MS) against a spawn
   interval measured in whole seconds, and cars now clear the window faster
   because they are not sitting at it deciding.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Assign FIFO slots and where each car is ENTITLED to stop.
 *
 * 🔴 GONE CARS KEEP THEIR SLOT until `LANE_EXIT_MS` has elapsed. That single
 * line is the "cars block each other" mechanic: a car you served slowly still
 * holds the window while three more people behind it burn their deadlines. Skip
 * it and the lane is a list with a countdown, which is what we were asked not
 * to build.
 */
function compact(K, now) {
  const cars = K.lane.filter(Boolean).sort((a, b2) => _num(a.arrivedAt, 0) - _num(b2.arrivedAt, 0));
  const cap = capOf(K);
  const laneLen = EC('LANE_LEN');
  const unit = laneLen / Math.max(1, cap - 1);
  const speaker = speakerPos();

  /* 🔴 SLOTS ARE MEASURED IN LENGTH UNITS, NOT IN CARS. CARS[] ships a `len`
     (a rig and a transit bus are 2, everything else is 1) and an earlier draft
     ignored it, which made `len` a decorative field and made a road train
     occupy exactly as much lane as a BMX. Accumulating length instead means a
     rig genuinely holds up more of the queue — free character out of a column
     the data file already authored — and it is why `spawn()` measures the cap
     in units too, so a bus arriving at a nearly-full lane drives past when a
     bike would have fitted. */
  let used = 0;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (c.slot !== i) { c.slot = i; K.rev = _int(K.rev) + 1; }
    const slotPos = used * unit;
    /* 🔴 §GEOGRAPHY — YOU MAY NOT DRIVE PAST THE SPEAKER BEFORE YOU HAVE
       ORDERED. One `Math.max` and it is the whole fix for a bug the round-2
       critic measured directly: order-phase frames by position came out
       {1.00:737, 0.75:334, 0.25:137, 0.50:16, 0.00:24}, i.e. twenty-four frames
       of a customer announcing their order while parked at the PICKUP HATCH,
       and 42% of all ordering happening somewhere other than the sign. The
       PICTURE had already been fixed — render draws 🔊 ORDER HERE at the mouth
       and 🪟 WINDOW at pos 0 — but the state machine still let a car enter its
       `order` phase from whichever slot it happened to stop in, which on an
       empty lane is slot 0, the window.

       Clamping the TARGET rather than gating the phase is what makes the two
       agree instead of merely disagreeing more quietly: an arrival now comes to
       rest AT the sign, speaks there, and only then rolls up to its slot. On an
       empty lane that is a visible pull-up-and-order beat where there used to
       be a car sliding silently to the hatch; in a full lane the rear slot IS
       the sign, so nothing about the queue picture changes.

       ⚠ CARS BEHIND AN ORDERING CAR CAN BE PUSHED PAST THE LANE MOUTH, and
       that is the honest simulation rather than a defect — `roll()`'s
       non-overlap floor puts them out on the road, `carX()` clips them behind
       the sign, and their BALK CLOCK is running the whole time. Ordering takes
       LANE_ORDER_MS (2.4s) against a spawn interval measured in whole seconds,
       so it is a transient; when it is not a transient, the lane is genuinely
       jammed and POP_JAM is the correct thing to be charging for it. */
    c.target = (!c.ticketId && c.state !== 'gone') ? Math.max(slotPos, speaker) : slotPos;
    used += Math.max(1, _int(c.len) || 1);
  }
  K.lane = cars;
  stations(K);
}

/** The speaker box, in lane units from the window. See §GEOGRAPHY. */
function speakerPos() {
  return _clamp(EC('LANE_SPEAKER_POS'), 0, 1) * EC('LANE_LEN');
}

/**
 * WHERE EACH CAR PHYSICALLY IS — derived from `pos`, not from slot index.
 *
 * 🔴 THIS USED TO BE A SLOT LOOKUP AND IT LIED. `station` was
 * `i === 0 ? 'window' : (last ? 'speaker' : 'queue')`, so the rear car of a
 * TWO-car lane was reported "At the speaker" while sitting a third of the way
 * down the tarmac, and the only car in an empty lane was reported "At the
 * window" while it was still rolling in. The renderer prints that string to the
 * player on the pinned card (STATION_WORD), so it was a caption contradicting
 * the picture beside it. Position is the only thing that can answer the
 * question, so position answers it.
 *
 * Called at the end of `compact()` for the initial placement and again after
 * `roll()` each frame, because a car that MOVED this frame may have changed
 * which fixture it is standing at.
 */
function stations(K) {
  const speaker = speakerPos();
  const unit = EC('LANE_LEN') / Math.max(1, capOf(K) - 1);
  const windowPos = unit * 0.5;          // "at the hatch", not "exactly on zero"
  for (const c of (K.lane || [])) {
    if (!c) continue;
    const at = c.pos <= windowPos ? 'window' : (c.pos >= speaker - POS_EPS ? 'speaker' : 'queue');
    if (c.station !== at) { c.station = at; K.rev = _int(K.rev) + 1; }
  }
}

/* Tolerance for "has this car come to rest". One frame of roll at 60fps is
   LANE_ROLL_UNITS_S/60 ≈ 0.009 lane units, so anything at or below that reads
   as arrived rather than as still moving. */
const POS_EPS = 0.02;

/** Lane occupancy in LENGTH UNITS, gone-but-not-yet-reaped cars included —
    a car still clearing the window is still in the way. */
function usedUnits(K) {
  let n = 0;
  for (const c of (K.lane || [])) if (c) n += Math.max(1, _int(c.len) || 1);
  return n;
}

/**
 * 🔴 MOVEMENT IS ONE FRONT-TO-BACK PASS, NOT A PER-CAR UPDATE.
 *
 * The obvious implementation eases every car toward its own slot position
 * independently, and it produces the single worst-looking bug this file can
 * have: the lane fills faster than cars can roll, a car spawning at the mouth
 * eases toward slot 3 while the car in slot 0 is still crawling in from slot 2,
 * and they DRIVE THROUGH EACH OTHER. On a 360px screen that is unmissable.
 *
 * So each car's real stopping point (`_stop`) is the FURTHER FORWARD of its own
 * slot position and "one car-length behind whoever is in front of me, using the
 * position that car has ALREADY been moved to this frame". Front to back, in
 * slot order, which is why `compact()` has to run first.
 *
 * `len` comes from CARS[] — a rig and a transit bus take two lengths, so they
 * genuinely hold up more of the lane than a bike does. That is free character
 * out of a field the data file already ships.
 */
function roll(K, dt) {
  const step = EC('LANE_ROLL_UNITS_S') * (dt / 1000);
  const laneLen = EC('LANE_LEN');
  const cap = capOf(K);
  const unit = laneLen / Math.max(1, cap - 1);   // one slot's worth of lane
  const exitPos = -0.35 * laneLen;

  let aheadPos = -Infinity, aheadLen = 0;
  for (const car of K.lane) {
    if (!car) continue;

    let stop;
    if (car.state === 'gone') {
      /* 🔴 ONLY THE HEAD OF THE QUEUE MAY DRIVE OUT.
         The first version of this sent every leaving car to `exitPos`, which is
         past the window — so a customer who gave up in slot 2 DROVE FORWARD
         THROUGH the two cars ahead of them. A harness counting "is pos
         non-decreasing front to back" caught it 619 times in one rush; on
         screen it is two vehicles occupying the same six pixels, which is the
         single most obvious way to tell a player the lane is fake.

         Rejected fix: reverse them out of the lane instead. It solves the cars
         in front and creates the identical problem with the cars behind.

         So a leaving car that is not at the head STAYS EXACTLY WHERE IT IS for
         LANE_EXIT_MS and is then reaped. That is also the honest simulation —
         you cannot drive out of the middle of a drive-thru — and it means
         losing a mid-queue customer really does cost the whole queue the time,
         which is precisely the pressure the lane is for. `exitDir` tells the
         renderer which of the two it is drawing: 'forward' translates out past
         the window, 'aside' veers onto the shoulder and fades where it sits. */
      const atHead = aheadPos === -Infinity;
      car.exitDir = atHead ? 'forward' : 'aside';
      stop = atHead ? exitPos : car.pos;
    } else {
      const gap = aheadPos === -Infinity ? -Infinity : aheadPos + unit * Math.max(1, aheadLen);
      stop = Math.max(_num(car.target, car.pos), gap);
    }
    car._stop = stop;

    if (car.pos > stop) car.pos = Math.max(stop, car.pos - step);
    else if (car.pos < stop) car.pos = Math.min(stop, car.pos + step);

    /* 🔴 THE HARD NON-OVERLAP INVARIANT, ENFORCED RATHER THAN RELIED UPON.
       Easing toward a stopping point is enough right up until something ELSE
       writes `pos` or reorders the queue — a queue-jump splicing a raider in,
       a mid-lane customer giving up, a cap change from an upgrade bought
       mid-shift. Each of those was a separate overlap bug, and each was fixed
       at the producer, and then a fourth one appeared. Clamping HERE makes
       two cars occupying the same stretch of tarmac unrepresentable, whatever
       any producer does. Cars shuffle back instantly when they have to and
       ease the rest of the time, which is also how a real queue absorbs
       somebody barging in. */
    if (aheadPos !== -Infinity) {
      const floor = aheadPos + unit * Math.max(1, aheadLen);
      if (car.pos < floor) car.pos = floor;
    }

    aheadPos = car.pos;
    aheadLen = Math.max(1, _int(car.len) || 1);
  }
}

/**
 * One car, one frame.
 *
 * The phases in order: `approach` (rolling in from off screen), `order` (at the
 * speaker, saying what they want), `wait` (ticket on the board, deadline
 * running), `collect` (their food is ready and they are at or near the window),
 * `exit` (served or gone, still physically clearing the lane).
 *
 * `car.state` stays inside the CONTRACT's four values — 'rolling' | 'ordering'
 * | 'waiting' | 'gone' — because kitchen.state.js tests `state !== 'gone'` for
 * the closing bell and the renderer was specified against that set. `phase` and
 * `station` are the finer detail, added rather than substituted, so a renderer
 * that only understands `state` still draws a correct lane.
 */
function advanceCar(K, car, dt, now, out) {
  // §READABILITY. Before anything else, and before the 'gone' bail: a compound
  // utterance is spoken one bubble-sized beat at a time and an exiting car has
  // to be allowed to finish its sentence.
  drainSay(K, car, now);
  if (car.state === 'gone') { car.phase = 'exit'; return; }

  // ── mood, for the face over the car. Cheap, every frame, read by render. ──
  const pct = patiencePct(car, now);
  const mood = pct <= EC('LANE_MOOD_ANGRY') ? 'furious'
             : pct <= EC('LANE_MOOD_TESTY') ? 'testy'
             : (car.special === 'favour' ? 'happy' : 'ok');
  if (mood !== car.mood) { car.mood = mood; K.rev = _int(K.rev) + 1; }

  // ── APPROACH → ORDER. They order once they have physically reached the
  //    back of the queue, which is where the speaker box is. ─────────────────
  if (car.phase === 'approach') {
    /* 🔴 §GEOGRAPHY — THEY ORDER AT THE SPEAKER, AND NOWHERE ELSE.
       The test is `pos <= target`, not `pos <= _stop`, and the difference is
       the entire fix. `_stop` is "wherever the car in front let me get to", so
       a car blocked out on the road counted as PARKED and ordered from the
       street — one of the two ways round 2 ended up with 42% of ordering
       happening away from the sign. `target` is where this car is ENTITLED to
       be, and `compact()` now clamps that to the speaker for anybody who has
       not ordered (see §GEOGRAPHY there). So reaching `target` means one thing
       only: I am at the sign, at rest, and it is my turn to speak.

       `station === 'speaker'` is asserted alongside rather than instead of it,
       because `station` is derived from raw `pos` and would also be true for a
       car sitting FURTHER BACK than the sign — which is exactly the blocked car
       we are refusing. Both must hold. */
    const atTarget = car.pos <= _num(car.target, car.pos) + POS_EPS;
    const atSpeaker = car.station === 'speaker';
    if (atTarget && atSpeaker) {
      car.phase = 'order';
      car.state = 'ordering';
      car.orderStartedAt = now;
      say(K, car, speakerSegments(car), EC('LANE_ORDER_MS') + 1200);
      K.rev = _int(K.rev) + 1;
    } else if (now >= _num(car.balkAt, Infinity)) {
      // Jammed at the mouth of the lane and never got to speak. Their fault?
      // No — ours. POP_JAM is nearly four times POP_BALK for exactly that.
      giveUp(K, car, 'jammed', now, out);
    }
    return;
  }

  // ── ORDER → WAIT. The ticket is filed and the shared deadline starts. ─────
  if (car.phase === 'order') {
    if (now - _num(car.orderStartedAt, now) < EC('LANE_ORDER_MS')) return;
    const ticket = fileTicket(K, car, now);
    if (!ticket) { giveUp(K, car, 'nomenu', now, out); return; }
    car.ticketId = ticket.id;
    car.orderedAt = now;
    car.expiresAt = _num(ticket.dueAt, now);          // §DEADLINE — a MIRROR
    car.patienceMs = Math.max(1, car.expiresAt - _num(ticket.placedAt, now));
    car.phase = 'wait';
    car.state = 'waiting';
    K.rev = _int(K.rev) + 1;
    raise(K, out, 'car:order', {
      carId: car.carId, ticketId: ticket.id, custId: car.custId,
      items: car.items.map((it) => it.recipeId),
      mods: car.mods.map((m) => m.label), special: car.special,
    });
    return;
  }

  // ── WAIT / COLLECT. ───────────────────────────────────────────────────────
  const ticket = ticketOf(K, car.ticketId);
  if (!ticket) {
    // The board no longer has this order. state.js reaped it (a timeout it
    // owned) or something removed it. Either way the customer is finished here
    // and must not sit in the lane forever blocking the window.
    giveUp(K, car, 'noticket', now, out, true);
    return;
  }

  // Re-mirror the deadline EVERY FRAME. A queue jump, or anything else that
  // moves `dueAt`, must be visible on the car in the same frame it happens.
  car.expiresAt = _num(ticket.dueAt, car.expiresAt);

  if (ticket.state === 'ready' && car.phase !== 'collect') {
    car.phase = 'collect';
    say(K, car, pickLine(K, car, moodKey(car)), 2600);
    K.rev = _int(K.rev) + 1;
  }

  /* THE WINDOW NAG, AND IT ESCALATES.
     Once they are past testy they start saying so, spaced so a waiting customer
     TALKS rather than shouts every frame — but the gap SHORTENS when the mood
     drops to furious, and the pool it draws from is a different pool (see the
     VOICE header). A fixed interval over one shared pool is what made the last
     ten seconds of a doomed order read exactly like the first ten, and what had
     the Mayor's Aide say the same sentence eighteen times in one shift. */
  if (pct < EC('LANE_MOOD_TESTY') && now >= _num(car.nagAt, 0)) {
    const furious = car.mood === 'furious';
    car.nagAt = now + (furious ? EC('LANE_NAG_ANGRY_MS') : EC('LANE_NAG_MS'));
    say(K, car, pickLine(K, car, furious ? 'furious' : 'testy'), 3200);
  }

  if (now >= _num(car.expiresAt, Infinity)) giveUp(K, car, 'impatient', now, out);
}

/* ════════════════════════════════════════════════════════════════════════════
   💬 §READABILITY — THE LANE'S WRITING, MEASURED AGAINST THE BOX IT LANDS IN.
   ════════════════════════════════════════════════════════════════════════════
   🔴 THE DEFECT: EVERY SPOKEN LINE IN THE LANE WAS CLIPPED ON A PHONE.
   Measured live in headless Chromium over a 120-step rush at 360×780: 49 of 50
   distinct bubbles clipped — a 166px box against 247–503px of text, every one
   of them ending in an ellipsis inside the first four words. Seventeen
   personalities, five mood pools, 272 authored lines, and the player never read
   a whole sentence of any of them. The writing is the reason the lane is not a
   spawn table, and it was invisible.

   TWO CAUSES, AND THEY NEED TWO DIFFERENT OWNERS:

     1. ✅ `white-space: nowrap` on `.mk-bub` (kitchen.css). NOT OUR FILE, AND
        IT LANDED. What shipped is `white-space: normal` + `width: max-content` +
        `max-height: 3.75em` (three line boxes exactly) rather than the
        `-webkit-line-clamp` trio this block originally asked for — a plain
        max-height on an exact multiple of the line-height clips only BETWEEN
        lines, which is the same guarantee with one vendor prefix fewer. The two
        declarations that were NOT negotiable both went in verbatim. Kept here in
        full because this is the only record of WHY, and because a reviewer
        deleting `width: max-content` as redundant re-breaks 100% of the lane's
        writing on a phone. Measured in the running game, not a mock-up:
          · `white-space: normal` ALONE MAKES IT WORSE. `.mk-bub` is
            `position:absolute` inside `.mk-car`, so the moment it is allowed
            to wrap its shrink-to-fit width collapses to the CAR's 76px and
            `max-width` never binds — measured live at 360px, 52 of 52 bubbles
            still clipped, in a 77px box needing 45px of height against 31.
          · `width: max-content` beside it restores the intended 166px box and
            takes the clip rate to ZERO: 0/52 at 360, 0/59 at 390, 0/52 at 430,
            0/55 at 1280, with nothing overflowing the viewport at any width.
        The max-width, the shadow and the `data-side` flip all stay exactly as
        they are. No re-layout, no widening, no new breakpoint — the width the
        design already chose is enough the moment the text may use more than one
        line of it and is not being squeezed by the sprite it hangs over.
        AFTER, live at 360×780 over 220 paint steps: 61 distinct spoken lines,
        0 clipped, 0 off-road, line histogram {1 line: 4, 2 lines: 57}.

     2. LINE LENGTH, WHICH IS OURS. Individual authored lines are already
        inside that budget (272 lines, longest 63 chars). The 131-character
        monsters all came from ONE place: `speakerLine()` concatenates the
        personality's opener with up to two spoken modifiers, so a Corp Suit
        with two fussy requests says 131 characters in one breath. Measured
        across five seeded 600s days, 875 spoken lines: 6.4% over 73 chars,
        100% of those the compound order line.

   🔴 THE FIX IS BEATS, NOT TRUNCATION. An ellipsis is what we are removing;
   re-adding it in JS would be the same bug with a different owner. A customer
   who has three sentences to say now says them one at a time, in the same
   bubble, over the same total airtime — which is how a person talks, and which
   makes the compound order READ as an order followed by conditions rather than
   as a wall. `speakerLine()` still composes the whole utterance (the ticket
   card draws it in full, where there is room); `say()` is the thing that
   decides how much of it is on screen at once.

   ⚠ REJECTED: shortening the writing to fit. The lines ARE the feature. The
   longest single authored sentence is 63 characters, comfortably inside 73, so
   nothing had to be cut — and if a future writer does exceed the budget,
   `voiceAudit()` names the line rather than the player finding it clipped.
   AFTER: 942 spoken lines over five seeded 600s days, longest 68, none over
   budget, `voiceAudit()` clean.

   These two constants are MEASURED FACTS ABOUT THE BUBBLE, not tuning — same
   category as `POS_EPS` above, which is derived from LANE_ROLL_UNITS_S and also
   lives here rather than in ECON. A designer retuning the economy has no
   business in either.

   🔴 IF THE BUBBLE CSS CHANGES, RE-MEASURE IN THE RUNNING GAME AND NOT IN A
   MOCK-UP. A standalone page carrying a copy of the `.mk-bub` rule answered
   "wrapping alone fixes it, capacity 73" — and it was WRONG about the first
   half, because in the mock-up the bubble's containing block was the body and
   in the game it is a 76px car. The character budget it gave was right; the CSS
   conclusion it gave would have shipped a regression. Drive the real overlay.
   ════════════════════════════════════════════════════════════════════════════ */

/** Characters that fit in three wrapped lines of `.mk-bub` at 360px — measured
    at 73 against the real selector (151.6px of content width, 11px type), with
    five taken off for the font a real phone actually substitutes. */
const SAY_MAX_CH = 68;
/** No beat flashes past faster than this, however the airtime divides. Below
    about a second and a half a wrapped three-line bubble cannot be read at all,
    which would trade a clipped line for an unreadable one. */
const SAY_MIN_MS = 1500;

/**
 * Split one utterance into bubble-sized BEATS.
 *
 * `text` is a string, or — better — the ARRAY OF SEGMENTS it was composed from.
 * 🔴 THE SEGMENT LIST IS NOT AN OPTIMISATION, IT IS THE WRITING. Packing the
 * flat string "Corp order. Full box, itemised, and I'll need it hot. No tomato.
 * Long story, bad year. No onions. They repeat on me." by sentence gives beats
 * that break BETWEEN a modifier and its own punchline —
 *     "…and I'll need it hot. No tomato."  /  "Long story, bad year. No onions…"
 * — which is worse than clipping, because it reads as two different people. Fed
 * the segments (`speakerSegments()`), whole thoughts stay together and a beat
 * boundary can only ever fall where the author already put one.
 *
 * Greedy: as many whole SEGMENTS as fit, then a new beat. A segment too long to
 * fit alone is broken between whole sentences, and a single SENTENCE over the
 * budget is shipped WHOLE and never cut — a sentence chopped mid-clause reads
 * as a bug, an over-long one merely wraps to a fourth line, and `voiceAudit()`
 * exists so the author finds that case before the player does.
 */
function beatsFor(text, budget) {
  const cap = Math.max(24, _int(budget) || SAY_MAX_CH);
  const segs = (Array.isArray(text) ? text : [text])
    .map((x) => String(x == null ? '' : x).trim())
    .filter(Boolean);
  if (!segs.length) return [];
  const out = [];
  let acc = '';
  const add = (piece) => {
    const cand = acc ? acc + ' ' + piece : piece;
    if (cand.length <= cap) { acc = cand; return; }
    if (acc) out.push(acc);
    acc = piece;
  };
  for (const seg of segs) {
    if (seg.length <= cap) { add(seg); continue; }
    const parts = seg.match(/[^.!?…]+[.!?…]+["'”’)]*\s*|[^.!?…]+$/g) || [seg];
    for (const raw of parts) { const p = raw.trim(); if (p) add(p); }
  }
  if (acc) out.push(acc);
  return out.length ? out : segs.slice();
}

/**
 * → { budget, over:[{where,len,text}], max, ok } — every authored line that
 * `beatsFor()` cannot get inside the bubble, i.e. every SINGLE SENTENCE longer
 * than the budget. `ok` is the only state this file ships in, exactly like
 * `econAudit()`, and for the same reason: a rule nothing checks is a rule that
 * has already been broken somewhere you have not looked.
 *
 * Pure, cheap, no arguments needed. `debug()` in index.js should print it
 * beside `econAudit()`.
 */
export function voiceAudit(budget) {
  const cap = Math.max(24, _int(budget) || SAY_MAX_CH);
  const over = [];
  const look = (where, text) => {
    for (const beat of beatsFor(text, cap)) {
      if (beat.length > cap) over.push({ where, len: beat.length, text: beat });
    }
  };
  try {
    for (const id of Object.keys(VOICE)) {
      for (const key of Object.keys(VOICE[id])) for (const t of VOICE[id][key]) look(id + '.' + key, t);
    }
    for (const key of Object.keys(GENERIC)) for (const t of GENERIC[key]) look('generic.' + key, t);
    for (const sp of Object.keys(SPECIAL_VOICE)) {
      for (const key of Object.keys(SPECIAL_VOICE[sp])) for (const t of SPECIAL_VOICE[sp][key]) look(sp + '.' + key, t);
    }
    for (const m of MODS) look('mod.' + m.id, m.say);
  } catch (e) { /* rule 2 — an audit must never be the thing that throws */ }
  let max = 0;
  for (const o of over) if (o.len > max) max = o.len;
  return { budget: cap, over, max, ok: over.length === 0 };
}

/**
 * Put a line on screen over the car. Render reads `say` / `sayUntil`.
 *
 * The airtime the caller asked for is DIVIDED between the beats in proportion
 * to their length, so a one-sentence nag is unchanged from before and only a
 * compound order line takes longer to deliver — floored at SAY_MIN_MS, so the
 * total can run over for a very long utterance rather than flashing.
 *
 * ⚠ A NEW LINE ALWAYS WINS. `_sayQ` is replaced, never appended to: if a
 * customer's food lands while they are still listing their conditions, the
 * thing they say about the food is what matters and the rest of the order is
 * stale. Derived, never saved — the lane is not persisted (CONTRACT §5).
 */
function say(K, car, text, ms) {
  if (!car || !text) return;
  const beats = beatsFor(text, SAY_MAX_CH);
  if (!beats.length) return;
  const now = _num(K && K.now, 0);
  const total = Math.max(600, _num(ms, 2500));
  let chars = 0;
  for (const b of beats) chars += b.length;
  const span = (b) => Math.max(SAY_MIN_MS, Math.round(total * (b.length / Math.max(1, chars))));
  car.say = beats[0];
  car.sayUntil = now + span(beats[0]);
  car._sayQ = beats.slice(1).map((b) => ({ t: b, ms: span(b) }));
}

/**
 * Advance a multi-beat utterance. Called at the top of `advanceCar()`, so it
 * runs for EVERY car including one already flagged 'gone' — a customer driving
 * off mid-sentence with the rest of it swallowed is the same defect one frame
 * later.
 *
 * ⚠ DELIBERATELY DOES NOT BUMP `K.rev`. Bubbles are drawn by `frame()` off
 * `laneCard()`/`laneView()`, not by a structural repaint; the window nag has
 * never bumped rev either, and a rev bump every 1.5s per talking car would
 * repaint the ticket board through the whole rush.
 */
function drainSay(K, car, now) {
  const q = car && car._sayQ;
  if (!Array.isArray(q) || !q.length) return;
  if (_num(now, 0) < _num(car.sayUntil, 0)) return;
  const next = q.shift();
  if (!next) return;
  car.say = next.t;
  car.sayUntil = _num(now, 0) + _num(next.ms, SAY_MIN_MS);
}

/** Which waiting pool this car draws from right now. */
function moodKey(car) { return car && car.mood === 'furious' ? 'furious' : 'testy'; }

/**
 * Pick a line for this car, remembering the LAST one so it cannot be said
 * twice running. `_lastSay` is derived and never saved.
 */
function pickLine(K, car, key) {
  const r = () => rnd(K);
  const line = voiceFor(car.custId, key, car.special, r, car._lastSay);
  if (line) car._lastSay = line;
  return line;
}

/**
 * The speaker-box line: the personality's own opener, then the modifiers spoken
 * aloud. "Two of everything. The gate doesn't feed us. No onions, they repeat
 * on me." is the whole modifier system delivered as speech, which is worth more
 * than a badge on a ticket.
 *
 * 🔴 SENTENCES, NOT AN EM-DASH SPLICE. The first version joined with " — " onto
 * a base that already ended in a full stop, and shipped lines like
 *     "Corp account. Itemise it. Quickly. — drown it."
 *     "The line moved. I moved it. — honestly, take your time."
 * The second one is also a raider who has just bullied to the front of the
 * queue asking you to slow down; the modifier POOL fix (§MODIFIERS `ban`) deals
 * with that half. This half is purely grammar: every `say` in MODS is written
 * as a complete sentence, and they are simply concatenated. Nothing is trimmed
 * off the base — a personality's opener is finished writing and this function
 * has no business editing it.
 */
function speakerSegments(car) {
  const out = [];
  const base = String((car && car._speaker) || '').trim();
  if (base) out.push(base);
  for (const m of (Array.isArray(car && car.mods) ? car.mods : [])) {
    let line = String((m && (m.say || m.label)) || '').trim();
    if (!line) continue;
    // A `say` authored without terminal punctuation still lands as a sentence.
    if (!/[.!?…]$/.test(line)) line += '.';
    out.push(line);
  }
  return out;
}

/** The same utterance as ONE string, for the ticket card, which has room and
    wraps. The bubble is fed `speakerSegments()` instead — see `beatsFor()`. */
function speakerLine(car) {
  return speakerSegments(car).join(' ');
}

/* ═══════════════════════════════════════════════════════════════════════════
   GIVING UP — 🔴 and the one place a double popularity charge could hide.
   ═══════════════════════════════════════════════════════════════════════════
   A drive customer who leaves unserved must cost POP_LOST, ONCE. There are two
   modules that can notice it: this one (their patience ran out) and
   kitchen.state.js (`t > ticket.dueAt` in its expiry loop). state.js already
   defers to us — it skips a drive ticket whose car is still in the lane, with a
   TICKET_HARD_GRACE_MS backstop in case we have a bug.

   So the routing is: WE decide WHEN, state.js applies the PENALTY.
     • mark the car gone (which releases state.js's deferral), and
     • pull `ticket.dueAt` back to just before `now`,
   and state.js's step 5 — which runs AFTER our step 3 in the same frame — sees
   an expired ticket whose car is gone and calls its own `loseTicket()`. One
   penalty, one `ticket:lost`, one popularity hit, applied by the file that owns
   popularity.

   ⚠ REJECTED: charging POP_LOST here and deleting the ticket ourselves. It
   works, and it puts a second copy of the lost-ticket rules (tallies, `totals`,
   the `ticket:lost` payload, the fx float-up) in a file that has no business
   knowing them. The first time state.js retunes POP_LOST, the drive-thru would
   quietly keep charging the old number.
   ═══════════════════════════════════════════════════════════════════════════ */
function giveUp(K, car, reason, now, out, silentTicket) {
  if (!car || car.state === 'gone') return;
  car.state = 'gone';
  car.phase = 'exit';
  car.leftAt = now;
  car.reason = reason;
  settle(K, car, 'lost', now);
  K.rev = _int(K.rev) + 1;

  if (!silentTicket && car.ticketId) {
    // Hand the penalty to state.js by making the ticket expired THIS frame.
    const tk = ticketOf(K, car.ticketId);
    if (tk && (tk.state === 'open' || tk.state === 'ready')) tk.dueAt = now - 1;
  }

  // A car that never got to order produces no ticket, so state.js has no path
  // to charge for it. POP_JAM is ours, and it is the heavier of our two.
  if (!car.ticketId) bumpPop(K, out, EC('POP_JAM'), 'jammed');

  raise(K, out, 'car:leave', { carId: car.carId, custId: car.custId, reason, served: false });
}

/* ═══════════════════════════════════════════════════════════════════════════
   📒 §SETTLE — 🔴 ONE PLACE WHERE A CUSTOMER'S OUTCOME IS WRITTEN DOWN.
   ═══════════════════════════════════════════════════════════════════════════
   THE BUG THIS REPLACES, because it is the subtlest one this file has shipped:
   `remember(K, car, 'served')` and `stats.served++` used to live ONLY inside
   `serveCar()`. `serveCar()` had no callers — the renderer served through
   `State.serveTicket()` directly — so the lane's ledger recorded FAILURES AND
   NOTHING ELSE. Measured over a full simulated day: 54 `car:served` events
   against `laneStatus().stats.served === 0`.

   That is not a cosmetic counter. `rollSpecial()` computes
   `wronged = (lost + waved) > served` to decide whether a returning regular
   comes back with a GRUDGE or a FAVOUR. With `served` pinned at zero, `wronged`
   was ALWAYS TRUE: over 12 simulated days and 822 arrivals the set pieces that
   fired were {bulk: 43, jump: 26, grudge: 22, favour: 0}. The favour set piece
   — a regular who came back because you were good to them, its own dialogue,
   its own ×1.55 tip — was unreachable in live play. A quarter of the writing in
   this file could not be seen.

   🔴 THE FIX IS STRUCTURAL, NOT A CALL SITE. Booking the outcome inside one
   player verb means it is only booked if the game happens to go through that
   verb, and there are FOUR ways a car can finish:
       serveCar()                     — our own verb
       State.serveTicket()            — the renderer's direct path, which calls
                                        state.js's releaseCar() and never
                                        touches this file
       loseTicket()                   — state.js's own expiry backstop
       giveUp() / waveCar()           — ours
   Only the first and last two were ever booked. So the ledger is now written by
   a SWEEP in `tick()` (`settleGone`) that finds any car marked 'gone' that has
   not been booked yet and books it from `car.reason`, plus `settle()` calls on
   our own paths so the voice line and the stats land in the same frame the
   player acted. `_settled` makes it exactly-once whichever door the car left
   through, and no future call site can forget.

   ⚠ WHAT settle() DELIBERATELY DOES NOT DO: touch popularity, touch tickets,
   or raise `car:leave`. Every one of those has exactly one owner already
   (§GIVING UP, state.js's loseTicket, state.js's releaseCar) and a second
   charge is the failure mode this file works hardest to avoid.
   ═══════════════════════════════════════════════════════════════════════════ */
function settle(K, car, outcome, now, quiet) {
  if (!car || car._settled) return false;
  car._settled = outcome;

  const b = book(K);
  if (outcome === 'served') b.stats.served++;
  else if (outcome === 'waved') b.stats.waved++;
  else b.stats.lost++;

  remember(K, car, outcome, now);

  car.mood = outcome === 'served' ? 'happy' : 'furious';
  if (!quiet) say(K, car, pickLine(K, car, outcome === 'served' ? 'served' : 'angry'), 3000);
  return true;
}

/**
 * The sweep. Any car that state.js released without going through one of our
 * verbs is booked here, from the reason state.js wrote on it.
 * `releaseCar()` sets reason 'served' | 'lost'; `waveCar()` sets 'waved'.
 */
function settleGone(K, now) {
  for (const car of (K.lane || [])) {
    if (!car || car.state !== 'gone' || car._settled) continue;
    const r = String(car.reason || 'lost');
    settle(K, car, r === 'served' ? 'served' : (r === 'waved' ? 'waved' : 'lost'), now);
  }
}

/** The regulars ledger (per shift — see `book()`). */
function remember(K, car, outcome, now) {
  if (!car || !car.custId) return;
  const mem = book(K).mem;
  const m = mem[car.custId] || (mem[car.custId] = { served: 0, lost: 0, waved: 0, lastAt: 0 });
  if (outcome === 'served') m.served++;
  else if (outcome === 'waved') m.waved++;
  else m.lost++;
  m.lastAt = _num(now, _num(K.now, 0));
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARRIVAL RATE — popularity × the day curve × the rush, with jitter.
   ═══════════════════════════════════════════════════════════════════════════
   `DATA.spawnIntervalMs(pop, rush)` owns the curve (its own comment: "drivethru
   applies jitter", which is what we do here and nothing more). That interval is
   the WHOLE HOUSE's arrival rate; kitchen.state.js takes COUNTER_SHARE of it
   for walk-ins, so the lane takes the remaining (1 − COUNTER_SHARE).

   🔴 SPAWN_MIN_MS IS A FLOOR AND NOT A TARGET. At popularity 95 in the 20:00
   rush the raw interval is already about 2.1s. Dividing by the lane's share
   pushes it back up, which is correct — the customers going to the counter are
   not also driving up — but the floor still has to be there because a bad
   retune of RUSH_CURVE would otherwise produce a zero interval and spawn a car
   every frame until the lane cap catches it, which is a hang, not a rush.
   ═══════════════════════════════════════════════════════════════════════════ */
function laneIntervalMs(K) {
  const f = DF('spawnIntervalMs');
  const whole = f ? _num(f(_num(K.popularity, 50), _num(K.shift && K.shift.rush, 1)), EC('SPAWN_BASE_MS'))
                  : EC('SPAWN_BASE_MS');
  const laneShare = _clamp(1 - EC('COUNTER_SHARE'), 0.05, 1);
  return Math.max(EC('SPAWN_MIN_MS'), whole / laneShare);
}

/* ═══════════════════════════════════════════════════════════════════════════
   🚪 §DRY — THE DOORS ARE SHUT, AND THE LANE NOW KNOWS IT.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 WHAT THIS CLOSES, MEASURED ON THE SHIPPED CODE BEFORE THE FIX (my
   scratchpad r6dt/dry.mjs, which reproduces the critic's r8/drygate3.mjs to the
   digit). A level-1 kitchen with an empty pantry, an empty live-resource ledger
   and ZERO Cinder — `dryCheck()` → {dry:true, cookable:[], affordable:[],
   need:['supplies','dna']} — run for one full 780s day with no player actions:

       counter tickets 0      ← kitchen.state.js gated its walk-ins correctly
       LANE tickets   33      ← we did not
       served 0 · lost 33 · popularity 50 → 21.5

   Thirty-three customers admitted to a kitchen the game had ALREADY PROVED it
   could not feed, at about −1 popularity each, with no counter-play: waving
   costs popularity, letting them expire costs popularity, and there is no third
   button. The same shift showed the contradiction on ONE screen — an empty
   pantry, an empty wallet, and a lane header reading "2 CARS · ROOM FOR 2".

   🔴 IT IS NOT A NEW IDEA, IT IS THE FIFTH ROUND OF THE SAME SHAPE. `_dry` has
   existed in kitchen.state.js since round 4 with the annotation "drivethru.js
   reads this to stop the lane", and this file's own handover (O3) has said in
   writing since round 4 that it does NOT. Two files, one truth, disagreeing in
   comments while a real player paid for it. Both halves are now written: the
   test is below, and O3 is closed in the past tense at the bottom of this file.

   ── WHY `State.isDry()` AND NOT `K._dry` ──────────────────────────────────
   Same rule as everywhere else in this file: we read other people's state
   through the door they opened, never off the object. `isDry()` (kitchen.state.js)
   returns the latch that `tick()` refreshes at step 2b — BEFORE `DriveThru.tick()`
   runs, deliberately, so what we read here is THIS frame's answer and not last
   frame's. It is a plain boolean read, no recomputation and no bridge traffic,
   so it is safe on the spawn path every frame. The same accessor gates state.js's
   own walk-ins, so the counter door and the lane door cannot drift apart.

   ⚠ AND IT IS GUARDED THREE WAYS, because rule 2 says we never throw:
     • `typeof State.isDry === 'function'` — the import cycle means we must
       never assume a binding exists at call time;
     • `State.Kitchen === K` — `isDry()` reads the module-private singleton, NOT
       the `K` we were handed. A harness or a replay running a DETACHED kitchen
       must be judged on its own pantry, and reading the singleton's dryness
       there would silently shut a lane that has plenty of food;
     • try/catch, defaulting to FALSE. If we cannot prove the kitchen is dry we
       let the customer in — the failure mode of a false negative is the lane we
       had yesterday, and the failure mode of a false positive is a drive-thru
       that never opens.
   ═══════════════════════════════════════════════════════════════════════════ */
function laneDry(K) {
  try {
    if (!K || State.Kitchen !== K) return false;
    return (typeof State.isDry === 'function') ? !!State.isDry() : false;
  } catch (e) { return false; }
}

function scheduleArrivals(K, now, out) {
  const b = book(K);

  // Service has closed for the day: the clock is past DAY_MS, so nobody new
  // joins the lane. The people already in it are still owed their food — that
  // is what state.js's LAST_CALL_MS grace is for.
  const pctFn = DF('dayPct');
  const dayPct = pctFn ? _clamp(_num(pctFn(_num(K.shift.tMs, 0)), 0), 0, 1)
                       : _clamp(_num(K.shift.tMs, 0) / Math.max(1, EC('DAY_MS')), 0, 1);
  if (dayPct >= 1) return;

  /* 🚪 §DRY — nobody new joins a lane the kitchen cannot serve.
     🔴 THE ROLL-FORWARD IS HALF THE FIX AND IT IS THE HALF THAT IS EASY TO
     MISS. A bare `if (dry) return;` leaves `b.nextAt` in the past, so the
     instant a crate lands the lane fires a spawn on the FIRST frame and then
     again the frame after that — the whole shut period arrives at once, and the
     player is punished for restocking. Pushing the cursor a full interval ahead
     every frame the doors are shut means the queue that forms after a restock
     is the queue popularity says it should be. kitchen.state.js's tick() does
     exactly this for `_nextCounter` (`if (dry) K._nextCounter = t + …`) and the
     two doors must behave the same way or the player learns two rules.
     ⚠ Cars ALREADY in the lane are untouched. They were let in while there was
     stock, they are owed their food, and their patience is still running — the
     dry gate is about who is ADMITTED, never about who is abandoned. */
  if (laneDry(K)) { b.nextAt = now + laneIntervalMs(K); return; }

  if (!b.nextAt) { b.nextAt = now + EC('SHIFT_GRACE_MS'); return; }
  if (now < b.nextAt) return;

  const j = EC('SPAWN_JITTER');
  b.nextAt = now + laneIntervalMs(K) * (1 - j + rnd(K) * 2 * j);
  spawn(K, now, false);
}

/* ═══════════════════════════════════════════════════════════════════════════
   🎬 SERVICE RESOLUTION — §THE TWO VERBS.
   ═══════════════════════════════════════════════════════════════════════════
   These are the ONLY two things a player can do to the lane, and they are the
   entire reason the lane is a game and not an animation.

   ✅ BOTH ARE WIRED. `serveCar()` is called from `doServe()` (kitchen.render.js
   :2704) and `doWave()` calls `waveCar()` (:2733) off a `data-act="wave"` button
   that exists in two places — the ✋ on the head car (:757) and the "✋ Wave off"
   on the pinned card (:1785). Re-check with
   `grep -rn "serveCar\\|waveCar" public/src public/index.html` before trusting
   this sentence; it was false for a whole round.

   🔴 IT SHIPPED DEAD, AND THAT IS WHY THE CALL SITES ARE STILL WRITTEN OUT IN
   FULL BELOW. In the round that first shipped these two functions, that same
   grep returned nothing but the two definitions: the renderer served through
   `State.serveTicket()` directly, so the reward moment (the customer's `served`
   line, the regulars ledger, the modifier verdict, the stats) never ran, and
   there was no `data-act="wave"` anywhere, so the player's escape hatch could
   not be invoked at all. Leaving a verb's exact wiring in a handover for
   somebody else to design is how that happens. This block is the antidote and
   it stays even though the work is done — the next person to touch `doServe()`
   should be able to read what it is supposed to look like without diffing:

       // in doServe(id, now), where `t` is the ticket being served:
       if (t.source === 'drive' && t.carId) {
         const r = DriveThru.serveCar(State.Kitchen, t.carId, now);
         if (!r.ok) { toast(r.why); return; }
         // r.paid, r.tip, r.line and r.mods are the reward moment — see below.
       } else {
         result(State.serveTicket(t.id, now));
       }

       // and in rewardMoment(r) — ONE line, replacing the two that print only
       // the first kept OR the first broken promise and never its worth:
       if (r.modLine) line += ` · ${esc0(r.modLine)}`;

       // a wave button on the head car, and in the onClick switch:
       case 'wave': doWave(el.dataset.car, now); break;
       async function doWave(carId, now) {
         if (!await gcConfirm('Wave them off? It costs popularity.')) return;
         DriveThru.waveCar(State.Kitchen, carId, now);
         paint();
       }

   ⚠ `serveCar()` CALLS `State.serveTicket()` ITSELF. Do NOT call both — that
   is a double payout, and the second call returns `{ok:false}` on an already
   served ticket, so the bug would show up as a spurious error toast on a sale
   that actually went through.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 💸 THE SETTLEMENT, IN ONE STRING THE RENDERER CAN PRINT VERBATIM. ──
   🔴 WHY A PREFORMATTED STRING AND NOT JUST THE NUMBERS. Round 3 returned
   `modCinder` and `modPop` "so `rewardMoment()` can say what the promise was
   worth", left the formatting "to the renderer" — and nothing drew either one.
   `grep -rn "modCinder|modPop"` found the two assignments and a handover note
   admitting the toast ignored them. That is the third round running that a
   value was computed and no caller consumed it, and the common factor is a
   handover that asks somebody to make a decision rather than to paste a line.

   So the decision is made HERE, once, in the file that knows what the numbers
   mean, and the renderer's job is `line += ' · ' + r.modLine`. The numbers are
   still returned separately for anything that wants to colour them.

   THE FORMAT IS THE CHIP'S FORMAT, ON PURPOSE. `modChip()` prints a bare signed
   figure — green for a bonus, red for a charge — beside the promise WHILE the
   player can still keep it. The toast has to print the same glyphs and the same
   figure or the player cannot tell it is the same number, which is the entire
   point. The SHAPE, which is what this block is specifying:
       one promise   →  "✓ no greens +NN · +N.N pop"
       one broken    →  "✗ no greens −NN · −N.N pop"
       several       →  "✓2 ✗1 −NN · −N.N pop"
   ⚠ THE FIGURES ARE DELIBERATELY NOT WRITTEN OUT HERE. This block used to show
   "✓ no greens +18 · +0.5 pop" as its worked example; by the time anyone read it
   again MOD_PAY_HIT_MIN had moved to 28 and MOD_POP_HIT was 0.14, so the example
   was wrong in both columns and looked authoritative. Every figure comes from
   MOD_PAY_* / MOD_POP_* in kitchen.data.js and from nowhere else. If you want to
   see today's, run the A/B: scratchpad r4dt/ab.mjs prints obey / defy / ignore
   side by side off the real ECON table.
   UNPROVEN rows are counted in neither. They are worth exactly 0 in both
   directions and `modChip()` already refuses to print a zero, because a "0" on
   an untouched line reads as a penalty already taken. */
function signedCinder(n) {
  const v = Math.round(_num(n, 0));
  return v ? ((v > 0 ? '+' : '−') + Math.abs(v)) : '';
}
function signedPop(n) {
  const v = Math.round(_num(n, 0) * 100) / 100;
  return v ? ((v > 0 ? '+' : '−') + Math.abs(v).toFixed(1)) : '';
}
function verdictLine(verdict) {
  if (!verdict) return '';
  const kept = _int(verdict.honoured), broke = _int(verdict.broken);
  if (!(kept + broke)) return '';
  let head;
  if (kept + broke === 1) {
    const row = (verdict.detail || []).find((d) => d && (d.result === 'honoured' || d.result === 'broken'));
    head = ((row && row.result === 'honoured') ? '✓ ' : '✗ ') + ((row && row.label) || 'the order');
  } else {
    const bits = [];
    if (kept) bits.push('✓' + kept);
    if (broke) bits.push('✗' + broke);
    head = bits.join(' ');
  }
  const money = signedCinder(verdict.cinder);
  const pop = signedPop(verdict.pop);
  return [head + (money ? ' ' + money : ''), pop ? pop + ' pop' : ''].filter(Boolean).join(' · ');
}

/**
 * Hand the food out of the window. THE reward moment.
 *
 * → { ok, code, why, paid, tip, xp, line, mods:[{label,result,worth}],
 *     honoured, broken, custName, icon, modCinder, modPop, modLine }
 *
 * Deliberately THIN on the money. `State.serveTicket()` is the payer: it prices
 * the ticket (§8.3), calls `bridge().addGems`, moves popularity, awards XP,
 * emits `pay`, `ticket:served` and `car:served`, and calls its own
 * `releaseCar()` which sets `car.state = 'gone'` and emits `car:leave`.
 * Re-implementing ANY of that here would be a second copy of the payout rules
 * in a file that must not own money.
 *
 * What IS ours, and what the return value is for:
 *   • the customer's `served` line — the payoff for reading their voice all shift;
 *   • the regulars ledger (§SETTLE), which is what makes the FAVOUR set piece
 *     reachable at all;
 *   • the modifier verdict (§MODIFIERS), re-judged AFTER `serveTicket()` has
 *     committed, on the plates that physically left the pass — see the block
 *     inside the function. ⚠ THIS LINE USED TO SAY "captured BEFORE serveTicket
 *     runs", which was the bug, not the design: judging early answered a
 *     different question about a different set of plates, and the chip, the
 *     toast and the popularity charge disagreed with the till on 14 of 239
 *     drive tickets over 12 seeded days. Zero now.
 *
 * ⚠ WHAT THIS FUNCTION MUST NOT DO: emit `car:served` or `car:leave`. state.js
 * has already emitted both by the time it returns, and a duplicate is two
 * float-ups and two toasts for one burger.
 */
export function serveCar(K, carId, now) {
  const fail = (code, why) => ({ ok: false, code, why, paid: 0, tip: 0, mods: [] });
  try {
    if (!K) return fail('BAD_ARG', 'No kitchen.');
    const t = _num(now, K.now);
    const car = findCar(K, carId);
    if (!car) return fail('BAD_ARG', 'That car has already gone.');
    if (car.state === 'gone') return fail('BAD_ARG', 'That car has already gone.');
    if (!car.ticketId) return fail('NOT_READY', `${car.name} has not ordered yet.`);

    const ticket = ticketOf(K, car.ticketId);
    if (!ticket) return fail('BAD_ARG', 'That order is gone.');
    if (ticket.state !== 'ready') return fail('NOT_READY', `${car.name}’s order is not complete yet.`);

    /* ⚠ THE PROVISIONAL VERDICT, AND IT IS A FALLBACK AND NOTHING ELSE.
       `refreshReady()` judges against whatever the pass happens to be holding
       this frame; that is what the chips draw and it is right for a chip. It is
       NOT what the customer was handed. Keep it only so a verdict still exists
       if a sibling file ever empties `ticket.items` on commit — see below. */
    const provisional = judgeTicket(ticket);

    let res = null;
    try {
      if (typeof State.serveTicket === 'function' && State.Kitchen === K) {
        res = State.serveTicket(ticket.id, t);
      }
    } catch (e) { res = null; }
    if (!res) return fail('NOT_READY', 'The till would not take that order.');
    if (!res.ok) return { ok: false, code: res.code || 'NOT_READY', why: res.why || '', paid: 0, tip: 0, mods: [] };

    // state.js's releaseCar() has already flipped this car to 'gone'. Dress it,
    // and book it (§SETTLE — idempotent, so the tick sweep will not double it).
    /* ══ 🔴 THE VERDICT IS RE-JUDGED HERE, AFTER THE COMMIT. ══════════════
       THE DEFECT THIS CLOSES, quoted so it cannot be softened: "the verdict on
       screen and the verdict the till paid on are different verdicts, and the
       popularity is charged on the wrong one."

       `serveTicket()` calls `takeDishes()`, which REBUILDS `item.built`,
       `item.filled`, `item.pn` and `item.qsum` from the plates that physically
       left the pass — deliberately rebuilt rather than trimmed, because the
       provisional list can contain plates a nearer-due ticket took between the
       last look and this commit. Judging before that call answered a different
       question about a different set of plates. Measured on one perfect burger
       against "well done": the chip said ✗, the toast said "✗ well done",
       popularity was docked 0.5 — and the till, which prices the tip AFTER the
       commit through `tipFor()`, paid the honoured rate on the same
       transaction. Over twelve seeded days the shown verdict {h:102,b:110,u:21}
       and the paid verdict {h:116,b:96,u:21} disagreed on 14 drive tickets.

       So: the money already read the committed evidence (`tipFor()` runs inside
       `serveTicket()`, after `takeDishes()`), and now the popularity charge,
       the returned detail and the reward toast read the SAME committed
       evidence. One transaction, one verdict, four surfaces.

       ⚠ `ticket` IS STILL A LIVE OBJECT. `serveTicket()` filters it out of
       `K.tickets` on success, which is why this used to be judged early — but
       filtering an array does not destroy the object we are holding a reference
       to, and its `items` (mods, builds, filled, pn) are exactly as the commit
       left them. The `provisional` fallback below covers the one way that could
       stop being true: a future commit path that CLEARS `ticket.items`. If that
       ever happens the chip's answer is still better than no answer. */
    let verdict = judgeTicket(ticket);
    if (!verdict.detail.length && provisional.detail.length) verdict = provisional;

    car.state = 'gone';
    car.phase = 'exit';
    car.leftAt = t;
    car.reason = 'served';
    settle(K, car, 'served', t);

    /* §SETTLEMENT, THE WORD-OF-MOUTH HALF. The Cinder went out on the tip line
       inside `State.serveTicket()` (see §SETTLEMENT and `tipFor()`); the
       popularity has no path through state.js at all — `bumpPop(popGain)` there
       prices the FOOD, not the promise — so it is charged here, once, by the
       verb, exactly like the balk and the wave-off are.
       ⚠ `_modPopped` and not `_settled`: a car is settled by the tick sweep
       whichever door it left through, and only THIS door has a verdict to
       charge for. Guarding on the shared flag would silently skip the charge
       the moment the sweep got there first. */
    if (!car._modPopped && (verdict.honoured || verdict.broken)) {
      car._modPopped = true;
      if (verdict.pop) bumpPop(K, null, verdict.pop, verdict.broken ? 'promise-broken' : 'promise-kept');
    }
    K.rev = _int(K.rev) + 1;

    return {
      ok: true, code: 'OK', why: '',
      paid: _int(res.paid), tip: _int(res.tip), xp: _int(res.xp),
      custName: car.name, icon: car.icon,
      line: car.say || '',
      honoured: verdict.honoured, broken: verdict.broken, unproven: verdict.unproven,
      /* What the promise itself was worth, judged on what actually went out of
         the window (see the re-judge above). `modLine` is the same two numbers
         already formatted the way `modChip()` formats them — see the block
         above `serveCar()` for why this file does the formatting. */
      modCinder: Math.round(_num(verdict.cinder, 0)),
      modPop: Math.round(_num(verdict.pop, 0) * 100) / 100,
      modLine: verdictLine(verdict),
      mods: verdict.detail,
    };
  } catch (e) {
    return fail('BAD_ARG', 'Something went wrong at the window.');
  }
}

/**
 * Wave one away. The player's escape hatch, and it is not a free one.
 *
 * → { ok, code, why, custName, icon, pop } — an object rather than the bare
 *   boolean the first version returned, because the renderer needs the name to
 *   say WHO drove off and the pop cost to show what it charged. `ok` is the
 *   boolean CONTRACT §1 asks for and truthiness is unchanged for any caller
 *   that only tests the result.
 *
 * COSTS POP_WAVE and produces NO lost ticket — CONTRACT §1 is explicit about
 * that, and it is the right call: waving somebody off is a DECISION (usually
 * "this raider is going to time out anyway and take three cars behind him with
 * him"), and a decision that costs the same as a failure is not a decision. At
 * POP_WAVE −2.0 against POP_LOST −3.5 the maths says: wave early, eat a smaller
 * hit, save the queue.
 *
 * ⚠ It removes the ticket from the board WITHOUT `loseTicket()`, on purpose —
 * `loseTicket()` charges POP_LOST and increments `today.lost`/`totals.lost`,
 * and a wave-off is neither of those things. This is the one place this file
 * touches `K.tickets` directly, and it is the reason the comment is this long.
 */
export function waveCar(K, carId, now) {
  const fail = (code, why) => ({ ok: false, code, why, custName: '', icon: '', pop: 0 });
  try {
    if (!K) return fail('BAD_ARG', 'No kitchen.');
    const t = _num(now, K.now);
    const car = findCar(K, carId);
    if (!car) return fail('BAD_ARG', 'That car has already gone.');
    if (car.state === 'gone') return fail('BAD_ARG', 'That car has already gone.');

    if (car.ticketId && Array.isArray(K.tickets)) {
      const before = K.tickets.length;
      K.tickets = K.tickets.filter((x) => !(x && x.id === car.ticketId));
      if (K.tickets.length !== before) K.rev = _int(K.rev) + 1;
    }

    car.state = 'gone';
    car.phase = 'exit';
    car.leftAt = t;
    car.reason = 'waved';
    car.ticketId = null;
    settle(K, car, 'waved', t);
    K.rev = _int(K.rev) + 1;

    const pop = EC('POP_WAVE');
    bumpPop(K, null, pop, 'waved');
    raiseLater(K, 'car:leave', { carId: car.carId, custId: car.custId, reason: 'waved', served: false });
    return { ok: true, code: 'OK', why: '', custName: car.name, icon: car.icon, pop };
  } catch (e) {
    return fail('BAD_ARG', 'Something went wrong at the window.');
  }
}

function findCar(K, carId) {
  if (!Array.isArray(K.lane)) return null;
  return K.lane.find((c) => c && (c.carId === carId || c.id === carId)) || null;
}

/**
 * 0..1 of the customer's patience REMAINING. 1 is a fresh arrival, 0 is gone.
 *
 * ⚠ THE DIRECTION IS THE AMBIGUITY AND THIS IS THE ANSWER. CONTRACT §1 says
 * "→ 0..1 for the bar over the car" without saying which way. Remaining, not
 * elapsed, because a bar that EMPTIES as time runs out is the universal reading
 * of a patience meter and the renderer will get it right by instinct. If you
 * want elapsed, it is `1 - patiencePct(car, now)`; do not invert this function.
 *
 * Before the order is placed this measures the balk clock instead, so the bar
 * over a car stuck at the mouth of a jammed lane is still telling the truth.
 */
export function patiencePct(car, now) {
  if (!car) return 0;
  const t = _num(now, 0);
  if (car.state === 'gone') return 0;
  if (!car.ticketId) {
    const span = Math.max(1, EC('LANE_BALK_MS'));
    return _clamp((_num(car.balkAt, t) - t) / span, 0, 1);
  }
  const span = Math.max(1, _num(car.patienceMs, EC('TICKET_BASE_MS')));
  return _clamp((_num(car.expiresAt, t) - t) / span, 0, 1);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §TIP — what the customer leaves on top.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THIS RETURNS A FRACTION OF THE BILL, NOT AN ABSOLUTE NUMBER, AND IT MUST
      STAY STRICTLY BELOW 1.

   CONTRACT.md is genuinely ambiguous here — §1 types this "→ integer Cinder"
   and §8.3 writes `tip = payout × DriveThru.tipFor(...)`, which needs a
   fraction. kitchen.state.js resolved it defensively and documented it:

        const v = DriveThru.tipFor(K, car, avgQ, now);
        if (v > 0 && v < 1) return Math.round(payout * v);   // fraction
        return Math.max(0, Math.round(v));                    // absolute Cinder

   We return the FRACTION reading, because it is the one that composes with the
   payout — §8.3's formula prices a tip as a share of a bill that has already
   been through the quality, popularity and rush multipliers, and an absolute
   number would have to re-derive all three. TIP_FRACTION_MAX exists solely to
   keep us on the correct side of that `v < 1` test: return 1.05 and state.js
   reads it as ONE CINDER, which is a 99% pay cut delivered silently.

   The blend is ECON's, not this file's invention: how much of the promise was
   left (patience), how good the food actually was (quality), how well-liked the
   place is (popularity), weighted by TIP_*_W, ceilinged at TIP_MAX_PCT. Then
   the things that are the LANE's business multiply it — the customer's own
   generosity, the tip upgrades, the set piece, and whether the modifiers they
   asked for were honoured.
   ═══════════════════════════════════════════════════════════════════════════ */
export function tipFor(K, car, quality, now) {
  try {
    const t = _num(now, K ? K.now : 0);

    // state.js passes a STUB `{carId}` when the car has already left the lane.
    // Re-look-up first; fall back to the stub's own fields.
    const live = (car && car.custId) ? car : (K ? findCar(K, car && car.carId) : null) || car || {};

    const patience = _clamp(patiencePct(live, t), 0, 1);
    const qCeil = Math.max(0.01, EC('Q_PERFECT'));
    const q = _clamp(_num(quality, 0) / qCeil, 0, 1);
    const pop = _clamp(_num(K && K.popularity, 50) / 100, 0, 1);

    const blend = patience * EC('TIP_PATIENCE_W')
                + q        * EC('TIP_QUALITY_W')
                + pop      * EC('TIP_POP_W');

    /* ── THE GENEROSITY STACK, AND WHY IT IS CAPPED ────────────────────────
       `blend` is the part the PLAYER earns — patience left, how good the food
       was, how well-liked the place is. Everything below is who the customer
       happens to BE, and it multiplies.

       🔴 IT HAS TO BE CAPPED, and this is a measured defect and not a
       precaution. Un-capped, a Corp Suit (tipBias 1.80) on a bulk order
       (×1.70) at a kitchen with the Clear Speaker Box and the Neon Marquee
       (tipMul 1.20 × 1.15) stacks to 4.2×. Against TIP_MAX_PCT 0.35 that is a
       tip fraction of 1.47, which slams into TIP_FRACTION_MAX — and a harness
       sampling 4,000 of them found the clamp binding on 100% OF SAMPLES. The
       whole top tier paid an identical flat maximum: perfect food and ruined
       food tipped the same, and the modifier mechanic became literally
       invisible at exactly the point in the game a player is paying most
       attention to it. A ceiling that binds constantly is not a ceiling, it is
       a bug with a `Math.min` in front of it.

       Capping the STACK instead of the RESULT is what keeps the tip sensitive:
       the jackpot corner still pays a jackpot, but quality, patience and the
       modifiers keep moving it all the way up, because `blend` is never
       clamped away. Post-fix the same 4,000 samples spread instead of pegging,
       and honouring a modifier is worth a visible amount again. */
    let gen = 1;

    const cust = customerOf(live.custId);
    gen *= _num(cust && cust.tipBias, 1);

    const upFn = DF('tipMul');
    gen *= _num(upFn && K ? upFn(K.upgrades) : 1, 1);

    if (live.special === 'bulk')   gen *= EC('BULK_TIP_MULT');
    if (live.special === 'grudge') gen *= EC('GRUDGE_TIP_MULT');
    if (live.special === 'favour') gen *= EC('FAVOUR_TIP_MULT');

    /* 🔴 THE PROMISE IS NOT IN THIS STACK, AND THAT IS THE ROUND-6 FIX.
       `gen *= verdict.mul` used to sit here, multiplying the generosity blend by
       MOD_TIP_HIT / MOD_TIP_MISS on top of the §SETTLEMENT that the chip had
       already quoted — TWO channels for one promise, one of them invisible.
       MEASURED before it was removed (scratchpad r6dt/settle.mjs, identical food
       in each arm so the promise is the ONLY thing moving):
           chip "+28" → the till moved +39      chip "−17" → the till moved −32
       Breaking a promise cost nearly TWICE what the chip warned, on the one
       surface the round built for making that choice — and the plate picker now
       puts "✓ keeps no greens" beside "✗ breaks no greens", so there IS a
       counterfactual on the card and the understatement had become a lie.
       ONE promise, ONE channel, ONE number: §SETTLEMENT, in absolute Cinder,
       priced from MOD_PAY_* and printed on the chip before the player commits.
       ⚠ MOD_TIP_HIT / MOD_TIP_MISS / MOD_TIP_UNPROVEN are consequently read by
       NOBODY. Deleting them from kitchen.data.js is the ask, and it is written
       up as handover item O2 — a key with no reader is the fault, not the fix,
       and it must not be "solved" by putting the second channel back. */

    /* THREE GUARDS, EACH DOING A DIFFERENT JOB. They were arrived at by
       measuring 4,000 samples per tier, not by feel, and collapsing them into
       one number re-breaks whichever job the survivor was not doing:

         TIP_GEN_MAX    stops RUNAWAY MULTIPLICATION. Four independent factors
                        multiply (personality × upgrades × set piece × set
                        piece), so the stack is unbounded in principle. Set high
                        enough that it does not touch a normal customer — its
                        job is to catch the pathological corner, not to shape
                        the curve. ⚠ It used to have a FIFTH factor, the
                        modifier verdict, and that is why this row read
                        "modifiers stack ×1.7 on their own"; the promise left
                        this stack in round 6 and the sentence went with it.
         TIP_HARD_PCT   the DESIGN ceiling. kitchen.data.js calls TIP_MAX_PCT
                        "ceiling as a fraction of payout" and means ~35%; the
                        generosity stack legitimately pushes past that, but not
                        to 95%. Two times the designer's ceiling is the jackpot,
                        and reaching it needs a rare set piece AND the whole
                        ~700k Cinder tip-upgrade path AND perfect execution.
         TIP_FRACTION_MAX  the last-ditch guard that keeps us on the correct
                        side of state.js's `v < 1` fraction test. If this one
                        ever binds, something above it is wrong.

       ⚠ THE PROMISE USED TO BE MEASURED HERE AND IS NOT ANY MORE. This comment
       carried a three-row table — honoured 39.2% of the bill / unproven 29.0% /
       broken 20.3% — described as "the whole modifier mechanic". That spread was
       the BLEND channel, which round 6 removed (see the note where
       `gen *= verdict.mul` used to be): the tip is now promise-blind and the
       whole mechanic is the §SETTLEMENT below, in Cinder, on the chip. Leaving
       the table would have been a comment describing a channel that no longer
       exists — which is the same fault as a value nothing consumes, one layer
       up. What these clamps shape now is generosity: WHO the customer is, what
       upgrades the player owns, and which set piece is running. */
    const pct = EC('TIP_MAX_PCT') * _clamp(blend, 0, 1)
              * _clamp(gen, 0, EC('TIP_GEN_MAX'));
    const tipPct = Math.min(pct, EC('TIP_HARD_PCT'));

    /* ── §SETTLEMENT RIDES OUT HERE. Read the §SETTLEMENT header first. ─────
       The three clamps above shape a TIP. This is not a tip: it is the
       modifier settlement, priced in absolute Cinder from MOD_PAY_*, and it is
       delivered on the tip line because `tipFor()` is the only seam state.js
       opens between computing the payout and paying it.

       🔴 IT IS ADDED AFTER TIP_HARD_PCT AND THAT IS DELIBERATE. Folding it in
       before the design ceiling would let the ceiling eat exactly the thing the
       player is being taught to chase — which is the failure the ceiling itself
       was introduced to fix on the generosity stack (see the comment above it).
       The settlement is bounded by its own ECON keys and by the line prices it
       is a percentage of; it does not need a second ceiling on top.

       🔴 AND IT MAY RETURN ZERO. `TIP_FRACTION_MIN` exists so a served car
       always drops a coin, and it is suspended for exactly one case: a promise
       the player BROKE. state.js reads a non-positive return as "no tip", so a
       badly broken ticket costs the whole tip — the largest punishment this
       pipe can deliver, and the reason the HANDOVER asks for a payout hook.

       🔴 THE FLOOR IS APPLIED TO THE TIP, NOT TO THE SUM, AND THAT ORDER IS THE
       DIFFERENCE BETWEEN AN EXACT CHIP AND AN ALMOST-EXACT ONE. The old line
       was `_clamp(tipPct + settle, MIN, MAX)`, which clamps a settled total
       back UP to TIP_FRACTION_MIN — i.e. the floor quietly refunded part of a
       punishment, on exactly the tickets where the punishment was the message.
       Flooring the TIP first keeps what the floor is for ("a served car always
       drops a coin") and leaves the settlement free to move the total all the
       way to nothing, which is what the chip's red figure promised.

       ⚠ TIP_FRACTION_MAX IS STILL A CEILING ON THE SUM and it is the one place
       an honoured settlement can still be clipped: a cheap dish carrying an
       honoured `extra` can price a settlement worth more than 95% of the bill.
       It is rare, it errs downward, and it cannot be fixed from inside this
       file — the payout hook (O1) is what removes it.

       It judges the TICKET, not `car.mods`, because a promise is scored PER
       LINE: "no onions" is about the burgers, not about the milkshake beside
       them. `ticketFor()` recovers the ticket even from the `{carId}` stub
       state.js passes once the car has already left the lane. */
    const ticket = ticketFor(K, live) || ticketFor(K, car);
    const verdict = judgeTicket(ticket);
    const est = payoutEstimate(K, ticket);
    const settle = est > 0 ? (_num(verdict.cinder, 0) / est) : 0;
    const total = Math.max(tipPct, EC('TIP_FRACTION_MIN')) + settle;
    if (total <= 0) return 0;
    return Math.min(total, EC('TIP_FRACTION_MAX'));
  } catch (e) {
    return EC('TIP_FRACTION_MIN');   // rule 2: a bad tip beats a dead till
  }
}

/**
 * What state.js is about to pay for this ticket, re-derived so the §SETTLEMENT
 * can be expressed as a fraction of it.
 *
 * ⚠ IT MIRRORS `serveTicket()`'s formula RATHER THAN OWNING IT, and the two
 * files must not drift: gross is Σ(basePrice × qsum), then `popPayMul()` and
 * `rushPayMul()` — both kitchen.data.js functions, both read by state.js from
 * the same place. If a fourth multiplier is ever added to the payout, this
 * estimate is quietly wrong by that factor and the settlement is delivered at
 * the wrong size. That is the strongest argument in the file for the payout
 * hook, handover item O1: with it, this function deletes.
 *
 * It is only ever a DENOMINATOR, so an under-estimate over-delivers the
 * settlement and an over-estimate under-delivers it; neither can invert the
 * sign, and a zero falls back to paying nothing extra rather than dividing.
 */
function payoutEstimate(K, ticket) {
  if (!ticket || !Array.isArray(ticket.items)) return 0;
  let gross = 0;
  for (const it of ticket.items) gross += lineGross(it);
  if (!(gross > 0)) return 0;
  const popFn = DF('popPayMul'), rushFn = DF('rushPayMul');
  const popMult = popFn ? _num(popFn(_num(K && K.popularity, 50)), 1)
                        : EC('POP_PAY_FLOOR') + (_num(K && K.popularity, 50) / 100) * EC('POP_PAY_SPAN');
  const rushMult = rushFn ? _num(rushFn(_num(K && K.shift && K.shift.rush, 1)), 1) : 1;
  return Math.max(0, gross * popMult * rushMult);
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLEAR — the shift ended (CONTRACT §4: the shift is the unit of persistence).
   ═══════════════════════════════════════════════════════════════════════════
   Called from kitchen.state.js's `clearService()`, which then also does
   `K.lane = []` itself. That belt-and-braces is fine; what this function is
   really for is the BOOK — the spawn timer, the regulars ledger and the stats.
   Leaving `mem` behind would make yesterday's grudges walk into today's first
   shift with no explanation on screen, and leaving `nextAt` behind would make
   the first car of a new shift arrive on the old shift's schedule.

   ⚠ It does NOT charge anybody for the cars it removes. `closeShift(forfeit)`
   is explicit that a player who shut the panel did not fail those customers,
   and `closeShift()` proper has already run every open ticket through
   `loseTicket()` before it gets here. Charging again would be the double-penalty
   this file works hardest to avoid.
   ═══════════════════════════════════════════════════════════════════════════ */
export function clearLane(K) {
  try {
    if (!K) return;
    K.lane = [];
    K._lane = null;
    book(K);          // rebuild empty, so the next shift starts from zero
    K.rev = _int(K.rev) + 1;
  } catch (e) { /* never throw across a shift boundary */ }
}

/* ═══════════════════════════════════════════════════════════════════════════
   🔁 arrivalPlan — THE REPLAYABLE RUSH.
   ═══════════════════════════════════════════════════════════════════════════
   CONTRACT: "Export a deterministic, seedable arrival generator so a critic can
   replay a rush."

   This is PURE. No `K`, no clock, no mutation, no `State.*`. Given a seed and
   the shape of a shift it returns exactly who would drive up and when, so a
   balance argument can be settled by running it rather than by playing for
   twelve minutes and disagreeing about what happened.

   It deliberately does NOT share the live cursor: a critic replaying 20:00 must
   not perturb a running game's RNG, and a replay that changed the thing it was
   measuring would be worthless.

   ⚠ IT MODELS ARRIVALS, NOT OUTCOMES. It answers "how much custom does the
   dinner rush actually send at popularity 90" — which is the question the
   difficulty wall in ECON's header is arguing about. It does not know whether
   the lane was full, because that depends on how fast the player cooks. Pair it
   with `State.simulate()` for the other half.

   opts: { seed, fromMs, toMs, pop, level, upgrades, laneShare, serveRate }
   → [{ at, tMs, custId, name, carId, vehicle, seats, special, items, mods,
        patienceMs, rush }]
   ═══════════════════════════════════════════════════════════════════════════ */
export function arrivalPlan(opts) {
  const o = opts || {};
  const r = mulberry32(_int(o.seed) || 1);
  const dayMs = EC('DAY_MS');
  const from = _clamp(_num(o.fromMs, 0), 0, dayMs);
  const to = _clamp(_num(o.toMs, dayMs), from, dayMs);
  const pop = _clamp(_num(o.pop, EC('POP_START')), EC('POP_MIN'), EC('POP_MAX'));
  const level = Math.max(1, _int(o.level) || 40);
  const upgrades = Array.isArray(o.upgrades) ? o.upgrades : [];
  const share = _clamp(_num(o.laneShare, 1 - EC('COUNTER_SHARE')), 0.05, 1);
  /* 🔴 THE ASSUMED HIT RATE, AND IT IS NOW MEASURED RATHER THAN WISHED FOR.
     The default was 0.7 — "a competent shift" — and it did not describe the
     game that shipped. Round 2 measured the divergence directly:
       arrivalPlan({seed:1337, 0..720s, pop:90, level:20})
         → 166 arrivals, specials {none:152, bulk:6, favour:6, jump:2}
       twelve live seeded days at the same level and popularity
         → {none:526, bulk:16, jump:21, grudge:23, favour:12}
     Six favours and zero grudges in the replay against grudges outnumbering
     favours 2:1 in play — because `rollSpecial()` reads
     `wronged = (lost + waved) > served` and 0.7 models a player who almost
     never loses anybody. A balance argument settled on the replay tool was
     being settled on a KINDER GAME than the one running.

     So the default is ECON.PLAN_SERVE_RATE, which is the lane's own measured
     figure and is a lane number like SPAWN_BASE_MS. `plan.serveRate` is stamped
     on the returned array so a reader can see which player was modelled without
     reading this comment, and passing an explicit `serveRate` still models
     whatever you like — 1 for a perfect shift, 0 for a disaster.

     ⚠ RE-MEASURE IT WHEN THE LANE IS RETUNED. It is a snapshot of a moving
     number: an assembling auto-cook over 6 seeded 720s days at level 20 /
     popularity 85 finishes 630 served against 251 lost tickets and 784/1182
     arrived-versus-balked at the mouth. Which of those two ratios you want
     depends on the question; PLAN_SERVE_RATE models the FINISHED-CUSTOMER one,
     because that is the ledger `rollSpecial()` reads. */
  const serveRate = _clamp(_num(o.serveRate, EC('PLAN_SERVE_RATE')), 0, 1);

  const rushFn = DF('rushAt');
  const intervalFn = DF('spawnIntervalMs');
  const jitter = EC('SPAWN_JITTER');
  const roster = Array.isArray(DATA.CUSTOMERS) ? DATA.CUSTOMERS : [];
  const cars = Array.isArray(DATA.CARS) ? DATA.CARS : [];

  // A throwaway `K`-shaped object so the shared helpers (rollSpecial's regulars
  // ledger, buildOrder's menu) work unchanged. It is never returned and never
  // touches the real Kitchen — which is the entire point of the exercise.
  const fake = { level, upgrades, popularity: pop, _lane: null, _seed: _int(o.seed) || 1 };

  const out = [];
  let tMs = from;
  let guard = 0;
  while (tMs < to && guard++ < 20000) {
    const rush = rushFn ? _num(rushFn(tMs), 1) : 1;
    const whole = intervalFn ? _num(intervalFn(pop, rush), EC('SPAWN_BASE_MS'))
                             : EC('SPAWN_BASE_MS');
    const gap = Math.max(EC('SPAWN_MIN_MS'), whole / share) * (1 - jitter + r() * 2 * jitter);
    tMs += gap;
    if (tMs >= to) break;

    const pick = rollSpecial(fake, r, level);
    const cust = (pick.custId ? customerOf(pick.custId) : null) || rpick(r, roster);
    // Same two filters `spawn()` uses, in the same order (§RIDES) — a replay
    // that puts a different driver in a different vehicle is not a replay.
    let pool = ridePool(cars, cust);
    if (pick.special === 'bulk') {
      const big = pool.filter((c) => _int(c.seats) >= 4);
      pool = big.length ? big : (cars.filter((c) => _int(c.seats) >= 4) || pool);
    }
    const carDef = skinRide(rweight(r, pool, 'weight')
      || { id: 'hatch', icon: '🚗', name: 'Hatchback', seats: 2, patienceMul: 1 }, cust);
    const items = buildOrder(r, cust, carDef, level, pick.special);
    if (!items.length) continue;
    const mods = [];
    for (const it of items) for (const m of (it.mods || [])) mods.push(m);

    /* A replayed arrival is remembered too, so grudges and favours replay.
       🔴 IT ROLLS AN OUTCOME. The first version did `m.served++` on EVERY
       replayed arrival, which made the replay's regulars ledger the exact
       INVERSE of the live one: `rollSpecial` reads `wronged = (lost + waved) >
       served`, so a replay produced favours and never a grudge while live play
       produced grudges and never a favour. Measured: seed 1337 over the 9:00
       rush returned specials {none:29, favour:2, bulk:1}. A balance argument
       settled by running the replay tool was being settled on the opposite data
       to the game.
       `serveRate` is the assumed hit rate of the player being modelled and it
       defaults to ECON.PLAN_SERVE_RATE, the lane's MEASURED figure — see the
       comment on it above, which records how far the old 0.7 was from the game
       that shipped. Pass 1 to model a perfect shift, 0 to model a disaster. */
    if (cust && cust.id) {
      const mem = book(fake).mem;
      const m = mem[cust.id] || (mem[cust.id] = { served: 0, lost: 0, waved: 0, lastAt: 0 });
      if (r() < serveRate) m.served++; else m.lost++;
    }

    out.push({
      at: Math.round(tMs),
      tMs: Math.round(tMs),
      rush: Math.round(rush * 1000) / 1000,
      custId: cust ? cust.id : null,
      name: (cust && cust.name) || 'Survivor',
      carId: carDef.id,
      vehicle: carDef.id,
      seats: _int(carDef.seats) || 2,
      special: pick.special || null,
      items: items.map((it) => ({ recipeId: it.recipeId, qty: it.qty })),
      mods: mods.map((m) => m.label),
      patienceMs: patienceFor(cust, carDef, items, mods, pick.special),
    });
  }
  /* Stamped on the array rather than returned in a wrapper: every existing
     caller treats the result as a plain list and a shape change would break
     them for a field most of them do not want. `plan.serveRate` says which
     player this plan modelled, which is the thing a balance argument has to
     agree on before it can be had at all. */
  try {
    out.serveRate = serveRate;
    out.seed = _int(o.seed) || 1;
  } catch (e) { /* a frozen array is still a valid plan */ }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ-ONLY VIEWS for the renderer and the admin debug panel.
   ═══════════════════════════════════════════════════════════════════════════
   None of these mutate. They exist so `kitchen.render.js` does not have to know
   the lane's internal shape — a renderer that reaches into `K._lane` is a
   renderer that breaks the next time this file is retuned.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Cars in draw order, front (window) first. Excludes nothing — a leaving car
    is still on screen, and it is still blocking, so render must see it. */
export function laneView(K) {
  if (!K || !Array.isArray(K.lane)) return [];
  return K.lane.slice();
}

/**
 * The lane's HUD chip.
 *
 * 🔴 `label` IS THE THING TO PRINT. Everything else is raw material.
 *
 * ⚠ TWO UNITS LIVE IN THIS OBJECT AND MIXING THEM IS A REAL BUG THAT SHIPPED.
 * `cap` and `used` are in LENGTH UNITS (a rig and a transit bus are 2), because
 * that is the unit the cap is actually enforced in — see `compact()`. `live` is
 * a plain HEAD COUNT. The two legitimately disagree the moment a road train
 * pulls in: a rig plus two hatchbacks is used 4 of cap 4, so the lane is
 * refusing new arrivals, but `live` is 3.
 *
 * The renderer printed `${live} / ${cap} cars` — a head count over a length,
 * which is the exact failure the previous version of this comment warned about
 * and did nothing to prevent. On a full lane it read "3 / 4 CARS · FULL", which
 * is a sentence that argues with itself.
 *
 * So the ratio is gone and the report means ONE thing: a count of cars, in
 * cars, and a separate plain-English statement of whether the lane is full.
 *   "Lane clear"            no cars
 *   "1 car"                 room for more
 *   "3 cars"                room for more
 *   "3 cars · lane full"    used >= cap, whatever the head count is
 *   "3 cars · room for 1"   one length unit spare
 * `spare` is in LENGTH UNITS too, which is why the phrasing is "room for 1"
 * rather than "1 car" — a spare unit fits a hatchback and does not fit a rig,
 * and the lane should not promise what it cannot park.
 *
 * 🚪 AND IT REPORTS §DRY, BECAUSE THE HEADER WAS THE SURFACE THAT LIED. On the
 * dry day measured in §DRY the screen carried an empty pantry, an empty wallet
 * and "NEXT IN 56.2S · 2 CARS · ROOM FOR 2" — a promise of custom from a lane
 * that was about to stop admitting anybody. Two fields answer it, and BOTH are
 * consumed by code that already exists rather than waiting on somebody:
 *   • `label` says "doors shut" instead of "room for N" — kitchen.render.js
 *     prints `st.label` verbatim in the section head;
 *   • `nextInMs` is ZERO while the doors are shut, and render's countdown is
 *     already guarded `st.nextInMs > 0`, so the "next in 56.2s" line takes
 *     itself off the screen with no change in anybody else's file.
 * `dry` rides out beside them for anything that wants to style it.
 */
export function laneStatus(K, now) {
  if (!K) {
    return { cap: 0, used: 0, live: 0, spare: 0, full: false, dry: false, label: 'Lane closed',
             nextInMs: 0, intervalMs: 0, stats: null };
  }
  const b = book(K);
  const t = _num(now, K.now);
  const cap = capOf(K);
  const used = usedUnits(K);
  const live = (K.lane || []).filter((c) => c && c.state !== 'gone').length;
  const full = used >= cap;
  const spare = Math.max(0, cap - used);
  const dry = laneDry(K);

  /* The dry phrasing beats the full/room phrasing because it is the reason:
     "3 cars · room for 1" on a shut kitchen is true about the tarmac and wrong
     about the game. What the player needs to read is why nobody else is coming. */
  let label;
  if (dry) label = live ? `${live} car${live === 1 ? '' : 's'} · doors shut, no stock` : 'Doors shut · no stock';
  else if (!live) label = full ? 'Lane blocked' : 'Lane clear';
  else label = `${live} car${live === 1 ? '' : 's'}` + (full ? ' · lane full' : ` · room for ${spare}`);

  return {
    cap,          // LENGTH UNITS
    used,         // LENGTH UNITS
    spare,        // LENGTH UNITS
    live,         // CARS
    full,
    dry,          // §DRY — the kitchen cannot cook and cannot buy its way out
    label,        // ← print this
    // 🚪 Zero while dry ON PURPOSE — see the header. There IS no next one.
    nextInMs: dry ? 0 : Math.max(0, _num(b.nextAt, t) - t),
    intervalMs: Math.round(laneIntervalMs(K)),
    stats: b.stats,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   🖼 §RENDER — the six fields the lane computes every frame. ✅ ALL SIX DRAWN.
   ═══════════════════════════════════════════════════════════════════════════
   A measured 84px strip of four emoji is what this lane looked like on a phone,
   while the sim underneath computed all of this per car per frame and threw it
   away. Every field below now has a renderer — `moodFace` and `specialLabel` on
   the pinned card, `exitDir` in `updateCars()`, `ticket.line` in the ticket
   header, `item.mods` as chips under the line, `p.lane` on the drive-past band —
   so this block is now a SPEC AND A RECEIPT rather than a request. It stays
   because `laneCard()` hands the whole set over pre-chewed and a renderer must
   never have to reach into `K._lane` or re-derive a mood; the "DRAW:" notes say
   what each field is FOR, which is the thing a redesign needs and the thing a
   screenshot cannot tell you.

     car.mood     'happy' | 'ok' | 'testy' | 'furious', stepped off patience
                  remaining at LANE_MOOD_TESTY / LANE_MOOD_ANGRY.
                  DRAW: the face over the vehicle — 🙂 😐 😠 🤬 — and tint the
                  patience bar with it. This is REF-B's Popularity emoji, per
                  customer. It is the single highest-value pixel on the lane
                  because it tells the player WHO to serve next at a glance.

     car.special  null | 'bulk' | 'jump' | 'grudge' | 'favour'.
                  DRAW: a small badge on the car — 📦 BULK, ⚡ CUT IN, 😤 GRUDGE,
                  💚 REGULAR — and let the badge be the thing that explains why
                  this ticket is worth 1.55× or 0.45×. A set piece the player
                  cannot identify is a random number generator.

     car.exitDir  'forward' | 'aside', written by `roll()` when a car goes.
                  DRAW: 'forward' translates the car past the window and off the
                  near end; 'aside' veers it onto the shoulder and fades it
                  WHERE IT SITS. 🔴 The second one is not decoration — a car
                  that gave up mid-queue physically cannot drive out, it blocks
                  everyone behind it for LANE_EXIT_MS, and animating it forward
                  would show it driving through the cars in front.

     ticket.line  the customer's spoken order, mods included and grammatical
                  (see `speakerLine()`).
                  DRAW: the ticket header, in quotes. REF-B's order screen is
                  itemised tickets with per-item detail; this is that, and it is
                  already written.

     ticket.mods  the flattened promise list for the whole order.
                  DRAW: chips in the ticket header.

     item.mods    the promises ON ONE LINE — this is the one that matters,
                  because a modifier is scored per line (§MODIFIERS).
                  DRAW: a chip under that line with the ingredient icon, and
                  once there is a verdict, its state: ✓ honoured, ✗ broken,
                  — unproven. `modVerdict(K, car)` returns exactly those three
                  words per mod, live, every frame.

     p.lane / p.lanes   §BALK SPACING. Which row of the far-side band a
                  drive-past belongs in, and how many rows there are. Five balks
                  in one frame used to be five sprites at identical coordinates
                  (measured live at 360px: all five at x=304, one on top of
                  another). `passersBy()` also holds each one at the kerb for
                  its own `delay`, so a burst leaves in single file — the two
                  together are the whole fix, and the renderer only has to
                  honour `lane` and `pct`.

   The balk has no car at all — see `passersBy()`.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 🎯 THE PINNED STRIP. Everything a two-slot "window car / next car" panel needs,
 * already resolved, so the headline feature is never a scroll away on a phone.
 *
 * → { window, next, waiting, label, full, balking }
 *   where `window` / `next` are null or:
 *   { carId, name, icon, vehicleIcon, vehicleName, mood, moodFace, special,
 *     specialLabel, exitDir, state, phase, station, patience (0..1), ready,
 *     say, line, items:[{recipeId, name, icon, qty, filled, mods:[{label, ing,
 *     ingIcon, result}]}], canServe, canWave }
 *
 * `canServe` / `canWave` are the two buttons. `canServe` is true only when
 * `serveCar()` would succeed, so a renderer can disable the button rather than
 * offering it and then toasting a refusal.
 */
export function laneCard(K, now) {
  const empty = { window: null, next: null, waiting: 0, label: 'Lane closed', full: false, balking: 0 };
  try {
    if (!K) return empty;
    const t = _num(now, K.now);
    const st = laneStatus(K, t);
    const cars = (K.lane || []).filter(Boolean);
    return {
      window: cardFor(K, cars[0], t),
      next: cardFor(K, cars[1], t),
      waiting: st.live,
      label: st.label,
      full: st.full,
      balking: (book(K).passers || []).length,
    };
  } catch (e) {
    return empty;
  }
}

const MOOD_FACE = { happy: '😄', ok: '🙂', testy: '😠', furious: '🤬' };
const SPECIAL_LABEL = { bulk: '📦 Bulk order', jump: '⚡ Cut in', grudge: '😤 Second chance', favour: '💚 Regular' };

function cardFor(K, car, now) {
  if (!car) return null;
  const ticket = ticketFor(K, car);
  const verdict = ticket ? judgeTicket(ticket) : null;
  const ready = !!(ticket && ticket.state === 'ready');

  const items = [];
  const lines = (ticket && Array.isArray(ticket.items)) ? ticket.items : (car.items || []);
  for (const it of lines) {
    if (!it) continue;
    const rec = recipeOf(it.recipeId) || {};
    items.push({
      recipeId: it.recipeId,
      name: rec.name || it.recipeId,
      icon: rec.icon || '🍽',
      qty: _int(it.qty) || 1,
      filled: _int(it.filled),
      mods: (Array.isArray(it.mods) ? it.mods : []).map((m) => {
        const result = ticket ? judgeMod(m, it) : 'unproven';
        const row = verdict && verdict.detail.find((d) => d.id === m.id && d.recipeId === it.recipeId);
        return {
          id: m.id, label: m.label, kind: m.kind, ing: m.ing || null,
          ingIcon: ingIconOf(m.ing),
          result,
          // 🔴 THE STAKES, ON THE CHIP. A verdict the player only learns after
          //    the money has moved is a mechanic they never learn at all — so
          //    the chip can show what this promise is worth BEFORE they decide
          //    whether to keep it. Signed Cinder, straight off §SETTLEMENT.
          cinder: row ? _int(row.cinder) : 0,
        };
      }),
    });
  }

  return {
    carId: car.carId,
    name: car.name,
    icon: car.icon,
    vehicleIcon: car.vehicleIcon,
    vehicleName: car.vehicleName,
    mood: car.mood || 'ok',
    moodFace: MOOD_FACE[car.mood] || MOOD_FACE.ok,
    special: car.special || null,
    specialLabel: car.special ? (SPECIAL_LABEL[car.special] || '') : '',
    exitDir: car.exitDir || null,
    state: car.state,
    phase: car.phase,
    station: car.station,
    patience: patiencePct(car, now),
    ready,
    say: (now < _num(car.sayUntil, 0)) ? (car.say || '') : '',
    line: (ticket && ticket.line) || car._speaker || '',
    items,
    honoured: verdict ? verdict.honoured : 0,
    broken: verdict ? verdict.broken : 0,
    canServe: ready && car.state !== 'gone',
    canWave: car.state !== 'gone',
  };
}

function ingIconOf(id) {
  if (!id) return '';
  try {
    if (typeof DATA.ingredient === 'function') { const g = DATA.ingredient(id); if (g) return g.icon || ''; }
  } catch (e) {}
  try { const g = (DATA.INGREDIENTS || []).find((x) => x && x.id === id); return (g && g.icon) || ''; }
  catch (e) { return ''; }
}

/**
 * §BALK — the custom you are LOSING, on screen while you lose it.
 *
 * → [{ id, custName, icon, vehicleIcon, vehicleName, pct }] where `pct` runs
 *   0 → 1 across LANE_PASSBY_MS.
 *
 * DRAW: translate the vehicle across the FAR end of the road (behind the queue,
 * not through it) from one kerb to the other, at `pct`, fading out at the end,
 * with a small "drove past" float. It is the largest single event in the
 * business — a measured 74 balks against 64 arrivals in one twelve-minute day —
 * and until now it produced nothing at all on screen.
 */
export function passersBy(K, now) {
  try {
    if (!K) return [];
    const t = _num(now, K.now);
    const span = Math.max(1, EC('LANE_PASSBY_MS'));
    const lanes = Math.max(1, _int(EC('PASSBY_LANES')));
    const out = [];
    for (const p of (book(K).passers || [])) {
      // 🔴 The head start (§BALK SPACING). A car that has not left the kerb yet
      //    is NOT emitted at pct 0 — it is not emitted at all, so a burst
      //    genuinely strings out instead of five sprites sitting on the start
      //    line together waiting for their turn to move.
      const elapsed = t - _num(p.at, t) - _num(p.delay, 0);
      if (elapsed < 0) continue;
      const pct = _clamp(elapsed / span, 0, 1);
      if (pct >= 1) continue;
      out.push({
        id: p.id, custId: p.custId, custName: p.custName, icon: p.icon,
        vehicle: p.vehicle, vehicleIcon: p.vehicleIcon, vehicleName: p.vehicleName,
        pct,
        // Which row of the far-side band to draw this one in, 0..PASSBY_LANES-1.
        // Render may hash the id instead; this is the same answer, decided once,
        // by the file that knows how many are in flight.
        lane: _int(p.lane) % lanes,
        lanes,
      });
    }
    return out;
  } catch (e) {
    return [];
  }
}

/** The set of `custId`s this shift has already dealt with, and how it went. */
export function regulars(K) {
  if (!K) return {};
  const mem = book(K).mem;
  const out = {};
  for (const id in mem) out[id] = Object.assign({}, mem[id]);
  return out;
}

/* ════════════════════════════════════════════════════════════════════════════
   📌 HANDOVER — THINGS THIS FILE STILL NEEDS FROM OTHER PEOPLE'S FILES.
   ════════════════════════════════════════════════════════════════════════════
   CONTRACT.md: "If you need something this contract does not give you, do not
   invent it locally — say so and it gets added HERE first." These are the
   say-sos. Everything below WORKS today; each one would work better with a
   small addition somebody else owns.

   🔴 HOW TO READ THIS LIST, AND THE RULE THAT NOW GOVERNS IT.
   A handover that keeps a shipped fix listed as the top outstanding defect is
   an ACTIVE HAZARD, not merely untidy: it is the instrument the next builder or
   critic reads to decide where to spend a round, and it sent one of them at
   finished work with round-3 numbers attached. So:
     • a CLOSED item is rewritten in the past tense, marked ✅, and keeps only
       what a future reader needs — what the bug was, what closed it, and the
       re-measured figure. It is NEVER left phrased as work to do.
     • an OPEN item is marked 🔴 or ⚠, names the file and the exact signature,
       and says what it is worth. If you cannot name the signature, it is not
       ready to be a handover item.
     • EVERY claim here is a grep away from being checked. Check it. Two rounds
       running, the thing this block asserted about another file was false.
   Last swept: round 5, against the shipped code, item by item.

   ── OPEN ────────────────────────────────────────────────────────────────

   O1. 🔴 A PAYOUT HOOK IN kitchen.state.js. THE OLDEST OPEN ITEM AND THE ONE
      THAT DELETES CODE RATHER THAN ADDING IT. §SETTLEMENT explains at length
      why the modifier Cinder currently rides out on the tip line:
      `serveTicket()` makes exactly one `bridge().addGems(payout + tip)` call and
      opens no seam between computing the payout and paying it. The one this
      file wants, immediately after `const payout = …`:

          // kitchen.state.js, serveTicket(), right after `payout`
          let bonus = 0;
          if (ticket.source === 'drive' && typeof DriveThru.settleFor === 'function') {
            bonus = _int(DriveThru.settleFor(K, ticket, payout, t));
          }
          const paidOut = Math.max(0, payout + bonus);

      `settleFor(K, ticket, payout, now) → integer Cinder, signed` is two lines
      here (`judgeTicket(ticket).cinder`, rounded). It DELETES `payoutEstimate()`,
      which today re-derives state.js's own payout formula and is therefore the
      one place in this file that silently goes wrong if a fourth payout
      multiplier is ever added. With the hook, TIP_FRACTION_MAX stops binding on
      cheap dishes carrying an honoured `extra`, and a broken promise can cost
      more than the whole tip.

      ⚠ AND IT WOULD MAKE THE CHIP EXACT, WHICH IT IS NOT TODAY. MEASURED, round
      5, one Commuter, one burgerClassic, one "no greens", everything else held
      identical (scratchpad r5dt/settle.mjs, controlled against an ignore run
      that carries no promise at all):
          settlement channel alone (MOD_TIP_* zeroed)
              chip "+28" → tip moves +27      chip "−17" → tip moves −18
          both channels, i.e. what ships
              chip "+28" → till moves +34     chip "−17" → till moves −32
      So the figure the chip prints IS delivered, to a Cinder of rounding — and
      then MOD_TIP_HIT / MOD_TIP_MISS move the generosity blend a SECOND time on
      top of it, unshown. Honouring therefore pays more than advertised (fine)
      and BREAKING costs about twice what the chip warned (not fine, and it is
      the direction a player is least able to learn from). Nothing on screen
      contradicts itself — there is no counterfactual on the card — so this is an
      understatement of stakes rather than a lie, which is why it is a handover
      item and not a defect fix. The two honest resolutions both live in other
      people's files or in a design call:
        (a) take the hook, pay the settlement out of the PAYOUT, and leave the
            tip blend as the only thing riding the tip; or
        (b) decide the blend is part of the promise and show the total.
      Do not resolve it by deleting `gen *= verdict.mul` — that strands
      MOD_TIP_HIT / MOD_TIP_MISS / MOD_TIP_UNPROVEN as three more dead ECON keys,
      which is the fault O2 is already about.

   O2. 🔴 ECON.MOD_XP_HIT IS STILL READ BY NOBODY. kitchen.data.js ships it at
      3 xp (getting a fussy order right) and there is no path from this file to
      `addXp()` — it is module-private in kitchen.state.js, levels are derived
      inside it, and writing `K.xp` from here would skip the level-up emit, the
      unlock list and the forced save. Either export
      `awardXp(n, why) → boolean` or fold the modifier xp into `serveTicket()`
      beside O1's hook. Verified still true this round:
      `grep -rn "MOD_XP_HIT\\|awardXp" public/src/kitchen/` returns the ECON row
      and these comments, nothing else. A shipped key nothing reads is a designer
      tuning a number that does not exist.

   O3. 🔴 kitchen.state.js SAYS THIS FILE READS `K._dry`. IT DOES NOT.
      kitchen.state.js's `Kitchen` literal annotates `_dry` with "drivethru.js
      reads this to stop the lane (see the HANDOVER)". `grep -n "_dry"
      drivethru.js` returns nothing. Either the lane should stop spawning when
      the kitchen is provably dry — which is a real design question, because a
      lane that keeps filling with people you cannot feed is a popularity drain
      with no counter-play — or that annotation should be corrected. This file
      will take the behaviour the moment somebody decides which; it is one test
      in `scheduleArrivals()`. Named here because a comment in SOMEBODY ELSE'S
      file asserting something about THIS one is exactly the class of error this
      round was spent deleting.

   O4. ⚠ `extra` MODIFIERS ARE GATED ON THE RECIPE, NOT ON THE MODIFIER, and it
      is a data question as much as a code one. `State.addStep()` refuses to lay
      more of an ingredient than the recipe calls for, so an `extra` promise is
      only keepable on a dish whose canon carries at least MOD_EXTRA_MIN of it.
      Re-derived against the shipped RECIPES this round: `extra_must` (no recipe
      carries mustard:2) and `extra_oil` (none carries oil:2) can never spawn.
      Every other `extra` row is live — cheese, sauce, pickle, onion, pepperoni,
      chili, bacon, ice, syrup, coffee, milk all have at least one dish. Either
      state is fine; what is not fine is a promise the game forbids the player
      from keeping, which is what shipping the ungated pool would have been. If
      more `extra` variety is wanted the lever is in RECIPES, not here.

   O5. 🚲 CARS STILL HAS NO BICYCLE ROW — now a nicety, not a visible defect.
      §RIDE SKINS repaints the Kid's `bike` as 🚲 BMX in the lane, on the pinned
      card and on the drive-past, without touching kitchen.data.js and without
      moving a single number. A real row would let the BMX have its own `weight`
      and `patienceMul` instead of borrowing a motorbike's:
          { id:'bmx', icon:'🚲', name:'BMX', seats:1, patienceMul:0.9,
            weight:5, len:1 }
      …and `RIDES.kid` becomes `['bmx']` with the skin deleted. Optionally
      `CUSTOMERS[].vehicles` moves the whole ride table into the data file;
      `ridePool()` already prefers that field when it exists. The Courier keeps
      🏍️ either way — their own customer icon is 🛵 and a courier on a motorbike
      is not a contradiction.

   O6. 🔴 kitchen.state.js's `skewClocks()` REACHES INTO `K.lane`, AND ITS OWN
      COMMENT SAYS SO: "⚠ K.lane BELONGS TO drivethru.js. … The alternative — a
      `DriveThru.skew(K, ms)` entry point — is the better shape and wants adding
      to CONTRACT §1." Agreed, and here is the exact signature, ready to take:

          export function skew(K, ms) → boolean   // push every ABSOLUTE lane
                                                  // stamp forward by `ms`

      ⚠ IT IS DELIBERATELY NOT WRITTEN YET, and that is the whole discipline of
      this list. This file has shipped a dead export twice (§THE TWO VERBS, and
      `fitScore` for a round). An entry point with no caller is worth less than
      nothing: it looks done. It gets written in the same change that makes
      `skewClocks()` call it, and not before.

      🔴 AND THE HAND-ROLLED VERSION IS ALREADY MISSING TWO OF OUR STAMPS, which
      is the argument for the seam rather than against it. `skewClocks()` shifts
      arrivedAt / orderedAt / expiresAt / balkAt / sayUntil / nagAt / leftAt and
      `_lane.nextAt`. It does NOT shift:
        · `car.orderStartedAt` — so a car skewed mid-order has its order start
          left in the past, `now - orderStartedAt >= LANE_ORDER_MS` is instantly
          true, and it files its ticket without finishing its sentence;
        · each `passers[].at` / `.until` — so every drive-past on screen expires
          at once and the §BALK traffic vanishes in a frame.
      Neither is fatal and both are invisible in review, which is exactly what a
      list of field names in somebody else's file always eventually is.

   O7. ⚠ `laneView()` HAS NO CONSUMER AND kitchen.render.js REACHES PAST IT.
      §RENDER says "a renderer that reaches into `K._lane` is a renderer that
      breaks the next time this file is retuned", and render does the adjacent
      thing: `(k.lane || []).find(…)` in five places (kitchen.render.js :644,
      :953, :1792, :2256, :2283) while `laneView(K)` — the read that exists for
      exactly this — is called by nobody. It is not currently a BUG: `K.lane` is
      the same array `laneView()` copies. It is a seam that is not being used,
      so the next time the lane's internal shape moves, five call sites in
      somebody else's file move with it. Either render adopts `laneView()` or
      §RENDER stops claiming the rule. Do not resolve it by deleting
      `laneView()`; the CONTRACT lists it.

   ── CLOSED, KEPT AS THE RECORD ───────────────────────────────────────

   C1. ✅ ECON KEYS — ALL 36 OF THEM, PLUS THIS FILE'S OWN FOUR. `EC()` takes ONE
      argument and reads ECON. LANE_SPEAKER_POS, PASSBY_STAGGER_MS, PASSBY_LANES
      and PLAN_SERVE_RATE were adopted by kitchen.data.js at exactly the values
      in `ECON_PENDING`, so that object is now unreachable and stays only as a
      degradation guard. ASSERT IT rather than believing it: `econAudit()`
      returns `{gaps: [], … ok: true}` after a full simulated day.
      Two of the old pairs had ALREADY drifted before this landed — MOD_TIP_MISS
      −0.45 in ECON against −0.30 here, SPAWN_MIN_MS 2100 against 1400 — which is
      the whole argument for why one argument beats two.

   C2. ✅ MODIFIER EVIDENCE. kitchen.state.js records `dish.built` and freezes it
      onto `item.built` / `item.builds` at the moment of service (§MODIFIERS), so
      every `hold` and every `extra` scores for real. Six seeded 720s days at
      level 20 with an assembling auto-cook: 94 promises HONOURED, where the
      round that shipped the check measured 0 over twelve days.

   C3. ✅ THE PASS HANDED OVER THE WRONG PLATE — CLOSED BY `planPass()`, NOT BY
      THIS FILE. This item spent a round listed as "THE LARGEST REMAINING FALSE
      NEGATIVE" after it had been fixed, with round-3 measurements attached; see
      the rule at the top of this block, which exists because of exactly that.
      WHAT IT WAS: `takeDishes()` and `refreshReady()` filled a ticket line with
      the FIRST matching-recipe plate on the pass, so a burger built without
      lettuce for the car that asked for "no greens" went to whoever was served
      first and the careful player was told they broke a promise they kept. Six
      seeded days: 80 honoured against 57 broken, 43 of those `hold` mods the bot
      HAD obeyed.
      WHAT CLOSED IT: kitchen.state.js's `planPass()` — ONE matcher, asked by
      both readers, ranking lexicographically pin > fit > contention > oldest,
      with a fast exit that makes a plain board byte-for-byte the old FIFO. Our
      `fitScore(item, dish)` is its `fit` term, reached through `fitOf()`.
      RE-MEASURED, 12 seeded days: 89 broken `hold` verdicts remain and ZERO of
      them had an available, uncontested, fitting plate the matcher passed over.
      Cost: 0.181ms/tick on a saturated 15-ticket / 16-plate all-modded board.

   C4. ✅ `patiencePct` DIRECTION AND `tipFor` RETURN TYPE ARE IN THE CONTRACT.
      Both were ambiguous in CONTRACT.md §1 and resolved defensively here and in
      kitchen.state.js. Round 5 wrote them down properly: §1 now states that
      `patiencePct` returns patience REMAINING (1 fresh → 0 gone) and that
      `tipFor` returns a FRACTION of the payout, never absolute Cinder.

   C5. ✅ THE TWO VERBS ARE WIRED. `serveCar()` is called by `doServe()`
      (kitchen.render.js) and `waveCar()` by `doWave()`, off a `data-act="wave"`
      button that exists both on the head car and on the pinned card. They
      shipped with zero callers; §THE TWO VERBS keeps the exact call sites
      written out so the next person to touch `doServe()` does not have to diff.

   C6. ✅ `car:balk` IS WIRED AND SPACED. It is in TOAST_RANK, `passersBy()`
      drives `.mk-passer`, and the renderer reads `p.lane` / `p.lanes` for the
      row rather than hashing the id — so a burst of five fans out into traffic
      instead of stacking five sprites on one x-coordinate.

   C7. ✅ THE PINNED CARD'S "WHERE" IS TRUE (§GEOGRAPHY). `station` is derived
      from position rather than from slot index, so STATION_WORD no longer says
      "At the window" over a car that is still rolling in. Nothing to do — this
      is a note that the string got MORE accurate, in case a screenshot diff
      looks like a regression.

   C8. ✅ `serveCar().modLine` IS DRAWN. `rewardMoment()` prints it verbatim, so
      the "+28" the chip promised before the player pressed SERVE is confirmed by
      the toast after it. It also fixed a second half for free: the old code
      showed `broke[0]` OR `kept[0]`, so a ticket that honoured two promises and
      broke one read as a pure failure; `modLine` prints "✓2 ✗1 −N · −N.N pop".

   C9. ✅ THE BUBBLE WRAPS. kitchen.css took `white-space: normal`,
      `width: max-content` and a `max-height` of exactly three line boxes (its own
      solution, and a better one than the `-webkit-line-clamp` this file asked
      for). `width: max-content` is the one a reviewer deletes as redundant and
      the one without which `white-space: normal` makes the box NARROWER — 76px,
      the width of the car it hangs over — rather than wider. §READABILITY keeps
      the measurement that proves it. Live at 360×780 over 220 paint steps: 61
      distinct spoken lines, 0 clipped, 0 off-road.

   C10. ✅ RENDER READS — SIX OF THE SEVEN. `laneStatus()`, `laneCard()`,
      `passersBy()`, `modVerdict()`, `fitScore()` and `patiencePct()` all have
      live consumers in kitchen.render.js; `tick()`, `tipFor()` and `clearLane()`
      are called by kitchen.state.js; `serveCar()` and `waveCar()` by the two
      buttons (C5). `laneCard()` hands the whole pinned-strip payload over
      resolved, which is why the renderer never has to re-derive a mood.
      ⚠ THE SEVENTH IS `laneView()` AND IT IS OPEN — see O7. Counted honestly
      because the previous version of this line said "all ten have a consumer",
      and a grep says otherwise for `laneView`, `econAudit`, `voiceAudit`,
      `arrivalPlan` and `regulars`. The last four are TOOLS, not render reads —
      they are for harnesses, the critic's replay and the admin debug panel, and
      index.js does not import this module at all, so `debug()` cannot print
      them. That is a one-line ask if anybody wants it in the panel:
      `import * as DriveThru from './drivethru.js'` and
      `drivethru: { econ: DriveThru.econAudit(), voice: DriveThru.voiceAudit() }`
      in index.js's `debug()`. Both audits are pure, cheap and return `ok:true`
      in the only state this file ships in — which is precisely the pair of
      claims a debug panel exists to stop anyone having to take on trust.
   ════════════════════════════════════════════════════════════════════════════ */
