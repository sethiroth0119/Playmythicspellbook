/* ═══════════════════════════════════════════════════════════════════════════
   🚚 convoy.js — PLAYER-TO-PLAYER SHIPPING. Composition · route · transit ·
   arrival · claim. The loading bay behind the kitchen.
   ═══════════════════════════════════════════════════════════════════════════

   WHAT THIS FILE IS
   "Set up a shipment to send to another player's city on a convoy that will
   send the player food." Everything that sentence implies lives here:

     1. COMPOSITION — you pick a truck, you pick BOXES off the pass (a manifest,
        not a dump), capacity and the level gate are real, and the freight fee
        is charged in Cinder at launch.
     2. THE ROUTE — five named legs across a ruined city, with incidents that
        can cost you boxes. Deterministic, server-seeded, and it can only ever
        SUBTRACT (see §3).
     3. TRANSIT — a wall-clock countdown measured in HOURS, on the SERVER clock.
     4. ARRIVAL — the truck lands whether or not the panel is open.
     5. CLAIM — the recipient unloads it into the live `food` ledger, exactly
        once, through a server RPC that reports whether THIS call was the one
        that paid.

   ── 🔴 WHAT CHANGED IN ROUND 2, AND WHY ─────────────────────────────────────
   Round 1 shipped a convoy system nobody could actually use: the renderer
   hardcoded the recipient to the player's own user id, so `self` was always
   true, `API.insertConvoy` was never reached, and sql/038 guarded a feature
   that could not be performed. Three real defects came out of the review and
   all three are closed here:

     A. DOUBLE PAYOUT. `kitchen_convoy_claim()` returned the convoy row on an
        already-claimed convoy with no signal about whether the ledger insert
        actually happened, and this file treated any `ok` as authorisation to
        credit the stash. Two tabs claiming one 40-box truck credited 80 food.
        FIX: the RPC now returns `first_claim` and `delivered_dishes`, and
        **THE ONLY NUMBER THIS FILE MAY PAY OUT ON IS `delivered_dishes`** — the
        boxes THIS CALL delivered. A replay returns 0 and pays 0. See `claim()`.

     B. PARTIAL UNLOAD DESTROYED THE REMAINDER. When the stash cap short-landed
        a claim, the client kept the inbound row and said "30 food is still on
        the truck" — but the server had already flipped that row to `claimed`,
        `listInbound()` filters claimed rows out, and the next 60s heartbeat
        deleted the truck. FIX: THE DEPOT HOLD (§4). Once the server says
        delivered, the truck is over; the remainder becomes a HELD row in
        `K.convoys` (which IS persisted) and drains into the stash as room
        appears. Ownership of the truth is written out in §4 in one paragraph.

     C. CLIENT-CLOCK ARRIVAL. `arrives_at` was computed on the device clock and
        the only server check was `arrives_at > now()`, so a tampered client
        landed a truck in 1ms and a player with a slow clock could never ship at
        all. FIX: `kitchen_convoy_launch()` computes `arrives_at` from the
        SERVER clock; the client posts a transit DURATION, not a timestamp, and
        adopts the server's answer (with a skew correction, §2).

   🔴 THE SIX HARD RULES THIS FILE LIVES UNDER

   1. NO DOM. NO TIMERS. NO `Date.now()`. `now` and `dt` arrive as arguments
      from the one RAF loop in index.js (CONTRACT §3). A convoy module that read
      the wall clock itself could not be replayed by a headless test, and the
      arrival maths is the part most worth testing.

      ⚠ AND YET convoys ARE the wall-clock system (CONTRACT §4). There is no
      contradiction: the *value* of `now` is a wall-clock read, it is just taken
      by index.js and handed down. `catchUp(K, now)` is what closes the gap for
      the hours the panel was shut, and it is idempotent so calling it from both
      `init()` and `open()` — which state.js deliberately does — cannot
      double-arrive anything.

   2. NEVER THROW. state.js wraps our `tick()` in a try/catch commented "a
      convoy module mid-write must not stop you cooking", which is correct and
      is also not a licence. A throw here silently deletes shipping for the rest
      of the session with nothing on screen to say so. Every entry point returns
      a value; none of them raise. `claim()`, `launch()` and `recipients()` are
      `async` and therefore return REJECTED PROMISES if they throw — which
      render would swallow into "the convoy did not leave" with no reason — so
      they are wrapped too.

   3. WE MAY MUTATE `K`. CONTRACT rule 2 names exactly three files:
      kitchen.state.js, drivethru.js, convoy.js. We own `K.convoys` and
      `K.inbound` outright. We take dishes off `K.pass` (that is the whole
      point) and we move `K.xp` / `K.level` on arrival — see `grantXp()` for why
      that one is written out here instead of called.

   4. 🔴 A CONVOY MOVES VALUE. IT NEVER MINTS IT. This is the single most
      dangerous surface in the feature and ECON says so in capitals. The dishes
      were bought out of the 14-id live ledger via `buySupply()`, so a claim
      pays `deliveredDishes × ECON.CONVOY_FOOD_PER_DISH` units of `food` — a
      number deliberately tuned BELOW the food embodied in the cheapest dish
      that can ride. Three guards, all of which this file honours:
        · outer — only `DATA.shippable(recipeId)` dishes are ever loaded;
        · inner — even the cheapest UNSHIPPABLE dish costs more food than a
          claim pays, so a bug here still cannot print food;
        · server — `delivered_dishes` comes back from the RPC and is the ONLY
          quantity this file is allowed to multiply by `CONVOY_FOOD_PER_DISH`.
      `DATA.convoyGuardOk()` recomputes the first two walls from the live
      tables. If you touch SUPPLY_RECIPES, RECIPES.steps or
      CONVOY_FOOD_PER_DISH, run it.
      🔴 NOTHING IN THIS FILE MAY EVER GRANT MORE THAN `deliveredDishes ×
      perDish`. Not a bonus, not a "long haul" multiplier, not a round-up, and
      **not a route incident** — incidents subtract and never add. There is no
      small version of that bug: `food` prices the Gene Vault, the Bottling
      Line, crafting and the resource market, and inflating it kills all four.

   5. THE SERVER IS THE LEDGER; THE STASH IS NOT. A P2P claim goes through
      `kitchen_convoy_claim()` FIRST and credits the stash only on what came
      back — the community.api.js `claimRewards` rule, verbatim, for the same
      reason (a double-click must not pay twice). A local practice run has no
      server row and no server leg.

   6. INCIDENTS ARE HONESTY, NOT SECURITY. The route can cost you boxes. That
      loss is computed HERE, on the client, from a hash of the SERVER-issued
      convoy uuid. A tampered client could refuse to apply it — and would then
      land exactly `delivered_dishes × perDish`, which is the ceiling the server
      already authorised and the same number round 1 paid. So spoilage can only
      ever make the payout SMALLER than the server's ceiling, which is why it is
      safe to compute it client-side, and why it must NEVER be relied on as a
      control. Anything that needs to be enforced goes in sql/038.

   ⚠ WHY A NAMESPACE IMPORT (`import * as State`) AND NOT NAMED ONES
   Same reason drivethru.js gives, and it applies here for the same reason: this
   file is on the far side of an import CYCLE (state.js imports us, we import
   state.js). ESM resolves that for hoisted `function` declarations and NOT for
   `const` arrows, which are in the temporal dead zone while the cycle links. A
   namespace import binds the module record instead of a binding, every call
   site is guarded by `typeof`, and — critically — NOTHING HERE TOUCHES `State.*`
   AT MODULE EVALUATION TIME.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as DATA from './kitchen.data.js';
import * as State from './kitchen.state.js';
import * as BRIDGE from './kitchen.bridge.js';
import * as API from './kitchen.api.js';

/* ───────────────────────────────────────────────────────────────────────────
   THE SEAM. `{}` is the floor, for the reason state.js writes out at length:
   every call below is `b.foo ? b.foo() : <zero>` because §7 says a reader may
   be absent and a mutator may return false, so an empty object behaves exactly
   like NULL_BRIDGE without this file keeping a second, drifting copy of the
   seam's shape. kitchen.bridge.js owns that shape.
   ─────────────────────────────────────────────────────────────────────────── */
const BRIDGE_FLOOR = {};
function bridge() {
  try {
    if (typeof BRIDGE.bridge === 'function') return BRIDGE.bridge() || BRIDGE_FLOOR;
    return BRIDGE.NULL_BRIDGE || BRIDGE_FLOOR;
  } catch (e) { return BRIDGE_FLOOR; }
}

/**
 * 🔴 IS THERE A STASH TO PUT FOOD IN AT ALL?
 *
 * CONTRACT §9 rung 1 is "no bridge at all" — the headless case, where
 * `NULL_BRIDGE` answers every reader with a zero and every mutator with
 * `false`. That is NOT the same as "your vault is full", and telling the two
 * apart matters: a full vault means HOLD the remainder at the depot until room
 * appears (§4), while no game attached means there is nowhere for it to go and
 * never will be. Without this test a rung-1 claim parks every truck on a dock
 * that can never be drained, and the board never clears.
 *
 * `bridgeReady()` is the seam's own answer to the question (`!bridge()._null`),
 * so this cannot drift from what the rest of the feature believes.
 */
function noStash() {
  try {
    if (typeof BRIDGE.bridgeReady === 'function' && !BRIDGE.bridgeReady()) return true;
  } catch (e) { return true; }
  return typeof bridge().addRes !== 'function';
}

/* ───────────────────────────────────────────────────────────────────────────
   ECON ACCESS. CLAUDE.md: "All operation pricing goes through _opEcon(). Never
   hardcode economy numbers." Kitchen's `_opEcon()` is `ECON` in kitchen.data.js
   and `EC()` is the only way this file reads it.

   🔴 THE SECOND ARGUMENT IS A NaN GUARD, NOT A TUNING VALUE. Changing it
   changes nothing on a correctly-built data file and will silently diverge from
   the number the designer is looking at. Retune in kitchen.data.js.

   ⚠ FOUR KEYS BELOW ARE NOT IN ECON YET and are flagged where they are read:
   CONVOY_SPOIL_PCT, CONVOY_ROUTE_LEGS, CONVOY_SYNC_MS and CONVOY_HOLD_MS.
   Their fallbacks are chosen so the feature behaves EXACTLY as CONTRACT §8.4
   describes when the keys are absent — INCIDENT LOSS OFF, in particular, so a
   data file that has not been retuned cannot start eating a player's boxes.
   The route still draws, still names its legs and still reads as a journey at
   zero loss; setting `CONVOY_SPOIL_PCT` is the one line that arms it.
   Inventing a spoilage rate locally would be inventing an economy number in the
   wrong file, which is the exact bug CLAUDE.md names.
   ─────────────────────────────────────────────────────────────────────────── */
