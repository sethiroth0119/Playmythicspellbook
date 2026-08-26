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
        what they order and how long they will tolerate you, and three lines of
        dialogue (speaker, window, leaving).
     5. Occasionally somebody memorable turns up: a corp buyer with a bulk
        order, a raider who takes the front of the queue by force, or a regular
        who came back this shift with a grudge or a favour.

   🔴 THE FOUR HARD RULES THIS FILE LIVES UNDER
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
     LANE_NAG_MS           9000  minimum gap between a car's window nags, so a
                                 waiting customer talks instead of shouting.

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
     MOD_CHANCE             0.30 chance an ordered item carries a modifier
     MOD_PATIENCE_MULT      0.94 a fussy order is a fussier customer
     MOD_WANT_Q             1.0  the avg quality multiplier a mod demands
     MOD_TIP_HIT            0.35 tip multiplier bonus when the bar is cleared
     MOD_TIP_MISS          -0.30 …and the penalty when it is not

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
   🗣 THE VOICE — dialogue at the speaker, at the window, and on leaving.
   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS TABLE LIVES HERE AND NOT IN kitchen.data.js: the ECON rule is about
   ECONOMY NUMBERS ("a literal economy number in any other kitchen file is a
   bug"). This is content, not tuning, and the lane owns the lane's voice —
   nothing outside this file reads it. kitchen.data.js already ships ONE `line`
   per customer for the ticket header; these are the other three moments, keyed
   by the same CUSTOMERS ids so the two can never drift apart. A customer id
   with no entry here falls through to GENERIC and still talks.

   ⚠ THE VOICE IS THE JOKE AND IT HAS TO LAND. Mythic Spellbook is a
   post-collapse survivor game. These are people buying hot food in a ruined
   city — a gate guard whose relief eats what he does not, a vault family whose
   daughter has never had a hot meal, a courier who counts every second spent
   in the open. Write them as survivors who found a working restaurant, never
   as suburban commuters at a window. A generic "one burger please" line is not
   neutral, it is wrong, and it quietly deletes the setting.
   ═══════════════════════════════════════════════════════════════════════════ */
const VOICE = {
  commuter: {
    speaker: ['Same as yesterday. Assuming yesterday still counts.', 'Usual. Don’t make it interesting.'],
    wait:    ['The convoy leaves at six whether I’m on it or not.', 'I do this drive twice a day. This is the good part.'],
    served:  ['Still warm. That’s a good sign.', 'See you tomorrow. Probably.'],
    angry:   ['I’ll eat at the checkpoint. Again.', 'Fine. FINE.'],
  },
  courier: {
    speaker: ['Engine’s running. Talk fast.', 'One hand on the bars, so make it one bag.'],
    wait:    ['Every second here is a second in the open.', 'Clock’s on the parcel, not on you. Sadly.'],
    served:  ['You’re on my good list. That list is short.', 'Eating this at ninety. Worth it.'],
    angry:   ['Keeping the parcel. Losing the appetite.', 'You just cost me the run bonus.'],
  },
  scav: {
    speaker: ['Whatever’s cheap and whatever’s hot.', 'Surprise me. Low bar, mind.'],
    wait:    ['I’ve waited out a dust storm. I can wait out you.', 'Take your time. Nothing out there’s going anywhere.'],
    served:  ['First hot thing I’ve had in a week.', 'That’s a good day, that is.'],
    angry:   ['Back to the tins, then.', 'Should’ve known. Should’ve known.'],
  },
  trucker: {
    speaker: ['Feed the whole cab. They’ve been rationing since the ridge.', 'Big one. Six of us and a dog.'],
    wait:    ['Rig’s idling. Fuel isn’t free out here.', 'Boys in the back are getting ideas.'],
    served:  ['That’ll get us to the next depot.', 'You’re marked on my map. The good marker.'],
    angry:   ['Rolling. Tell the ridge I tried.', 'Depot food it is. Cruel.'],
  },
  medic: {
    speaker: ['Twelve hours in. Something hot, something with sugar.', 'I stopped tasting things at hour nine. Feed me anyway.'],
    wait:    ['I have people bleeding who wait less than this.', 'If I fall asleep at this window, tap the glass.'],
    served:  ['You just bought yourself a free stitch-up.', 'This is the best part of my night and my night has been terrible.'],
    angry:   ['If you ever come into my ward, I’ll remember this.', 'Back to the vending machine. Back to the abyss.'],
  },
  suit: {
    speaker: ['I am on a clock and the clock bills by the minute.', 'Corp account. Itemise it. Quickly.'],
    wait:    ['This is going in the quarterly.', 'I could buy this building. I would rather have lunch.'],
    served:  ['Acceptable. Keep the change, it isn’t mine.', 'Noted favourably. Do not read into that.'],
    angry:   ['Noted. Your permit renewal is in March.', 'I’ll be recommending the other one.'],
  },
  kid: {
    speaker: ['Fries. Just fries. I’ve got the caps, look.', 'Can I get the one with the — the crispy — yeah, that.'],
    wait:    ['My mum says the old world had these in five minutes.', 'Is it nearly? Is it nearly?'],
    served:  ['Best day. BEST day.', 'I’m telling EVERYONE at the pump.'],
    angry:   ['Fine. I’ll go to the noodle guy. He’s worse but he’s FAST.', 'That’s not fair and you know it.'],
  },
  raider: {
    speaker: ['Make it fast and nobody’s day gets ruined.', 'Food. Now. That’s the whole conversation.'],
    wait:    ['You’re testing something you shouldn’t test.', 'I count to ten. I’m at six.'],
    served:  ['Huh. Good. We’ll skip this block next run.', 'You get to keep the sign. For now.'],
    angry:   ['We’ll be back. Not for food.', 'Remember this window. I will.'],
  },
  family: {
    speaker: ['Big order, sorry — first time out of the vault in years.', 'Whatever you’d feed your own. All of it.'],
    wait:    ['The little one’s never had a hot meal. Please.', 'We can wait. We’re very good at waiting.'],
    served:  ['She’s crying. Good crying. Thank you.', 'We’ll be telling people about tonight.'],
    angry:   ['It’s fine. We’ll tell her they were sold out.', 'Come on, love. Back in the truck.'],
  },
  mayor: {
    speaker: ['This is for the office. It’s not for me. It’s for the office.', 'Council order. Discreetly, if you can.'],
    wait:    ['The Mayor doesn’t wait. Which means I don’t wait.', 'There is a meeting. There is always a meeting.'],
    served:  ['The council will hear about this favourably.', 'Your water ration is safe another quarter.'],
    angry:   ['Your road resurfacing just moved to next year.', 'I’ll note that the vendor was unable to comply.'],
  },
  ghoul: {
    speaker: ['Been coming here forty years. Longer than the crater.', 'The usual. You know the usual. Your grandad knew it.'],
    wait:    ['Take your time. I’ve got nothing but.', 'Used to be a bank here. Terrible food.'],
    served:  ['Tastes the same as before. Highest thing I can say.', 'Good lad. Good lad.'],
    angry:   ['Ah, well. Been a long life of missing lunch.', 'No matter. No matter at all.'],
  },
  guard: {
    speaker: ['Two of everything. The gate doesn’t feed us.', 'Shift order. Don’t skimp, we check.'],
    wait:    ['My relief’s in ten and he eats what I don’t.', 'Anything moves in that lane, I’m getting out.'],
    served:  ['Your name’s on the friendly list at the north gate.', 'Straight through next time. No search.'],
    angry:   ['Gate’s closing at dusk. Don’t be late tonight.', 'That’s a shame. That’s a real shame.'],
  },
};

/* Fallback voice. A customer id with no VOICE entry still speaks — silence at
   the speaker box reads as a broken game, not as a quiet customer. */
const GENERIC = {
  speaker: ['Whatever’s hot and whatever’s left.', 'Food. Please. Any food.'],
  wait:    ['Still here.', 'Any minute now, yeah?'],
  served:  ['Appreciated. Genuinely.', 'That’s the day turned around.'],
  angry:   ['Forget it.', 'Not worth the fuel.'],
};

/* Set-piece lines. These OVERRIDE the customer's own for the moment that makes
   them a set piece, then hand back to the personality. */
const SPECIAL_VOICE = {
  bulk:   { speaker: ['Corp order. Full box, itemised, and I’ll need it hot.', 'Bulk purchase. The whole floor eats or nobody does.'],
            served:  ['Invoice it. And — genuinely — thank you.', 'The floor will hear it was you.'],
            angry:   ['Cancel it. The floor eats ration bars and knows why.', 'That was a standing order. Was.'] },
  jump:   { speaker: ['The line moved. I moved it.', 'Front of the queue. Don’t make it a thing.'],
            served:  ['See? Nobody had to bleed.', 'Efficient. I like efficient.'],
            angry:   ['Everyone in this lane saw that.', 'You had one job and a very short queue.'] },
  grudge: { speaker: ['You dropped my order an hour ago. Second chance.', 'Back again. Prove the last one was a fluke.'],
            served:  ['…Alright. We’re square.', 'Forgiven. Not forgotten, but forgiven.'],
            angry:   ['Twice. TWICE. I’m telling the whole block.', 'That’s the last time I give anyone a second go.'] },
  favour: { speaker: ['Told three people about this place. Don’t make a liar of me.', 'Back for more. That’s the review.'],
            served:  ['That’s four people I’m telling now.', 'Never doubted it.'],
            angry:   ['I VOUCHED for you.', 'Well. I look stupid now, don’t I.'] },
};

function voiceFor(custId, key, special, r) {
  const pool = (special && SPECIAL_VOICE[special] && SPECIAL_VOICE[special][key])
            || (VOICE[custId] && VOICE[custId][key])
            || GENERIC[key] || [];
  return rpick(r, pool) || '';
}

/* ═══════════════════════════════════════════════════════════════════════════
   🥬 §MODIFIERS — "no onions", "extra chili".
   ═══════════════════════════════════════════════════════════════════════════
   A modifier is a REQUEST attached to an ordered item. It shows on the ticket,
   it shows at the speaker box, it shortens the customer's fuse a little, and it
   is scored at the window: clear the quality bar and the tip goes up, miss it
   and the tip goes down. That is real money moving on a real check.

   🔴 WHAT A MODIFIER CANNOT DO YET, AND WHY — READ BEFORE "FIXING" IT.
   The obvious implementation is "if the ticket says no onions, check that the
   delivered dish had no onion on it". That check is NOT POSSIBLE across the
   current module boundary, and pretending otherwise would ship a mechanic that
   silently always passes:
     • `State.newTicket()` rebuilds each item as {recipeId, qty, filled, qsum,
       xn, pn} — any extra field on the way in is DROPPED. (We attach `mods` to
       the ticket AFTER it is filed, which survives, but state.js does not read
       it.)
     • `fillTickets()` matches a dish to an item on `recipeId` alone.
     • `plateHand()` writes {id, recipeId, quality, mult, madeAt} — the
       `slot.steps` array that records what the player ACTUALLY laid on is
       discarded at `pullSlot()`.
   So the only honest signal that reaches the window is `avgQ`, the average
   quality multiplier of the units that filled the ticket — which does fold in
   the build-order bonus from `scoreBuild()`, and therefore does measure care.
   We score modifiers against THAT and we say so out loud, here and on screen.

   ⚠ HANDOVER, in the shape CONTRACT.md asks for: making "no onions" literally
   checkable needs two additions to kitchen.state.js — `newTicket` preserving an
   `item.mods` array, and `plateHand` carrying `slot.steps` onto the dish. Both
   are additive and neither changes an existing number. That belongs in
   CONTRACT.md §1 before anyone writes it; it is not something this file may
   reach across and do.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Modifier vocabulary. `ing` is advisory (which ingredient it is about) so a
   renderer can draw the right bin icon; nothing keys off it. */
const MODS = [
  { id: 'no_onion',   kind: 'hold',  label: 'no onions',     ing: 'onion',   say: 'no onions, they repeat on me' },
  { id: 'no_pickle',  kind: 'hold',  label: 'no pickle',     ing: 'pickle',  say: 'hold the pickle' },
  { id: 'no_sauce',   kind: 'hold',  label: 'sauce on side',  ing: 'sauce',   say: 'sauce on the side, I’m driving' },
  { id: 'no_lettuce', kind: 'hold',  label: 'no greens',     ing: 'lettuce', say: 'no greens. I get enough green in the water' },
  { id: 'extra_chz',  kind: 'extra', label: 'extra cheese',  ing: 'cheese',  say: 'extra cheese, I’ll pay for it' },
  { id: 'extra_chili',kind: 'extra', label: 'extra chili',   ing: 'chili',   say: 'extra chili. Serious extra' },
  { id: 'extra_sauce',kind: 'extra', label: 'double sauce',  ing: 'sauce',   say: 'drown it' },
  { id: 'well_done',  kind: 'extra', label: 'well done',     ing: null,      say: 'well done — properly well done' },
  { id: 'no_rush',    kind: 'hold',  label: 'take your time', ing: null,     say: 'honestly, take your time' },
];

/**
 * Roll a modifier for one ordered item. Returns null most of the time — a lane
 * where every order is fussy is a lane where fussiness stops meaning anything.
 * `no_rush` is deliberately in the same pool as the demanding ones: it is the
 * one modifier that BUYS the player time, and finding it in the list is the
 * reason to read the list.
 */
function rollMod(r, recipeId) {
  if (r() >= EC('MOD_CHANCE', 0.30)) return null;
  const rec = recipeOf(recipeId);
  const needs = (rec && rec.needs) || {};
  // Prefer a modifier that is actually about something in this dish. A "no
  // pickle" on a fountain soda is a joke that only lands once.
  const relevant = MODS.filter((m) => !m.ing || needs[m.ing] > 0);
  const m = rpick(r, relevant.length ? relevant : MODS.filter((x) => !x.ing));
  if (!m) return null;
  return {
    id: m.id,
    kind: m.kind,
    label: m.label,
    ing: m.ing,
    say: m.say,
    // The quality bar this request has to clear at the window, and what it is
    // worth either way. Held here so a renderer can show the stakes.
    wantQ: EC('MOD_WANT_Q', 1.0),
    tipHit: EC('MOD_TIP_HIT', 0.35),
    tipMiss: EC('MOD_TIP_MISS', -0.30),
    // `no_rush` is the exception that proves the mechanic: it asks for nothing
    // and pays nothing, it just makes the customer patient.
    patienceMult: m.id === 'no_rush' ? 1.45 : EC('MOD_PATIENCE_MULT', 0.94),
  };
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
      stats: { arrived: 0, served: 0, lost: 0, balked: 0, waved: 0, jumped: 0 },
    };
  }
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
  // Modifiers, rolled per LINE rather than per unit — "two burgers, no onions"
  // is one instruction a cook can hold in their head; two burgers with two
  // different modifiers each is a spreadsheet.
  for (const it of items) {
    const m = rollMod(r, it.recipeId);
    if (m) it.mods.push(m);
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
/** Somebody drove up to a full lane and kept driving. A tiny popularity nick,
    not a punishment: a full lane is usually a compliment, and what was lost is
    the sale, not the reputation. This is the pressure valve the whole
    difficulty curve leans on — see the ECON header's hour-by-hour model. */
function balk(K, b) {
  b.stats.balked++;
  bumpPop(K, null, EC('POP_BALK', -0.25), 'balk');
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
    // The cheap rejection first: no room for even a bike, so nobody is picked
    // and no RNG is spent describing a customer who never arrives.
    if (usedUnits(K) >= cap && !force) return balk(K, b);
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

    // …and the second rejection, now that we know how long the vehicle IS. A
    // road train needs two lengths of lane and will drive past a gap that a
    // hatchback would have taken. That is true to life and it is also why the
    // occupancy test could not simply live at the top of this function.
    if (!force && usedUnits(K) + Math.max(1, _int(carDef.len) || 1) > cap) return balk(K, b);

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
     renderer draws under each line and `tipFor()` scores at the window. See
     §MODIFIERS for what it can and cannot yet mean. */
  try {
    ticket.mods = car.mods.slice();
    for (let i = 0; i < ticket.items.length; i++) {
      const src = car.items[i];
      if (src && Array.isArray(src.mods) && src.mods.length) ticket.items[i].mods = src.mods.slice();
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
    say(K, car, pickLine(K, car, 'wait'), 2600);
    K.rev = _int(K.rev) + 1;
  }

  // The window nag. Once they are past testy they start saying so — spaced by
  // LANE_NAG_MS so a waiting customer TALKS rather than shouts every frame.
  if (pct < EC('LANE_MOOD_TESTY', 0.55) && now >= _num(car.nagAt, 0)) {
    car.nagAt = now + EC('LANE_NAG_MS', 9000);
    say(K, car, pickLine(K, car, 'wait'), 3200);
  }

  if (now >= _num(car.expiresAt, Infinity)) giveUp(K, car, 'impatient', now, out);
}

/** Put a line on screen over the car. Render reads `say` / `sayUntil`. */
function say(K, car, text, ms) {
  if (!text) return;
  car.say = String(text);
  car.sayUntil = _num(K.now, 0) + Math.max(600, _num(ms, 2500));
}

function pickLine(K, car, key) {
  const r = () => rnd(K);
  return voiceFor(car.custId, key, car.special, r);
}

/**
 * The speaker-box line: the personality's own opener, plus the modifiers spoken
 * aloud. "Two burgers — no onions, they repeat on me" is the whole modifier
 * system delivered as a sentence, which is worth more than a badge on a ticket.
 */
function speakerLine(car) {
  const base = car._speaker || '';
  if (!car.mods.length) return base;
  const say = car.mods.map((m) => m.say || m.label).join(', and ');
  return base ? `${base} — ${say}.` : `${say}.`;
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
  car.mood = 'furious';
  say(K, car, pickLine(K, car, 'angry'), 3000);
  remember(K, car, 'lost');
  book(K).stats.lost++;
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

/** The regulars ledger (per shift — see `book()`). */
function remember(K, car, outcome) {
  if (!car || !car.custId) return;
  const mem = book(K).mem;
  const m = mem[car.custId] || (mem[car.custId] = { served: 0, lost: 0, waved: 0, lastAt: 0 });
  if (outcome === 'served') m.served++;
  else if (outcome === 'waved') m.waved++;
  else m.lost++;
  m.lastAt = _num(K.now, 0);
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
   SERVICE RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hand the food out of the window.
 *
 * Deliberately THIN. `State.serveTicket()` is the payer: it prices the ticket
 * (§8.3), calls `bridge().addGems`, moves popularity, awards XP, emits `pay`,
 * `ticket:served` and `car:served`, and calls its own `releaseCar()` which sets
 * `car.state = 'gone'` and emits `car:leave`. Re-implementing ANY of that here
 * would be a second copy of the payout rules in a file that must not own money.
 *
 * ⚠ WHAT THIS FUNCTION MUST NOT DO: emit `car:served` or `car:leave`. state.js
 * already emitted both by the time it returns, and a duplicate is two float-ups
 * and two toasts for one burger. All that is left for us is to dress the car
 * for its exit and write the regulars ledger.
 */
export function serveCar(K, carId, now) {
  const fail = (code, why) => ({ ok: false, code, why, paid: 0, tip: 0 });
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

    let res = null;
    try {
      if (typeof State.serveTicket === 'function' && State.Kitchen === K) {
        res = State.serveTicket(ticket.id, t);
      }
    } catch (e) { res = null; }
    if (!res) return fail('NOT_READY', 'The till would not take that order.');
    if (!res.ok) return { ok: false, code: res.code || 'NOT_READY', why: res.why || '', paid: 0, tip: 0 };

    // state.js's releaseCar() has already flipped this car to 'gone'. Dress it.
    car.state = 'gone';
    car.phase = 'exit';
    car.leftAt = t;
    car.reason = 'served';
    car.mood = 'happy';
    say(K, car, pickLine(K, car, 'served'), 3000);
    remember(K, car, 'served');
    book(K).stats.served++;
    K.rev = _int(K.rev) + 1;

    return { ok: true, code: 'OK', why: '', paid: _int(res.paid), tip: _int(res.tip), xp: _int(res.xp) };
  } catch (e) {
    return fail('BAD_ARG', 'Something went wrong at the window.');
  }
}

/**
 * Wave one away. The player's escape hatch, and it is not a free one.
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
  try {
    if (!K) return false;
    const t = _num(now, K.now);
    const car = findCar(K, carId);
    if (!car || car.state === 'gone') return false;

    if (car.ticketId && Array.isArray(K.tickets)) {
      const before = K.tickets.length;
      K.tickets = K.tickets.filter((x) => !(x && x.id === car.ticketId));
      if (K.tickets.length !== before) K.rev = _int(K.rev) + 1;
    }

    car.state = 'gone';
    car.phase = 'exit';
    car.leftAt = t;
    car.reason = 'waved';
    car.mood = 'furious';
    car.ticketId = null;
    say(K, car, pickLine(K, car, 'angry'), 3000);
    remember(K, car, 'waved');
    book(K).stats.waved++;
    K.rev = _int(K.rev) + 1;

    bumpPop(K, null, EC('POP_WAVE', -2.0), 'waved');
    raiseLater(K, 'car:leave', { carId: car.carId, custId: car.custId, reason: 'waved', served: false });
    return true;
  } catch (e) {
    return false;
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

    // §MODIFIERS scored. Clearing the bar pays; missing it costs. Read the big
    // block at MODS for exactly what `quality` can and cannot prove here.
    const mods = Array.isArray(live.mods) ? live.mods : [];
    if (mods.length) {
      let modMul = 1;
      for (const m of mods) {
        const cleared = _num(quality, 0) >= _num(m.wantQ, EC('MOD_WANT_Q', 1.0));
        modMul += cleared ? _num(m.tipHit, EC('MOD_TIP_HIT', 0.35))
                          : _num(m.tipMiss, EC('MOD_TIP_MISS', -0.30));
      }
      gen *= Math.max(0, modMul);
    }

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

       ⚠ The common case is the one that had to stay sensitive, and it is: an
       ordinary customer with one modifier tips ~32% honoured against ~17%
       missed. That difference is the whole modifier mechanic, and it lives
       nowhere near any of these clamps. */
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

   opts: { seed, fromMs, toMs, pop, level, upgrades, laneShare }
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

    // A replayed arrival is remembered too, so grudges and favours replay.
    if (cust && cust.id) {
      const mem = book(fake).mem;
      const m = mem[cust.id] || (mem[cust.id] = { served: 0, lost: 0, waved: 0, lastAt: 0 });
      m.served++;
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
 * ⚠ `cap` and `used` are in LENGTH UNITS (a rig is 2), because that is the unit
 * the cap is actually enforced in — see compact(). `live` is a plain head-count
 * for the "3 cars waiting" line, and the two will legitimately disagree the
 * moment a road train pulls in. Reporting only the head-count is how a HUD ends
 * up saying "3 / 4" next to a lane that is refusing new arrivals.
 */
export function laneStatus(K, now) {
  if (!K) return { cap: 0, used: 0, live: 0, full: false, nextInMs: 0, intervalMs: 0, stats: null };
  const b = book(K);
  const t = _num(now, K.now);
  const cap = capOf(K);
  const used = usedUnits(K);
  return {
    cap,
    used,
    live: (K.lane || []).filter((c) => c && c.state !== 'gone').length,
    full: used >= cap,
    nextInMs: Math.max(0, _num(b.nextAt, t) - t),
    intervalMs: Math.round(laneIntervalMs(K)),
    stats: b.stats,
  };
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

   2. MODIFIERS, PROPERLY CHECKABLE (§MODIFIERS). Two additive changes to
      kitchen.state.js would turn "no onions" from a tip-weighted request into a
      literal check: `newTicket()` preserving `item.mods`, and `plateHand()`
      carrying `slot.steps` onto the dish so the window can see what was
      actually built. Neither changes an existing number.

   3. `patiencePct` DIRECTION and `tipFor` RETURN TYPE. Both are ambiguous in
      CONTRACT.md and both are resolved defensively here and in kitchen.state.js
      (see §TIP and `patiencePct`). They want writing down properly in §1 so the
      next reader does not have to reconstruct the reasoning from two comments
      in two files.

   4. RENDER READS. `laneView()`, `laneStatus()` and `regulars()` are the public
      shape of the lane. A renderer reaching into `K._lane` directly is a
      renderer that breaks the next time this file is retuned.
   ═══════════════════════════════════════════════════════════════════════════ */
