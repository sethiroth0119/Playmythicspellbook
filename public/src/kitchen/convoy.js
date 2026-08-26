/* ═══════════════════════════════════════════════════════════════════════════
   🚚 convoy.js — PLAYER-TO-PLAYER SHIPPING. Composition · transit · arrival ·
   claim. The loading bay behind the kitchen.
   ═══════════════════════════════════════════════════════════════════════════

   WHAT THIS FILE IS
   "Set up a shipment to send to another player's city on a convoy that will
   send the player food." Everything that sentence implies lives here:

     1. COMPOSITION — you pick a truck and it eats finished dishes off the pass.
        Capacity is real, the level gate on the bigger trucks is real, and the
        freight fee is charged in Cinder at launch.
     2. TRANSIT — a wall-clock countdown measured in HOURS, not seconds.
     3. ARRIVAL — the truck lands whether or not the panel is open.
     4. CLAIM — the recipient unloads it into the live `food` ledger, exactly
        once, through a server RPC that cannot be replayed into a second payout.

   🔴 THE FIVE HARD RULES THIS FILE LIVES UNDER

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
      a value; none of them raise. `claim()` and `launch()` are `async` and
      therefore return REJECTED PROMISES if they throw — which render would swallow
      into "the convoy did not leave" with no reason — so they are wrapped too.

   3. WE MAY MUTATE `K`. CONTRACT rule 2 names exactly three files:
      kitchen.state.js, drivethru.js, convoy.js. We own `K.convoys` and
      `K.inbound` outright. We take dishes off `K.pass` (that is the whole
      point) and we move `K.xp` / `K.level` on arrival — see `grantXp()` for why
      that one is written out here instead of called.

   4. 🔴 A CONVOY MOVES VALUE. IT NEVER MINTS IT. This is the single most
      dangerous surface in the feature and ECON says so in capitals. The dishes
      were bought out of the 14-id live ledger via `buySupply()`, so a claim
      pays `dishes × ECON.CONVOY_FOOD_PER_DISH` units of `food` — a number
      deliberately tuned BELOW the food embodied in the cheapest dish that can
      ride. Two guards, both of which this file honours:
        · outer — only `DATA.shippable(recipeId)` dishes are ever loaded;
        · inner — even the cheapest UNSHIPPABLE dish costs more food than a
          claim pays, so a bug here still cannot print food.
      `DATA.convoyGuardOk()` recomputes both walls from the live tables. If you
      touch SUPPLY_RECIPES, RECIPES.steps or CONVOY_FOOD_PER_DISH, run it.
      🔴 NOTHING IN THIS FILE MAY EVER GRANT MORE THAN `dishes × perDish`.
      Not a bonus, not a "long haul" multiplier, not a round-up. There is no
      small version of that bug: `food` prices the Gene Vault, the Bottling
      Line, crafting and the resource market, and inflating it kills all four.

   5. THE SERVER IS THE LEDGER; THE STASH IS NOT. A P2P claim goes through
      `kitchen_convoy_claim()` FIRST and credits the stash only on what came
      back — the community.api.js `claimRewards` rule, verbatim, for the same
      reason (a double-click must not pay twice). A local practice run has no
      server row and no server leg.

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

/* ───────────────────────────────────────────────────────────────────────────
   ECON ACCESS. CLAUDE.md: "All operation pricing goes through _opEcon(). Never
   hardcode economy numbers." Kitchen's `_opEcon()` is `ECON` in kitchen.data.js
   and `EC()` is the only way this file reads it.

   🔴 THE SECOND ARGUMENT IS A NaN GUARD, NOT A TUNING VALUE. Changing it
   changes nothing on a correctly-built data file and will silently diverge from
   the number the designer is looking at. Retune in kitchen.data.js.

   ⚠ THREE KEYS BELOW ARE NOT IN ECON YET and are flagged where they are read:
   CONVOY_SPOIL_PCT, CONVOY_HISTORY_MS and CONVOY_SYNC_MS. Their fallbacks are
   chosen so the feature behaves EXACTLY as CONTRACT §8.4 describes when the
   keys are absent — spoilage OFF, in particular. They want adding to ECON in
   the next contract pass; inventing a spoilage rate locally would be inventing
   an economy number in the wrong file, which is the bug CLAUDE.md names.
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
    closed before the 5s debounce is indistinguishable from theft. */
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
 * A stable 0..1 from a string. Used ONLY for spoilage, and it must be stable:
 * a re-rolled loss would change the arrival amount every time the panel
 * repainted, which reads as the game lying about how much is on the truck.
 * FNV-1a, 32-bit — the smallest hash that does not clump on short ids.
 */
