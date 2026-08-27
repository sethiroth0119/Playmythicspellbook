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
   ECON ACCESS — the same `EC()` guard kitchen.state.js uses, for the same
   reason (CLAUDE.md's _opEcon rule: no economy number lives outside
   kitchen.data.js). The second argument is a NaN GUARD, not a tuning value:
   changing it changes nothing on a correctly-built data file and will silently
   diverge from the number the designer is actually looking at.

   WHY the guard has to exist: a missing ECON key yields `undefined`, undefined
   poisons arithmetic into NaN, and a NaN `expiresAt` compares false against
   every threshold forever — the customer never runs out of patience, never
   leaves, holds the front of the lane for the rest of the shift and blocks the
   closing bell. That failure is invisible and unbounded. One default is not.
   ─────────────────────────────────────────────────────────────────────────── */
function EC(key, fallback) {
  try {
    const v = DATA.ECON ? DATA.ECON[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  } catch (e) { return fallback; }
}

function DF(name) {
  try { const f = DATA[name]; return (typeof f === 'function') ? f : null; }
  catch (e) { return null; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   📋 ECON KEYS THIS FILE READS THAT kitchen.data.js DOES NOT DEFINE YET
   ═══════════════════════════════════════════════════════════════════════════
   Same handover note kitchen.state.js writes for its own five, and the same
   deal: these are concepts THIS file introduced, so they want ADDING TO ECON
   rather than living here as fallbacks. Until they are, `EC()` returns the
   value shown and the lane plays correctly — it is a handover note, not an
   excuse, and not a second economy table.

   The ones the CONTRACT already lists and kitchen.data.js already ships —
   LANE_CAP, LANE_LEN, SPAWN_BASE_MS, SPAWN_POP_SPAN, SPAWN_JITTER,
   SPAWN_MIN_MS, PATIENCE_ITEM_MS, PATIENCE_MIN_MS, ORDER_MAX_ITEMS,
   COUNTER_SHARE, TIP_MAX_PCT, TIP_*_W, TIP_MIN, POP_WAVE, POP_MIN, POP_MAX,
   Q_PERFECT, TICKET_BASE_MS, TICKET_ITEM_MS, LIKE_BIAS — are NOT in this list.
   Those are read straight through.

   ── GEOMETRY & TIMING OF THE LANE ────────────────────────────────────────
     LANE_ROLL_UNITS_S     0.55  lane-lengths per second a car rolls forward.
                                 Slow enough to read as a vehicle moving, fast
                                 enough that clearing the window never feels
                                 like the game is stalling you on purpose.
     LANE_ENTRY_POS        1.30  where a car appears, past the mouth of the
                                 lane, so it drives ON SCREEN rather than
                                 popping into existence in the queue.
     LANE_ORDER_MS         2400  time at the speaker box actually ordering.
                                 This is the beat that makes the speaker line
                                 readable; at 0 the dialogue flashes past.
     LANE_EXIT_MS          1500  🔴 how long a served car BLOCKS THE WINDOW
                                 before it is reaped. This is not decoration —
                                 it is the entire "cars block each other"
                                 mechanic. At 0 the lane is a list, not a queue.
     LANE_BALK_MS         26000  patience of a car that has arrived but not yet
                                 reached the speaker. Only reachable when the
                                 lane is jammed by an unserved front car.
     LANE_MOOD_TESTY        0.55 patience-remaining thresholds the mood face
     LANE_MOOD_ANGRY        0.25 steps down at. Render reads `car.mood`.
     LANE_NAG_MS           9000  gap between a TESTY car's window nags, so a
                                 waiting customer talks instead of shouting.
     LANE_NAG_ANGRY_MS     5500  🔴 and the gap once they are FURIOUS. The nag
                                 ESCALATES: a customer who is about to walk
                                 talks more, not the same amount. A fixed
                                 interval made the last ten seconds of a
                                 doomed order read identically to the first.
     LANE_PASSBY_MS        2600  how long a balked vehicle stays in
                                 `passersBy()` so a renderer can drive it
                                 across the top of the road and off. See §BALK.

   ── POPULARITY THIS FILE APPLIES ITSELF ──────────────────────────────────
   (state.js owns POP_SERVE / POP_LOST / POP_BURN. These two have no path
    through state.js because neither produces a lost TICKET.)
     POP_BALK             -0.25  a car reached a full lane and drove past. Tiny
                                 on purpose: it is lost custom, not a failure,
                                 and a full lane is usually a compliment.
     POP_JAM              -0.90  a car queued, never got to order, gave up.
                                 That one IS your fault.
     POP_JUMP             -0.60  everyone behind a queue-jumper sees you allow
                                 it. Charged once, when the raider cuts in.

   ── SET PIECES (§SET PIECES) ─────────────────────────────────────────────
     SPECIAL_CHANCE         0.11 chance an arrival is a set piece at all.
     SPECIAL_MIN_LEVEL      3    below this the lane is plain. A brand-new
                                 player meeting a queue-jumper in their first
                                 sixty seconds learns "this game is unfair",
                                 not "this game has texture".
     BULK_ITEM_MULT         2.2  order-size multiplier for a corp bulk buy
     BULK_PATIENCE_MULT     1.9  …who is correspondingly willing to wait
     BULK_TIP_MULT          1.35 …and pays for the privilege. NOT higher: the
                                 customers who place bulk orders are already the
                                 two most generous rows in CUSTOMERS (tipBias
                                 1.8 / 1.6), so a big multiplier on top of a big
                                 bias is what made this tier flat in the first
                                 place.
     JUMP_PATIENCE_COST_MS  7000 patience each car behind loses to the cut-in
     GRUDGE_PATIENCE_MULT   0.70 a regular you failed is a shorter fuse
     GRUDGE_TIP_MULT        0.45 …and a worse tipper
     FAVOUR_PATIENCE_MULT   1.35 a regular you delighted gives you room
     FAVOUR_TIP_MULT        1.55 …and pays it back

   ── MODIFIERS (§MODIFIERS) ───────────────────────────────────────────────
     MOD_CHANCE             0.30 chance an ordered LINE carries a modifier
     MOD_SECOND_CHANCE      0.18 chance that line carries a SECOND one, so
                                 "no onions, extra cheese" exists and is rare.
     MOD_MAX_PER_ORDER      2    hard cap on promises in one spoken order. A
                                 family bucket with six instructions is a wall
                                 of text in a bubble on a 360px screen.
     MOD_PATIENCE_MULT      0.94 a fussy order is a fussier customer
     MOD_EXTRA_MIN          2    how many of an ingredient counts as "extra".
                                 Canon builds lay 1; asking for extra means
                                 laying it twice. 🔴 THIS IS THE CHECK — see
                                 §MODIFIERS. There is no quality bar any more.
     MOD_TIP_HIT            0.35 tip multiplier bonus for an HONOURED promise
     MOD_TIP_MISS          -0.30 …and the penalty for a BROKEN one
     MOD_TIP_UNPROVEN       0     …and what an UNPROVABLE one is worth, which
                                 is nothing in either direction. 🔴 Zero, not
                                 a small bonus and not a small penalty: see
                                 §MODIFIERS on why a mod nobody can check must
                                 never be able to move money.

   ── THE TIP RETURN (§TIP) ────────────────────────────────────────────────
     TIP_GEN_MAX            4.0  runaway guard on the GENEROSITY STACK (tipBias
                                 × tip upgrades × set piece × modifiers, which
                                 is unbounded because modifiers stack). Set high
                                 enough not to touch a normal customer.
     TIP_HARD_PCT           0.70 🔴 the DESIGN ceiling, ≈2× TIP_MAX_PCT. Without
                                 it the top tier saturated the safety clamp on
                                 100% of 4,000 samples and quality stopped
                                 mattering entirely — measured, not guessed.
     TIP_FRACTION_MAX       0.95 🔴 last-ditch clamp keeping us below state.js's
                                 `v < 1` fraction test. Should never bind; if it
                                 does, TIP_HARD_PCT is wrong.
     TIP_FRACTION_MIN       0.01 floor, so a served car always drops a coin
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
              'Fine. FINE.',
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
              'I’m telling everyone at the pump. The BAD version.'],
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

   ── 🔴 'unproven' AND WHY IT IS WORTH EXACTLY ZERO ────────────────────────
   The ingredient checks need EVIDENCE: the list of ingredients actually laid on
   each dish that filled the line. That evidence does not exist yet — it is the
   HANDOVER at the bottom of this file, two additive lines in kitchen.state.js.
   Until it lands, `judgeMod()` returns 'unproven' for `hold`/`extra`, and an
   unproven modifier moves the tip by MOD_TIP_UNPROVEN, which is ZERO.

   That is the whole point and it is not a placeholder:
     • it can never PUNISH a player for obeying a ticket the game cannot read;
     • it can never REWARD a player for ignoring one;
     • it is visibly different on screen (`modVerdict()` returns the same three
       words) so a ticket chip reads "—" rather than a lying ✓.
   A guess that moves money is worse than an honest blank. The moment the two
   handover lines land, every `hold`/`extra` on the board starts scoring for
   real with no change here.

   ── WHERE THE EVIDENCE IS READ FROM ───────────────────────────────────────
   `ticket.items[i].builds` — one entry per FILLED unit, in fill order:
       an ARRAY of ingredient ids in the order they were laid, or
       a MAP {ingId: count}, or
       `null` when that unit carried no build record.
   Both shapes are accepted because `slot.steps` is a lay-ordered array today
   and a counted map is the obvious thing somebody optimises it into later. A
   line whose `builds` is missing, empty, or all-null is UNPROVEN — never
   honoured by default, never broken by default.

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
  { id:'no_cheese',   kind:'hold',  w:1,    label:'no cheese',      ing:'cheese',   say:'No cheese. Long story, don’t ask.' },
  { id:'no_mustard',  kind:'hold',  w:1,    label:'no mustard',     ing:'mustard',  say:'No mustard. It gets everywhere.' },
  { id:'extra_must',  kind:'extra', w:1,    label:'extra mustard',  ing:'mustard',  say:'Yellow all over it. All over it.' },
  { id:'extra_pep',   kind:'extra', w:1,    label:'extra pepperoni',ing:'pepperoni',say:'Double the pepperoni. Go on.' },
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
  if (r() >= EC('MOD_CHANCE', 0.30)) return [];
  const rec = recipeOf(recipeId);
  const needs = (rec && rec.needs) || {};

  /* The pool: a modifier must be ABOUT something in this dish (a "no pickle" on
     a fountain soda is a joke that lands once), must not be banned for this
     personality, and — for `no_rush` — must not be coming out of the mouth of
     somebody who just barged the queue. */
  const pool = MODS.filter((m) => {
    if (m.ing && !(needs[m.ing] > 0)) return false;
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

  if (r() < EC('MOD_SECOND_CHANCE', 0.18)) {
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
    tipHit: m.kind === 'gift' ? 0 : EC('MOD_TIP_HIT', 0.35),
    tipMiss: m.kind === 'gift' ? 0 : EC('MOD_TIP_MISS', -0.30),
    // `no_rush` is the exception that proves the mechanic: it asks for nothing
    // and pays nothing, it just makes the customer patient.
    patienceMult: m.id === 'no_rush' ? 1.45 : EC('MOD_PATIENCE_MULT', 0.94),
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

/** The per-unit build records for one ticket line, or [] when there are none. */
function buildsOf(item) {
  if (!item) return [];
  const b = item.builds;
  if (!Array.isArray(b) || !b.length) return [];
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
  const min = Math.max(1, _int(EC('MOD_EXTRA_MIN', 2)));

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

/**
 * Judge every modifier on a ticket.
 * → { mul, honoured, broken, unproven, detail:[{id,label,kind,ing,result,worth}] }
 *
 * `mul` is the generosity multiplier §TIP folds in. Exported through
 * `modVerdict()` so the renderer can draw the SAME three words on the chip that
 * the till paid out on — a verdict the player is told about after the fact and
 * cannot see coming is a mechanic they will never learn.
 */
function judgeTicket(ticket) {
  const out = { mul: 1, honoured: 0, broken: 0, unproven: 0, detail: [] };
  if (!ticket || !Array.isArray(ticket.items)) return out;
  const hit = EC('MOD_TIP_HIT', 0.35);
  const miss = EC('MOD_TIP_MISS', -0.30);
  const meh = EC('MOD_TIP_UNPROVEN', 0);
  for (const item of ticket.items) {
    const mods = (item && Array.isArray(item.mods)) ? item.mods : [];
    for (const m of mods) {
      const result = judgeMod(m, item);
      const worth = result === 'honoured' ? _num(m.tipHit, hit)
                  : result === 'broken'   ? _num(m.tipMiss, miss)
                  : meh;
      out.mul += worth;
      out[result === 'honoured' ? 'honoured' : (result === 'broken' ? 'broken' : 'unproven')]++;
      out.detail.push({
        id: m.id, label: m.label, kind: m.kind, ing: m.ing || null,
        recipeId: item.recipeId, result, worth,
      });
    }
  }
  out.mul = Math.max(0, out.mul);
  return out;
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
    return { mul: 1, honoured: 0, broken: 0, unproven: 0, detail: [] };
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
  const n = f ? _int(f(K.upgrades)) : _int(EC('LANE_CAP', 4));
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
    lo = Math.max(lo, Math.round(lo * EC('BULK_ITEM_MULT', 2.2)));
    hi = Math.max(lo, Math.round(hi * EC('BULK_ITEM_MULT', 2.2)));
  }
  const seats = Math.max(1, _int(carDef && carDef.seats) || 2);
  const ceiling = Math.max(1, _int(EC('ORDER_MAX_ITEMS', 5)));
  // A bulk buyer is the one case allowed past ORDER_MAX_ITEMS, because "a corp
  // buyer placing a bulk order" is meaningless if it is the same size as a
  // hauler's. It still cannot exceed twice the ceiling.
  const hardCap = special === 'bulk' ? ceiling * 2 : ceiling;
  hi = _clamp(hi, 1, Math.min(hardCap, special === 'bulk' ? hardCap : seats));
  lo = _clamp(lo, 1, hi);

  const count = rint(r, lo, hi);
  const likes = (cust && Array.isArray(cust.likes)) ? cust.likes : [];
  const liked = likes.length ? menu.filter((x) => likes.indexOf(x.cat) !== -1) : [];
  const bias = EC('LIKE_BIAS', 0.7);

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
  const maxPerOrder = Math.max(1, _int(EC('MOD_MAX_PER_ORDER', 2)));
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
  if (level < EC('SPECIAL_MIN_LEVEL', 3)) return { special: null, custId: null };
  if (r() >= EC('SPECIAL_CHANCE', 0.11)) return { special: null, custId: null };

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
  let ms = _num(cust && cust.patienceMs, EC('TICKET_BASE_MS', 45000));
  ms *= _num(carDef && carDef.patienceMul, 1);

  let units = 0;
  for (const it of items) units += Math.max(1, _int(it.qty));
  ms += EC('PATIENCE_ITEM_MS', 12000) * Math.max(0, units - 1);

  for (const m of mods) ms *= _num(m.patienceMult, 1);

  if (special === 'bulk')   ms *= EC('BULK_PATIENCE_MULT', 1.9);
  if (special === 'grudge') ms *= EC('GRUDGE_PATIENCE_MULT', 0.70);
  if (special === 'favour') ms *= EC('FAVOUR_PATIENCE_MULT', 1.35);

  return Math.max(EC('PATIENCE_MIN_MS', 20000), Math.round(ms));
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
  b.passers.push({
    id: 'p' + (++b.seq),
    custId: cust ? cust.id : null,
    custName: (cust && cust.name) || 'Someone',
    icon: (cust && cust.icon) || '🧑',
    vehicle: (carDef && carDef.id) || 'hatch',
    vehicleIcon: icon,
    vehicleName: (carDef && carDef.name) || 'Vehicle',
    at: t,
    until: t + EC('LANE_PASSBY_MS', 2600),
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
  bumpPop(K, null, EC('POP_BALK', -0.25), 'balk');
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

    // WHAT THEY ARRIVE IN. A bulk buyer needs a vehicle that can plausibly
    // carry the order, so the pool is filtered by seats before the weighted
    // pick — otherwise the funniest bug in the feature is a corp suit loading
    // forty boxes onto a BMX.
    const cars = Array.isArray(DATA.CARS) ? DATA.CARS : [];
    let pool = cars;
    if (special === 'bulk') {
      const big = cars.filter((c) => _int(c.seats) >= 4);
      if (big.length) pool = big;
    } else if (special === 'jump') {
      const fast = cars.filter((c) => _num(c.patienceMul, 1) <= 0.9);
      if (fast.length) pool = fast;
    }
    const carDef = rweight(r, pool, 'weight') || rpick(r, cars) || { id: 'hatch', icon: '🚗', seats: 2, patienceMul: 1, len: 1 };

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
      balkAt: t + EC('LANE_BALK_MS', 26000),    // patience BEFORE ordering

      // Geometry. pos 0 is the WINDOW, LANE_LEN is the mouth of the lane, and a
      // car spawns past that so it drives on screen instead of appearing.
      pos: EC('LANE_ENTRY_POS', 1.30) * EC('LANE_LEN', 1.0),
      slot: 99,                                 // reassigned by compact() below
      target: EC('LANE_ENTRY_POS', 1.30),       // slot position, from compact()
      _stop: EC('LANE_ENTRY_POS', 1.30),        // where the car AHEAD lets it get to
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
  const cost = EC('JUMP_PATIENCE_COST_MS', 7000);
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
  bumpPop(K, null, EC('POP_JUMP', -0.60), 'queue-jump');
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
  const base = EC('TICKET_BASE_MS', 45000) + EC('TICKET_ITEM_MS', 20000) * units;
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
  const lo = EC('POP_MIN', 0), hi = EC('POP_MAX', 100);
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
    const step = _clamp(_num(dt, 16), 0, EC('MAX_DT_MS', 250));
    if (!Array.isArray(K.lane)) K.lane = [];
    const b = book(K);

    /* 0. SETTLE — §SETTLE. Book any car that finished OUTSIDE one of our verbs
       (the renderer serving through `State.serveTicket()`, or state.js's own
       expiry backstop) before anything else can reap it out from under us. This
       runs first for exactly that reason: step 1 deletes cars, and a car
       deleted before it was booked is a sale the ledger never heard about. */
    settleGone(K, t);

    // 1. REAP. A car in 'exit' still occupies its slot — that IS the blocking.
    const exitMs = EC('LANE_EXIT_MS', 1500);
    if (K.lane.length) {
      const keep = K.lane.filter((c) => !(c && c.state === 'gone' && t - _num(c.leftAt, t) >= exitMs));
      if (keep.length !== K.lane.length) { K.lane = keep; K.rev = _int(K.rev) + 1; }
    }

    // 2. COMPACT — FIFO slots, gone-but-not-reaped cars included.
    compact(K, t);

    // 3a. ROLL — one front-to-back pass, so nobody drives through anybody.
    roll(K, step);

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

    // Drain anything the steps above raised through the buffered path (a
    // fake-`K` harness). Done LAST so a car that spawned this frame reports it
    // this frame rather than one frame late.
    if (b.pending.length) { for (const e of b.pending) out.push(e); b.pending.length = 0; }

    return out;
  } catch (e) {
    return out;   // rule 2. The lane going quiet beats the ovens stopping.
  }
}

/**
 * Assign FIFO slots and the three lane STATIONS the brief asks for
 * (ORDER → PAY → WAIT → COLLECT): the back of the queue is the SPEAKER where
 * you order, the middle is the QUEUE where you wait, and slot 0 is the WINDOW
 * where you pay and collect.
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
  const laneLen = EC('LANE_LEN', 1.0);
  const unit = laneLen / Math.max(1, cap - 1);

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
    c.target = used * unit;
    // Where they physically are, which is what the brief's ORDER → PAY → WAIT →
    // COLLECT is about: slot 0 is the window, the far end is the speaker.
    c.station = i === 0 ? 'window' : (used + Math.max(1, _int(c.len) || 1) >= cap ? 'speaker' : 'queue');
    used += Math.max(1, _int(c.len) || 1);
  }
  K.lane = cars;
}

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
  const step = EC('LANE_ROLL_UNITS_S', 0.55) * (dt / 1000);
  const laneLen = EC('LANE_LEN', 1.0);
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
  if (car.state === 'gone') { car.phase = 'exit'; return; }

  // ── mood, for the face over the car. Cheap, every frame, read by render. ──
  const pct = patiencePct(car, now);
  const mood = pct <= EC('LANE_MOOD_ANGRY', 0.25) ? 'furious'
             : pct <= EC('LANE_MOOD_TESTY', 0.55) ? 'testy'
             : (car.special === 'favour' ? 'happy' : 'ok');
  if (mood !== car.mood) { car.mood = mood; K.rev = _int(K.rev) + 1; }

  // ── APPROACH → ORDER. They order once they have physically reached the
  //    back of the queue, which is where the speaker box is. ─────────────────
  if (car.phase === 'approach') {
    /* They order once they have COME TO REST (`_stop`, which accounts for the
       car in front — see roll()) AND are actually inside the lane rather than
       still queued out on the road. Gating on `target` alone would let a car
       blocked out at the mouth of the lane order from the street, and gating on
       the lane mouth alone would let a still-moving car order mid-roll. */
    const parked = car.pos <= _num(car._stop, car.target) + 0.02;
    const inLane = car.pos <= EC('LANE_LEN', 1.0) + 0.02;
    if (parked && inLane) {
      car.phase = 'order';
      car.state = 'ordering';
      car.orderStartedAt = now;
      say(K, car, speakerLine(car), EC('LANE_ORDER_MS', 2400) + 1200);
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
    if (now - _num(car.orderStartedAt, now) < EC('LANE_ORDER_MS', 2400)) return;
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
  if (pct < EC('LANE_MOOD_TESTY', 0.55) && now >= _num(car.nagAt, 0)) {
    const furious = car.mood === 'furious';
    car.nagAt = now + (furious ? EC('LANE_NAG_ANGRY_MS', 5500) : EC('LANE_NAG_MS', 9000));
    say(K, car, pickLine(K, car, furious ? 'furious' : 'testy'), 3200);
  }

  if (now >= _num(car.expiresAt, Infinity)) giveUp(K, car, 'impatient', now, out);
}

/** Put a line on screen over the car. Render reads `say` / `sayUntil`. */
function say(K, car, text, ms) {
  if (!text) return;
  car.say = String(text);
  car.sayUntil = _num(K.now, 0) + Math.max(600, _num(ms, 2500));
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
function speakerLine(car) {
  const base = String(car._speaker || '').trim();
  const mods = Array.isArray(car.mods) ? car.mods : [];
  if (!mods.length) return base;
  const said = [];
  for (const m of mods) {
    let line = String((m && (m.say || m.label)) || '').trim();
    if (!line) continue;
    // A `say` authored without terminal punctuation still lands as a sentence.
    if (!/[.!?…]$/.test(line)) line += '.';
    said.push(line);
  }
  if (!said.length) return base;
  return base ? `${base} ${said.join(' ')}` : said.join(' ');
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
  if (!car.ticketId) bumpPop(K, out, EC('POP_JAM', -0.90), 'jammed');

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
  const whole = f ? _num(f(_num(K.popularity, 50), _num(K.shift && K.shift.rush, 1)), EC('SPAWN_BASE_MS', 9000))
                  : EC('SPAWN_BASE_MS', 9000);
  const laneShare = _clamp(1 - EC('COUNTER_SHARE', 0.35), 0.05, 1);
  return Math.max(EC('SPAWN_MIN_MS', 1400), whole / laneShare);
}

function scheduleArrivals(K, now, out) {
  const b = book(K);

  // Service has closed for the day: the clock is past DAY_MS, so nobody new
  // joins the lane. The people already in it are still owed their food — that
  // is what state.js's LAST_CALL_MS grace is for.
  const pctFn = DF('dayPct');
  const dayPct = pctFn ? _clamp(_num(pctFn(_num(K.shift.tMs, 0)), 0), 0, 1)
                       : _clamp(_num(K.shift.tMs, 0) / Math.max(1, EC('DAY_MS', 720000)), 0, 1);
  if (dayPct >= 1) return;

  if (!b.nextAt) { b.nextAt = now + EC('SHIFT_GRACE_MS', 4000); return; }
  if (now < b.nextAt) return;

  const j = EC('SPAWN_JITTER', 0.25);
  b.nextAt = now + laneIntervalMs(K) * (1 - j + rnd(K) * 2 * j);
  spawn(K, now, false);
}

/* ═══════════════════════════════════════════════════════════════════════════
   🎬 SERVICE RESOLUTION — §THE TWO VERBS.
   ═══════════════════════════════════════════════════════════════════════════
   These are the ONLY two things a player can do to the lane, and they are the
   entire reason the lane is a game and not an animation. They were also, in the
   round that shipped, DEAD CODE: `grep -rn "serveCar\\|waveCar" public/src
   public/index.html` returned nothing but the two definitions. The renderer
   served through `State.serveTicket()` directly, so the reward moment (the
   customer's `served` line, the regulars ledger, the modifier verdict, the
   stats) never ran, and there was no `data-act="wave"` anywhere so the player's
   escape hatch could not be invoked at all.

   🔴 THE EXACT CALLS THE RENDERER MUST MAKE. Written here rather than "left to
   the wiring" because that is what produced two dead exports last time:

       // in doServe(id, now), where `t` is the ticket being served:
       if (t.source === 'drive' && t.carId) {
         const r = DriveThru.serveCar(State.Kitchen, t.carId, now);
         if (!r.ok) { toast(r.why); return; }
         // r.paid, r.tip, r.line and r.mods are the reward moment — see below.
       } else {
         result(State.serveTicket(t.id, now));
       }

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

/**
 * Hand the food out of the window. THE reward moment.
 *
 * → { ok, code, why, paid, tip, xp, line, mods:[{label,result,worth}],
 *     honoured, broken, custName, icon }
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
 *   • the modifier verdict (§MODIFIERS), captured BEFORE serveTicket runs,
 *     because serveTicket deletes the ticket off the board when it is done and
 *     the verdict is unrecoverable one line later.
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

    // 🔴 BEFORE the till runs — serveTicket() removes the ticket from the board
    //    on success and the per-line mods go with it.
    const verdict = judgeTicket(ticket);

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
    car.state = 'gone';
    car.phase = 'exit';
    car.leftAt = t;
    car.reason = 'served';
    settle(K, car, 'served', t);
    K.rev = _int(K.rev) + 1;

    return {
      ok: true, code: 'OK', why: '',
      paid: _int(res.paid), tip: _int(res.tip), xp: _int(res.xp),
      custName: car.name, icon: car.icon,
      line: car.say || '',
      honoured: verdict.honoured, broken: verdict.broken, unproven: verdict.unproven,
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

    const pop = EC('POP_WAVE', -2.0);
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
    const span = Math.max(1, EC('LANE_BALK_MS', 26000));
    return _clamp((_num(car.balkAt, t) - t) / span, 0, 1);
  }
  const span = Math.max(1, _num(car.patienceMs, EC('TICKET_BASE_MS', 45000)));
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
    const qCeil = Math.max(0.01, EC('Q_PERFECT', 1.25));
    const q = _clamp(_num(quality, 0) / qCeil, 0, 1);
    const pop = _clamp(_num(K && K.popularity, 50) / 100, 0, 1);

    const blend = patience * EC('TIP_PATIENCE_W', 0.45)
                + q        * EC('TIP_QUALITY_W', 0.35)
                + pop      * EC('TIP_POP_W', 0.20);

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

    if (live.special === 'bulk')   gen *= EC('BULK_TIP_MULT', 1.35);
    if (live.special === 'grudge') gen *= EC('GRUDGE_TIP_MULT', 0.45);
    if (live.special === 'favour') gen *= EC('FAVOUR_TIP_MULT', 1.55);

    /* §MODIFIERS scored — and 🔴 NOT AGAINST `quality`. Honouring a promise pays
       MOD_TIP_HIT, breaking it costs MOD_TIP_MISS, and a promise the game
       cannot yet verify is worth MOD_TIP_UNPROVEN, which is zero in either
       direction. The old test — `quality >= MOD_WANT_Q` with both sides equal
       to 1.0 — cleared every modifier on every non-raw dish, so obeying a
       ticket paid LESS than ignoring it. Read the §MODIFIERS header; the
       numbers that proved it are in there.

       It reads the TICKET, not `car.mods`, because the check is PER LINE: "no
       onions" is a promise about the burgers, not about the milkshake next to
       them. `ticketFor()` recovers the ticket even from the `{carId}` stub
       state.js passes once the car has left the lane. */
    const verdict = judgeTicket(ticketFor(K, live) || ticketFor(K, car));
    gen *= verdict.mul;

    /* THREE GUARDS, EACH DOING A DIFFERENT JOB. They were arrived at by
       measuring 4,000 samples per tier, not by feel, and collapsing them into
       one number re-breaks whichever job the survivor was not doing:

         TIP_GEN_MAX    stops RUNAWAY MULTIPLICATION. Modifiers stack (two
                        honoured mods is ×1.7 on their own), so the stack is
                        unbounded in principle. Set high enough that it does
                        not touch a normal customer — its job is to catch the
                        pathological corner, not to shape the curve.
         TIP_HARD_PCT   the DESIGN ceiling. kitchen.data.js calls TIP_MAX_PCT
                        "ceiling as a fraction of payout" and means ~35%; the
                        generosity stack legitimately pushes past that, but not
                        to 95%. Two times the designer's ceiling is the jackpot,
                        and reaching it needs a rare set piece AND the whole
                        ~700k Cinder tip-upgrade path AND perfect execution.
         TIP_FRACTION_MAX  the last-ditch guard that keeps us on the correct
                        side of state.js's `v < 1` fraction test. If this one
                        ever binds, something above it is wrong.

       ⚠ The common case is the one that had to stay sensitive, and it is.
       MEASURED, everything else held identical — an ordinary Commuter at
       popularity 50 on a burgerClassic carrying one "no greens", avgQ 1.0 in
       all three cases, so the ONLY thing moving is the promise:
             honoured  39.2% of the bill
             unproven  29.0%      (the modifier moved nothing — by design)
             broken    20.3%
       That spread is the whole modifier mechanic and it lives nowhere near any
       of these clamps. The previous version of this comment claimed ~32% vs
       ~17%; it was wrong by a factor of thirty, because the check it described
       always passed (§MODIFIERS). Numbers in this comment are re-measured when
       the mechanic changes or they are deleted. */
    const pct = EC('TIP_MAX_PCT', 0.35) * _clamp(blend, 0, 1)
              * _clamp(gen, 0, EC('TIP_GEN_MAX', 4.0));

    return _clamp(Math.min(pct, EC('TIP_HARD_PCT', 0.70)),
                  EC('TIP_FRACTION_MIN', 0.01), EC('TIP_FRACTION_MAX', 0.95));
  } catch (e) {
    return EC('TIP_FRACTION_MIN', 0.01);   // rule 2: a bad tip beats a dead till
  }
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
  const dayMs = EC('DAY_MS', 720000);
  const from = _clamp(_num(o.fromMs, 0), 0, dayMs);
  const to = _clamp(_num(o.toMs, dayMs), from, dayMs);
  const pop = _clamp(_num(o.pop, EC('POP_START', 50)), EC('POP_MIN', 0), EC('POP_MAX', 100));
  const level = Math.max(1, _int(o.level) || 40);
  const upgrades = Array.isArray(o.upgrades) ? o.upgrades : [];
  const share = _clamp(_num(o.laneShare, 1 - EC('COUNTER_SHARE', 0.35)), 0.05, 1);
  const serveRate = _clamp(_num(o.serveRate, 0.7), 0, 1);

  const rushFn = DF('rushAt');
  const intervalFn = DF('spawnIntervalMs');
  const jitter = EC('SPAWN_JITTER', 0.25);
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
    const whole = intervalFn ? _num(intervalFn(pop, rush), EC('SPAWN_BASE_MS', 9000))
                             : EC('SPAWN_BASE_MS', 9000);
    const gap = Math.max(EC('SPAWN_MIN_MS', 1400), whole / share) * (1 - jitter + r() * 2 * jitter);
    tMs += gap;
    if (tMs >= to) break;

    const pick = rollSpecial(fake, r, level);
    const cust = (pick.custId ? customerOf(pick.custId) : null) || rpick(r, roster);
    let pool = cars;
    if (pick.special === 'bulk') { const big = cars.filter((c) => _int(c.seats) >= 4); if (big.length) pool = big; }
    const carDef = rweight(r, pool, 'weight') || { id: 'hatch', seats: 2, patienceMul: 1 };
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
       `serveRate` is the assumed hit rate of the player being modelled — 0.7 is
       a competent shift. Pass 1 to model a perfect one, 0 to model a disaster,
       and the grudge/favour mix moves the way it does in play. */
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
 */
export function laneStatus(K, now) {
  if (!K) {
    return { cap: 0, used: 0, live: 0, spare: 0, full: false, label: 'Lane closed',
             nextInMs: 0, intervalMs: 0, stats: null };
  }
  const b = book(K);
  const t = _num(now, K.now);
  const cap = capOf(K);
  const used = usedUnits(K);
  const live = (K.lane || []).filter((c) => c && c.state !== 'gone').length;
  const full = used >= cap;
  const spare = Math.max(0, cap - used);

  let label;
  if (!live) label = full ? 'Lane blocked' : 'Lane clear';
  else label = `${live} car${live === 1 ? '' : 's'}` + (full ? ' · lane full' : ` · room for ${spare}`);

  return {
    cap,          // LENGTH UNITS
    used,         // LENGTH UNITS
    spare,        // LENGTH UNITS
    live,         // CARS
    full,
    label,        // ← print this
    nextInMs: Math.max(0, _num(b.nextAt, t) - t),
    intervalMs: Math.round(laneIntervalMs(K)),
    stats: b.stats,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   🖼 §RENDER — the six fields the lane computes every frame and nobody drew.
   ═══════════════════════════════════════════════════════════════════════════
   A measured 84px strip of four emoji is what this lane looked like on a phone,
   while the sim underneath was computing all of this per car per frame and
   throwing it away. This is the say-so for each one — WHAT it is and WHAT to
   draw — and `laneCard()` below hands the whole set over pre-chewed so a
   renderer never has to reach into `K._lane` or re-derive a mood.

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
      mods: (Array.isArray(it.mods) ? it.mods : []).map((m) => ({
        id: m.id, label: m.label, kind: m.kind, ing: m.ing || null,
        ingIcon: ingIconOf(m.ing),
        result: ticket ? judgeMod(m, it) : 'unproven',
      })),
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
    const span = Math.max(1, EC('LANE_PASSBY_MS', 2600));
    const out = [];
    for (const p of (book(K).passers || [])) {
      const pct = _clamp((t - _num(p.at, t)) / span, 0, 1);
      if (pct >= 1) continue;
      out.push({
        id: p.id, custId: p.custId, custName: p.custName, icon: p.icon,
        vehicle: p.vehicle, vehicleIcon: p.vehicleIcon, vehicleName: p.vehicleName,
        pct,
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

/* ═══════════════════════════════════════════════════════════════════════════
   📌 HANDOVER NOTES — the things this file needs from other people's files.
   ═══════════════════════════════════════════════════════════════════════════
   CONTRACT.md: "If you need something this contract does not give you, do not
   invent it locally — say so and it gets added HERE first." These are the
   say-sos. Everything below WORKS today; each one would work better with a
   small addition somebody else owns.

   1. ECON KEYS. The block near the top of this file lists 24 keys this module
      reads that kitchen.data.js does not define yet. They are all lane concepts
      and they belong in ECON, not in `EC()` fallbacks here. Nothing breaks
      until somebody wants to retune the lane and cannot find the numbers.

   2. 🔴 MODIFIER EVIDENCE — THE ONE THING THIS FILE IS STILL WAITING FOR.
      §MODIFIERS is now a literal three-way check ('honoured' | 'broken' |
      'unproven') instead of a quality comparison that always passed. `cook`
      mods ("well done") already score for real off `item.pn` / `item.filled`,
      which state.js already maintains. The INGREDIENT mods — every `hold` and
      every `extra`, which is the great majority of them — read 'unproven' and
      are worth exactly zero until kitchen.state.js records what was built.

      TWO ADDITIVE LINES, NEITHER OF WHICH CHANGES AN EXISTING NUMBER:

        (a) in `plateHand(now)`, on the dish object it pushes onto `K.pass`:
                steps: Array.isArray(K.hand.steps) ? K.hand.steps.slice() : null
            i.e. the ingredient ids the player actually laid, in lay order.
            (`addStep` already maintains `slot.steps`; `pullSlot` currently
            discards it into `K.hand` and `plateHand` drops it on the floor.)

        (b) in `fillTickets(now)`, where a dish fills a unit of a ticket line,
            immediately after `item.filled++`:
                (item.builds || (item.builds = [])).push(
                  Array.isArray(dish.steps) ? dish.steps.slice() : null);
            EXACTLY ONE ENTRY PER FILLED UNIT, in fill order, `null` when that
            unit carried no build record.

      This file accepts either an array of ingredient ids or a counted map
      `{ingId: n}` per unit (`countIn()`), so an optimisation later cannot break
      it. `newTicket()` does NOT need to preserve `item.mods` — we attach those
      to the filed ticket ourselves, matched by recipeId (see `fileTicket()`).
      Nothing throws, nothing changes and nothing pays differently until (a) and
      (b) land; on the frame they do, every "no onions" on the board becomes a
      real promise with real money on it.

   3. `patiencePct` DIRECTION and `tipFor` RETURN TYPE. Both are ambiguous in
      CONTRACT.md and both are resolved defensively here and in kitchen.state.js
      (see §TIP and `patiencePct`). They want writing down properly in §1 so the
      next reader does not have to reconstruct the reasoning from two comments
      in two files.

   4. RENDER READS. `laneView()`, `laneStatus()`, `laneCard()`, `passersBy()`,
      `modVerdict()` and `regulars()` are the public shape of the lane. A
      renderer reaching into `K._lane` directly is a renderer that breaks the
      next time this file is retuned. §RENDER above says what to draw with each
      field; `laneCard()` hands the whole pinned-strip payload over resolved.

   5. THE TWO VERBS ARE THE WIRING (§THE TWO VERBS). `serveCar(K, carId, now)`
      and `waveCar(K, carId, now)` are the only two things a player can do to
      the lane and both shipped with zero callers. The exact call sites the
      renderer needs are written out in full in §THE TWO VERBS; they are two
      small edits to `doServe()` and the `onClick` switch in kitchen.render.js.

   6. `car:balk` IS A NEW EVENT (§BALK) and it is the biggest number in the
      lane. It wants adding to kitchen.render.js's TOAST_RANK — below
      `ticket:lost`, so it is rate-limited but present — with a `toastLine()`
      case reading something like `🚗 ${e.custName} drove past a full lane.`
   ═══════════════════════════════════════════════════════════════════════════ */