function EC(key, fallback) {
  try {
    const v = DATA.ECON ? DATA.ECON[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : fallback;
  } catch (e) { return fallback; }
}

/** A data-module function, or null if that build of kitchen.data.js lacks it. */
function DF(name) {
  try { return (typeof DATA[name] === 'function') ? DATA[name] : null; } catch (e) { return null; }
}

const _int = (n) => { const v = Math.floor(Number(n)); return isFinite(v) ? v : 0; };
const _num = (n, d) => { const v = Number(n); return isFinite(v) ? v : (d || 0); };
const _clamp = (v, lo, hi) => (v < lo ? lo : (v > hi ? hi : v));
const _str = (s, n) => String(s == null ? '' : s).slice(0, n || 40);

/* Result helpers — the universal `{ok,code,why}` of CONTRACT §1.
   codes: OK NO_PANTRY NO_SLOT LOCKED CLOSED NOT_READY BAD_ARG CAP            */
function ok(extra) { return Object.assign({ ok: true, code: 'OK', why: '' }, extra || {}); }
function no(code, why, extra) { return Object.assign({ ok: false, code, why }, extra || {}); }

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT RAISING — exactly once, preferring state.js's emitter.
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THE DOUBLE-PUSH TRAP, copied deliberately from drivethru.js because it is
   the same trap. kitchen.state.js's tick does:
       const evs = Convoy.tick(K, step, t);
       if (Array.isArray(evs)) for (const e of evs) K._events.push(e);
   so if this file ALSO called `State.emit()` (which pushes to `K._events`
   itself) and then returned the same event, every arrival would land in the
   frame TWICE — two toasts, two badges, two float-ups.

   THE RULE: prefer `State.emit()`, because it also fires SUBSCRIBERS — render
   calls `State.on('convoy:arrive', …)` and a returned-only event never reaches
   it. When emit succeeds we return NOTHING for that event; it is already in the
   array state.js drains. The push-to-`out` branch is the fallback for a harness
   driving a FAKE `K`, where `State.emit()` would post to the real `Kitchen`
   singleton instead of the fake — hence the `State.Kitchen === K` test.

   ⚠ `Object.assign({name}, payload)` means a payload key called `name` silently
   overwrites the EVENT name (drivethru.js shipped that bug once and every car
   arrival dispatched under the customer's display name). Convoy payloads
   therefore spell the recipient `toName`, never `name`.

   ⚠ NO NEW EVENT NAMES. CONTRACT §6 is a CLOSED SET and this file may not edit
   CONTRACT.md, so route incidents do NOT get a `convoy:hazard` event. They are
   read instead — `route(c, now)` is pure and render already polls it every
   frame to place the truck, so an incident becomes visible the moment the truck
   reaches it with no new plumbing. `convoy:hazard` wants adding to the closed
   set on the next contract pass; until it is there, do not emit it.
   ═══════════════════════════════════════════════════════════════════════════ */
function raise(K, out, name, payload) {
  const ev = Object.assign({ name: String(name), t: _num(K && K.now, 0) }, payload || {});
  try {
    if (typeof State.emit === 'function' && State.Kitchen === K) {
      State.emit(name, payload);
      return ev;                 // delivered; do NOT also hand it back to state.js
    }
  } catch (e) { /* fall through to the buffer */ }
  if (Array.isArray(out)) out.push(ev);
  return ev;
}

/** Force a save through state.js when it owns this `K`. CONTRACT §5 force-calls
    on convoy:launch and convoy:claim — a truck that vanishes because the tab
    closed before the 5s debounce is indistinguishable from theft.

    🔴 IT IS ALSO THE DEPOT HOLD'S ONLY PERSISTENCE (§4). A held row lives in
    `K.convoys`, which `snapshot()` saves; if the save does not happen, the
    remainder of a short-landed claim dies with the tab. Every path that creates
    or drains a hold calls this. */
function forceSave(K) {
  try {
    if (typeof State.save === 'function' && State.Kitchen === K) return State.save(true) !== false;
  } catch (e) {}
  return false;
}

/* ═══════════════════════════════════════════════════════════════════════════
   IDENTITY & TIME
   ═══════════════════════════════════════════════════════════════════════════ */

function myId() {
  const b = bridge();
  try { return b.userId ? (b.userId() || null) : null; } catch (e) { return null; }
}
function myName() {
  const b = bridge();
  try { return (b.displayName ? b.displayName() : '') || 'Survivor'; } catch (e) { return 'Survivor'; }
}

/**
 * A stable local id for a convoy.
 *
 * 🔴 NOT `'c' + (++K._seq)`. `_seq` is NOT in `snapshot()` — it resets to 0 on
 * every reload — while `K.convoys` IS saved. Sequence ids would therefore start
 * colliding with yesterday's trucks the moment the page reloaded, and `claim()`
 * looks convoys up BY ID. Built from `now` (already unique to the minute) plus a
 * disambiguating counter, then checked against the live list, so it is unique
 * and still deterministic for a replay — no `Math.random()`, no clock read.
 */
function localId(K, now) {
  const base = 'cv' + Math.max(0, _int(now)).toString(36);
  const taken = Object.create(null);
  for (const c of (K.convoys || [])) if (c && c.id) taken[c.id] = 1;
  for (const c of (K.inbound || [])) if (c && c.id) taken[c.id] = 1;
  let n = 0, id = base;
  while (taken[id]) { n++; id = base + '-' + n.toString(36); }
  return id;
}

/**
 * A stable 0..1 from a string. Used ONLY for the route, and it must be stable:
 * a re-rolled incident would change the arrival amount every time the panel
 * repainted, which reads as the game lying about how much is on the truck, and
 * would let a client reload until it rolled a clean run.
 *
 * 🔴 THE FINAL AVALANCHE IS NOT OPTIONAL, AND THIS IS THE SECOND TIME. Round 1
 * ended the loop at FNV-1a's last multiply and took the top bits straight. The
 * seeds this file hashes differ only in their LAST character (`…:p0`, `…:p1`,
 * `…:p2`), and one multiply does not spread a one-byte change across 32 bits —
 * so every leg of a five-leg route drew the SAME place out of the table and the
 * road read "The Overpass → The Overpass → The Overpass". The two mix rounds
 * below (lowbias32) are what make near-identical seeds independent.
 * `Math.imul` is used because `*` on 32-bit values goes through a double and
 * loses the low bits, which is the classic way this gets quietly broken again.
 */
function _hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §1 — COMPOSITION: what fits on the truck, and what it costs to send
   ═══════════════════════════════════════════════════════════════════════════ */

function tierOf(tierId) {
  const f = DF('convoyTier');
  if (f) { try { return f(tierId) || null; } catch (e) { return null; } }
  const rows = Array.isArray(DATA.CONVOY_TIERS) ? DATA.CONVOY_TIERS : [];
  for (const t of rows) if (t && t.id === tierId) return t;
  return null;
}

function capacityOf(tierId, owned) {
  const f = DF('convoyCapacity');
  if (f) { try { return Math.max(0, _int(f(tierId, owned))); } catch (e) {} }
  const t = tierOf(tierId);
  return t ? Math.max(0, _int(t.capacity)) : 0;
}

function feePctOf(tierId, owned) {
  const f = DF('convoyFeePct');
  if (f) { try { const v = _num(f(tierId, owned), NaN); if (isFinite(v)) return Math.max(0, v); } catch (e) {} }
  const t = tierOf(tierId);
  const base = (t && typeof t.feePct === 'number') ? t.feePct : EC('CONVOY_FEE_PCT', 0.10);
  return Math.max(0, base);
}

function isShippable(recipeId) {
  const f = DF('shippable');
  if (f) { try { return !!f(recipeId); } catch (e) { return false; } }
  // ⚠ NO DATA FUNCTION → NOTHING SHIPS. Fail CLOSED, never open: the ship flag
  //    is the outer wall of the food-printer guard (rule 4 above), and a build
  //    of kitchen.data.js old enough to lack `shippable()` is exactly the build
  //    whose recipes were never audited for it.
  return false;
}

function countOf(items) {
  let n = 0;
  for (const id in (items || {})) n += Math.max(0, _int(items[id]));
  return n;
}

/** Menu order — the ONE deterministic order used everywhere a load is trimmed,
    so `estimate()` and `compose()` can never disagree about what got left. */
function orderedIds(items) {
  const out = [];
  const rows = Array.isArray(DATA.RECIPES) ? DATA.RECIPES : [];
  for (const r of rows) if (r && Object.prototype.hasOwnProperty.call(items || {}, r.id)) out.push(r.id);
  for (const id in (items || {})) if (out.indexOf(id) === -1) out.push(id);   // unknown ids last
  return out;
}

/**
 * Trim a wish-list to what the truck can actually hold, dropping anything that
 * cannot ride.
 *
 * ⚠ WHY TRIM AND NOT REFUSE. render may hand us more than fits — the manifest
 * stepper clamps as you tap, but the pass moves under it between frames.
 * Refusing an over-capacity load would disable the button precisely when the
 * player has the most to ship: "the van is full" would read as "the van is
 * broken". Trimming is the behaviour of a real loading bay — it takes what fits
 * and the rest waits for the next truck.
 */
function clampToCapacity(items, cap) {
  const out = {};
  let left = Math.max(0, _int(cap));
  for (const id of orderedIds(items)) {
    if (left <= 0) break;
    if (!isShippable(id)) continue;                    // outer wall of the guard
    const want = Math.max(0, _int(items[id]));
    if (want <= 0) continue;
    const take = Math.min(want, left);
    if (take > 0) { out[id] = take; left -= take; }
  }
  return out;
}

function feeFor(tierId, items, owned) {
  const f = DF('dishValue');
  let value = 0;
  if (f) { try { value = Math.max(0, _int(f(items))); } catch (e) { value = 0; } }
  return Math.max(0, Math.round(value * feePctOf(tierId, owned)));
}

/**
 * Pure, side-effect-free quote for the UI. CONTRACT §1 signature is
 * `(tierId, items)`; `owned` is an OPTIONAL third argument so a caller that
 * has `K.upgrades` to hand gets the upgraded capacity and fee. A caller that
 * omits it sees the stock truck — a small under-quote for an upgraded player,
 * never an over-quote, which is the safe direction to be wrong in when the
 * number next to it is a price.
 */
export function estimate(tierId, items, owned) {
  const t = tierOf(tierId);
  if (!t) return { tierId, dishes: 0, transitMs: 0, feeCinder: 0, capacity: 0, items: {}, food: 0 };
  const cap = capacityOf(tierId, owned);
  const picked = clampToCapacity(items, cap);
  const dishes = countOf(picked);
  return {
    tierId,
    items: picked,
    dishes,
    capacity: cap,
    transitMs: Math.max(0, _int(t.transitMs)),
    feeCinder: feeFor(tierId, picked, owned),
    // What the RECIPIENT gets, BEFORE the route takes its cut. Quoted so the
    // sender can see it is a transfer and not a jackpot — see rule 4.
    food: Math.max(0, Math.floor(dishes * EC('CONVOY_FOOD_PER_DISH', 1))),
  };
}

/** How many of each recipe are actually sitting on the pass right now. */
function passCounts(K) {
  const have = {};
  for (const d of (K.pass || [])) {
    if (!d || !d.recipeId) continue;
    have[d.recipeId] = (have[d.recipeId] || 0) + 1;
  }
  return have;
}

/** Outbound trucks still on the road. The concurrency cap counts these only —
    an arrived truck waiting to be unloaded is not occupying a driver, and a
    HELD one is not on the road at all. */
function activeOutbound(K) {
  let n = 0;
  for (const c of (K.convoys || [])) if (c && c.state === 'transit' && c.dir !== 'in') n++;
  return n;
}

/* ───────────────────────────────────────────────────────────────────────────
   THE MANIFEST — round 2's answer to "a convoy is a form, not an event".

   ⚠ NOT IN CONTRACT §1's EXPORT LIST, and this note is the "say so" §0 asks
   for. `shippablePass()` and `manifest()` are PURE READS over `K` with no
   mutation and no side effects. They exist because the round-1 loader dumped
   the entire pass onto the truck, which is not a decision — the player never
   chose anything, so loading could not feel like an act. They want adding to §1
   on the next pass.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * Every dish on the pass that can ride, as bins for a stepper UI.
 * → [{ recipeId, name, icon, have, foodCost, value, ship:true }]
 *
 * `foodCost` is what the ingredients for ONE of these cost out of the live
 * `food` ledger. It is on the row on purpose: it is the number that makes rule
 * 4 legible to a player. Shipping is a LOSS for the pair and the manifest
 * should say so rather than hiding it behind a friendly "+40 food".
 */
export function shippablePass(K) {
  const out = [];
  try {
    if (!K || typeof K !== 'object') return out;
    const have = passCounts(K);
    const fc = DF('foodCostOf');
    const rows = Array.isArray(DATA.RECIPES) ? DATA.RECIPES : [];
    for (const r of rows) {
      if (!r || !r.id) continue;
      const n = Math.max(0, _int(have[r.id]));
      if (n <= 0) continue;
      if (!isShippable(r.id)) continue;
      let cost = 0;
      if (fc) { try { cost = _num(fc(r.id), 0); } catch (e) { cost = 0; } }
      out.push({
        recipeId: r.id,
        name: r.name || r.id,
        icon: r.icon || '🍽',
        have: n,
        foodCost: cost,
        value: Math.max(0, _int(r.basePrice)),
        ship: true,
      });
    }
  } catch (e) {}
  return out;
}

/**
 * The live quote behind a manifest panel. Pure. Safe to call every frame.
 *
 * `wanted` is `{recipeId: qty}` from the stepper, or `null` for "fill it" —
 * auto-fill takes the pass in menu order, which is the same order
 * `clampToCapacity` trims in, so what the player sees is what leaves.
 *
 * → { tierId, tier, items, lines, dishes, capacity, transitMs, feeCinder,
 *     food, purse, minDishes, ok, code, why }
 *
 * `ok:false` here is a DISABLED BUTTON, not an error toast. `why` is the label
 * the wiring agent should put under the LOAD button.
 */
export function manifest(K, tierId, wanted) {
  const t = tierOf(tierId);
  const blank = {
    tierId, tier: null, items: {}, lines: [], dishes: 0, capacity: 0,
    transitMs: 0, feeCinder: 0, food: 0, purse: 0,
    minDishes: Math.max(1, _int(EC('CONVOY_MIN_DISHES', 4))),
    ok: false, code: 'BAD_ARG', why: 'That truck is not in the yard.',
  };
  try {
    if (!K || typeof K !== 'object' || !t) return blank;

    const bins = shippablePass(K);
    const cap = capacityOf(tierId, K.upgrades);
    const minLevel = Math.max(1, _int(t.minLevel || 1));
    const minDishes = Math.max(1, _int(EC('CONVOY_MIN_DISHES', 4)));

    // What the player asked for, clamped to what is really on the pass.
    const wish = {};
    if (wanted && typeof wanted === 'object') {
      for (const b of bins) {
        const q = Math.min(Math.max(0, _int(wanted[b.recipeId])), b.have);
        if (q > 0) wish[b.recipeId] = q;
      }
    } else {
      for (const b of bins) wish[b.recipeId] = b.have;      // "fill it"
    }
    const items = clampToCapacity(wish, cap);
    const dishes = countOf(items);
    const feeCinder = feeFor(tierId, items, K.upgrades);

    let purse = 0;
    try { const b = bridge(); purse = _int(b.gems ? b.gems() : 0); } catch (e) { purse = 0; }

    const lines = bins.map((b) => Object.assign({}, b, {
      take: Math.max(0, _int(items[b.recipeId])),
      // What the stepper's + button is allowed to reach on this truck.
      max: Math.min(b.have, cap),
    }));

    let code = 'OK', why = '';
    if (_int(K.level) < minLevel) { code = 'LOCKED'; why = 'The ' + (t.name || 'truck') + ' unlocks at level ' + minLevel + '.'; }
    else if (activeOutbound(K) >= Math.max(1, _int(EC('CONVOY_MAX_ACTIVE', 3)))) {
      code = 'CAP'; why = 'You already have ' + Math.max(1, _int(EC('CONVOY_MAX_ACTIVE', 3))) + ' convoys on the road.';
    } else if (!bins.length) { code = 'NOT_READY'; why = 'Nothing on the pass can ride a convoy — fries and shakes do not travel.'; }
    else if (dishes < minDishes) { code = 'NOT_READY'; why = 'Load at least ' + minDishes + ' boxes.'; }
    else if (feeCinder > purse) { code = 'NO_PANTRY'; why = 'Freight is ' + feeCinder + ' Cinder and you have ' + purse + '.'; }

    return {
      tierId, tier: t, items, lines, dishes, capacity: cap,
      transitMs: Math.max(0, _int(t.transitMs)), feeCinder, purse, minDishes,
      food: Math.max(0, Math.floor(dishes * EC('CONVOY_FOOD_PER_DISH', 1))),
      ok: code === 'OK', code, why,
    };
  } catch (e) { return blank; }
}

/**
 * Validate a load against the truck, the level gate and the pass.
 * → {ok, code, why, convoy}   `convoy` is a DRAFT: no id, not in `K`, nothing spent.
 */
export function compose(K, tierId, items) {
  try {
    if (!K || typeof K !== 'object') return no('BAD_ARG', 'The kitchen is not open.');
    const t = tierOf(tierId);
    if (!t) return no('BAD_ARG', 'That truck is not in the yard.');

    const minLevel = Math.max(1, _int(t.minLevel || 1));
    if (_int(K.level) < minLevel) {
      return no('LOCKED', 'The ' + (t.name || 'truck') + ' unlocks at level ' + minLevel + '.');
    }

    const maxActive = Math.max(1, _int(EC('CONVOY_MAX_ACTIVE', 3)));
    if (activeOutbound(K) >= maxActive) {
      return no('CAP', 'You already have ' + maxActive + ' convoys on the road.');
    }

    // Intersect the wish-list with what is REALLY on the pass. render builds
    // `items` from the pass a frame ago; between that and the click a customer
    // may have taken the last burger, and a truck must never carry a dish that
    // was already sold.
    const have = passCounts(K);
    const real = {};
    for (const id in (items || {})) {
      const want = Math.min(Math.max(0, _int(items[id])), Math.max(0, _int(have[id])));
      if (want > 0) real[id] = want;
    }

    const cap = capacityOf(tierId, K.upgrades);
    if (cap <= 0) return no('BAD_ARG', 'That truck has no bed on it.');
    const picked = clampToCapacity(real, cap);
    const dishes = countOf(picked);

    if (dishes <= 0) {
      return no('NOT_READY', 'Nothing on the pass can ride a convoy — fries and shakes do not travel.');
    }
    const minDishes = Math.max(1, _int(EC('CONVOY_MIN_DISHES', 4)));
    if (dishes < minDishes) {
      return no('NOT_READY', 'A convoy needs at least ' + minDishes + ' boxes. You have ' + dishes + '.');
    }

    const feeCinder = feeFor(tierId, picked, K.upgrades);
    const transitMs = Math.max(0, _int(t.transitMs));

    return ok({
      convoy: {
        tierId: t.id,
        items: picked,
        dishes,
        capacity: cap,
        feeCinder,
        transitMs,
        // Quoted here so the confirm dialog can say what the other player gets.
        // 🔴 The AUTHORITATIVE grant is recomputed at claim() from the SERVER's
        //    `delivered_dishes` and ECON — never read back off the row, because
        //    on an inbound convoy that row was written by somebody else's client.
        food: Math.max(0, Math.floor(dishes * EC('CONVOY_FOOD_PER_DISH', 1))),
      },
    });
  } catch (e) {
    return no('BAD_ARG', 'That load will not go.');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §2 — LAUNCH: spend the fee, take the dishes, put a truck on the road
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Take `n` dishes of `recipeId` off the pass, OLDEST FIRST.
 *
 * ⚠ Oldest first is deliberate and it is a kindness, not an optimisation. The
 * counter pays a staleness multiplier (see state.js `stalenessMul`); a convoy
 * pays a flat food rate per box. So the dish worth least at the window is worth
 * exactly as much on the truck, and FIFO means loading a convoy never costs the
 * player the good end of their pass.
 */
function takeFromPass(K, recipeId, n) {
  const taken = [];
  let left = Math.max(0, _int(n));
  if (!left) return taken;
  const idx = [];
  for (let i = 0; i < (K.pass || []).length; i++) {
    const d = K.pass[i];
    if (d && d.recipeId === recipeId) idx.push(i);
  }
  idx.sort((a, b) => _num(K.pass[a].madeAt, 0) - _num(K.pass[b].madeAt, 0));
  const kill = {};
  for (const i of idx) { if (left <= 0) break; kill[i] = 1; taken.push(K.pass[i]); left--; }
  if (taken.length) K.pass = K.pass.filter((d, i) => !kill[i]);
  return taken;
}

/**
 * Put a composed load on the road.
 *
 * `toUserId` may be:
 *   · `{ id, name }`   — a row straight out of `recipients()`. THE REAL PATH.
 *   · a user id string — the same thing without a display name.
 *   · `null`           — an explicit PRACTICE RUN to your own city.
 * Your own id is treated as null. See `recipients()` for what the picker hands
 * back and `resolveTo()` for the exact rules.
 *
 * A practice run is CONTRACT §9 rungs 2/3 made real, and it is safe for the
 * same reason a P2P convoy is: the dishes cost more `food` to make than the
 * claim pays back, so a self-convoy is a small deliberate LOSS plus a freight
 * fee. It teaches the mechanic; it is not a loop.
 *
 * SPEND ORDER IS settle.js DISCIPLINE (§8.1 steps 1–4): preflight everything,
 * take the Cinder, take the dishes, and only then write the row. The dishes
 * cannot fail (a local array) and the row cannot fail (a local push), so the
 * only unwind is "the fee was taken and then something impossible happened" —
 * which is still written out below, with `addGems`, because a spend path with
 * no unwind is how a player ends up paying for a truck that never left.
 *
 * 🔴 THE SERVER LEG IS LAST AND IT CANNOT FAIL THE LAUNCH. The truck exists
 * locally the instant the fee is paid. A 404 (sql/038 not run), a dead network
 * or a signed-out session degrade to a local convoy that still arrives and can
 * still be claimed — CONTRACT §9 says all four rungs must be playable, and
 * "your food is gone and there is no truck" is not a rung.
 *
 * 🔴 THE SERVER OWNS THE CLOCK. We post a transit DURATION and adopt the
 * `arrives_at` the server computes from `now()`. Round 1 posted a timestamp off
 * the device clock, which (a) let a tampered client land a truck in 1ms and
 * (b) made shipping IMPOSSIBLE for a player whose clock ran 40 minutes slow —
 * their insert failed `arrives_at > now()` and their truck was silently
 * renamed "(local run)" with no explanation. Both are gone: the duration is
 * clamped server-side and the answer comes back as fact.
 */
export async function launch(K, convoy, toUserId, now) {
  try {
    if (!K || typeof K !== 'object') return no('BAD_ARG', 'The kitchen is not open.');
    if (!convoy || typeof convoy !== 'object') return no('BAD_ARG', 'There is no load to send.');
    const t = _num(now, _num(K.now, 0));

    // 1 · RE-COMPOSE. Never trust a draft that has been round-tripped through
    //     the UI: it was built before an `await`, and the pass, the level and
    //     the upgrade list can all have moved since. compose() is idempotent,
    //     so this is free when nothing changed.
    const re = compose(K, convoy.tierId, convoy.items);
    if (!re.ok) return re;
    const load = re.convoy;

    // 2 · RESOLVE THE RECIPIENT.
    const to = resolveTo(toUserId);

    // ⚠ A NAMED RECIPIENT WHILE SIGNED OUT IS REFUSED, NOT DOWNGRADED. Round 1
    //   silently turned every failed P2P launch into a practice run, which is
    //   the right behaviour when the network drops MID-launch (the fee is
    //   already spent) and completely the wrong behaviour BEFORE it: the player
    //   picked a person, and quietly shipping to yourself instead is a lie with
    //   their boxes in it. Refuse while nothing has been spent.
    if (!to.self && !myId()) {
      return no('CLOSED', 'Sign in to ship to another player.');
    }

    // 3 · PREFLIGHT THE FEE. Refuse before touching anything — a failed launch
    //     must cost the player nothing at all.
    const b = bridge();
    const fee = Math.max(0, _int(load.feeCinder));
    if (fee > 0) {
      let purse = 0;
      try { purse = _int(b.gems ? b.gems() : 0); } catch (e) { purse = 0; }
      if (purse < fee) return no('NO_PANTRY', 'Freight is ' + fee + ' Cinder and you have ' + purse + '.');
    }

    // 4 · TAKE THE FEE.
    let paid = 0;
    if (fee > 0) {
      let done = false;
      try { done = (b.spendGems ? b.spendGems(fee) : false) === true; } catch (e) { done = false; }
      // 🔴 `=== true`, not truthy. CONTRACT rule 3: a wrapper that returns
      //    undefined on success would otherwise read as a failure here — and
      //    the reverse mistake (treating undefined as success) charges nobody
      //    and ships the truck for free.
      if (!done) return no('NO_PANTRY', 'The freight fee would not go through.');
      paid = fee;
    }

    // 5 · TAKE THE DISHES.
    const loaded = [];
    for (const id of orderedIds(load.items)) {
      const got = takeFromPass(K, id, load.items[id]);
      for (const d of got) loaded.push(d);
    }
    if (loaded.length !== load.dishes) {
      // Should be impossible — compose() just counted the same pass — so this
      // is the "something impossible happened" branch. Put EVERYTHING back.
      for (const d of loaded) K.pass.push(d);
      // ⚠ addGems, not spendGems(-n). Refunding a charge this call stack just
      //    made is the `refundRes` rule applied to Cinder: never re-run a
      //    capped/validated grant path to undo a deduction.
      if (paid > 0) { try { b.addGems && b.addGems(paid); } catch (e) {} }
      K.rev++;
      return no('NOT_READY', 'The pass changed while you were loading. Nothing was sent.');
    }

    // 6 · THE ROW. Local first, always.
    const row = {
      id: localId(K, t),
      remoteId: null,
      dir: 'out',
      self: to.self,
      tierId: load.tierId,
      toUserId: to.id || null,
      toName: to.self ? myName() : (to.name || 'Another kitchen'),
      fromName: myName(),
      items: Object.assign({}, load.items),
      dishes: load.dishes,
      launchedAt: t,
      arrivesAt: t + Math.max(0, _int(load.transitMs)),   // ← provisional; §2 note
      state: 'transit',
      feeCinder: paid,
      // Bookkeeping the claim path needs. `paidFood` is how much of this
      // convoy's food has ALREADY landed in a stash — see the depot hold (§4).
      paidFood: 0,
      // 🔴 `serverClaimed` is the depot hold's memory: once the RPC has paid
      //    out, this row must never call the RPC again, whatever happens to the
      //    tab in between.
      serverClaimed: false,
      xpPaid: false,
      // Clock skew between this device and the server, filled in below. Zero
      // for a practice run, which has no server to disagree with.
      skewMs: 0,
    };
    K.convoys.push(row);
    K.rev++;
    raise(K, null, 'convoy:launch', {
      id: row.id, tierId: row.tierId, dishes: row.dishes,
      toName: row.toName, self: to.self, feeCinder: paid, arrivesAt: row.arrivesAt,
    });
    forceSave(K);

    // 7 · THE SERVER LEG. Best effort, never fatal. A practice run skips it
    //     entirely: writing a self-addressed row would give the same truck two
    //     claim paths (local and RPC) and one of them would pay twice — and
    //     sql/038's `to_user <> from_user` check rejects it anyway.
    if (!to.self && to.id) {
      let res = null;
      try {
        res = await API.insertConvoy({
          to_user: to.id,
          to_name: to.name,
          from_name: row.fromName,
          tier: row.tierId,
          items: row.items,
          dishes: row.dishes,
          // 🔴 A DURATION, NOT A TIMESTAMP. See the block comment above.
          transit_ms: Math.max(0, _int(load.transitMs)),
        });
      } catch (e) { res = null; }                 // api never throws; belt and braces
      if (res && res.ok && res.row && res.row.id) {
        row.remoteId = res.row.id;
        adoptServerClock(row, res.row, t);
        K.missing = false; K.offline = false;
        K.rev++;
        forceSave(K);
      } else {
        // 🔴 THE TRUCK TURNS BACK. The fee is already spent and the dishes are
        //    already off the pass, so the one thing that must not happen here is
        //    "your food is gone and there is no truck". The row becomes a local
        //    run: it still arrives, and the SENDER can unload it into their own
        //    stash. The intended recipient gets nothing — that is the honest
        //    outcome of a shipment that never reached the network — and the
        //    player is not robbed, because a local run still pays out less food
        //    than the ingredients cost (rule 4).
        // ⚠ Round 1 renamed the row and said nothing else. `turnedBack` is here
        //   so the renderer can say WHY on the row itself, and `why` comes back
        //   to the caller so the launch toast is not a cheerful lie.
        if (res && res.missing) K.missing = true;
        if (res && res.offline) K.offline = true;
        row.local = true;
        row.turnedBack = true;
        row.self = true;        // nobody else can see it, so it is claimable here
        row.toUserId = myId();
        row.toName = myName() + ' (turned back)';
        K.rev++;
        forceSave(K);
        return ok({
          id: row.id, convoy: row, feeCinder: paid, local: true, turnedBack: true,
          why: (res && res.missing)
            ? 'The convoy network is not set up yet — the truck turned back to your own city.'
            : 'The depot could not reach ' + (to.name || 'them') + '. The truck turned back to your own city.',
        });
      }
    }

    return ok({ id: row.id, convoy: row, feeCinder: paid, local: !row.remoteId });
  } catch (e) {
    return no('BAD_ARG', 'The convoy did not leave.');
  }
}

/**
 * Who is this convoy for?
 * → { id, name, self }
 *
 * ⚠ `self` IS THE MOST IMPORTANT BOOLEAN IN THIS FILE and round 1 got it wrong
 * by never producing anything else: the renderer passed `bridge().userId()` as
 * the recipient, so `self` was always true and the whole network leg was
 * unreachable. It is `true` only for an EXPLICIT practice run (null/blank) or
 * for a picker row that resolved to my own account, and it is `false` for every
 * real person. Nothing else may set it.
 */
function resolveTo(toUserId) {
  let id = null, name = '';
  if (toUserId && typeof toUserId === 'object') {
    id = toUserId.id || toUserId.userId || toUserId.user_id || null;
    name = _str(toUserId.name || toUserId.displayName || toUserId.display_name, 40);
  } else if (typeof toUserId === 'string' && toUserId.trim()) {
    id = toUserId.trim();
  }
  const mine = myId();
  const self = !id || (!!mine && id === mine);
  if (self) return { id: mine, name: myName(), self: true };
  return { id, name: name || 'Another kitchen', self: false };
}

/**
 * Adopt the server's launch/arrival times onto a local row.
 *
 * ⚠ THE SKEW CORRECTION IS THE POINT. `arrivesAt` is compared against `now`,
 * which is `Date.now()` on the PLAYER'S DEVICE. The server's `arrives_at` is on
 * the SERVER's clock. On a device running 40 minutes slow, storing the server's
 * absolute timestamp would show a 30-minute van as arriving in 70 minutes and
 * the countdown would lie for the whole trip. So we convert: the server told us
 * both when it thinks the truck left and when it lands, and the difference
 * between its "left" and our `now` is the skew. Subtract it and the countdown
 * runs in device time while the CLAIM still happens on server time — which is
 * where it belongs, and which is why a fast clock buys nothing.
 */
function adoptServerClock(row, srv, localNow) {
  try {
    const sLaunch = Date.parse(srv.launched_at || '') || 0;
    const sArrive = Date.parse(srv.arrives_at || '') || 0;
    if (!sArrive) return;
    const skew = sLaunch ? (sLaunch - _num(localNow, 0)) : 0;
    row.skewMs = skew;
    row.arrivesAt = sArrive - skew;
    row.launchedAt = sLaunch ? (sLaunch - skew) : row.launchedAt;
    row.arrivesAtServer = srv.arrives_at || null;
    if (srv.dishes != null) row.dishes = Math.max(0, _int(srv.dishes));
  } catch (e) { /* keep the provisional local clock */ }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — THE ROUTE. What makes a convoy an event instead of a progress bar.
   ═══════════════════════════════════════════════════════════════════════════

   A convoy crosses a ruined city. Round 1 drew that as one 1-D bar, which is
   the same picture a file download gets, and the review was right that it read
   as a settings dialog. So the journey now has SHAPE:

     · FIVE NAMED LEGS between two markers — your kitchen and their city.
     · An INCIDENT may sit on a leg: a checkpoint, a washed-out span, a stall
       in the road. The truck reaches it at a known point in the trip and the
       player watches it happen.
     · An incident can cost BOXES. Never all of them (`dishes - 1` is the hard
       ceiling), never nothing-but-flavour when the loss rate is armed.

   🔴 EVERYTHING HERE IS DETERMINISTIC AND SEEDED FROM THE CONVOY'S ID. For a
   P2P convoy that id is the SERVER's `gen_random_uuid()`, so the route is
   rolled by the database and neither party can re-roll it by reloading. For a
   practice run it is the local id, which is derived from the launch timestamp.
   A re-rolled incident would change the arrival amount every repaint and would
   let a client reload until it got a clean run.

   🔴 INCIDENTS SUBTRACT. THEY NEVER ADD. Read rule 6 at the top of the file:
   the server authorises a ceiling (`delivered_dishes`) and the route can only
   take boxes off that number. That is what makes it safe to compute here.

   ⚠ THE FLAVOUR STRINGS BELOW ARE CONTENT, NOT IDS AND NOT NUMBERS. They are
   read from `DATA.CONVOY_ROUTE` / `DATA.CONVOY_HAZARDS` when kitchen.data.js
   grows them (which is where they belong — that file owns the vocabulary) and
   fall back to these so the route is never nameless. No id in here is
   referenced by any other module, so the fallback cannot drift into a contract.
   ═══════════════════════════════════════════════════════════════════════════ */

const FALLBACK_PLACES = [
  { name: 'The Overpass',   icon: '🌉' },
  { name: 'Rust Flats',     icon: '🏜' },
  { name: 'Checkpoint Nine',icon: '🚧' },
  { name: 'The Long Culvert',icon: '🕳' },
  { name: 'Ash Market',     icon: '⛺' },
  { name: 'Dead Reservoir', icon: '💧' },
  { name: 'The Cut',        icon: '⛰' },
  { name: 'Grid North',     icon: '🏚' },
];

const FALLBACK_HAZARDS = [
  { id: 'toll',    name: 'Roadside toll',   icon: '💰', line: 'A crew at the barrier took their cut in boxes.' },
  { id: 'washout', name: 'Washed-out span', icon: '🌊', line: 'The detour cost the load a pallet off the back.' },
  { id: 'heat',    name: 'Cooler stall',    icon: '🥵', line: 'The chiller cut out and part of the load turned.' },
  { id: 'raiders', name: 'Raiders',         icon: '🏴', line: 'They took what they could carry and let the truck go.' },
  { id: 'patrol',  name: 'Patrol stop',     icon: '🚓', line: 'A search, a shrug, and a lighter truck.' },
];

function places() {
  try {
    const rows = DATA.CONVOY_ROUTE;
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (e) {}
  return FALLBACK_PLACES;
}
function hazards() {
  try {
    const rows = DATA.CONVOY_HAZARDS;
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (e) {}
  return FALLBACK_HAZARDS;
}

/* The route is recomputed on demand and render polls it every frame, so it is
   memoised on the cheapest key that fully determines it. Capped at 32 entries
   because a player can only ever have a handful of trucks and an unbounded
   cache in a module that lives for the whole session is a leak. */
const _routeCache = new Map();

function routeSeed(c) { return String((c && (c.remoteId || c.id)) || ''); }

/**
 * The plan for one convoy: legs, incidents, and the total boxes lost.
 * Pure. No `K`, no clock, no bridge.
 */
function routePlan(c) {
  const seed = routeSeed(c);
  const dishes = Math.max(0, _int(c && c.dishes));
  // ⚠ Leg count is LAYOUT, not economy — it decides how many markers the
  //   renderer draws. Kept in ECON anyway so a designer can widen the road
  //   without touching code, and clamped so a silly value cannot make the
  //   strip unreadable at 360px.
  const legs = _clamp(_int(EC('CONVOY_ROUTE_LEGS', 5)), 3, 8);
  // 🔴 THE ARMING KEY. Absent → 0 → a scenic route with no losses, exactly as
  //    CONTRACT §8.4 describes today. See the EC() note at the top.
  const pct = _clamp(_num(EC('CONVOY_SPOIL_PCT', 0), 0), 0, 0.5);
  const key = seed + '|' + dishes + '|' + legs + '|' + pct;
  const hit = _routeCache.get(key);
  if (hit) return hit;

  const P = places(), H = hazards();
  const maxLost = Math.max(0, dishes - 1);   // never a total loss: that is a bug report
  const out = [];
  let lost = 0;

  // ⚠ PLACES ARE DRAWN WITHOUT REPLACEMENT. A plain `hash % P.length` per leg
  //   collides often enough at five-from-eight that a good third of routes
  //   would name two legs the same, and "The Overpass → Rust Flats → The
  //   Overpass" reads as a bug rather than a road. A deterministic partial
  //   shuffle costs nothing and cannot repeat while `legs <= P.length`.
  const bag = P.map((_, n) => n);
  const pick = [];
  for (let i = 0; i < legs; i++) {
    if (!bag.length) { pick.push(i % P.length); continue; }
    const j = Math.floor(_hash01(seed + ':p' + i) * bag.length) % bag.length;
    pick.push(bag.splice(j, 1)[0]);
  }

  for (let i = 0; i < legs; i++) {
    const p = P[pick[i]] || P[0];
    const leg = {
      i,
      at: (i + 0.5) / legs,          // where on the road this leg sits, 0..1
      name: (p && p.name) || 'The road',
      icon: (p && p.icon) || '🛣',
      hazard: null,
      lost: 0,
    };
    // An incident is rolled per leg. `pct * 2` is the *chance*, `pct` the size:
    // at a 6% loss rate roughly one leg in eight has an incident and it costs a
    // few boxes, which is a story. Both fall to zero together.
    if (pct > 0 && dishes > 0 && lost < maxLost && _hash01(seed + ':h' + i) < pct * 2) {
      const hz = H[Math.floor(_hash01(seed + ':k' + i) * H.length) % H.length] || H[0];
      const want = Math.max(1, Math.floor(dishes * pct * _hash01(seed + ':l' + i)));
      leg.lost = Math.min(want, maxLost - lost);
      leg.hazard = { id: hz.id, name: hz.name, icon: hz.icon, line: hz.line };
      lost += leg.lost;
    }
    out.push(leg);
  }
  const plan = { legs: out, spoilFinal: lost, dishes, armed: pct > 0 };
  if (_routeCache.size > 32) _routeCache.clear();
  _routeCache.set(key, plan);
  return plan;
}

/**
 * The route as the renderer wants it, at a moment in time.
 *
 * → {
 *     pct,          // 0..1 — where the truck is. Drive `left:` off this.
 *     etaMs,        // ms until it lands (0 once it has)
 *     arrived,      // boolean
 *     origin, dest, // { name, icon } — the two markers
 *     legs,         // [{ i, at, name, icon, hazard|null, lost, passed }]
 *     incidents,    // legs with a hazard the truck has ALREADY reached
 *     spoil,        // boxes lost so far (incidents reached)
 *     spoilFinal,   // boxes this route will cost in total
 *     dishes,       // boxes loaded
 *     delivering,   // boxes that will actually land = dishes - spoilFinal
 *     food,         // live `food` that lands = delivering × CONVOY_FOOD_PER_DISH
 *     armed,        // false when ECON.CONVOY_SPOIL_PCT is absent/0
 *   }
 *
 * PURE and cheap enough for `frame()`. Safe against a null convoy.
 */
export function route(c, now) {
  const empty = {
    pct: 0, etaMs: 0, arrived: false,
    origin: { name: 'Your kitchen', icon: '🍔' }, dest: { name: 'Their city', icon: '🏙' },
    legs: [], incidents: [], spoil: 0, spoilFinal: 0, dishes: 0, delivering: 0, food: 0, armed: false,
  };
  try {
    if (!c || typeof c !== 'object') return empty;
    const plan = routePlan(c);
    const pct = progress(c, now);
    const inbound = c.dir === 'in';
    const legs = plan.legs.map((l) => Object.assign({}, l, { passed: pct >= l.at }));
    const incidents = legs.filter((l) => l.hazard && l.passed);
    let spoil = 0;
    for (const l of incidents) spoil += Math.max(0, _int(l.lost));
    const delivering = Math.max(0, plan.dishes - plan.spoilFinal);
    return {
      pct,
      etaMs: Math.max(0, _num(c.arrivesAt, 0) - _num(now, 0)),
      arrived: c.state !== 'transit',
      origin: inbound
        ? { name: _str(c.fromName || 'Another kitchen', 40), icon: '🍔' }
        : { name: 'Your kitchen', icon: '🍔' },
      dest: inbound
        ? { name: 'Your city', icon: '🏙' }
        : { name: _str(c.toName || 'Their city', 40), icon: '🏙' },
      legs,
      incidents,
      spoil,
      spoilFinal: plan.spoilFinal,
      dishes: plan.dishes,
      delivering,
      food: Math.max(0, Math.floor(delivering * EC('CONVOY_FOOD_PER_DISH', 1))),
      armed: plan.armed,
    };
  } catch (e) { return empty; }
}

/** Boxes this route costs. The ONE number `owedFood()` subtracts, so the panel
    and the payout can never disagree about what the road took. */
function spoilOf(c) {
  try { return Math.max(0, _int(routePlan(c).spoilFinal)); } catch (e) { return 0; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §4 — 🔴 WHO OWNS THE TRUTH, AND THE DEPOT HOLD
   ═══════════════════════════════════════════════════════════════════════════

   THE ROUND-1 BUG, in one sentence: the client believed a short-landed claim
   left the remainder "on the truck", while the server had already closed the
   truck — so the next heartbeat deleted it and the remainder was gone.

   THE RULE, and it is not a compromise, it is a split:

     THE SERVER OWNS DELIVERY.  `kitchen_convoy_claim()` decides, once and for
       all, whether this convoy has been handed over and how many boxes it
       handed over (`delivered_dishes`). Once it says delivered, the convoy is
       OVER. It is never re-claimed, never re-shown as inbound, and this file
       never calls the RPC for it again. That is the fact a ledger records.

     THE CLIENT OWNS THE STASH.  Whether those boxes FIT is a question about the
       player's vault, which the server knows nothing about. `addRes()` enforces
       the stash cap and returns without adding when it is full (CONTRACT §7,
       and that behaviour once destroyed 215 units of a real player's
       resources). So a short landing is a LOCAL condition with a LOCAL answer.

   THE DEPOT HOLD is that answer. What did not fit becomes a row in `K.convoys`
   with `state:'held'` and `serverClaimed:true`:

     · `K.convoys` is in `snapshot()` (CONTRACT §5), so the hold survives a
       reload. `K.inbound` is NOT, which is exactly why the remainder cannot be
       left there.
     · `serverClaimed` means "the RPC has already paid this out" — the hold
       never touches the network again, so it cannot double-claim by any route.
     · `paidFood` records what has landed so far, so the drain pays only the
       remainder however many times it runs.
     · `drainHeld()` retries on every catch-up and on a throttled tick, so the
       food arrives on its own as the player makes room. No lost truck, no
       button they have to remember to press.

   The renderer shows it as what it is: "Held at the depot: N food — your stash
   was full." Not "on the truck". The truck is gone; the food is on a dock.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Units of live `food` a convoy still owes.
 *
 * 🔴 THE CEILING IS `dishes`, AND ON AN INBOUND CONVOY `dishes` IS WHATEVER THE
 * SERVER LAST TOLD US — never a `food` field on the row, which was written by
 * somebody else's client and is therefore a claim, not a fact. The route can
 * only take boxes OFF that ceiling (§3, rule 6).
 */
function owedFood(c) {
  const dishes = Math.max(0, _int(c && c.dishes));
  const perDish = Math.max(0, _num(EC('CONVOY_FOOD_PER_DISH', 1), 1));
  const gross = Math.max(0, Math.floor(Math.max(0, dishes - spoilOf(c)) * perDish));
  return Math.max(0, gross - Math.max(0, _int(c && c.paidFood)));
}

/** Every truck sitting on the dock with food that would not fit. Pure read. */
export function held(K) {
  const out = [];
  try {
    for (const c of ((K && K.convoys) || [])) {
      if (!c || c.state !== 'held') continue;
      out.push({
        id: c.id,
        remoteId: c.remoteId || null,
        dir: c.dir || 'out',
        fromName: c.fromName || '',
        toName: c.toName || '',
        dishes: Math.max(0, _int(c.dishes)),
        paidFood: Math.max(0, _int(c.paidFood)),
        food: owedFood(c),
        heldAt: _num(c.heldAt, 0),
      });
    }
  } catch (e) {}
  return out;
}

/** Total live `food` waiting on the dock. One number for a HUD chip. */
export function heldFood(K) {
  let n = 0;
  for (const h of held(K)) n += Math.max(0, _int(h.food));
  return n;
}

/**
 * Move a short-landed convoy onto the dock.
 *
 * ⚠ THE ROW MOVES OUT OF `K.inbound` AND INTO `K.convoys`. That is not tidying:
 * `K.inbound` is rebuilt from the server on every sync and is not saved, and
 * the server row is already `claimed`, so a hold left in `K.inbound` is deleted
 * by the next heartbeat. This one line is the whole of finding #3's fix.
 */
function holdRow(K, found, t, landedNow) {
  const c = found.row;
  c.state = 'held';
  c.heldAt = _num(t, 0);
  if (found.where === 'in') {
    c.serverClaimed = true;          // the RPC has paid; never call it again
    K.inbound = (K.inbound || []).filter((x) => x !== c);
    if ((K.convoys || []).indexOf(c) === -1) K.convoys.push(c);
  }
  K.rev++;
  forceSave(K);
  raise(K, null, 'convoy:claim', {
    id: c.id, granted: _int(landedNow), held: owedFood(c),
    dishes: _int(c.dishes), dir: c.dir === 'in' ? 'in' : 'out', partial: true,
  });
}

/**
 * Push held food into the stash, as much as fits, and retire anything that
 * empties out. Returns the units that landed this pass.
 *
 * 🔴 NO SERVER CALL, EVER. A held row is already paid for on the server side —
 * see `serverClaimed` — so this is purely "does it fit yet".
 */
function drainHeld(K, now, out) {
  let landedTotal = 0;
  try {
    // Same rule as claim()'s held branch: an unpaid server row is not a hold.
    // The drain SKIPS it rather than repairing it, because the drain runs on a
    // timer and must never surprise the player with a state change.
    const rows = (K.convoys || []).filter(
      (c) => c && c.state === 'held' && !(c.remoteId && !c.serverClaimed));
    if (!rows.length) return 0;
    const b = bridge();
    if (noStash()) return 0;                           // rung 1: no stash to fill

    for (const c of rows) {
      const owed = owedFood(c);
      if (owed <= 0) { retire(K, c, now, 0, out); continue; }

      let room = Infinity;
      try {
        const cap = _int(b.resourceCap ? b.resourceCap() : 0);
        const used = _int(b.resourceUnits ? b.resourceUnits() : 0);
        if (cap > 0) room = Math.max(0, cap - used);
      } catch (e) { room = Infinity; }
      if (room <= 0) continue;                          // still no room; wait

      const take = Math.max(0, Math.min(owed, room === Infinity ? owed : room));
      if (take <= 0) continue;

      let before = 0;
      try { before = _int(b.getRes ? b.getRes('food') : 0); } catch (e) { before = 0; }
      let called = false;
      try { called = b.addRes('food', take) === true; } catch (e) { called = false; }
      let after = before + (called ? take : 0);
      try { if (b.getRes) after = _int(b.getRes('food')); } catch (e) {}
      const landed = _clamp(after - before, 0, take);
      if (landed <= 0) continue;

      c.paidFood = Math.max(0, _int(c.paidFood)) + landed;
      landedTotal += landed;
      K.rev++;
      if (owedFood(c) <= 0) retire(K, c, now, landed, out);
      else {
        forceSave(K);
        raise(K, out, 'convoy:claim', {
          id: c.id, granted: landed, held: owedFood(c),
          dishes: _int(c.dishes), dir: c.dir === 'in' ? 'in' : 'out', partial: true,
        });
      }
    }
  } catch (e) { /* rule 2 */ }
  return landedTotal;
}

/** Take a finished truck off the board and say so once. */
function retire(K, c, t, granted, out) {
  c.state = 'claimed';
  c.claimedAt = _num(t, 0);
  K.convoys = (K.convoys || []).filter((x) => x !== c);
  K.inbound = (K.inbound || []).filter((x) => x !== c);
  K.rev++;
  raise(K, out, 'convoy:claim', {
    id: c.id, granted: _int(granted), held: 0,
    dishes: _int(c.dishes), dir: c.dir === 'in' ? 'in' : 'out',
  });
  forceSave(K);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §5 — TRANSIT & ARRIVAL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * XP for the sender, on arrival.
 *
 * ⚠ WHY THIS IS WRITTEN OUT INSTEAD OF CALLED. kitchen.state.js's `addXp()` is
 * module-private — it is not in its export list and this file may not edit that
 * file. CONTRACT rule 2 names convoy.js as one of the three files allowed to
 * mutate `K`, so the grant is legal; it is the DUPLICATION that needs the note.
 * The level is derived through `DATA.levelForXp` (the same function state.js
 * uses) rather than incremented, so the two paths cannot drift. If state.js
 * ever exports `addXp`, delete this and call it.
 */
function grantXp(K, out, n) {
  const gain = Math.max(0, _int(n));
  if (!gain) return;
  const before = Math.max(1, _int(K.level) || 1);
  K.xp = Math.max(0, _int(K.xp)) + gain;
  const f = DF('levelForXp');
  let lv = before;
  if (f) { try { lv = Math.max(1, _int(f(K.xp))); } catch (e) { lv = before; } }
  if (lv > before) {
    K.level = lv;
    K.rev++;
    let unlocked = [];
    const m = DF('menuForLevel');
    if (m) {
      try { unlocked = m(lv).filter((r) => _int(r.minLevel || 1) > before).map((r) => r.id); } catch (e) { unlocked = []; }
    }
    raise(K, out, 'level:up', { from: before, to: lv, unlocked });
  }
}

/**
 * Flip every truck whose clock has run out. THE ONE ARRIVAL PATH — `tick()` and
 * `catchUp()` both come through here, which is what makes calling both (as
 * state.js's `init()` deliberately does) idempotent: the `state` field is the
 * latch, so a second pass finds nothing in `'transit'` and does nothing.
 */
function arriveDue(K, now, out) {
  const t = _num(now, 0);
  if (!(t > 0)) return;      // `now = 0` is init() before the first tick. Nothing
                             // has arrived at the epoch; the first real tick flips it.

  // ── OUTBOUND (mine) ──────────────────────────────────────────────────────
  const drop = [];
  for (const c of (K.convoys || [])) {
    if (!c || c.state !== 'transit') continue;
    if (_num(c.arrivesAt, Infinity) > t) continue;
    c.state = 'arrived';
    c.arrivedAt = t;
    K.rev++;

    if (!c.xpPaid) {
      c.xpPaid = true;
      // Sized in ECON against the counter sale the sender GAVE UP — see the
      // comment on CONVOY_XP_PER_DISH. It is xp only: no Cinder, no resources,
      // so it cannot be part of any printing loop.
      grantXp(K, out, Math.max(0, _int(c.dishes)) * Math.max(0, _int(EC('CONVOY_XP_PER_DISH', 6))));
    }

    // ⚠ THE ARRIVAL PAYLOAD IS THE BANNER'S SCRIPT. The renderer draws a
    //   full-width arrival moment off this, so it carries the whole story: who,
    //   how many boxes, what the road took, what actually lands.
    const r = route(c, t);
    raise(K, out, 'convoy:arrive', {
      id: c.id, dishes: _int(c.dishes), toName: c.toName || '', fromName: c.fromName || '',
      self: !!c.self, dir: 'out', spoil: r.spoilFinal, delivered: r.delivering, food: r.food,
      incidents: r.incidents.length,
    });

    // A truck addressed to SOMEBODY ELSE is theirs to unload. Keeping the
    // sender's copy would leave a row on the sender's board with a Claim button
    // that can only ever fail, so it is retired the moment it lands.
    if (!c.self) { c.state = 'claimed'; c.deliveredAt = t; drop.push(c.id); }
  }
  if (drop.length) K.convoys = K.convoys.filter((c) => drop.indexOf(c.id) === -1);

  // ── INBOUND (mirrors of server rows) ─────────────────────────────────────
  // These carry no XP and no fee — they are somebody else's launch. All that
  // happens locally is the flip that puts a Claim button on the row.
  for (const c of (K.inbound || [])) {
    if (!c || c.state !== 'transit') continue;
    if (_num(c.arrivesAt, Infinity) > t) continue;
    c.state = 'arrived';
    K.rev++;
    const r = route(c, t);
    raise(K, out, 'convoy:arrive', {
      id: c.id, dishes: _int(c.dishes), toName: c.toName || '', fromName: c.fromName || '',
      self: false, dir: 'in', spoil: r.spoilFinal, delivered: r.delivering, food: r.food,
      incidents: r.incidents.length,
    });
  }
}

/**
 * Per-frame advance. Cheap on purpose: a convoy has exactly one interesting
 * moment in six hours, so this is a comparison per row and nothing else.
 * `dt` is unused and that is correct — arrival is an absolute deadline, not an
 * accumulated one, so a clamped/backgrounded `dt` can never desynchronise it.
 */
export function tick(K, dt, now) {
  const out = [];
  try {
    if (!K || typeof K !== 'object') return out;
    arriveDue(K, now, out);
    maybeDrain(K, _num(now, 0), out);
    maybeSync(K, _num(now, 0));
  } catch (e) { /* rule 2: never throw into the sim */ }
  return out;
}

/**
 * Close the gap for the hours the panel was shut (CONTRACT §4). Idempotent —
 * state.js calls it from `init()` AND `open()` on purpose, and the arrival latch
 * in `arriveDue()` is what makes that belt-and-braces instead of a double-pay.
 */
export function catchUp(K, now) {
  const out = [];
  try {
    if (!K || typeof K !== 'object') return out;
    arriveDue(K, now, out);
    // Opening the bay is the natural moment to try the dock again — the player
    // has been away and may well have spent their way back under the cap.
    drainHeld(K, _num(now, 0), out);
    // …and to ask the server what turned up while you were gone.
    // Fire-and-forget: `catchUp` is synchronous by contract (state.js consumes
    // its return value inline) and a network round trip must never sit in front
    // of the panel opening.
    maybeSync(K, _num(now, 0), true);
  } catch (e) {}
  return out;
}

/** Throttled dock retry. ⚠ NOT every frame: `addRes` goes through the legacy
    app and re-reads the whole stash, and doing that 60×/second to answer "is
    there room yet" would be a real cost for a question that changes on the
    scale of seconds. `CONVOY_HOLD_MS` is a UI cadence, not a price. */
function maybeDrain(K, now, out) {
  if (!(now > 0)) return;
  const every = Math.max(1000, _int(EC('CONVOY_HOLD_MS', 5000)));   // ⚠ not in ECON yet
  const last = _num(K._holdDrain, 0);
  if (last && (now - last) < every) return;
  K._holdDrain = now;
  drainHeld(K, now, out);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §6 — THE NETWORK MIRROR
   ═══════════════════════════════════════════════════════════════════════════ */

/** Server row → the client shape render already knows how to draw. */
function mapInbound(row, now) {
  const arrives = Date.parse(row.arrives_at || '') || 0;
  const launched = Date.parse(row.launched_at || '') || 0;
  const claimed = String(row.state || '') === 'claimed';
  return {
    id: 'rx:' + row.id,          // namespaced so an inbound id can never collide
    remoteId: row.id,            // with a local one in `claim()`'s lookup
    dir: 'in',
    self: false,
    tierId: row.tier || 'van',
    fromUserId: row.from_user || null,
    toUserId: row.to_user || null,
    // render prints `toName` as the row title. On an INBOUND row the useful
    // name is who sent it, so that is what goes there; `fromName` carries the
    // bare name for the route's origin marker.
    toName: 'From ' + _str(row.from_name || 'another kitchen', 40),
    fromName: _str(row.from_name || 'Another kitchen', 40),
    items: (row.items && typeof row.items === 'object') ? row.items : {},
    dishes: Math.max(0, _int(row.dishes)),
    launchedAt: launched || (arrives - 1),
    arrivesAt: arrives,
    state: claimed ? 'claimed' : (arrives && arrives <= _num(now, 0) ? 'arrived' : 'transit'),
    feeCinder: 0,
    paidFood: 0,
    serverClaimed: false,
    xpPaid: true,                // never any XP on the receiving end
  };
}

/**
 * Pull what is addressed to me, and reconcile what I sent.
 *
 * ⚠ IT DOES BOTH, AND THE NAME ONLY SAYS ONE. Kept as `refreshInbound` because
 * that is the CONTRACT §1 signature; it wants renaming to `sync()` in the next
 * contract pass. WHY they are one call: it is one panel open, one round trip,
 * and a sender who never learns their truck was unloaded keeps a ghost row on
 * their board forever.
 *
 * Degradation is the whole point of this function: a missing table, a signed-out
 * session and a dead network all end the same way — `K.inbound = []`, a flag
 * set, no throw, no toast. CONTRACT §9 rungs 2 and 3.
 */
export async function refreshInbound(K) {
  try {
    if (!K || typeof K !== 'object') return false;

    const inb = await API.listInbound();
    if (!inb || !inb.ok) {
      const had = (K.inbound || []).length;
      K.inbound = [];
      const miss = !!(inb && inb.missing), off = !!(inb && inb.offline);
      // ⚠ `error` stays null for missing/offline. Those are SETUP states, not
      //    failures, and render paints an error banner off `K.error`.
      const err = (inb && inb.error && !miss && !off) ? inb.error : null;
      // ⚠ ONLY BUMP `rev` ON A REAL CHANGE. This runs on a 60s heartbeat and
      //    `rev` drives a FULL structural repaint (§6), which drops focus and
      //    scroll. A signed-out player would otherwise have the convoy sheet
      //    yanked out from under them once a minute for no reason at all —
      //    including, now, while they are typing in the recipient search.
      if (had || K.missing !== miss || K.offline !== off || K.error !== err) K.rev++;
      K.missing = miss; K.offline = off; K.error = err;
      return false;
    }
    const changed = K.missing || K.offline || K.error;
    K.missing = false; K.offline = false; K.error = null;

    const now = _num(K.now, 0);
    const rows = Array.isArray(inb.rows) ? inb.rows : [];
    const seen = Object.create(null);
    // 🔴 A HELD ROW IS NOT AN INBOUND ROW. It lives in `K.convoys`, the server
    //    already marked it claimed, and re-mirroring it here would resurrect a
    //    truck the RPC will never pay for again. Round 1's carry-forward of
    //    `paidFood` into a fresh mirror is DELETED, not moved: the row it was
    //    written for could not survive the `state='claimed'` filter above it,
    //    so it was unreachable code standing where the bug was.
    const heldRemote = Object.create(null);
    for (const c of (K.convoys || [])) if (c && c.state === 'held' && c.remoteId) heldRemote[c.remoteId] = 1;

    const next = [];
    for (const r of rows) {
      if (!r || !r.id || seen[r.id]) continue;
      seen[r.id] = 1;
      if (heldRemote[r.id]) continue;              // already on our dock
      const m = mapInbound(r, now);
      if (m.state === 'claimed') continue;         // already unloaded; nothing to show
      next.push(m);
    }
    // Same repaint discipline as the failure branch: a heartbeat that changed
    // nothing must not repaint. The signature is id+state, which is everything
    // render's convoy row draws structurally (the ETA and the truck position
    // are `frame()` updates).
    const sig = (rows2) => rows2.map((x) => x.remoteId + ':' + x.state).join('|');
    const dirty = sig(K.inbound || []) !== sig(next);
    K.inbound = next;

    // ── RECONCILE MINE ──────────────────────────────────────────────────────
    let reconciled = false;
    const outb = await API.listOutbound();
    if (outb && outb.ok && Array.isArray(outb.rows)) {
      const byRemote = Object.create(null);
      for (const r of outb.rows) if (r && r.id) byRemote[r.id] = r;
      const drop = [];
      for (const c of (K.convoys || [])) {
        if (!c || !c.remoteId) continue;           // local practice runs are not up there
        if (c.dir === 'in') continue;              // a held inbound row is ours to drain
        if (c.state === 'held') continue;          // …and is never reconciled away
        const r = byRemote[c.remoteId];
        if (!r) continue;
        if (String(r.state || '') === 'claimed') { c.state = 'claimed'; drop.push(c.id); }
      }
      if (drop.length) {
        K.convoys = K.convoys.filter((c) => drop.indexOf(c.id) === -1);
        reconciled = true;
        forceSave(K);   // the board shrank; that belongs in the save, not in RAM
      }
      // People I have actually shipped to, newest first — the picker's "recent"
      // list. Not persisted on purpose: it is a convenience derived from the
      // server's own record, and CONTRACT §5 fixes what `snapshot()` saves.
      K._partners = partnersFrom(outb.rows);
    }

    if (dirty || reconciled || changed) K.rev++;
    return true;
  } catch (e) {
    // The api layer does not throw; this is the last net under it.
    try { K.inbound = []; K.rev++; } catch (e2) {}
    return false;
  }
}

/** Distinct recipients out of an outbound history, newest first. */
function partnersFrom(rows) {
  const out = [], seen = Object.create(null);
  for (const r of (rows || [])) {
    if (!r || !r.to_user || seen[r.to_user]) continue;
    seen[r.to_user] = 1;
    out.push({ id: r.to_user, name: _str(r.to_name || 'Survivor', 40), kind: 'recent', sub: 'shipped before' });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * Throttled fire-and-forget wrapper around `refreshInbound`.
 *
 * ⚠ NOTHING ELSE CALLS refreshInbound on a schedule. render's convoy sheet
 * reads `K.inbound` and index.js drives only `tick`/`catchUp`, so without this
 * hook an inbound convoy would never appear on the board at all. The throttle
 * stamp is `now` — the same value the sim runs on — so there is still no clock
 * read in here.
 */
function maybeSync(K, now, force) {
  const every = Math.max(15000, _int(EC('CONVOY_SYNC_MS', 60000)));   // ⚠ not in ECON yet
  const last = _num(K._convoySync, 0);
  if (!force && last && (now - last) < every) return;
  if (!(now > 0)) return;
  if (K._convoySyncing) return;
  K._convoySync = now;
  K._convoySyncing = true;
  try {
    Promise.resolve(refreshInbound(K))
      .then(() => { K._convoySyncing = false; }, () => { K._convoySyncing = false; });
  } catch (e) { K._convoySyncing = false; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §7 — CLAIM: the only place `food` enters the live ledger
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠ `where` IS THE DIRECTION, NOT THE LIST IT WAS FOUND IN. A held inbound
 * convoy lives in `K.convoys` (§4) and must still be classified `'in'`, because
 * `'in'` is what makes `claim()` demand a server confirmation. Keying it off
 * the array would let a row move lists and quietly lose its server leg.
 */
function findConvoy(K, convoyId) {
  const id = String(convoyId || '');
  const dirOf = (c) => (c.dir === 'in' ? 'in' : 'out');
  for (const c of (K.convoys || [])) if (c && (c.id === id || (c.remoteId && c.remoteId === id))) return { row: c, where: dirOf(c) };
  for (const c of (K.inbound || [])) if (c && (c.id === id || c.remoteId === id)) return { row: c, where: 'in' };
  return null;
}

/**
 * Unload an arrived convoy into the stash.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE SAFETY STORY:
 *   1. Refuse anything that has not landed. No payout for a truck in transit.
 *   2. PREFLIGHT THE STASH CAP before touching the server. If the vault has no
 *      room at all, nothing is claimed anywhere and the truck stays claimable —
 *      burning a one-shot server claim on a vault that cannot take a single
 *      unit would put the whole load on the dock for nothing.
 *   3. SERVER FIRST for an inbound convoy. `kitchen_convoy_claim()` appends the
 *      ledger row and flips the state atomically and returns TWO facts:
 *        · `first_claim`      — was THIS call the one that delivered?
 *        · `delivered_dishes` — how many boxes THIS call delivered (0 on a replay).
 *      🔴 `delivered_dishes` IS THE ONLY QUANTITY THIS FUNCTION MAY PAY ON.
 *      Round 1 credited the stash on any `ok`, so two tabs claiming one 40-box
 *      truck credited 80 food out of nothing. A replay now credits zero,
 *      because the server says zero.
 *   4. `addRes` then RE-READ `getRes`. 🔴 §7: `addRes()` enforces the stash cap
 *      and returns without adding when the vault is full. A short landing does
 *      NOT stay "on the truck" — the truck is delivered and gone. It becomes a
 *      DEPOT HOLD (§4) that persists and drains itself.
 */
export async function claim(K, convoyId, now) {
  try {
    if (!K || typeof K !== 'object') return no('BAD_ARG', 'The kitchen is not open.');
    const t = _num(now, _num(K.now, 0));
    const found = findConvoy(K, convoyId);
    if (!found) return no('BAD_ARG', 'That convoy is not on the board.');
    const c = found.row;

    if (c.state === 'claimed') return no('NOT_READY', 'That convoy has already been unloaded.');

    /* ── A HELD ROW: the dock, not the road. No server call — the RPC has
       already paid this out (`serverClaimed`) and asking again would return
       `first_claim:false` anyway. All that is left is whether it fits. ── */
    if (c.state === 'held') {
      // 🔴 A HELD ROW IS PAID-FOR OR IT IS NOT A HELD ROW. `K.convoys` is
      //    restored from `Profile.kitchen`, which is the player's own save and
      //    is therefore not evidence of anything. A hand-edited save that
      //    marked a server-backed convoy `held` without `serverClaimed` would
      //    otherwise take the local drain path and be paid without the RPC ever
      //    running. Send it back to the server instead of trusting the file.
      if (c.remoteId && !c.serverClaimed) {
        c.state = 'arrived';
        K.inbound = (K.inbound || []).concat([c]);
        K.convoys = (K.convoys || []).filter((x) => x !== c);
        K.rev++;
        return no('NOT_READY', 'That convoy has to be released by the depot. Try again in a moment.');
      }
      const landed = drainHeld(K, t, null);
      const left = owedFood(c);
      if (landed > 0 && left <= 0) return ok({ granted: landed });
      if (landed > 0) return no('CAP', 'Took ' + landed + ' food — ' + left + ' is still held at the depot.', { granted: landed, held: left });
      return no('CAP', 'Your stash is still full — ' + left + ' food is held at the depot.', { granted: 0, held: left });
    }

    if (c.state !== 'arrived' || _num(c.arrivesAt, Infinity) > t) {
      return no('NOT_READY', 'That convoy is still on the road.');
    }

    const b = bridge();

    // 2 · ROOM.
    // ⚠ A cap of 0 means the bridge could not tell us (NULL_BRIDGE returns 0 for
    //   both readings), NOT that the stash is full. Gating on an unknown would
    //   make every claim fail on CONTRACT §9 rung 1. The post-credit re-read
    //   below is the real check; this one exists only to avoid burning the
    //   one-shot server claim on a vault we already know cannot take anything.
    let room = Infinity;
    try {
      const cap = _int(b.resourceCap ? b.resourceCap() : 0);
      const used = _int(b.resourceUnits ? b.resourceUnits() : 0);
      if (cap > 0) room = Math.max(0, cap - used);
    } catch (e) { room = Infinity; }
    if (owedFood(c) > 0 && room <= 0) {
      return no('CAP', 'Your stash is full — make room before you unload this.');
    }

    // 3 · THE SERVER LEG, for an inbound convoy only.
    let ceilingDishes = Math.max(0, _int(c.dishes));
    if (found.where === 'in') {
      if (!c.remoteId) return no('BAD_ARG', 'That convoy has no manifest.');
      if (c.serverClaimed) return no('NOT_READY', 'That convoy has already been unloaded.');
      let res = null;
      try { res = await API.claimConvoy(c.remoteId); } catch (e) { res = null; }
      if (!res || !res.ok) {
        if (res && res.missing) { K.missing = true; return no('CLOSED', 'The convoy network is not set up yet.'); }
        if (res && res.offline) { K.offline = true; return no('CLOSED', 'Sign in to unload a convoy from another player.'); }
        // 🔴 NO LOCAL FALLBACK HERE, EVER. Granting `food` for an inbound
        //    convoy the server did not confirm would let an offline client
        //    unload the same truck as many times as it liked.
        return no('NOT_READY', 'The depot would not release that convoy. Try again in a moment.');
      }
      // Trust the server's dish count over the mirror's — the mirror is a copy
      // and the row is the record.
      if (res.row && res.row.dishes != null) c.dishes = Math.max(0, _int(res.row.dishes));
      c.serverClaimed = true;

      /* 🔴 THE DOUBLE-PAYOUT WALL, AND IT IS ONE LINE.
         `deliveredDishes` is what THIS call delivered. On a first claim it is
         the truck's box count; on a replay — a second tab, a retried fetch, a
         request the network duplicated — the server's unique index on
         (convoy_id, kind) swallowed the ledger insert and it comes back 0.
         Paying on anything else is how round 1 minted 40 food. */
      ceilingDishes = Math.max(0, _int(res.deliveredDishes));
      // Pin the row to the number we are actually paying on, so `owedFood()` —
      // which the depot hold, the board and the drain all read — can never
      // compute a different ceiling from the one this claim used.
      if (ceilingDishes > 0) c.dishes = ceilingDishes;
      if (res.firstClaim === false || ceilingDishes <= 0) {
        // Someone (probably this player, in another tab) already collected it.
        retire(K, c, t, 0, null);
        return ok({ granted: 0, already: true, why: 'That convoy was already unloaded.' });
      }
    }

    // 🔴 THE PAYOUT CEILING, computed in ONE place from the server's number.
    //    The route may take boxes off it (§3) and nothing may put boxes on.
    const perDish = Math.max(0, _num(EC('CONVOY_FOOD_PER_DISH', 1), 1));
    const spoil = spoilOf(c);
    const owed = Math.max(0, Math.floor(Math.max(0, ceilingDishes - spoil) * perDish)
                             - Math.max(0, _int(c.paidFood)));

    if (owed <= 0) {
      retire(K, c, t, 0, null);
      return ok({ granted: 0, spoil });
    }

    // 4 · CREDIT.
    if (noStash()) {
      // Rung 1: no bridge at all. There is no stash to put it in and there
      // never will be, so this is NOT a short landing — parking the truck on a
      // dock that can never be drained would leave a phantom on the board
      // forever, which is worse than a no-op.
      retire(K, c, t, 0, null);
      return ok({ granted: 0 });
    }
    let before = 0;
    try { before = _int(b.getRes ? b.getRes('food') : 0); } catch (e) { before = 0; }
    let called = false;
    try { called = b.addRes('food', owed) === true; } catch (e) { called = false; }
    let after = before + (called ? owed : 0);
    try { if (b.getRes) after = _int(b.getRes('food')); } catch (e) {}
    const landed = _clamp(after - before, 0, owed);

    c.paidFood = Math.max(0, _int(c.paidFood)) + landed;
    K.rev++;

    if (landed < owed) {
      // 🔴 SHORT LANDING → THE DOCK, NOT THE TRUCK. See §4 for who owns what.
      //    "The preflight should have caught it" is exactly how 215 units of a
      //    real player's resources went missing — see the refundRes note in §7
      //    of the CONTRACT.
      holdRow(K, found, t, landed);
      const left = owedFood(c);
      return no('CAP', 'Your stash filled up — ' + left + ' food is held at the depot and will load itself as you make room.',
        { granted: landed, held: left });
    }

    retire(K, c, t, landed, null);
    return ok({ granted: landed, spoil });
  } catch (e) {
    return no('BAD_ARG', 'That convoy will not unload.');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §8 — THE RECIPIENT PICKER
   ═══════════════════════════════════════════════════════════════════════════
   🔴 THIS IS THE FEATURE. Round 1 had `recipients()` and `API.findPlayer()` and
   zero call sites for either, so every convoy went to the player's own id and
   the network was decoration. The renderer's contract is written out in full in
   the doc comment on `recipients()` because a wiring agent builds the picker
   from these words.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Who can I ship to?
 *
 * ```js
 * const r = await Convoy.recipients(fragment, K);
 * // r = { ok:true, rows:[…], offline:false, missing:false, searching:false, why:'' }
 * // row = { id:'<uuid>', name:'Kestrel', kind:'recent'|'player', sub:'shipped before' }
 * ```
 *
 * THE RENDERER'S SIDE OF THE DEAL:
 *   · Call it on input, debounced. It is cheap and it never throws.
 *   · `fragment` shorter than two characters returns RECENT partners only, with
 *     `searching:false` — that is not an error, it is the resting state of the
 *     picker, and the list is still useful because most convoys go to someone
 *     you have shipped to before.
 *   · `rows` is ALREADY de-duplicated and already excludes me.
 *   · `why` is a sentence to put under the field: "Type two letters", "Sign in
 *     to ship to another player", "The convoy network is not set up yet",
 *     "Nobody by that name."
 *   · Pass the CHOSEN ROW straight into `launch(K, draft, row, now)`. Pass
 *     `null` for the explicit practice run. Do NOT pass `bridge().userId()` —
 *     that was round 1's bug and it made the whole network unreachable.
 *
 * ⚠ `offline` and `missing` ARE SETUP STATES, NOT ERRORS (CONTRACT §9). Show
 * `why` as a quiet line, never a toast, and keep the practice-run option live:
 * every rung of the ladder can still load a truck.
 */
export async function recipients(fragment, K) {
  const q = String(fragment == null ? '' : fragment).trim();
  const recents = recentPartners(K);
  const base = { ok: true, rows: recents, offline: false, missing: false, searching: false, why: '' };
  try {
    if (!myId()) {
      base.offline = true;
      base.rows = [];
      base.why = 'Sign in to ship to another player. Practice runs to your own city still work.';
      return base;
    }
    if (q.length < 2) {
      base.why = recents.length ? 'Type two letters to find someone else.' : 'Type two letters to find a player.';
      return base;
    }
    base.searching = true;

    let r = null;
    try { r = await API.findPlayer(q); } catch (e) { r = null; }
    if (!r || !r.ok) {
      base.missing = !!(r && r.missing);
      base.offline = !!(r && r.offline);
      base.why = base.missing
        ? 'The player directory is not available. Practice runs still work.'
        : 'Could not reach the directory. Try again in a moment.';
      return base;
    }

    const seen = Object.create(null);
    const rows = [];
    // Recents that MATCH the fragment stay pinned at the top: the person you
    // shipped to yesterday is far more likely than a stranger with a similar
    // name, and making the player scroll past strangers to find them is the
    // kind of small rudeness that stops a feature being used.
    const needle = q.toLowerCase();
    for (const p of recents) {
      if (!p || !p.id || seen[p.id]) continue;
      if (String(p.name || '').toLowerCase().indexOf(needle) === -1) continue;
      seen[p.id] = 1; rows.push(p);
    }
    for (const row of (r.rows || [])) {
      const id = row && row.user_id;
      if (!id || seen[id]) continue;
      seen[id] = 1;
      rows.push({ id, name: _str(row.display_name || 'Survivor', 40), kind: 'player', sub: '' });
    }
    base.rows = rows;
    if (!rows.length) base.why = 'Nobody by that name.';
    return base;
  } catch (e) {
    // Rule 2: an async entry point that rejects reaches render as "undefined".
    return { ok: true, rows: recents, offline: false, missing: false, searching: false, why: '' };
  }
}

/**
 * People I have shipped to before. PURE, SYNCHRONOUS and offline-safe, so the
 * picker has something in it the instant it opens instead of a spinner.
 *
 * Source order matters: `K._partners` is the server's own outbound history
 * (filled by `refreshInbound`), and the live board is the fallback for a player
 * who has not synced yet this session.
 */
export function recentPartners(K, limit) {
  const out = [], seen = Object.create(null);
  const cap = Math.max(1, _int(limit || 6));
  try {
    for (const p of ((K && K._partners) || [])) {
      if (!p || !p.id || seen[p.id]) continue;
      seen[p.id] = 1; out.push(p);
      if (out.length >= cap) return out;
    }
    for (const c of ((K && K.convoys) || [])) {
      if (!c || c.self || !c.toUserId || seen[c.toUserId]) continue;
      seen[c.toUserId] = 1;
      out.push({ id: c.toUserId, name: _str(c.toName || 'Survivor', 40), kind: 'recent', sub: 'shipped before' });
      if (out.length >= cap) return out;
    }
    for (const c of ((K && K.inbound) || [])) {
      if (!c || !c.fromUserId || seen[c.fromUserId]) continue;
      seen[c.fromUserId] = 1;
      out.push({ id: c.fromUserId, name: _str(c.fromName || 'Survivor', 40), kind: 'recent', sub: 'shipped to you' });
      if (out.length >= cap) return out;
    }
  } catch (e) {}
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §9 — READ-ONLY VIEWS (for render and the debug panel)
   ═══════════════════════════════════════════════════════════════════════════
   ⚠ NOT IN CONTRACT.md's EXPORT LIST, and this note is the "say so" §0 asks
   for. They are pure reads over `K` with no mutation and no side effects, so
   nothing downstream has to know they exist; they want adding to §1 on the next
   pass. Nothing in this file depends on them.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every truck on the board, mine and inbound, newest departure first.
    Held rows sort with the rest — they carry a `launchedAt` like anything else. */
export function board(K) {
  const rows = [].concat(K && K.convoys ? K.convoys : [], K && K.inbound ? K.inbound : []);
  return rows.slice().sort((a, b2) => _num(b2.launchedAt, 0) - _num(a.launchedAt, 0));
}

/** 0..1 progress along the route, for the truck glyph on the route strip. */
export function progress(c, now) {
  if (!c) return 0;
  if (c.state && c.state !== 'transit') return 1;
  const span = Math.max(1, _num(c.arrivesAt, 0) - _num(c.launchedAt, 0));
  return _clamp((_num(now, 0) - _num(c.launchedAt, 0)) / span, 0, 1);
}

/**
 * The append-only movement log for one convoy — what the server recorded, not
 * what this client believes. Guarded and empty on every failure, like
 * everything else that touches the network.
 *
 * ⚠ Balance is `sum(amount)`: a launch row is `-dishes` (the boxes left the
 * sender) and a claim row is `+dishes` (they landed), so a delivered convoy
 * sums to zero and one still on the road sums to `-dishes`. There is no balance
 * column and there never will be (CLAUDE.md, `corp_treasury`).
 */
export async function history(convoyId) {
  try {
    const r = await API.listConvoyLedger(convoyId);
    if (!r || !r.ok) return { ok: false, rows: [], missing: !!(r && r.missing), offline: !!(r && r.offline) };
    return { ok: true, rows: r.rows || [], missing: false, offline: false };
  } catch (e) { return { ok: false, rows: [], missing: false, offline: false }; }
}