function _hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
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
 * ⚠ WHY TRIM AND NOT REFUSE. render hands us EVERY shippable dish on the pass
 * and lets the player press Load. Refusing an over-capacity load would disable
 * the button precisely when the player has the most to ship — "the van is full"
 * would read as "the van is broken". Trimming is the behaviour of a real
 * loading bay: it takes what fits and the rest waits for the next truck.
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
 * has `K.upgrades` to hand gets the upgraded capacity and fee. render does not
 * pass it and therefore sees the stock truck — a small under-quote for an
 * upgraded player, never an over-quote, which is the safe direction to be wrong
 * in when the number next to it is a price.
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
    // What the RECIPIENT gets. Quoted so the sender can see it is a transfer
    // and not a jackpot — see rule 4.
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
    an arrived truck waiting to be unloaded is not occupying a driver. */
function activeOutbound(K) {
  let n = 0;
  for (const c of (K.convoys || [])) if (c && c.state === 'transit') n++;
  return n;
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
        // 🔴 The AUTHORITATIVE grant is recomputed at claim() from `dishes` and
        //    ECON — never read back off the row, because on an inbound convoy
        //    that row was written by somebody else's client.
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
 * `toUserId` may be a user id string, `{id,name}` from a future recipient
 * picker, or null. Null — or your own id — is a PRACTICE RUN: a truck to your
 * own city that never touches the network. That is CONTRACT §9 rung 2/3 made
 * real, and it is safe for the same reason a P2P convoy is: the dishes cost
 * more `food` to make than the claim pays back, so a self-convoy is a small
 * deliberate LOSS plus a freight fee. It teaches the mechanic; it is not a loop.
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
    let toId = null, toName = '';
    if (toUserId && typeof toUserId === 'object') {
      toId = toUserId.id || toUserId.userId || null;
      toName = String(toUserId.name || toUserId.displayName || '').slice(0, 40);
    } else if (typeof toUserId === 'string' && toUserId) {
      toId = toUserId;
    }
    const mine = myId();
    const self = !toId || (mine && toId === mine);
    if (self) { toId = mine; toName = myName(); }
    if (!toName) toName = self ? myName() : 'Another kitchen';

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
      self,
      tierId: load.tierId,
      toUserId: toId || null,
      toName,
      fromName: myName(),
      items: Object.assign({}, load.items),
      dishes: load.dishes,
      launchedAt: t,
      arrivesAt: t + Math.max(0, _int(load.transitMs)),
      state: 'transit',
      feeCinder: paid,
      // Bookkeeping the claim path needs. `paidFood` makes a partial unload
      // (stash hit its cap) resumable without paying the landed part twice.
      paidFood: 0,
      xpPaid: false,
    };
    K.convoys.push(row);
    K.rev++;
    raise(K, null, 'convoy:launch', {
      id: row.id, tierId: row.tierId, dishes: row.dishes,
      toName: row.toName, self, feeCinder: paid, arrivesAt: row.arrivesAt,
    });
    forceSave(K);

    // 7 · THE SERVER LEG. Best effort, never fatal. A practice run skips it
    //     entirely: writing a self-addressed row would give the same truck two
    //     claim paths (local and RPC) and one of them would pay twice.
    if (!self && toId) {
      let res = null;
      try {
        res = await API.insertConvoy({
          to_user: toId,
          to_name: toName,
          from_name: row.fromName,
          tier: row.tierId,
          items: row.items,
          dishes: row.dishes,
          arrives_at: new Date(row.arrivesAt).toISOString(),
        });
      } catch (e) { res = null; }                 // api never throws; belt and braces
      if (res && res.ok && res.row && res.row.id) {
        row.remoteId = res.row.id;
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
        //    than the ingredients cost (rule 4). Renaming the row is what makes
        //    that legible instead of looking like a bug.
        // Flags, not an error toast. CONTRACT §9: `missing` is a SETUP state.
        if (res && res.missing) K.missing = true;
        if (res && res.offline) K.offline = true;
        row.local = true;
        row.self = true;        // nobody else can see it, so it is claimable here
        row.toName = myName() + ' (local run)';
        K.rev++;
        forceSave(K);
      }
    }

    return ok({ id: row.id, convoy: row, feeCinder: paid, local: !row.remoteId });
  } catch (e) {
    return no('BAD_ARG', 'The convoy did not leave.');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   §3 — TRANSIT & ARRIVAL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Spoilage in transit. OPTIONAL AND OFF BY DEFAULT.
 *
 * ⚠ `ECON.CONVOY_SPOIL_PCT` does not exist yet, so this returns 0 and the
 * feature behaves exactly as CONTRACT §8.4 describes. The mechanism is written
 * because "spoilage or risk in transit" was asked for; the NUMBER is not,
 * because a loss rate is an economy number and economy numbers live in
 * kitchen.data.js (CLAUDE.md's `_opEcon()` rule). Add the key there to switch
 * it on — nothing here needs to change.
 *
 * 🔴 IT IS DETERMINISTIC PER CONVOY, hashed off the id. A re-rolled loss would
 * change the arrival amount every repaint and would let a client reload until
 * it rolled zero. And it can only ever REDUCE the payout, so it cannot become a
 * hole in the food-printer guard.
 */
function spoilOf(c) {
  const pct = _clamp(_num(EC('CONVOY_SPOIL_PCT', 0), 0), 0, 0.5);
  if (pct <= 0) return 0;
  const dishes = Math.max(0, _int(c && c.dishes));
  if (dishes <= 0) return 0;
  // Hash decides the ROLL, pct decides the CEILING: an ordinary truck loses
  // nothing, an unlucky one loses up to `pct` of the load. Never all of it —
  // a total loss is not a game mechanic, it is a bug report.
  const roll = _hash01((c && (c.remoteId || c.id)) || '');
  return Math.min(dishes - 1, Math.floor(dishes * pct * roll));
}

/** Units of live `food` a convoy still owes its recipient. The ONLY place the
    payout is computed, and it is computed from `dishes` × ECON — never from a
    `food` field on the row, which on an inbound convoy was written by somebody
    else's client and is therefore a claim, not a fact. */
function owedFood(c) {
  const dishes = Math.max(0, _int(c && c.dishes));
  const perDish = Math.max(0, _num(EC('CONVOY_FOOD_PER_DISH', 1), 1));
  const gross = Math.max(0, Math.floor((dishes - spoilOf(c)) * perDish));
  return Math.max(0, gross - Math.max(0, _int(c && c.paidFood)));
}

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

    raise(K, out, 'convoy:arrive', {
      id: c.id, dishes: _int(c.dishes), toName: c.toName || '', self: !!c.self, dir: 'out',
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
    raise(K, out, 'convoy:arrive', {
      id: c.id, dishes: _int(c.dishes), toName: c.toName || '', self: false, dir: 'in',
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
    // Opening the bay is the natural moment to ask the server what turned up
    // while you were gone. Fire-and-forget: `catchUp` is synchronous by
    // contract (state.js consumes its return value inline) and a network round
    // trip must never sit in front of the panel opening.
    maybeSync(K, _num(now, 0), true);
  } catch (e) {}
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
   §4 — THE NETWORK MIRROR
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
    // name is who sent it, so that is what goes there.
    toName: 'From ' + String(row.from_name || 'another kitchen').slice(0, 40),
    fromName: String(row.from_name || '').slice(0, 40),
    items: (row.items && typeof row.items === 'object') ? row.items : {},
    dishes: Math.max(0, _int(row.dishes)),
    launchedAt: launched || (arrives - 1),
    arrivesAt: arrives,
    state: claimed ? 'claimed' : (arrives && arrives <= _num(now, 0) ? 'arrived' : 'transit'),
    feeCinder: 0,
    paidFood: 0,
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
      //    yanked out from under them once a minute for no reason at all.
      if (had || K.missing !== miss || K.offline !== off || K.error !== err) K.rev++;
      K.missing = miss; K.offline = off; K.error = err;
      return false;
    }
    const changed = K.missing || K.offline || K.error;
    K.missing = false; K.offline = false; K.error = null;

    const now = _num(K.now, 0);
    const rows = Array.isArray(inb.rows) ? inb.rows : [];
    const seen = Object.create(null);
    const next = [];
    for (const r of rows) {
      if (!r || !r.id || seen[r.id]) continue;
      seen[r.id] = 1;
      const m = mapInbound(r, now);
      if (m.state === 'claimed') continue;         // already unloaded; nothing to show
      // Carry forward a partial unload so a stash that filled up mid-claim does
      // not pay the landed part twice after a refresh.
      const prev = (K.inbound || []).find((x) => x && x.remoteId === r.id);
      if (prev) m.paidFood = Math.max(0, _int(prev.paidFood));
      next.push(m);
    }
    // Same repaint discipline as the failure branch: a heartbeat that changed
    // nothing must not repaint. The signature is id+state, which is everything
    // render's convoy row draws structurally (the ETA is a `frame()` update).
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
        const r = byRemote[c.remoteId];
        if (!r) continue;
        if (String(r.state || '') === 'claimed') { c.state = 'claimed'; drop.push(c.id); }
      }
      if (drop.length) {
        K.convoys = K.convoys.filter((c) => drop.indexOf(c.id) === -1);
        reconciled = true;
        forceSave(K);   // the board shrank; that belongs in the save, not in RAM
      }
    }

    if (dirty || reconciled || changed) K.rev++;
    return true;
  } catch (e) {
    // The api layer does not throw; this is the last net under it.
    try { K.inbound = []; K.rev++; } catch (e2) {}
    return false;
  }
}

/**
 * Throttled fire-and-forget wrapper around `refreshInbound`.
 *
 * ⚠ NOTHING ELSE CALLS refreshInbound. render's convoy sheet reads `K.inbound`
 * and index.js drives only `tick`/`catchUp`, so without this hook an inbound
 * convoy would never appear on the board at all. The throttle stamp is `now` —
 * the same value the sim runs on — so there is still no clock read in here.
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
   §5 — CLAIM: the only place `food` enters the live ledger
   ═══════════════════════════════════════════════════════════════════════════ */

function findConvoy(K, convoyId) {
  const id = String(convoyId || '');
  for (const c of (K.convoys || [])) if (c && c.id === id) return { row: c, where: 'out' };
  for (const c of (K.inbound || [])) if (c && (c.id === id || c.remoteId === id)) return { row: c, where: 'in' };
  return null;
}

/**
 * Unload an arrived convoy into the stash.
 *
 * THE ORDER OF OPERATIONS IS THE WHOLE SAFETY STORY:
 *   1. Refuse anything that has not landed. No payout for a truck in transit.
 *   2. PREFLIGHT THE STASH CAP before touching the server. If the vault has no
 *      room, nothing is claimed anywhere and the truck stays claimable.
 *   3. SERVER FIRST for an inbound convoy — `kitchen_convoy_claim()` appends
 *      the ledger row and flips the state atomically, and its unique index
 *      makes a replayed request a no-op rather than a second payout. The stash
 *      is credited on what came BACK, never before (community.api.js's
 *      `claimRewards` rule, and it exists because a double-click paid twice).
 *   4. `addRes` then RE-READ `getRes`. 🔴 §7: `addRes()` enforces the stash cap
 *      and returns without adding when the vault is full. A short landing is
 *      reported as `{ok:false, code:'CAP'}` with the truck still claimable —
 *      NEVER silently clamped. `paidFood` records what did land so the retry
 *      pays only the remainder.
 */
export async function claim(K, convoyId, now) {
  try {
    if (!K || typeof K !== 'object') return no('BAD_ARG', 'The kitchen is not open.');
    const t = _num(now, _num(K.now, 0));
    const found = findConvoy(K, convoyId);
    if (!found) return no('BAD_ARG', 'That convoy is not on the board.');
    const c = found.row;

    if (c.state === 'claimed') return no('NOT_READY', 'That convoy has already been unloaded.');
    if (c.state !== 'arrived' || _num(c.arrivesAt, Infinity) > t) {
      return no('NOT_READY', 'That convoy is still on the road.');
    }

    const grant = owedFood(c);
    const b = bridge();

    // 2 · ROOM.
    // ⚠ A cap of 0 means the bridge could not tell us (NULL_BRIDGE returns 0 for
    //   both readings), NOT that the stash is full. Gating on an unknown would
    //   make every claim fail on CONTRACT §9 rung 1. The post-credit re-read
    //   below is the real check; this one exists only to avoid burning the
    //   server-side claim on a vault we already know cannot take it.
    let room = Infinity;
    try {
      const cap = _int(b.resourceCap ? b.resourceCap() : 0);
      const used = _int(b.resourceUnits ? b.resourceUnits() : 0);
      if (cap > 0) room = Math.max(0, cap - used);
    } catch (e) { room = Infinity; }
    if (grant > 0 && room <= 0) {
      return no('CAP', 'Your stash is full — make room before you unload this.');
    }

    // 3 · THE SERVER LEG, for an inbound convoy only.
    if (found.where === 'in') {
      if (!c.remoteId) return no('BAD_ARG', 'That convoy has no manifest.');
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
      // and the row is the record. Still capped by the same ECON maths.
      if (res.row && res.row.dishes != null) c.dishes = Math.max(0, _int(res.row.dishes));
    }

    const owed = owedFood(c);       // recomputed: the server may have corrected `dishes`
    if (owed <= 0) {
      completeClaim(K, found, t, 0);
      return ok({ granted: 0 });
    }

    // 4 · CREDIT.
    if (typeof b.addRes !== 'function') {
      // Rung 1: no bridge at all. There is no stash to put it in, and leaving a
      // phantom truck stuck on the board forever would be worse than a no-op.
      completeClaim(K, found, t, 0);
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
      // 🔴 SHORT LANDING. The truck stays claimable and keeps the remainder.
      //    "The preflight should have caught it" is exactly how 215 units of a
      //    real player's resources went missing — see the refundRes note in §7.
      const left = owed - landed;
      forceSave(K);
      raise(K, null, 'convoy:claim', { id: c.id, granted: landed, short: left, partial: true });
      return no('CAP', 'Your stash filled up — ' + left + ' food is still on the truck.', { granted: landed });
    }

    completeClaim(K, found, t, landed);
    return ok({ granted: landed });
  } catch (e) {
    return no('BAD_ARG', 'That convoy will not unload.');
  }
}

/** Retire a fully-unloaded truck. Completed convoys are REMOVED rather than
    left in `'claimed'`: render lists everything in `K.convoys` under "On the
    road", and a finished truck is not on the road. The server ledger is the
    history (`listConvoyLedger`); `K.convoys` is the board. */
function completeClaim(K, found, t, granted) {
  const c = found.row;
  c.state = 'claimed';
  c.claimedAt = t;
  if (found.where === 'in') K.inbound = (K.inbound || []).filter((x) => x !== c);
  else K.convoys = (K.convoys || []).filter((x) => x !== c);
  K.rev++;
  raise(K, null, 'convoy:claim', {
    id: c.id, granted: _int(granted), dishes: _int(c.dishes), dir: found.where === 'in' ? 'in' : 'out',
  });
  forceSave(K);
}

/* ═══════════════════════════════════════════════════════════════════════════
   §6 — READ-ONLY VIEWS (for render and the debug panel)
   ═══════════════════════════════════════════════════════════════════════════
   ⚠ NOT IN CONTRACT.md's EXPORT LIST, and this note is the "say so" §0 asks
   for. They are pure reads over `K` with no mutation and no side effects, so
   nothing downstream has to know they exist; they want adding to §1 on the next
   pass. Nothing in this file depends on them.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every truck on the board, mine and inbound, newest departure first. */
export function board(K) {
  const rows = [].concat(K && K.convoys ? K.convoys : [], K && K.inbound ? K.inbound : []);
  return rows.slice().sort((a, b2) => _num(b2.launchedAt, 0) - _num(a.launchedAt, 0));
}

/** 0..1 progress along the route, for the bar under a convoy row. */
export function progress(c, now) {
  if (!c) return 0;
  const span = Math.max(1, _num(c.arrivesAt, 0) - _num(c.launchedAt, 0));
  return _clamp((_num(now, 0) - _num(c.launchedAt, 0)) / span, 0, 1);
}

/** What a recipient shortlist looks like before a picker exists: my corp, and
    whatever the api can find by name. Returns `{ok, rows}`, never throws. */
export async function recipients(fragment) {
  const out = [];
  try {
    const b = bridge();
    const corp = b.myCorp ? b.myCorp() : null;
    if (corp && corp.id) out.push({ id: null, corpId: corp.id, name: corp.name || corp.tag || 'My corp', kind: 'corp' });
  } catch (e) {}
  try {
    const r = await API.findPlayer(fragment);
    if (r && r.ok) for (const row of (r.rows || [])) out.push({ id: row.user_id, name: row.display_name || 'Survivor', kind: 'player' });
  } catch (e) {}
  return { ok: true, rows: out };
}
